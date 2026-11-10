# A4 — Audit Adversarial Akuntansi: Jurnal Lintas Modul

**Mandat:** A-15 (user, 2026-11-04). **Peran:** Cost Accountant + Tax Accountant. **Sikap:** setiap jurnal otomatis dianggap salah akun/salah sisi/salah nilai sampai ditelusuri baris demi baris di kode.
**Cakupan:** semua jurnal yang dibuat modul LAIN ke buku besar — POS, Gudang, Payroll & HR, Aset Tetap, Beban & Catat Transaksi, Saldo Awal, Impor, Bank. **Metode:** baca-saja; setiap tabel di bawah disalin dari konstruksi `postJournal` di kode, bukan dari dokumentasi. Bukti = berkas:baris.
**Berkas inti:** `src/server/accounting.ts` (mesin jurnal), `src/server/pos.ts`, `src/server/inventory.ts`, `src/server/supplier-returns.ts`, `src/server/payables.ts`, `src/server/actions/accounting.ts` (payroll & pemetaan), `src/server/hr.ts`, `src/server/fixed-assets.ts`, `src/server/expenses.ts`, `src/server/quick-entry.ts`, `src/server/opening-balances.ts`, `src/server/employee-advances.ts`, `src/server/employee-loans.ts`, `src/server/reimbursements.ts`, `src/server/bank-transfers.ts`, `src/server/bank-reconciliation.ts`, `src/db/seed.ts:255–372` (COA & pemetaan).

## Ringkasan vonis

**18 temuan: P0 = 0 · P1 = 6 · P2 = 4 · P3 = 8.**

Kabar baiknya nyata: mesin jurnal (`postJournal`) menegakkan saldo seimbang, periode terbuka, akun postable/aktif/sekantor, dan menolak jurnal < 2 baris — jadi kesalahan di bawah ini mayoritas **gagal keras (rollback)** atau **salah saji terstruktur**, bukan korupsi diam-diam. Mayoritas jurnal inti (checkout POS, pembayaran piutang/utang, retur pemasok A-9, aset tetap, saldo awal) terbukti **BENAR penuh**. Masalah terkonsentrasi di lima titik: (1) retur penjualan berinteraksi buruk dengan pembulatan & penjualan kredit, (2) ada DUA mekanisme retur pemasok dan yang warisan salah, (3) PPN Masukan tidak ada sama sekali, (4) komponen cuti tak berbayar di jurnal payroll dikreditkan sebagai utang, (5) rekonsiliasi nilai persediaan laporan ↔ GL tidak dijamin oleh desain valuasi.

| # | Transaksi | Vonis |
|---|---|---|
| 1 | Checkout POS (tunai/kredit/campuran) | **BENAR** |
| 2 | Retur penjualan POS | **SALAH** (AK4-01, AK4-03) |
| 3 | Pembayaran piutang penjualan | **BENAR** |
| 4 | Void penjualan | **BENAR** |
| 5 | Tutup sesi kas & mutasi laci | **BENAR** (catatan AK4-18) |
| 6 | Penerimaan pembelian (kredit & tunai) | **BENAR** akun/sisi; **SALAH nilai untuk PKP** (AK4-04) |
| 7 | Penerimaan bonus / opening / other | **MERAGUKAN** (AK4-14); opening BENAR |
| 8 | Penerimaan retur pelanggan via Gudang | **SALAH** (AK4-07) |
| 9 | Penyesuaian stok & rusak/kedaluwarsa | **BENAR** |
| 10 | Stok opname | **MERAGUKAN** (AK4-11) |
| 11 | Karantina | **BENAR** (tanpa jurnal — memang seharusnya) |
| 12 | Transfer antar-gudang (1 & 2 tahap) | **BENAR** di GL (catatan AK4-13) |
| 13 | Retur pembelian jalur warisan Gudang | **SALAH** (AK4-02) |
| 14 | Retur pemasok modul A-9 + penyelesaiannya | **BENAR** |
| 15 | Pembayaran utang + void-nya | **BENAR** |
| 16 | Payroll run | **BENAR struktur; SALAH satu komponen** (AK4-05) |
| 17 | Pembayaran gaji + void run | **BENAR** |
| 18 | Final pay | **SEBAGIAN SALAH** (AK4-05, AK4-08) |
| 19 | Kasbon & pinjaman karyawan (semua jurnal) | **BENAR** (catatan AK4-16) |
| 20 | Reimbursement | **BENAR** saat dibayar (kekurangan AK4-10) |
| 21 | Beban (modul Beban & Catat Transaksi) | **BENAR** sederhana (AK4-04, AK4-10) |
| 22 | Penjualan tunai cepat (quick cash sale) | **BENAR** |
| 23 | Terima piutang / bayar utang FIFO (Catat Transaksi) | **BENAR** (mewarisi domain teruji) |
| 24 | Aset tetap: perolehan, penyusutan, pelepasan | **BENAR** |
| 25 | Saldo awal pihak + pembayarannya; impor saldo | **BENAR** |
| 26 | Transfer bank + biaya admin | **BENAR** |
| 27 | Jurnal dari mutasi bank (rekonsiliasi) | **BENAR** |
| 28 | PO, PR, reservasi, penjualan ditahan, draf THR/lembur | **BENAR** (memang tidak boleh menjurnal) |

Akun yang dirujuk di bawah memakai pemetaan bawaan seed: 1000 Kas, 1100 Bank, 1110 QRIS Clearing, 1200 Piutang Usaha, 1210 Kredit Pemasok, 1220 Piutang Karyawan, 1300 Persediaan, 1510 Akum. Penyusutan, 2000 Utang Usaha, 2100 Utang Gaji, 2110 Utang PPh 21, 2120 Utang BPJS, 2200 PPN Keluaran, 2300 Kredit Pelanggan, 3000 Modal, 4000 Penjualan, 4010 Diskon Penjualan, 4020 Retur Penjualan, 4030 Pendapatan Lain-lain, 5000 HPP, 5010 Selisih Persediaan, 5020 Barang Rusak, 6000 Beban Gaji, 6080 Beban Iuran BPJS Perusahaan, 8000/8001 Selisih Kas Kurang/Lebih, 9000/9001 Pembulatan (Laba)/(Rugi).

