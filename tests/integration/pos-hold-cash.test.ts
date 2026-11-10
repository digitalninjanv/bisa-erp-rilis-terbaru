import { afterAll, describe, expect, it, vi } from "vitest";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  cashSessions,
  companySettings,
  customerGroupPrices,
  customerGroups,
  paymentMethods,
  products,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  cashDrawerMovement,
  createSale,
  createSaleReturn,
  holdSale,
  quoteCart,
} from "@/server/pos";
import { getCashSessionSummary, getSaleDetail } from "@/server/reports";
import { peekSequence } from "@/server/sequences";
import {
  checkoutAction,
  holdAction,
  resumeHeldSaleAction,
  voidSaleAction,
} from "@/server/actions/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Tahap 3 POS batch P3-2: POS-HOLD-01 (kelompok harga end-to-end pada
// pesanan ditahan), POS-HOLD-02 (resume baca-saja, seri nomor HOLD,
// checkout yang menghapus tahanan), POS-CASH-01 (semantik setor/tarik ke
// bank satu arah di ringkasan sesi), POS-RCPT-01 (kontrak angka nota:
// Σ lineTotal baris = total, pajak inklusif tidak ditambah dua kali).
// Uji domain memakai transaksi rollback di perusahaan demo; uji action
// meniru pola feature-matrix (sesi dimock) dan membersihkan fixture
// ter-commit-nya sendiri (void penjualan + hapus grup).
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function committed<T>(fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
    return fn(tx);
  });
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

async function stockedProduct(tx: Tx, warehouseId: string, minQty: string) {
  const [row] = await tx
    .select({
      productId: stockOnHand.productId,
      qty: stockOnHand.qty,
      salePrice: products.salePrice,
    })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, minQty),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function cashMethod(tx: Tx) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function openSession(tx: Tx) {
  const [session] = await tx
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.companyId, ORG_ID),
        eq(cashSessions.userId, USER_ID),
        eq(cashSessions.status, "open"),
      ),
    )
    .orderBy(desc(cashSessions.openedAt))
    .limit(1);
  expect(session).toBeDefined();
  return session;
}

/** Grup diskon persen untuk satu produk (pola sale-flow.test.ts). */
async function makePercentGroup(tx: Tx, productId: string, suffix: string) {
  const [discountAccount] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "440101")))
    .limit(1);
  const [group] = await tx
    .insert(customerGroups)
    .values({
      companyId: ORG_ID,
      name: `Uji P3-2 ${suffix}`,
      roundingStep: 500,
      roundingDirection: "down",
      roundCashTotal: true,
      discountAccountId: discountAccount.id,
    })
    .returning({ id: customerGroups.id });
  await tx.insert(customerGroupPrices).values({
    companyId: ORG_ID,
    groupId: group.id,
    productId,
    ruleType: "percent",
    value: "10",
  });
  return group.id;
}

