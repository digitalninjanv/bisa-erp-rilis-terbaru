# Program Audit Produksi — Rencana & Peta Tahap

> Mandat pemilik (master prompt 2026-11-08): audit teknis & fungsional
> menyeluruh yang BERBUKTI — aplikasi dijalankan dan workflow diuji nyata
> ujung-ke-ujung, bukan hanya membaca kode. Temuan terbukti diperbaiki
> (prioritas uang, stok, jurnal, keamanan, integritas data), lalu regresi
> penuh, lalu laporan akhir dengan verdict **GO / CONDITIONAL GO / NO GO**
> (§9–§10 mandat: status PASS/FAIL/PARTIAL/BLOCKED/NOT IMPLEMENTED/
> NOT TESTED; risiko P0–P3).
>
> Register temuan hidup di `docs/audit/AUDIT-REGISTER.md`. Pemeriksaan
> integritas DB yang bisa diulang: `scripts/audit/db-integrity.sql`.
> Kontrak kualitas yang mengikat semua perbaikan: `docs/PANDUAN-KUALITAS-KODE.md`.

## Keadaan awal terverifikasi (A0, 2026-11-08)

- HEAD `82e8c15` (penutup program Satuan Kemasan), migrasi terakhir 0065.
- Baseline dari RESEED bersih (tanpa pipa, exit code per perintah):
  suite **1992/1992 (209 berkas) exit 0** · typecheck **exit 0** ·
  lint **exit 0** (0 error, 27 warning unused-vars warisan) ·
  build **exit 0** · e2e **25/25 exit 0**.
- Demo hasil reseed: 65 produk, nilai persediaan Rp28.349.600, 1 organisasi.
- Integritas DB tenant hidup: semua pemeriksaan inti **0 pelanggaran**
  (jurnal seimbang, stok konsisten, tanpa yatim/duplikat) — rincian di
  register; DB dev bersama membawa 290.896 baris residu fixture mati
  (AUD-001).

## Peta tahap

| Tahap | Isi | Gerbang keluar |
|---|---|---|
| **A0 — Analisis, peta, baseline, integritas DB** (SELESAI 2026-11-08) | Peta project & Graphify; baseline gerbang dari reseed; pemeriksaan integritas DB tertulis & terulang; register awal | Dokumen ini + register; angka baseline tercatat |
| **A1 — Audit fungsional per modul (workflow UI nyata)** | Setiap menu/fitur diuji dari UI: Master data (§3A mandat), Gudang 10 workflow (§3B), POS 15 langkah + offline (§3C), Akuntansi double-entry + 7 laporan (§3D). CRUD, validasi, duplikasi, impor/ekspor, tombol mati/fitur tampilan | Tabel kelengkapan fitur berstatus per fitur; temuan baru masuk register dgn langkah reproduksi |
| **A2 — Uji integrasi antarmodul** | Rantai ujung-ke-ujung §4 mandat: beli→terima→stok→nilai→utang→bayar→kas→jurnal→laporan; jual POS→stok→HPP→pendapatan→kas→jurnal→LR/neraca/persediaan; retur penjualan; transfer gudang; pembatalan/void. Rekonsiliasi angka laporan vs buku besar & vs ledger stok | Setiap rantai: angka di semua modul cocok ATAU temuan P0/P1 terdaftar dgn bukti selisih |
| **A3 — Peran & keamanan** | Matriks 5 peran (owner/admin/kasir/gudang/akuntan + viewer) di UI **dan** pemanggilan endpoint langsung tanpa izin; kebocoran data sensitif; konfigurasi env & rahasia; permukaan SQLi/XSS/CSRF; audit kerentanan dependensi daring (AUD-004) | Matriks akses terbukti dua sisi; temuan keamanan terdaftar per tingkat |
| **A4 — Performa & skala** | Skenario terukur: seed bulk 10.000 produk, volume transaksi penjualan besar, riwayat stok besar, pengguna bersamaan pada stok yang sama; waktu muat halaman berat & kueri; catat BATAS yang benar-benar teruji (tanpa klaim di luar bukti) | Angka benchmark per skenario + daftar bottleneck terukur |
| **A5 — Perbaikan, regresi, laporan akhir** | Perbaiki temuan terbukti prioritas P0→P1→P2 (tanpa refactor besar tanpa alasan; tanpa melemahkan test/penjaga); regresi workflow terdampak + gerbang penuh dari reseed; laporan akhir format §10 mandat (executive summary, kelengkapan fitur, workflow, bug, integritas DB & keuangan, performa & keamanan, checklist kesiapan produksi) + **FINAL VERDICT** | Laporan akhir terbit; verdict berbasis bukti |

Urutan mengikat: tahap berurutan (satu pohon kode yang sama); di dalam
tahap, audit baca-saja boleh paralel. Perbaikan hanya atas temuan yang
terbukti bereproduksi — bukan atas dugaan.

## Cakupan per modul (dari mandat, dipetakan ke permukaan nyata repo)

- **Master data** — produk/SKU/barcode/kategori/satuan + kemasan
  (program Satuan Kemasan), harga beli/jual, pajak, diskon kelompok,
  pemasok, pelanggan (+grup), karyawan, bagan akun (COA 5 digit A-27),
  gudang. CRUD + nonaktif + hapus-aman; impor/ekspor; edit master tidak
  merusak histori (cuplikan faktor & penjaga dampak akun).
- **Gudang** — penerimaan (dari PO & langsung), transfer dua tahap,
  penyesuaian, opname (buta + hitungan campuran kemasan), barang
  rusak/hilang/kedaluwarsa, retur pemasok, reservasi, pergerakan stok,
  nilai persediaan AVCO; invarian `stock_on_hand = Σ stock_movements`.
- **POS & penjualan** — sesi kas (buka/tutup buta + toleransi selisih
  A-28), keranjang & pindai (pcs + barcode kemasan), diskon baris &
  kelompok, pajak, tunai/kembalian, QRIS statis verifikasi manual
  (dinamis = AUD-007), utang pelanggan (D-19), tahan/lanjut, retur
  sebagian/penuh, void berizin, cetak & cetak ulang SALINAN, riwayat;
  **offline web (PWA)** dan **desktop Tauri** — idempotensi, sinkron
  ulang, konflik, tanpa ganda/hilang.
- **Akuntansi** — jurnal manual & otomatis semua sumber, kas & bank +
  rekonsiliasi, piutang/utang & pembayaran, saldo awal, periode &
  tutup buku, koreksi via jurnal pembalik (posted append-only);
  laporan: buku besar, neraca saldo, neraca, laba rugi, arus kas,
  aging piutang/utang, persediaan & HPP — semuanya dgn kolom
  pembanding & rekonsiliasi ke jurnal sumber.
- **HR/Payroll** (modul pendukung) — karyawan, absensi, cuti, lembur,
  kasbon/pinjaman, payroll Indonesia (izin `payroll.salary` A-28),
  jurnal gaji.
- **Pengaturan & platform** — pengguna & peran kustom, pemetaan akun,
  pengaturan cetak satu pintu, pajak, backup/restore & status sistem,
  terminal desktop & rilis updater.

## Keputusan pemilik yang BUKAN pekerjaan audit (jangan dieksekusi diam-diam)

PIN supervisor POS · integrasi PSP QRIS dinamis · kanal rilis desktop &
sertifikat Windows · scheduler `a24-lanjut-otomatis` · daftar keputusan
warisan A-24 §3. Audit hanya memverifikasi keadaan & mencatat dampaknya
di register.
