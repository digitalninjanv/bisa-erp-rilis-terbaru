import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  fixedAssetCategories,
  fixedAssetDepreciationRuns,
  fixedAssetDepreciations,
  fixedAssets,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import { ensureSystemAccounts } from "@/server/system-accounts";
import { nextDocumentNumber } from "@/server/sequences";
import { listJournalNumbersById } from "@/server/catalog";
import { postJournal, reverseSourceJournal } from "./accounting";

/**
 * SIM-2 S7B-2 Batch 2 — Aset tetap & penyusutan (§8).
 *
 * Metode garis lurus saja. Semua akun (aset, akumulasi, beban penyusutan,
 * laba/rugi pelepasan) diambil dari pemetaan `account_mappings`; kategori
 * boleh membawakan akun sendiri yang mengalahkan pemetaan. Tidak ada
 * angka regulasi di kode: umur manfaat & nilai residu adalah input per
 * aset dengan bawaan dari kategori.
 *
 * Konvensi periode: penyusutan dihitung untuk bulan perolehan itu
 * sendiri (inklusif) sampai bulan terakhir umur manfaat; bulan terakhir
 * menyerap sisa pembulatan sehingga akumulasi tidak pernah melebihi
 * (harga perolehan − nilai residu). Pelepasan menghentikan penyusutan
 * mulai bulan pelepasannya.
 */

export const FIXED_ASSET_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  disposed: "Dilepas",
};

type AccountSpec = {
  key: string;
  code: string;
  fallbackCode: string;
  name: string;
  type: "asset" | "expense" | "revenue";
  normalBalance: "debit" | "credit";
  // FIX-R2 Tahap 3 (AK2-04): akun sistem yang dibuat jalur ensure ini
  // membawa kelompok laporannya secara eksplisit — fallback laporan
  // tidak lagi menebak dari kode akun.
  section: string;
  cashFlowGroup: string;
};

