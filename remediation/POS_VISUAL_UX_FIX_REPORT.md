# POS Visual/UX Remediation — 2026-11-23

Status: implementasi selesai untuk temuan visual/UX prioritas; verifikasi teknis lulus.  
Branch: working tree saat ini (tanpa commit/deploy).  
Sumber temuan: audit visual POS 2026-11-21 (VIS-01–VIS-15).

> Catatan: working tree saat ini juga memuat perubahan/penghapusan berkas di luar POS
> yang sudah ada sebelumnya (mis. folder `audit/`). Pass ini tidak menghapus atau
> memulihkan berkas tersebut.

---

## 1. Ringkasan

Perbaikan difokuskan pada hal yang membuat POS sulit dipakai di layar nyata:

- panel pembayaran tertutup/ di bawah lipatan pada laptop 1366×768 dan 1280×720;
- nominal mutasi kas hilang di mobile;
- tabel riwayat sesi terpotong di desktop;
- dialog konfirmasi tidak menahan fokus;
- target sentuh halaman pendukung 16–36px;
- urutan form retur 1 → 3 → 2;
- chrome mobile terlalu tinggi dan sheet keranjang tidak terasa native.

---

## 2. Status temuan

| ID | Temuan | Status | Bukti |
|---|---|---|---|
| VIS-01 | Pembayaran tidak terlihat di laptop pendek | **Fixed** | 1280×720 & 1366×768: input 605–641, Bayar 707–755, footer 694/646; tidak tertutup |
| VIS-02 | Mutasi kas mobile tanpa Nominal | **Fixed** | Kartu mobile: `Rp 11.000`, `Rp 8.500`, dst.; tabel desktop tetap |
| VIS-03 | Riwayat sesi desktop terpotong | **Fixed** | 8 kolom, lebar 1134 = card 1134, `scrollWidth = clientWidth` |
| VIS-04 | ConfirmDialog fokus bocor | **Fixed** | Tab berputar Batal ↔ Ya; fokus kembali; axe 0 |
| VIS-05 | Target sentuh <44px | **Fixed untuk konten POS** | Audit mobile: 0 kontrol <44px di terminal/riwayat/retur/sesi/piutang/ditahan; hanya link inline “Pengaturan → Cetak” |
| VIS-06 | Urutan retur 1/3/2 | **Fixed** | 1 Barang → 2 Kondisi → 3 Alasan → 4 Penyelesaian; hint “Lengkapi: …” |
| VIS-07 | Chrome mobile 317px | **Improved** | Produk pertama 265px; pencarian global & layar penuh disembunyikan di POS mobile |
| VIS-08 | Metode non-tunai tersembunyi | **Improved** | Dua metode alternatif langsung (QRIS/Transfer/Tunai) + menu untuk sisanya |
| VIS-09 | Diskon/kredit retur 16–17px | **Fixed** | Trigger dan editor 44px |
| VIS-10 | Dua bahasa desain | **Partial** | Halaman pendukung naik ke 44px/13px; tipografi tabel masih 11–13px |
| VIS-11 | Istilah/tanggal tidak konsisten | **Partial** | Void→Batal, tanggal sesi/mutasi format `id-ID`; format nol & judul belum seluruhnya |
| VIS-12 | Navigasi mobile ganda | **Partial** | Hamburger 44px, aksi retur berlabel; dua pintu navigasi masih ada |
| VIS-13 | Tabel: header/sort/tanggal duplikat | **Partial** | Header 12px; riwayat sesi ringkas; sticky header/sort/duplikasi tanggal belum |
| VIS-14 | Pencarian tanpa recovery | **Improved** | Tombol hapus + empty state; pagination masih di bawah grid |
| VIS-15 | Axe label mismatch/scroll region | **Fixed** | 7 halaman POS + sheet mobile: 0 violations |

---

## 3. Perubahan utama

