import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { accountMappings, accounts, journalEntries, journalLines } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { CHART_TEMPLATE, type ChartTemplateEntry } from "@/lib/akuntansi/chart-template";
import {
  LEGACY_CHART_CODE_MAP,
  type LegacyChartCodePair,
} from "@/lib/akuntansi/legacy-chart-mapping";
import { Decimal, d } from "@/lib/money";
import { writeAudit } from "@/server/audit";

/**
 * A-27 B7 — Alat migrasi bagan akun perusahaan BERJALAN ke templat
 * 5 digit (docs/bagan-akun/RENCANA.md §5–§6, tahap B7). Sifatnya
 * OPT-IN pemilik per perusahaan: TIDAK ada jalur otomatis/terjadwal
 * yang memanggil modul ini — hanya aksi server berpenjaga izin
 * (actions/accounting/migrasi-coa.ts) atas perintah eksplisit.
 *
 * Keamanan mekanisnya bertumpu pada satu fakta: jurnal, pemetaan,
 * dan metode mereferensikan `accountId`, BUKAN kode. Renumber hanya
 * memperbarui baris `accounts`; tidak ada jurnal migrasi, tidak ada
 * saldo yang berpindah, tidak ada riwayat yang ditulis ulang.
 *
 * Alur:
 *  1. `previewCoaMigration` (dry-run, baca-saja): akun yang akan
 *     di-renumber menurut tabel mapping, akun kustom yang TIDAK
 *     terpetakan (dibiarkan apa adanya), akun templat yang belum
 *     ada (akan dibuat BARU dengan id baru — bukan renumber), dan
 *     bentrok kode tujuan (akun lain sudah memakai kode baru →
 *     eksekusi MENOLAK sampai diputuskan manual).
 *  2. `executeCoaMigration` (dipanggil di dalam SATU transaksi
 *     pemanggil): bentrok → batal tanpa perubahan; renumber lewat
 *     kode sementara internal transaksi (aman dari tabrakan unik
 *     sesaat, termasuk kode yang bertukar tempat); terapkan atribut
 *     templat (nama/tipe/section/kelas kas-bank/tag PSAK 118/
 *     kontra/induk/postable) ke akun yang di-renumber; buat akun
 *     templat yang hilang; lalu VERIFIKASI internal: neraca saldo
 *     per `accountId` sebelum vs sesudah harus IDENTIK — selisih
 *     apa pun melempar error dan seluruh transaksi batal.
 *
 * Tabel mapping adalah PARAMETER (bawaan: LEGACY_CHART_CODE_MAP
 * dari RENCANA §5) agar perusahaan berkode lama kustom dapat
 * dimigrasi dengan tabel yang disesuaikan per perusahaan sebagai
 * data, tanpa mengubah kode program.
 */

export type CoaMigrationRename = {
  accountId: string;
  oldCode: string;
  oldName: string;
  newCode: string;
  newName: string;
};

export type CoaMigrationConflict = {
  oldCode: string;
  oldName: string;
  newCode: string;
  newName: string;
  blockingName: string;
};

export type CoaMigrationPreview = {
  /** Akun berkode lama yang akan berubah kode mengikuti tabel mapping. */
  renames: CoaMigrationRename[];
  /** Pasangan mapping yang sudah dalam keadaan baru (kode lama tidak ada, kode baru ada). */
  alreadyMigratedCount: number;
  /** Akun templat 5 digit yang belum ada di perusahaan — akan dibuat baru saat eksekusi. */
  missingTemplate: Array<{ code: string; name: string; isHeader: boolean }>;
  /** Akun perusahaan di luar tabel mapping & templat — akun kustom; dibiarkan, kode tidak diubah. */
  unmapped: Array<{ id: string; code: string; name: string }>;
  /** Kode tujuan sudah dipakai akun lain — eksekusi menolak selama daftar ini tidak kosong. */
  conflicts: CoaMigrationConflict[];
  needsMigration: boolean;
  canExecute: boolean;
};

export type CoaMigrationResult = {
  renamedCount: number;
  createdCount: number;
  createdCodes: string[];
  unmappedCount: number;
  alreadyUpToDate: boolean;
  balancesVerified: true;
};

const TEMPLATE_BY_CODE = new Map<string, ChartTemplateEntry>(
  CHART_TEMPLATE.map((entry) => [entry.code, entry]),
);

type AccountRow = typeof accounts.$inferSelect;

