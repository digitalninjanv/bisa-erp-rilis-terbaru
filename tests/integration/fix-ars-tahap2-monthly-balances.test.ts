import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  accountMappings,
  accountMonthlyBalances,
  accounts,
  member,
  organization,
  user,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import type { Tx } from "@/db";
import { d, Decimal } from "@/lib/money";
import { resolveSection } from "@/lib/accounting";
import { ensureFiscalPeriods, postJournal } from "@/server/accounting";
import {
  getAccountingSummary,
  getBalanceSheet,
  getIncomeStatement,
  getLedger,
  getTrialBalance,
  mappedBalance,
} from "@/server/reports";
import { wipeCompanyFixture, wipeCompanyRows } from "../helpers/wipe-company";

/**
 * FIX-ARS Tahap 2 (ARS3-01 / R-4) — Ringkasan saldo bulanan per akun.
 *
 * Kontrak yang dibuktikan berkas ini:
 *  1. postJournal memelihara account_monthly_balances dalam transaksi
 *     yang sama (upsert per company/akun/bulan tanggal jurnal), termasuk
 *     jurnal pembalik dan jurnal backdated ke bulan lampau; replay
 *     idempoten tidak menggandakan ringkasan.
 *  2. SQL backfill migrasi 0046 (disalin persis di berkas ini) mengisi
 *     ringkasan dari jurnal lama yang ditulis langsung (bypass
 *     postJournal) sehingga ringkasan == agregat mentah.
 *  3. Fungsi laporan inti (mappedBalance, neraca saldo, laba rugi,
 *     neraca, buku besar, ringkasan akuntansi) yang membaca hibrida
 *     (ringkasan bulan penuh + agregat mentah bulan parsial) memberi
 *     hasil IDENTIK dengan agregat mentah independen untuk serangkaian
 *     tanggal/rentang: as-of pertengahan bulan, rentang lintas tahun,
 *     saldo awal periode, pembanding, akun tanpa gerakan.
 *
 * Perusahaan fixture khusus berkas ini (f901), dibersihkan total —
 * perusahaan demo tidak disentuh.
 */

const ORG = "01900000-0000-7000-8000-00000000f901";
const OWNER = "01900000-0000-7000-8000-00000000f940";


const F = {
  cash: "",
  bank: "",
  receivable: "",
  inventory: "",
  payable: "",
  equity: "",
  revenue: "",
  discount: "",
  cogs: "",
  salary: "",
  otherExpense: "",
};

async function wipeFixtureRows() {
  // AUD-001: reset sebagian lewat helper bersama — hanya baris
  // transaksional jurnal (+ ringkasan bulanan); akun & pemetaan master
  // persisten antar-blok by design (semantik wipeFixtureRows lama).
  await wipeCompanyRows(adminSql, ORG, {
    onlyTables: [
      "audit_log",
      "document_sequences",
      "fiscal_periods",
      "journal_entries",
      "journal_lines",
      "account_monthly_balances",
    ],
  });
}

async function wipeFixtureAll() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

