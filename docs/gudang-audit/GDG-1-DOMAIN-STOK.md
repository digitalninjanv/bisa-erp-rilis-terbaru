# Audit Adversarial Gudang GDG-1 — Domain & Kebenaran Stok/AVCO

**Tanggal:** 2026-11-04 · **Auditor:** agen GDG-1 (baca-saja; satu-satunya berkas yang ditulis adalah laporan ini) · **HEAD saat audit:** `740fba1`
**Sikap:** anggap semua salah sampai terbukti benar dengan angka.
**Metode:** 26 probe integrasi berskenario angka BARU di perusahaan fixture khusus `01900000-…-b701` (transaksi rollback; probe konkurensi memakai transaksi commit nyata di fixture yang sama; assert ditulis sebagai perilaku BENAR, sehingga test gagal = bukti temuan dan test lulus = bukti benar). Berkas probe dihapus sesudah dijalankan; hasil lariannya dikutip verbatim di bawah. Perusahaan demo `…-0001` tidak ditulis sama sekali.
**Hasil larian probe final:** 26 probe → **19 lulus (TERBUKTI-BENAR) · 7 gagal (TERBUKTI-SALAH)**. Dua temuan tambahan dibuktikan dari bentuk API/kode (GDG1-07, GDG1-09 didukung probe fakta G3).

**Ringkasan temuan: P0: 0 · P1: 2 · P2: 5 · P3: 2 (9 temuan).**

Fondasi terbukti kuat: AVCO global dua gudang, void penerimaan dengan hitung ulang biaya dari ledger, gerbang PO, penjaga void, tanda penyesuaian, gerbang persetujuan maker-checker, invariant batch sesudah rangkaian campur, FEFO & blokir jual kedaluwarsa, seri anti-jual-ganda, dan penyelesaian campuran retur semuanya lulus probe angka baru. Yang patah terkonsentrasi di **tepi-tepi muda**: retur pemasok × nomor seri, asal-usul retur, isi ulang AVCO dari stok negatif, dan balapan reservasi.

---

## 1. Temuan TERBUKTI-SALAH

### GDG1-01 (P1) — Retur pembelian tidak memeriksa asal-usul barang: retur 40 unit ke pemasok yang hanya pernah menjual 5 unit TERPOSTING dan menciptakan Kredit Pemasok fiktif Rp350.000

- **Bukti kode:** `createSupplierReturn` (`src/server/supplier-returns.ts:380`) memvalidasi `receiptLineId` hanya bila diisi (produk & pemasok cocok), tetapi **tidak ada plafon kumulatif** qty retur ≤ qty yang pernah diterima dari pemasok itu — per produk maupun per baris penerimaan. `postSupplierReturn` (`:562`) mengalokasikan NILAI retur (pada AVCO berjalan) secara FIFO ke seluruh utang terbuka pemasok, dan kelebihannya menjadi `creditAmount` ke akun 1210 Kredit Pemasok (`:706-716`).
- **Bukti probe (H1):** pemasok A2 hanya menjual 5 unit @Rp10.000 (utang Rp50.000); pemasok B2 menjual 50 unit produk yang sama. Retur **40 unit ke A2** → hasil terukur: `posted credit=350000.0000 payable=50000.0000`. Utang A2 terpotong penuh dan perusahaan membukukan klaim Rp350.000 kepada pemasok yang tidak pernah mengirim barang itu.
- **Dampak:** klaim kredit pemasok adalah aset nyata yang bisa diselesaikan sebagai refund tunai (`refundSupplierReturn`) atau potong pembelian berikutnya — kesalahan input (salah pilih pemasok) atau kecurangan staf langsung menjadi uang keluar. Subledger utang pemasok lain ikut terpotong oleh barang yang bukan miliknya.
- **Arah perbaikan:** tegakkan plafon provenance di domain: Σ qty retur terposting per (pemasok, produk) ≤ Σ qty diterima dari pemasok itu − Σ qty retur sebelumnya (atau wajibkan `receiptLineId` dan plafon per baris penerimaan, pola plafon `replaceable` yang sudah ada di `receiveReplacement`). Retur tanpa asal (mis. stok awal) perlu jalur eksplisit beralasan, bukan jalan bebas.

