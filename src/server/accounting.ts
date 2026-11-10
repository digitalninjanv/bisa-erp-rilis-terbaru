import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accountMappings,
  accountMonthlyBalances,
  accounts,
  bankStatementLines,
  fiscalPeriods,
  journalEntries,
  journalLines,
  paymentMethods,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { CHART_TEMPLATE } from "@/lib/akuntansi/chart-template";
import { Decimal, d, formatIDR, sum, toDb, type MoneyInput } from "@/lib/money";
import { nextDocumentNumber } from "@/server/sequences";

import { getCompanySettingsRow } from "@/server/settings";
export type JournalLineInput = {
  accountId: string;
  debit?: MoneyInput;
  credit?: MoneyInput;
  description?: string;
  partyType?: string;
  partyId?: string;
};

type CashGuardAccount = { id: string; code: string; name: string };

/**
 * FIX-R2 Tahap 3 (RV2-01 / AK3-11): penjaga saldo kas/bank negatif,
 * dievaluasi SATU KALI di postJournal — titik bersama seluruh jalur
 * pengeluaran (beban, pembayaran utang/gaji, transfer keluar, quick
 * entry, refund, jurnal manual) — supaya tidak tercecer per modul.
 *
 * Kebijakan per perusahaan (company_settings.cash_negative_policy):
 *   allow — perilaku lama persis: tanpa pemeriksaan sama sekali.
 *   warn  — posting berjalan; peringatan (berisi saldo proyeksi)
 *           dikembalikan lewat hasil postJournal dan ditampilkan UI.
 *   block — posting DITOLAK dengan AppError VALIDATION berbahasa
 *           Indonesia yang menyebut saldo sekarang & saldo proyeksi.
 *
 * Saldo proyeksi = saldo GL akun (seluruh jurnal posted) + efek neto
 * jurnal ini pada akun itu. Hanya akun kas/bank (berkelas kas/bank/
 * kliring, A-27 B2 — listCashBankIds) dengan efek neto keluar yang
 * diperiksa — jurnal yang menambah kas tidak pernah bisa membuat
 * saldo negatif.
 *
 * Jurnal PEMBALIK (reversalOfId terisi) DIKECUALIKAN: koreksi atas
 * jurnal yang sudah terlanjur posted harus selalu bisa dilakukan
 * (doktrin append-only — koreksi lewat reversal), menahannya akan
 * menjebak pengguna dalam saldo yang salah tanpa jalan keluar.
 */
async function evaluateCashNegativeGuard(
  tx: Tx,
  companyId: string,
  lines: Array<{ accountId: string; debit: Decimal; credit: Decimal }>,
  accountRows: CashGuardAccount[],
): Promise<string[]> {
  const settings = await getCompanySettingsRow(tx, companyId);
  // Tanpa baris pengaturan (tidak terjadi pada perusahaan normal),
  // bawaan aman = warn, sama dengan bawaan kolom migrasi 0042.
  const policy = settings?.cashNegativePolicy ?? "warn";
  if (policy === "allow") return [];

  const netByAccount = new Map<string, Decimal>();
  for (const line of lines) {
    netByAccount.set(
      line.accountId,
      (netByAccount.get(line.accountId) ?? d(0)).plus(line.debit).minus(line.credit),
    );
  }
  const outflowAccountIds = [...netByAccount.entries()]
    .filter(([, net]) => net.isNegative())
    .map(([accountId]) => accountId);
  if (outflowAccountIds.length === 0) return [];

  const cashLikeIds = await listCashBankIds(tx, companyId);
  const candidates = outflowAccountIds.filter((accountId) => cashLikeIds.has(accountId));
  if (candidates.length === 0) return [];

  const accountById = new Map(accountRows.map((row) => [row.id, row]));
  const warnings: string[] = [];
  for (const accountId of candidates) {
    const postedLines = await tx
      .select({ debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.companyId, companyId),
          eq(journalLines.accountId, accountId),
          eq(journalEntries.status, "posted"),
        ),
      );
    const balance = postedLines.reduce(
      (acc, row) => acc.plus(row.debit).minus(row.credit),
      d(0),
    );
    const projected = balance.plus(netByAccount.get(accountId)!);
    if (!projected.isNegative()) continue;
    const account = accountById.get(accountId);
    const label = account ? `akun ${account.code} (${account.name})` : "akun kas/bank";
    if (policy === "block") {
      throw new AppError(
        "VALIDATION",
        `Saldo ${label} tidak mencukupi: saldo sekarang ${formatIDR(balance)}, ` +
          `pengeluaran jurnal ini ${formatIDR(netByAccount.get(accountId)!.abs())}, ` +
          `saldo sesudah posting akan menjadi ${formatIDR(projected)} (negatif). ` +
          `Periksa jumlah atau sumber dananya, atau ubah kebijakan saldo kas/bank di Pengaturan.`,
      );
    }
    warnings.push(
      `Saldo ${label} akan menjadi negatif sesudah posting: saldo sekarang ${formatIDR(balance)}, ` +
        `saldo proyeksi ${formatIDR(projected)}. Periksa kembali sumber dananya.`,
    );
  }
  return warnings;
}

