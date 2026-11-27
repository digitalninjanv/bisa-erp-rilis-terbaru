# Audit UI/UX POS Kasir — 27 November 2026

## Ringkasan eksekutif

Palet hijau tua + kertas hangat + emas sudah berada di arah yang benar. Masalah utama **bukan lagi warna**, melainkan **kepadatan layout, hierarki tipografi, dan alur uang tunai**.

Tiga temuan yang paling berdampak:

1. **Footer Bayar menutupi area uang diterima dan tombol uang cepat** pada layar 1366×768 dan pada reproduksi 1536×864 (setara layar 1920×1080 dengan zoom 125%, seperti screenshot pemilik). Kasir tidak melihat pilihan “Uang Pas”/pecahan tanpa menggulir.
2. **Daftar keranjang terlalu pendek dan memakai scroll bersarang**. Pada 4 baris, hanya 2 baris terlihat penuh; pada 8 baris, item terakhir berada di luar area pandang dan daftar tidak auto-scroll. Kasir tidak bisa memverifikasi hasil scan terakhir.
3. **Placeholder “Pas: 121.500” adalah placeholder 50% opasitas dengan kontras 2.33:1**, tetapi terlihat seperti nilai yang sudah terisi. Tombol Bayar tetap aktif dan checkout memperlakukan input kosong sebagai uang pas. Ini berisiko menagih uang pas tanpa kasir sadar.

Audit otomatis axe tetap **0 violations**; artinya masalahnya lolos dari aturan otomatis: oklusi sticky footer, placeholder pseudo-element, kepadatan, ukuran teks, dan beban kognitif tidak diperiksa axe.

---

## Status implementasi — 27 November 2026

P0 dan sebagian besar P1 sudah diperbaiki di kode dan diverifikasi ulang.

| Perbaikan | Bukti setelah perubahan |
|---|---|
| Footer tidak lagi menutup uang diterima/chip | 1536×864: chip `647–691`, footer `725`; 1366×768 full: chip `527–571`, footer `605`; 1366×768 non-full: chip `603–647`, footer `681` |
| Tombol Bayar lebih besar | tinggi **56px** (dari 48px), Tahan juga 56px |
| Keranjang auto-scroll ke item terbaru | 4 baris: `scrollTop 191` (1536) / `311` (1366); item terakhir terlihat; tepi atas memudar saat digulir |
| Ringkasan total tidak menutupi layar pendek | Bar total keranjang dihapus; total ada di header pembayaran. Rincian subtotal/diskon/PPN/pembulatan dibuka dari badge jumlah item (“Rincian transaksi”). |
| Placeholder nominal netral & kontras | placeholder `0`, warna `rgb(87,83,78)` pada `#fffdf8` = **7.50:1** (sebelumnya 2.33:1) |
| Kartu produk lebih padat, harga dominan | kartu **126px**, harga **22px/800**, nama 16px; tidak ada nama/stok terpotong di 1366/1536 |
| Kolom mengikuti lebar katalog | 3 kolom area 530px, 4 kolom 1366/cart 360, 5 kolom 1536, 6 kolom 1920 |
| Pembayaran lebih ringkas | kolom kanan hanya keranjang + satu tombol Bayar; panel pembayaran **baru muncul sebagai dialog** setelah Bayar. Hanya **Tunai + QRIS** di panel; Transfer/Utang, split, kredit retur, MDR masuk dialog “Opsi pembayaran lain”; total keranjang tidak lagi diulang |
| Metode aktif tidak warna-saja | checkmark pada tile aktif |
| Kembalian lebih kontras | `#065f46` pada `#d1fae5` = **7.32:1** |
| Aksesibilitas | axe **0 violations** di 1920/1536/1366 full/1366 non-full/390 mobile, termasuk dialog opsi dan rincian terbuka |
| Regresi | **146 file / 1.261 test** lulus; build + typecheck lulus; lint 0 error |
| Checkout nyata | 5 scan → Bayar → Uang Pas → “Transaksi berhasil”, commit server **101ms**, 0 console error; benchmark 5 scan→dialog→sukses **700ms**; dialog 448×397 (desktop) / 358×397 (mobile, margin 16px) |
| 1080p | daftar keranjang 480px, 4 baris terlihat; grid 6 kolom, 24 produk tanpa scroll halaman |

