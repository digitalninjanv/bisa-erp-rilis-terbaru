# Laporan Pengujian A-24 T7 — Verifikasi Fungsi Menyeluruh

**Tanggal putaran:** 2026-11-06 · **Pohon diuji:** HEAD `eb8062c` + perbaikan
T7-01 (higiene reset seed, belum di-commit — menunggu Pemimpin) ·
**Baseline masuk:** suite 1538/1538, e2e 19/19, migrasi 0054.

Laporan ini adalah dokumen matriks program A-24 tahap T7 (format
RENCANA §T7 / RISET-TEKNOLOGI §4): satu baris per fitur, status
`LULUS / SEBAGIAN / GAGAL / BELUM DIUJI`, bukti otomatis dirujuk nama
berkasnya, bukti manual berupa putaran peramban sungguhan bertanggal.
Klasifikasi kawasan di §6 memakai PASS / PARTIAL / FAIL / BLOCKED
sesuai prompt otonom pengguna §9. Skenario simulasi §15 prompt yang
sama dipetakan di §5 (S-01…S-30).

---

## 1. Ringkasan hasil

| Modul | Baris | LULUS | SEBAGIAN | GAGAL | BELUM DIUJI |
|---|---|---|---|---|---|
| POS | 12 | 12 | 0 | 0 | 0 |
| Gudang (GDG) | 13 | 13 | 0 | 0 | 0 |
| Akuntansi (AKT) | 16 | 16 | 0 | 0 | 0 |
| HR (HR) | 11 | 11 | 0 | 0 | 0 |
| Pengaturan & platform (PLT) | 9 | 9 | 0 | 0 | 0 |
| **Total** | **61** | **61** | **0** | **0** | **0** |

- **Cacat ditemukan & diperbaiki di tahap ini: 1** — T7-01 higiene
  reset seed (§2). Tidak ada baris matriks berstatus GAGAL/SEBAGIAN,
  sehingga **tidak lahir tahap turunan T7a…** dari matriks; satu-satunya
  perbaikan adalah cacat infrastruktur seed yang ditemukan lewat
  backlog §0G, diperbaiki & diverifikasi di tahap ini.
- **Bukti manual putaran ini (2026-11-06):** e2e produksi 19/19 +
  probe peran Playwright 11/11 (kasir jual tunai sungguhan sampai
  nota; staf gudang posting penerimaan dari UI; penolakan peran dua
  arah; viewer mode lihat) + kueri invariant DB independen
  (0 jurnal timpang, 0 selisih stok, 0 selisih ringkasan bulanan —
  dua arah) + verifikasi angka DB atas transaksi probe
  (Aqua 235 = Σ movements 235; INV-2026-00009 completed Rp4.000;
  RCV-2026-00003 posted).
- **Yang tetap BELUM terbukti (jujur, bukan baris matriks):** uji
  perangkat fisik printer/scanner (NOT TESTED sejak SIM-2 — butuh
  perangkat sungguhan); runtime Docker Compose (daemon tidak bisa
  berjalan di VM bersarang — T5); CI GitHub (repo tanpa remote —
  keputusan pemilik). Ketiganya tercatat sebagai BLOCKED eksternal
  di §6, bukan disembunyikan.

## 2. Cacat T7-01 — Higiene reset seed (ditemukan → diperbaiki → terverifikasi)

**Akar masalah.** `resetCompanyData` (`src/db/seed.ts`) menghapus 50
dari 92 tabel ber-`company_id`. Keluarga yang tidak terhapus menempel
kembali ke perusahaan demo hasil reseed (organization dibuat ulang
dengan id yang sama), sementara `document_sequences` ter-reset —
dokumen yatim akan menabrak nomor seri dokumen baru.

**Bukti sebelum perbaikan (dijalankan tahap ini).**
- Hitungan langsung di DB: perusahaan demo memuat
  `supplier_returns` 1 baris + 1 baris lines, dan `fixed_assets`
  1 baris — padahal seed tidak pernah membuat keduanya.
- Sesudah `pnpm db:seed -- --force` dijalankan, kedua yatim **tetap
  ada** (reseed tidak membersihkannya). Identitas yatim:
  `RTB-2026-00001` (posted, 2026-11-04 — sisa sesi bukti lama) dan
  aset "Etalase Kaca T4" (2026-11-05, sesi bukti T4). RTB yatim +
  urutan seri ter-reset = tabrakan nomor pada retur demo berikutnya
  (pola persis purchase_orders yang diperbaiki T3).

**Penilaian per keluarga (backlog PROGRESS §0G):**

