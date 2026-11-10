# Standar UX, Performa & Keamanan — Riset Web untuk Bisa ERP

> Dokumen riset (bukan kode). Semua klaim standar dirujuk ke **sumber resmi** (W3C, IBM Carbon,
> Atlassian, Odoo, Frappe/ERPNext, Vercel/Next.js, PostgreSQL, Drizzle, OWASP).
> Konteks kode: Next.js 16 full-stack monolith (App Router, Server Actions), PostgreSQL + Drizzle + RLS,
> modul Akuntansi, Gudang, POS, Pengaturan. Tanggal riset: 2026-11-03.
> Temuan kondisi saat ini berasal dari pembacaan struktur `src/` pada tanggal yang sama
> (disebut eksplisit sebagai "kondisi saat ini", bukan klaim standar).

---

## 1. UI/UX Enterprise & Aksesibilitas

### 1.1 Target konformansi: WCAG 2.2 Level AA

**Prinsip.** WCAG 2.2 adalah W3C Recommendation; kriteria keberhasilan (success criteria) bersifat
testable dan tidak terikat teknologi. Konformansi 2.2 sekaligus memenuhi 2.1/2.0. Kriteria A+AA yang
paling berdampak untuk aplikasi ERP data-dense:

- **1.4.3 Contrast (Minimum) — AA:** teks ≥ 4,5:1; teks besar ≥ 3:1.
  Sumber: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **1.4.11 Non-text Contrast — AA:** komponen UI, batas kontrol, dan indikator fokus ≥ 3:1 terhadap
  warna di sekitarnya. Sumber: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- **1.4.10 Reflow — AA:** konten tetap utuh dan berfungsi pada lebar 320 CSS px tanpa scroll dua arah
  (tabel data adalah pengecualian yang diakui, tetapi halaman di sekitarnya tidak boleh ikut rusak).
- **1.1.1 Non-text Content — A:** semua konten non-teks (ikon, grafik) punya alternatif teks.
  Sumber: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html
- **2.1.1 Keyboard — A / 2.4.7 Focus Visible — AA / 2.4.11 Focus Not Obscured (Minimum) — AA (baru di 2.2):**
  semua fungsi bisa dioperasikan keyboard, fokus terlihat, dan elemen yang berfokus tidak tertutup
  seluruhnya oleh header/footer lengket (sticky).
- **2.5.8 Target Size (Minimum) — AA (baru di 2.2):** target pointer ≥ 24×24 CSS px (atau memenuhi
  pengecualian spacing). Untuk layar sentuh kasir, targetkan lebih besar (lihat §2).
- **3.3.7 Redundant Entry — A (baru di 2.2):** informasi yang sudah dimasukkan user dalam proses yang
  sama tidak boleh diminta ulang; harus terisi otomatis atau dapat dipilih.
- **3.3.8 Accessible Authentication (Minimum) — AA (baru di 2.2):** login tidak boleh bergantung pada
  tes kognitif (mis. menghafal/memecahkan puzzle) tanpa alternatif; paste password harus diizinkan.
- **3.2.6 Consistent Help — A (baru di 2.2):** mekanisme bantuan muncul di lokasi yang konsisten.
- Spesifikasi normatif lengkap: https://www.w3.org/TR/WCAG22/

**Penerapan di Bisa ERP.**

- Token warna di `src/app/globals.css` (Tailwind 4 + shadcn/Base UI di `src/components/ui/*`) adalah
  satu-satunya tempat memperbaiki kontras: ukur pasangan foreground/background token (`--foreground`,
  `--muted-foreground`, `--destructive`, border) terhadap rasio di atas; `muted-foreground` untuk teks
  kecil adalah risiko kontras paling umum di tema padat.
- `src/components/ui/button.tsx` sudah memakai `focus-visible:ring` — pertahankan dan jangan pernah
  menghapus outline tanpa pengganti yang memenuhi 1.4.11. Terapkan pola yang sama ke semua kontrol
  kustom di `src/components/blocks/*` dan form per modul.
- Sticky header tabel/shell (`src/components/shell/module-shell.tsx`, `sidebar-nav.tsx`,
  `mobile-nav.tsx`): beri `scroll-margin-top` pada baris/elemen yang bisa berfokus agar tidak tertutup
  header lengket (2.4.11).
- Ikon Lucide yang berdiri sendiri sebagai tombol (di `src/components/blocks/*`, `pos/*`, `gudang/*`)
  wajib punya `aria-label`; grafik di `src/components/akuntansi/charts.tsx` wajib punya ringkasan teks
  (tabel data alternatif / `aria-describedby`) per 1.1.1 dan 1.4.1 (jangan menyampaikan makna hanya
  lewat warna — status juga harus teks, lihat `src/components/blocks/status-badge.tsx`: selalu render
  label teks, bukan hanya titik warna).
- Form multi-langkah (impor di `src/components/gudang/import-wizard.tsx`, jurnal baru di
  `src/app/app/akuntansi/jurnal/baru/page.tsx`): terapkan 3.3.7 — nilai yang sudah dipilih di langkah
  sebelumnya (perusahaan, gudang, periode, pemetaan kolom) jangan diminta ulang.

**Verifikasi.**

- `@axe-core/playwright` pada route per modul (login, POS, daftar produk, jurnal, laporan):
  target **0 violation critical/serious**. (Saat ini `playwright.config.*` dan folder e2e belum ada —
  perlu ditambahkan; script `test:e2e` sudah tersedia di `package.json`.)
