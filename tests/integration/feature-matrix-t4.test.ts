import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  bankStatementLines,
  companySettings,
  customers,
  importJobs,
  importRows,
  journalEntries,
  journalLines,
  member,
  organization,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { getAccountMap, postJournal, reverseJournalEntry } from "@/server/accounting";
import { autoMatch, importStatement, matchLine } from "@/server/bank-reconciliation";
import { createOpeningBalance, payOpeningBalance } from "@/server/opening-balances";
import { listPayables, listReceivables } from "@/server/reports";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  ENTITY_FIELDS,
  suggestMappingFor,
  type ImportEntity,
} from "@/lib/import-parse";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { d, formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { GET as exportSuppliersRoute } from "@/app/api/export/suppliers/route";
import { GET as exportCustomersRoute } from "@/app/api/export/customers/route";
import { GET as exportAccountsRoute } from "@/app/api/export/accounts/route";
import GoodsReceiptPrintPage from "@/app/app/gudang/penerimaan/[id]/cetak/page";
import PurchaseOrderPrintPage from "@/app/app/gudang/pembelian/[id]/cetak/page";
import { adminSql } from "@/db/admin";
import { rollbackTransaction } from "../helpers/rollback-transaction";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// Matriks Verifikasi Fitur Tahap 4 (A-5) — test penutup untuk celah yang
// belum tersentuh berkas uji batch T4-1 s.d. T4-6b:
//   M-T4-1 aging AR/AP memuat dokumen saldo awal pada bucket yang benar
//   M-T4-2 rekonsiliasi: jurnal yang sudah dibalik tidak tertaut auto-match
//   M-T4-3 impor → ekspor CSV master: nilai SEMUA field utuh (round-trip)
//   M-T4-4 halaman cetak GRN/PO asli memakai pengaturan cetak perusahaan
//   M-T4-5 requireAuth asli: cookie perusahaan asing tidak menggeser konteks
//
// Sesi diganti versi dinamis (satu berkas memuat perusahaan uji berbeda per
// rangkaian); khusus M-T4-5 modul sesi ASLI dimuat lewat importActual
// dengan auth & header Next yang diganti, terhadap database nyata.

const DEMO_ORG = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const AGING_ORG = "01900000-0000-7000-8000-00000000aa11";
const PRINT_ORG = "01900000-0000-7000-8000-00000000aa13";
const SECOND_ORG = "01900000-0000-7000-8000-00000000bb11";
const suffix = crypto.randomUUID().slice(0, 8);

const hoisted = vi.hoisted(() => ({
  companyId: "01900000-0000-7000-8000-000000000001",
  cookieJar: new Map<string, string>(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: hoisted.companyId },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
  // A-23 SIS-04: halaman cetak kini memakai penjaga halaman
  // (requirePermissionPage) — ganda uji mengembalikan ctx owner yang
  // sama seperti requirePermission di atas.
  requirePermissionPage: async () => ({
    company: { id: hoisted.companyId },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
  requirePermissionPageInModule: async () => ({
    company: { id: hoisted.companyId },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
  requireAuth: async () => ({
    company: { id: hoisted.companyId },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
  getCompanyId: async () => hoisted.companyId,
}));
// Modul sesi asli (M-T4-5) mengimpor "server-only" dan auth Better Auth;
// keduanya diganti agar requireAuth asli bisa berjalan di Vitest.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "01900000-0000-7000-8000-000000000010", name: "Owner Demo", email: "owner@bisa.id" },
        session: { id: "sesi-uji-matriks-t4" },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = hoisted.cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      hoisted.cookieJar.set(name, value);
    },
    delete: (name: string) => {
      hoisted.cookieJar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// Link dirender sebagai <a> polos: yang diuji di sini adalah pemakaian
// pengaturan cetak oleh halaman, bukan perutean Next.
vi.mock("next/link", async () => {
  const { jsx } = await import("react/jsx-runtime");
  return {
    default: (props: { href?: string; className?: string; children?: unknown }) =>
      jsx("a", { href: props.href ?? "#", className: props.className, children: props.children }),
  };
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


async function orgTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}

function daysAgo(days: number): string {
  const date = new Date(`${todayISO()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function idDate(iso: string): string {
  const [y, m, dd] = iso.split("-");
  return `${dd}/${m}/${y}`;
}

/* ------------------------------------------------------------------ */
/* M-T4-1 — aging AR/AP memuat dokumen saldo awal (D-14)               */
/* ------------------------------------------------------------------ */

// Perusahaan uji khusus TANPA baris periode fiskal: di perusahaan demo
// bulan Sep–Okt 2026 sudah `closed`, sehingga bucket 31–60 & 61–90 hari
// tidak bisa dijangkau dokumen nyata di sana (posting ditolak periode
// tertutup). Semantik proyek: bulan tanpa baris periode = terbuka.
const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["2100", "Utang Gaji", "liability", "credit"],
  ["2200", "PPN Keluaran", "liability", "credit"],
  ["2300", "Kredit Pelanggan", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["5010", "Selisih Persediaan", "cogs", "debit"],
  ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
  ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
  ["8000", "Selisih Kas Kurang", "expense", "debit"],
  ["8001", "Selisih Kas Lebih", "revenue", "credit"],
  ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
  ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
];

async function ensureAgingCompany(tx: Tx) {
  const [existing] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, AGING_ORG))
    .limit(1);
  if (existing) return;

  await tx.insert(companySettings).values({ companyId: AGING_ORG, legalName: "Uji Aging Matriks T4" });
  const accountRows = await tx
    .insert(accounts)
    .values(
      ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
        companyId: AGING_ORG,
        code,
        name,
        type,
        normalBalance,
        // AUD-001/A-27: kelas kas/bank eksplisit (validator membacanya);
        // fixture tidak boleh bergantung pada residu ter-backfill.
        cashBankKind:
          code === "1000" ? "cash" : code === "1100" ? "bank" : code === "1110" ? "clearing" : null,
      })),
    )
    .returning();
  const acc = new Map(accountRows.map((a) => [a.code, a.id]));
  const mapping: Record<string, string> = {
    cash: acc.get("1000")!,
    bank: acc.get("1100")!,
    qris: acc.get("1110")!,
    receivable: acc.get("1200")!,
    inventory: acc.get("1300")!,
    payable: acc.get("2000")!,
    revenue: acc.get("4000")!,
    sales_discount: acc.get("4010")!,
    sales_return: acc.get("4020")!,
    cogs: acc.get("5000")!,
    inventory_shrink: acc.get("5010")!,
    damaged: acc.get("5020")!,
    tax_output: acc.get("2200")!,
    rounding_gain: acc.get("9000")!,
    rounding_loss: acc.get("9001")!,
    cash_short: acc.get("8000")!,
    cash_over: acc.get("8001")!,
    salary_expense: acc.get("6000")!,
    salary_payable: acc.get("2100")!,
    bank_fee: acc.get("6060")!,
    equity: acc.get("3000")!,
    customer_credit: acc.get("2300")!,
  };
  await tx.insert(accountMappings).values(
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: AGING_ORG, key, accountId })),
  );
}

// Cermin persis aritmetika bucket di halaman piutang-utang
// (src/app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx `agingBuckets`, fungsi
// komponen yang tidak diekspor): bucket dari TANGGAL DOKUMEN terhadap
// hari ini (basis tengah malam +07:00), nilai yang dijumlah = sisa
// (outstanding) baris. Yang dibuktikan di sini: baris saldo awal dari
// listPayables/listReceivables membawa date + outstanding yang membuat
// aritmetika itu menempatkannya di bucket yang benar.
function bucketIndexOf(date: string): number {
  const today = new Date(`${todayISO()}T00:00:00+07:00`);
  const docDate = new Date(`${String(date).slice(0, 10)}T00:00:00+07:00`);
  const days = Math.max(0, Math.floor((today.getTime() - docDate.getTime()) / 86_400_000));
  return days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
}

function bucketTotals(rows: Array<{ date: string; outstanding: number }>): number[] {
  const totals = [0, 0, 0, 0];
  for (const row of rows) totals[bucketIndexOf(row.date)] += row.outstanding;
  return totals;
}

describe("M-T4-1 aging AR/AP memuat dokumen saldo awal pada bucket yang benar", () => {
  it("dokumen saldo awal AP & AR tampil bertanda opening dan jatuh di keempat bucket sesuai tanggal dokumen", async () => {
    const outcome = await orgTx(AGING_ORG, async (tx) => {
      await ensureAgingCompany(tx);
      const map = await getAccountMap(tx, AGING_ORG);

      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: AGING_ORG, code: `SUP-AGE-${suffix}`, name: `Pemasok Aging ${suffix}` })
        .returning({ id: suppliers.id });
      const [customer] = await tx
        .insert(customers)
        .values({ companyId: AGING_ORG, code: `CST-AGE-${suffix}`, name: `Pelanggan Aging ${suffix}` })
        .returning({ id: customers.id });

      // Satu dokumen per bucket untuk AP maupun AR; nominal khas per
      // bucket agar total bucket bisa dicocokkan persis.
      const apPlan: Array<{ days: number; amount: string }> = [
        { days: 10, amount: "111000" },
        { days: 45, amount: "222000" },
        { days: 75, amount: "333000" },
        { days: 120, amount: "444000" },
      ];
      for (const plan of apPlan) {
        await createOpeningBalance(tx, {
          companyId: AGING_ORG,
          userId: USER_ID,
          kind: "payable",
          partyId: supplier.id,
          date: daysAgo(plan.days),
          amount: plan.amount,
          reference: `AGE-AP-${plan.days}`,
        });
      }
      const arPlan: Array<{ days: number; amount: string }> = [
        { days: 10, amount: "121000" },
        { days: 45, amount: "242000" },
        { days: 75, amount: "363000" },
        { days: 120, amount: "484000" },
      ];
      for (const plan of arPlan) {
        await createOpeningBalance(tx, {
          companyId: AGING_ORG,
          userId: USER_ID,
          kind: "receivable",
          partyId: customer.id,
          date: daysAgo(plan.days),
          amount: plan.amount,
          reference: `AGE-AR-${plan.days}`,
        });
      }

      // Satu dokumen AP terbayar sebagian: aging harus menjumlah SISA
      // (400.000), bukan nominal dokumen (555.000).
      const partial = await createOpeningBalance(tx, {
        companyId: AGING_ORG,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: daysAgo(10),
        amount: "555000",
        reference: "AGE-AP-SEBAGIAN",
      });
      await payOpeningBalance(tx, {
        companyId: AGING_ORG,
        userId: USER_ID,
        openingId: partial.id,
        date: todayISO(),
        amount: "155000",
        accountId: map.cash,
      });

      const payables = await listPayables(tx, AGING_ORG);
      const receivables = await listReceivables(tx, AGING_ORG);
      return { payables, receivables, supplierId: supplier.id, customerId: customer.id };
    });

    const apRows = outcome.payables.filter((row) => row.supplierId === outcome.supplierId);
    const arRows = outcome.receivables.filter((row) => row.customerId === outcome.customerId);

    expect(apRows).toHaveLength(5);
    expect(arRows).toHaveLength(4);
    expect(apRows.every((row) => row.source === "opening")).toBe(true);
    expect(arRows.every((row) => row.source === "opening")).toBe(true);

    const partialRow = apRows.find((row) => row.reference === "AGE-AP-SEBAGIAN");
    expect(partialRow?.outstanding).toBe(400000);
    expect(partialRow?.paymentStatus).toBe("partial");

    // Bucket 0–30 / 31–60 / 61–90 / >90, dijumlah dari sisa dokumen.
    expect(bucketTotals(apRows)).toEqual([511000, 222000, 333000, 444000]);
    expect(bucketTotals(arRows)).toEqual([121000, 242000, 363000, 484000]);
  });
});

/* ------------------------------------------------------------------ */
/* M-T4-2 — rekonsiliasi: jurnal yang sudah dibalik & jurnal balik     */
/* tidak menjadi kandidat auto-match (D-11)                            */
/* ------------------------------------------------------------------ */

describe("M-T4-2 rekonsiliasi bank — jurnal yang sudah dibalik tidak tertaut auto-match", () => {
  it("auto-match melewati jurnal yang sudah dibalik dan baris jurnal baliknya; jurnal live tetap tertaut", async () => {
    await rollbackTransaction(DEMO_ORG, async (tx) => {
      const [bank] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, DEMO_ORG), eq(accounts.code, "11010201")))
        .limit(1);
      const [revenue] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, DEMO_ORG), eq(accounts.code, "400001")))
        .limit(1);
      const today = todayISO();

      // Jurnal yang akan dibalik: nominal khas 8.880.011.
      const doomed = await postJournal(tx, {
        companyId: DEMO_ORG,
        date: today,
        description: `Setoran dibalik uji matriks ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "8880011" },
          { accountId: revenue.id, credit: "8880011" },
        ],
      });
      const { reversal } = await reverseJournalEntry(tx, {
        companyId: DEMO_ORG,
        entryId: doomed.id,
        date: today,
        createdBy: USER_ID,
      });
      const [reversalRow] = await tx
        .select({ reversalOfId: journalEntries.reversalOfId })
        .from(journalEntries)
        .where(eq(journalEntries.id, reversal.id))
        .limit(1);
      expect(reversalRow.reversalOfId).toBe(doomed.id);

      // Kontrol: jurnal live dengan nominal berbeda harus tetap tertaut
      // pada run auto-match yang sama.
      const live = await postJournal(tx, {
        companyId: DEMO_ORG,
        date: today,
        description: `Setoran live uji matriks ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "8880022" },
          { accountId: revenue.id, credit: "8880022" },
        ],
      });
      const [liveBankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, live.id), eq(journalLines.accountId, bank.id)))
        .limit(1);

      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Setoran dibalik uji matriks ${suffix};8.880.011;`,
        `${idDate(today)};Setoran live uji matriks ${suffix};8.880.022;`,
      ].join("\n");
      await importStatement(tx, {
        companyId: DEMO_ORG,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-matriks.csv",
        csvText: csv,
      });

      const outcome = await autoMatch(tx, { companyId: DEMO_ORG, accountId: bank.id });
      expect(outcome.matchedCount).toBe(1);
      expect(outcome.ambiguousCount).toBe(0);
      expect(outcome.unmatchedCount).toBe(1);

      const lines = await tx
        .select({ debit: bankStatementLines.debit, matchedJournalLineId: bankStatementLines.matchedJournalLineId })
        .from(bankStatementLines)
        .where(eq(bankStatementLines.companyId, DEMO_ORG));
      const reversedLine = lines.find((row) => d(row.debit).eq("8880011"));
      const liveLine = lines.find((row) => d(row.debit).eq("8880022"));
      // Baris mutasi sebesar jurnal yang sudah dibalik TIDAK tertaut —
      // bukan ke jurnal asalnya (sudah dibalik) dan bukan ke jurnal
      // baliknya (kredit bank, arah berlawanan & memang dikecualikan).
      expect(reversedLine?.matchedJournalLineId).toBeNull();
      expect(liveLine?.matchedJournalLineId).toBe(liveBankLine.id);
    });
  });
});

/* ------------------------------------------------------------------ */
/* M-T4-6 — T4M-01: matchLine manual menolak baris jurnal yang sudah   */
/* dibalik maupun baris jurnal balik itu sendiri                       */
/* ------------------------------------------------------------------ */

describe("M-T4-6 rekonsiliasi bank — tautan manual menolak jurnal yang sudah dibalik (T4M-01)", () => {
  it("matchLine ke jurnal yang sudah dibalik dan ke jurnal baliknya ditolak VALIDATION", async () => {
    await rollbackTransaction(DEMO_ORG, async (tx) => {
      const [bank] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, DEMO_ORG), eq(accounts.code, "11010201")))
        .limit(1);
      const [revenue] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, DEMO_ORG), eq(accounts.code, "400001")))
        .limit(1);
      const today = todayISO();

      const doomed = await postJournal(tx, {
        companyId: DEMO_ORG,
        date: today,
        description: `Setoran dibalik tautan manual ${suffix}`,
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: bank.id, debit: "7770019" },
          { accountId: revenue.id, credit: "7770019" },
        ],
      });
      const [doomedBankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, doomed.id), eq(journalLines.accountId, bank.id)))
        .limit(1);
      const { reversal } = await reverseJournalEntry(tx, {
        companyId: DEMO_ORG,
        entryId: doomed.id,
        date: today,
        createdBy: USER_ID,
      });
      // Baris kredit bank pada jurnal balik — nominalnya selaras dengan
      // mutasi kredit senilai sama, jadi hanya predikat "live" yang boleh
      // menolaknya (bukan arah/nominal).
      const [reversalBankLine] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, reversal.id), eq(journalLines.accountId, bank.id)))
        .limit(1);

      const csv = [
        "Tanggal;Keterangan;Debit;Kredit",
        `${idDate(today)};Setoran dibalik tautan manual ${suffix};7.770.019;`,
        `${idDate(today)};Koreksi setoran tautan manual ${suffix};;7.770.019`,
      ].join("\n");
      await importStatement(tx, {
        companyId: DEMO_ORG,
        userId: USER_ID,
        accountId: bank.id,
        fileName: "mutasi-tautan-manual.csv",
        csvText: csv,
      });
      const stmtLines = await tx
        .select({ id: bankStatementLines.id, debit: bankStatementLines.debit })
        .from(bankStatementLines)
        .where(eq(bankStatementLines.companyId, DEMO_ORG));
      const debitStmt = stmtLines.find((row) => d(row.debit).eq("7770019"));
      const creditStmt = stmtLines.find((row) => !d(row.debit).eq("7770019"));

      await expect(
        matchLine(tx, { companyId: DEMO_ORG, statementLineId: debitStmt!.id, journalLineId: doomedBankLine.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        matchLine(tx, { companyId: DEMO_ORG, statementLineId: creditStmt!.id, journalLineId: reversalBankLine.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});

/* ------------------------------------------------------------------ */
/* M-T4-3 — impor → ekspor CSV master: round-trip nilai semua field    */
/* ------------------------------------------------------------------ */

const createdJobIds: string[] = [];
const createdSupplierCodes: string[] = [];
const createdCustomerCodes: string[] = [];
const createdAccountCodes: string[] = [];

async function makeImportJob(
  entity: ImportEntity,
  rows: Record<string, string>[],
  mapping: Partial<Record<string, string>>,
): Promise<string> {
  const jobId = await withCompany(DEMO_ORG, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: DEMO_ORG,
        entity,
        fileName: `uji-matriks-${entity}-${suffix}.csv`,
        status: "preview",
        totalRows: rows.length,
        mapping,
        createdBy: USER_ID,
      })
      .returning({ id: importJobs.id });
    await tx.insert(importRows).values(
      rows.map((data, index) => ({
        companyId: DEMO_ORG,
        jobId: job.id,
        rowNumber: index + 1,
        data,
        status: "pending",
      })),
    );
    return job.id;
  });
  createdJobIds.push(jobId);
  return jobId;
}

