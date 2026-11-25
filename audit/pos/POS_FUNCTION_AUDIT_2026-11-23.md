# Audit Fungsi POS — 23 November 2026

## Ringkasan hasil

Audit ini menelusuri terminal POS aktif, alur penjualan dan kas, retur, offline, API terminal, riwayat, serta semua jalur cetak yang ditemukan. Jalur penjualan online mempunyai kontrol penting di kode: izin server, hitung ulang harga di server, idempotensi, penguncian sesi/stok/kredit, dan penulisan transaksi dalam transaksi basis data yang sama. Pada tahap tindak lanjut, temuan performa, antrean, snapshot dan toolchain POS diremediasi; validasi unit/type/lint terbaru lulus. Tidak ada bukti dari pemeriksaan ini bahwa penjualan online dapat menggandakan jurnal atau pengurangan stok.

Namun, audit belum dapat menyatakan seluruh POS bebas bug atau sesuai sertifikasi standar internasional. Basis data disposable, aplikasi aktif, browser nyata, terminal, dan printer fisik tidak tersedia untuk verifikasi end-to-end atau pengukuran saat ini. Lihat bagian status remediasi untuk masalah yang telah diperbaiki di source serta risiko yang masih memerlukan keputusan retensi atau uji runtime.

## Cakupan dan batas

- Produk desktop aktif yang didukung adalah `pos-electron/` yang memuat aplikasi ERP di `/app/pos`. `pos-desktop/` didokumentasikan sebagai prototipe Tauri eksperimental, bukan klien desktop operasional yang didukung.
- Kode yang diperiksa adalah working tree pada tanggal audit; ada perubahan/deletion POS dan audit yang sudah ada di working tree. Audit ini tidak mengubah source aplikasi dan tidak menganggap perubahan tersebut sebagai bagian commit tertentu.
- Ponytail, Exa MCP, dan Context7 MCP tidak tersedia pada koneksi ini. Tidak ada hasil dari alat tersebut yang diklaim. Dokumentasi proyek dibaca lebih dahulu; acuan teknis diganti dengan dokumentasi resmi Electron, PostgreSQL, MDN, OWASP, dan advisori GitHub.
- OWASP API Security Top 10 dipakai sebagai lensa untuk akses fungsi dan pembatasan konsumsi sumber daya; ini bukan penilaian sertifikasi ASVS.

## Peta fungsi POS yang ditelusuri

| Area / alur | Fungsi dan pemilik utama | Bukti dan batas verifikasi |
|---|---|---|
| Terminal, izin, dan pemuatan awal | `/app/pos`, `PosTerminal`, `pos/layout.tsx`, izin `pos.sell`/`pos.session` | Jalur halaman, aksi server, dan kondisi loading diperiksa statis; navigasi nyata belum dijalankan. |
| Katalog, kategori, barcode, pelanggan | `searchProductsAction`, `searchCustomersAction`, `quickAddCustomerAction`, `useProductSearch`, `useGlobalBarcodeScan`, cart product action | Batas halaman 24, debounce 220 ms, urutan pencarian barcode persis, dan fallback cache diperiksa. Waktu interaksi/browser tidak diukur. |
| Keranjang, kutipan, harga, pajak, diskon, promosi, grup, loyalitas | `quoteAction`, `quoteCart`, `priceQuoteLines`, `src/lib/pos/promotions.ts`, `loyalty.ts`, cart hooks | Server menghitung ulang harga; batas 200 baris dan larangan duplikat produk/kemasan diperiksa. Logika unit test masuk suite POS; aturan bisnis live belum dikonfirmasi ke pemilik. |
| Pembayaran dan checkout | `useTerminalCheckout`, `checkoutAction`, `createSale`, `allocateSalePayments`, `persistSaleDocument`, `applySaleStockMovements`, `postSaleJournal` | Jalur idempotensi, fingerprint, pembayaran campuran/kredit, quote ulang, stok, kas, jurnal, dan audit diperiksa; transaksi/race PostgreSQL tidak dijalankan. |
| Transaksi ditahan | `holdAction`, `resumeHeldSaleAction`, `deleteHeldSaleAction`, `sales-hold.ts`, `useHeldSales` | Validasi dan konsumsi transaksi ditahan diperiksa statis; persistensi dan race DB belum diuji. |
| Sesi kas dan rekonsiliasi | `openSessionAction`, `prepareSessionCloseAction`, `closeSessionAction`, `forceCloseSessionAction`, `cashMovementAction`, `openCashSession`, `closeCashSession`, `cashDrawerMovement` | Kepemilikan sesi, lock, token hitungan, toleransi selisih, mutasi kas, jurnal, audit, dan idempotensi UI diperiksa; concurrency DB/fisik tidak diuji. |
| Void, retur, tukar, refund, kredit pelanggan | `voidSaleAction`, `createReturnAction`, `createSaleReturn`, `resolveReturnSettlement`, `getReturnCreditAction`, `return-history.ts`, `returns-credit.ts` | Retur mengunci penjualan asal, memakai snapshot baris penjualan, mengakumulasi kuantitas retur, dan memulihkan stok/jurnal/kas secara transaksional pada kode. DB-backed negative/race cases belum dijalankan. |
| Piutang POS | `payReceivableAction`, `voidReceivablePaymentAction`, `receivables.ts`, payment state UI | Validasi dan hubungan ke jurnal diperiksa statis; rekonsiliasi data dan reversal di DB belum dilakukan. |
| Offline/PWA | `useOfflineQueue`, `pos-offline.ts`, `syncOfflineSalesAction`, `processOfflineSaleItem`, `listOfflineReviewQueue`, `postOfflineReviewItem`, `pos-sw.js`, `PosServiceWorker` | Unit tests menguji queue dan kontrak service worker dengan mock. Sinkronisasi nyata, jaringan putus, dan antrean besar belum diuji. Service worker memang hanya berjalan pada secure context; dokumentasi menyebut HTTP ke IP LAN tidak mendapat cache shell. |
| API terminal/native | pairing, enroll/login, snapshot, sync/session, receipt, download/update; `src/server/pos/terminals.ts`, `pos-device.ts`, `device-sync.ts`, `device-sessions.ts` | Token/izin dan batas snapshot ditinjau statis. API ini bukan jalur produk Electron aktif; klien native legacy/prototipe tidak diuji end-to-end. |
| Riwayat dan dokumen | `/riwayat`, `/nota/[id]`, faktur, nota retur, laporan sesi X/Z, piutang cetak, cetak ulang | Rute dan permission cetak ulang diperiksa. PDF/print layout nyata tidak diuji. |
| Kitchen display | `src/lib/pos/kitchen-display.ts` dan tes unit | Logika helper ditemukan; tidak ada jalur UI/route POS aktif yang dapat diverifikasi dalam pemetaan rute ini. Statusnya bukan alur terminal kasir yang teruji. |