**Masih tersisa (bukan blocker layout):** belum ada numpad nominal on-screen; input masih mengandalkan keyboard/OS. Uji printer fisik, Windows/Electron, dan kasir sungguhan belum diulang setelah perubahan ini. Smoke test membuat transaksi uji `INV-2026-00011` (Rp69.500) di DB lokal.

### Pembayaran fokus ala Accurate — 27 November 2026

Kolom kanan kini hanya berisi keranjang dan satu tombol **Bayar Rp …**. Panel pembayaran tidak lagi menetap di layar; ia muncul sebagai dialog setelah tombol ditekan. Dialognya:

- Desktop **448×397px**, mobile **358×397px** dengan margin 16px.
- Header total + metode Tunai/QRIS; Transfer/Utang dan opsi lain ada di tombol “…”.
- Input uang, kembalian, empat chip cepat, lalu **Bayar 56px** dan Tahan.
- Token warna POS dikirim eksplisit ke dialog portal (`pos-terminal-surface` + `themeStyle`) sehingga tile Tunai tetap hijau, bukan transparan.
- `Rincian transaksi` dibuka dari badge jumlah item; tidak ada bar total tambahan di keranjang.
- Verifikasi: axe **0 violations** pada halaman sebelum Bayar, dialog terbuka, dialog opsi, dan mobile; checkout nyata `INV-2026-00011` commit server **101ms**, benchmark 5 scan→dialog→sukses **700ms**, tanpa console error.

### Desain POS menyeluruh — native cart & Odoo flow (27 November 2026)

Perbaikan tidak berhenti di dialog pembayaran. Seluruh layar terminal dirapikan:

- Kanvas dipertajam ke `#e7ddcc`, panel `#fffdf8`, border `#6f6658`; objek putih kini jelas terpisah dari latar (border 5.56:1 terhadap panel, 4.19:1 terhadap kanvas).
- Harga produk memakai hijau aksi `#065f46` (7.56:1 di panel) sehingga hierarki nama → harga lebih cepat dibaca.
- Panel kanan menjadi satu kartu penuh: header tetap, daftar mengisi ruang, footer Total + **Bayar** + **Tahan** menempel di dasar. Tidak ada celah antara daftar dan footer.
- Footer tetap terlihat saat daftar panjang: 8 baris = list scroll 654px/1035px, footer tetap di y=731–851 (1536×864), item terakhir auto-terlihat.
- **Tahan pesanan dikembalikan** di footer keranjang dan bar mobile. Menyimpan hold **tidak lagi menampilkan toast sukses**; dialog ditutup dan keranjang dikosongkan sebagai umpan balik.
- **Footer Total/Bayar/Tahan selalu terlihat** meski keranjang kosong: Total Rp0, 0 item, Bayar/Tahan disabled, posisi tetap di dasar panel. Empty state kini di tengah area daftar.
- Dialog hold/resume memakai palet POS (`pos-terminal-surface`), bukan tema ERP ungu.
- Referensi Odoo: order panel kanan dengan tombol Payment tetap di bawah; modul OCA “POS Order Details on the Payment Screen” menegaskan “a long order scrolls inside the panel, so the payment buttons stay exactly where the cashier expects.” Layout kita mengikuti prinsip itu, dengan footer Total + dua aksi.

Verifikasi akhir: **146 file / 1.261 test**, build/typecheck, lint 0 error, axe **0 violations** pada halaman, dialog bayar, dialog opsi, hold, dan mobile. Screenshot: `pos-whole-1536.png`, `pos-whole-1536-cart.png`, `pos-whole-mobile-bar.png`, `pos-hold-native-dialog.png`, `pos-empty-footer-final.png`.

---

## Ruang lingkup dan metode

