# CHANGELOG — Bisa ERP

Catatan perubahan penting & keputusan teknis per program. Status resmi &
rincian bukti hidup di `PROGRESS.md`; daftar ini ringkasannya per tanggal.
Format: yang terbaru di atas.

## [Overhaul UX] Jurnal Umum & laporan satu periode — 2026-11-09

Tindak lanjut mandat overhaul minimarket (Accurate-like). Fase ini
mengerjakan permukaan yang paling sering dipakai kasir/akuntan tanpa
mengubah mesin jurnal atau keseimbangan ledger.

- **Jurnal Umum**: formulir mulai dengan **3 baris**; tombol
  **Tambah 2 baris**; kolom **Kredit merah**; **Pola cepat** dan
  **Memo** dihapus; **Keterangan opsional** (server memakai
  `Jurnal umum` bila kosong); baris berdekatan yang akunnya sudah
  dipilih terisi otomatis sebagai penyeimbang saat field ditinggalkan;
  setelah simpan langsung ke **histori** (bukan halaman detail).
- **Histori jurnal**: filter baru **User** (pembuat) di samping
  tanggal, akun, sumber, dan status; ekspor CSV mengikuti filter itu.
- **Laporan keuangan**: layar dan cetak resmi kini **satu periode** —
  kolom pembanding tahun lalu, saklar "Pembanding", dan CSS-nya
  dihapus. Data tetap dari fungsi laporan yang sama.
- **Menu akuntansi**: dikelompokkan ala Accurate — Dashboard,
  Kas & Bank (termasuk **Transfer bank**), Buku Besar, Laporan,
  Setting. Form **Beban** dan **Piutang & Utang** tidak lagi
  dipromosikan di menu; rutenya dipertahankan untuk kompatibilitas.
- **Kas & Bank**: histori transfer mendapat filter **rekening**,
  **jenis** (posted/void), dan **user**.
- **Ekspor laporan satu periode**: CSV/XLSX tidak lagi memuat kolom
  tahun lalu maupun "Selisih"; header, lebar kolom, dan jumlah sel
  mengikuti model layar/cetak.
- **PPN Masukan eksplisit** pada penerimaan barang: nominal bebas
  (termasuk 0/non-PPN), harga baris diperlakukan DPP, PPN ditambahkan
  ke total faktur dan dijurnal Dr PPN Masukan / Cr utang atau kas.
- **Rute lama ditutup**: `/app/akuntansi/beban` dialihkan ke Jurnal
  Umum baru; `/app/akuntansi/piutang-utang` dialihkan ke laporan
  posisi keuangan. Komponen form lama dihapus.
- **COA referensi diterapkan** (`/home/najib/Documents/ref/akun-perkiraan (3).xlsx`):
  126 akun referensi + 15 akun operasional = **141 akun**, 20 header
  non-postable, 121 detail, 36 pemetaan, 7 kontra, 11 akun kas/bank.
  Satu perbaikan hierarki: BSI 11010203 di bawah 110102. Seed demo
  dan data laba rugi diulang; laporan tetap seimbang. Alat migrasi
  lama diperbarui ke kode referensi + penanda bagan baru. Lihat
  `docs/OVERHAUL-MINIMARKET.md`.
- **Seed data laba rugi** kini dapat diulang lewat `pnpm db:seed:pl`
  (12 penjualan + 5 beban, sesi kas dikembalikan terbuka).
- **Margin produk**: overview margin (rata-rata/tertinggi/terendah/
  negatif), kolom margin di daftar produk, kalkulator target margin di
  form produk, serta Harga jual/Margin/Target margin per baris di
  penerimaan barang. Harga jual master diperbarui saat penerimaan
  pembelian diposting (izin `inventory.price`).
- **Modul Analisa** (modul ke-5): 12 indikator kesehatan bisnis,
  penggerak kinerja (ABC-FSN, turnover, GMROI, ATV), dan pengendalian
  risiko (stockout, dead stock, shrinkage, inventory accuracy).
