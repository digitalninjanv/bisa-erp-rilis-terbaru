# SIM-2 Fase S2 — Engine Payroll Indonesia (PPh 21 TER + BPJS) yang Configurable

Tanggal: 2026-11-04 · Sumber rancangan: `docs/sim2/S0-C-HR-PAYROLL.md` Bagian 3 ·
Migrasi: **0027** (aditif; migrasi lama tidak diubah) · Status gerbang: lihat §8.

Prinsip yang ditegakkan sepanjang fase: **tidak ada tarif, batas, atau
kategori regulasi yang ter-hardcode di kode**. Engine
(`src/lib/payroll-indonesia.ts`) tidak mengimpor satu pun angka regulasi;
semua angka hidup sebagai baris konfigurasi bertanggal efektif per
perusahaan dan dibaca lewat `loadStatutoryConfig(tx, companyId, asOfDate)`.
Berkas `src/lib/payroll-indonesia-defaults.ts` hanya berisi DATA bawaan
untuk seeding — bukan logika.

---

## 1. Yang dibangun per batch

### Batch 1 — Konfigurasi regulasi (migrasi 0027)

10 tabel baru (semua `company_id` + RLS ENABLE/FORCE + GRANT pola repo):

| Tabel | Isi |
|---|---|
| `payroll_statutory_settings` | Saklar per perusahaan: `is_enabled` (engine keseluruhan, bawaan **false**), `pph21_enabled` (bawaan true) |
| `payroll_ptkp_statuses` | PTKP per status: kode (TK/0…K/3), jumlah tahunan, kategori TER (A/B/C), bertanggal efektif |
| `payroll_ter_brackets` | Lapisan TER per kategori: batas bawah/atas bruto bulanan → tarif %, bertanggal efektif |
| `payroll_tax_brackets` | Lapisan Pasal 17 tahunan, bertanggal efektif |
| `payroll_statutory_programs` | Per program BPJS: `is_enabled`, tarif pekerja/perusahaan, `wage_cap`, `wage_floor`, kelas risiko (JKK), flag perilaku (`adds_to_tax_gross`, `employee_deductible_annual`, `counts_as_employer_cost`), `funding_note`, bertanggal efektif |
| `payroll_statutory_parameters` | Parameter kunci-nilai bertanggal: `biaya_jabatan_rate`, `biaya_jabatan_cap_year`, `biaya_jabatan_cap_month`, `non_npwp_surcharge_rate`, `thr_min_months`, `thr_full_months`, `overtime_hourly_divisor` |
| `payroll_overtime_rules` | Pengali lembur per skenario (hari kerja/libur, pola 5/6 hari, jam ke-n) |
| `payroll_minimum_wages` | Upah minimum per kode wilayah + tahun |
| `employee_statutory_enrollments` | Pengecualian kepesertaan per karyawan per program (ketiadaan baris = ikut) |
| `payroll_item_lines` | Snapshot komponen per item run: kode, label, kategori (`statutory_employee`/`statutory_employer`/`tax`/`info`), jumlah, dasar, `basis_snapshot` JSON |

Backfill migrasi untuk SEMUA perusahaan yang ada: akun **2110 "Utang
PPh 21"** (pemetaan `pph21_payable`), **2120 "Utang BPJS"** (`bpjs_payable`),
**6080 "Beban Iuran BPJS Perusahaan"** (`payroll_employer_expense`) +
konfigurasi regulasi lengkap dengan engine **nonaktif** — perilaku lama
tidak berubah oleh migrasi. Verifikasi DB dev: 1.500 baris TER
(125 lapisan × 12 perusahaan), 96 baris PTKP (8 × 12).

Halaman admin: **Pengaturan → Payroll Indonesia**
(`/app/pengaturan/payroll-indonesia`, gerbang `settings.manage`) —
saklar engine & PPh 21, saklar + tarif per program, PTKP, parameter,
tarif satu lapisan TER, upah minimum per wilayah. Semua penyimpanan
berpola **baris bertanggal efektif**: baris lama ditutup sehari sebelum
tanggal efektif baru; tanggal yang sama memperbarui di tempat; setiap
perubahan menulis `audit_log`. Aksi di
`src/server/actions/payroll-indonesia.ts`.

