# AUDIT & REDESAIN DASHBOARD UTAMA

Tanggal: 2026-11-15. Rute: `/app` (Beranda).

## Referensi

- **Odoo Accounting Pro Dashboard** — KPI tiles, date range, chart,
  dan follow-up list; angka kerja sebelum dekorasi.
- **Accurate Online Dashboard** — widget kas/bank, penjualan, laba,
  faktur jatuh tempo, dan pengingat piutang.
- **SAP Fiori Overview Page** — kartu ringkasan + daftar tindakan;
  hierarki jelas, bukan dinding kartu.

## Masalah desain sebelumnya

1. Paragraf sambutan panjang ("Pantau penjualan, stok...") memakan
   ruang dan terasa seperti teks marketing, bukan alat kerja.
2. Antrean **Perlu perhatian** tersembunyi di kolom kanan bawah —
   padahal itu pekerjaan yang harus dikerjakan lebih dulu.
3. KPI hanya 4 dan tidak menampilkan **piutang/utang**, padahal
   pemilik toko butuh posisi pihak setiap hari.
4. Kartu modul memakai blok warna aksen berbeda-beda — dekoratif,
   bukan informasi.
5. Tidak ada aksi utama di atas layar; pengguna harus mencari menu.

## Desain baru

Urutan kerja: **Ringkasan → Tindakan → Tren → Ruang kerja → Aktivitas**.

- **Header ringkas** dengan aksi utama `Mulai kasir` + `Jurnal baru`
  dan status sesi/stok.
- **KPI band 5 kartu**: penjualan hari ini, penjualan periode,
  kas/bank, piutang terbuka, utang terbuka — dengan konteks jatuh
  tempo, bukan sekadar angka.
- **Antrean tindakan** tepat di bawah KPI: stok menipis, sesi kas,
  piutang terlambat, utang jatuh tempo, pesanan ditahan, migrasi data.
- **Tren penjualan + produk terlaris** tetap sebagai sepasang panel.
- **Ruang kerja** netral: ikon monokrom, metrik per modul, tanpa blok
  warna dekoratif.
- **Transaksi terakhir + pintasan** di bawah.

## Verifikasi

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — lulus.
- E2E `e2e/dashboard.spec.ts` — struktur dan mobile 390px.
- E2E aksesibilitas `/app` — 0 critical/serious (axe WCAG 2 A/AA).
- Suite penuh **2444/2444**, E2E **55/55**.