- **Pinjaman & laporan**: halaman Pinjaman Karyawan menjelaskan
  dampaknya — pokok pinjaman masuk Neraca (`110305`) dan Arus Kas
  operasi, bukan Laba Rugi; bunga/biaya pinjaman (`720001`) masuk
  Beban Lain-lain, pinjaman bank (`2201`) masuk pendanaan. Kolom
  "Jurnal" ditambahkan di daftar pinjaman agar posting-nya terlihat.

## [Impor Accurate] Kompatibilitas ekspor nyata — 2026-11-09

Mandat pengguna: migrasi dari Accurate ke Bisa ERP; halaman Impor
data gagal pada file `daftar-barang.xlsx` (1.000 baris) karena
pemetaan otomatis memilih `Harga dari rincian grup` (boolean TIDAK)
sebagai harga jual.

- **Pemetaan produk**: `salePrice` ← `Def. Hrg. Jual Satuan #1`
  (exclude `rincian grup`/`kemasan`), `stock` ← `Kuantitas Saldo
  Awal`, `minStock` ← `Batas Minimum Stok`; alias Accurate untuk
  kategori, pemasok, barcode, dan satuan.
- **Multi-satuan**: `Satuan #2..#5` + `Rasio Satuan #2..#5` +
  `Def. Hrg. Jual/Beli Satuan #2..#5` dibaca menjadi kemasan ERP
  (`import-accurate.ts`); `Satuan Beli` menandai kemasan bawaan
  pembelian. Rasio pecahan ditolak per baris dengan pesan jelas.
- **Atribut produk**: `Jenis Barang`, `Non Aktif`,
  `Menggunakan No. Seri`, `Pakai tanggal kadaluarsa` menjadi
  `trackStock`/`isActive`/`trackSerial`/`trackBatch`; ekspor ERP
  sendiri (`Lacak Persediaan`, `Lacak Batch`, `Status`) juga terbaca.
  Commit tidak lagi memaksa semua produk aktif & berstok.
- **Pelanggan/pemasok**: `Kategori Harga`, `Batas Piutang`,
  `No. Pemasok`, dan termin `Net 30`/`COD` terbaca.
- **Akun**: tipe Accurate (`Aktiva`, `Aktiva Lancar`, `Kewajiban
  Lancar`, `Cash/Bank`, `Account Payable`, `COGS`, dll.) diterjemahkan
  lewat alias + prefiks; hierarki akun induk tetap tidak diimpor
  (didokumentasikan).
- **Stok awal**: kolom `Nilai Satuan`, `Gudang Saldo Awal`, dan
  `Per Tanggal` terbaca; satu penerimaan per kombinasi gudang+tanggal;
  tanggal cut-off di layar menjadi fallback. Produk non-persediaan/
  ber-seri/ber-batch ditolak menerima stok lewat jalur impor produk.
- **Perbaikan UX/validasi**: kolom kemasan menggantung tanpa kolom
  `Kemasan` tidak lagi menghasilkan 1.000 error baris; ringkasan
  `invalidRows` menghitung semua baris (bukan 30 pratinjau); kartu
  "Bermasalah" produk menghitung error kemasan; petunjuk unggah dan
  tab impor menyebut kolom Accurate yang sebenarnya.
- **Filter harga & format uang (tindak lanjut pengguna)**: filter
  "Harga jual/beli kosong" kini juga menangkap nilai **0/0.000000**
  (Accurate mengekspor harga kosong sebagai nol, bukan sel kosong);
  kolom harga di tabel pratinjau memakai `MoneyInput` berformat
  id-ID dan menyimpan sekali saat blur/Enter; pratinjau stok awal &
  saldo awal memakai `formatIDR`.
- **Definisi "Siap impor" = lengkap**: hanya baris dengan SKU, Nama,
  Barcode, Satuan, Harga beli > 0, dan Harga jual > 0 yang masuk
  filter Siap impor dan dapat dicentang. Baris lain masuk filter
  **Belum lengkap**, tidak dapat dipilih, dan dilewati saat commit
  dengan alasan eksplisit. Ringkasan "Siap diimpor (lengkap)"
  memakai hitungan baru.
- **Berkas dipecah** demi ratchet 800 baris: `import-products.ts`,
  `import-accurate.ts`, helper sel di `import-cells.ts`;
  `import-parse.ts` menjadi fasad re-export.

