# Audit Adversarial Akuntansi — Bagian 3: Piutang, Utang, Kas/Bank & Rekonsiliasi

Sikap audit: **semua saldo pihak dianggap salah sampai terbukti cocok.**
Metode: inspeksi kode domain + aksi (baca-saja) dan kueri SELECT pembuktian di DB dev.
Tanggal: 2026-11-04. Lingkup: `party_payments` & FIFO, retur pemasok (A-9/D-20), Catat Transaksi (A-12/D-23), rekonsiliasi bank, sesi kas POS, transfer antar-akun, halaman piutang/utang.

## Ringkasan hitungan

| Prioritas | Jumlah | ID |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | AK3-01, AK3-02 |
| P2 | 5 | AK3-03 s.d. AK3-07 |
| P3 | 5 | AK3-08 s.d. AK3-12 |

---

## P1

### AK3-01 — SALAH-SALDO (P1): Void penjualan TIDAK menyentuh pembayaran piutang (`party_payments`) — GL piutang menyimpang dari subledger, dan penjualan void tetap bisa dibayar

Bukti jalur kode:

- `voidSale` (`src/server/pos.ts:1256–1529`) hanya membalik jurnal penjualan (`reverseSourceJournal` sourceType `"sale"`, baris ~1371) dan mengembalikan stok. Seluruh badan fungsi memuat **0 rujukan** ke `partyPayments`/`party_payments` (terverifikasi grep pada rentang fungsi). Jurnal penerimaan piutang ber-sourceType `"payment"` (dibuat `payReceivable`, `pos.ts:1950-an`) **tidak ikut dibalik** dan baris `party_payments`-nya tetap `posted`.
- Update akhir `voidSale` (`pos.ts:1497–1506`) hanya menyetel `status/voidedAt/voidedBy/voidReason` — `paidTotal` dan `paymentStatus` penjualan **tidak direset**.
- Penjaga void yang ada hanya: status + retur terposting (T4R-1). Bandingkan sisi utang: void penerimaan **terblokir** bila sudah ada pembayaran/alokasi retur (`src/server/inventory.ts:1740–1758`) — penjaga yang sama **tidak ada** untuk penjualan berpiutang.
- `payReceivable` (`pos.ts:1874–1897`) hanya menolak bila `paymentStatus === "paid"`; **tidak ada pemeriksaan `sale.status`**. Aksi `payReceivableAction` (`src/server/actions/pos.ts:428`) juga tidak menambah pemeriksaan. Jadi penjualan yang sudah di-void (paymentStatus masih `partial`/`unpaid`) tetap menerima pembayaran baru lewat domain/aksi.

Akibat angka: penjualan utang Rp1.000.000, diterima Rp400.000, lalu di-void → jurnal penjualan dibalik penuh (piutang GL kembali 0 dari dokumen), tetapi jurnal penerimaan Rp400.000 (Dr Kas / Cr Piutang) tetap posted → **saldo GL akun piutang untuk pelanggan itu −Rp400.000**, kas menyimpan uang tanpa kewajiban tercatat. `listReceivables` (`src/server/reports.ts:1746`) menyaring `status = "completed"` sehingga dokumen hilang dari subledger & aging → **subledger ≠ GL sebesar total pembayaran atas penjualan void**, tanpa satu pun penanda di UI. Kueri pembuktian di DB dev: saat ini 0 baris penjualan void ber-`party_payments` posted — cacatnya laten di jalur kode, belum meledak di data contoh.

### AK3-02 — ALOKASI-SALAH (P1): Pembayaran utang per dokumen tidak memeriksa status penerimaan — penerimaan yang sudah di-VOID tetap bisa dibayar