describe("POS hold dengan kelompok harga (domain, rollback)", () => {
  it("(a) holdSale menyimpan customerGroupId dan total harga grup", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "10");
      const groupId = await makePercentGroup(tx, product.productId, "domain");
      const lines = [{ productId: product.productId, qty: 3 }];

      const normalQuote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines,
      });
      const groupQuote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        groupId,
        lines,
      });
      expect(groupQuote.total).toBeLessThan(normalQuote.total);

      const held = await holdSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        groupId,
        date: todayISO(),
        label: "Uji hold grup",
        lines,
      } as Parameters<typeof holdSale>[1]);

      const [stored] = await tx
        .select({
          customerGroupId: sales.customerGroupId,
          total: sales.total,
          status: sales.status,
        })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, held.id)));
      return { stored, groupId, groupTotal: groupQuote.total, normalTotal: normalQuote.total };
    });

    expect(outcome.stored.status).toBe("held");
    expect(outcome.stored.customerGroupId).toBe(outcome.groupId);
    expect(d(outcome.stored.total).toNumber()).toBeCloseTo(outcome.groupTotal, 2);
    expect(d(outcome.stored.total).toNumber()).toBeLessThan(outcome.normalTotal);
  });

  it("(c) nomor hold memakai seri HOLD dan tidak mengonsumsi seri SALE", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      const method = await cashMethod(tx);
      await openSession(tx);
      const year = new Date(`${todayISO()}T00:00:00Z`).getUTCFullYear();

      const saleSeqBefore = await peekSequence(tx, ORG_ID, "SALE", year);
      const held = await holdSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        label: "Uji seri nomor",
        lines: [{ productId: product.productId, qty: 1 }],
      });
      const saleSeqAfterHold = await peekSequence(tx, ORG_ID, "SALE", year);

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [{ productId: product.productId, qty: 1 }],
      });
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });
      return { heldNumber: held.number, saleNumber: sale.number, saleSeqBefore, saleSeqAfterHold };
    });

    expect(outcome.heldNumber.startsWith("HLD-")).toBe(true);
    expect(outcome.saleNumber.startsWith("INV-")).toBe(true);
    expect(outcome.saleSeqAfterHold).toBe(outcome.saleSeqBefore);
  });
});

describe("POS kontrak angka nota berpajak (POS-RCPT-01, rollback)", () => {
  it("Σ lineTotal baris = total pada quote dan pada getSaleDetail (pajak inklusif)", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      // SIM-2 S2: PPN kini punya saklar per perusahaan — test ini
      // menguji penjualan BERPAJAK, jadi saklar dinyalakan eksplisit.
      await tx
        .update(companySettings)
        .set({ taxRate: "11", taxEnabled: true })
        .where(eq(companySettings.companyId, ORG_ID));
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      const method = await cashMethod(tx);
      await openSession(tx);
      const lines = [{ productId: product.productId, qty: 2 }];

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines,
        asOfDate: todayISO(),
      });
      expect(quote.taxTotal).toBeGreaterThan(0);
      const quoteLineSum = quote.lines.reduce((acc, line) => acc + line.lineTotal, 0);

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      const detail = await getSaleDetail(tx, ORG_ID, sale.id);
      expect(detail).not.toBeNull();
      const detailLineSum = detail!.lines.reduce(
        (acc, line) => acc.plus(d(line.lineTotal)),
        d(0),
      );
      return {
        quoteLineSum,
        quoteTotal: quote.total,
        detailLineSum: detailLineSum.toNumber(),
        saleTotal: sale.total,
        taxTotal: d(detail!.sale.taxTotal).toNumber(),
      };
    });

    expect(outcome.taxTotal).toBeGreaterThan(0);
    expect(outcome.quoteLineSum).toBeCloseTo(outcome.quoteTotal, 2);
    expect(outcome.detailLineSum).toBeCloseTo(outcome.saleTotal, 2);
  });
});

describe("POS ringkasan sesi kas (POS-CASH-01, rollback)", () => {
  it("(d) expected = modal + penjualan − refund − setor + tarik; total setor/tarik positif berarah", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      const method = await cashMethod(tx);
      const session = await openSession(tx);

      const before = await getCashSessionSummary(tx, ORG_ID, session.id);
      expect(before).not.toBeNull();

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [{ productId: product.productId, qty: 2 }],
      });
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 2 }],
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      await cashDrawerMovement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        sessionId: session.id,
        type: "deposit",
        amount: 100_000,
      });
      await cashDrawerMovement(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        sessionId: session.id,
        type: "withdrawal",
        amount: 40_000,
      });

      const ret = await createSaleReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        reason: "Uji ringkasan sesi P3-2",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.productId, qty: 1 }],
      });

      const after = await getCashSessionSummary(tx, ORG_ID, session.id);
      expect(after).not.toBeNull();
      return {
        before: before!,
        after: after!,
        saleTotal: sale.total,
        refundTotal: ret.total,
      };
    });

    const { before, after, saleTotal, refundTotal } = outcome;
    // Setor ke bank dilaporkan sebagai nominal positif berlabel arah,
    // bukan angka negatif mentah dari mutasi laci.
    expect(after.deposits - before.deposits).toBeCloseTo(100_000, 2);
    expect(after.withdrawals - before.withdrawals).toBeCloseTo(40_000, 2);
    expect(after.sales - before.sales).toBeCloseTo(saleTotal, 2);
    expect(after.refunds - before.refunds).toBeCloseTo(-refundTotal, 2);
    expect(after.expected - before.expected).toBeCloseTo(
      saleTotal - refundTotal - 100_000 + 40_000,
      2,
    );
  });
});

