/**
 * FIX-P1 Tahap 5 (AK5-05 + AK3-07): logika jatuh tempo bersama untuk
 * daftar piutang/utang dan ekspor aging. Semua perhitungan memakai
 * tanggal kalender (UTC murni dari string ISO) agar tidak bergeser oleh
 * zona waktu server.
 */

export function addDaysISO(date: string, days: number): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export type DueDateStatus =
  | { kind: "overdue"; days: number }
  | { kind: "today"; days: 0 }
  | { kind: "upcoming"; days: number };

/**
 * Status jatuh tempo relatif terhadap `today` (keduanya tanggal ISO).
 * `days` selalu positif: hari keterlambatan untuk overdue, sisa hari
 * untuk upcoming. Null bila tidak ada tanggal tempo yang valid.
 */
export function dueDateStatus(
  dueDate: string | null | undefined,
  today: string,
): DueDateStatus | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date(`${today.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null;
  const diff = Math.round((due - now) / 86_400_000);
  if (diff < 0) return { kind: "overdue", days: -diff };
  if (diff === 0) return { kind: "today", days: 0 };
  return { kind: "upcoming", days: diff };
}

/**
 * A-22 Tahap K6 (sisa K5): filter status daftar piutang & utang.
 * Baris sumbernya PERSIS baris listReceivables/listPayables (dokumen
 * terbuka saja: paymentStatus unpaid/partial — tidak ada baris lunas
 * di daftar itu, jadi chip "Lunas" tidak ditawarkan). Definisi tempo
 * menyamai angka antrean dashboard (getReceivablePayableQueues):
 * terlambat = tempo < hari ini; jatuh-tempo = tempo ≤ hari ini + 7
 * (gabungan overdue + dueSoon pada kartu "Utang jatuh tempo").
 */
export type ArApStatusFilter = "semua" | "belum-lunas" | "sebagian" | "terlambat" | "jatuh-tempo";

export const AR_AP_STATUS_FILTERS: readonly ArApStatusFilter[] = [
  "semua",
  "belum-lunas",
  "sebagian",
  "terlambat",
  "jatuh-tempo",
];

const AR_AP_STATUS_LABELS: Record<ArApStatusFilter, string> = {
  semua: "Semua",
  "belum-lunas": "Belum lunas",
  sebagian: "Sebagian",
  terlambat: "Terlambat",
  "jatuh-tempo": "Jatuh tempo ≤ 7 hari",
};

export function arApStatusLabel(status: ArApStatusFilter): string {
  return AR_AP_STATUS_LABELS[status];
}

/** Parameter URL aman: nilai apa pun di luar daftar sah → "semua". */
export function parseArApStatus(raw: string | undefined): ArApStatusFilter {
  return (AR_AP_STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as ArApStatusFilter)
    : "semua";
}

export function filterArApRows<T extends { paymentStatus: string; dueDate: string | null }>(
  rows: readonly T[],
  status: ArApStatusFilter,
  today: string,
): T[] {
  switch (status) {
    case "semua":
      return [...rows];
    case "belum-lunas":
      return rows.filter((row) => row.paymentStatus === "unpaid");
    case "sebagian":
      return rows.filter((row) => row.paymentStatus === "partial");
    case "terlambat":
      return rows.filter((row) => dueDateStatus(row.dueDate, today)?.kind === "overdue");
    case "jatuh-tempo": {
      const limit = addDaysISO(today, 7);
      return rows.filter((row) => row.dueDate != null && String(row.dueDate).slice(0, 10) <= limit);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Umur dokumen & kelompok aging (A-26 Q1b, D-01)                     */
/* ------------------------------------------------------------------ */

/**
 * Label kelompok umur dokumen — batas inklusif 30/60/90 hari dari
 * tanggal dokumen (aturan proyek: aging berbasis tanggal dokumen).
 * Satu definisi untuk kartu umur di halaman piutang-utang DAN kolom
 * "Kelompok umur" ekspor aging; sebelum tahap ini keduanya menulis
 * batas & labelnya masing-masing.
 */
export const AGING_BUCKET_LABELS = ["0–30 hari", "31–60 hari", "61–90 hari", "> 90 hari"] as const;

/**
 * Umur dokumen dalam hari kalender: `today` dikurangi tanggal
 * dokumen, tidak pernah negatif (dokumen bertanggal masa depan
 * berumur 0). Kedua tanggal diurai sebagai tanggal kalender UTC
 * murni dari string ISO — pola yang sama seperti dueDateStatus.
 *
 * Catatan paritas D-01: dua implementasi lama berbeda MEKANIK tetapi
 * identik hasil — ekspor lama mengurai UTC + Math.round, halaman
 * lama mengurai +07:00 + Math.floor. Karena kedua operan selalu
 * tanggal-saja pada offset yang sama di masing-masing implementasi,
 * selisihnya selalu kelipatan persis 86_400_000 ms, jadi
 * round/floor/nilai persis selalu sama. Bentuk di sini mengikuti
 * ekspor (UTC) & gaya berkas ini.
 */
export function ageDays(date: string, today: string): number {
  const start = new Date(`${String(date).slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${String(today).slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Indeks kelompok umur (0–3) untuk umur `days`. */
export function ageBucketIndex(days: number): number {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
}

/** Label kelompok umur untuk umur `days`. */
export function ageBucketLabel(days: number): string {
  return AGING_BUCKET_LABELS[ageBucketIndex(days)];
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Belum dibayar",
  partial: "Sebagian",
  paid: "Lunas",
};

/** Label status pembayaran Bahasa Indonesia (AK5-05/AK5-16). */
export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}