### GDG1-02 (P1) — Isi ulang stok dari posisi NEGATIF mereset AVCO ke harga isi ulang; subledger persediaan menyimpang permanen dari GL (probe: selisih Rp50.000)

- **Bukti kode:** blend di `applyStockMovement` (`src/server/inventory.ts:160-191`): bila `globalBefore <= 0`, rumus tertimbang dilewati dan `costPrice` disetel = biaya masuk (`newCost = d(input.unitCost)`). Padahal lubang negatif membawa nilai pada AVCO lama: penjualan negatif sudah mengkredit persediaan di GL sebesar AVCO lama.
- **Bukti probe (I1):** perusahaan dengan `allowNegativeStock=true`; jual 5 unit dari stok 0 pada AVCO Rp10.000 (stok −5, GL persediaan −Rp50.000), lalu terima 10 @Rp20.000 → stok 5. Nilai ledger gerakan terbukti Rp150.000 (−5×10.000 + 10×20.000) dan delta GL persediaan terbukti Rp150.000 — keduanya lulus assert. Tetapi `costPrice` akhir = **Rp20.000** (assert mengharapkan Rp30.000): valuasi subledger 5 × 20.000 = Rp100.000 ≠ GL Rp150.000. Selisih Rp50.000 tidak pernah terkoreksi oleh gerakan berikutnya.
- **Dampak:** hanya pada perusahaan yang mengaktifkan stok negatif (konfigurasi yang didukung resmi) — tetapi di sana laporan nilai persediaan (qty × costPrice) dan HPP penjualan sesudahnya salah diam-diam, persis jenis drift yang diperbaiki FIX-P1 untuk jalur void (AK4-06) tetapi tersisa di jalur isi ulang dari negatif.
- **Arah perbaikan:** rumus tertimbang harus tetap berlaku saat `globalBefore < 0 < globalAfter`: `(globalBefore × costPriceLama + delta × unitCost) / globalAfter` — dengan angka probe: (−5×10.000 + 10×20.000)/5 = Rp30.000, cocok dengan kuotien ledger yang dipakai `recomputeCostFromLedger`. Kasus `globalAfter <= 0` tetap pengecualian.

### GDG1-03 (P2) — Void retur pembelian produk SERIAL mengembalikan qty stok tetapi serinya tetap "out" selamanya

- **Bukti kode:** `postSupplierReturn` mengeluarkan seri lewat `pickSerialsOut` (`src/server/supplier-returns.ts:695`), tetapi `voidPostedSupplierReturn` (`:904`) hanya memulihkan batch (`creditBatchById`) dan gerakan stok — **tidak ada pemulihan seri sama sekali** di seluruh fungsi (bandingkan `voidSale`/`voidReceipt` yang memanggil `restoreSerialsForSale`/`voidSerialsForReceipt`).
- **Bukti probe (F2):** terima 3 unit serial SN-A/B/C → retur 1 terposting (stok 2) → void retur (stok kembali 3). Seri berstatus `in_stock` terukur = **2**, bukan 3. Unit ketiga menjadi stok hantu: qty ada, tetapi tidak ada seri yang bisa dipilih kasir untuk menjualnya, dan invariant jumlah seri hidup = `stock_on_hand` patah tanpa pesan apa pun.
- **Arah perbaikan:** pada void retur, pulihkan seri yang gerakan keluarnya ber-`referenceId` = retur itu (pola `restoreSerialsForSale` dengan referensi `supplier_return`), sesudah penjaga resolusi yang sudah ada.

### GDG1-04 (P2) — Barang pengganti (replacement) produk SERIAL masuk stok tanpa nomor seri — unit pengganti tidak bisa dijual

