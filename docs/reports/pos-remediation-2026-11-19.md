# Rencana dan bukti perbaikan POS — 19 November 2026

## Cakupan

Menutup 11 temuan audit POS. Pertahankan domain, transaksi PostgreSQL,
Decimal, komponen UI, dan dependency yang ada. Tidak mengubah data produksi.

## Referensi sebelum implementasi

Riset memakai Exa MCP `web_search_exa` (hasil mentah `/tmp/pos-fix-exa-*.txt`).
Context7 tidak tersedia pada sesi ini; dokumentasi resmi dan tipe paket lokal
dipakai untuk memverifikasi API.

- [Stripe: retry dan hasil belum pasti](https://docs.stripe.com/error-low-level):
  pertahankan kunci dan parameter; pastikan hasil sebelum membuat operasi baru.
  Ini prinsip retry, bukan penambahan integrasi Stripe.
- [PostgreSQL 18: row locks](https://www.postgresql.org/docs/18/explicit-locking.html):
  penulis mutasi dan penutup sesi memakai kunci baris yang sama.
- [React: Effect Events](https://react.dev/reference/react/useEffectEvent):
  baca bahan fallback terkini tanpa menjadikannya pemicu ulang request.
- [Base UI Dialog](https://base-ui.com/react/components/dialog): pakai modal,
  fokus awal/akhir dan pembatalan penutupan saat submit dari komponen proyek.
- Panduan Next.js terpasang: `revalidatePath`, `useRouter`, dan Server Actions
  di `node_modules/next/dist/docs/`.
- Modern Web Guidance `dialog`: nama dialog, fokus ke aksi aman, dan isolasi
  keyboard; komponen Dialog Base UI proyek dipertahankan sesuai aturan repo.

## Urutan implementasi dan penerimaan

1. Checkout: simpan percobaan sebelum pengiriman, pulihkan setelah reload,
   rekonsiliasi memakai payload yang sama. Respons hilang tidak membuat dua nota.
2. Piutang: kunci sesi selama penerimaan tunai; tutup sesi tidak melewatkan mutasi.
3. Retur: fingerprint parameter bisnis; retry identik boleh, perubahan ditolak.
4. Pencarian: hasil diikat ke query/gudang/kategori; Enter tidak memilih hasil lama.
5. Tahan: snapshot yang dibandingkan identik; keranjang kosong setelah hold sukses
   tanpa menghapus edit baru yang terjadi selama request.
6. Harga beli: sanitasi field kemasan di server, termasuk hasil pencarian.
7. Quote: cache fallback tidak memicu loop; quote lama tidak diterapkan setelah cleanup.
8. Serial: metadata bertahan pada pencarian, scan, reservasi, dan pemulihan keranjang.
9. Cetak: mapper baris kemasan yang sama pada kedua jalur thermal; sisa piutang
   tampil pada struk, termasuk offline.
10. Void: Dialog proyek, fokus tertahan, Escape/backdrop tidak menutup saat submit,
    error jaringan melepas status sibuk.
11. Verifikasi: regresi unit/integrasi dan browser, build/typecheck/lint,
    pengukuran quote idle, latensi kasir, dan concurrency pada DB test terpisah.

## Hasil

Seluruh 11 perbaikan diimplementasikan tanpa dependency atau migrasi baru.

| Prioritas audit | Perbaikan dan lokasi | Bukti regresi |
| --- | --- | --- |
| High | `terminal/use-terminal-checkout.ts`, `lib/pos/checkout-attempt.ts`: simpan payload + kunci sebelum HTTP; dialog pemulihan setelah reload; kegagalan penyimpanan menghentikan pengiriman | Respons dibuang setelah commit, reload, periksa ulang: payload bisnis identik, satu dokumen; kegagalan localStorage tidak mengirim pembayaran |
| High | `server/pos/receivables.ts`: `FOR UPDATE` pada sesi terbuka sebelum memasukkan mutasi | Penutupan menunggu penerimaan yang belum commit; expectedCash sama dengan jumlah mutasi. Urutan sebaliknya tidak memasukkan penerimaan ke sesi tertutup |
| High | `terminal/use-product-search.ts`, `terminal/product-catalog.tsx`: hasil terikat query/gudang/kategori | Paste + Enter langsung tidak menambahkan Aqua dari hasil lama; Enter setelah hasil baru menambahkan Ultra Milk |
| High | `use-held-sales.ts`: konteks reservasi konsisten pada perbandingan snapshot | Hold mengosongkan keranjang; resume tidak meminta penggantian keranjang kosong; checkout mengonsumsi tahanan |
| High | `server/catalog/products.ts`: hapus `packagings.buyPrice` saat `includeCost=false` | Top-level dan harga beli nested tidak dikirim; akses biaya yang sah tetap mendapat harga beli |
| High | `lib/escpos/receipt-template.ts`, kedua penyedia receipt, checkout offline: sisa utang eksplisit | Utang penuh mencetak BELUM LUNAS + sisa; receipt antrean lama memakai fallback jenis pembayaran; receipt yang sudah ditagih dapat mencetak LUNAS |
| Medium | `use-quote.ts`: Effect Event untuk bahan fallback; hasil request yang dibatalkan diabaikan | Mode offline aktif: 0 quote tambahan selama 5 detik idle; quote lokal dan sinkronisasi offline tetap berjalan |
| Medium | `terminal/use-product-search.ts`, `pos-terminal.tsx`, `server/actions/pos.ts`: pertahankan trackSerial; pulihkan metadata produk keranjang secara batch | Input serial muncul untuk produk di luar 24 produk awal melalui pencarian, scan, dan reload |
| Medium | `lib/escpos/sale-receipt-line.ts`, action dan endpoint receipt desktop: mapper snapshot bersama | 1 Dus isi 40 tampil sebagai 1 Dus × Rp145.000; unit test juga memeriksa 1,5 Dus |
| Medium | `server/pos/returns.ts`: fingerprint data bisnis yang dinormalisasi | Dua request identik bersamaan memperoleh retur yang sama; retry lintas tanggal/format angka setara boleh; perubahan qty/alasan/refund/disposisi ditolak |
| Medium | `sale-row-actions.tsx`: Dialog proyek, fokus aman, penutupan ditahan selama submit, finally melepas busy | Tab berputar di modal; fokus awal Batal; Escape saat submit tidak menutup; gangguan jaringan melepas busy; retry void berhasil |

Semua lokasi relatif terhadap `src/components/pos/` kecuali yang menyebut `server/` atau `lib/` (relatif terhadap `src/`).

### Verifikasi

- PostgreSQL 18 terpisah: `127.0.0.1:55439/bisa_erp_test`, koneksi aplikasi memakai `app_user` dengan RLS; owner hanya untuk fixture/inspeksi.
- Production build Next.js, Chromium nyata, viewport desktop dan mobile.
- `vitest run tests/unit/pos*`: **111 lulus**.
- Suite integrasi POS terpilih + simulasi sinkronisasi offline: **121 lulus dalam 15 file**, termasuk 6 regresi domain baru.
- Playwright keyboard, native/mobile, daftar POS, dan fault injection baru: **17 lulus**, termasuk autentikasi dan 7 regresi browser baru.
- Production build Next.js, `tsc --noEmit`, ESLint file terdampak, dan `git diff --check`: **lulus**.
- Fault injection checkout menjalankan HTTP sampai commit, kemudian membuang respons; pemeriksaan database menghitung satu penjualan untuk kunci tersebut.
- Uji locking memakai transaksi riil dengan barrier sebelum commit, bukan mock database.

Run awal sempat gagal akibat fixture demo bertabrakan antar-suite, sisa pesanan held dari audit, assertion terhadap encoding `$undefined` milik React, dan pembacaan fokus sebelum focus guard Base UI selesai memindahkannya. Fixture test dibersihkan secara terbatas, suite dijalankan berurutan, parameter dibandingkan setelah decoding, serta fokus diperiksa dengan polling. Ini koreksi harness; kegagalan awal tidak dihitung sebagai keberhasilan.

### Pengukuran

Satu mesin lokal, build produksi, browser otomatis; lima sampel per operasi UI.
Angka mencakup overhead Playwright. Sampel kecil ini memeriksa regresi, bukan SLA produksi.

| Metrik | Sebelum | Sesudah |
| --- | ---: | ---: |
| Quote tambahan saat idle 5 detik, offline aktif | 23 request | 0 request |
| Median cari → hasil | 296 ms | 300 ms |
| Median tambah → Bayar siap | 354 ms | 307 ms |
| Median checkout → modal berhasil | 174 ms | 177 ms |
| Median scan → keranjang, termasuk ketikan scanner | 190 ms | 182 ms |
| Median scan → Bayar siap | 429 ms | 419 ms |
| 60 pencarian, 20 paralel, median / p95 | 291 / 452 ms | 290 / 471 ms |
| 60 checkout, 20 kasir, median / p95 | 464 / 1104 ms | 404 / 1030 ms |

Dataset beban: sekitar 10.000 produk dan 25.000 penjualan. Kedua run memakai produk fixture setara yang stok awalnya 100; sesudah 60 checkout stok 40, 60 ID penjualan unik, dan 0 jurnal tidak seimbang. Run baru memakai SKU fixture lain agar stok awal setara. Pengukuran UI dan beban dilakukan terpisah; tidak menyimpulkan percepatan umum dari selisih kecil.

Uji PWA nyata: reload saat offline berhasil, satu transaksi Rp4.000 disimpan di IndexedDB, tersinkron menjadi satu dokumen dalam **361 ms** sesudah koneksi kembali (sebelumnya 360 ms). Ini satu sampel.

Bukti mentah sementara: `/tmp/pos-fix-{unit,integration,e2e,browser,load,offline}.json`, log build/typecheck/lint di `/tmp/pos-fix-*.log`. Tidak disimpan dalam git karena mengandung ID fixture dan artefak lingkungan lokal.

### Batas dan risiko operasional

- Printer thermal fisik, Bluetooth/USB/serial, laci uang, dan scanner fisik tidak tersedia. Pengujian mencakup data/byte ESC/POS dan keyboard scanner, bukan kalibrasi perangkat.
- Rekonsiliasi checkout bergantung pada record browser sebelum request. Jika storage tidak bisa ditulis, pembayaran tidak dikirim. Penghapusan storage/pergantian perangkat saat status pembayaran belum pasti tetap memerlukan pemeriksaan riwayat oleh supervisor.
- Retur lama yang belum memiliki fingerprint ditolak saat replay dan diminta diperiksa melalui riwayat; tidak ada migrasi yang menebak payload lama.
- Penerimaan piutang tanpa sesi kas terbuka tetap mengikuti perilaku akuntansi yang ada: boleh dicatat di luar laci. Perbaikan memastikan tidak menambah mutasi ke sesi yang telah ditutup.
- Error hydration React **#418** dari run awal sudah ditutup pada lanjutan Ponytail di bawah. Pemicu berhasil direproduksi ketika flag offline perusahaan aktif; setelah perbaikan regresi PWA pada build produksi lulus tanpa pageerror.
- Tidak mengubah, melakukan migrasi, atau deploy database/aplikasi produksi.

## Lanjutan Ponytail: perbaikan kecil hydration PWA

Pengguna meminta mendahulukan perbaikan mudah. Cakupan lanjutan dibatasi pada
status koneksi awal di `src/components/pos/use-offline-queue.ts`, regresi unit,
dan satu skenario browser PWA. Tidak mengubah worker, caching, antrean,
database, atau dependency.

### Akar masalah yang sudah dibuktikan

Pada Node.js v22.23.0, `typeof navigator === "object"` tetapi
`navigator.onLine === undefined`. Initializer lama mengevaluasi nilai tersebut
sebagai falsy. Ketika mode offline perusahaan aktif, HTML server berisi tautan
"POS offline", sementara render awal browser online menghilangkannya. React
menemukan `<a>` dari server di tempat `<div>` kontrol tampilan dan membangun
ulang tree (#418). Debug build development dengan flag perusahaan aktif
menghasilkan diff DOM ini secara eksplisit.

Perbaikan: `useState(true)` memberi snapshot awal yang sama pada server dan
hidrasi browser. Effect dan listener yang sudah ada kemudian membaca
`navigator.onLine` serta memperbarui indikator. Checkout tetap memeriksa
koneksi browser sebenarnya; nilai awal indikator tidak menentukan pengiriman
pembayaran. Ini mengikuti prinsip [snapshot server/hidrasi React](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering),
dengan mempertahankan state dan listener proyek yang sudah tersedia.

### Bukti lanjutan

- Sebelum perubahan: 2 error hydration pada siklus browser nyata; 2 dari 4
  kasus regresi SSR gagal (navigator tanpa onLine dan navigator offline).
- Sesudah perubahan: 4 kasus SSR lulus; keseluruhan **115 unit test POS lulus**.
- Probe development online/reload sesudah perubahan: **0 error**.
- Build produksi, TypeScript, ESLint tiga file terdampak, dan diff check lulus.
- Regresi browser PWA memeriksa reload cache saat offline, indikator Offline,
  satu transaksi IndexedDB, satu dokumen server setelah kembali online, antrean
  habis, serta tidak ada pageerror: **lulus pada build produksi, 0 error**.
- Seluruh suite browser POS terpilih: **18 lulus** (termasuk autentikasi);
  pengujian backend 121 kasus dari tahap sebelumnya tidak diulang karena
  perubahan lanjutan hanya menyentuh initializer state klien.

Bukti mentah: `/tmp/pos-easy-before.json`, `/tmp/pos-easy-dev-after.log`,
`/tmp/pos-easy-unit.json`, `/tmp/pos-easy-e2e.json`, dan log
`/tmp/pos-easy-{build,types,lint}.log`.
