# SIM-2 Fase S1 — Simulasi Bisnis Inti Ujung-ke-Ujung + Rekonsiliasi

**Tanggal:** 2026-11-04 · **Bukti:** `tests/sim2/sim-bisnis.test.ts` (37 test, semua hijau, stabil pada larian ulang)
**Perusahaan fixture:** "SimMart" — `01900000-0000-7000-8000-00000000cc01` (khusus SIM-2, tidak dipakai suite lain; data ter-commit antar-langkah karena garis waktu berurutan, dibersihkan penuh di `beforeAll`/`afterAll`).
**Metode:** seluruh transaksi bisnis berjalan lewat domain (`src/server/*`) dan server action yang sesungguhnya (`checkoutAction`, `holdAction`, `runPayrollAction`, `payPayrollAction`, `setPeriodStatusAction` dengan sesi mock pola `payroll-reverse.test.ts`). SQL/Drizzle langsung hanya untuk setup master dan verifikasi angka. **Setiap ekspektasi nominal dihitung tangan dari skenario sebelum test dijalankan** — bukan diturunkan dari keluaran sistem.
**Hasil suite:** file baru 37/37 · suite penuh **627/627 (70 berkas)** — baseline S0 590 + 37 baru, nol regresi · `pnpm typecheck` bersih · `pnpm lint` bersih.

---

## 1. Skenario & hasil per langkah

Garis waktu: satu bulan berjalan (semua tanggal = hari berjalan; jurnal payroll terbit pada tanggal 28 bulan yang sama sesuai perilaku sistem). Modal awal Rp50.000.000 (Kas 45jt + Bank 5jt).