Bukti: `tests/unit/accurate-import.test.ts`,
`tests/integration/accurate-import.test.ts`; seluruh suite impor
(14 berkas, 155 tes) lulus; typecheck & lint (0 error) lulus.


Mandat pengguna 21:50–21:51 (rombak total bertahap, riset dulu, otomatis
sampai selesai; terminal POS tidak disentuh) diperluas master prompt
22:48 (Graphify sebagai alat utama audit; 15 fase; dokumen resmi).
Scheduler `a24-lanjut-otomatis` (tiap 2 jam) menggerakkan kelanjutannya.

- **T8 selesai — gerbang final & rilis** (agen tahap; commit penutup,
  ZIP, dan penghentian scheduler oleh Pemimpin): gerbang penuh dari
  reseed bersih tanpa pipa penutup — seed exit 0 (65 produk,
  Rp28.349.600), suite **1540/1540** (161 berkas), typecheck/lint/build
  exit 0, e2e **19/19**. Pengukuran ulang workflow per peran dari UI
  sungguhan (definisi langkah audit A-22/A-23): kasir 6/6 (retur K5:
  dari TIDAK ADA JALUR menjadi 5 langkah, RTN terbit), gudang 7/7
  (termasuk Mode Operasi scan-first 2 langkah; harga penerimaan kini
  tampil terformat `2.600`), akuntan 9/9 + Rincian Jurnal 1 klik +
  daftar periksa akhir bulan, pemilik P1/P2 (label peran eksplisit;
  dialog menutup dengan Escape), HR bercangkang sendiri. Sapuan visual
  67 pemeriksaan (21 rute × 1440/768/390 + POS 1100): 0 error, 1
  overflow 390px di `/app/pos/sesi` (wilayah POS beku perintah pemilik
  — dilaporkan, tidak diubah). Tujuh dokumen resmi ditulis dari bahan
  yang sudah ada: `docs/ERP_WORKFLOW.md` (121 baris),
  `docs/ARCHITECTURE.md` (172), `docs/MODULE_BOUNDARIES.md` (93),
  `docs/DATABASE_DESIGN.md` (139), `docs/BUSINESS_RULES.md` (184),
  `docs/DEVELOPMENT_GUIDE.md` (135), `docs/UI_UX_AUDIT.md` (96) —
  melengkapi `docs/OFFLINE_POS_ARCHITECTURE.md` (437, dari T6).
  `IMPLEMENTATION_PLAN.md` diakhiri (Fase 5–9, 12, 14 = [x]; Fase 11,
  13, 15 = [/] dengan sisa yang seluruhnya eksternal/keputusan
  pemilik/penutupan Pemimpin). Artefak rilis terverifikasi ulang dari
  pohon final: `deploy/build-release.sh` exit 0 (18M). Graf akhir:
  6.258 node / 23.014 edge / 223 komunitas, 0 siklus impor.
- **T7 selesai** (`31f7432`; suite 1540/1540, e2e 19/19): matriks
  verifikasi fungsi **61/61 LULUS** (POS 12, GDG 13, AKT 16, HR 11,
  PLT 9) di `docs/TESTING_REPORT.md`, pemetaan 30 skenario §15 master
  prompt, invariant SQL mentah bersih (0 jurnal timpang, 0 selisih
  stok/ringkasan bulanan dua arah). Satu cacat diperbaiki: T7-01
  higiene reset seed — 33 tabel ditambahkan ke `resetCompanyData` +
  test penjaga `tests/unit/seed-reset-coverage.test.ts`.
- **T6B selesai** (suite 1538/1538, e2e 19/19): service worker terbatas
  POS — reload saat server mati membuka terminal dari cache; penjualan
  offline tersinkron angka-cocok; kontrak SW terkunci test (hanya
  dokumen `/app/pos` network-first; aksi/API tak dicegat); registrasi
  mengikuti saklar `pos_offline_enabled`. Batas jujur: secure context
  saja (localhost/HTTPS).