| Keluarga | Vonis | Alasan |
|---|---|---|
| purchase_requests (+lines) | **CELAH — ditambah ke reset** | Dokumen berseri PRQ; pola tabrakan T3 |
| supplier_returns (+lines/allocations/resolutions) | **CELAH — ditambah** | Terbukti hidup (RTB yatim di atas) |
| stock_reservations | **CELAH — ditambah** | Keluarga dokumen stok; induknya ter-reset |
| stock_serials (+serial_movements) | **CELAH — ditambah** | Sama |
| stock_batches | **CELAH — ditambah** | Sama |
| fixed_assets (+categories/depreciations/runs) | **CELAH — ditambah** | Terbukti hidup (aset yatim di atas) |
| HR operasional (attendance, leave_requests, overtime, advances+entries, loans+entries, claims, history, shift assignments, work_shifts, departments, job_positions, employee_statutory_enrollments, payroll_item_lines, payroll_component_drafts) | **CELAH — ditambah** | Anak/dokumen dari employees & payroll yang ter-reset (kelas party_credits A-22 K1) |
| leave_types | **Ditambah** (dengan catatan) | Jenis kustom akan menempel; 5 bawaan ditanam ulang persis oleh `ensureDefaultLeaveTypes` |
| quick_entry (drafts, submissions) | **CELAH — ditambah** | Draf melekat pada user demo ber-id tetap; submissions = penyimpanan idempotensi paralel `idempotency_keys` yang ter-reset |
| Parameter statutori payroll (8 tabel) | **BUKAN celah — tidak diubah** | Ditanam ulang idempoten oleh `seedPayrollIndonesiaDefaults`, dipanggil `seed.ts:422` pada setiap penanaman |
| hr_parameters | **BUKAN celah — tidak diubah** | `seedHrDefaults` dipanggil malas oleh get/setHrParameter |

**Perbaikan.** 33 tabel ditambahkan ke `resetCompanyData` berkelompok
keluarga dengan komentar bukti (pola T3). Penjaga regresi baru:
`tests/unit/seed-reset-coverage.test.ts` — memindai `schema.ts` vs
daftar reset dan gagal bila ada tabel ber-`company_id` yang tidak
terhapus dan tidak masuk daftar pengecualian beralasan tertulis
(mengunci kelas celah ini selamanya). TDD: test merah dulu (33 tabel
persis), hijau sesudah perbaikan.

**Verifikasi fungsional.** Reseed ulang sesudah perbaikan: yatim
supplier_returns & fixed_assets **hilang**; keluarga statutori tetap
utuh pada angka tanamnya (TER 125, program 11, parameter 7, PTKP 8,
tarif 5, upah minimum 2, lembur 11, hr_parameters 7); seed melaporkan
baseline identik (65 produk, Rp28.349.600).

## 3. Metode putaran manual tahap ini

1. **e2e produksi (19 test)** pada build pohon ini: login & kata sandi
   salah; laba rugi berangka; jurnal & pencarian jurnal dari UI;
   rekonsiliasi bank; tab pengaturan (modul/penomoran/cetak); simulasi
   minimarket (terima tunai 100 → jual 1 → stok tepat); offline
   skenario A (3 penjualan antre di tengah sesi) & C (konflik harga/
   stok → peninjauan); PWA T6B (reload jaringan mati membuka terminal
   dari cache, penjualan mengantre & tersinkron); sapuan aksesibilitas
   0 critical/serious.
2. **Probe peran Playwright** (skrip `.local/t7/probe.mjs`, tangkapan
   `~/workspace/bukti-a24/t7-*.png`): pengguna kasir/gudang/viewer
   dibuat lewat UI Pengaturan oleh owner, lalu —
   kasir: mendarat langsung `/app/pos`; membuka `/app/gudang/produk`
   terpantul `?denied=gudang` berbanner; membuka sesi (modal
   Rp100.000) dan menjual 1 Aqua tunai sampai nota
   (`INV-2026-00009`, Rp4.000, completed);
   staf gudang: memposting penerimaan tunai 24 Aqua @Rp2.600 dari UI
   (`RCV-2026-00003`, posted); membuka `/app/akuntansi/jurnal`
   terpantul `?denied=akuntansi`;
   viewer: halaman penerimaan dalam mode lihat (GateNotice), tanpa
   tombol buat;
   owner: laporan dengan konteks pembanding tahun lalu; payroll
   tampil dalam cangkang modul HR.
   Hasil: **11/11 PASS**. Dua kegagalan pada larian pertama probe
   terbukti cacat *skrip probe* (perlombaan pemeriksaan URL
   pendaratan; cabang buka-sesi tidak andal), bukan cacat aplikasi —
   dibuktikan skrip debug terpisah (pendaratan kasir memang
   `/app/pos`; tombol Bayar nonaktif adalah perilaku benar terminal
   tanpa sesi terbuka), lalu probe diperbaiki dan lulus penuh.
