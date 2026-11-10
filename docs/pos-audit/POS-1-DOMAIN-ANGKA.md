# Audit Adversarial POS-1 — Domain & Kebenaran Angka POS (Bisa ERP)

- **Tanggal:** 2026-11-04 · **Jenis:** audit adversarial baca-saja (kode produksi tidak diubah; tidak ada commit).
- **Lingkup:** domain & angka POS — `src/server/pos.ts` (2.360 baris), `src/server/pos-offline.ts`, `src/lib/pos-offline.ts`, jalur terkait (`postJournal` di `src/server/accounting.ts`, `applyStockMovement` di `src/server/inventory.ts`, `payReceivable` yang juga dipakai quick-entry FIFO).
- **Sikap:** anggap semua salah sampai terbukti benar dengan angka. Setiap klaim diverifikasi dengan **probe runtime berangka baru** di perusahaan fixture khusus audit `01900000-0000-7000-8000-00000000d501` (+ tenant kedua `…d601` untuk probe lintas-tenant). Perusahaan demo `01900000-…-0001` **tidak disentuh untuk menulis**.
- **Instrumen bukti:** `tests/integration/pos1-audit-probe.test.ts` — 18 test yang assert-nya menyatakan perilaku yang BENAR. Test gagal = temuan terbukti-salah (angka aktual dari output vitest dikutip apa adanya); test lulus = terbukti-benar. Hasil larian final yang stabil: **13 gagal · 5 lulus**. Berkas probe dibiarkan di repo sebagai target regresi: sesudah perbaikan, test terkait harus berubah hijau.
- **Verifikasi klaim lama:** 8 berkas test POS lama dijalankan ulang — `sale-flow`, `pos-returns`, `pos-debt-sales`, `pos-guards`, `pos-hold-cash`, `feature-matrix-pos`, `credit-redemption`, `stock-batches` — **61/61 hijau**. Temuan audit 2026-11-03 yang diklaim tertutup (POS-RET-01/02, POS-PAY-01/02, POS-DISC-01 dasar, POS-SES-01 kepemilikan, POS-REF-01, POS-STK-01, POS-GRP-01, POS-HOLD-01/02, POS-IDEM-01 sekuensial, POS-CASH-01 semantik D-9) **terbukti memang tertutup** pada lapisan yang diuji berkas-berkas itu. Temuan di bawah adalah celah yang TIDAK tercakup lapisan uji tersebut.

## Ringkasan

**13 temuan baru — P0: 0 · P1: 3 · P2: 4 · P3: 6.** Fondasi checkout inti terbukti kuat (rekonsiliasi emas cocok persis; idempotensi & stok aman di bawah konkurensi; void membalik penerimaan piutang dengan bersih). Kelemahan terkonsentrasi di **tepi-tepi yang tidak dikunci/diduplikasi persis seperti checkout**: validasi agregat di dalam satu permintaan retur, plafon kredit di bawah konkurensi, penerimaan piutang tanpa kunci idempotensi, setoran sesi tanpa plafon isi laci, dan sinkronisasi offline yang mengutip ulang harga secara senyap.

