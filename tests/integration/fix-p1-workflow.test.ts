import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  fiscalPeriods,
  journalEntries,
  member,
  organization,
  payrollRuns,
  stockReceipts,
  suppliers,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  ensureFiscalPeriods,
  postJournal,
  reverseJournalEntry,
} from "@/server/accounting";
import {
  getBalanceSheet,
  getJournalDetail,
  getLedger,
  getTrialBalance,
  listJournalEntries,
  listJournalSourceTypes,
  listPayables,
} from "@/server/reports";
import {
  lockYearPeriods,
  postYearEndClosing,
  previewYearEndClosing,
} from "@/server/year-end-closing";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * FIX-P1 Tahap 5 (A-15) — Workflow akuntan:
 *
 * AK5-04 + AK1-05: tidak ada alur tutup buku tahunan. Domain baru
 * `year-end-closing`: pratinjau angka tahun, posting SATU jurnal penutup
 * (pendapatan/beban → laba ditahan) bertanggal 31 Des, idempoten per
 * tahun, dapat dibalik lewat mekanisme reversal biasa, dan kunci 12
 * periode sebagai aksi terpisah.
 *
 * AK5-02: daftar jurnal bisa disaring per akun & status, dan daftar tipe
 * sumber diturunkan dari data nyata (bukan 9 nilai hardcoded).
 *
 * AK5-01: buku besar membawa entryId (tautan ke detail jurnal) dan
 * detail jurnal menyelesaikan tautan dokumen sumber (sourceHref).
 *
 * AK3-07: utang pembelian berjatuh tempo nyata — tanggal penerimaan +
 * termin pemasok; termin kosong → bawaan perusahaan
 * `payable_default_term_days` (migrasi 0041).
 *
 * Perusahaan fixture khusus berkas ini (f501), dibersihkan total —
 * perusahaan demo tidak disentuh.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const ORG = "01900000-0000-7000-8000-00000000f501";
const OWNER = "01900000-0000-7000-8000-00000000f540";

const CUR = new Date().getFullYear();
const Y = CUR - 1; // tahun yang ditutup bukunya
const RANGE_Y = { from: `${Y}-01-01T00:00:00`, to: `${Y}-12-31T23:59:59` };
const RANGE_Y1 = { from: `${Y + 1}-01-01T00:00:00`, to: `${Y + 1}-12-31T23:59:59` };


const A = {
  kas: "", modal: "", labaDitahan: "", pendapatan: "", hpp: "", beban: "",
};
let warehouseId = "";
let closingJournalId = "";

async function wipeFixtureAll() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

beforeAll(async () => {
  await wipeFixtureAll();
  await adminDb.insert(user).values({
    id: OWNER, name: "Pemilik Uji Workflow", email: "owner@workflow.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "Workflow", slug: "workflow-f501", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "3100", name: "Laba Ditahan", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "4000", name: "Pendapatan Penjualan", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
      { companyId: ORG, code: "6000", name: "Beban Operasional", type: "expense", normalBalance: "debit" },
    ])
    .returning({ id: accounts.id, code: accounts.code });
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  A.kas = byCode.get("1000")!;
  A.modal = byCode.get("3000")!;
  A.labaDitahan = byCode.get("3100")!;
  A.pendapatan = byCode.get("4000")!;
  A.hpp = byCode.get("5000")!;
  A.beban = byCode.get("6000")!;

  await adminDb.insert(accountMappings).values({ companyId: ORG, key: "equity", accountId: A.labaDitahan });
  await adminDb.insert(companySettings).values({
    companyId: ORG,
    legalName: "PT Workflow Uji",
    payableDefaultTermDays: 45,
    receivableDefaultTermDays: 10,
  });
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "GDG", name: "Gudang Uji", isDefault: true })
    .returning({ id: warehouses.id });
  warehouseId = wh.id;
});

afterAll(wipeFixtureAll);

async function postManual(date: string, description: string, lines: { accountId: string; debit?: string; credit?: string }[]) {
  return withCompany(ORG, (tx) =>
    postJournal(tx, { companyId: ORG, date, description, sourceType: "manual", createdBy: OWNER, lines }),
  );
}