---

## 1. POS — penjualan, retur, piutang, sesi kas

### 1.1 Checkout penjualan — BENAR (`src/server/pos.ts:993–1031`)

| Debit | Kredit |
|---|---|
| Akun pembayaran per metode (diagregasi per akun; termasuk Dr 2300 Kredit Pelanggan bila dibayar kredit pelanggan) | |
| 1200 Piutang Usaha (porsi kredit, bertag pelanggan) | |
| 4010 Diskon Penjualan (atau akun diskon kelompok harga bila dikonfigurasi) sebesar diskon total | |
| 9001 Selisih Pembulatan bila penyesuaian < 0 | |
| 5000 HPP sebesar `costTotal` | |
| | 4000 Penjualan sebesar subtotal − pajak (pendapatan **bruto sebelum diskon**, bersih dari PPN) |
| | 2200 PPN Keluaran sebesar pajak total |
| | 9000 Pembulatan (Laba) bila penyesuaian > 0 |
| | 1300 Persediaan sebesar `costTotal` |

Penilaian terhadap 7 pertanyaan mandat:
- **Pendapatan bruto vs contra:** benar. Pendapatan dikredit bruto (sebelum diskon), diskon didebit ke 4010 — persis pola yang diwajibkan AGENTS.md proyek.
- **PPN keluaran:** benar. Tarif hanya berlaku bila `taxEnabled` (`pos.ts:292`), selalu inklusif dan diekstrak dari neto sesudah diskon (`lineTax({inclusive:true})`, `pos.ts:383`) — dasar pengenaan pajak benar (diskon mengurangi DPP).
- **HPP:** `costTotal` = Σ biaya kutipan (= `products.costPrice`/AVCO berjalan saat transaksi) × qty, hanya baris pelacak stok. Baris non-stok tidak memotong persediaan. Benar.
- **Pembulatan:** 9000/9001 dipakai di sini — dan ternyata **hanya** di modul POS di seluruh sistem (grep `rounding_gain|rounding_loss` di luar `pos.ts` hanya menemukan daftar kunci pemetaan). Konsisten karena memang hanya POS yang membulatkan total.
- Catatan kecil: akun diskon kelompok harga (`quote.discountAccountId`) dapat diarahkan admin ke akun mana pun; tidak ada penjaga tipe akun contra-revenue. Kebebasan konfigurasi tanpa pagar — dicatat, bukan temuan bernomor.

### 1.2 Retur penjualan — SALAH (AK4-01, AK4-03) (`src/server/pos.ts:1571–1840`)

Struktur akunnya sendiri benar:

| Debit | Kredit |
|---|---|
| 4020 Retur Penjualan (porsi pendapatan: bruto − pajak) | |
| 2200 PPN Keluaran (porsi pajak) | |
| 9000 Pembulatan (porsi, bila penyesuaian asal > 0) | |
| 1300 Persediaan (porsi biaya **asal penjualan**) | |
| | Akun penyelesaian (kas/bank/2300) sebesar `returnTotal` |
| | 4010 Diskon Penjualan (porsi diskon) |
| | 9001 Pembulatan (porsi, bila penyesuaian asal < 0) |
| | 5000 HPP (porsi biaya asal) |

Dua cacat fatal:

**AK4-01 (P1) — Setiap retur atas penjualan yang memiliki penyesuaian pembulatan GAGAL TOTAL: jurnal tidak seimbang persis sebesar porsi pembulatan.** Baris penyelesaian dikredit sebesar `returnTotal` saja (`pos.ts:1813`), sementara porsi pembulatan direversi pada baris terpisah (Dr 9000 di `pos.ts:1810–1812`; Cr 9001 di `pos.ts:1817–1819`). Aljabar: Σdebit − Σkredit = porsi pembulatan ≠ 0 untuk retur penuh maupun sebagian, pada kedua arah penyesuaian. `postJournal` menolak jurnal tak seimbang → seluruh transaksi retur rollback → **kasir sama sekali tidak dapat memproses retur** untuk penjualan ber-pembulatan. Yang benar: kredit penyelesaian = `returnTotal + roundingPortion` (pelanggan membayar total terbulatkan; retur penuh wajib mengembalikan jumlah itu). Kondisi pemicu bukan teoretis: `roundingMode` bawaan skema memang `"none"` (`src/db/schema.ts:231`), tetapi seed demo memakai `nearest_500` dan perusahaan ritel mana pun yang menyalakan pembulatan tunai menabraknya. Di DB dev saat audit: nol penjualan dengan `rounding_adjustment ≠ 0` dan semua jurnal `sale_return` yang ada seimbang — kombinasi ini belum pernah teruji.

**AK4-03 (P1) — Retur atas penjualan KREDIT tidak pernah mengurangi piutang.** `createSaleReturn` tidak membaca sisa piutang penjualan asal sama sekali; metode penyelesaian hanya tunai/transfer/kredit toko/tukar (`pos.ts:1662–1712`) — tidak ada "potong piutang". Akibatnya untuk penjualan utang yang belum lunas: (a) perusahaan mengeluarkan kas refund atas penjualan yang belum pernah dibayar tunai; (b) jurnal tidak menyentuh 1200, dan `sales.total`/`paidTotal` tidak berubah, sehingga daftar piutang & aging tetap menagih porsi yang sudah diretur (penjualan retur sebagian tetap berstatus `completed` dengan sisa penuh — `src/server/reports.ts:1761–1770`); (c) penjualan yang diretur penuh berubah status menjadi `returned` tetapi `paymentStatus`-nya tidak disentuh, dan `payReceivable` hanya menolak status `paid` — sisa piutang penjualan yang sudah diretur penuh masih dapat "dibayar" dan menjurnal Dr Kas / Cr 1200 untuk kedua kalinya.

