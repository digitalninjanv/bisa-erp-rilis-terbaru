/**
 * AUDIT REPRO — POS-001 (audit ERP 2026-11-10)
 *
 * Bug: `voidReceivablePaymentAction` menghitung ulang `sales.paidTotal`
 * HANYA dari `party_payments` yang non-void
 * (src/server/actions/pos.ts:643-660). Padahal `paidTotal` semula
 * berisi pembayaran tunai/kredit yang dicatat di `sale_payments`
 * (sales-persist.ts:74). Akibatnya, setelah penerimaan piutang dibatalkan,
 * porsi tunai penjualan hilang dari `paidTotal` dan `paymentStatus` salah.
 *
 * Tes ini sengaja ditulis terpisah dari suite existing dan TIDAK mengubah
 * kode produksi. Ia gagal pada kepala (paidTotal menjadi 0 alih-alih 8000)
 * dan akan hijau setelah bug diperbaiki.
 *
 * Menjalankan:
 *   pnpm vitest run tests/audit-repro/pos-paid-total-repro.test.ts
 *
 * Tes memakai perusahaan demo dan membersihkan fixtures-nya di afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, gt } from "drizzle-orm";
import { getAccountMap } from "@/server/accounting";
import {
  cashSessions,
  customers,
  partyPayments,
  paymentMethods,
  products,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { createSale, openCashSession, quoteCart } from "@/server/pos";
import { payReceivableAction, voidReceivablePaymentAction } from "@/server/actions/pos";
import { todayISO } from "@/lib/format";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  });
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

const CASH_PART = 8000;
const CREDIT_PART = 12000;
const SALE_TOTAL = CASH_PART + CREDIT_PART;

let saleId = "";
let customerCode = "";
let openedSessionId: string | null = null;

beforeAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    const [open] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.companyId, ORG_ID),
          eq(cashSessions.userId, USER_ID),
          eq(cashSessions.status, "open"),
        ),
      )
      .limit(1);
    if (open) {
      openedSessionId = null;
    } else {
      const session = await openCashSession(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingCash: "0",
      });
      openedSessionId = session.id;
    }

    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
      .limit(1);
    if (!warehouse) throw new Error("Gudang default tidak ada");

    const [row] = await tx
      .select({ productId: stockOnHand.productId })
      .from(stockOnHand)
      .innerJoin(products, eq(stockOnHand.productId, products.id))
      .where(
        and(
          eq(stockOnHand.companyId, ORG_ID),
          eq(stockOnHand.warehouseId, warehouse.id),
          gt(stockOnHand.qty, "5"),
          eq(products.trackBatch, false),
          eq(products.trackSerial, false),
        ),
      )
      .orderBy(asc(products.sku))
      .limit(1);
    if (!row) throw new Error("Produk berstok tidak ada");
    await tx
      .update(products)
      .set({ salePrice: "10000" })
      .where(eq(products.id, row.productId));

    const [cash] = await tx
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
      .limit(1);
    const [credit] = await tx
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "credit")))
      .limit(1);
    if (!cash || !credit) throw new Error("Metode pembayaran tidak lengkap");

    const suffix = crypto.randomUUID().slice(0, 8);
    customerCode = `AUDIT-${suffix}`;
    const [customer] = await tx
      .insert(customers)
      .values({
        companyId: ORG_ID,
        code: customerCode,
        name: `Pelanggan Audit ${suffix}`,
        creditLimit: "1000000",
      })
      .returning({ id: customers.id });

    const quote = await quoteCart(tx, {
      companyId: ORG_ID,
      warehouseId: warehouse.id,
      customerId: customer.id,
      lines: [{ productId: row.productId, qty: 2 }],
    });
    expect(Number(quote.total)).toBe(SALE_TOTAL);

    const sale = await createSale(tx, {
      companyId: ORG_ID,
      userId: USER_ID,
      warehouseId: warehouse.id,
      customerId: customer.id,
      date: todayISO(),
      dueDate: todayISO(),
      lines: [{ productId: row.productId, qty: 2 }],
      payments: [
        { methodId: cash.id, amount: CASH_PART, tendered: CASH_PART },
        { methodId: credit.id, amount: CREDIT_PART, tendered: CREDIT_PART },
      ],
      idempotencyKey: crypto.randomUUID(),
    });
    saleId = sale.id;
  });
});

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    if (saleId) {
      await tx.delete(partyPayments).where(eq(partyPayments.saleId, saleId));
      await tx.delete(sales).where(eq(sales.id, saleId));
    }
    if (customerCode) {
      await tx.delete(customers).where(
        and(eq(customers.companyId, ORG_ID), eq(customers.code, customerCode)),
      );
    }
    if (openedSessionId) {
      await tx
        .delete(cashSessions)
        .where(and(eq(cashSessions.companyId, ORG_ID), eq(cashSessions.id, openedSessionId)));
    }
  });
});

describe("AUDIT REPRO POS-001 — void penerimaan piutang menghapus porsi tunai", () => {
  it("paidTotal setelah void penerimaan piutang tetap memuat pembayaran tunai", async () => {
    const [before] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(sales).where(eq(sales.id, saleId)).limit(1),
    );
    expect(Number(before.paidTotal)).toBe(CASH_PART);

    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const paidOk = await payReceivableAction({
      saleId,
      amount: CREDIT_PART,
      accountId: map.cash,
    });
    expect(paidOk.ok).toBe(true);

    const payment = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.saleId, saleId)));
      return rows.find((row) => row.status !== "void");
    });
    expect(payment).toBeDefined();

    const [afterPay] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(sales).where(eq(sales.id, saleId)).limit(1),
    );
    expect(Number(afterPay.paidTotal)).toBe(SALE_TOTAL);

    const voided = await voidReceivablePaymentAction({
      paymentId: payment!.id,
      reason: "Reproduksi audit POS-001",
    });
    expect(voided.ok).toBe(true);

    const [afterVoid] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(sales).where(eq(sales.id, saleId)).limit(1),
    );
    // BUG: paidTotal menjadi 0 (hanya party_payments non-void), bukan 8000.
    expect(Number(afterVoid.paidTotal)).toBe(CASH_PART);
  });
});