- Playwright keyboard-only script: Tab dari awal halaman POS sampai tombol bayar tanpa mouse; assert
  elemen berfokus terlihat (bounding box tidak tertutup header) di setiap langkah.
- Uji reflow Playwright pada viewport 320×720 dan 200% zoom untuk halaman daftar & form (di luar tabel,
  tidak boleh ada scroll horizontal halaman).
- Uji kontras otomatis via axe (`color-contrast`) + spot-check manual untuk status badge & grafik.

### 1.2 Pola data-dense: Carbon Design System

**Prinsip (Carbon — Data table).** Tabel data enterprise mendukung: sorting pada header kolom,
ekspansi baris untuk progressive disclosure, batch actions, toolbar berisi pencarian/filter/aksi
utama, pagination bar, dan **empat ukuran baris (tall, normal, short, compact)** yang konsisten antara
header dan baris. Tabel harus diberi ruang lebar yang cukup; hindari menanam tabel di dalam modal atau
kontainer sempit yang memaksa truncation.
Sumber: https://v10.carbondesignsystem.com/components/data-table/usage/

**Penerapan di Bisa ERP.**

- Standarkan semua daftar (produk, pergerakan stok, jurnal, buku besar, riwayat penjualan, piutang/utang)
  pada satu pola dari `src/components/ui/table.tsx` + `src/components/blocks/pagination.tsx` +
  `src/components/blocks/search-form.tsx`: header sortable untuk kolom yang memang terindeks di server
  (lihat §3), toolbar di atas tabel (search + filter + aksi utama), pagination bar di bawah.
- Sediakan pilihan densitas baris yang persisten per user untuk staf gudang/akuntansi yang bekerja
  berjam-jam (compact) vs kasir (normal) — cukup sebagai preferensi tampilan, bukan setting bisnis.
- Detail panjang masuk ke ekspansi baris atau halaman detail (`produk/[id]`, `jurnal/[id]`,
  `nota/[id]`, `payroll/[id]` sudah berpola halaman detail) — jangan menambah kolom terus-menerus.
- `src/components/blocks/empty-state.tsx` adalah pola wajib untuk keadaan kosong: jelaskan kenapa
  kosong dan tawarkan aksi berikutnya (impor, tambah), jangan tampilkan tabel kosong tanpa konteks.

**Verifikasi.** Review visual per route terhadap checklist pola di atas; Playwright mengukur tidak ada
teks terpotong (scrollWidth elemen kunci ≤ clientWidth) pada 1366×768 untuk tabel utama tiap modul.

### 1.3 Form, status & feedback: Atlassian Design System

**Prinsip (Atlassian — pesan error & pesan kontekstual).**

- Pesan error muncul **setelah** aksi, menyatakan apa yang terjadi, akibatnya, dan apa yang harus
  dilakukan untuk lanjut; 1–2 kalimat, tanpa jargon teknis, tanpa menyalahkan user.
  Sumber: https://atlassian.design/foundations/content/designing-messages/error-messages
- Pilih kanal menurut urgensi: **banner** untuk masalah sistem kritis (kehilangan data/fungsi),
  **section message** untuk informasi penting yang persisten di dalam seksi dan butuh tindakan,
  **inline message / validasi inline** untuk konteks spesifik di dekat field.
  Sumber: https://atlassian.design/components/section-message/usage dan
  https://atlassian.design/components/inline-message/usage
- Jangan menyampaikan tingkat keparahan hanya lewat warna — selalu ada ikon + teks; pesan tidak boleh
  terpotong (truncation tidak aksesibel).

**Penerapan di Bisa ERP.**

- Validasi form: error per-field tampil inline di bawah field (pola react-hook-form + Zod yang sudah
  dipakai, mis. `src/components/akuntansi/journal-entry-form.tsx`,
  `src/components/gudang/product-form.tsx`), dengan `aria-invalid` + `aria-describedby` mengarah ke
  teks error; error tingkat dokumen (jurnal tidak seimbang, periode tertutup, stok tidak cukup)
  tampil sebagai section message di atas form dengan angka konkret (selisih debit/kredit, stok tersedia).
- Toast (`src/components/ui/sonner.tsx`) hanya untuk konfirmasi sukses singkat; **jangan** pakai toast
  untuk error yang membutuhkan tindakan (user bisa melewatkannya) — pakai inline/section message.
