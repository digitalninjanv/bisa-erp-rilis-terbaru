import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  importJobs,
  importRows,
  journalEntries,
  journalLines,
  products,
  stockMovements,
  stockOnHand,
  stockReceipts,
  stockDocuments,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { getAccountMap } from "@/server/accounting";
import {
  createAdjustment,
  createReceipt,
  createTransfer,
  voidReceipt,
  voidStockDocument,
} from "@/server/inventory";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Action-level tests need an authenticated company context and Next's cache
// revalidation; both are replaced so the real action code runs against the
// real database, following payments-void-p2.test.ts.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const mod = {
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  };
  return { ...mod, requirePermissionInModule: mod.requirePermission };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
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

async function movementSum(tx: Tx, warehouseId: string, productId: string) {
  const rows = await tx
    .select({ qty: stockMovements.qty })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, ORG_ID),
        eq(stockMovements.warehouseId, warehouseId),
        eq(stockMovements.productId, productId),
      ),
    );
  return rows.reduce((acc, row) => acc.plus(d(row.qty)), d(0));
}

async function newProduct(tx: Tx, name: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-VI-${suffix}`,
      name,
      costPrice: "5000",
      salePrice: "9000",
      trackStock: true,
    })
    .returning({ id: products.id });
  return product;
}

/** Net (debit − credit) of one account across the given journal entries. */
async function accountNet(tx: Tx, entryIds: string[], accountId: string) {
  if (entryIds.length === 0) return d(0);
  const lines = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .where(and(eq(journalLines.companyId, ORG_ID), eq(journalLines.accountId, accountId), inArray(journalLines.entryId, entryIds)));
  return lines.reduce((acc, line) => acc.plus(d(line.debit)).minus(d(line.credit)), d(0));
}

describe("GD-P1-5 void penerimaan", () => {
  it("(a) membatalkan penerimaan: stok kembali, jurnal terbalik tertaut, status void, void ganda ditolak", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, "Produk Uji Void Penerimaan");

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 5000 }],
      });
      const stockAfterReceipt = await stockQty(tx, warehouse.id, product.id);

      const [originalEntry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "purchase"),
            eq(journalEntries.sourceId, receipt.id),
          ),
        );
      expect(originalEntry).toBeDefined();

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: receipt.id,
        reason: "Salah qty saat input penerimaan",
        date: todayISO(),
      });

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      const stockAfterVoid = await stockQty(tx, warehouse.id, product.id);
      const movementsTotal = await movementSum(tx, warehouse.id, product.id);
      const reversalMovements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceType, "stock_receipt_void"),
            eq(stockMovements.referenceId, receipt.id),
          ),
        );
      const [reversalEntry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "purchase_reversal"),
            eq(journalEntries.sourceId, receipt.id),
          ),
        );
      const map = await getAccountMap(tx, ORG_ID);
      const entryIds = [originalEntry.id, reversalEntry?.id ?? ""].filter(Boolean);
      const inventoryNet = await accountNet(tx, entryIds, map.inventory);
      const payableNet = await accountNet(tx, entryIds, map.payable);

      let doubleVoidError: { code?: string } | null = null;
      try {
        await voidReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          reason: "Coba batalkan dua kali",
          date: todayISO(),
        });
      } catch (error) {
        doubleVoidError = error as { code?: string };
      }

      return {
        stockAfterReceipt,
        stockAfterVoid,
        movementsTotal,
        reversalMovements,
        storedStatus: stored.status,
        originalEntry,
        reversalEntry,
        inventoryNet,
        payableNet,
        doubleVoidError,
      };
    });

    expect(outcome.stockAfterReceipt.toFixed(4)).toBe("10.0000");
    expect(outcome.stockAfterVoid.toFixed(4)).toBe("0.0000");
    // stock_on_hand tetap sama dengan jumlah seluruh gerakan (append-only).
    expect(outcome.movementsTotal.toFixed(4)).toBe("0.0000");
    expect(outcome.reversalMovements).toHaveLength(1);
    expect(d(outcome.reversalMovements[0].qty).toFixed(4)).toBe("-10.0000");
    expect(d(outcome.reversalMovements[0].unitCost).toFixed(4)).toBe("5000.0000");
    expect(outcome.storedStatus).toBe("void");
    // Jurnal pembalik tertaut ke jurnal penerimaan asal; kedua akun net-nol.
    expect(outcome.reversalEntry).toBeDefined();
    expect(outcome.reversalEntry.reversalOfId).toBe(outcome.originalEntry.id);
    expect(outcome.inventoryNet.toFixed(4)).toBe("0.0000");
    expect(outcome.payableNet.toFixed(4)).toBe("0.0000");
    // Void kedua ditolak.
    expect(outcome.doubleVoidError?.code).toBe("INVALID_STATE");
  });

  it("(b) menolak void penerimaan bila stok sudah terpakai sebagian — pesan menyebut produk, tidak ada yang berubah", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, "Produk Uji Void Ditolak");

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 5000 }],
      });
      // 4 dari 10 unit rusak dan dikeluarkan → sisa 6 < qty penerimaan.
      await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Pecah di gudang",
        lines: [{ productId: product.id, qty: 4 }],
      });
      const stockBefore = await stockQty(tx, warehouse.id, product.id);

      let voidError: { code?: string; message?: string } | null = null;
      try {
        await voidReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          reason: "Ingin membatalkan penerimaan",
          date: todayISO(),
        });
      } catch (error) {
        voidError = error as { code?: string; message?: string };
      }

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      const stockAfter = await stockQty(tx, warehouse.id, product.id);
      // Hanya pembalik milik penerimaan INI. Query lama menghitung semua
      // purchase_reversal perusahaan sehingga residu dokumen lain di DB
      // dev membuat tes gagal padahal penerimaan ini tidak berubah.
      const reversals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "purchase_reversal"),
            eq(journalEntries.sourceId, receipt.id),
          ),
        );

      return { stockBefore, stockAfter, voidError, storedStatus: stored.status, reversals };
    });

    expect(outcome.stockBefore.toFixed(4)).toBe("6.0000");
    expect(outcome.voidError).not.toBeNull();
    expect(outcome.voidError?.message).toMatch(/Produk Uji Void Ditolak/);
    // Tidak ada perubahan: status tetap posted, stok tetap, tak ada jurnal pembalik baru.
    expect(outcome.storedStatus).toBe("posted");
    expect(outcome.stockAfter.toFixed(4)).toBe("6.0000");
    expect(outcome.reversals).toHaveLength(0);
  });
});

describe("GD-P1-5 void dokumen stok", () => {
  it("(c) void penyesuaian keluar (damaged) mengembalikan stok dan membalik jurnalnya", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, "Produk Uji Void Penyesuaian");

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 5000 }],
      });
      const doc = await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        type: "damaged",
        reason: "Kemasan rusak",
        lines: [{ productId: product.id, qty: 3 }],
      });
      const stockAfterAdjustment = await stockQty(tx, warehouse.id, product.id);

      const [originalEntry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "adjustment"),
            eq(journalEntries.sourceId, doc.id),
          ),
        );
      expect(originalEntry).toBeDefined();

      await voidStockDocument(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        documentId: doc.id,
        reason: "Dokumen rusak salah input",
        date: todayISO(),
      });

      const [stored] = await tx
        .select()
        .from(stockDocuments)
        .where(eq(stockDocuments.id, doc.id));
      const stockAfterVoid = await stockQty(tx, warehouse.id, product.id);
      const movementsTotal = await movementSum(tx, warehouse.id, product.id);
      const [reversalEntry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "adjustment_reversal"),
            eq(journalEntries.sourceId, doc.id),
          ),
        );
      const map = await getAccountMap(tx, ORG_ID);
      const inventoryNet = await accountNet(
        tx,
        [originalEntry.id, reversalEntry?.id ?? ""].filter(Boolean),
        map.inventory,
      );

      return {
        stockAfterAdjustment,
        stockAfterVoid,
        movementsTotal,
        storedStatus: stored.status,
        originalEntry,
        reversalEntry,
        inventoryNet,
      };
    });

    expect(outcome.stockAfterAdjustment.toFixed(4)).toBe("7.0000");
    expect(outcome.stockAfterVoid.toFixed(4)).toBe("10.0000");
    expect(outcome.movementsTotal.toFixed(4)).toBe("10.0000");
    expect(outcome.storedStatus).toBe("void");
    expect(outcome.reversalEntry).toBeDefined();
    expect(outcome.reversalEntry.reversalOfId).toBe(outcome.originalEntry.id);
    expect(outcome.inventoryNet.toFixed(4)).toBe("0.0000");
  });

  it("(d) void transfer mengembalikan stok kedua gudang", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouseA = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, "Produk Uji Void Transfer");
      const suffix = crypto.randomUUID().slice(0, 8);
      const [warehouseB] = await tx
        .insert(warehouses)
        .values({ companyId: ORG_ID, code: `WH-VI-${suffix}`, name: "Gudang Uji Void" })
        .returning({ id: warehouses.id });

      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouseA.id,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 5000 }],
      });
      const doc = await createTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        fromWarehouseId: warehouseA.id,
        toWarehouseId: warehouseB.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 4 }],
      });
      const aAfterTransfer = await stockQty(tx, warehouseA.id, product.id);
      const bAfterTransfer = await stockQty(tx, warehouseB.id, product.id);

      await voidStockDocument(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        documentId: doc.id,
        reason: "Transfer salah tujuan",
        date: todayISO(),
      });

      const [stored] = await tx
        .select()
        .from(stockDocuments)
        .where(eq(stockDocuments.id, doc.id));
      const aAfterVoid = await stockQty(tx, warehouseA.id, product.id);
      const bAfterVoid = await stockQty(tx, warehouseB.id, product.id);
      const aMovements = await movementSum(tx, warehouseA.id, product.id);
      const bMovements = await movementSum(tx, warehouseB.id, product.id);

      return {
        aAfterTransfer,
        bAfterTransfer,
        aAfterVoid,
        bAfterVoid,
        aMovements,
        bMovements,
        storedStatus: stored.status,
      };
    });

    expect(outcome.aAfterTransfer.toFixed(4)).toBe("6.0000");
    expect(outcome.bAfterTransfer.toFixed(4)).toBe("4.0000");
    expect(outcome.aAfterVoid.toFixed(4)).toBe("10.0000");
    expect(outcome.bAfterVoid.toFixed(4)).toBe("0.0000");
    expect(outcome.aMovements.toFixed(4)).toBe("10.0000");
    expect(outcome.bMovements.toFixed(4)).toBe("0.0000");
    expect(outcome.storedStatus).toBe("void");
  });
});

describe("GD-P1-6 impor updateExisting memposting stok awal", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const sku = `TST-VI-IMP-${suffix}`;
  let productId = "";
  let jobId = "";
  let warehouseId = "";

  afterAll(async () => {
    await withCompany(ORG_ID, async (tx) => {
      if (jobId) {
        await tx.delete(importRows).where(eq(importRows.jobId, jobId));
        await tx.delete(importJobs).where(eq(importJobs.id, jobId));
      }
      if (productId) {
        // stock_movements is append-only at the database level (trigger
        // stock_movements_append_only, migration 0001), so the fixture's
        // opening movement stays as history (same approach as
        // inventory-p1.test.ts), and its stock_on_hand row MUST stay with
        // it: the consistency suite full-joins on-hand against the movement
        // ledger sum, so deleting the on-hand row (or zeroing it) while
        // the movements remain breaks that invariant.
        // SIM-2 S7 (REM-01): the product master row now stays too —
        // migration 0031's FK stock_movements.product_id makes deleting a
        // product with ledger history impossible, the same rule the app's
        // delete guard enforces. The fixture is deactivated instead; its
        // SKU already carries a per-run random suffix, so it can never
        // collide with a later run. (The previous cleanup deleted only
        // the master and knowingly orphaned the stock rows — that is
        // exactly the RT-07 orphan population the FK now prevents.)
        await tx
          .update(products)
          .set({ isActive: false })
          .where(eq(products.id, productId));
      }
    });
  });

  it("(e) produk yang diperbarui menerima gerakan opening + jurnal saldo awal, dan commit ulang tidak menggandakan", async () => {
    const mapping = {
      name: "Nama",
      sku: "SKU",
      costPrice: "Harga Pokok",
      salePrice: "Harga Jual",
      stock: "Stok Awal",
    };

    await withCompany(ORG_ID, async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      warehouseId = warehouse.id;

      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku,
          name: "Produk Impor Lama",
          costPrice: "4000",
          salePrice: "6000",
          trackStock: true,
        })
        .returning({ id: products.id });
      productId = product.id;

      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ORG_ID,
          entity: "products",
          fileName: "uji-void-import.csv",
          status: "preview",
          totalRows: 1,
          mapping,
          createdBy: USER_ID,
        })
        .returning({ id: importJobs.id });
      jobId = job.id;

      await tx.insert(importRows).values({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: 1,
        status: "pending",
        data: {
          Nama: "Produk Impor Baru",
          SKU: sku,
          "Harga Pokok": "5000",
          "Harga Jual": "8000",
          "Stok Awal": "7",
        },
      });
    });

    const result = await commitImportBatchAction({
      jobId,
      mapping,
      limit: 10,
      updateExisting: true,
      importStock: true,
      warehouseId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.imported).toBe(1);

    const after = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, productId));
      const [onHand] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouseId),
            eq(stockOnHand.productId, productId),
          ),
        );
      const openings = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.productId, productId),
            eq(stockMovements.movementType, "opening"),
          ),
        );
      const [row] = await tx
        .select()
        .from(importRows)
        .where(eq(importRows.jobId, jobId));
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "opening"),
            eq(journalEntries.sourceId, jobId),
          ),
        );
      let journalDebit = d(0);
      if (entry) {
        const lines = await tx
          .select({ debit: journalLines.debit })
          .from(journalLines)
          .where(eq(journalLines.entryId, entry.id));
        journalDebit = lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
      }
      return { product, onHand, openings, row, entry, journalDebit };
    });

    // Master data tetap diperbarui seperti sebelumnya…
    expect(after.product.name).toBe("Produk Impor Baru");
    expect(after.product.costPrice).toBe("5000.0000");
    // …dan sekarang stok awalnya benar-benar masuk (sebelum perbaikan: 0).
    expect(d(after.onHand?.qty ?? 0).toFixed(4)).toBe("7.0000");
    expect(after.openings).toHaveLength(1);
    expect(d(after.openings[0].qty).toFixed(4)).toBe("7.0000");
    expect(after.row.status).toBe("imported");
    expect(after.entry).toBeDefined();
    expect(after.journalDebit.toFixed(2)).toBe("35000.00");

    // Commit ulang job yang sama tidak boleh menggandakan stok: job sudah
    // selesai sehingga ditolak, dan stok tetap 7.
    const second = await commitImportBatchAction({
      jobId,
      mapping,
      limit: 10,
      updateExisting: true,
      importStock: true,
      warehouseId,
    });
    expect(second.ok).toBe(false);
    const [onHand] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouseId),
            eq(stockOnHand.productId, productId),
          ),
        ),
    );
    expect(d(onHand?.qty ?? 0).toFixed(4)).toBe("7.0000");
  });
});