Nilai stok retur: barang kembali pada **biaya asal penjualan** (`line.original.unitCost`, `pos.ts:1651`) — pilihan yang dapat dipertahankan untuk jurnal (membalik HPP asal persis), tetapi lihat AK4-06 untuk dampak valuasinya.

### 1.3 Pembayaran piutang — BENAR (`src/server/pos.ts:1878–1990`)

Dr akun penerimaan (divalidasi: metode aktif atau pemetaan kas/bank/QRIS; metode kredit ditolak) / Cr 1200 Piutang Usaha bertag pelanggan, `sourceType "payment"`, kunci idempotensi `ar:{saleId}:{nomor pembayaran}` sehingga void menarget entri yang tepat. Plafon = sisa piutang dokumen.

### 1.4 Void penjualan — BENAR (`src/server/pos.ts` ±1363)

Jurnal asal dibalik utuh (`reverseSourceJournal("sale")`), stok kembali pada biaya asal, dan void diblokir bila sudah ada retur terposting — urutan koreksi yang benar.

### 1.5 Sesi kas & laci — BENAR, catatan kecil (`src/server/pos.ts` ±2101–2202)

Tutup sesi: selisih lebih Dr Kas / Cr 8001 Selisih Kas Lebih; selisih kurang Dr 8000 Selisih Kas Kurang / Cr Kas. Mutasi laci: setoran Dr Bank / Cr Kas, penarikan sebaliknya. **AK4-18 (P3):** jurnal selisih selalu memakai akun kas pemetaan perusahaan dan tanggal `todayISO()` — bila ada banyak register/cabang, selisih semua register tercampur di satu akun kas dan tanggal jurnal mengikuti hari penutupan, bukan tanggal sesi.

---

## 2. Gudang — penerimaan, penyesuaian, opname, transfer, retur

### 2.1 Penerimaan pembelian — BENAR akun/sisi; SALAH nilai untuk PKP (`src/server/inventory.ts:596–663`)

| Skenario | Debit | Kredit |
|---|---|---|
| Kredit | 1300 Persediaan (total faktur) | 2000 Utang Usaha bertag pemasok |
| Tunai | 1300 Persediaan (total faktur) | Akun pembayaran (dijaga hanya pemetaan kas/bank/QRIS) |

**AK4-04 (P1) — PPN Masukan tidak ada di mana pun di sistem ini.** Bukti negatif yang lengkap: grep `tax_input` dan "PPN Masukan" di seluruh `src/` = **nol hasil**; tidak ada kunci pemetaan maupun akunnya di COA seed. Penerimaan menjurnal **total faktur penuh** ke persediaan — bila faktur pemasok memuat PPN (harga inklusif), PPN ikut terkapitalisasi menjadi biaya persediaan. Jalur beban sama: domain beban menyatakan sendiri di komentarnya "Tidak ada dukungan pajak masukan di domain ini — nominal adalah nominal beban penuh" (`src/server/expenses.ts:9–13`). Dampak untuk perusahaan PKP: (1) persediaan dan beban overstated sebesar PPN yang sebenarnya dapat dikreditkan; (2) aset PPN Masukan tidak pernah diakui sehingga tidak dapat dikompensasikan ke PPN Keluaran 2200 — kewajiban setor PPN di buku lebih besar dari yang seharusnya dan SPT Masa tidak dapat disusun dari sistem; (3) HPP ikut terdistorsi karena AVCO menyerap PPN. Untuk perusahaan non-PKP perlakuan ini benar (PPN memang bagian dari biaya). Karena saklar `tax_enabled` hanya mengendalikan PPN **keluaran**, tidak ada konfigurasi yang menyelamatkan PKP. Ini kesenjangan pajak terbesar di sistem.

Catatan pendamping (bukan temuan terpisah): tidak ada varian harga beli (PPV) — penerimaan pada harga ketik baris, selaras AVCO; wajar untuk skala ini.

### 2.2 Penerimaan non-pembelian — MERAGUKAN (`src/server/inventory.ts:618–638`)

| Sumber | Debit | Kredit | Vonis |
|---|---|---|---|
| `opening` | 1300 Persediaan | 3000 Modal | BENAR (saldo awal memang melawan ekuitas) |
| `bonus` | 1300 Persediaan pada biaya ketik | 4030 Pendapatan Lain-lain (fallback 4000) | MERAGUKAN — **AK4-14 (P3)** |
| `other` | 1300 Persediaan pada biaya ketik | 3000 Modal Pemilik | MERAGUKAN — **AK4-14 (P3)** |
| `customer_return` | 1300 Persediaan pada AVCO berjalan | **4020 Retur Penjualan** | **SALAH — AK4-07 (P2)** |

**AK4-14:** barang bonus diakui sebagai pendapatan sebesar biaya yang diketik pengguna — menaikkan pendapatan lain-lain tanpa dasar nilai wajar yang terverifikasi, dan karena gerakan stoknya bertipe `"purchase"` ia ikut mencampur AVCO (lihat AK4-06). Sumber `other` mengkredit **Modal Pemilik** untuk penerimaan beralasan bebas apa pun — ekuitas pemilik berubah tanpa peristiwa penyetoran; akun suspense/pendapatan lain lebih tepat.

**AK4-07 (P2) — Penerimaan retur pelanggan via Gudang mengkredit 4020 sebesar BIAYA.** Jalur POS mendebit 4020 sebesar nilai **pendapatan** yang diretur (harga jual bersih pajak). Jalur gudang ini mengkredit akun yang sama sebesar **biaya berjalan**. Saldo 4020 di laporan laba rugi menjadi campuran dua semantik berbeda (harga jual vs biaya) sehingga angka "Retur Penjualan" tidak lagi bermakna; tidak ada pembalikan PPN, tidak ada tautan ke penjualan asal, dan tidak ada pengurangan piutang/penjualan terkait. Dua jalur retur pelanggan dengan semantik berlawanan atas akun yang sama.

