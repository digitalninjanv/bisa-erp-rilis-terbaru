import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  cashMovements,
  companySettings,
  customers,
  journalEntries,
  member,
  organization,
  paymentMethods,
  payrollRuns,
  products,
  saleReturns,
  stockMovements,
  suppliers,
  user,
  warehouses,
} from "@/db/schema";
import { ensureFiscalPeriods, postJournal, seedChartOfAccounts } from "@/server/accounting";
import { listCompanyAuditTrail, HR_AUDIT_ENTITY_TYPES, writeAudit } from "@/server/audit";
import { revokeEmployeeUserAccess } from "@/server/member-permissions";
import { createReceipt, voidReceipt } from "@/server/inventory";
import { cashDrawerMovement, createSale, createSaleReturn, openCashSession } from "@/server/pos";
import { getSalesSummary, getTopProducts } from "@/server/reports";
import { payPayrollRun } from "@/server/hr/payroll-runs";
import { lockYearPeriods, postYearEndClosing } from "@/server/year-end-closing";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { CASH_MOVEMENT_TYPE_BY_INTENT } from "@/lib/pos/cash-movement";
import { rollbackTransaction, type Tx } from "../helpers/rollback-transaction";

const companyIdFor = () => crypto.randomUUID();

async function seedCompany(
  tx: Tx,
  companyId: string,
  options?: { taxEnabled?: boolean; taxRate?: string },
) {
  const userId = crypto.randomUUID();
  const map = await seedChartOfAccounts(tx, companyId);
  await tx.insert(companySettings).values({
    companyId,
    legalName: "Synthetic remediation",
    taxEnabled: options?.taxEnabled ?? false,
    taxRate: options?.taxRate ?? "0",
    allowNegativeStock: false,
  });
  const [warehouse] = await tx
    .insert(warehouses)
    .values({ companyId, code: "MAIN", name: "Main", isDefault: true })
    .returning();
  return { companyId, userId, map, warehouse };
}

async function makeProduct(tx: Tx, companyId: string, cost = "100", price = "200") {
  const [product] = await tx
    .insert(products)
    .values({
      companyId,
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      name: "Produk remediasi",
      costPrice: cost,
      salePrice: price,
      trackStock: true,
    })
    .returning();
  return product;
}

