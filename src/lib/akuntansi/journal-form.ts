import { d, formatIDR, toDb, type Decimal } from "@/lib/money";

/**
 * Logika murni formulir jurnal manual — dipisah dari komponen agar
 * ringkasan keseimbangan, alasan tombol Posting nonaktif, dan tombol
 * "Samakan" bisa diuji unit. Semua hitungan Decimal.
 *
 * Overhaul UI/UX: formulir tidak lagi memakai pola cepat maupun memo
 * per baris. Keterangan jurnal opsional (server memakai teks bawaan
 * bila kosong).
 */

export type JournalLineDraft = {
  accountId: string;
  debit: string;
  credit: string;
  /** A-21 (R3-09): tag pihak opsional — ditawarkan formulir hanya
   * untuk akun kontrol piutang/utang terpetakan. */
  partyType?: "customer" | "supplier";
  partyId?: string;
};

export const EMPTY_JOURNAL_LINE: JournalLineDraft = {
  accountId: "",
  debit: "",
  credit: "",
};

/** Baris awal formulir: tiga baris kosong (spesifikasi Accurate-like). */
export function initialJournalLines(): JournalLineDraft[] {
  return Array.from({ length: 3 }, () => ({ ...EMPTY_JOURNAL_LINE }));
}

/** Tombol "Tambah baris" menambah dua baris sekaligus. */
export function appendJournalLines(lines: JournalLineDraft[]): JournalLineDraft[] {
  return [...lines, { ...EMPTY_JOURNAL_LINE }, { ...EMPTY_JOURNAL_LINE }];
}

function amount(value: string): Decimal {
  if (!value) return d(0);
  try {
    const parsed = d(value);
    return parsed.isFinite() ? parsed : d(0);
  } catch {
    return d(0);
  }
}

export type JournalSummary = {
  totalDebit: Decimal;
  totalCredit: Decimal;
  /** Debit − kredit (bertanda). */
  difference: Decimal;
  /** Baris yang punya akun dan nominal positif di salah satu sisi. */
  filledCount: number;
  balanced: boolean;
};

export function summarizeJournalLines(lines: JournalLineDraft[]): JournalSummary {
  let totalDebit = d(0);
  let totalCredit = d(0);
  let filledCount = 0;
  for (const line of lines) {
    const debit = amount(line.debit);
    const credit = amount(line.credit);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    if (line.accountId && (debit.gt(0) || credit.gt(0))) filledCount += 1;
  }
  const difference = totalDebit.minus(totalCredit);
  return {
    totalDebit,
    totalCredit,
    difference,
    filledCount,
    balanced: totalDebit.gt(0) && difference.isZero(),
  };
}

export type JournalBalanceState = "empty" | "balanced" | "unbalanced";

/**
 * A-25 U2 (ARAH-DESAIN-A25 §4.1 butir 7): keadaan tampilan indikator
 * keseimbangan. Form kosong BUKAN "belum seimbang" — `balanced` pada
 * ringkasan memang false saat total masih nol (jurnal kosong tidak
 * boleh diposting), tetapi menampilkannya sebagai alarm merah
 * "Belum seimbang — selisih Rp 0" sebelum pengguna mengetik apa pun
 * adalah alarm palsu (AUDIT-UI-A25 diagnosis #8). Peringatan hanya
 * lahir pada keadaan "unbalanced": ada baris terisi DAN selisih ≠ 0.
 */
export function journalBalanceState(summary: Pick<JournalSummary, "filledCount" | "balanced">): JournalBalanceState {
  if (summary.filledCount === 0) return "empty";
  return summary.balanced ? "balanced" : "unbalanced";
}

/**
 * Nominal penyeimbang untuk tombol "Samakan": sisi yang kurang dan
 * nominalnya (string kanonis 4 desimal). Null bila sudah seimbang atau
 * belum ada nominal sama sekali.
 */
export function computeBalancing(
  lines: JournalLineDraft[],
): { side: "debit" | "credit"; amount: string } | null {
  const { difference, totalDebit, totalCredit } = summarizeJournalLines(lines);
  if (difference.isZero() || (totalDebit.isZero() && totalCredit.isZero())) return null;
  return difference.gt(0)
    ? { side: "credit", amount: toDb(difference.abs()) }
    : { side: "debit", amount: toDb(difference.abs()) };
}

/**
 * Alasan pertama mengapa jurnal belum bisa diposting — ditampilkan di
 * samping tombol Posting agar tombol nonaktif tidak misterius. Null
 * berarti siap posting. Urutan prioritas mengikuti urutan perbaikan
 * yang paling membantu pengguna.
 */
export function journalSubmitBlockReason(input: {
  filledCount: number;
  balanced: boolean;
  hasInvalidAmounts: boolean;
  difference: string;
}): string | null {
  if (input.hasInvalidAmounts) {
    return "Ada nominal yang tidak terbaca — periksa bidang yang ditandai.";
  }
  if (input.filledCount < 2) {
    return "Isi minimal dua baris (akun + nominal) untuk bisa memposting.";
  }
  if (!input.balanced) {
    return `Selisih ${formatIDR(input.difference)} — samakan total debit dan kredit untuk bisa memposting.`;
  }
  return null;
}

/**
 * Isi otomatis baris penyeimbang yang berdekatan.
 *
 * Saat pengguna selesai mengisi debit pada satu baris, baris BERIKUTNYA
 * yang sudah punya akun tetapi belum bernominal diisi kredit sebesar
 * selisih — dan sebaliknya untuk kredit (baris sebelumnya diisi debit).
 * Hanya satu baris berdekatan yang disentuh; baris lain tidak diubah.
 * Mengembalikan `lines` yang sama bila tidak ada kandidat.
 */
export function autoBalanceAdjacent(
  lines: JournalLineDraft[],
  index: number,
  side: "debit" | "credit",
): JournalLineDraft[] {
  const current = lines[index];
  if (!current) return lines;
  const entered = side === "debit" ? amount(current.debit) : amount(current.credit);
  if (!entered.gt(0)) return lines;
  const candidateIndex = side === "debit" ? index + 1 : index - 1;
  const candidate = lines[candidateIndex];
  if (!candidate?.accountId) return lines;
  if (amount(candidate.debit).gt(0) || amount(candidate.credit).gt(0)) return lines;
  const fix = computeBalancing(lines);
  if (!fix) return lines;
  const next = lines.map((line) => ({ ...line }));
  next[candidateIndex] =
    fix.side === "debit"
      ? { ...next[candidateIndex], debit: fix.amount, credit: "" }
      : { ...next[candidateIndex], credit: fix.amount, debit: "" };
  return next;
}
