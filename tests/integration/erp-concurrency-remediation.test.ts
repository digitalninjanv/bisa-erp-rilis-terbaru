import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { accounts, companySettings, journalLines, paymentMethods, products, saleReturns, sales, stockMovements, suppliers, warehouses } from "@/db/schema";
import { postJournal, seedChartOfAccounts } from "@/server/accounting";
import { createReceipt } from "@/server/inventory";
import { createSale, createSaleReturn, holdSale, openCashSession } from "@/server/pos";
import { checkoutAction } from "@/server/actions/pos";
import { permissionsFor } from "@/lib/permissions";
import { todayISO } from "@/lib/format";
import { d } from "@/lib/money";

const state = vi.hoisted(() => ({ companyId: "", userId: "erp-remediation-concurrent" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const context = async () => ({ company: { id: state.companyId }, user: { id: state.userId }, role: "owner", permissions: permissionsFor("owner") });
  return { requirePermission: context, requirePermissionInModule: context, requireAuth: context };
});
const date = todayISO();
let warehouseId = "", supplierId = "", methodId = "";

beforeAll(async () => {
  state.companyId = crypto.randomUUID();
  await withCompany(state.companyId, async tx => {
    const map = await seedChartOfAccounts(tx, state.companyId);
    await tx.insert(companySettings).values({ companyId: state.companyId, legalName: "Synthetic remediation", taxEnabled: false, roundingMode: "none" });
    const [warehouse] = await tx.insert(warehouses).values({ companyId: state.companyId, code: "MAIN", name: "Synthetic warehouse", isDefault: true }).returning();
    const [supplier] = await tx.insert(suppliers).values({ companyId: state.companyId, code: "SUP", name: "Synthetic supplier" }).returning();
    const [method] = await tx.insert(paymentMethods).values({ companyId: state.companyId, code: "CASH", name: "Cash", type: "cash", accountId: map.cash }).returning();
    warehouseId = warehouse.id; supplierId = supplier.id; methodId = method.id;
    await openCashSession(tx, { companyId: state.companyId, userId: state.userId, openingCash: 0 });
  });
});
async function product() {
  return withCompany(state.companyId, async tx => {
    const [row] = await tx.insert(products).values({ companyId: state.companyId, sku: crypto.randomUUID(), name: "Synthetic concurrent", costPrice: "0", salePrice: "20000", trackStock: true }).returning();
    await createReceipt(tx, { companyId: state.companyId, userId: state.userId, warehouseId, date, source: "opening", lines: [{ productId: row.id, qty: 100, unitCost: 10000 }] });
    return row.id;
  });
}
const payment = (amount: number) => [{ methodId, amount, tendered: amount }];

describe("committed concurrency and DB lifecycle (disposable fixtures)", () => {
  it("F10 sale waits for receipt before freezing AVCO", async () => {
    const productId = await product();
    let release!: () => void, ready!: () => void;
    const unlocked = new Promise<void>(r => { release = r; });
    const written = new Promise<void>(r => { ready = r; });
    const receipt = withCompany(state.companyId, async tx => {
      await createReceipt(tx, { companyId: state.companyId, userId: state.userId, warehouseId, supplierId, date, lines: [{ productId, qty: 50, unitCost: 12000 }] });
      ready();
      await unlocked;
    });
    await written;
    const sale = withCompany(state.companyId, tx => createSale(tx, { companyId: state.companyId, userId: state.userId, warehouseId, date, idempotencyKey: crypto.randomUUID(), lines: [{ productId, qty: 20 }], payments: payment(400000) }));
    release();
    await receipt;
    const result = await sale;
    await withCompanyReadOnly(state.companyId, async tx => {
      const [row] = await tx.select().from(sales).where(eq(sales.id, result.id));
      expect(Number(row.costTotal)).toBeCloseTo(20 * 10666.6667, 4);
      const [ledger] = await tx.select({ value: sql<string>`sum(${stockMovements.qty} * ${stockMovements.unitCost})`, qty: sql<string>`sum(${stockMovements.qty})` }).from(stockMovements).where(eq(stockMovements.productId, productId));
      const [p] = await tx.select().from(products).where(eq(products.id, productId));
      expect(d(ledger.qty).mul(p.costPrice).minus(ledger.value).abs().toNumber()).toBeLessThan(0.02);
    });
  });
  it("F08 concurrent partial-return retries create one refund document", async () => {
    const productId = await product();
    const sold = await withCompany(state.companyId, tx => createSale(tx, { companyId: state.companyId, userId: state.userId, warehouseId, date, idempotencyKey: crypto.randomUUID(), lines: [{ productId, qty: 10 }], payments: payment(200000) }));
    const input = { companyId: state.companyId, userId: state.userId, date, saleId: sold.id, idempotencyKey: crypto.randomUUID(), reason: "Concurrent retry", refundMethod: "cash" as const, type: "return" as const, lines: [{ productId, qty: 2 }] };
    const results = await Promise.all([withCompany(state.companyId, tx => createSaleReturn(tx, input)), withCompany(state.companyId, tx => createSaleReturn(tx, input))]);
    expect(results[0].id).toBe(results[1].id);
    const rows = await withCompanyReadOnly(state.companyId, tx => tx.select().from(saleReturns).where(eq(saleReturns.saleId, sold.id)));
    expect(rows).toHaveLength(1);
  });
  it("F13 late balanced append is rejected after a real commit", async () => {
    const original = await withCompany(state.companyId, async tx => {
      const [a,b] = await tx.insert(accounts).values([
        { companyId: state.companyId, code: crypto.randomUUID(), name: "Lifecycle debit", type: "asset", normalBalance: "debit" },
        { companyId: state.companyId, code: crypto.randomUUID(), name: "Lifecycle credit", type: "liability", normalBalance: "credit" },
      ]).returning();
      const entry = await postJournal(tx, { companyId: state.companyId, date, description: "Lifecycle", sourceType: "manual", lines: [{ accountId: a.id, debit: 1 }, { accountId: b.id, credit: 1 }] });
      return { entryId: entry.id, a: a.id, b: b.id };
    });
    await expect(withCompany(state.companyId, tx => tx.insert(journalLines).values([
      { companyId: state.companyId, entryId: original.entryId, accountId: original.a, debit: "1" },
      { companyId: state.companyId, entryId: original.entryId, accountId: original.b, credit: "1" },
    ]))).rejects.toThrow();
    const rows = await withCompanyReadOnly(state.companyId, tx => tx.select().from(journalLines).where(eq(journalLines.entryId, original.entryId)));
    expect(rows).toHaveLength(2);
  });
  it("F17 held checkout survives concurrent and sequential replay", async () => {
    const productId = await product();
    const held = await withCompany(state.companyId, tx => holdSale(tx, { companyId: state.companyId, userId: state.userId, warehouseId, date, label: "Held retry", lines: [{ productId, qty: 1 }] }));
    const input = { warehouseId, heldSaleId: held.id, idempotencyKey: crypto.randomUUID(), lines: [{ productId, qty: 1 }], payments: payment(20000) };
    const results = await Promise.all([checkoutAction(input), checkoutAction(input)]);
    expect(results.every(r => r.ok)).toBe(true);
    const replay = await checkoutAction(input);
    expect(replay.ok).toBe(true);
    if (results[0].ok && results[1].ok && replay.ok) {
      expect(results[1].data.id).toBe(results[0].data.id);
      expect(replay.data.id).toBe(results[0].data.id);
    }
    const documents = await withCompanyReadOnly(state.companyId, tx => tx.select().from(sales).where(and(eq(sales.companyId, state.companyId), eq(sales.idempotencyKey, input.idempotencyKey))));
    expect(documents).toHaveLength(1);
  });
});
