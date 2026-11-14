import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  bankTransfers,
  customers,
  employees,
  journalEntries,
  journalLines,
  partyPayments,
  payrollRuns,
  sales,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { ensureFiscalPeriods, getAccountMap } from "@/server/accounting";
import {
  createBankTransferAction,
  voidBankTransferAction,
} from "@/server/actions/accounting/beban-transfer";
import {
  payPayableAction,
  voidPayablePaymentAction,
} from "@/server/actions/accounting/pembayaran";
import {
  payPayrollAction,
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import { payReceivableAction, voidReceivablePaymentAction } from "@/server/actions/pos";
import { todayISO } from "@/lib/format";

// Server actions need an authenticated company context and Next's cache
// revalidation; both are replaced here so the real action code (validation,
// journal posting, account mapping) runs against the real database.
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

const SUPPLIER_CODE = "SUP-TST-P2D";
const CUSTOMER_CODE = "CST-TST-P2D";
const EMPLOYEE_CODE = "EMP-TST-P2V";
const VOID_PERIOD = "2099-09";
const PAID_PERIOD = "2099-10";

/** A past date inside the current (open) month: earlier than today, same period. */
function pastDateThisMonth(): string {
  const today = todayISO();
  const day = Number(today.slice(8, 10));
  const pastDay = Math.max(1, day - 2);
  return `${today.slice(0, 8)}${String(pastDay).padStart(2, "0")}`;
}

let warehouseId = "";
let receiptId = "";
let saleId = "";
const transferIds: string[] = [];

async function cleanupFixtures() {
  await withCompany(ORG_ID, async (tx) => {
    if (transferIds.length) {
      await tx
        .delete(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG_ID), inArray(bankTransfers.id, transferIds)));
    }
    await tx
      .delete(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ORG_ID), inArray(payrollRuns.period, [VOID_PERIOD, PAID_PERIOD])));
    await tx
      .delete(employees)
      .where(and(eq(employees.companyId, ORG_ID), eq(employees.code, EMPLOYEE_CODE)));
    if (receiptId) {
      await tx.delete(partyPayments).where(eq(partyPayments.receiptId, receiptId));
      await tx.delete(stockReceipts).where(eq(stockReceipts.id, receiptId));
    }
    if (saleId) {
      await tx.delete(partyPayments).where(eq(partyPayments.saleId, saleId));
      await tx.delete(sales).where(eq(sales.id, saleId));
    }
    await tx
      .delete(suppliers)
      .where(and(eq(suppliers.companyId, ORG_ID), eq(suppliers.code, SUPPLIER_CODE)));
    await tx
      .delete(customers)
      .where(and(eq(customers.companyId, ORG_ID), eq(customers.code, CUSTOMER_CODE)));
  });
}

beforeAll(async () => {
  await cleanupFixtures();
  await withCompany(ORG_ID, async (tx) => {
    // FIX-P1 Tahap 3 (AK1-01): periode uji 2099-09/2099-10 harus
    // dimaterialisasi eksplisit — periode tanpa baris kini tertutup.
    await ensureFiscalPeriods(tx, ORG_ID, 2099);
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.companyId, ORG_ID))
      .limit(1);
    warehouseId = warehouse.id;

    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: ORG_ID, code: SUPPLIER_CODE, name: "Pemasok Uji P2" })
      .returning({ id: suppliers.id });
    const [receipt] = await tx
      .insert(stockReceipts)
      .values({
        companyId: ORG_ID,
        warehouseId,
        supplierId: supplier.id,
        number: `TEST-P2-AP-${crypto.randomUUID().slice(0, 8)}`,
        // A-21 (R3-15): penerimaan fixture kini bertanggal sama dengan
        // tanggal pembayaran lampau yang dipilih test AK-P2-03 di
        // bawah — penyesuaian yang sama seperti yang dulu dibuat
        // untuk penjualan saat POS1-12 menutup sisi piutang. Bentuk
        // lama (penerimaan hari ini dibayar dengan tanggal 2 hari
        // lalu) mengkode skenario yang kini ditolak domain secara
        // sengaja: pembayaran utang tidak boleh mendahului tanggal
        // penerimaannya. Maksud test tidak berubah.
        date: pastDateThisMonth(),
        status: "posted",
        total: "1000000",
        paidAmount: "0",
        paymentStatus: "unpaid",
        createdBy: USER_ID,
      })
      .returning({ id: stockReceipts.id });
    receiptId = receipt.id;

    const [customer] = await tx
      .insert(customers)
      .values({ companyId: ORG_ID, code: CUSTOMER_CODE, name: "Pelanggan Uji P2" })
      .returning({ id: customers.id });
    const [sale] = await tx
      .insert(sales)
      .values({
        companyId: ORG_ID,
        warehouseId,
        number: `TEST-P2-AR-${crypto.randomUUID().slice(0, 8)}`,
        // FIX-POS Tahap 1 (POS1-12): penjualan fixture kini bertanggal
        // sama dengan tanggal pembayaran lampau yang dipilih test
        // AK-P2-03 di bawah. Bentuk lama (penjualan hari ini dibayar
        // dengan tanggal 2 hari lalu) mengkode skenario yang kini
        // ditolak domain secara sengaja: pembayaran piutang tidak
        // boleh mendahului tanggal penjualannya. Maksud test —
        // tanggal pilihan tercatat apa adanya, bukan diganti hari
        // ini — tidak berubah.
        date: pastDateThisMonth(),
        cashierId: USER_ID,
        customerId: customer.id,
        status: "completed",
        subtotal: "750000",
        total: "750000",
        paidTotal: "0",
        paymentStatus: "unpaid",
        createdBy: USER_ID,
      })
      .returning({ id: sales.id });
    saleId = sale.id;
  });
});
afterAll(cleanupFixtures);

