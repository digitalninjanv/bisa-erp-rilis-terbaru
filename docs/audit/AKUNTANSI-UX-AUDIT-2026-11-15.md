# AUDIT UI/UX MODUL AKUNTANSI

Tanggal: 2026-11-15. Fokus: workflow, konsistensi pola, kemudahan scan,
dan kinerja render — bukan menambah fitur akuntansi baru.

## Referensi

- **SAP Fiori List Report / Object Page** — filter bar, status, aksi
  per baris, drill-down ke object page.
- **SAP Fiori Manage Journal Entries** — daftar jurnal dengan aksi
  utama (buat, balik, ekspor) dan tampilan detail per dokumen.
- **ERPNext Journal Entry & Chart of Accounts** — jurnal harus
  seimbang, COA berupa pohon akun, reversal aman.
- **Odoo Bank Reconciliation** — rekonsiliasi dimulai dari rekening,
  pencocokan otomatis + manual, sisa selisih terlihat.

## Inventaris bagian

| # | Bagian | Rute | Isi |
| --- | --- | --- | --- |
| 1 | Ringkasan keuangan | `/app/akuntansi` | KPI laba rugi, kas/bank, piutang/utang, antrean kerja, tren |
| 2 | Bagan akun | `/app/akuntansi/akun` | Daftar akun per tipe, saldo, status, aksi, impor/ekspor |
| 3 | Detail akun | `/app/akuntansi/akun/[id]` | Profil akun, mutasi bulanan, pagination |
| 4 | Jurnal baru | `/app/akuntansi/jurnal/baru` | Form debit/kredit, validasi periode, posting |
| 5 | Riwayat jurnal | `/app/akuntansi/jurnal/riwayat` | Filter periode/sumber/akun/status/user, KPI, ekspor |
| 6 | Detail jurnal | `/app/akuntansi/jurnal/[id]` | Baris debit/kredit, sumber dokumen, pembalik, cetak |
| 7 | Buku besar | `/app/akuntansi/buku-besar` | Mutasi per akun, saldo berjalan, CSV/Excel/cetak |
| 8 | Laporan keuangan | `/app/akuntansi/laporan` | Laba rugi, posisi keuangan, arus kas, ekuitas, neraca saldo, catatan, penjualan |
| 9 | Pajak PPN | `/app/akuntansi/pajak` | Buku PPN masukan/keluaran, neto, ekspor/cetak |
| 10 | Piutang & utang | `/app/akuntansi/piutang-utang` | Tab piutang/utang, aging, pembayaran, kredit pihak |
| 11 | Kas & bank | `/app/akuntansi/bank` | Saldo rekening, transfer, modal, tautan buku besar |
| 12 | Rekonsiliasi bank | `/app/akuntansi/rekonsiliasi` | Impor rekening koran, cocok otomatis/manual, jurnal |
| 13 | Rekonsiliasi kontrol | `/app/akuntansi/rekonsiliasi-kontrol` | GL vs subledger, kontributor selisih |
| 14 | Periode fiskal | `/app/akuntansi/periode` | Buka/tutup/kunci, checklist tutup buku, tutup tahun |
| 15 | Aset tetap | `/app/akuntansi/aset` | Registrasi, penyusutan, pelepasan, kategori |
| 16 | Migrasi COA | `/app/akuntansi/migrasi-coa` | Pemetaan ulang kode akun |
| 17 | HR/Payroll | `/app/akuntansi/hr`, `karyawan`, `payroll`, `kasbon`, `pinjaman`, `klaim` | Modul terpisah di route group akuntansi |

## Matriks audit

| Bagian | Pola UI | Status | Catatan |
| --- | --- | --- | --- |
| Ringkasan | SummaryStrip + WorkQueue + tren | Baik | Aksi “Perlu tindakan” langsung ke dokumen |
| Bagan akun | Daftar per tipe + pencarian + chip | **Diperbaiki** | 1.708 akun sebelumnya terbuka semua; kini kelompok lipat, pencarian/filter membuka otomatis |
| Detail akun | Object page + tabel mutasi + pagination | Baik | Saldo & jurnal terkait terlihat |
| Jurnal baru | Form + validasi periode + peringatan | Baik | Belum ada simpan draf (lihat gap) |
| Riwayat jurnal | List report lengkap | Baik | Filter periode, sumber, akun, status, user; KPI seimbang |
| Detail jurnal | Object page + document flow | Baik | Sumber dokumen & pembalik tertaut |
| Buku besar | Filter akun/periode + saldo berjalan | Baik | Ekspor & cetak tersedia |
| Laporan | Tab + pembanding + ekspor/cetak | Baik | Empty/tanpa akun nol ditangani |
| PPN | Periode + ringkasan + buku | Baik | Angka dari akun pemetaan, bukan hitung ulang |
| Piutang/utang | Tab + aging chip + aksi bayar | Baik | Sumber dokumen & jatuh tempo jelas |
| Kas & bank | KPI + form transfer + saldo | **Diperbaiki** | Rekening bank/clearing kini punya tautan langsung ke rekonsiliasi akun |
| Rekonsiliasi bank | Auto-match + manual + jurnal | Baik | Pola Odoo terpenuhi |
| Rekonsiliasi kontrol | Tabel selisih + kontributor | Baik | Selisih nol/merah eksplisit |
| Periode | Checklist + kontrol status | Baik | Aksi owner untuk buka kunci |
| Aset tetap | KPI + daftar + pencarian/status | **Diperbaiki** | Filter Aktif/Dilepas + pencarian + total mengikuti filter |

## Gap yang sudah diperbaiki

1. **Draf jurnal** — form punya **Simpan draf**; draf tidak menyentuh
   buku besar, dapat direview di halaman detail, lalu **Posting draf**
   atau **Hapus draf**. Posting memakai validasi dan `postJournal`
   yang sama, lalu draf diganti jurnal resmi.
2. **Payload COA** — tanpa pencarian/filter, halaman hanya merender
   enam ringkasan kelompok (bukan 1.700 baris). Klik kelompok membuka
   akunnya; pencarian membuka hasil lintas kelompok.
3. **Mobile jurnal** — riwayat jurnal punya card view di bawah `lg`
   (nomor, keterangan, nilai, status, sumber); tabel hanya desktop.
4. **DPP pajak per dokumen** — buku PPN menampilkan nomor dokumen
   sumber, tautan dokumen, dan DPP dari POS/penerimaan/beban; ekspor
   CSV/XLSX ikut membawa kolom DPP dan Dokumen.

## Sisa gap kecil

1. Draf belum dapat **diedit in-place**; koreksi draf dilakukan dengan
   membuat draf baru (draf lama dihapus). Berikutnya: form edit draf.
2. COA masih membaca seluruh saldo untuk menghitung total kelompok;
   payload HTML sudah kecil, tetapi query tetap satu kali penuh.
3. DPP untuk sumber selain POS/penerimaan/beban (mis. payroll/klaim)
   tetap ditampilkan “—”; DPP-nya belum dipetakan per dokumen.

## Verifikasi

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — lulus.
- E2E `e2e/akuntansi-workflow.spec.ts` — 2 skenario lulus di DB
  disposable: kelompok COA lipat + pencarian membuka hasil; tautan
  rekening bank ke rekonsiliasi.
