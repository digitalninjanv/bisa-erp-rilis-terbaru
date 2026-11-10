import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  auditLog,
  companySettings,
  journalEntries,
  products,
  stockDocumentLines,
  stockMovements,
  stockOnHand,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";
import {
  createAdjustment,
  createOpname,
  createReceipt,
  createTransfer,
} from "@/server/inventory";
import {
  findUsedPackagingIds,
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog/packaging";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * Program Satuan Kemasan S3 — gudang: opname hitungan campuran
 * (dus utuh + pak utuh + pcs lepas) menjumlah ke satuan dasar,
 * transfer & penyesuaian menerima satuan kemasan dengan cuplikan,
 * dan kemasan yang terpakai dokumen stok terdaftar di penjaga hapus.
 * Semua dalam transaksi rollback di perusahaan demo.
 */
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

const rollbackTransaction = makeRollbackTransaction(ORG_ID, { before: alignSequences });

/** Samakan penomoran dokumen stok & penerimaan ke max(ter-commit)+1
 * di dalam transaksi uji (pola packaging-purchasing.test.ts). */
async function alignSequences(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const series: [string, string, string][] = [
    ["RECEIPT", "stock_receipts", "RCV"],
    ["OPNAME", "stock_documents", "OPN"],
    ["TRANSFER", "stock_documents", "TRF"],
    ["ADJUSTMENT", "stock_documents", "ADJ"],
  ];
  for (const [docType, table, prefix] of series) {
    await tx.execute(sql`
      insert into document_sequences (company_id, doc_type, fiscal_year, prefix, next_number)
      select ${ORG_ID}, ${docType}, ${year}, ${prefix},
             coalesce(max(cast(substring(number from '[0-9]+$') as integer)), 0) + 1
        from ${sql.raw(table)}
       where company_id = ${ORG_ID} and number like ${`${prefix}-${year}-%`}
      on conflict (company_id, doc_type, fiscal_year)
      do update set next_number = greatest(document_sequences.next_number, excluded.next_number)
    `);
  }
  // Deterministik di dalam transaksi uji: transfer satu tahap &
  // penyesuaian tanpa gerbang persetujuan (keduanya diuji tahap lain).
  await tx
    .update(companySettings)
    .set({ transferTwoStepEnabled: false, adjustmentApprovalThreshold: null })
    .where(eq(companySettings.companyId, ORG_ID));
}

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function otherWarehouse(tx: Tx, excludeId: string) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(
      and(
        eq(warehouses.companyId, ORG_ID),
        eq(warehouses.isActive, true),
        sql`${warehouses.id} <> ${excludeId}`,
        sql`${warehouses.type} <> 'quarantine'`,
      ),
    )
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function anySupplier(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  expect(supplier).toBeDefined();
  return supplier;
}

async function makeProduct(tx: Tx, costPrice = "2500") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [pcs] = await tx
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.companyId, ORG_ID), eq(units.code, "PCS")))
    .limit(1);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-S3-${suffix}`,
      name: `Produk Uji S3 ${suffix}`,
      costPrice,
      salePrice: "3800",
      trackStock: true,
      unitId: pcs?.id,
    })
    .returning({ id: products.id });
  return product;
}

/** Tanam kemasan produk; mengembalikan peta nama → baris kemasan. */
async function addPackagings(
  tx: Tx,
  productId: string,
  defs: { name: string; isi: string }[],
) {
  await syncProductPackagings(
    tx,
    ORG_ID,
    productId,
    defs.map((def) => ({
      name: def.name,
      isi: def.isi,
      buyPrice: null,
      salePrice: null,
      barcode: null,
      isDefaultPurchase: false,
      isDefaultSale: false,
      isActive: true,
    })),
    { priceGateSatisfied: true },
  );
  const rows = await listProductPackagings(tx, ORG_ID, productId);
  return new Map(rows.map((row) => [row.name, row]));
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? 0);
}

async function stockIn(tx: Tx, warehouseId: string, supplierId: string, productId: string, qty: string, unitCost = "2500") {
  await createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    supplierId,
    source: "purchase",
    date: todayISO(),
    lines: [{ productId, qty, unitCost }],
  });
}

async function docLines(tx: Tx, documentId: string) {
  return tx
    .select()
    .from(stockDocumentLines)
    .where(
      and(eq(stockDocumentLines.companyId, ORG_ID), eq(stockDocumentLines.documentId, documentId)),
    );
}

describe("opname hitungan campuran (S3)", () => {
  it("buku 345, hitung 3 Dus (100) + 4 Slop (10) + 5 Pcs = 345 → selisih 0, tanpa gerakan/jurnal, rincian teraudit", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const packs = await addPackagings(tx, product.id, [
        { name: "Slop", isi: "10" },
        { name: "Dus", isi: "100" },
      ]);
      await stockIn(tx, warehouse.id, supplier.id, product.id, "345");
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(345));

      const doc = await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [
          {
            productId: product.id,
            countedQty: "345",
            countComponents: [
              { packagingId: packs.get("Dus")!.id, qty: "3" },
              { packagingId: packs.get("Slop")!.id, qty: "4" },
              { packagingId: null, qty: "5" },
            ],
          },
        ],
      });

      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(345));
      // Selisih nol: tidak ada baris dokumen, gerakan, atau jurnal.
      expect(await docLines(tx, doc.id)).toHaveLength(0);
      const movements = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.companyId, ORG_ID), eq(stockMovements.referenceId, doc.id)));
      expect(movements).toHaveLength(0);
      const journals = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.sourceId, doc.id)));
      expect(journals).toHaveLength(0);

      // Tetapi lembar hitung campurannya TETAP teraudit lengkap.
      const [audit] = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.entityId, doc.id),
            eq(auditLog.action, "inventory.opname"),
          ),
        );
      const after = audit.after as {
        counts: {
          countedQty: string;
          components: { packagingName: string; qtyInput: string; baseQty: string }[];
        }[];
      };
      expect(after.counts).toHaveLength(1);
      expect(after.counts[0].countedQty).toBe("345.0000");
      expect(
        after.counts[0].components.map((c) => `${c.qtyInput} ${c.packagingName} = ${c.baseQty}`),
      ).toEqual(["3.0000 Dus = 300.0000", "4.0000 Slop = 40.0000", "5.0000 Pieces = 5.0000"]);
    });
  });

  it("hitungan menyimpang (340 dari buku 345) → selisih dasar −5, baris menyimpan count_breakdown", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const packs = await addPackagings(tx, product.id, [
        { name: "Slop", isi: "10" },
        { name: "Dus", isi: "100" },
      ]);
      await stockIn(tx, warehouse.id, supplier.id, product.id, "345");

      const doc = await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [
          {
            productId: product.id,
            countedQty: "340",
            countComponents: [
              { packagingId: packs.get("Dus")!.id, qty: "3" },
              { packagingId: packs.get("Slop")!.id, qty: "3" },
              { packagingId: null, qty: "10" },
            ],
          },
        ],
      });

      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(340));
      const [line] = await docLines(tx, doc.id);
      expect(line.qty).toBe("-5.0000");
      expect(line.systemQty).toBe("345.0000");
      expect(line.qtyInput).toBe("340.0000");
      expect(line.isiSnapshot).toBe("1.0000");
      expect(line.packagingId).toBeNull();
      expect(line.countBreakdown).toHaveLength(3);
      expect(line.countBreakdown?.map((c) => c.baseQty)).toEqual([
        "300.0000",
        "30.0000",
        "10.0000",
      ]);
      // Selisih bukan nol menjurnal seperti opname biasa.
      const journals = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.sourceId, doc.id)));
      expect(journals).toHaveLength(1);
    });
  });

  it("komponen kemasan produk lain & komponen ganda ditolak sebelum stok bergerak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      const other = await makeProduct(tx);
      const packs = await addPackagings(tx, product.id, [{ name: "Dus", isi: "100" }]);
      const otherPacks = await addPackagings(tx, other.id, [{ name: "Dus", isi: "24" }]);
      await stockIn(tx, warehouse.id, supplier.id, product.id, "50");

      await expect(
        createOpname(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [
            {
              productId: product.id,
              countedQty: "24",
              countComponents: [{ packagingId: otherPacks.get("Dus")!.id, qty: "1" }],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        createOpname(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [
            {
              productId: product.id,
              countedQty: "200",
              countComponents: [
                { packagingId: packs.get("Dus")!.id, qty: "1" },
                { packagingId: packs.get("Dus")!.id, qty: "1" },
              ],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(50));
    });
  });

  it("opname satuan dasar tanpa komponen: perilaku & baris persis lama", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx);
      await stockIn(tx, warehouse.id, supplier.id, product.id, "20");

      const doc = await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.id, countedQty: "18" }],
      });
      const [line] = await docLines(tx, doc.id);
      expect(line.qty).toBe("-2.0000");
      expect(line.qtyInput).toBe("18.0000");
      expect(line.isiSnapshot).toBe("1.0000");
      expect(line.packagingId).toBeNull();
      expect(line.countBreakdown).toBeNull();
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(18));
    });
  });
});

describe("transfer & penyesuaian berkemasan (S3)", () => {
  it("transfer 2 Dus isi 40 → bergerak 80 pcs; baris menyimpan cuplikan", async () => {
    await rollbackTransaction(async (tx) => {
      const from = await defaultWarehouse(tx);
      const to = await otherWarehouse(tx, from.id);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, "3100");
      const packs = await addPackagings(tx, product.id, [{ name: "Dus", isi: "40" }]);
      await stockIn(tx, from.id, supplier.id, product.id, "200", "3100");

      const doc = await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "2", packagingId: packs.get("Dus")!.id }],
      });

      expect(await stockQty(tx, from.id, product.id)).toEqual(d(120));
      expect(await stockQty(tx, to.id, product.id)).toEqual(d(80));
      const [line] = await docLines(tx, doc.id);
      expect(line.qty).toBe("80.0000");
      expect(line.qtyInput).toBe("2.0000");
      expect(line.isiSnapshot).toBe("40.0000");
      expect(line.packagingId).toBe(packs.get("Dus")!.id);
      expect(line.countBreakdown).toBeNull();
    });
  });

  it("penyesuaian rusak 1 Dus isi 40 → stok −40; koreksi bertanda −1 Dus sama; cuplikan tersimpan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, "1000");
      const packs = await addPackagings(tx, product.id, [{ name: "Dus", isi: "40" }]);
      await stockIn(tx, warehouse.id, supplier.id, product.id, "120", "1000");

      const damaged = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Satu dus penyok parah saat bongkar muat.",
        lines: [{ productId: product.id, qty: "1", packagingId: packs.get("Dus")!.id }],
      });
      expect(damaged.status).toBe("posted");
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(80));
      const [damagedLine] = await docLines(tx, damaged.id);
      expect(damagedLine.qty).toBe("-40.0000");
      expect(damagedLine.qtyInput).toBe("1.0000");
      expect(damagedLine.isiSnapshot).toBe("40.0000");
      expect(damagedLine.packagingId).toBe(packs.get("Dus")!.id);

      const correction = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "adjustment",
        reason: "Koreksi salah hitung satu dus.",
        lines: [{ productId: product.id, qty: "-1", packagingId: packs.get("Dus")!.id }],
      });
      expect(correction.status).toBe("posted");
      expect(await stockQty(tx, warehouse.id, product.id)).toEqual(d(40));
      const [correctionLine] = await docLines(tx, correction.id);
      expect(correctionLine.qty).toBe("-40.0000");
      expect(correctionLine.qtyInput).toBe("-1.0000");
    });
  });

  it("produk tanpa kemasan: transfer & penyesuaian baris persis lama", async () => {
    await rollbackTransaction(async (tx) => {
      const from = await defaultWarehouse(tx);
      const to = await otherWarehouse(tx, from.id);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, "1000");
      await stockIn(tx, from.id, supplier.id, product.id, "30", "1000");

      const doc = await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "12" }],
      });
      const [line] = await docLines(tx, doc.id);
      expect(line.qty).toBe("12.0000");
      expect(line.qtyInput).toBe("12.0000");
      expect(line.isiSnapshot).toBe("1.0000");
      expect(line.packagingId).toBeNull();
      expect(await stockQty(tx, to.id, product.id)).toEqual(d(12));
    });
  });
});

describe("penjaga hapus kemasan terpakai dokumen stok (S3)", () => {
  it("kemasan terpakai transfer & komponen opname terdaftar — hapus ditolak, nonaktif sah", async () => {
    await rollbackTransaction(async (tx) => {
      const from = await defaultWarehouse(tx);
      const to = await otherWarehouse(tx, from.id);
      const supplier = await anySupplier(tx);
      const product = await makeProduct(tx, "1000");
      const packs = await addPackagings(tx, product.id, [
        { name: "Dus", isi: "40" },
        { name: "Pak", isi: "10" },
      ]);
      const dus = packs.get("Dus")!;
      const pak = packs.get("Pak")!;
      await stockIn(tx, from.id, supplier.id, product.id, "100", "1000");

      expect(await findUsedPackagingIds(tx, ORG_ID, [dus.id, pak.id])).toEqual(new Set());

      await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "1", packagingId: dus.id }],
      });
      // Pak hanya muncul sebagai KOMPONEN hitungan opname (jsonb).
      await createOpname(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: from.id,
        date: todayISO(),
        lines: [
          {
            productId: product.id,
            countedQty: "60",
            countComponents: [
              { packagingId: pak.id, qty: "1" },
              { packagingId: null, qty: "50" },
            ],
          },
        ],
      });

      expect(await findUsedPackagingIds(tx, ORG_ID, [dus.id, pak.id])).toEqual(
        new Set([dus.id, pak.id]),
      );
      await expect(
        syncProductPackagings(tx, ORG_ID, product.id, [], { priceGateSatisfied: true }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