export async function getAccountId(tx: Tx, companyId: string, key: string): Promise<string> {
  const [row] = await tx
    .select({ accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, companyId), eq(accountMappings.key, key)))
    .limit(1);
  if (!row) {
    throw new AppError("VALIDATION", `Akun untuk "${key}" belum dipetakan di Pengaturan.`);
  }
  return row.accountId;
}

export async function getAccountMap(tx: Tx, companyId: string): Promise<Record<string, string>> {
  const rows = await tx
    .select({ key: accountMappings.key, accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(eq(accountMappings.companyId, companyId));
  return Object.fromEntries(rows.map((r) => [r.key, r.accountId]));
}

/**
 * A-27 B6 — penanam bagan akun templat 5 digit (lib/akuntansi/
 * chart-template.ts, SATU-SATUNYA sumber bagan bawaan) untuk
 * perusahaan BARU: menanam 124 akun (hierarki + kelas kas/bank + tag
 * PSAK 118 + penanda kontra) dan pemetaan 37 kunci dalam transaksi
 * pemanggil. Urutan daftar templat menjamin induk ditanam sebelum
 * anaknya; tautan kontra dipasang pada putaran kedua sesudah semua
 * id dikenal. Mengembalikan record kunci → id akun.
 *
 * Hanya untuk perusahaan yang BELUM memiliki akun sama sekali —
 * perusahaan berjalan bermigrasi lewat alat opt-in B7, bukan fungsi
 * ini. Seed demo memanggilnya lewat adapter db/seed-chart.ts.
 */
export async function seedChartOfAccounts(tx: Tx, companyId: string): Promise<Record<string, string>> {
  const [existing] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.companyId, companyId))
    .limit(1);
  if (existing) {
    throw new AppError(
      "CONFLICT",
      "Perusahaan ini sudah memiliki bagan akun; templat bawaan hanya ditanam untuk perusahaan baru.",
    );
  }
  const idByCode = new Map<string, string>();
  // CHART_TEMPLATE sudah diurutkan induk-dulu oleh modul templat.
  for (const entry of CHART_TEMPLATE) {
    const [row] = await tx
      .insert(accounts)
      .values({
        companyId,
        code: entry.code,
        name: entry.name,
        type: entry.type,
        normalBalance: entry.normalBalance,
        parentId: entry.parentCode ? idByCode.get(entry.parentCode)! : null,
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
  }
  for (const entry of CHART_TEMPLATE) {
    if (!entry.contraOfCode) continue;
    await tx
      .update(accounts)
      .set({ contraOf: idByCode.get(entry.contraOfCode)! })
      .where(eq(accounts.id, idByCode.get(entry.code)!));
  }
  const mapping: Record<string, string> = {};
  for (const entry of CHART_TEMPLATE) {
    if (entry.mappingKey) mapping[entry.mappingKey] = idByCode.get(entry.code)!;
  }
  await tx.insert(accountMappings).values(
    Object.entries(mapping).map(([key, accountId]) => ({ companyId, key, accountId })),
  );
  return mapping;
}

/**
 * FIX-P1 Tahap 3 (AK1-01): materialisasi periode fiskal satu tahun penuh
 * (12 baris "open") untuk satu perusahaan. Idempoten — baris yang sudah
 * ada (termasuk yang closed/locked) tidak pernah disentuh.
 */
export async function ensureFiscalPeriods(tx: Tx, companyId: string, year: number): Promise<void> {
  await tx
    .insert(fiscalPeriods)
    .values(
      Array.from({ length: 12 }, (_, i) => ({
        companyId,
        year,
        month: i + 1,
        status: "open",
      })),
    )
    .onConflictDoNothing({
      target: [fiscalPeriods.companyId, fiscalPeriods.year, fiscalPeriods.month],
    });
}

export async function assertPeriodOpen(
  tx: Tx,
  companyId: string,
  date: string,
  options?: { allowClosingEntry?: boolean },
): Promise<void> {
  const parsed = new Date(`${date}T00:00:00Z`);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new AppError("VALIDATION", `Tanggal jurnal "${date}" tidak valid.`);
  }

  // FIX-P1 Tahap 3 (AK6-02): baris periode DIKUNCI (SELECT … FOR UPDATE)
  // selama transaksi posting berjalan, dan jalur penutupan mengambil
  // kunci yang sama. Serialisasi dua arah ini menutup race TOCTOU:
  // penutupan tidak bisa commit di tengah posting yang sedang berjalan,
  // dan posting yang tiba sesudah penutupan membaca status terbaru lalu
  // ditolak — bukan status basi dari awal transaksinya.
  const selectPeriod = () =>
    tx
      .select({ status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.companyId, companyId),
          eq(fiscalPeriods.year, year),
          eq(fiscalPeriods.month, month),
        ),
      )
      .limit(1)
      .for("update");

  let [period] = await selectPeriod();

  if (!period) {
    // FIX-P1 Tahap 3 (AK1-01): periode TANPA baris tidak lagi dianggap
    // terbuka. Satu-satunya pengecualian adalah jendela materialisasi
    // otomatis — tahun berjalan & tahun berikutnya — yang barisnya
    // memang selalu harus ada (dibuat saat perusahaan dibuat, di-backfill
    // migrasi 0039, dan di sini secara lazy bila belum ada). Tahun di
    // luar jendela itu hanya bisa dibuka lewat materialisasi eksplisit
    // owner di halaman Periode (seedMissingPeriodsAction, teraudit).
    const currentYear = new Date().getFullYear();
    if (year === currentYear || year === currentYear + 1) {
      await ensureFiscalPeriods(tx, companyId, year);
      [period] = await selectPeriod();
    }
  }

  if (!period) {
    throw new AppError(
      "PERIOD_CLOSED",
      `Periode ${String(month).padStart(2, "0")}/${year} belum dibuat, sehingga dianggap tertutup. Pemilik (owner) dapat membuat periode tahun ${year} dari menu Akuntansi → Periode.`,
    );
  }
  if (period.status !== "open") {
    if (options?.allowClosingEntry && period.status === "closed") {
      // Jurnal penutup tahunan (year_end_closing) dan pembaliknya diizinkan diposting ke periode berstatus closed
      return;
    }
    throw new AppError(
      "PERIOD_CLOSED",
      `Periode ${String(month).padStart(2, "0")}/${year} sudah ${period.status === "locked" ? "dikunci" : "ditutup"}.`,
    );
  }
}

