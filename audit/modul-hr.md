# Laporan Audit Modul: HR & Penggajian (Payroll)

- **Kode Modul**: `hr`
- **Prefix Temuan**: `HR-*`
- **Lingkup**: Data Karyawan, Siklus Hidup & Terminasi, Struktur Organisasi (Departemen & Jabatan), Presensi & Shift, Cuti, Lembur (PP 35/2021), THR Keagamaan, Antrean Persetujuan (Approval Queue), Kasbon Karyawan, Pinjaman Lunak, Klaim Reimbursement, dan Engine Payroll Indonesia (PPh 21 TER PMK 168/2023, BPJS TK & BPJS Kesehatan).

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 3.5 | Skema PPh 21 TER dan BPJS komprehensif; terdapat bug perhitungan pecahan jam lembur (*fractional hours*) dan masuknya karyawan baru ke periode gaji sebelum tanggal mulai kerja. |
| **Tampilan Visual (UI)** | 3.0 | Desain kartu karyawan dan ringkasan slip gaji rapi; filter status aktif/terminasi kurang menonjol. |
| **Pengalaman Pengguna (UX)** | 3.0 | Alur pengajuan cuti & lembur terintegrasi ke antrean persetujuan; navigasi URL fisik masih menumpang pada `/app/akuntansi/` menimbulkan inkonsistensi mental model. |
| **Workflow & State Machine** | 3.5 | Alur cuti/lembur (pending → approved/rejected) terlindungi; payroll memiliki status draft → posted → paid yang berurutan. |
| **Integritas Data & Atomisitas**| 2.5 | Entitas `employees` terpisah total dari akun login `user`; terminasi karyawan tidak mematikan akun login eks-karyawan (risiko keamanan kritis). |
| **Laporan & Akurasi Angka** | 3.0 | Engine BPJS dan TER akurat, namun rumus lembur memotong (*truncate*) jam pecahan (misal 1.5 jam dihitung 1 jam). |
| **Performa & Query** | 4.0 | Komputasi payroll berjalan dalam satu transaksi DB dengan bulk insert payroll lines. |
| **Hak Akses & Keamanan** | 3.0 | Izin khusus `payroll.salary` berhasil menyembunyikan angka gaji dari staf HR biasa, namun ketiadaan sinkronisasi akun login menjadi celah besar. |

---

## 2. Rincian Temuan Audit

### HR-001: Karyawan Baru Belum Bekerja Ikut Tergaji pada Periode Sebelumnya (*Premature Payroll Enrollment*)
- **Severity**: **Kritis**
- **Kategori**: Logika Akuntansi Penggajian & Filter Data
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `payroll.ts`)
- **Bukti Kode**:
  - `src/server/actions/hr/payroll.ts:125-130`
- **Deskripsi Masalah**:
  Pada eksekusi pembuatan batch gaji bulanan (`runPayrollAction`), sistem memilih daftar karyawan dengan query:
  ```typescript
  const staff = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)));
  ```
  Sistem **hanya mengecek `isActive = true` tanpa memvalidasi tanggal mulai bekerja (`joinedAt`)**. 
  Sebagai contoh skenario: jika perusahaan memproses gaji periode **November 2026** pada akhir bulan, dan seorang staf baru diinput dengan tanggal bergabung resmi **1 Desember 2026**, staf baru tersebut tetap ditarik ke dalam batch penggajian bulan November dan menerima transfer gaji penuh satu bulan sebelum ia mulai bekerja!
- **Dampak Bisnis**:
  Kerugian finansial langsung bagi perusahaan (kebocoran dana kas gaji); perselisihan pembukuan antara bagian HR dan Akuntansi.
- **Rekomendasi Perbaikan**:
  Filter karyawan wajib menyertakan batas tanggal masuk kerja terhadap akhir periode:
  ```typescript
  const periodEnd = periodEndDate(data.period); // YYYY-MM-DD
  where(
    and(
      eq(employees.companyId, ctx.company.id),
      eq(employees.isActive, true),
      lte(employees.joinedAt, periodEnd),
      or(isNull(employees.terminationDate), gte(employees.terminationDate, periodStartDate(data.period)))
    )
  )
  ```
- **Estimasi Effort**: **S (Small)**

---

### HR-002: Pemotongan Jam Pecahan pada Perhitungan Lembur PP 35/2021 (*Fractional Overtime Truncation*)
- **Severity**: **Tinggi**
- **Kategori**: Akurasi Perhitungan & Kepatuhan Regulasi
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `payroll-indonesia.ts`)
- **Bukti Kode**:
  - `src/lib/payroll/payroll-indonesia.ts:311-316`