| No | Tingkat | Temuan | Status bukti |
|---|---|---|---|
| POS1-01 | **P1** | Retur: baris produk duplikat dalam satu permintaan mengakali penjaga sisa retur — refund 160% dari nilai terjual | TERBUKTI-SALAH (probe) |
| POS1-02 | **P1** | Batas kredit pelanggan dapat ditembus dua checkout utang bersamaan (200.000 > limit 150.000) | TERBUKTI-SALAH (probe, deterministik) |
| POS1-03 | **P1** | Setoran kas melebihi isi laci diterima — rantai dua operasi biasa menciptakan saldo bank & pendapatan selisih fiktif Rp150.000 | TERBUKTI-SALAH (probe) |
| POS1-04 | P2 | Sinkronisasi offline: harga turun sesudah antre → penjualan terposting "synced" dengan total berbeda dari struk pelanggan, tanpa jejak | TERBUKTI-SALAH (probe) |
| POS1-05 | P2 | Pembayaran piutang tanpa kunci idempotensi: pengiriman ganda tercatat dua kali (kas GL > kas fisik) | TERBUKTI-SALAH (probe) |
| POS1-06 | P2 | Refund TUNAI atas penjualan yang dibayar penuh dengan Kredit Pelanggan — kredit non-tunai dikonversi menjadi kas laci | TERBUKTI-SALAH (probe) |
| POS1-07 | P2 | Penjualan lunas menerima `customerId` perusahaan lain tanpa validasi (penjualan kredit memvalidasi, lunas tidak) | TERBUKTI-SALAH (probe) |
| POS1-08 | P3 | Metode pembayaran tanpa akun penampung: checkout gugur di akhir dengan "Jurnal tidak seimbang", bukan penolakan konfigurasi | TERBUKTI-SALAH (probe) |
| POS1-09 | P3 | Penjualan produk berharga Rp0 gugur total: "Jurnal minimal memiliki dua baris" | TERBUKTI-SALAH (probe) |
| POS1-10 | P3 | Ambang diskon supervisor dinilai dari bruto harga normal: diskon manual 100% atas harga kelompok Rp500 (produk Rp100.000) lolos tanpa izin & tanpa audit override | TERBUKTI-SALAH (probe) |
| POS1-11 | P3 | Penjualan utang menerima jatuh tempo di masa lalu (langsung lewat tempo di aging) | TERBUKTI-SALAH (probe) |
| POS1-12 | P3 | Pembayaran piutang menerima tanggal sebelum tanggal penjualan | TERBUKTI-SALAH (probe) |
| POS1-13 | P3 | `createSale` membaca sesi kas tanpa kunci baris: balapan tutup-sesi vs checkout dapat menulis mutasi ke sesi yang baru ditutup | TERBUKTI dari kode; runtime TIDAK-TERUJI |

---

## Temuan

### POS1-01 · P1 · Retur mengakali penjaga sisa lewat baris duplikat dalam satu permintaan

**Bukti kode.** `createSaleReturn` memvalidasi setiap baris terhadap snapshot `returnedMap` yang dibaca SEKALI sebelum loop (`src/server/pos.ts:1675-1684`), lalu loop validasi (`pos.ts:1703-1740`, cek `qty.gt(maxReturn)` di baris 1710) tidak pernah menambahkan qty baris yang sedang diproses ke peta itu. Dua baris untuk produk yang sama dalam satu permintaan masing-masing dinilai terhadap sisa penuh. Bandingkan `quoteCart` yang justru menolak produk duplikat secara eksplisit (T3R-1, `pos.ts:151-165`) dengan alasan yang sama persis ("duplikat mengakali dua penjaga per baris") — penjaga itu tidak pernah dipasang di jalur retur. Action `createReturnAction` juga tidak men-dedupe (`src/server/actions/pos.ts:379-413`).

**Bukti probe (POS1-01).** Jual 5 unit @Rp10.000 tunai (total Rp50.000, stok 5→0), lalu satu permintaan retur tunai dengan baris `[{produk, 4}, {produk, 4}]`:
- hasil retur: **refund Rp80.000** (output bukti: `{"refundTotal":80000,"returnLinesQty":[4,4],"stockAfter":8}`) — 160% dari yang pernah dibayar pelanggan;
- stok akhir **8 unit** dari 5 yang pernah ada — 3 unit persediaan fiktif masuk kartu stok & valuasi;
- jurnal retur terposting seimbang untuk 8 unit (Dr Retur penjualan/HPP terbalik untuk barang yang tidak pernah dijual).

**Dampak.** Kasir (izin `pos.return`) — atau kesalahan entri UI yang mengirim baris ganda — mengeluarkan uang laci melebihi penjualan dan menggembungkan persediaan. Tidak perlu konkurensi, tidak perlu dua permintaan; satu formulir cukup. Ini melewati persis penjaga yang dibangun untuk POS-RET-01: kunci baris penjualan hanya menahan balapan ANTAR-permintaan, bukan agregat DI DALAM permintaan.

