# Audit Gudang GDG-3 — Lintas, Integrasi, Izin, Performa & Ketahanan

**Tanggal:** 2026-11-04 · **Jenis:** audit adversarial baca-saja + probe runtime · **Mandat:** A-17 (pola audit akuntansi diterapkan ke Gudang)
**Lingkup:** integrasi gudang↔akuntansi, izin peran `warehouse`, performa & skala gudang, ketahanan (konkurensi, dokumen ganda, impor duplikat/rusak).
**Di luar lingkup berkas ini:** domain & angka gudang murni (GDG-1), UI/UX gudang (GDG-2).

**Metode:** baca kode saat ini (`src/server/inventory.ts`, `supplier-returns.ts`, `purchase-requests.ts`, `purchasing.ts`, `reservations.ts`, `reports.ts`, `catalog.ts`, `actions/inventory.ts`, `actions/import.ts`, `lib/permissions.ts`) + **17 probe yang dijalankan** di `tests/integration/gdg3-audit-probe.test.ts` terhadap PostgreSQL 18 dev (perusahaan fixture khusus `…f701`/`…f702`; perusahaan demo tidak disentuh; skenario domain dalam transaksi rollback, probe konkurensi berkomit di perusahaan fixture sendiri) + verifikasi katalog RLS langsung ke DB + pengukuran waktu terukur. Suite lama yang relevan dijalankan ulang sebagai kontrol: **97/97 hijau** (adjustment-approval, inventory-void-import, goods-receipt, consistency, purchase-order, feature-matrix-gudang, stock-batches, inventory-p1, inventory-p2, fix-r2-sisa-angka).

**Ringkasan hitungan temuan cacat: P0: 0 · P1: 2 · P2: 8 · P3: 6** (16 temuan), ditambah 4 blok yang **TERBUKTI BAIK** dan tidak boleh "diperbaiki" tanpa alasan.

Catatan lingkungan: server PG18 dev sempat mati di awal sesi (smart shutdown tercatat di log 16:03 UTC) dan dihidupkan ulang mengikuti prosedur pemulihan proyek sebelum probe berjalan; tidak ada dampak ke hasil.

---

## 1. Temuan

### P1 — Tinggi

**GDG3-16. Dua commit bersamaan atas job impor yang sama menggandakan stok, tetapi jurnalnya terdedupe — GL dan subledger pecah Rp100.000 per batch.**
*Status: TERBUKTI (probe GDG3-16: `ok=2, stok=20, jurnalPembuka=1`).*
`commitImportBatchAction` membaca job tanpa kunci baris dan memilih baris `pending` tanpa klaim atomik (`src/server/actions/import.ts:667-733`). Dua pemanggil bersamaan (dua tab, retry paralel dari wizard) sama-sama memproses baris yang sama: mutasi stok awal diterapkan dua kali (+20 unit), tetapi jurnal saldo awal memakai `idempotencyKey: import:{jobId}:{barisPertama}` sehingga `postJournal` mendedupe-nya menjadi satu jurnal (+Rp100.000). Hasil akhir terukur: stok bernilai Rp200.000, GL persediaan hanya ter-kredit/debit Rp100.000 — invariant rekonsiliasi kontrol persediaan langsung selisih, tanpa error apa pun yang tampil (kedua commit melaporkan sukses).
*Dampak:* korupsi angka senyap pada jalur migrasi data — persis jalur yang dipakai saat onboarding pelanggan. Persistensinya teramati langsung: sesudah dua larian probe, rekonsiliasi kontrol perusahaan fixture menetap pada selisih −Rp200.000 (dua kejadian balapan × Rp100.000) yang tidak pernah sembuh sendiri.
*Arah perbaikan:* kunci baris job (`FOR UPDATE`) di awal commit, atau klaim baris secara atomik (`UPDATE … SET status='processing' … WHERE status='pending' RETURNING`), dan samakan perlakuan idempotensi mutasi stok dengan jurnalnya.