- Code review: `pos-terminal.tsx`, `cart-panel.tsx`, `payment-panel.tsx`, `product-catalog.tsx`, `cash-chips.tsx`, `money-input.tsx`, `globals.css`.
- Playwright, Chromium, produksi lokal:
  - **1920×1080** full screen.
  - **1536×864** full screen, `cartWidth=360` — reproduksi kondisi screenshot pemilik (1920×1080 @ 125%).
  - **1366×768**.
  - **390×844** mobile sheet.
- Skenario: 4 baris keranjang; uji tambahan 8 baris untuk melihat perilaku scroll.
- axe-core WCAG 2 A/AA pada setiap viewport.
- Perhitungan kontras WCAG dari computed style; cek pseudo-element placeholder.
- Riset: Exa, Firecrawl search/scrape, dan skill web-search. Sumber utama: Toast, Baymard, NN/g, Shopify, LaundryVerse, Material Design, SuperBiller, HarakahTec, Square, Pawoon, Majoo, W3C WCAG/APCA.

---

## Yang sudah bagus dan sebaiknya dipertahankan

- Kanvas hangat dan command bar hijau tua; tidak “putih semua”.
- Total besar dengan angka emas; hierarki total transaksi jelas.
- Search besar, auto-focus, dan pemindaian barcode cepat.
- Tombol metode 52px, stepper 44px, chip 44px, Bayar 48px — target sentuh utama sudah di atas minimum.
- Struktur pembayaran sudah disederhanakan: 4 metode utama, “Metode lain”, MDR di disclosure, kredit retur collapsed.
- Checkout tunai 5 item berhasil, quote 318 ms, checkout 360 ms, tanpa console error.
- axe 0 violations di 1920, 1536, 1366, dan mobile.

---

## Temuan prioritas

### P0-1 — Sticky footer menutupi input uang diterima dan quick cash

**Bukti terukur**

| Viewport | Input “Uang diterima” | Footer Bayar | Chip “Uang Pas” | Hasil |
|---|---:|---:|---:|---|
| 1920×1080 | bawah 781.5 | atas 994 | 791.5–858 | Aman, tidak bertumpuk |
| 1536×864 | bawah 782 | atas 778 | 792–858 | Input tertutup 4px; chip **100% di bawah footer** |
| 1366×768 | — | atas 706 | 727.5–794 | Overlap 30px; `elementFromPoint` tidak menemukan chip |

Pada 1536×864, panel kanan memiliki `clientHeight=840` tetapi `scrollHeight=1080`; footer sticky berada di atas konten yang belum tergulir. Chip saran uang dan tombol “Bayar dengan beberapa metode” baru muncul setelah panel kanan digulir.

**Dampak**
- Kasir tidak melihat “Uang Pas”/pecahan tanpa scroll.
- Input tunai terpotong; kesan pertama adalah form rusak.
- Pada layar 1366 (laptop kasir umum), alur tunai memerlukan scroll sebelum bisa memasukkan uang.

**Penyebab teknis**
- Footer `sticky bottom-0` berada di luar kartu pembayaran dan tidak menyisakan ruang bawah pada konten.
- Panel kanan `overflow-y-auto`; kartu pembayaran lebih tinggi dari viewport.
- Tidak ada `padding-bottom` yang setara tinggi footer di dalam area scroll.

**Saran**
- Beri ruang bawah pada konten sebesar tinggi footer + safe area, atau jadikan footer bagian dari flex column yang tidak menimpa konten.
- Alternatif yang lebih kuat: mode pembayaran fokus — saat kasir menekan Bayar, keranjang mengecil menjadi ringkasan “4 item · Rp121.500 · Lihat”, panel pembayaran mengambil alih tinggi penuh, dan footer tidak perlu menutupi apa pun.
- Target: pada 1366×768 dan 1536×864, input uang, chip cepat, dan tombol Bayar terlihat tanpa scroll.

---

### P0-2 — Keranjang tidak menampilkan semua item, memakai nested scroll, dan tidak auto-scroll

**Bukti terukur**