describe("remediasi audit — P0 data integrity", () => {
  it("INV-01: void penerimaan PPN inklusif memakai DPP dan tidak merusak AVCO", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId, { taxEnabled: true, taxRate: "11" });
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId, code: "SUP", name: "Supplier" })
        .returning();
      const product = await makeProduct(tx, companyId);
      const date = todayISO();

      await createReceipt(tx, {
        companyId,
        userId: seeded.userId,
        warehouseId: seeded.warehouse.id,
        source: "opening",
        date,
        lines: [{ productId: product.id, qty: 10, unitCost: 100 }],
      });
      const taxable = await createReceipt(tx, {
        companyId,
        userId: seeded.userId,
        warehouseId: seeded.warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date,
        taxIncluded: true,
        lines: [{ productId: product.id, qty: 1, unitCost: 111 }],
      });

      await voidReceipt(tx, {
        companyId,
        userId: seeded.userId,
        receiptId: taxable.id,
        reason: "Remediasi INV-01",
        date,
      });

      const [row] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));
      expect(Number(row.costPrice)).toBe(100);

      const [ledger] = await tx
        .select({
          qty: sql<string>`coalesce(sum(${stockMovements.qty}), 0)`,
          value: sql<string>`coalesce(sum(${stockMovements.qty} * ${stockMovements.unitCost}), 0)`,
        })
        .from(stockMovements)
        .where(eq(stockMovements.productId, product.id));
      expect(Number(ledger.qty)).toBe(10);
      expect(Number(ledger.value)).toBeCloseTo(1000, 4);
    });
  });

  it("POS-03: retur store credit atas penjualan utang tidak meninggalkan omzet hantu", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      const [customer] = await tx
        .insert(customers)
        .values({ companyId, code: "CUST", name: "Pelanggan", creditLimit: "0" })
        .returning();
      const [creditMethod] = await tx
        .insert(paymentMethods)
        .values({ companyId, code: "CREDIT", name: "Utang", type: "credit" })
        .returning();
      const product = await makeProduct(tx, companyId);
      const date = todayISO();
      await openCashSession(tx, { companyId, userId: seeded.userId, openingCash: 0 });
      await createReceipt(tx, {
        companyId,
        userId: seeded.userId,
        warehouseId: seeded.warehouse.id,
        source: "opening",
        date,
        lines: [{ productId: product.id, qty: 10, unitCost: 100 }],
      });
      const sale = await createSale(tx, {
        companyId,
        userId: seeded.userId,
        warehouseId: seeded.warehouse.id,
        customerId: customer.id,
        dueDate: date,
        date,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ productId: product.id, qty: 2 }],
        payments: [{ methodId: creditMethod.id, amount: 400 }],
      });
      const ret = await createSaleReturn(tx, {
        companyId,
        userId: seeded.userId,
        saleId: sale.id,
        idempotencyKey: crypto.randomUUID(),
        date,
        reason: "Retur utang penuh",
        refundMethod: "store_credit",
        type: "return",
        lines: [{ productId: product.id, qty: 2 }],
      });

      const [returnRow] = await tx
        .select({ total: saleReturns.total, goodsTotal: saleReturns.goodsTotal })
        .from(saleReturns)
        .where(eq(saleReturns.id, ret.id));
      expect(Number(returnRow.total)).toBe(0);
      expect(Number(returnRow.goodsTotal)).toBe(400);

      const summary = await getSalesSummary(tx, companyId, { from: date, to: date });
      expect(summary.total).toBe(0);
      expect(summary.returned).toBe(400);
      expect(summary.profit).toBe(0);
    });
  });

  it("ACC-01: tutup buku berhasil setelah seluruh periode dikunci", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      const year = 2025;
      await ensureFiscalPeriods(tx, companyId, year);
      await postJournal(tx, {
        companyId,
        date: `${year}-12-15`,
        description: "Pendapatan uji closing",
        sourceType: "remediation_test",
        createdBy: seeded.userId,
        lines: [
          { accountId: seeded.map.cash, debit: 1000 },
          { accountId: seeded.map.revenue, credit: 1000 },
        ],
      });
      await lockYearPeriods(tx, { companyId, year, userId: seeded.userId });
      const entry = await postYearEndClosing(tx, {
        companyId,
        year,
        retainedEarningsAccountId: seeded.map.equity,
        createdBy: seeded.userId,
      });
      expect(entry.number).toMatch(/^JE-/);
      const [closing] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.id, entry.id));
      expect(closing).toBeTruthy();
    });
  });

  it("POS-01/POS-06: arah kas benar dan key yang dipakai ulang dengan payload berbeda ditolak", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      const session = await openCashSession(tx, {
        companyId,
        userId: seeded.userId,
        openingCash: 100000,
      });
      await cashDrawerMovement(tx, {
        companyId,
        userId: seeded.userId,
        sessionId: session.id,
        type: CASH_MOVEMENT_TYPE_BY_INTENT.out,
        amount: 25000,
        notes: "Kas keluar",
      });
      const [total] = await tx
        .select({ value: sql<string>`coalesce(sum(${cashMovements.amount}),0)` })
        .from(cashMovements)
        .where(eq(cashMovements.sessionId, session.id));
      expect(Number(total.value)).toBe(75000);

      const key = crypto.randomUUID();
      await cashDrawerMovement(tx, {
        companyId,
        userId: seeded.userId,
        sessionId: session.id,
        type: CASH_MOVEMENT_TYPE_BY_INTENT.out,
        amount: 10000,
        idempotencyKey: key,
      });
      await expect(
        cashDrawerMovement(tx, {
          companyId,
          userId: seeded.userId,
          sessionId: session.id,
          type: CASH_MOVEMENT_TYPE_BY_INTENT.in,
          amount: 999999,
          idempotencyKey: key,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  it("CORE-06: feed audit tanpa izin HR menyembunyikan entity HR", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      await writeAudit(tx, {
        companyId,
        userId: seeded.userId,
        action: "employee_loan.create",
        entityType: "employee_loan",
        entityId: crypto.randomUUID(),
        after: { amount: "5000000" },
      });
      await writeAudit(tx, {
        companyId,
        userId: seeded.userId,
        action: "product.update",
        entityType: "product",
        entityId: crypto.randomUUID(),
        after: { salePrice: "200" },
      });
      const visible = await listCompanyAuditTrail(tx, companyId, {
        excludeEntityTypes: [...HR_AUDIT_ENTITY_TYPES],
      });
      expect(visible.rows.map((row) => row.entityType)).toEqual(["product"]);
      expect(visible.total).toBe(1);
      const all = await listCompanyAuditTrail(tx, companyId);
      expect(all.rows.map((row) => row.entityType).sort()).toEqual([
        "employee_loan",
        "product",
      ]);
    });
  });

  it("REP-01: produk yang hanya muncul di sisi retur tetap masuk top products", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      const [cash] = await tx
        .insert(paymentMethods)
        .values({
          companyId,
          code: "CASH",
          name: "Cash",
          type: "cash",
          accountId: seeded.map.cash,
        })
        .returning();
      const product = await makeProduct(tx, companyId);
      const saleDate = "2026-10-15";
      const returnDate = "2026-11-21";
      await openCashSession(tx, { companyId, userId: seeded.userId, openingCash: 0 });
      await createReceipt(tx, {
        companyId,
        userId: seeded.userId,
        warehouseId: seeded.warehouse.id,
        source: "opening",
        date: saleDate,
        lines: [{ productId: product.id, qty: 10, unitCost: 100 }],
      });
      const sale = await createSale(tx, {
        companyId,
        userId: seeded.userId,
        warehouseId: seeded.warehouse.id,
        date: saleDate,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ productId: product.id, qty: 2 }],
        payments: [{ methodId: cash.id, amount: 400 }],
      });
      await createSaleReturn(tx, {
        companyId,
        userId: seeded.userId,
        saleId: sale.id,
        idempotencyKey: crypto.randomUUID(),
        date: returnDate,
        reason: "Retur periode berikutnya",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId: product.id, qty: 2 }],
      });
      const top = await getTopProducts(tx, companyId, { from: returnDate, to: returnDate });
      const row = top.find((item) => item.productId === product.id);
      expect(row).toBeTruthy();
      expect(row!.total).toBe(-400);
    });
  });

  it("ACC-02: pembayaran payroll menolak akun non-kas/bank", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          companyId,
          number: `PR-${crypto.randomUUID().slice(0, 8)}`,
          period: "2026-11",
          status: "posted",
          totalGross: "1000000",
          totalDeductions: "0",
          totalNet: "1000000",
          createdBy: seeded.userId,
        })
        .returning();
      await expect(
        payPayrollRun(tx, {
          companyId,
          userId: seeded.userId,
          runId: run.id,
          accountId: seeded.map.revenue,
          date: todayISO(),
        }),
      ).rejects.toBeInstanceOf(AppError);
      const [stillPosted] = await tx
        .select({ status: payrollRuns.status })
        .from(payrollRuns)
        .where(eq(payrollRuns.id, run.id));
      expect(stillPosted.status).toBe("posted");

      await expect(
        payPayrollRun(tx, {
          companyId,
          userId: seeded.userId,
          runId: run.id,
          accountId: seeded.map.cash,
          date: todayISO(),
        }),
      ).resolves.toBeTruthy();
    });
  });

  it("ACC-03: key jurnal yang sama + payload berbeda ditolak, payload sama replay", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      const seeded = await seedCompany(tx, companyId);
      const key = crypto.randomUUID();
      const base = {
        companyId,
        date: todayISO(),
        description: "Jurnal remediasi",
        sourceType: "manual",
        createdBy: seeded.userId,
        idempotencyKey: key,
      };
      const first = await postJournal(tx, {
        ...base,
        lines: [
          { accountId: seeded.map.cash, debit: 100 },
          { accountId: seeded.map.revenue, credit: 100 },
        ],
      });
      const replay = await postJournal(tx, {
        ...base,
        lines: [
          { accountId: seeded.map.cash, debit: 100 },
          { accountId: seeded.map.revenue, credit: 100 },
        ],
      });
      expect(replay.id).toBe(first.id);

      await expect(
        postJournal(tx, {
          ...base,
          lines: [
            { accountId: seeded.map.cash, debit: 200 },
            { accountId: seeded.map.revenue, credit: 200 },
          ],
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  it("HR-01: nama ambigu tidak mencabut semua akun; nama unik dicabut", async () => {
    const companyId = companyIdFor();
    await rollbackTransaction(companyId, async (tx) => {
      await tx.insert(organization).values({
        id: companyId,
        name: "Uji offboarding",
        slug: `offboarding-${crypto.randomUUID().slice(0, 8)}`,
      });
      const addMember = async (name: string) => {
        const id = crypto.randomUUID();
        await tx.insert(user).values({
          id,
          name,
          email: `${id}@uji.local`,
          emailVerified: true,
          role: "user",
        });
        await tx.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: companyId,
          userId: id,
          role: "cashier",
        });
        return id;
      };
      await addMember("Budi");
      await addMember("Budi");
      const ambiguous = await revokeEmployeeUserAccess(tx, companyId, "Budi");
      expect(ambiguous.revoked).toBe(false);
      expect(ambiguous.reason).toBe("ambiguous");

      const sole = await addMember("Siti");
      const revoked = await revokeEmployeeUserAccess(tx, companyId, "Siti");
      expect(revoked.revoked).toBe(true);
      expect(revoked.userId).toBe(sole);
    });
  });
});