beforeAll(async () => {
  await wipeFixtureAll();
  await adminDb.insert(user).values({
    id: OWNER,
    name: "Pemilik Uji ARS2",
    email: "owner@ars2.id",
    emailVerified: true,
    role: "owner",
  });
  await adminDb.insert(organization).values({
    id: ORG,
    name: "Ars2",
    slug: "ars2",
    createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: ORG,
    userId: OWNER,
    role: "owner",
    createdAt: new Date(),
  });
  const accRows = await adminDb
    .insert(accounts)
    .values([
      // A-28 Tahap 3 (H-AKT-02): akun kas/bank fixture berkelas
      // cash/bank — ringkasan akuntansi kini membaca himpunan KELAS
      // (bukan pemetaan), dan kedua akun ini memang kas & bank
      // perusahaan fixture; ekspektasi test tidak berubah.
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", section: "current_asset", cashBankKind: "cash" },
      { companyId: ORG, code: "1010", name: "Bank", type: "asset", normalBalance: "debit", section: "current_asset", cashBankKind: "bank" },
      { companyId: ORG, code: "1100", name: "Piutang Usaha", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit", section: "current_liability" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit", section: "equity" },
      { companyId: ORG, code: "4000", name: "Pendapatan Penjualan", type: "revenue", normalBalance: "credit", section: "revenue" },
      { companyId: ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit", section: "revenue" },
      { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit", section: "cogs" },
      { companyId: ORG, code: "6000", name: "Beban Gaji", type: "expense", normalBalance: "debit", section: "operating_expense" },
      { companyId: ORG, code: "6100", name: "Beban Lain-lain", type: "expense", normalBalance: "debit", section: "other_expense" },
    ])
    .returning();
  const byCode = Object.fromEntries(accRows.map((row) => [row.code, row.id]));
  F.cash = byCode["1000"];
  F.bank = byCode["1010"];
  F.receivable = byCode["1100"];
  F.inventory = byCode["1300"];
  F.payable = byCode["2000"];
  F.equity = byCode["3000"];
  F.revenue = byCode["4000"];
  F.discount = byCode["4010"];
  F.cogs = byCode["5000"];
  F.salary = byCode["6000"];
  F.otherExpense = byCode["6100"];
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: F.cash },
    { companyId: ORG, key: "bank", accountId: F.bank },
    { companyId: ORG, key: "receivable", accountId: F.receivable },
    { companyId: ORG, key: "payable", accountId: F.payable },
    { companyId: ORG, key: "inventory", accountId: F.inventory },
  ]);
  // Periode fiskal untuk semua tahun yang dipakai jurnal fixture.
  await withCompany(ORG, async (tx) => {
    for (const year of [2023, 2024, 2025, 2026, 2027]) {
      await ensureFiscalPeriods(tx, ORG, year);
    }
  });
});

afterAll(async () => {
  await wipeFixtureAll();
});

