import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountMappings,
  accounts,
  bankStatementImports,
  bankStatementLines,
  companySettings,
  customers,
  employees,
  journalEntries,
  journalLines,
  partyCredits,
  partyOpeningBalances,
  reimbursementClaims,
  sales,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import type { Tx } from "@/db";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { countUnmatchedStatementLines } from "@/server/bank-reconciliation";
import { getPartyCreditQueueSummary } from "@/server/party-credits";
import { countPendingReimbursementClaims } from "@/server/reimbursements";
import {
  getAccountingOnboardingState,
  getReceivablePayableQueues,
  listPayables,
  listReceivables,
} from "@/server/reports";

// A-22 Tahap K5: dashboard akuntansi menjadi daftar kerja — angka
// antreannya wajib datang dari fungsi baca modul server (ratchet
// ARS1-01 melarang agregasi di halaman). Test ini menanam data
// deterministik di perusahaan fixture khusus berkas ini (dibersihkan
// & ditanam ulang di beforeAll agar hitungan agregat perusahaan
// eksak), lalu menegaskan kelima fungsi baca antrean + keadaan awal
// (onboarding) untuk perusahaan kosong / setengah siap / berjalan.

// ORG acak per larian: baris jurnal posted bersifat append-only
// (trigger DB melarang hapus), jadi perusahaan agregat tidak bisa
// dibersihkan & dipakai ulang antar-larian seperti fixture dokumen
// lain. EMPTY/MAPPED tidak menanam jurnal — id tetap + wipe aman.
const ORG = crypto.randomUUID();
const EMPTY = "01900000-0000-7000-8000-00000000a223";
const MAPPED = "01900000-0000-7000-8000-00000000a224";
const TODAY = "2099-01-20";

const acc: Record<string, string> = {};
let warehouseId = "";
let customerId = "";
let supplierId = "";
let employeeId = "";

async function wipe(tx: Tx, companyId: string) {
  // Urutan mengikuti FK: anak sebelum induk.
  await tx.delete(bankStatementLines).where(eq(bankStatementLines.companyId, companyId));
  await tx.delete(bankStatementImports).where(eq(bankStatementImports.companyId, companyId));
  await tx.delete(partyCredits).where(eq(partyCredits.companyId, companyId));
  await tx.delete(journalLines).where(eq(journalLines.companyId, companyId));
  await tx.delete(journalEntries).where(eq(journalEntries.companyId, companyId));
  await tx.delete(reimbursementClaims).where(eq(reimbursementClaims.companyId, companyId));
  await tx.delete(partyOpeningBalances).where(eq(partyOpeningBalances.companyId, companyId));
  await tx.delete(sales).where(eq(sales.companyId, companyId));
  await tx.delete(stockReceipts).where(eq(stockReceipts.companyId, companyId));
  await tx.delete(employees).where(eq(employees.companyId, companyId));
  await tx.delete(customers).where(eq(customers.companyId, companyId));
  await tx.delete(suppliers).where(eq(suppliers.companyId, companyId));
  await tx.delete(warehouses).where(eq(warehouses.companyId, companyId));
  await tx.delete(accountMappings).where(eq(accountMappings.companyId, companyId));
  await tx.delete(accounts).where(eq(accounts.companyId, companyId));
  await tx.delete(companySettings).where(eq(companySettings.companyId, companyId));
}