### 2.3 Penyesuaian stok & rusak/kedaluwarsa — BENAR (`src/server/inventory.ts:1017–1061`)

Penyesuaian bertanda menjurnal **per arah pada nilainya masing-masing** (masuk: Dr 1300 / Cr 5010; keluar: Dr 5010 / Cr 1300) — tidak dineto. Rusak/kedaluwarsa/hilang: Dr 5020 (pemetaan `damaged`) / Cr 1300. Semua akun dari pemetaan → **dapat dikonfigurasi** di Pengaturan. Karantina: **tanpa jurnal** — benar, barang tetap persediaan, hanya berpindah lokasi (GD-P2-3a). Penjaga persetujuan maker≠checker untuk keluarga write-off juga ada di domain.

### 2.4 Stok opname — MERAGUKAN (`src/server/inventory.ts:1598, 1648–1668`)

**AK4-11 (P3) — Jurnal opname diposting atas nilai NETO seluruh hitungan.** Selisih lebih dan kurang antarproduk saling meniadakan lebih dulu; satu jurnal ke 5010 sebesar |neto|; bila neto tepat nol, **tidak ada jurnal sama sekali** walau selisih bruto besar. Kontras dengan penyesuaian (§2.3) yang bruto per arah. Laba rugi neto memang benar, tetapi jejak bruto selisih (indikator shrinkage/fraud) hilang dari buku besar — hanya tersisa di dokumen opname. Praktik yang lebih baik: jurnal dua sisi bruto, idealnya selisih lebih ke akun laba terpisah dari selisih kurang.

### 2.5 Transfer antar-gudang — BENAR di GL; catatan penyajian (`src/server/inventory.ts:1228–1515`)

Transfer **tidak pernah menjurnal** — benar, karena akun persediaan GL tunggal per perusahaan; nilai kedua leg sama pada biaya dokumen yang dibekukan, dan `receiveTransfer` memulihkan irisan batch asal persis. **AK4-13 (P3):** pada mode dua tahap, selama status `in_transit` barang tidak tercatat di gudang asal maupun tujuan — tidak ada akun maupun laporan "Persediaan Dalam Perjalanan". Saldo GL tidak terpengaruh, tetapi total laporan valuasi stok (§AK4-06) menyusut sebesar nilai barang dalam perjalanan selama transit, memperlebar selisih subledger↔GL yang tidak bisa dijelaskan pengguna.

### 2.6 Retur pembelian — DUA mekanisme, satu BENAR, satu SALAH

**Modul A-9 (`src/server/supplier-returns.ts`) — BENAR penuh.** Posting membekukan nilai pada AVCO berjalan saat posting (`:537–620`):

| Debit | Kredit |
|---|---|
| 2000 Utang Usaha sebesar min(total retur, utang terbuka) — teralokasi per penerimaan tertua | |
| 1210 Kredit Pemasok sebesar kelebihan di atas utang | |
| | 1300 Persediaan sebesar total retur |

Penyelesaian klaim dibatasi sisa klaim (`:964–965`) dan jurnalnya utuh untuk campuran: terapkan kredit Dr 2000 / Cr 1210 (`:1125`); refund Dr kas/bank / Cr 1210 (`:1204`); barang pengganti Dr 1300 / Cr 1210 dengan gerakan bertipe `"purchase"` sehingga AVCO tercampur ulang pada nilai klaim (`:1388`). Pembayaran utang memperhitungkan alokasi retur sehingga tidak pernah membayar bagian yang sudah diselesaikan retur (`src/server/payables.ts:11–18`).

**Jalur warisan Gudang — SALAH. AK4-02 (P1).** Dokumen penyesuaian bertipe `purchase_return` (masih aktif di UI: `src/components/gudang/adjustment-form.tsx:17`, `src/server/actions/inventory.ts:351–357`) menjurnal di `src/server/inventory.ts:986–1016`:

| Metode | Debit | Kredit |
|---|---|---|
| `cash` | Kas (pemetaan) | 1300 Persediaan |
| `credit_note` / `deduction` | **2000 Utang Usaha — tanpa tag pemasok, tanpa alokasi penerimaan** | 1300 Persediaan |
| `replacement` | **1200 Piutang Usaha** | 1300 Persediaan |

Tiga kesalahan: (1) debit Utang Usaha tidak mengurangi dokumen utang mana pun — subledger tetap menunjukkan faktur terbuka penuh, sehingga membayar faktur itu kemudian mendebit utang **untuk kedua kalinya** (utang terbayar ganda di GL vs subledger); (2) metode `replacement` mendebit **Piutang Usaha (piutang pelanggan)** untuk klaim penggantian kepada **pemasok** — akun salah secara definisi, mencemari saldo 1200 yang direkonsiliasi ke subledger AR berbasis penjualan; (3) nilai retur memakai biaya ketik/biaya berjalan dokumen penyesuaian, bukan nilai klaim teralokasi. Rekomendasi: nonaktifkan tipe `purchase_return` dari formulir penyesuaian dan arahkan semua retur pemasok ke modul A-9.

### 2.7 Void penerimaan & void dokumen stok — BENAR (`src/server/inventory.ts:1716–2010`)

Void memakai jurnal pembalik pada nilai asal persis, gerakan stok cermin pada biaya asal, dan penjaga yang benar: penerimaan kredit yang sudah dibayar atau sudah dialokasi retur A-9 tidak dapat di-void sebelum pembayaran/retur-nya dibatalkan lebih dulu. Satu-satunya noda adalah valuasi — lihat AK4-06(c).

### 2.8 Valuasi & AVCO — rekonsiliasi GL tidak dijamin (AK4-06, P1)