export async function postJournal(
  tx: Tx,
  input: {
    companyId: string;
    date: string;
    description: string;
    sourceType: string;
    sourceId?: string | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
    reversalOfId?: string | null;
    lines: JournalLineInput[];
  },
): Promise<{ id: string; number: string; warnings: string[] }> {
  if (input.idempotencyKey) {
    const [existing] = await tx
      .select({ id: journalEntries.id, number: journalEntries.number })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, input.companyId),
          eq(journalEntries.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    // Replay idempoten: jurnal tidak diposting ulang, jadi tidak ada
    // peringatan baru untuk jurnal ini.
    if (existing) return { ...existing, warnings: [] };
  }

  const parsedLines = input.lines.map((line) => ({
    ...line,
    debitValue: d(line.debit),
    creditValue: d(line.credit),
  }));

  // FIX-P1 Tahap 3 (AK6-01/AK1-02): baris jurnal wajib satu sisi dan
  // non-negatif. Baris negatif atau dua-sisi tetap "seimbang" secara
  // aritmetika (Σdebit = Σkredit), sehingga lolos uji keseimbangan dan
  // trigger DB — tetapi mendistorsi mutasi per akun di semua laporan.
  // Koreksi nilai berjalan lewat jurnal pembalik, bukan baris negatif.
  for (const line of parsedLines) {
    if (line.debitValue.lt(0) || line.creditValue.lt(0)) {
      throw new AppError(
        "VALIDATION",
        "Baris jurnal tidak boleh bernilai negatif. Gunakan jurnal pembalik untuk mengoreksi jurnal yang sudah terposting.",
      );
    }
    if (line.debitValue.gt(0) && line.creditValue.gt(0)) {
      throw new AppError(
        "VALIDATION",
        "Setiap baris jurnal hanya boleh terisi di satu sisi (debit atau kredit), tidak boleh keduanya sekaligus.",
      );
    }
  }

  const lines = parsedLines.filter((line) => line.debitValue.gt(0) || line.creditValue.gt(0));

  if (lines.length < 2) {
    throw new AppError("VALIDATION", "Jurnal minimal memiliki dua baris.");
  }

  const totalDebit = sum(lines.map((line) => line.debitValue));
  const totalCredit = sum(lines.map((line) => line.creditValue));

  if (!totalDebit.equals(totalCredit)) {
    throw new AppError(
      "VALIDATION",
      `Jurnal tidak seimbang. Debit ${totalDebit.toFixed(2)} vs kredit ${totalCredit.toFixed(2)}.`,
    );
  }
  if (totalDebit.lte(0)) {
    throw new AppError("VALIDATION", "Nilai jurnal harus lebih dari nol.");
  }

  // AK-P1-02: every line account must exist in this company, be postable,
  // and be active. Runs after the idempotency replay check above so a
  // replayed key keeps its original behaviour.
  const uniqueAccountIds = [...new Set(lines.map((line) => line.accountId))];
  const accountRows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), inArray(accounts.id, uniqueAccountIds)));
  if (accountRows.length !== uniqueAccountIds.length) {
    const foundIds = new Set(accountRows.map((row) => row.id));
    const missingIds = uniqueAccountIds.filter((id) => !foundIds.has(id));
    throw new AppError(
      "VALIDATION",
      `Akun jurnal tidak ditemukan untuk perusahaan ini: ${missingIds.join(", ")}.`,
    );
  }
  // Leader decision D-1 (PROGRESS.md): a reversal posting (reversalOfId set)
  // is the only correction path in an append-only ledger, so it must not be
  // blocked by an account that was deactivated or made non-postable AFTER the
  // original posting. Existence + company scope above still apply to it.
  const isReversal = Boolean(input.reversalOfId);
  for (const account of accountRows) {
    if (!isReversal && !account.isPostable) {
      throw new AppError(
        "VALIDATION",
        `Akun ${account.code} (${account.name}) adalah akun induk dan tidak dapat dipakai untuk posting jurnal.`,
      );
    }
    if (!isReversal && !account.isActive) {
      throw new AppError(
        "VALIDATION",
        `Akun ${account.code} (${account.name}) sudah tidak aktif dan tidak dapat dipakai untuk posting jurnal.`,
      );
    }
  }

  // FIX-R2 Tahap 3 (RV2-01/AK3-11): penjaga saldo kas/bank negatif di
  // titik bersama ini. Jurnal pembalik dikecualikan — lihat komentar
  // evaluateCashNegativeGuard.
  const warnings = isReversal
    ? []
    : await evaluateCashNegativeGuard(
        tx,
        input.companyId,
        lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debitValue,
          credit: line.creditValue,
        })),
        accountRows,
      );

  await assertPeriodOpen(tx, input.companyId, input.date, {
    allowClosingEntry:
      input.sourceType === "year_end_closing" ||
      input.sourceType === "year_end_closing_reversal",
  });
  const number = await nextDocumentNumber(tx, input.companyId, "JOURNAL", input.date);

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId: input.companyId,
      number,
      date: input.date,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      status: "posted",
      reversalOfId: input.reversalOfId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdBy: input.createdBy ?? null,
      postedAt: new Date(),
    })
    .returning({ id: journalEntries.id, number: journalEntries.number });

  await tx.insert(journalLines).values(
    lines.map((line, index) => ({
      companyId: input.companyId,
      entryId: entry.id,
      accountId: line.accountId,
      debit: toDb(line.debitValue),
      credit: toDb(line.creditValue),
      description: line.description ?? input.description,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null,
      lineNo: index + 1,
    })),
  );

  // FIX-ARS Tahap 2 (ARS3-01 / R-4): pelihara ringkasan saldo bulanan
  // dalam transaksi yang sama. postJournal adalah SATU-SATUNYA gerbang
  // insert jurnal di kode aplikasi (terverifikasi audit ARS-3), jadi
  // inilah satu-satunya titik pembaruan ringkasan: jurnal pembalik
  // adalah jurnal baru bertanggal sendiri yang lewat sini juga, dan
  // jurnal backdated otomatis mengubah ringkasan bulan tanggalnya.
  // Replay idempoten sudah kembali lebih awal di atas, sehingga tidak
  // pernah menggandakan ringkasan.
  const yearMonth = input.date.slice(0, 7);
  const monthlyTotals = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const line of lines) {
    const acc = monthlyTotals.get(line.accountId) ?? { debit: d(0), credit: d(0) };
    acc.debit = acc.debit.plus(line.debitValue);
    acc.credit = acc.credit.plus(line.creditValue);
    monthlyTotals.set(line.accountId, acc);
  }
  await tx
    .insert(accountMonthlyBalances)
    .values(
      [...monthlyTotals].map(([accountId, totals]) => ({
        companyId: input.companyId,
        accountId,
        yearMonth,
        totalDebit: toDb(totals.debit),
        totalCredit: toDb(totals.credit),
      })),
    )
    .onConflictDoUpdate({
      target: [
        accountMonthlyBalances.companyId,
        accountMonthlyBalances.accountId,
        accountMonthlyBalances.yearMonth,
      ],
      set: {
        totalDebit: sql`${accountMonthlyBalances.totalDebit} + excluded.total_debit`,
        totalCredit: sql`${accountMonthlyBalances.totalCredit} + excluded.total_credit`,
        updatedAt: new Date(),
      },
    });

  return { ...entry, warnings };
}