beforeEach(async () => {
  await wipeFixtureRows();
  // wipeFixtureRows menghapus fiscal_periods juga — materialisasi ulang.
  await withCompany(ORG, async (tx) => {
    for (const year of [2023, 2024, 2025, 2026, 2027]) {
      await ensureFiscalPeriods(tx, ORG, year);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Helper: posting & agregat mentah independen                         */
/* ------------------------------------------------------------------ */

type Line = { accountId: string; debit?: number; credit?: number };

async function post(date: string, lines: Line[], extra?: { reversalOfId?: string; idempotencyKey?: string }) {
  return withCompany(ORG, (tx) =>
    postJournal(tx, {
      companyId: ORG,
      date,
      description: `Uji ARS tahap 2 @ ${date}`,
      sourceType: "manual",
      createdBy: OWNER,
      reversalOfId: extra?.reversalOfId ?? null,
      idempotencyKey: extra?.idempotencyKey ?? null,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
      })),
    }),
  );
}

/** Agregat mentah independen (SQL polos, hanya jurnal posted). */
async function rawTotals(
  tx: Tx,
  opts?: { from?: string; to?: string },
): Promise<Map<string, { debit: Decimal; credit: Decimal }>> {
  const rows = await tx.execute(sql`
    select jl.account_id as "accountId",
           coalesce(sum(jl.debit), 0) as "debit",
           coalesce(sum(jl.credit), 0) as "credit"
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    where jl.company_id = ${ORG}
      and je.status = 'posted'
      ${opts?.from ? sql`and je.date >= ${opts.from}` : sql``}
      ${opts?.to ? sql`and je.date <= ${opts.to}` : sql``}
    group by jl.account_id
  `);
  const map = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const row of rows as unknown as { accountId: string; debit: string; credit: string }[]) {
    map.set(row.accountId, { debit: d(row.debit), credit: d(row.credit) });
  }
  return map;
}

function prevDay(date: string): string {
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

const zero = () => ({ debit: d(0), credit: d(0) });
const get = (map: Map<string, { debit: Decimal; credit: Decimal }>, id: string) =>
  map.get(id) ?? zero();

/** Linimasa jurnal baku untuk uji kesetaraan laporan. */
async function postTimeline() {
  await post("2024-03-10", [
    { accountId: F.cash, debit: 10_000_000 },
    { accountId: F.equity, credit: 10_000_000 },
  ]);
  await post("2024-03-20", [
    { accountId: F.inventory, debit: 4_000_000 },
    { accountId: F.cash, credit: 4_000_000 },
  ]);
  const sale = await post("2024-11-05", [
    { accountId: F.receivable, debit: 2_500_000 },
    { accountId: F.revenue, credit: 2_500_000 },
  ]);
  await post("2025-01-15", [
    { accountId: F.cash, debit: 2_500_000 },
    { accountId: F.receivable, credit: 2_500_000 },
  ]);
  await post("2025-01-31", [
    { accountId: F.discount, debit: 100_000 },
    { accountId: F.receivable, credit: 100_000 },
  ]);
  await post("2025-06-15", [
    { accountId: F.cogs, debit: 1_200_000 },
    { accountId: F.inventory, credit: 1_200_000 },
  ]);
  await post("2025-06-15", [
    { accountId: F.salary, debit: 800_000 },
    { accountId: F.cash, credit: 800_000 },
  ]);
  // Jurnal pembalik penjualan 2024-11-05, bertanggal bulan lain.
  await post(
    "2025-06-20",
    [
      { accountId: F.revenue, debit: 2_500_000 },
      { accountId: F.receivable, credit: 2_500_000 },
    ],
    { reversalOfId: sale.id },
  );
  return sale;
}

/* ------------------------------------------------------------------ */
/* 1. Pemeliharaan ringkasan oleh postJournal                          */
/* ------------------------------------------------------------------ */

describe("ARS3-01 — postJournal memelihara account_monthly_balances", () => {
  it("ringkasan == agregat mentah per (akun, bulan), termasuk jurnal balik & backdated", async () => {
    await postTimeline();
    // Backdated: diposting SEKARANG, bertanggal bulan lampau yang sudah
    // pernah dibaca — ringkasan bulan itu wajib ikut berubah.
    await post("2024-03-25", [
      { accountId: F.cash, debit: 500_000 },
      { accountId: F.revenue, credit: 500_000 },
    ]);

    await withCompanyReadOnly(ORG, async (tx) => {
      const summaryRows = await tx
        .select()
        .from(accountMonthlyBalances)
        .where(eq(accountMonthlyBalances.companyId, ORG));
      const rawRows = await tx.execute(sql`
        select jl.account_id as "accountId",
               to_char(je.date, 'YYYY-MM') as "yearMonth",
               coalesce(sum(jl.debit), 0) as "debit",
               coalesce(sum(jl.credit), 0) as "credit"
        from journal_lines jl
        join journal_entries je on je.id = jl.entry_id
        where jl.company_id = ${ORG} and je.status = 'posted'
        group by jl.account_id, to_char(je.date, 'YYYY-MM')
      `);
      const key = (accountId: string, yearMonth: string) => `${accountId}|${yearMonth}`;
      const fromSummary = new Map(
        summaryRows.map((row) => [
          key(row.accountId, row.yearMonth),
          { debit: d(row.totalDebit), credit: d(row.totalCredit) },
        ]),
      );
      const fromRaw = new Map(
        (rawRows as unknown as { accountId: string; yearMonth: string; debit: string; credit: string }[]).map(
          (row) => [key(row.accountId, row.yearMonth), { debit: d(row.debit), credit: d(row.credit) }],
        ),
      );
      expect(fromSummary.size).toBe(fromRaw.size);
      for (const [k, raw] of fromRaw) {
        const sum = fromSummary.get(k);
        expect(sum, `ringkasan hilang untuk ${k}`).toBeDefined();
        expect(sum!.debit.equals(raw.debit), `debit ${k}`).toBe(true);
        expect(sum!.credit.equals(raw.credit), `kredit ${k}`).toBe(true);
      }
      // Baris eksplisit: bulan jurnal balik membawa sisi terbaliknya.
      const reversalMonth = fromSummary.get(key(F.revenue, "2025-06"));
      expect(reversalMonth?.debit.toNumber()).toBe(2_500_000);
      // Baris eksplisit: backdated masuk bulan tanggal jurnalnya.
      const backdated = fromSummary.get(key(F.cash, "2024-03"));
      expect(backdated?.debit.toNumber()).toBe(10_500_000);
      expect(backdated?.credit.toNumber()).toBe(4_000_000);
    });
  });

  it("replay idempoten tidak menggandakan ringkasan", async () => {
    const input: Line[] = [
      { accountId: F.cash, debit: 750_000 },
      { accountId: F.equity, credit: 750_000 },
    ];
    await post("2025-02-10", input, { idempotencyKey: "ars2-replay-1" });
    await post("2025-02-10", input, { idempotencyKey: "ars2-replay-1" });
    await withCompanyReadOnly(ORG, async (tx) => {
      const [row] = await tx
        .select()
        .from(accountMonthlyBalances)
        .where(
          and(
            eq(accountMonthlyBalances.companyId, ORG),
            eq(accountMonthlyBalances.accountId, F.cash),
            eq(accountMonthlyBalances.yearMonth, "2025-02"),
          ),
        );
      expect(row).toBeDefined();
      expect(d(row.totalDebit).toNumber()).toBe(750_000);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 2. Backfill migrasi atas data lama (bypass postJournal)             */
/* ------------------------------------------------------------------ */

describe("ARS3-01 — backfill migrasi 0046 atas jurnal lama", () => {
  it("SQL backfill membuat ringkasan identik dengan agregat mentah", async () => {
    // Tulis jurnal posted LANGSUNG (meniru data pra-migrasi / seed):
    // tanpa satu pun baris ringkasan.
    await adminSql.begin(async (tx) => {
      await tx.unsafe("SET session_replication_role = replica");
      const entries: [string, string][] = [
        ["ARS2-OLD-0001", "2023-12-15"],
        ["ARS2-OLD-0002", "2024-01-05"],
        ["ARS2-OLD-0003", "2024-01-20"],
      ];
      for (const [number, date] of entries) {
        const [entry] = await tx`
          insert into journal_entries (company_id, number, date, description, source_type, status, created_by)
          values (${ORG}, ${number}, ${date}, 'Jurnal lama uji backfill', 'manual', 'posted', ${OWNER})
          returning id
        `;
        await tx`
          insert into journal_lines (company_id, entry_id, account_id, debit, credit, description, line_no)
          values (${ORG}, ${entry.id}, ${F.cash}, 1000000, 0, 'Kas', 1),
                 (${ORG}, ${entry.id}, ${F.equity}, 0, 1000000, 'Modal', 2)
        `;
      }
      // Satu jurnal DRAFT — tidak boleh masuk ringkasan.
      const [draft] = await tx`
        insert into journal_entries (company_id, number, date, description, source_type, status, created_by)
        values (${ORG}, 'ARS2-OLD-DRAFT', '2024-01-07', 'Draf lama', 'manual', 'draft', ${OWNER})
        returning id
      `;
      await tx`
        insert into journal_lines (company_id, entry_id, account_id, debit, credit, description, line_no)
        values (${ORG}, ${draft.id}, ${F.cash}, 999000, 0, 'Kas', 1),
               (${ORG}, ${draft.id}, ${F.equity}, 0, 999000, 'Modal', 2)
      `;
      // Statement backfill PERSIS seperti di migrasi 0046.
      await tx.unsafe(`
        INSERT INTO "account_monthly_balances" ("company_id", "account_id", "year_month", "total_debit", "total_credit")
        SELECT jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM'), sum(jl."debit"), sum(jl."credit")
        FROM "journal_lines" jl
        INNER JOIN "journal_entries" je ON je."id" = jl."entry_id"
        WHERE je."status" = 'posted'
        GROUP BY jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM')
        ON CONFLICT ("company_id", "account_id", "year_month") DO UPDATE SET
          "total_debit" = EXCLUDED."total_debit",
          "total_credit" = EXCLUDED."total_credit"
      `);
    });

    await withCompanyReadOnly(ORG, async (tx) => {
      const rows = await tx
        .select()
        .from(accountMonthlyBalances)
        .where(eq(accountMonthlyBalances.companyId, ORG));
      const byKey = new Map(rows.map((row) => [`${row.accountId}|${row.yearMonth}`, row]));
      // 2023-12: satu jurnal; 2024-01: dua jurnal posted (draf terabaikan).
      expect(d(byKey.get(`${F.cash}|2023-12`)!.totalDebit).toNumber()).toBe(1_000_000);
      expect(d(byKey.get(`${F.cash}|2024-01`)!.totalDebit).toNumber()).toBe(2_000_000);
      expect(d(byKey.get(`${F.equity}|2024-01`)!.totalCredit).toNumber()).toBe(2_000_000);
      expect(rows).toHaveLength(4);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. Kesetaraan laporan hibrida vs agregat mentah                     */
/* ------------------------------------------------------------------ */

const AS_OFS = [
  "2024-03-09", // sebelum jurnal pertama
  "2024-03-15", // pertengahan bulan, sesudah jurnal pertama
  "2024-03-31", // akhir bulan
  "2024-12-31",
  "2025-01-20", // pertengahan bulan berjalan
  "2025-06-18", // di antara jurnal dan jurnal baliknya
  "2025-06-30",
  "2025-12-31",
  "2100-12-31",
];

const RANGES = [
  { from: "2024-01-01", to: "2024-12-31" },
  { from: "2025-01-01", to: "2025-12-31" },
  { from: "2024-03-01", to: "2024-03-31" }, // satu bulan penuh persis
  { from: "2024-03-15", to: "2025-02-10" }, // lintas tahun, tepi parsial
  { from: "2025-06-01", to: "2025-06-30" },
  { from: "1900-01-01", to: "2100-12-31" }, // rentang lebar ala WIDE
];

describe("ARS3-01 — kesetaraan laporan hibrida vs agregat mentah", () => {
  beforeEach(async () => {
    await postTimeline();
  });

  it("mappedBalance identik untuk semua kunci & tanggal", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      const meta = await tx
        .select({ id: accounts.id, type: accounts.type })
        .from(accounts)
        .where(eq(accounts.companyId, ORG));
      const typeOf = new Map(meta.map((row) => [row.id, row.type]));
      const mappingRows = await tx
        .select({ key: accountMappings.key, accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(eq(accountMappings.companyId, ORG));
      const keySets: string[][] = [["cash"], ["cash", "bank", "qris"], ["receivable"], ["payable"], ["inventory"]];
      for (const to of [...AS_OFS, undefined]) {
        const raw = await rawTotals(tx, to ? { to } : undefined);
        for (const keys of keySets) {
          let expected = d(0);
          for (const mapping of mappingRows) {
            if (!keys.includes(mapping.key)) continue;
            const totals = get(raw, mapping.accountId);
            const sign =
              typeOf.get(mapping.accountId) === "asset" ||
              typeOf.get(mapping.accountId) === "expense" ||
              typeOf.get(mapping.accountId) === "cogs"
                ? 1
                : -1;
            expected = expected.plus(totals.debit.minus(totals.credit).mul(sign));
          }
          const actual = await mappedBalance(tx, ORG, keys, to ? { to } : undefined);
          expect(actual, `mappedBalance ${keys.join("+")} s.d. ${to ?? "∞"}`).toBe(expected.toNumber());
        }
      }
    });
  });

  it("neraca saldo identik untuk semua rentang", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      const meta = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, ORG))
        .orderBy(accounts.code);
      for (const range of RANGES) {
        const before = await rawTotals(tx, { to: prevDay(range.from) });
        const through = await rawTotals(tx, { to: range.to });
        const actual = await getTrialBalance(tx, ORG, range);
        expect(actual).toHaveLength(meta.length);
        for (const account of meta) {
          const row = actual.find((r) => r.accountId === account.id)!;
          const b = get(before, account.id);
          const t = get(through, account.id);
          const sign = account.normalBalance === "debit" ? 1 : -1;
          const label = `${account.code} ${range.from}..${range.to}`;
          expect(row.opening, `opening ${label}`).toBe(b.debit.minus(b.credit).mul(sign).toNumber());
          expect(row.debit, `debit ${label}`).toBe(t.debit.minus(b.debit).toNumber());
          expect(row.credit, `credit ${label}`).toBe(t.credit.minus(b.credit).toNumber());
          expect(row.closing, `closing ${label}`).toBe(t.debit.minus(t.credit).mul(sign).toNumber());
        }
      }
    });
  });

  it("laba rugi identik untuk semua rentang (termasuk akun tanpa gerakan)", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      const meta = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, ORG));
      const pl = meta.filter(
        (a) => a.isPostable && ["revenue", "cogs", "expense"].includes(a.type),
      );
      for (const range of RANGES) {
        const raw = await rawTotals(tx, { from: range.from, to: range.to });
        const actual = await getIncomeStatement(tx, ORG, range);
        const allLines = [
          ...actual.revenue,
          ...actual.otherIncome,
          ...actual.cogs,
          ...actual.operatingExpense,
          ...actual.otherExpense,
        ];
        // Alam semesta akun sama: akun P&L postable selalu tampil.
        expect(allLines).toHaveLength(pl.length);
        let expectedNet = d(0);
        for (const account of pl) {
          const totals = get(raw, account.id);
          const section = resolveSection(account);
          const amount =
            section === "revenue" || section === "other_income"
              ? totals.credit.minus(totals.debit)
              : totals.debit.minus(totals.credit);
          const line = allLines.find((l) => l.accountId === account.id)!;
          expect(line.amount, `${account.code} ${range.from}..${range.to}`).toBe(amount.toNumber());
          expectedNet = expectedNet.plus(
            section === "revenue" || section === "other_income" ? amount : amount.neg(),
          );
        }
        expect(actual.netProfit, `netProfit ${range.from}..${range.to}`).toBe(expectedNet.toNumber());
      }
    });
  });

  it("neraca identik & seimbang untuk semua tanggal as-of", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      const meta = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, ORG));
      const bsAccounts = meta.filter((a) => ["asset", "liability", "equity"].includes(a.type));
      const plAccounts = meta.filter(
        (a) => a.isPostable && ["revenue", "cogs", "expense"].includes(a.type),
      );
      for (const asOf of AS_OFS) {
        const raw = await rawTotals(tx, { to: asOf });
        const actual = await getBalanceSheet(tx, ORG, asOf);
        const lines = [...actual.assets, ...actual.liabilities, ...actual.equity];
        let totalAssets = d(0);
        let totalLiabilities = d(0);
        let totalEquity = d(0);
        for (const account of bsAccounts) {
          const totals = get(raw, account.id);
          const hasMovement = !totals.debit.isZero() || !totals.credit.isZero();
          const line = lines.find((l) => l.accountId === account.id);
          if (!hasMovement) {
            expect(line, `${account.code} tanpa gerakan @${asOf}`).toBeUndefined();
            continue;
          }
          const amount =
            account.type === "asset"
              ? totals.debit.minus(totals.credit)
              : totals.credit.minus(totals.debit);
          expect(line?.amount, `${account.code} @${asOf}`).toBe(amount.toNumber());
          if (account.type === "asset") totalAssets = totalAssets.plus(amount);
          else if (account.type === "liability") totalLiabilities = totalLiabilities.plus(amount);
          else totalEquity = totalEquity.plus(amount);
        }
        // Laba berjalan dari agregat mentah (aturan tanda per seksi).
        let netProfit = d(0);
        for (const account of plAccounts) {
          const totals = get(raw, account.id);
          const section = resolveSection(account);
          const amount =
            section === "revenue" || section === "other_income"
              ? totals.credit.minus(totals.debit)
              : totals.debit.minus(totals.credit);
          netProfit =
            section === "revenue" || section === "other_income"
              ? netProfit.plus(amount)
              : netProfit.minus(amount);
        }
        totalEquity = totalEquity.plus(netProfit);
        expect(actual.totalAssets, `totalAssets @${asOf}`).toBe(totalAssets.toNumber());
        expect(actual.totalLiabilities, `totalLiabilities @${asOf}`).toBe(totalLiabilities.toNumber());
        expect(actual.totalEquity, `totalEquity @${asOf}`).toBe(totalEquity.toNumber());
        expect(actual.balanced, `balanced @${asOf}`).toBe(true);
      }
    });
  });

  it("buku besar: saldo awal, total rentang & saldo akhir identik", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      for (const range of RANGES) {
        const before = await rawTotals(tx, { to: prevDay(range.from) });
        const inRange = await rawTotals(tx, { from: range.from, to: range.to });
        const ledger = await getLedger(tx, {
          companyId: ORG,
          accountId: F.cash,
          from: range.from,
          to: range.to,
        });
        const b = get(before, F.cash);
        const r = get(inRange, F.cash);
        const label = `kas ${range.from}..${range.to}`;
        expect(ledger.opening, `opening ${label}`).toBe(b.debit.minus(b.credit).toNumber());
        expect(ledger.totalDebit, `totalDebit ${label}`).toBe(r.debit.toNumber());
        expect(ledger.totalCredit, `totalCredit ${label}`).toBe(r.credit.toNumber());
        expect(ledger.closing, `closing ${label}`).toBe(
          b.debit.minus(b.credit).plus(r.debit).minus(r.credit).toNumber(),
        );
      }
    });
  });

  it("ringkasan akuntansi identik dengan komponen mentahnya", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      const range = { from: "2025-01-01", to: "2025-12-31" };
      const rawAll = await rawTotals(tx, {});
      const summary = await getAccountingSummary(tx, ORG, range);
      const balanceOf = (id: string, creditNormal: boolean) => {
        const t = get(rawAll, id);
        return (creditNormal ? t.credit.minus(t.debit) : t.debit.minus(t.credit)).toNumber();
      };
      expect(summary.cash).toBe(balanceOf(F.cash, false));
      expect(summary.bank).toBe(balanceOf(F.bank, false));
      expect(summary.receivable).toBe(balanceOf(F.receivable, false));
      expect(summary.payable).toBe(balanceOf(F.payable, true));
      expect(summary.inventoryValue).toBe(balanceOf(F.inventory, false));
      expect(summary.balanced).toBe(true);
    });
  });

  it("backdated sesudah laporan dibaca: hasil berubah persis sebesar jurnalnya", async () => {
    await withCompanyReadOnly(ORG, async (tx) => {
      const before = await getTrialBalance(tx, ORG, { from: "2024-01-01", to: "2024-12-31" });
      const cashBefore = before.find((r) => r.accountId === F.cash)!;
      expect(cashBefore.closing).toBe(6_000_000);
    });
    await post("2024-03-25", [
      { accountId: F.cash, debit: 500_000 },
      { accountId: F.revenue, credit: 500_000 },
    ]);
    await withCompanyReadOnly(ORG, async (tx) => {
      const after = await getTrialBalance(tx, ORG, { from: "2024-01-01", to: "2024-12-31" });
      const cashAfter = after.find((r) => r.accountId === F.cash)!;
      expect(cashAfter.closing).toBe(6_500_000);
      const raw = await rawTotals(tx, { to: "2024-12-31" });
      expect(cashAfter.closing).toBe(get(raw, F.cash).debit.minus(get(raw, F.cash).credit).toNumber());
      // As-of SEBELUM tanggal backdated tidak ikut berubah.
      const midSheet = await getBalanceSheet(tx, ORG, "2024-03-15");
      const cashLine = midSheet.assets.find((l) => l.accountId === F.cash)!;
      expect(cashLine.amount).toBe(10_000_000);
    });
  });
});

// Menjaga impor Decimal terpakai untuk perbandingan bertipe di masa depan.
void Decimal;
