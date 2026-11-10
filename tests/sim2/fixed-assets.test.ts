import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  fixedAssetDepreciationRuns,
  fixedAssetDepreciations,
  journalEntries,
  journalLines,
  member,
  organization,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  disposeFixedAsset,
  getFixedAssetBookValues,
  registerFixedAsset,
  runFixedAssetDepreciation,
  saveFixedAssetCategory,
  voidFixedAssetDepreciationRun,
} from "@/server/fixed-assets";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-2 Batch 2 — Aset tetap & penyusutan (§8).
 *
 * Aset Rp12.000.000, umur 12 bulan, residu 0 → penyusutan garis lurus
 * tepat Rp1.000.000/bulan; sesudah 3 proses nilai buku Rp9.000.000;
 * proses ulang periode yang sama DITOLAK; total akumulasi laporan sama
 * dengan saldo GL akun akumulasi; pelepasan menghentikan penyusutan
 * dan menjurnal selisih nilai buku sebagai kerugian.
 */

const state = vi.hoisted(() => ({ org: "", user: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: state.org },
    user: { id: state.user },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e802";
const OWNER = "01900000-0000-7000-8000-00000000e852";


function expectMoney(actual: unknown, expected: number) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

const acc: Record<string, string> = {};
let categoryId = "";
let assetId = "";
let secondAssetId = "";

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(user).values({ id: OWNER, name: "Pemilik Uji", email: "owner-e802@bisa.id", emailVerified: true, role: "owner" });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji Aset", slug: "uji-aset", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Aset", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1500", name: "Peralatan Toko", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1510", name: "Akumulasi Penyusutan Peralatan", type: "asset", normalBalance: "credit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
    ])
    .returning();
  for (const row of rows) acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "equity", accountId: acc["3000"] },
  ]);
  state.org = ORG;
  state.user = OWNER;
}

