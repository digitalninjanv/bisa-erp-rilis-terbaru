# SIM-2 Fase S0-C — Audit HR & Payroll + Riset Regulasi Indonesia

- **Tanggal audit:** 4 November 2026
- **Ruang lingkup:** mandat pengguna §6A–6G (siklus karyawan, attendance & shift, leave, payroll & komponen, payroll Indonesia, advance & reimbursement, termination)
- **Metode:** pembacaan kode & skema aktual (baca-saja) + riset web sumber resmi/sekunder tepercaya untuk regulasi. Tidak ada kode yang diubah dalam fase ini.
- **Status yang dipakai:** BERFUNGSI (ada implementasi nyata dan teruji) · SEBAGIAN (ada sebagian, ada celah material) · BELUM ADA (tidak ditemukan implementasi).

---

# Bagian 1 — Inventaris Kemampuan HR/Payroll Saat Ini

## Ringkasan bukti utama

- Master karyawan: tabel `employees` — `src/db/schema.ts:1214-1230`.
- Mesin payroll: `runPayrollAction`, `payPayrollAction`, `voidPayrollRunAction` — `src/server/actions/accounting.ts:739-1080`.
- Form karyawan & run: `src/components/akuntansi/payroll-panel.tsx`; halaman `src/app/app/akuntansi/payroll/` dan `payroll/[id]/`.
- Kasbon: domain `src/server/employee-advances.ts`, aksi `src/server/actions/employee-advances.ts`, UI `src/app/app/akuntansi/kasbon/`.
- Izin: satu-satunya gerbang HR adalah `payroll.manage` di bawah modul Akuntansi (`src/lib/permissions.ts:16`). **Tidak ada peran/izin HR terpisah** — siapa pun yang boleh mengelola payroll melihat seluruh data gaji; akuntan dan "HR" tidak dibedakan oleh sistem izin.
- Pencarian kode `pph|bpjs|ptkp|ter|thr|lembur|absensi|cuti` di seluruh `src/`: **nol hasil fungsional**. Tidak ada satu pun perhitungan pajak/BPJS di kode.

## 6A. Employee Management — Status: SEBAGIAN

| Kebutuhan §6A | Status | Bukti / catatan |
|---|---|---|
| Tambah & edit karyawan | BERFUNGSI | `saveEmployeeAction` (`actions/accounting.ts:703`), form di `payroll-panel.tsx`. Update yang tidak mengenai baris ditolak NOT_FOUND (AK-P2-10). |
| Nomor induk karyawan | SEBAGIAN | `employees.code` unik per perusahaan (`employees_company_code_uq`) berfungsi sebagai kode internal. **NIK KTP dan NPWP tidak ada** di skema. |
| Nama, tanggal mulai | BERFUNGSI | `name`, `joinedAt`. |
| Jabatan | SEBAGIAN | `position` teks bebas — bukan master jabatan, tidak ada konsistensi/riwayat. |
| Departemen | BELUM ADA | Tidak ada kolom/tabel departemen. |
| Cabang | BELUM ADA | `employees` tidak punya `branchId`; karyawan tidak terhubung ke cabang mana pun. |
| Atasan (manager) | BELUM ADA | Tidak ada kolom atasan/relasi organisasi. |
| Status kerja | SEBAGIAN | Hanya `isActive` boolean. Tidak ada status cuti panjang, resign, terminasi, atau masa percobaan yang terdiferensiasi. |
| Jenis kontrak PKWT/PKWTT | BELUM ADA | Tidak ada kolom jenis kontrak. |
| Tanggal mulai & berakhir kontrak | BELUM ADA | Hanya `joinedAt`; tidak ada tanggal akhir kontrak → tidak ada peringatan kontrak habis. |
| Riwayat perubahan jabatan | BELUM ADA | Update menimpa `position`; tidak ada tabel riwayat. `saveEmployeeAction` juga tidak menulis `writeAudit`, jadi perubahan jabatan tidak berjejak terstruktur. |
| Riwayat perubahan gaji | BELUM ADA | `baseSalary` ditimpa langsung; payroll lama aman karena run menyalin snapshot ke `payroll_items`, tetapi riwayat "siapa mengubah gaji dari berapa ke berapa, efektif kapan" tidak ada. |
| Riwayat perubahan lokasi kerja | BELUM ADA | Konsep lokasi/cabang untuk karyawan tidak ada. |
| Dokumen kontrak & lampiran | BELUM ADA | Tidak ada penyimpanan dokumen karyawan. |
| Gaji pokok, tunjangan, potongan pada master | BERFUNGSI (kasar) | Tiga angka: `baseSalary`, `allowances` (satu angka gabungan), `deductions` (satu angka gabungan). Lihat 6D. |

**Requirement (6A yang belum ada):** perluasan master karyawan — NIK, NPWP, status PTKP, jenis kelamin & tanggal lahir (dibutuhkan BPJS/PTKP), departemen, cabang, atasan, jenis kontrak + tanggal mulai/akhir, rekening bank untuk pembayaran gaji, nomor kepesertaan BPJS Kesehatan & Ketenagakerjaan; master jabatan & departemen; tabel riwayat efektif-bertanggal untuk jabatan, gaji, dan lokasi.
**Acceptance criteria:** (1) perubahan gaji/jabatan selalu menambah baris riwayat bertanggal efektif dan tidak mengubah payroll periode yang sudah posted; (2) kontrak PKWT yang akan berakhir ≤30 hari muncul di daftar peringatan; (3) field sensitif (NIK, NPWP, rekening) hanya terlihat oleh pemegang izin HR, tercatat di audit log saat diubah.

## 6B. Attendance & Shift — Status: BELUM ADA

Tidak ada tabel absensi, jadwal, atau shift karyawan di skema; tidak ada halaman absensi. Yang bernama "sesi/shift" di sistem adalah **sesi kasir POS** (`cash_sessions`) — konsep berbeda, tidak terhubung ke karyawan HR.

**Requirement:** master shift (jam mulai/selesai, lintas tengah malam, pola 5/6 hari kerja), jadwal per karyawan per tanggal, pencatatan check-in/out (manual oleh atasan + koreksi beralasan), status kehadiran (hadir, terlambat, pulang awal, alpa, izin, sakit, cuti), rekap periode yang menjadi masukan payroll (hari kerja efektif, menit terlambat, jam lembur terverifikasi).
**Acceptance criteria:** (1) check-in ganda di hari yang sama ditolak/digabung dengan jejak; (2) lupa check-out ditandai dan hanya bisa ditutup lewat koreksi beralasan oleh atasan; (3) perubahan jadwal sesudah absensi tercatat tidak mengubah rekap yang sudah terkunci untuk payroll posted; (4) rekap per karyawan per periode dapat ditelusur ke catatan harian.

