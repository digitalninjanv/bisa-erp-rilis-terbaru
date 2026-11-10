import { afterAll, describe, expect, it, vi } from "vitest";
import { and, asc, count, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  importJobs,
  importRows,
  journalEntries,
  partyOpeningBalances,
  paymentMethods,
  products,
  sales,
  stockOnHand,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  createSale,
  createSaleReturn,
  getReturnCredit,
  quoteCart,
  voidSale,
} from "@/server/pos";
import { ENTITY_FIELDS, suggestMappingFor } from "@/lib/import-parse";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Tindak lanjut review independen Tahap 4 (batch T4R-A):
//   T4R-1 (P1) — voidSale harus menolak penjualan yang sudah memiliki
//     retur posted: retur sudah memulihkan sebagian stok dan membalik
//     sebagian jurnal penjualan, jadi void penuh akan menggandakan
//     keduanya, dan kredit toko dari retur akan tetap bisa ditebus
//     untuk penjualan yang sudah tidak ada. Domain TIDAK punya jalur
//     void retur (retur posted bersifat final), jadi predikat
//     penghalangnya adalah keberadaan retur posted itu sendiri.
//   T4R-2 (P1) — commit impor saldo awal menangkap error per baris dan
//     melanjutkan dalam transaksi yang sama; urutan lama
//     createOpeningBalance (insert dokumen → postJournal) meninggalkan
//     dokumen yatim ber-journal_id NULL yang ikut ter-commit dan tampil
//     sebagai utang/piutang sah. Test ini memakai transaksi yang
//     benar-benar commit (rollback akan menyembunyikan bug-nya) dengan
//     pembersihan afterAll, pola opening-balances.test.ts.

