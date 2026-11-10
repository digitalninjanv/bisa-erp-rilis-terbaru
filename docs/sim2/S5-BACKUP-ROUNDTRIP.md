# SIM-2 Fase S5 — Backup/Restore & Round-Trip Penuh (mandat §11)

Tanggal uji: 2026-11-04. Lingkungan: DB dev `bisa` di PostgreSQL 18.6
(port 5433). Semua angka di bawah dihasilkan dari perintah yang
benar-benar dijalankan pada fase ini; artefak bukti (dump, metrik,
keluaran fungsi laporan) tersimpan di `~/workspace/bukti-sim2/`.
Prinsip yang diuji: **backup tidak dianggap valid sebelum restore
berhasil — dan restore tidak dianggap berhasil sebelum angka cocok.**

## Ringkasan vonis

| Jalur | Hasil |
|---|---|
| Backup → restore tingkat DB (database baru) | **PASS — identik penuh** (80 tabel, neraca saldo, valuasi, subledger, fungsi laporan aplikasi) |
| Backup terenkripsi → restore | **PASS — identik penuh**; frasa sandi salah ditolak |
| Round-trip tingkat aplikasi (ekspor → perusahaan kosong → impor) | **PARTIAL secara desain** — master + stok awal + saldo awal AR/AP utuh; riwayat jurnal transaksi tidak punya jalur (RT-04) |
| Penjadwalan backup & uji restore berkala | **NOT IMPLEMENTED** — requirement tertulis di runbook |

## Langkah 1 — Backup/restore tingkat DB

### 1.1 Kegagalan awal yang terbukti (RT-01, RT-02)

Menjalankan prosedur terdokumentasi apa adanya gagal total:

```text
$ pnpm db:backup
pg_dump: error: aborting because of server version mismatch
pg_dump: detail: server version: 18.6; pg_dump version: 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
```

- **RT-01 (P1 — lingkungan/prosedur)**: mesin dev hanya punya client
  PostgreSQL 16 (sistem) sedangkan server 18.6; distribusi Zonky yang
  membawa server hanya berisi biner server (`initdb/pg_ctl/postgres`),
  dan podman tidak tersedia, jadi fallback skrip pun tidak bisa jalan.
  Prosedur backup **tidak dapat dijalankan sama sekali** di lingkungan
  ini sampai client ≥ versi server tersedia. Untuk uji ini client
  resmi PGDG `postgresql-client-18` 18.6 diekstrak (tanpa install
  sistem) ke `.local/pg18-client/` dan dipakai lewat `PATH`.
  Runbook kini menyatakan prasyarat versi ini secara eksplisit.
- **RT-02 (P2 — skrip, DIPERBAIKI)**: kegagalan di atas meninggalkan
  berkas `backups/bisa-*.dump` berukuran **0 byte** — tampak seperti
  backup, padahal kosong. `scripts/backup.sh` kini menulis ke berkas
  `.tmp` dan hanya mengganti nama saat dump sukses; terbukti pada uji
  kegagalan ulang: exit 1 dan **tidak ada berkas sisa**.

### 1.2 Backup & restore yang berhasil

| Ukuran | Nilai |
|---|---|
| Berkas backup | `bisa-20261104-050817.dump`, **2.699.103 byte**, sha256 `4c6dea98911ff0de021498aee2434670a0054c4fd8933b7350a7f6e4540c99cf` |
| Durasi backup | **3 detik** |
| Isi dump (`pg_restore --list`) | 552 baris daftar isi, terbaca penuh |
| Restore #1 ke DB baru `bisa_erp_restore_test` (flag persis `restore.sh`) | exit 0, **11 detik**, tanpa error |
| Restore #2 via `scripts/restore.sh` (salinan skrip, `.env.local` menunjuk DB sekali pakai) | exit 0 |
| Penjaga skrip restore tanpa `--yes` | menolak, exit 1 ✓ |

Perbandingan sumber vs hasil restore memakai satu skrip metrik yang
sama (`~/workspace/bukti-sim2/metrics.sh`) atas kedua database:
**`diff` kosong — identik pada seluruh butir**:

- Jumlah baris **seluruh ±80 tabel** publik (antara lain
  `journal_entries` 5.638, `journal_lines` 17.314, `sales` 1.460,
  `products` 1.354, `stock_movements` 4.442, `audit_log` 10.404,
  `organization` 1, `user` 1, `member` 1).
- Neraca saldo per perusahaan: debit = kredit, selisih **0,0000** di
  semua perusahaan; perusahaan demo Rp11.263.172.602,1414 = Rp11.263.172.602,1414.
- Jurnal posted yang tidak seimbang: **0**.
- Nilai persediaan per perusahaan (Σ on-hand × harga pokok) sama;
  demo: **Rp36.214.997,8927**.
- Saldo GL akun terpetakan (kas/persediaan/utang/piutang) sama; demo:
  Utang Usaha **Rp12.414.000 Cr**, penerimaan belum lunas 1 dokumen
  **Rp7.864.000**.
- Migrasi tercatat: 31 baris `__drizzle_migrations`; menjalankan
  `pnpm db:migrate` pada DB hasil restore = **no-op** (sudah di head,
  tidak perlu migrasi tambahan).
- Stempel transaksi terakhir sebelum backup hadir persis: jurnal
  terakhir `2026-11-04 05:05:27.638651+00`, audit terakhir
  `05:05:44.600467+00` — tidak ada transaksi ter-commit yang hilang
  (snapshot pg_dump bersifat transaksional).

### 1.3 Pemeriksaan tingkat aplikasi pada DB hasil restore (RT-03)

Fungsi laporan domain asli (`getTrialBalance`, `getBalanceSheet`,
`getInventoryValuation`, `listReceivables`, `listPayables` dari
`src/server/reports.ts`) dijalankan sebagai `app_user` di bawah RLS
(`withCompanyReadOnly`) terhadap perusahaan demo di **kedua** DB:
keluaran JSON **identik byte-per-byte** (108.383 byte; valuasi aplikasi
Rp36.214.997,8927 cocok dengan hitungan SQL).

- **RT-03 (P1 — disaster recovery, DIPERBAIKI secara prosedural)**:
  sebelum grant diterapkan ulang, pemeriksaan itu mustahil — restore
  ke database **baru** menghasilkan **0 grant** untuk `app_user`
  (`permission denied for table products`), karena dump dibuat dengan
  `--no-privileges`. Aplikasi hasil restore ke server/DB baru mati
  total sampai grant diterapkan. (Restore ke DB **yang sama** aman:
  default privileges yang sudah hidup di DB itu berlaku bagi objek
  yang dibuat ulang.) Perbaikan: `docs/RUNBOOK-BACKUP-RESTORE.md`
  memuat langkah wajib penerapan ulang blok grant dari migrasi 0001 /
  `docker/init.sql`; sesudah langkah itu akses `app_user` pulih dan
  laporan identik seperti di atas. Rekomendasi lanjutan (belum
  dikerjakan): sediakan `scripts/post-restore-grants.sql` resmi atau
  nilai ulang pilihan `--no-privileges` untuk paket rilis.

Ketiga database uji restore **sudah di-drop** di akhir fase; DB dev
tidak pernah ditimpa.

## Langkah 2 — Round-trip tingkat aplikasi

Test permanen: `tests/sim2/s5-roundtrip.test.ts` (12 test, hijau).
Perusahaan sumber fixture `…cc05` menjalankan bisnis nyata lewat
domain: penerimaan pembelian kredit Rp450.000, saldo awal utang
Rp75.000, saldo awal piutang Rp120.000, penjualan POS tunai Rp15.000,
penjualan POS utang Rp125.000. Ekspor dilakukan dengan **memanggil
rute ekspor aplikasi asli** (produk/pemasok/pelanggan/akun), impor ke
perusahaan kosong `…cc06` dengan **aksi impor asli**
(job → `analyzeImportAction` → `commitImportBatchAction`).

### 2.1 Hasil per entitas (sumber → tujuan)