- **Bukti kode:** `receiveReplacement` (`src/server/supplier-returns.ts:1334`) — baris inputnya hanya `{ returnLineId, qty, batchNumber, expiryDate }`; **tidak ada `serialNumbers`** dan tidak ada pemanggilan `registerSerialsIn`. Pilihan produknya bahkan tidak membaca `trackSerial`. Jalur penerimaan biasa menolak stok masuk serial tanpa daftar seri (`applyDocumentMovement`, `inventory.ts:222-229`), jalur pengganti ini melewatinya diam-diam.
- **Bukti probe (F3):** beli tunai 2 unit serial, retur 1 (klaim kredit Rp9.000 persis), terima pengganti 1 → stok kembali 2, tetapi seri `in_stock` terukur = **1**, bukan 2.
- **Dampak:** sama seperti GDG1-03 — stok hantu tak terjual + invariant seri patah; terjadi pada alur bisnis normal (bukan koreksi), jadi akan sering kena di pemakai produk serial.
- **Arah perbaikan:** wajibkan `serialNumbers` per unit untuk produk `trackSerial` pada `receiveReplacement` (validasi jumlah = qty, unik, belum pernah diterima — persis aturan `createReceipt`) dan daftarkan lewat `registerSerialsIn` tertaut ke dokumen retur.

### GDG1-05 (P2) — `receiveReplacement` menerima baris `returnLineId` GANDA: satu baris retur diganti dua kali lipat, kolom `replacedQty` bahkan menutupinya

- **Bukti kode:** `receiveReplacement` (`src/server/supplier-returns.ts:1383-1413`): plafon per baris dihitung dari snapshot `returnLine.replacedQty` yang dibaca SEKALI sebelum loop; dua baris input dengan `returnLineId` sama sama-sama lulus plafon dari snapshot yang sama. Penulisan baliknya pun memakai snapshot basi yang sama (`d(item.returnLine.replacedQty).plus(item.qty)`), sehingga `replacedQty` akhir tertulis 5 — bukan 10 — menyembunyikan kelebihan itu dari data.
- **Bukti probe (H2):** retur dua produk A & B masing-masing 5 @Rp10.000 (klaim Rp100.000). `receiveReplacement` dengan dua baris untuk baris A (5 + 5) → hasil terukur: `posted replacedQty=5.0000 stokA=10`. Stok A kembali 10 unit padahal hanya 5 yang diretur; klaim milik baris B terkonsumsi barang A; B tidak pernah diganti tetapi klaim habis.
- **Arah perbaikan:** agregasikan qty pengganti per `returnLineId` sebelum plafon (pola R-4 agregasi per produk di `lockPurchaseOrderForReceipt`), atau perbarui snapshot berjalan di dalam loop; tulis `replacedQty` secara inkremental dari nilai terbaru.

### GDG1-06 (P2) — Balapan reservasi: dua reservasi konkuren sama-sama lolos, total tereservasi 16 atas stok 10

- **Bukti kode:** `createReservation` (`src/server/reservations.ts:44-110`) membaca `stock_on_hand` dan `getReservedQuantities` **tanpa kunci baris** (`FOR UPDATE`) dan tanpa constraint penopang; pemeriksaan ketersediaan dan penyisipan tidak atomik terhadap transaksi lain.
- **Bukti probe (G2):** stok 10; dua `createReservation` 8 + 8 dalam `Promise.all` pada transaksi nyata terpisah → terukur: `{ succeeded: 2, reservedTotal: '16' }`.
- **Dampak:** stok yang bisa dijual (on-hand − reserved, ditegakkan POS per probe G1) menjadi negatif secara logis; penjualan sah ikut tertolak dan janji ke pelanggan ganda tidak bisa dipenuhi dua-duanya.
- **Arah perbaikan:** kunci baris `stock_on_hand` (produk × gudang) di awal `createReservation` — pola `lockStockQty`/`lockOnHandQty` yang sudah dipakai opname & batch — lalu hitung ketersediaan di dalam kunci.

### GDG1-07 (P2) — Transfer dua tahap tidak punya penerimaan SEBAGIAN/selisih: barang hilang di jalan tidak bisa dicatat