Seed perusahaan baru: `src/db/seed.ts` menyemai akun 2110/2120/6080 +
3 pemetaan + konfigurasi bawaan lewat `seedPayrollIndonesiaDefaults`
(idempoten), saklar tetap nonaktif.

### Batch 2 — Master karyawan diperluas

Kolom baru `employees` (migrasi 0027): `nik`, `npwp`, `ptkp_status`,
`birth_date`, `gender`, `contract_type` (`pkwtt|pkwt|harian|magang`),
`jkk_risk_class` (5 kelas), `work_region_code`. Field lama tidak berubah
makna. `saveEmployeeAction` menerima field baru secara opsional —
hanya ditulis bila terkirim (pemanggil lama tidak menghapus data) — dan
meng-upsert kepesertaan per program. Formulir karyawan
(`payroll-panel.tsx`) mendapat seksi "Payroll Indonesia": NIK, NPWP,
status PTKP (8 kode), tanggal lahir, jenis kelamin, jenis kontrak,
kelas risiko JKK, kode wilayah kerja, dan 6 checkbox kepesertaan.

### Batch 3 — Engine perhitungan + integrasi run payroll

Engine murni `src/lib/payroll-indonesia.ts` (Decimal.js, pembulatan
rupiah penuh HALF_UP): `terRateFor`, `computeMonthlyPph21`,
`computeProgressiveTax`, `computeAnnualPph21` (Pasal 17 + biaya jabatan
+ pengurang iuran pekerja + PTKP, PKP dibulatkan ke ribuan bawah),
`computeContribution(s)` (dasar dibatasi floor/cap konfigurasi, JKK per
kelas risiko karyawan dengan bawaan deterministik kelas sangat rendah,
menghormati saklar program & kepesertaan karyawan), `computeThr`,
`computeOvertimePay`, `isBelowMinimumWage`.

Domain `src/server/payroll-indonesia.ts`: `loadStatutoryConfig`
(memilih baris efektif terbaru per kunci pada tanggal run; `null` bila
engine nonaktif), `computeEmployeeStatutory` (kontribusi → premi
perusahaan yang menjadi objek pajak ditambahkan ke bruto pajak → PPh 21
TER bulanan, atau **hitung ulang tahunan mode masa terakhir** untuk
periode final/Desember atau `finalPeriod` eksplisit), `getYearToDateFigures`
(agregat snapshot run non-void tahun berjalan), `getPayrollRecap`.

Integrasi `runPayrollAction`:
- Bila engine nonaktif/tidak ada konfigurasi: **jalur generik persis
  seperti sebelum S2** (dibuktikan test — net, jurnal, dan nol baris
  statutory identik).
- Bila aktif: statutory dihitung SEBELUM usulan/override kasbon sehingga
  batas gaji bersih kasbon (A-11) memperhitungkan iuran + PPh 21;
  kasbon tidak mengurangi bruto pajak (TC-11).
- Pemeriksaan upah minimum per `work_region_code` karyawan: run di bawah
  UMP ditolak kecuali `acknowledgeMinWage` (TC-12).
- Snapshot `payroll_item_lines` ditulis per item; total run baru:
  `payroll_runs.total_pph21`, `total_statutory_employee`,
  `total_employer_contributions`.
- Jurnal tambahan (hanya bila total ≠ 0, semua lewat pemetaan akun):
  Dr `payroll_employer_expense` / Cr `bpjs_payable` sebesar beban
  perusahaan yang `counts_as_employer_cost`; Cr `bpjs_payable` sebesar
  iuran pekerja; Cr `pph21_payable` sebesar PPh 21 (PPh negatif di masa
  terakhir → baris Dr pengembalian kelebihan potongan). JKP tidak
  membebani kas perusahaan (`counts_as_employer_cost=false`,
  `funding_note` tercatat di konfigurasi).
- Status PTKP karyawan kosong → bawaan TK/0 dengan penanda
  `ptkpAssumed` di `basis_snapshot` (tidak diam-diam).
- Karyawan tanpa NPWP **dan** tanpa NIK → tarif TER +20% (parameter
  `non_npwp_surcharge_rate`); NIK terisi dianggap memenuhi syarat.