**Arah perbaikan.** Di awal `createSaleReturn`, agregatkan `input.lines` per `productId` (atau tolak duplikat seperti `quoteCart`), dan nilai validasi terhadap peta yang ikut diperbarui selama loop pass-1. Tambahkan test regresi dari probe POS1-01.

### POS1-02 · P1 · Batas kredit bukan plafon keras di bawah konkurensi

**Bukti kode.** Pemeriksaan batas kredit di `createSale` (`pos.ts:790-813`) membaca `SUM(sales.total − sales.paidTotal)` tanpa kunci apa pun (tanpa `FOR UPDATE` pada baris pelanggan, tanpa kunci penasihat per pelanggan). Di bawah READ COMMITTED, dua transaksi bersamaan tidak melihat penjualan satu sama lain yang belum commit — keduanya menilai sisa limit yang sama.

**Bukti probe (POS1-13c, transaksi commit, `Promise.allSettled`).** Pelanggan berlimit **Rp150.000**; dua checkout utang bersamaan masing-masing **Rp100.000** (kunci idempotensi berbeda, produk & sesi sama): **keduanya terposting**; piutang terbuka akhir = **Rp200.000** (kegagalan assert: `expected 200000 to be less than or equal to 150000`). Terpicu pada percobaan pertama di dua larian berturut-turut — bukan balapan eksotis.

**Dampak.** Kebijakan kredit perusahaan (D-19) dapat ditembus oleh pemakaian normal dua terminal secara bersamaan — persis skenario minimarket dua kasir. Piutang berisiko lahir di atas plafon yang disetujui pemilik tanpa satu pun kasir melihat peringatan.

**Arah perbaikan.** Serialisasi per pelanggan pada jalur piutang: kunci baris `customers` (`FOR UPDATE`) sebelum pemeriksaan limit, atau kunci penasihat `pg_advisory_xact_lock` per (perusahaan, pelanggan). Test regresi = probe POS1-13c.

### POS1-03 · P1 · Setoran melebihi isi laci menciptakan uang fiktif berantai

**Bukti kode.** `cashDrawerMovement` (`pos.ts:2292-…`) hanya memvalidasi sesi milik aktor & berstatus open dan `amount > 0`. Tidak ada pemeriksaan terhadap saldo laci sesi berjalan (opening + Σ mutasi). Setoran ditandatangani negatif (`pos.ts:2320`) sesuai semantik D-9 (setor = kas keluar ke bank), dan langsung dijurnal Dr Bank / Cr Kas tanpa plafon apa pun selain penjaga saldo kas GL perusahaan (FIX-R2, bawaan `warn` = hanya peringatan).

**Bukti probe (POS1-09, dua test).** Sesi dibuka dengan kas awal **Rp50.000**, tanpa penjualan:
1. `cashDrawerMovement(deposit, 200.000)` → **diterima** (assert penolakan gagal: `expected false to be true`).
2. Tutup sesi dengan hitungan fisik 0 → **difference = +Rp150.000** (assert: `expected 150000 to be +0`), dan penutupan menjurnal Dr Kas / Cr *Selisih kas lebih* (pendapatan) Rp150.000.

**Dampak.** Rantai dua operasi biasa oleh satu pemegang izin `pos.session` menghasilkan: saldo **Bank GL +Rp200.000** untuk setoran yang secara fisik mustahil (laci hanya berisi Rp50.000), kas GL dipulihkan oleh jurnal "kas lebih" fiktif, dan **pendapatan selisih Rp150.000 yang tidak pernah ada**. Kontrol kas — alasan sesi kasir ada — dapat dipalsukan dari dalam sistem tanpa menyentuh database. Penjaga FIX-R2 mode `block` pun menilai saldo kas GL *perusahaan*, bukan isi laci *sesi*, jadi tidak menahan rantai ini bila kas perusahaan cukup besar.