- `payPayableDocument` (`src/server/payables.ts:40–61`) memeriksa `source === "purchase"`, `paymentAccountId` kosong, supplier ada, dan `paymentStatus !== "paid"` — **tidak pernah memeriksa `receipt.status`**.
- `voidReceipt` (`src/server/inventory.ts:1935–1938`) hanya menyetel `status: "void"`; `paymentStatus` penerimaan kredit yang belum dibayar tetap `"unpaid"`.
- Kombinasinya: penerimaan kredit → di-void (jurnal utangnya sudah dibalik) → `payPayableAction` dengan `receiptId` itu lolos semua pemeriksaan → `party_payments` terbit + jurnal Dr Utang / Cr Kas posted. Uang keluar, utang GL pemasok menjadi negatif, dan dokumen tidak muncul di `listPayables` (penyaring `status = "posted"`, `reports.ts:1830`) sehingga pembayaran yatim ini tak terlihat di subledger.
- Jalur FIFO aman dari cacat ini (`listSupplierOpenPayableDocs` menyaring `status = "posted"`, `supplier-returns.ts:132`), dan domain saldo awal menegakkan pemeriksaan status (`payOpeningBalance`, `opening-balances.ts:373–374`: void/settled ditolak). Jadi ini murni lubang di satu domain pembayaran tertua.

## P2

### AK3-03 — KURANG-LENGKAP/kontrol (P2): Pembayaran utang tidak memvalidasi akun sumber dana; transfer bank juga tidak membatasi akun yang layak

- `payPayableDocument` memakai `input.accountId` apa adanya ke jurnal (`payables.ts:84–99`); aksi `payPayableAction` (`actions/accounting.ts:399–443`) hanya memvalidasi bentuk UUID. Satu-satunya benteng adalah pemeriksaan generik `postJournal` (akun milik perusahaan, postable, aktif — `accounting.ts:67–82`).
- Tiga domain saudara menegakkan validasi saluran pembayaran pola POS-PAY-01 secara eksplisit dan berkomentar bahwa domain "tidak boleh percaya klien": `payReceivable` (`pos.ts:1899–1942`), `payOpeningBalance` lewat `assertPaymentAccount` (`opening-balances.ts:313–361`), dan penjualan tunai Catat Transaksi (`quick-entry.ts:53–83`). Domain pembayaran utang — yang dipakai halaman Utang **dan** FIFO Catat Transaksi — adalah satu-satunya yang tidak.
- Akibat: pembayaran utang dapat dikreditkan ke akun postable mana pun (akun pendapatan, persediaan, liabilitas lain) lewat panggilan aksi langsung; jurnal tetap seimbang sehingga tidak ada alarm. UI memang menawarkan daftar akun kas/bank, tetapi kontrolnya tidak ada di server.
- Pola sama, dampak lebih kecil: `createBankTransfer` (`bank-transfers.ts`) dan aksinya tidak membatasi pasangan akun ke akun kas/bank yang terpetakan — transfer "dari akun pendapatan ke akun beban" dapat diposting.

### AK3-04 — FUNGSI-HILANG (P2): Tidak ada fee/MDR metode pembayaran (QRIS/EDC) — saldo bank di GL permanen lebih tinggi dari saldo bank riil

- Pencarian `feePercent|fee_percent|mdr|fee` pada skema `payment_methods`, `src/server/pos.ts`, dan aksi pengaturan: **0 hasil**. Pembayaran non-tunai dibukukan bruto penuh ke akun metode bayar.
- Bank/acquirer menyetor neto (mis. MDR QRIS 0,7%). Selisihnya tidak pernah dijurnal sebagai beban, sehingga saldo akun bank/QRIS di buku besar selalu melebihi mutasi bank riil sebesar akumulasi MDR — dan di rekonsiliasi bank selisih itu muncul sebagai baris buku "tak tertaut" yang tidak bisa dijelaskan dari dalam sistem. Tidak ada konfigurasi tarif fee per metode bayar sama sekali (melanggar semangat D-25: parameter biaya seharusnya konfigurasi per perusahaan/metode).

### AK3-05 — FUNGSI-HILANG (P2): Kelebihan bayar & uang muka tidak bisa dicatat — semua jalur menolak pembayaran di atas sisa