/**
 * T4R-3: a journal whose lines are linked to a bank statement line must
 * not be reversed while the link stands — the reversal would silently
 * leave the reconciliation pointing at a dead journal (and the summary
 * would keep counting it). Enforced here, in the domain, so EVERY
 * reversal caller (journal page, module voids, opening-balance voids)
 * is bound by it; the user unlinks first on the Rekonsiliasi page.
 */
async function assertJournalNotLinkedToStatement(
  tx: Tx,
  companyId: string,
  entryId: string,
  entryNumber: string,
): Promise<void> {
  const [linked] = await tx
    .select({ id: bankStatementLines.id })
    .from(bankStatementLines)
    .innerJoin(journalLines, eq(bankStatementLines.matchedJournalLineId, journalLines.id))
    .where(and(eq(bankStatementLines.companyId, companyId), eq(journalLines.entryId, entryId)))
    .limit(1);
  if (linked) {
    throw new AppError(
      "VALIDATION",
      `Jurnal ${entryNumber} masih tertaut ke mutasi bank dan tidak dapat dibalik. Lepas tautannya terlebih dahulu di halaman Rekonsiliasi, lalu balik jurnal ini.`,
    );
  }
}

export async function reverseSourceJournal(
  tx: Tx,
  input: {
    companyId: string;
    sourceType: string;
    sourceId: string;
    date: string;
    description: string;
    createdBy?: string | null;
  },
): Promise<{ id: string; number: string } | null> {
  const [original] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.sourceType, input.sourceType),
        eq(journalEntries.sourceId, input.sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .limit(1);
  if (!original) return null;

  await assertJournalNotLinkedToStatement(tx, input.companyId, original.id, original.number);

  const lines = await tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, original.id));

  return postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `${input.description} (pembalik ${original.number})`,
    sourceType: `${input.sourceType}_reversal`,
    sourceId: input.sourceId,
    createdBy: input.createdBy,
    idempotencyKey: `reversal:${original.id}`,
    reversalOfId: original.id,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      description: line.description ?? undefined,
      partyType: line.partyType ?? undefined,
      partyId: line.partyId ?? undefined,
    })),
  });
}