| # | Langkah | Status | Angka kunci terverifikasi (hitungan tangan = sistem) |
|---|---|---|---|
| 1 | Setup: 2 gudang, COA 35 akun + 24 pemetaan, 5 metode bayar, 12 produk (1 batch, 1 stok minimum khusus), 2 pemasok, 3 pelanggan, 3 karyawan | PASS | Master terbaca lengkap; saldo awal semua akun 0 |
| 2 | Modal awal Dr Kas 45jt + Dr Bank 5jt / Cr Modal 50jt | PASS | Kas 45.000.000; Bank 5.000.000; Modal −50.000.000 |
| 3 | PO-1 (S1) terima PENUH: AQUA 100 @2.500 + IND 100 @3.000 | PASS | Stok 100/100; AVCO = harga beli; jurnal Dr Persediaan 550.000 / Cr Utang 550.000; status PO `received`; utang S1 550.000 |
| 4 | PO-2 (S1) terima PARSIAL 30 lalu 20 dari 50 GULA @15.000 | PASS | Status PO `partial` → `received`; stok GULA 30 → 50; utang S1 1.000.000 → 1.300.000 |
| 5 | Terima KELEBIHAN dari sisa PO (sisa 0, coba +1) | PASS (ditolak) | Penolakan tanpa menulis apa pun: stok tetap 50, utang tetap 1.300.000 |
| 6 | Penerimaan langsung tanpa PO (S1): MINYAK 20 @34.000 + TISU 5 @13.500 | PASS | Utang S1 2.047.500 |
| 7 | Penerimaan batch S2: SUSU LOT-A 20 @5.000 (kedaluwarsa +10 hari), LOT-B 20 @5.200 (+60 hari) | PASS | AVCO global SUSU = **5.100** persis; batch 20/20; utang S2 204.000 |
| 8 | Retur#1: 5 SUSU rusak → potong utang (D-20) | PASS | Nilai retur 5 × 5.100 = 25.500; alokasi FEFO dari LOT-A (20→15); utang S2 178.500; Kredit Pemasok 0; `payableAmount` 25.500, `creditAmount` 0 |
| 9 | Utang S2 dilunasi FIFO 178.500; **pembayaran ganda** atas dokumen lunas | PASS (ganda ditolak) | `INVALID_STATE` "Utang sudah lunas"; utang S2 tetap 0; kas 44.821.500 |
| 10 | Retur#2: 10 SUSU kualitas, utang S2 sudah nol | PASS | Seluruh nilai 51.000 menjadi Kredit Pemasok (Dr 1210 per pihak S2 = 51.000); LOT-A 15→5 (FEFO); stok SUSU 25 |
| 11 | Penyelesaian campuran — kredit diterapkan ke penerimaan baru TEH 10 @4.000 | PASS | Utang TEH 40.000 lunas oleh kredit; sisa klaim 11.000; saldo 1210 = 11.000 |
| 12 | Penyelesaian campuran — refund sisa klaim 11.000 ke kas | PASS | Klaim habis; retur berstatus `resolved`; kas +11.000 → 44.832.500; saldo 1210 = 0 |
| 13 | Penerimaan KOPI S2 50 @1.500 dibiarkan terbuka | PASS | Utang S2 akhir 75.000 (bahan rekonsiliasi AP) |
| 14 | Bayar utang S1: sebagian 300.000 (`partial`) → lunas 250.000 → bayar lagi | PASS (bayar lagi ditolak) | `INVALID_STATE`; lalu sisa S1 1.497.500 dilunasi FIFO → utang S1 0; kas 42.785.000 |
| 15 | POS: sesi dibuka (modal laci 200.000); jual tunai AQUA 10 (dibayar 50.000) | PASS | Total 40.000, kembalian 10.000; jurnal Dr Kas 40.000 / Cr Penjualan 40.000 / Dr HPP 25.000 / Cr Persediaan 25.000; stok AQUA 90 |
| 16 | Jual QRIS IND 5 | PASS | Total 19.000; akun QRIS Clearing +19.000; stok IND 95 |
| 17 | Jual split tunai 20.000 + QRIS 16.000 (GULA 2) | PASS | Total 36.000; stok GULA 48; QRIS kumulatif 35.000 |
| 18 | Jual UTANG (D-19): MINYAK 10 ke Toko Berkah, jatuh tempo +14 hari | PASS | Piutang per pihak 390.000; daftar piutang menampilkan `dueDate` benar; stok MINYAK 10 |
| 19 | Jual utang melampaui batas kredit (390rb + 720rb > limit 1jt) | PASS (ditolak) | Pesan "Batas kredit … terlampaui"; stok & piutang tidak berubah |
| 20 | Jual SUSU 12 pcs — alokasi FEFO batch | PASS | LOT-A 5→0, LOT-B 20→13, stok SUSU 13 |
| 21 | Retur penjualan sebagian: 2 AQUA refund tunai | PASS | Stok 90→92; jurnal Dr Retur Penjualan 8.000 / Cr Kas 8.000 + Dr Persediaan 5.000 / Cr HPP 5.000; mutasi kas sesi −8.000 |
| 22 | Hold → resume → checkout merujuk tahanan (KOPI 5) | PASS | Resume baca-saja (tahanan tetap ada, stok tidak bergerak saat hold); checkout menghapus tahanan secara atomik; stok KOPI 50→45; total tertahan 12.500 = total checkout |
| 23 | **Konkurensi**: 2 penjualan bersamaan TISU 4 pcs (stok 5), transaksi terpisah | PASS | Tepat 1 berhasil, 1 ditolak `INSUFFICIENT_STOCK`; stok akhir 1 — tidak oversell, tidak negatif |
| 24 | Tutup sesi dengan hitungan fisik berbeda | PASS | Diharapkan 416.500, dihitung 414.500, selisih **−2.000** tercatat di sesi dan terjurnal Dr Selisih Kas Kurang 2.000 / Cr Kas 2.000 |
| 25 | Transfer antar-gudang AQUA 20 (Utama → Cabang) | PASS | WH1 72 / WH2 20; GL persediaan tak berubah 1.762.300 |
| 26 | Opname GULA: sistem 48, fisik 45 | PASS | Stok 45; jurnal Dr Selisih Persediaan 45.000 / Cr Persediaan 45.000 (3 × 15.000) |
| 27 | Peringatan stok minimum | PASS | Valuasi: SABUN (min 10, stok 0) & TEH (min 12, stok 10) terdaftar menipis; AQUA (stok 92) tidak |
| 28 | Beban listrik 750.000 lewat domain beban (jalur Catat Transaksi) dari Bank | PASS | Dr Beban Listrik / Cr Bank 750.000; Bank 4.250.000 |
| 29 | Penjualan tunai non-stok 100.000 (Catat Transaksi) | PASS | Dr Kas / Cr Pendapatan Lain-lain 100.000 |
| 30 | Terima piutang Toko Berkah sebagian 200.000 FIFO | PASS | Sisa piutang 190.000; status dokumen `partial`; GL 1200 per pihak = 190.000 |
| 31 | Jurnal manual seimbang: sewa 1.200.000 | PASS | Dr Beban Sewa / Cr Kas |
| 32 | Kasbon Andi 500.000, rencana cicilan tetap 200.000 (D-22) | PASS | Nomor seri KSB terbit; Dr Piutang Karyawan / Cr Kas 500.000 |
| 33 | Payroll bulan berjalan (3 karyawan) | PASS | Bruto 10.250.000; potongan kasbon Andi otomatis **200.000** sesuai rencana; bersih 10.050.000; jurnal Dr Beban Gaji 10.250.000 / Cr Utang Gaji 10.050.000 / Cr Piutang Karyawan 200.000 — seimbang; bersih Andi 4.300.000 |
| 34 | Payroll dibayar dari kas | PASS | Utang gaji (2100) kembali 0; sisa kasbon Andi terbawa 300.000 |
| 35 | Rekonsiliasi (lihat §2) | PASS | Semua identitas cocok persis |
| 36 | Tutup periode bulan berjalan, lalu posting | PASS (ditolak) | Jurnal manual & penerimaan bertanggal bulan tertutup ditolak `PERIOD_CLOSED` |