## 6C. Leave Management — Status: BELUM ADA

Tidak ada pengajuan cuti, saldo cuti, atau persetujuan cuti. Tidak ada pengaruh cuti ke payroll.

**Requirement:** jenis cuti terkonfigurasi (tahunan, sakit, melahirkan, izin, khusus, unpaid) dengan kuota & aturan accrual; pengajuan → persetujuan atasan → saldo berkurang; cuti tidak dibayar memotong gaji secara proporsional di payroll; setengah hari didukung. Acuan normatif: cuti tahunan minimal 12 hari kerja setelah 12 bulan bekerja terus-menerus (UU 13/2003 Pasal 79 sebagaimana diubah UU 6/2023); cuti melahirkan 3 bulan (UU 13/2003 Pasal 82, diperbarui UU KIA No. 4/2024 — rincian durasi perlu verifikasi saat Fase S2).
**Acceptance criteria:** (1) saldo tidak pernah negatif dan setiap perubahan saldo tertelusur ke pengajuan yang disetujui; (2) pengajuan yang tumpang tindih ditolak; (3) unpaid leave N hari pada periode payroll mengurangi penghasilan proporsional sesuai konfigurasi perusahaan dan tampil sebagai baris tersendiri di slip; (4) sisa cuti tahunan terlihat oleh karyawan & atasan.

## 6D. Payroll & Penggajian — Status: SEBAGIAN (inti bulanan berfungsi, komponen & variasi belum)

### Bagaimana komponen didefinisikan saat ini

Mesin payroll **tidak mengenal komponen bernama**. Per karyawan hanya ada tiga angka di master: `baseSalary`, `allowances` (satu nominal gabungan untuk semua tunjangan), `deductions` (satu nominal gabungan untuk semua potongan tetap). Saat run, angka itu disalin apa adanya ke `payroll_items` (snapshot — perubahan master berikutnya tidak mengubah run lama). Bruto = pokok + allowances; bersih = bruto − deductions − potongan kasbon. Tidak ada definisi komponen per perusahaan, tidak ada tipe komponen (tetap/tidak tetap), tidak ada formula, tidak ada penanda kena-pajak/dasar-BPJS per komponen.

| Kebutuhan §6D | Status | Bukti / catatan |
|---|---|---|
| Gaji pokok | BERFUNGSI | `employees.baseSalary`, disnapshot ke `payroll_items.baseSalary`. |
| Tunjangan tetap / tidak tetap | SEBAGIAN | Hanya satu angka `allowances` gabungan; tetap vs tidak tetap tidak dibedakan (padahal dasar THR, lembur, dan BPJS Kesehatan hanya mengakui tunjangan **tetap**). |
| Uang makan, transportasi, komisi, bonus, insentif | BELUM ADA | Tidak ada komponen terpisah; hanya bisa digabung manual ke `allowances` sebelum run — tanpa jejak per komponen di slip/item. |
| Lembur sebagai komponen payroll | BELUM ADA | Tidak ada data lembur dan tidak ada perhitungan pengali. |
| THR | BELUM ADA | Tidak ada modul/perhitungan THR. |
| Potongan PPh 21 | BELUM ADA (sebagai perhitungan) | Hanya bisa dimasukkan manual ke angka `deductions` gabungan; mesin tidak menghitung. |
| Potongan BPJS karyawan | BELUM ADA (sebagai perhitungan) | Sama — manual gabungan. Jurnal memang mengkredit potongan ke akun utang potongan (`salary_deductions_payable` opsional, fallback `salary_payable`) sebagai **satu baris gabungan**, jadi utang PPh dan utang BPJS tidak terpisah di buku besar. |
| Potongan kasbon | BERFUNGSI | Lihat 6F. Terpisah eksplisit di `payroll_items.advanceDeduction` dan jurnal mengkredit Piutang Karyawan. |
| Cicilan pinjaman | BELUM ADA | Tidak ada modul pinjaman (lihat 6F). |
| Potongan ketidakhadiran | BELUM ADA | Tidak ada data absensi. |
| Penggajian bulanan | BERFUNGSI | `runPayrollAction`, periode `YYYY-MM` (regex ketat), jurnal diposting bertanggal `${period}-28` dengan `assertPeriodOpen`. |
| Penggajian mingguan | BELUM ADA | Format periode hanya bulanan. |
| Payroll massal | BERFUNGSI | Satu run memproses **semua** karyawan aktif sekaligus. Konsekuensinya: tidak bisa memproses subset/departemen terpisah dalam periode yang sama. |
| Gaji karyawan baru | SEBAGIAN | Karyawan aktif langsung masuk run **sebulan penuh** — tidak ada prorata berdasarkan `joinedAt` di tengah periode. |
| Karyawan resign pertengahan bulan | BELUM ADA | Menonaktifkan karyawan mengeluarkannya dari run berikutnya; tidak ada perhitungan gaji final proporsional. |
| Perubahan gaji di tengah periode | SEBAGIAN | Run memakai nilai master saat run dieksekusi; tidak ada konsep tanggal efektif — mengubah master sebelum run mengubah seluruh periode secara retroaktif. |
| Absensi/cuti/lembur memengaruhi gaji | BELUM ADA | Tidak ada sumber datanya (6B/6C). |
| Pembayaran gaji penuh | BERFUNGSI | `payPayrollAction`: Dr Utang gaji / Cr kas-bank sebesar `totalNet` run, status posted → paid. |
| Pembayaran gaji sebagian | BELUM ADA | Pembayaran selalu seluruh `totalNet` satu run dalam satu jurnal; tidak bisa per karyawan/per kelompok. Utang potongan (`totalDeductions`) **tidak** dilunasi oleh aksi ini — penyelesaiannya di luar payroll (jurnal manual), tidak ada aksi bayar utang potongan/PPh/BPJS. |
| Koreksi payroll | BERFUNGSI | `voidPayrollRunAction` (hanya status posted, alasan wajib) membalik jurnal, memulihkan potongan kasbon (`restorePayrollAdvanceDeductions`), lalu periode boleh diproses ulang. Run berstatus paid **tidak bisa** di-void. |
| Penggajian ulang | BERFUNGSI | Void → run ulang periode sama; dijamin indeks unik parsial (di bawah). |
| Slip gaji | BELUM ADA (sebagai dokumen) | Halaman detail run menampilkan rincian per karyawan di layar; tidak ada slip per karyawan yang dapat dicetak/diunduh lewat Print Engine, dan karyawan tidak punya akses melihat slipnya sendiri. |
| Histori penggajian | BERFUNGSI | Daftar run + `payroll_items` tersimpan permanen; run void tetap terlihat. |
| Export pembayaran bank | BELUM ADA | Tidak ada berkas instruksi transfer massal (CSV/format bank). |
| Penjaga periode ganda | BERFUNGSI (kuat) | Tiga lapis: cek aplikasi → CONFLICT; indeks unik parsial `payroll_runs_company_period_uq` pada `(company_id, period) WHERE status <> 'void'` (migrasi 0019, AK-P3-03); pelanggaran unik diterjemahkan menjadi CONFLICT yang sama. Koreksi sah lewat void tidak terhalang. |
| Jurnal payroll | BERFUNGSI | Dr Beban gaji **bruto** / Cr Utang gaji bersih / Cr Utang potongan / Cr Piutang Karyawan (kasbon) — diperbaiki di AK-P1-03 agar beban tidak lagi dicatat sebesar nilai bersih. Pemetaan: `salary_expense` (6000), `salary_payable` (2100), opsional `salary_deductions_payable`, `employee_receivable` (1220). |