export async function reverseJournalEntry(
  tx: Tx,
  input: {
    companyId: string;
    entryId: string;
    date: string;
    description?: string;
    createdBy?: string | null;
  },
): Promise<{ original: { id: string; number: string }; reversal: { id: string; number: string } }> {
  const [entry] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number, status: journalEntries.status, sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, input.companyId), eq(journalEntries.id, input.entryId)))
    .limit(1);
  if (!entry) throw new AppError("NOT_FOUND", "Jurnal tidak ditemukan.");
  if (entry.status !== "posted") throw new AppError("INVALID_STATE", "Hanya jurnal posted yang bisa dibalik.");

  const [existing] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, input.companyId), eq(journalEntries.reversalOfId, entry.id)))
    .limit(1);
  if (existing) throw new AppError("CONFLICT", "Jurnal ini sudah memiliki jurnal pembalik.");

  await assertJournalNotLinkedToStatement(tx, input.companyId, entry.id, entry.number);

  const lines = await tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));

  const reversal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: input.description?.trim() || `Pembalik jurnal ${entry.number}`,
    sourceType: `${entry.sourceType}_reversal`,
    sourceId: entry.sourceId ?? entry.id,
    createdBy: input.createdBy,
    idempotencyKey: `reversal:${entry.id}`,
    reversalOfId: entry.id,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      description: line.description ?? undefined,
      partyType: line.partyType ?? undefined,
      partyId: line.partyId ?? undefined,
    })),
  });

  return { original: { id: entry.id, number: entry.number }, reversal };
}

