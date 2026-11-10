# SIM-2 Fase S7B-1 — HR Lanjutan (§6 + D-24/D-25)

Status: **SELESAI & TERVERIFIKASI** — belum di-commit (menunggu pemeriksaan Pemimpin).
Baseline HEAD saat fase mulai: `ae2101a` (suite 835/835, 89 berkas).

## Gerbang akhir (bukti)

| Gerbang | Hasil |
|---|---|
| `pnpm test` | **863/863 test lulus, 94 berkas** (naik dari 835/835, 89 berkas) |
| `pnpm build` | **exit code 0** (mentah, tanpa pipa) |
| `pnpm typecheck` | **bersih, tanpa error** |

Migrasi baru (aditif, tidak mengedit migrasi lama): `0033_s7b1_hr_org`,
`0034_s7b1_attendance`, `0035_s7b1_overtime_thr`, `0036_s7b1_leave`,
`0037_s7b1_final_pay` — semuanya teraplikasi di PG18 lokal (port 5433)
dengan blok RLS tenant + GRANT `app_user` mengikuti pola repo.

## Per batch — bukti test

### Batch 1 — Struktur organisasi & riwayat karyawan (§6A)
`tests/sim2/hr-org-history.test.ts` — **8/8 hijau**.
- Master Departemen & Jabatan (CRUD + nonaktif, pola master repo);
  karyawan menunjuk departemen/jabatan/atasan (self-ref tanpa FK agar
  bebas siklus)/cabang; tanggal mulai/selesai kontrak PKWT.
- Tabel `employee_history`: perubahan jabatan, departemen, gaji pokok,
  kontrak, cabang, atasan, dan status tercatat otomatis dari aksi
  simpan karyawan yang sudah ada (snapshot before/after berlabel +
  tanggal efektif). Karyawan lama tanpa departemen tetap berjalan.
- UI: fieldset "Organisasi & kontrak" di formulir karyawan, hub
  `/app/akuntansi/hr`, detail karyawan `/app/akuntansi/karyawan/[id]`
  dengan tab Ringkasan | Riwayat perubahan, peringatan kontrak PKWT
  yang akan berakhir (ambang hari = konfigurasi).

### Batch 2 — Absensi & shift (§6B)
`tests/sim2/hr-attendance.test.ts` — **6/6 hijau** + `tests/unit/hr.test.ts` — **5/5 hijau**.
- Master shift (jam masuk/pulang, hari kerja per weekday, lintas
  tengah malam), penugasan shift bertanggal efektif per karyawan.
- Catatan absensi harian (hadir/izin/sakit/cuti/alpa, jam aktual,
  menit terlambat dihitung dari shift berlaku), input manual + impor
  CSV (`kode;tanggal;status;masuk;pulang;catatan`, alias status
  Indonesia/Inggris, error per baris tidak menggagalkan impor).
- Rekap per periode; absensi perusahaan lain terisolasi (test lintas
  perusahaan). Absensi TIDAK menyentuh payroll kecuali saklar Batch
  3/4 diaktifkan.

### Batch 3 — Lembur terhubung payroll + THR (menutup R-6 S2)
`tests/sim2/hr-overtime-thr.test.ts` — **4/4 hijau**.
- Pengajuan lembur dengan persetujuan (diajukan/disahkan/ditolak,
  pengesah tercatat); lembur disahkan menjadi komponen upah lembur
  bernama (`payroll_item_lines` code `overtime`) memakai aturan
  pengali KONFIGURASI S2 — acuan TC-10: upah 5.190.000 → Rp30.000/jam;
  3 jam hari kerja disahkan = **Rp165.000** masuk run. Ditolak/pending
  tidak masuk; saklar mati = perilaku lama persis.
- "Hitung THR" memakai `computeThr` S2 → draf komponen per karyawan
  (satu draf aktif per karyawan/periode, indeks unik parsial); draf
  masuk run berikutnya sebagai baris `thr`, ter-`consumed` oleh run,
  dan pulih otomatis saat run di-void. Karyawan 6 bulan =
  **50% × Rp6.000.000 = Rp3.000.000**; ≥12 bulan penuh.
- Lembur/THR menambah bruto pajak (`taxableExtra` di engine S2);
  dasar iuran BPJS tetap gaji pokok + tunjangan (konvensi S2).

### Batch 4 — Cuti (§6C)
`tests/sim2/hr-leave.test.ts` — **6/6 hijau**.
- Jenis cuti terkonfigurasi tersemai: tahunan 12 hari berbayar, sakit
  (tanpa jatah) berbayar, melahirkan 90 berbayar, izin (tanpa jatah)
  **tidak berbayar**, khusus (tanpa jatah) berbayar — semua dapat
  diubah/dinonaktifkan admin.