**Ringkasan status: 36 langkah skenario — 36 PASS · 0 FAIL · 0 NOT IMPLEMENTED.** Hold/resume yang dipertanyakan mandat ternyata terimplementasi penuh di domain + aksi (seri HOLD, klaim atomik saat checkout) dan terbukti di langkah 22. Tidak ditemukan bug produksi pada fase ini — tidak ada test `TEMUAN` yang perlu ditulis (lihat §4 untuk observasi non-bug).

---

## 2. Rekonsiliasi akhir (langkah 35) — angka yang dibuktikan

**Neraca saldo & identitas buku besar**
- `getTrialBalance` bulan berjalan: total debit = total kredit (selisih 0,00); Σ(debit − kredit) seluruh baris jurnal posted = **0**.
- Saldo GL per akun = hitungan tangan skenario (20 akun ditegaskan persis), antara lain: Kas **31.549.500**; Bank **4.250.000**; QRIS **35.000**; Piutang **190.000**; Piutang Karyawan **300.000**; Persediaan **1.717.300**; Utang **−75.000**; Modal **−50.000.000**; Penjualan **−649.500**; Retur Penjualan **8.000**; Pendapatan Lain **−100.000**; HPP **527.700**; Selisih Persediaan **45.000**; Beban Gaji **10.250.000**; Beban Sewa **1.200.000**; Beban Listrik **750.000**; Selisih Kas Kurang **2.000**; Kredit Pemasok & Utang Gaji **0**.

**Laba rugi** (`getIncomeStatement`, bulan berjalan)
- Pendapatan 641.500 (penjualan bruto 649.500 − retur 8.000) · Pendapatan lain 100.000 · HPP + selisih persediaan 572.700 · Laba kotor **68.800** · Total beban 12.202.000 · **Rugi bersih −12.033.200** (bulan pertama: payroll 3 karyawan mendominasi — wajar dan konsisten ke neraca).