describe("POS hold → resume → checkout (action, fixture ter-commit dibersihkan)", () => {
  let groupId: string | null = null;
  let completedSaleId: string | null = null;
  let heldSaleId: string | null = null;

  afterAll(async () => {
    if (completedSaleId) {
      await voidSaleAction({ saleId: completedSaleId, reason: "Pembersihan uji P3-2" });
    }
    if (heldSaleId) {
      await committed(async (tx) => {
        await tx.execute(sql`delete from sale_lines where sale_id = ${heldSaleId}`);
        await tx.execute(sql`delete from sales where id = ${heldSaleId}`);
      });
    }
    if (groupId) {
      await committed(async (tx) => {
        await tx
          .delete(customerGroupPrices)
          .where(eq(customerGroupPrices.groupId, groupId!));
        await tx.delete(customerGroups).where(eq(customerGroups.id, groupId!));
      });
    }
  });

  it("(a)+(b) hold bergrup → resume baca-saja dua kali → checkout menghapus tahanan & memakai harga grup", async () => {
    const fixture = await committed(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      const method = await cashMethod(tx);
      await openSession(tx);
      return { warehouseId: warehouse.id, productId: product.productId, methodId: method.id };
    });
    groupId = await committed((tx) => makePercentGroup(tx, fixture.productId, "action"));
    const lines = [{ productId: fixture.productId, qty: 2 }];

    const expected = await rollbackTransaction(async (tx) => {
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: fixture.warehouseId,
        groupId: groupId!,
        lines,
      });
      return quote.total;
    });

    const held = await holdAction({
      warehouseId: fixture.warehouseId,
      groupId,
      idempotencyKey: crypto.randomUUID(),
      label: "Uji P3-2 action",
      lines,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    heldSaleId = held.data.id;
    expect(held.data.number.startsWith("HLD-")).toBe(true);

    const resumed = await resumeHeldSaleAction(held.data.id);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.data.customerGroupId).toBe(groupId);
    expect(resumed.data.heldTotal).toBeCloseTo(expected, 2);
    expect(resumed.data.lines).toHaveLength(1);
    expect(resumed.data.lines[0].productId).toBe(fixture.productId);

    // Resume bersifat baca-saja: panggilan kedua tetap berhasil dan
    // dokumen tahanan masih ada.
    const resumedAgain = await resumeHeldSaleAction(held.data.id);
    expect(resumedAgain.ok).toBe(true);
    const stillHeld = await committed(async (tx) => {
      const [row] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, held.data.id)))
        .limit(1);
      return row;
    });
    expect(stillHeld?.status).toBe("held");

    const checkout = await checkoutAction({
      warehouseId: fixture.warehouseId,
      groupId,
      heldSaleId: held.data.id,
      idempotencyKey: crypto.randomUUID(),
      lines,
      payments: [
        { methodId: fixture.methodId, amount: expected, tendered: expected },
      ],
    } as Parameters<typeof checkoutAction>[0]);
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    completedSaleId = checkout.data.id;
    expect(checkout.data.total).toBeCloseTo(expected, 2);

    const heldGone = await committed(async (tx) => {
      const [row] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, held.data.id)))
        .limit(1);
      return row;
    });
    expect(heldGone).toBeUndefined();
    heldSaleId = null;
  });
});