async function listCompanyAccounts(tx: Tx, companyId: string): Promise<AccountRow[]> {
  return tx.select().from(accounts).where(eq(accounts.companyId, companyId));
}

export async function previewCoaMigration(
  tx: Tx,
  companyId: string,
  mapping: readonly LegacyChartCodePair[] = LEGACY_CHART_CODE_MAP,
): Promise<CoaMigrationPreview> {
  const rows = await listCompanyAccounts(tx, companyId);
  const byCode = new Map(rows.map((row) => [row.code, row]));

  // Penanda bagan referensi sudah terpasang: kode 110107 Tunai adalah
  // akun khas templat baru. Tanpa penjaga ini, kode root referensi
  // yang kebetulan sama dengan kode lama (1200/1300/3000/4000/6000)
  // akan salah dianggap akun lama dan di-renumber.
  const cashMarker = byCode.get("110107");
  const referenceMarker =
    (cashMarker?.name === "Tunai" ? cashMarker : undefined) ??
    (byCode.get("400001")?.name === "Penjualan" ? byCode.get("400001") : undefined);
  if (referenceMarker) {
    return {
      renames: [],
      alreadyMigratedCount: rows.length,
      missingTemplate: [],
      unmapped: [],
      conflicts: [],
      needsMigration: false,
      canExecute: false,
    };
  }

  const renames: CoaMigrationRename[] = [];
  const conflicts: CoaMigrationConflict[] = [];
  let alreadyMigratedCount = 0;
  const renameTargets = new Set<string>();

  for (const pair of mapping) {
    if (pair.oldCode === pair.newCode) continue;
    const account = byCode.get(pair.oldCode);
    const targetName = TEMPLATE_BY_CODE.get(pair.newCode)?.name ?? pair.newCode;
    if (!account) {
      if (byCode.has(pair.newCode)) alreadyMigratedCount += 1;
      continue;
    }
    const blocker = byCode.get(pair.newCode);
    if (blocker && blocker.id !== account.id) {
      conflicts.push({
        oldCode: pair.oldCode,
        oldName: account.name,
        newCode: pair.newCode,
        newName: targetName,
        blockingName: blocker.name,
      });
      continue;
    }
    renames.push({
      accountId: account.id,
      oldCode: pair.oldCode,
      oldName: account.name,
      newCode: pair.newCode,
      newName: targetName,
    });
    renameTargets.add(pair.newCode);
  }

  // Akun templat "hadir" bila kodenya sudah ada DAN tidak akan
  // dikosongkan oleh renumber, ATAU menjadi tujuan renumber. Kode
  // lama yang kebetulan sama dengan kode root referensi (1200/1300/
  // 3000/4000/6000) akan dikosongkan, sehingga akun referensi dengan
  // kode itu tetap harus dibuat.
  const renameSources = new Set(renames.map((row) => row.oldCode));
  const missingTemplate = CHART_TEMPLATE.filter((entry) => {
    const present = byCode.has(entry.code) && !renameSources.has(entry.code);
    return !present && !renameTargets.has(entry.code);
  }).map((entry) => ({ code: entry.code, name: entry.name, isHeader: entry.isHeader }));

  const knownCodes = new Set<string>([
    ...mapping.map((pair) => pair.oldCode),
    ...mapping.map((pair) => pair.newCode),
    ...CHART_TEMPLATE.map((entry) => entry.code),
  ]);
  const unmapped = rows
    .filter((row) => !knownCodes.has(row.code))
    .map((row) => ({ id: row.id, code: row.code, name: row.name }));

  const needsMigration = renames.length > 0 || missingTemplate.length > 0;
  return {
    renames,
    alreadyMigratedCount,
    missingTemplate,
    unmapped,
    conflicts,
    needsMigration,
    canExecute: needsMigration && conflicts.length === 0,
  };
}

/** Neraca saldo mentah per accountId dari baris jurnal posted — dasar verifikasi migrasi. */
async function snapshotBalancesByAccountId(
  tx: Tx,
  companyId: string,
): Promise<Map<string, { debit: Decimal; credit: Decimal }>> {
  const rows = await tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalEntries.status, "posted")));
  const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const row of rows) {
    const current = totals.get(row.accountId) ?? { debit: d(0), credit: d(0) };
    current.debit = current.debit.plus(d(row.debit));
    current.credit = current.credit.plus(d(row.credit));
    totals.set(row.accountId, current);
  }
  return totals;
}