3. **Kueri invariant DB independen** (skrip `.local/t7/invariants.mjs`,
   SQL mentah di luar jalur aplikasi): jurnal posted timpang 0;
   `stock_on_hand` ≠ Σ `stock_movements` 0 baris (dua arah); ringkasan
   bulanan ≠ agregat jurnal 0 baris (dua arah) — pada keadaan baseline
   dan sesudah transaksi probe.
4. **Bukti manual tahap sebelumnya yang dirujuk per baris** (bertanggal,
   di `~/workspace/bukti-a24/`): T1 (peran lihat & palet), T2 (modul
   HR & pantulan kasir), T3 (alur gudang & opname), T4 (Rincian Jurnal),
   T5 (instalasi systemd & login tumpukan produksi), T6/T6B (offline &
   PWA, tangkapan di subfolder t6/t6b).

## 4. Matriks fitur

Kolom bukti manual menyebut putaran terbaru yang menaungi baris itu:
**T7** = putaran tahap ini (e2e/probe/invariant), atau tahap A-24
sebelumnya yang buktinya masih berlaku untuk perilaku yang tidak
berubah sesudahnya. Commit pohon diuji: `eb8062c` (+T7-01).

### 4.1 POS

| ID | Fitur | Peran penguji | Skenario & hasil terukur | Bukti otomatis | Bukti manual | Status |
|---|---|---|---|---|---|---|
| POS-01 | Jual tunai | kasir (bisa); viewer (tidak) | Tambah produk → Bayar tunai pas → nota INV terbit, stok −1, jurnal seimbang | `feature-matrix-pos`, `sale-flow`, `simulasi-minimarket.spec` (e2e) | **T7 probe kasir**: INV-2026-00009 Rp4.000 completed; stok DB cocok | LULUS |
| POS-02 | Jual non-tunai (QRIS/kartu) + fee metode | kasir | Checkout QRIS; fee per metode (bila aktif) dibekukan di baris bayar & jadi beban 6060 | `fix-pos-t1-domain`, `fix-a21-r3a-fees`, `pos-offline-tahap2` | A-17 FIX-POS T4; A-21 R3-A | LULUS |
| POS-03 | Jual utang (kredit) + batas kredit | kasir + pelanggan wajib + jatuh tempo | Porsi utang → Dr Piutang; pelanggan & due date wajib; limit ditegakkan | `pos-debt-sales`, `feature-matrix-pos` | A-17; PROGRESS A-21 | LULUS |
| POS-04 | Penjualan campuran (tunai + non-tunai + utang) | kasir | Total tender = total dokumen; jurnal terbagi per kaki | `feature-matrix-pos`, `sale-flow` | SIM-2 S1 SimMart 36/36 | LULUS |
| POS-05 | Diskon baris/total & kelompok harga + pembulatan | kasir; diskon besar butuh izin | Harga grup dibulatkan per mode grup; diskon manual tak melewati bruto | `feature-matrix-pos`, unit `money`, `pos-guards` | A-17 FIX-POS | LULUS |
| POS-06 | Retur penjualan (dengan nota) | kasir (berizin `pos.return` sejak `7079687`) | Retur → stok kembali, refund ke sesi, jurnal balik via 4020 | `pos-returns`, `feature-matrix-pos` | T2 (izin retur kasir); A-17 | LULUS |
| POS-07 | Void penjualan | kasir berizin `pos.void` | Void → dokumen `void` + jurnal pembalik, stok pulih | `pos-returns`, `payments-void-p2` | A-17 | LULUS |
| POS-08 | Sesi kas: buka, setoran/tarik, tutup + selisih | kasir | Modal awal → transaksi → hitung fisik → selisih tercatat | `cash-session-history`, `pos-hold-cash`, `feature-matrix-pos` | **T7 probe**: kasir membuka sesi modal Rp100.000 dari UI | LULUS |
| POS-09 | Pesanan ditahan (hold/recall) | kasir | Tahan keranjang → panggil kembali → checkout normal | `pos-hold-cash`, `feature-matrix-pos` | A-17 | LULUS |
| POS-10 | Offline: antrean, kuota, kepemilikan penyinkron | kasir (saklar perusahaan) | Putus jaringan → jual mengantre → sambung → tersinkron angka-sama; kirim ulang = duplicate, bukan ganda | `pos-offline-tahap2`, `pos-offline-sync` (sim2), unit `pos-offline-queue`, `pos-offline-local-quote`, e2e `pos-offline.spec` skenario A & C | **T7 e2e** skenario A & C pada build ini; T6 (server dimatikan sungguhan) | LULUS |
| POS-11 | PWA: terminal dibuka dari cache saat server mati | kasir | Reload saat server mati → terminal tampil dari cache; jual mengantre & tersinkron | unit `pos-pwa-sw`, `pos-pwa-manifest`, e2e `pos-pwa.spec` | **T7 e2e** T6B pada build ini | LULUS |
| POS-12 | Penolakan peran & kebocoran data | kasir → gudang/akuntansi ditolak; HPP tak tampil ke kasir | URL modul lain terpantul berbanner; kolom HPP tersembunyi | `pos-permissions-tahap3`, `rbac-matrix` (sim2), `permissions` | **T7 probe**: kasir → `?denied=gudang` | LULUS |