**Requirement (6D yang belum ada):** katalog komponen payroll per perusahaan (lihat rancangan Bagian 3); prorata masuk/resign; run per kelompok karyawan; slip gaji tercetak per karyawan; ekspor pembayaran bank; aksi pelunasan utang potongan (PPh/BPJS) dari payroll.
**Acceptance criteria:** (1) setiap angka di slip dapat ditelusur ke komponen + masukan periode (lembur, cuti, kasbon) yang menyusunnya; (2) karyawan yang masuk tanggal 15 dibayar proporsional menurut konfigurasi hari dasar perusahaan; (3) ekspor bank untuk run paid menghasilkan satu baris per karyawan dengan total sama persis dengan `totalNet` run dikurangi yang sudah dibayar.

## 6E. Payroll Indonesia — Status: BELUM ADA (seluruhnya)

Tidak ada PPh 21 TER/Pasal 17, PTKP, BPJS Kesehatan, BPJS Ketenagakerjaan (JHT/JKK/JKM/JP/JKP), THR, perhitungan lembur, maupun pemeriksaan upah minimum di kode. Seluruhnya saat ini hanya dapat diakomodasi sebagai angka manual pada `deductions`/`allowances` gabungan — tanpa validasi regulasi apa pun. Lembar fakta regulasi ada di Bagian 2; rancangan engine yang dapat dikonfigurasi (tanpa tarif hardcode) ada di Bagian 3.

**Requirement ringkas:** engine perhitungan statutory Indonesia yang seluruh tarif/batas/kategorinya tersimpan sebagai konfigurasi bertanggal efektif (Bagian 3), mencakup: PPh 21 TER bulanan + perhitungan ulang masa pajak terakhir (Pasal 17); iuran BPJS Kesehatan & Ketenagakerjaan dua sisi (pekerja & perusahaan, perusahaan menjadi beban terpisah dan — untuk JKK/JKM/JKN porsi perusahaan — menambah penghasilan bruto pajak sesuai aturan); THR tahunan prorata; lembur berpengali resmi; pemeriksaan upah minimum per wilayah kerja karyawan.
**Acceptance criteria:** seluruh test case Bagian 3 lulus; mengganti tarif pada konfigurasi bertanggal efektif mengubah hasil periode berikutnya tanpa mengubah satu baris kode dan tanpa mengubah hasil periode yang sudah posted.

## 6F. Employee Advance & Reimbursement — Status: SEBAGIAN (kasbon kuat; sisanya belum)

| Kebutuhan §6F | Status | Bukti / catatan |
|---|---|---|
| Kasbon karyawan | BERFUNGSI | `employee_advances` + `employee_advance_entries` (schema.ts:1285-1338); `createEmployeeAdvance` memposting Dr Piutang Karyawan (akun 1220 via pemetaan `employee_receivable`) / Cr akun kas/bank sumber. **Kasbon dicatat sebagai aset piutang, bukan beban** — sesuai mandat §6F. |
| Rencana potongan kasbon fleksibel | BERFUNGSI | `planMode`: `full` (potong penuh gaji berikut), `fixed` (cicilan nominal), `percent` (persen dari gaji pokok) — keputusan D-22. |
| Potongan kasbon dari gaji | BERFUNGSI | Usulan otomatis per rencana saat run, dibatasi sisa kasbon & gaji bersih (tidak pernah negatif), override manual tervalidasi server, alokasi FIFO ke kasbon tertua, entri tertelusur ke run & jurnal; void payroll memulihkan saldo (`employee-advances.ts:195-428`). |
| Pelunasan kasbon di luar payroll | BERFUNGSI | `recordAdvanceRepayment` — setoran tunai karyawan mengurangi piutang. |
| Pembatalan kasbon | BERFUNGSI | `voidEmployeeAdvance` dengan jurnal balik. |
| Persetujuan atasan untuk kasbon | BELUM ADA | Kasbon langsung terposting oleh pemegang `payroll.manage`; tidak ada alur pengajuan → setuju/tolak. |
| Pinjaman karyawan (terpisah dari kasbon) | BELUM ADA | Tidak ada pinjaman berjadwal amortisasi, plafon, atau bunga (kasbon `fixed` meniru cicilan tetapi bukan produk pinjaman: tanpa jadwal jatuh tempo per cicilan & tanpa status keterlambatan). |
| Uang muka perjalanan dinas | SEBAGIAN | Mekanik piutang karyawan kasbon dapat dipakai, tetapi tidak ada kategori keperluan, batas waktu pertanggungjawaban, atau penyelesaian dengan realisasi biaya (kelebihan/kekurangan uang muka). |
| Reimbursement (klaim biaya) | BELUM ADA | Tidak ada klaim karyawan dengan lampiran bukti, persetujuan, dan pembayaran. Biaya perusahaan saat ini dicatat langsung lewat modul Beban oleh akuntansi — bukan klaim dari karyawan. |
| Lampiran bukti pembayaran | BELUM ADA | Tidak ada unggahan lampiran pada kasbon maupun beban karyawan. |