- **T6 selesai** (`cad8a66`; suite 1525/1525, e2e 18/18): pembuktian
  offline POS 3 skenario peramban sungguhan — 2 cacat BROKEN ditemukan
  & diperbaiki (kuotasi offline cermin murni domain; antrean penjualan
  offline tunggal berkunci beku). A PASS (jurnal identik kontrol
  online, kirim-ulang = duplicate), B PASS (antrean selamat di profil
  disk; reload server-mati = refused → pemicu T6B), C PASS (konflik
  harga/stok tertahan di Peninjauan, nol penjualan). Dokumen
  `docs/OFFLINE_POS_ARCHITECTURE.md` tertulis.
- **T5 selesai:** paket penyebaran lokal Linux — satu artefak, dua
  jalur (Docker Compose produksi + `install.sh` idempoten & systemd
  dengan backup→migrasi→cek `/api/health`, rollback = restore backup).
  Jalur systemd PASS penuh (install bersih ±9 detik, login, 5 halaman
  modul 200, timer backup menghasilkan dump, restore identik);
  runtime Docker Compose BLOCKED eksternal (daemon tidak bisa
  berjalan di VM bersarang; berkas tervalidasi statis). Runbook:
  `docs/RUNBOOK-INSTALASI-PRODUKSI.md`, `docs/RUNBOOK-BACKUP-RESTORE.md`.
- **T4B selesai** (kebersihan arsitektur): `reports.ts`,
  `supplier-returns.ts`, `hr.ts` dipecah ke folder domain + re-export
  tipis; helper test `rollbackTransaction` dipusatkan; `xlsx` tidak
  diganti → keputusan pemilik §3 butir 19 (registry npm mentok 0.18.5,
  mendahului perbaikan CVE 0.19.3/0.20.2; repo memakai 0.20.3 ter-pin
  + test SEC-05; rekomendasi Pemimpin: pertahankan).
- **T4 selesai** (akuntansi pola Accurate): Rincian Jurnal satu-klik
  dari semua dokumen terposting non-POS (8 jenis dokumen) + daftar
  periksa akhir bulan terpandu di halaman Periode. Dokumen POS
  dikecualikan per keputusan Pemimpin §3.1 butir 2.
- **T3 selesai** (gudang mudah dipakai): Mode Operasi scan-first
  (`/app/gudang/operasi`), antrean operasi berkartu, opname bertugas
  hitung buta + tinjau selisih bernilai Rp + gerbang konfirmasi,
  penyesuaian beralasan dengan nilai dampak terlihat sebelum posting,
  mode kartu layar kecil; SIS-08/09/14 tertutup; sidebar gudang
  berkelompok HARIAN / MASTER & STOK / PEMBELIAN.
- **T2 selesai** (`ce2115e`; suite 1470/1470, e2e 16/16): HR menjadi
  modul keempat (shell Opsi A, rute tidak berpindah) — grup SDM &
  Payroll keluar dari sidebar akuntansi; kepemilikan izin payroll ke
  `MODULE_PERMISSIONS.hr`; blok aksi payroll ±898 baris berpindah ke
  `src/server/actions/hr.ts`; 33 gerbang aksi keluarga payroll
  bermodul `hr`, dibuktikan `tests/integration/hr-module-gate.test.ts`.
- **Fase 1 — Audit Graphify (dokumen):** graf repo disegarkan di HEAD
  (5.814 node, 21.792 edge, 203 komunitas, 0 siklus impor);
  `docs/CODEBASE_AUDIT.md` (peta graf + inventaris temuan 8 kategori +
  konsolidasi audit lama), `IMPLEMENTATION_PLAN.md` (indeks induk 15 fase
  ↔ T1–T8), dan CHANGELOG ini dimulai.
- **T1 selesai** (`55a7484`; suite 1441/1441, e2e 16/16): SIS-05 terbukti
  hidup untuk peran lihat → lib `form-gate` + `GateNotice` bersama + sapuan
  12 titik EmptyState sadar-peran; sisa SIS-07 non-POS (4 field Rp
  Pengaturan & harga baris penerimaan memakai MoneyInput bersama); SIS-11
  cangkang Pengaturan sendiri (URL nol berubah); SIS-12 palet Ctrl+K
  tersaring peran×saklar dengan pencarian entitas tergating server;
  serpihan SIS-15 (target sentuh & Escape dialog).