**GDG3-07. Penerimaan menerima `warehouseId` dan `supplierId` milik perusahaan lain tanpa validasi kepemilikan.**
*Status: TERBUKTI (probe GDG3-07: penerimaan perusahaan A terposting dengan gudang & pemasok perusahaan B; stok tercatat pada pasangan (perusahaan A, gudang B)).*
`createReceipt` memvalidasi produk per perusahaan dan akun pembayaran per perusahaan (pola AK-P1-02), tetapi tidak pernah memeriksa gudang maupun pemasok (`src/server/inventory.ts:347-360, 465-476`; satu-satunya query `warehouses` di berkas itu adalah resolusi gudang karantina yang memang ter-scope perusahaan). RLS tidak menolong: baris ditulis dengan `company_id` pemanggil, dan FK hanya memeriksa keberadaan gudang. Jalur dokumen lain (penyesuaian, transfer, opname) juga tidak memvalidasi gudang — hanya reservasi yang melakukannya (`reservations.ts:71-77`). Skema aksi hanya memeriksa format UUID.
*Dampak:* stok tercatat menggantung di gudang perusahaan lain (tidak terlihat benar di daftar stok kedua perusahaan), tag pihak jurnal menunjuk pemasok asing, dan daftar utang dapat menampilkan dokumen dengan pemasok yang bukan milik perusahaan. Pemicu realistis: ID basi/tertukar dari klien, bukan hanya serangan.
*Arah perbaikan:* validasi kepemilikan + status aktif gudang & pemasok di `createReceipt` (dan gudang di `createAdjustment`/`createTransfer`/`createOpname`), meniru validasi akun pembayaran yang sudah ada.

### P2 — Sedang

**GDG3-15. Berkas yang sama diimpor ulang sebagai job baru menggandakan stok awal dan jurnal modal — tanpa peringatan duplikat apa pun.**
*Status: TERBUKTI (probe GDG3-15: stok 10 → 20; dua jurnal `opening` untuk berkas yang sama).*
Tidak ada sidik berkas (hash isi/nama+ukuran) dan tidak ada pemeriksaan "berkas ini sudah pernah diimpor". Dengan opsi `updateExisting + importStock` (kombinasi sah di wizard), impor ulang menerapkan lagi gerakan `opening` per baris dan jurnal Dr Persediaan / Cr Modal kedua (`actions/import.ts:985-1010, 1090-1108`). Buku tetap seimbang — stok dan ekuitas sama-sama fiktif bertambah — sehingga rekonsiliasi tidak menangkapnya.
*Arah perbaikan:* simpan hash berkas pada job; saat unggah/commit, peringatkan (atau tolak) bila hash yang sama sudah ter-commit untuk perusahaan ini; tampilkan riwayat impor per berkas.

**GDG3-02. Dokumen gudang bertanggal periode tertutup lolos bila dokumennya tidak menjurnal.**
*Status: TERBUKTI (probe GDG3-02, empat sub-skenario).*
Penjaga periode hanya hidup di dalam `postJournal` (`assertPeriodOpen`). Kontrol positif: penerimaan bernilai pada 2026-03-15 (periode ditutup di fixture) **ditolak** dengan benar. Tetapi: (a) transfer — yang memang tidak pernah menjurnal — bertanggal periode tertutup **terposting dan memindahkan stok**; (b) opname yang selisihnya neto-nol antar produk bertanggal periode tertutup **terposting** (tidak ada jurnal → tidak ada penjaga); (c) penerimaan berharga nol (total 0 → jurnal dilewati, `inventory.ts:736`) bertanggal periode tertutup **menambah stok**.
*Dampak:* pembekuan periode tidak membekukan subledger stok; laporan & kartu stok berbasis tanggal dokumen dapat berubah di periode yang sudah ditutup, dan opname neto-nol dapat menyembunyikan susut/surplus bruto di dalam periode tertutup (lihat GDG3-05).
*Arah perbaikan:* panggil `assertPeriodOpen` secara eksplisit di awal `createTransfer`, `createOpname`, dan `createReceipt` (termasuk cabang total 0), bukan hanya secara tidak langsung lewat jurnal.