- Pesan error dari server action dipetakan dari `src/lib/errors.ts` ke kalimat Bahasa Indonesia yang
  bisa ditindaklanjuti ("Periode Januari 2026 sudah ditutup — buka kembali di Akuntansi → Periode atau
  posting di periode berjalan"), bukan stack trace/kode mentah (juga persyaratan keamanan, §4).
- Status dokumen konsisten lintas modul lewat `src/components/blocks/status-badge.tsx`:
  draft/posted/void/ditahan/lunas selalu teks + warna yang sama maknanya di POS, Gudang, Akuntansi.

**Verifikasi.** Playwright: skenario error wajib per form utama (submit jurnal tidak seimbang, terima
barang melebihi pesanan, checkout stok kurang) — assert pesan muncul, spesifik, dan field terkait
ber-`aria-invalid`. Review manual: tidak ada error yang hanya berupa toast.

### 1.4 Navigasi & responsif

**Prinsip.** WCAG 1.4.10 (reflow) + 2.4.6 (headings/labels deskriptif) + konsistensi navigasi (3.2.3).
Pola shell Carbon/Atlassian: navigasi utama persisten, breadcrumb untuk kedalaman, judul halaman yang
menyatakan konteks (perusahaan/periode/gudang aktif).

**Penerapan di Bisa ERP.**

- `src/components/shell/module-shell.tsx` + `sidebar-nav.tsx` (desktop) dan `mobile-nav.tsx`:
  struktur menu per modul harus identik urutannya di desktop dan mobile; konteks aktif (nama
  perusahaan, gudang, sesi kas) selalu terlihat di shell, bukan hanya di halaman.
- Tabel di layar kecil: jangan paksakan semua kolom — prioritaskan kolom kunci (SKU/nama, qty, nilai,
  status), sisanya masuk ekspansi baris/halaman detail; scroll horizontal hanya di dalam kontainer
  tabel, tidak pada halaman (menjaga 1.4.10 untuk konten non-tabel).
- Breakpoint Tailwind standar (`sm/md/lg/xl`) dipakai konsisten; POS adalah pengecualian sadar:
  dioptimalkan untuk landscape ≥1024px dan tidak boleh rusak total di tablet potrait (lihat §2).

**Verifikasi.** Playwright pada 8 viewport (320×720, 375×812, 430×932, 768×1024, 1024×768, 1366×768,
1440×900, 1920×1080): tidak ada scroll horizontal halaman, tidak ada elemen tumpang-tindih
(cek geometri bounding box elemen kunci), menu mobile mencapai semua route modul.

---

## 2. UX Khusus POS Kasir

**Prinsip dari referensi resmi POS.**

- **Barcode-first adalah jalur utama, bukan fitur tambahan.** Di Odoo POS, scanner harus mengakhiri
  barcode dengan karakter `ENTER` (keycode 28) agar kompatibel; scanner pada dasarnya mengetik sangat
  cepat. Artinya aplikasi harus membedakan ketikan scanner (burst cepat + Enter) dari ketikan manusia
  dan langsung menambah barang tanpa klik.
  Sumber: https://www.odoo.com/documentation/saas-18.1/applications/sales/point_of_sale/configuration/pos_iot.html
- **Sesi kas adalah unit kerja kasir** (ERPNext/Frappe): buka sesi dengan POS Opening Entry (saldo awal
  kas), jual lewat POS Invoice, tutup dengan POS Closing Entry; stok dan posting akuntansi terjadi dari
  dokumen-dokumen ini. Pemisahan buka–jual–tutup membuat selisih kas bisa diaudit.
  Sumber: https://docs.frappe.io/erpnext/pos-workflows
- **Kecepatan checkout diukur dalam jumlah aksi, bukan kesan:** tambah barang (scan/1 klik), bayar,
  selesai. Setiap modal/popup tambahan di jalur utama adalah biaya antrean.
- **Pencegahan error pembayaran:** konfirmasi eksplisit untuk aksi destruktif/ireversibel (void, retur)
  dengan alasan wajib; pembayaran campuran (split payment) menampilkan total terbayar vs sisa secara
  real-time; kembalian dihitung sistem, tidak diketik manual.

**Penerapan di Bisa ERP** (selaras aturan proyek: POS tanpa pemilih pelanggan; harga/diskon dari
kelompok pelanggan saja; metode tempo/kredit disembunyikan).

- `src/components/pos/pos-terminal.tsx`: input barcode global selalu berfokus saat tidak ada dialog
  terbuka; scan (diakhiri Enter) → produk bertambah dan fokus kembali ke input. Setelah dialog apa pun
  ditutup, fokus **wajib** kembali ke input barcode.
- Shortcut keyboard terdokumentasi di layar (mis. F-keys/Alt+kombinasi untuk Bayar, Tahan, Buka sesi)
  dan tidak bertabrakan dengan shortcut browser; daftar shortcut tampil dari tombol bantuan yang
  lokasinya konsisten (WCAG 3.2.6).
- Alur bayar (`pos-terminal.tsx` + `src/server/pos.ts` + `src/server/actions/pos.ts`): tombol Bayar
  menonaktifkan diri selama submit (anti dobel-klik), submit membawa **idempotency key** (pola sudah
  ada di akuntansi — `src/server/accounting.ts`); klik dua kali / retry jaringan tidak boleh
  menghasilkan dua penjualan.
- Void & retur (`src/components/pos/return-form.tsx`, `sale-row-actions.tsx`, halaman
  `src/app/app/pos/retur/page.tsx`): wajib izin khusus (`requirePermission`, pola sudah dipakai di
  `src/server/actions/pos.ts`) + alasan wajib; nota asli tidak pernah diubah/dihapus — koreksi lewat
  dokumen retur/void yang tertaut (konsisten dengan append-only akuntansi).
- Sesi (`src/components/pos/session-manager.tsx`, `src/app/app/pos/sesi/page.tsx`): checkout ditolak
  bila tidak ada sesi terbuka; tutup sesi menampilkan selisih hitung vs sistem sebelum final.
- Nota (`src/components/pos/receipt-print.tsx`, `src/app/app/pos/nota/[id]/page.tsx`): cetak 58/80mm
  tanpa terpotong; angka nota harus identik dengan data server (total, diskon, kembalian) — riwayat
  mencetak ulang dari data server, bukan state klien.
- Target sentuh di terminal: tombol produk & pembayaran ≥ 44×44 CSS px (di atas minimum AA 24px,
  karena konteks sentuh kasir), teks total minimal setara teks besar WCAG agar terbaca dari jarak
  berdiri.
- **Kejujuran fitur:** skema `outbox` sudah ada tetapi belum ada worker produksi (per README) — jangan
  mengklaim POS offline sampai antrean sinkronisasi benar-benar berjalan dan teruji; pola acuan offline
  ERPNext (antrean lokal + sinkron saat koneksi pulih) adalah target desain, bukan kondisi saat ini.
  Sumber pola: https://docs.frappe.io/erpnext/pos-workflows

**Verifikasi.**

- Playwright mensimulasikan scanner: ketik barcode + Enter dengan jeda antar-karakter < 50 ms; assert
  barang masuk keranjang dan total benar. Ukur: scan→tampil di keranjang < 300 ms pada data katalog
  hasil `pnpm db:seed:bulk` (10.000 produk).
- Playwright: dobel-klik Bayar dan submit ulang dengan idempotency key sama → tepat 1 penjualan,
  1 jurnal, stok berkurang sekali (diverifikasi juga oleh `tests/integration/sale-flow.test.ts`).
- Uji keyboard-only checkout penuh: scan (keyboard) → bayar tunai → nota, tanpa satu klik mouse.
- Uji target sentuh: bounding box tombol utama POS ≥ 44×44 pada viewport 1024×768 dan 1366×768.

---

## 3. Performa

### 3.1 Next.js: streaming, jangan blokir halaman oleh satu query lambat

**Prinsip.** `loading.js` membuat instant loading state: fallback UI (skeleton) tampil segera dari
server sementara konten segmen stream masuk, navigasi bersifat interruptible, dan layout bersama tetap
interaktif. `<Suspense>` manual memberi granularitas per komponen.
Sumber: https://nextjs.org/docs/app/api-reference/file-conventions/loading
Dokumen resmi Next.js juga menegaskan fetch yang tidak di-cache akan memblokir render sampai selesai —
karena itu komponen yang mengambil data segar dibungkus `<Suspense>` agar stream, atau hasilnya
di-cache secara eksplisit bila memang jarang berubah.
Sumber: https://nextjs.org/docs/app/api-reference/file-conventions/loading (dan panduan fetching data
yang dirujuk dari halaman tersebut).

