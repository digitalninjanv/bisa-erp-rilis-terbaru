import { describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, importJobs, importRows } from "@/db/schema";
import { postJournal } from "@/server/accounting";
import {
  getIncomeStatement,
} from "@/server/reports";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  ACCOUNT_MAPPING_KEYS,
  mappingAllowsAccountType,
} from "@/lib/account-mappings";
import {
  ENTITY_FIELDS,
  mapAccountRow,
  suggestMappingFor,
} from "@/lib/import-parse";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * Regresi integritas akuntansi:
 * - kontrak tipe akun untuk pemetaan (beban tidak boleh jadi pendapatan);
 * - impor bagan akun menolak section yang tidak sesuai tipe;
 * - laba rugi periode tidak memasukkan jurnal tutup buku;
 * - impor pemetaan akun menolak tipe akun yang salah.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const mod = {
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  };
  return { ...mod, requirePermissionInModule: mod.requirePermission };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const rollbackTransaction = makeRollbackTransaction(ORG_ID);
const suffix = crypto.randomUUID().slice(0, 8);

describe("integritas akuntansi", () => {
  it("setiap kunci pemetaan punya kontrak tipe akun", () => {
    for (const key of ACCOUNT_MAPPING_KEYS) {
      expect(mappingAllowsAccountType(key, "asset") || mappingAllowsAccountType(key, "liability") || mappingAllowsAccountType(key, "equity") || mappingAllowsAccountType(key, "revenue") || mappingAllowsAccountType(key, "cogs") || mappingAllowsAccountType(key, "expense")).toBe(true);
    }
    expect(mappingAllowsAccountType("revenue", "expense")).toBe(false);
    expect(mappingAllowsAccountType("cogs", "revenue")).toBe(false);
    expect(mappingAllowsAccountType("payable", "asset")).toBe(false);
    expect(mappingAllowsAccountType("revenue", "revenue")).toBe(true);
  });

  it("impor bagan akun menolak expense dengan section aset", () => {
    const mapping = suggestMappingFor(ENTITY_FIELDS.accounts, [
      "Kode",
      "Nama",
      "Tipe",
      "Bagian",
    ]);
    const mapped = mapAccountRow(
      {
        Kode: `TST-${suffix}`,
        Nama: "Beban Salah Kelompok",
        Tipe: "expense",
        Bagian: "current_asset",
      },
      mapping,
    );
    expect(mapped.error).toContain("tidak sesuai");
    expect(mapped.value).toBeUndefined();
  });

  it("laba rugi periode mengecualikan jurnal tutup buku", async () => {
    await rollbackTransaction(async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, code: accounts.code, type: accounts.type })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), inArray(accounts.code, ["400001", "600019"])));
      const revenue = rows.find((row) => row.code === "400001")!;
      const expense = rows.find((row) => row.code === "600019")!;
      const date = todayISO();

      const before = await getIncomeStatement(
        tx,
        ORG_ID,
        { from: date, to: date },
        { excludeClosing: true },
      );
      await postJournal(tx, {
        companyId: ORG_ID,
        date,
        description: "Uji tutup buku sintetis",
        sourceType: "year_end_closing",
        createdBy: USER_ID,
        lines: [
          { accountId: revenue.id, debit: 100_000, description: "Menutup pendapatan" },
          { accountId: expense.id, credit: 100_000, description: "Menutup beban" },
        ],
      });

      const included = await getIncomeStatement(tx, ORG_ID, { from: date, to: date });
      const excluded = await getIncomeStatement(
        tx,
        ORG_ID,
        { from: date, to: date },
        { excludeClosing: true },
      );
      // Jurnal tutup buku mengubah P&L default, tetapi tidak boleh
      // mengubah P&L periode yang mengecualikan closing.
      expect(included.totalRevenue).not.toBeCloseTo(before.totalRevenue, 2);
      expect(excluded.totalRevenue).toBeCloseTo(before.totalRevenue, 2);
      expect(excluded.totalOperatingExpense).toBeCloseTo(before.totalOperatingExpense, 2);
    });
  });

  it("impor pemetaan menolak akun beban untuk kunci revenue", async () => {
    const expense = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ code: accounts.code })
        .from(accounts)
        .where(
          and(
            eq(accounts.companyId, ORG_ID),
            eq(accounts.type, "expense"),
            eq(accounts.isPostable, true),
            eq(accounts.isActive, true),
          ),
        )
        .limit(1),
    );
    expect(expense[0]?.code).toBeTruthy();
    const mapping = suggestMappingFor(ENTITY_FIELDS.account_mappings, [
      "Kunci pemetaan",
      "Kode akun",
    ]);
    const jobId = await withCompany(ORG_ID, async (tx) => {
      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ORG_ID,
          entity: "account_mappings",
          fileName: `uji-pemetaan-${suffix}.xlsx`,
          status: "preview",
          totalRows: 1,
          mapping,
          createdBy: USER_ID,
        })
        .returning({ id: importJobs.id });
      await tx.insert(importRows).values({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: 1,
        data: { "Kunci pemetaan": "revenue", "Kode akun": expense[0]!.code },
        status: "pending",
      });
      return job.id;
    });
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.invalidRows).toBe(1);
    const commit = await commitImportBatchAction({ jobId, mapping, limit: 10 });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.data.failed).toBe(1);
    expect(commit.data.imported).toBe(0);

    await withCompany(ORG_ID, async (tx) => {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    });
  });
});
