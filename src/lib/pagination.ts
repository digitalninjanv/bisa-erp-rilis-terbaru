/**
 * Mekanik paginasi bersama (A-26 Q5, menutup P-06/D-05) — rumah tunggal
 * untuk normalisasi parameter halaman, hitung offset, bentuk hasil
 * halaman, dan parse parameter `page` dari searchParams halaman.
 * Murni: tanpa akses DB/framework, teruji unit langsung.
 *
 * Idiom yang dibakukan adalah idiom mayoritas yang sudah berjalan di
 * server: page dijepit `Math.max(1, page ?? 1)` dan pageSize dijepit
 * `Math.min(200, Math.max(1, pageSize ?? <bawaan per situs>))`. Nilai
 * bawaan per situs tetap ada sebagai jaring pengaman, tetapi sejak G3
 * ukuran halaman daftar disatukan di `LIST_PAGE_SIZE` di bawah.
 *
 * Situs yang semantiknya memang berbeda TIDAK dipaksa ke helper ini:
 * batas 100 di laporan & audit, `Math.floor` di riwayat sesi kas,
 * paginasi kondisional di laporan persediaan, dan pageSize
 * `listMovements` yang historis tanpa jepit bawah (dipertahankan
 * persis di tempatnya, tercatat di laporan Q5).
 */

/**
 * G3 (TBL-01): SATU ukuran halaman baku untuk semua daftar halaman yang
 * tumbuh. 40 dipilih karena sudah dominan di repo — daftar dokumen
 * gudang (penerimaan, PO, opname, penyesuaian, transfer, retur
 * pembelian, reservasi) dan subtotal AR/AP sudah memakai 40 — dan
 * cukup besar untuk kerja daftar master tanpa menggulir berlebihan,
 * cukup kecil agar halaman tetap ringan. Halaman daftar WAJIB mengoper
 * nilai ini secara eksplisit ke fungsi bacanya.
 *
 * Pengecualian tertulis (bukan daftar halaman biasa — jangan disamakan):
 * laporan buku besar 50 (permukaan laporan), sub-daftar di halaman
 * detail (10–20), daftar pendek Pengaturan (20), lembar hitung opname
 * 200 (satu lembar kerja utuh), ekspor 100. Default `pageSize` di
 * dalam fungsi baca server tetap jaring pengaman API per situs, bukan
 * ukuran halaman daftar.
 */
export const LIST_PAGE_SIZE = 40;

/** Batas atas pageSize pada idiom paginasi server mayoritas. */
export const MAX_PAGE_SIZE = 200;

export type PageParams = {
  page: number;
  pageSize: number;
};

/** Bentuk hasil halaman kanonis untuk fungsi baca terpaginasi. */
export type PageResult<Row> = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** Jepit nomor halaman: `Math.max(1, page ?? 1)` — idiom server berjalan. */
export function normalizePage(page: number | undefined): number {
  return Math.max(1, page ?? 1);
}

/**
 * Normalisasi pasangan page/pageSize dengan nilai bawaan pageSize per
 * situs. pageSize dijepit ke 1..MAX_PAGE_SIZE.
 */
export function normalizePageParams(
  input: { page?: number; pageSize?: number },
  defaultPageSize: number,
): PageParams {
  return {
    page: normalizePage(input.page),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? defaultPageSize)),
  };
}

/** Offset baris untuk pasangan page/pageSize yang sudah dinormalisasi. */
export function pageOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** Jumlah halaman dari total baris; 0 bila pageSize tidak sah. */
export function totalPages(total: number, pageSize: number): number {
  return pageSize > 0 ? Math.ceil(total / pageSize) : 0;
}

/** Rakit hasil halaman kanonis dari baris satu halaman + total. */
export function pageResult<Row>(
  rows: Row[],
  total: number,
  page: number,
  pageSize: number,
): PageResult<Row> {
  return { rows, total, page, pageSize, totalPages: totalPages(total, pageSize) };
}

/**
 * Parse parameter `page` dari searchParams halaman — ekstraksi persis
 * idiom yang selama ini ditulis inline di halaman
 * (`Number(params.page ?? 1)`): nilai tak absah menghasilkan NaN dan
 * penjepitan otoritatif tetap di server lewat normalizePageParams.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  return Number(raw ?? 1);
}