**Kondisi saat ini.** Pencarian pada `src/app` dan `src/components`: **belum ada `loading.tsx` maupun
`<Suspense>` sama sekali** — setiap halaman daftar menunggu seluruh query selesai sebelum HTML pertama
tampil. Ini gap performa UX nomor satu di sisi frontend.

**Penerapan.**

- Tambahkan `loading.tsx` (skeleton tabel dari `src/components/ui/skeleton.tsx`) di segmen daftar
  berat: `src/app/app/gudang/produk/`, `gudang/pergerakan/`, `akuntansi/jurnal/`,
  `akuntansi/buku-besar/`, `pos/riwayat/`, `akuntansi/laporan/`.
- Halaman laporan (`src/app/app/akuntansi/laporan/page.tsx` + `src/server/reports.ts`): pisahkan
  blok laporan menjadi komponen async per seksi di dalam `<Suspense>` agar KPI cepat tampil duluan dan
  tabel berat menyusul.
- Halaman adalah request-time (`export const dynamic = "force-dynamic"` per AGENTS.md) — jangan
  mengorbankan kesegaran data demi cache; yang dioptimalkan adalah **streaming + query**, bukan
  caching data bisnis. Cache hanya untuk aset statis dan data referensi yang benar-benar jarang berubah.

**Verifikasi.** Playwright dengan jaringan di-throttle (Slow 4G) + query buatan lambat di lingkungan
uji: skeleton terlihat < 1 dtk setelah navigasi, konten menyusul tanpa layout shift pada header tabel.
Anggaran: TTFB halaman shell < 500 ms di server lokal uji.

### 3.2 PostgreSQL: pagination terukur — keyset untuk daftar dalam, offset terbatas untuk daftar dangkal

**Prinsip.**

- `EXPLAIN` menunjukkan rencana eksekusi yang dipilih planner; `EXPLAIN (ANALYZE, BUFFERS)` adalah
  alat keputusan utama sebelum/ sesudah menambah indeks — bukan tebakan.
  Sumber: https://www.postgresql.org/docs/current/using-explain.html
- `LIMIT … OFFSET …` memaksa database memindai dan membuang semua baris yang di-skip: biaya naik
  linear dengan kedalaman halaman. **Keyset (seek) pagination** memakai nilai terakhir yang terlihat
  sebagai jangkar (`WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT n`) dan
  berjalan di atas indeks dengan biaya nyaris konstan di kedalaman berapa pun — pola ini juga yang
  didokumentasikan dalam literatur resmi PostgreSQL tentang penggunaan indeks untuk `ORDER BY`/`LIMIT`.

**Kondisi saat ini.** Offset pagination dipakai di `src/server/catalog.ts` (daftar produk & pencarian,
3 titik), `src/server/reports.ts` (2 titik), dan `src/server/actions/import.ts` (pratinjau baris impor).
Dengan target katalog 10.000+ produk (fixture `db:seed:bulk`) dan pergerakan stok/jurnal yang tumbuh
tanpa batas, daftar yang dalam akan melambat.

**Keputusan terukur (aturan proyek yang diusulkan).**