## Pemeriksaan jalur printer satu per satu

| Jalur | Implementasi | Perilaku yang didukung kode | Hasil pemeriksaan |
|---|---|---|---|
| Browser / dialog OS | `ReceiptPrint`, `receipt-print-window.ts`, halaman nota/faktur/retur/piutang/sesi | `window.print()`; nota thermal mengukur tinggi isi; popup terpisah menghindari cetak halaman terminal. | Unit/static saja. `afterprint` menandakan dokumen mulai dicetak atau preview ditutup, bukan bukti kertas keluar; pembatalan tetap harus ditangani kasir. |
| Browser kiosk test | `printer-modal.tsx:183-221` | Popup uji memakai printer/default OS dan ditutup setelah pemanggilan print. | Belum diuji dengan Chrome/Edge `--kiosk-printing` dan perangkat nyata. |
| USB ESC/POS | `printer-connection.ts`, `encoder.ts`, `receipt-template.ts` | Pilih USB device, cari endpoint OUT, kirim buffer, periksa status/jumlah byte transfer. | Helper dan encoder masuk tes; tidak ada USB printer untuk uji. Perangkat komposit/firmware berbeda belum divalidasi. |
| Serial ESC/POS | `printer-connection.ts` | Buka port dengan baud rate bawaan 9600 dan tulis buffer. | Helper masuk tes; baud rate/flow control belum diuji pada model printer. |
| Bluetooth ESC/POS | `printer-connection.ts` | Cari characteristic yang didukung; buffer dipotong tetap 100 byte dan jeda antar-potongan. | Helper masuk tes; ukuran maksimum write dan dukungan per model belum diuji. API perlu secure context dan dukungan browser. |
| Antrean cetak browser | `print-queue.ts`, `PosPrintQueue` | Status pending/printing/sent/failed/uncertain, retry manual setelah hasil tidak pasti, query berbasis indeks dan claim IndexedDB atomik; lock lintas tab tetap dipakai jika tersedia. | Unit tests adapter memory lulus. IndexedDB browser dua tab dan printer nyata belum diuji; operasi `list()` eksplisit masih membaca semua, tetapi tidak ditemukan pemanggil produksi. |
| Cetak OS senyap Electron | `pos-electron/main.cjs`, `preload.cjs`, `print-callback.cjs` | Verifikasi printer OS, jendela tersembunyi terisolasi, ukuran thermal dinamis, `webContents.print`; timeout mempertahankan operasi native sebagai belum pasti sampai callback; retry perlu konfirmasi kasir. | Unit helper callback/timeout lulus dan Linux directory packaging berhasil. Callback tidak membuktikan kertas fisik; runtime Electron/printer tidak diuji. |
| API nota thermal perangkat lama | `/api/pos/desktop/transactions/[saleId]/receipt` | Bearer device, izin `pos.receipt.reprint`, pencatatan audit. | Source diperiksa; endpoint tidak terbukti dipakai Electron aktif. |

