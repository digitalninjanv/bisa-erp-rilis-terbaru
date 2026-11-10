# Riset Acuan UI/UX Seluruh Sistem — Program A-23

Mandat pengguna 2026-11-05 20:26 WIB: perombakan UI/UX **semuanya, bertahap** —
dari tampilan pertama, sidebar, isolasi modul per klik (klik modul → hanya
tampilan modul itu), visibilitas per peran (kasir hanya bisa POS), workflow
mudah dibaca, fitur mudah dipakai, input mudah (terutama nominal uang
berformat), cepat dan rapi — seperti ERP modern/Odoo — untuk pengguna akhir
karyawan minimarket: **kasir, staf gudang, akuntan, pemilik**. Hasil akhir
yang diminta: sistem minimarket yang mudah dipakai semua peran, arsitektur
kode tetap mudah diperbaiki.

Dokumen ini adalah bahan risetnya. Ia **membangun di atas** riset A-22
(`docs/akuntansi-ux/RISET-ODOO.md`, khusus workflow akuntansi — pola di sana
tidak diulang di sini) dan hasil A-22 yang sudah ter-commit (dashboard antrean
kerja akuntansi, sidebar akuntansi berkelompok, MoneyInput bersama, kartu
responsif). Fokus dokumen ini adalah lapisan yang belum disentuh A-22:
**shell & tampilan pertama, visibilitas per peran, workflow kasir (POS),
workflow gudang, input uang & angka lintas modul, dan kecepatan yang terasa.**

## Metode, keadaan awal terverifikasi, dan catatan kejujuran sumber

- Acuan utama: dokumentasi resmi Odoo 19.0 (odoo.com), dokumentasi resmi
  ERPNext/Frappe (docs.frappe.io), Help Center resmi Square & Shopify POS,
  riset kegunaan Nielsen Norman Group & Baymard Institute, dan buku
  implementator Cybrosys v19 untuk detail yang tidak ada di dokumentasi
  resmi. URL dicantumkan per pola; tidak ada URL karangan.
- Yang tidak dapat diverifikasi dari sumber ditandai **TIDAK TERVERIFIKASI**
  dan dikumpulkan di daftar koreksi kejujuran di akhir dokumen.
- **Keadaan Bisa ERP saat riset (dibaca dari kode, bukan asumsi):**
  - Tiga modul: `pos`, `gudang`, `akuntansi` (+ `pengaturan`), didefinisikan
    di `src/lib/modules.ts` sebagai `MODULES`/`MODULE_LIST` dengan `NavItem`
    ber-`permission` dan `group` (pengelompokan sidebar dari A-22 K5).
  - Shell bersama di `src/components/shell/`: `module-shell.tsx` (sidebar per
    modul + pengalih modul POS/GDG/AKT + breadcrumb "Beranda / Modul"),
    `sidebar-nav.tsx`, `mobile-nav.tsx`, `company-switcher.tsx`,
    `user-menu.tsx`. Sidebar **sudah berganti total per modul** dan itemnya
    tersaring izin — pola dasarnya sudah benar; yang kurang adalah
    pendaratan per peran dan pencarian global.
  - Beranda `/app` (`src/app/app/page.tsx`) menampilkan salam, kartu modul
    yang **sudah tersaring dua lapis** (`ctx.modules` dari peran ∩
    `ctx.enabledModules` saklar perusahaan), ringkasan usaha, dan penjualan
    terakhir — sama untuk semua peran yang punya >1 modul. Halaman ini juga
    sudah membaca parameter `denied`/`disabled` untuk pemberitahuan akses.
  - Setiap layout modul menegakkan `requireModuleAccess("pos" | "gudang" |
    "akuntansi")`; aksi server menegakkan `requirePermission`. Peran bawaan:
    owner, admin, manager, cashier, warehouse, accountant, viewer; peran
    kustom membawa daftar `modules` eksplisit (`src/lib/permissions.ts`).
  - Input uang bersama **sudah ada dan sudah benar polanya**:
    `src/components/money-input.tsx` + `src/lib/money-input.ts` — memformat
    pemisah ribuan id-ID **saat mengetik**, nilai yang dipertukarkan adalah
    string Decimal kanonis, toleran terhadap ketikan-di-tengah, kesalahan
    tampil berbahasa Indonesia di bawah field dan bisa memblokir submit.
  - Pemuatan: halaman `force-dynamic`; ada `loading.tsx` di segmen aplikasi
    dan komponen `src/components/blocks/page-skeleton.tsx`.

---

## Bagian 1 — Shell & tampilan pertama

### Pola S1 — Pendaratan per peran: sesudah login, pengguna langsung masuk aplikasi pekerjaannya

**Masalah yang diselesaikan.** Kasir yang harus melewati Beranda berisi
ringkasan usaha dan kartu modul setiap giliran kerja membuang waktu dan —
lebih buruk — melihat angka yang bukan urusannya. Layar pertama seharusnya
adalah *tempat kerja* peran itu, bukan lobi.

**Interaksi persis di acuan.**
- **Odoo — Home Action per pengguna**: formulir pengguna punya field
  *Home Action* di tab Preferences; dokumentasi sumber Odoo sendiri
  menjelaskannya: *"If specified, this action will be opened at log on for
  this user, in addition to the standard menu."* Praktik yang
  didokumentasikan komunitas resmi Odoo: pengguna POS diberi Home Action =
  aplikasi Point of Sale sehingga login langsung membuka POS.
- **ERPNext — Workspace sebagai rumah modul**: sesudah login pengguna
  disambut Desk dengan sidebar persisten berisi Workspace; setiap Workspace
  adalah halaman modul berisi Shortcuts, Number Cards, dan Cards — pengguna
  bekerja dari workspace modulnya, bukan dari daftar aplikasi global.

**Terapan ke Bisa ERP.** Tambahkan resolusi pendaratan di `src/app/app/
page.tsx` (Beranda): bila `ctx.modules ∩ ctx.enabledModules` berisi **tepat
satu** modul bisnis, redirect server-side langsung ke halaman kerja modul
itu — kasir → daftar sesi/terminal POS (`/app/pos`), warehouse → antrean
operasi gudang (`/app/gudang`), accountant → Ringkasan akuntansi
(`/app/akuntansi`). Bila >1 modul, tetap Beranda peluncur (Pola S2).
Pemilik/admin tidak berubah. Aturannya diturunkan dari data peran yang sudah
ada — tanpa field "home" baru per pengguna (peran kustom sudah membawa
daftar modulnya); bila kelak dibutuhkan pengecualian per orang, tambahkan
sebagai konfigurasi di Pengaturan Pengguna mengikuti pola Home Action.

**Penilaian: ADOPSI PENUH.** Biaya kecil (data peran sudah tersedia),
dampaknya adalah inti mandat "kasir hanya bisa POS": kasir tidak pernah
melihat lobi sama sekali.

Sumber:
- https://www.odoo.com/forum/help-1/initial-app-157260
- https://docs.frappe.io/erpnext/show-hide-modules

### Pola S2 — Beranda peluncur bergaya workspace: kartu modul berisi antrean & pintasan tugas, bukan dashboard campuran

**Masalah yang diselesaikan.** Untuk peran multi-modul (manager, pemilik),
Beranda hari ini adalah dashboard angka campuran. Yang dibutuhkan di lobi
adalah *peluncur*: modul apa yang bisa saya masuki, dan di modul mana ada
pekerjaan menunggu.