describe("AK5-04/AK1-05 — tutup buku tahunan", () => {
  beforeAll(async () => {
    await withCompany(ORG, async (tx) => {
      await ensureFiscalPeriods(tx, ORG, Y);
      await ensureFiscalPeriods(tx, ORG, Y + 1);
    });
    // Aktivitas tahun Y: pendapatan 10jt, HPP 4jt, beban 1,5jt → laba 4,5jt.
    await postManual(`${Y}-03-10`, "Penjualan tahun berjalan", [
      { accountId: A.kas, debit: "10000000" },
      { accountId: A.pendapatan, credit: "10000000" },
    ]);
    await postManual(`${Y}-03-11`, "HPP tahun berjalan", [
      { accountId: A.hpp, debit: "4000000" },
      { accountId: A.kas, credit: "4000000" },
    ]);
    await postManual(`${Y}-06-15`, "Beban tahun berjalan", [
      { accountId: A.beban, debit: "1500000" },
      { accountId: A.kas, credit: "1500000" },
    ]);
  });

  it("pratinjau menghitung total pendapatan, beban, dan laba bersih tahun itu", async () => {
    const preview = await withCompany(ORG, (tx) => previewYearEndClosing(tx, ORG, Y));
    expect(preview.totalRevenue).toBe(10_000_000);
    expect(preview.totalExpense).toBe(5_500_000);
    expect(preview.netProfit).toBe(4_500_000);
    expect(preview.alreadyClosed).toBe(false);
    expect(preview.retainedEarningsAccountId).toBe(A.labaDitahan);
  });

  it("menolak akun laba ditahan yang bukan ekuitas", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        postYearEndClosing(tx, { companyId: ORG, year: Y, retainedEarningsAccountId: A.pendapatan, createdBy: OWNER }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("posting jurnal penutup menolkan pendapatan/beban tahun itu dan memindahkan laba persis ke laba ditahan", async () => {
    const entry = await withCompany(ORG, (tx) =>
      postYearEndClosing(tx, { companyId: ORG, year: Y, retainedEarningsAccountId: A.labaDitahan, createdBy: OWNER }),
    );
    closingJournalId = entry.id;

    const [row] = await adminDb
      .select({ sourceType: journalEntries.sourceType, date: journalEntries.date, sourceId: journalEntries.sourceId })
      .from(journalEntries)
      .where(eq(journalEntries.id, entry.id));
    expect(row.sourceType).toBe("year_end_closing");
    expect(String(row.date)).toBe(`${Y}-12-31`);
    expect(row.sourceId).toBeNull(); // tahun disimpan di idempotency key, bukan sourceId uuid

    const trialY = await withCompany(ORG, (tx) => getTrialBalance(tx, ORG, RANGE_Y));
    // "+ 0" menormalkan -0 dari perkalian tanda Decimal untuk akun
    // bersaldo normal kredit — nilainya memang nol.
    const closingOf = (accountId: string) => (trialY.find((r) => r.accountId === accountId)?.closing ?? 0) + 0;
    expect(closingOf(A.pendapatan)).toBe(0);
    expect(closingOf(A.hpp)).toBe(0);
    expect(closingOf(A.beban)).toBe(0);
    expect(closingOf(A.kas)).toBe(4_500_000);

    // Neraca awal tahun berikutnya: laba ditahan memuat laba tahun lalu.
    const trialY1 = await withCompany(ORG, (tx) => getTrialBalance(tx, ORG, RANGE_Y1));
    const openingOf = (accountId: string) => (trialY1.find((r) => r.accountId === accountId)?.opening ?? 0) + 0;
    expect(openingOf(A.labaDitahan)).toBe(4_500_000);
    expect(openingOf(A.pendapatan)).toBe(0);

    const sheet = await withCompany(ORG, (tx) => getBalanceSheet(tx, ORG, `${Y + 1}-01-31`));
    expect(sheet.totalEquity).toBe(4_500_000);
    expect(sheet.balanced).toBe(true);
  });

  it("tutup ulang tahun yang sama ditolak", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        postYearEndClosing(tx, { companyId: ORG, year: Y, retainedEarningsAccountId: A.labaDitahan, createdBy: OWNER }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const preview = await withCompany(ORG, (tx) => previewYearEndClosing(tx, ORG, Y));
    expect(preview.alreadyClosed).toBe(true);
    expect(preview.closingJournal?.id).toBe(closingJournalId);
  });

  it("jurnal penutup dapat dibalik lewat reversal biasa, lalu tahun dapat ditutup ulang", async () => {
    // Jalur koreksi standar: jurnal pembalik bertanggal sama dengan
    // jurnal penutup (31 Des, periode masih terbuka — tahun belum
    // dikunci), sehingga saldo P&L tahun itu hidup kembali di dalam
    // tahunnya dan penutupan ulang menghitung angka yang sama.
    await withCompany(ORG, (tx) =>
      reverseJournalEntry(tx, {
        companyId: ORG,
        entryId: closingJournalId,
        date: `${Y}-12-31`,
        createdBy: OWNER,
      }),
    );
    const preview = await withCompany(ORG, (tx) => previewYearEndClosing(tx, ORG, Y));
    expect(preview.alreadyClosed).toBe(false);

    const reclosed = await withCompany(ORG, (tx) =>
      postYearEndClosing(tx, { companyId: ORG, year: Y, retainedEarningsAccountId: A.labaDitahan, createdBy: OWNER }),
    );
    expect(reclosed.id).not.toBe(closingJournalId);
    closingJournalId = reclosed.id;
    const trialY = await withCompany(ORG, (tx) => getTrialBalance(tx, ORG, RANGE_Y));
    expect((trialY.find((r) => r.accountId === A.pendapatan)?.closing ?? 0) + 0).toBe(0);
  });

  it("kunci 12 periode adalah aksi terpisah dan sesudahnya posting ke tahun itu ditolak", async () => {
    const result = await withCompany(ORG, (tx) => lockYearPeriods(tx, { companyId: ORG, year: Y, userId: OWNER }));
    expect(result.locked).toBe(12);
    const periods = await adminDb
      .select({ status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, Y)));
    expect(periods).toHaveLength(12);
    expect(periods.every((p) => p.status === "locked")).toBe(true);

    await expect(
      postManual(`${Y}-05-20`, "Posting sesudah kunci tahun", [
        { accountId: A.kas, debit: "1000" },
        { accountId: A.modal, credit: "1000" },
      ]),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});

describe("AK5-02 — daftar jurnal: filter akun, status, dan tipe sumber dari data", () => {
  let modalJournalId = "";
  let bebanJournalId = "";

  beforeAll(async () => {
    const a = await postManual(`${CUR}-02-01`, "Setoran modal uji", [
      { accountId: A.kas, debit: "2000000" },
      { accountId: A.modal, credit: "2000000" },
    ]);
    modalJournalId = a.id;
    const b = await postManual(`${CUR}-02-02`, "Beban uji daftar", [
      { accountId: A.beban, debit: "250000" },
      { accountId: A.kas, credit: "250000" },
    ]);
    bebanJournalId = b.id;
  });

  it("filter akun hanya mengembalikan jurnal yang menyentuh akun itu", async () => {
    const result = await withCompany(ORG, (tx) =>
      listJournalEntries(tx, { companyId: ORG, accountId: A.beban, pageSize: 50 }),
    );
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(bebanJournalId);
    expect(ids).not.toContain(modalJournalId);
  });

  it("filter status posted/void bekerja", async () => {
    const posted = await withCompany(ORG, (tx) =>
      listJournalEntries(tx, { companyId: ORG, status: "posted", pageSize: 50 }),
    );
    expect(posted.rows.map((r) => r.id)).toContain(modalJournalId);
    const voids = await withCompany(ORG, (tx) =>
      listJournalEntries(tx, { companyId: ORG, status: "void", pageSize: 50 }),
    );
    expect(voids.total).toBe(0);
  });

  it("tipe sumber diturunkan dari data nyata perusahaan", async () => {
    const types = await withCompany(ORG, (tx) => listJournalSourceTypes(tx, ORG));
    expect(types).toContain("manual");
    expect(types).toContain("year_end_closing");
  });
});

describe("AK5-01 — drill-through: buku besar membawa entryId, detail jurnal membawa sourceHref", () => {
  it("baris buku besar memuat entryId jurnalnya", async () => {
    const ledger = await withCompany(ORG, (tx) =>
      getLedger(tx, { companyId: ORG, accountId: A.modal, from: `${CUR}-01-01`, to: `${CUR}-12-31` }),
    );
    const row = ledger.items.find((r) => r.description === "Setoran modal uji");
    expect(row).toBeTruthy();
    expect(row!.entryId).toBeTruthy();
    const [entry] = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.id, row!.entryId));
    expect(entry?.id).toBe(row!.entryId);
  });

  it("jurnal payroll menyelesaikan tautan ke halaman run payroll; jurnal manual tanpa tautan", async () => {
    const [run] = await adminDb
      .insert(payrollRuns)
      .values({
        companyId: ORG, number: "PAY-UJI-001", period: `${CUR}-01`,
        totalGross: "0", totalDeductions: "0", totalNet: "0",
      })
      .returning({ id: payrollRuns.id });
    const entry = await withCompany(ORG, (tx) =>
      postJournal(tx, {
        companyId: ORG,
        date: `${CUR}-01-31`,
        description: "Jurnal gaji uji drill",
        sourceType: "payroll",
        sourceId: run.id,
        createdBy: OWNER,
        lines: [
          { accountId: A.beban, debit: "100000" },
          { accountId: A.kas, credit: "100000" },
        ],
      }),
    );
    const detail = await withCompany(ORG, (tx) => getJournalDetail(tx, ORG, entry.id));
    expect(detail?.source.number).toBe("PAY-UJI-001");
    expect(detail?.source.href).toBe(`/app/akuntansi/payroll/${run.id}`);

    const manual = await postManual(`${CUR}-03-01`, "Jurnal manual drill", [
      { accountId: A.kas, debit: "5000" },
      { accountId: A.modal, credit: "5000" },
    ]);
    const manualDetail = await withCompany(ORG, (tx) => getJournalDetail(tx, ORG, manual.id));
    expect(manualDetail?.source.href).toBeNull();
  });
});

describe("AK3-07 — jatuh tempo utang pembelian dari termin pemasok / bawaan perusahaan", () => {
  beforeAll(async () => {
    const [supA, supB] = await adminDb
      .insert(suppliers)
      .values([
        { companyId: ORG, code: "SUP-A", name: "Pemasok Termin", paymentTermDays: 14 },
        { companyId: ORG, code: "SUP-B", name: "Pemasok Polos" },
      ])
      .returning({ id: suppliers.id, code: suppliers.code });
    await adminDb.insert(stockReceipts).values([
      {
        companyId: ORG, warehouseId, supplierId: supA.id, source: "purchase",
        number: "GRN-UJI-A", date: `${CUR}-01-10`, status: "posted",
        total: "1000000", paidAmount: "0", paymentStatus: "unpaid",
      },
      {
        companyId: ORG, warehouseId, supplierId: supB.id, source: "purchase",
        number: "GRN-UJI-B", date: `${CUR}-01-10`, status: "posted",
        total: "2000000", paidAmount: "0", paymentStatus: "unpaid",
      },
    ]);
  });

  it("termin pemasok dipakai; tanpa termin memakai bawaan perusahaan (45 hari)", async () => {
    const payables = await withCompany(ORG, (tx) => listPayables(tx, ORG));
    const a = payables.find((r) => r.number === "GRN-UJI-A");
    const b = payables.find((r) => r.number === "GRN-UJI-B");
    expect(a?.dueDate).toBe(`${CUR}-01-24`); // 10 Jan + 14 hari
    expect(b?.dueDate).toBe(addDays(`${CUR}-01-10`, 45));
  });

  it("mengubah bawaan perusahaan mengubah jatuh tempo dokumen tanpa termin", async () => {
    await adminDb
      .update(companySettings)
      .set({ payableDefaultTermDays: 10 })
      .where(eq(companySettings.companyId, ORG));
    const payables = await withCompany(ORG, (tx) => listPayables(tx, ORG));
    const b = payables.find((r) => r.number === "GRN-UJI-B");
    expect(b?.dueDate).toBe(`${CUR}-01-20`);
    const a = payables.find((r) => r.number === "GRN-UJI-A");
    expect(a?.dueDate).toBe(`${CUR}-01-24`); // termin pemasok tetap menang
  });
});

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
