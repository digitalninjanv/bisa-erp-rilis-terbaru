# Audit Adversarial Akuntansi — Bagian 2: Laporan Keuangan

Tanggal: 2026-11-04 · Sifat: **baca-saja** (kode dibaca; DB dev hanya SELECT lewat fungsi laporan asli & SQL pembanding; skrip pembuktian sementara sudah dihapus).

Sikap audit: setiap laporan dianggap salah sampai angkanya dibuktikan cocok dengan data sumbernya.

## Objek & metode

- Kode: `src/server/reports.ts` (2067 baris — `getTrialBalance`, `getIncomeStatement`, `getBalanceSheet`, `getCashFlow`, `getEquityStatement`, `getLedger`, `listJournalEntries`, `listReceivables`, `listPayables`, `mappedBalance`), `src/lib/accounting.ts` (resolusi section & kelompok arus kas), halaman `src/app/app/akuntansi/laporan/page.tsx`, `piutang-utang/page.tsx`, `buku-besar/page.tsx`, rute ekspor `src/app/api/export/report/route.ts`.
- Pembuktian angka: fungsi laporan **asli** dijalankan lewat `withCompanyReadOnly` terhadap perusahaan `01900000-0000-7000-8000-000000000001` ("Bisa Minimarket", perusahaan demo/fixture bersama di DB dev) dan dibandingkan dengan agregat SQL independen atas `journal_lines`/`journal_entries` (status `posted`) pada **cakupan tanggal yang identik**.
- **Karakter dataset (penting)**: perusahaan ini fixture bersama banyak test; berisi residu jurnal ter-commit bertanggal 2026 (27 entri) dan 2099 (14 entri) serta angka uji besar (mis. Utang Gaji bersaldo debit Rp113,65 jt, beban bersih kredit Rp69,3 jt). Nilai absolutnya **bukan** potret demo bersih. Yang dibuktikan adalah *kesesuaian rumus* fungsi vs SQL pada cakupan yang sama — dan di situlah temuan-temuan di bawah berdiri atau gugur.

## Ringkasan hasil

| Prioritas | Jumlah |
|---|---|
| P0 | 0 |
| P1 | 2 |
| P2 | 5 |
| P3 | 6 |

Kabar baiknya nyata: **rumus agregasi inti (neraca saldo, laba rugi, neraca, arus kas) terbukti cocok persis dengan SQL independen** pada cakupan yang selaras. Yang rusak ada di tepi: retur atas penjualan utang, laporan perubahan ekuitas lintas periode, klasifikasi arus kas jurnal majemuk, dan beberapa kelengkapan standar.

---

## Temuan

### AK2-01 — P1 · SALAH-ANGKA · Retur penjualan utang bisa direfund tunai penuh; piutang tidak pernah berkurang

`createSaleReturn` (`src/server/pos.ts:1565` dst.) memvalidasi hanya kuantitas terhadap transaksi asal. Ia **tidak pernah memeriksa `paymentStatus`/`paidTotal`** dan penyelesaian retur hanya boleh ke kas (`map.cash`), bank (`map.bank`), atau liabilitas Kredit Pelanggan (`map.customer_credit`) — lihat pemilihan `settleAccount` di `pos.ts:1669–1697`; komentar kode bahkan menegaskan "never the receivable account". Aksi server (`src/server/actions/pos.ts:398`) dan formulir retur (`src/components/pos/return-form.tsx`, `src/app/app/pos/retur/page.tsx`) juga tidak punya kesadaran status bayar sama sekali (grep `paymentStatus|paidTotal|utang` = nol hasil).

Akibatnya, untuk penjualan utang (D-19) yang belum lunas atau lunas sebagian:

1. Kasir dapat memproses retur dengan refund **tunai/transfer sebesar nilai penuh barang**, padahal pelanggan belum membayar sepeser pun — kas keluar untuk utang yang tidak pernah diterima.
2. Jurnal retur (Dr 4020 / Cr Kas) tidak menyentuh akun Piutang (1200), dan `sales.paidTotal` tidak berubah, sehingga `listReceivables` tetap menagih **seluruh** sisa utang termasuk barang yang sudah dikembalikan.

Tidak ada test yang menutup kasus ini (test retur yang ada: penjualan tunai; simulasi S1 pun retur atas penjualan tunai). Perbaikan yang benar secara akuntansi: porsi retur sebesar sisa piutang harus memotong piutang (Dr 4020 / Cr 1200 + kurangi outstanding), refund tunai hanya boleh sebesar yang benar-benar sudah dibayar.

### AK2-02 — P1 · SALAH-ANGKA · Laporan Perubahan Ekuitas kehilangan laba akumulasi periode-periode sebelumnya

`getEquityStatement` (`src/server/reports.ts:529–593`) menghitung saldo awal/akhir **hanya dari akun-akun ekuitas** lalu menambahkan laba *rentang yang sedang dilihat* pada total akhir. Laba periode-periode sebelumnya — yang di neraca tampil sebagai bagian ekuitas — tidak muncul di mana pun dalam laporan ini: tidak sebagai saldo awal, tidak sebagai baris.