**Requirement:** workflow pengajuan & persetujuan untuk kasbon di atas ambang terkonfigurasi; modul pinjaman dengan jadwal cicilan; uang muka dinas dengan pertanggungjawaban; reimbursement dengan lampiran, persetujuan atasan, dan jurnal Dr Beban / Cr Utang karyawan → pembayaran Cr Kas.
**Acceptance criteria:** (1) reimbursement yang disetujui tidak menggandakan beban bila dokumen sumber yang sama diajukan dua kali; (2) uang muka dinas yang belum dipertanggungjawabkan melewati tenggat muncul sebagai pengingat dan menghalangi uang muka baru (konfigurasi); (3) setiap persetujuan mencatat penyetuju, waktu, dan nilai yang disetujui (boleh berbeda dari yang diajukan, dengan selisih tercatat).

## 6G. Employee Termination — Status: BELUM ADA (sebagai proses)

Satu-satunya mekanisme adalah `isActive = false`, yang mengeluarkan karyawan dari run berikutnya. Dampak positif yang sudah benar: histori payroll karyawan tidak ikut terhapus (`payroll_items` permanen) dan kasbon yang masih terbuka tetap tercatat — tetapi juga tidak ada yang memaksa penyelesaiannya.

| Kebutuhan §6G | Status | Catatan |
|---|---|---|
| Jenis keluar (resign, PHK, kontrak berakhir) | BELUM ADA | Tidak ada tanggal/jenis/alsan keluar. |
| Final salary (gaji proporsional hari kerja terakhir) | BELUM ADA | — |
| Hak yang masih dibayar (sisa cuti, THR prorata, kompensasi PKWT, pesangon/UPMK per PP 35/2021) | BELUM ADA | Tidak ada perhitungan komponen akhir. |
| Penyelesaian kasbon saat keluar | BELUM ADA | Kasbon terbuka tidak diperiksa/dipotong dari pembayaran akhir secara otomatis. |
| Status akses sistem | BELUM ADA (hubungan) | Master `employees` **tidak terhubung** ke akun login pengguna (`member`/Better Auth). Menonaktifkan karyawan tidak menonaktifkan akses login orang yang sama bila ia juga pengguna sistem — harus dilakukan terpisah di manajemen pengguna. |
| Arsip dokumen & histori | SEBAGIAN | Histori payroll & kasbon abadi; dokumen kontrak memang belum ada (6A). |

**Requirement:** proses terminasi berpanduan — tanggal & jenis keluar, perhitungan pembayaran akhir (gaji prorata, THR prorata bila memenuhi syarat, kompensasi akhir PKWT, pesangon sesuai konfigurasi & PP 35/2021), pemotongan kasbon/pinjaman dari pembayaran akhir dengan persetujuan tercatat, penonaktifan akun login tertaut, dan status karyawan menjadi `terminated` (bukan hilang).
**Acceptance criteria:** (1) terminasi dengan kasbon terbuka tidak dapat difinalkan sebelum kasbon diselesaikan atau dipotong dari pembayaran akhir; (2) pembayaran akhir terposting sebagai run khusus tertelusur dan tidak membuka kembali periode yang sudah ada run aktifnya secara diam-diam; (3) karyawan terminated tidak muncul di run reguler berikutnya tetapi seluruh histori tetap dapat dibuka.

---

# Bagian 2 — Lembar Fakta Regulasi Indonesia

Tanggal riset: 4 November 2026. Setiap angka mencantumkan nilai, tanggal berlaku, dasar hukum, dan sumber. Angka yang hanya ditemukan di sumber sekunder yang mereproduksi teks peraturan ditandai tingkat keyakinannya; angka yang tidak berhasil diverifikasi ditandai eksplisit **tidak terverifikasi** dan tidak boleh dipakai sebagai dasar perhitungan produksi sebelum dicek ke dokumen resmi.

## 2.1 PPh Pasal 21 — Metode TER

