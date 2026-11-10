import { describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  fiscalPeriods,
  journalEntries,
  journalLines,
  partyPayments,
  products,
  purchaseAdvanceAllocations,
  purchaseAdvances,
  stockBatches,
  stockMovements,
  stockOnHand,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { createReceipt, createTransfer } from "@/server/inventory";
import { postJournal } from "@/server/accounting";
import { nextDocumentNumber } from "@/server/sequences";
import { listPayables } from "@/server/reports";
import {
  applySupplierCredit,
  convertSupplierCreditToAdvance,
  createSupplierReturn,
  deleteSupplierReturn,
  getSupplierOpenPayable,
  getSupplierReturnDetail,
  listSupplierOpenPayableDocs,
  listSupplierReturnsPage,
  postSupplierReturn,
  receiveReplacement,
  refundSupplierReturn,
  resolveSupplierReturnOther,
  voidPostedSupplierReturn,
} from "@/server/supplier-returns";
import { listOpenPurchaseAdvancesForSupplier, listPurchaseAdvances, voidPurchaseAdvance } from "@/server/purchase-advances";
import { d, toDb } from "@/lib/money";
import { makeFlexibleRollbackTransaction } from "../helpers/rollback-transaction";

// A-9 (D-20): Retur Pembelian ke Pemasok.
//  (a) retur di bawah utang terbuka → Dr Utang/Cr Persediaan, listPayables turun.
//  (b) retur melebihi utang → kelebihan menjadi Dr Kredit Pemasok (1210).
//  (c) kredit diterapkan ke utang berikutnya → klaim habis, status resolved.
//  (d) refund sebagian → Dr Kas, klaim berkurang, status partially_resolved.
//  (e) pengganti 2 unit → stok masuk pada nilai klaim, klaim berkurang.
//  (f) penolakan: stok kurang, batch tak cukup, alasan kosong, periode tutup.
//  (g) regresi: angka listPayables pemasok tanpa retur tidak berubah.
//  (h) void retur posted tanpa penyelesaian → stok & jurnal berbalik penuh.
//  (i) penutupan "lainnya" dengan sisa klaim → wajib penegasan; klaim tetap di buku.
//  (j) draft terhapus bersih; dokumen posted tidak bisa dihapus.
// Perusahaan uji tersendiri (aa52), pola transaksi rollback.
const ORG = "01900000-0000-7000-8000-00000000aa52";
const DEMO_ORG = "01900000-0000-7000-8000-000000000001";
const USER_ID = "user-uji-retur";
const DATE = "2026-11-04";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeFlexibleRollbackTransaction(ORG);

async function ensureCompany(tx: Tx) {
  const [settings] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, ORG))
    .limit(1);
  if (settings) return;

  await tx.insert(companySettings).values({ companyId: ORG, legalName: "Uji Retur Pemasok" });
  const accountRows = await tx
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1400", name: "Uang Muka Pembelian", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
    ])
    .returning();
  const acc = new Map(accountRows.map((row) => [row.code, row.id]));
  await tx.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc.get("1000")! },
    { companyId: ORG, key: "bank", accountId: acc.get("1100")! },
    { companyId: ORG, key: "receivable", accountId: acc.get("1200")! },
    { companyId: ORG, key: "supplier_credit", accountId: acc.get("1210")! },
    { companyId: ORG, key: "inventory", accountId: acc.get("1300")! },
    { companyId: ORG, key: "purchase_advance", accountId: acc.get("1400")! },
    { companyId: ORG, key: "payable", accountId: acc.get("2000")! },
    { companyId: ORG, key: "equity", accountId: acc.get("3000")! },
    { companyId: ORG, key: "revenue", accountId: acc.get("4000")! },
  ]);
  await tx.insert(warehouses).values({
    companyId: ORG,
    code: "GD-RTB",
    name: "Gudang Uji Retur",
    type: "warehouse",
    isDefault: true,
  });
  await tx.insert(suppliers).values([
    { companyId: ORG, code: "SUP-RTB-A", name: "Pemasok Retur A" },
    { companyId: ORG, code: "SUP-RTB-B", name: "Pemasok Retur B" },
  ]);
  await tx.insert(products).values([
    { companyId: ORG, sku: "RTB-P1", name: "Produk Retur Satu", costPrice: "0", salePrice: "8000" },
    {
      companyId: ORG,
      sku: "RTB-P2",
      name: "Produk Retur Batch",
      costPrice: "0",
      salePrice: "9000",
      trackBatch: true,
    },
  ]);
}