### 4.2 Gudang (GDG)

| ID | Fitur | Peran penguji | Skenario & hasil terukur | Bukti otomatis | Bukti manual | Status |
|---|---|---|---|---|---|---|
| GDG-01 | Penerimaan dari PO (penuh) | staf gudang | PO → terima penuh → stok +, utang lahir, jurnal via postReceiptJournal | `goods-receipt`, `purchase-order`, `feature-matrix-gudang` | T3 (scan PO membuka penerimaan) | LULUS |
| GDG-02 | Penerimaan sebagian (parsial) | staf gudang | Terima < dipesan → PO tetap terbuka; terima sisa → tuntas | `goods-receipt`, `feature-matrix-gudang`, `inventory-p1/p2` | T3 (Diminta/Terkonfirmasi/Selisih) | LULUS |
| GDG-03 | Penerimaan tunai langsung | staf gudang | Tanpa PO, bayar langsung → stok +, kas −, tanpa utang | e2e `simulasi-minimarket.spec` | **T7 probe gudang**: RCV-2026-00003 posted (24 Aqua) | LULUS |
| GDG-04 | Purchase Order & Purchase Request | staf gudang; PR persetujuan berambang | PO/PR berseri unik; PR di atas ambang butuh persetujuan | `purchase-order`, `purchase-requests` (sim2), `adjustment-approval` | T3 | LULUS |
| GDG-05 | Retur pembelian + penyelesaian | staf gudang | Retur ≤ plafon asal; penyelesaian ganti barang/potong/refund/custom terlacak | `supplier-returns`, `return-settlement-gate` (sim2), `fix-gdg-tahap1` | A-9; T3 | LULUS |
| GDG-06 | Transfer antar-gudang (+ in-transit) | staf gudang | Kirim → terima di tujuan; stok berpindah, selisih terlihat | `reservations-transfers` (sim2), `fix-gdg-tahap2` | T3 (terima transfer kolom selisih) | LULUS |
| GDG-07 | Reservasi stok | staf gudang | Reservasi mengurangi stok tersedia, bukan stok fisik | `reservations-transfers` (sim2), `feature-matrix-gudang` | SIM-2 S7B-2 | LULUS |
| GDG-08 | Opname hitung buta + tugas opname | staf gudang; posting butuh izin | Fisik tersembunyi sampai ditampilkan eksplisit; selisih ditinjau sebelum posting; tugas selesai otomatis saat posting | `opname-tasks`, unit `opname-count`, `feature-matrix-gudang` | T3 (tugas opname & tinjau selisih) | LULUS |
| GDG-09 | Penyesuaian stok beralasan | staf gudang; di atas ambang butuh persetujuan | Alasan terkonfigurasi wajib; nilai Rp dampak tampil sebelum posting | `inventory-adjustment`, `adjustment-approval` | T3 (penyesuaian nilai Rp) | LULUS |
| GDG-10 | Batch & kedaluwarsa (FEFO) + nomor seri | staf gudang | Penerimaan berbatch; penjualan mengambil batch FEFO; seri terlacak per gerakan | `stock-batches`, `serial-numbers` (sim2) | SIM-2 S7B-2; panel kedaluwarsa T3 | LULUS |
| GDG-11 | Impor produk & stok (CSV) + tinjau baris | staf gudang/admin | Unggah → klasifikasikan → sunting baris → commit; balapan commit tidak memecah GL vs subledger | `import-*` (8 berkas), `inventory-void-import`, `fix-gdg-tahap1` | A-10; A-17 | LULUS |
| GDG-12 | Kartu stok & nilai persediaan (AVCO) | staf gudang; peran lihat | Kartu per gudang cocok dengan movements; nilai = Σ qty × AVCO | `stock-card-valuation`, `consistency`, `movements-pagination` | **T7 invariant DB**: 0 selisih dua arah | LULUS |
| GDG-13 | Mode Operasi scan-first | staf gudang | Pindai barcode/PO → dokumen terbuka dalam 1 aksi | `a24-t3-libs` (unit), `barcode-burst` | T3 (operasi 1440/768/390 + scan) | LULUS |

