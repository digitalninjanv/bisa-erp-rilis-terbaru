import { afterAll, beforeAll, expect, it, vi } from "vitest";
import postgres from "postgres";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { companySettings, warehouses, paymentMethods, products, productPackagings, customers, cashMovements, cashSessions } from "@/db/schema";
import { seedChartOfAccounts } from "@/server/accounting";
import { createSale, createSaleReturn, openCashSession, getOpenCashSession, payReceivable, closeCashSession } from "@/server/pos";
import { searchProducts } from "@/server/catalog/products";
import { getSaleReceiptDataAction } from "@/server/actions/pos-receipt";
import { formatReceiptToEscPos } from "@/lib/escpos/receipt-template";
import { todayISO } from "@/lib/format";
import { wipeCompanyRows } from "../helpers/wipe-company";

const state = vi.hoisted(() => ({ companyId: "", userId: "pos-remediation" }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({ company: { id: state.companyId }, user: { id: state.userId } }),
}));
const admin = postgres(process.env.DIRECT_URL!, { max: 1 });
let warehouseId = "", methodId = "", creditId = "", productId = "", packagingId = "", customerId = "", cashAccountId = "";

beforeAll(async () => {
  state.companyId = crypto.randomUUID();
  await withCompany(state.companyId, async (tx) => {
    const map = await seedChartOfAccounts(tx, state.companyId);
    cashAccountId = map.cash;
    await tx.insert(companySettings).values({ companyId: state.companyId, legalName: "POS remediation", taxEnabled: false, roundingMode: "none" });
    const [warehouse] = await tx.insert(warehouses).values({ companyId: state.companyId, code: "MAIN", name: "Utama", isDefault: true }).returning();
    warehouseId = warehouse.id;
    const methods = await tx.insert(paymentMethods).values([
      { companyId: state.companyId, code: "CASH", name: "Tunai", type: "cash", accountId: map.cash },
      { companyId: state.companyId, code: "CREDIT", name: "Utang", type: "credit", accountId: map.receivable },
    ]).returning();
    methodId = methods[0].id;
    creditId = methods[1].id;
    const [product] = await tx.insert(products).values({ companyId: state.companyId, sku: "TEST", name: "Kemasan", salePrice: "4000", costPrice: "2500", trackStock: false }).returning();
    productId = product.id;
    const [pack] = await tx.insert(productPackagings).values({ companyId: state.companyId, productId, name: "Dus", isi: "40", salePrice: "145000", buyPrice: "100000", barcode: "TEST-PACK" }).returning();
    packagingId = pack.id;
    const [customer] = await tx.insert(customers).values({ companyId: state.companyId, code: "TEST", name: "Pelanggan" }).returning();
    customerId = customer.id;
    await openCashSession(tx, { ...state, openingCash: 0 });
  });
});
afterAll(async () => {
  try { if (state.companyId) await wipeCompanyRows(admin, state.companyId); }
  finally { await admin.end(); }
});

function cashSale() {
  return withCompany(state.companyId, (tx) => createSale(tx, {
    ...state, warehouseId, date: todayISO(), lines: [{ productId, packagingId, qty: 1 }],
    payments: [{ methodId, amount: 145000, tendered: 145000 }], idempotencyKey: crypto.randomUUID(),
  }));
}
function debtSale() {
  return withCompany(state.companyId, (tx) => createSale(tx, {
    ...state, warehouseId, date: todayISO(), dueDate: todayISO(), customerId, lines: [{ productId, qty: 1 }],
    payments: [{ methodId: creditId, amount: 4000 }], idempotencyKey: crypto.randomUUID(),
  }));
}

it("omits nested packaging costs without cost access", async () => {
  const search = { companyId: state.companyId, warehouseId, q: "TEST-PACK", exactCode: true };
  const [product] = await withCompanyReadOnly(state.companyId, (tx) => searchProducts(tx, { ...search, includeCost: false }));
  expect(product).not.toHaveProperty("costPrice");
  expect(product.packagings[0]).not.toHaveProperty("buyPrice");
  const [privileged] = await withCompanyReadOnly(state.companyId, (tx) => searchProducts(tx, { ...search, includeCost: true }));
  expect(privileged.packagings[0].buyPrice).toBe("100000.0000");
});

it("prints the purchased packaging quantity and price", async () => {
  const sale = await cashSale();
  const result = await getSaleReceiptDataAction(sale.id);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.message);
  expect(result.data.lines[0]).toMatchObject({ qty: 1, unit: "Dus", price: 145000 });
});