describe("tanggal pembayaran piutang/utang (AK-P2-03)", () => {
  it("records a payable payment on the chosen past date, not today", async () => {
    const payDate = pastDateThisMonth();
    expect(payDate < todayISO()).toBe(true);
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));

    const result = await payPayableAction({
      receiptId,
      idempotencyKey: randomUUID(),
      amount: 400000,
      accountId: map.cash,
      date: payDate,
    });
    expect(result.ok).toBe(true);

    const data = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.receiptId, receiptId)))
        .limit(1);
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "payment"),
            eq(journalEntries.sourceId, receiptId),
          ),
        )
        .limit(1);
      const [receipt] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receiptId))
        .limit(1);
      return { payment, entry, receipt };
    });

    expect(data.payment.date).toBe(payDate);
    expect(data.entry.date).toBe(payDate);
    expect(Number(data.receipt.paidAmount)).toBeCloseTo(400000, 2);
    expect(data.receipt.paymentStatus).toBe("partial");
  });

  it("records a receivable payment on the chosen past date, not today", async () => {
    const payDate = pastDateThisMonth();
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));

    const result = await payReceivableAction({
      saleId,
      amount: 250000,
      accountId: map.cash,
      date: payDate,
    });
    expect(result.ok).toBe(true);

    const data = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.saleId, saleId)))
        .limit(1);
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "payment"),
            eq(journalEntries.sourceId, saleId),
          ),
        )
        .limit(1);
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
      return { payment, entry, sale };
    });

    expect(data.payment.date).toBe(payDate);
    expect(data.entry.date).toBe(payDate);
    expect(Number(data.sale.paidTotal)).toBeCloseTo(250000, 2);
    expect(data.sale.paymentStatus).toBe("partial");
  });

  it("uses today when no payment date is given", async () => {
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const result = await payPayableAction({ receiptId, idempotencyKey: randomUUID(), amount: 100000, accountId: map.cash });
    expect(result.ok).toBe(true);

    const dates = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = await tx
        .select({ date: partyPayments.date })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.receiptId, receiptId)));
      return rows.map((row) => row.date);
    });
    expect(dates).toContain(todayISO());
  });
});

