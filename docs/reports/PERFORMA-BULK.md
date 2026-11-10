# Bukti Performa Dataset Besar — T4-6b (AK-P3-05 penutup)

Tanggal ukur: 4 November 2026 · Lingkungan: PostgreSQL 18.6 lokal (port 5433, VM yang sama dengan dev), fungsi server dipanggil langsung lewat `withCompanyReadOnly` (jalur yang sama dengan halaman).

## Dataset (database scratch `bisa_bulk`, BUKAN database dev)

Database terpisah `bisa_bulk` dibuat di server PG18 yang sama, dimigrasi penuh (18 migrasi), lalu diisi `pnpm db:seed:bulk` dan data pelengkap sintetis khusus scratch. Sesudah pengukuran database **di-DROP**.

| Ukuran | Jumlah |
| --- | --- |
| Produk | 10.200 |
| Gerakan stok (`stock_movements`) | 12.700 |
| Gerakan produk terbanyak (SKU-00001) | 2.501 |
| Jurnal (`journal_entries`) | 6.001 |
| Baris jurnal (`journal_lines`) | 12.003 |
| Nilai persediaan hasil seed | Rp17.873.972.200 |

Catatan kejujuran data: seed bulk bawaan hanya membuat **satu gerakan stok per produk** dan **satu jurnal pembuka**, sehingga halaman 40 kartu stok dan daftar jurnal tidak terukur dari seed murni. Karena itu, khusus di database scratch ditambahkan lewat SQL: 2.500 gerakan tambahan untuk SKU-00001 (bergantian `purchase` +2 / `sale` −1, `stock_on_hand` disesuaikan ke Σ gerakan) dan 6.000 jurnal `BENCH-*` (masing-masing 2 baris seimbang Dr beban / Cr pendapatan, tanggal tersebar Jan–Okt 2026). Database dev utama tidak disentuh sama sekali.

## Hasil (median dari 3× jalan sesudah 1× pemanasan)

| Fungsi | Skenario | Median | Rentang 3× |
| --- | --- | --- | --- |
| `getInventoryValuation` | semua 10.200 produk (tanpa pagination) | **197,5 ms** | 186,3–268,6 ms |
| `getStockCard` | halaman 40, pageSize 50, produk 2.501 gerakan | **13,0 ms** | 12,4–14,1 ms |
| `listJournalEntries` | halaman 1, pageSize 25, dari 6.001 jurnal | **6,1 ms** | 5,8–6,6 ms |
| `getIncomeStatement` | periode 2026 penuh (12.003 baris jurnal) | **41,1 ms** | 40,4–58,0 ms |

Semua jauh di bawah target misi (halaman < 2 detik). Angka mencakup pembukaan transaksi `withCompanyReadOnly` + `set_config` RLS per panggilan. Ini pengukuran fungsi server di mesin lokal yang sama — bukan uji beban jaringan/browser; uji e2e performa ujung-ke-ujung tetap pekerjaan Tahap 5.

## Temuan samping yang penting (di luar angka)

Migrasi ke database yang **benar-benar baru** gagal di migrasi `0000` pernyataan ke-99: indeks `products_company_name_trgm_idx` membutuhkan operator class `gin_trgm_ops`, tetapi tidak ada migrasi yang membuat ekstensi `pg_trgm` — database dev berfungsi hanya karena ekstensinya sudah ada dari penyiapan awal. Di `bisa_bulk` masalah hilang setelah `CREATE EXTENSION pg_trgm` manual. Rekomendasi: tambahkan migrasi `CREATE EXTENSION IF NOT EXISTS pg_trgm` sebelum indeks tersebut (atau dokumentasikan sebagai prasyarat deploy) — perlu keputusan Pemimpin karena menyentuh rantai migrasi.