**Arah perbaikan.** Validasi setoran terhadap saldo laci sesi berjalan (opening + mutasi sampai saat ini, dihitung di bawah kunci baris sesi): setoran > saldo laci → tolak. Penarikan dari bank boleh tetap bebas (uang masuk dari bank dapat diverifikasi dari mutasi bank), atau dibatasi kebijakan perusahaan.

### POS1-04 · P2 · Sinkronisasi offline mengutip ulang harga secara senyap

**Bukti kode.** `OfflineSalePayload` (`src/lib/pos-offline.ts:30-40`) tidak membawa total/nilai yang dikutip perangkat saat offline — hanya baris, pembayaran, dan `clientKey`. `processOfflineSaleItem` (`src/server/pos-offline.ts:84-131`) memanggil `createSale` biasa, yang mengutip ulang dari harga & aturan diskon **saat sinkron**. Hasil sinkron tidak membandingkan apa pun: status `synced` diberikan untuk total berapa pun yang keluar dari kutipan ulang.

**Bukti probe (POS1-02).** Produk Rp10.000, item antre dibayar tunai Rp10.000 (struk pelanggan: Rp10.000, tanpa kembalian):
- harga server **turun ke Rp7.500** sebelum sinkron → status **`synced`**, penjualan terposting **total Rp7.500** dengan kembalian tercatat Rp2.500 (assert: `expected 7500 to be 10000`) — kembalian yang tidak pernah diberikan kepada siapa pun; pendapatan & PPN tercatat lebih rendah dari transaksi nyata, tanpa satu pun penanda di daftar peninjauan;
- harga **naik ke Rp12.000** → status `failed` ("Pembayaran kurang…") dan masuk daftar peninjauan — arah ini aman (test lulus).

**Dampak.** Setiap perubahan harga/diskon selama jendela offline menciptakan selisih senyap antara struk pelanggan dan buku besar untuk arah turun, dan kegagalan massal untuk arah naik. Karena payload tidak menyimpan total offline, selisih arah turun **tidak dapat dideteksi sesudahnya** dari data outbox.

**Arah perbaikan.** Simpan `expectedTotal` (hasil quote perangkat) di payload; saat sinkron, bandingkan dengan total kutipan ulang — selisih ≠ 0 → status `conflict` untuk ditinjau (dengan kedua angka ditampilkan), bukan `synced`. Alternatif kebijakan: hormati harga saat antre untuk baris (snapshot harga per baris seperti dokumen lain) — tetapi itu keputusan produk yang harus eksplisit, bukan diam-diam seperti sekarang.

### POS1-05 · P2 · Pembayaran piutang tidak idempoten

**Bukti kode.** `payReceivable` (`pos.ts:2017-…`) tidak menerima kunci idempotensi (berbeda dengan `createSale` yang mewajibkannya, `pos.ts:488-493`), dan `payReceivableAction` tidak meneruskannya (`src/server/actions/pos.ts:428-463`). Penyisipan `party_payments` adalah SQL mentah tanpa kunci dedupe (`pos.ts:2101-2105`). Kunci baris penjualan menahan pembayaran MELEBIHI sisa, tetapi tidak menahan pengulangan pembayaran yang masih muat di sisa.

**Bukti probe (POS1-03).** Utang Rp100.000; dua panggilan **identik** `payReceivable(40.000, akun Kas, tanggal sama)` (pola retry/klik ganda): keduanya sukses — `party_payments` berisi **2 baris** (assert: `expected [ …(2) ] to have a length of 1 but got 2`), `paidTotal` = Rp80.000, jurnal penerimaan Dr Kas tercatat dua kali.

**Dampak.** Satu penerimaan fisik Rp40.000 tercatat Rp80.000: GL kas melebihi kas fisik (selisih kas misterius saat tutup sesi/rekonsiliasi bank), dan sisa piutang pelanggan menyusut dua kali — pelanggan ditagih lebih kecil dari utang sebenarnya. Jalur ini juga dipakai quick-entry FIFO A-12 (`receiveReceivableFifo` memanggil `payReceivable` yang sama), jadi permukaan gandanya mencakup Catat Transaksi.

