# BLOKIR & PEKERJAAN TERSISA

Daftar hal yang **belum selesai** pada putaran audit ini. Tidak ada yang dihapus atau diabaikan diam-diam.

## Keamanan

1. **SEC-003 — kebocoran `inventory.cost`.** Dashboard gudang, dashboard utama, dan pergerakan sudah disaring; PO, penerimaan, retur, dokumen, dan reservasi masih menampilkan HPP/nilai untuk pengguna tanpa `inventory.cost`. Perlu masking terpusat di sisa halaman.
2. **SEC-006 — status error export.** Route export belum memetakan `AppError`/`ZodError` ke 401/403/400/404; kesalahan izin/parameter bisa menjadi 500.
3. **SEC-008 — batas upload.** Content-Length >20MB sudah ditolak sebelum `formData()`; parsing workbook masih memuat seluruh isi dan belum ada validasi magic bytes/zip bomb.
4. **SEC-011 — gerbang modul.** Beberapa aksi PO/PR/reservasi memakai `requirePermission`, bukan `requirePermissionInModule`.
5. **SEC-012/013 — rate limit & CSP.** Rate limit in-memory; CSP masih `unsafe-inline`; logo URL diblokir CSP.
6. **Installer HTTPS.** Runtime mewajibkan HTTPS produksi, tetapi contoh `deploy/env.prod.example`/`install.sh` masih mencontohkan HTTP; perlu diperbarui agar operator tidak memakai flag insecure.

## Akuntansi / stok

7. **AKN-004 lanjutan — tanggal void.** Void beban sudah memakai tanggal asal; void payroll, penjualan, dan transfer bank masih memakai tanggal hari ini. Dampaknya beban/pendapatan bulan berjalan bisa negatif bila dokumen asal dari periode lain.
8. **Retur pemasok/stock document serial void.** Kuantitas dan AVCO sudah dipulihkan, tetapi serial untuk adjustment/opname quarantine belum selalu dikembalikan.
9. **Laporan penjualan** sudah neto retur, tetapi jumlah transaksi masih menghitung penjualan yang diretur; PPN retur diproporsikan, bukan per baris.
10. **Grup harga lama** dengan default 500/down masih ada; default baru 0 tetapi data lama perlu diedit manual.

## QA / data uji

11. **Coverage 80%** untuk logika akuntansi/stok belum diukur formal; test baru mencakup kasus yang diperbaiki, bukan seluruh cabang.
12. **E2E browser** belum dijalankan ulang untuk seluruh alur setup→pembelian→POS→tutup buku; UI utama diperiksa manual/Playwright untuk halaman yang diubah.
13. **Full suite** di DB uji: 2254/2254 pada putaran audit; putaran cetak 2252/2254 karena 2 tes balapan (payroll & idempotensi POS) sensitif beban. Keduanya lulus 29/29 saat diisolasi; perlu stabilisasi tes konkurensi. Database pengguna tidak di-seed ulang; 497 produk dan penjualan yang ada adalah data pengguna.

## Import/export

14. Belum ada impor massal untuk gudang/cabang, metode pembayaran, kelompok harga, karyawan, dan aset tetap.
15. Template XLSX tidak membawa dropdown validation/gaya sel (batas SheetJS Community); diganti sheet Petunjuk/Referensi.
16. Impor pemetaan akun meng-upsert; baris yang ada diperbarui, bukan dilewati — sudah didokumentasikan di template.

## Cara melanjutkan

- Selesaikan SEC-003/SEC-005 terlebih dahulu (kerahasiaan biaya & akses terminal). SEC-005 sudah ditutup; prioritas sekarang SEC-003.
- Lanjutkan AKN-004 ke payroll/sale/bank transfer.
- Buat seed demo dengan beberapa transaksi agar tes analytics tidak bergantung pada urutan tes.
- Ukur coverage dengan `vitest --coverage`; tambah test untuk setiap aturan validasi baru.