Fakta mekanik yang terverifikasi:
- `products.costPrice` (AVCO global per produk) dihitung ulang **hanya** oleh gerakan positif bertipe `"purchase"` (`src/server/inventory.ts:128–160`).
- Laporan valuasi = Σ qty on-hand × `costPrice` **kini** (`src/server/reports.ts:791–806`).
- Retur penjualan masuk pada biaya asal dengan tipe gerakan `sale_return` → **tidak mencampur ulang AVCO** (`src/server/pos.ts:1651, 1770–1792`).
- Void penerimaan secara eksplisit **tidak** menghitung ulang AVCO (komentar `src/server/inventory.ts:1716–1724`) walau jurnalnya dibalik persis.
- Penyesuaian mengizinkan `unitCost` ketik bebas per baris (`src/server/inventory.ts:773`) yang boleh menyimpang dari AVCO.

Contoh tandingan konkret (satu produk): beli 10 @100 → AVCO 100, GL 1.000.000… (dalam rupiah: GL Rp1.000). Jual 10 @AVCO 100 → GL 0. Beli 10 @200 → stok asal kosong sehingga AVCO reset ke 200, GL Rp2.000. Retur penjualan pertama masuk 10 unit pada biaya asal 100 → GL Rp3.000 untuk 20 unit; laporan valuasi 20 × 200 = **Rp4.000 ≠ GL Rp3.000**, selisih Rp1.000 permanen dan tanpa jurnal penjelas. Contoh kedua: beli 10 @100 lalu 10 @200 (AVCO 150), void penerimaan pertama → GL Rp2.000 untuk 10 unit, AVCO tetap 150, laporan Rp1.500 ≠ GL. Gerbang rekonsiliasi SIM-2 S1 lolos hanya karena AVCO tidak bergerak di antara peristiwa-peristiwa skenarionya. **Kesimpulan: kesetaraan saldo GL Persediaan dengan nilai laporan stok adalah kebetulan skenario, bukan invariant desain.** Perbaikan yang benar: retur penjualan & void ikut mencampur AVCO (atau jurnal selisih valuasi ke 5010), dan laporan rekonsiliasi valuasi↔GL ditampilkan eksplisit.

---

## 3. Payroll, statutory, kasbon, pinjaman, final pay

### 3.1 Jurnal run — BENAR struktur; satu komponen SALAH (`src/server/actions/accounting.ts:990–1360`)

Komposisi per karyawan terverifikasi: bruto = gaji pokok + tunjangan + pendapatan tambahan (lembur disahkan + THR dari draf, masuk snapshot tunjangan); potongan reguler + cuti tak berbayar di `deductions`; statutory (BPJS pekerja + PPh 21) terpisah; kasbon dan cicilan pinjaman dibatasi sisa bersih berurutan dan dialokasikan FIFO per dokumen. Jurnal agregat run:

| Debit | Kredit |
|---|---|
| 6000 Beban Gaji sebesar bruto total (termasuk lembur & THR) | |
| 6080 Beban Iuran BPJS Perusahaan sebesar iuran perusahaan | |
| 2110 Utang PPh 21 **didebit** bila PPh masa terakhir negatif (kelebihan potongan dikembalikan) | |
| | 2100 Utang Gaji sebesar bersih total |
| | Akun potongan (bawaan 2100; atau `salary_deductions_payable` bila perusahaan memetakan) sebesar potongan reguler + cuti tak berbayar |
| | 1220 Piutang Karyawan sebesar potongan kasbon |
| | Akun piutang pinjaman sebesar cicilan pinjaman (baris terpisah dari kasbon) |
| | 2120 Utang BPJS sebesar iuran pekerja + iuran perusahaan |
| | 2110 Utang PPh 21 sebesar PPh 21 (bila positif) |

Yang benar dan patut dicatat: beban BPJS perusahaan **terpisah** (Dr 6080, bukan dicampur ke beban gaji); JKP tidak masuk jurnal dengan alasan tertulis di kode (bukan beban kas perusahaan — rekomposisi JKK/JKM); PPh 21 negatif masa terakhir ditangani simetris; THR/lembur masuk bruto kena pajak tetapi tidak masuk dasar iuran BPJS (konvensi engine S2, terdokumentasi).

**AK4-05 (P1) — Cuti tidak berbayar dikreditkan sebagai utang.** `item.deductions` = potongan reguler **+ cuti tak berbayar** (`src/server/actions/accounting.ts:1063–1096`), `totalDeductions` menjumlahkannya (`:1184–1187`), dan jurnal mengkredit seluruhnya ke akun potongan (`:1288–1296`) sementara Dr Beban Gaji memakai bruto **penuh**. Padahal cuti tak berbayar bukan utang kepada siapa pun — itu upah yang tidak pernah earned. Akibatnya, setiap run yang memuat cuti tak berbayar: Beban Gaji overstated **dan** Utang Gaji (2100) overstated sebesar total cuti tak berbayar; pembayaran run hanya mendebit bersih (`§3.2`), sehingga residu kredit sebesar itu **menetap permanen** di 2100 dan terakumulasi antarperiode. Slip gaji tetap benar (aritmetika bersih per karyawan benar), jadi kesalahan ini tidak terlihat dari sisi karyawan — hanya dari buku besar. Perlakuan yang benar: keluarkan komponen cuti tak berbayar dari bruto (kredit balik ke 6000), jangan dikreditkan ke utang. Final pay mewarisi cacat yang sama persis (`src/server/hr.ts:1760–1787` untuk komposisi; jurnalnya meniru run).

### 3.2 Pembayaran gaji & void run — BENAR (`src/server/actions/accounting.ts:1440–1615`)

Pembayaran: Dr 2100 Utang Gaji sebesar `totalNet` run / Cr akun pilihan pengguna, kunci idempotensi `payroll_payment:{runId}` — **tidak ada double count** dengan jurnal run (run mengakui beban & utang; pembayaran hanya melunasi utang). Void run yang sudah dibayar ditolak. Void run yang belum dibayar **simetris penuh**: jurnal pembalik + sisa kasbon dipulihkan + sisa pinjaman dipulihkan + draf THR yang terpakai dikembalikan menjadi draf. Final pay dapat dibayar & di-void melalui jalur yang sama (run berjenis `final`).

### 3.3 Final pay — SEBAGIAN SALAH (`src/server/hr.ts:1690–2030`)