/** Normal balance sign for reporting: debit-positive for assets/expenses/cogs. */
export function signedBalance(
  type: string,
  debit: MoneyInput,
  credit: MoneyInput,
): Decimal {
  const debitValue = d(debit);
  const creditValue = d(credit);
  if (type === "asset" || type === "expense" || type === "cogs") {
    return debitValue.minus(creditValue);
  }
  return creditValue.minus(debitValue);
}

export async function listPostableAccounts(tx: Tx, companyId: string) {
  return tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      normalBalance: accounts.normalBalance,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.isActive, true), eq(accounts.isPostable, true)))
    .orderBy(accounts.code);
}

// ---------------------------------------------------------------------------
// A-27 B2: keanggotaan kas/bank diturunkan dari KELAS akun
// (accounts.cash_bank_kind, ditanam B1), bukan lagi dari slot pemetaan
// cash/bank/qris. Pemetaan tetap hidup sebagai penunjuk akun BAWAAN
// (kas sesi POS, bank bawaan, penampung QRIS bawaan) — bukan penentu
// keanggotaan. Kedua fungsi di bawah ini adalah SATU-SATUNYA definisi
// himpunan kas/bank untuk seluruh permukaan baca & validator domain;
// jangan merakit himpunan sendiri dari pemetaan di tempat lain.
// A-28 Tahap 3 (H-AKT-02) menyelaraskan dua permukaan laporan yang
// terakhir tertinggal ke definisi ini: subjek kas laporan arus kas
// (getCashFlow) dan kartu Kas & Bank ringkasan akuntansi
// (getAccountingSummary) — angka kas kini rekonsiliasi antar semua
// permukaan (dashboard, Kas & bank, arus kas, ringkasan).
// ---------------------------------------------------------------------------

