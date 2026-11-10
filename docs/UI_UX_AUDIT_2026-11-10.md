# Audit UI/UX & Konflik Sistem — 10 November 2026

Dokumen ini mencatat audit lanjutan setelah redesign Dashboard, Analisa, HR,
laporan keuangan, dan halaman cetak. Fokusnya bukan menambah fitur, tetapi
menemukan **konflik akar** yang membuat sistem terasa tidak konsisten atau
sulit dipakai, lalu menutupnya dengan bukti.

## 1. Metode

- Inventaris seluruh rute: **87 halaman** di `src/app/app`.
- Audit statis tautan: semua `href`/`action` `/app/...` dicocokkan dengan
  pola rute nyata (termasuk rute dinamis) — **0 tautan mati**.
- Audit browser otomatis: **60 halaman statis × 2 viewport** (1440 dan 390)
  diperiksa untuk status HTTP, error JS, overflow horizontal, jumlah `h1`,
  serta teks `undefined`/`NaN`.
- Audit pola kode: komponen KPI, kartu, tab, input tanggal/bulan, label
  status, dan navigasi.
- Riset referensi: SAP Fiori *List Report / Object Page* (list → detail,
  filter di atas daftar), praktik ERP UX (progressive disclosure, navigasi
  per peran, pencarian kuat), serta pola laporan Xero/QuickBooks/FreshBooks.

## 2. Temuan akar & status

| # | Prioritas | Temuan | Bukti | Status |
|---|---|---|---|---|
| 1 | P1 | Halaman **Piutang & Utang** dialihkan ke neraca, tetapi 30 tautan, antrean dashboard, dan Input Cepat masih menunjuk ke sana. Pengguna tidak bisa menerima piutang, membayar utang, atau memakai kredit pihak dari layar. | `piutang-utang/page.tsx` hanya `redirect()`; `getPartyCreditQueueSummary` berkomentar "untuk halaman piutang-utang"; `PaymentForm`/`PartyRowSecondaryActions` masih ada tanpa pemanggil halaman | **Ditutup** — halaman kerja dipulihkan: tab piutang/utang, ringkasan jatuh tempo, pencarian, aging, aksi Terima/Bayar, write-off, saldo awal, dan kredit pihak |
| 2 | P1 | Beranda `/app` dapat digeser horizontal di 390px; nilai kas negatif meluber keluar kartu. | Audit browser: `scrollWidth 398 > 390`; kartu KPI memakai 24px paksa dari `.theme-erp .stat-value` | **Ditutup** — `overflow-x-hidden`, `min-w-0`, ukuran angka `clamp()`, kolom tabel transaksi diprioritaskan untuk mobile |
| 3 | P1 | Halaman POS tidak punya `h1`; pembaca layar dan struktur dokumen kehilangan judul. | Audit browser: `h1=[]` di `/app/pos` | **Ditutup** — `h1` aksesibel "Kasir" (termasuk keadaan belum ada gudang) |
| 4 | P1 | Tautan sidebar Analisa menuju `#kesehatan`, `#kinerja`, `#risiko`, tetapi tidak ada elemen dengan id tersebut. | `grep id=` di halaman Analisa: tidak ditemukan | **Ditutup** — anchor dipasang pada strip kesehatan, penggerak, dan risiko |
| 5 | P2 | Navigasi Akuntansi menyembunyikan Piutang & Utang, tetapi dashboard mempromosikannya; menu juga memuat pengaturan global yang bukan pekerjaan akuntansi. | `modules.ts` vs tautan dashboard/Input Cepat | **Ditutup** — Piutang & Utang masuk grup Kas & Bank; Pengguna/Pengaturan global keluar dari sidebar akuntansi (tetap di pengalih aplikasi & kartu pengguna); Aset tetap pindah ke Buku Besar |
| 6 | P2 | POS memiliki 9 item datar tanpa kelompok; Gudang menyebut "Pemasok" padahal halamannya bertab Pemasok & Pelanggan. | `modules.ts` | **Ditutup** — POS dikelompokkan Harian / Kas & Perangkat / Lainnya; label gudang menjadi "Pemasok & pelanggan" |
| 7 | P2 | Input Cepat "Catat Beban" dan pintasan beranda menuju `/app/akuntansi/beban` yang hanya redirect ke jurnal baru. | `quick-input.ts`, `app/page.tsx` | **Ditutup** — tautan langsung ke jurnal baru; modal Catat Transaksi tetap menjadi jalur utama |
| 8 | P2 | Status `open` ditampilkan sebagai "Buka" pada lencana dokumen/sesi. | `status-badge.tsx` | **Ditutup** — label menjadi "Berjalan" |
| 9 | P2 | Footer nota penjualan ("Terima kasih telah berbelanja…") ikut tercetak pada laporan keuangan. | `report-document.tsx` memakai footer pengaturan global | **Ditutup** — laporan memakai footer dokumen sendiri: tiga tanda tangan, catatan kerahasiaan, QR verifikasi; footer nota diuji tidak muncul |
| 10 | P2 | Laporan layar/cetak belum punya identitas dokumen formal dan navigasi filter tidak konsisten. | Audit laporan & PDF | **Ditutup** — kop legal, judul, periode, satuan, referensi, tab garis bawah, filter tanggal tanpa kolom cari palsu, menu Unduh, satu halaman untuk P&L/posisi/arus kas/ekuitas |
| 11 | P2 | Ringkasan KPI memakai dua bahasa komponen (StatCard vs SummaryStrip) dan angka besar dapat meluber. | 15 halaman memakai `StatCard`; halaman baru memakai `SummaryStrip` | **Sebagian** — `SummaryStrip` menjadi pola dashboard/daftar baru; `StatCard` dipertahankan untuk metrik detail, dengan ukuran angka responsif. Migrasi menyeluruh dicatat sebagai utang kosmetik, bukan blocker |
| 12 | P2 | Pintasan beranda memakai visibilitas modul, bukan izin aksi: "Catat jurnal" tampil untuk pemegang `accounting.view` tanpa `accounting.post`; "Buka sesi kas" tampil tanpa `pos.session`. | `app/page.tsx` shortcut array | **Ditutup** — pintasan digerbangi izin aksinya masing-masing |
| 13 | P2 | Database demo tercemar jurnal pembalik payroll uji bertanggal 2026, sehingga beban negatif dan laba tampak tidak wajar. | `account_monthly_balances`/jurnal `payroll_reversal`; dashboard menampilkan peringatan saldo beban negatif | **Terbuka (operasional)** — perlu reseed atau database uji terpisah; bukan bug UI. Dashboard sengaja menampilkan peringatan, bukan menyembunyikan angka |
| 14 | P3 | Rute HR masih berada di bawah `/app/akuntansi/...` meski HR adalah modul sendiri. | `modules.ts`, rute `(hr)` | **Terbuka (keputusan arsitektur)** — migrasi rute butuh pengalihan bookmark, tautan cetak, dan tes rute; belum dilakukan agar tidak memutus tautan lama |
| 15 | P3 | Teks 10px masih banyak (315 kemunculan) untuk label kecil. | grep `text-[10px]` | **Terbuka (tipografi)** — label uppercase/code sengaja padat; sapuan menyeluruh harus diuji per permukaan agar tabel tidak pecah |

