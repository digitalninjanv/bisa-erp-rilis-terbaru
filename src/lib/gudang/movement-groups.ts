/**
 * A-28 UI-4 (UX-C03 / sisa GDG-08) — pengelompokan baris pergerakan
 * stok per dokumen asal untuk permukaan ringkasan (beranda Gudang).
 *
 * Fungsi murni: masukan adalah baris yang SUDAH terurut menurun
 * menurut waktu (urutan baca server tidak diubah); baris yang
 * berurutan dengan dokumen asal yang sama (referenceType +
 * referenceId; untuk referensi tanpa id — mis. stok awal "opening" —
 * referenceType + referenceNumber) menjadi satu grup. Baris tanpa
 * referensi apa pun selalu menjadi grup sendiri agar tidak pernah
 * tertempel ke dokumen tetangganya.
 */

export type MovementGroupRow = {
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
};

export type MovementGroup<T extends MovementGroupRow> = {
  key: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  rows: T[];
};

function groupKey(row: MovementGroupRow, index: number): string | null {
  if (row.referenceId) return `id:${row.referenceType ?? ""}:${row.referenceId}`;
  if (row.referenceNumber) return `num:${row.referenceType ?? ""}:${row.referenceNumber}`;
  // Tanpa referensi: tidak pernah berkelompok (kunci unik per baris
  // ditangani pemanggil lewat fallback index).
  void index;
  return null;
}

export function groupMovementsByDocument<T extends MovementGroupRow>(
  rows: readonly T[],
): MovementGroup<T>[] {
  const groups: MovementGroup<T>[] = [];
  rows.forEach((row, index) => {
    const key = groupKey(row, index);
    const last = groups[groups.length - 1];
    if (key !== null && last && last.key === key) {
      last.rows.push(row);
      return;
    }
    groups.push({
      key: key ?? `solo:${index}`,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      referenceNumber: row.referenceNumber,
      rows: [row],
    });
  });
  return groups;
}