- Setiap jalur menolak nominal di atas sisa: `payReceivable` (`pos.ts:1897`), `payPayableDocument` (`payables.ts:63–66`), FIFO terima piutang (`quick-entry.ts:255–260`), FIFO bayar utang (`quick-entry.ts:331–336`), `payOpeningBalance` (`opening-balances.ts:383–386`).
- Tidak ada konsep deposit/uang muka pihak di seluruh skema & domain (pencarian `uang muka|downpayment|down_payment|deposit` hanya menemukan kasbon karyawan). Pelanggan yang membayar di muka atau pemasok yang menerima DP tidak punya rumah akuntansi: kasir terpaksa menolak uangnya, atau — yang lebih buruk — mencatatnya lewat jurnal manual/beban lain yang memalsukan saldo. Untuk ERP toko yang menerima pesanan inden/DP, ini kekurangan fungsional nyata.

### AK3-06 — KURANG-LENGKAP (P2): Kredit pelanggan (store credit) terjurnal benar tetapi tidak terlihat sebagai saldo di mana pun — asimetris terhadap kredit pemasok

- Sisi jurnal benar: retur `store_credit`/`exchange` mengkredit akun liabilitas pemetaan `customer_credit` bertag pihak (`pos.ts:1664–1680`), penebusan di checkout mendebit akun yang sama (`pos.ts:606–630, 727, 892`), dan void penjualan mengembalikan `creditUsed` (D-12, `pos.ts:1440–1496`).
- Tetapi saldonya hanya hidup sebagai angka per-dokumen retur (`getReturnCredit`, `pos.ts:1531`) yang diketahui dari **nomor dokumen retur**. Tidak ada: kolom saldo kredit di detail pelanggan (`getPartyDetail` di `master-data.ts` hanya menghitung `supplierCreditRemaining` untuk pemasok, baris 666–680; untuk pelanggan tidak ada padanannya — 0 rujukan `customer_credit` di `master-data.ts`, `reports.ts`, dan halaman piutang-utang), tidak ada daftar kredit pelanggan terbuka, dan daftar piutang tidak menetralkan kredit ini. Saldo liabilitas kredit pelanggan di GL tidak punya subledger yang bisa diaudit dari UI.

### AK3-07 — KURANG-LENGKAP (P2): Utang pembelian tidak memiliki jatuh tempo sama sekali; termin pihak praktis tidak dipakai

- Skema memuat tepat dua kolom `due_date`: `sales.due_date` (baris 1032) dan `party_opening_balances.due_date` (baris 2473). `stock_receipts` dan `purchase_orders` **tidak punya kolom jatuh tempo**; `listPayables` mengisi `dueDate: null` untuk semua penerimaan dokumen (`reports.ts:1885`) — hanya saldo awal yang ber-tempo.
- `suppliers.payment_term_days`/`customers.payment_term_days` (S3) hanya dikonsumsi satu tempat: bawaan jatuh tempo **dokumen saldo awal** (`opening-balances.ts:47–67, 158`). Tidak dipakai PO, penerimaan, maupun POS.
- Jatuh tempo penjualan utang POS memang wajib diisi (D-19), tetapi bawaannya **+7 hari ter-hardcode di komponen UI** (`src/components/pos/pos-terminal.tsx:195–200`), bukan dari termin pelanggan.
- Akibat: aging utang hanya bisa berdasar tanggal dokumen (sesuai aturan proyek), tidak ada penanda "lewat tempo" untuk utang riil, dan pertanyaan paling dasar kas — "utang apa yang jatuh tempo minggu ini?" — tidak bisa dijawab sistem untuk pembelian berjalan.

## P3

### AK3-08 — KURANG-LENGKAP (P3): Tanggal pembayaran boleh mendahului tanggal dokumen; FIFO dapat mengalokasikan pembayaran ke dokumen bertanggal lebih muda dari pembayaran