**GDG3-03. Rekonsiliasi kontrol persediaan menghasilkan selisih palsu sebesar nilai penuh dokumen untuk tanggal as-of lampau.**
*Status: TERBUKTI (probe GDG3-03: delta selisih persis +Rp1.000.000 untuk penerimaan backdated Rp1.000.000 terhadap baseline transaksi yang sama; delta per hari ini 0).*
Kaki GL memakai tanggal dokumen jurnal (`journal_entries.date ≤ asOf`), kaki subledger memakai `stock_movements.createdAt` (waktu posting) dan menilai qty dengan `products.costPrice` **berjalan** (`src/server/reports.ts:2596-2620`). Penerimaan backdated 30 hari yang diposting hari ini: per as-of 15 hari lalu GL memuat Rp1.000.000, subledger memuat Rp0. Catatan metode di UI menyebut perbedaan ini "selisih kecil yang bukan kesalahan posting" — terukur bisa 100% dari nilai dokumen. Risiko sebaliknya juga ada: selisih asli dapat tertutup oleh selisih metode yang sama besar.
*Arah perbaikan:* nilai subledger per tanggal dari ledger mutasi itu sendiri (Σ qty × unitCost per mutasi ≤ asOf berbasis tanggal dokumen sumber), atau batasi fitur ke as-of hari ini dengan label jujur; jangan tampilkan angka selisih lampau yang secara konstruksi pasti salah.

**GDG3-10. Gerbang persetujuan penyesuaian mati secara bawaan — penghapusan stok bernilai berapa pun langsung terposting oleh pembuatnya sendiri.**
*Status: TERBUKTI (probe GDG3-10: ambang fixture `null`; penyesuaian `damaged` 50 × Rp1.000.000 = Rp50.000.000 berstatus `posted` seketika, jurnal terbit, satu pengguna dari awal sampai akhir).*
Maker-checker penyesuaian (T5-3/D-17) hanya aktif bila perusahaan mengisi `adjustmentApprovalThreshold`; kolom itu nullable tanpa bawaan (`schema.ts:276`), dan tanpa ambang perilaku historis berlaku: dokumen langsung posted. Fitur keamanannya sendiri terbukti baik (suite `adjustment-approval` hijau; penolakan self-approve ditegakkan domain), tetapi **bawaan**-nya membuat jalur penyesuaian — termasuk tipe generik bertanda ± yang pada dasarnya koreksi stok bebas beralasan teks — tanpa peninjau kedua untuk nilai tak terbatas.
*Arah perbaikan:* beri bawaan ambang yang aman (mis. Rp0 = semua penghapusan menunggu persetujuan, perusahaan boleh menaikkan), atau wajibkan pemilihan sadar saat setup perusahaan; tampilkan status gerbang di Pengaturan.

**GDG3-04. Nomor faktur pemasok yang sama diterima dua kali tanpa peringatan — utang tercatat ganda.**
*Status: TERBUKTI (probe GDG3-04: dua penerimaan dengan `supplierInvoiceNumber` identik untuk pemasok yang sama; kredit utang gabungan Rp200.000).*
Tidak ada unique index maupun cek lunak atas (perusahaan, pemasok, nomor faktur) di `createReceipt` maupun skema (`schema.ts:793` kolom teks polos). Ini vektor klasik pembayaran ganda AP: faktur yang sama diterima dua kali (kesalahan staf/unggah ulang) menjadi dua dokumen utang yang sama-sama dapat dibayar.
*Arah perbaikan:* peringatan keras saat commit bila nomor faktur sudah ada untuk pemasok yang sama (soft warning, bukan unique index kaku — nomor faktur pemasok bisa sah berulang antar pemasok/periode), dan tampilkan indikator duplikat di daftar penerimaan.

**GDG3-06. Tidak ada kunci idempotensi pada dokumen gudang — submit ganda menghasilkan dokumen ganda penuh.**
*Status: TERBUKTI (probe GDG3-06: dua panggilan identik → 2 penerimaan, stok 2×, 2 jurnal, 2 dokumen utang).*
Skema aksi penerimaan/penyesuaian/transfer/opname tidak membawa `idempotencyKey` (bandingkan POS yang mewajibkannya — AGENTS.md) dan domain tidak mendedupe apa pun. Mitigasi yang ada hanya tombol form yang nonaktif selama pending (`receipt-form.tsx:397`) — melindungi satu form dari klik ganda, tetapi tidak dua tab, dua perangkat, atau retry sesudah timeout yang sebenarnya sudah ter-commit.
*Arah perbaikan:* terima `idempotencyKey` per dokumen (pola POS) dan tegakkan unik per perusahaan pada tabel dokumen, atau minimal kunci (perusahaan, nomor referensi eksternal) untuk penerimaan berfaktur.