| Jenis daftar | Pola | Batas |
|---|---|---|
| Pergerakan stok, jurnal, buku besar, riwayat penjualan, audit log, baris impor | **Keyset** di `(tanggal/id)` atau `(created_at, id)` dengan indeks komposit yang urutannya sama persis dengan `ORDER BY` | halaman 50–100 |
| Daftar master dangkal (gudang, kategori, satuan, pemasok, akun) | Offset boleh, **dengan cap halaman** dan `LIMIT` maksimum server-side | offset maksimum setara ±10.000 baris |
| Pencarian produk POS/katalog | Keyset atau hasil dibatasi + indeks trigram (`pg_trgm` sudah diaktifkan di `docker/init.sql`) | hasil maks. 20–50 |

- Setiap query daftar baru wajib lolos gerbang `EXPLAIN (ANALYZE, BUFFERS)` pada data fixture bulk:
  tidak ada `Seq Scan` pada tabel > 10.000 baris untuk query halaman pertama maupun halaman dalam;
  waktu eksekusi halaman dalam ≤ 2× halaman pertama.
- Indeks ditambah hanya lewat migrasi Drizzle baru (tidak mengedit migrasi lama), dan hanya bila
  EXPLAIN membuktikan kebutuhan.

**Verifikasi.** Skrip/uji integrasi performa: jalankan query daftar pada 10.000 produk + volume
pergerakan stok besar, simpan output EXPLAIN sebagai artefak; Playwright mengukur waktu muat halaman
daftar (p95 navigasi < 1,5 dtk pada data bulk di mesin uji).

### 3.3 Drizzle: cegah N+1 secara struktural

**Prinsip.** Relational Query API Drizzle (`db.query.<tabel>.findMany({ with: { … } })`) memuat relasi
bersarang dalam **satu statement SQL** (join/subquery lateral), termasuk `limit`/`offset` per relasi —
berlawanan dengan pola loop yang menjalankan satu query per baris (N+1).
Sumber (repositori resmi dokumen Drizzle): https://github.com/drizzle-team/drizzle-orm-docs/blob/HEAD/src/content/docs/mssql/rqb.mdx
(API relational query sama lintas dialek; proyek ini memakai dialek PostgreSQL.)

**Penerapan.**

- Aturan: fungsi daftar di `src/server/*.ts` (`catalog.ts`, `inventory.ts`, `reports.ts`, `pos.ts`)
  **dilarang** melakukan query di dalam `map`/loop atas hasil query lain. Relasi untuk tampilan daftar
  dimuat via `with:` atau satu `leftJoin` eksplisit dengan daftar kolom terpilih (hindari `select *`
  pada tabel lebar seperti produk + pergerakan).
- Agregat (saldo buku besar, aging piutang/utang, nilai persediaan) dihitung di SQL
  (`sum`/`groupBy`) di `src/server/reports.ts`, bukan dengan menarik semua baris lalu menjumlah di JS.
- Uang tetap Decimal.js dari string `numeric(19,4)` (`src/lib/money.ts`) — optimasi tidak boleh
  mengganti aritmetika uang menjadi `number`.

**Verifikasi.** Uji integrasi menghitung jumlah statement SQL per pemanggilan fungsi daftar
(interceptor logger Drizzle di lingkungan test): daftar 50 baris harus ≤ 3 statement (1 data + 1 count
+ toleransi). Regresi N+1 = uji gagal.

---

## 4. Keamanan

### 4.1 Kerangka: OWASP ASVS sebagai daftar periksa, Cheat Sheets sebagai panduan implementasi

**Prinsip.** ASVS adalah katalog persyaratan keamanan yang dapat diuji, berjenjang Level 1–3; aplikasi
ERP multi-tenant yang memproses uang menargetkan **Level 2** untuk bab terkait akses kontrol,
validasi, logging, dan sesi.
Sumber: https://owasp.org/www-project-application-security-verification-standard/
Broken Access Control adalah kategori risiko #1 OWASP Top 10 — kegagalan paling umum adalah cek izin
yang hanya ada di UI/route tetapi tidak di operasi data.
Sumber: https://owasp.org/Top10/A01_2021-Broken_Access_Control/

### 4.2 RBAC & otorisasi per-operasi (deny by default)

**Prinsip (OWASP).** Access Control Cheat Sheet: terapkan least privilege, deny by default, dan
otorisasi **di server pada setiap operasi**, termasuk kepemilikan/konteks objek (anti-IDOR).
Sumber: https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html dan
https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
Next.js menegaskan hal yang sama untuk arsitektur ini: Server Actions dapat dipanggil lewat POST
langsung, jadi **setiap action harus memverifikasi autentikasi dan otorisasi di dalamnya sendiri**;
cek di level halaman tidak melindungi action.
Sumber: https://nextjs.org/docs/app/guides/data-security dan
https://nextjs.org/docs/app/guides/authentication

**Kondisi saat ini & penerapan.** Pola proyek sudah benar arahnya dan wajib dipertahankan tanpa
pengecualian:

- Setiap ekspor di `src/server/actions/*.ts`: `"use server"`, parse Zod, `requirePermission(...)`
  (dari `src/lib/session.ts`, izin di `src/lib/permissions.ts`), lalu `guard(...)`. Menambah action
  baru tanpa `requirePermission` = cacat P0.
- Peran kustom (`company_roles`) tidak boleh melebihi izin peran bawaan yang memberi; hanya owner
  boleh menetapkan owner; owner terakhir tidak boleh diturunkan/dihapus (aturan AGENTS.md — uji ini
  harus ada di `tests/unit/permissions.test.ts` / integrasi).