Semua jalur printer memiliki uji unit untuk sebagian logika formatter/antrean, tetapi **tidak satu pun jalur dinyatakan tervalidasi pada printer fisik**. Hasil `sent`/`success` pada transport berarti data diterima API/browser/spooler sesuai jalurnya, bukan bukti kertas tercetak utuh.

## Temuan yang ditemukan saat audit (sebelum remediasi)

### POS-002 — Riwayat antrean offline server tidak memiliki retensi dan review membaca semua payload

- **Severity / prioritas:** Medium / P2.
- **Confidence:** Strong Evidence dari query dan skema; dampak latensi/pertumbuhan belum diukur pada DB produksi.
- **Alur:** sinkronisasi offline, review supervisor, penyelesaian offline.
- **Lokasi:** `src/server/pos/offline.ts:165-243,480-525,560-571`; `src/server/actions/pos-offline.ts:91-99,113-130`; `src/db/schema/platform.ts:323-346`; migration `0087_pos_offline_outbox_query_indexes.sql`.
- **Reproduksi/skenario:** buat banyak percobaan sync dan item review. Tiap percobaan menambahkan row outbox; item terminal menyimpan ringkasan, item unresolved menyimpan payload penuh. `listOfflineReviewQueue` tidak memberi batas atau cursor. Untuk memposting satu item, aksi memanggil seluruh queue dengan `includePayload: true`, lalu mencari satu ID.
- **Expected vs actual:** query review satu item semestinya mengambil satu row; saat ini ia membaca semua item unresolved beserta payload sebelum mengambil target. Retensi/arsip untuk riwayat terminal tidak ditemukan pada job repository yang diperiksa.
- **Akar masalah / dampak:** outbox menyimpan sejarah, antrean operasional, dan payload retry pada satu tabel. Indeks `clientKey` dan `settlement.sessionId` sudah ditambahkan di migration 0087 sehingga pencarian kunci lebih baik dari laporan sebelumnya, tetapi indeks itu tidak membatasi ukuran tabel atau mem-paginate daftar review. Beban memori/IO dan durasi review tumbuh seiring backlog/riwayat; payload gagal dapat berisi detail transaksi lebih lama dari perlu.
- **Perbaikan minimal:** ambil item target langsung berdasarkan `company_id + id` dengan lock; paginasi queue menggunakan keyset dan proyeksi kolom; tetapkan masa simpan yang disetujui bisnis untuk row terminal/payload dan pertahankan unresolved serta jejak audit wajib.
- **Verifikasi:** seed DB disposable dengan 10k+ row terminal/unresolved, ukur `EXPLAIN (ANALYZE, BUFFERS)` untuk list/single-item/settlement di bawah role aplikasi, dan pastikan unresolved tidak terhapus oleh retensi.
- **Kompleksitas:** Medium.

### POS-003 — Sinkronisasi offline berulang kali memuat dan mengurutkan seluruh antrean lokal

- **Severity / prioritas:** Medium / P2.
- **Confidence:** Strong Evidence; belum diukur dengan antrean besar.
- **Alur:** pemulihan setelah terminal lama offline.
- **Lokasi:** `src/lib/pos/pos-offline.ts:154-219,355-365`; `src/components/pos/use-offline-queue.ts:35-65`.
- **Reproduksi/skenario:** isi IndexedDB dengan N transaksi, lalu sambungkan kembali. Klien membaca dan mengurutkan seluruh queue sekali; setiap 25 item yang disinkronkan, ia memanggil `getOfflineQueueSummary`, yang kembali menjalankan `getAll()` dan sort atas antrean tersisa.
- **Expected vs actual:** pemulihan backlog seharusnya memproses per batch dengan biaya mendekati jumlah item. Saat ini ada pembacaan/sort seluruh antrean untuk setiap batch; semua item gagal membuat jumlah yang dibaca hampir sama pada setiap iterasi. Pada antrean besar biaya lokal menjadi berlipat terhadap jumlah batch, selain payload ter-clone ke memori.
- **Akar masalah / dampak:** `IndexedDbOfflineStorage.list()` menggunakan `store.getAll()` lalu `sort`, sedangkan ringkasan count/oldest memanggil `list()` lagi tiap batch. Ini dapat membuat tab POS lambat atau kehabisan memori selama pemulihan antrean besar.
- **Perbaikan minimal:** gunakan `count()` dan indeks tanggal untuk ringkasan; baca/ambil per batch dengan cursor/key range; terapkan hasil dan update status tanpa memuat/sort seluruh store berulang.
- **Verifikasi:** ukur waktu/memori saat memulihkan 100, 1k, dan 10k transaksi yang berisi campuran synced/conflict; cek request count dan pastikan retry tetap idempotent.
- **Kompleksitas:** Medium.