| Item | Nilai / aturan | Berlaku | Dasar hukum | Sumber |
|---|---|---|---|---|
| Skema TER | Pemotongan bulanan pegawai tetap = **tarif efektif × penghasilan bruto sebulan** (Jan–Nov / selain masa pajak terakhir). TER menggantikan hitungan manual disetahunkan untuk masa berjalan; tarif Pasal 17 tetap menjadi dasar pajak setahun. | 1 Jan 2024 – sekarang | PP 58/2023; PMK 168/2023 | PMK 168/2023 (PDF resmi DJP): https://pajak.go.id/sites/default/files/2024-02/PMK%20168%20Tahun%202023%20Tentang%20PPh%20Pasal%2021%20TER.pdf |
| Kategori TER | **A** = TK/0, TK/1, K/0 · **B** = TK/2, TK/3, K/1, K/2 · **C** = K/3. Kategori ditentukan dari status PTKP **pada awal tahun pajak**. | 1 Jan 2024 | PP 58/2023 Pasal 2; Lampiran PMK 168/2023 | PDF DJP di atas; reproduksi tabel: https://www.online-pajak.com/tentang-pph21/tarif-ter-pph-21/ |
| Lapisan TER A (cuplikan terverifikasi dari Lampiran PP 58/2023) | bruto ≤ Rp5.400.000 → **0%**; 5.400.001–5.650.000 → 0,25%; 5.650.001–5.950.000 → 0,50%; 5.950.001–6.300.000 → 0,75%; 6.300.001–6.750.000 → 1,00%; 6.750.001–7.500.000 → 1,25%; 7.500.001–8.550.000 → 1,50%; 8.550.001–9.650.000 → 1,75%; 9.650.001–10.050.000 → 2,00%; 10.050.001–10.350.000 → 2,25%; 10.350.001–10.700.000 → 2,50%; tarif tertinggi 34% untuk bruto di atas ± Rp1,4 miliar/bulan. Total 44 lapisan. | 1 Jan 2024 | Lampiran PP 58/2023 | Reproduksi lampiran: https://www.online-pajak.com/tentang-pph21/tarif-ter-pph-21/ dan https://gajihub.com/blog/tarif-ter-pph-21-dan-contohnya/ |
| Ambang 0% TER B & C | B: 0% sampai bruto Rp6.200.000 (40 lapisan). C: 0% sampai bruto Rp6.600.000 (41 lapisan). Lapisan lengkap B & C harus dimuat dari Lampiran PP 58/2023 saat implementasi — cuplikan lengkapnya **tidak terverifikasi** baris demi baris dalam riset ini. | 1 Jan 2024 | Lampiran PP 58/2023 | https://www.online-pajak.com/tentang-pph21/tarif-ter-pph-21/ |
| Masa pajak terakhir (Desember / berhenti bekerja) | Pajak setahun dihitung ulang dengan **tarif Pasal 17** atas PKP setahun: bruto setahun − biaya jabatan − iuran yang dibayar pegawai (JHT/JP) − PTKP; hasil dikurangi PPh 21 yang sudah dipotong masa sebelumnya; selisih dipotong/dikembalikan di masa terakhir. | 1 Jan 2024 | PMK 168/2023 (ketentuan masa pajak terakhir); UU PPh Pasal 17 | PDF DJP di atas |
| Tarif Pasal 17 (orang pribadi) | PKP ≤ Rp60 jt → 5%; >60–250 jt → 15%; >250–500 jt → 25%; >500 jt–5 M → 30%; >5 M → 35%. PKP dibulatkan ke bawah ke ribuan terdekat. | 1 Jan 2022 (UU HPP) – sekarang | UU 7/2021 (HPP) mengubah UU PPh Pasal 17 | Teks UU PPh sebagaimana diubah UU HPP (JDIH Kemenkeu) |
| Biaya jabatan | 5% dari bruto, **maksimal Rp500.000/bulan atau Rp6.000.000/tahun**; pengurang hanya pada perhitungan tahunan/masa terakhir (sudah tercermin di dalam tarif TER untuk masa berjalan). | Berlaku lama, ditegaskan PMK 168/2023 | PMK 168/2023 & ketentuan biaya jabatan | PDF DJP di atas |
| Tanpa NPWP | Tarif pemotongan **20% lebih tinggi** dari tarif normal. | Lama | UU PPh Pasal 21 ayat (5a) | Teks UU PPh (JDIH Kemenkeu) |
| TER harian | Ada tarif efektif harian untuk pegawai tidak tetap dalam PP 58/2023. **Rincian lapisannya tidak terverifikasi dalam riset ini** — wajib dimuat dari lampiran resmi sebelum engine mendukung pegawai harian. | 1 Jan 2024 | PP 58/2023 | PDF DJP di atas |
| Insentif berkala | Kebijakan PPh 21 Ditanggung Pemerintah (DTP) untuk sektor/kriteria tertentu pernah berlaku per tahun anggaran (mis. 2025). **Status & cakupan untuk 2026 tidak terverifikasi** dalam riset ini — engine harus memperlakukannya sebagai konfigurasi opsional per periode, bukan asumsi permanen. | Berkala | PMK insentif tahunan (berubah-ubah) | — |

### PTKP (PMK 101/PMK.010/2016 — berlaku sejak 2016, tidak berubah sampai riset ini)

| Status | PTKP setahun | Kategori TER |
|---|---|---|
| TK/0 | Rp54.000.000 | A |
| TK/1 | Rp58.500.000 | A |
| K/0 | Rp58.500.000 | A |
| TK/2 | Rp63.000.000 | B |
| K/1 | Rp63.000.000 | B |
| TK/3 | Rp67.500.000 | B |
| K/2 | Rp67.500.000 | B |
| K/3 | Rp72.000.000 | C |

Komposisi: wajib pajak sendiri Rp54.000.000 + Rp4.500.000 status kawin + Rp4.500.000 per tanggungan (maksimal 3). Sumber: PMK 101/PMK.010/2016; konsistensi kategori: Lampiran PMK 168/2023 (PDF DJP di atas).

Catatan bruto pajak: penghasilan bruto untuk PPh 21 mencakup gaji, tunjangan, lembur, bonus, THR, **dan premi/iuran yang dibayar pemberi kerja untuk pegawai (JKK, JKM, dan porsi perusahaan BPJS Kesehatan)**; iuran JHT/JP porsi perusahaan bukan objek tambahan bruto, sedangkan porsi pegawai JHT/JP adalah pengurang pada perhitungan tahunan.

## 2.2 BPJS Kesehatan (JKN — Pekerja Penerima Upah)

| Item | Nilai | Berlaku | Dasar hukum | Sumber |
|---|---|---|---|---|
| Total iuran PPU | **5%** dari upah sebulan | 2020 – sekarang | Perpres 64/2020 Pasal 30 (mengubah Perpres 82/2018) | https://www.gadjian.com/blog/2024/04/26/iuran-bpjs-kesehatan-karyawan/ |
| Porsi pemberi kerja | **4%** | idem | idem | idem |
| Porsi pekerja (potong gaji) | **1%** | idem | idem | idem |
| Dasar upah | Gaji pokok + tunjangan tetap | idem | Perpres 82/2018 jo. 64/2020 | idem |
| Batas atas dasar upah | **Rp12.000.000/bulan** | 2020 – sekarang (Pasal 32 ayat (1); tidak diubah Perpres 59/2024) | Perpres 64/2020 Pasal 32 ayat (1) | https://calcuid.com/bpjs-kesehatan/kalkulator-iuran/ (mereproduksi pasal; verifikasi silang tiga sumber sekunder konsisten) |
| Batas bawah dasar upah | Upah minimum yang berlaku (acuan diubah Perpres 59/2024 dari UMK menjadi UMP) | 2024 – sekarang | Perpres 59/2024 Pasal 32 ayat (2)–(4) | idem — rincian ayat perlu verifikasi dokumen resmi saat implementasi |
| Perubahan tarif oleh KRIS | Perpres 59/2024 memperkenalkan Kelas Rawat Inap Standar; **persentase iuran PPU tidak berubah** sampai riset ini. | 2024 | Perpres 59/2024 | https://nusawork.com/blog/cara-menghitung-iuran-bpjs-kesehatan-karyawan/ |

## 2.3 BPJS Ketenagakerjaan (Penerima Upah)