| Entitas | Sumber | Tujuan | Bukti commit impor |
|---|---|---|---|
| Akun (COA) | 37 (36 standar + 1 kustom `6950`) | 37, kode unik 37 | imported 1, **skipped 36**, failed 0 |
| Pemasok | 2 | 2 | imported 2 |
| Pelanggan | 2 | 2 | imported 2 |
| Produk | 2 | 2 | imported 2 (lihat RT-06 untuk impor ulang) |
| Stok (qty) | RT-001: 95, RT-002: 10 | **95 / 10** | opening_stock imported 2, penerimaan `RCV-2026-00001` terbit |
| Nilai persediaan | Rp337.500 | **Rp337.500** | `getInventoryValuation` kedua perusahaan |
| Utang terbuka | Rp525.000 (2 dokumen) | **Rp525.000 (2 dokumen saldo awal)** | opening_payables imported 2 |
| Piutang terbuka | Rp245.000 (2 dokumen) | **Rp245.000 (2 dokumen saldo awal)** | opening_receivables imported 2 |

Field master yang ikut berpindah utuh (ditegaskan di test): NPWP,
bank, nomor rekening, atas nama, termin 30 hari (pemasok); NPWP,
termin 14 hari, batas kredit Rp5.000.000 (pelanggan); harga
beli/jual, barcode, kategori, satuan, pemasok bawaan (produk).

Neraca perusahaan tujuan sesudah round-trip — hanya dari dokumen
saldo awal & stok awal, dan **seimbang**: Persediaan Rp337.500 Dr,
Piutang Rp245.000 Dr, Utang Rp525.000 Cr, Modal (ekuitas pembuka)
Rp57.500 Cr; total debit jurnal = total kredit.

### 2.2 Batas yang terbukti (RT-04)

- **RT-04 (P1 — batas §11 tingkat aplikasi, NOT IMPLEMENTED by
  design)**: riwayat transaksi terposting **tidak bisa** ikut
  round-trip. Di sumber: Pendapatan Rp140.000 Cr, HPP Rp112.500 Dr,
  Kas Rp15.000 Dr. Di tujuan ketiganya **Rp0** — memang tidak ada
  jurnal apa pun selain jurnal pembuka. Sebabnya struktural: ekspor
  jurnal hanya berupa unduhan per dokumen & buku besar satu arah;
  **tidak ada impor jurnal**. Konsekuensi jujur: migrasi lewat jalur
  aplikasi = mulai dari saldo awal (master + stok + AR/AP), laporan
  historis tidak direproduksi. Untuk pemindahan utuh satu sistem,
  jalur yang benar dan terbukti adalah backup/restore DB (Langkah 1).
  Requirement bila migrasi antar-sistem suatu hari dibutuhkan:
  ekspor jurnal massal terstruktur + impor jurnal dengan validasi
  keseimbangan & periode — belum dibangun, tidak disimulasikan di sini.

- **RT-05 (P3 — observasi)**: impor COA ke perusahaan yang sudah
  memiliki bagan standar melewati 36 kode yang sama sebagai
  `skipped` generik; hasil akhir benar (tanpa duplikat, akun kustom
  masuk), tetapi ringkasan commit tidak membedakan "sudah ada" dari
  jenis lewati lain (alasan tersedia di status baris impor).
- **RT-06 (P3 — observasi)**: impor ulang berkas produk yang sama ke
  perusahaan tujuan menghasilkan `skipped 2, imported 0` dan jumlah
  produk tetap 2 — aman dari duplikasi; pada jalur commit job baru,
  SKU yang sudah ada diperlakukan sebagai lewati, bukan update.

## Langkah 3 — Penguatan yang dikerjakan

1. **`docs/RUNBOOK-BACKUP-RESTORE.md`** (baru): prosedur terbukti —
   prasyarat versi client, backup, verifikasi berkas (ukuran + sha256
   + `pg_restore --list`), restore DB sama, restore DB/server baru
   **termasuk langkah grant wajib**, kueri verifikasi sesudah
   restore, dan requirement penjadwalan/uji berkala.
2. **Enkripsi backup opt-in** di `scripts/backup.sh` /
   `scripts/restore.sh`: `BACKUP_PASSPHRASE` → berkas `.dump.enc`
   (openssl AES-256-CBC + PBKDF2). Perilaku bawaan tanpa frasa sandi
   **tidak berubah**. Terbukti end-to-end: backup terenkripsi
   2.699.120 byte → restore via skrip ke DB sekali pakai → metrik
   **identik** dengan sumber; frasa sandi salah → `bad decrypt`,
   exit 1, tidak ada restore; berkas dekripsi sementara selalu
   dibersihkan.