| Viewport | Tinggi area baris | Isi 4 baris | Baris terlihat penuh | Catatan |
|---|---:|---:|---:|---|
| 1920×1080 | 320px | 491px | 2 dari 4 | 3 baris terlihat sebagian |
| 1536×864 | 320px | 491px | 2 dari 4 | screenshot pemilik menunjukkan ±1,5 baris |
| 1366×768 | 180px | 491px | 1 dari 4 | 2 baris terlihat sebagian |

Uji 8 baris di 1536×864: `clientHeight=320`, `scrollHeight=1035`, `scrollTop=0`; item terakhir berada di `y=991–1113`, sementara area baris hanya `y=78–398`. Item terakhir **tidak terlihat sama sekali**.

**Dampak**
- Kasir tidak bisa memverifikasi item yang baru dipindai.
- Risiko item terlewat, item ganda, atau salah qty sebelum pembayaran.
- Dua scrollbar (panel kanan dan daftar baris) membingungkan; roda mouse/touch bisa menggulir area yang salah.

**Penyebab teknis**
- `.pos-cart-lines { max-height: 320px }`, 200px di mobile, 180px di layar pendek.
- `aside` juga `overflow-y-auto` → nested scroll.
- Tidak ada efek yang menggulir daftar ke baris terbaru saat `cart.length` bertambah.

**Saran**
- Hapus scroll dalam daftar; jadikan panel kanan satu area scroll, atau jadikan daftar `flex-1 min-h-0` dengan auto-scroll ke baris terbaru.
- Tampilkan indikator “8 baris · gulir untuk melihat semua” bila daftar tetap dibatasi.
- Ringkas baris: nama 15–16px, meta 12px, stepper 44px, total baris 18px; target tinggi baris 88–96px agar 4 baris muat di 1536.
- Setelah scan, tampilkan status singkat “Ditambahkan: Baygon 2×” dan auto-scroll.

---

### P0-3 — Placeholder “Pas: 121.500” ambigu dan gagal kontras

**Bukti**
- Input `#pos-tendered-input` kosong, tetapi placeholder “Pas: 121.500” tampil seperti nilai.
- Computed placeholder: `oklab(0.216114 0.00343135 0.00508514 / 0.5)` — 50% opasitas.
- Efektif terhadap panel `#fffdf8`: **2.33:1** (gagal WCAG 4.5:1).
- Tombol Bayar tetap aktif. Kode checkout memakai `cashTendered || total`, jadi input kosong berarti **uang pas**.

**Dampak**
- Kasir bisa menekan Bayar tanpa sadar bahwa sistem menganggap pelanggan membayar pas.
- Pembaca layar/penglihatan rendah tidak bisa membaca petunjuk.
- Placeholder terlihat seperti value; kasir bisa mengira 121.500 sudah masuk.

**Saran**
- Placeholder netral: `0` atau `Masukkan nominal`, dengan kontras ≥ 4.5:1.
- Pisahkan aksi “Uang Pas” sebagai tombol/chip eksplisit; jangan jadikan input kosong sebagai exact cash secara implisit.
- Jika mempertahankan exact cash, label tombol harus “Bayar pas Rp121.500” dan ada state “Uang pas” yang terlihat.
- Tambahkan on-screen numpad atau auto-focus input nominal saat panel tunai dibuka.

---

### P1-4 — Kartu produk terlalu kosong; harga belum menjadi hierarki utama

**Bukti**
- 1920×1080: kartu 337×131.5px; jarak nama→harga **57.5px** (44% tinggi kartu).
- 1536×864: kartu 271×120px; jarak nama→harga **46px**.
- Nama 16px/600; harga 18px/700. Hanya beda 2px dan sama-sama hitam.
- Kartu hanya berisi nama dan harga (plus stok); tidak ada gambar/SKU/kategori default.

**Dampak**
- Tampilan terasa “kosong” dan belum selesai.
- Harga tidak langsung menonjol; kasir harus membaca nama dan harga dengan bobot yang hampir sama.
- Baris kartu ikut meregang mengikuti kartu tertinggi (mis. yang punya badge kemasan), menambah ruang mati.

