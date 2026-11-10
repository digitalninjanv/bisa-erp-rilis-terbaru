# Peta Kepemilikan `src/lib/`

**A-26 Q9 (menutup cacat struktural K-09/§4 audit kualitas kode).**
`lib/` adalah rumah **logika murni** proyek: fungsi yang bisa diuji
unit tanpa database/framework dan tidak tahu soal Drizzle/Next —
kekuatan itu dipertahankan (keputusan Q0: logika murni TIDAK dipindah
ke `server/`). Yang diubah Q9 hanyalah **pengakuan kepemilikannya**:
mesin domain yang besar kini tinggal di subfolder bernama pemiliknya,
agar developer baru melihat bahwa `lib/` memuat separuh mesin bisnis,
bukan sekadar utilitas.

## Aturan main

1. Kode baru mengimpor mesin domain dari folder grupnya
   (`@/lib/payroll/…`, `@/lib/akuntansi/…`, dst. atau barrel grup
   `@/lib/payroll`).
2. Jalur datar lama (`@/lib/payroll-indonesia`, dst.) adalah **fasad
   kompatibilitas** — berkas re-export tipis yang dipertahankan agar
   pemanggil yang ada tidak berubah. Jangan menambah definisi di
   fasad; definisi selalu di berkas grup.
3. Berkas tetap datar hanya bila ia (a) primitif/kernel platform,
   atau (b) logika bersama lintas modul yang pemiliknya memang
   platform — keduanya terdaftar di peta bawah. Mesin domain baru
   yang besar masuk ke folder grup pemiliknya, bukan ke akar `lib/`.
4. Pengecualian infra yang tercatat sejak audit AD-1/Q0: `auth.ts` &
   `session.ts` (kernel sesi) mengimpor `@/db`; `gudang/stock.ts`
   membangun fragmen SQL Drizzle untuk kembaran SQL `isLowStock`
   (tanpa koneksi/query). Keduanya disadari, bukan pola untuk ditiru
   berkas murni baru.

## Grup domain (subfolder)

| Folder | Pemilik | Isi |
|---|---|---|
| `payroll/` | Modul HR | `payroll-indonesia` (mesin statutori PPh 21/BPJS), `payroll-indonesia-defaults` (tarif & parameter bawaan), `hr` (kalender kerja, keterlambatan, masa kerja) |
| `import/` | Domain impor | `import-parse` (parser berkas impor), `import-classify` (klasifikasi baris/kolom) |
| `pos/` | Modul POS | `pos-offline` (cermin quote offline terminal, kontrak D-23), `barcode-burst` (penangkap burst scanner) |
| `akuntansi/` | Modul Akuntansi | `statement-csv` (parser mutasi bank), `quick-entry` + `quick-input` (Catat Transaksi, kontrak pratinjau==posting D-23), `journal-form`, `account-mappings`, `accounting` (helper buku besar murni), `payment-settlement`, `reconciliation-form`, `period-status`, `balance-status` |
| `gudang/` | Modul Gudang | `opname-count`, `opname-cycle` (hitung & siklus opname), `adjustment-reasons` (alasan penyesuaian terkonfigurasi), `operation-scan` (resolusi pindaian Mode Operasi), `stock` (definisi stok menipis kanonis + kembaran SQL-nya), `movement-groups` (pengelompokan pergerakan per dokumen asal untuk ringkasan beranda) |

## Tetap datar — kernel platform & primitif

| Berkas | Peran |
|---|---|
| `money`, `format`, `csv`, `pagination`, `errors`, `log`, `env`, `utils` | Primitif uang/format/ekspor/paginasi/error yang dipakai semua modul |
| `money-input`, `percent-input`, `date-field` | Mesin parsing/format input form bersama (pasangan komponen input di `src/components/`) |
| `action-validation`, `form-gate` | Validasi & gerbang form bersama |
| `auth`, `auth-client`, `session`, `company-selection` | Kernel autentikasi & sesi (lihat pengecualian §4 atas) |
| `permissions`, `modules`, `landing`, `settings-nav`, `palette`, `notify-warnings`, `qris-image` | Platform pengalaman: izin, modul, pendaratan peran, navigasi pengaturan, palet perintah, peringatan, QRIS |

## Tetap datar — logika bersama lintas modul (pemilik: platform)

| Berkas | Alasan tetap datar |
|---|---|
| `custom-fields` | Fitur kolom kustom per perusahaan menempel ke produk/pemasok/pelanggan lintas modul; definisinya milik platform (jsonb `company_settings`) |
| `document-numbering` | Penomoran dokumen dipakai semua modul penerbit dokumen; formatnya milik platform |
| `document-flow` | Peta status → tahap untuk `DocumentPage` bersama; maknanya sengaja seragam antar-modul |
| `due-date` | Logika jatuh tempo/aging bersama daftar piutang-utang (akuntansi) dan penagihan POS |
| `categories` | Helper pohon kategori murni untuk taksonomi produk (dipakai gudang & impor lewat fasad yang sama) |