- Saldo = jatah − terpakai (pengajuan approved) + sisa tahun lalu
  hanya bila `leave_carry_over_enabled` (test: sisa 9 → saldo 2027 =
  12 + 9 = **21**). Hari dihitung menurut pola kerja karyawan (shift
  berlaku / pola bawaan konfigurasi); setengah hari 0,5 untuk satu
  hari. Pengajuan melebihi saldo ditolak; tumpang tindih dengan
  pending/approved ditolak; saldo dicek ulang saat pengesahan.
- Pengesahan menulis `attendance_records` status `leave`
  (source `leave`, tertaut `leave_request_id`).
- Cuti tidak berbayar disahkan → potongan bernama `unpaid_leave` di
  run bila saklar aktif: tarif harian = upah bulanan ÷
  `working_days_per_month` konfigurasi. Test: 2 hari ×
  (4.400.000 ÷ 22) = **Rp400.000**, bersih 4.000.000; karyawan tanpa
  cuti tidak terpengaruh.

### Batch 5 — Terminasi & final pay (§6G)
`tests/sim2/hr-termination.test.ts` — **6/6 hijau** (2 perusahaan uji).
- `payroll_runs.kind` (`regular` | `final`) + `employee_id`; indeks
  unik periode kini hanya untuk run reguler — final pay TIDAK
  menghalangi run reguler bulan yang sama (penjaga lama di
  `runPayrollAction` diperbaiki menyaring `kind='regular'`), dan satu
  final run non-void per karyawan dijaga indeks unik parsial.
- Final pay: gaji **prorata hari kerja terpakai** (pola kerja
  karyawan; baris info `final_prorata` berisi faktor & snapshot),
  lembur/THR/cuti tak berbayar mengikuti saklar yang sama seperti run
  reguler, dan PPh 21 **mode masa terakhir** (`isFinalPeriod`) bila
  engine S2 aktif. Test statutory: karyawan Rp10.000.000 TK/0 hanya
  JHT+JP — Jan–Okt TER Rp200.000/bln; final pay November: pajak
  tahunan 11 bulan (110.000.000 − 3.300.000 − 5.500.000 − 54.000.000)
  × 5% = 2.360.000 − TER terbayar 2.000.000 = **PPh Rp360.000**,
  bersih **Rp9.340.000** (bukan TER 200.000 — hitung ulang terbukti).
- Test generik: berhenti 2026-11-13 → prorata 10/21 × 6.000.000 =
  Rp2.857.142,86; kasbon Rp900.000 **tertagih penuh**; bersih
  Rp1.957.142,86; jurnal final pay seimbang.
- Sisa kasbon melebihi pembayaran akhir: **ditolak tanpa penegasan**;
  dengan `acknowledgeShortfall` tercatat di audit → dipotong sebatas
  bersih (bersih 0), sisa Rp4.000.000 tetap piutang terbuka.
- Karyawan berhenti: `isActive=false`, status `terminated`, tanggal/
  alasan (kode dari konfigurasi)/catatan terisi + baris riwayat
  `status`; hilang dari run reguler berikutnya; histori tetap terbaca;
  tidak ada aksi hapus karyawan (tidak bisa dihapus). Final run dapat
  dibayar/di-void lewat alur payroll generik yang sama; sesudah void,
  pembayaran akhir dapat dibuat ulang dari panel terminasi di detail
  karyawan (`createFinalPayAction`).

## Konfigurasi baru (D-25 — semua per perusahaan, bertanggal efektif)

Tabel `hr_parameters` (kunci → bawaan):
- `working_days_per_month` = 22 — penyebut tarif harian.
- `default_work_days` = `1,2,3,4,5` — pola hari kerja karyawan tanpa shift.
- `overtime_payroll_enabled` = false — saklar lembur + draf THR masuk run.
- `unpaid_leave_payroll_enabled` = false — saklar potongan cuti tak berbayar.
- `leave_carry_over_enabled` = false — sisa cuti terbawa ke tahun berikut.
- `contract_expiry_warning_days` = 30 — ambang peringatan PKWT berakhir.
- `termination_reasons` = JSON resign/phk/pensiun/kontrak_selesai/meninggal/lainnya.

Master baru yang dapat dikelola admin: `departments`, `job_positions`,
`work_shifts` (hari kerja + jam), `leave_types` (jatah hari/tahun,
berbayar/tidak, aktif/tidak). Pengali lembur & aturan THR tetap memakai
konfigurasi S2 (tidak diduplikasi). Semua data HR mengikuti gerbang
izin S6: baca `payroll.view`, tulis `payroll.manage` dalam modul
akuntansi.