**GDG3-14. Reservasi bersamaan dapat melebihi stok — ketersediaan dibaca tanpa kunci.**
*Status: TERBUKTI (probe GDG3-14: `fulfilled=2, reserved=16` atas stok 10).*
`createReservation` membaca `stock_on_hand` dan total reservasi aktif tanpa `FOR UPDATE` (`reservations.ts:86-107`); dua transaksi bersamaan sama-sama melihat tersedia 10 dan sama-sama berhasil mereservasi 8. Total janji 16 > stok fisik 10; ketersediaan POS (on hand − reserved) menjadi −6 secara logis, dan salah satu reservasi pasti tidak dapat dipenuhi saat penjualan terjadi.
*Arah perbaikan:* kunci baris `stock_on_hand` produk+gudang di awal `createReservation` (pola `lockStockQty` yang sudah ada di inventory.ts), lalu hitung ketersediaan di dalam kunci.

**GDG3-11. Peran warehouse dapat mengubah harga jual (dan harga pokok master) produk.**
*Status: TERBUKTI (probe GDG3-11 di lapisan aksi dengan konteks peran warehouse: `salePrice` berubah menjadi Rp777.000; dikembalikan sesudahnya).*
`saveProductAction` hanya memeriksa `inventory.manage` — izin yang memang dimiliki peran warehouse — lalu menulis `salePrice` dan `costPrice` tanpa gerbang field apa pun (`actions/inventory.ts:107-180`). Formulir produk juga menampilkan dan mengirim kedua harga tanpa syarat izin (`product-form.tsx:184`). Katalog izin tidak mengenal izin harga sama sekali; satu-satunya izin harga yang ada adalah `inventory.cost` (lihat harga beli) dan `inventory.cost_override` (override harga pokok penyesuaian) — keduanya tidak dipakai untuk harga master.
*Dampak:* staf gudang dapat menaikkan/menurunkan harga jual yang langsung berlaku di POS, tanpa jejak persetujuan; audit log hanya mencatat `product.update` dengan sku/nama (nilai harga lama/baru tidak ikut tercatat).
*Arah perbaikan:* pisahkan gerbang harga (mis. perubahan `salePrice`/`costPrice` pada simpan produk mensyaratkan izin tambahan yang tidak dimiliki peran warehouse bawaan), dan catat nilai lama/baru harga pada audit log.

### P3 — Rendah

**GDG3-09b. PO tidak memiliki tahap persetujuan — pembuat yang sama membuat draft dan mengirim PO sendiri.**
*Status: TERBUKTI (probe GDG3-09 paruh kedua: `createPurchaseOrder` + `sendPurchaseOrder` oleh pengguna yang sama berhasil; status `sent`).*
PR menegakkan maker-checker di domain (TERBUKTI BAIK, GDG3-09a di §2), tetapi PO — dokumen komitmen belanja yang menjadi dasar penerimaan & utang — hanya mengenal draft → sent oleh pemegang `inventory.manage` yang sama, tanpa checker dan tanpa ambang nilai. Penerimaan terhadap PO itu pun izin yang sama.
*Arah perbaikan:* pertimbangkan gerbang kirim-PO maker-checker di atas ambang (menyatukan pola PR), atau dokumentasikan secara eksplisit bahwa PR adalah satu-satunya titik kontrol komitmen belanja.

**GDG3-05. Opname menjaring selisih antar produk ke satu jurnal neto — susut bruto hilang dari buku besar.**
*Status: TERBUKTI (probe GDG3-05: susut Rp500.000 produk A + surplus Rp500.000 produk B dalam satu opname → 0 jurnal; mutasi dua arah tetap tercatat).*
`createOpname` menjurnalkan `netValue` (Σ delta × costPrice lintas produk) sebagai satu pasang baris (`inventory.ts:1862-1881`). Total GL persediaan tetap benar, tetapi akun beban susut tidak pernah menunjukkan susut bruto dan akun yang sama dipakai dua arah (kredit untuk surplus), sehingga analisis susut per periode selalu neto dan bisa nol padahal terjadi susut besar.
*Arah perbaikan:* jurnalkan arah keluar dan arah masuk sebagai dua kelompok baris terpisah (pola yang sudah dipakai penyesuaian bertanda campuran di `postStockAdjustment`).