- **Bukti kode:** `receiveTransfer` (`src/server/inventory.ts:1599`) berinput hanya `{ companyId, userId, documentId, date }` — tanpa qty per baris; ia selalu mengkreditkan gudang tujuan sebesar qty terkirim penuh (dari baris dokumen / gerakan keluar). Skema aksinya sama (`src/server/actions/reservations.ts:90-95`: hanya `documentId` + `date`). Tidak ada status/jalur "diterima sebagian" atau "selisih perjalanan".
- **Dampak:** kehilangan/kerusakan di perjalanan hanya bisa ditangani dengan (a) menerima penuh lalu penyesuaian keluar di tujuan — dokumen penerimaan berbohong dan selisih tercatat sebagai kehilangan di gudang tujuan, bukan di perjalanan; atau (b) void seluruh transfer — barang yang benar-benar tiba ikut kembali secara data. Jejak akuntabilitas pengiriman hilang.
- **Arah perbaikan:** terima `lines: { productId, receivedQty }` opsional pada `receiveTransfer` (bawaan = penuh); selisih (terkirim − diterima) ditulis sebagai gerakan keluar bertipe selisih perjalanan dengan jurnal ke akun selisih stok dan dokumen tetap tertelusur (status `posted` dengan penanda selisih), seri/batch mengikuti irisan yang diterima.

### GDG1-08 (P3) — Domain `createTransfer` tidak memvalidasi tanda qty: qty −4 memindahkan stok MUNDUR (tujuan → asal) dalam dokumen yang menyatakan sebaliknya

- **Bukti kode:** `createTransfer` (`src/server/inventory.ts:1409`) tidak memeriksa `qty > 0` per baris (dan tidak menolak baris duplikat); leg keluar memakai `d(line.qty).neg()` dan leg masuk memakai qty apa adanya. Asimetris dengan `createReceipt` yang memvalidasi qty di level domain secara eksplisit (komentar R-9: "direct domain callers cannot sneak").
- **Bukti probe (C2):** asal kosong, tujuan berisi 10; `createTransfer` A→B qty **−4** → terukur stok akhir `4/6`: asal BERTAMBAH 4, tujuan BERKURANG 4 — arah fisik terbalik dari dokumen.
- **Batas jujur:** jalur UI/aksi aman — skema aksi mewajibkan `amountField(..., "positive")` (`src/server/actions/inventory.ts:520`). Yang terbuka hanya pemanggil domain langsung (modul lain/test/masa depan). Karena proyek menetapkan domain sebagai lapisan kebenaran, celah ini tetap dicatat.
- **Arah perbaikan:** tolak `qty <= 0` per baris di `createTransfer` (pesan per produk seperti penerimaan), agregat/tolak produk duplikat.

### GDG1-09 (P3) — Reservasi tanpa `expiresAt` mengunci stok selamanya dan tidak ada jalur pemenuhan: pemegang reservasi pun tidak bisa membeli barangnya sendiri tanpa melepas manual

- **Bukti kode + probe:** `createReservation` menerima `expiresAt: null`; `getReservedQuantities` (`src/server/reservations.ts:112`) menghitung reservasi aktif tanpa kedaluwarsa tanpa batas waktu. Probe G3: reservasi tanpa kedaluwarsa atas 6 unit masih dihitung penuh oleh `getReservedQuantities` pada tanggal baca **2031-01-01** (5 tahun kemudian). Tidak ada fungsi consume/fulfil di `reservations.ts` — hanya `releaseReservation` manual; reservasi juga tidak tertaut ke pelanggan/dokumen penjualan. Probe G1 membuktikan checkout atas qty yang direservasi ditolak (`INSUFFICIENT_STOCK`) — termasuk untuk pembelian yang menjadi alasan reservasi itu dibuat; kasir wajib melepas reservasi dulu secara manual, langkah yang mudah terlupa dan tidak dituntun UI mana pun dari layar penjualan.
- **Dampak:** stok terjual menyusut permanen oleh reservasi yatim; alur jual atas reservasi berbelit. Bukan kebocoran angka (ledger tidak tersentuh), murni desain lifecycle.
- **Arah perbaikan:** bawaan `expiresAt` wajib (mis. dari pengaturan perusahaan, mis. 7 hari) dengan peringatan daftar reservasi menua; sediakan pemenuhan: checkout dapat menyebut `reservationId` sehingga qty reservasi itu dikonsumsi atomik oleh penjualan.

