# Analisa Konflik POS → Akuntansi → Gudang

- **Tanggal**: 13 November 2026
- **Mode**: Read-only analysis
- **Sumber bukti**:
  - kode `src/server/pos/*`, `src/server/inventory/*`, `src/server/reports/*`
  - backup `backups/bisa-pre-remediation-20261113-1794539771863.dump` yang direstore ke database sementara `bisa_audit` (tidak menyentuh DB utama)
- **DB utama saat analisa**: kosong (0 sales/products/movements), sehingga bukti transaksi diambil dari backup.

---

## 1. Workflow Standar

Perpetual inventory, penjualan tunai:

```
Dr Kas/Bank                  Rp jual
  Cr Pendapatan Penjualan             Rp jual
  Cr PPN Keluaran (jika ada)          Rp pajak

Dr Harga Pokok Penjualan     Rp HPP
  Cr Persediaan                       Rp HPP

Stok fisik: berkurang qty terjual
```

Referensi: OpenStax Financial Accounting 6.4; Strategic CFO POS method.

---

## 2. Yang Dilakukan Kode

- `applySaleStockMovements()` menulis `delta: -line.qty` untuk setiap baris stok.
- `postSaleJournal()` menulis:
  - `Dr COGS`
  - `Cr Inventory`
- `getStockCard()` menambah qty bertanda ke running balance.
- `getBalanceSheet()` menghitung aset sebagai `debit − credit`.

**Kesimpulan kode: arah normal sudah benar, tidak ada pembalikan.**

---

## 3. Bukti dari Backup

Contoh penjualan `INV-2026-00015`:

- Stock movement: `sale`, qty `-1`, unit cost `250.75`.
- Jurnal:
  - `Dr Tunai` 500
  - `Cr Penjualan` 500
  - `Dr COGS` 250.75
  - `Cr Persediaan` 250.75

Query integritas:

| Cek | Hasil |
|---|---|
| Stok `sale` dengan qty positif | **0** |
| Jurnal `sale` yang mendebit akun Persediaan | **0** |
| Jurnal `sale` yang mengkredit Persediaan | ada (benar) |

Jadi untuk penjualan normal, stok dan jurnal **sudah berlawanan arah yang benar**: stok turun, persediaan GL turun, HPP naik.

---

## 4. Konflik yang Ditemukan

### K-01 — Dua definisi “Nilai Persediaan” yang berbeda

- **Dashboard/Akuntansi** memakai `mappedBalance(inventory)` → saldo GL akun `110401`.
- **Gudang/Nilai Persediaan** memakai `getInventoryValuation()` → `Σ qty × products.cost_price`.

Pada backup:

| Sumber | Nilai |
|---|---:|
| GL Persediaan (`110401`) | **Rp 601.870,50** |
| Valuasi stok (`qty × cost`) | **Rp 1.356.945.870,50** |

Selisih ≈ **Rp 1,356 miliar**. Ini membuat dua halaman bisa terlihat “berkebalikan” karena sumber angkanya berbeda.

### K-02 — Stock movement tanpa jurnal (polusi data uji)

Ditemukan movement `opening` tanpa `reference_number` dan tanpa jurnal:

| SKU | Qty | Unit cost | Nilai |
|---|---:|---:|---:|
| `UJI-PENJAGA-1` | 100.000 | 6.000 | Rp 600.000.000 |
| `UJI-REVIEW-T3-1` | 100.000 | 6.000 | Rp 600.000.000 |

Dua baris ini menyumbang **Rp 1,2 miliar** dari valuasi stok, tetapi tidak memiliki jurnal persediaan. Ini artefak test yang masuk ke database pengembangan.

### K-03 — Belum ada rekonsiliasi GL vs subledger

Tidak ada penjaga yang membandingkan:
- saldo akun Persediaan GL, dengan
- `Σ stock_movements.qty × unit_cost` per produk/gudang.

Akibatnya divergensi seperti K-01/K-02 tidak pernah muncul sebagai error; pengguna hanya melihat angka yang berbeda antar halaman.

### K-04 — Konteks transaksi bisa disalahartikan

Yang **menambah** persediaan adalah:
- pembelian/penerimaan,
- retur penjualan,
- opname surplus,
- void penjualan (pembalik).

Jika pengguna melihat stok naik setelah “transaksi POS”, perlu dipastikan itu penjualan normal, retur, atau void. Normal sale tidak pernah menambah stok.

### K-05 — Laba penjualan memang naik (bukan bug)

`getSalesSummary()` menghitung:
`profit = total − pajak − HPP`.
Menjual memang menaikkan laba dan menurunkan persediaan. Jika yang terlihat “laba naik” bersamaan dengan “stok naik”, itu bukan dari penjualan normal — kemungkinan dari retur/void atau data uji.

---

## 5. Rekomendasi

1. **Bersihkan database pengembangan** dari SKU/test fixtures (`UJI-*`, `T5-*`, `GDG*`, `G2-*`) atau reset + seed ulang.
2. **Tambahkan laporan rekonsiliasi** “GL Persediaan vs Valuasi Stok” per produk/gudang, dengan selisih dan tautan ke jurnal/movement.
3. **Validasi saat impor/opening stock**: setiap movement `opening` wajib punya jurnal posted; tolak jika tidak.
4. **Beri label sumber angka** di dashboard: “Nilai Persediaan (GL)” vs “Valuasi Stok (qty × biaya)” agar tidak dibandingkan sebagai angka yang sama.
5. **Tambahkan jejak audit per penjualan**: nota → stock movement → jurnal, sehingga kasir/owner bisa melihat arah mutasi.
6. **Cek status transaksi** sebelum menyimpulkan: `completed` vs `returned` vs `void`.

---

## 6. Kesimpulan

- **Penjualan normal POS tidak membalik stok/jurnal.** Bukti backup: stok `-1`, jurnal `Cr Persediaan`.
- **Konflik nyata ada di data**: valuasi stok dan GL berbeda karena opening movement test tanpa jurnal, ditambah dua definisi nilai persediaan yang dipakai di halaman berbeda.
- **Dampak**: pengguna melihat angka persediaan naik/turun tidak konsisten dan mengira alur POS terbalik.
- **Prioritas**: bersihkan data uji, tambah rekonsiliasi GL vs subledger, dan beri label sumber angka.