**GDG3-08. `createTransfer` di lapisan domain tidak memvalidasi qty — qty negatif membalik arah mutasi.**
*Status: TERBUKTI (probe GDG3-08: transfer qty −5 dari W1 ke W2 menghasilkan W1 +5 dan W2 −5; dokumen tercatat berkebalikan dari labelnya).*
Lapisan aksi memblokir (`transferSchema` memakai `amountField(..., "positive")`, `actions/inventory.ts:517-531`), jadi jalur UI aman; tetapi domain — yang untuk penerimaan/penyesuaian/opname memvalidasi tandanya sendiri — di sini diam. Pemanggil domain lain di masa depan (impor, otomatisasi) mewarisi lubangnya. Qty 0 juga diterima dan mencatat mutasi nol.
*Arah perbaikan:* tegakkan `qty > 0` dan tolak baris duplikat per produk di `createTransfer`, samakan dengan pertahanan domain dokumen lain.

**GDG3-17b. Pencarian teks daftar pergerakan adalah jalur baca gudang terlambat yang terukur.**
*Status: TERBUKTI terukur pada skala probe; ekstrapolasi ditandai sebagai risiko.*
Pada 30.000 mutasi (satu produk, di dalam transaksi uji yang sama): kartu stok hal. 1 = **113 ms**, hal. 300 = **137 ms** (sehat), valuasi 5.000 produk hal. 1 = **56 ms**, penuh = **125 ms** (sehat, konsisten dengan S4). Tetapi `listMovements` dengan `q` teks = **531 ms** untuk halaman pertama: `count(*)` + join produk dengan `ilike '%…%'` pada nama/SKU/nomor referensi (`catalog.ts:572-638`). Indeks trigram tidak dapat menolong di bawah RLS (bukti S4 §4.2 — tidak diusulkan dipasang ulang). Pada volume mutasi skala S4-A (133 rb) jalur ini berisiko multi-detik per pencarian.
*Arah perbaikan:* batasi count dengan estimasi/skip-count untuk halaman dalam, atau pisahkan pencarian nomor referensi (equality/awalan, btree-able) dari pencarian nama; ukur ulang pada dataset besar sebelum memilih.

**GDG3-18. Tidak ada pembatasan gudang per pengguna.**
*Status: TERBUKTI dari skema & kode (bukan probe runtime).*
Tabel `member` tidak memiliki ikatan gudang, dan tidak ada pemeriksaan kepemilikan gudang terhadap pengguna di aksi/domain gudang: pemegang `inventory.manage` dapat memposting dokumen untuk gudang mana pun di perusahaannya (termasuk gudang cabang lain), dan pemegang `inventory.view` melihat semua gudang. Untuk bisnis multi-cabang ini berarti peran "Staf Gudang" bersifat perusahaan-penuh secara bawaan.
*Arah perbaikan:* bila pemisahan cabang dibutuhkan, tambahkan penugasan gudang per anggota + filter bawaan (bukan penolakan keras) pada daftar/pilihan gudang; dokumentasikan bila memang disengaja perusahaan-penuh.

**GDG3-19. Laporan stok lambat (slow/dead-moving) tidak ada.**
*Status: MISSING (grep menyeluruh `src/` — tidak ada fungsi/halaman stok lambat).*
Yang tersedia adalah rekomendasi pembelian berbasis stok minimum (`purchasing.ts:468`, halaman `gudang/rekomendasi`). Tidak ada laporan produk tanpa pergerakan keluar dalam N hari beserta nilai tertanamnya — alat standar pengendalian persediaan dan dasar keputusan diskon/penghapusan stok mati.
*Arah perbaikan:* laporan baca-saja dari `stock_movements` (terakhir keluar per produk + qty × costPrice), terpaginasi; perhatikan biaya agregasinya pada volume besar (lihat GDG3-17b).

---

## 2. Yang TERBUKTI BAIK (jangan diubah tanpa alasan)