---

## 2. TERBUKTI-BENAR (probe GDG-1, skenario angka baru)

| # | Klaim yang diuji | Bukti probe |
|---|---|---|
| A1 | AVCO global antar-gudang (klaim tutup audit lama P1-2) | 10@4.000 di A + 10@8.000 di B → `costPrice` persis 6.000 |
| A2 | Void penerimaan menghitung ulang AVCO dari ledger sisa (FIX-P1 AK4-06b) | 10@5.000 + 10@9.000 (AVCO 7.000) → void penerimaan kedua → stok 10, AVCO kembali 5.000, delta GL persediaan persis Rp50.000 |
| A3 | Konkurensi blend AVCO dua gudang | Dua penerimaan bersamaan (transaksi nyata, `Promise.all`) 10@4.000 & 10@12.000 di gudang berbeda, 4 percobaan → AVCO akhir 8.000 di 4/4 percobaan. **Catatan risiko sisa:** blend membaca `products.costPrice` tanpa kunci baris produk (`inventory.ts:160-191`); kebenaran empiris 4/4 bukan bukti struktural — jendela balapan teoretis tetap ada bila interleave lebih rapat. |
| B1 | Gerbang PO: parsial, pemasok salah, penerimaan berlebih | PO 30: terima 12 ✓; pemasok lain ditolak; terima 19 ditolak "melebihi sisa"; terima 18 ✓ → stok 30 |
| B2 | Penerimaan 3 skenario (tunai vs kredit) | Tunai 4@6.000: ΔUtang 0, ΔKas −24.000; kredit: ΔUtang −24.000 (kredit) persis |
| B3 | Void penerimaan yang stoknya sudah terpakai ditolak | Terima 10, jual 4 → void ditolak menyebut sisa; stok tetap 6 |
| C1 | Transfer dua tahap dasar | Kirim 20: asal 0, tujuan 0 (in-transit); terima → tujuan 20 |
| C3 | Void transfer in-transit | Stok asal pulih utuh 9, tujuan 0 |
| D1 | Tanda penyesuaian ditegakkan server (klaim tutup P0-1 lama) | "Rusak 3" qty positif → stok 10→7, ΔBeban Rusak +15.000 pada AVCO 5.000, ΔGL persediaan konsisten |
| D2 | Opname campuran tanda: jurnal neto | Lebih 6 & kurang 6 @5.000 seproduk berbeda → stok per produk tepat (16/4), GL persediaan tidak berubah (neto 0 memang benar) |
| D3 | Gerbang persetujuan penyesuaian (maker ≠ checker, posting tepat sekali) | Nilai 20.000 > ambang 10.000 → pending tanpa gerakan; maker menyetujui → ditolak FORBIDDEN; checker lain → terposting sekali (stok 10→6); persetujuan kedua ditolak |
| D4 | Penyesuaian keluar melebihi stok ditolak | Minta 8 dari stok 5 → INSUFFICIENT, stok tetap 5 |
| E1 | Invariant batch Σ = on_hand sesudah rangkaian campur | Terima 2 batch (6+6) → jual FEFO 4 → retur pemasok 2 → opname ke 5 → on_hand 5 = Σ batch 5 |
| E2 | Batch kedaluwarsa tidak terjual; jalur koreksi bisa mengeluarkannya | Stok segar 3 + kedaluwarsa 8: jual 4 ditolak menyebut kedaluwarsa; jual 3 ✓; penyesuaian `expired` 8 ✓ → stok & Σ batch 0 |
| F1 | Seri: duplikat ditolak, jual ganda ditolak | Seri sama di penerimaan kedua ditolak "sudah pernah diterima" (dan savepoint membuktikan stok tidak bertambah); SN yang sudah terjual ditolak "tidak tersedia"; stok akhir 1 |
| G1 | Reservasi benar-benar menahan ketersediaan POS | Stok 10 direservasi 10 → checkout 10 ditolak; stok fisik tetap 10 |
| H3 | Penyelesaian campuran retur (refund + potong utang) | Klaim 60.000: refund 25.000 + terapkan 35.000 ke utang baru 40.000 → sisa klaim 0, status `resolved`, ΔKredit Pemasok 0, ΔUtang −5.000 persis |
| I2 | Stok negatif konsisten saat pengaturan mati | Stok 3, jual 4 → ditolak, stok tetap 3 |

