import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accounts,
  auditLog,
  fiscalPeriods,
  journalEntries,
  journalLines,
  member,
  organization,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { assertPeriodOpen, ensureFiscalPeriods, postJournal } from "@/server/accounting";
import { postManualJournalAction } from "@/server/actions/accounting/jurnal";
import {
  seedMissingPeriodsAction,
  setPeriodStatusAction,
} from "@/server/actions/accounting/periode";
import { wipeCompanyFixture, wipeCompanyRows } from "../helpers/wipe-company";

/**
 * FIX-P1 Tahap 3 (A-15) — Periode & integritas jurnal:
 *
 * AK6-01/AK1-02: postJournal menerima baris jurnal NEGATIF dan baris
 * DUA-SISI (debit>0 dan kredit>0 sekaligus) — neraca saldo tetap tampak
 * seimbang sementara mutasi per akun terdistorsi.
 *
 * AK6-02: race tutup periode (TOCTOU) — assertPeriodOpen membaca status
 * tanpa kunci, sehingga posting paralel yang sedang berjalan commit ke
 * periode yang sudah ditutup (probe: 30/36 lolos).
 *
 * AK1-01: periode TANPA baris dianggap terbuka selamanya — jurnal manual
 * bisa diposting backdated ke tahun mana pun yang belum pernah ditutup.
 * Desain perbaikan: materialisasi periode. Tahun berjalan & berikutnya
 * selalu termaterialisasi; periode tanpa baris = TERTUTUP; tahun lain
 * hanya bisa dimaterialisasi eksplisit oleh owner (teraudit).
 *
 * Perusahaan fixture khusus berkas ini (f301), dibersihkan total —
 * perusahaan demo tidak disentuh.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const sessionState = vi.hoisted(() => ({ role: "owner" as string }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000f301" },
    user: { id: "01900000-0000-7000-8000-00000000f340" },
    role: sessionState.role,
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000f301";
const OWNER = "01900000-0000-7000-8000-00000000f340";

const NOW = new Date();
const CUR = NOW.getFullYear();
const PAST_YEAR = CUR - 6;
const FAR_YEAR = CUR + 3;
const RACE_MONTH = 6;


const F = { cash: "", equity: "" };

async function wipeFixtureRows() {
  // AUD-001: reset sebagian lewat helper bersama — hanya baris
  // transaksional jurnal; akun master persisten antar-blok by design
  // (semantik wipeFixtureRows lama, kini tanpa daftar beku terpisah).
  await wipeCompanyRows(adminSql, ORG, {
    onlyTables: ["audit_log", "document_sequences", "fiscal_periods", "journal_entries", "journal_lines"],
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
    id: OWNER, name: "Pemilik Uji AK6", email: "owner@ak6.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "Ak6", slug: "ak6", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  const accRows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
    ])
    .returning();
  const byCode = Object.fromEntries(accRows.map((row) => [row.code, row.id]));
  F.cash = byCode["1000"];
  F.equity = byCode["3000"];
});

afterAll(async () => {
  await wipeFixtureAll();
});

beforeEach(async () => {
  sessionState.role = "owner";
  await wipeFixtureRows();
});

function journalInput(lines: { accountId: string; debit?: number; credit?: number }[], date?: string) {
  return {
    companyId: ORG,
    date: date ?? `${CUR}-11-15`,
    description: "Uji FIX-P1 Tahap 3 periode & integritas jurnal",
    sourceType: "manual",
    createdBy: OWNER,
    lines,
  };
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

function expectAppError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe("AK6-01/AK1-02 — baris jurnal negatif & dua-sisi ditolak", () => {
  it("domain: debit negatif ditolak", async () => {
    const error = await captureError(() =>
      withCompany(ORG, (tx) =>
        postJournal(tx, journalInput([
          { accountId: F.cash, debit: -100000, credit: 100000 },
          { accountId: F.equity, debit: 200000 },
        ])),
      ),
    );
    expectAppError(error, "VALIDATION");
    expect((error as AppError).message).toMatch(/negatif/i);
  });

  it("domain: kredit negatif ditolak", async () => {
    const error = await captureError(() =>
      withCompany(ORG, (tx) =>
        postJournal(tx, journalInput([
          { accountId: F.cash, debit: 100000 },
          { accountId: F.equity, credit: -100000 },
        ])),
      ),
    );
    expectAppError(error, "VALIDATION");
    expect((error as AppError).message).toMatch(/negatif/i);
  });

  it("domain: baris dua-sisi (debit dan kredit terisi) ditolak", async () => {
    const error = await captureError(() =>
      withCompany(ORG, (tx) =>
        postJournal(tx, journalInput([
          { accountId: F.cash, debit: 100000, credit: 100000 },
          { accountId: F.equity, credit: 100000 },
          { accountId: F.cash, debit: 100000 },
        ])),
      ),
    );
    expectAppError(error, "VALIDATION");
    expect((error as AppError).message).toMatch(/dua sisi|sekaligus/i);
  });

  it("domain: baris nol tetap dibuang dan jurnal sah tetap terposting", async () => {
    const entry = await withCompany(ORG, (tx) =>
      postJournal(tx, journalInput([
        { accountId: F.cash, debit: 150000 },
        { accountId: F.equity, credit: 150000 },
        { accountId: F.cash, debit: 0, credit: 0 },
      ])),
    );
    expect(entry.number).toBeTruthy();
    const lines = await adminDb
      .select({ id: journalLines.id })
      .from(journalLines)
      .where(eq(journalLines.entryId, entry.id));
    expect(lines).toHaveLength(2);
  });

  it("aksi: jurnal manual dengan baris negatif ditolak", async () => {
    const result = await postManualJournalAction({
      date: `${CUR}-11-15`,
      description: "Jurnal uji negatif tahap 3",
      lines: [
        { accountId: F.cash, debit: "-100000", credit: "100000" },
        { accountId: F.equity, debit: "200000" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("aksi: jurnal manual dengan baris dua-sisi ditolak", async () => {
    const result = await postManualJournalAction({
      date: `${CUR}-11-15`,
      description: "Jurnal uji dua sisi tahap 3",
      lines: [
        { accountId: F.cash, debit: "100000", credit: "100000" },
        { accountId: F.equity, credit: "100000" },
        { accountId: F.cash, debit: "100000" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("aksi: jurnal manual sah tetap terposting", async () => {
    const result = await postManualJournalAction({
      date: `${CUR}-11-15`,
      description: "Jurnal uji sah tahap 3",
      lines: [
        { accountId: F.cash, debit: "75000" },
        { accountId: F.equity, credit: "75000" },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("AK1-01 — periode tanpa baris = tertutup; materialisasi eksplisit", () => {
  it("posting ke tahun lampau tanpa baris periode ditolak PERIOD_CLOSED", async () => {
    const error = await captureError(() =>
      withCompany(ORG, (tx) =>
        postJournal(tx, journalInput([
          { accountId: F.cash, debit: 1000 },
          { accountId: F.equity, credit: 1000 },
        ], `${PAST_YEAR}-05-10`)),
      ),
    );
    expectAppError(error, "PERIOD_CLOSED");
  });

  it("assertPeriodOpen menolak tahun lampau yang belum dimaterialisasi", async () => {
    const error = await captureError(() =>
      withCompany(ORG, (tx) => assertPeriodOpen(tx, ORG, `${PAST_YEAR}-01-15`)),
    );
    expectAppError(error, "PERIOD_CLOSED");
  });

  it("ensureFiscalPeriods membuat 12 bulan terbuka dan idempoten", async () => {
    await withCompany(ORG, (tx) => ensureFiscalPeriods(tx, ORG, PAST_YEAR));
    await withCompany(ORG, (tx) => ensureFiscalPeriods(tx, ORG, PAST_YEAR));
    const rows = await adminDb
      .select({ month: fiscalPeriods.month, status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, PAST_YEAR)));
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.status === "open")).toBe(true);
  });

  it("sesudah dimaterialisasi, posting ke tahun lampau berhasil", async () => {
    await withCompany(ORG, (tx) => ensureFiscalPeriods(tx, ORG, PAST_YEAR));
    const entry = await withCompany(ORG, (tx) =>
      postJournal(tx, journalInput([
        { accountId: F.cash, debit: 2000 },
        { accountId: F.equity, credit: 2000 },
      ], `${PAST_YEAR}-05-10`)),
    );
    expect(entry.number).toBeTruthy();
  });

  it("posting tahun berjalan tanpa baris apa pun berhasil dan mematerialisasi tahun itu", async () => {
    const entry = await withCompany(ORG, (tx) =>
      postJournal(tx, journalInput([
        { accountId: F.cash, debit: 3000 },
        { accountId: F.equity, credit: 3000 },
      ], `${CUR}-03-10`)),
    );
    expect(entry.number).toBeTruthy();
    const rows = await adminDb
      .select({ month: fiscalPeriods.month })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, CUR)));
    expect(rows).toHaveLength(12);
  });

  it("posting tahun berikutnya tanpa baris berhasil (jendela materialisasi otomatis)", async () => {
    const entry = await withCompany(ORG, (tx) =>
      postJournal(tx, journalInput([
        { accountId: F.cash, debit: 4000 },
        { accountId: F.equity, credit: 4000 },
      ], `${CUR + 1}-01-10`)),
    );
    expect(entry.number).toBeTruthy();
  });

  it("posting jauh ke masa depan di luar jendela (tahun berjalan +3) ditolak", async () => {
    const error = await captureError(() =>
      withCompany(ORG, (tx) =>
        postJournal(tx, journalInput([
          { accountId: F.cash, debit: 1000 },
          { accountId: F.equity, credit: 1000 },
        ], `${FAR_YEAR}-05-10`)),
      ),
    );
    expectAppError(error, "PERIOD_CLOSED");
  });

  it("aksi materialisasi tahun lampau oleh owner berhasil dan teraudit", async () => {
    const result = await seedMissingPeriodsAction({ year: PAST_YEAR });
    expect(result.ok).toBe(true);
    const rows = await adminDb
      .select({ month: fiscalPeriods.month })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, PAST_YEAR)));
    expect(rows).toHaveLength(12);
    const audits = await adminDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, ORG), eq(auditLog.action, "period.materialize")));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("aksi materialisasi tahun lampau oleh NON-owner ditolak", async () => {
    sessionState.role = "accountant";
    const result = await seedMissingPeriodsAction({ year: PAST_YEAR });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    const rows = await adminDb
      .select({ month: fiscalPeriods.month })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, PAST_YEAR)));
    expect(rows).toHaveLength(0);
  });
});

describe("AK6-02 — race tutup periode: tidak ada posting yang commit sesudah penutupan", () => {
  it("12 posting paralel vs penutupan bersamaan: yang sukses selalu commit sebelum penutupan", async () => {
    await withCompany(ORG, (tx) => ensureFiscalPeriods(tx, ORG, CUR));
    const date = `${CUR}-${String(RACE_MONTH).padStart(2, "0")}-15`;

    let closerResolvedAt = Number.POSITIVE_INFINITY;
    const posters = Array.from({ length: 12 }, (_, i) =>
      (async () => {
        try {
          await withCompany(ORG, (tx) =>
            postJournal(tx, {
              companyId: ORG,
              date,
              description: `Uji race tutup periode ${i}`,
              sourceType: "manual",
              createdBy: OWNER,
              lines: [
                { accountId: F.cash, debit: 1000 + i },
                { accountId: F.equity, credit: 1000 + i },
              ],
            }),
          );
          return { ok: true, resolvedAt: Date.now() };
        } catch {
          return { ok: false, resolvedAt: Date.now() };
        }
      })(),
    );
    const closer = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const result = await setPeriodStatusAction({ year: CUR, month: RACE_MONTH, status: "closed" });
      closerResolvedAt = Date.now();
      return result;
    })();

    const [results, closeResult] = await Promise.all([Promise.all(posters), closer]);
    expect(closeResult.ok).toBe(true);

    const succeeded = results.filter((row) => row.ok);
    // Invariant inti AK6-02: tidak satu pun posting sukses yang commit
    // SESUDAH penutupan selesai — sebelum perbaikan, 30/36 lolos.
    for (const row of succeeded) {
      expect(row.resolvedAt).toBeLessThanOrEqual(closerResolvedAt);
    }

    const stored = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.date, date)));
    expect(stored).toHaveLength(succeeded.length);

    // Dan sesudah penutupan, posting baru ke periode itu selalu ditolak.
    const error = await captureError(() =>
      withCompany(ORG, (tx) =>
        postJournal(tx, {
          companyId: ORG,
          date,
          description: "Posting sesudah tutup — harus ditolak",
          sourceType: "manual",
          createdBy: OWNER,
          lines: [
            { accountId: F.cash, debit: 500 },
            { accountId: F.equity, credit: 500 },
          ],
        }),
      ),
    );
    expectAppError(error, "PERIOD_CLOSED");
  });
});