it("prints outstanding debt for an unpaid receipt", async () => {
  const sale = await debtSale();
  const result = await getSaleReceiptDataAction(sale.id);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.message);
  const text = new TextDecoder().decode(formatReceiptToEscPos({ ...result.data, paperWidth: "80mm", showQr: false, cutPaper: false }));
  expect(text).toContain("BELUM LUNAS");
  expect(text).toContain("Sisa utang");
  expect(result.data.outstanding).toBe(4000);
});

it("replays identical returns across midnight and rejects changed business data", async () => {
  const sale = await cashSale();
  const base = {
    ...state, date: todayISO(), saleId: sale.id, idempotencyKey: crypto.randomUUID(), reason: "Salah input",
    refundMethod: "store_credit" as const, type: "return" as const, lines: [{ productId, qty: 2 }],
  };
  const [first, concurrent] = await Promise.all([
    withCompany(state.companyId, (tx) => createSaleReturn(tx, base)),
    withCompany(state.companyId, (tx) => createSaleReturn(tx, base)),
  ]);
  expect(concurrent.id).toBe(first.id);
  const replay = await withCompany(state.companyId, (tx) => createSaleReturn(tx, {
    ...base, date: "2026-11-20", lines: [{ productId, qty: "2.0000" }], disposition: "sellable",
  }));
  expect(replay.id).toBe(first.id);
  expect(replay.total).toBe(first.total);
  for (const change of [
    { reason: "Alasan berbeda" }, { lines: [{ productId, qty: 3 }] },
    { refundMethod: "cash" as const }, { disposition: "write_off" as const },
  ]) {
    await expect(withCompany(state.companyId, (tx) => createSaleReturn(tx, { ...base, ...change })))
      .rejects.toMatchObject({ code: "CONFLICT" });
  }
});

it("session close waits for an uncommitted cash receipt and includes its movement", async () => {
  const sale = await debtSale();
  const session = await withCompanyReadOnly(state.companyId, (tx) => getOpenCashSession(tx, state.companyId, state.userId));
  if (!session) throw Error("Session missing");
  const rows = await withCompanyReadOnly(state.companyId, (tx) => tx.select().from(cashMovements));
  const expectedBefore = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  let ready!: () => void, release!: () => void;
  const written = new Promise<void>((resolve) => { ready = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const payment = withCompany(state.companyId, async (tx) => {
    await payReceivable(tx, { ...state, saleId: sale.id, date: todayISO(), accountId: cashAccountId, amount: 1000, idempotencyKey: crypto.randomUUID() });
    ready();
    await gate;
  });
  await written;
  const closing = withCompany(state.companyId, (tx) => closeCashSession(tx, {
    ...state, sessionId: session.id, countedCash: expectedBefore + 1000,
  }));
  let closedBeforePayment = false;
  try {
    closedBeforePayment = await Promise.race([closing.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150))]);
  } finally { release(); }
  await payment;
  await closing;
  const movements = await withCompanyReadOnly(state.companyId, (tx) => tx.select().from(cashMovements));
  const actual = movements.reduce((sum, row) => sum + Number(row.amount), 0);
  const sessions = await withCompanyReadOnly(state.companyId, (tx) => tx.select().from(cashSessions));
  const closed = sessions.find((row) => row.id === session.id)!;
  expect(closedBeforePayment).toBe(false);
  expect(Number(closed.expectedCash)).toBe(actual);
  expect(Number(closed.expectedCash)).toBe(expectedBefore + 1000);
});

it("a receipt waiting behind session close never adds cash to the closed session", async () => {
  const session = await withCompany(state.companyId, (tx) => openCashSession(tx, { ...state, openingCash: 0 }));
  const sale = await debtSale();
  let ready!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => { ready = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const closing = withCompany(state.companyId, async (tx) => {
    await closeCashSession(tx, { ...state, sessionId: session.id, countedCash: 0 });
    ready();
    await gate;
  });
  await locked;
  const payment = withCompany(state.companyId, (tx) => payReceivable(tx, {
    ...state, saleId: sale.id, date: todayISO(), accountId: cashAccountId, amount: 1000, idempotencyKey: crypto.randomUUID(),
  }));
  let completedBeforeClose = false;
  try {
    completedBeforeClose = await Promise.race([payment.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150))]);
  } finally { release(); }
  await closing;
  await payment;
  const movements = await withCompanyReadOnly(state.companyId, (tx) => tx.select().from(cashMovements));
  expect(completedBeforeClose).toBe(false);
  expect(movements.filter((row) => row.sessionId === session.id && row.type === "sale")).toHaveLength(0);
});