### Batch 4 — Slip gaji & ringkasan setoran

- **Slip gaji cetak** `/app/akuntansi/payroll/[id]/cetak` (Print Engine,
  kertas dokumen perusahaan, satu karyawan per halaman; `?employeeId=`
  untuk slip tunggal): penghasilan (pokok, tunjangan, premi perusahaan
  objek pajak), iuran perusahaan sebagai informasi, potongan per
  komponen bernama (iuran pekerja per program, PPh 21, kasbon, potongan
  tetap), gaji bersih. Angka dibaca dari SNAPSHOT run — slip lama tidak
  berubah saat konfigurasi berubah.
- **Halaman detail run**: metrik PPh 21 / iuran pekerja / beban
  perusahaan, kolom BPJS pekerja & PPh 21 per karyawan dengan rincian
  per program, tautan slip per baris.
- **Ekspor CSV rekap** `GET /api/export/payroll?runId=` (izin
  `accounting.view`, `withCompanyReadOnly`, helper `toCsv`/`csvResponse`
  yang sama dengan ekspor lain): satu baris per karyawan — kode, nama,
  PTKP, bruto, potongan tetap, iuran pekerja per program (Kes/JHT/JP),
  total iuran pekerja, PPh 21, potongan kasbon, gaji bersih, iuran
  perusahaan per program (Kes/JHT/JKK/JKM/JP/JKP), total beban
  perusahaan, dan **total setoran** (pekerja + perusahaan + PPh 21)
  untuk keperluan setor PPh 21/BPJS.

### Batch tambahan (penegasan pemilik) — Saklar PPN per perusahaan

Audit konfigurasi pajak transaksi yang sudah ada:

| Pertanyaan audit | Temuan |
|---|---|
| Tarif PPN per perusahaan? | **Ya** — `company_settings.tax_rate`, dipakai POS (inklusif per baris via `lineTax`) dan Catat Transaksi (opsi "Termasuk PPN" via pemetaan `tax_output` 2200) |
| Bertanggal efektif? | **Tidak** — satu tarif berlaku segera; tidak ada riwayat tarif. → requirement S7 (§7 R-2) |
| Bisa dinonaktifkan per perusahaan? | **Tidak ada saklar** — satu-satunya cara adalah tarif 0 (menghapus informasi tarif). → **ditutup di fase ini** |
| Toggle per transaksi di POS? | Tidak ada. → requirement S7 (§7 R-3) |

Penutupan celah: kolom `company_settings.tax_enabled` (migrasi 0027,
backfill `tax_enabled = (tax_rate > 0)` sehingga **tidak ada perusahaan
yang perilakunya berubah oleh migrasi**). Ditegakkan di server:
`quoteCart` POS (quote = checkout, satu titik hitung) dan jalur posting
+ bootstrap modal Catat Transaksi. UI: checkbox "PPN aktif" di
Pengaturan Umum di samping tarif. Test: `tests/sim2/ppn-toggle.test.ts`
(3 test — mati → pajak 0 walau tarif 11 tersimpan; menyala → inklusif
11% atas Rp111.000 = Rp11.000; mati lagi → 0, tarif tersimpan utuh).
Dua test lama (POS M-4, kontrak nota berpajak) diperbarui menyalakan
saklar secara eksplisit karena memang menguji penjualan berpajak.

---

## 2. Test case regulasi — hasil

**Unit murni** `tests/unit/payroll-indonesia.test.ts` — **20/20 lulus**:
TC-01…TC-12 pada level fungsi murni, ditambah bukti konfigurasi:
mengganti tarif TER di konfigurasi mengubah hasil; mematikan JKP
menghapus tepat komponen JKP; menghapus semua program → nol statutory.

**Integrasi** `tests/sim2/payroll-indonesia.test.ts` (9 test) +
`tests/sim2/payroll-indonesia-desember.test.ts` (4 test) — **13/13 lulus**:

| TC | Bukti integrasi |
|---|---|
| TC-01/02 | Run Maret 2026: karyawan A (TK/0, bruto 10 jt, BPJS penuh, JKK sangat rendah) — bruto pajak **10.454.000** (termasuk premi Kes 400 rb + JKK 24 rb + JKM 30 rb), PPh **261.350** (TER 2,5%); karyawan B tanpa kepesertaan PPh **200.000** (TER 2%) |
| Jurnal | Cr 2120 Utang BPJS 1.424.000; Dr 6080 beban perusahaan 1.024.000; Cr 2110 Utang PPh 21 461.350 |
| Saklar program | JKP dimatikan → baris `jkp_employer` hilang persis, angka lain identik; semua program mati → karyawan hanya punya baris pajak |
| Bukan hardcode | Mei 2026: lapisan TER 9.650.001 diubah via baris efektif baru menjadi 5% → PPh B **500.000**; snapshot Maret tetap 200.000 |
| TC-05 | **Persis kanonis**: Jan–Nov terpotong 200.000/bln (total 2.200.000); Desember hitung ulang tahunan: bruto 120 jt − biaya jabatan 6 jt − JHT 2,4 jt − JP 1,2 jt − PTKP 54 jt → PKP 56,4 jt → pajak setahun 2.820.000 → **potongan Desember Rp620.000**; net 9.080.000; jurnal Cr 2110 620.000 |
| TC-11 | Kasbon Rp5 jt rencana `full`: PPh tetap 200.000 (kasbon bukan pengurang bruto), potongan kasbon 5.000.000, net 4.800.000, sisa kasbon 0 |
| TC-12 | Karyawan bergaji 5 jt di wilayah ID-JK (UMP 5.729.876): run **ditolak** `/upah minimum/i`; lulus dengan `acknowledgeMinWage`; PPh 0; net 5.000.000 |
| Generik utuh | Perusahaan tanpa konfigurasi aktif: net 3.900.000, nol baris statutory, nol jurnal 2110/2120/6080 |
| Void | Void run memulihkan YTD (agregat snapshot) dan kasbon seperti perilaku lama; rekap Maret terbaca benar dari snapshot |

Regresi terkait terkonfirmasi hijau di suite penuh (§8).

---

## 3. Nilai konfigurasi bawaan + sumber regulasi

Disemai dari lembar fakta S0-C Bagian 3 (terverifikasi penuh) dan
diverifikasi silang 2026-11-04:

- **PTKP** (PMK 101/PMK.010/2016): TK/0 54 jt; TK/1 & K/0 58,5 jt;
  TK/2 & K/1 63 jt; TK/3 & K/2 67,5 jt; K/3 72 jt. Kategori TER:
  A = TK/0, TK/1, K/0 · B = TK/2, TK/3, K/1, K/2 · C = K/3.
- **TER bulanan** (Lampiran PP 58/2023): A 44 lapisan (0% s.d. 5,4 jt …
  34% di atas 1,4 M), B 40 lapisan (0% s.d. 6,2 jt), C 41 lapisan
  (0% s.d. 6,6 jt).
- **Pasal 17**: 5% ≤60 jt; 15% 60–250 jt; 25% 250–500 jt; 30% 500 jt–5 M;
  35% >5 M.
- **BPJS Kesehatan** (Perpres 64/2020): 5% = perusahaan 4% + pekerja 1%,
  dasar (pokok + tunjangan) dibatasi Rp12.000.000.
- **JHT** 5,7% (3,7% perusahaan / 2% pekerja, tanpa batas). **JKK** 100%
  perusahaan per kelas risiko 0,24/0,54/0,89/1,27/1,74%. **JKM** 0,30%
  perusahaan. **JP** 3% (2%/1%), batas upah **Rp10.547.400 efektif
  2025-03-01**.
- **JKP**: 0,46% s.d. 2025-02-06; **0,36% sejak 2025-02-07** (PP 6/2025),
  batas dasar Rp5.000.000, bukan beban kas perusahaan (rekomposisi +
  pemerintah — tercatat di `funding_note`).
- **Parameter**: biaya jabatan 5%, maks 500 rb/bln & 6 jt/thn; surcharge
  tanpa NPWP 20%; THR: hak mulai 1 bulan, penuh pada 12 bulan; pembagi
  upah sejam lembur 173; pengali lembur PP 35/2021 Pasal 31–32.