### POS-004 — Pencarian katalog tidak membatasi panjang query atau offset halaman

- **Severity / prioritas:** Medium / P2.
- **Confidence:** Confirmed dari kontrak aksi/query; efek produksi perlu diukur ulang.
- **Alur:** pencarian produk dan paginasi kisi.
- **Lokasi:** `src/server/actions/pos.ts:70-102`; `src/server/catalog/products.ts:452-564`; `src/components/pos/terminal/use-product-search.ts:35-113`.
- **Reproduksi/skenario:** panggil server action langsung dengan string pencarian sangat panjang atau offset sangat besar (aksi tidak memvalidasi keduanya dengan Zod; offset hanya dibulatkan dan dibatasi bawah). Query non-exact memakai `ILIKE '%q%'` dan `LIMIT 24 OFFSET n`.
- **Expected vs actual:** input teks/paginasi dibatasi dan beban query dapat diprediksi. Saat ini ukuran teks dan offset tidak memiliki maksimum server-side; offset besar memaksa DB melewati baris yang tidak dikirim, sedangkan pencarian isi teks bergantung pada pemindaian yang efektif di bawah RLS.
- **Bukti skala:** benchmark repo 4 November 2026, PostgreSQL dev dengan 100k produk, melaporkan pencarian kata POS p50 177,8 ms / p95 187,4 ms dan kisi kosong p50 2,7 ms / p95 2,9 ms. Angka itu historis, bukan pengukuran runtime sekarang; benchmark tidak mengukur request/network/render, 1 juta produk, atau jalur scanner persis (`exactCode: true`). Benchmark menjelaskan indeks trigram untuk teks tidak dipilih planner aplikasi di bawah FORCE RLS. Lihat `docs/sim2/S4-BENCHMARK.md:118-148,187-191` dan `scripts/sim2-gen/results/final-B.json`.
- **Akar masalah / dampak:** batasan hanya diterapkan oleh UI (page size 24 dan debounce 220 ms), tidak di server action yang dapat dipanggil sebagai endpoint. Trafik langsung/offset ekstrem dapat menghabiskan CPU/IO DB dan pencarian teks mulai terasa pada katalog 100k.
- **Perbaikan minimal:** validasi `q` dengan batas panjang dan normalisasi; batasi offset maksimum atau pindah ke keyset/cursor berbasis nama+id. Jangan menambah indeks trigram sebelum `EXPLAIN (ANALYZE, BUFFERS)` membuktikan planner role aplikasi memakainya.
- **Verifikasi:** benchmark endpoint/action aktual di role RLS aplikasi pada 100k dan 1M produk, kata umum/langka, offset awal/dalam, scanner exact, serta banyak kasir bersamaan; catat p50/p95 dan rencana query.
- **Kompleksitas:** Low–Medium.

### POS-005 — Cache produk terminal terus membesar dan fallback barcode menelusuri semua isinya

- **Severity / prioritas:** Medium / P2.
- **Confidence:** Strong Evidence dari state management; belum diprofilkan di browser.
- **Alur:** menjelajah katalog, memindai barcode saat jaringan offline.
- **Lokasi:** `src/components/pos/terminal/use-product-search.ts:63-76,101-110,152-180`.
- **Reproduksi/skenario:** kasir memajukan banyak halaman produk; setiap halaman ditambahkan ke object `cache` tanpa eviction. Pindai barcode saat request server gagal.
- **Expected vs actual:** kebutuhan browse cache seharusnya terbatas pada halaman aktif, keranjang, dan lookup lokal yang diperlukan. Saat ini setiap halaman dikopi dengan `{ ...current }`; fallback barcode membuat `Object.values(cache)` baru dan mencari linear seluruh produk yang pernah dikunjungi.
- **Akar masalah / dampak:** cache katalog berbentuk object tanpa batas, tanpa indeks barcode, dan melakukan salinan penuh pada setiap halaman baru. Setelah ribuan halaman, waktu/memori naik dan pemindaian offline dapat memblokir interaksi kasir.
- **Perbaikan minimal:** cache browse berbatas (mis. LRU per halaman), simpan produk keranjang dalam cache terpisah yang tidak dievict, dan gunakan indeks `barcode/SKU → product` untuk lookup lokal.
- **Verifikasi:** Chrome Performance/React Profiler pada 100k produk saat browse 1k/10k item, lalu pindai barcode; ukur heap, waktu render, waktu lookup, dan pastikan produk aktif di keranjang tidak hilang.
- **Kompleksitas:** Medium.

### POS-006 — Query retur per penjualan tidak memiliki indeks `sale_returns(company_id, sale_id)`

