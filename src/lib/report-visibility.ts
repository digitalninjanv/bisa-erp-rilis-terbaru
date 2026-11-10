/**
 * A-28 UI-3 (AKT-09): SATU definisi "akun hampa" untuk ketiga
 * permukaan laporan — layar, cetak resmi, dan ekspor (CSV/XLSX).
 * Sebuah baris akun disebut hampa bila nilainya nol pada periode
 * berjalan DAN nol pada periode pembanding: akun yang hanya bergerak
 * tahun lalu (atau hanya tahun ini) tetap tampil agar kolom
 * pembanding tidak berbohong. Penyaringan murni presentasi — total
 * kelompok/dokumen selalu dihitung server dari himpunan PENUH, jadi
 * menyembunyikan baris tidak pernah mengubah satu pun angka total.
 *
 * Bawaan laporan: hampa disembunyikan; saklar "Tampilkan akun
 * bersaldo nol" (parameter `nol=1`) menampilkannya lagi di ketiga
 * permukaan sekaligus.
 */

export type StatementLineLike = { accountId: string; amount: number };

/** Baris laporan berkala (laba rugi, posisi keuangan): nol di kedua periode. */
export function isEmptyStatementLine(
  line: StatementLineLike,
  priorByAccount: Map<string, number>,
): boolean {
  return line.amount === 0 && (priorByAccount.get(line.accountId) ?? 0) === 0;
}

export function visibleStatementLines<T extends StatementLineLike>(
  lines: T[],
  priorLines: StatementLineLike[],
  hideZero: boolean,
): T[] {
  if (!hideZero) return lines;
  const priorByAccount = new Map(priorLines.map((row) => [row.accountId, row.amount]));
  return lines.filter((line) => !isEmptyStatementLine(line, priorByAccount));
}

/**
 * Validasi 2 (V-06): sebuah kelompok disebut hampa persis seperti
 * yang dirender — tidak ada satu pun baris tampak sesudah saringan
 * akun nol. Dipakai permukaan laporan untuk memutuskan keadaan
 * kosong ringkas: bila SEMUA kelompok sebuah laporan hampa, layar
 * menampilkan satu keadaan kosong, bukan "Tidak ada mutasi" yang
 * berulang per kelompok. Begitu satu kelompok punya baris tampak,
 * struktur kelompok tampil utuh lagi. Murni presentasi — total
 * tetap dihitung dari himpunan penuh.
 */
export function isStatementGroupEmpty(
  lines: StatementLineLike[],
  priorLines: StatementLineLike[],
  hideZero: boolean,
): boolean {
  return visibleStatementLines(lines, priorLines, hideZero).length === 0;
}

/** True bila setiap kelompok dalam daftar hampa menurut definisi di atas. */
export function allStatementGroupsEmpty(
  groups: { current: StatementLineLike[]; prior: StatementLineLike[] }[],
  hideZero: boolean,
): boolean {
  return groups.every((group) =>
    isStatementGroupEmpty(group.current, group.prior, hideZero),
  );
}

export type TrialRowLike = {
  accountId: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

/** Baris neraca saldo: semua kolom gerak & saldo nol di kedua periode. */
export function visibleTrialRows<T extends TrialRowLike>(
  rows: T[],
  priorRows: { accountId: string; closing: number }[],
  hideZero: boolean,
): T[] {
  if (!hideZero) return rows;
  const priorClosing = new Map(priorRows.map((row) => [row.accountId, row.closing]));
  return rows.filter(
    (row) =>
      row.opening !== 0 ||
      row.debit !== 0 ||
      row.credit !== 0 ||
      row.closing !== 0 ||
      (priorClosing.get(row.accountId) ?? 0) !== 0,
  );
}

export type EquityRowLike = {
  accountId: string;
  opening: number;
  addition: number;
  reduction: number;
  closing: number;
};

/** Baris perubahan ekuitas: saldo & gerak nol di kedua periode. */
export function visibleEquityRows<T extends EquityRowLike>(
  rows: T[],
  priorRows: { accountId: string; closing: number }[],
  hideZero: boolean,
): T[] {
  if (!hideZero) return rows;
  const priorClosing = new Map(priorRows.map((row) => [row.accountId, row.closing]));
  return rows.filter(
    (row) =>
      row.opening !== 0 ||
      row.addition !== 0 ||
      row.reduction !== 0 ||
      row.closing !== 0 ||
      (priorClosing.get(row.accountId) ?? 0) !== 0,
  );
}