- UI hanya menyembunyikan menu/tombol (`can(ctx, permission)`); keamanan tidak pernah bergantung pada
  penyembunyian itu.

**Verifikasi.** Uji integrasi matriks izin: untuk setiap action mutasi, panggil sebagai peran tanpa
izin → ditolak; sebagai peran lintas perusahaan → ditolak (lihat juga 4.3).

### 4.3 Isolasi multi-tenant dengan RLS (pertahanan berlapis)

**Prinsip.** Otorisasi aplikasi saja tidak cukup untuk multi-tenant; isolasi harus juga ditegakkan di
database (defense in depth), sehingga satu bug query tidak membocorkan data tenant lain. Ini penerapan
langsung prinsip deny-by-default OWASP pada lapisan data.
Sumber: https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html

**Penerapan (pola yang sudah ada — jangan dilonggarkan).**

- Semua query tabel ber-`company_id` hanya lewat `withCompany` / `withCompanyReadOnly` di
  `src/db/tenant.ts` (menyetel `app.company_id` untuk RLS); role aplikasi `app_user` bukan pemilik
  skema (`DIRECT_URL` hanya untuk migrasi/seed/admin — `src/db/admin.ts`).
- Dilarang query langsung dari `db` (`src/db/index.ts`) ke tabel bisnis di luar wrapper, dan dilarang
  menerima `companyId` dari input klien — konteks perusahaan selalu dari sesi (`requireAuth`).
- Migrasi RLS & guard berada di `src/db/migrations/0001_rls_and_guards.sql`; tabel bisnis baru wajib
  menyertakan `company_id`, policy RLS, dan grant untuk `app_user` dalam migrasinya.

**Verifikasi.** `tests/integration/consistency.test.ts` sudah mencakup RLS — perluas: untuk setiap
tabel bisnis, uji sebagai perusahaan B tidak dapat membaca/mengubah baris perusahaan A lewat jalur
aplikasi maupun query langsung sebagai `app_user`. Uji ini adalah gerbang, tidak boleh di-skip.

### 4.4 Validasi input & SQL injection

**Prinsip (OWASP).** Validasi allowlist di batas kepercayaan (tipe, panjang, rentang, format) dan
query terparameter untuk semua akses SQL.
Sumber: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

**Penerapan.**

- Semua input action divalidasi skema Zod (pola `src/server/actions/*.ts`); validasi ulang di lapisan
  domain `src/server/*.ts` untuk invariant bisnis (jumlah > 0, jurnal seimbang, periode terbuka).
- Drizzle query builder terparameter secara default; `sql` mentah hanya untuk ekspresi yang tidak
  mengandung input user secara langsung (contoh sah: `set_config` di `tenant.ts` yang tetap memakai
  placeholder parameter).
- Impor berkas (`src/server/actions/import.ts`, `src/lib/import-parse.ts`, wizard impor): perlakukan
  isi XLSX/CSV sebagai tidak tepercaya — batas ukuran & jumlah baris, validasi per baris dengan
  pratinjau sebelum commit (pola yang sudah ada), tidak ada eksekusi formula dari sel.

**Verifikasi.** Uji unit untuk parser impor dengan berkas jahat (formula, baris raksasa, encoding
rusak) di `tests/unit/import-parse.test.ts`; uji integrasi injeksi pada parameter pencarian katalog
(string `' OR 1=1 --` tidak mengubah hasil di luar pencarian literal).

### 4.5 Idempotency & integritas dokumen

**Prinsip.** Operasi yang dapat di-retry jaringan/klien harus aman diulang: kunci idempotency unik per
operasi membuat pengulangan menghasilkan hasil yang sama, bukan dokumen ganda. (Praktik ini pasangan
dari kontrol logika bisnis & integritas alur kerja pada ASVS.)
Sumber kerangka: https://owasp.org/www-project-application-security-verification-standard/

**Penerapan (sudah menjadi aturan proyek — pertahankan).**

- Checkout POS dan posting jurnal memakai idempotency key (`src/server/pos.ts`,
  `src/server/accounting.ts`: kolom `idempotencyKey` pada jurnal; reversal memakai kunci deterministik
  `reversal:<id>`), dengan constraint unik di skema (`src/db/schema.ts`).
- Dokumen final (jurnal posted, penjualan selesai, stok bergerak) append-only: koreksi hanya lewat
  jurnal pembalik / dokumen retur / void beralasan — tidak ada `update`/`delete` pada baris posted;
  penjaga di level database (trigger/migrasi guard) plus pola kode.

**Verifikasi.** Uji integrasi: submit checkout yang sama 2× (paralel dan berurutan) → 1 penjualan,
1 jurnal seimbang, stok berkurang sekali; reversal 2× → 1 jurnal pembalik.

### 4.6 Audit log & logging yang aman

**Prinsip (OWASP Logging Cheat Sheet).** Catat peristiwa keamanan & bisnis penting (siapa, apa,
kapan, pada objek apa, hasil berhasil/gagal) untuk rekonstruksi; **jangan pernah** mencatat kredensial,
token sesi, atau data sensitif lain ke log; lindungi log dari perubahan.
Sumber: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

**Penerapan.**