- **Severity / prioritas:** Medium / P2.
- **Confidence:** Strong Evidence dari skema dan query; perlu rencana query DB untuk mengukur dampaknya.
- **Alur:** validasi kuantitas retur, penyelesaian refund, riwayat retur.
- **Lokasi:** `src/db/schema/sales.ts:154-195`; `src/server/pos/returns.ts:260-280,136-145`; `src/server/pos/returns-settlement.ts:124-149`; `src/server/pos/return-history.ts:7-25,116-125`.
- **Reproduksi/skenario:** di perusahaan dengan banyak dokumen retur, lakukan retur kedua untuk salah satu penjualan. Kode memfilter `sale_returns` berdasarkan `company_id + sale_id` (kadang status juga), lalu join baris retur. Skema/migrasi sampai 0087 memiliki indeks perusahaan+tanggal dan unique `(company,id)`, tetapi tidak indeks komposit perusahaan+sale.
- **Expected vs actual:** lookup retur satu nota proporsional pada jumlah retur nota tersebut. Tanpa indeks komposit, DB berpotensi membaca retur perusahaan dalam jumlah besar lalu menyaring `sale_id` setiap retur dan setiap tampilan riwayat.
- **Akar masalah / dampak:** foreign key pasangan tidak otomatis menyediakan indeks pada kolom referensi. Query yang sama dipanggil berulang dalam retur, history, dan alokasi settlement; latensi meningkat saat tabel tumbuh.
- **Perbaikan minimal:** ukur rencana di DB representatif, lalu tambahkan indeks yang mengikuti pola umum, misalnya `(company_id, sale_id, created_at DESC)`; pertahankan tenant filter dan verifikasi biaya tulis.
- **Verifikasi:** `EXPLAIN (ANALYZE, BUFFERS)` di bawah role aplikasi pada 100k/1M retur; ukur p95 pembuatan retur/history dan pastikan total kuantitas hasil tetap identik.
- **Kompleksitas:** Low–Medium.

### POS-007 — Antrean cetak menggunakan `getAll()` meski mempunyai indeks IndexedDB

- **Severity / prioritas:** Medium / P2.
- **Confidence:** Confirmed dari implementasi; dampak perlu diuji dengan backlog printer nyata.
- **Alur:** antrean/reprint receipt saat printer putus atau backlog tinggi.
- **Lokasi:** `src/lib/pos/print-queue.ts:88-99,138-140,184-220,269-300`; `src/components/pos/terminal/pos-print-queue.tsx:69-92`.
- **Reproduksi/skenario:** simpan banyak job pending/uncertain lalu aktifkan direct printer. Worker memeriksa tiap 2 detik. `list()` memanggil `store.getAll()`; `nextCopyIndex`, `latestForSale`, `claimNext`, `resetStuck`, dan `cleanup` memfilter/mengurutkan di JavaScript. Indeks `status`, `saleId`, dan `createdAt` dibuat tetapi tidak digunakan oleh `list()`.
- **Expected vs actual:** claim satu job atau cari job satu sale hanya membaca rentang relevan. Saat ini tiap operasi meng-clone seluruh IndexedDB store ke array; pending/printing tidak dibersihkan oleh cleanup sehingga backlog yang belum selesai dapat terus membesar.
- **Akar masalah / dampak:** API queue abstraksi selalu mengembalikan semua data; operasi yang mestinya key/index lookup menjadi O(jumlah seluruh job), disertai sort dan tekanan memori. Worker berkala mengulang biaya ini.
- **Perbaikan minimal:** gunakan object-store indexes/cursor untuk `status`, `saleId`, dan urutan waktu; batasi hasil yang dibaca, pertahankan claim atomik dan lock lintas tab; tetapkan penanganan backlog pending yang aman agar job tidak hilang diam-diam.
- **Verifikasi:** buat 10k+ job IndexedDB, ukur waktu claim/latest/cleanup dan heap; jalankan dua tab dan putus-sambung printer untuk memastikan satu job tidak tercetak ganda atau hilang.
- **Kompleksitas:** Medium.

### POS-008 — Timeout cetak Electron mengembalikan status tidak pasti tanpa membatalkan operasi native

- **Severity / prioritas:** Low / P3.
- **Confidence:** Hypothesis berbasis implementasi, belum dapat direproduksi pada runtime Electron/printer.
- **Alur:** cetak receipt Electron dan retry setelah timeout.
- **Lokasi:** `pos-electron/main.cjs:61-67,123-144`; `src/components/pos/terminal/checkout-success-modal.tsx:63-89`.
- **Reproduksi/skenario:** buat `webContents.print()` atau callback OS menunggu lebih dari 20 detik setelah spooler sempat menerima job; timeout `Promise.race` menandai uncertain, menutup window sesudah 500 ms, dan membuka mutex untuk permintaan berikutnya. Kasir mengonfirmasi retry.
- **Expected vs actual:** status mencerminkan hasil definitif atau hasil tidak pasti yang mencegah pengiriman ulang tanpa keputusan operator. Saat ini retry manual memang meminta konfirmasi, tetapi operasi native yang terlambat tidak dibatalkan/dapat diidentifikasi sebagai job yang sama; skenario spooler-terima/callback-terlambat berpotensi menghasilkan dua kertas.
- **Akar masalah / dampak:** timeout JavaScript tidak membatalkan `contents.print()`. Handler hanya memakai boolean `ok` dan membuang `failureReason`, sehingga log juga kehilangan sebab spesifik dari Electron.
- **Perbaikan minimal:** pertahankan job state `uncertain`, tampilkan `failureReason` untuk kegagalan definitif, dan jangan mengklaim timeout sebagai pembatalan; gunakan identifier lokal/job dan petunjuk inspeksi sebelum mengirim ulang.
- **Verifikasi:** fault injection Electron dengan callback cepat, gagal, terlambat, dan tidak pernah kembali; pastikan retry tidak dilakukan otomatis dan pesan operasional sesuai hasil spooler.
- **Kompleksitas:** Medium.