**Arah perbaikan.** Tambahkan kunci idempotensi ujung-ke-ujung untuk pembayaran piutang (pola klaim `idempotencyKeys` yang sudah terbukti di checkout), diteruskan action dari klien; di domain, tolak/abaikan pengulangan kunci yang sama dengan mengembalikan pembayaran yang sudah tercatat.

### POS1-06 · P2 · Kredit Pelanggan dapat dicairkan menjadi tunai lewat retur

**Bukti kode.** Penyelesaian retur (`createSaleReturn`) ditentukan murni oleh `refundMethod` yang dipilih pemroses dan sisa piutang dokumen (`pos.ts:1761-1810`); komposisi pembayaran penjualan asal tidak pernah dibaca. Penjualan yang dibayar dengan metode `customer_credit` tercatat lunas (`paid` terakumulasi dari semua metode non-`credit`, termasuk kredit pelanggan), sehingga `outstanding = 0` dan seluruh nilai retur menjadi `excessPortion` yang boleh keluar sebagai kas.

**Bukti probe (POS1-10).** Penjualan A Rp100.000 tunai → retur metode kredit toko (liabilitas Kredit Pelanggan Rp100.000) → penjualan B Rp100.000 dibayar **penuh** dengan kredit itu (kas masuk Rp0) → retur B metode **tunai** → mutasi laci **`refund −Rp100.000`** tercatat (assert: `expected [ -100000 ] to deeply equal []`).

**Dampak.** Liabilitas non-tunai yang lahir dari D-12 (voucher retur — sengaja dirancang BUKAN uang) dapat diubah menjadi uang tunai laci dalam dua langkah transaksi biasa. Selain vektor pencairan, ini merusak rekonsiliasi sesi: laci mengeluarkan kas untuk penjualan yang tidak pernah memasukkan kas. Jalur yang sama berlaku untuk pembayaran QRIS/transfer yang diretur tunai (kas keluar dari laci sementara uangnya berada di akun QRIS/bank) — dampaknya lebih kecil tetapi semantiknya sama: metode refund mengabaikan tender asal.

**Arah perbaikan.** Penyelesaian retur mengikuti komposisi pembayaran asal: porsi yang dibayar tunai boleh refund tunai; porsi kredit pelanggan kembali menjadi kredit pelanggan; porsi non-tunai kembali ke akun metode asalnya (atau minimal larang refund tunai melebihi porsi tunai yang diterima dokumen asal).

### POS1-07 · P2 · `customerId` lintas tenant diterima pada penjualan lunas

**Bukti kode.** Di `createSale`, keberadaan & kepemilikan pelanggan hanya diperiksa di blok piutang (`pos.ts:795-805`, itupun hanya bila `receivable > 0`). Untuk penjualan lunas, `input.customerId` ditulis apa adanya ke `sales.customerId` tanpa satu pun kueri kepemilikan. FK database hanya membuktikan baris pelanggan itu **ada di suatu perusahaan**; RLS tidak menilai kolom referensi baris yang disisipkan.

**Bukti probe (POS1-08).** Penjualan tunai Rp10.000 di perusahaan fixture dengan `customerId` milik tenant `…d601` → **terposting** (assert penolakan gagal). Dokumen penjualan kini menunjuk pelanggan perusahaan lain; nama pelanggan tidak akan pernah tampil benar di perusahaan penjual (gabungan RLS menyembunyikannya), dan setiap agregasi per pelanggan membawa referensi yatim lintas-tenant.

**Dampak.** Integritas referensial multi-tenant bocor di jalur tulis utama POS; request langsung (atau bug klien) dapat menanam referensi asing yang mengotori laporan dan riwayat. Penjualan kredit kebal karena memvalidasi — inkonsistensinya sendiri adalah petunjuk bahwa validasi lunas tertinggal, bukan keputusan desain.

**Arah perbaikan.** Bila `customerId` terisi, validasi selalu (ada & milik perusahaan ini) di awal `createSale`, tanpa memandang komposisi pembayaran.