| Program | Total | Pekerja | Perusahaan | Dasar upah & batas | Dasar hukum |
|---|---|---|---|---|---|
| JHT (Jaminan Hari Tua) | 5,7% | **2%** | **3,7%** | Upah sebulan; tanpa batas atas | PP 46/2015 Pasal 16 |
| JKK (Jaminan Kecelakaan Kerja) | 0,24% / 0,54% / 0,89% / 1,27% / 1,74% menurut kelas risiko (sangat rendah → sangat tinggi) | 0% | **100%** | Upah sebulan; tanpa batas atas | PP 44/2015 Pasal 16 |
| JKM (Jaminan Kematian) | 0,30% | 0% | **100%** | Upah sebulan; tanpa batas atas | PP 44/2015 Pasal 18 |
| JP (Jaminan Pensiun) | 3% | **1%** | **2%** | Upah sebulan dengan **batas atas yang disesuaikan setiap tahun** (mekanisme: × (1 + pertumbuhan PDB tahun sebelumnya), diumumkan BPJS paling lambat 1 bulan setelah BPS merilis PDB — PP 45/2015 Pasal 29) | PP 45/2015 Pasal 28–29 |
| JKP (Jaminan Kehilangan Pekerjaan) | **0,36%** (tarif berlaku sejak PP 6/2025) | 0% | 0% langsung — dibiayai 0,22% Pemerintah Pusat + 0,14% rekomposisi iuran JKK | Batas atas dasar upah **Rp5.000.000** | PP 37/2021 Pasal 11 sebagaimana diubah PP 6/2025 (7 Feb 2025) |

Sumber gabungan: https://karirpintar.com/artikel/potongan-gaji-bpjs (mengutip pasal per program) dan https://www.online-pajak.com/tentang-pph21/bpjs-ketenagakerjaan/.

**Batas atas upah JP per tahun (angka bergerak — contoh kenapa harus konfigurasi):**
- Efektif Maret 2025: **Rp10.547.400** (dikutip luas, termasuk Online-Pajak per Sep 2026).
- Efektif Maret 2026: **Rp11.086.300** — dikutip dari surat BPJS Ketenagakerjaan No. B/1226/022026 oleh sumber sekunder; **terverifikasi sebagian** — wajib dikonfirmasi ke pengumuman resmi BPJS Ketenagakerjaan sebelum dipakai produksi.
- Catatan perubahan: tarif JKP lama 0,46% (termasuk rekomposisi 0,10% dari JKM) **sudah tidak berlaku** sejak PP 6/2025; banyak halaman lama masih menampilkan 0,46% — engine harus memakai 0,36% untuk periode ≥ Feb 2025 dan menyimpan riwayat tarif bertanggal.

## 2.4 THR Keagamaan

| Item | Nilai / aturan | Dasar hukum | Sumber |
|---|---|---|---|
| Hak | Pekerja dengan masa kerja **≥ 1 bulan** terus-menerus, PKWT maupun PKWTT | Permenaker 6/2016 Pasal 2 | https://prd.wageindicator.org/id-id/bekerja-di-indonesia/hukum-tenaga-kerja/pengupahan/seputar-thr (mereproduksi teks Permenaker) |
| Masa kerja ≥ 12 bulan | **1 bulan upah** | Permenaker 6/2016 Pasal 3 ayat (1) | idem |
| Masa kerja 1 – <12 bulan | **Prorata: (masa kerja ÷ 12) × 1 bulan upah** | Permenaker 6/2016 Pasal 3 ayat (1) | idem |
| Definisi upah 1 bulan | Upah pokok + tunjangan tetap (atau upah bersih bila tanpa tunjangan); pekerja harian: rata-rata upah 12 bulan terakhir (masa kerja ≥12 bln) atau rata-rata per bulan selama masa kerja (<12 bln) | Permenaker 6/2016 Pasal 3 ayat (2)–(3) | idem |
| Batas pembayaran | Paling lambat **7 hari sebelum** hari raya keagamaan pekerja | Permenaker 6/2016 Pasal 5 | idem |
| Penegasan tahunan | Pelaksanaan THR ditegaskan tiap tahun lewat Surat Edaran Menaker (untuk 2026: SE M/3/HK.04.00/III/2026) — besaran rumus tidak berubah | SE Menaker tahunan | https://tools.satutim.id/kalkulator-thr (menyebut nomor SE 2026; nomor SE **terverifikasi sebagian**) |

## 2.5 Lembur

Dasar hukum: UU 13/2003 Pasal 78 sebagaimana diubah UU 6/2023; PP 35/2021 Pasal 26–33 (Pasal 31 pengali, Pasal 32 upah sejam); Kepmenakertrans 102/MEN/VI/2004 dicabut Permenaker 23/2021 dan materinya hidup di PP 35/2021.

| Item | Nilai |
|---|---|
| Upah sejam | **1/173 × upah sebulan** (upah pokok + tunjangan tetap) — PP 35/2021 Pasal 32 |
| Batas lembur | Maksimal **4 jam/hari dan 18 jam/minggu** (di luar lembur hari istirahat/libur resmi); perlu perintah tertulis & persetujuan pekerja |
| Hari kerja biasa | Jam ke-1: **1,5×** upah sejam; jam berikutnya: **2×** |
| Hari istirahat/libur resmi — pola 5 hari kerja | Jam 1–8: 2×; jam ke-9: 3×; jam 10–12: 4× |
| Hari istirahat/libur resmi — pola 6 hari kerja | Jam 1–7: 2×; jam ke-8: 3×; jam 9–11: 4× |
| Libur resmi jatuh pada hari kerja terpendek (pola 6 hari) | Jam 1–5: 2×; jam ke-6: 3×; jam 7–9: 4× |

Sumber: https://www.gadjian.com/blog/2022/10/04/rumus-perhitungan-lembur-excel/ dan https://blog.payrollbozz.com/2025/05/09/cara-menghitung-uang-lembur-karyawan-sesuai-dengan-undang-undang-ketenagakerjaan-terbaru/ (keduanya mengutip Pasal 31–32 PP 35/2021 secara konsisten).

## 2.6 Upah Minimum — Kesimpulan: Konfigurasi per Wilayah & Tahun