async function commitImport(
  jobId: string,
  mapping: Partial<Record<string, string>>,
): Promise<{ imported: number; failed: number }> {
  const analysis = await analyzeImportAction({ jobId, mapping });
  expect(analysis.ok).toBe(true);
  let imported = 0;
  let failed = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const result = await commitImportBatchAction({ jobId, mapping, limit: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) break;
    imported += result.data.imported;
    failed += result.data.failed;
    if (result.data.done || result.data.processed === 0) break;
  }
  return { imported, failed };
}

/** Parse CSV ekspor (BOM + \r\n) menjadi sel per baris; data uji bebas
 * koma/kutip sehingga pemisahan koma polos sah di sini. */
function csvCells(csvText: string): string[][] {
  return csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split(","));
}

describe("M-T4-3 impor → ekspor CSV master memuat baris hasil impor dengan nilai field utuh", () => {
  afterAll(async () => {
    await withCompany(DEMO_ORG, async (tx) => {
      if (createdJobIds.length) {
        await tx.delete(importRows).where(inArray(importRows.jobId, createdJobIds));
        await tx.delete(importJobs).where(inArray(importJobs.id, createdJobIds));
      }
      if (createdSupplierCodes.length) {
        await tx
          .delete(suppliers)
          .where(and(eq(suppliers.companyId, DEMO_ORG), inArray(suppliers.code, createdSupplierCodes)));
      }
      if (createdCustomerCodes.length) {
        await tx
          .delete(customers)
          .where(and(eq(customers.companyId, DEMO_ORG), inArray(customers.code, createdCustomerCodes)));
      }
      if (createdAccountCodes.length) {
        await tx
          .delete(accounts)
          .where(and(eq(accounts.companyId, DEMO_ORG), inArray(accounts.code, createdAccountCodes)));
      }
    });
  });

  it("pemasok: baris ekspor memuat kode, nama, telepon, email, alamat, catatan & status persis hasil impor", async () => {
    const code = `SUP-RT-${suffix}`;
    const headers = ["Kode", "Nama", "Telepon", "Email", "Alamat", "Catatan"];
    const mapping = suggestMappingFor(ENTITY_FIELDS.suppliers, headers);
    const jobId = await makeImportJob(
      "suppliers",
      [
        {
          Kode: code,
          Nama: `Pemasok Round Trip ${suffix}`,
          Telepon: "081299988877",
          Email: `rt-${suffix}@uji.id`,
          Alamat: "Jl. Round Trip No. 1",
          Catatan: "catatan round trip pemasok",
        },
      ],
      mapping,
    );
    const result = await commitImport(jobId, mapping);
    expect(result).toEqual({ imported: 1, failed: 0 });
    createdSupplierCodes.push(code);

    const response = await exportSuppliersRoute();
    expect(response.status).toBe(200);
    const rows = csvCells(await response.text());
    const row = rows.find((cells) => cells[0] === code);
    expect(row).toEqual([
      code,
      `Pemasok Round Trip ${suffix}`,
      "081299988877",
      `rt-${suffix}@uji.id`,
      "Jl. Round Trip No. 1",
      "catatan round trip pemasok",
      // S3 (§18D): kolom NPWP/bank/termin ikut diekspor (kosong di sini).
      "",
      "",
      "",
      "",
      "",
      "Aktif",
    ]);
  });

  it("pelanggan: baris ekspor memuat semua field; batas kredit id-ID 1.500.000 keluar sebagai 1500000.00", async () => {
    const code = `CST-RT-${suffix}`;
    const headers = ["Kode", "Nama", "Telepon", "Email", "Alamat", "Kelompok Harga", "Batas Kredit", "Catatan"];
    const mapping = suggestMappingFor(ENTITY_FIELDS.customers, headers);
    const jobId = await makeImportJob(
      "customers",
      [
        {
          Kode: code,
          Nama: `Pelanggan Round Trip ${suffix}`,
          Telepon: "081311122233",
          Email: `rtc-${suffix}@uji.id`,
          Alamat: "Jl. Round Trip No. 2",
          "Kelompok Harga": "",
          "Batas Kredit": "1.500.000",
          Catatan: "catatan round trip pelanggan",
        },
      ],
      mapping,
    );
    const result = await commitImport(jobId, mapping);
    expect(result).toEqual({ imported: 1, failed: 0 });
    createdCustomerCodes.push(code);

    const response = await exportCustomersRoute();
    expect(response.status).toBe(200);
    const rows = csvCells(await response.text());
    const row = rows.find((cells) => cells[0] === code);
    expect(row).toEqual([
      code,
      `Pelanggan Round Trip ${suffix}`,
      "081311122233",
      `rtc-${suffix}@uji.id`,
      "Jl. Round Trip No. 2",
      "",
      "1500000.00",
      "catatan round trip pelanggan",
      // S3 (§18D): kolom NPWP/termin ikut diekspor (kosong di sini).
      "",
      "",
      "Aktif",
    ]);
  });

  it("akun: baris ekspor memuat kode, nama, tipe, saldo normal & bagian persis hasil impor", async () => {
    const code = `77${(suffix.charCodeAt(0) % 9) + 1}${suffix.charCodeAt(1) % 10}`;
    const headers = ["Kode", "Nama", "Tipe", "Saldo Normal", "Bagian", "Keterangan"];
    const mapping = suggestMappingFor(ENTITY_FIELDS.accounts, headers);
    const jobId = await makeImportJob(
      "accounts",
      [
        {
          Kode: code,
          Nama: `Beban Round Trip ${suffix}`,
          Tipe: "expense",
          "Saldo Normal": "debit",
          Bagian: "operating_expense",
          Keterangan: "keterangan round trip akun",
        },
      ],
      mapping,
    );
    const result = await commitImport(jobId, mapping);
    expect(result).toEqual({ imported: 1, failed: 0 });
    createdAccountCodes.push(code);

    const response = await exportAccountsRoute();
    expect(response.status).toBe(200);
    const rows = csvCells(await response.text());
    const row = rows.find((cells) => cells[0] === code);
    expect(row).toBeDefined();
    expect(row!.slice(0, 5)).toEqual([code, `Beban Round Trip ${suffix}`, "expense", "debit", "operating_expense"]);
    expect(row![7]).toBe("Aktif");
  });
});