Struktur jurnal meniru run (prorata pokok & tunjangan menurut hari kerja, statutory selalu mode masa terakhir dengan YTD, kasbon ditagih penuh lalu pinjaman dari sisanya, kekurangan wajib diakui eksplisit) — bagian itu benar. Dua kekurangan:

**AK4-08 (P2) — Tidak ada pesangon sama sekali.** Grep `pesangon|severance|UPMK|uang penghargaan` di seluruh `src/` = nol. Pembayaran akhir hanya memuat prorata gaji, THR/lembur, dan statutory. Uang pesangon, uang penghargaan masa kerja, dan uang penggantian hak (PP 35/2021) tidak dapat dihitung maupun dicatat sebagai komponen final pay — perusahaan yang mem-PHK karyawan harus mengarangnya lewat tunjangan manual tanpa jejak perhitungan masa kerja.

**AK4-05** berlaku juga di sini (cuti tak berbayar final ikut dikreditkan ke utang).

### 3.4 Kasbon & pinjaman karyawan — BENAR (`src/server/employee-advances.ts`, `src/server/employee-loans.ts`)

| Peristiwa | Jurnal |
|---|---|
| Kasbon diberikan (`advances:140`) | Dr 1220 Piutang Karyawan (tag karyawan) / Cr kas-bank pilihan |
| Setoran kasbon (`advances:532`) | Dr kas-bank / Cr 1220 (tag karyawan), alokasi FIFO |
| Pinjaman dicairkan (`loans:130`) | Dr akun piutang pinjaman / Cr kas-bank |
| Setoran pinjaman (`loans:416`) | Dr kas-bank / Cr akun piutang pinjaman, alokasi FIFO |
| Potongan via payroll | Cr 1220 / Cr piutang pinjaman sebagai **baris terpisah** (§3.1) |
| Void payroll | Piutang dipulihkan lewat entri pemulihan + jurnal pembalik (§3.2) |

Akun piutang pinjaman memakai kunci `employee_loan_receivable` bila ada, fallback ke `employee_receivable` (`loans:56–64`) — perilaku fallback terdokumentasi dan tidak menebak akun di luar pemetaan. **AK4-16 (P3):** setoran kasbon, setoran pinjaman, dan mutasi laci memakai `idempotencyKey: crypto.randomUUID()` — tidak ada dedup server bila formulir terkirim dua kali; perlindungan efektif hanya tersisa dari kunci baris + validasi sisa terbuka. Risiko kecil, tetapi tidak sekuat jalur lain yang memakai kunci deterministik per dokumen.

### 3.5 Reimbursement — BENAR saat dibayar; akrual tidak ada (`src/server/reimbursements.ts:225–262`)

Saat klaim dibayar: Dr akun beban klaim (tag karyawan) / Cr kas-bank — benar sebagai beban perusahaan (S7B-1 sudah mengoreksinya dari piutang karyawan). **AK4-10 (P2) — Tidak ada akrual & tidak ada beban dibayar di muka di seluruh sistem.** Klaim yang **disahkan** belum menjurnal apa pun; beban baru diakui pada tanggal pembayaran. Klaim disahkan 30 Desember dan dibayar 5 Januari membebankan tahun yang salah. Pola yang sama di modul Beban: jurnal selalu Dr beban / Cr **akun pembayaran** (`src/server/expenses.ts:38–51`) — beban yang dibeli secara kredit/utang tidak dapat dicatat selain lewat jurnal manual, dan tidak ada konsep prepaid (asuransi/sewa dibayar di muka akan langsung terbeban penuh di bulan pembayaran). Untuk laporan bulanan yang akurat ini kekurangan desain yang material, walau umum di ERP skala kecil.

### 3.6 Utang statutory tidak punya alur pelunasan (AK4-09, P2)

Akun 2110 (PPh 21) dan 2120 (BPJS) hanya pernah **dikredit** oleh jurnal run/final pay; satu-satunya debit atas keduanya berasal dari jurnal pembalik void. Tidak ada fungsi/modal "bayar setoran" (bandingkan: piutang, utang, gaji, kasbon, pinjaman semuanya punya alur bayar + void berpasangan). Saldo utang pajak & iuran akan menumpuk tanpa mekanisme penyelesaian terpandu, tanpa penanda batas setor (PPh 21 tgl 10, BPJS tgl 15), dan tanpa rekonsiliasi ke rekap setoran S2. Pelunasan hanya bisa lewat jurnal manual — rawan salah akun oleh pengguna non-akuntan.

**AK4-17 (P3), terkait:** potongan reguler bawaan dikredit ke 2100 Utang Gaji kecuali perusahaan memetakan `salary_deductions_payable` sendiri (kunci itu tidak terseed). Sesudah run dibayar, 2100 menyisakan saldo potongan yang tak terbedakan dari gaji belum dibayar, dan tidak ada laporan komposisi saldo 2100.

---

## 4. Aset tetap — BENAR (`src/server/fixed-assets.ts`)

| Peristiwa | Jurnal |
|---|---|
| Perolehan (`:293`) | Dr akun aset kategori / Cr akun sumber dana, sebesar biaya perolehan |
| Penyusutan (`:448`) | Satu jurnal agregat per periode: Dr Beban Penyusutan (diagregasi per akun kategori) / Cr Akumulasi Penyusutan (diagregasi per akun); garis lurus, bulan perolehan dihitung penuh, dibatasi nilai tersusutkan; run ganda per periode ditolak; void = pembalik |
| Pelepasan (`:543–575`) | Dr Akumulasi (saldo aset ybs) + Dr akun hasil pelepasan / Cr Biaya Perolehan; selisih ke **Cr 4030 Pendapatan Lain-lain (laba)** atau **Dr 6070 Beban Lain-lain (rugi)** |