## 3. Perbaikan yang dilakukan pada audit ini

1. **Piutang & Utang dipulihkan sebagai halaman kerja**  
   `/app/akuntansi/piutang-utang` — tab, ringkasan, filter jatuh tempo,
   pencarian, aging, pembayaran, write-off, saldo awal, kredit pihak, dan
   cetak umur. Semua tautan lama kembali valid.

2. **Navigasi lintas modul dirapikan**  
   Akuntansi: Piutang & Utang masuk Kas & Bank; pengaturan global tidak lagi
   bercampur. POS dikelompokkan. Gudang memakai label yang jujur.

3. **Beranda mobile diperbaiki**  
   Tidak ada lagi geser horizontal; nilai uang muat; tabel transaksi
   menampilkan Nomor/Total/Status di layar kecil, sementara Waktu/Kasir
   muncul di layar lebih lebar.

4. **Aksesibilitas dasar**  
   POS memiliki `h1`; anchor Analisa berfungsi; status `open` berlabel
   "Berjalan".

5. **Jalur catat beban tidak lagi melewati redirect**  
   Input Cepat dan pintasan beranda langsung menuju jurnal baru.

6. **Konsistensi cetak laporan**  
   Footer nota tidak lagi muncul di laporan; laporan memakai footer dokumen
   formal, kop legal, dan satuan Rupiah.

## 4. Verifikasi

- `tsc --noEmit`: bersih.
- `lint`: 0 error, 19 warning lama.
- `build`: sukses.
- Audit browser 60 halaman × 2 viewport: tidak ada overflow/error baru pada
  halaman statis; satu-satunya `h1=[]` tersisa adalah rute redirect lama
  `/app/akuntansi/beban` yang langsung berpindah halaman.
- Audit PDF: P&L, Posisi Keuangan, Arus Kas, Perubahan Ekuitas = 1 halaman;
  Neraca Saldo/Penjualan multi-halaman dengan header tabel berulang.
- Tes unit navigasi/palet/quick-input: 61 lulus.
- Full suite: 2199 lulus, 1 gagal lama `review-fixes-t4rb` (saldo bank demo
  negatif) — bukan regresi audit ini.

## 5. Rekomendasi berikutnya

1. Pisahkan database uji dari database demo, atau wajibkan semua tes tulis
   memakai transaksi rollback, agar angka demo tidak berubah setiap suite
   dijalankan.
2. Putuskan migrasi rute HR ke `/app/hr/*` (dengan redirect 308 dari rute
   lama) bila ingin URL yang benar-benar mencerminkan modul.
3. Lanjutkan migrasi `StatCard` → `SummaryStrip` pada halaman daftar yang
   masih memakai kartu KPI, satu modul per batch.
4. Lakukan sapuan tipografi 10px → 11px per permukaan, bukan global, agar
   tabel padat dan dokumen cetak tetap muat.