- **Rencana terbit** (`315432d`): `docs/rombak/RENCANA.md` — tahap T1–T8
  ber-centang, 18 butir keputusan pemilik (tidak dieksekusi diam-diam),
  keputusan Pemimpin atas ambiguitas sumber (T5 dua jalur pengemasan;
  dokumen POS di luar T4; generalisasi barcode-burst terbatas; SIS-05
  verifikasi-lalu-tutup).
- **Izin retur kasir** (`7079687`): sisa A-23 S2 yang dipertahankan sesudah
  seluruh pekerjaan wilayah POS dikembalikan ke HEAD — template peran
  Kasir memenuhi izin `pos.return` yang sudah menggerbangi menu/halaman
  Retur (perubahan kemampuan murni di `src/lib/permissions.ts`, nol
  perubahan tampilan POS; bisa dibalik satu perintah `git revert`).
- **Riset selesai:** domain minimarket & acuan Accurate/Odoo (`ab0cd00`,
  `docs/rombak/RISET-DOMAIN.md` — kesimpulan: fondasi transaksi lengkap;
  celah di jangkauan peran, gerbang longgar, bukti offline; dua kekosongan
  domain = keputusan pemilik) dan teknologi (`dd0c3cf`,
  `docs/rombak/RISET-TEKNOLOGI.md` — model utama server lokal Linux di
  toko; PWA pengerasan lanjut; Tauri/Electron ditunda beralasan; HR modul
  shell tanpa pindah rute).
- **Graphify terpasang global** atas perintah pengguna (CLI 0.9.102;
  graf repo di `graphify-out/`, ter-gitignore) dan menjadi alat utama
  Fase 1 serta pemetaan codebase sesudahnya.
- **Warisan A-23 S1** (`b44d934`): kontrak mengetik MoneyInput dipisah
  (`parseTypedMoneyText`; parser tempel tidak berubah) menutup SIS-01 —
  nominal ≥5 digit yang diketik digit-per-digit tidak lagi rusak; template
  peran bawaan menjadi konstanta pusat `BUILTIN_ROLES` (Kasir = modul POS
  saja); 74 halaman memakai gerbang peran yang memantulkan + banner
  bersama; pendaratan & beranda sadar peran.

## [A-22] UI/UX Akuntansi — 2026-11-05 (tuntas, ZIP terkirim)

- Enam tahap (K1 pencarian jurnal diperbaiki dari cacat parameter ganda;
  K2 responsif permukaan kerja; K5 antrean kerja dashboard & sidebar
  berkelompok + perbaikan drawer mobile semua modul; K4 paradigma input &
  pembayaran jujur; K3 rekonsiliasi CSV & model cepat; K6 sapuan 35 rute ×
  3 lebar, 0 overflow — menemukan bug nyata halaman Aset Tetap).
  Gerbang final Pemimpin: 1375/1375, e2e 16/16; ZIP dari `e9c59da`.

## [A-21] Akuntansi R3 — Kelengkapan Input — 2026-11-05 (tuntas)

- Fee transfer di jalur cepat; penjaga diseragamkan + kunci idempotensi
  (migrasi 0047); penjualan tunai + diskon & referensi pembayaran (0048);
  PPN klaim & beban terutang (0049); kredit pihak `party_credits` seri KRD
  (0050); fee/MDR per metode (0051); withholding PPh akun 2130 (0052);
  write-off akun 6100 (0053) — semua fitur baru konfigurabel per perusahaan
  & bawaan mati (pola D-25). Gerbang: 1298/1298, e2e 15/15.

## [A-20] Analisis Arsitektur Mendalam — 2026-11-05 (analisis)

- Vonis 6,7/10 (`docs/arsitektur-dalam/`): Dependency Rule & OCP terbukti
  dari arkeologi git; bounded context sebagian; risiko dominan = drift,
  bukan over-engineering. Tanpa perubahan kode.

## [A-19] FIX-ARS — Perbaikan P1 Arsitektur — 2026-11-05 (tuntas)

- Env fail-fast, logger JSON, `/api/health`, CI tertulis; ringkasan saldo
  bulanan (migrasi 0046; neraca saldo 455→31,6 ms); arus kas agregat SQL;
  pecah domain pos/inventory & PosTerminal; ratchet jalur baca ARS1-01.
  Gerbang: 1195/1195, e2e 15/15. Sisa P1 tunggal: git remote/CI = keputusan
  pemilik.