- Fitur pilih tanggal pembayaran (AK-P2-03) disengaja, tetapi tidak satu pun jalur membandingkan tanggal pembayaran dengan tanggal dokumen induk: `payPayableDocument`, `payReceivable`, `payOpeningBalance`, dan kedua FIFO tidak memuat pemeriksaan tanggal relatif.
- FIFO mengurutkan dokumen berdasar tanggal dokumen lalu `createdAt` (`quick-entry.ts:226`; `supplier-returns.ts:197–199`) tanpa menyaring `doc.date <= payment.date`. Pembayaran bertanggal 5 Jan dapat teralokasi ke penerimaan bertanggal 20 Jan; jurnal pembayaran terposting 5 Jan mengurangi utang yang jurnalnya sendiri baru terbit 20 Jan — neraca per tanggal antara keduanya menampilkan gerakan utang tanpa dokumen sumber.

### AK3-09 — KURANG-LENGKAP (P3): Penerimaan piutang tunai & pembayaran utang tunai tidak masuk mutasi sesi kas — kas laci versi sesi menyimpang dari GL

- `closeCashSession` menghitung kas harapan murni dari `cash_movements` (`pos.ts:2086–2092`). `payReceivable` dan `payPayableDocument` tidak menulis `cash_movements` apa pun dan tidak mengenal sesi.
- Kasir yang menerima pembayaran piutang tunai ke akun kas laci di tengah sesi menaikkan saldo GL kas tanpa menaikkan kas harapan sesi → saat tutup sesi selisih terbaca "kas lebih" dan terjurnal ke akun selisih (8001), padahal uangnya sah dan tertelusur ke pembayaran piutang. Selisih sesi berhenti menjadi alat kontrol yang bersih.

### AK3-10 — KURANG-LENGKAP (P3): Rekonsiliasi bank hanya "per hari ini", dan taut/lepas tautan tidak teraudit

- `getReconciliationSummary` (`bank-reconciliation.ts:745–824`) mengunci batas `journalEntries.date <= todayISO()` di kode — tidak ada parameter tanggal-akhir, sehingga rekonsiliasi per tanggal tutup buku lampau tidak dapat dihasilkan ulang; tidak ada saldo-akhir-mutasi (ending bank balance) yang dibandingkan secara formal, hanya total terekonsiliasi/belum dari sisi buku + total mutasi tak tertaut.
- Satu-satunya `writeAudit` di berkas itu ada di baris 729 (pembuatan jurnal dari baris mutasi). `matchLine` (574) dan `unmatchLine` (649) mengubah status rekonsiliasi tanpa jejak audit siapa/kapan.

### AK3-11 — KURANG-LENGKAP (P3): Tidak ada pencegahan/peringatan saldo kas/bank GL negatif di jalur keluar mana pun

- Transfer (`bank-transfers.ts`), pembayaran utang/piutang, beban, dan setoran tidak memeriksa saldo akun sumber; `postJournal` tidak mengenal konsep saldo. Rekening bank dapat terdorong negatif tanpa satu pun penolakan atau peringatan. Boleh jadi kebijakan yang diterima (banyak ERP mengizinkan), tetapi tidak terdokumentasi sebagai keputusan dan tidak ada saklar konfigurasi untuk menegakkannya.

### AK3-12 — FUNGSI-HILANG (P3): Tidak ada denda keterlambatan dan tidak ada pengingat jatuh tempo

- Pencarian `denda|lateFee|late_fee|pengingat|reminder` di domain server & halaman akuntansi: 0 hasil. Halaman piutang-utang hanya menampilkan teks "Tempo {tanggal}" untuk baris yang punya `dueDate` (`piutang-utang/page.tsx:172, 235`) tanpa penanda lewat-tempo, tanpa daftar "jatuh tempo minggu ini", tanpa mekanisme pengingat apa pun.

---

## Yang terbukti BENAR (diverifikasi dari kode)