async function ids(tx: Tx) {
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  const supplierRows = await tx
    .select({ id: suppliers.id, code: suppliers.code })
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG));
  const productRows = await tx
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(eq(products.companyId, ORG));
  const accountRows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(eq(accounts.companyId, ORG));
  return {
    warehouseId: warehouse.id,
    supplierA: supplierRows.find((row) => row.code === "SUP-RTB-A")!.id,
    supplierB: supplierRows.find((row) => row.code === "SUP-RTB-B")!.id,
    product1: productRows.find((row) => row.sku === "RTB-P1")!.id,
    product2: productRows.find((row) => row.sku === "RTB-P2")!.id,
    accountByCode: new Map(accountRows.map((row) => [row.code, row.id])),
  };
}

async function buyCredit(
  tx: Tx,
  input: {
    supplierId: string;
    warehouseId: string;
    lines: { productId: string; qty: string; unitCost: string; batchNumber?: string }[];
  },
) {
  return createReceipt(tx, {
    companyId: ORG,
    userId: USER_ID,
    warehouseId: input.warehouseId,
    supplierId: input.supplierId,
    source: "purchase",
    date: DATE,
    lines: input.lines,
  });
}

/** Mirror of payPayableAction's writes, at domain level for fixtures. */
async function payReceiptPart(tx: Tx, receiptId: string, amount: string) {
  const [receipt] = await tx
    .select()
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, ORG), eq(stockReceipts.id, receiptId)))
    .limit(1);
  const [cashMapping] = await tx
    .select({ accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, ORG), eq(accountMappings.key, "cash")))
    .limit(1);
  const [payableMapping] = await tx
    .select({ accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, ORG), eq(accountMappings.key, "payable")))
    .limit(1);
  const number = await nextDocumentNumber(tx, ORG, "PAYMENT", DATE);
  await tx.insert(partyPayments).values({
    companyId: ORG,
    type: "payable",
    partyType: "supplier",
    partyId: receipt.supplierId!,
    receiptId: receipt.id,
    number,
    date: DATE,
    amount,
    accountId: cashMapping.accountId,
    createdBy: USER_ID,
  });
  await postJournal(tx, {
    companyId: ORG,
    date: DATE,
    description: `Pembayaran utang ${receipt.number}`,
    sourceType: "payment",
    sourceId: receipt.id,
    createdBy: USER_ID,
    idempotencyKey: `ap:${receipt.id}:${number}`,
    lines: [
      {
        accountId: payableMapping.accountId,
        debit: amount,
        description: "Utang berkurang",
        partyType: "supplier",
        partyId: receipt.supplierId!,
      },
      { accountId: cashMapping.accountId, credit: amount, description: "Kas/bank keluar" },
    ],
  });
  const paid = d(receipt.paidAmount).plus(amount);
  await tx
    .update(stockReceipts)
    .set({
      paidAmount: toDb(paid),
      paymentStatus: paid.gte(d(receipt.total)) ? "paid" : "partial",
    })
    .where(and(eq(stockReceipts.companyId, ORG), eq(stockReceipts.id, receipt.id)));
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? "0");
}

/** Journal lines of one source document, keyed by account code. */
async function journalBySource(tx: Tx, sourceType: string, sourceId: string) {
  const entries = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .orderBy(asc(journalEntries.createdAt));
  const result: { entryId: string; number: string; byCode: Map<string, { debit: string; credit: string }> }[] = [];
  for (const entry of entries) {
    const lines = await tx
      .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(eq(journalLines.entryId, entry.id));
    const byCode = new Map<string, { debit: string; credit: string }>();
    for (const line of lines) {
      const current = byCode.get(line.code) ?? { debit: "0", credit: "0" };
      byCode.set(line.code, {
        debit: toDb(d(current.debit).plus(line.debit)),
        credit: toDb(d(current.credit).plus(line.credit)),
      });
    }
    result.push({ entryId: entry.id, number: entry.number, byCode });
  }
  return result;
}

/** Net (debit − credit) GL balance of one account code, optionally per party. */
async function accountBalance(tx: Tx, code: string, partyId?: string) {
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  const [row] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, ORG),
        eq(journalLines.accountId, account.id),
        eq(journalEntries.status, "posted"),
        partyId ? eq(journalLines.partyId, partyId) : sql`true`,
      ),
    );
  return d(row?.debit ?? "0").minus(row?.credit ?? "0");
}