- `writeAudit` (`src/server/audit.ts`) wajib dipanggil dalam transaksi yang sama untuk:
  penjualan/void/retur POS, perubahan stok manual (penyesuaian/opname), posting & reversal jurnal,
  tutup/kunci periode, perubahan pengaturan & pemetaan akun, manajemen user/peran.
  Baris audit membawa `companyId`, `userId`, `action`, `entityType`, `entityId`, `before`/`after`,
  `requestId`, `ip` — jangan menambah field berisi password/token/secret ke `before`/`after`.
- `audit_log` bersifat append-only (konsisten dengan aturan append-only proyek); retensi & ekspor
  audit adalah fitur halaman Pengaturan/Akuntansi, bukan penghapusan.
- Error ke klien tidak membocorkan detail internal (lihat §1.3); detail teknis hanya di log server
  tanpa data sensitif.

**Verifikasi.** Uji integrasi: setiap aksi sensitif di atas menghasilkan tepat 1 baris audit dengan
aktor benar; grep kode & uji snapshot payload audit memastikan tidak ada kunci bernama
password/token/secret yang tercatat.

### 4.7 Sesi & autentikasi

**Prinsip.** Ikuti panduan resmi Next.js (sesi terverifikasi di DAL, bukan hanya middleware/proxy)
dan WCAG 3.3.8 (login dapat diakses).
Sumber: https://nextjs.org/docs/app/guides/authentication dan https://www.w3.org/TR/WCAG22/

**Penerapan.** Better Auth (`src/lib/auth.ts`, `src/app/api/auth/[...all]/route.ts`) tetap satu-satunya
jalur autentikasi; `requireAuth`/`requirePermission` di `src/lib/session.ts` membaca ulang peran/izin
dari database setiap request (perilaku saat ini — perubahan peran langsung berlaku). Form login
(`src/components/auth/login-form.tsx`) mengizinkan paste & password manager (tanpa
`onPaste` blocker, tanpa CAPTCHA kognitif).

**Verifikasi.** Uji: sesi dicabut/ peran diturunkan → request berikutnya langsung ditolak; login gagal
berulang tidak membocorkan apakah email terdaftar (pesan generik).

---

## 5. Lima Keputusan Terpenting (ringkasan eksekutif)

1. **Target konformansi WCAG 2.2 AA dengan gerbang axe = 0 critical/serious** di route utama tiap
   modul — kontras, fokus tidak tertutup, target sentuh, dan label teks untuk semua status adalah
   perbaikan token/pola di `globals.css`, `components/ui`, dan `components/blocks`, bukan per halaman.
2. **Tambahkan streaming sekarang:** belum ada satu pun `loading.tsx`/`<Suspense>` di `src/app` —
   skeleton per segmen daftar adalah peningkatan performa-terasa terbesar dengan risiko terkecil,
   tanpa mengubah kesegaran data (`force-dynamic` tetap).
3. **Pagination keyset untuk daftar yang tumbuh tanpa batas** (pergerakan stok, jurnal, buku besar,
   riwayat, audit) dengan indeks komposit sesuai `ORDER BY`, digerbang `EXPLAIN (ANALYZE, BUFFERS)`
   pada fixture 10.000 produk; offset hanya untuk daftar master dangkal dengan cap.
4. **POS barcode-first + anti-dobel-submit:** scanner Enter-terminated (standar Odoo), fokus yang
   selalu kembali ke input barcode, dan idempotency key pada checkout — kecepatan dan pencegahan
   penjualan ganda diukur dengan Playwright, bukan dirasakan.
5. **Pertahankan & uji pertahanan berlapis yang sudah ada** — `requirePermission` di setiap action +
   `withCompany`/RLS di setiap query + `writeAudit` di setiap aksi sensitif; penambahan action/tabel
   baru tanpa ketiganya adalah cacat P0 yang memblokir gerbang fase.

---

## 6. Checklist Gerbang Kualitas per Fase Modul

Fase dinyatakan lolos hanya bila **semua** butir pada fasenya tercentang dengan bukti
(output test/EXPLAIN/tangkapan Playwright), bukan klaim.

### 6.0 Gerbang Fondasi (sekali, sebelum fase modul)

- [ ] `playwright.config.*` + `@axe-core/playwright` terpasang; script `test:e2e` berjalan.
- [ ] Token kontras `globals.css` lolos rasio WCAG 1.4.3/1.4.11 (laporan axe pada halaman login & shell).
- [ ] `loading.tsx` skeleton tersedia untuk segmen daftar utama; navigasi ter-throttle menampilkan
      skeleton < 1 dtk.
- [ ] Fixture performa siap: `pnpm db:seed:bulk` (10.000 produk) dapat dibuat ulang dari nol.
- [ ] Uji integrasi RLS lintas-tenant hijau untuk semua tabel bisnis yang ada.

### 6.1 Fase POS

- [ ] Scan barcode (burst + Enter) menambah barang < 300 ms pada katalog 10.000 produk; fokus kembali
      ke input barcode setelah setiap dialog.
- [ ] Checkout keyboard-only selesai tanpa mouse; tombol utama ≥ 44×44 CSS px di 1024×768.
- [ ] Dobel-klik / submit ulang checkout (idempotency key sama) → tepat 1 penjualan, 1 jurnal
      seimbang, stok berkurang sekali (`tests/integration/sale-flow.test.ts` + Playwright).
- [ ] Checkout tanpa sesi terbuka ditolak; tutup sesi menampilkan selisih kas sebelum final.
- [ ] Void/retur wajib izin + alasan; nota asli tidak berubah; cetak ulang nota identik angka server
      (58/80mm tidak terpotong).