Terbukti dengan angka pada data audit (rentang 2099, karena data 2026 memuat laba Rp69.302.445,45):

| Ukuran | Nilai |
|---|---|
| Neraca `totalEquity` per 2098-12-31 | 147.187.045,45 |
| Perubahan ekuitas `totalOpening` 2099 | 77.884.600 |
| **Selisih (= laba 2026 persis)** | **69.302.445,45** |
| Perubahan ekuitas `totalClosing` 2099 | −64.865.400 |
| Neraca `totalEquity` per 2099-12-31 | 4.437.045,45 |

Laporan hanya benar bila rentang dimulai dari awal waktu (terbukti: rentang 1900→hari ini `totalClosing` = neraca `totalEquity` persis). Untuk pemakaian normal — laporan per bulan/tahun berjalan — saldo awal dan saldo akhir **selalu kurang sebesar laba akumulasi sebelumnya**. Perbaikan: saldo awal harus memuat laba akumulasi s.d. awal rentang (seperti neraca: akun ekuitas + laba 1900→`from`−1), idealnya sebagai baris "Laba ditahan (akumulasi)" tersendiri.

### AK2-03 — P2 · SALAH-KELOMPOK · Arus kas: satu jurnal = satu kelompok, dipilih dari akun lawan berbobot terbesar

`getCashFlow` mengklasifikasikan **seluruh** jurnal yang menyentuh kas ke tepat satu kelompok (`groupOfEntry`, `reports.ts:461–481`): kelompok dari akun lawan dengan bobot `|debit − kredit|` terbesar menang; akun lawan bergrup `null` diabaikan; bila semua lawan `null`, kelompok diam-diam menjadi `"operating"` (nilai bawaan `best`).

Bukti pada data nyata: jurnal pembuka JE-2026-00001 (Dr Kas 50.000.000 + Dr Persediaan 28.349.600 / Cr Modal Pemilik 78.349.600) tampil sebagai **arus pendanaan masuk Rp50.000.000** — porsi persediaan (akun lawan bergrup `null`) lenyap dari klasifikasi, dan saldo awal pembukuan diperlakukan sebagai arus kas pendanaan periode berjalan. Secara konstruksi, jurnal majemuk apa pun (mis. satu jurnal membayar beban Rp10 jt + membeli peralatan Rp90 jt tunai) akan mengklasifikasikan seluruh Rp100 jt ke satu kelompok dan salah menyajikan sisanya.

Catatan terkait: ini metode langsung berbasis *jenis sumber jurnal* untuk rincian bucket-nya, tanpa rekonsiliasi laba→kas (metode tidak langsung) sebagai pembanding; klasifikasi sepenuhnya bergantung pada `cash_flow_group` akun lawan + fallback kode (lihat AK2-04).

### AK2-04 — P2 · SALAH-KELOMPOK (potensial, bawaan) · Fallback kelompok dari rentang kode string

`src/lib/accounting.ts:34–57` (`defaultSection`/`resolveCashFlowGroup`):

- Semua liabilitas berkode `< "2500"` = **liabilitas jangka pendek** di neraca **dan kelompok operasi** di arus kas. COA bawaan tidak memiliki akun utang bank; akun kustom yang wajar seperti "2400 — Utang Bank Jangka Panjang" akan tampil sebagai utang jangka pendek, dan penerimaan/pelunasan pinjamannya sebagai arus **operasi**, bukan pendanaan.
- Aset: batas `< "1500"` memisahkan lancar/tidak lancar; perbandingan **string** — rapuh untuk kode di luar 4 digit (mis. "999" atau "10000" akan salah urut leksikografis).
- Pendapatan: hanya 4030 & 9000 yang menjadi pendapatan lain-lain; beban: hanya 8000/8001/9001 yang menjadi beban lain-lain. Akun kustom di luar daftar (mis. "4050 Pendapatan Bunga") jatuh ke pendapatan operasional.

Formulir akun memang menyediakan pilihan `section` & `cash_flow_group` manual (`src/components/akuntansi/account-form.tsx:151,160`), jadi kesalahan ini *bisa* dikoreksi admin — tetapi bawaan diam-diam salah untuk kasus utang bank jangka panjang yang sangat lazim, tanpa peringatan apa pun.

### AK2-05 — P2 · FUNGSI-HILANG · Tidak ada drill-through dari laporan ke jurnal sumber

Baris-baris laba rugi dan neraca di `laporan/page.tsx` (`ComparisonGroup`) dirender sebagai `<tr>` polos tanpa tautan; halaman buku besar pun hanya menaut ke ekspor CSV, bukan dari baris jurnal ke detail jurnalnya. Padahal prasarana tujuan sudah ada (halaman detail jurnal `getJournalDetail`, buku besar per akun). Dari angka laporan, auditor/pengguna tidak bisa menelusur ke transaksi asal tanpa berburu manual lewat Jurnal Umum — men
...[truncated 13468 chars]