## [A-17] Audit & Perbaikan POS → Gudang — 2026-11-04 (tuntas)

- Audit POS 62 temuan & Gudang 50 temuan; FIX-POS 4 tahap & FIX-GDG 4
  tahap menutup semua P1 (migrasi 0043–0045). Gerbang: 1137/1137.

## [A-16] FIX-R2 — Desain Laporan & UI — 2026-11-04 (tuntas)

- Komponen ReportDocument & cetak resmi laporan; konsistensi UI (satu
  StatCard/StatusBadge, token nada); penjaga saldo kas/bank negatif
  terkonfigurasi (migrasi 0042); rekonsiliasi kontrol GL vs subledger.
  Gerbang: 1009/1009.

## [A-15] FIX-P1 — Remediasi Audit Adversarial Akuntansi — 2026-11-04 (tuntas)

- 18 P1 ditutup 5 tahap (retur & void; angka salah; periode & integritas;
  PPN Masukan akun 1180 + pemetaan; workflow & tutup buku tahunan),
  migrasi 0039–0041. Gerbang: 968/968.

## [A-14] SIM-2 — Payroll Indonesia, Master Data, HR Lanjutan — 2026-11-04 (tuntas)

- Keputusan **D-24**: mandat SIM-2 penuh (termasuk offline POS sebagian &
  HR lanjutan). Keputusan **D-25**: semua parameter fiskal/regulasi =
  konfigurasi per perusahaan bertanggal efektif + saklar per komponen.
- Engine PPh 21 TER + BPJS konfigurable (0027), master data & bulk edit
  (0028), backup/restore terbukti, keamanan RBAC (SEC-01 tertutup),
  absensi/shift/cuti/lembur, pinjaman & reimbursement, aset tetap,
  reservasi & nomor seri, offline POS PARTIAL (uji browser NOT TESTED —
  pekerjaan A-24 T6). Gerbang final: 881/881, e2e 15/15, migrasi s.d. 0038.

## [A-8…A-13] Perbaikan bertahap — 2026-11-04 (tuntas)

- A-8 POS/metode bayar/sesi/Input Cepat (suite 506) · A-9 Retur Pembelian
  (akun 1210 Kredit Pemasok, seri RTB) · A-10 Impor Produk · A-11 Kasbon
  (akun 1220) · A-12 Catat Transaksi (migrasi 0026) · A-13 bug Pengaturan →
  Pengguna (suite 590). Didahului program perbaikan 5 tahap atas audit
  awal 91 temuan & Perbaikan Cetak (migrasi 0022).

## Keputusan teknis lintas program yang tetap mengikat

- **D-25** — parameter fiskal/regulasi selalu konfigurasi per perusahaan
  bertanggal efektif + saklar per komponen; komponen nonaktif tidak
  dihitung/ditampilkan/dijurnal.
- **D-17** — konversi multi-satuan tidak dibangun (keputusan pemilik).
- **D-16** — status dokumen kustom & form builder generik tidak dibangun;
  saklar modul & custom fields dibangun.
- **D-15** — satu-satunya pengecualian edit migrasi terapan (0000,
  ekstensi pg_trgm idempoten).
- Terminal POS tidak disentuh sejak perintah pengguna 2026-11-05 21:50;
  perubahan kemampuan kasir `7079687` tercatat & dapat dibalik.

## [Audit Otonom] Putaran 1 — 2026-11-11

- **Akuntansi**: kontrak tipe akun pemetaan; retur pelanggan `Cr HPP`;
  P&L periode mengecualikan jurnal tutup buku; section impor divalidasi;
  akun berjurnal tidak bisa non-posting; void beban tanggal asal;
  laporan penjualan neto retur & PPN tidak dobel.
- **Gudang/POS**: void penerimaan memakai DPP/net + recompute AVCO;
  void retur pemasok/dokumen stok recompute AVCO; pembulatan tidak
  menghasilkan nol; refund lock sesi kas; default rounding grup 0.
- **Migrasi**: `0070` unique index idempotency `(company,scope,key)`;
  `0071` default `customer_groups.rounding_step=0`.