### POS1-08 · P3 · Metode pembayaran tanpa akun: checkout gugur sebagai "jurnal tidak seimbang"

**Bukti kode.** `paymentMethods.accountId` nullable di skema (`src/db/schema.ts:331`). Di `createSale`, kaki debit jurnal dibangun hanya dari pembayaran yang `accountId`-nya terisi (`pos.ts:1013-1017`) — pembayaran lewat metode tanpa akun hilang dari jurnal secara senyap sampai `postJournal` menolak ketidakseimbangan di ujung transaksi.

**Bukti probe (POS1-05).** Metode tunai dengan `accountId = null`; checkout Rp10.000 → ditolak dengan pesan **`Jurnal tidak seimbang. Debit 6000.00 vs kredit …`** (kaki HPP saja yang tersisa di sisi debit) — bukan pesan bahwa metode pembayaran belum memiliki akun penampung.

**Dampak.** Fail-closed (tidak ada data korup), tetapi jebakan konfigurasi: satu metode yang dibuat tanpa akun (UI CRUD A-8.2 mengizinkan?) membuat setiap checkout-nya gugur dengan pesan akuntansi yang tidak dapat ditindaklanjuti kasir, sesudah seluruh alur pembayaran dilalui.

**Arah perbaikan.** Validasi di awal `createSale`: metode terpakai wajib memiliki `accountId` → pesan "Metode X belum memiliki akun penampung…". Sekalian tegakkan `accountId` wajib saat metode pembayaran dibuat/diaktifkan di Pengaturan.

### POS1-09 · P3 · Penjualan Rp0 gugur karena jurnal

**Bukti kode & probe (POS1-04).** Produk `salePrice = 0` (track stok, biaya 0), checkout tanpa pembayaran: seluruh kaki jurnal bernilai 0, `postJournal` menyaring baris nol lalu menolak — penjualan gugur dengan **`AppError: Jurnal minimal memiliki dua baris…`** dan tidak ada penjualan yang tercatat sama sekali (stok pun tidak bergerak).

**Dampak.** Barang gratis/bonus berharga jual 0 tidak dapat dijual lewat POS sama sekali, dengan pesan eror internal akuntansi di wajah kasir. (Diskon 100% atas produk berharga > 0 tidak terkena: kaki diskon vs pendapatan tetap terbit.)

**Arah perbaikan.** Tangani dokumen bernilai nol secara eksplisit: izinkan penjualan total 0 tanpa jurnal (atau jurnal dilewati dengan penanda), dengan pesan/domain yang disengaja — bukan kegagalan turunan dari validasi jurnal.

### POS1-10 · P3 · Basis penilaian ambang diskon melemahkan penjaga supervisor

**Bukti kode.** Sejak T3R-6, persen diskon manual dinilai terhadap **bruto harga normal** (`pos.ts:370-380`): `percent = manualDiscount / gross`. Diskon manual dihitung dari harga kelompok, jadi pada produk yang harga kelompoknya ekstrem kecil, tindakan manual terbesar sekalipun (100%) ternilai kecil.

**Bukti probe (POS1-06).** Produk Rp100.000; aturan kelompok harga tetap **Rp500**; kasir **tanpa** izin `pos.discount` memberi diskon manual **100%** (baris menjadi Rp0): `quoteCart` lolos, `manualDiscountOverride = null` (assert: `expected null not to be null`) — tidak ada penolakan, tidak ada baris audit override.

**Dampak.** Terbatas (memerlukan aturan harga kelompok ekstrem yang dibuat manajer), tetapi semantik penjaganya terbalik dari sudut fraud: yang dijaga seharusnya *tindakan manual kasir* (meng-nol-kan sisa harga yang masih harus dibayar pelanggan kelompok: Rp500 → Rp0 adalah diskon manual 100% atas harga transaksi aktual), bukan proporsinya terhadap harga normal yang sudah didiskon kelompok. Komentar T3R-6 menyebut penilaian ini "konservatif" — terbukti konservatif hanya untuk menghindari false-positive, bukan untuk menahan fraud.

