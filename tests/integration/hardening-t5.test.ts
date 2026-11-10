import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  account,
  accountMappings,
  accounts,
  auditLog,
  companySettings,
  employees,
  journalEntries,
  payrollItems,
  payrollRuns,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { createExpenseAction } from "@/server/actions/accounting/beban-transfer";
import { postManualJournalAction } from "@/server/actions/accounting/jurnal";
import { saveAccountAction } from "@/server/actions/accounting/akun-pemetaan";
import {
  runPayrollAction,
  voidPayrollRunAction,
} from "@/server/actions/hr/payroll";
import { ensureFiscalPeriods } from "@/server/accounting";
import { saveSettingsAction } from "@/server/actions/settings/identitas-pajak";
import { resetUserPasswordAction } from "@/server/actions/users";
import { todayISO } from "@/lib/format";

// Tahap 5 batch T5-1 — sisa hardening P3 Akuntansi + test keamanan:
//   AK-P3-06 tarif pajak divalidasi rentang 0–100 di skema settings.
//   AK-P3-02 jurnal manual memakai kunci idempotensi per sesi form.
//   AK-P3-03 payroll satu periode tidak bisa diproses dua kali, termasuk
//            dua permintaan yang berjalan bersamaan (migrasi 0019).
//   AK-P3-01 tanggal/nominal divalidasi skema bersama; 23505 menjadi
//            pesan duplikat, bukan "Terjadi kesalahan pada server".
//   SEC-P0-01 non-owner tidak boleh mereset kata sandi owner (penjaga
//            Tahap 1 — test otomatisnya baru ditulis di sini).
// Sesi diganti versi dinamis (peran & perusahaan bisa ditukar per uji);
// database-nya nyata.

const DEMO_ORG = "01900000-0000-7000-8000-000000000001";
const T5_ORG = "01900000-0000-7000-8000-00000000aa31";
const OWNER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);

const session = vi.hoisted(() => ({
  companyId: "01900000-0000-7000-8000-000000000001",
  userId: "01900000-0000-7000-8000-000000000010",
  role: "owner",
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: session.companyId },
    user: { id: session.userId },
    role: session.role,
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

function useSession(companyId: string, role: string) {
  session.companyId = companyId;
  session.role = role;
  session.userId = OWNER_ID;
}

/* ------------------------------------------------------------------ */
/* Fixture perusahaan uji T5 (jurnal manual & payroll)                 */
/* ------------------------------------------------------------------ */

let cashAccountId = "";
let revenueAccountId = "";

beforeAll(async () => {
  await withCompany(T5_ORG, async (tx) => {
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, T5_ORG))
      .limit(1);
    if (!settings) {
      await tx.insert(companySettings).values({ companyId: T5_ORG, legalName: "Perusahaan Uji T5" });
      const rows = await tx
        .insert(accounts)
        .values([
          { companyId: T5_ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
          { companyId: T5_ORG, code: "1200", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: T5_ORG, code: "2100", name: "Utang Gaji", type: "liability", normalBalance: "credit" },
          { companyId: T5_ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: T5_ORG, code: "6000", name: "Beban Gaji", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: T5_ORG, key: "salary_expense", accountId: byCode.get("6000")! },
        { companyId: T5_ORG, key: "salary_payable", accountId: byCode.get("2100")! },
      ]);
      await tx.insert(employees).values({
        companyId: T5_ORG,
        code: `EMP-T5-${suffix}`,
        name: "Karyawan Uji T5",
        baseSalary: "5000000",
        allowances: "0",
        deductions: "0",
        isActive: true,
      });
    }
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, T5_ORG));
    cashAccountId = rows.find((row) => row.code === "1000")!.id;
    revenueAccountId = rows.find((row) => row.code === "4000")!.id;
  });
});

/* ------------------------------------------------------------------ */
/* AK-P3-06 — tarif pajak 0–100                                        */
/* ------------------------------------------------------------------ */

