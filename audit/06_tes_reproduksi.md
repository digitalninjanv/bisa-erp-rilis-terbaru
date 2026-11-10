# 06. Daftar Tes Reproduksi Bug (Reproduction Test Suite)

Dokumen ini mendokumentasikan suite pengujian reproduksi bug yang telah dibuat di folder `audit/tests/` untuk memverifikasi temuan audit secara empiris tanpa mengubah kode produksi.

---

## 1. Cara Menjalankan Tes Reproduksi Audit

Seluruh tes reproduksi audit dapat dijalankan secara terisolasi menggunakan perintah:
```bash
pnpm vitest run --config audit/tests/vitest.audit.config.mts
```

---

## 2. Daftar Berkas Tes Reproduksi

| Berkas Tes | ID Temuan Terkait | Modul | Status Verifikasi | Ringkasan Pembuktian |
| :--- | :---: | :---: | :---: | :--- |
| `audit/tests/repro-overtime-truncation.test.ts` | **HR-002** | HR / Payroll | **TERBUKTI (Exit 0)** | Membuktikan bahwa lembur 1.5 jam pada fungsi `computeOvertimePay` memotong 0.5 jam (hanya membayar Rp15.000 dari yang seharusnya Rp25.000) akibat perulangan integer `for (let hour = 1; hour <= entry.hours; hour += 1)`. |
| `audit/tests/repro-hr-payroll-filter.test.ts` | **HR-001** | HR / Payroll | **TERBUKTI (Exit 0)** | Membuktikan bahwa query pengambilan karyawan aktif pada `runPayrollAction` tidak membatasi `joinedAt <= periodEnd`, sehingga karyawan baru yang mulai bekerja bulan depan ikut terbayarkan gaji bulan ini. |
| `tests/integration/review-fixes-t4rb.test.ts:252` | **AKN-001** | Akuntansi | **TERBUKTI (Test Fail)** | Gagal pada suite integrasi bawaan proyek: pembuktian empiris bahwa rumus rekonsiliasi bank menghasilkan `unreconciledTotal < 0` (negatif). |

---

## 3. Rincian Log Eksekusi Tes

```text
 RUN  v5.0.5 /home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp

stdout | audit/tests/repro-overtime-truncation.test.ts > Audit Reproduction: HR-002 Pemotongan Jam Pecahan Lembur > membuktikan bahwa lembur 1.5 jam memotong 0.5 jam akibat perulangan integer
Hasil aktual dari fungsi computeOvertimePay: 15000
Hasil yang seharusnya (normatif): 25000

 ✓ audit/tests/repro-overtime-truncation.test.ts (1 test) 6ms

stdout | audit/tests/repro-hr-payroll-filter.test.ts > Audit Reproduction: HR-001 Premature Payroll Enrollment > membuktikan bahwa query karyawan aktif tanpa filter joinedAt akan menyertakan karyawan masa depan
Karyawan yang terproses pada periode Nov 2026 (Aktual): [ 'Budi (Karyawan Lama)', 'Siti (Karyawan Baru Masuk Des)' ]
Karyawan yang seharusnya terproses (Normatif): [ 'Budi (Karyawan Lama)' ]

 ✓ audit/tests/repro-hr-payroll-filter.test.ts (1 test) 5ms

 Test Files  2 passed (2)
      Tests  2 passed (2)
   Duration  319ms
```
