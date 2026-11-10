# Laporan Tahap 2 — Gudang

Tanggal: 2026-11-03 · Pemimpin: sesi utama · Status: **SELESAI** (seluruh temuan audit Gudang tertangani kecuali GD-P2-5/P2-6 yang terjadwal ke Tahap 4; fitur spek pengguna G6/G7/G8 terimplementasi & teruji; review independen ditindaklanjuti)

## 1. Temuan audit (docs/audit/GUDANG.md — 29 temuan) & status akhir

| Kelompok | Isi ringkas | Status |
|---|---|---|
| GD-P0-1 | Tanda penyesuaian stok terbalik (rusak menambah stok, jurnal terbalik) | ✅ `14358a5` (Tahap 1 awal) |
| GD-P1-1 s.d. P1-8 | Jurnal penyesuaian campuran salah nilai; HPP per-gudang merusak rata-rata global; produk non-stok digerakkan POS; dokumen posted tanpa void; impor update menelan stok awal; validasi qty/biaya kosong; CRUD master setengah jadi | ✅ Semua — `cd35c6a`, `dca4bab`, `ff967d0` |
| GD-P2-1 s.d. P2-4 | Total dokumen selalu Rp0; tipe dokumen asli hilang di riwayat; karantina semu + jurnal replacement keliru; opname rawan race & baris ganda | ✅ `96d4407` (+ keputusan D-3, D-4) |
| GD-P2-5, P2-6 | Kartu stok mencampur gudang & tanpa batas; valuasi tanpa pagination & aritmetika Number | ⏳ Terjadwal Tahap 4 (performa/pagination) — dicatat jujur, bukan diklaim selesai |
| GD-P2-7 s.d. P2-10 | Review impor hanya 50 baris; batal impor menghapus jejak; gudang default tak konsisten; definisi stok menipis berbeda per halaman | ✅ `1f7e4c1`, `f7a2743` |
| GD-P3-1 s.d. P3-11 | Klaster impor (SKU fallback, data buruk tertelan, laporan hasil tak akurat, parse sheet pertama & nilai tampilan, muat ulang tabel penuh, error izin tertelan), dead code, pagination riwayat, pencarian pergerakan mati, form opname basi, update master tanpa NOT_FOUND, konflik taksonomi tertelan | ✅ `f7a2743`, `09ecb98`, `ff967d0` |

Fitur spek pengguna (A-6) yang ditambahkan di tahap ini di luar audit: **Terima Barang 3 skenario + cetak GRN** (`8952ad0`, desain D-5), **Purchase Order + rekomendasi pembelian** (`e1ac2c1`, D-6), **Batch & kedaluwarsa + FEFO** (`91524a6`, D-7).

## 2. Perbaikan & pembangunan (semua TDD, diverifikasi ulang Pemimpin per commit)

14 commit perbaikan/fitur di tahap ini (daftar lengkap di git log & PROGRESS.md). Sorotan integritas:
- HPP moving average kini global antar-gudang; produk jasa tidak lagi digerakkan stoknya dan tidak lagi mengkredit persediaan di jurnal penjualan (sebelumnya penjualan jasa bahkan gagal total bila stok negatif dilarang).
- Semua dokumen gudang punya jalur void yang sah dengan penjaga (stok sudah terpakai / sudah dibayar → ditolak beralasan), gerakan & jurnal pembalik tertaut, alasan wajib, audit.
- Penerimaan tidak lagi selalu berutang: sumber kredit/tunai/stok awal/bonus/retur pelanggan/lainnya masing-masing berjurnal benar; daftar utang tersaring dari utang hantu; akun bayar dibatasi server ke pemetaan kas/bank/qris (temuan review R-1).
- Batch: invariant Σ batch = stok tercatat; FEFO; batch kedaluwarsa tidak terjual; retur kembali ke batch asal.
- PO: terima melebihi pesanan ditolak sebelum penulisan; void penerimaan mengembalikan progres PO; pelepasan progres berlebih kini meledak sebagai error, tidak di-clamp diam-diam (R-10).

## 3. Fitur yang ditambahkan / dilengkapi