3. **Perbaikan artefak 0 byte** (RT-02) seperti di §1.1.
4. Requirement penjadwalan backup, retensi, penyimpanan off-site,
   dan uji restore berkala otomatis ditulis di runbook §"Requirement
   lanjutan" — **tidak dibangun** pada fase ini.

## Langkah 4 — Skenario rusak & integritas referensial

Pemeriksaan yatim dijalankan identik di DB sumber dan DB hasil
restore (keduanya sama persis — restore tidak menambah dan tidak
membersihkan kerusakan yang sudah ada; itu perilaku yang benar untuk
alat pemulihan):

| Pemeriksaan | Sumber | Restore |
|---|---|---|
| `journal_lines` tanpa entri / tanpa akun | 0 / 0 | 0 / 0 |
| `sale_lines` tanpa penjualan | 0 | 0 |
| `stock_on_hand` tanpa produk | **46 baris** (qty total 322) | **46 baris** |
| `stock_movements` tanpa produk | **142 baris** | **142 baris** |
| Pasangan (produk,gudang) Σ gerakan ≠ on-hand | 2 | 2 |

- **RT-07 (P2 — integritas data fixture)**: seluruh baris yatim
  berada di satu perusahaan `01900000-…-0001` (perusahaan
  demo/fixture bersama) dan berasal dari pembersihan test yang
  menghapus produk langsung via SQL — **mustahil lewat UI** (penjaga
  hapus produk menolak produk berstok/bertransaksi; S0-B). Angka
  bertambah dari 32 (saat S0-B) menjadi 46 karena aktivitas fixture
  S1–S4. Dampak ke laporan: **nol** (valuasi & kartu stok men-join
  produk), tetapi `stock_on_hand.product_id` &
  `stock_movements.product_id` memang **tanpa FK database**, jadi
  invariant-nya hanya dijaga aplikasi. Rekomendasi S7: nilai FK /
  bersihkan fixture / halaman kualitas data (sudah direkomendasikan
  S0-B §5).
- **RT-08 (P3)**: 2 pasangan Σ gerakan ≠ on-hand terkait baris yatim
  RT-07 (produk terhapus); bukan akibat restore dan bukan di
  perusahaan non-fixture.

## Status §11 per butir

| Butir §11 | Status | Bukti |
|---|---|---|
| Backup database (manual) | **PASS** (dengan prasyarat client ≥ server, RT-01) | §1.2 |
| Backup terenkripsi | **PASS** (baru di S5, opt-in) | Langkah 3.2 |
| Restore teruji ke DB baru | **PASS** | §1.2, §1.3 (3× restore, identik) |
| Verifikasi sesudah restore terdokumentasi | **PASS** | Runbook |
| Round-trip master (produk/pihak/akun) | **PASS** | §2.1 |
| Round-trip stok & nilai persediaan | **PASS** (jalur stok awal) | §2.1 |
| Round-trip saldo awal AR/AP | **PASS** (per dokumen, aging utuh) | §2.1 |
| Round-trip transaksi & jurnal penuh (tingkat aplikasi) | **NOT IMPLEMENTED** (RT-04) | §2.2 |
| Dokumentasi format ekspor/impor & recovery | **PASS** | Runbook + template/contoh CSV bawaan aplikasi |
| Backup terjadwal + retensi + off-site | **NOT IMPLEMENTED** | Requirement di runbook |
| Uji restore berkala otomatis | **NOT IMPLEMENTED** | Requirement di runbook |

## Gerbang akhir fase

- `pnpm test`: **705/705 lulus, 77 berkas** (termasuk 12 test baru
  `tests/sim2/s5-roundtrip.test.ts`).
- `pnpm typecheck`: bersih.
- Perubahan pohon kerja: `scripts/backup.sh`, `scripts/restore.sh`
  (diubah minimal), `docs/RUNBOOK-BACKUP-RESTORE.md` (baru),
  `tests/sim2/s5-roundtrip.test.ts` (baru), laporan ini. Tidak ada
  perubahan perilaku aplikasi; tidak ada migrasi baru. **Tidak
  di-commit** (menunggu Pemimpin).