### 4.3 Akuntansi (AKT)

| ID | Fitur | Peran penguji | Skenario & hasil terukur | Bukti otomatis | Bukti manual | Status |
|---|---|---|---|---|---|---|
| AKT-01 | Jurnal manual (halaman penuh) | akuntan | Baris tak seimbang ditolak; posted seimbang & tak bisa disunting | `journal-validation`, unit `journal-form`, `fix-p1-period-integrity` | A-22 K2; e2e pencarian jurnal (**T7**) | LULUS |
| AKT-02 | Jurnal balik / void dokumen sumber | akuntan | Koreksi hanya via reverseSourceJournal; dokumen asal tetap | `fix-p1-retur-void`, `payroll-reverse`, `payments-void-p2` | A-15 FIX-P1 | LULUS |
| AKT-03 | Beban (tunai & terutang) | akuntan | Terutang → Cr payable bertag pemasok; dilunasi mesin utang | `fix-a21-r3e-ppn-akrual`, `fix-a21-r3c-guards` | T4 (Rincian Jurnal beban) | LULUS |
| AKT-04 | Transfer bank + biaya admin | akuntan | Dr tujuan, Dr 6060 fee, Cr asal amount+fee — dari form khusus & Catat Transaksi | `fix-a21-r3c-guards`, `quick-entry` | T4; A-21 T1 | LULUS |
| AKT-05 | Piutang: terima pembayaran, parsial, kredit pihak | akuntan | Kelebihan bayar → kredit KRD; kredit dipakai di pembayaran berikut | `fix-a21-r3b-party-credit`, `credit-redemption` | A-21 R3-B; A-22 K4 (banner kredit di dialog) | LULUS |
| AKT-06 | Utang: bayar, parsial, withholding PPh | akuntan | Potongan PPh → 2130; FIFO mengiris potongan ke dokumen tertua | `fix-a21-r3a-withholding`, `accounting-actions-p2` | A-21 R3-A | LULUS |
| AKT-07 | Write-off sisa piutang/utang | akuntan (`accounting.manage`, ambang per perusahaan) | Alasan wajib; piutang → 6100; utang → pendapatan lain | `fix-a21-r3a-writeoff` | A-21 R3-A; T1 (field ambang berformat) | LULUS |
| AKT-08 | Rekonsiliasi bank (impor CSV & tempel) | akuntan | Contoh UI lolos parser; cocok-otomatis menetap di panel; jurnal dari mutasi | unit `statement-csv`, `bank-reconciliation`, e2e akuntansi | **T7 e2e** halaman rekonsiliasi; A-22 K3 | LULUS |
| AKT-09 | Laporan keuangan + pembanding tahun lalu | akuntan/owner; kasir tidak bisa | Laba rugi & neraca berkolom tahun lalu; angka dari ringkasan bulanan terverifikasi | `reports-p2`, `fix-ars-tahap2-monthly-balances`, `fix-ars-tahap3-cashflow-sql`, unit `report-money` | **T7 probe owner** laporan; **T7 invariant** ringkasan = agregat | LULUS |
| AKT-10 | Buku besar & drill-down ke dokumen | akuntan | Baris laporan → jurnal → dokumen sumber (Rincian Jurnal satu-klik semua dokumen non-POS) | `fix-a24-t4-journal-links`, `journal-source-print` | T4 (8 jenis dokumen tertaut) | LULUS |
| AKT-11 | Tutup periode & tutup tahun | akuntan/owner | Posting ke periode tertutup ditolak `assertPeriodOpen`; daftar periksa akhir bulan terpandu | `fix-p1-period-integrity`, unit `period-status`, `period-end-date` | T4 (daftar periksa akhir bulan); A-15 | LULUS |
| AKT-12 | Saldo awal (akun & pihak) | akuntan | Dokumen saldo awal terposting seimbang; AR/AP demo tampil di aging | `opening-balances` | FIX-R2 Tahap 3 | LULUS |
| AKT-13 | Aset tetap & penyusutan | akuntan | Register → run penyusutan → jurnal; disposal berbalik benar | `fixed-assets` (sim2) | T4 (halaman aset + Rincian Jurnal) | LULUS |
| AKT-14 | Catat Transaksi (quick entry) | akuntan | Pratinjau == posting dari lib bersama untuk semua jenis | `quick-entry` (integration), unit `quick-entry`, `quick-input` | A-12; A-22 K4 | LULUS |
| AKT-15 | PPN: klaim memisah PPN Masukan; saklar pajak | akuntan | Tarif dibekukan di klaim; komponen nonaktif tidak dihitung/dijurnal | `fix-a21-r3e-ppn-akrual`, `ppn-toggle` (sim2), `fix-p1-ppn-pemetaan` | A-21; SIM-2 (D-25) | LULUS |
| AKT-16 | Rekonsiliasi kontrol GL vs subledger | akuntan | Halaman kontrol membandingkan GL dengan subledger AR/AP/stok | `fix-r2-sisa-angka`, `consistency` | FIX-R2 Tahap 3 | LULUS |