### Terminal dan pembayaran
- Footer `Bayar`/`Tahan` dipindah ke luar kartu pembayaran dan tetap `sticky` terhadap scrollport panel kanan.
- Panel kanan memakai tinggi tetap `calc(100dvh - 76px)`; daftar baris dibatasi 320px (180px pada tinggi ≤850px).
- Baris harga penuh disembunyikan pada laptop pendek; selector harga ringkas muncul di header keranjang.
- Header keranjang tidak lagi memuat ikon riwayat/sesi/piutang (sudah ada di menu POS); badge `3 baris` tidak membungkus.
- Dua metode alternatif langsung ditampilkan di sebelah metode aktif.
- Sheet keranjang mobile menjadi **bottom sheet** 92dvh, sudut atas membulat, dan scrim lebih jelas; tanpa handle palsu — tutup lewat tombol/scrim.
- Di sheet mobile, total ganda di kartu keranjang disembunyikan (header sheet tetap menampilkan total) dan daftar baris dibatasi 200px agar Uang diterima + Bayar tetap terlihat.
- Bottom bar mobile menampilkan item terakhir + jumlah baris + total, mengikuti pola Shopify POS “keep the cart in view”.
- Tombol Bayar 48px; target utama tetap 44–48px.

### Tabel dan sesi
- Mutasi Kas: kartu label-nilai di mobile/tablet; tabel tetap di desktop; region tabel dapat difokus keyboard.
- Riwayat sesi: 12 kolom menjadi 8 kolom (Kasir+status, Waktu, Transaksi+non-tunai, Modal, Mutasi masuk/keluar, Seharusnya, Dihitung, Selisih); tanpa scroll horizontal.
- Tanggal sesi dan mutasi memakai `formatDateTime` (`id-ID`).
- Input, tombol bank, `Cetak X`, dan tombol kunci 44px.

### Form retur
- Urutan section diperbaiki.
- Footer tidak lagi sticky; tidak menutupi field terakhir.
- `Simpan retur` nonaktif disertai daftar syarat yang kurang.
- Qty, preset alasan, select, dan tombol 44px; helper text 11px.

### Dialog, pencarian, dan shell
- `ConfirmDialog`: focus trap Tab/Shift+Tab, focus restore, Escape, tombol 44px, centered.
- Pencarian produk: tombol hapus 44px, empty state “Hapus pencarian”.
- Global command palette disembunyikan di POS mobile; label aksesibel diperbaiki.
- Hamburger mobile 44px; item menu pengguna 44px.
- PageHeader “Penjelasan halaman” 44px di mobile.
- Filter chip, date field, pagination, row menu, print button, dan aksi baris 44px di layar kecil.

---

## 4. Verifikasi

### Teknis