- **Import/export**: XLSX untuk seluruh route export; template
  Data/Petunjuk/Referensi; impor kategori, satuan, pemetaan akun;
  tombol ekspor/impor di halaman master.
- **Keamanan**: batas pemberian peran/izin, reset password memutus
  session, impor akuntansi butuh izin akuntansi, HTTPS produksi wajib.
- **Dokumentasi**: INVENTARIS, DATA_FLOW, TEMUAN, KEPUTUSAN, VALIDATION,
  SECURITY, BACKUP, DATA_DICTIONARY, PANDUAN_PENGGUNA, DEPLOY,
  LAPORAN_AKHIR, BLOKIR.
- **Backup**: `bisa-pre-migration-20261111-103520.dump`; restore drill
  ke DB kosong berhasil.
- **Sisa**: SEC-003 (cost leak), SEC-005 (token POS), AKN-004 lanjutan,
  serial void, stabilisasi seed/suite — lihat `docs/BLOKIR.md`.

- **Akses LAN HTTP**: `crypto.randomUUID()` diganti helper `newUuid()` dengan fallback `crypto.getRandomValues`, sehingga POS/form tidak gagal saat dibuka lewat `http://192.168.x.x` (non-secure context).

- **Cetak otomatis POS**: `ReceiptPrint` menunggu font siap, memanggil
  `window.print()` otomatis, dan kembali ke `/app/pos` setelah
  `afterprint`. Ref penjaga yang memblokir auto-print di React Strict
  Mode (`next dev`) dihapus. Tautan cetak ulang membawa `autoprint=1`.
- **Launcher printer**: `deploy/print/bisa-pos-print.sh` / `.bat`
  membuka POS (`/app/pos`) di Chrome/Edge dengan `--kiosk-printing`;
  pengaturan cetak menampilkan petunjuk printer default OS.

## [Deep Audit Gudang → Akuntansi] 2026-11-15

- **Nilai persediaan**: pencarian `q` (nama/SKU/kategori) kini server-side
  sebelum paginasi dan agregasi; ekspor XLSX/CSV ikut tersaring.
- **Gerbang modul**: aksi purchasing, purchase request, dan reservasi memakai
  `requirePermissionInModule(..., "gudang")`.
- **Void dokumen stok**: serial penyesuaian/opname/karantina dipulihkan ke
  gudang asal; hanya seri yang gerakan terakhirnya milik dokumen tersebut.
- **Tanggal void**: penjualan, payroll, dan transfer bank memakai tanggal
  dokumen asal bila periode terbuka; fallback hari ini bila tertutup.
- **Payroll Indonesia dipulihkan**: `runPayrollAction` kembali memakai engine
  statutory (TER/PPh 21, BPJS, THR/lembur, cuti tidak berbayar, kasbon,
  pinjaman); `final-pay.ts` menghitung PPh 21 masa terakhir + BPJS.
- **Ratchet arsitektur**: `receipt-form`, `supplier-return-form`, dan
  `supplier-returns/posting` dipecah ke berkas pendukung (≤800 baris);
  import-cycle dan table-writers kembali lulus.
- **Arsitektur**: impor `receipt-links` dan `supplier-returns/shared` lewat
  barrel; dua pelanggaran batas modul ditutup.
- **SEC-003**: HPP/nilai persediaan di PO, penerimaan, retur, dokumen, dan
  cetak dokumen disembunyikan tanpa `inventory.cost`; test matriks izin
  `tests/unit/cost-masking.test.ts`.
- **Analisa bisnis**: tren omzet harian, banner aksi risiko stok
  (stok habis/dead stock), pagination 20 produk, dan card view mobile;
  audit di `docs/audit/ANALISA-UX-AUDIT-2026-11-15.md`.
- **Dashboard utama**: hierarki baru Ringkasan → Perlu tindakan →
  Tren → Ruang kerja → Aktivitas; KPI piutang/utang, aksi utama di
  header, modul tanpa blok warna dekoratif; audit di
  `docs/audit/DASHBOARD-UX-AUDIT-2026-11-15.md`.
- **POS UX**: terminal mobile kini membuka keranjang + pembayaran
  sebagai sheet dari bar bawah; riwayat penjualan, pesanan ditahan,
  riwayat sesi, piutang, dan detail sesi memakai kartu di mobile
  (tabel tetap desktop);
  audit lengkap di `docs/audit/POS-UX-AUDIT-2026-11-15.md`.