- **Deskripsi Masalah**:
  Dalam fungsi kalkulasi upah lembur resmi (`computeOvertimePay`), sistem menggunakan perulangan integer:
  ```typescript
  for (let hour = 1; hour <= entry.hours; hour += 1) {
    const rule = rules.find((candidate) => hour >= candidate.hourFrom && (candidate.hourTo === null || hour <= candidate.hourTo));
    if (rule) total = total.plus(hourlyWage.mul(d(rule.multiplier)));
  }
  ```
  Jika karyawan lembur selama **1.5 jam** (atau 2.5 jam):
  - Pada iterasi `hour = 1`, kondisi `1 <= 1.5` terpenuhi (dihitung 1 jam pertama x 1.5).
  - Pada iterasi berikutnya `hour = 2`, kondisi `2 <= 1.5` menjadi FALSE, dan loop langsung berhenti!
  Sisa 0.5 jam lembur karyawan **hilang begitu saja** tanpa dihitung sama sekali!
- **Dampak Bisnis**:
  Pelanggaran UU Cipta Kerja / PP No. 35 Tahun 2021. Karyawan dirugikan karena upah lemburnya dipotong secara sistemik; potensi tuntutan hukum ketenagakerjaan dan mogok kerja.
- **Rekomendasi Perbaikan**:
  Ubah perulangan menjadi penghitungan segmen jam kontinu atau desimal (misal 1 jam pertama penuh, sisa 0.5 jam dikalikan tarif jam berikutnya secara proporsional).
- **Estimasi Effort**: **M (Medium)**

---

### HR-003: Pemisahan Entitas `employees` dan Akun Login `users` Menciptakan Celah Keamanan Serius
- **Severity**: **Tinggi**
- **Kategori**: Keamanan Sistem & Hak Akses
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari skema database & alur terminasi)
- **Bukti Kode**:
  - `src/db/schema/hr.ts:15-60` (Tabel `employees` tidak memiliki relasi `userId`)
  - `src/server/hr/final-pay.ts:150-180` (`processFinalPay` tidak menyentuh tabel `member` / `user`)
- **Deskripsi Masalah**:
  Entitas data karyawan (`employees`) berdiri sendiri tanpa foreign key atau link ke tabel otentikasi login (`user` / `member`). Ketika HR mengeksekusi terminasi karyawan (pemecatan/pengunduran diri) pada `terminateEmployeeAction` dan `processFinalPay`, sistem hanya memperbarui `employees.employmentStatus = 'terminated'` dan `employees.isActive = false`.
  Akun login email dan password milik eks-karyawan tersebut di tabel `user`/`member` **tetap aktif 100%**. Eks-karyawan masih bisa masuk ke sistem ERP, melihat data finansial, mencuri database kontak pelanggan, atau bahkan melakukan transaksi fraud bila mereka memegang kredensial POS.
- **Dampak Bisnis**:
  Risiko sabotase data, kebocoran rahasia bisnis minimarket, dan pencurian data oleh mantan karyawan yang sakit hati.
- **Rekomendasi Perbaikan**:
  1. Tambahkan kolom `userId: text("user_id").references(() => user.id)` pada tabel `employees`.
  2. Saat alur terminasi karyawan dieksekusi, berikan opsi otomatis atau wajib: *"Nonaktifkan akun login sistem milik karyawan ini secara permanen"*.
- **Estimasi Effort**: **M (Medium)**

---

### HR-004: Anomali URL Fisik Modul HR Menumpang di Segmen Rute Akuntansi
- **Severity**: **Sedang**
- **Kategori**: Arsitektur Routing & UX
- **Tingkat Keyakinan**: **Tinggi**
- **Bukti Kode**:
  - `src/app/app/akuntansi/(hr)/`
  - `src/lib/modules.ts:212` (`href: "/app/akuntansi/hr"`)
- **Deskripsi Masalah**:
  Meskipun secara konseptual dan navigasi sidebar HR telah dipisahkan menjadi modul mandiri sejak migrasi A-24, secara fisik seluruh rute halaman HR masih berada di bawah subdirektori `/app/akuntansi/...` (misal `/app/akuntansi/hr`, `/app/akuntansi/payroll`, `/app/akuntansi/kasbon`).
- **Dampak Bisnis**:
  Inkonsistensi URL menimbulkan kebingungan bagi pengguna (misal staf HR mempertanyakan mengapa URL browser mereka selalu bertuliskan `/akuntansi/`), serta meningkatkan risiko benturan middleware keamanan di masa depan.
- **Rekomendasi Perbaikan**:
  Migrasikan route Next.js ke `/app/hr/*` secara bersih pada refactoring arsitektur berikutnya, dan sediakan redirect 308 dari rute lama.
- **Estimasi Effort**: **M (Medium)**