**Neraca** (`getBalanceSheet`, akhir bulan): `balanced = true` — Aset **38.041.800** = Utang **75.000** + Ekuitas **37.966.800** (modal 50.000.000 + rugi berjalan −12.033.200).

**Subledger = akun kontrol**
- Nilai persediaan `getInventoryValuation` **1.717.300** = saldo GL 1300 = hitungan tangan Σ qty × AVCO (AQUA 92×2.500 + IND 95×3.000 + SUSU 13×5.100 + GULA 45×15.000 + MINYAK 10×34.000 + TEH 10×4.000 + KOPI 45×1.500 + TISU 1×13.500).
- Σ `listReceivables.outstanding` **190.000** = GL 1200. Σ `listPayables.outstanding` **75.000** = GL 2000.
- Invariant stok: `stock_on_hand` = Σ `stock_movements` untuk semua produk × gudang (0 baris menyimpang).

---

## 3. Cakupan mandat S1

| Butir mandat | Bukti langkah |
|---|---|
| Procurement penuh (PO, parsial, kelebihan, rusak/retur, tunai/kredit, pembayaran ganda) | 3–14 |
| Gudang (transfer, opname, stok minimum, batch/FEFO, AVCO, valuasi) | 7, 20, 25–27, §2 |
| POS (semua metode, split, utang & batas kredit, hold/resume, retur/refund, sesi & selisih kas, kasir bersamaan) | 15–24 |
| Akuntansi (jurnal manual, beban, entri cepat, terima piutang, tutup periode, 3 laporan rekonsiliasi) | 28–31, 35–36 |
| HR ringkas (kasbon → payroll → potongan otomatis → bayar) | 32–34 |

Di luar cakupan S1 sesuai rencana fase: payroll Indonesia penuh (S2), master data §18 (S3), data besar (S4), backup/round-trip (S5), keamanan (S6), offline POS (keputusan D-24).

## 4. Temuan

**Tidak ada temuan bug (SIM-xx) pada fase ini.** Seluruh penjaga yang diuji menolak dengan benar (kelebihan terima PO, pembayaran ganda, batas kredit, oversell konkuren, periode tertutup) dan seluruh angka rekonsiliasi cocok persis dengan hitungan tangan independen.

Dua observasi non-bug yang dicatat apa adanya (bukan kegagalan, tidak mengubah status langkah):

- **OBS-1 (informasi):** definisi "stok menipis" kanonis D-4 adalah `qty <= minStock`, sehingga produk dengan `minStock = 0` dan stok 0 (dalam skenario: BERAS, ROTI, TELUR — belum pernah distock) ikut terhitung menipis di daftar valuasi. Ini perilaku sesuai keputusan tercatat, bukan cacat hitung; bila daftar peringatan terasa bising, pengetatan definisi (`minStock > 0`) adalah keputusan produk untuk Pemimpin, bukan perbaikan bug.
- **OBS-2 (informasi):** jurnal payroll terbit bertanggal `‹periode›-28`. Bila payroll diproses sebelum tanggal 28, jurnalnya beredar lebih dulu dari tanggalnya di dalam bulan yang sama; periode & laporan bulanan tetap benar. Dicatat agar diketahui, bukan sebagai temuan.

## 5. Bukti perintah

| Perintah | Hasil |
|---|---|
| `pnpm exec vitest run tests/sim2/sim-bisnis.test.ts` | 37/37 lulus (±3–6 dtk) |
| Larian ulang file yang sama | 37/37 lulus (fixture idempoten) |
| `pnpm exec vitest run` (penuh) | **627/627 lulus, 70 berkas** (85 dtk) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (2 warning impor tak terpakai pada draf awal sudah dibersihkan) |