**Saran**
- Harga 22–24px/800; nama 16px/600; stok 12–13px/500.
- Tinggi kartu 96–112px; hindari `justify-between` yang menaruh harga jauh di bawah.
- Opsional: gambar produk 48–56px di kiri, fallback huruf awal/ikon; untuk toko yang bergantung barcode, gambar tidak wajib.
- Batasi badge kemasan maksimal 1 baris; jangan biarkan satu badge menaikkan seluruh baris.

---

### P1-5 — 4 kolom dipaksa dari viewport, bukan lebar area katalog

**Bukti**
- 1366×768: area katalog ±570px, tetapi `xl:grid-cols-4` menghasilkan kartu **122.5px**.
- Nama “Aqua Air Mineral…” terpotong; stok “Stok 119 BT…” terpotong.
- 1536: 4 kolom kartu 271px (nyaman); 1920: 4 kolom kartu 337px (terlalu lebar).

**Dampak**
- Di laptop 1366, kartu sempit dan informasi terpotong.
- Di layar besar, kartu terlalu lebar dan kosong.
- Preferensi 4/5/6 kolom tidak cukup; breakpoint harus mengikuti lebar panel katalog.

**Saran**
- Gunakan container query/ResizeObserver: 3 kolom saat area katalog < 700px; 4 kolom 700–1000px; 5 kolom > 1000px.
- Minimal lebar kartu 150–160px agar nama 2 baris dan stok tidak terpotong.
- Uji di 1366×768 dan 1536×864 dengan cart width 360/396/480.

---

### P1-6 — Belum ada keypad nominal atau auto-focus untuk uang tunai

**Bukti**
- Input tunai hanya `MoneyInput`; tidak ada numpad on-screen.
- F4 adalah shortcut, tetapi tidak terlihat di dekat field.
- Input tidak auto-focus; kasir harus tap field lalu mengetik dengan keyboard OS.
- Placeholder menunjukkan “Pas: total”, bukan state input yang jelas.

**Dampak**
- Di terminal touchscreen, keyboard OS menutupi layar dan memperlambat.
- Kasir lebih memilih menekan Bayar (uang pas) walaupun pelanggan memberi pecahan lain.
- Risiko salah nominal/kembalian.

**Saran**
- Auto-focus input nominal saat metode Tunai dipilih.
- Sediakan numpad 3×4 (tombol ≥48px) atau tombol “Keypad” yang membuka modal; quick cash tetap di atas.
- Tampilkan amount due besar di atas input, change di bawah, dan tombol Bayar 56px.
- Referensi pola: Toast/LaundryVerse/Shopify change due calculator.

---

### P1-7 — Banyak label 10–11px; terlalu kecil untuk dibaca dari posisi kasir

**Bukti ukuran**
- “PEMBAYARAN”, “UANG DITERIMA”, “KEMBALIAN”, “SARAN UANG DITERIMA”, “TOTAL”: 11px.
- “BANK”, “TEMPO”: 10px.
- Nama item keranjang: 14px; meta 12px; stok 12px.
- Harga produk 18px; nama 16px.

**Dampak**
- Kontras boleh lulus, tetapi ukuran tetap membuat mata cepat lelah.
- Pada layar 1366/1536, label kecil tenggelam.
- Riset tipografi: body 16px, secondary 14px, price 22–28px, jangan di bawah 12px.

**Saran**
- Label minimum 12px; secondary 14px; body 16px; harga 22–24px; total 28–32px.
- Kurangi uppercase 10px; gunakan sentence case 12px untuk label.
- Line-height 1.4–1.5 untuk teks; 1.1–1.2 untuk angka total.

---

### P1-8 — Metode aktif hanya dibedakan warna; pilihan metode bisa terlalu banyak

**Bukti**
- Tile aktif hanya berubah fill; tidak ada checkmark/label “Dipilih”.
- 4 metode tampil sekaligus (Tunai, QRIS, Transfer Bank, Utang).
- QRIS memakai ungu; bank biru; utang amber; tunai hijau.