1. **Satu definisi utang/piutang terbuka untuk semua jalur.** FIFO terima piutang, FIFO bayar utang, pembayaran per dokumen, posting retur, dan laporan memakai definisi yang sama: total − pembayaran non-void − alokasi retur, terurut tanggal dokumen lalu `createdAt` (`quick-entry.ts:163–233, 303–368`; `supplier-returns.ts:113–204`). Alokasi retur selalu dikurangkan lebih dulu, sehingga utang yang sudah diselesaikan retur **tidak bisa dibayar dua kali** (penjaga eksplisit di `payables.ts:62–66`).
2. **Tiga angka saldo pihak cocok menurut konstruksi.** Saldo di detail pihak (`master-data.ts:657–663`) memanggil `listPayables`/`listReceivables` yang sama dengan halaman Piutang/Utang, dan aging di halaman itu dihitung dari baris yang sama (`piutang-utang/page.tsx:76–77, 325–340`). Detail = daftar = aging; yang tidak dijamin jalur ini adalah kesetaraan terhadap GL bila AK3-01/AK3-02 terjadi.
3. **Void pembayaran per dokumen tepat sasaran.** Jurnal pembayaran itu sendiri dibalik lewat idempotency key-nya (bukan per dokumen induk), `paidAmount` induk dihitung ulang dari pembayaran non-void + alokasi retur, status diturunkan kembali dengan benar (`actions/accounting.ts:445–552`; sisi piutang simetris di `actions/pos.ts:465`). Teruji termasuk void salah satu dari dua pembayaran parsial (`tests/integration/payments-void-p2.test.ts:349–513`).
4. **Void dokumen induk terpenjaga di sisi utang & saldo awal.** Void penerimaan terblokir bila ada pembayaran atau alokasi retur (`inventory.ts:1740–1770`); void saldo awal terblokir bila ada pembayaran/alokasi (`opening-balances.ts:261–285`); void retur pemasok menghapus alokasi, menyegarkan status semua dokumen terdampak, membalik jurnal, dan memulihkan stok irisan batch asal (`supplier-returns.ts:814–943`). (Sisi penjualan adalah pengecualian — lihat AK3-01.)
5. **Klaim kredit pemasok konsisten dokumen ↔ GL.** Posting retur: Dr Utang (FIFO, sebesar utang terbuka) + Dr Kredit Pemasok 1210 (sisanya) / Cr Persediaan (`supplier-returns.ts:705–768`); penerapan kredit mendukung target eksplisit atau FIFO dengan jurnal Dr Utang / Cr 1210 (`1088–1168`); refund dan barang pengganti mengonsumsi akun klaim yang sama; penutupan "other" tidak menghapus sisa klaim — tetap tercatat sebagai aset dan tertandai `closedWithRemainder` (`1435–1498`). Sisa klaim di detail pemasok = Σ(creditAmount − resolvedAmount), selaras dengan jurnal-jurnal di atas.
6. **Rekonsiliasi bank kokoh di inti.** Impor mutasi CSV ada (`importStatement`, 334); auto-match hanya jumlah **persis sama** dan selisih tanggal ≤ 3 hari, kandidat ganda dihitung sebagai ambigu dan tidak dipaksakan (480–548); match manual menolak jumlah tak sama, baris jurnal balik, dan jurnal yang sudah dibalik (574–647); unmatch tersedia (649); selisih diselesaikan lewat jurnal penyesuaian/`createJournalFromLine`, bukan tautan paksa; ringkasan memakai predikat "live" yang sama untuk saldo buku dan total terekonsiliasi (745–824).
7. **Transfer bank membukukan biaya dengan benar.** Jurnal: Dr rekening tujuan (nominal penuh) + Dr beban biaya bank (pemetaan `bank_fee`, bila fee > 0) / Cr rekening asal (nominal + fee) (`bank-transfers.ts:60–71`); void transfer membalik termasuk fee-nya (teruji, `payments-void-p2.test.ts:515`).
8. **Selisih sesi kas terjurnal ke akun terkonfigurasi.** Selisih tutup sesi masuk pemetaan `cash_over` (seed 8001) / `cash_short` (seed 8000) — dapat diganti lewat pemetaan akun, bukan hardcoded di domain (`pos.ts:2104–2125`; `seed.ts:350–351`). Setoran ke bank dan tarik dari bank dari dalam sesi terjurnal dua arah dan menjadi bagian mutasi sesi (`pos.ts:2134–2201`), sesuai semantik D-9. Sesi hanya bisa ditutup pemiliknya (POS-SES-01).
9. **`payOpeningBalance` adalah implementasi rujukan.** Pemeriksaan status (void/settled), validasi akun saluran, pengurangan alokasi retur, dan idempotency key per pembayaran semuanya ada (`opening-balances.ts:362–422`) — membuktikan pola yang benar sudah dikenal codebase; AK3-02/AK3-03 adalah ketidakkonsistenan, bukan ketidakmampuan.
10. **Akun penerimaan piutang divalidasi ketat.** `payReceivable` menolak akun non-postable/nonaktif dan akun di luar saluran sah (metode bayar aktif non-kredit ∪ pemetaan kas/bank/QRIS), secara eksplisit untuk mencegah pembayaran "ke akun piutang itu sendiri" (`pos.ts:1899–1942`).