Tidak ada satu angka nasional. UMP ditetapkan Gubernur tiap provinsi (dan UMK per kabupaten/kota) setiap tahun berdasarkan PP Pengupahan (PP 36/2021 sebagaimana diubah terakhir oleh **PP 49/2025**, berlaku 17 Des 2025; formula: inflasi + pertumbuhan ekonomi × alfa). Contoh terverifikasi untuk 2026 (berlaku 1 Jan 2026): **UMP DKI Jakarta Rp5.729.876** (Kepgub DKI 1142/2025) sedangkan **UMP Jawa Barat Rp2.317.601** — selisih ±2,5 kali lipat antarprovinsi membuktikan upah minimum wajib menjadi data konfigurasi per wilayah kerja + tahun + nomor SK, bukan konstanta. Sumber: https://gajihub.com/blog/ump-jakarta/ dan https://www.fortuneidn.com/news/daftar-ump-2026-lengkap-38-provinsi-d7w03-00-dz73p-h06j9m.

---

# Bagian 3 — Rancangan Engine Payroll Indonesia (untuk Fase S2)

## 3.1 Prinsip

1. **Nol tarif di kode.** Setiap tarif, batas, kategori, dan pengali adalah baris data bertanggal efektif (`effective_from` / `effective_to`). Mengubah regulasi = menambah baris konfigurasi, bukan mengubah kode.
2. **Snapshot saat posting.** Run menyalin hasil perhitungan per komponen ke `payroll_item_lines`; perubahan konfigurasi sesudahnya tidak pernah mengubah run yang sudah posted (konsisten dengan pola snapshot `payroll_items` saat ini dan jurnal append-only).
3. **Komponen dulu, statutory kemudian.** Engine menghitung dari katalog komponen perusahaan; modul statutory (PPh/BPJS/THR/lembur) adalah penghitung khusus yang membaca konfigurasi regulasi, bukan angka yang diketik pengguna.
4. **Satu jalur jurnal.** Hasil engine tetap diposting lewat `runPayrollAction`/`postJournal` yang ada, dengan baris kredit dipecah per kelompok utang (utang gaji bersih, utang PPh 21, utang BPJS per program, potongan kasbon) memakai kunci pemetaan akun yang dapat diperluas.

## 3.2 Struktur konfigurasi yang diusulkan

**Master karyawan (perluasan `employees` / tabel pendamping):**
- `nik`, `npwp`, `ptkp_status` (FK ke tabel status PTKP), `birth_date`, `gender`, `department_id`, `branch_id`, `manager_employee_id`, `contract_type` (`pkwt|pkwtt|harian|magang`), `contract_start`, `contract_end`, `bank_name`, `bank_account_number`, `bpjs_kes_number`, `bpjs_tk_number`, `jkk_risk_class`, `work_region_id` (untuk upah minimum), `employment_status` (`active|on_leave|terminated`), `termination_date`, `termination_kind`.
- Tabel riwayat efektif: `employee_history` (`employee_id`, `field_group` ∈ jabatan/gaji/lokasi/status, `payload` jsonb nilai baru, `effective_date`, `created_by`) — perubahan master selalu menambah baris riwayat.

**Katalog komponen (per perusahaan):**
- `payroll_components`: `code`, `name`, `kind` (`earning|deduction`), `calc_type` (`fixed|percent_of_base|formula_overtime|statutory|manual`), `is_fixed_allowance` (penanda tunjangan tetap — penentu dasar THR/lembur/BPJS Kesehatan), `adds_to_tax_gross` (boolean), `counts_in_bpjs_wage_base` (boolean), `account_id` (akun beban/utang), `is_active`.
- `employee_components`: `employee_id`, `component_id`, `amount` atau `rate`, `effective_from/to` — menggantikan tiga angka gabungan `allowances`/`deductions` (migrasi: dua komponen bawaan "Tunjangan" & "Potongan tetap" agar data lama setara).

**Konfigurasi regulasi (global per yurisdiksi, dapat ditimpa per perusahaan bila perlu):**
- `statutory_ptkp_statuses`: `code` (TK/0…K/3), `annual_amount`, `ter_category` (A/B/C), `effective_from/to`.
- `statutory_ter_brackets`: `category`, `lower_bound`, `upper_bound` (null = tak terbatas), `rate`, `effective_from/to`. Dimuat dari Lampiran PP 58/2023 (44/40/41 lapisan).
- `statutory_tax_brackets` (Pasal 17): `lower_bound`, `upper_bound`, `rate`, `effective_from/to`.
- `statutory_parameters`: kunci-nilai bertanggal, mis. `biaya_jabatan_rate=5%`, `biaya_jabatan_cap_year=6000000`, `non_npwp_surcharge=20%`.
- `statutory_contributions`: `program` (`bpjs_kes|jht|jkk|jkm|jp|jkp`), `risk_class` (khusus JKK, nullable), `employer_rate`, `employee_rate`, `wage_cap` (nullable), `wage_floor_source` (`none|regional_minimum`), `funding_note` (untuk JKP: pemerintah + rekomposisi), `effective_from/to`.
- `regional_minimum_wages`: `region_code`, `region_name`, `level` (`provinsi|kabupaten`), `year`, `amount`, `decree_ref` (nomor SK Gubernur).
- `overtime_rules`: `day_type` (`workday|rest_5day|rest_6day|shortest_day_6day`), `hour_from`, `hour_to`, `multiplier`, `effective_from/to`; parameter `hourly_divisor=173`, batas `max_hours_day=4`, `max_hours_week=18`.

**Hasil perhitungan:** `payroll_item_lines` (`run_id`, `employee_id`, `component_code`, `category` (`earning|statutory_employee|statutory_employer|deduction`), `amount`, `basis_snapshot` jsonb berisi masukan perhitungan — bruto, tarif, batas, kategori TER — agar setiap angka dapat diaudit ulang).

## 3.3 Urutan perhitungan per karyawan per periode

1. Pendapatan dari komponen (tetap + tidak tetap + lembur dari `overtime_rules` + THR bila periode pembayaran THR).
2. Iuran perusahaan yang menjadi objek pajak (JKK, JKM, porsi perusahaan BPJS Kesehatan) ditambahkan ke penghasilan bruto pajak.
3. **PPh 21:** bila masa pajak terakhir → hitungan tahunan Pasal 17 (bruto setahun − biaya jabatan − iuran pegawai JHT/JP − PTKP, tarif progresif, dikurangi potongan masa sebelumnya); selain itu TER bulanan menurut kategori & bruto bulan ini.
4. Iuran pegawai: BPJS Kesehatan 1%, JHT 2%, JP 1% (masing-masing dari dasar upah berbatas sesuai konfigurasi) — tidak mengurangi bruto TER bulan berjalan, hanya mengurangi neto (dan menjadi pengurang pada hitungan tahunan).
5. Potongan lain: kasbon/pinjaman (di luar pajak — tidak mengurangi bruto), potongan ketidakhadiran, dll.
6. Neto = bruto − seluruh potongan; penjaga: neto tidak negatif (pola yang sudah ada dipertahankan).
7. Beban perusahaan (di luar neto karyawan): porsi perusahaan semua program BPJS menjadi beban + utang per program.