// Sesi & cache Next diganti agar kode action impor asli berjalan
// terhadap database dev asli (pola opening-balances.test.ts).
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
}));

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function daysAgo(days: number): string {
  const date = new Date(`${todayISO()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
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

async function stockedProduct(tx: Tx, warehouseId: string, minQty: number) {
  const [row] = await tx
    .select({ productId: stockOnHand.productId, qty: stockOnHand.qty })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, String(minQty)),
        eq(products.trackBatch, false),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function methodByType(tx: Tx, type: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, type)))
    .limit(1);
  expect(method).toBeDefined();
  return method;
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
  return d(row?.qty ?? "0");
}

async function journalCount(tx: Tx) {
  const [row] = await tx
    .select({ total: count() })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, ORG_ID));
  return row.total;
}

async function makeCashSale(tx: Tx, warehouseId: string, productId: string, qty: number) {
  const lines = [{ productId, qty }];
  const quote = await quoteCart(tx, {
    companyId: ORG_ID,
    warehouseId,
    customerId: null,
    lines,
  });
  const sale = await createSale(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    customerId: null,
    date: todayISO(),
    lines,
    payments: [{ methodId: (await methodByType(tx, "cash")).id, amount: quote.total, tendered: quote.total }],
    idempotencyKey: crypto.randomUUID(),
  });
  return sale;
}

describe("T4R-1 — voidSale menolak penjualan yang sudah memiliki retur posted", () => {
  it("jual 10 → retur 2 store_credit → void DITOLAK; stok, jurnal, dan kredit retur tidak berubah", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 10);
      const stockBefore = await stockQty(tx, warehouse.id, product.productId);

      const sale = await makeCashSale(tx, warehouse.id, product.productId, 10);
      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji T4R-1 retur sebagian",
        refundMethod: "store_credit",
        type: "return",
        lines: [{ productId: product.productId, qty: 2 }],
      });

      // Keadaan sesudah retur: stok = awal − 8, kredit retur tersedia
      // penuh, penjualan tetap completed.
      const stockAfterReturn = await stockQty(tx, warehouse.id, product.productId);
      expect(stockAfterReturn.toFixed(4)).toBe(stockBefore.minus(8).toFixed(4));
      const creditBefore = await getReturnCredit(tx, ORG_ID, ret.number);
      expect(creditBefore).not.toBeNull();
      expect(creditBefore!.available).toBeGreaterThan(0);
      const journalsAfterReturn = await journalCount(tx);

      let error: unknown;
      try {
        await voidSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          saleId: sale.id,
          reason: "Uji T4R-1 void sesudah retur",
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect((error as { message: string }).message).toMatch(/retur/i);
      expect((error as { message: string }).message).toContain(ret.number);

      // Tidak ada perubahan apa pun: status, stok, jurnal, kredit.
      const [stored] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const stockAfterVoidAttempt = await stockQty(tx, warehouse.id, product.productId);
      const creditAfter = await getReturnCredit(tx, ORG_ID, ret.number);
      const journalsAfterVoidAttempt = await journalCount(tx);
      return {
        status: stored.status,
        stockAfterVoidAttempt,
        stockAfterReturn,
        creditAvailable: creditAfter!.available,
        creditBefore: creditBefore!.available,
        journalsAfterVoidAttempt,
        journalsAfterReturn,
      };
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.stockAfterVoidAttempt.toFixed(4)).toBe(outcome.stockAfterReturn.toFixed(4));
    expect(outcome.creditAvailable).toBe(outcome.creditBefore);
    expect(outcome.journalsAfterVoidAttempt).toBe(outcome.journalsAfterReturn);
  });

  it("kontrol: penjualan tanpa retur tetap bisa di-void dan stok pulih penuh", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, 10);
      const stockBefore = await stockQty(tx, warehouse.id, product.productId);

      const sale = await makeCashSale(tx, warehouse.id, product.productId, 3);
      expect((await stockQty(tx, warehouse.id, product.productId)).toFixed(4)).toBe(
        stockBefore.minus(3).toFixed(4),
      );

      await voidSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        reason: "Uji T4R-1 kontrol void normal",
      });

      const [stored] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const stockAfter = await stockQty(tx, warehouse.id, product.productId);
      return { status: stored.status, stockBefore, stockAfter };
    });

    expect(outcome.status).toBe("void");
    expect(outcome.stockAfter.toFixed(4)).toBe(outcome.stockBefore.toFixed(4));
  });
});

describe("T4R-2 — impor saldo awal tidak meninggalkan dokumen yatim", () => {
  const supplierName = `PT Saldo Yatim ${suffix}`;
  const supplierCode = `SUP-YTM-${suffix}`;
  // September 2026 berstatus closed di seed demo — pemicu realistis
  // kegagalan postJournal sesudah insert pada urutan lama.
  const CLOSED_PERIOD_DATE = "2026-09-15";
  let supplierId = "";
  let jobId = "";
  const createdOpeningIds: string[] = [];

  afterAll(async () => {
    await withCompany(ORG_ID, async (tx) => {
      if (createdOpeningIds.length) {
        await tx
          .update(partyOpeningBalances)
          .set({ journalId: null })
          .where(inArray(partyOpeningBalances.id, createdOpeningIds));
        for (const id of createdOpeningIds) {
          await tx.delete(partyOpeningBalances).where(eq(partyOpeningBalances.id, id));
        }
      }
      if (jobId) {
        await tx.delete(importRows).where(eq(importRows.jobId, jobId));
        await tx.delete(importJobs).where(eq(importJobs.id, jobId));
      }
      if (supplierId) {
        await tx.delete(suppliers).where(eq(suppliers.id, supplierId));
      }
    });
  });

  it("campuran baris valid + baris periode tertutup: yang gagal error di job, nol dokumen yatim ter-commit", async () => {
    supplierId = await withCompany(ORG_ID, async (tx) => {
      const [row] = await tx
        .insert(suppliers)
        .values({ companyId: ORG_ID, code: supplierCode, name: supplierName })
        .returning({ id: suppliers.id });
      return row.id;
    });

    const headers = ["Nama Pemasok", "Tanggal", "Jatuh Tempo", "Jumlah", "Referensi"];
    const mapping = suggestMappingFor(ENTITY_FIELDS.opening_payables, headers);
    const rows: Record<string, string>[] = [
      {
        "Nama Pemasok": supplierName,
        Tanggal: daysAgo(3),
        "Jatuh Tempo": daysAgo(1),
        Jumlah: "250000",
        Referensi: `FAKTUR-VALID-${suffix}`,
      },
      {
        "Nama Pemasok": supplierName,
        Tanggal: CLOSED_PERIOD_DATE,
        "Jatuh Tempo": "",
        Jumlah: "99000",
        Referensi: `FAKTUR-PERIODE-TUTUP-${suffix}`,
      },
    ];

    jobId = await withCompany(ORG_ID, async (tx) => {
      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ORG_ID,
          entity: "opening_payables",
          fileName: `uji-saldo-yatim-${suffix}.csv`,
          status: "preview",
          totalRows: rows.length,
          mapping,
          createdBy: USER_ID,
        })
        .returning({ id: importJobs.id });
      await tx.insert(importRows).values(
        rows.map((data, index) => ({
          companyId: ORG_ID,
          jobId: job.id,
          rowNumber: index + 1,
          data,
          status: "pending",
        })),
      );
      return job.id;
    });

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);

    let last: { done: boolean; imported: number; failed: number } = { done: false, imported: 0, failed: 0 };
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await commitImportBatchAction({ jobId, mapping, limit: 200 });
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      last = result.data;
      if (result.data.done || result.data.processed === 0) break;
    }
    expect(last.imported).toBe(1);
    expect(last.failed).toBe(1);

    const stored = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({
          rowNumber: importRows.rowNumber,
          status: importRows.status,
          error: importRows.error,
          entityId: importRows.entityId,
        })
        .from(importRows)
        .where(eq(importRows.jobId, jobId))
        .orderBy(asc(importRows.rowNumber)),
    );
    expect(stored[0].status).toBe("imported");
    expect(stored[1].status).toBe("error");
    expect(stored[1].error).toMatch(/ditutup/);
    if (stored[0].entityId) createdOpeningIds.push(stored[0].entityId);

    // Inti T4R-2: hanya dokumen baris valid yang ada — dokumen untuk
    // baris periode tertutup TIDAK ada sama sekali (bukan ada tapi
    // ber-journal_id NULL), dan jurnal pembuka hanya untuk yang valid.
    const docs = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select()
        .from(partyOpeningBalances)
        .where(and(eq(partyOpeningBalances.companyId, ORG_ID), eq(partyOpeningBalances.partyId, supplierId))),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].reference).toBe(`FAKTUR-VALID-${suffix}`);
    expect(docs[0].journalId).toBeTruthy();

    const openingJournals = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: journalEntries.id, sourceId: journalEntries.sourceId })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "opening_balance"),
            eq(journalEntries.sourceId, docs[0].id),
          ),
        ),
    );
    expect(openingJournals).toHaveLength(1);
  });
});