### POS-009 — Snapshot penuh API terminal lama berhenti diam-diam pada 20.000 produk

- **Severity / prioritas:** Low / P3 pada jalur produk saat ini; dampak Medium/P2 bila API dipakai klien terminal lama.
- **Confidence:** Confirmed dari source; penerapan aktual di toko belum diketahui.
- **Alur:** sinkronisasi katalog full snapshot ke klien device lama.
- **Lokasi:** `src/server/pos-device.ts:329-334,609-671`; `src/app/api/pos/snapshot/route.ts:13-25,39-53`.
- **Reproduksi/skenario:** minta snapshot full untuk perusahaan dengan lebih dari 20.000 produk aktif. Loop hanya membaca maksimal 40 halaman × 500 produk dan response mengembalikan mode `full` tanpa `truncated` atau cursor untuk sisa katalog.
- **Expected vs actual:** klien mengetahui katalog belum lengkap atau meminta halaman berikutnya. Saat ini klien dapat menganggap 20.000 produk tersebut sebagai snapshot lengkap; barcode produk setelah batas tidak tersedia offline.
- **Akar masalah / dampak:** plafon keselamatan ukuran payload tidak diungkap sebagai status parsial. Jalur ini bagian API terminal bertanda rencana/prototipe; Electron resmi aktif tidak menggunakannya, jadi dampak produksi bersyarat.
- **Perbaikan minimal:** jika API tetap didukung, paginasi full snapshot dengan cursor stabil atau return `truncated/nextCursor` dan cegah klien menandai snapshot parsial sebagai lengkap. Jika tidak didukung, tutup/nonaktifkan jalur atau tandai status API dengan jelas.
- **Verifikasi:** fixture 20.001+ produk, termasuk perubahan selama paging; pastikan semua produk tercakup atau respons eksplisit menyatakan parsial.
- **Kompleksitas:** Medium.

### POS-010 — Alat packaging Electron menarik `minimatch@10.2.6` yang terkena advisori DoS

- **Severity / prioritas:** Low / P3 untuk security supply chain build; tidak ditemukan jalur paket tersebut pada runtime kasir.
- **Confidence:** Confirmed oleh `pnpm audit` dan pohon dependensi.
- **Alur:** membangun paket desktop POS.
- **Lokasi:** `pos-electron/package.json` (`electron-builder` devDependency); rantai `electron-builder@26.18.0 → app-builder-lib → minimatch@10.2.6`.
- **Reproduksi/skenario:** `pnpm --dir pos-electron audit` keluar dengan satu temuan moderate; `pnpm --dir pos-electron why minimatch --depth 8` menemukan versi 10.2.6. Advisori menyatakan rentang terdampak `>=7.0.0 <11.0.1` dan pola glob input-kontrol dapat memperbesar pemakaian CPU/memori.
- **Expected vs actual:** proses packaging tidak memakai dependensi terdampak. Saat ini versi rentan berada di toolchain build, bukan dependency produksi ERP; saya tidak menemukan input glob dari pengguna pada alur POS runtime.
- **Akar masalah / dampak:** versi transitive `minimatch` dari builder berada di rentang rentan. Risiko praktis berpusat pada pipeline/build yang memproses pola tidak tepercaya atau build yang sengaja dimasukkan pola berbahaya.
- **Perbaikan minimal:** naikkan versi builder atau gunakan override transitive yang kompatibel ke versi patched `>=11.0.1`; jalankan ulang audit dan build installer Linux/Windows.
- **Verifikasi:** pastikan `pnpm why minimatch` tidak lagi menyertakan versi rentan pada jalur builder dan kedua target packaging lulus.
- **Kompleksitas:** Low–Medium.

## Status remediasi setelah revalidasi