## 3.4 Test case validasi engine (input → hasil menurut Bagian 2)

| ID | Skenario | Input | Hasil yang diharapkan |
|---|---|---|---|
| TC-01 | TER 0% | Pegawai tetap TK/0 (kategori A), bruto Rp5.000.000/bln, masa pajak Maret | PPh 21 = **Rp0** (lapisan A ≤5,4 jt = 0%) |
| TC-02 | TER A lapisan 2% | TK/0, bruto Rp10.000.000/bln, masa pajak Maret | Tarif lapisan 9.650.001–10.050.000 = 2% → PPh 21 = **Rp200.000** |
| TC-03 | TER B 0% | K/1 (kategori B), bruto Rp6.000.000/bln | PPh 21 = **Rp0** (B 0% s.d. 6,2 jt) |
| TC-04 | TER C 0% | K/3 (kategori C), bruto Rp6.500.000/bln | PPh 21 = **Rp0** (C 0% s.d. 6,6 jt) |
| TC-05 | Masa pajak terakhir (Desember) | TK/0; bruto tetap Rp10.000.000 × 12 bln; pegawai membayar JHT 2% & JP 1% (dasar di bawah batas JP) | Bruto setahun 120.000.000 − biaya jabatan 6.000.000 (5%, mencapai batas) − JHT 2.400.000 − JP 1.200.000 = neto 110.400.000; PKP = 110.400.000 − 54.000.000 = 56.400.000; PPh setahun = 5% × 56.400.000 = **Rp2.820.000**; sudah dipotong Jan–Nov (TER 2% × 10 jt × 11) = 2.200.000 → **potongan Desember = Rp620.000** |
| TC-06 | BPJS Kesehatan di atas batas | Upah (pokok + tunjangan tetap) Rp16.000.000 | Dasar dibatasi 12.000.000 → perusahaan 4% = **Rp480.000**; pegawai 1% = **Rp120.000**. Pembanding di bawah batas: upah Rp8.000.000 → Rp320.000 / Rp80.000 |
| TC-07 | Paket BPJS TK lengkap | Upah Rp10.000.000; JKK kelas risiko sangat rendah 0,24%; batas JP 2025 tidak terlampaui | JHT: perusahaan **Rp370.000**, pegawai **Rp200.000** · JKK perusahaan **Rp24.000** · JKM perusahaan **Rp30.000** · JP: perusahaan **Rp200.000**, pegawai **Rp100.000** · JKP: dasar dibatasi 5.000.000 → total **Rp18.000** dibiayai pemerintah 0,22% (Rp11.000) + rekomposisi JKK 0,14% (Rp7.000), pegawai Rp0 · Total potongan BPJS-TK dari gaji pegawai = **Rp300.000** |
| TC-08 | Batas atas JP mengikat | Upah Rp15.000.000, konfigurasi batas JP efektif 2025 = Rp10.547.400 | Dasar JP = 10.547.400 → perusahaan 2% = **Rp210.948**; pegawai 1% = **Rp105.474**. (Dengan batas 2026 Rp11.086.300 — angka terverifikasi sebagian — hasilnya Rp221.726 / Rp110.863; test memakai baris konfigurasi bertanggal, jadi mengganti baris mengubah hasil tanpa kode baru.) |
| TC-09 | THR prorata & penuh | Upah sebulan Rp6.000.000 (pokok + tunjangan tetap) | Masa kerja 8 bulan → 8/12 × 6.000.000 = **Rp4.000.000** · masa kerja ≥12 bulan → **Rp6.000.000** · masa kerja 20 hari → **tidak berhak (Rp0)** |
| TC-10 | Lembur | Upah sebulan Rp5.190.000 → upah sejam = 5.190.000 ÷ 173 = **Rp30.000** | (a) Hari kerja, 3 jam: (1,5 + 2 + 2) × 30.000 = **Rp165.000** · (b) Hari libur pola 5 hari kerja, 9 jam: (8×2 + 1×3) × 30.000 = 19 × 30.000 = **Rp570.000** |
| TC-11 | Kasbon bukan pengurang pajak | Bruto Rp10.000.000 (TK/0), potongan kasbon Rp1.000.000 pada bulan yang sama | PPh 21 tetap dihitung dari bruto penuh: 2% × 10.000.000 = **Rp200.000** (kasbon hanya mengurangi neto, bukan bruto) — mengunci perilaku benar fitur A-11 di engine baru |
| TC-12 | Pemeriksaan upah minimum | Karyawan wilayah DKI Jakarta, gaji pokok + tunjangan tetap Rp5.000.000, konfigurasi UMP DKI 2026 = Rp5.729.876 | Engine **menandai pelanggaran** (di bawah UMP) sebagai peringatan yang menghalangi posting tanpa pengakuan eksplisit — bukan menghitung diam-diam. Pembanding wilayah Jawa Barat (UMP Rp2.317.601): gaji yang sama **lolos** — membuktikan konfigurasi per wilayah bekerja |

## 3.5 Catatan implementasi Fase S2

- Muat tabel TER lengkap (A 44, B 40, C 41 lapisan) dari Lampiran PP 58/2023 dan verifikasi silang dengan kalkulator resmi DJP sebelum test case dinyatakan lulus; cuplikan yang terverifikasi pada riset ini hanya lapisan awal kategori A + ambang 0% B/C.
- Batas upah JP dan tarif JKP adalah dua angka yang terbukti berubah antar-tahun (JP: penyesuaian PDB tahunan; JKP: 0,46% → 0,36% oleh PP 6/2025) — keduanya menjadi contoh wajib uji "ganti konfigurasi, bukan ganti kode".
- Angka bertanda "terverifikasi sebagian" di Bagian 2 (batas JP 2026, nomor SE THR 2026, status DTP 2026, lapisan TER harian) harus diverifikasi ke dokumen resmi pada awal Fase S2 sebelum dimuat sebagai konfigurasi bawaan.