### 4.4 HR (HR)

| ID | Fitur | Peran penguji | Skenario & hasil terukur | Bukti otomatis | Bukti manual | Status |
|---|---|---|---|---|---|---|
| HR-01 | Master karyawan & riwayat perubahan | HR/admin (`payroll.manage`); gaji tak terbaca tanpa `payroll.view` | CRUD karyawan; riwayat terekam; SEC-01 tertutup | `hr-org-history`, `payroll-access` (sim2), `master-crud` | T2 (cangkang HR) | LULUS |
| HR-02 | Departemen, jabatan, struktur | HR/admin | Master terpakai di karyawan & payroll | `hr-org-history`, `master-data` (sim2) | SIM-2 S7B-1 | LULUS |
| HR-03 | Shift & penugasan jadwal | HR/admin | Shift mingguan terikat ke absensi | `hr-attendance` (sim2) | SIM-2 S7B-1 | LULUS |
| HR-04 | Presensi: check-in/out, terlambat, pulang awal, koreksi berotorisasi | karyawan/HR | Rekap periode cocok dengan catatan; koreksi tercatat | `hr-attendance` (sim2) | SIM-2 S7B-1 | LULUS |
| HR-05 | Cuti & izin: pengajuan, persetujuan, saldo | karyawan → atasan menyetujui | Saldo berkurang hanya sesudah persetujuan; jenis bawaan 5 | `hr-leave` (sim2) | SIM-2 S7B-1 | LULUS |
| HR-06 | Lembur & THR (draf komponen) | HR/admin | Lembur menurut aturan bertanggal efektif; draf THR termakan run | `hr-overtime-thr` (sim2) | SIM-2 S7B-1 | LULUS |
| HR-07 | Payroll Indonesia: PPh 21 TER, BPJS per program, PTKP — semua konfigurasi bertanggal efektif + saklar (D-25) | HR/admin | Komponen nonaktif tidak dihitung/tampil/dijurnal; hitung Desember (tahunan) benar | `payroll-indonesia` (sim2 + unit), `payroll-indonesia-desember`, `payroll-batch-proposals`, `ppn-toggle` | SIM-2 S2 | LULUS |
| HR-08 | Run payroll → persetujuan → bayar → jurnal ringkasan ke Akuntansi | HR/admin; jurnal terbaca akuntansi | Run terposting → jurnal Dr beban gaji / Cr kas-bank seimbang; slip per karyawan | `payroll-reverse`, `fix-a24-t4-journal-links`, `accounting-actions-p2` | **T7 probe owner**: payroll dalam cangkang HR; T4 Rincian Jurnal payroll | LULUS |
| HR-09 | Pembatalan/reverse payroll | HR/admin | Reverse mengembalikan jurnal & status persis | `payroll-reverse`, `fix-p1-payroll-unpaid-leave` (sim2) | A-15 | LULUS |
| HR-10 | Kasbon & pinjaman karyawan (potong gaji) | HR/admin; gerbang modul `hr` | Kasbon → 1220; potongan masuk run payroll; saklar modul HR mengatur aksi keluarga payroll | `employee-advances`, `hr-loans-reimbursement` (sim2), `hr-module-gate` | T2 + susulan gerbang `hr` | LULUS |
| HR-11 | Klaim reimbursement (+PPN terpisah) | karyawan → HR menyetujui | Klaim disahkan memisah PPN Masukan bertarif beku | `hr-loans-reimbursement` (sim2), `fix-a21-r3e-ppn-akrual` | A-21 R3-E | LULUS |

### 4.5 Pengaturan & platform (PLT)

