# AUDIT & PERBAIKAN MODUL ANALISA

Tanggal: 2026-11-15. Rute: `/app/analisa`.

## Referensi

- **Odoo Inventory dashboards** — KPI, chart, dan daftar tindakan
  operasional, bukan sekadar tabel angka.
- **Accurate Online** — monitoring HPP/margin per produk, widget
  stok, dan laporan penjualan per produk.
- **ABC/FSN analysis** — klasifikasi kontribusi omzet (A/B/C) dan
  frekuensi pergerakan (F/S/N), plus turnover/GMROI/dead stock.

## Temuan

| Bagian | Kondisi sebelumnya | Penilaian |
| --- | --- | --- |
| Kesehatan bisnis | 4 metrik utama (omzet, margin, laba operasi, arus kas) | Baik |
| Tren | Tidak ada grafik; hanya angka periode | **Gap** |
| Aksi | Risiko stok hanya angka di bawah; tidak ada jalan kerja | **Gap** |
| Kinerja produk | Tabel dipotong 12 baris, tanpa pagination | **Gap workflow** |
| Mobile | Tabel lebar, tanpa card view | **Gap native** |
| ABC-FSN | Matriks dan penjelasan istilah | Baik |
| Penggerak/risiko | Turnover, GMROI, stockout, dead stock, shrinkage, accuracy | Baik |

## Perbaikan

1. **Tren omzet** — grafik harian periode terpilih + total dan
   pertumbuhan vs periode pembanding.
2. **Antrean aksi** — banner risiko di atas grafik: jumlah SKU stok
   habis, produk tidak bergerak, nilai stok mati, dengan tautan
   langsung ke tab “Stok habis”/“Tidak terjual”.
3. **Daftar produk lengkap** — pagination 20 baris (bukan potong 12)
   dengan parameter periode/view/pencarian yang dipertahankan.
4. **Card view mobile** — produk, SKU/kategori, qty/omzet/margin,
   ABC/FSN, atau stok/nilai untuk dead stock; tabel tetap desktop.
5. Angka `activeTotal` dan label tidak lagi menyesatkan (“12 dari N”
   diganti jumlah sebenarnya + pagination).

## Verifikasi

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — lulus.
- E2E `e2e/analisa.spec.ts` — struktur analisa + mobile 390px.
- Suite penuh **2444/2444**, E2E **57/57**.

## Sisa ide (bukan blocker)

- Ekspor XLSX untuk view analisa yang sedang aktif.
- Klik sel matriks ABC-FSN untuk memfilter daftar produk.
- Perbandingan dua periode sebagai dua seri pada grafik yang sama.
