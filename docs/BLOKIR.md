# BLOKIR & PEKERJAAN TERSISA

Daftar hal yang **belum selesai** pada putaran audit ini. Tidak ada yang dihapus
atau diabaikan diam-diam. Diperbarui 2026-11-15 setelah suite penuh hijau.

## Keamanan

1. **Pair throttle POS** masih in-memory per instance (lapisan tambahan
   di atas rate limit login yang sudah database). Multi-instance tetap
   memakai rate limit login terpusat; throttle pairing perlu storage
   bersama bila POS desktop dijalankan pada banyak replika.

## Akuntansi / stok

2. **Laporan penjualan** sudah neto retur, tetapi jumlah transaksi masih
   menghitung penjualan yang diretur; PPN retur diproporsikan, bukan per baris.
3. **Grup harga lama** dengan default 500/down masih ada; default baru 0 tetapi
   data lama perlu diedit manual.

## QA / operasional

4. **Coverage branch 79,35%** — 26 cabang lagi menuju 80%; lines/statements/functions sudah ≥89%.
5. **E2E browser** sudah 44/44 lulus pada production build; cakupan skenario
    besar sudah terbukti, tetapi belum mencakup seluruh kombinasi role/modul.
6. **Kebocoran memori dev Turbopack** sebagian ditangani (config + pembersihan
    cache), tetapi kebocoran per-render (~3.9 MB/render) di dev runtime belum
    diperbaiki (#97555). Untuk sesi panjang, gunakan production build
    (`pnpm build && pnpm start`) atau restart dev server berkala.
7. **Tes konkurensi** payroll/POS pernah flaky di bawah beban tinggi; pada
    suite penuh terakhir semuanya lulus. Perlu stabilisasi bila CI sering
    paralel.

## Import/export

13. Template XLSX tidak membawa dropdown validation/gaya sel (batas SheetJS
    Community); diganti sheet Petunjuk/Referensi.
14. Impor pemetaan akun meng-upsert; baris yang ada diperbarui, bukan dilewati —
    sudah didokumentasikan di template.

## Yang sudah ditutup

- **SEC-008** — upload impor: body streaming dibatasi 20MB, magic bytes
  XLSX/XLS/CSV divalidasi, entri/rasio/ukuran dekompresi ZIP dibatasi.
  Test `tests/unit/import-file-validation.test.ts`.
- **SEC-006** — mapper `apiErrorResponse`/`withApiError` untuk seluruh route
  export; FORBIDDEN 403, VALIDATION/Zod 400, NOT_FOUND 404, konflik 409,
  internal 500 tanpa detail. Test `tests/unit/api-error.test.ts`.
- **SEC-003** — masking `inventory.cost` di PO, penerimaan, retur, dokumen,
  dan cetak dokumen; test matriks izin `tests/unit/cost-masking.test.ts`.
- **Tanggal & jatuh tempo faktur pemasok** — kolom baru
  `stock_receipts.supplier_invoice_date`/`due_date`; form penerimaan, koreksi
  faktur, detail, cetak GRN, dan aging utang memakainya.

- **SEC-011** — gerbang modul purchasing/PR/reservasi.
- **AKN-004** — tanggal void penjualan/payroll/transfer bank.
- **Serial void** — penyesuaian/opname/karantina memulihkan nomor seri.
- **Pencarian nilai persediaan** — server-side untuk seluruh katalog + ekspor.
- **Payroll Indonesia** — engine statutory, PPh 21 TER/final, BPJS, cuti
  tidak berbayar, THR/lembur, pinjaman, dan final pay dipulihkan.
- **Ratchet ukuran berkas** — tiga berkas >800 baris dipecah.

## Cara melanjutkan

- Prioritas berikutnya: branch coverage 80% dan stabilisasi tes konkurensi.
- Ukur coverage dengan `vitest --coverage`; tambah test untuk aturan baru.
- Jalankan E2E penuh di staging sebelum go-live.