---

## Lampiran: cakupan periksa mandat

| Butir mandat | Hasil |
|---|---|
| §1 FIFO parsial berurutan | Benar — urutan tanggal dokumen + createdAt, satu definisi (Terbukti #1) |
| §1 Kelebihan bayar | Ditolak di semua jalur; tidak menjadi kredit pihak → AK3-05 |
| §1 Bayar dokumen void | Utang: LOLOS bayar (AK3-02); Piutang: dokumen void tak terdaftar untuk FIFO, tetapi pembayaran per dokumen tetap lolos (AK3-01) |
| §1 Void pembayaran memulihkan alokasi | Benar persis (Terbukti #3) |
| §1 Pembayaran sebelum tanggal dokumen | Tidak dicegah → AK3-08 |
| §2 Kredit pemasok FIFO vs target | Keduanya didukung (Terbukti #5) |
| §2 Kredit pelanggan simetris? | Jurnal simetris, visibilitas tidak → AK3-06 |
| §2 Detail vs aging vs subledger | Sama menurut konstruksi (Terbukti #2); terhadap GL rapuh oleh AK3-01/02 |
| §3 Transfer + biaya | Benar termasuk fee (Terbukti #7); akun tak dibatasi (AK3-03) |
| §3 Rekonsiliasi: cocok manual/otomatis, batal, outstanding | Keduanya ada; unmatch ada; mutasi tak tertaut tampil sebagai daftar; ringkasan hanya as-of hari ini (AK3-10) |
| §3 Impor mutasi bank | Ada (CSV) |
| §3 Saldo kas/bank negatif dicegah | Tidak → AK3-11 |
| §4 Selisih sesi | Akun pemetaan cash_over/cash_short (Terbukti #8) |
| §4 Setoran bank dari sesi; uang masuk non-penjualan | Setoran/tarik terjurnal; penerimaan piutang tunai tidak masuk mutasi sesi → AK3-09 |
| §5 Jatuh tempo & termin | AR POS punya dueDate (bawaan +7 hari hardcoded); AP dokumen tanpa dueDate; termin hanya untuk saldo awal → AK3-07 |
| §5 Denda & pengingat | Tidak ada → AK3-12 |
| §6 Pembulatan pembayaran | Pembayaran pihak nominal persis (4 desimal); pembulatan tunai hanya di total penjualan per kelompok pelanggan (akun 9000/9001) — tidak ada temuan |
| §6 Fee metode bayar (EDC/QRIS) | Tidak ada sama sekali → AK3-04 |