**Dampak**
- Pengguna color-blind bisa sulit membedakan state.
- Empat warna + empat pilihan menambah beban visual; NN/g mengingatkan terlalu banyak opsi pembayaran menyebabkan choice overload.
- QRIS ungu bukan warna brand QRIS yang dikenal (merah/putih).

**Saran**
- Tambah checkmark/teks “Dipilih” pada tile aktif.
- Pertimbangkan 2 metode utama (Tunai, QRIS) + “Lainnya” untuk Transfer/Utang; atau tetap 4 dengan ikon netral.
- Gunakan satu warna aksi untuk state aktif; warna metode hanya pada ikon/aksen.
- Gunakan logo QRIS resmi jika tersedia.

---

### P2-9 — Pemilih “Harga normal” terlalu menonjol di header keranjang

- Select putih 118×44px di header hijau terlihat seperti tombol utama.
- Kasir bisa mengira itu aksi, bukan pengaturan harga.
- Saran: pindahkan ke menu kecil “Harga: Normal” atau baris tersier di bawah header; beri label “Kelompok harga”.

### P2-10 — Total muncul tiga kali

- Total baris, total keranjang (Subtotal + TOTAL), dan total header pembayaran.
- Tidak salah, tetapi menambah noise dan tinggi.
- Saran: ringkas total keranjang menjadi satu baris; detail subtotal/diskon/PPN di disclosure.

### P2-11 — Kembalian hijau 4.84:1; margin tipis

- `#047857` pada `#d1fae5` = 4.84:1; lulus AA, tetapi dekat batas.
- Saran: `#065f46` pada `#d1fae5` (7.3:1) atau naikkan ukuran/berat.

### P2-12 — Stok terpotong di kartu sempit

- “Stok 119 BT…” pada 1366.
- Saran: format “119 BTL” atau “Stok 119” + satuan terpisah; jangan truncate angka stok.

### P2-13 — Mobile: 3 baris, hanya 2 terlihat; chip di bawah footer

- Sheet 390×844: 3 baris keranjang, 2 terlihat; chip Uang Pas di bawah footer.
- Saran yang sama: satu scroll, auto-scroll, footer reserve, compact row.

---

## Rekomendasi layout target

### Opsi A — perbaikan minimal (cepat, risiko rendah)

1. Panel kanan jadi **satu scroll**; hapus `pos-cart-lines` overflow.
2. Tambah `padding-bottom` konten sebesar tinggi footer + safe area.
3. Auto-scroll ke baris keranjang terbaru.
4. Placeholder input jadi `0`/“Masukkan nominal”; tambah chip Uang Pas eksplisit.
5. Naikkan harga jadi 22–24px; ringkas tinggi kartu.
6. Container query 3/4/5 kolom.
7. Naikkan label 10–11px menjadi 12–13px.
8. Tambah checkmark pada metode aktif.

Ini sudah menghilangkan P0 dan sebagian besar P1.

### Opsi B — mode pembayaran fokus (lebih baik untuk 1366/1536)

1. Saat kasir menekan Bayar, tampilkan panel pembayaran fokus (kanan atau modal).
2. Keranjang mengecil menjadi ringkasan “4 item · Rp121.500 · Lihat”.
3. Panel fokus berisi: total besar, metode, numpad, quick cash, change, Bayar 56px.
4. Setelah sukses, kembali ke keranjang kosong.
5. Di 1920×1080, layout dua panel tetap boleh dipakai; mode fokus otomatis pada tinggi < 900px atau cart > 4 baris.

Opsi B paling sesuai dengan keluhan “sulit dibaca dan dipakai” karena memberi ruang untuk nominal dan mengurangi kepadatan.

---

## Prioritas implementasi

### P0 — sebelum dipakai kasir
- [ ] Hilangkan overlap footer pada 1366×768 dan 1536×864.
- [ ] Satu scroll untuk panel kanan; auto-scroll keranjang ke item terbaru.
- [ ] Perbaiki placeholder nominal: kontras ≥4.5:1, semantics “0/Masukkan nominal”.
- [ ] Buat “Uang Pas” eksplisit; jangan biarkan input kosong diam-diam menjadi exact cash.