| ID | Fitur | Peran penguji | Skenario & hasil terukur | Bukti otomatis | Bukti manual | Status |
|---|---|---|---|---|---|---|
| PLT-01 | Pengguna & peran (bawaan + kustom) | owner/admin (`users.manage`) | Buat pengguna → sesi pertamanya langsung terbatasi template; peran kustom tidak ditimpa template | `user-management`, `permissions`, `rbac-matrix` (sim2), `payroll-access` | **T7 probe**: owner membuat 3 pengguna; ketiganya berperilaku sesuai peran | LULUS |
| PLT-02 | Matriks izin lintas modul (peran salah ditolak rapi) | semua peran | Halaman tanpa izin → pantulan + banner, bukan error; aksi server tetap melempar | `hr-module-gate`, `landing`, unit `form-gate`, `palette` | **T7 probe** dua arah; T1 SIS-05; T2 kasir→HR | LULUS |
| PLT-03 | Metode pembayaran (CRUD + fee per metode) | admin | Metode nonaktif tak tampil di POS; fee bawaan mati | `payment-method-crud`, `fix-a21-r3a-fees` | A-8; A-21 | LULUS |
| PLT-04 | Pengaturan perusahaan & saklar modul | owner/admin (`settings.manage`) | Saklar modul mengubah visibilitas & gerbang aksi (payroll mengikuti saklar HR) | `modules-enabled`, `hr-module-gate`, `platform-t5`, e2e pengaturan | **T7 e2e** tab Modul; T2 saklar HR | LULUS |
| PLT-05 | Penomoran dokumen & format cetak/struk | admin | Seri per jenis dokumen; template cetak tersimpan | `document-numbering` (integration + unit), `print-settings`, e2e pengaturan | **T7 e2e** tab Penomoran & Cetak | LULUS |
| PLT-06 | Backup & restore | owner (prosedur) | Dump terjadwal (timer) → restore ke DB sampingan identik | `s5-roundtrip` (sim2), `hardening-t5` | T5 (timer menghasilkan dump; restore identik) | LULUS |
| PLT-07 | `/api/health` | publik (tanpa sesi) | 200 `{status ok, db ok, migration 0054}` | unit `health`, `env`, `log` | **T7**: curl langsung ke server produksi lokal — cocok | LULUS |
| PLT-08 | Palet perintah Ctrl+K tersaring peran | semua peran | Kasir: nol hasil gudang/akuntansi; owner: produk & halaman ditemukan | unit `palette` (10 test) | T1 (tangkapan owner & kasir) | LULUS |
| PLT-09 | Instalasi produksi Linux (systemd) | pemilik toko (runbook) | Install bersih → migrasi idempoten → health → login; update satu putaran dengan rollback jujur | `platform-t5`, `hardening-t5` | T5 penuh (9 detik install; 5 halaman modul 200) | LULUS |

## 5. Pemetaan 30 skenario simulasi (prompt otonom §15)

| S | Skenario | Baris matriks | Bukti penentu |
|---|---|---|---|
| S-01 | Buat master barang | GDG-12, PLT-01 | `master-crud`, `master-data` (sim2) |
| S-02 | Ubah master barang | GDG-12 | `master-crud`; snapshot nama dokumen (`rem-name-snapshot`) |
| S-03 | Buat supplier | GDG-01 | `master-crud` |
| S-04 | Pembelian (PO) | GDG-04 | `purchase-order` |
| S-05 | Penerimaan sebagian & penuh | GDG-01, GDG-02 | `goods-receipt`, `feature-matrix-gudang` |
| S-06 | Retur pembelian | GDG-05 | `supplier-returns` |
| S-07 | Penjualan tunai & non-tunai | POS-01, POS-02 | e2e simulasi; `feature-matrix-pos` |
| S-08 | Diskon & pajak | POS-05, AKT-15 | `feature-matrix-pos`, `ppn-toggle` |
| S-09 | Pembatalan & retur penjualan | POS-06, POS-07 | `pos-returns` |
| S-10 | Stock opname | GDG-08 | `opname-tasks` |
| S-11 | Penyesuaian stok | GDG-09 | `inventory-adjustment` |
| S-12 | Mutasi stok (transfer) | GDG-06 | `reservations-transfers` |
| S-13 | Barang rusak & kedaluwarsa | GDG-09, GDG-10 | `inventory-adjustment`, `stock-batches` |
| S-14 | Pelunasan utang | AKT-06 | `accounting-actions-p2` |
| S-15 | Pengeluaran operasional | AKT-03 | `fix-a21-r3e-ppn-akrual` |
| S-16 | Buat data karyawan | HR-01 | `hr-org-history` |
| S-17 | Jabatan & shift | HR-02, HR-03 | `hr-attendance`, `hr-org-history` |
| S-18 | Check-in & check-out | HR-04 | `hr-attendance` |
| S-19 | Terlambat, izin, cuti | HR-04, HR-05 | `hr-attendance`, `hr-leave` |
| S-20 | Perhitungan payroll | HR-07 | `payroll-indonesia` |
| S-21 | Slip gaji | HR-08 | `journal-source-print`, cetak slip payroll/[id] |
| S-22 | Persetujuan & pembayaran gaji | HR-08 | `payroll-reverse`, `fix-a24-t4-journal-links` |
| S-23 | Penutupan shift kasir (sesi) | POS-08 | `cash-session-history` |
| S-24 | Penutupan periode akuntansi | AKT-11 | `fix-p1-period-integrity` |
| S-25 | Laporan keuangan terverifikasi | AKT-09 | `reports-p2` + invariant T7 |
| S-26 | Semua role & permission | PLT-02 | `rbac-matrix` (14×7), probe T7 |
| S-27 | POS offline | POS-10 | e2e skenario A (T7) |
| S-28 | Sinkronisasi sesudah online | POS-10, POS-11 | e2e skenario A/C + PWA (T7) |
| S-29 | Konkurensi | GDG-12, POS-01 | `warehouse-race`, probe balapan POS1/A-17, invariant 0 selisih |
| S-30 | Input salah/kosong/tidak valid/ekstrem | AKT-01, POS-05 | `journal-validation`, unit `money`, `money-input`, `action-validation`, `guard-zod` |