**Arah perbaikan.** Nilai ambang dari harga yang benar-benar dibayar sebelum diskon manual (harga kelompok): persen manual = manualDiscount / (qty × groupUnitPrice); pertahankan penilaian bruto sebagai informasi tambahan di audit.

### POS1-11 · P3 · Jatuh tempo lampau diterima

**Bukti probe (POS1-07a).** Penjualan utang dengan `dueDate = kemarin` **terposting** (assert penolakan gagal). Piutang lahir sudah lewat tempo: aging menampilkannya tertunggak sejak hari pertama, pengingat penagihan & perhitungan keterlambatan (FIX-P1 "Terlambat N hari") langsung menyala untuk utang yang baru dibuat — dan tidak ada cara membedakan salah ketik tanggal dari utang yang sungguh lama. `createSale` hanya memeriksa keberadaan `dueDate` (`pos.ts:787-793`), tidak pernah hubungannya dengan `date`.

**Arah perbaikan.** Tolak `dueDate < date` untuk penjualan utang baru (atau wajibkan alasan eksplisit bila memang mencatat utang historis).

### POS1-12 · P3 · Pembayaran piutang bertanggal sebelum penjualan

**Bukti probe (POS1-07b).** `payReceivable` dengan tanggal **3 hari sebelum** tanggal penjualan **diterima** dan terposting (assert penolakan gagal) — jurnal penerimaan mendahului jurnal penjualannya; laporan arus kas & aging berbasis tanggal dokumen menjadi tidak kronologis. `postJournal` hanya menegakkan periode terbuka, bukan kewajaran urutan dokumen.

**Arah perbaikan.** Di `payReceivable`: tolak `date < sale.date`. (Keluarga yang sama: `createSale` menerima `input.date` masa depan tanpa pemeriksaan — jurnal bertanggal mendatang terposting selama periode tahun berikutnya sudah termaterialisasi. TERBUKTI dari pembacaan kode; tidak diprobe.)

### POS1-13 · P3 · Sesi kas dibaca tanpa kunci di checkout (balapan tutup vs jual)

**Bukti kode.** `createSale` memilih sesi terbuka dengan SELECT biasa tanpa `FOR UPDATE` (`pos.ts:579-593`), sedangkan `closeCashSession` mengunci baris sesi (`pos.ts:2223-…`). Di antara pembacaan "open" oleh checkout dan penyisipan mutasi kasnya, penutupan dapat commit: checkout kemudian menulis penjualan + mutasi `sale` ke sesi yang sudah tertutup. `expectedCash` tersimpan (snapshot saat tutup) tidak berubah, tetapi halaman riwayat sesi menghitung ulang agregat dari `cash_movements` (A-8.3), sehingga riwayat dan snapshot dapat berbeda tanpa penjelasan.

**Status.** TERBUKTI dari pola kode (tidak ada kunci/cek ulang status di dalam transaksi yang sama); **TIDAK-TERUJI runtime** — jendela balapannya berada di tengah satu panggilan domain tanpa titik sangkut deterministik untuk probe. Bandingkan `voidSale` yang justru menangani persis risiko ini untuk mutasi refund (T3R-2).

**Arah perbaikan.** Kunci baris sesi (`FOR UPDATE`) di `createSale` sesudah memilihnya, atau tegakkan di level data (trigger/cek status saat insert mutasi kas). Bila kunci diambil, serialisasi terhadap `closeCashSession` menjadi eksplisit.

---

## TERBUKTI-BENAR (diverifikasi dengan probe angka baru)