async function makeReturn(
  tx: Tx,
  input: {
    supplierId: string;
    warehouseId: string;
    qty: string;
    productId: string;
    resolutionType?: string;
    batchId?: string;
    reasonDetail?: string;
  },
) {
  return createSupplierReturn(tx, {
    companyId: ORG,
    userId: USER_ID,
    supplierId: input.supplierId,
    warehouseId: input.warehouseId,
    date: DATE,
    reasonCategory: "damaged",
    reasonDetail: input.reasonDetail ?? "Barang pecah saat diterima di gudang",
    resolutionType: input.resolutionType ?? "next_purchase_credit",
    lines: [{ productId: input.productId, qty: input.qty, batchId: input.batchId }],
  });
}

describe("A-9/D-20 retur pembelian ke pemasok", () => {
  it("(a) retur di bawah utang terbuka memotong utang dan stok", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });

      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
      });
      expect(ret.number).toMatch(/^RTB-2026-\d{5}$/);
      const posted = await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect(d(posted.totalValue)).toEqual(d(20000));

      expect(await stockQty(tx, f.warehouseId, f.product1)).toEqual(d(6));

      const journals = await journalBySource(tx, "supplier_return", ret.id);
      expect(journals).toHaveLength(1);
      expect(journals[0].byCode.get("2000")?.debit).toBe(toDb(20000));
      expect(journals[0].byCode.get("1300")?.credit).toBe(toDb(20000));
      expect(journals[0].byCode.has("1210")).toBe(false);

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(d(detail?.payableAmount)).toEqual(d(20000));
      expect(d(detail?.creditAmount)).toEqual(d(0));
      expect(detail?.status).toBe("resolved");

      const payables = await listPayables(tx, ORG);
      const row = payables.find((r) => r.id === receipt.id);
      expect(row?.outstanding).toBe(30000);
      expect(d(await getSupplierOpenPayable(tx, ORG, f.supplierA))).toEqual(d(30000));
    });
  });

  it("(b) retur melebihi utang: kelebihan menjadi Kredit Pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, receipt.id, "30000");

      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "6",
      });
      const posted = await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect(d(posted.totalValue)).toEqual(d(30000));
      expect(d(posted.payableAmount)).toEqual(d(20000));
      expect(d(posted.creditAmount)).toEqual(d(10000));

      const journals = await journalBySource(tx, "supplier_return", ret.id);
      expect(journals[0].byCode.get("2000")?.debit).toBe(toDb(20000));
      expect(journals[0].byCode.get("1210")?.debit).toBe(toDb(10000));
      expect(journals[0].byCode.get("1300")?.credit).toBe(toDb(30000));

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("posted");
      // Utang pemasok lunas oleh retur: penerimaan hilang dari daftar utang.
      const payables = await listPayables(tx, ORG);
      expect(payables.find((r) => r.id === receipt.id)).toBeUndefined();
      expect(d(await getSupplierOpenPayable(tx, ORG, f.supplierA))).toEqual(d(0));
      expect(await accountBalance(tx, "1210", f.supplierA)).toEqual(d(10000));
    });
  });

  it("(c) kredit diterapkan ke pembelian berikutnya sampai klaim habis", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const first = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, first.id, "50000");
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "2",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });

      const second = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      expect(d(await getSupplierOpenPayable(tx, ORG, f.supplierA))).toEqual(d(50000));

      await expect(
        applySupplierCredit(tx, {
          companyId: ORG,
          userId: USER_ID,
          returnId: ret.id,
          amount: "15000",
          date: DATE,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const applied = await applySupplierCredit(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        amount: "10000",
        date: DATE,
      });
      expect(d(applied.remainingClaim)).toEqual(d(0));

      const journals = await journalBySource(tx, "supplier_return_credit_apply", ret.id);
      expect(journals).toHaveLength(1);
      expect(journals[0].byCode.get("2000")?.debit).toBe(toDb(10000));
      expect(journals[0].byCode.get("1210")?.credit).toBe(toDb(10000));

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("resolved");
      expect(d(detail?.resolvedAmount)).toEqual(d(10000));
      expect(await accountBalance(tx, "1210", f.supplierA)).toEqual(d(0));

      const payables = await listPayables(tx, ORG);
      expect(payables.find((r) => r.id === second.id)?.outstanding).toBe(40000);
    });
  });

  it("(k) retur purchase_advance membuat uang muka dan dipakai pada penerimaan berikutnya", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const first = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, first.id, "30000");

      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "6",
        resolutionType: "purchase_advance",
      });
      const posted = await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect(d(posted.payableAmount)).toEqual(d(20000));
      expect(d(posted.creditAmount)).toEqual(d(10000));

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("resolved");
      expect(d(detail?.resolvedAmount)).toEqual(d(10000));
      expect(await accountBalance(tx, "1210", f.supplierA)).toEqual(d(0));
      expect(await accountBalance(tx, "1400", f.supplierA)).toEqual(d(10000));

      const [advance] = await tx
        .select()
        .from(purchaseAdvances)
        .where(
          and(
            eq(purchaseAdvances.companyId, ORG),
            eq(purchaseAdvances.originReturnId, ret.id),
          ),
        );
      expect(advance).toBeDefined();
      expect(advance.originType).toBe("return");
      expect(advance.paymentAccountId).toBeNull();
      expect(d(advance.amount)).toEqual(d(10000));
      expect(d(advance.remainingAmount)).toEqual(d(10000));
      expect(advance.status).toBe("open");

      const conversion = await journalBySource(tx, "purchase_advance", advance.id);
      expect(conversion).toHaveLength(1);
      expect(conversion[0].byCode.get("1400")?.debit).toBe(toDb(10000));
      expect(conversion[0].byCode.get("1210")?.credit).toBe(toDb(10000));

      const listed = await listPurchaseAdvances(tx, ORG, {
        from: DATE,
        to: DATE,
        page: 1,
        pageSize: 50,
        offset: 0,
      });
      const listedRow = listed.rows.find((row) => row.id === advance.id);
      expect(listedRow?.originType).toBe("return");
      expect(listedRow?.originReturnNumber).toBe(ret.number);

      const open = await listOpenPurchaseAdvancesForSupplier(tx, ORG, f.supplierA);
      expect(open.map((row) => row.id)).toContain(advance.id);

      await expect(
        voidPurchaseAdvance(tx, {
          companyId: ORG,
          userId: USER_ID,
          advanceId: advance.id,
          date: DATE,
          reason: "Uji batal uang muka asal retur",
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      const second = await createReceipt(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId: f.warehouseId,
        supplierId: f.supplierA,
        source: "purchase",
        date: DATE,
        advanceAmount: "10000",
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });

      const [used] = await tx
        .select()
        .from(purchaseAdvances)
        .where(eq(purchaseAdvances.id, advance.id));
      expect(d(used.remainingAmount)).toEqual(d(0));
      expect(used.status).toBe("used");

      const allocations = await tx
        .select()
        .from(purchaseAdvanceAllocations)
        .where(eq(purchaseAdvanceAllocations.receiptId, second.id));
      expect(allocations).toHaveLength(1);
      expect(d(allocations[0].amount)).toEqual(d(10000));

      const receiptJournal = await journalBySource(tx, "purchase", second.id);
      expect(receiptJournal[0].byCode.get("1400")?.credit).toBe(toDb(10000));
      expect(receiptJournal[0].byCode.get("2000")?.credit).toBe(toDb(40000));

      const payables = await listPayables(tx, ORG);
      expect(payables.find((row) => row.id === second.id)?.outstanding).toBe(40000);
    });
  });

  it("(l) next_purchase_credit tidak otomatis membuat uang muka", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const first = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, first.id, "50000");

      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "2",
        resolutionType: "next_purchase_credit",
      });
      const posted = await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect(d(posted.creditAmount)).toEqual(d(10000));

      const advances = await tx
        .select({ id: purchaseAdvances.id })
        .from(purchaseAdvances)
        .where(
          and(
            eq(purchaseAdvances.companyId, ORG),
            eq(purchaseAdvances.originReturnId, ret.id),
          ),
        );
      expect(advances).toHaveLength(0);

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("posted");
      expect(d(detail?.resolvedAmount)).toEqual(d(0));
      expect(await accountBalance(tx, "1210", f.supplierA)).toEqual(d(10000));
      expect(await accountBalance(tx, "1400", f.supplierA)).toEqual(d(0));
    });
  });

  it("(m) konversi manual memindahkan seluruh sisa klaim dan menolak konversi kedua", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const first = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, first.id, "50000");

      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "2",
        resolutionType: "next_purchase_credit",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });

      const converted = await convertSupplierCreditToAdvance(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        date: DATE,
      });
      expect(d(converted.remainingClaim)).toEqual(d(0));
      expect(d(await accountBalance(tx, "1400", f.supplierA))).toEqual(d(10000));
      expect(d(await accountBalance(tx, "1210", f.supplierA))).toEqual(d(0));

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("resolved");
      expect(d(detail?.resolvedAmount)).toEqual(d(10000));

      await expect(
        convertSupplierCreditToAdvance(tx, {
          companyId: ORG,
          userId: USER_ID,
          returnId: ret.id,
          date: DATE,
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });

  it("(d) refund sebagian mengembalikan kas dan mengurangi klaim", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, receipt.id, "50000");
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
        resolutionType: "refund",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });

      const refunded = await refundSupplierReturn(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        accountId: f.accountByCode.get("1000")!,
        amount: "8000",
        date: DATE,
      });
      expect(d(refunded.remainingClaim)).toEqual(d(12000));

      const journals = await journalBySource(tx, "supplier_return_refund", ret.id);
      expect(journals[0].byCode.get("1000")?.debit).toBe(toDb(8000));
      expect(journals[0].byCode.get("1210")?.credit).toBe(toDb(8000));

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("partially_resolved");
      expect(d(detail?.resolvedAmount)).toEqual(d(8000));
    });
  });

  it("(e) barang pengganti masuk pada nilai klaim per unit baris asal", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, receipt.id, "50000");
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
        resolutionType: "replacement",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect(await stockQty(tx, f.warehouseId, f.product1)).toEqual(d(6));

      const detailBefore = await getSupplierReturnDetail(tx, ORG, ret.id);
      const lineId = detailBefore!.lines[0].id;
      const replaced = await receiveReplacement(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        date: DATE,
        lines: [{ returnLineId: lineId, qty: "2" }],
      });
      expect(d(replaced.consumedAmount)).toEqual(d(10000));
      expect(d(replaced.remainingClaim)).toEqual(d(10000));
      expect(await stockQty(tx, f.warehouseId, f.product1)).toEqual(d(8));

      const movements = await tx
        .select({ qty: stockMovements.qty, unitCost: stockMovements.unitCost })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG),
            eq(stockMovements.referenceType, "supplier_return_replacement"),
            eq(stockMovements.referenceId, ret.id),
          ),
        );
      expect(movements).toHaveLength(1);
      expect(d(movements[0].qty)).toEqual(d(2));
      expect(d(movements[0].unitCost)).toEqual(d(5000));

      const journals = await journalBySource(tx, "supplier_return_replacement", ret.id);
      expect(journals[0].byCode.get("1300")?.debit).toBe(toDb(10000));
      expect(journals[0].byCode.get("1210")?.credit).toBe(toDb(10000));

      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(d(detail?.lines[0].replacedQty)).toEqual(d(2));
      // Pengganti melebihi qty baris asal ditolak.
      await expect(
        receiveReplacement(tx, {
          companyId: ORG,
          userId: USER_ID,
          returnId: ret.id,
          date: DATE,
          lines: [{ returnLineId: lineId, qty: "3" }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  it("(f) penolakan: stok kurang, batch tak cukup, alasan kosong, periode tertutup", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "5", unitCost: "5000" }],
      });

      // Alasan detail kosong → VALIDATION saat membuat retur.
      await expect(
        makeReturn(tx, {
          supplierId: f.supplierA,
          warehouseId: f.warehouseId,
          productId: f.product1,
          qty: "1",
          reasonDetail: "   ",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      // Stok tidak cukup → posting ditolak. Penyesuaian FIX-GDG
      // Tahap 1 (GDG1-01): draf retur kini dibatasi plafon asal-usul
      // (qty retur ≤ qty yang pernah diterima dari pemasok ini), jadi
      // skenario "stok fisik kurang saat posting" dibangun dengan
      // memindahkan 3 unit keluar dari gudang asal lewat transfer
      // (transfer tidak menjurnal, jadi fixture tanpa pemetaan beban
      // susut ini tetap sah) — maksud test tetap sama: pembuatan draf
      // lolos, posting tertahan INSUFFICIENT_STOCK.
      const [otherWarehouse] = await tx
        .insert(warehouses)
        .values({
          companyId: ORG,
          code: "GD-RTB-2",
          name: "Gudang Uji Retur Kedua",
          type: "warehouse",
        })
        .returning({ id: warehouses.id });
      await createTransfer(tx, {
        companyId: ORG,
        userId: USER_ID,
        fromWarehouseId: f.warehouseId,
        toWarehouseId: otherWarehouse.id,
        date: DATE,
        lines: [{ productId: f.product1, qty: "3" }],
      });
      const tooMany = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "5",
      });
      await expect(
        postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: tooMany.id }),
      ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

      // Batch: B-1 berisi 10, B-2 berisi 5; retur 7 dari B-2 ditolak.
      await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [
          { productId: f.product2, qty: "10", unitCost: "4000", batchNumber: "B-1" },
          { productId: f.product2, qty: "5", unitCost: "4000", batchNumber: "B-2" },
        ],
      });
      const [batch2] = await tx
        .select({ id: stockBatches.id })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.companyId, ORG),
            eq(stockBatches.productId, f.product2),
            eq(stockBatches.batchNumber, "B-2"),
          ),
        )
        .limit(1);
      const batchReturn = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product2,
        qty: "7",
        batchId: batch2.id,
      });
      await expect(
        postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: batchReturn.id }),
      ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

      // Periode tertutup → posting ditolak. FIX-P1 Tahap 3 (AK1-01):
      // baris periode 2026-11 kini mungkin sudah ada (termaterialisasi
      // lazy oleh posting sebelumnya di transaksi yang sama), jadi
      // statusnya ditimpa menjadi closed, bukan disisipkan buta.
      await tx
        .insert(fiscalPeriods)
        .values({
          companyId: ORG,
          year: 2026,
          month: 11,
          status: "closed",
        })
        .onConflictDoUpdate({
          target: [fiscalPeriods.companyId, fiscalPeriods.year, fiscalPeriods.month],
          set: { status: "closed" },
        });
      const valid = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "1",
      });
      await expect(
        postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: valid.id }),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    });
  });

  it("(g) regresi: utang pemasok tanpa retur tidak berubah oleh retur pemasok lain", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receiptB = await buyCredit(tx, {
        supplierId: f.supplierB,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "3", unitCost: "10000" }],
      });
      await payReceiptPart(tx, receiptB.id, "10000");
      const before = await listPayables(tx, ORG);
      expect(before.find((r) => r.id === receiptB.id)?.outstanding).toBe(20000);

      const receiptA = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      void receiptA;

      const after = await listPayables(tx, ORG);
      const rowB = after.find((r) => r.id === receiptB.id);
      expect(rowB?.outstanding).toBe(20000);
      expect(d(rowB?.paidAmount)).toEqual(d(10000));
      expect(d(await getSupplierOpenPayable(tx, ORG, f.supplierB))).toEqual(d(20000));
    });
  });

  it("(h) void retur posted tanpa penyelesaian membalik stok, jurnal, dan alokasi", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, receipt.id, "50000");
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect(await stockQty(tx, f.warehouseId, f.product1)).toEqual(d(6));

      // Sudah ada penyelesaian → void ditolak.
      await refundSupplierReturn(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        accountId: f.accountByCode.get("1000")!,
        amount: "5000",
        date: DATE,
      });
      await expect(
        voidPostedSupplierReturn(tx, {
          companyId: ORG,
          userId: USER_ID,
          returnId: ret.id,
          reason: "Salah input",
          date: DATE,
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    });

    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });
      expect((await listPayables(tx, ORG)).find((r) => r.id === receipt.id)?.outstanding).toBe(30000);

      await voidPostedSupplierReturn(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        reason: "Retur dibatalkan, barang tidak jadi dikirim",
        date: DATE,
      });
      expect(await stockQty(tx, f.warehouseId, f.product1)).toEqual(d(10));
      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.status).toBe("void");
      expect((await listPayables(tx, ORG)).find((r) => r.id === receipt.id)?.outstanding).toBe(50000);
      expect(await accountBalance(tx, "2000", f.supplierA)).toEqual(d(-50000));
      const reversals = await journalBySource(tx, "supplier_return_reversal", ret.id);
      expect(reversals).toHaveLength(1);
    });
  });

  it("(i) penutupan lainnya: sisa klaim wajib ditegaskan dan tetap tercatat di buku", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      await payReceiptPart(tx, receipt.id, "50000");
      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "2",
        resolutionType: "other",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });

      await expect(
        resolveSupplierReturnOther(tx, {
          companyId: ORG,
          userId: USER_ID,
          returnId: ret.id,
          date: DATE,
          note: "Pemasok mengganti dengan diskon di luar sistem",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const closed = await resolveSupplierReturnOther(tx, {
        companyId: ORG,
        userId: USER_ID,
        returnId: ret.id,
        date: DATE,
        note: "Pemasok mengganti dengan diskon di luar sistem",
        writeOffRemainder: true,
      });
      expect(closed.status).toBe("resolved");
      const detail = await getSupplierReturnDetail(tx, ORG, ret.id);
      expect(detail?.closedWithRemainder).toBe(true);
      // Klaim TIDAK dihapus diam-diam: saldo Kredit Pemasok tetap 10.000.
      expect(await accountBalance(tx, "1210", f.supplierA)).toEqual(d(10000));
    });
  });

  it("(j) draft dapat dihapus; dokumen posted tidak", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      const draft = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "1",
      });
      await deleteSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: draft.id });
      expect(await getSupplierReturnDetail(tx, ORG, draft.id)).toBeNull();

      const posted = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "1",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: posted.id });
      await expect(
        deleteSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: posted.id }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });

  it("migrasi 0024: perusahaan lama (demo) memiliki akun Kredit Pemasok & pemetaan supplier_credit", async () => {
    await rollbackTransaction(async (tx) => {
      const [row] = await tx
        .select({ code: accounts.code, name: accounts.name })
        .from(accountMappings)
        .innerJoin(accounts, eq(accountMappings.accountId, accounts.id))
        .where(
          and(
            eq(accountMappings.companyId, DEMO_ORG),
            eq(accountMappings.key, "supplier_credit"),
          ),
        )
        .limit(1);
      expect(row?.code).toBe("1113");
      expect(row?.name).toBe("Piutang ke Supplier");
    }, DEMO_ORG);
  });
});