## 6. Klasifikasi per kawasan (PASS / PARTIAL / FAIL / BLOCKED)

| Kawasan | Vonis | Dasar |
|---|---|---|
| POS (fungsi & integritas) | **PASS** | 12/12 baris LULUS; offline & PWA terbukti peramban pada build ini |
| Gudang & inventory | **PASS** | 13/13 LULUS; invariant stok 0 selisih dua arah |
| Akuntansi | **PASS** | 16/16 LULUS; jurnal 0 timpang; ringkasan = agregat |
| HR & payroll | **PASS** | 11/11 LULUS; modul berdiri sendiri (T2) |
| Pengaturan & platform | **PASS** | 9/9 LULUS; health 0054 terverifikasi langsung |
| Higiene seed/demo | **PASS sesudah perbaikan T7-01** | Yatim terbukti → 33 tabel ditambah + penjaga regresi; reseed bersih terverifikasi |
| Penyebaran Docker Compose | **BLOCKED (eksternal)** | Berkas tervalidasi; runtime NOT TESTED — daemon Docker tidak dapat berjalan di VM bersarang (bukti T5). Jalur systemd = PASS penuh |
| Perangkat fisik (printer/scanner) | **BLOCKED (eksternal)** | NOT TESTED — tidak ada perangkat di lingkungan ini; langkah pembuktiannya tertulis di OFFLINE_POS_ARCHITECTURE |
| CI GitHub | **BLOCKED (keputusan pemilik)** | Workflow tertulis & tervalidasi lokal; repo tanpa remote |

Tidak ada kawasan FAIL. Tidak ada baris inti PARTIAL: fitur yang
memang keputusan pemilik (promosi bertanggal, peringatan kadaluarsa
bertingkat, PIN supervisor, tender kredit di terminal, ekspor
Excel/PDF berformat, multi-satuan D-17) **tidak** dimasukkan sebagai
baris GAGAL — daftar itu hidup di RENCANA §3 & PROGRESS §0D/§0G.

## 7. Angka gerbang tahap ini

Semua perintah dijalankan **tanpa pipa penutup** (exit code dibaca
langsung), pada pohon berakhir (HEAD `eb8062c` + perbaikan T7-01):

| Gerbang | Hasil masuk (baseline) | Hasil akhir tahap ini |
|---|---|---|
| `pnpm test` | 1538/1538 (160 berkas) — dijalankan ulang & cocok | **1540/1540 (161 berkas), exit 0** (+2 test penjaga T7-01) |
| `pnpm typecheck` | — | **exit 0** |
| `pnpm lint` | — | **exit 0** |
| `pnpm build` | — | **exit 0** (Compiled successfully) |
| `pnpm test:e2e` | 19/19 | **19/19, exit 0** (dua kali: sebelum & sesudah perbaikan seed) |
| Probe peran Playwright (manual) | — | **11/11 PASS** (§3 butir 2) |
| Invariant DB independen | — | **0 / 0 / 0** (jurnal timpang / selisih stok / selisih ringkasan, dua arah) |
| Reseed penutup | — | 65 produk, Rp28.349.600, yatim = 0, port 3000 bebas |

## 8. Keadaan akhir

- Demo tereseed baseline: 65 produk, nilai persediaan Rp28.349.600,
  invariant 0 selisih; pengguna probe `t7.*` terhapus (user/account/
  session/member = 0 sisa); tidak ada saklar uji yang tertinggal
  berubah (pengaturan perusahaan ikut ter-reset oleh reseed).
- Berkas diubah tahap ini: `src/db/seed.ts` (reset +33 tabel),
  `tests/unit/seed-reset-coverage.test.ts` (baru), dokumen ini.
  Nol perubahan logika domain/UI; nol migrasi baru (tetap 0054).
- Rekomendasi ke Pemimpin: centang T7 sesudah verifikasi & commit;
  tidak ada butir T7a yang perlu lahir dari matriks ini.
