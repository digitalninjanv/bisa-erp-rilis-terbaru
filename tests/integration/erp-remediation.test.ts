import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { accountMonthlyBalances, companySettings, importJobs, importRows, journalEntries, journalLines, paymentMethods, productPackagings, products, saleReturns, stockMovements, stockOnHand, suppliers, warehouses } from "@/db/schema";
import { createAdjustment, createReceipt, createTransfer, receiveTransfer, voidStockDocument } from "@/server/inventory";
import { createSale, createSaleReturn, openCashSession } from "@/server/pos";
import { getAccountMap, postJournal } from "@/server/accounting";
import { applyBulkEditProducts } from "@/server/master-data";
import { getInventoryValuation } from "@/server/reports";
import { processOfflineSaleItem } from "@/server/pos-offline";
import { quoteCart } from "@/server/pos";
import { prepareProductBatch, processProductBatch } from "@/server/actions/import/commit-phases";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const companyId = "01900000-0000-7000-8000-000000000001";
const userId = "01900000-0000-7000-8000-000000000010";
const date = todayISO();
const rollback = makeRollbackTransaction(companyId);

async function fixture(tx: Tx) {
  await tx.update(companySettings).set({ taxEnabled: false, roundingMode: "none", transferTwoStepEnabled: true, adjustmentApprovalThreshold: null }).where(eq(companySettings.companyId, companyId));
  const [warehouse] = await tx.select().from(warehouses).where(and(eq(warehouses.companyId, companyId), eq(warehouses.isDefault, true))).limit(1);
  const [destination] = await tx.insert(warehouses).values({ companyId, code: crypto.randomUUID(), name: "Remediation destination" }).returning();
  const [supplier] = await tx.insert(suppliers).values({ companyId, code: crypto.randomUUID(), name: "Remediation supplier" }).returning();
  const [product] = await tx.insert(products).values({ companyId, sku: crypto.randomUUID(), name: "Remediation product", costPrice: "0", salePrice: "20000", trackStock: true }).returning();
  await createReceipt(tx, { companyId, userId, date, warehouseId: warehouse.id, source: "opening", lines: [{ productId: product.id, qty: 100, unitCost: 10000 }] });
  return { warehouseId: warehouse.id, destinationId: destination.id, supplierId: supplier.id, productId: product.id, sku: product.sku };
}
async function cost(tx: Tx, productId: string) {
  const [row] = await tx.select({ cost: products.costPrice }).from(products).where(eq(products.id, productId));
  return d(row.cost);
}
async function ledger(tx: Tx, productId: string) {
  const [row] = await tx.select({ value: sql<string>`sum(${stockMovements.qty} * ${stockMovements.unitCost})`, qty: sql<string>`sum(${stockMovements.qty})` }).from(stockMovements).where(eq(stockMovements.productId, productId));
  return { value: d(row.value), qty: d(row.qty) };
}
async function sale(tx: Tx, f: Awaited<ReturnType<typeof fixture>>, qty = 10) {
  await openCashSession(tx, { companyId, userId: "remediation-cashier", openingCash: 0 });
  const [method] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.type, "cash"))).limit(1);
  return createSale(tx, { companyId, userId: "remediation-cashier", date, warehouseId: f.warehouseId, idempotencyKey: crypto.randomUUID(), lines: [{ productId: f.productId, qty }], payments: [{ methodId: method.id, amount: qty * 20000, tendered: qty * 20000 }] });
}