| ID | Perubahan yang diterapkan | Hasil dan batas verifikasi |
|---|---|---|
| POS-002 | Review offline dibatasi 50 item dengan keyset cursor stabil; ringkasan antrean berupa aggregate; badge tidak lagi memuat seluruh row; payload lengkap hanya untuk supervisor; aksi posting mengambil satu target; indeks parsial pending dan indeks retur ada di migration 0088. | Unit cursor lulus. `pnpm db:generate` bersih. Migrasi belum diterapkan ke DB, query plan belum diukur. Retensi outbox tetap keputusan bisnis/audit dan belum diperbaiki. |
| POS-003 | Hapus load/sort antrean penuh pada setiap chunk; hitung antrean tersisa dan penunjuk tertua diperbarui dari hasil yang dihapus. | POS unit lulus. Satu snapshot penuh masih dibuat saat sinkronisasi dimulai, sehingga antrean sangat besar belum terbukti memenuhi batas memori/waktu. |
| POS-004 | Validasi batas query 80 karakter dan offset integer 0–100.000 sebelum query katalog. | Unit boundary/malformed lulus. Query masih memakai pola substring dan OFFSET; tidak ada benchmark DB saat ini. |
| POS-005 | Cache produk maksimal 1.200 item dan pin produk di halaman aktif/keranjang. | Unit eviction/pinning lulus. Fallback barcode tetap scan linear sampai 1.200 item. |
| POS-006 | Indeks `sale_returns(company_id, sale_id, created_at)` ditambahkan ke schema dan migration 0088. | Skema konsisten menurut `db:generate`; belum diaplikasikan atau diverifikasi dengan `EXPLAIN` pada DB disposable. |
| POS-007 | IndexedDB versi 2 menambah indeks per status/waktu dan scope terminal; claim melakukan pencarian serta update di satu transaksi read-write. | Unit tes adapter memory lulus; IndexedDB nyata, tab bersamaan, dan printer offline belum diuji. Metode eksplisit `list()` masih mengembalikan semua row, tanpa caller produksi yang ditemukan. |
| POS-008 | Timeout Electron mengembalikan hasil tidak pasti, mempertahankan job native sampai callback, meneruskan `failureReason`, dan meminta konfirmasi retry eksplisit. | Unit helper callback timeout/terlambat lulus; build Linux directory lulus. Uji Electron/printer fisik belum ada; retry yang dikonfirmasi manusia tetap dapat bertumpang tindih dengan job native yang terlambat. |
| POS-009 | API full snapshot memeriksa produk ke-20.001 dan menolak snapshot parsial dengan validasi eksplisit. | Unit batas lulus; respons pada DB 20.001 produk belum diuji. |
| POS-010 | Override dependency hanya pada rantai parent terdampak ke `minimatch@11.0.1`; build tooling dipertahankan di versi saat ini. | `pnpm --dir pos-electron audit --json`: nol advisori; dependency tree tidak lagi memuat minimatch 9/10; CLI builder dan packaging Linux berhasil. |
| POS-001 / SEC-001 | Tidak ada perubahan tambahan. | Regression tests PWA/cookie dan telemetry ikut suite yang lulus; runtime browser/API belum diuji. |