| Perintah | Hasil |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm test` | **143 files / 1235 tests PASS** |
| `pnpm lint` (seluruh repo) | PASS (exit 0) |
| `pnpm exec eslint` (POS/blocks/shell/date-field/sheet/tes) | PASS (exit 0) |
| `BISA_TEST_BUILD=1 pnpm build` | PASS (exit 0) |
| Playwright `pos-native` + `pos-list-native` + `pos-keyboard` (reseed kanonis) | **10/10 PASS** |

### Browser

| Pemeriksaan | Hasil |
|---|---|
| Layout 1440/1366/1280/1024 | input Uang diterima & Bayar terlihat, tidak tertutup |
| Mobile 390 | produk pertama 265px; global search & fullscreen hidden; kontrol POS 44px |
| Bottom sheet | top 68, height 776 (92dvh); 3 item: input 721–757, Bayar 783, tidak tertutup |
| Mutasi mobile | nominal terlihat di kartu; tidak ada horizontal overflow |
| Riwayat sesi 1440 | 1134/1134, tanpa overflow, status & selisih terlihat |
| ConfirmDialog | fokus berputar di dalam dialog; tidak bisa ke kontrol latar |
| Retur mobile | urutan 1→2→3→4; hint syarat; footer tidak menutupi |
| Axe | 0 violations di 7 halaman POS + sheet mobile |
| Touch audit | 0 kontrol <44px di konten POS; hanya link inline “Pengaturan → Cetak” |
| E2E POS | 10/10 lulus dengan `BISA_E2E_RESEED=1` (bottom sheet, kartu mobile, keyboard) |

E2E gate mereset perusahaan demo ke baseline kanonis (65 produk). Ini data demo,
bukan data produksi.

Screenshot after: `audit-reports/pos-visual-2026-11-21/after/`.

---

## 5. Referensi desain

- Shopify, *Keep the cart in view on mobile POS* (2026-09): cart persisten,
  item terakhir + jumlah + total, buka cart satu tap.
  https://changelog.shopify.com/posts/keep-the-cart-in-view-on-mobile-pos
- Shopify, *Checkout Kit* (2026): checkout mobile sebagai native sheet,
  drag handle, snap points, dismiss.
  https://shopify.dev/docs/storefronts/mobile/checkout-kit/configuration
- Material Design 3, *Bottom sheets*: container, drag handle, scrim, modal.
  https://m3.material.io/components/bottom-sheets/guidelines
- Material Design 3, *Grids & spacing*: target minimum 48×48 CSS px.
  https://m3.material.io/foundations/layout/grids-spacing/density
- Apple HIG: kontrol minimal 44×44 pt.
  https://developer.apple.com/design/tips/
- W3C WCAG 2.2 SC 2.5.8: target minimum 24×24 CSS px + pengecualian.
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C WCAG 2.2 SC 2.5.3 Label in Name.
  https://www.w3.org/TR/WCAG22/
- NN/g, *Mobile Tables*: kolom harus legibel tanpa zoom; rotasi bukan solusi utama.
  https://www.nngroup.com/articles/mobile-tables/

---

## 6. Residual risk / belum dikerjakan

- **Dark mode** tidak diverifikasi; tema class-based, emulasi media query tetap terang.
- **Alur tulis** (tutup sesi, void, retur posting, piutang bayar, resume held sale)
  tidak diselesaikan dalam pass ini; tidak ada data uji untuk piutang/held/offline.
- **Terminal Desktop POS** (halaman admin pairing) masih memakai kontrol 28–36px;
  bukan alur kasir.
- **Tabel**: sticky header, sort, dan duplikasi tanggal di riwayat belum diubah.
- **Bottom sheet**: tutup lewat tombol/scrim/Esc; drag-to-dismiss belum ada dan
  handle visual sengaja tidak dipasang agar tidak menjadi affordance palsu.
- **Piutang**: filter bersama sudah 44px; tabel baris dan form pembayaran belum
  diuji dengan data nyata.
- **Tipografi**: tabel masih 11–13px; belum disatukan penuh dengan skala terminal.

---

## 7. Berkas utama yang diubah

- `src/components/pos/pos-terminal.tsx`
- `src/components/pos/cart-panel.tsx`
- `src/components/pos/payment-panel.tsx`
- `src/components/pos/payment/credit-section.tsx`
- `src/components/pos/terminal/mobile-pay-bar.tsx`
- `src/components/pos/terminal/product-catalog.tsx`
- `src/components/pos/session-manager.tsx`
- `src/components/pos/session-history-list.tsx`
- `src/components/pos/return-form.tsx`
- `src/components/pos/sale-row-actions.tsx`
- `src/components/pos/terminal-dialogs.tsx`
- `src/components/pos/receipt-print.tsx`
- `src/components/pos/pos-display.tsx`
- `src/components/pos/pos-action-menu.tsx`
- `src/components/blocks/confirm-dialog.tsx`
- `src/components/blocks/data-list.tsx`
- `src/components/blocks/page-header.tsx`
- `src/components/blocks/pagination.tsx`
- `src/components/blocks/row-menu.tsx`
- `src/components/blocks/search-form.tsx`
- `src/components/blocks/field-classes.ts`
- `src/components/date-field.tsx`
- `src/components/shell/app-switcher.tsx`
- `src/components/shell/command-palette.tsx`
- `src/components/shell/mobile-nav.tsx`
- `src/components/shell/user-menu.tsx`
- `src/components/ui/sheet.tsx`
- `eslint.config.mjs`
- `src/app/globals.css`
- `src/app/app/pos/riwayat/page.tsx`
- `src/app/app/pos/ditahan/page.tsx`
- `src/app/app/pos/grup/page.tsx`
- `src/app/app/pos/retur/page.tsx`
- `src/app/app/pos/sesi/page.tsx`
- `src/app/app/pos/sesi/riwayat/page.tsx`
- `src/app/app/pos/nota/[id]/page.tsx`
- `src/app/app/pos/nota/[id]/faktur/page.tsx`
- `tests/unit/pos-visual-ux.test.ts`

Tidak ada commit, push, deploy, atau perubahan pada logika akuntansi/stok.