const FIXED_ASSET_ACCOUNT_SPECS: AccountSpec[] = [
  { key: "fixed_asset", code: "1500", fallbackCode: "1500-AST", name: "Aset Tetap", type: "asset", normalBalance: "debit", section: "non_current_asset", cashFlowGroup: "investing" },
  { key: "accumulated_depreciation", code: "1510", fallbackCode: "1510-AKM", name: "Akumulasi Penyusutan", type: "asset", normalBalance: "credit", section: "non_current_asset", cashFlowGroup: "investing" },
  { key: "depreciation_expense", code: "6090", fallbackCode: "6090-SST", name: "Beban Penyusutan", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
  { key: "asset_disposal_gain", code: "4030", fallbackCode: "4030-LPS", name: "Pendapatan Lain-lain", type: "revenue", normalBalance: "credit", section: "other_income", cashFlowGroup: "operating" },
  { key: "asset_disposal_loss", code: "6070", fallbackCode: "6070-RPS", name: "Beban Lain-lain", type: "expense", normalBalance: "debit", section: "other_expense", cashFlowGroup: "operating" },
];

/**
 * Pastikan akun & pemetaan aset tetap ada (pola ensure S2): pemetaan
 * yang sudah ada tidak pernah ditimpa. Akun dicari dulu berdasarkan
 * kode standar bagan akun (1500/1510 memang akun aset tetap bawaan),
 * lalu nama, barulah dibuat baru (kode standar atau kode awalan bila
 * kode standar dipakai akun lain).
 */
export async function ensureFixedAssetAccounts(
  tx: Tx,
  companyId: string,
): Promise<Record<string, string>> {
  // R3 K-2: algoritma ensure kini hidup SATU di server/system-accounts
  // (mekanik peta-memori berkas inilah yang menjadi mekanik gabungan);
  // berkas ini menyimpan daftar spec + pasca-langkah kontranya.
  const map = new Map(
    Object.entries(await ensureSystemAccounts(tx, companyId, FIXED_ASSET_ACCOUNT_SPECS)),
  );
  // A-27 B5: akumulasi penyusutan adalah akun KONTRA dari aset tetap —
  // tandai dari pasangan kunci pemetaannya (satu-satunya pasangan
  // kontra yang lahir dari jalur ensure ini), termasuk bila akunnya
  // sudah ada dari sebelum B5 (update idempoten, hanya mengisi).
  const fixedAssetId = map.get("fixed_asset");
  const accumulatedId = map.get("accumulated_depreciation");
  if (fixedAssetId && accumulatedId && fixedAssetId !== accumulatedId) {
    await tx
      .update(accounts)
      .set({ isContra: true, contraOf: fixedAssetId })
      .where(
        and(
          eq(accounts.companyId, companyId),
          eq(accounts.id, accumulatedId),
          eq(accounts.isContra, false),
        ),
      );
  }
  return Object.fromEntries(map);
}

async function assertPostableAccount(tx: Tx, companyId: string, accountId: string, label: string) {
  const [account] = await tx
    .select({ id: accounts.id, isPostable: accounts.isPostable, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account || !account.isPostable || !account.isActive) {
    throw new AppError("VALIDATION", `${label} harus akun aktif yang dapat diposting.`);
  }
}

// ─── Kategori ──────────────────────────────────────────────────────────

export type FixedAssetCategoryInput = {
  companyId: string;
  id?: string;
  code: string;
  name: string;
  defaultUsefulLifeMonths?: number | null;
  defaultResidualPercent?: MoneyInput | null;
  assetAccountId?: string | null;
  accumulatedAccountId?: string | null;
  expenseAccountId?: string | null;
  isActive?: boolean;
};

export async function saveFixedAssetCategory(tx: Tx, input: FixedAssetCategoryInput) {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || name.length < 2) {
    throw new AppError("VALIDATION", "Kode dan nama kategori aset wajib diisi.");
  }
  if (input.defaultUsefulLifeMonths != null && input.defaultUsefulLifeMonths < 1) {
    throw new AppError("VALIDATION", "Umur manfaat bawaan kategori minimal 1 bulan.");
  }
  const values = {
    companyId: input.companyId,
    code,
    name,
    defaultUsefulLifeMonths: input.defaultUsefulLifeMonths ?? null,
    defaultResidualPercent:
      input.defaultResidualPercent != null ? toDb(input.defaultResidualPercent) : null,
    assetAccountId: input.assetAccountId ?? null,
    accumulatedAccountId: input.accumulatedAccountId ?? null,
    expenseAccountId: input.expenseAccountId ?? null,
    isActive: input.isActive ?? true,
  };
  if (input.id) {
    const [row] = await tx
      .update(fixedAssetCategories)
      .set(values)
      .where(and(eq(fixedAssetCategories.companyId, input.companyId), eq(fixedAssetCategories.id, input.id)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Kategori aset tidak ditemukan.");
    return row;
  }
  const clash = await tx
    .select({ id: fixedAssetCategories.id })
    .from(fixedAssetCategories)
    .where(and(eq(fixedAssetCategories.companyId, input.companyId), eq(fixedAssetCategories.code, code)))
    .limit(1);
  if (clash.length > 0) {
    throw new AppError("CONFLICT", `Kode kategori ${code} sudah dipakai.`);
  }
  const [row] = await tx.insert(fixedAssetCategories).values(values).returning();
  return row;
}

export async function listFixedAssetCategories(tx: Tx, companyId: string) {
  return tx
    .select()
    .from(fixedAssetCategories)
    .where(eq(fixedAssetCategories.companyId, companyId))
    .orderBy(asc(fixedAssetCategories.code));
}

type AssetAccountSet = {
  assetAccountId: string;
  accumulatedAccountId: string;
  expenseAccountId: string;
};

/**
 * Akun aset/akumulasi/beban untuk satu aset: akun pada kategorinya
 * mengalahkan pemetaan perusahaan; pemetaan dilengkapi ensure (D-25).
 */
export async function resolveAssetAccounts(
  tx: Tx,
  companyId: string,
  categoryId: string | null,
): Promise<AssetAccountSet> {
  const map = await ensureFixedAssetAccounts(tx, companyId);
  let category: typeof fixedAssetCategories.$inferSelect | null = null;
  if (categoryId) {
    const [row] = await tx
      .select()
      .from(fixedAssetCategories)
      .where(and(eq(fixedAssetCategories.companyId, companyId), eq(fixedAssetCategories.id, categoryId)))
      .limit(1);
    category = row ?? null;
  }
  const resolved = {
    assetAccountId: category?.assetAccountId ?? map.fixed_asset,
    accumulatedAccountId: category?.accumulatedAccountId ?? map.accumulated_depreciation,
    expenseAccountId: category?.expenseAccountId ?? map.depreciation_expense,
  };
  if (!resolved.assetAccountId || !resolved.accumulatedAccountId || !resolved.expenseAccountId) {
    throw new AppError("VALIDATION", "Pemetaan akun aset tetap belum lengkap.");
  }
  return resolved as AssetAccountSet;
}

// ─── Registrasi aset ───────────────────────────────────────────────────

export async function registerFixedAsset(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    name: string;
    categoryId?: string | null;
    acquisitionDate: string;
    cost: MoneyInput;
    residualValue?: MoneyInput | null;
    usefulLifeMonths?: number | null;
    sourceAccountId: string;
    serialOrNote?: string | null;
  },
) {
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("VALIDATION", "Nama aset wajib diisi.");
  const cost = d(input.cost);
  if (cost.lte(0)) throw new AppError("VALIDATION", "Harga perolehan harus lebih dari nol.");

  let category: typeof fixedAssetCategories.$inferSelect | null = null;
  if (input.categoryId) {
    const [row] = await tx
      .select()
      .from(fixedAssetCategories)
      .where(and(eq(fixedAssetCategories.companyId, input.companyId), eq(fixedAssetCategories.id, input.categoryId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Kategori aset tidak ditemukan.");
    category = row;
  }

  const life = input.usefulLifeMonths ?? category?.defaultUsefulLifeMonths ?? null;
  if (!life || life < 1) {
    throw new AppError("VALIDATION", "Umur manfaat (bulan) wajib diisi — dari aset atau bawaan kategori.");
  }
  let residual: ReturnType<typeof d>;
  if (input.residualValue != null) {
    residual = d(input.residualValue);
  } else if (category?.defaultResidualPercent != null) {
    residual = cost.mul(d(category.defaultResidualPercent)).div(100);
  } else {
    residual = d(0);
  }
  if (residual.lt(0) || residual.gte(cost)) {
    throw new AppError("VALIDATION", "Nilai residu harus nol atau lebih dan lebih kecil dari harga perolehan.");
  }

  await assertPostableAccount(tx, input.companyId, input.sourceAccountId, "Akun sumber perolehan");
  const { assetAccountId } = await resolveAssetAccounts(tx, input.companyId, category?.id ?? null);

  const number = await nextDocumentNumber(tx, input.companyId, "FIXED_ASSET", input.acquisitionDate);
  const [asset] = await tx
    .insert(fixedAssets)
    .values({
      companyId: input.companyId,
      number,
      name,
      categoryId: category?.id ?? null,
      acquisitionDate: input.acquisitionDate,
      cost: toDb(cost),
      residualValue: toDb(residual),
      usefulLifeMonths: life,
      sourceAccountId: input.sourceAccountId,
      notes: input.serialOrNote ?? null,
      createdBy: input.userId,
    })
    .returning();

  const journal = await postJournal(tx, {
    companyId: input.companyId,
    createdBy: input.userId,
    date: input.acquisitionDate,
    description: `Perolehan aset tetap ${number} — ${name}`,
    sourceType: "fixed_asset_acquisition",
    sourceId: asset.id,
    idempotencyKey: `fixed_asset_acquisition:${asset.id}`,
    lines: [
      { accountId: assetAccountId, debit: toDb(cost), description: `Perolehan ${name}` },
      { accountId: input.sourceAccountId, credit: toDb(cost), description: `Sumber dana perolehan ${number}` },
    ],
  });
  await tx
    .update(fixedAssets)
    .set({ journalId: journal.id })
    .where(and(eq(fixedAssets.companyId, input.companyId), eq(fixedAssets.id, asset.id)));
  return { ...asset, journalId: journal.id };
}

// ─── Penyusutan ────────────────────────────────────────────────────────

export function periodEnd(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

/** Jumlah bulan penyusutan yang sudah jatuh tempo sampai periode ini (0 bila belum mulai). */
export function monthsElapsed(acquisitionDate: string, period: string): number {
  const [ay, am] = acquisitionDate.split("-").map(Number);
  const [py, pm] = period.split("-").map(Number);
  return (py - ay) * 12 + (pm - am) + 1;
}

export async function getAccumulatedDepreciation(
  tx: Tx,
  companyId: string,
  assetId: string,
): Promise<ReturnType<typeof d>> {
  const rows = await tx
    .select({ amount: fixedAssetDepreciations.amount })
    .from(fixedAssetDepreciations)
    .innerJoin(
      fixedAssetDepreciationRuns,
      eq(fixedAssetDepreciations.runId, fixedAssetDepreciationRuns.id),
    )
    .where(
      and(
        eq(fixedAssetDepreciations.companyId, companyId),
        eq(fixedAssetDepreciations.assetId, assetId),
        eq(fixedAssetDepreciationRuns.status, "posted"),
      ),
    );
  return rows.reduce(
    (sum: ReturnType<typeof d>, row: { amount: string }) => sum.plus(row.amount),
    d(0),
  );
}

/**
 * R3 K-8: versi batch dari getAccumulatedDepreciation — SATU kueri
 * agregat (SUM … GROUP BY) dengan filter yang persis sama (run
 * berstatus "posted" saja) untuk banyak aset sekaligus; menggantikan
 * pola N+1 pada loop run bulanan & daftar nilai buku. SUM atas
 * numeric(19,4) di PostgreSQL eksak, jadi hasilnya identik dengan
 * penjumlahan Decimal per baris pada helper tunggal di atas (aset
 * tanpa baris posted tidak muncul di peta = akumulasi 0).
 */
export async function getAccumulatedDepreciationMap(
  tx: Tx,
  companyId: string,
  assetIds: string[],
): Promise<Map<string, ReturnType<typeof d>>> {
  const result = new Map<string, ReturnType<typeof d>>();
  if (assetIds.length === 0) return result;
  const rows = await tx
    .select({
      assetId: fixedAssetDepreciations.assetId,
      total: sql<string>`coalesce(sum(${fixedAssetDepreciations.amount}), 0)`,
    })
    .from(fixedAssetDepreciations)
    .innerJoin(
      fixedAssetDepreciationRuns,
      eq(fixedAssetDepreciations.runId, fixedAssetDepreciationRuns.id),
    )
    .where(
      and(
        eq(fixedAssetDepreciations.companyId, companyId),
        inArray(fixedAssetDepreciations.assetId, assetIds),
        eq(fixedAssetDepreciationRuns.status, "posted"),
      ),
    )
    .groupBy(fixedAssetDepreciations.assetId);
  for (const row of rows) result.set(row.assetId, d(row.total));
  return result;
}

/** Nominal penyusutan aset untuk satu periode (0 bila di luar jendela umur/disposal). */
export function monthlyDepreciationAmount(
  asset: { acquisitionDate: string; cost: string; residualValue: string; usefulLifeMonths: number; disposalDate: string | null; status: string },
  accumulatedBefore: ReturnType<typeof d>,
  period: string,
): ReturnType<typeof d> {
  if (asset.disposalDate && period >= asset.disposalDate.slice(0, 7)) return d(0);
  const elapsed = monthsElapsed(asset.acquisitionDate, period);
  if (elapsed < 1 || elapsed > asset.usefulLifeMonths) return d(0);
  const depreciable = d(asset.cost).minus(asset.residualValue);
  const remaining = depreciable.minus(accumulatedBefore);
  if (remaining.lte(0)) return d(0);
  const monthly = depreciable.div(asset.usefulLifeMonths).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return monthly.lt(remaining) ? monthly : remaining;
}

export async function runFixedAssetDepreciation(
  tx: Tx,
  input: { companyId: string; userId: string; period: string; date?: string },
) {
  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    throw new AppError("VALIDATION", "Periode penyusutan harus berformat YYYY-MM.");
  }
  const existing = await tx
    .select({ id: fixedAssetDepreciationRuns.id })
    .from(fixedAssetDepreciationRuns)
    .where(
      and(
        eq(fixedAssetDepreciationRuns.companyId, input.companyId),
        eq(fixedAssetDepreciationRuns.period, input.period),
        ne(fixedAssetDepreciationRuns.status, "void"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new AppError("CONFLICT", `Penyusutan periode ${input.period} sudah diproses.`);
  }

  const assets = await tx
    .select()
    .from(fixedAssets)
    .where(and(eq(fixedAssets.companyId, input.companyId), eq(fixedAssets.status, "active")))
    .orderBy(asc(fixedAssets.acquisitionDate));

  type Planned = {
    asset: (typeof assets)[number];
    amount: ReturnType<typeof d>;
    accumulatedAfter: ReturnType<typeof d>;
    bookValueAfter: ReturnType<typeof d>;
  };
  const accumulatedByAsset = await getAccumulatedDepreciationMap(
    tx,
    input.companyId,
    assets.map((asset) => asset.id),
  );
  const planned: Planned[] = [];
  for (const asset of assets) {
    const accumulated = accumulatedByAsset.get(asset.id) ?? d(0);
    const amount = monthlyDepreciationAmount(asset, accumulated, input.period);
    if (amount.lte(0)) continue;
    planned.push({
      asset,
      amount,
      accumulatedAfter: accumulated.plus(amount),
      bookValueAfter: d(asset.cost).minus(accumulated).minus(amount),
    });
  }
  if (planned.length === 0) {
    throw new AppError("VALIDATION", `Tidak ada aset aktif yang perlu disusutkan pada periode ${input.period}.`);
  }

  const total = planned.reduce((sum, row) => sum.plus(row.amount), d(0));
  const [run] = await tx
    .insert(fixedAssetDepreciationRuns)
    .values({
      companyId: input.companyId,
      period: input.period,
      totalAmount: toDb(total),
      createdBy: input.userId,
    })
    .returning();
  await tx.insert(fixedAssetDepreciations).values(
    planned.map((row) => ({
      companyId: input.companyId,
      runId: run.id,
      assetId: row.asset.id,
      period: input.period,
      amount: toDb(row.amount),
      accumulatedAfter: toDb(row.accumulatedAfter),
      bookValueAfter: toDb(row.bookValueAfter),
    })),
  );

  const debitByAccount = new Map<string, ReturnType<typeof d>>();
  const creditByAccount = new Map<string, ReturnType<typeof d>>();
  for (const row of planned) {
    const resolved = await resolveAssetAccounts(tx, input.companyId, row.asset.categoryId);
    debitByAccount.set(resolved.expenseAccountId, (debitByAccount.get(resolved.expenseAccountId) ?? d(0)).plus(row.amount));
    creditByAccount.set(resolved.accumulatedAccountId, (creditByAccount.get(resolved.accumulatedAccountId) ?? d(0)).plus(row.amount));
  }
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    createdBy: input.userId,
    date: input.date ?? periodEnd(input.period),
    description: `Penyusutan aset tetap periode ${input.period}`,
    sourceType: "fixed_asset_depreciation",
    sourceId: run.id,
    idempotencyKey: `fixed_asset_depreciation:${run.id}`,
    lines: [
      ...[...debitByAccount.entries()].map(([accountId, amount]) => ({
        accountId,
        debit: toDb(amount),
        description: `Beban penyusutan ${input.period}`,
      })),
      ...[...creditByAccount.entries()].map(([accountId, amount]) => ({
        accountId,
        credit: toDb(amount),
        description: `Akumulasi penyusutan ${input.period}`,
      })),
    ],
  });
  await tx
    .update(fixedAssetDepreciationRuns)
    .set({ journalId: journal.id })
    .where(and(eq(fixedAssetDepreciationRuns.companyId, input.companyId), eq(fixedAssetDepreciationRuns.id, run.id)));
  return { ...run, journalId: journal.id, totalAmount: toDb(total), assetCount: planned.length };
}

export async function voidFixedAssetDepreciationRun(
  tx: Tx,
  input: { companyId: string; userId: string; runId: string; reason?: string | null },
) {
  const [run] = await tx
    .select()
    .from(fixedAssetDepreciationRuns)
    .where(and(eq(fixedAssetDepreciationRuns.companyId, input.companyId), eq(fixedAssetDepreciationRuns.id, input.runId)))
    .limit(1);
  if (!run) throw new AppError("NOT_FOUND", "Proses penyusutan tidak ditemukan.");
  if (run.status === "void") throw new AppError("CONFLICT", "Proses penyusutan ini sudah dibatalkan.");
  await reverseSourceJournal(tx, {
    companyId: input.companyId,
    sourceType: "fixed_asset_depreciation",
    sourceId: run.id,
    date: periodEnd(run.period),
    description: `Pembatalan penyusutan periode ${run.period}${input.reason ? ` — ${input.reason}` : ""}`,
    createdBy: input.userId,
  });
  // Baris rincian adalah turunan dari run; jurnal pembalik menjaga audit,
  // baris dihapus agar periode dapat diproses ulang (indeks unik per aset).
  await tx
    .delete(fixedAssetDepreciations)
    .where(and(eq(fixedAssetDepreciations.companyId, input.companyId), eq(fixedAssetDepreciations.runId, run.id)));
  const [updated] = await tx
    .update(fixedAssetDepreciationRuns)
    .set({ status: "void" })
    .where(and(eq(fixedAssetDepreciationRuns.companyId, input.companyId), eq(fixedAssetDepreciationRuns.id, run.id)))
    .returning();
  return updated;
}

export async function listDepreciationRuns(tx: Tx, companyId: string) {
  return tx
    .select()
    .from(fixedAssetDepreciationRuns)
    .where(eq(fixedAssetDepreciationRuns.companyId, companyId))
    .orderBy(asc(fixedAssetDepreciationRuns.period));
}

// ─── Pelepasan ─────────────────────────────────────────────────────────

export async function disposeFixedAsset(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    userRole?: string | null;
    assetId: string;
    date: string;
    proceeds: MoneyInput;
    proceedsAccountId: string;
    note?: string | null;
  },
) {
  const [asset] = await tx
    .select()
    .from(fixedAssets)
    .where(and(eq(fixedAssets.companyId, input.companyId), eq(fixedAssets.id, input.assetId)))
    .limit(1)
    .for("update");
  if (!asset) throw new AppError("NOT_FOUND", "Aset tidak ditemukan.");
  if (asset.status !== "active") throw new AppError("CONFLICT", "Aset ini sudah dilepas.");

  // WF-024: Maker-checker pelepasan aset — pembuat aset tidak dapat melepas asetnya sendiri
  if (
    input.userRole &&
    input.userRole !== "owner" &&
    input.userRole !== "admin" &&
    input.userId &&
    asset.createdBy &&
    asset.createdBy === input.userId
  ) {
    throw new AppError(
      "FORBIDDEN",
      "Prinsip Maker-Checker (Four-Eyes Principle): Pelepasan aset tetap harus disahkan atau dilakukan oleh pengguna selain pendaftar aset tersebut.",
    );
  }
  const proceeds = d(input.proceeds);
  if (proceeds.lt(0)) throw new AppError("VALIDATION", "Hasil pelepasan tidak boleh negatif.");
  if (proceeds.gt(0)) {
    await assertPostableAccount(tx, input.companyId, input.proceedsAccountId, "Akun penerima hasil pelepasan");
  }
  const map = await ensureFixedAssetAccounts(tx, input.companyId);
  const resolved = await resolveAssetAccounts(tx, input.companyId, asset.categoryId);
  const accumulated = await getAccumulatedDepreciation(tx, input.companyId, asset.id);
  const bookValue = d(asset.cost).minus(accumulated);
  const gain = proceeds.minus(bookValue);

  const lines: Array<{ accountId: string; debit?: string; credit?: string; description?: string }> = [];
  if (accumulated.gt(0)) {
    lines.push({ accountId: resolved.accumulatedAccountId, debit: toDb(accumulated), description: "Tutup akumulasi penyusutan" });
  }
  if (proceeds.gt(0)) {
    lines.push({ accountId: input.proceedsAccountId, debit: toDb(proceeds), description: "Hasil pelepasan aset" });
  }
  if (gain.gt(0)) {
    lines.push({ accountId: map.asset_disposal_gain, credit: toDb(gain), description: "Laba pelepasan aset" });
  } else if (gain.lt(0)) {
    lines.push({ accountId: map.asset_disposal_loss, debit: toDb(gain.abs()), description: "Rugi pelepasan aset" });
  }
  lines.push({ accountId: resolved.assetAccountId, credit: toDb(asset.cost), description: `Keluarkan aset ${asset.number}` });

  const journal = await postJournal(tx, {
    companyId: input.companyId,
    createdBy: input.userId,
    date: input.date,
    description: `Pelepasan aset tetap ${asset.number} — ${asset.name}`,
    sourceType: "fixed_asset_disposal",
    sourceId: asset.id,
    idempotencyKey: `fixed_asset_disposal:${asset.id}`,
    lines,
  });
  const [updated] = await tx
    .update(fixedAssets)
    .set({
      status: "disposed",
      disposalDate: input.date,
      disposalProceeds: toDb(proceeds),
      disposalAccountId: proceeds.gt(0) ? input.proceedsAccountId : null,
      disposalJournalId: journal.id,
    })
    .where(and(eq(fixedAssets.companyId, input.companyId), eq(fixedAssets.id, asset.id)))
    .returning();
  return updated;
}

// ─── Laporan nilai buku ────────────────────────────────────────────────

export async function getFixedAssetBookValues(tx: Tx, companyId: string) {
  const assets = await tx
    .select({
      asset: fixedAssets,
      categoryName: fixedAssetCategories.name,
    })
    .from(fixedAssets)
    .leftJoin(fixedAssetCategories, eq(fixedAssets.categoryId, fixedAssetCategories.id))
    .where(eq(fixedAssets.companyId, companyId))
    .orderBy(asc(fixedAssets.acquisitionDate), asc(fixedAssets.number));
  const rows: Array<{
    id: string;
    number: string;
    name: string;
    categoryName: string | null;
    acquisitionDate: string;
    cost: string;
    residualValue: string;
    usefulLifeMonths: number;
    status: string;
    disposalDate: string | null;
    accumulated: string;
    bookValue: string;
    // A-24 T4: jurnal perolehan & pelepasan aset (id tersimpan di
    // baris aset; nomor diselesaikan batch di bawah).
    journalId: string | null;
    journalNumber: string | null;
    disposalJournalId: string | null;
    disposalJournalNumber: string | null;
  }> = [];
  const journalNumbers = await listJournalNumbersById(
    tx,
    companyId,
    assets.flatMap((row) => [row.asset.journalId, row.asset.disposalJournalId]).filter(
      (id): id is string => Boolean(id),
    ),
  );
  const accumulatedByAsset = await getAccumulatedDepreciationMap(
    tx,
    companyId,
    assets.map((row) => row.asset.id),
  );
  for (const row of assets) {
    const accumulated = accumulatedByAsset.get(row.asset.id) ?? d(0);
    rows.push({
      id: row.asset.id,
      number: row.asset.number,
      name: row.asset.name,
      categoryName: row.categoryName,
      acquisitionDate: row.asset.acquisitionDate,
      cost: row.asset.cost,
      residualValue: row.asset.residualValue,
      usefulLifeMonths: row.asset.usefulLifeMonths,
      status: row.asset.status,
      disposalDate: row.asset.disposalDate,
      accumulated: toDb(accumulated),
      bookValue: toDb(d(row.asset.cost).minus(accumulated)),
      journalId: row.asset.journalId,
      journalNumber: row.asset.journalId ? (journalNumbers.get(row.asset.journalId) ?? null) : null,
      disposalJournalId: row.asset.disposalJournalId,
      disposalJournalNumber: row.asset.disposalJournalId
        ? (journalNumbers.get(row.asset.disposalJournalId) ?? null)
        : null,
    });
  }
  const totals = rows.reduce(
    (acc, row) => ({
      cost: acc.cost.plus(row.cost),
      accumulated: acc.accumulated.plus(row.accumulated),
      bookValue: acc.bookValue.plus(row.bookValue),
    }),
    { cost: d(0), accumulated: d(0), bookValue: d(0) },
  );
  return {
    rows,
    totals: {
      cost: toDb(totals.cost),
      accumulated: toDb(totals.accumulated),
      bookValue: toDb(totals.bookValue),
    },
  };
}

/** Saldo GL (kredit-normal) seluruh akun akumulasi yang dipakai aset perusahaan — untuk tie-out laporan. */
export async function getAccumulatedDepreciationGlBalance(tx: Tx, companyId: string) {
  const map = await ensureFixedAssetAccounts(tx, companyId);
  const categories = await tx
    .select({ accumulatedAccountId: fixedAssetCategories.accumulatedAccountId })
    .from(fixedAssetCategories)
    .where(eq(fixedAssetCategories.companyId, companyId));
  const accountIds = [
    ...new Set(
      [map.accumulated_depreciation, ...categories.map((row: { accumulatedAccountId: string | null }) => row.accumulatedAccountId)].filter(Boolean),
    ),
  ] as string[];
  if (accountIds.length === 0) return "0";
  const lines = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.status, "posted"),
        inArray(journalLines.accountId, accountIds),
      ),
    );
  const balance = lines.reduce(
    (sum: ReturnType<typeof d>, row: { debit: string; credit: string }) => sum.plus(row.credit).minus(row.debit),
    d(0),
  );
  return toDb(balance);
}