Pelepasan adalah jurnal pelepasan buku teks yang benar — nilai buku dikeluarkan utuh dan laba/rugi diakui terpisah, bukan dineto ke hasil. Akun 6090/4030/6070 dibuat/dipastikan lewat `ensureFixedAssetAccounts` per perusahaan (`:51–63`) karena tidak ada di COA seed bawaan — berfungsi, walau menambah satu jalur pemetaan di luar tabel pemetaan resmi (lihat AK4-12). Keterbatasan yang sudah diakui sejak S7B-2 dan bukan temuan baru: hanya metode garis lurus.

---

## 5. Beban & Catat Transaksi (quick entry, 5 jenis)

| Jenis | Jalur | Vonis |
|---|---|---|
| Penjualan tunai | Jurnal langsung `postQuickCashSale` (`src/server/quick-entry.ts:34–148`) | **BENAR** |
| Beban / pembelian | Membungkus `createExpense` | BENAR sederhana (AK4-04, AK4-10) |
| Terima piutang | FIFO ke `payReceivable` / `payOpeningBalance` | **BENAR** |
| Bayar utang | FIFO ke `payPayableDocument` / `payOpeningBalance` | **BENAR** |
| Transfer rekening | Membungkus transfer bank (§6) | **BENAR** |

Penjualan tunai cepat: Dr kas/bank/QRIS sebesar bruto / Cr akun pendapatan sebesar bersih / Cr 2200 PPN Keluaran sebesar pajak, dengan `splitCashSale` inklusif yang sama seperti POS (`src/lib/quick-entry.ts`) — **konsisten dengan jalur POS**: pendapatan bersih dari PPN, bukan bruto. Akun penerimaan divalidasi harus akun kas/bank/QRIS yang dipetakan; akun pendapatan divalidasi bertipe revenue. **Saklar `tax_enabled` ditegakkan**: aksi meneruskan tarif `"0"` bila saklar mati (`src/server/actions/quick-entry.ts:198, 316`). Tidak ada pembulatan di jalur ini (nominal ketik apa adanya) sehingga ketiadaan baris 9000/9001 di sini bukan kebocoran.