- **Akuntansi UX**: Bagan akun 1.700+ baris kini hanya merender
  ringkasan kelompok (klik untuk membuka; pencarian membuka hasil);
  rekening bank/clearing punya tautan langsung ke rekonsiliasi akun;
  riwayat jurnal punya card view mobile; buku PPN menampilkan dokumen
  sumber + DPP; form jurnal punya **Simpan draf → review → Posting
  draf/Hapus draf**. Audit lengkap di
  `docs/audit/AKUNTANSI-UX-AUDIT-2026-11-15.md`.
- **Penerimaan barang (Fiori Post Goods Receipt)**: formulir dibagi
  tiga langkah (Dokumen & tujuan → Pemasok & faktur → Barang diterima);
  tautan PO dipindah dari panel "advanced" ke permukaan form karena
  itu jalur kerja utama penerimaan pembelian; hint jumlah PO terbuka.
- **UI/UX workflow (Fiori list report)**: filter status kerja pada
  Transfer stok (Dalam perjalanan/Selesai/Dibatalkan), Penyesuaian
  (Menunggu/Terposting/Ditolak/Dibatalkan), Riwayat opname, dan Aset
  Tetap (Aktif/Dilepas) + pencarian aset; KPI/empty state menjelaskan
  aksi berikutnya. E2E `gudang-workflow.spec.ts` menjaga chip, URL,
  dan responsivitas 390px.
- **QA**: rate limit login DB dibersihkan sebelum reseed E2E; tes PWA
  dibuat tahan cache service worker antar-spec.
- **SEC-012/013**: rate limit login tersimpan di tabel `rate_limit`
  (migrasi `0083`), `BISA_TRUSTED_PROXIES` untuk hop forwarded, dan CSP
  nonce per request di `src/proxy.ts` (`script-src` tanpa `unsafe-inline`).
- **Installer HTTPS**: `deploy/install.sh` default nginx + TLS,
  redirect HTTP→HTTPS, HSTS, `BETTER_AUTH_URL=https://...`,
  `BISA_TRUSTED_PROXIES=127.0.0.1`; sertifikat resmi lewat
  `BISA_TLS_CERT`/`BISA_TLS_KEY`.
- **Tahap 8**: impor massal cabang, gudang, metode pembayaran, kelompok
  harga, karyawan, dan aset tetap — template, preview, commit idempoten,
  validasi per baris; aset tetap membuat jurnal perolehan lewat aturan
  akuntansi yang sama. E2E tab impor + unduh template.
- **Tahap 7**: coverage kini lines 92.37%, statements 89.92%, functions
  93.83%, branches 79.35% (26 cabang lagi menuju 80%).
- **SEC-008**: upload impor dibatasi saat streaming (20MB), magic bytes
  XLSX/XLS/CSV divalidasi, entri/rasio/ukuran dekompresi ZIP dibatasi.
- **SEC-006**: seluruh 16 route export memakai `withApiError`; `AppError`/
  `ZodError` dipetakan ke 400/403/404/409/500, detail internal diredaksi.
- **Faktur pemasok**: migrasi `0082` menambah `stock_receipts.supplier_invoice_date`
  dan `due_date`; form penerimaan, koreksi nomor/tanggal faktur, detail,
  cetak GRN, dan aging utang (`listPayables`/`listPayablesPage`) memakai
  jatuh tempo eksplisit bila diisi.
- **UI/UX**: label ringkasan HR dan buku besar dinaikkan ke 11px; header dan
  sel kolom numerik buku besar kini rata kanan; sidebar Pengaturan yang
  terlipat dibuka sebelum navigasi pada E2E.
- **Test**: 53 test valuasi/gudang, 79 test purchasing/PR/reservasi, 39 test
  serial/adjustment, 14 test sale/payroll/bank void, 41 test payroll/HR.
  Suite penuh **2444/2444 lulus (276 file)**, E2E **57/57 lulus**,
  typecheck/lint/build lulus.
- **Dokumentasi**: `docs/audit/DEEP-AUDIT-2026-11-15.md`.