describe("void payroll run (AK-P2-04)", () => {
  it("voids an unpaid run: status void, journal reversed, period can be re-run", async () => {
    await withCompany(ORG_ID, async (tx) => {
      await tx.insert(employees).values({
        companyId: ORG_ID,
        code: EMPLOYEE_CODE,
        name: "Karyawan Uji Void Payroll",
        baseSalary: "3000000",
        allowances: "0",
        deductions: "100000",
        isActive: true,
      });
    });

    const ran = await runPayrollAction({ period: VOID_PERIOD });
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    const runId = ran.data.id;

    const voided = await voidPayrollRunAction({ id: runId, reason: "Salah input periode uji" });
    expect(voided.ok).toBe(true);

    const data = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [run] = await tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG_ID), eq(payrollRuns.id, runId)))
        .limit(1);
      const entries = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.sourceId, runId)));
      const map = await getAccountMap(tx, ORG_ID);
      const entryIds = entries.map((entry) => entry.id);
      const lines = entryIds.length
        ? await tx.select().from(journalLines).where(inArray(journalLines.entryId, entryIds))
        : [];
      const expenseNet = lines
        .filter((line) => line.accountId === map.salary_expense)
        .reduce((acc, line) => acc + Number(line.debit) - Number(line.credit), 0);
      return { run, entries, expenseNet };
    });

    expect(data.run.status).toBe("void");
    const original = data.entries.find((entry) => entry.sourceType === "payroll");
    const reversal = data.entries.find((entry) => entry.sourceType === "payroll_reversal");
    expect(original).toBeDefined();
    expect(reversal).toBeDefined();
    expect(reversal!.reversalOfId).toBe(original!.id);
    // Salary expense of this run nets to zero after the reversal.
    expect(data.expenseNet).toBeCloseTo(0, 2);

    // A voided run can no longer be paid…
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const payAttempt = await payPayrollAction({ runId, accountId: map.cash, date: todayISO() });
    expect(payAttempt.ok).toBe(false);

    // …and voiding it twice is rejected.
    const secondVoid = await voidPayrollRunAction({ id: runId, reason: "Coba batalkan lagi" });
    expect(secondVoid.ok).toBe(false);

    // The period is free again after a void (correction workflow).
    const rerun = await runPayrollAction({ period: VOID_PERIOD });
    expect(rerun.ok).toBe(true);
  });

  it("rejects voiding a run that has already been paid", async () => {
    const ran = await runPayrollAction({ period: PAID_PERIOD });
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    const runId = ran.data.id;

    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const paid = await payPayrollAction({ runId, accountId: map.cash, date: todayISO() });
    expect(paid.ok).toBe(true);

    const voided = await voidPayrollRunAction({ id: runId, reason: "Ingin membatalkan run terbayar" });
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.message).toMatch(/dibayar|pembayaran/i);

    const [run] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ORG_ID), eq(payrollRuns.id, runId)))
        .limit(1),
    );
    expect(run.status).toBe("paid");
  });
});

describe("void pembayaran piutang/utang (AK-P2-03)", () => {
  it("voids a payable payment: outstanding restored, that payment's journal reversed", async () => {
    // Keadaan dari test tanggal di atas: utang 1.000.000 sudah dibayar
    // 400.000 (tanggal lampau) + 100.000 (hari ini) → terbayar 500.000.
    const before = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const payments = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.receiptId, receiptId)));
      const second = payments.find((row) => Number(row.amount) === 100000);
      expect(second).toBeDefined();
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.idempotencyKey, `ap:${receiptId}:${second!.number}`),
          ),
        )
        .limit(1);
      return { second: second!, entry };
    });
    expect(before.entry).toBeDefined();
    expect(before.second.status).toBe("posted");

    const voided = await voidPayablePaymentAction({
      paymentId: before.second.id,
      reason: "Pembayaran uji salah catat",
    });
    expect(voided.ok).toBe(true);

    const after = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(eq(partyPayments.id, before.second.id))
        .limit(1);
      const [receipt] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receiptId))
        .limit(1);
      const [reversal] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.reversalOfId, before.entry.id),
          ),
        )
        .limit(1);
      return { payment, receipt, reversal };
    });

    expect(after.payment.status).toBe("void");
    // Sisa utang kembali: hanya pembayaran 400.000 yang masih dihitung.
    expect(Number(after.receipt.paidAmount)).toBeCloseTo(400000, 2);
    expect(after.receipt.paymentStatus).toBe("partial");
    expect(after.reversal).toBeDefined();
    expect(after.reversal.sourceType).toBe("payment_reversal");

    // Void ganda ditolak.
    const secondVoid = await voidPayablePaymentAction({
      paymentId: before.second.id,
      reason: "Coba batalkan dua kali",
    });
    expect(secondVoid.ok).toBe(false);
  });

  it("voids only the second of two partial receivable payments", async () => {
    // Keadaan: piutang 750.000 sudah diterima 250.000. Tambah penerimaan kedua.
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const paid = await payReceivableAction({ saleId, amount: 200000, accountId: map.cash });
    expect(paid.ok).toBe(true);

    const before = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const payments = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.saleId, saleId)));
      const first = payments.find((row) => Number(row.amount) === 250000);
      const second = payments.find((row) => Number(row.amount) === 200000);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      const entries = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            inArray(journalEntries.idempotencyKey, [
              `ar:${saleId}:${first!.number}`,
              `ar:${saleId}:${second!.number}`,
            ]),
          ),
        );
      const firstEntry = entries.find((e) => e.idempotencyKey === `ar:${saleId}:${first!.number}`);
      const secondEntry = entries.find((e) => e.idempotencyKey === `ar:${saleId}:${second!.number}`);
      return { first: first!, second: second!, firstEntry: firstEntry!, secondEntry: secondEntry! };
    });
    expect(before.firstEntry).toBeDefined();
    expect(before.secondEntry).toBeDefined();

    const voided = await voidReceivablePaymentAction({
      paymentId: before.second.id,
      reason: "Penerimaan kedua salah nominal",
    });
    expect(voided.ok).toBe(true);

    const after = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const payments = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.saleId, saleId)));
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
      const reversals = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            inArray(journalEntries.reversalOfId, [before.firstEntry.id, before.secondEntry.id]),
          ),
        );
      return { payments, sale, reversals };
    });

    // Hanya jurnal pembayaran kedua yang dibalik; yang pertama tetap berdiri.
    expect(after.reversals).toHaveLength(1);
    expect(after.reversals[0].reversalOfId).toBe(before.secondEntry.id);
    expect(after.payments.find((row) => row.id === before.second.id)?.status).toBe("void");
    expect(after.payments.find((row) => row.id === before.first.id)?.status).toBe("posted");
    // Sisa piutang = total − pembayaran pertama saja.
    expect(Number(after.sale.paidTotal)).toBeCloseTo(250000, 2);
    expect(Number(after.sale.total) - Number(after.sale.paidTotal)).toBeCloseTo(500000, 2);
    expect(after.sale.paymentStatus).toBe("partial");
  });

  it("voiding the last open receivable payment restores the sale to unpaid", async () => {
    const before = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const payments = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG_ID), eq(partyPayments.saleId, saleId)));
      const open = payments.filter((row) => row.status !== "void");
      expect(open).toHaveLength(1);
      return open[0];
    });

    const voided = await voidReceivablePaymentAction({
      paymentId: before.id,
      reason: "Penerimaan uji dibatalkan seluruhnya",
    });
    expect(voided.ok).toBe(true);

    const [sale] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select().from(sales).where(eq(sales.id, saleId)).limit(1),
    );
    expect(Number(sale.paidTotal)).toBeCloseTo(0, 2);
    expect(sale.paymentStatus).toBe("unpaid");
    expect(Number(sale.total) - Number(sale.paidTotal)).toBeCloseTo(750000, 2);
  });
});