async function bootstrap() {
  await withCompany(ORG, async (tx) => {
    await wipe(tx, ORG);
    await tx.insert(companySettings).values({
      companyId: ORG,
      legalName: "Uji K5",
      taxRate: "0",
      taxEnabled: false,
    });
    const rows = await tx
      .insert(accounts)
      .values([
        { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
        { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" },
        { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
        { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
        { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
        { companyId: ORG, code: "2300", name: "Kredit Pelanggan", type: "liability", normalBalance: "credit" },
        { companyId: ORG, code: "6100", name: "Beban Listrik", type: "expense", normalBalance: "debit" },
      ])
      .returning({ id: accounts.id, code: accounts.code });
    const byCode = new Map(rows.map((row) => [row.code, row.id]));
    for (const [code, id] of byCode) acc[code] = id;
    await tx.insert(accountMappings).values([
      { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
      { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
      { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
      { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
      { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
      { companyId: ORG, key: "customer_credit", accountId: byCode.get("2300")! },
    ]);
    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: ORG, code: "GD-K5", name: "Gudang Uji K5", type: "warehouse", isDefault: true })
      .returning({ id: warehouses.id });
    warehouseId = warehouse.id;
    const [customer] = await tx
      .insert(customers)
      .values({ companyId: ORG, code: "CST-K5", name: "Pelanggan K5" })
      .returning({ id: customers.id });
    customerId = customer.id;
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: ORG, code: "SUP-K5", name: "Pemasok K5", paymentTermDays: 30 })
      .returning({ id: suppliers.id });
    supplierId = supplier.id;
    const [employee] = await tx
      .insert(employees)
      .values({ companyId: ORG, code: "EMP-K5", name: "Karyawan K5" })
      .returning({ id: employees.id });
    employeeId = employee.id;

    // --- Piutang: 2 terlambat (100.000 + 40.000), 1 terbuka belum tempo.
    await tx.insert(sales).values([
      {
        companyId: ORG, warehouseId, number: "INV-K5-001", date: "2099-01-02",
        dueDate: "2099-01-10", cashierId: "user-k5", customerId,
        status: "completed", total: "100000", paidTotal: "0", paymentStatus: "unpaid",
      },
      {
        companyId: ORG, warehouseId, number: "INV-K5-002", date: "2099-01-15",
        dueDate: "2099-02-01", cashierId: "user-k5", customerId,
        status: "completed", total: "50000", paidTotal: "20000", paymentStatus: "partial",
      },
    ]);
    await tx.insert(partyOpeningBalances).values([
      {
        companyId: ORG, number: "OPB-K5-AR", kind: "receivable", partyType: "customer",
        partyId: customerId, date: "2098-12-20", dueDate: "2099-01-05",
        amount: "40000", paidAmount: "0", status: "open",
      },
      {
        companyId: ORG, number: "OPB-K5-AP", kind: "payable", partyType: "supplier",
        partyId: supplierId, date: "2099-01-10", dueDate: "2099-01-25",
        amount: "75000", paidAmount: "0", status: "open",
      },
    ]);

    // --- Utang: 1 terlambat (termin 30 hari dari 2098-12-01), 1 belum tempo.
    await tx.insert(stockReceipts).values([
      {
        companyId: ORG, warehouseId, supplierId, source: "purchase", number: "RCV-K5-001",
        date: "2098-12-01", status: "posted", total: "200000", paidAmount: "0", paymentStatus: "unpaid",
      },
      {
        companyId: ORG, warehouseId, supplierId, source: "purchase", number: "RCV-K5-002",
        date: "2099-01-18", status: "posted", total: "60000", paidAmount: "0", paymentStatus: "unpaid",
      },
    ]);

    // --- Kredit pihak: 2 terbuka bersisa, 1 lunas, 1 terbuka sisa nol.
    await tx.insert(partyCredits).values([
      { companyId: ORG, number: "KRD-K5-001", partyType: "customer", partyId: customerId, date: "2099-01-12", amount: "50000", usedAmount: "20000", status: "open" },
      { companyId: ORG, number: "KRD-K5-002", partyType: "supplier", partyId: supplierId, date: "2099-01-12", amount: "25000", usedAmount: "0", status: "open" },
      { companyId: ORG, number: "KRD-K5-003", partyType: "customer", partyId: customerId, date: "2099-01-12", amount: "10000", usedAmount: "10000", status: "settled" },
      { companyId: ORG, number: "KRD-K5-004", partyType: "supplier", partyId: supplierId, date: "2099-01-12", amount: "8000", usedAmount: "8000", status: "open" },
    ]);

    // --- Klaim: 2 menunggu persetujuan, 1 sudah disahkan.
    await tx.insert(reimbursementClaims).values([
      { companyId: ORG, number: "RBS-K5-001", employeeId, date: "2099-01-11", expenseAccountId: acc["6100"], amount: "15000", description: "Klaim K5 satu", status: "submitted" },
      { companyId: ORG, number: "RBS-K5-002", employeeId, date: "2099-01-12", expenseAccountId: acc["6100"], amount: "25000", description: "Klaim K5 dua", status: "submitted" },
      { companyId: ORG, number: "RBS-K5-003", employeeId, date: "2099-01-12", expenseAccountId: acc["6100"], amount: "99999", description: "Klaim K5 disahkan", status: "approved" },
    ]);

    // --- Jurnal posted (untuk baris mutasi yang sudah cocok + onboarding).
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        companyId: ORG, number: "JE-K5-001", date: "2099-01-10",
        description: "Jurnal uji K5", sourceType: "manual", status: "posted",
      })
      .returning({ id: journalEntries.id });
    const [line] = await tx
      .insert(journalLines)
      .values([
        {
          companyId: ORG, entryId: entry.id, accountId: acc["1100"],
          debit: "777000", credit: "0", lineNo: 1,
        },
        {
          companyId: ORG, entryId: entry.id, accountId: acc["1000"],
          debit: "0", credit: "777000", lineNo: 2,
        },
      ])
      .returning({ id: journalLines.id });

    // --- Mutasi bank: 3 belum cocok (neto +125.000), 1 sudah cocok.
    const [imp] = await tx
      .insert(bankStatementImports)
      .values({ companyId: ORG, accountId: acc["1100"], fileName: "mutasi-k5.csv", totalRows: 4, insertedRows: 4 })
      .returning({ id: bankStatementImports.id });
    await tx.insert(bankStatementLines).values([
      { companyId: ORG, importId: imp.id, accountId: acc["1100"], date: "2099-01-11", description: "Setoran K5", debit: "150000", credit: "0", fingerprint: "k5-line-1" },
      { companyId: ORG, importId: imp.id, accountId: acc["1100"], date: "2099-01-12", description: "Biaya K5", debit: "0", credit: "50000", fingerprint: "k5-line-2" },
      { companyId: ORG, importId: imp.id, accountId: acc["1100"], date: "2099-01-13", description: "Setoran K5 dua", debit: "25000", credit: "0", fingerprint: "k5-line-3" },
      { companyId: ORG, importId: imp.id, accountId: acc["1100"], date: "2099-01-10", description: "Sudah cocok K5", debit: "777000", credit: "0", fingerprint: "k5-line-4", matchedJournalLineId: line.id },
    ]);
  });

  // Perusahaan setengah siap: akun bank + pemetaan saja, tanpa jurnal.
  await withCompany(MAPPED, async (tx) => {
    await wipe(tx, MAPPED);
    const [bank] = await tx
      .insert(accounts)
      .values({ companyId: MAPPED, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" })
      .returning({ id: accounts.id });
    await tx.insert(accountMappings).values({ companyId: MAPPED, key: "bank", accountId: bank.id });
  });
  await withCompany(EMPTY, async (tx) => {
    await wipe(tx, EMPTY);
  });
}

beforeAll(bootstrap);

describe("antrean dashboard akuntansi (A-22 K5)", () => {
  it("piutang: terlambat & terbuka dihitung dari daftar yang sama dengan halaman", async () => {
    const queues = await withCompanyReadOnly(ORG, (tx) => getReceivablePayableQueues(tx, ORG, TODAY));
    expect(queues.receivables.overdueCount).toBe(2);
    expect(queues.receivables.overdueTotal).toBe(140000);
    expect(queues.receivables.openCount).toBe(3);
    expect(queues.receivables.openTotal).toBe(170000);
  });

  it("utang: terlambat, jatuh tempo ≤7 hari, dan terbuka dipisahkan", async () => {
    const queues = await withCompanyReadOnly(ORG, (tx) => getReceivablePayableQueues(tx, ORG, TODAY));
    expect(queues.payables.overdueCount).toBe(1);
    expect(queues.payables.overdueTotal).toBe(200000);
    expect(queues.payables.dueSoonCount).toBe(1);
    expect(queues.payables.dueSoonTotal).toBe(75000);
    expect(queues.payables.openCount).toBe(3);
    expect(queues.payables.openTotal).toBe(335000);
  });

  it("ringkasan dashboard memakai daftar piutang & utang yang sudah dimuat", async () => {
    const queues = await withCompanyReadOnly(ORG, async (tx) => {
      const [receivables, payables] = await Promise.all([
        listReceivables(tx, ORG),
        listPayables(tx, ORG),
      ]);
      return getReceivablePayableQueues(tx, ORG, TODAY, { receivables, payables });
    });
    expect(queues.receivables.openCount).toBe(3);
    expect(queues.receivables.openTotal).toBe(170000);
    expect(queues.payables.openCount).toBe(3);
    expect(queues.payables.openTotal).toBe(335000);
  });

  it("mutasi bank belum cocok: jumlah baris & neto bertanda", async () => {
    const result = await withCompanyReadOnly(ORG, (tx) => countUnmatchedStatementLines(tx, ORG));
    expect(result.count).toBe(3);
    expect(result.netTotal).toBe("125000.0000");
  });

  it("kredit pihak tersedia: hanya dokumen open bersisa yang dihitung", async () => {
    const summary = await withCompanyReadOnly(ORG, (tx) => getPartyCreditQueueSummary(tx, ORG));
    expect(summary.count).toBe(2);
    expect(summary.totalRemaining).toBe("55000.0000");
    expect(summary.customer.count).toBe(1);
    expect(summary.customer.totalRemaining).toBe("30000.0000");
    expect(summary.supplier.count).toBe(1);
    expect(summary.supplier.totalRemaining).toBe("25000.0000");
  });

  it("klaim menunggu persetujuan: hanya status submitted", async () => {
    const pending = await withCompanyReadOnly(ORG, (tx) => countPendingReimbursementClaims(tx, ORG));
    expect(pending.count).toBe(2);
    expect(pending.total).toBe("40000.0000");
  });

  it("keadaan awal: perusahaan berjalan terdeteksi dari jurnal posted & pemetaan bank", async () => {
    const state = await withCompanyReadOnly(ORG, (tx) => getAccountingOnboardingState(tx, ORG));
    expect(state.hasPostedJournal).toBe(true);
    expect(state.hasBankMapping).toBe(true);
    expect(state.journalCount).toBe(1);
  });

  it("keadaan awal: perusahaan kosong belum punya keduanya", async () => {
    const state = await withCompanyReadOnly(EMPTY, (tx) => getAccountingOnboardingState(tx, EMPTY));
    expect(state).toEqual({ journalCount: 0, hasPostedJournal: false, hasBankMapping: false });
  });

  it("keadaan awal: bank terpeta saja belum dianggap berjalan", async () => {
    const state = await withCompanyReadOnly(MAPPED, (tx) => getAccountingOnboardingState(tx, MAPPED));
    expect(state.hasPostedJournal).toBe(false);
    expect(state.hasBankMapping).toBe(true);
  });
});