1. **Rekonsiliasi emas penjualan campuran (POS1-11, LULUS).** Skenario baru: 2 × Rp111.000 (PPN 11% inklusif), aturan kelompok −10%, pembulatan perusahaan `up_500`, split tunai 100.000 / QRIS 50.000 / utang 50.000. Semua cocok persis: dokumen (bruto 222.000; diskon 22.200; PPN 19.800; pembulatan +200; total 200.000; paidTotal 150.000; status partial), kaki jurnal per akun (Kas Dr 100.000; QRIS Dr 50.000; Piutang Dr 50.000; Diskon Dr 22.200; Pendapatan Cr 202.200; PPN Cr 19.800; Pembulatan laba Cr 200; HPP Dr 120.000; Persediaan Cr 120.000; ΣDr = ΣCr), mutasi sesi hanya +100.000 (porsi tunai), stok 10 → 8, dan delta GL per akun persis sebesar kaki-kaki itu.
2. **Void membalik penerimaan piutang (POS1-12, LULUS — FIX-P1 AK3-01 terverifikasi ulang dengan angka baru).** Utang 100.000 → bayar 40.000 (GL piutang +60.000) → void: GL piutang & kas kembali persis ke posisi awal, `party_payments` berstatus void, `paidTotal` 0, stok pulih penuh.
3. **Idempotensi checkout konkuren (POS1-13a, LULUS).** Dua checkout bersamaan, kunci sama: keduanya menerima penjualan yang sama, tepat 1 baris penjualan, stok berkurang satu kali (klaim kunci POS-IDEM-01 bekerja di bawah konkurensi nyata, bukan hanya replay sekuensial).
4. **Balapan stok terakhir (POS1-13b, LULUS).** Stok 5, dua checkout bersamaan @5: tepat satu lolos, stok akhir 0, tidak ada oversell (kunci baris `stock_on_hand` di `applyStockMovement` efektif).
5. **Offline arah naik aman (POS1-02b, LULUS).** Harga naik sesudah antre → item `failed`, tidak ada penjualan, masuk daftar peninjauan — tidak dipaksakan.
6. **Klaim penutupan audit lama** — 61/61 test pada 8 berkas POS lama hijau (lihat pembuka), termasuk retur konkuren POS-RET-01, penebusan kredit konkuren D-12, FEFO & batch kedaluwarsa, kepemilikan sesi POS-SES-01, dan penjualan utang D-19 ujung-ke-ujung.

## TIDAK-TERUJI (dinyatakan eksplisit, tanpa klaim)

- **Lapisan UI/terminal** (di luar lingkup domain audit ini): balapan scanner barcode (POS-SCAN-01 lama), render nota & kembalian campuran di layar, persistensi keranjang — wilayah audit POS-2.
- **Balapan tutup-sesi vs checkout (POS1-13)** pada runtime — hanya bukti kode.
- **Offline POS di browser sungguhan** — tetap NOT TESTED sejak SIM-2 (acceptance manual); probe ini hanya menguji domain sinkronisasinya.
- **Produk nomor seri di POS** — tidak diprobe ulang di sini; cakupannya ada di test SIM-2 (tidak dijalankan pada audit ini).
- **Akumulasi pembulatan retur parsial pecahan** (mis. retur 1/7 berulang): jurnal per dokumen selalu seimbang karena porsi dihitung dari basis yang sama (pola FIX-P1 AK4-01); drift kumulatif terhadap nilai baris asal berskala ≤ pecahan sen — dinilai dapat diabaikan, tidak diprobe.
- **Penjualan berdiskon kelompok + retur silang gudang / retur penjualan `held`** — status `held` ditolak jalur retur secara kode (`sale.status !== "completed"`); tidak diprobe karena bukan jalur uang yang aktif.

## Urutan perbaikan yang disarankan

1. **POS1-01** — agregasi/dedupe baris retur (satu perubahan kecil, kerugian uang langsung).
2. **POS1-03** — plafon setoran terhadap saldo laci sesi (menutup fabrikasi saldo bank).
3. **POS1-02** — kunci per pelanggan untuk batas kredit.
4. **POS1-05** — kunci idempotensi pembayaran piutang (pola sudah ada di checkout).
5. **POS1-04** — `expectedTotal` di payload offline + status conflict untuk selisih harga.
6. **POS1-06** — penyelesaian retur mengikuti tender asal.
7. **POS1-07** — validasi pelanggan selalu. Lalu P3 sesuai antrean.