describe("AK-P3-06 tarif pajak divalidasi rentang", () => {
  type SettingsRow = typeof companySettings.$inferSelect;
  let original: SettingsRow;

  beforeAll(async () => {
    original = await withCompanyReadOnly(DEMO_ORG, async (tx) => {
      const [row] = await tx
        .select()
        .from(companySettings)
        .where(eq(companySettings.companyId, DEMO_ORG))
        .limit(1);
      return row;
    });
  });

  afterAll(async () => {
    await withCompany(DEMO_ORG, async (tx) => {
      await tx
        .update(companySettings)
        .set({ taxRate: original.taxRate })
        .where(eq(companySettings.companyId, DEMO_ORG));
    });
  });

  function settingsInput(taxRate: string | number) {
    return {
      legalName: original.legalName,
      taxId: original.taxId ?? undefined,
      address: original.address ?? undefined,
      phone: original.phone ?? undefined,
      roundingMode: original.roundingMode as "none",
      // A-28 UI-2: field nota warisan dihapus dari skema pengaturan
      // umum — nota diatur satu pintu di mesin cetak.
      qrisImage: original.qrisImage,
      allowNegativeStock: original.allowNegativeStock,
      taxRate,
      posDiscountThresholdPercent: original.posDiscountThresholdPercent,
      reportNotes: original.reportNotes ?? undefined,
      defaultWarehouseId: original.defaultWarehouseId,
    };
  }

  it("menolak tarif -1 dan 150 dengan pesan tarif pajak", async () => {
    useSession(DEMO_ORG, "owner");
    for (const bad of [-1, 150, "-1", "150"]) {
      const result = await saveSettingsAction(settingsInput(bad));
      expect(result.ok, `taxRate=${bad}`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("VALIDATION");
        expect(result.message).toMatch(/tarif pajak/i);
      }
    }
    const stored = await withCompanyReadOnly(DEMO_ORG, async (tx) => {
      const [row] = await tx
        .select({ taxRate: companySettings.taxRate })
        .from(companySettings)
        .where(eq(companySettings.companyId, DEMO_ORG))
        .limit(1);
      return row.taxRate;
    });
    expect(stored).toBe(original.taxRate);
  });

  it("menerima tarif batas 0 dan 100", async () => {
    useSession(DEMO_ORG, "owner");
    for (const good of [0, 100]) {
      const result = await saveSettingsAction(settingsInput(good));
      expect(result.ok, `taxRate=${good}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* AK-P3-01 — validasi tanggal & nominal di action akuntansi           */
/* ------------------------------------------------------------------ */

describe("AK-P3-01 validasi skema bersama di action akuntansi", () => {
  it("tanggal 2026-02-30 ditolak VALIDATION menyebut tanggal", async () => {
    useSession(DEMO_ORG, "owner");
    const result = await createExpenseAction({
      date: "2026-02-30",
      expenseAccountId: crypto.randomUUID(),
      paymentAccountId: crypto.randomUUID(),
      amount: "10000",
      description: "Beban uji tanggal tidak nyata",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toMatch(/tanggal/i);
    }
  });

  it("nominal 'abc' ditolak VALIDATION menyebut bidang nominalnya", async () => {
    useSession(DEMO_ORG, "owner");
    const result = await createExpenseAction({
      date: todayISO(),
      expenseAccountId: crypto.randomUUID(),
      paymentAccountId: crypto.randomUUID(),
      amount: "abc",
      description: "Beban uji nominal tidak terbaca",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toContain("Nominal beban");
    }
  });

  it("kode akun duplikat menghasilkan pesan duplikat, bukan pesan server generik", async () => {
    useSession(DEMO_ORG, "owner");
    const existing = await withCompanyReadOnly(DEMO_ORG, async (tx) => {
      const [row] = await tx
        .select({ code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, DEMO_ORG))
        .limit(1);
      return row;
    });
    const result = await saveAccountAction({
      code: existing.code,
      name: "Akun Uji Duplikat T5",
      type: "asset",
      normalBalance: "debit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFLICT");
      expect(result.message).toMatch(/sudah digunakan/);
      expect(result.message).not.toContain("Terjadi kesalahan pada server");
    }
  });
});

/* ------------------------------------------------------------------ */
/* AK-P3-02 — idempotensi jurnal manual                                */
/* ------------------------------------------------------------------ */

describe("AK-P3-02 jurnal manual idempoten per kunci form", () => {
  it("dua panggilan dengan kunci sama menghasilkan SATU jurnal yang sama", async () => {
    useSession(T5_ORG, "owner");
    const key = `manual-journal-t5-${suffix}`;
    const input = {
      date: todayISO(),
      description: `Jurnal uji idempotensi T5 ${suffix}`,
      idempotencyKey: key,
      lines: [
        { accountId: cashAccountId, debit: "50000" },
        { accountId: revenueAccountId, credit: "50000" },
      ],
    };
    const first = await postManualJournalAction(input);
    const second = await postManualJournalAction(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.number).toBe(first.data.number);
    }
    const count = await withCompanyReadOnly(T5_ORG, async (tx) => {
      const rows = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, T5_ORG), eq(journalEntries.idempotencyKey, key)));
      return rows.length;
    });
    expect(count).toBe(1);

    // Kunci berbeda = jurnal baru; yang menahan duplikasi adalah kuncinya,
    // bukan isi jurnalnya.
    const third = await postManualJournalAction({ ...input, idempotencyKey: `manual-journal-t5-b-${suffix}` });
    expect(third.ok).toBe(true);
    if (first.ok && third.ok) expect(third.data.id).not.toBe(first.data.id);
  });
});

/* ------------------------------------------------------------------ */
/* AK-P3-03 — payroll satu periode hanya satu run                      */
/* ------------------------------------------------------------------ */

describe("AK-P3-03 proses payroll konkuren satu periode", () => {
  const period = `20${50 + Math.floor(Math.random() * 40)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;

  // FIX-P1 Tahap 3 (AK1-01): tahun acak masa depan yang dipakai test ini
  // harus dimaterialisasi eksplisit — periode tanpa baris kini tertutup.
  beforeAll(async () => {
    await withCompany(T5_ORG, async (tx) => {
      await ensureFiscalPeriods(tx, T5_ORG, Number(period.slice(0, 4)));
    });
  });

  afterAll(async () => {
    await withCompany(T5_ORG, async (tx) => {
      await tx
        .delete(payrollRuns)
        .where(and(eq(payrollRuns.companyId, T5_ORG), eq(payrollRuns.period, period)));
    });
  });

  it("dua proses bersamaan: tepat satu run + satu jurnal; yang lain CONFLICT", async () => {
    useSession(T5_ORG, "owner");
    const results = await Promise.all([runPayrollAction({ period }), runPayrollAction({ period })]);
    const ok = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (!failed[0].ok) {
      expect(failed[0].code).toBe("CONFLICT");
      expect(failed[0].message).toMatch(/sudah pernah diproses/);
      expect(failed[0].message).not.toContain("Terjadi kesalahan pada server");
    }

    const state = await withCompanyReadOnly(T5_ORG, async (tx) => {
      const runs = await tx
        .select({ id: payrollRuns.id, status: payrollRuns.status })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, T5_ORG), eq(payrollRuns.period, period)));
      const journals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, T5_ORG),
            eq(journalEntries.sourceType, "payroll"),
            eq(journalEntries.sourceId, runs[0]?.id ?? ""),
          ),
        );
      const items = await tx
        .select({ id: payrollItems.id })
        .from(payrollItems)
        .where(eq(payrollItems.companyId, T5_ORG));
      return { runs, journals, itemCount: items.length };
    });
    expect(state.runs).toHaveLength(1);
    expect(state.journals).toHaveLength(1);
    expect(state.itemCount).toBe(1);
  });

  it("proses ulang sekuensial sesudah yang pertama committed juga CONFLICT", async () => {
    useSession(T5_ORG, "owner");
    const result = await runPayrollAction({ period });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});

/* ------------------------------------------------------------------ */
/* SEC-P0-01 — penjaga reset kata sandi owner                          */
/* ------------------------------------------------------------------ */

describe("SEC-P0-01 reset kata sandi owner hanya oleh owner", () => {
  let originalHash: string | null = null;

  async function readHash(): Promise<string | null> {
    return withCompanyReadOnly(DEMO_ORG, async (tx) => {
      const [row] = await tx
        .select({ password: account.password })
        .from(account)
        .where(and(eq(account.userId, OWNER_ID), eq(account.providerId, "credential")))
        .limit(1);
      return row?.password ?? null;
    });
  }

  beforeAll(async () => {
    originalHash = await readHash();
    expect(originalHash).toBeTruthy();
  });

  afterAll(async () => {
    // Pulihkan kredensial demo seperti semula agar login demo tetap utuh.
    await withCompany(DEMO_ORG, async (tx) => {
      await tx
        .update(account)
        .set({ password: originalHash })
        .where(and(eq(account.userId, OWNER_ID), eq(account.providerId, "credential")));
    });
    useSession(DEMO_ORG, "owner");
  });

  it("admin (non-owner) mereset kata sandi owner → FORBIDDEN dan hash tidak berubah", async () => {
    useSession(DEMO_ORG, "admin");
    const result = await resetUserPasswordAction({ userId: OWNER_ID, password: "KataSandiBaru123!" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
      expect(result.message).toMatch(/owner/i);
    }
    expect(await readHash()).toBe(originalHash);
  });

  it("owner mereset kata sandi owner → berhasil, hash berubah, audit tercatat", async () => {
    useSession(DEMO_ORG, "owner");
    const result = await resetUserPasswordAction({ userId: OWNER_ID, password: "KataSandiBaru123!" });
    expect(result.ok).toBe(true);
    const newHash = await readHash();
    expect(newHash).toBeTruthy();
    expect(newHash).not.toBe(originalHash);

    const audits = await withCompanyReadOnly(DEMO_ORG, async (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, DEMO_ORG),
            eq(auditLog.action, "user.password.reset"),
            eq(auditLog.entityId, OWNER_ID),
          ),
        ),
    );
    expect(audits.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* AK-P3-03 lanjutan (T5R-7) — alur koreksi sah ujung-ke-ujung:        */
/* proses → void → proses ulang periode yang sama HARUS berhasil.      */
/* Inilah alasan indeks unik 0019 bersifat parsial (status <> 'void'); */
/* test konkuren di atas hanya membuktikan sisi larangannya.           */
/* ------------------------------------------------------------------ */

describe("AK-P3-03 proses → void → proses ulang satu periode (T5R-7)", () => {
  const period = `209${Math.floor(Math.random() * 9)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;

  // FIX-P1 Tahap 3 (AK1-01): sama seperti describe AK-P3-03 di atas.
  beforeAll(async () => {
    await withCompany(T5_ORG, async (tx) => {
      await ensureFiscalPeriods(tx, T5_ORG, Number(period.slice(0, 4)));
    });
  });

  async function runsOfPeriod() {
    return withCompanyReadOnly(T5_ORG, async (tx) =>
      tx
        .select({ id: payrollRuns.id, status: payrollRuns.status })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, T5_ORG), eq(payrollRuns.period, period))),
    );
  }

  afterAll(async () => {
    await withCompany(T5_ORG, async (tx) => {
      const runs = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, T5_ORG), eq(payrollRuns.period, period)));
      if (runs.length > 0) {
        await tx
          .delete(payrollItems)
          .where(
            and(
              eq(payrollItems.companyId, T5_ORG),
              inArray(
                payrollItems.runId,
                runs.map((run) => run.id),
              ),
            ),
          );
      }
      await tx
        .delete(payrollRuns)
        .where(and(eq(payrollRuns.companyId, T5_ORG), eq(payrollRuns.period, period)));
    });
  });

  it("run yang di-void tidak menghalangi pemrosesan ulang; jurnal hidup hanya dari run aktif", async () => {
    useSession(T5_ORG, "owner");

    const first = await runPayrollAction({ period });
    expect(first.ok).toBe(true);
    const afterFirst = await runsOfPeriod();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].status).toBe("posted");

    const voided = await voidPayrollRunAction({
      id: afterFirst[0].id,
      reason: "Salah input periode uji T5R-7",
    });
    expect(voided.ok).toBe(true);

    const second = await runPayrollAction({ period });
    expect(second.ok).toBe(true);

    const runs = await runsOfPeriod();
    expect(runs).toHaveLength(2);
    const voidRun = runs.find((run) => run.status === "void");
    const activeRun = runs.find((run) => run.status === "posted");
    expect(voidRun).toBeDefined();
    expect(activeRun).toBeDefined();

    const journals = await withCompanyReadOnly(T5_ORG, async (tx) => {
      const own = await tx
        .select({
          id: journalEntries.id,
          sourceId: journalEntries.sourceId,
          status: journalEntries.status,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, T5_ORG),
            eq(journalEntries.sourceType, "payroll"),
            inArray(
              journalEntries.sourceId,
              runs.map((run) => run.id),
            ),
          ),
        );
      const reversals = await tx
        .select({ reversalOfId: journalEntries.reversalOfId })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, T5_ORG),
            inArray(
              journalEntries.reversalOfId,
              own.map((entry) => entry.id),
            ),
          ),
        );
      return { own, reversedIds: new Set(reversals.map((row) => row.reversalOfId)) };
    });

    const voidJournals = journals.own.filter((entry) => entry.sourceId === voidRun!.id);
    const activeJournals = journals.own.filter((entry) => entry.sourceId === activeRun!.id);
    // Run void: jurnal asalnya ada dan SUDAH dibalik — efek bersih nol.
    expect(voidJournals).toHaveLength(1);
    expect(journals.reversedIds.has(voidJournals[0].id)).toBe(true);
    // Run aktif: tepat satu jurnal posted dan belum dibalik.
    expect(activeJournals).toHaveLength(1);
    expect(activeJournals[0].status).toBe("posted");
    expect(journals.reversedIds.has(activeJournals[0].id)).toBe(false);
  });
});