### P1 — sebelum rollout luas
- [ ] Harga 22–24px; kartu 96–112px; kurangi ruang mati.
- [ ] Container query 3/4/5 kolom; hentikan truncation stok/nama.
- [ ] Numpad/auto-focus nominal tunai.
- [ ] Label minimum 12px; secondary 14px.
- [ ] Checkmark/teks pada metode aktif.
- [ ] Ringkas total ganda; kecilkan select harga.

### P2 — polish
- [ ] Warna QRIS/bank/utang dievaluasi ulang.
- [ ] Darken change green.
- [ ] Format stok pendek.
- [ ] Mobile sheet: ringkasan total dan item count yang selalu terlihat.

---

## Referensi utama

- Toast — Configure Cash Payments: https://support.toasttab.com/en/article/Cash-Payments-Configuration
- Toast — Payment workflows: https://doc.toasttab.com/doc/platformguide/platformPwfTenders.html
- Baymard — Payment UX: https://baymard.com/blog/payment-ux
- NN/g — Mobile Checkout: https://www.nngroup.com/articles/mobile-checkout-ux/
- Shopify — Change due calculator: https://changelog.shopify.com/posts/change-due-calculator-for-cash-payments
- LaundryVerse — Processing Payments (autofocus, numpad, quick amounts, change): https://laundryverse.app/help/pos/payments
- Material Design 3 — Density & 48px targets: https://m3.material.io/foundations/layout/grids-spacing/density
- Material Design — Accessibility/touch targets: https://m2.material.io/design/usability/accessibility.html
- SuperBiller — POS touch target 48–64px: https://www.mysuperbiller.com/blog/pos-ui-design-principles-fast-retail-billing
- HarakahTec — Cashier grid, columns, tile height, name/price size: https://help.harakahtec.com/the-cashier-grid/
- Square — Visual item grid/images: https://squareup.com/ca/en/the-bottom-line/inside-square/visual-browse
- Pawoon — Alur transaksi pertama: https://www.pawoon-helpcenter.com/memulai-transaksi-pertama
- Majoo — Multi payment/pembulatan: https://majoo.id/aplikasi-kasir-online
- W3C WCAG 2.2 — Contrast Minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
- W3C WCAG 2.2 — Text Spacing: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- APCA — Easy Intro: https://git.apcacontrast.com/documentation/APCAeasyIntro.html
- CustomFit — Typography ecommerce/price 22–28px: https://www.customfit.ai/blog/ux-design/typography-ecommerce-readability
- ExodeUI — Information density B2B: https://www.exodeui.com/learn/information-density-b2b-dashboards/
- Mobile POS UX teardown — cart drawer/48px/56px: https://dpopstudio.co/blog/mobile-point-of-sale-ux-teardown-posify-architecture
- CAKE POS case study — keep order visible, split payment context: https://danurajayakody.com/work/cake-pos
- Propello POS — sticky payment summary, touch-first: https://www.vimal.design/case-studies/propello-pos.html

---

## Lampiran metrik

File mentah baseline: `audit/checks/pos-ux-audit.json`. Screenshot baseline: `pos-ux-desktop-1920.png`, `pos-ux-1536-user.png`, `pos-ux-laptop-1366.png`, `pos-ux-mobile-sheet.png`. Screenshot setelah perbaikan: `pos-final9-1920.png`, `pos-final9-1536.png`, `pos-final9-1366-full.png`, `pos-final9-1366-nofull.png`, `pos-final9-mobile-sheet.png`, `pos-final9-options.png`, `pos-final9-summary.png`, `pos-final10-1536-summary.png`, `pos-final12-1920.png`, `pos-accurate-before.png`, `pos-accurate-dialog.png`, `pos-accurate-mobile-dialog.png`, `pos-accurate-options.png`, `pos-payment-dialog-success-final.png`, `pos-accurate-before.png`, `pos-accurate-dialog.png`, `pos-accurate-mobile-dialog.png`, `pos-accurate-options.png`.

Catatan: temuan di atas adalah baseline audit sebelum implementasi; status implementasi dan verifikasi ulang ada di bagian atas.