describe("A-9/RET-2 query baca untuk UI retur pembelian", () => {
  it("listSupplierReturnsPage: pagination, saringan status, nama pemasok & gudang", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });
      const draft = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "1",
      });
      const posted = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "2",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: posted.id });

      const all = await listSupplierReturnsPage(tx, ORG, { page: 1, pageSize: 40 });
      expect(all.total).toBe(2);
      expect(all.rows.map((row) => row.id).sort()).toEqual([draft.id, posted.id].sort());
      const postedRow = all.rows.find((row) => row.id === posted.id)!;
      expect(postedRow.supplierName).toBe("Pemasok Retur A");
      expect(postedRow.warehouseName).toBe("Gudang Uji Retur");
      expect(d(postedRow.totalValue)).toEqual(d(10000));

      const draftsOnly = await listSupplierReturnsPage(tx, ORG, { status: "draft" });
      expect(draftsOnly.total).toBe(1);
      expect(draftsOnly.rows[0].id).toBe(draft.id);

      const pageTwo = await listSupplierReturnsPage(tx, ORG, { page: 2, pageSize: 1 });
      expect(pageTwo.total).toBe(2);
      expect(pageTwo.rows).toHaveLength(1);
    });
  });

  it("listSupplierOpenPayableDocs: nomor dokumen tampil dan alokasi retur mengurangi sisa", async () => {
    await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const f = await ids(tx);
      const receipt = await buyCredit(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        lines: [{ productId: f.product1, qty: "10", unitCost: "5000" }],
      });

      const before = await listSupplierOpenPayableDocs(tx, ORG, f.supplierA);
      expect(before).toHaveLength(1);
      expect(before[0].kind).toBe("receipt");
      expect(before[0].id).toBe(receipt.id);
      expect(before[0].number).toBe(receipt.number);
      expect(d(before[0].outstanding)).toEqual(d(50000));

      const ret = await makeReturn(tx, {
        supplierId: f.supplierA,
        warehouseId: f.warehouseId,
        productId: f.product1,
        qty: "4",
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER_ID, returnId: ret.id });

      const after = await listSupplierOpenPayableDocs(tx, ORG, f.supplierA);
      expect(after).toHaveLength(1);
      expect(d(after[0].allocated)).toEqual(d(20000));
      expect(d(after[0].outstanding)).toEqual(d(30000));

      // Pemasok tanpa utang terbuka: daftar kosong.
      expect(await listSupplierOpenPayableDocs(tx, ORG, f.supplierB)).toEqual([]);
    });
  });
});