- **GDG3-01 — Transfer benar-benar netral nilai.** Probe: penerimaan 100 × Rp10.000 (GL persediaan Rp1.000.000) → transfer 40 antar gudang menghasilkan **0 jurnal**, GL tetap Rp1.000.000, stok 60/40 persis. Klaim desain "transfer tanpa jurnal karena akun persediaan tingkat perusahaan" terbukti benar, termasuk untuk batch/serial (irisan batch & seri mengikuti leg yang sama di kode).
- **GDG3-12 — RLS antar perusahaan menahan semua probe.** Sebagai `app_user` berkonteks perusahaan A: baca penerimaan perusahaan B = 0 baris (meski difilter eksplisit `company_id = B`), update produk B = 0 baris, insert `stock_on_hand` ber-`company_id` B **ditolak policy RLS**. Verifikasi katalog: seluruh 89 tabel ber-`company_id` berstatus RLS aktif + FORCE + tepat 1 policy.
- **GDG3-09a — Maker-checker PR ditegakkan di domain.** Pembuat PR yang menyetujui PR-nya sendiri ditolak `FORBIDDEN` (maker-checker), termasuk penolakan wajib beralasan dan ambang peran senior untuk nilai besar (`purchase-requests.ts:138-160`); checker lain dapat memutuskan (kontrol probe lolos).
- **GDG3-13 — Konkurensi mutasi stok aman.** Dua penyesuaian `damaged` 7 unit bersamaan atas stok 10: **tepat satu berhasil**, stok akhir 3 persis — kunci baris `stock_on_hand FOR UPDATE` di `applyStockMovement` bekerja; tidak ada stok negatif dan tidak ada mutasi ganda.
- **Kontrol periode (paruh GDG3-02)** — penerimaan bernilai bertanggal periode tertutup ditolak `PERIOD_CLOSED`; persetujuan penyesuaian juga memeriksa periode tanggal dokumen saat approval (`approveStockAdjustment`).
- **Kontrol rekonsiliasi (paruh GDG3-03)** — untuk as-of hari ini, rekonsiliasi kontrol persediaan selisih 0 pada skenario probe.
- **Void dokumen gudang konsisten** — tidak di-probe ulang ronde ini; suite lama `inventory-void-import`, `goods-receipt`, `consistency` (bagian dari 97/97 hijau di atas) membuktikan void penerimaan/dokumen membalik jurnal lewat jurnal pembalik + mutasi cermin + hitung ulang AVCO dari ledger.
- **Performa baca inti sehat** — kartu stok & valuasi terukur di GDG3-17 konsisten dengan benchmark S4 (yang tetap menjadi acuan skala 100 rb produk / 5,1 jt mutasi); tidak ditemukan regresi.

## 3. KLAIM-TANPA-BUKTI & TIDAK-TERUJI

- **KLAIM-TANPA-BUKTI (parsial):** "Tidak ada jalur mengubah stok tanpa dokumen" — benar secara konstruksi (semua mutasi lahir dari dokumen lewat `applyStockMovement`), tetapi dokumen penyesuaian generik bertanda ± beralasan teks bebas adalah koreksi tanpa referensi sumber; nilainya dinilai di GDG3-10, bukan di sini.
- **TIDAK-TERUJI ronde ini:** void transfer dua tahap `in_transit` dan void opname campuran di bawah konkurensi (mengandalkan suite lama yang hijau); impor berkas *rusak* per baris (jalur error sudah dicakup suite `import-hardening` lama — tidak diulang); perilaku batch/serial pada void bersamaan; performa pencarian pergerakan pada dataset skala S4-B (dataset benchmark sudah dibersihkan S4 — risiko GDG3-17b diekstrapolasi dari pengukuran 30 rb mutasi, ditandai sebagai ekstrapolasi).
- **Tidak diusulkan:** pemasangan ulang indeks trigram untuk pencarian — S4 §4.2 membuktikan planner di bawah RLS tidak pernah memilihnya (operator LIKE tidak leakproof); setiap usul indeks baru wajib membawa bukti EXPLAIN sebagai `app_user`.

## 4. Bukti & artefak

- Berkas probe: `tests/integration/gdg3-audit-probe.test.ts` (17 probe; 17/17 lulus pada larian final — asersi sengaja membuktikan perilaku apa adanya, termasuk yang cacat).
- Keluaran terukur yang dikutip: GDG3-14 `fulfilled=2 reserved=16`; GDG3-16 `ok=2 stok=20 jurnalPembuka=1`; GDG3-17 `{"stockCardPage1":113,"stockCardPage300":137,"listMovementsSearch":531,"valuationPage1":56,"valuationFull":125}` ms.
- Kontrol suite lama: 10 berkas, 97/97 test hijau (perintah tercatat di riwayat sesi audit).
- Residu berkomit hanya ada di perusahaan fixture khusus berkas ini (`…f701`/`…f702`: produk probe konkurensi/impor bertanda SKU `GDG3-CC*`/`GDG3-IMP*`); perusahaan demo tidak disentuh sama sekali.