describe("void transfer bank (AK-P2-04)", () => {
  it("voids a posted transfer: journal incl. fee reversed, status void, double void rejected", async () => {
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const created = await createBankTransferAction({
      date: todayISO(),
      fromAccountId: map.cash,
      toAccountId: map.bank,
      amount: 300000,
      fee: 6500,
      reference: "UJI-VOID-P2",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const transferId = created.data.id;
    transferIds.push(transferId);

    const before = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(bankTransfers)
        .where(eq(bankTransfers.id, transferId))
        .limit(1);
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "bank_transfer"),
            eq(journalEntries.sourceId, transferId),
          ),
        )
        .limit(1);
      return { transfer, entry };
    });
    expect(before.transfer.status).toBe("posted");
    expect(before.entry).toBeDefined();

    const voided = await voidBankTransferAction({
      id: transferId,
      reason: "Transfer uji salah tujuan",
    });
    expect(voided.ok).toBe(true);

    const after = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [transfer] = await tx
        .select()
        .from(bankTransfers)
        .where(eq(bankTransfers.id, transferId))
        .limit(1);
      const entries = await tx
        .select()
        .from(journalEntries)
        .where(
          and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.sourceId, transferId)),
        );
      const lines = entries.length
        ? await tx
            .select()
            .from(journalLines)
            .where(inArray(journalLines.entryId, entries.map((entry) => entry.id)))
        : [];
      const feeNet = lines
        .filter((line) => line.accountId === map.bank_fee)
        .reduce((acc, line) => acc + Number(line.debit) - Number(line.credit), 0);
      const cashNet = lines
        .filter((line) => line.accountId === map.cash)
        .reduce((acc, line) => acc + Number(line.debit) - Number(line.credit), 0);
      return { transfer, entries, feeNet, cashNet };
    });

    expect(after.transfer.status).toBe("void");
    const reversal = after.entries.find((entry) => entry.sourceType === "bank_transfer_reversal");
    expect(reversal).toBeDefined();
    expect(reversal!.reversalOfId).toBe(before.entry.id);
    // Biaya admin dan dana keluar sama-sama net-nol setelah pembalikan.
    expect(after.feeNet).toBeCloseTo(0, 2);
    expect(after.cashNet).toBeCloseTo(0, 2);

    const secondVoid = await voidBankTransferAction({
      id: transferId,
      reason: "Coba batalkan dua kali",
    });
    expect(secondVoid.ok).toBe(false);
  });
});