/* ------------------------------------------------------------------ */
/* M-T4-4 — halaman cetak GRN & PO memakai pengaturan cetak (D-13)     */
/* ------------------------------------------------------------------ */

const PRINT_RECEIPT_NUMBER = "RCV-MTX4-001";
const PRINT_PO_NUMBER = "PO-MTX4-001";
const PRINT_LEGAL_NAME = "PT Uji Cetak Matriks";
const PRINT_PRODUCT_NAME = "Produk Cetak Matriks";

async function seedPrintFixture() {
  return withCompany(PRINT_ORG, async (tx) => {
    await tx
      .insert(companySettings)
      .values({
        companyId: PRINT_ORG,
        legalName: PRINT_LEGAL_NAME,
        address: "Jl. Cetak Matriks No. 4",
        phone: "0800-444",
        printTemplate: "classic",
        printDocumentPaper: "a5",
        printShowQr: true,
        printShowSignature: true,
        printHeaderText: "Kop Uji Matriks",
        printFooterText: "Kaki Uji Matriks",
      })
      .onConflictDoUpdate({
        target: companySettings.companyId,
        set: {
          legalName: PRINT_LEGAL_NAME,
          address: "Jl. Cetak Matriks No. 4",
          phone: "0800-444",
          printTemplate: "classic",
          printDocumentPaper: "a5",
          printShowQr: true,
          printShowSignature: true,
          printHeaderText: "Kop Uji Matriks",
          printFooterText: "Kaki Uji Matriks",
        },
      });

    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: PRINT_ORG, code: "GD-CETAK", name: "Gudang Cetak Matriks", type: "warehouse", isDefault: true })
      .onConflictDoNothing()
      .returning({ id: warehouses.id });
    const warehouseRow =
      warehouse ??
      (await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, PRINT_ORG), eq(warehouses.code, "GD-CETAK")))
        .limit(1))[0];

    const [supplierRow] = await tx
      .insert(suppliers)
      .values({ companyId: PRINT_ORG, code: "SUP-CETAK", name: "Pemasok Cetak Matriks" })
      .onConflictDoNothing()
      .returning({ id: suppliers.id });
    const supplier =
      supplierRow ??
      (await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.companyId, PRINT_ORG), eq(suppliers.code, "SUP-CETAK")))
        .limit(1))[0];

    const [productRow] = await tx
      .insert(products)
      .values({ companyId: PRINT_ORG, sku: "SKU-CETAK-1", name: PRINT_PRODUCT_NAME })
      .onConflictDoNothing()
      .returning({ id: products.id });
    const product =
      productRow ??
      (await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.companyId, PRINT_ORG), eq(products.sku, "SKU-CETAK-1")))
        .limit(1))[0];

    // Dokumen uji ditulis ulang bersih setiap run (baris ikut cascade).
    await tx
      .delete(stockReceipts)
      .where(and(eq(stockReceipts.companyId, PRINT_ORG), eq(stockReceipts.number, PRINT_RECEIPT_NUMBER)));
    const [receipt] = await tx
      .insert(stockReceipts)
      .values({
        companyId: PRINT_ORG,
        warehouseId: warehouseRow.id,
        supplierId: supplier.id,
        source: "purchase",
        number: PRINT_RECEIPT_NUMBER,
        date: todayISO(),
        status: "posted",
        total: "250000",
        paymentStatus: "unpaid",
      })
      .returning({ id: stockReceipts.id });
    await tx.insert(stockReceiptLines).values({
      companyId: PRINT_ORG,
      receiptId: receipt.id,
      productId: product.id,
      qty: "10",
      unitCost: "25000",
      lineTotal: "250000",
      // S2: baris satuan dasar — qtyInput adalah qty dasarnya sendiri.
      qtyInput: "10",
    });

    await tx
      .delete(purchaseOrders)
      .where(and(eq(purchaseOrders.companyId, PRINT_ORG), eq(purchaseOrders.number, PRINT_PO_NUMBER)));
    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        companyId: PRINT_ORG,
        supplierId: supplier.id,
        number: PRINT_PO_NUMBER,
        date: todayISO(),
        status: "sent",
        total: "175000",
      })
      .returning({ id: purchaseOrders.id });
    await tx.insert(purchaseOrderLines).values({
      companyId: PRINT_ORG,
      orderId: order.id,
      productId: product.id,
      qty: "7",
      unitCost: "25000",
      lineTotal: "175000",
      // S2: baris satuan dasar — qtyInput adalah qty dasarnya sendiri.
      qtyInput: "7",
    });

    return { receiptId: receipt.id, orderId: order.id };
  });
}

