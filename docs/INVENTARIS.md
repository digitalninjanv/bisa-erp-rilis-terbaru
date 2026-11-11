# INVENTARIS MODUL & ROUTE

Diperbarui: 2026-11-11. Metode: pemindaian `src/app/app/**/page.tsx`, menu modul di `src/lib/modules.ts`, dan pemetaan aksi server. Status “DIAUDIT” berarti route dibaca, alur data diperiksa, dan temuan terkait dicatat di `docs/TEMUAN.md`.

| Modul | Route utama | Status | Catatan |
| --- | --- | --- | --- |
| POS | `/app/pos`, `/app/pos/riwayat`, `/app/pos/sesi`, `/app/pos/retur`, `/app/pos/nota/[id]`, `/app/pos/nota/[id]/faktur` | DIAUDIT | Checkout, split payment, diskon, pajak, hold, void, retur, sesi kas, cetak struk/faktur. |
| Gudang | `/app/gudang`, `produk`, `pemasok`, `penerimaan`, `pembelian`, `retur-pembelian`, `uang-muka`, `penyesuaian`, `transfer`, `opname`, `pergerakan`, `nilai`, `stok`, `reservasi`, `dokumen`, `impor` | DIAUDIT | Stok dari ledger; void penerimaan/retur/dokumen; import/export Excel. |
| Akuntansi | `/app/akuntansi`, `akun`, `jurnal`, `buku-besar`, `laporan`, `pajak`, `piutang-utang`, `bank`, `rekonsiliasi`, `periode`, `aset`, `beban`, `riwayat`, `migrasi-coa` | DIAUDIT | Jurnal, COA, pemetaan, tutup buku, laporan, PPN, aging. |
| HR | `/app/akuntansi/hr`, `karyawan`, `payroll`, `kasbon`, `pinjaman`, `klaim`, `absensi`, `cuti`, `lembur`, `shift` | DIAUDIT (sebagian) | Fokus payroll/void; daftar HR besar belum semuanya berpaginasi. |
| Analisa | `/app/analisa` | DIAUDIT | Indikator kesehatan, penggerak, risiko; bergantung data penjualan. |
| Pengaturan | `/app/pengaturan` (`umum`, `pengguna`, `payroll-indonesia`, `penomoran`, `metode-pembayaran`, `kelompok-harga`, `gudang-cabang`, `pemetaan-akun`, `modul`, `kolom-kustom`, `status`) | DIAUDIT | RBAC, cetak, pemetaan akun, integritas. |
| Login/awal | `/login` | DIAUDIT | Better Auth, rate limit, sesi. |
| API | `/api/export/*`, `/api/import/*`, `/api/health`, `/api/pos/snapshot` | DIAUDIT | Ekspor mengikuti filter; impor preview/commit; health. |

## Route tanpa menu / menu tanpa route

- Tidak ditemukan route halaman yatim yang menonjol; route cetak (`(cetak)`, `/cetak`) memang tidak muncul sebagai menu.
- Route API bukan menu.
- `eyebrow` pada `PageHeader` saat ini no-op, tetapi masih dikirim banyak halaman (temuan UI-RENDAH).

## Modul yang belum selesai diaudit mendalam

- Seluruh varian laporan HR (rekap absensi/cuti/lembur) — hanya kontrak baca & paginasi yang diperiksa.
- POS desktop/Tauri dan sinkronisasi offline — arsitektur dibaca, bukan diuji perangkat.
- Import/export gudang/cabang, metode pembayaran, kelompok harga, karyawan, aset tetap — belum ada impor massal (lihat BLOKIR).