## Status §6A–6G sesudah fase ini

| Bagian | Status |
|---|---|
| 6A Employee Management | **TERIMPLEMENTASI** — master org, riwayat otomatis, kontrak PKWT + peringatan. Sisa: dokumen/lampiran kontrak (lihat bawah). |
| 6B Attendance & Shift | **TERIMPLEMENTASI** — shift, penugasan, absensi manual/CSV, rekap. Sisa: integrasi perangkat (lihat bawah). |
| 6C Leave Management | **TERIMPLEMENTASI** — jenis terkonfigurasi, saldo + carry-over, persetujuan, absensi otomatis, potongan tak berbayar. |
| 6D Payroll & Penggajian | **DIPERLUAS** — lembur & THR terhubung run; final pay. Payroll mingguan & run per kelompok karyawan TIDAK dibangun (di luar mandat batch fase ini). |
| 6E Payroll Indonesia | Sudah selesai di S2; fase ini menutup R-6 (THR/lembur terhubung run) dan memakai mode masa terakhir untuk final pay. |
| 6F Advance & Reimbursement | Kasbon ditagihkan penuh di final pay (fase ini). Persetujuan kasbon, pinjaman karyawan terpisah, dan reimbursement adalah lingkup **S7B-2** — final pay saat ini hanya menagih kasbon; pinjaman karyawan belum ada sebagai entitas. |
| 6G Termination | **TERIMPLEMENTASI** — proses berhenti + final pay + penjaga kasbon. |

## NOT IMPLEMENTED (jujur — requirement, bukan fitur setengah jadi)

- **Mesin absensi fingerprint/perangkat & geolocation**: tidak ada
  integrasi perangkat keras; absensi masuk lewat input manual dan
  impor CSV. Requirement bila dibangun: adapter per vendor, antrean
  sinkronisasi offline, dan pemetaan ID perangkat → karyawan.
- **ESS / slip mandiri karyawan (R-8 S2)**: karyawan belum punya
  login untuk melihat slip, mengajukan cuti/lembur sendiri, atau
  mengunduh bukti potong. Pengajuan saat ini dicatat admin/atasan.
  Requirement: peran `employee` terikat `employee_id`, halaman slip &
  pengajuan mandiri, dan gerbang privasi antar-karyawan.
- **Dokumen kontrak & lampiran karyawan**: belum ada penyimpanan
  berkas per karyawan (kontrak PKWT, KTP, NPWP). Requirement: unggah
  berkas terikat tenant + kontrol akses `payroll.view`.
- **Pesangon/kompensasi PKWT otomatis**: final pay mencakup prorata
  gaji, lembur, THR draf, potongan, PPh masa terakhir, dan kasbon —
  perhitungan uang pesangon/UPMK/kompensasi PKWT menurut PP 35/2021
  belum dimodelkan sebagai komponen konfigurasi; bila perusahaan
  membutuhkannya, masukkan sebagai komponen manual/draf sampai fase
  khusus memutuskan rumusnya bersama pemilik.
- **Payroll mingguan & run per kelompok**: run tetap bulanan untuk
  semua karyawan aktif; final pay adalah satu-satunya run per karyawan.

## Berkas utama yang berubah/dibuat

- Migrasi: `src/db/migrations/0033–0037` (+ snapshot & jurnal).
- Domain: `src/server/hr.ts` (baru), `src/lib/hr.ts` (helper murni baru),
  `src/server/actions/hr.ts` (baru), perluasan `src/server/actions/accounting.ts`
  (riwayat pada simpan karyawan; lembur/THR/cuti di `runPayrollAction`;
  penjaga periode menyaring `kind='regular'`),
  `src/server/payroll-indonesia.ts` (parameter `taxableExtra`).
- Skema: `src/db/schema.ts` (tabel HR + `payroll_runs.kind/employee_id`).
- UI: `src/components/akuntansi/hr-panel.tsx` (baru),
  `src/app/app/akuntansi/hr/` (hub, absensi, lembur, cuti),
  `src/app/app/akuntansi/karyawan/[id]/` (detail + tab riwayat + panel
  terminasi), perluasan formulir karyawan di `payroll-panel.tsx` dan
  penanda "Pembayaran akhir" di daftar payroll.
- Test: `tests/sim2/hr-org-history.test.ts`, `hr-attendance.test.ts`,
  `hr-overtime-thr.test.ts`, `hr-leave.test.ts`, `hr-termination.test.ts`,
  `tests/unit/hr.test.ts`.