Exa MCP, Context7 MCP, dan Ponytail tidak tersedia pada koneksi aktif. Rekomendasi menggunakan dokumentasi resmi sebagai fallback: [PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html), [partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html), [EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html); [MDN IndexedDB object store](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore) dan [cursor](https://developer.mozilla.org/en-US/docs/Web/API/IDBIndex/openCursor); [MDN Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map); [OWASP API4:2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/); [Electron print callback](https://www.electronjs.org/docs/latest/api/web-contents/); dan [GitHub advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Tidak ada klaim riset Exa yang dibuat.

## Temuan lama yang diperiksa ulang

- **POS-001 — cookie request tidak tersedia bagi service worker:** kode saat ini memakai `cookieStore.get()` dan ID cache non-otorisasi di respons server; tes `pos-pwa-sw.test.ts` lulus. Temuan lama itu tampak **termitigasi di source dan unit test**, tetapi belum diuji ulang pada aplikasi/browser nyata. Dokumentasi offline menyatakan service worker hanya untuk secure context (HTTPS/localhost); deployment HTTP ke IP LAN memang tidak mendapat shell cache setelah reload.
- **SEC-001 telemetry POS:** implementasi saat ini membatasi body 8 KB, 32 field, 256 karakter per nilai, membuang field identitas/event dari input klien, lalu menulis identitas server. Unit test telemetry termasuk suite lulus; temuan lama tampak **termitigasi di source dan unit test**.
- **POS-002 outbox offline:** migration 0087 memberi indeks kunci klien/sesi dan remediasi menambahkan pagination, aggregate, lookup target tunggal, serta indeks pending. Baca seluruh queue untuk review sudah dihilangkan. Retensi belum ditentukan, jadi risiko pertumbuhan histori tetap terbuka.

## Kinerja pada data besar

| Ukuran/operasi | Hasil yang ada | Penilaian |
|---|---|---|
| 100k produk, POS grid kosong | p50 2,7 ms; p95 2,9 ms (benchmark dev 4 Nov 2026) | Baik untuk query awal historis; bukan end-to-end dan perlu diulang di hardware/database target. |
| 100k produk, pencarian POS kata | p50 177,8 ms; p95 187,4 ms (benchmark historis) | Terasa jika ditambah debounce, network, render. Konsisten dengan `%q%` di bawah RLS dan alasan indeks trigram tidak dipilih. |
| Halaman katalog dalam | p50 53,9 ms; p95 55,9 ms di hasil benchmark historis | OFFSET masih digunakan namun kini dibatasi sampai 100.000; angka itu bukan pengukuran pada batas baru atau runtime saat ini. |
| 1M produk, antrean offline besar, riwayat retur besar, backlog printer besar | Tidak ada pengukuran | Tidak boleh dianggap skalabel hanya dari 100k benchmark atau tes helper. |
| Checkout, sesi, retur pada banyak kasir | Tidak ada p50/p95, DB lock/wait atau test concurrency saat ini | Belum ada klaim kapasitas transaksi POS. |

Angka benchmark adalah bukti arsip dari environment PostgreSQL dev (100k produk), bukan baseline terkini atau SLA. PostgreSQL menganjurkan pemeriksaan rencana query terhadap bentuk data/role yang sesungguhnya; `EXPLAIN ANALYZE` pada role RLS produksi diperlukan sebelum memilih indeks.

## Tes dan pemeriksaan yang benar-benar dijalankan

- `pnpm exec vitest run tests/unit/pos-*.test.ts tests/unit/print-document-overrides.test.ts tests/unit/architecture-print-patterns.test.ts tests/unit/print-audit-compliance.test.ts --reporter=dot` — **32 test files passed, 179 tests passed**, 8,74 detik.
- `pnpm typecheck` — **lulus** (`tsc --noEmit`).
- ESLint scoped pada source POS, tes baru, dan Electron yang diubah — **lulus**.
- `git diff --check` — **lulus**, tidak ada whitespace error pada diff yang diperiksa.
- `pnpm audit --prod` (root ERP) — **No known vulnerabilities found**.
- `pnpm --dir pos-electron audit --json` — **0 advisori** setelah override POS-010; `pnpm --dir pos-electron why minimatch --depth 8` hanya menunjukkan 3.1.5, 5.1.9, dan 11.0.1; versi builder `26.18.0`.
- `pnpm db:generate` — **No schema changes, nothing to migrate** setelah migration 0088.
- `electron-builder --dir --linux` — berhasil membuat paket directory pada Linux; tidak membuktikan Windows installer atau cetak runtime.
- Tidak dijalankan: integration/DB tests, aplikasi lokal dengan DB disposable, E2E browser, browser matrix, concurrency/load tests, profil React, `EXPLAIN ANALYZE`, p95 runtime sekarang, percobaan jaringan/timeout nyata, atau cetak fisik. Tidak ada `.env.local` yang dibaca/digunakan oleh tes ini.

## Acuan yang dipakai

- Project docs: `pos-electron/README.md`, `pos-desktop/README.md`, `deploy/print/README.md`, `docs/OFFLINE_POS_ARCHITECTURE.md`, POS audit lama, dan `docs/sim2/S4-BENCHMARK.md`.
- [Electron `webContents.print`](https://www.electronjs.org/docs/latest/api/web-contents/) untuk callback `success`/`failureReason`, printer OS, dan ukuran halaman.
- [MDN `Window.afterprint`](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event) untuk semantik event sesudah mulai mencetak/preview ditutup; [MDN IndexedDB `getAll`](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/getAll) untuk hasil seluruh record dan clone ke memori.
- [MDN service worker registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register), [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), dan [CookieStore](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) untuk batas secure context/browser pada offline shell.
- [PostgreSQL 18 `EXPLAIN`](https://www.postgresql.org/docs/18/using-explain.html) untuk verifikasi query/index di skala representatif.
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) khususnya API4 Unrestricted Resource Consumption untuk validasi ukuran input, queue, dan pagination.
- [GitHub Advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) untuk temuan minimatch.

## Kesimpulan operasional

POS mempunyai dasar implementasi yang cukup baik untuk integritas checkout online. Remediasi yang didukung source sudah diterapkan dan pemeriksaan unit/type/lint/security dependency lulus. Temuan yang tersisa adalah retensi outbox tanpa kebijakan, biaya scan awal yang masih berbanding lurus dengan antrean lokal, serta belum adanya verifikasi DB/browser/printer nyata. Karena itu laporan ini tidak menyatakan POS bebas bug atau sesuai sertifikasi internasional. Sebelum klaim produksi, terapkan migrasi pada DB disposable lalu ukur query/lock/p95 pada volume representatif, jalankan concurrency dan browser multi-tab, dan cetak pada printer 58/80 mm serta koneksi LAN/Bluetooth/USB/Serial yang benar-benar didukung.
