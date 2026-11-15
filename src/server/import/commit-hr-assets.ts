import type { Tx } from "@/db";
import { accounts, employees, fixedAssetCategories, fixedAssets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { toDb } from "@/lib/money";
import type { MappedEmployee, MappedFixedAsset } from "@/lib/import-parse";
import { registerFixedAsset } from "@/server/fixed-assets";
import type { SimpleMasterResult } from "./commit-commerce";
import { markRow } from "./shared";

/** Commit karyawan & aset tetap — dipisah agar commit.ts tetap ≤800 baris. */

export type EmployeeCommitContext = {
  tx: Tx;
  companyId: string;
  existingCodes: Map<string, string>;
  existingNiks: Set<string>;
  seenCodes: Set<string>;
  seenNiks: Set<string>;
  nextCode: (prefix: string, seq: number) => { code: string; seq: number };
  seq: number;
};

export async function commitEmployee(
  ctx: EmployeeCommitContext,
  value: MappedEmployee,
): Promise<{ result: SimpleMasterResult; seq: number }> {
  const codeKey = value.code?.toLowerCase() ?? null;
  if (codeKey && ctx.seenCodes.has(codeKey)) {
    return {
      result: { status: "error", message: "Kode karyawan duplikat di file" },
      seq: ctx.seq,
    };
  }
  if (codeKey) ctx.seenCodes.add(codeKey);
  if (codeKey && ctx.existingCodes.has(codeKey)) {
    return {
      result: { status: "skipped", message: "Karyawan sudah ada", id: ctx.existingCodes.get(codeKey) },
      seq: ctx.seq,
    };
  }
  if (value.nik) {
    if (ctx.seenNiks.has(value.nik)) {
      return { result: { status: "error", message: `NIK ${value.nik} duplikat di file` }, seq: ctx.seq };
    }
    ctx.seenNiks.add(value.nik);
    if (ctx.existingNiks.has(value.nik)) {
      return { result: { status: "skipped", message: "NIK sudah terdaftar" }, seq: ctx.seq };
    }
  }
  let code = value.code;
  let seq = ctx.seq;
  if (!code) {
    const generated = ctx.nextCode("EMP", seq);
    code = generated.code;
    seq = generated.seq;
  }
  const [created] = await ctx.tx
    .insert(employees)
    .values({
      companyId: ctx.companyId,
      code,
      name: value.name,
      position: value.position,
      baseSalary: toDb(value.baseSalary),
      allowances: toDb(value.allowances),
      deductions: toDb(value.deductions),
      joinedAt: value.joinedAt,
      nik: value.nik,
      npwp: value.npwp,
      ptkpStatus: value.ptkpStatus,
      gender: value.gender,
      contractType: value.contractType,
      isActive: value.isActive,
    })
    .onConflictDoNothing()
    .returning({ id: employees.id });
  if (!created) {
    return { result: { status: "skipped", message: "Karyawan sudah ada" }, seq };
  }
  ctx.existingCodes.set(code.toLowerCase(), created.id);
  return { result: { status: "imported", id: created.id }, seq };
}

export type FixedAssetCommitContext = {
  tx: Tx;
  companyId: string;
  userId: string;
  categoryByName: Map<string, string>;
  accountIdByCode: Map<string, string>;
  existingKeys: Set<string>;
  keysInFile: Set<string>;
};

/** Kunci idempoten aset: nama + tanggal perolehan + harga. */
export function fixedAssetKey(name: string, date: string, cost: number): string {
  return `${name.trim().toLowerCase()}|${date}|${cost.toFixed(4)}`;
}

export async function commitFixedAsset(
  ctx: FixedAssetCommitContext,
  value: MappedFixedAsset,
): Promise<SimpleMasterResult> {
  const key = fixedAssetKey(value.name, value.acquisitionDate, value.cost);
  if (ctx.keysInFile.has(key)) {
    return { status: "error", message: "Aset yang sama duplikat di file" };
  }
  ctx.keysInFile.add(key);
  if (ctx.existingKeys.has(key)) {
    return { status: "skipped", message: "Aset sudah ada" };
  }
  const sourceAccountId = ctx.accountIdByCode.get(value.sourceAccountCode.toLowerCase());
  if (!sourceAccountId) {
    return {
      status: "error",
      message: `Kode akun sumber "${value.sourceAccountCode}" tidak ditemukan`,
    };
  }
  let categoryId: string | null = null;
  if (value.category) {
    categoryId =
      ctx.categoryByName.get(value.category.trim().toLowerCase()) ?? null;
    if (!categoryId) {
      return { status: "error", message: `Kategori aset "${value.category}" tidak ditemukan` };
    }
  }
  try {
    const created = await registerFixedAsset(ctx.tx, {
      companyId: ctx.companyId,
      userId: ctx.userId,
      name: value.name,
      categoryId,
      acquisitionDate: value.acquisitionDate,
      cost: value.cost,
      residualValue: value.residualValue,
      usefulLifeMonths: value.usefulLifeMonths,
      sourceAccountId,
      serialOrNote: value.notes,
    });
    return { status: "imported", id: created.id };
  } catch (error) {
    if (error instanceof AppError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function markHrAssetResult(
  tx: Tx,
  rowId: string,
  result: SimpleMasterResult,
): Promise<{ imported: number; skipped: number; failed: number }> {
  if (result.status === "imported") {
    await markRow(tx, rowId, "imported", null, result.id);
    return { imported: 1, skipped: 0, failed: 0 };
  }
  if (result.status === "skipped") {
    await markRow(tx, rowId, "skipped", result.message, result.id);
    return { imported: 0, skipped: 1, failed: 0 };
  }
  await markRow(tx, rowId, "error", result.message);
  return { imported: 0, skipped: 0, failed: 1 };
}

export async function loadEmployeeExisting(tx: Tx, companyId: string) {
  const rows = await tx
    .select({ id: employees.id, code: employees.code, nik: employees.nik })
    .from(employees)
    .where(eq(employees.companyId, companyId));
  const codes = new Map<string, string>();
  const niks = new Set<string>();
  for (const row of rows) {
    codes.set(row.code.toLowerCase(), row.id);
    if (row.nik) niks.add(row.nik);
  }
  return { codes, niks, count: rows.length };
}

export async function loadFixedAssetExisting(tx: Tx, companyId: string) {
  const [assetRows, categoryRows, accountRows] = await Promise.all([
    tx
      .select({ name: fixedAssets.name, acquisitionDate: fixedAssets.acquisitionDate, cost: fixedAssets.cost })
      .from(fixedAssets)
      .where(eq(fixedAssets.companyId, companyId)),
    tx
      .select({ id: fixedAssetCategories.id, code: fixedAssetCategories.code, name: fixedAssetCategories.name })
      .from(fixedAssetCategories)
      .where(eq(fixedAssetCategories.companyId, companyId)),
    tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, companyId)),
  ]);
  const categoryByName = new Map<string, string>();
  for (const row of categoryRows) {
    categoryByName.set(row.code.toLowerCase(), row.id);
    categoryByName.set(row.name.toLowerCase(), row.id);
  }
  const accountIdByCode = new Map<string, string>();
  for (const row of accountRows) accountIdByCode.set(row.code.toLowerCase(), row.id);
  const keys = new Set<string>();
  for (const row of assetRows) {
    keys.add(`${row.name.trim().toLowerCase()}|${row.acquisitionDate}|${Number(row.cost).toFixed(4)}`);
  }
  return { categoryByName, accountIdByCode, keys };
}