**Sapuan saklar `tax_enabled` (pertanyaan mandat #2):** hanya ada dua jalur posting yang menghitung PPN keluaran — POS (`pos.ts:292`) dan penjualan tunai cepat (di atas). Keduanya menghormati saklar. Jalur lain tidak menghitung PPN sama sekali (itulah AK4-04 untuk sisi masukan). **Tidak ditemukan kebocoran saklar.**

## 6. Saldo awal, impor, bank

| Transaksi | Jurnal | Vonis |
|---|---|---|
| Saldo awal utang pihak (`opening-balances.ts:188`) | Dr Ekuitas saldo awal / Cr 2000 bertag pemasok | BENAR |
| Saldo awal piutang pihak | Dr 1200 bertag pelanggan / Cr Ekuitas saldo awal | BENAR |
| Pembayaran saldo awal (`opening-balances.ts:412`) | Dr 2000 / Cr kas (utang); Dr kas / Cr 1200 (piutang), kunci `ap/ar-opening:{id}:{nomor}` | BENAR |
| Impor saldo awal & stok | Memakai ulang `createOpeningBalance` & `createReceipt` sumber `opening` | BENAR (mewarisi) |
| Transfer bank (`bank-transfers.ts:61`) | Dr akun tujuan (nominal) + Dr `bank_fee` (biaya) / Cr akun sumber (nominal + biaya) | BENAR |
| Jurnal dari mutasi bank (`bank-reconciliation.ts:699`) | Dr/Cr akun bank vs akun lawan pilihan pengguna, tertaut ke baris mutasi | BENAR (akun lawan adalah keputusan pengguna, divalidasi postable/aktif/beda akun) |

Catatan: lawan saldo awal memakai akun ekuitas pemetaan (`equity` → 3000 Modal Pemilik), bukan akun khusus "Saldo Awal/Ekuitas Pembuka". Dapat diterima untuk skala ini; perusahaan yang mengaudit migrasi dari sistem lama akan lebih terbantu akun pembuka terpisah. Bukan temuan bernomor.

## 7. Yang memang TIDAK menjurnal — dan itu BENAR

Pesanan pembelian (PO), permintaan pembelian (PR), reservasi stok, penjualan ditahan (held), draf THR & lembur sebelum masuk run, dan klaim reimbursement sebelum dibayar (tetapi lihat AK4-10) tidak membuat jurnal. Itu perlakuan yang benar untuk komitmen/draf. Penjualan offline POS tersinkron memakai ulang `createSale` yang sama — tidak ada jurnal ganda maupun jurnal khusus sinkronisasi.

## 8. Konsistensi konfigurasi pemetaan (AK4-12, P3)

COA seed memetakan **28 kunci** (`src/db/seed.ts:337–364`), tetapi daftar resmi yang boleh diubah lewat Pengaturan (`ACCOUNT_MAPPING_KEYS`, `src/server/actions/accounting.ts:1778–1803`) hanya memuat **24 kunci**. Enam kunci yang nyata dibaca kode tidak dapat dipetakan ulang dari UI: `supplier_credit`, `employee_receivable`, `employee_loan_receivable`, `pph21_payable`, `bpjs_payable`, `payroll_employer_expense` — `saveMappingAction` menolaknya sebagai "tidak dikenal". Komentar AK-P2-06 di daftar itu mengklaim kunci di luar daftar tidak dibaca kode mana pun; klaim itu **tidak benar** untuk keenam kunci ini (bukti: `getAccountId(..., "bpjs_payable")` di `actions/accounting.ts:1330`, `getLoanReceivableAccountId` di `employee-loans.ts:56–64`, `supplier_credit` di `supplier-returns.ts`). `employee_loan_receivable` bahkan tidak terseed sama sekali — jalur konfigurasinya mati dari dua arah. Dampak praktis: perusahaan yang ingin memisahkan akun Kredit Pemasok / Utang PPh 21 / Utang BPJS dari bawaan tidak bisa, bertentangan dengan mandat konfigurabilitas (D-25).

## 9. Daftar temuan (prioritas)

### P1 — salah saji material / alur inti terblokir
- **AK4-01** Retur penjualan selalu gagal (jurnal tak seimbang sebesar porsi pembulatan) bila penjualan asal memiliki penyesuaian pembulatan ≠ 0. `pos.ts:1793–1827`.
- **AK4-02** Retur pembelian jalur warisan Gudang: Dr Utang Usaha tanpa tag/alokasi (risiko bayar ganda) dan Dr Piutang Usaha untuk klaim penggantian ke pemasok. `inventory.ts:986–1016`; UI aktif `adjustment-form.tsx:17`.
- **AK4-03** Retur penjualan atas penjualan kredit tidak mengurangi piutang; refund tunai atas utang belum lunas; sisa piutang penjualan retur-penuh masih dapat dibayar. `pos.ts:1567–1712`, `reports.ts:1761–1770`.
- **AK4-04** PPN Masukan tidak ada sama sekali (nol akun/kunci/jalur): PKP mengkapitalisasi PPN ke persediaan & beban; kompensasi PPN mustahil dari sistem. `inventory.ts:596–663`, `expenses.ts:9–13`, grep `tax_input` = 0.
- **AK4-05** Cuti tak berbayar di jurnal payroll & final pay dikreditkan ke utang dan bruto dibebankan penuh: Beban Gaji + Utang Gaji overstated permanen sebesar komponen itu. `actions/accounting.ts:1063–1096, 1184–1187, 1288–1296`; `hr.ts:1760–1787`.
- **AK4-06** Rekonsiliasi valuasi stok ↔ GL Persediaan tidak dijamin desain (retur biaya asal tanpa re-blend AVCO; void tanpa hitung ulang AVCO; unitCost ketik bebas) — selisih permanen tanpa jurnal penjelas. `inventory.ts:128–160, 773, 1716–1724`; `pos.ts:1651`; `reports.ts:791–806`.

### P2 — salah saji terbatas / kekurangan kepatuhan & kelengkapan
- **AK4-07** Penerimaan retur pelanggan via Gudang mengkredit 4020 sebesar biaya — semantik contra-revenue rusak, tanpa PPN/tautan penjualan. `inventory.ts:625–631`.
- **AK4-08** Final pay tanpa pesangon/UPMK/UPH sama sekali. `hr.ts:1690–2030`; grep pesangon = 0.
- **AK4-09** Tidak ada alur pembayaran setoran PPh 21 & BPJS; utang statutory hanya bisa dilunasi jurnal manual. `actions/accounting.ts:1330–1352` (hanya kredit).
- **AK4-10** Tidak ada akrual beban maupun beban dibayar di muka: reimbursement diakui saat dibayar, beban selalu tunai. `reimbursements.ts:225–262`, `expenses.ts:38–51`.

### P3 — penyajian, konfigurasi, kerapian
- **AK4-11** Jurnal opname neto; neto nol = tanpa jurnal walau selisih bruto besar. `inventory.ts:1598, 1648–1668`.
- **AK4-12** 6 kunci pemetaan yang dibaca kode tidak dapat diubah dari Pengaturan; `employee_loan_receivable` tidak terseed. `actions/accounting.ts:1778–1803`.
- **AK4-13** Barang in-transit hilang dari semua laporan stok selama transit; tak ada akun Persediaan Dalam Perjalanan. `inventory.ts:1245–1264`.
- **AK4-14** Penerimaan bonus → kredit Pendapatan Lain-lain pada biaya ketik (+ ikut re-blend AVCO); penerimaan `other` → kredit Modal Pemilik. `inventory.ts:618–638`.
- **AK4-15** Biaya perolehan pembelian tidak lengkap: ongkir/biaya angkut pembelian tidak dapat dikapitalisasi ke biaya persediaan (PSAK 14), dan tidak ada potongan pembelian; grep `ongkir|freight|landed` = 0.
- **AK4-16** Kunci idempotensi acak (UUID) pada setoran kasbon/pinjaman & mutasi laci — tanpa dedup server. `employee-advances.ts:532`, `employee-loans.ts:416`, `pos.ts` (cashDrawerMovement).
- **AK4-17** Potongan reguler menumpuk di 2100 tanpa pemetaan bawaan `salary_deductions_payable` dan tanpa laporan komposisi saldo 2100. `actions/accounting.ts:1279–1283`.
- **AK4-18** Jurnal selisih sesi kas selalu ke akun kas pemetaan tunggal bertanggal hari penutupan. `pos.ts` (closeCashSession).

## 10. Transaksi yang jurnalnya terbukti BENAR PENUH

Checkout POS · pembayaran piutang penjualan · void penjualan · tutup sesi kas (akun/sisi) · penerimaan pembelian (akun/sisi; nilai untuk non-PKP) · penyesuaian stok per arah · rusak/kedaluwarsa · karantina (tanpa jurnal) · transfer antar-gudang di GL · **retur pemasok modul A-9 termasuk ketiga penyelesaian klaimnya** · pembayaran utang & void-nya · pembayaran gaji (tanpa double count) · void payroll (simetris: jurnal + kasbon + pinjaman + draf THR) · kasbon (beri/setor/potong/pulih) · pinjaman karyawan (cair/setor/cicil) · penjualan tunai cepat · FIFO terima piutang & bayar utang Catat Transaksi · aset tetap (perolehan/penyusutan agregat/pelepasan dengan laba-rugi terpisah) · saldo awal pihak & pembayarannya · transfer bank + biaya admin · jurnal mutasi bank · ketiadaan jurnal pada PO/PR/reservasi/draf.

*Catatan metode: audit ini baca-saja atas kode pada 2026-11-04 malam; angka contoh pada AK4-06 adalah konstruksi aljabar dari rumus di kode, bukan hasil menjalankan transaksi di DB. Temuan AK4-01 didukung bukti DB dev: belum pernah ada penjualan dengan `rounding_adjustment ≠ 0`, sehingga jalur gagalnya belum pernah terpicu dalam pengujian mana pun.*