- **Upah minimum contoh 2026**: DKI Jakarta (ID-JK) Rp5.729.876
  (Kepgub DKI 1142/2025); Jawa Barat (ID-JB) Rp2.317.601. Wilayah lain
  ditambah admin lewat halaman pengaturan.

## 4. Sengaja TIDAK disemai (terverifikasi sebagian — hanya struktur)

1. **Batas upah JP 2026 (Rp11.086.300)** — baris efektif baru ditambah
   admin bila sudah resmi; struktur bertanggalnya sudah mendukung.
2. **Lapisan TER harian** — struktur tabel mendukung baris per kategori,
   tetapi pemetaan pegawai harian belum memakai TER bulanan (lihat R-1).
3. **PPh 21 DTP** (mis. PMK 105/2025 untuk sektor padat karya 2026,
   bruto ≤ Rp10 jt/bln) — belum ada flag konfigurasi DTP; requirement R-4.

## 5. Daftar configurable + toggleable (dengan lokasi)

| # | Item | Lokasi konfigurasi |
|---|---|---|
| C-1 | Engine Payroll Indonesia aktif/nonaktif per perusahaan | Pengaturan → Payroll Indonesia (`payroll_statutory_settings.is_enabled`) |
| C-2 | PPh 21 (TER + hitung ulang tahunan) aktif/nonaktif | idem (`pph21_enabled`) |
| C-3 | Setiap program BPJS satu per satu (Kes/JHT/JKK/JKM/JP/JKP) | idem (`payroll_statutory_programs.is_enabled` per baris efektif) |
| C-4 | Tarif pekerja & perusahaan per program | idem (`employer_rate`/`employee_rate`) |
| C-5 | Batas upah (cap) & lantai upah per program | idem (`wage_cap`/`wage_floor`) |
| C-6 | Kelas risiko JKK + tarif per kelas | idem (baris `risk_class`) + kelas per karyawan di master karyawan |
| C-7 | Perilaku program: menambah bruto pajak / pengurang tahunan / beban kas perusahaan | idem (`adds_to_tax_gross`, `employee_deductible_annual`, `counts_as_employer_cost`) |
| C-8 | PTKP per status + pemetaan status → kategori TER | `payroll_ptkp_statuses` (halaman menampilkan; ubah via baris efektif) |
| C-9 | Seluruh lapisan TER A/B/C | `payroll_ter_brackets` (halaman: ubah tarif per lapisan per tanggal efektif) |
| C-10 | Lapisan Pasal 17 | `payroll_tax_brackets` |
| C-11 | Biaya jabatan (%), cap bulanan & tahunan; surcharge non-NPWP; ambang THR; pembagi lembur | `payroll_statutory_parameters` (halaman pengaturan) |
| C-12 | Pengali lembur per skenario | `payroll_overtime_rules` |
| C-13 | Upah minimum per wilayah + tahun | `payroll_minimum_wages` (halaman pengaturan + formulir tambah) |
| C-14 | Kepesertaan per karyawan per program (pengecualian) | Master karyawan → seksi Payroll Indonesia (`employee_statutory_enrollments`) |
| C-15 | Status PTKP, NIK/NPWP, kontrak, wilayah kerja per karyawan | Master karyawan |
| C-16 | Akun jurnal PPh 21 / BPJS / beban perusahaan | Pemetaan akun (`pph21_payable`, `bpjs_payable`, `payroll_employer_expense`) |
| C-17 | **PPN aktif/nonaktif per perusahaan** (baru, S2) | Pengaturan Umum (`company_settings.tax_enabled`) |
| C-18 | Tarif PPN per perusahaan | Pengaturan Umum (`company_settings.tax_rate`) |

Semua perubahan konfigurasi di C-1…C-13 berpola baris bertanggal efektif
dan **tidak mengubah snapshot run yang sudah terposting**.

## 6. Masih ter-hardcode (jujur, bernomor — untuk remediasi)