**Interaksi persis di acuan.** Workspace ERPNext menyusun setiap modul
sebagai halaman berisi: **Shortcuts** (pintasan ke dokumen/aksi terbanyak),
**Number Cards** (angka antrean yang bisa diklik menuju daftar tersaring),
dan **Cards** (kelompok tautan). A-22 sudah membuktikan pola Number Card
versi akuntansi (kartu "Antrean kerja" di Ringkasan akuntansi).

**Terapan ke Bisa ERP.** Beranda multi-peran mempertahankan kartu modul yang
sudah tersaring peran, tetapi isi kartunya diganti dari deskripsi statis
menjadi ringkasan antrean modul itu: POS — sesi terbuka & penjualan hari
ini; Gudang — penerimaan menunggu, opname berjalan, stok menipis; Akuntansi —
memakai angka antrean yang sama dengan dashboard K5 (satu fungsi baca,
dipakai dua tempat). Pintasan tugas terbanyak per modul (Catat Transaksi,
Penerimaan baru, Buka sesi) tampil di kartu. Ringkasan usaha & penjualan
terakhir yang sekarang memenuhi Beranda turun menjadi satu strip ringkas —
atau pindah ke kartu Akuntansi/POS; pemilik yang butuh angka tetap
menemukannya di dalam modul.

**Penilaian: ADOPSI SEBAGIAN.** Struktur kartunya diadopsi; jangan
menyalin kebebasan kustomisasi workspace ERPNext (pengguna menyusun ulang
kartunya sendiri) — untuk minimarket, susunan tetap yang dirancang baik
lebih mudah dipakai daripada yang bisa diutak-atik.

Sumber:
- https://docs.frappe.io/erpnext/show-hide-modules
- https://github.com/kannan19302/unierp/blob/HEAD/workspace/governance/strata-penpot-2026-09-05/REFERENCE-RESEARCH.md

### Pola S3 — Sidebar milik modul aktif + pengalih modul yang ringkas dan konsisten

**Masalah yang diselesaikan.** Mandat pengguna persis: "ketika klik modul
ya tampilannya itu aja". Sidebar yang mencampur semua modul membuat
pengguna tersesat; pengalih modul yang tidak konsisten membuat pindah modul
terasa seperti pindah aplikasi lain.

**Interaksi persis di acuan.** Di Odoo, menu yang tampil adalah menu
**aplikasi aktif**; berpindah aplikasi lewat *app switcher* (ikon grid di
kiri atas) yang membuka daftar aplikasi — dan menu aplikasi terikat ke grup
akses (`menu_access` pada grup): aplikasi di luar grup tidak muncul di
switcher sama sekali. ERPNext memakai sidebar persisten berisi daftar
Workspace; memilih satu mengganti seluruh isi halaman kerja ke workspace
itu.

