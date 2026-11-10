"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { amountField, isoDateField, parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import {
  disposeFixedAsset,
  registerFixedAsset,
  runFixedAssetDepreciation,
  saveFixedAssetCategory,
  voidFixedAssetDepreciationRun,
} from "@/server/fixed-assets";

/**
 * SIM-2 S7B-2 Batch 2 — Server actions aset tetap (§8).
 * Baca: accounting.view; tulis: accounting.manage (modul akuntansi).
 */

function revalidateAssetPaths() {
  revalidatePath("/app/akuntansi/aset");
  revalidatePath("/app/akuntansi");
}

const categorySchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(120),
  defaultUsefulLifeMonths: z.number().int().min(1).max(1200).nullish(),
  defaultResidualPercent: amountField("Persen residu bawaan", "nonNegative").nullish(),
  assetAccountId: z.string().uuid().nullish(),
  accumulatedAccountId: z.string().uuid().nullish(),
  expenseAccountId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});

export async function saveFixedAssetCategoryAction(input: z.input<typeof categorySchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(categorySchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const saved = await saveFixedAssetCategory(tx, { companyId: ctx.company.id, ...data });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.id ? "fixed_asset_category.update" : "fixed_asset_category.create",
        entityType: "fixed_asset_category",
        entityId: saved.id,
        after: { code: saved.code, name: saved.name },
      });
      return saved;
    });
    revalidateAssetPaths();
    return row;
  });
}

const registerSchema = z.object({
  name: z.string().min(2).max(160),
  categoryId: z.string().uuid().nullish(),
  acquisitionDate: isoDateField,
  cost: amountField("Harga perolehan", "positive"),
  residualValue: amountField("Nilai residu", "nonNegative").nullish(),
  usefulLifeMonths: z.number().int().min(1).max(1200).nullish(),
  sourceAccountId: z.string().uuid(),
  notes: z.string().max(300).optional(),
});

export async function registerFixedAssetAction(input: z.input<typeof registerSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(registerSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const created = await registerFixedAsset(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        name: data.name,
        categoryId: data.categoryId ?? null,
        acquisitionDate: data.acquisitionDate,
        cost: data.cost,
        residualValue: data.residualValue ?? null,
        usefulLifeMonths: data.usefulLifeMonths ?? null,
        sourceAccountId: data.sourceAccountId,
        serialOrNote: data.notes ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "fixed_asset.create",
        entityType: "fixed_asset",
        entityId: created.id,
        after: { number: created.number, name: created.name, cost: created.cost },
      });
      return created;
    });
    revalidateAssetPaths();
    return row;
  });
}

const runSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });

export async function runDepreciationAction(input: z.input<typeof runSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(runSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const run = await runFixedAssetDepreciation(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        period: data.period,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "fixed_asset_depreciation.run",
        entityType: "fixed_asset_depreciation_run",
        entityId: run.id,
        after: { period: run.period, totalAmount: run.totalAmount },
      });
      return run;
    });
    revalidateAssetPaths();
    return row;
  });
}

const voidRunSchema = z.object({
  runId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export async function voidDepreciationRunAction(input: z.input<typeof voidRunSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(voidRunSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const run = await voidFixedAssetDepreciationRun(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        runId: data.runId,
        reason: data.reason ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "fixed_asset_depreciation.void",
        entityType: "fixed_asset_depreciation_run",
        entityId: run.id,
        after: { period: run.period },
      });
      return run;
    });
    revalidateAssetPaths();
    return row;
  });
}

const disposeSchema = z.object({
  assetId: z.string().uuid(),
  date: isoDateField,
  proceeds: amountField("Hasil pelepasan", "nonNegative"),
  proceedsAccountId: z.string().uuid(),
});

export async function disposeFixedAssetAction(input: z.input<typeof disposeSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(disposeSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const disposed = await disposeFixedAsset(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        assetId: data.assetId,
        date: data.date,
        proceeds: data.proceeds,
        proceedsAccountId: data.proceedsAccountId,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "fixed_asset.dispose",
        entityType: "fixed_asset",
        entityId: disposed.id,
        after: { number: disposed.number, disposalDate: disposed.disposalDate, proceeds: disposed.disposalProceeds },
      });
      return disposed;
    });
    revalidateAssetPaths();
    return row;
  });
}