**Terverifikasi oleh suite eksisting (dibaca, tidak di-probe ulang):** balapan dua checkout memperebutkan stok terakhir & dua opname konkuren (`tests/integration/warehouse-race.test.ts`); FEFO dasar, retur penjualan kembali ke batch asal, batch sisa "Tanpa batch" (`tests/integration/stock-batches.test.ts`); retur penjualan memotong piutang & plafon anti-kelebihan retur (`tests/integration/pos-returns.test.ts`, `fix-p1-retur-void.test.ts`); produk `trackStock=false` tidak digerakkan POS (`tests/integration/inventory-p1.test.ts`).

## 3. TIDAK-TERUJI (dinyatakan eksplisit, tanpa klaim)

- **Transfer dua tahap untuk produk batch & serial** — jalur kode ada (`receiveTransfer` memulihkan irisan batch dari gerakan keluar; seri lewat `shipSerialsForTransfer`/`receiveSerialsForTransfer`) tetapi probe C1/C3 memakai produk polos; kombinasi batch/serial × in-transit × void belum dibuktikan angka.
- **Void transfer SATU tahap yang sudah diterima penuh** (kedua leg terposting) — kode `voidStockDocument` mencerminkan semua gerakan ber-referensi dokumen; tidak di-probe.
- **Retur penjualan POS untuk produk serial** (pemulihan seri via `restoreSerialsForSale` dengan qty sebagian berurutan) — dipercaya dari suite POS, tidak di-probe ulang di sini.
- **Konkurensi dua mutasi POS pada produk batch yang sama** (FEFO di bawah balapan) — kunci baris batch ada (`lockBatchRows FOR UPDATE`); tidak diuji balapan.
- **Konvensi tanggal kedaluwarsa:** batch yang kedaluwarsa HARI INI masih bisa dijual (`isExpired` = `expiry < asOf`, `batches.ts:38-40`) — pilihan definisi (hari kedaluwarsa = hari terakhir jual); dicatat sebagai observasi, bukan temuan.
- **Void penerimaan produk batch yang batch asalnya sudah terkonsumsi FEFO** — desain terdokumentasi mengambil limpahan dari batch lain (total stok benar, atribusi batch bergeser); tidak dinilai salah, tidak di-probe.
- **Impor produk (A-10) & Purchase Request maker-checker (SIM-2)** — di luar lingkup GDG-1 (domain stok); tidak disentuh.

## 4. Metode & integritas probe

- Fixture: perusahaan khusus `…b701` dengan bagan akun & pemetaan lengkap (18 akun, 17 pemetaan), 3 gudang (termasuk karantina), 2 pemasok, sesi kas terbuka — dibangun meniru pola `fix-r2-sisa-angka.test.ts`.
- Assert GL selalu berbentuk **delta** (saldo sebelum vs sesudah) dan assert stok/seri/batch selalu per produk — dua kegagalan larian pertama terbukti artefak harness (polusi GL dari probe konkurensi yang commit, dan sisa parsial penolakan tanpa savepoint), diperbaiki dan dijalankan ulang sampai setiap kegagalan tersisa murni perilaku produk. F1 secara khusus diverifikasi ulang dengan jejak gerakan mentah: penjualan serial yang benar menghasilkan tepat satu gerakan `sale −1`.
- Larian final yang dikutip: 26 probe, 19 lulus / 7 gagal — ketujuh kegagalan adalah assert perilaku-benar atas GDG1-01, 02, 03, 04, 05, 06, 08.
