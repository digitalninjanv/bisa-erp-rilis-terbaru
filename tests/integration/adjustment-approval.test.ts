import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  journalEntries,
  products,
  stockDocuments,
  suppliers,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  applyStockMovement,
  approveStockAdjustment,
  cancelStockAdjustment,
  createAdjustment,
  rejectStockAdjustment,
} from "@/server/inventory";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// T5-3 (D-17): approval workflow penyesuaian stok (maker-checker).
// (a) ambang kosong → perilaku lama: langsung posted.
// (b) di atas ambang → pending tanpa gerakan/jurnal; pembuat tidak bisa
//     menyetujui sendiri; pengguna lain menyetujui → terposting sekali.
// (c) tolak beralasan → rejected tanpa efek; batalkan oleh pembuat → void.
// (d) dua persetujuan konkuren → tepat satu yang menerapkan.
// (e) nilai tepat di ambang → langsung posted (aturan ">" bukan "≥").
// (f) periode tanggal dokumen tertutup → approve gagal, tetap pending.
// (a)–(c), (e), (f) memakai transaksi rollback di perusahaan demo dengan
// ambang diatur di dalam transaksi yang sama; (d) memakai perusahaan uji
// tersendiri dengan transaksi commit sungguhan (kunci baris hanya
// terlihat antar-transaksi).

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const RACE_ORG = "01900000-0000-7000-8000-00000000aa41";
const MAKER = "01900000-0000-7000-8000-000000000010";
const CHECKER = "01900000-0000-7000-8000-000000000011";
const CHECKER_2 = "01900000-0000-7000-8000-000000000012";
const suffix = crypto.randomUUID().slice(0, 8);
const today = todayISO();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function orgTx<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${org}, true)`);
    return fn(tx);
  });
}

async function setThreshold(tx: Tx, org: string, value: string | null) {
  await tx
    .update(companySettings)
    .set({ adjustmentApprovalThreshold: value })
    .where(eq(companySettings.companyId, org));
}

async function defaultWarehouse(tx: Tx, org: string) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, org), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function makeStockedProduct(
  tx: Tx,
  org: string,
  warehouseId: string,
  opts: { cost: string; qty: number; sku: string },
) {
  const [product] = await tx
    .insert(products)
    .values({
      companyId: org,
      sku: opts.sku,
      name: `Produk Uji Approval ${opts.sku}`,
      costPrice: opts.cost,
      salePrice: opts.cost,
      trackStock: true,
    })
    .returning({ id: products.id });
  await applyStockMovement(tx, {
    companyId: org,
    warehouseId,
    productId: product.id,
    delta: opts.qty,
    unitCost: opts.cost,
    movementType: "opening",
    userId: MAKER,
  });
  return product;
}

async function stockQty(tx: Tx, org: string, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, org),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    )
    .limit(1);
  return d(row?.qty ?? 0);
}

async function docRow(tx: Tx, org: string, docId: string) {
  const [row] = await tx
    .select()
    .from(stockDocuments)
    .where(and(eq(stockDocuments.companyId, org), eq(stockDocuments.id, docId)))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function journalCount(tx: Tx, org: string, docId: string) {
  const rows = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, org),
        eq(journalEntries.sourceType, "adjustment"),
        eq(journalEntries.sourceId, docId),
      ),
    );
  return rows.length;
}

async function movementCount(tx: Tx, org: string, docId: string) {
  const rows = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, org), eq(stockMovements.referenceId, docId)));
  return rows.length;
}

describe("Approval penyesuaian stok (T5-3 / D-17)", () => {
  it("(a) ambang kosong: penyesuaian langsung posted seperti perilaku lama", async () => {
    await rollbackTransaction(async (tx) => {
      await setThreshold(tx, ORG_ID, null);
      const warehouse = await defaultWarehouse(tx, ORG_ID);
      const product = await makeStockedProduct(tx, ORG_ID, warehouse.id, {
        cost: "10000",
        qty: 50,
        sku: `T5-APPR-A-${suffix}`,
      });

      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: today,
        type: "damaged",
        reason: "Kemasan rusak uji approval A",
        lines: [{ productId: product.id, qty: 5 }],
      });

      expect(doc.status).toBe("posted");
      expect((await docRow(tx, ORG_ID, doc.id)).status).toBe("posted");
      expect((await stockQty(tx, ORG_ID, warehouse.id, product.id)).toFixed(4)).toBe("45.0000");
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(1);
    });
  });

  it("(b) di atas ambang: pending tanpa efek; pembuat ditolak; pemeriksa menyetujui tepat sekali", async () => {
    await rollbackTransaction(async (tx) => {
      await setThreshold(tx, ORG_ID, "50000");
      const warehouse = await defaultWarehouse(tx, ORG_ID);
      const product = await makeStockedProduct(tx, ORG_ID, warehouse.id, {
        cost: "10000",
        qty: 50,
        sku: `T5-APPR-B-${suffix}`,
      });

      // Dampak: 10 × Rp10.000 = Rp100.000 > ambang Rp50.000.
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: today,
        type: "adjustment",
        reason: "Koreksi stok uji approval B",
        lines: [{ productId: product.id, qty: -10 }],
      });

      expect(doc.status).toBe("pending");
      const stored = await docRow(tx, ORG_ID, doc.id);
      expect(stored.status).toBe("pending");
      expect(d(stored.total).toFixed(4)).toBe("100000.0000");
      // Belum ada efek apa pun: stok utuh, nol gerakan, nol jurnal.
      expect((await stockQty(tx, ORG_ID, warehouse.id, product.id)).toFixed(4)).toBe("50.0000");
      expect(await movementCount(tx, ORG_ID, doc.id)).toBe(0);
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(0);

      // Maker ≠ checker ditegakkan di domain.
      await expect(
        approveStockAdjustment(tx, { companyId: ORG_ID, userId: MAKER, documentId: doc.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await docRow(tx, ORG_ID, doc.id)).status).toBe("pending");

      const approved = await approveStockAdjustment(tx, {
        companyId: ORG_ID,
        userId: CHECKER,
        documentId: doc.id,
      });
      expect(approved.status).toBe("posted");
      const after = await docRow(tx, ORG_ID, doc.id);
      expect(after.status).toBe("posted");
      expect(after.approvedBy).toBe(CHECKER);
      expect(after.approvedAt).not.toBeNull();
      expect((await stockQty(tx, ORG_ID, warehouse.id, product.id)).toFixed(4)).toBe("40.0000");
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(1);

      // Persetujuan kedua atas dokumen yang sama ditolak.
      await expect(
        approveStockAdjustment(tx, { companyId: ORG_ID, userId: CHECKER_2, documentId: doc.id }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(1);
    });
  });

  it("(c) penolakan beralasan → rejected tanpa efek; pembuat membatalkan pending miliknya → void", async () => {
    await rollbackTransaction(async (tx) => {
      await setThreshold(tx, ORG_ID, "50000");
      const warehouse = await defaultWarehouse(tx, ORG_ID);
      const product = await makeStockedProduct(tx, ORG_ID, warehouse.id, {
        cost: "10000",
        qty: 50,
        sku: `T5-APPR-C-${suffix}`,
      });

      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: today,
        type: "damaged",
        reason: "Barang rusak uji approval C",
        lines: [{ productId: product.id, qty: 10 }],
      });
      expect(doc.status).toBe("pending");

      // Penolakan tanpa alasan ditolak; oleh pembuat sendiri juga ditolak.
      await expect(
        rejectStockAdjustment(tx, {
          companyId: ORG_ID,
          userId: CHECKER,
          documentId: doc.id,
          reason: "  ",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        rejectStockAdjustment(tx, {
          companyId: ORG_ID,
          userId: MAKER,
          documentId: doc.id,
          reason: "Saya buat sendiri",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const rejected = await rejectStockAdjustment(tx, {
        companyId: ORG_ID,
        userId: CHECKER,
        documentId: doc.id,
        reason: "Bukti foto kerusakan tidak ada",
      });
      expect(rejected.status).toBe("rejected");
      const stored = await docRow(tx, ORG_ID, doc.id);
      expect(stored.status).toBe("rejected");
      expect(stored.rejectionReason).toBe("Bukti foto kerusakan tidak ada");
      expect((await stockQty(tx, ORG_ID, warehouse.id, product.id)).toFixed(4)).toBe("50.0000");
      expect(await movementCount(tx, ORG_ID, doc.id)).toBe(0);
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(0);

      // Dokumen rejected tidak bisa disetujui lagi.
      await expect(
        approveStockAdjustment(tx, { companyId: ORG_ID, userId: CHECKER, documentId: doc.id }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      // Pembatalan pending oleh pembuatnya sendiri.
      const doc2 = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: today,
        type: "damaged",
        reason: "Barang rusak uji batal C2",
        lines: [{ productId: product.id, qty: 8 }],
      });
      expect(doc2.status).toBe("pending");
      await expect(
        cancelStockAdjustment(tx, { companyId: ORG_ID, userId: CHECKER, documentId: doc2.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const cancelled = await cancelStockAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        documentId: doc2.id,
      });
      expect(cancelled.status).toBe("void");
      expect((await docRow(tx, ORG_ID, doc2.id)).status).toBe("void");
      expect(await movementCount(tx, ORG_ID, doc2.id)).toBe(0);
      expect(await journalCount(tx, ORG_ID, doc2.id)).toBe(0);
    });
  });

  it("(e) nilai dampak tepat di ambang: langsung posted (aturan > bukan ≥)", async () => {
    await rollbackTransaction(async (tx) => {
      await setThreshold(tx, ORG_ID, "100000");
      const warehouse = await defaultWarehouse(tx, ORG_ID);
      const product = await makeStockedProduct(tx, ORG_ID, warehouse.id, {
        cost: "10000",
        qty: 50,
        sku: `T5-APPR-E-${suffix}`,
      });

      // Dampak tepat Rp100.000 = ambang → tidak menunggu persetujuan.
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: today,
        type: "damaged",
        reason: "Barang rusak uji approval E",
        lines: [{ productId: product.id, qty: 10 }],
      });

      expect(doc.status).toBe("posted");
      expect((await stockQty(tx, ORG_ID, warehouse.id, product.id)).toFixed(4)).toBe("40.0000");
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(1);
    });
  });

  it("(f) approve pada tanggal dokumen yang periodenya tertutup gagal dan dokumen tetap pending", async () => {
    await rollbackTransaction(async (tx) => {
      await setThreshold(tx, ORG_ID, "50000");
      const warehouse = await defaultWarehouse(tx, ORG_ID);
      const product = await makeStockedProduct(tx, ORG_ID, warehouse.id, {
        cost: "10000",
        qty: 50,
        sku: `T5-APPR-F-${suffix}`,
      });

      // Periode ≤ Okt 2026 pada data demo berstatus closed; dokumen
      // pending boleh dibuat (belum ada jurnal), tetapi persetujuannya
      // harus gagal sampai periode dibuka kembali.
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: "2026-09-15",
        type: "damaged",
        reason: "Barang rusak uji approval F",
        lines: [{ productId: product.id, qty: 10 }],
      });
      expect(doc.status).toBe("pending");

      await expect(
        approveStockAdjustment(tx, { companyId: ORG_ID, userId: CHECKER, documentId: doc.id }),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      expect((await docRow(tx, ORG_ID, doc.id)).status).toBe("pending");
      expect((await stockQty(tx, ORG_ID, warehouse.id, product.id)).toFixed(4)).toBe("50.0000");
      expect(await journalCount(tx, ORG_ID, doc.id)).toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ */
/* (d) Balapan persetujuan — perusahaan uji tersendiri, commit nyata   */
/* ------------------------------------------------------------------ */

let raceWarehouseId = "";
let raceDocId = "";
let raceProductId = "";

beforeAll(async () => {
  await orgTx(RACE_ORG, async (tx) => {
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, RACE_ORG))
      .limit(1);
    if (!settings) {
      await tx.insert(companySettings).values({
        companyId: RACE_ORG,
        legalName: "Perusahaan Uji Balapan Approval",
        adjustmentApprovalThreshold: "1000",
        allowNegativeStock: false,
        taxRate: "0",
      });
      const accountRows = await tx
        .insert(accounts)
        .values([
          { companyId: RACE_ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "1200", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: RACE_ORG, code: "2100", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "2200", name: "PPN Keluaran", type: "liability", normalBalance: "credit" },
          { companyId: RACE_ORG, code: "3000", name: "Modal", type: "equity", normalBalance: "credit" },
          { companyId: RACE_ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: RACE_ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "4020", name: "Retur Penjualan", type: "revenue", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "6020", name: "Selisih Stok", type: "expense", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "6030", name: "Barang Rusak", type: "expense", normalBalance: "debit" },
          { companyId: RACE_ORG, code: "9000", name: "Laba Pembulatan", type: "revenue", normalBalance: "credit" },
          { companyId: RACE_ORG, code: "9001", name: "Rugi Pembulatan", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(accountRows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: RACE_ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: RACE_ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: RACE_ORG, key: "qris", accountId: byCode.get("1100")! },
        { companyId: RACE_ORG, key: "inventory", accountId: byCode.get("1200")! },
        { companyId: RACE_ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: RACE_ORG, key: "receivable", accountId: byCode.get("2100")! },
        { companyId: RACE_ORG, key: "tax_output", accountId: byCode.get("2200")! },
        { companyId: RACE_ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: RACE_ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: RACE_ORG, key: "sales_discount", accountId: byCode.get("4010")! },
        { companyId: RACE_ORG, key: "sales_return", accountId: byCode.get("4020")! },
        { companyId: RACE_ORG, key: "cogs", accountId: byCode.get("5000")! },
        { companyId: RACE_ORG, key: "inventory_shrink", accountId: byCode.get("6020")! },
        { companyId: RACE_ORG, key: "damaged", accountId: byCode.get("6030")! },
        { companyId: RACE_ORG, key: "rounding_gain", accountId: byCode.get("9000")! },
        { companyId: RACE_ORG, key: "rounding_loss", accountId: byCode.get("9001")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: RACE_ORG, code: "GDG-T5A", name: "Gudang Approval", isDefault: true })
        .returning({ id: warehouses.id });
      raceWarehouseId = warehouse.id;
    } else {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, RACE_ORG))
        .limit(1);
      raceWarehouseId = warehouse.id;
    }

    // Setiap run memakai produk + dokumen baru agar balapan antar-run
    // tidak saling mengganggu (file aman dijalankan ulang).
    const product = await makeStockedProduct(tx, RACE_ORG, raceWarehouseId, {
      cost: "10000",
      qty: 100,
      sku: `T5-APPR-D-${suffix}`,
    });
    raceProductId = product.id;
    const doc = await createAdjustment(tx, {
      companyId: RACE_ORG,
      userId: MAKER,
      warehouseId: raceWarehouseId,
      date: today,
      type: "damaged",
      reason: "Barang rusak uji balapan approval",
      lines: [{ productId: product.id, qty: 5 }],
    });
    expect(doc.status).toBe("pending");
    raceDocId = doc.id;
  });
});

describe("Balapan persetujuan penyesuaian (T5-3 / D-17)", () => {
  it("(d) dua approve konkuren: tepat satu menerapkan gerakan + jurnal", async () => {
    const attempt = (userId: string) =>
      orgTx(RACE_ORG, (tx) =>
        approveStockAdjustment(tx, { companyId: RACE_ORG, userId, documentId: raceDocId }),
      );
    const results = await Promise.allSettled([attempt(CHECKER), attempt(CHECKER_2)]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ code: "INVALID_STATE" });
    }

    await orgTx(RACE_ORG, async (tx) => {
      expect((await docRow(tx, RACE_ORG, raceDocId)).status).toBe("posted");
      expect((await stockQty(tx, RACE_ORG, raceWarehouseId, raceProductId)).toFixed(4)).toBe("95.0000");
      expect(await journalCount(tx, RACE_ORG, raceDocId)).toBe(1);
    });
  });
});

/* ------------------------------------------------------------------ */
/* T5R-5 — gerbang approval hanya untuk keluarga write-off. Retur      */
/* pembelian adalah dokumen bisnis (klaim/potong utang ke pemasok) dan */
/* karantina perpindahan lokasi murni: keduanya selalu langsung        */
/* terposting berapa pun nilainya, agar label pengaturan jujur.        */
/* ------------------------------------------------------------------ */

describe("Approval hanya untuk keluarga write-off (T5R-5)", () => {
  it("(g) ambang kecil terpasang: purchase_return kini ditolak FIX-P1 (AK4-02); damaged tetap pending", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setThreshold(tx, ORG_ID, "1000");
      const warehouse = await defaultWarehouse(tx, ORG_ID);
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID))
        .limit(1);
      expect(supplier).toBeDefined();
      const product = await makeStockedProduct(tx, ORG_ID, warehouse.id, {
        cost: "5000",
        qty: 10,
        sku: `T5R5-${suffix}`,
      });

      // Retur pemasok tidak lagi melewati penyesuaian sama sekali
      // (FIX-P1 AK4-02) — bukan "langsung posted" seperti klaim T5R-5
      // lama, melainkan ditolak dan diarahkan ke modul Retur Pembelian.
      let returnError: unknown;
      try {
        await createAdjustment(tx, {
          companyId: ORG_ID,
          userId: MAKER,
          warehouseId: warehouse.id,
          date: today,
          type: "purchase_return",
          reason: "Uji T5R-5 retur ke pemasok",
          supplierId: supplier.id,
          refundMethod: "deduction",
          lines: [{ productId: product.id, qty: 2 }],
        });
      } catch (caught) {
        returnError = caught;
      }
      const stockAfterReturnAttempt = await stockQty(tx, ORG_ID, warehouse.id, product.id);

      const damaged = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: MAKER,
        warehouseId: warehouse.id,
        date: today,
        type: "damaged",
        reason: "Uji T5R-5 barang rusak",
        lines: [{ productId: product.id, qty: 2 }],
      });

      return { returnError, damaged, stockAfterReturnAttempt };
    });

    expect(outcome.returnError).toBeInstanceOf(AppError);
    expect(outcome.stockAfterReturnAttempt.toNumber()).toBe(10);
    expect(outcome.damaged.status).toBe("pending");
  });
});