async function setPrintSettings(patch: {
  printTemplate: string;
  printDocumentPaper: string;
  printShowQr: boolean;
  printShowSignature: boolean;
}) {
  await withCompany(PRINT_ORG, async (tx) => {
    await tx.update(companySettings).set(patch).where(eq(companySettings.companyId, PRINT_ORG));
  });
}

describe("M-T4-4 halaman cetak GRN/PO memakai pengaturan cetak perusahaan", () => {
  let receiptId = "";
  let orderId = "";

  beforeAll(async () => {
    const ids = await seedPrintFixture();
    receiptId = ids.receiptId;
    orderId = ids.orderId;
    hoisted.companyId = PRINT_ORG;
  });

  afterAll(() => {
    hoisted.companyId = DEMO_ORG;
  });

  it("GRN: template klasik + kertas A5 + kop di kepala + QR + tanda tangan tercermin di render halaman asli", async () => {
    const element = await GoodsReceiptPrintPage({
      params: Promise.resolve({ id: receiptId }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(element);

    expect(html).toContain("print-doc--classic");
    expect(html).toContain("size: A5 portrait");
    // SET-RCPT-01: kop (identitas + teks kop perusahaan) mendahului isi.
    expect(html).toContain("Kop Uji Matriks");
    expect(html.indexOf(PRINT_LEGAL_NAME)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(PRINT_LEGAL_NAME)).toBeLessThan(html.indexOf(PRINT_PRODUCT_NAME));
    expect(html).toContain(PRINT_RECEIPT_NUMBER);
    expect(html).toContain(formatIDR("250000"));
    // QR nomor dokumen & blok tanda tangan aktif sesuai pengaturan
    // (label tanda tangan GRN: Diserahkan/Diterima/Mengetahui).
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("Diserahkan oleh");
    expect(html).toContain("Diterima oleh");
    expect(html).toContain("Kaki Uji Matriks");
  });

  it("GRN: mengganti pengaturan ke minimal/A4 tanpa QR & tanda tangan mengubah render (bukan hardcode)", async () => {
    await setPrintSettings({
      printTemplate: "minimal",
      printDocumentPaper: "a4",
      printShowQr: false,
      printShowSignature: false,
    });
    try {
      const element = await GoodsReceiptPrintPage({
        params: Promise.resolve({ id: receiptId }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToString(element);
      expect(html).toContain("print-doc--minimal");
      expect(html).toContain("size: A4 portrait");
      expect(html).not.toContain("data:image/png");
      expect(html).not.toContain("Diserahkan oleh");
      // Angka dokumen tidak berubah oleh pergantian template/kertas.
      expect(html).toContain(PRINT_RECEIPT_NUMBER);
      expect(html).toContain(formatIDR("250000"));
    } finally {
      await setPrintSettings({
        printTemplate: "classic",
        printDocumentPaper: "a5",
        printShowQr: true,
        printShowSignature: true,
      });
    }
  });

  it("PO: render halaman asli memakai template & kertas dokumen yang sama dari pengaturan", async () => {
    const element = await PurchaseOrderPrintPage({
      params: Promise.resolve({ id: orderId }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToString(element);

    expect(html).toContain("print-doc--classic");
    expect(html).toContain("size: A5 portrait");
    expect(html.indexOf(PRINT_LEGAL_NAME)).toBeLessThan(html.indexOf(PRINT_PRODUCT_NAME));
    expect(html).toContain(PRINT_PO_NUMBER);
    expect(html).toContain("Pemasok Cetak Matriks");
    expect(html).toContain(formatIDR("175000"));
    expect(html).toContain("data:image/png;base64,");
  });
});

/* ------------------------------------------------------------------ */
/* M-T4-5 — requireAuth asli: cookie perusahaan asing tidak menggeser */
/* konteks tenant (LINTAS-01, melengkapi company-switch.test.ts yang  */
/* menguji action-nya; di sini resolusi sesi + konteks withCompany)    */
/* ------------------------------------------------------------------ */

const realSession = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");

describe("M-T4-5 requireAuth: resolusi perusahaan dari cookie tervalidasi membership", () => {
  beforeAll(async () => {
    await db
      .insert(organization)
      .values({ id: SECOND_ORG, name: "Perusahaan Kedua Matriks", slug: `kedua-matriks-${suffix}` })
      .onConflictDoNothing();
    await db
      .insert(member)
      .values({ id: crypto.randomUUID(), organizationId: SECOND_ORG, userId: USER_ID, role: "admin" })
      .onConflictDoNothing();
    // company_settings ber-RLS: tulis lewat konteks tenant perusahaan itu.
    await withCompany(SECOND_ORG, async (tx) => {
      await tx
        .insert(companySettings)
        .values({ companyId: SECOND_ORG, legalName: "PT Kedua Matriks Uji" })
        .onConflictDoNothing();
    });
  });

  afterAll(async () => {
    hoisted.cookieJar.clear();
    // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
    // (semua tabel ber-company_id dienumerasi dinamis — bukan daftar
    // tulis tangan parsial; lihat tests/helpers/wipe-company.ts).
    await wipeCompanyFixture(adminSql, SECOND_ORG);
  });

  it("cookie berisi id perusahaan ASING (bukan membership) → konteks tetap perusahaan terawal pengguna", async () => {
    hoisted.cookieJar.set(COMPANY_COOKIE_NAME, "01900000-0000-7000-8000-00000000ffff");
    const ctx = await realSession.requireAuth();
    expect(ctx.company.id).toBe(DEMO_ORG);
    expect(ctx.role).toBe("owner");
    expect(ctx.companies.map((row) => row.id)).toContain(SECOND_ORG);
  });

  it("cookie berisi perusahaan kedua yang SAH → konteks berpindah dan data tenant mengikuti konteks itu", async () => {
    hoisted.cookieJar.set(COMPANY_COOKIE_NAME, SECOND_ORG);
    const ctx = await realSession.requireAuth();
    expect(ctx.company.id).toBe(SECOND_ORG);
    expect(ctx.role).toBe("admin");

    const legalName = await withCompanyReadOnly(ctx.company.id, async (tx) => {
      const [row] = await tx
        .select({ legalName: companySettings.legalName })
        .from(companySettings)
        .where(eq(companySettings.companyId, ctx.company.id))
        .limit(1);
      return row?.legalName;
    });
    expect(legalName).toBe("PT Kedua Matriks Uji");
  });

  it("tanpa cookie → perusahaan terawal (demo) yang dipakai", async () => {
    hoisted.cookieJar.delete(COMPANY_COOKIE_NAME);
    const ctx = await realSession.requireAuth();
    expect(ctx.company.id).toBe(DEMO_ORG);
  });
});