function assertBalancesIdentical(
  before: Map<string, { debit: Decimal; credit: Decimal }>,
  after: Map<string, { debit: Decimal; credit: Decimal }>,
): void {
  const fail = () => {
    throw new AppError(
      "INTERNAL",
      "Verifikasi migrasi gagal: neraca saldo per akun berubah selama migrasi. Seluruh migrasi dibatalkan; tidak ada perubahan yang disimpan.",
    );
  };
  if (before.size !== after.size) fail();
  for (const [accountId, totals] of before) {
    const next = after.get(accountId);
    if (!next || !next.debit.eq(totals.debit) || !next.credit.eq(totals.credit)) fail();
  }
}

/**
 * Eksekusi migrasi. WAJIB dipanggil di dalam transaksi pemanggil
 * (aksi server memakai withCompany) — lemparan error apa pun,
 * termasuk verifikasi saldo, membatalkan seluruh perubahan.
 */
export async function executeCoaMigration(
  tx: Tx,
  companyId: string,
  opts: {
    mapping?: readonly LegacyChartCodePair[];
    userId?: string | null;
  } = {},
): Promise<CoaMigrationResult> {
  const mapping = opts.mapping ?? LEGACY_CHART_CODE_MAP;
  const preview = await previewCoaMigration(tx, companyId, mapping);

  if (preview.conflicts.length > 0) {
    const detail = preview.conflicts
      .map((c) => `${c.oldCode} → ${c.newCode} terhalang akun "${c.blockingName}"`)
      .join("; ");
    throw new AppError(
      "CONFLICT",
      `Migrasi ditolak: kode tujuan sudah dipakai akun lain di perusahaan ini (${detail}). ` +
        "Putuskan bentrok tersebut secara manual (ganti kode akun penghalang atau akun lamanya) lalu jalankan dry-run lagi. Tidak ada perubahan yang disimpan.",
    );
  }
  if (!preview.needsMigration) {
    return {
      renamedCount: 0,
      createdCount: 0,
      createdCodes: [],
      unmappedCount: preview.unmapped.length,
      alreadyUpToDate: true,
      balancesVerified: true,
    };
  }

  const balancesBefore = await snapshotBalancesByAccountId(tx, companyId);
  const rows = await listCompanyAccounts(tx, companyId);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const idByCode = new Map(rows.map((row) => [row.code, row.id]));

  // Fase 1 — kode sementara internal transaksi: membebaskan semua
  // kode lama sekaligus, sehingga fase 2 tidak pernah menabrak
  // indeks unik (company_id, code), termasuk bila dua kode pada
  // tabel mapping yang disesuaikan saling bertukar tempat.
  for (const rename of preview.renames) {
    await tx
      .update(accounts)
      .set({ code: `mig:${rename.accountId}` })
      .where(and(eq(accounts.companyId, companyId), eq(accounts.id, rename.accountId)));
  }

  // Fase 2 — kode baru + atribut templat (nama, tipe, section,
  // saldo normal, kelompok arus kas, kelas kas/bank, tag PSAK 118,
  // penanda kontra, postable). Rincian bank & mata uang akun TIDAK
  // disentuh: itu data rekening perusahaan, bukan data templat.
  // Induk & tautan kontra dipasang di fase 4 sesudah semua akun
  // (termasuk yang baru dibuat) dikenal id-nya.
  for (const rename of preview.renames) {
    const entry = TEMPLATE_BY_CODE.get(rename.newCode);
    const existing = rowById.get(rename.accountId)!;
    await tx
      .update(accounts)
      .set({
        code: rename.newCode,
        name: entry?.name ?? existing.name,
        type: entry?.type ?? existing.type,
        section: entry ? entry.section : existing.section,
        normalBalance: entry?.normalBalance ?? existing.normalBalance,
        cashFlowGroup: entry ? entry.cashFlowGroup : existing.cashFlowGroup,
        cashBankKind: entry ? entry.cashBankKind : existing.cashBankKind,
        psak118Category: entry ? entry.psak118Category : existing.psak118Category,
        expenseNature: entry ? entry.expenseNature : existing.expenseNature,
        expenseFunction: entry ? entry.expenseFunction : existing.expenseFunction,
        isContra: entry ? entry.isContra : existing.isContra,
        isPostable: entry ? entry.isPostable : existing.isPostable,
        description: entry?.description ?? existing.description,
      })
      .where(and(eq(accounts.companyId, companyId), eq(accounts.id, rename.accountId)));
    idByCode.delete(rename.oldCode);
    idByCode.set(rename.newCode, rename.accountId);
  }

  // Fase 3 — buat akun templat yang hilang, mengikuti urutan
  // templat (induk selalu mendahului anak). Akun yang membawa kunci
  // pemetaan dan kuncinya belum terpetakan di perusahaan ini ikut
  // dipetakan — pemetaan yang sudah ada TIDAK pernah dialihkan.
  const missingCodes = new Set(preview.missingTemplate.map((item) => item.code));
  const createdCodes: string[] = [];
  const createdEntries: ChartTemplateEntry[] = [];
  if (missingCodes.size > 0) {
    const existingMappings = await tx
      .select({ key: accountMappings.key })
      .from(accountMappings)
      .where(eq(accountMappings.companyId, companyId));
    const mappedKeys = new Set(existingMappings.map((row) => row.key));
    for (const entry of CHART_TEMPLATE) {
      if (!missingCodes.has(entry.code)) continue;
      const [row] = await tx
        .insert(accounts)
        .values({
          companyId,
          code: entry.code,
          name: entry.name,
          type: entry.type,
          normalBalance: entry.normalBalance,
          parentId: entry.parentCode ? (idByCode.get(entry.parentCode) ?? null) : null,
          section: entry.section,
          cashFlowGroup: entry.cashFlowGroup,
          cashBankKind: entry.cashBankKind,
          psak118Category: entry.psak118Category,
          expenseNature: entry.expenseNature,
          expenseFunction: entry.expenseFunction,
          isContra: entry.isContra,
          description: entry.description,
          isPostable: entry.isPostable,
        })
        .returning({ id: accounts.id });
      idByCode.set(entry.code, row.id);
      createdCodes.push(entry.code);
      createdEntries.push(entry);
      if (entry.mappingKey && !mappedKeys.has(entry.mappingKey)) {
        await tx
          .insert(accountMappings)
          .values({ companyId, key: entry.mappingKey, accountId: row.id });
        mappedKeys.add(entry.mappingKey);
      }
    }
  }

  // Fase 4 — induk & tautan kontra untuk akun yang di-renumber dan
  // yang baru dibuat, diresolusi dari peta kode → id final.
  const touched: Array<{ accountId: string; entry: ChartTemplateEntry }> = [
    ...preview.renames.flatMap((rename) => {
      const entry = TEMPLATE_BY_CODE.get(rename.newCode);
      return entry ? [{ accountId: rename.accountId, entry }] : [];
    }),
    ...createdEntries.map((entry) => ({ accountId: idByCode.get(entry.code)!, entry })),
  ];
  for (const { accountId, entry } of touched) {
    await tx
      .update(accounts)
      .set({
        parentId: entry.parentCode ? (idByCode.get(entry.parentCode) ?? null) : null,
        contraOf: entry.contraOfCode ? (idByCode.get(entry.contraOfCode) ?? null) : null,
      })
      .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
  }

  // Verifikasi internal — gerbang terakhir di dalam transaksi:
  // neraca saldo per accountId tidak boleh berubah se-sen pun.
  const balancesAfter = await snapshotBalancesByAccountId(tx, companyId);
  assertBalancesIdentical(balancesBefore, balancesAfter);

  // Jejak audit: per akun yang berubah kode (pola B4
  // account.code_change) + satu ringkasan migrasi per perusahaan.
  for (const rename of preview.renames) {
    await writeAudit(tx, {
      companyId,
      userId: opts.userId ?? null,
      action: "account.code_change",
      entityType: "account",
      entityId: rename.accountId,
      before: { code: rename.oldCode },
      after: { code: rename.newCode, via: "coa_migration" },
    });
  }
  await writeAudit(tx, {
    companyId,
    userId: opts.userId ?? null,
    action: "coa.migration",
    entityType: "company",
    entityId: companyId,
    after: {
      renamed: preview.renames.map((rename) => ({ from: rename.oldCode, to: rename.newCode })),
      createdCodes,
      unmappedCodes: preview.unmapped.map((item) => item.code),
      balancesVerified: true,
    },
  });

  return {
    renamedCount: preview.renames.length,
    createdCount: createdCodes.length,
    createdCodes,
    unmappedCount: preview.unmapped.length,
    alreadyUpToDate: false,
    balancesVerified: true,
  };
}