- [ ] Axe pada halaman POS & riwayat: 0 critical/serious; pesan error pembayaran tampil inline,
      bukan hanya toast.
- [ ] Tidak ada klaim offline sebelum worker `outbox` berjalan & teruji sinkronisasinya.

### 6.2 Fase Gudang

- [ ] Daftar produk & pergerakan stok memakai keyset pagination; EXPLAIN halaman dalam tanpa Seq Scan
      pada data bulk; waktu halaman dalam ≤ 2× halaman pertama.
- [ ] Fungsi daftar bebas N+1 (≤ 3 statement SQL per panggilan daftar 50 baris, terukur di test).
- [ ] Impor: pratinjau validasi sebelum commit; berkas jahat (formula/oversize/encoding rusak) ditolak
      per baris dengan pesan yang bisa ditindaklanjuti (`tests/unit/import-parse.test.ts` hijau).
- [ ] Penyesuaian/opname/transfer selalu menulis pergerakan stok + audit dalam satu transaksi;
      `stock_on_hand` = jumlah `stock_movements` (uji konsistensi hijau).
- [ ] Form stok keyboard-operable; error stok tidak cukup tampil spesifik (diminta vs tersedia).
- [ ] Pola tabel Carbon terpenuhi: toolbar (search/filter/aksi), header sortable terindeks,
      pagination bar, empty state dengan aksi berikutnya.

### 6.3 Fase Akuntansi

- [ ] Jurnal tidak seimbang / periode tertutup ditolak dengan pesan spesifik (selisih & nama periode);
      jurnal posted tidak bisa diedit/dihapus — hanya reversal tertaut.
- [ ] Laporan (laba rugi, neraca, arus kas) mempertahankan kolom pembanding tahun sebelumnya dan
      pengelompokan akun yang dapat dikonfigurasi (`accounts.section`/`cash_flow_group`); angka laporan
      dapat ditelusuri ke buku besar (drill-through konsisten).
- [ ] Aging piutang/utang berbasis tanggal dokumen (bucket 0–30/31–60/61–90/>90).
- [ ] Halaman laporan stream per seksi (`<Suspense>`); KPI tampil sebelum tabel berat selesai.
- [ ] Query laporan teragregasi di SQL; EXPLAIN untuk laporan periode penuh pada data bulk tanpa
      Seq Scan berulang; tidak ada aritmetika `number` untuk uang (tetap Decimal dari `numeric(19,4)`).
- [ ] Semua aksi akuntansi sensitif (posting, reversal, tutup/kunci periode, ubah pemetaan akun)
      tercatat di `audit_log` dengan aktor & before/after tanpa data sensitif.

### 6.4 Gerbang Lintas Modul (setiap fase, sebelum rilis fase)

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit + integrasi) hijau dengan output nyata tersimpan.
- [ ] Matriks izin: setiap action baru diuji ditolak untuk peran tanpa izin & lintas perusahaan.
- [ ] Uji responsif 8 viewport lolos: tanpa scroll horizontal halaman, tanpa tumpang-tindih elemen kunci.
- [ ] Tidak ada fitur simulasi/lokal yang dilabeli sebagai fitur nyata di UI maupun catatan rilis fase.
- [ ] Temuan yang belum lolos dicatat sebagai daftar sisa eksplisit (bukan disembunyikan).

---

## 7. Daftar Sumber Resmi

- W3C — WCAG 2.2 (normatif): https://www.w3.org/TR/WCAG22/
- W3C — Understanding 1.1.1 Non-text Content: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html
- W3C — Understanding 1.4.3 Contrast (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C — Understanding 1.4.11 Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- IBM Carbon Design System — Data table usage: https://v10.carbondesignsystem.com/components/data-table/usage/
- Atlassian Design — Error messages: https://atlassian.design/foundations/content/designing-messages/error-messages
- Atlassian Design — Section message: https://atlassian.design/components/section-message/usage
- Atlassian Design — Inline message: https://atlassian.design/components/inline-message/usage
- Odoo Documentation — IoT system connection (POS peripherals, barcode scanner Enter/keycode 28): https://www.odoo.com/documentation/saas-18.1/applications/sales/point_of_sale/configuration/pos_iot.html
- Frappe/ERPNext Documentation — POS Workflows (opening/closing entry, POS invoice): https://docs.frappe.io/erpnext/pos-workflows
- Next.js Docs — loading.js (Loading UI & Streaming): https://nextjs.org/docs/app/api-reference/file-conventions/loading
- Next.js Docs — Data Security guide: https://nextjs.org/docs/app/guides/data-security
- Next.js Docs — Authentication guide: https://nextjs.org/docs/app/guides/authentication
- PostgreSQL Documentation — Using EXPLAIN: https://www.postgresql.org/docs/current/using-explain.html
- Drizzle ORM (dokumen resmi, repositori drizzle-team) — Relational Queries: https://github.com/drizzle-team/drizzle-orm-docs/blob/HEAD/src/content/docs/mssql/rqb.mdx
- OWASP — Application Security Verification Standard (ASVS): https://owasp.org/www-project-application-security-verification-standard/
- OWASP — Top 10 A01 Broken Access Control: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- OWASP Cheat Sheet — Access Control: https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html
- OWASP Cheat Sheet — Authorization: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Cheat Sheet — Logging: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Cheat Sheet — SQL Injection Prevention: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
