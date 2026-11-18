# AUDIT UI/UX MODUL POS

Tanggal: 2026-11-15. Fokus: kecepatan kasir, kejelasan status, bentuk
tabel/form native di desktop & mobile, serta konsistensi alur.

## Referensi

- **Square POS / Shopify POS / Loyverse** — barcode-first, keranjang
  selalu terlihat di desktop, sheet keranjang di mobile, bar total +
  bayar menetap, status offline jelas.
- **Odoo POS** — sesi kas, buka/tutup laci, hitung pecahan, retur
  berbasis nota asal.
- **SAP Fiori List Report** — filter status, tabel ringkas, aksi per
  baris, kartu mobile untuk daftar admin.

## Inventaris

| # | Bagian | Rute | Isi |
| --- | --- | --- | --- |
| 1 | Terminal kasir | `/app/pos` | Katalog, keranjang, pembayaran, tahan/resume, offline |
| 2 | Riwayat penjualan | `/app/pos/riwayat` | Filter status/tanggal, KPI, aksi void/retur |
| 3 | Nota & faktur | `/app/pos/nota/[id]`, `faktur` | Struk, salinan, faktur |
| 4 | Retur penjualan | `/app/pos/retur` | Pilih nota, form retur, riwayat |
| 5 | Pesanan ditahan | `/app/pos/ditahan` | Resume/hapus keranjang ditahan |
| 6 | Sesi kas | `/app/pos/sesi` | Buka/tutup laci, pecahan, setor/tarik |
| 7 | Riwayat sesi | `/app/pos/sesi/riwayat` | Filter status/kasir/cabang/tanggal, ekspor |
| 8 | Detail sesi | `/app/pos/sesi/riwayat/[id]` | Mutasi kas, cetak |
| 9 | Piutang POS | `/app/pos/piutang` | Daftar kredit pelanggan, pembayaran |
| 10 | Antrean offline | `/app/pos/offline` | Konflik stok, gagal sinkron, review |
| 11 | Terminal admin | `/app/pos/terminal` | Pasangkan/revoke terminal desktop |
| 12 | Kelompok harga | `/app/pos/grup` | Master kelompok harga |

## Matriks audit

| Bagian | Status | Catatan |
| --- | --- | --- |
| Terminal — pencarian/scan | Baik | Fokus otomatis, Enter secepat scanner = barcode, grid/list/density dapat diatur |
| Terminal — keranjang desktop | Baik | Panel sticky, total & Bayar selalu terlihat |
| Terminal — keranjang mobile | **Diperbaiki** | Sebelumnya keranjang berada di bawah 24 kartu produk; kini bar bawah membuka sheet keranjang + pembayaran |
| Terminal — offline | Baik | Indikator online/antre/sinkron, antrean tidak hilang |
| Riwayat penjualan | **Diperbaiki** | Tabel desktop + kartu mobile (nomor, waktu, pelanggan, total, status, aksi) |
| Retur | Baik | Pemilih nota bertahap, kartu mobile, form retur per baris asal |
| Pesanan ditahan | **Diperbaiki** | Kartu mobile dengan aksi resume/hapus |
| Sesi kas | Baik | Hitung pecahan, alasan selisih, setor/tarik |
| Detail sesi | **Diperbaiki** | Mutasi kas sebagai kartu mobile: jenis, nominal, waktu, pelaku, catatan |
| Riwayat sesi | **Diperbaiki** | Tabel desktop + kartu mobile (kasir, waktu, transaksi, seharusnya, dihitung, selisih) |
| Piutang POS | **Diperbaiki** | Kartu mobile: nomor, pelanggan, jatuh tempo, sisa, status, statement, tombol Terima |
| Antrean offline | Baik | KPI konflik/gagal, aksi review |
| Terminal admin | Baik | Pasangkan/revoke dengan status |

## Perbaikan yang diterapkan

1. **Mobile cart sheet** — `MobilePayBar` membuka sheet penuh berisi
   `CartPanel` + `PaymentPanel`; satu instance state, jadi pembayaran
   tidak bercabang antara mobile dan desktop. Tombol Tutup + judul
   “Keranjang & pembayaran”.
2. **Card view mobile** untuk Riwayat Penjualan, Pesanan Ditahan, dan
   Riwayat Sesi — tabel hanya desktop; tidak ada scroll horizontal
   dokumen di 390px.
3. Komponen header sheet dipisah ke `terminal/mobile-pay-bar.tsx`
   agar `pos-terminal.tsx` tetap ≤800 baris (ratchet arsitektur).

## Pembaruan 16 November 2026

1. **Navigasi kategori server-side** — chip kategori di atas kisi produk
   (rail horizontal, target 44px, `aria-pressed`). Katalog tidak lagi
   memuat seluruh produk ke klien; `searchProducts` menerima `categoryId`
   dan hanya mengembalikan halaman kategori aktif. Pindai barcode tetap
   lintas kategori agar barang yang dipindai tidak “hilang” saat filter
   menyala.
2. **Target sentuh & tipografi** — kotak cari dan pemilih gudang 44px,
   chip kategori 44px, chip uang cepat 40px, metode pembayaran minimal
   44px. Nama produk naik ke 15–16px dan harga 17–18px.
3. **Status sesi selalu terlihat** — chip “Sesi kas terbuka / belum
   dibuka” di toolbar terminal, satu tap menuju halaman buka/tutup.
   Status tidak lagi tersembunyi di dalam menu.
4. **Modal sukses checkout** — setelah bayar, terminal tidak berpindah
   halaman; modal menampilkan total, kembalian, cetak struk, dan
   “Transaksi Baru” (Enter). Detail nota tetap dapat dibuka.
5. **Printer ESC/POS** — tipe minimal Web Bluetooth/WebUSB/Web Serial
   dipisah ke `src/lib/escpos/web-printer-types.ts`; tidak ada `any` dan
   berkas koneksi kembali di bawah ratchet 800 baris.

## Sisa gap

1. Terminal belum menyediakan mode “kiosk”/customer display; saat ini
   fokus pada perangkat kasir. Ini fitur baru, bukan perbaikan tabel/form.
2. Split bill per item dan modifier/resep belum menjadi alur inti;
   pembayaran campuran sudah tersedia, split per baris belum.
3. Label pesanan ditahan masih meminta nama manual (POS-WF-03).

## Verifikasi

- `pnpm typecheck` — lulus.
- `pnpm lint` — 0 error (15 warning lama di modul lain).
- `pnpm build` — lulus.
- Vitest penuh — 278 berkas, 2450 test lulus.
- E2E penuh — 58 test lulus pada DB disposable.
- Test integrasi baru `tests/integration/pos-search-category.test.ts` —
  filter kategori tidak membocorkan produk di luar kategori.
- E2E `e2e/pos-native.spec.ts` — sheet keranjang mobile, kartu daftar
  POS tanpa overflow, dan chip kategori.
- E2E `e2e/pos-list-native.spec.ts` — kartu piutang (tombol Terima) dan
  kartu mutasi detail sesi; tabel desktop tetap tampil.