/** Nilai kelas kas/bank yang sah (kolom accounts.cash_bank_kind). */
export const CASH_BANK_KINDS = ["cash", "bank", "clearing"] as const;
export type CashBankKind = (typeof CASH_BANK_KINDS)[number];

export type CashBankAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  cashBankKind: string;
};

/**
 * Semua akun kas/bank perusahaan yang dapat dipakai: berkelas
 * cash|bank|clearing, postable, dan aktif, terurut kode. Inilah
 * himpunan yang ditampilkan halaman Kas & bank, pemilih akun
 * pembayaran, dan daftar rekonsiliasi (F-01/F-03/F-04).
 */
export async function listCashBankAccounts(
  tx: Tx,
  companyId: string,
): Promise<CashBankAccount[]> {
  const rows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      cashBankKind: accounts.cashBankKind,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.isPostable, true),
        eq(accounts.isActive, true),
        inArray(accounts.cashBankKind, [...CASH_BANK_KINDS]),
      ),
    )
    .orderBy(asc(accounts.code));
  return rows.map((row) => ({ ...row, cashBankKind: row.cashBankKind ?? "" }));
}

/** Id himpunan kas/bank (definisi sama persis dengan listCashBankAccounts) untuk penyaring & validator keanggotaan. */
export async function listCashBankIds(tx: Tx, companyId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.isPostable, true),
        eq(accounts.isActive, true),
        inArray(accounts.cashBankKind, [...CASH_BANK_KINDS]),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export async function listPaymentAccounts(tx: Tx, companyId: string) {
  // A-27 B2: himpunan akun pembayaran = himpunan kelas kas/bank
  // (listCashBankIds — sudah menyaring postable + aktif), bukan lagi
  // tiga akun hasil pemetaan cash/bank/qris.
  const cashBankIds = await listCashBankIds(tx, companyId);
  const accountRows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(eq(accounts.companyId, companyId))
    .orderBy(accounts.code);
  // A-21 Tahap R3-A (R3-01): konfigurasi fee metode pemilik tiap akun
  // ikut dikembalikan agar form pembayaran dapat menawarkan nilai
  // awal fee — resolusi metode per akun yang sama seperti domain
  // (resolvePaymentFee): metode aktif pertama menurut urutan tampil.
  const methodRows = await tx
    .select({
      accountId: paymentMethods.accountId,
      feeEnabled: paymentMethods.feeEnabled,
      feeType: paymentMethods.feeType,
      feeValue: paymentMethods.feeValue,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.isActive, true)))
    .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.createdAt));
  const feeByAccount = new Map<string, { feeEnabled: boolean; feeType: string; feeValue: string }>();
  for (const row of methodRows) {
    if (row.accountId && !feeByAccount.has(row.accountId)) {
      feeByAccount.set(row.accountId, {
        feeEnabled: row.feeEnabled,
        feeType: row.feeType,
        feeValue: row.feeValue,
      });
    }
  }
  return accountRows
    .filter((row) => cashBankIds.has(row.id))
    .map((row) => ({
      ...row,
      feeEnabled: feeByAccount.get(row.id)?.feeEnabled ?? false,
      feeType: feeByAccount.get(row.id)?.feeType ?? "none",
      feeValue: feeByAccount.get(row.id)?.feeValue ?? "0",
    }));
}