**Keadaan Bisa ERP & terapan.** Pola ini **sudah teradopsi secara struktur**:
`module-shell.tsx` mengganti sidebar total per modul dan pengalihnya berupa
tab POS/GDG/AKT yang tersaring peran. Yang dikerjakan tahap shell:
(a) breadcrumb tuntas di semua halaman ketiga modul ("Beranda / Modul /
Halaman" — sekarang baru sebagian permukaan); (b) di drawer mobile,
pengalih modul tampil sebagai daftar modul terlihat-peran di kepala drawer
(bukan hanya tab kecil), mengikuti perbaikan portal drawer A-22 K5;
(c) modul yang dinonaktifkan perusahaan tidak dirender sama sekali di
pengalih (sudah menjadi perilaku `enabledModules` — jadikan teruji);
(d) judul modul + ikon konsisten di kepala sidebar setiap modul.

**Penilaian: SUDAH TERADOPSI — tahap penguatan & konsistensi**, bukan
pembangunan ulang. Mencatat ini penting agar tahap tidak menghabiskan
anggaran untuk membangun yang sudah ada.

Sumber:
- https://www.odoo.com/documentation/master/applications/essentials/keyboard_shortcuts.html
- https://docs.frappe.io/erpnext/show-hide-modules

### Pola S4 — Command palette / pencarian global (Ctrl+K): melompat ke menu & aksi tanpa berburu sidebar

**Masalah yang diselesaikan.** Akuntan dan pemilik (pengguna daya) bekerja
lintas modul sepanjang hari; navigasi klik-sidebar untuk setiap lompatan
(document → pengaturan → laporan) lambat. Pengguna baru juga tidak tahu
suatu fitur tinggal di modul mana.

**Interaksi persis di acuan.** Dokumentasi pintasan resmi Odoo: **Ctrl+K**
(Command+K di macOS) membuka *command palette*; mengetik `/` mencari menu,
aplikasi, dan modul; `@` mencari pengguna; `#` saluran Discuss; `?` artikel
Knowledge; panah atas/bawah memilih, Enter membuka, Ctrl+Enter membuka di
tab baru. Pintasan lain yang terdokumentasi: Alt+Q fokus pencarian, Alt+1..9
memilih menu.

**Terapan ke Bisa ERP.** Komponen klien baru di shell (`module-shell.tsx`):
palette Ctrl+K yang mengindeks **seluruh `NavItem` dari modul yang terlihat
oleh peran pengguna** (sumber datanya definisi yang sama dengan sidebar —
satu sumber kebenaran, tanpa indeks terpisah yang bisa basi) ditambah aksi
cepat global (Catat Transaksi `N` yang sudah ada, Jurnal baru, Produk baru,
Penerimaan baru) yang masing-masing tunduk pada izinnya. Hasil tersaring
peran secara konstruksi: menu modul terlarang tidak pernah masuk indeks —
pelajaran langsung dari ERPNext bahwa workspace tersembunyi tetap bocor
lewat pencarian bila izinnya ada; di sini indeks dibangun dari daftar yang
sudah tersaring `ctx.modules` + `permission` item. Di permukaan sentuh,
palette diakses dari tombol cari di topbar (bukan pintasan saja).

**Penilaian: ADOPSI PENUH untuk desktop; pendamping (bukan pengganti)
navigasi sentuh.** Ini pola berdampak terbesar bagi akuntan/pemilik.

Sumber:
- https://www.odoo.com/documentation/master/applications/essentials/keyboard_shortcuts.html
- https://doc.eyssen.com/applications/essentials/keyboard_shortcuts.html

---

## Bagian 2 — Visibilitas per peran

### Pola S5 — Dua lapis yang tidak dicampur: disembunyikan untuk kerapian, dilarang untuk keamanan

**Masalah yang diselesaikan.** Menyembunyikan menu tanpa menegakkan izin
memberi rasa aman palsu (URL langsung tetap membuka); menegakkan izin tanpa
menyembunyikan membuat antarmuka staf operasional penuh hal yang tidak
relevan dan menakutkan.

**Interaksi persis di acuan.** Dokumentasi resmi ERPNext merumuskannya
paling tajam: pisahkan lima kontrol yang berbeda tujuan — Domain Settings
(domain aktif satu situs), **Role Permissions** (DocType apa yang bisa
dibuka peran), User Permissions (record mana di dalam DocType), **Workspace
configuration** (apa yang tampil di navigasi), Module Settings (perilaku
proses) — dan memperingatkan: *"A hidden shortcut is a cleaner interface; a
denied permission is access control"*, serta mewajibkan verifikasi dengan
akun berperan sama: dokumen terlarang tidak boleh bisa dibuka **lewat
pencarian maupun rute langsung**, bukan sekadar kartunya tidak ada.

**Keadaan Bisa ERP & terapan.** Dua lapis ini **sudah menjadi arsitektur**:
navigasi tersaring `permission` per item + `requireModuleAccess` di layout
modul + `requirePermission` di aksi server. Pekerjaan tahap peran adalah
menutup tepi-tepinya:
(a) **Pendaratan manis saat ditolak**: membuka URL modul terlarang
mendarat di Beranda dengan pemberitahuan yang jelas (Beranda sudah membaca
parameter `denied`/`disabled` — pastikan *semua* penolakan dari ketiga
layout modul mengarah ke sana, bukan halaman error);
(b) **matriks uji per peran**: untuk setiap peran bawaan, uji otomatis bahwa
(i) Beranda hanya memuat modulnya, (ii) URL langsung modul lain tertolak
manis, (iii) palette Ctrl+K tidak memuat menu terlarang — memperlakukan
visibilitas sebagai kontrak teruji, bukan kesan visual;
(c) peran kustom: halaman Pengaturan Pengguna menampilkan pratinjau
"pengguna ini akan melihat: [daftar modul & menu]" diturunkan dari definisi
yang sama, agar pemilik tidak menebak hasil konfigurasinya.

**Penilaian: ADOPSI PENUH sebagai standar + kontrak uji.** Tidak ada
mekanisme baru; yang baru adalah kelengkapan tepi dan buktinya.

Sumber:
- https://docs.frappe.io/erpnext/show-hide-modules

### Pola S6 — "Satu pekerjaan = satu aplikasi" untuk staf operasional: mode fokus terminal & mode operasi

**Masalah yang diselesaikan.** Kasir dan staf gudang bekerja dalam satu
tugas berulang berjam-jam. Shell ERP lengkap (pengalih modul, menu
pengaturan, ringkasan usaha) di sekitar tugas itu adalah gangguan dan
sumber salah-klik; mereka butuh aplikasi tunggal yang memenuhi layar.

**Interaksi persis di acuan.**
- **Odoo POS**: register adalah antarmuka tersendiri, terpisah dari backend
  — dibuka dari kartu POS lewat *Open Register* (dengan *Opening Control*
  untuk kas awal), dan di dalamnya hanya ada Register, Orders, dan aksi
  register. Tingkat akses POS sendiri berlapis (Employee Minimal/Basic/
  Advanced; User; Manager), dan karyawan **tanpa akun basis data** pun bisa
  mengoperasikan register sesudah dibuka pengguna berakun — pekerjaan kasir
  tidak mensyaratkan akun ERP penuh.
- **Square POS**: aplikasi menyediakan *modes* per tipe usaha (standar,
  retail, restoran, dll.) yang "membawa Anda langsung ke fitur yang
  dibutuhkan", dan pada desain ulangnya, hal di luar checkout disembunyikan
  di bawah tab "More" agar layar jual bersih.

**Terapan ke Bisa ERP.** Terminal POS (`src/components/pos/pos-terminal.tsx`,
rute di `src/app/app/pos/`) disajikan sebagai **mode fokus**: tanpa pengalih
modul dan tanpa sidebar modul — kepala terminal hanya memuat identitas sesi,
kasir, status antrean sinkron, dan jalan keluar yang jelas (Tutup sesi /
Kembali). Digabung Pola S1, kasir berperan `cashier` secara efektif *hidup*
di aplikasi ini. Prinsip yang sama untuk gudang diwujudkan sebagai Mode
Operasi (Pola G1), bukan shell kedua. Pengaturan & laporan POS tetap di
shell modul biasa untuk manager.

**Penilaian: ADOPSI PENUH untuk POS; SEBAGIAN untuk gudang** (mode di dalam
modul, bukan aplikasi terpisah — staf gudang masih berpindah ke daftar
produk/pemasok yang hidup di shell modul).

Sumber:
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html
- https://squareup.com/us/en/point-of-sale

### Pola S7 — Izin tingkat bidang untuk data sensitif: yang boleh melihat angka ≠ yang boleh menjalankan tugas

**Masalah yang diselesaikan.** Staf perlu *menjalankan* tugas yang
menyentuh angka sensitif (harga pokok, margin, batas diskon) tanpa perlu
*melihat* angkanya; menampilkan semuanya ke semua peran membocorkan data
dan membebani layar.

**Interaksi persis di acuan.**
- **ERPNext Perm Levels**: field diberi level izin; peran tanpa baris izin
  di level itu melihat field tersembunyi atau read-only **di dalam dokumen
  yang tetap bisa ia buka** — contoh resmi: staf HR melihat data karyawan,
  rincian gaji hanya untuk peran payroll.
- **Odoo POS Price Control**: pengaturan POS yang membuat hanya pengguna
  berakses Administrator POS yang boleh mengubah harga di register —
  kemampuan tugasnya dipisah per peran di titik aksinya.

**Keadaan Bisa ERP & terapan.** Benihnya sudah ada dan terbukti: kutipan POS
tidak membocorkan harga pokok ke kasir (`includeCost` bawaan mati sejak
FIX-POS), hak diskon mengikuti peran kasir asal pada sinkronisasi offline,
dan izin dibaca lewat `src/server/member-permissions.ts`. Tahap ini
menjadikannya **prinsip tertulis + sapuan audit permukaan**: setiap kolom/
panel berisi harga pokok, margin, atau nilai persediaan di daftar POS &
Gudang dinyatakan eksplisit izinnya (tampil untuk peran berizin, hilang —
bukan tertutup abu-abu — untuk yang tidak), mengikuti satu helper yang sama
agar tidak tersebar sebagai keputusan per halaman.

**Penilaian: ADOPSI SEBAGIAN.** Prinsip dan sasarannya diadopsi; **sistem
perm-level umum ala ERPNext DITOLAK** — model izin per-tindakan + daftar
modul yang sudah dimiliki proyek menampung kebutuhan minimarket tanpa
lapisan metada field baru.

Sumber:
- https://docs.frappe.io/erpnext/perm-levels
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html

---

## Bagian 3 — Workflow kasir (POS)

### Pola P1 — Tiga zona tetap terminal: pemilih produk | keranjang | numpad aksi yang mengikuti baris terpilih

**Masalah yang diselesaikan.** Terminal yang menyebar fungsi edit (qty di
satu tempat, diskon di dialog lain, harga di tempat ketiga) melatih kasir
berburu. Satu numpad dengan mode yang mengikuti konteks membuat semua edit
angka terjadi di satu tempat yang sama.

**Interaksi persis di acuan.** Dokumentasi resmi Odoo 19: *"The POS register
is divided into three sections: the product selector, the cart to visualize
the products added to the order, and the numpad for order actions."* Numpad
bermode: klik produk untuk menambah; **Qty** lalu angka mengubah jumlah;
**%** lalu angka memberi diskon; **Price** lalu angka mengubah harga — semua
pada baris yang sedang terpilih di keranjang. Sesudah selesai: **Payment**
→ pilih metode → **Validate**; layar struk menawarkan *New Order* untuk
antrean berikutnya.

**Terapan ke Bisa ERP.** `src/components/pos/pos-terminal.tsx` dengan
`cart-panel.tsx` & `payment-panel.tsx`: pertahankan dua panel yang sudah
ada (hasil pemecahan A-17) dan samakan bahasa editnya ke pola numpad
bermode — baris keranjang terpilih adalah konteks tunggal untuk qty,
diskon baris, dan harga (bila izin mengubah harga ada, Pola S7); total,
diskon, dan pajak selalu terlihat di kaki keranjang tanpa menggulir.
Pembayaran mengikuti alur Payment → metode → Validate yang sama.

**Penilaian: ADOPSI PENUH sebagai bahasa interaksi terminal.** Ini
standarisasi perilaku komponen yang sudah ada, bukan pembangunan terminal
baru.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html

### Pola P2 — Scan & cari dominan, kategori awal terkonfigurasi

**Masalah yang diselesaikan.** Di minimarket, mayoritas barang masuk
keranjang lewat barcode; pencarian adalah jalan cadangan, dan kategori
adalah jalan ketiga. Terminal yang memperlakukan ketiganya setara
membuang detik di setiap transaksi.

**Interaksi persis di acuan.** Header register Odoo memuat bilah pencarian
produk dan ikon barcode untuk memakai webcam sebagai pemindai; konfigurasi
POS menyediakan **Start Category** (kategori yang tampil bawaan saat
register dibuka) dan **Restrict Categories** (membatasi kategori yang
tampil). Shopify POS menempatkan pencarian dan pemindai kamera di layar
jualan yang sama, dan Quick Sale-nya menerima barang lewat ketuk, cari,
atau kamera.

**Keadaan Bisa ERP & terapan.** Pemindai burst sudah hidup
(`src/components/pos/use-barcode-scanner.ts`, `src/lib/barcode-burst.ts`)
dan pemecahan dua panel ≥lg sudah ada. Yang distandarkan: (a) fokus kembali
ke pencarian/scan secara otomatis saat terminal dibuka, sesudah pembayaran
selesai, dan sesudah dialog apa pun ditutup — fokus tidak pernah "hilang"
ke badan halaman; (b) kategori awal terminal menjadi **konfigurasi per
perusahaan** (kategori bawaan yang ditampilkan, mengikuti prinsip proyek
bahwa perilaku adalah konfigurasi bukan konstanta kode); (c) hasil
pencarian bisa di-Enter untuk langsung menambah hasil teratas ke keranjang.

**Penilaian: ADOPSI PENUH.** Mayoritas isinya penegakan perilaku fokus &
satu konfigurasi baru.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html
- https://help.shopify.com/en/manual/shopify-admin/shopify-app/quick-sale?utm_source=w26-editions-website&utm_medium=product-cta&utm_campaign=winter26edition

### Pola P3 — Grid favorit yang bisa disusun pemilik usaha (item grid / smart grid)

**Masalah yang diselesaikan.** Barang terlaris minimarket (rokok, mi
instan, pulsa, kantong plastik) sering tanpa barcode yang praktis atau
dibeli berbarengan; mencarinya per transaksi membuang waktu. Grid favorit
membuatnya satu ketuk.

**Interaksi persis di acuan.**
- **Square item grid** (dokumentasi resmi Square): grid checkout tersusun
  dari *tile* — **Item** (satu ketuk masuk keranjang; tile item berstok
  menampilkan jumlah stoknya), **Variation**, **Category** (membuka daftar
  isi kategori), **Custom amount** (memasukkan harga unik tanpa pindah
  layar), dan **Shortcut** (diskon, pelanggan, bersihkan keranjang, dll.).
  Grid disusun dari layar checkout itu sendiri dan bisa disinkronkan antar
  lokasi.
- **Shopify POS smart grid**: tile yang ditambahkan pemilik — *Add custom
  sale*, *Apply discount*, biaya kustom — menjadi bagian layar jualan.

**Terapan ke Bisa ERP.** Modul POS sudah punya rute `pos/grup` (grup
pelanggan & harga) — jangan dicampur: bangun **"Favorit terminal"** sebagai
konfigurasi per perusahaan di area POS (disusun manager: daftar produk/
kategori/nominal-kustom terpilih + urutannya), dirender sebagai pita tile
di panel produk terminal. Tile nominal kustom menampung barang harga-terbuka
dengan MoneyInput keypad (Pola U3). Penyusunan lewat form daftar biasa di
halaman pengaturan POS — **bukan** drag-and-drop di terminal (terminal
harus tetap bodoh dan cepat; penyusunan adalah pekerjaan manager sesekali).

**Penilaian: ADOPSI SEBAGIAN.** Grid & jenis tile-nya diadopsi; kustomisasi
di tempat (edit grid dari layar jual, sinkronisasi multi-perangkat ala
Square) ditolak untuk tahap ini — satu perusahaan minimarket tidak
membutuhkannya.

Sumber:
- https://squareup.com/help/us/en/article/8334-set-up-item-grid
- https://help.shopify.com/en/manual/sell-in-person/shopify-pos/process-sales-transaction?utm%5C%5C_campaign=Gurus&utm%5C%5C_medium=link&utm%5C%5C_source=gurucopy

### Pola P4 — Pembayaran satu-dua ketuk: metode teratas yang cerdas, nominal cepat, kembalian hidup

**Masalah yang diselesaikan.** Detik terlama di kasir adalah pembayaran
tunai: mengetik nominal yang diterima, menghitung kembalian di kepala,
membuka laci. Setiap ketukan yang dihapus di sini terasa di antrean.

**Interaksi persis di acuan.** Odoo: dari keranjang satu klik **Payment**;
metode dipilih; untuk tunai, konfigurasi **Prefill Cash Payment** membuat
nominal terisi persis jumlah terutang ("behave similarly to bank payment
input"); **Validate** menyelesaikan, struk tercetak/terkirim, *New Order*
memulai berikutnya. Square memungkinkan urutan & pilihan tender di checkout
disusun (*custom tender*), dan Quick Sale Shopify menyelesaikan pembayaran
dalam aliran Collect → metode → selesai dengan total selalu tampil ke
pelanggan.

**Keadaan Bisa ERP & terapan.** Chip **Uang Pas** sudah ada sejak A-8.
Perluas di `payment-panel.tsx`: (a) chip pecahan tunai Indonesia di atas
nominal diterima — Uang Pas, Rp50.000, Rp100.000, Rp200.000 — mengetuk chip
mengisi nominal diterima dan **kembalian dihitung hidup dan ditampilkan
sebesar tombol Bayar/Selesaikan** (kembalian adalah angka yang paling perlu
dibaca kasir, bukan catatan kaki kecil); (b) metode pembayaran terakhir
dipakai pada sesi itu menjadi pilihan awal (kebiasaan sesi, bukan
konfigurasi); (c) sesudah pembayaran berhasil, layar sukses menawarkan
transaksi berikutnya dalam satu ketuk dan fokus kembali ke scan (Pola P2).

**Penilaian: ADOPSI PENUH.** Seluruhnya perluasan panel pembayaran yang ada.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html
- https://www.cybrosys.com/odoo/odoo-books/v19/point-of-sale/opening-a-shop-session/

---

## Bagian 4 — Workflow gudang ritel

### Pola G1 — Mode Operasi scan-first: antrean operasi sebagai kartu, dokumen dibuka dengan memindai barcode-nya

**Masalah yang diselesaikan.** Staf gudang bekerja berdiri, satu tangan
memegang pemindai. Daftar dokumen bergaya tabel-desktop dengan kolom
sempit dan tombol kecil tidak bisa dipakai dalam posisi itu; mereka juga
tidak seharusnya *mencari* dokumen — dokumenlah yang datang lewat
barcode-nya (nomor penerimaan/transfer tercetak).

**Interaksi persis di acuan.** Aplikasi **Barcode** Odoo (dokumentasi resmi
19): membuka aplikasi menampilkan pemindai; tombol **Operations** membuka
daftar operasi (Receipts, Internal Transfers, Delivery Orders, dsb.)
sebagai kartu; **memindai barcode operasi membuka dokumen operasi itu**;
di dalamnya, memindai produk menambah/memvalidasi baris; perintah barcode
dan — baru di 19 — *instruksi yang jelas untuk penerimaan, transfer
internal, dan pengiriman tersedia langsung di dalam aplikasi Barcode*.
Alur RFID resmi menunjukkan pola yang sama: buka operasi (atau pindai
barcode operasinya) → pindai produk → validasi di perangkat genggam.

**Terapan ke Bisa ERP.** Tambahkan rute **`/app/gudang/operasi`** — Mode
Operasi di dalam modul Gudang (bukan modul baru): halaman antrean berisi
kartu besar ramah-sentuh untuk operasi yang menunggu (penerimaan dari
pembelian, transfer menunggu diterima, opname berjalan), satu input scan
yang selalu fokus memakai pendengar burst yang **sama** dengan POS
(generalisasi `src/lib/barcode-burst.ts` keluar dari konteks POS menjadi
utilitas bersama dengan prasetel perilaku per konteks), dan setiap kartu/
dokumen membuka tampilan kerjanya. Dokumen & domain yang ada
(`gudang/penerimaan`, `gudang/transfer`, `gudang/dokumen`) tetap menjadi
mesinnya — Mode Operasi adalah lapisan presentasi terpandu di atasnya,
mengikuti aturan proyek bahwa halaman membaca lewat fungsi baca modul
server pemilik.

**Penilaian: ADOPSI PENUH sebagai lapisan presentasi.** Ini pola berdampak
terbesar untuk gudang, dan prasyarat teknisnya (burst scanner, dokumen
terposting terstruktur) sudah dimiliki proyek.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/scan_rfid.html
- https://www.cybrosys.com/odoo/odoo-books/v19/barcode/

### Pola G2 — Pengerjaan dokumen terpandu: progres per baris terlihat, validasi digerbang ringkasan selisih

**Masalah yang diselesaikan.** Penerimaan/transfer gagal secara diam-diam
dalam dua arah: divalidasi padahal barang kurang (stok tercatat lebih dari
fisik), atau staf takut memvalidasi karena tidak tahu mana yang belum
sesuai. Keduanya hilang bila progres dan selisih selalu terlihat dan
validasi melewati satu gerbang ringkasan.

**Interaksi persis di acuan.** Pada aplikasi Barcode Odoo, memindai produk
memperbarui kuantitas baris di tempat; buku implementasi v19 mencatat
perilaku gerbangnya: menekan **Validate** dengan kuantitas belum mencukupi
memunculkan peringatan untuk melengkapi dulu. Di dokumen Inventory,
penerimaan yang kurang dari pesanan melahirkan sisa pesanan (backorder)
secara eksplisit — kekurangan menjadi dokumen lanjutan bernama, bukan
selisih yang hilang. Konsep operasi bertahap (terima sebagian → selisih
tercatat) juga sudah menjadi perilaku domain transfer Bisa ERP sejak
FIX-GDG (`transfer_difference`).

**Terapan ke Bisa ERP.** Halaman kerja penerimaan (`gudang/penerimaan/[id]`)
dan penerimaan transfer (`gudang/transfer/[id]`) dalam Mode Operasi (G1)
maupun shell biasa menampilkan, per baris: **diminta · terkonfirmasi ·
selisih** dengan warna status; tombol Terima/Validasi membuka ringkasan
selisih (ConfirmDialog bersama yang sudah ada) bila ada selisih ≠ 0 —
menyebutkan baris mana kurang/lebih dan apa akibatnya (terima sebagian /
selisih tercatat) — dan langsung aktif tanpa dialog bila semua baris pas.
Dalam Mode Operasi, konfirmasi kuantitas per scan mengikuti perilaku
opname yang sudah ada: scan menambah 1, ketuk baris untuk koreksi jumlah
besar.

**Penilaian: ADOPSI PENUH.** Mesin domain (terima sebagian, selisih
tercatat, void berantai) sudah selesai sejak A-17; ini murni penyajian
terpandu di atasnya.

Sumber:
- https://www.cybrosys.com/odoo/odoo-books/v19/barcode/
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/adjustments.html

### Pola G3 — Opname sebagai tugas: ditugaskan, terjadwal per lokasi, dan buta secara bawaan

**Masalah yang diselesaikan.** Opname yang "dilakukan siapa saja kapan
sempat atas semua produk" tidak pernah selesai dan hasilnya bias bila yang
menghitung melihat angka sistem sambil menghitung.

**Interaksi persis di acuan.** Dokumentasi resmi Odoo 19 (penyesuaian lewat
Barcode): manajer **menugaskan hitungan** — memilih lokasi & produk dan
*Assign to* pengguna beserta tanggal terjadwal; pengguna yang ditugasi
melihat hitungan tertunda saat membuka aplikasi Barcode (tombol *Count
Inventory* memuat jumlah produk yang harus dihitung). Di lokasi hitungan:
pindai barcode lokasi, lalu pindai produk; kuantitas disesuaikan dengan
tombol **+1/−1** atau tombol angka. **Kuantitas ekspektasi TIDAK ditampilkan
secara bawaan** — menampilkannya adalah pilihan eksplisit per permintaan
hitung (*Show Expected Quantity* pada jendela Request a Count). Terpisah,
*cycle counts* menjadwalkan hitungan berulang per lokasi lewat *Inventory
Frequency* (hari) pada lokasi; tanggal berikutnya terpasang otomatis
sesudah hitungan diterapkan.

**Keadaan Bisa ERP & terapan.** Hitung buta **sudah dibangun** (FIX-GDG T4:
lembar hitung tanpa stok sistem, stok dibuka hanya lewat tindakan eksplisit
— persis bawaan Odoo di atas). Yang ditambahkan di `gudang/opname` +
`gudang/opname/lembar-hitung`: (a) **penugasan** — opname dibuat dengan
penanggung jawab (pengguna berperan warehouse) dan cakupan (gudang/
kategori), dan Mode Operasi (G1) menampilkan "tugas saya" untuk yang
ditugasi; (b) **frekuensi hitung per gudang/kategori** sebagai konfigurasi
pengingat (opname berikutnya jatuh tempo tampil sebagai kartu antrean di
dashboard Gudang) — bukan mesin penjadwalan otomatis penuh.

**Penilaian: ADOPSI SEBAGIAN.** Penugasan & hitung buta diadopsi penuh;
penjadwalan siklus otomatis ala Odoo diturunkan menjadi pengingat
berkonfigurasi — volume satu minimarket tidak menjustifikasi mesin jadwal
per lokasi.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/adjustments.html
- https://www.odoo.com/documentation/19.0/ja/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html

### Pola G4 — Penyesuaian stok selalu beralasan dan bernilai uang di muka

**Masalah yang diselesaikan.** Penyesuaian tanpa alasan adalah lubang
audit klasik ritel (selisih hilang tak terlacak), dan persetujuan buta
tanpa nilai rupiah membuat ambang persetujuan tidak terasa.

**Interaksi persis di acuan.** Pada alur *Physical Inventory* Odoo,
menerapkan penyesuaian membuka jendela yang mewajibkan konteks hitungan
(*Inventory Reason* dan tanggal hitung pada pop-up *Apply/Request a
Count*); penyesuaian tercatat sebagai dokumen dengan penanggung jawabnya.

**Terapan ke Bisa ERP.** `gudang/penyesuaian`: alasan dipilih dari daftar
terkonfigurasi per perusahaan (Rusak, Kedaluwarsa, Hilang, Koreksi hitung,
Lainnya + teks) — konfigurasi, bukan daftar mati di kode; form menampilkan
**nilai selisih dalam rupiah** (selisih × harga pokok) saat baris diisi,
dan hubungannya dengan ambang persetujuan yang sudah ada (penyesuaian di
atas ambang memerlukan persetujuan — perilaku domain FIX-GDG) dinyatakan di
form sebelum simpan, bukan sebagai penolakan sesudahnya.

**Penilaian: ADOPSI PENUH (penyajian).** Domain penyesuaian & ambangnya
sudah ada; yang dibangun adalah alasan terkonfigurasi dan visibilitas nilai.

Sumber:
- https://www.cybrosys.com/odoo/odoo-books/v19/inventory/operations/

---

## Bagian 5 — Input uang & angka

### Pola U1 — Format ribuan saat mengetik, nilai kanonis terpisah dari tampilan, satu komponen untuk semua

**Masalah yang diselesaikan.** Nominal mentah "1500000" adalah sumber
kesalahan input termahal di ERP ritel: nol kelebihan/kurang satu mengubah
nilai sepuluh kali lipat, dan pengguna tidak bisa memeriksa ketikannya
sekilas.

**Bukti dari riset kegunaan.** Baymard Institute (pengujian checkout
skala besar): **89% subjek memasukkan input numerik dalam format yang
berbeda dari contoh yang ditampilkan** — menyediakan contoh format sebagai
teks/placeholder terbukti tidak cukup; yang bekerja adalah **masker/format
yang diterapkan otomatis saat pengguna mengetik**, dan melarang karakter
format secara kaku justru menimbulkan kesalahan validasi. Temuan sejajar
pada field kartu: memformat kelompok digit *selagi mengetik* menaikkan
akurasi dan memudahkan pemeriksaan ulang oleh pengguna sendiri.

**Keadaan Bisa ERP & terapan.** Pola ini **sudah terwujud** di
`src/components/money-input.tsx` + `src/lib/money-input.ts`: regroup
pemisah ribuan id-ID pada setiap ketukan, string Decimal kanonis sebagai
nilai, toleransi ketikan-di-tengah (titik menggantung tidak langsung
dianggap salah), pesan salah berbahasa Indonesia, dan `onValidityChange`
untuk memblokir submit. Pekerjaan tahap uang adalah **penegakan
menyeluruh**: audit semua permukaan yang masih menerima uang lewat input
angka mentah atau parsing lokal (harga & biaya di form Gudang, komponen
payroll & pinjaman di Akuntansi, mode Price di POS, setoran sesi) dan
migrasikan semuanya ke MoneyInput — satu komponen, satu parser, satu
perilaku; tidak ada parsing tampilan di server (server hanya menerima
string kanonis). Risiko yang dicatat A-21 — MoneyInput mengelompokkan
ulang per ketukan dan kursor bisa terasa melompat — ditangani di komponen
yang sama (posisi kursor dipertahankan relatif terhadap digit), sekali,
untuk semua pemakai.

**Penilaian: ADOPSI PENUH sebagai standar yang ditegakkan**, bukan fitur
baru. Ukuran keberhasilannya: nol field uang non-MoneyInput tersisa.

Sumber:
- http://baymard.com/research-articles/input-masking-form-field?ref=clearbit-blog.ghost.io
- http://baymard.com/research-articles/credit-card-field-auto-format-spaces?ref=weekly.ui-patterns.com

### Pola U2 — Fokus berarti "timpa saya": seleksi-semua saat fokus + keypad numerik di perangkat sentuh

**Masalah yang diselesaikan.** Mengoreksi nominal yang sudah terisi (harga,
qty, nominal diterima) seharusnya satu gerakan: klik → ketik angka baru.
Field yang menempatkan kursor di tengah angka memaksa hapus manual dan
mengundang sisa digit.

**Interaksi persis di acuan.** Numpad POS Odoo bekerja persis dengan
semantik timpa: memilih mode (Qty/%/Price) lalu mengetik angka
**menggantikan** nilai baris terpilih, bukan menyisip. Di web sentuh,
atribut `inputmode="decimal"` adalah mekanisme standar agar field angka
memunculkan keypad numerik (bukan keyboard huruf) di ponsel/tablet —
mekanisme HTML itu sendiri, bukan perilaku satu produk.

**Terapan ke Bisa ERP.** Di MoneyInput bersama (satu tempat, berlaku
sistem): fokus lewat klik/tab memilih seluruh isi; `inputMode="decimal"`
dan `type="text"` (bukan `type="number"` yang menghilangkan pemisah dan
punya perilaku roda-gulir buruk); Esc saat mengedit mengembalikan nilai
sebelum fokus. Field kuantitas di POS (`cart-panel`), opname, dan form
gudang mengikuti pola yang sama lewat komponen angka ringan bersama yang
berbagi parser `src/lib/money-input.ts` untuk konsistensi perilaku desimal.

**Penilaian: ADOPSI PENUH.** Perubahan terpusat berdampak sistem.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html

### Pola U3 — Di permukaan sentuh, nominal dimasukkan dengan keypad layar & pecahan — bukan keyboard

**Masalah yang diselesaikan.** Kasir di tablet/ponsel dan staf gudang
memakai sarung tangan/sebagian layar: keyboard sistem kecil, menutupi
setengah layar, dan tidak punya pecahan uang. Nominal besar (uang diterima,
setoran, hitungan qty besar) butuh papan ketik uang khusus.

**Interaksi persis di acuan.** Register Odoo menempatkan numpad fisik di
layar sebagai zona ketiga terminal (Pola P1) — semua angka transaksi masuk
lewatnya. Square menyediakan tile **Custom amount** untuk memasukkan harga
unik tanpa pindah layar, dan alur tunainya berpusat pada nominal yang
diterima. Shopify POS Go menjalankan seluruh penjualan dari layar Cart →
Checkout dengan target sentuh besar.

**Terapan ke Bisa ERP.** Bangun satu komponen keypad nominal bersama
(dipakai `payment-panel.tsx` POS untuk uang diterima, panel sesi kasir
untuk setoran/tarik, dan lembar hitung opname untuk qty besar): tombol
digit besar, 000, hapus, chip pecahan tunai (tautan ke Pola P4), dan tombol
konfirmasi yang menyebut akibatnya ("Terima — kembalian RpX"). Keypad hanya
muncul di konteks sentuh/terminal; form desktop akuntansi tetap keyboard
(U2) — satu logika parser di `src/lib/money-input.ts`, dua permukaan
presentasi.

**Penilaian: ADOPSI PENUH untuk permukaan terminal & sesi; TIDAK untuk
form desktop** (keyboard lebih cepat dan keypad layar akan memperlambat
akuntan).

Sumber:
- https://squareup.com/help/us/en/article/8334-set-up-item-grid
- https://help.shopify.com/en/manual/sell-in-person/hardware/pos-go/processing-a-sale?utm_source=gurucopy&ut

### Pola U4 — Satu bahasa uang di seluruh sistem: format tampil = format input, satuan selalu jelas

**Masalah yang diselesaikan.** Pengguna membandingkan angka antarlayar
terus-menerus (nota vs jurnal vs laporan). Format yang berbeda antarlayar
(pemisah, desimal, tanda negatif) membuat angka yang sama terlihat berbeda
dan memicu pengecekan ulang manual.

**Keadaan Bisa ERP & terapan.** Fondasinya sudah diletakkan FIX-R2:
`formatIDR` untuk tampilan operasional dan `formatIDRReport` (negatif
dalam kurung) khusus dokumen laporan, keduanya dari `src/lib/money.ts`.
Tahap ini menuntaskan konsistensinya: (a) desimal — rupiah operasional
tanpa desimal di tampilan, tetapi MoneyInput menerima & menyimpan presisi
kanonis; aturan pembulatannya dinyatakan satu kali di `src/lib/money.ts`,
bukan per halaman; (b) setiap field uang berlabel satuan ("Rp") di label
atau awalan field — bukan hanya placeholder; (c) placeholder MoneyInput
tetap "0" (bukan contoh nominal yang bisa tertukar dengan nilai, mengikuti
peringatan Baymard bahwa contoh statis tidak diikuti dan bisa membingungkan);
(d) angka stok/qty memakai formatter bilangan yang sama antar POS, Gudang,
dan laporan persediaan.

**Penilaian: ADOPSI PENUH sebagai sapuan konsistensi.** Murah karena
formatter-nya sudah terpusat; nilainya pada tidak adanya pengecualian.

Sumber:
- http://baymard.com/research-articles/input-masking-form-field?ref=clearbit-blog.ghost.io

---

## Bagian 6 — Kecepatan yang terasa

### Pola K1 — Skeleton yang meniru tata letak halaman, di semua modul

**Masalah yang diselesaikan.** Halaman ERP `force-dynamic` selalu memuat
dari server; layar kosong atau spinner polos selama itu membuat sistem
terasa lambat dan — pada staf operasional — terasa rusak.

**Bukti dari riset kegunaan.** Nielsen Norman Group, *Skeleton Screens
101*: skeleton adalah placeholder berbentuk wireframe yang **meniru tata
letak halaman akhir**, dipakai khusus untuk muat halaman penuh, dan
mengurangi waktu tunggu *yang terasa* karena pengguna membangun model
mental struktur halaman selagi menunggu. Peringatan resminya: skeleton
yang hanya menampilkan bingkai aplikasi tanpa wireframe konten **tidak
direkomendasikan** — halaman terasa kosong dan pengguna mengira sistem
macet.

**Keadaan Bisa ERP & terapan.** Komponen `page-skeleton.tsx` dan
`loading.tsx` segmen aplikasi sudah ada. Standarkan tiga bentuk skeleton
mengikuti keluarga halaman proyek (daftar-tabel, form, dashboard-kartu)
dan pasang `loading.tsx` per segmen modul (`pos/`, `gudang/`, `akuntansi/`)
agar navigasi antarhalaman di dalam modul selalu melewati skeleton yang
mirip tujuannya — bukan satu skeleton generik untuk semua.

**Penilaian: ADOPSI PENUH.** Komponen dasarnya ada; pekerjaannya
perluasan varian dan pemasangan konsisten.

Sumber:
- https://www.nngroup.com/articles/skeleton-screens/?lm=cookie-permissions&pt=article

### Pola K2 — Pencarian hidup tanpa tombol Cari untuk daftar operasional

**Masalah yang diselesaikan.** Daftar operasional (produk gudang, riwayat
POS, pergerakan stok, jurnal) dipakai dengan pola "ketik → lihat → saring
lagi". Form pencarian berbasis submit (isi → klik Cari → muat ulang penuh)
memutus pola itu dan terasa lambat walau servernya cepat.

**Interaksi persis di acuan.** Pencarian di daftar Odoo hidup di *control
panel* yang sama dengan daftar (filter & group-by diterapkan tanpa pindah
halaman), dan palette globalnya menyaring **saat mengetik** dengan navigasi
panah. App switcher komunitas Odoo 19 pun menjual poin yang sama: aplikasi
tersaring *as you type* dengan field yang sudah fokus saat layar terbuka.

**Terapan ke Bisa ERP.** Untuk daftar operasional volume-tinggi (produk
`gudang/produk`, riwayat `pos/riwayat`, `gudang/pergerakan`, daftar
`akuntansi/jurnal`): ketikan memicu pencarian sesudah jeda singkat
(debounce) dan memperbarui daftar di tempat; status filter tetap tinggal
di URL (parameter yang sama dengan SearchForm GET hari ini, diperbarui
lewat navigasi ringan) sehingga hasil tetap bisa dibagikan/dibuka ulang
dan halaman tetap server-rendered sesuai aturan proyek — formulir GET
penuh dipertahankan sebagai jalur tanpa-JS. Pintasan `/` memfokuskan kotak
cari halaman (konvensi yang sama dengan mode menu pada palette Odoo).

**Penilaian: ADOPSI SEBAGIAN.** Daftar operasional dulu; daftar keuangan
berpaginasi besar menyusul sesudah terukur kebutuhan dan bebannya (jangan
mengorbankan paginasi server yang sudah benar demi rasa instan).

Sumber:
- https://www.odoo.com/documentation/master/applications/essentials/keyboard_shortcuts.html
- https://pystrap.co.uk/blog/our-products-4/odoo-home-app-switcher-for-odoo-community-users-5

### Pola K3 — Aksi berulang tidak menunggu server; posting keuangan tidak berpura-pura

**Masalah yang diselesaikan.** Scan dan tambah-keranjang terjadi puluhan
kali per transaksi; bila masing-masing menunggu jaringan, terminal terasa
tersendat dan antrean offline menjadi kegagalan, bukan fitur. Sebaliknya,
posting dokumen keuangan yang "optimistis" akan menampilkan keberhasilan
palsu — pelanggaran integritas.

**Interaksi persis di acuan & keadaan Bisa ERP.** POS Bisa ERP **sudah**
mewujudkan sisi benar pola ini: keranjang berstatus lokal, antrean offline
(outbox) terkirim bertahap 25/panggilan dengan indikator jujur (hasil
D-24/FIX-POS), draf penjualan tertahan tersimpan lokal. Odoo POS
memperlakukan register sebagai aplikasi lokal yang menyinkronkan order ke
server, dengan daftar Orders yang menunjukkan status tiap order.

**Terapan.** Generalisasi *sikapnya*, bukan kodenya: (a) Mode Operasi
gudang (G1) memakai status lokal untuk scan & konfirmasi baris dengan
antrean sinkron berindikator sama seperti POS; (b) draf form panjang
(jurnal manual, penerimaan) tersimpan lokal otomatis (pola draf Catat
Transaksi & opname yang sudah ada) agar pekerjaan tidak hilang oleh
navigasi; (c) **batas eksplisit**: posting jurnal/dokumen, pembayaran, dan
validasi stok selalu menunggu konfirmasi server dan menampilkan hasil
sebenarnya — kecepatan di lapisan ini datang dari skeleton (K1) dan
keyboard (K4), bukan optimisme.

**Penilaian: ADOPSI SEBAGIAN dengan batas integritas tertulis.** Batas itu
adalah bagian dari polanya, bukan pengecualian.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html

### Pola K4 — Dua kecepatan yang disengaja: keyboard-first untuk pengguna daya, touch-first untuk operasional

**Masalah yang diselesaikan.** Akuntan memproses ratusan baris dengan
keyboard; kasir & staf gudang tidak menyentuh keyboard sama sekali.
Memaksakan satu gaya ke keduanya memperlambat dua-duanya.

**Interaksi persis di acuan.** Dokumentasi pintasan resmi Odoo memetakan
satu set kecil yang konsisten lintas aplikasi: Ctrl+K palette, Alt+Q
pencarian, Alt+1..9 menu, Alt+C buat baru, Alt+S simpan (keluarga pintasan
form) — dan menahan Ctrl/Alt menampilkan petunjuk pintasan pada elemen
layar. Di sisi sentuh, target besar dan numpad layar (Pola P1/U3) adalah
padanannya.

**Terapan ke Bisa ERP.** Tetapkan **peta pintasan kecil yang tertulis**
(maksimal ±8, diuji, ditampilkan lewat overlay `?` dan halaman Pengaturan):
Ctrl+K palette (S4), `N` Catat Transaksi (sudah ada sejak A-12), `/` fokus
cari halaman (K2), Enter-konfirmasi & Esc-batal pada dialog bersama
(ConfirmDialog), dan pintasan terminal POS yang diputuskan audit POS
(bukan disalin mentah dari Odoo). Setiap pintasan punya padanan klik/sentuh
yang terlihat — pintasan adalah akselerator, bukan satu-satunya jalan.

**Penilaian: ADOPSI SEBAGIAN.** Subset kecil yang benar-benar dipakai;
menyalin seluruh peta pintasan Odoo DITOLAK (konflik dengan pintasan
peramban & terminal proyek sendiri, dan tidak ada bukti kebutuhan).

Sumber:
- https://www.odoo.com/documentation/master/applications/essentials/keyboard_shortcuts.html

---

## Urutan dampak untuk Bisa ERP (ringkasan perencanaan tahap A-23)

1. **S1 Pendaratan per peran** — kasir/gudang/akuntan langsung di tempat
   kerjanya; inti mandat "kasir hanya POS". (`src/app/app/page.tsx`)
2. **S5 Tepi visibilitas + matriks uji per peran** — penolakan manis &
   kontrak teruji sembunyi-vs-larang. (layout modul, Beranda, Pengaturan
   Pengguna)
3. **S6 + P1 + P4 Mode fokus POS, numpad bermode, pembayaran cepat** —
   terminal sebagai aplikasi kasir tunggal: total & kembalian selalu
   terlihat, pembayaran 1–2 ketuk. (`src/components/pos/`)
4. **G1 + G2 Mode Operasi gudang scan-first + validasi tergerbang selisih**
   — lapisan terpandu di atas dokumen gudang yang ada.
   (`src/app/app/gudang/operasi` + generalisasi `barcode-burst`)
5. **U1 + U2 Penegakan MoneyInput menyeluruh + fokus-timpa & inputMode** —
   nol field uang mentah; satu perilaku uang untuk semua peran.
   (`src/components/money-input.tsx`, sapuan form ketiga modul)
6. **S4 Command palette Ctrl+K** — lompatan lintas modul untuk
   akuntan/pemilik, tersaring peran secara konstruksi. (shell)
7. **P2 + P3 Fokus scan otomatis, kategori awal terkonfigurasi, grid
   favorit terminal** — detik-detik yang dihapus dari setiap transaksi.
8. **G3 + G4 Opname bertugas & terjadwal-ringan; penyesuaian beralasan
   terkonfigurasi + nilai selisih terlihat.**
9. **K1 + K2 Skeleton per keluarga halaman; pencarian hidup daftar
   operasional** — kecepatan yang terasa di semua modul.
10. **S2 + S3 Beranda peluncur berantrean & konsistensi shell** — lobi
    multi-peran menjadi peluncur, breadcrumb & pengalih tuntas.
11. **U3 + U4 Keypad nominal bersama; konsistensi bahasa uang.**
12. **K3 + K4 Sikap antrean lokal digeneralisasi (dengan batas
    integritas); peta pintasan kecil tertulis.**

## Yang secara sadar TIDAK diadopsi

1. **Sistem perm-level field umum ala ERPNext** — model izin per-tindakan +
    daftar modul proyek sudah menampung kebutuhan; lapisan metadata field
    baru adalah kompleksitas tanpa pengguna (lihat S7).
2. **Kustomisasi workspace/grid oleh pengguna akhir** (menyusun ulang kartu
    ERPNext, drag-and-drop tile Square dari layar jual, app launcher
    bergaya ponsel dengan folder & urutan seret) — susunan tetap yang
    dirancang baik lebih mudah dipakai staf minimarket; penyusunan adalah
    pekerjaan manager lewat form biasa.
3. **Aplikasi terpisah per peran di luar web** (aplikasi POS/Barcode native
    terpisah ala Odoo/Square) — satu aplikasi web dengan mode fokus (S6/G1)
    mencapai isolasi yang sama tanpa menggandakan permukaan rilis.
4. **Seluruh peta pintasan keyboard Odoo** — konflik peramban & tak ada
    bukti kebutuhan; hanya subset kecil teruji (K4).
5. **Optimisme pada posting keuangan/stok** — ditolak secara prinsip (K3);
    keberhasilan palsu pada jurnal/pembayaran tidak dapat ditukar dengan
    rasa cepat.
6. **Singkatan ketik nominal lokal** (mis. mengetik "150rb" untuk
    150.000) — tidak ditemukan pada sumber acuan mana pun; tanpa bukti
    kebutuhan, parser uang tidak ditambah dialek tak resmi (lihat koreksi
    kejujuran).

## Koreksi kejujuran — klaim yang TIDAK terverifikasi / perlu dibaca hati-hati

1. **Home Action Odoo**: keberadaan & semantik field-nya terverifikasi dari
   kode sumber Odoo (`action_id`, "opened at log on for this user") dan
   forum resmi Odoo, tetapi halaman *dokumentasi pengguna resmi 19.0*
   khusus Home Action tidak ditemukan dalam riset ini — klaim perilaku
   dibatasi pada dua sumber itu.
2. **App switcher sebagai grid aplikasi penuh di Odoo 19 Community**:
   modul *Home App Switcher* yang dikutip adalah modul pihak ketiga untuk
   Community (pystrap), bukan bukti bahwa Odoo 19 inti membuka grid
   sepenuh-layar secara bawaan; yang terverifikasi dari dokumentasi resmi
   adalah adanya pengalih aplikasi & menu per aplikasi. Jangan
   mereplikasi "grid sepenuh layar" atas nama kesetiaan pada Odoo.
3. **"Sidebar berganti per aplikasi" di Odoo** dirumuskan dari struktur
   menu/aplikasi dan `menu_access` grup; Odoo tidak memakai kata "sidebar"
   untuk ini — pemetaan ke sidebar Bisa ERP adalah terjemahan pola, bukan
   kutipan perilaku.
4. **Square "modes"** terverifikasi dari halaman produk resmi Square
   (marketing), bukan dokumentasi perilaku terperinci; diperlakukan sebagai
   bukti konsep mode-per-tipe-usaha, bukan spesifikasi interaksi.
5. **Statistik Baymard 89%** berasal dari pengujian checkout e-commerce
   untuk input numerik terbatas (antara lain telepon/format khusus);
   penerapannya ke input uang ERP adalah ekstrapolasi yang wajar arahnya
   (format otomatis > contoh statis) tetapi angka persisnya bukan hasil
   uji pada konteks ERP.
6. **Perilaku gerbang kuantitas aplikasi Barcode** (peringatan saat qty
   kurang sebelum Validate) bersumber dari buku implementator Cybrosys
   v19, bukan dokumentasi resmi odoo.com; dokumentasi resmi yang
   terverifikasi adalah alur operasi & penugasan hitungan (Barcode
   operations/adjustments & RFID).
7. **Klaim "13% lebih singkat" untuk animasi pemuatan** yang beredar di
   artikel turunan NNGroup tidak ditemukan pada artikel *Skeleton Screens
   101* itu sendiri — tidak dipakai sebagai angka di dokumen ini.
8. Halaman *cycle counts* resmi yang terjangkau riset ini adalah lokal
   Jepang dari dokumentasi 19.0 (isi konsepnya terbaca dari hasil resmi
   odoo.com); detail langkah UI-nya tidak dikutip kata-per-kata.