| # | Item | Lokasi / catatan |
|---|---|---|
| H-1 | Tanggal jurnal payroll = `‹periode›-28` | `runPayrollAction` — tanggal 28 tetap untuk semua periode |
| H-2 | Format periode payroll hanya bulanan `YYYY-MM` | Skema `payroll_runs.period` + validasi aksi; payroll mingguan/harian belum didukung |
| H-3 | Dasar upah BPJS & bruto = gaji pokok + tunjangan **gabungan** | Master karyawan belum memisahkan tunjangan tetap/tidak tetap (S0-C §6D); aturan regulasi memakai dasar gabungan ini |
| H-4 | Bawaan status PTKP `TK/0` bila status karyawan kosong | Tercatat `ptkpAssumed` di snapshot, tetapi tetap sebuah bawaan di kode domain |
| H-5 | Pemeriksaan upah minimum memakai pokok + tunjangan gabungan | Sama dengan H-3 |
| H-6 | Daftar kode program & kolom rekap CSV | Kode program (`bpjs_kes`, `jht`, …) adalah kosakata skema; program regulasi BARU di luar enam ini butuh perubahan kode, bukan hanya konfigurasi |
| H-7 | Tarif PPN tidak bertanggal efektif | Lihat R-2 |

## 7. Keterbatasan & requirement lanjutan

- **R-1 TER harian (pegawai harian)**: engine saat ini menerapkan TER
  bulanan untuk semua `contract_type`. AC: pegawai `harian` dihitung
  dengan tabel TER harian (lapisan bruto harian) dari konfigurasi;
  test case terhitung untuk bruto harian di dua lapisan berbeda.
- **R-2 Tarif PPN bertanggal efektif**: tarif berubah (mis. 11% → 12%)
  harus berlaku per tanggal dokumen tanpa mengubah dokumen lama.
  AC: tabel tarif bertanggal per perusahaan; POS/quick-entry memilih
  tarif menurut tanggal transaksi; dokumen lama tidak berubah.
- **R-3 Toggle PPN per transaksi**: penjualan tertentu bebas PPN tanpa
  mematikan saklar perusahaan. AC: flag per transaksi di POS dengan
  izin khusus + tercatat di dokumen & jurnal.
- **R-4 PPh 21 DTP sebagai konfigurasi opsional**: flag per perusahaan
  per periode + syarat bruto maksimum; PPh ditandai ditanggung
  pemerintah (tidak memotong gaji, tetap dilaporkan). AC: konfigurasi
  DTP bertanggal; slip & rekap membedakan PPh dipotong vs DTP.
- **R-5 Setoran PPh 21/BPJS**: rekap CSV sudah tersedia; aksi "bayar
  setoran" yang melunasi utang 2110/2120 dari kas/bank belum ada.
- **R-6 THR & lembur terhubung ke run**: `computeThr`/`computeOvertimePay`
  sudah berfungsi dan teruji sebagai fungsi murni + konfigurasi, tetapi
  run payroll belum memasukkan komponen THR/lembur otomatis (tidak ada
  data absensi/lembur — di luar cakupan S2).
- **R-7 Gross-up PPh** (pajak ditanggung perusahaan sebagai tunjangan
  pajak) belum didukung.
- **R-8 Slip mandiri karyawan**: slip saat ini dicetak dari sisi admin/
  akuntansi; akses slip oleh karyawan sendiri belum ada.
- Catatan keamanan: halaman payroll/slip masih digerbang
  `accounting.view` — temuan **SEC-01 S0-D tetap milik fase S6** (gerbang
  data gaji per `payroll.manage`), tidak diubah diam-diam di fase ini.

## 8. Gerbang verifikasi

- `pnpm test`: **663/663 lulus** (74 berkas) — baseline S1 627 + 36 test
  baru S2 (20 unit + 13 integrasi payroll + 3 PPN).
- `pnpm typecheck`: lulus. `pnpm lint`: lulus (0 error).
  `pnpm build`: lulus (produksi, termasuk rute baru
  `/app/pengaturan/payroll-indonesia`, `/app/akuntansi/payroll/[id]/cetak`,
  `/api/export/payroll`).
- Migrasi 0027 diterapkan ke DB dev; tidak ada migrasi lama yang diubah.
- Tidak ada commit oleh agen fase ini (sesuai mandat — Pemimpin yang
  memeriksa diff, menjalankan ulang suite, dan commit).