Terima barang bersumber dengan nomor invoice supplier & cetak GRN bertanda tangan; Purchase Order bersiklus penuh (draft→sent→partial→received/cancelled) + cetak PO + terima terhadap PO (termasuk multi-batch dalam satu penerimaan, R-4); rekomendasi pembelian dari stok menipis dengan qty saran berlabel jujur + buat PO per pemasok; batch & kedaluwarsa opt-in per produk dengan daftar peringatan kedaluwarsa di dashboard; CRUD master lengkap (kategori & satuan akhirnya bisa dibuat dari UI; edit semua master; hapus berpenjaga; nonaktif); impor yang aman dibatalkan dan jujur per baris; pagination & pencarian yang berfungsi di seluruh riwayat gudang.

## 4. UI/UX sebelum → sesudah

- Penerimaan: satu mode kredit paksa → pemilih sumber dengan petunjuk konsekuensi jurnal, pemilih akun bayar untuk tunai, kolom sumber & status jujur ("Lunas (tunai)"/"Tanpa utang"), tautan cetak GRN.
- Penyesuaian: tipe dokumen tampil "Penyesuaian" untuk semua → tipe asli (Rusak/Kedaluwarsa/Hilang/Karantina) tersimpan & tampil; karantina kini memindahkan barang betulan.
- Riwayat dokumen: terpotong 30–40 baris tanpa jalan ke yang lama → pagination penuh + pencarian pergerakan yang menyaring sungguhan.
- Impor: review mentok 50 baris & baris bermasalah tampil "Siap" → pagination + filter bermasalah + isu nyata per baris + peringatan sheet lain.
- Master data: kategori/satuan mustahil dibuat, form edit tidak terjangkau, hapus tidak ada → kelola penuh dari UI dengan penjaga yang menjelaskan.
- Opname: stok sistem basi saat ganti gudang & input satu-satu → ambil ulang otomatis + muat semua produk gudang (batas 1.000, diperingatkan).
- Produk: tanpa jejak batch → toggle lacak batch, input batch/kedaluwarsa di penerimaan, tabel stok per batch di detail produk.

## 5. Hasil tes & build (output nyata, dijalankan Pemimpin)

- Awal tahap: 115 test → akhir tahap: **210/210 lulus (23 berkas)**; `pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm build` exit 0 pada commit penutup `adc2d79`.
- **Matriks Verifikasi Fitur (A-5)**: `docs/reports/MATRIKS-FITUR-GUDANG.md` — 50 fitur ditelusur ke bukti uji; 42 terbukti otomatis, 2 UI/build (cetak GRN/PO → e2e Tahap 5), 1 sebagian (konkurensi), 5 celah = fitur belum dibangun yang terjadwal (bukan kegagalan).
- **Test simulasi pengguna hijau persis**: terima tunai 100 @2.500 → jual 1 @3.000 → stok 99, laba kotor Rp500 (`goods-receipt.test.ts`).
- **Review kode independen (A-7)** atas diff tahap: 0 P0, 1 P1, 4 P2, 6 P3 — 10 ditindaklanjuti & ter-commit (`adc2d79`, 8 test baru RED→GREEN), 1 (R-5 kunci retur POS) dijadwalkan sebagai perbaikan pembuka Tahap 3. Migrasi tahap ini (0009, 0010, 0011) diperiksa Pemimpin baris per baris: aditif + RLS konsisten.
- DB dev di-reseed pada gerbang tahap (65 produk, Rp28.349.600 — sama dengan baseline; consistency hijau).

## 6. Sisa masalah & rencana berikutnya

- GD-P2-5 (kartu stok per gudang + pagination) & GD-P2-6 (valuasi berpaginasi + Decimal) → Tahap 4.
- Fitur belum dibangun dari matriks: kategori bertingkat, konversi multi-satuan, atribut produk kustom → lapisan platform Tahap 5; edit baris impor di tempat → Tahap 4 bersama perluasan impor/ekspor.
- Utang uji konkurensi: kunci terverifikasi dari kode + pola ON CONFLICT (R-3) dan urutan kunci tunggal (R-2) sudah diterapkan; test balapan dua-transaksi paralel belum ada (matriks menandainya "sebagian") → kandidat Tahap 5.
- `finalizeImportAction` dipertahankan (kontrak teruji, belum terhubung UI) — keputusan hubungkan/hapus diambil di Tahap 4 saat perluasan impor/ekspor.
- Berikutnya: **Tahap 3 POS** — dibuka dengan R-5/POS-RET-01 (kunci baris penjualan di retur + restore batch di bawah kunci), lalu POS-RCPT-01, POS-HOLD-01, POS-CASH-01, batas diskon manual, dan Matriks Verifikasi Fitur POS; keputusan arsitektur offline (A-2) diambil di tahap ini.
