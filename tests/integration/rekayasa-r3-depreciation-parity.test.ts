import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  fixedAssetDepreciationRuns,
  fixedAssetDepreciations,
  member,
  organization,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  getFixedAssetBookValues,
  registerFixedAsset,
  runFixedAssetDepreciation,
  saveFixedAssetCategory,
} from "@/server/fixed-assets";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// Program Rekayasa — R3 K-8: test KARAKTERISASI paritas agregasi
// akumulasi penyusutan. Ditulis & dibuktikan hijau pada implementasi
// LAMA (kueri per-aset), lalu implementasi diganti peta agregat satu
// kueri (SUM … GROUP BY, filter run posted yang sama) — test ini
// TIDAK berubah dan wajib tetap hijau persis sama.
//
// Fixture: 3 aset × 2 run posted + 1 run VOID berisi baris raksasa
// yang WAJIB tetap terkecuali dari semua total.
//   A1: biaya 12.000.000, umur 12, residu 0, peroleh 2026-01-10
//       → 1.000.000/bln
//   A2: biaya 6.000.000, umur 24, residu 1.200.000, peroleh 2026-01-20
//       → (6.000.000−1.200.000)/24 = 200.000/bln
//   A3: biaya 999.999, umur 3, residu 0, peroleh 2026-02-05
//       → 333.333/bln (mulai Februari)
// Run 2026-01 = A1+A2 = 1.200.000; run 2026-02 = +A3 = 1.533.333.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000e361";
const OWNER = "01900000-0000-7000-8000-00000000e371";

function expectMoney(actual: unknown, expected: number) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

const acc: Record<string, string> = {};
const assetIds: Record<string, string> = {};

async function wipeFixture() {
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(user).values({ id: OWNER, name: "Pemilik Uji K8", email: "owner-e361@bisa.id", emailVerified: true, role: "owner" });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji K8", slug: "uji-k8", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji K8", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
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
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("K-8 — paritas akumulasi penyusutan (karakterisasi)", () => {
  it("registrasi 3 aset + 2 run posted menghasilkan total run yang tepat", async () => {
    const category = await withCompany(ORG, (tx) =>
      saveFixedAssetCategory(tx, { companyId: ORG, code: "K8", name: "Kategori K8", defaultUsefulLifeMonths: 12 }),
    );
    const mk = (name: string, acquisitionDate: string, cost: string, residualValue: string, usefulLifeMonths: number) =>
      withCompany(ORG, (tx) =>
        registerFixedAsset(tx, {
          companyId: ORG, userId: OWNER, name, categoryId: category.id,
          acquisitionDate, cost, residualValue, usefulLifeMonths, sourceAccountId: acc["1000"],
        }),
      );
    assetIds.a1 = (await mk("Aset A1", "2026-01-10", "12000000", "0", 12)).id;
    assetIds.a2 = (await mk("Aset A2", "2026-01-20", "6000000", "1200000", 24)).id;
    assetIds.a3 = (await mk("Aset A3", "2026-02-05", "999999", "0", 3)).id;

    const run1 = await withCompany(ORG, (tx) =>
      runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period: "2026-01" }),
    );
    expectMoney(run1.totalAmount, 1200000);
    expect(run1.assetCount).toBe(2);
    const run2 = await withCompany(ORG, (tx) =>
      runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period: "2026-02" }),
    );
    expectMoney(run2.totalAmount, 1533333);
    expect(run2.assetCount).toBe(3);
  });

  it("run VOID berisi baris raksasa TIDAK mengubah nilai buku maupun total", async () => {
    const [voidRun] = await adminDb
      .insert(fixedAssetDepreciationRuns)
      .values({ companyId: ORG, period: "2025-06", totalAmount: "777000000", status: "void", createdBy: OWNER })
      .returning();
    await adminDb.insert(fixedAssetDepreciations).values({
      companyId: ORG, runId: voidRun.id, assetId: assetIds.a1, period: "2025-06",
      amount: "777000000", accumulatedAfter: "779000000",
    });

    const book = await withCompany(ORG, (tx) => getFixedAssetBookValues(tx, ORG));
    const byId = new Map(book.rows.map((r) => [r.id, r]));
    expectMoney(byId.get(assetIds.a1)?.accumulated, 2000000);
    expectMoney(byId.get(assetIds.a1)?.bookValue, 10000000);
    expectMoney(byId.get(assetIds.a2)?.accumulated, 400000);
    expectMoney(byId.get(assetIds.a2)?.bookValue, 5600000);
    expectMoney(byId.get(assetIds.a3)?.accumulated, 333333);
    expectMoney(byId.get(assetIds.a3)?.bookValue, 666666);
    expectMoney(book.totals.accumulated, 2733333);
    expectMoney(book.totals.bookValue, 16266666);
  });

  it("run bulan berikutnya memakai akumulasi yang sama (jalur loop bulanan)", async () => {
    const run3 = await withCompany(ORG, (tx) =>
      runFixedAssetDepreciation(tx, { companyId: ORG, userId: OWNER, period: "2026-03" }),
    );
    expectMoney(run3.totalAmount, 1533333);
    const book = await withCompany(ORG, (tx) => getFixedAssetBookValues(tx, ORG));
    expectMoney(book.totals.accumulated, 4266666);
  });
});