describe("ERP remediation F01–F13", () => {
  it("F01 bulk edit cannot overwrite a managed AVCO", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const result = await applyBulkEditProducts(tx, { companyId, userId, warehouseId: f.warehouseId, selection: { mode: "ids", ids: [f.productId] }, operation: { kind: "price", target: "costPrice", mode: "nominal", value: "10000" } });
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect((await cost(tx, f.productId)).toString()).toBe("10000");
  }));
  it("F02 import updates metadata without overwriting managed AVCO", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const mapping = { sku: "SKU", name: "Name", costPrice: "Cost", salePrice: "Price" };
    const [job] = await tx.insert(importJobs).values({ companyId, entity: "products", fileName: "synthetic.xlsx", mapping, totalRows: 1 }).returning();
    const rows = await tx.insert(importRows).values({ companyId, jobId: job.id, rowNumber: 1, status: "pending", data: { SKU: f.sku, Name: "Updated", Cost: "20000", Price: "25000" } }).returning();
    const batch = await prepareProductBatch(tx, { companyId, rows, mapping });
    const result = await processProductBatch(tx, { companyId, userId, warehouseId: f.warehouseId, job, batch, data: { jobId: job.id, mapping, limit: 10, updateExisting: true, importStock: false } });
    expect(result.imported).toBe(1);
    expect((await cost(tx, f.productId)).toString()).toBe("10000");
  }));
  it("F03 inactive stock remains in financial valuation", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const before = await getInventoryValuation(tx, companyId);
    await tx.update(products).set({ isActive: false }).where(eq(products.id, f.productId));
    const after = await getInventoryValuation(tx, companyId);
    expect(after.totalValue).toBe(before.totalValue);
    expect(after.items.find((row) => row.productId === f.productId)?.qty).toBe("100.0000");
  }));
  it("F04 cost pool and valuation retain transit before and after receipt", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const transfer = await createTransfer(tx, { companyId, userId, date, fromWarehouseId: f.warehouseId, toWarehouseId: f.destinationId, lines: [{ productId: f.productId, qty: 40 }] });
    await createReceipt(tx, { companyId, userId, date, warehouseId: f.warehouseId, supplierId: f.supplierId, lines: [{ productId: f.productId, qty: 40, unitCost: 20000 }] });
    expect((await cost(tx, f.productId)).toNumber()).toBeCloseTo(1800000 / 140, 4);
    const before = (await getInventoryValuation(tx, companyId)).items.find((r) => r.productId === f.productId)!;
    expect(before.qty).toBe("140.0000");
    expect(Number(before.value)).toBeCloseTo(1800000, 1);
    await receiveTransfer(tx, { companyId, userId, date, documentId: transfer.id });
    expect((await ledger(tx, f.productId)).value.toNumber()).toBe(1800000);
    expect((await cost(tx, f.productId)).toNumber() * 140).toBeCloseTo(1800000, 1);
  }));
  it("F04 void in-transit transfer does not leave phantom owned quantity", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const transfer = await createTransfer(tx, { companyId, userId, date, fromWarehouseId: f.warehouseId, toWarehouseId: f.destinationId, lines: [{ productId: f.productId, qty: 40 }] });
    await voidStockDocument(tx, { companyId, userId, date, documentId: transfer.id, reason: "Test cancellation" });
    const item = (await getInventoryValuation(tx, companyId)).items.find((r) => r.productId === f.productId)!;
    expect(item.qty).toBe("100.0000");
    expect(item.value).toBe("1000000.0000");
  }));
  it("F05 adjustment override maintains value after approval and void", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const doc = await createAdjustment(tx, { companyId, userId, date, warehouseId: f.warehouseId, type: "adjustment", reason: "Synthetic value correction", allowCostOverride: true, costOverrideReason: "Verified original cost", lines: [{ productId: f.productId, qty: 3, unitCost: 20000 }] });
    const state = await ledger(tx, f.productId);
    expect(state.value.toNumber()).toBe(1060000);
    expect((await cost(tx, f.productId)).mul(state.qty).toNumber()).toBeCloseTo(1060000, 1);
    await voidStockDocument(tx, { companyId, userId, date, documentId: doc.id, reason: "Reverse test" });
    expect((await cost(tx, f.productId)).toNumber()).toBe(10000);
  }));
  it("F06/F07 persisted detail, monthly totals and exact balance agree", () => rollback(async (tx) => {
    const [a,b] = await tx.insert((await import("@/db/schema")).accounts).values([
      { companyId, code: crypto.randomUUID(), name: "Tiny debit", type: "asset", normalBalance: "debit" },
      { companyId, code: crypto.randomUUID(), name: "Tiny credit", type: "liability", normalBalance: "credit" },
    ]).returning();
    const journal = await postJournal(tx, { companyId, date, description: "Tiny balanced", sourceType: "manual", lines: [{ accountId: a.id, debit: "0.00006" }, { accountId: a.id, debit: "0.00006" }, { accountId: b.id, credit: "0.00012" }] });
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, journal.id));
    const debit = lines.reduce((sum,l) => sum.plus(l.debit), d(0));
    const credit = lines.reduce((sum,l) => sum.plus(l.credit), d(0));
    expect(debit.eq(credit)).toBe(true);
    const [monthly] = await tx.select().from(accountMonthlyBalances).where(eq(accountMonthlyBalances.accountId, a.id));
    expect(d(monthly.totalDebit).eq(debit)).toBe(true);
  }));
  it.each(["sellable", "write_off"] as const)("F08/F09 replay of %s return creates one document and correct stock", disposition => rollback(async (tx) => {
    const f = await fixture(tx);
    const sold = await sale(tx, f);
    const input = { companyId, userId: "remediation-cashier", date, saleId: sold.id, reason: "Synthetic return", refundMethod: "cash" as const, type: "return" as const, disposition, idempotencyKey: crypto.randomUUID(), lines: [{ productId: f.productId, qty: 2 }] };
    const first = await createSaleReturn(tx, input);
    const second = await createSaleReturn(tx, input);
    expect(second.id).toBe(first.id);
    expect(await tx.select().from(saleReturns).where(eq(saleReturns.saleId, sold.id))).toHaveLength(1);
    const [onHand] = await tx.select().from(stockOnHand).where(and(eq(stockOnHand.productId, f.productId), eq(stockOnHand.warehouseId, f.warehouseId)));
    expect(Number(onHand.qty)).toBe(disposition === "sellable" ? 92 : 90);
    const map = await getAccountMap(tx, companyId);
    const [journal] = await tx.select().from(journalEntries).where(eq(journalEntries.sourceId, first.id));
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, journal.id));
    expect(lines.some(l => l.accountId === (disposition === "sellable" ? map.inventory : map.damaged ?? map.inventory_shrink) && Number(l.debit) === 20000)).toBe(true);
  }));
  it("F11 forged cashier identity cannot borrow supervisor permissions", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const result = await processOfflineSaleItem(tx, { companyId, userId: "cashier-without-approval", originEntitlements: { [userId]: { canSell: true, canDiscount: true } }, item: { clientKey: crypto.randomUUID(), date, cashierId: userId, warehouseId: f.warehouseId, lines: [{ productId: f.productId, qty: 1 }], payments: [], queuedAt: new Date().toISOString() } });
    expect(result.kind).toBe("origin_ineligible");
    expect(result.status).toBe("failed");
  }));
  it("F12 untrusted factor is rejected but supervised historic factor is explicit", () => rollback(async (tx) => {
    const f = await fixture(tx);
    const [pack] = await tx.insert(productPackagings).values({ companyId, productId: f.productId, name: "Dus", isi: "40", salePrice: "100000" }).returning();
    const input = { companyId, warehouseId: f.warehouseId, lines: [{ productId: f.productId, packagingId: pack.id, qty: 1, isiSnapshot: 1, unitPrice: 100000 }] };
    await expect(quoteCart(tx, input)).rejects.toThrow(/Faktor kemasan/);
    const historic = await quoteCart(tx, { ...input, frozenPrices: true });
    expect(historic.lines[0].qty).toBe(1);
  }));
});