async function glBalance(accountId: string): Promise<number> {
  const rows = await adminDb
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
      ),
    );
  return rows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("Aset tetap — registrasi & penyusutan", () => {
  it("kategori terkonfigurasi + registrasi aset menjurnal Dr Aset / Cr Kas", async () => {
    const category = await withCompany(ORG, (tx) =>
      saveFixedAssetCategory(tx, {
        companyId: ORG,
        code: "KND",
        name: "Kendaraan",
        defaultUsefulLifeMonths: 48,
      }),
    );
    categoryId = category.id;
    const asset = await withCompany(ORG, (tx) =>
      registerFixedAsset(tx, {
        companyId: ORG,
        userId: OWNER,
        name: "Mesin Kasir + Komputer",
        categoryId,
        acquisitionDate: "2026-01-10",
        cost: "12000000",
        residualValue: "0",
        usefulLifeMonths: 12,
        sourceAccountId: acc["1000"],
      }),
    );
    assetId = asset.id;
    expect(asset.number).toMatch(/^AST-/);
    const lines = await adminDb
      .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.sourceType, "fixed_asset_acquisition")));
    expectMoney(lines.find((l) => l.accountId === acc["1500"])?.debit, 12000000);
    expectMoney(lines.find((l) => l.accountId === acc["1000"])?.credit, 12000000);

    const second = await withCompany(ORG, (tx) =>
      registerFixedAsset(tx, {
        companyId: ORG,
        userId: OWNER,
        name: "Rak Display",
        acquisitionDate: "2026-01-20",
        cost: "2400000",
        residualValue: "0",
        usefulLifeMonths: 24,
        sourceAccountId: acc["1000"],
      }),
    );
    secondAssetId = second.id;
  });

  it("penyusutan bulanan tepat Rp1.000.000 dan proses ulang periode sama ditolak", async () => {
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const run = await withCompany(ORG, (tx) =>
        runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period }),
      );
      // Aset utama 1.000.000 + rak 100.000 per bulan.
      expectMoney(run.totalAmount, 1100000);
    }
    await expect(
      withCompany(ORG, (tx) =>
        runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period: "2026-02" }),
      ),
    ).rejects.toThrow();
    const rows = await adminDb
      .select()
      .from(fixedAssetDepreciations)
      .where(and(eq(fixedAssetDepreciations.companyId, ORG), eq(fixedAssetDepreciations.assetId, assetId)));
    expect(rows).toHaveLength(3);
    for (const row of rows) expectMoney(row.amount, 1000000);
    expectMoney(rows[2].accumulatedAfter, 3000000);
  });

  it("nilai buku laporan cocok dengan GL akumulasi penyusutan", async () => {
    const report = await withCompany(ORG, (tx) => getFixedAssetBookValues(tx, ORG));
    const main = report.rows.find((row) => row.id === assetId);
    expect(main).toBeTruthy();
    expectMoney(main!.bookValue, 9000000);
    expectMoney(report.totals.accumulated, 3300000);
    // Saldo GL akun 1510 adalah kredit 3.300.000 → debit−kredit = −3.300.000.
    expect(await glBalance(acc["1510"])).toBe(-3300000);
    expectMoney(report.totals.bookValue, 9000000 + 2100000);
  });

  it("void run penyusutan membalik jurnal dan membebaskan periode", async () => {
    const [marchRun] = await adminDb
      .select({ id: fixedAssetDepreciationRuns.id })
      .from(fixedAssetDepreciationRuns)
      .where(
        and(
          eq(fixedAssetDepreciationRuns.companyId, ORG),
          eq(fixedAssetDepreciationRuns.period, "2026-03"),
          eq(fixedAssetDepreciationRuns.status, "posted"),
        ),
      );
    const runId = marchRun.id;
    await withCompany(ORG, (tx) =>
      voidFixedAssetDepreciationRun(tx, { companyId: ORG, userId: OWNER, runId, reason: "Uji void" }),
    );
    expect(await glBalance(acc["1510"])).toBe(-2200000);
    const rerun = await withCompany(ORG, (tx) =>
      runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period: "2026-03" }),
    );
    expectMoney(rerun.totalAmount, 1100000);
    expect(await glBalance(acc["1510"])).toBe(-3300000);
  });

  it("pelepasan aset menghentikan penyusutan dan menjurnal kerugian selisih nilai buku", async () => {
    const disposed = await withCompany(ORG, (tx) =>
      disposeFixedAsset(tx, {
        companyId: ORG,
        userId: OWNER,
        assetId,
        date: "2026-04-15",
        proceeds: "8000000",
        proceedsAccountId: acc["1000"],
      }),
    );
    expect(disposed.status).toBe("disposed");
    // Nilai buku 9.000.000, laku 8.000.000 → rugi 1.000.000:
    // Dr Akumulasi 3.000.000 + Dr Kas 8.000.000 + Dr Rugi 1.000.000 / Cr Aset 12.000.000.
    const lines = await adminDb
      .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.sourceType, "fixed_asset_disposal")));
    expectMoney(lines.find((l) => l.accountId === acc["1510"])?.debit, 3000000);
    expectMoney(lines.find((l) => l.accountId === acc["1000"])?.debit, 8000000);
    expectMoney(lines.find((l) => l.accountId === acc["1500"])?.credit, 12000000);
    const lossLine = lines.find((l) => d(l.debit).eq(1000000));
    expect(lossLine).toBeTruthy();

    // Periode April: hanya rak yang masih disusutkan (100.000).
    const april = await withCompany(ORG, (tx) =>
      runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period: "2026-04" }),
    );
    expectMoney(april.totalAmount, 100000);
    const aprilRows = await adminDb
      .select()
      .from(fixedAssetDepreciations)
      .where(and(eq(fixedAssetDepreciations.companyId, ORG), eq(fixedAssetDepreciations.period, "2026-04")));
    expect(aprilRows).toHaveLength(1);
    expect(aprilRows[0].assetId).toBe(secondAssetId);
  });
});
