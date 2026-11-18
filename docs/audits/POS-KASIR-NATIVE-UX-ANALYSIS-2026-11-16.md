# Audit POS Kasir — UI/UX, Workflow, Fungsi, dan Kinerja

**Tanggal:** 16 November 2026  
**Repository:** bisa-erp, HEAD 741a54b  
**Cakupan:** hanya POS kasir dan route pendukung POS.  
**Metode:** inspeksi read-only melalui CodeGraph, pemeriksaan kode terarah, rekonsiliasi dokumen audit POS, riset Exa pada dokumentasi resmi, dan review agen read-only.  
**Perubahan kode/database/konfigurasi:** tidak ada. **Tes/browser/perangkat fisik:** tidak dijalankan.

## Ringkasan eksekutif

POS saat ini sudah memiliki fondasi transaksi yang lebih lengkap dari tampilan kasir yang terlihat: katalog berpaginasi, barcode HID, quote server, keranjang desktop dua panel, keranjang ponsel, pembayaran tunggal/campuran, piutang, retur, void, sesi kas, cetak ESC/POS, dan antrean offline. Checkout online memakai validasi server dan idempotensi. Beberapa temuan audit lama sudah tampak diperbaiki dalam kode saat ini.

Risiko utama yang masih terbuka:

1. **Void tunai dapat selesai tanpa mutasi kas** jika sesi asal dan sesi pemroses sudah tutup.
2. **Tahan pesanan dapat dikirim ganda** karena setiap klik memakai kunci idempotensi berbeda dan tombol tidak dikunci selama request.
3. **Hold/resume kehilangan pelanggan dan termin**, walau aksi server mengembalikan customerId.
4. **Mode offline bukan katalog POS penuh offline**: antrean checkout ada, tetapi pencarian produk dan barcode tetap memakai server.
5. **Transaksi offline hanya mendapat toast sementara**, walau belum tercatat server dan belum punya nomor nota server.
6. **Pesanan tahan kasir lain dapat memblokir tutup sesi** karena jumlah tahan dihitung untuk seluruh perusahaan.
7. Toolbar masih memuat terlalu banyak status/perangkat dan kontrol. Pengguna sebelumnya meminta tombol **Tampilan** tetap terlihat, sedangkan label rutin “Scanner siap” dan “Sesi kas belum dibuka” tidak memenuhi toolbar.
8. Sejumlah kontrol sentuh kecil, panel bayar padat, dan sheet ponsel belum sepenuhnya mengelola fokus/scroll layaknya modal aplikasi.

Tidak perlu mengganti pola transaksi inti atau meniru semua fitur kompetitor. Pertahankan scan → keranjang → bayar → hasil; sederhanakan hierarki, tampilkan cabang lanjutan hanya saat diperlukan, jaga total dan Bayar terlihat, serta tutup risiko uang/konteks pesanan sebelum menambah fitur dekoratif.

Temuan High di bawah adalah temuan statis yang perlu diverifikasi dengan transaksi uji sebelum perbaikan. Tidak ada klaim bahwa semua route POS sudah diuji runtime.

## Kondisi repo dan batas bukti

- HEAD 741a54b; working tree berisi perubahan pengguna yang belum di-commit, termasuk perubahan UI POS, kategori pencarian, printer, checkout success, halaman offline, serta E2E/integration tests. Audit membaca kode on-disk; perubahan tersebut bukan dibuat oleh audit ini.
- CodeGraph dan dua review agen read-only menelusuri terminal, pembayaran, scanner, hold/resume, sesi, dan offline.
- Exa dipakai untuk mencari dan membaca dokumentasi resmi Accurate, Odoo 19, Square, Toast, Lightspeed Retail R-Series, Apple, Android, dan W3C.
- Context7 MCP tidak tersedia pada sesi ini. API/framework bukan fokus temuan; referensi workflow/desain diambil dari dokumentasi resmi.
- Tes/build, browser visual check, transaksi database, scanner HID, printer thermal, serta kondisi offline nyata tidak dijalankan. “Ada di kode” bukan bukti “terbukti runtime”.

## Inventaris route dan fitur POS

| Area POS | Route | Fitur yang ditemukan | Status audit |
|---|---|---|---|
| Terminal kasir | /app/pos | Katalog, pencarian, kategori, barcode, gudang, keranjang, grup harga, reservasi, pembayaran, hold/resume, status sync | Perlu improvement |
| Terminal alternatif | /app/pos/terminal | Route terminal | Belum diverifikasi sebagai pengalaman berbeda |
| Pesanan ditahan | /app/pos/ditahan | Daftar, lanjut, hapus, simpan keranjang aktif sebelum resume | Perlu improvement |
| Riwayat transaksi | /app/pos/riwayat | Cari/filter, detail, aksi retur/void | Ada; kebijakan visibilitas dan layar belum diverifikasi ulang |
| Nota/faktur | /app/pos/nota/[id], /faktur | Nota, cetak, cetak ulang/faktur | Ada; printer fisik dan semua isi struk belum diuji |
| Retur | /app/pos/retur | Pilih nota asal, retur sebagian/penuh, penyelesaian/refund | Ada; visual dan operasional fisik belum diuji |
| Sesi kas | /app/pos/sesi | Modal awal, pecahan, setor/tarik, hitung-tutup, selisih | Perlu improvement |
| Riwayat/detail sesi | /app/pos/sesi/riwayat, /[id], /cetak | Filter, detail kas, cetak | Ada; keluaran cetak/serah-terima belum diuji |
| Piutang POS | /app/pos/piutang, /cetak | Cari tagihan, terima pembayaran, cetak | Ada; error pelanggan dan keterbacaan belum diuji ulang |
| Peninjauan offline | /app/pos/offline | Konflik/gagal sync dan resolusi | Ada; konfirmasi belum setara checkout online |
| Terminal/perangkat | /app/pos/terminal | Kelola terminal/perangkat | Route ada; pairing multi-device belum diuji |
| Grup harga | /app/pos/grup | Daftar kelompok harga POS | Ada; perubahan total keranjang perlu konfirmasi |

### Matriks fitur yang ditemukan

| Fitur kasir | Implementasi saat ini | Status |
|---|---|---|
| Buka sesi/modal awal | Form sesi kas dan ringkasan | Perlu improvement |
| Barcode HID/pencarian | Fokus otomatis, scan burst/Enter, kecocokan eksak, produk langsung ke cart | Perlu improvement; scanner fisik belum diuji |
| Kamera barcode | Jalur terminal belum terbukti | Belum terverifikasi |
| Kategori produk | Chip kategori, filter server, pagination | Sesuai secara fungsi; visual belum diuji perangkat |
| Gambar/favorit | Kartu teks; favorit tidak tampak di terminal | Belum lengkap bila dibutuhkan toko |
| Satuan/kemasan | Kartu/keranjang mendukung satuan; barcode kemasan dipetakan | Perlu improvement sentuh |
| Grup harga | Select di cart dan server quote | Perlu improvement: konfirmasi perubahan total |
| Qty/hapus/diskon baris | Stepper, input qty, diskon persen/nominal, hapus | Perlu improvement: kontrol kecil, qty nol hapus tanpa undo |
| Modifier/catatan | Modifier restoran bukan alur inti; nomor seri per unit tersedia | Tidak perlu menambah modifier umum tanpa kebutuhan |
| Reservasi | Bisa memilih reservasi; transaksi bereservasi tak bisa antre offline | Perlu penjelasan saat offline |
| Tunai/kembalian | Nominal diterima, uang cepat, kembalian | Sesuai secara logika; fisik belum diuji |
| QRIS/non-tunai | Metode, QR statis toko, konfirmasi manual, referensi | Perlu improvement; bukan integrasi verifikasi QRIS |
| Campuran/split tender | Alokasi per metode dan validasi sisa/kembalian | Sesuai domain; UI padat |
| Utang pelanggan | Cari/tambah customer, jatuh tempo, nominal utang | Perlu improvement; konteks hold/resume |
| Kredit retur | Komponen ada di panel bayar | Ada; alur penuh perlu diuji |
| Hold/resume | Label, snapshot, grup harga, gudang, kemasan/diskon; simpan cart aktif | Bug/perlu improvement |
| Checkout sukses | Modal online dengan nota/cetak/transaksi baru | Sesuai untuk online; offline berbeda |
| Cetak struk | Browser/kiosk dan ESC/POS BT/USB/Serial | Belum diverifikasi fisik |
| Retur/void | Route dan aksi terhubung ke nota asal; permission/alasan | Perlu improvement: void cash |
| Tutup shift | Hitung buta dua tahap, pecahan, alasan selisih | Perlu improvement: hitung hold lintas kasir |
| Offline queue | IndexedDB, idempotency, cashier/session/device, batch 25, review conflict | Perlu improvement: search katalog dan konfirmasi offline |
| Customer display | Layar kedua terpisah tidak ditemukan | Belum lengkap; opsional |
| PIN supervisor | Permission ada; approval PIN di terminal tidak terlihat | Belum terverifikasi/belum ada |

## Jalur kode yang ditelusuri

- Halaman/data awal: **src/app/app/pos/page.tsx:21–57**
- Terminal/layout: **src/components/pos/pos-terminal.tsx:37–115, 301–325, 608–779**
- Katalog/scan/status/kategori: **src/components/pos/terminal/product-catalog.tsx:53–90, 146–229, 283–409, 480–630**
- Cart: **src/components/pos/cart-panel.tsx:37–57, 81–143, 177–362, 385–423**
- Pembayaran: **src/components/pos/payment-panel.tsx:40–92, 148–484**
- Rencana bayar: **src/components/pos/terminal/use-payment-plan.ts:11–100**
- Checkout: **src/components/pos/terminal/use-terminal-checkout.ts:105–205, 202–359**
- Scanner: **src/components/pos/use-barcode-scanner.ts:29–35, 50–159**
- Hold/resume: **src/components/pos/use-held-sales.ts:14–26, 81–104, 183–226, 233–270**; aksi server **src/server/actions/pos.ts:347–418**
- Sesi: **src/components/pos/session-manager.tsx:37–104**; domain **src/server/pos/sessions.ts:100–213, 129–135**
- Offline: **src/components/pos/use-offline-queue.ts:27–81**; queue checkout **src/components/pos/terminal/use-terminal-checkout.ts:105–205**; sinkron **src/server/pos-offline.ts:190–380**
- Preferensi display: **src/components/pos/pos-display.tsx:13–45, 58–99, 148–374**
- Hasil/cetak: **src/components/pos/terminal/checkout-success-modal.tsx:21–124, 126–217**; jalur printer **src/lib/escpos/printer-connection.ts:594**

## Temuan baru

### POS-NATIVE-01 — High — Void tunai dapat selesai tanpa mutasi kas

**Lokasi:** **src/server/pos/sales-void.ts**, recordVoidCashRefund sekitar baris 312–374; orkestrasi voidSale sekitar baris 21–95.

**Kondisi/bukti:** fungsi memilih sesi asal yang terbuka atau sesi aktif pemroses void. Bila keduanya tidak ada, refundSessionId tetap null. Void dan audit tetap berjalan; cash movement hanya dibuat bila sesi tujuan tersedia.

**Dampak:** transaksi bisa berstatus void sementara pengembalian tunai tidak tercermin di mutasi laci mana pun.

**Rekomendasi:** refund tunai harus punya sesi kas tujuan yang terbuka atau alur alternatif yang tercatat. Pembalikan jurnal saja bukan bukti uang dikembalikan.

**Kriteria penerimaan:** void tunai membuat mutasi refund di sesi sah atau ditolak dengan pesan/langkah supervisor; tidak ada void tanpa kas keluar yang bisa direkonsiliasi.

### POS-NATIVE-02 — High — Klik ganda Tahan dapat membuat dua pesanan tahan

**Lokasi:** **src/components/pos/use-held-sales.ts:183–225**; tombol dialog **src/components/pos/terminal-dialogs.tsx** sekitar baris 60.

**Kondisi/bukti:** setiap pemanggilan hold mengirim newUuid() sebagai idempotency key; fungsi tidak tampak memiliki lock/busy; audit terdahulu tidak menemukan disabled pada tombol selama request.

**Dampak:** double tap/jaringan lambat dapat menghasilkan dua request berbeda dan dua pesanan tahan.

**Rekomendasi:** kunci submit, pertahankan kunci retry yang sama, tampilkan “Menyimpan…”, dan jangan kosongkan cart sampai server sukses. Label otomatis harus tersedia.

**Kriteria penerimaan:** double tap/retry menghasilkan satu hold; bila gagal, dialog dan cart tetap; kasir bisa hold tanpa mengetik label wajib.

### POS-NATIVE-03 — Medium — Hold/resume kehilangan konteks customer dan jatuh tempo

**Lokasi:** **src/components/pos/use-held-sales.ts:14–26, 81–103, 183–209**; **src/server/actions/pos.ts:347–418**; domain **src/server/pos/sales-hold.ts:18–75**.

**Kondisi/bukti:** server mengembalikan customerId saat resume, tetapi ResumeData dan applyResume tidak menyimpan/memulihkan field tersebut. hold payload juga tidak mengirim customerId/due date; tanggal jatuh tempo tidak masuk ke data resume terminal.

**Dampak:** kasir memilih ulang pelanggan/termin, berisiko salah pelanggan atau memperlambat antrean.

**Rekomendasi:** simpan dan pulihkan customer, jatuh tempo, serta konteks transaksi yang relevan. Tampilkan customer pada daftar tahan.

**Kriteria penerimaan:** hold → reload → resume mempertahankan customer, termin, gudang, grup harga, unit, diskon, seri, dan snapshot total; data yang tak lagi valid meminta konfirmasi.

### POS-NATIVE-04 — Medium — Tahanan kasir lain memblokir tutup shift

**Lokasi:** **src/server/pos/sessions.ts:129–135, 349–354**; UI **src/components/pos/session-manager.tsx:81–104**.

**Kondisi/bukti:** penutupan mengunci sesi milik aktor tetapi menghitung semua held sales perusahaan. UI memblokir bila hitungan lebih dari nol.

**Dampak:** pesanan lama/kasir lain dapat menahan penutupan shift meski laci pemilik sesi sudah dihitung.

**Rekomendasi:** tetapkan kebijakan. Jika seluruh tahanan perusahaan memang memblokir, tampilkan pemilik, umur, pesanan, dan wewenang penyelesaiannya. Jika tidak, batasi hitung ke pemilik/sesi.

**Kriteria penerimaan:** tahanan Kasir A tidak diam-diam memblokir Kasir B; bila memang kebijakan, UI menyebut alasan dan tindakan.

### POS-NATIVE-05 — High — Sukses antre offline belum berarti penjualan posted

**Lokasi:** **src/components/pos/terminal/use-terminal-checkout.ts**, queueSaleOffline sekitar baris 105–205 dan cabang offline sekitar 269–275; indikator **src/components/pos/use-offline-queue.ts:27–81**.

**Kondisi/bukti:** saat IndexedDB menerima payload, UI memberi toast, mengosongkan cart, mengembalikan fokus. Belum ada nomor nota server atau mutasi server; sinkron masih bisa conflict/failed. Jalur online memakai checkout success modal.

**Dampak:** kasir dapat mengira transaksi sudah masuk laporan padahal pembayaran/barang sudah berpindah dan server belum mencatat.

**Rekomendasi:** tampilkan hasil offline persisten: “Tersimpan di perangkat — belum tercatat di server”, ID lokal, total/kembalian snapshot, kasir/perangkat/waktu, jumlah antrean, opsi bukti lokal, dan tindakan review. Jangan tampilkan nomor nota server sebelum posted.

**Kriteria penerimaan:** transaksi lokal tetap terlihat sesudah refresh; status berubah hanya setelah server mengonfirmasi; gagal/conflict tidak hilang; retry tidak menggandakan transaksi.

### POS-NATIVE-06 — Medium — Search/barcode katalog tetap membutuhkan server saat offline

**Lokasi:** **src/components/pos/terminal/use-product-search.ts:17–109**; awal **src/app/app/pos/page.tsx:21–57**; scan **src/components/pos/pos-terminal.tsx:301–325**.

**Kondisi/bukti:** halaman awal menerima 24 produk; pencarian dan barcode menjalankan searchProductsAction di server. Queue hanya menerima transaksi setelah produk masuk cart. Pencarian lokal untuk SKU yang belum dimuat tidak tampak.

**Dampak:** antre pembayaran offline tidak menjamin kasir bisa menjual seluruh katalog saat jaringan toko/server mati.

**Rekomendasi:** jika offline penuh adalah kebutuhan, sediakan katalog minimum lokal sesuai outlet/gudang dengan harga/unit versi terakhir dan umur data. Bila tidak, jelaskan bahwa offline terbatas pada produk yang sudah dimuat.

**Kriteria penerimaan:** scan produk di snapshot lokal bekerja tanpa jaringan; produk di luar snapshot memberi pesan jelas; harga/stok lama ditandai untuk review saat sync.

### POS-NATIVE-07 — Medium — Storage antrean dapat fallback ke memori yang hilang saat reload

**Lokasi:** **src/lib/pos/pos-offline.ts:120–170** dan pemakaian getBrowserOfflineStorage di checkout/sinkron.

**Kondisi/bukti:** ada IndexedDbOfflineStorage dan MemoryOfflineStorage. Fallback memory tidak tahan reload/penutupan tab.

**Dampak:** kasir dapat menerima status tersimpan sementara, padahal transaksi hanya ada di memori proses browser.

**Rekomendasi:** jangan mengakui antrean tahan lama bila storage yang digunakan hanya memory. Blokir mode offline atau tampilkan peringatan/alternatif recovery.

**Kriteria penerimaan:** status “tersimpan lokal” hanya setelah IndexedDB mengonfirmasi write; bila storage gagal, cart tetap utuh dan UI menjelaskan tindakan.

### POS-NATIVE-08 — Medium — Scan saat input lain fokus dapat mengubah field yang sedang diedit

**Lokasi:** **src/components/pos/use-barcode-scanner.ts:29–35, 108–159**.

**Kondisi/bukti:** capture scanner global aktif ketika sesi buka. Beberapa input dikecualikan, tetapi komentar scanner menyebut karakter awal dapat masuk ke input lain sebelum burst dikenali.

**Dampak:** scan ketika fokus pada jumlah/nominal dapat mengubah nilai input atau memicu validasi lebih awal.

**Rekomendasi:** batasi scanner ke area katalog atau simpan/pulihkan nilai input dengan aman ketika burst terdeteksi.

**Kriteria penerimaan:** scan pada fokus jumlah, uang diterima, nomor seri, dialog, dan cari tidak mengubah nilai lain; kode tak dikenal hanya memberi satu pesan.

### POS-NATIVE-09 — Medium — Toolbar mencampur kerja rutin, status, dan pengaturan

**Lokasi:** **src/components/pos/terminal/product-catalog.tsx:146–350**; display **src/components/pos/pos-display.tsx:184–219**; menu **src/components/pos/pos-action-menu.tsx:32–122**.

**Kondisi/bukti:** flex-wrap toolbar memuat pencarian, gudang, reservasi, sesi, jaringan/antrean, sinkron, printer, layar penuh, Tampilan, bantuan, dan Lainnya. Pengguna meminta Tampilan tetap terlihat dan status rutin scanner/sesi dihilangkan dari baris utama.

**Dampak:** kontrol admin berkompetisi dengan pencarian yang paling sering dipakai dan mengurangi tinggi katalog. Label Scanner siap tidak membuktikan perangkat HID benar-benar tersambung.

**Rekomendasi:** baris utama: cari/scan, gudang, Tampilan, Lainnya. Status printer/sync jadi indikator kecil; sesi belum dibuka muncul saat menjadi blocker dengan tombol Buka sesi. Jangan mengklaim status hardware scanner tanpa handshake.

**Kriteria penerimaan:** pada 390px dan tablet portrait, pencarian dan Tampilan terlihat tanpa scroll horizontal; status error punya tindakan langsung; status rutin tidak membungkus toolbar.

### POS-NATIVE-10 — Medium — Sheet ponsel belum mengelola scroll/fokus dan ditutup sebelum checkout selesai

**Lokasi:** **src/components/pos/pos-terminal.tsx:658–676, 753–763**; cart scroll **src/components/pos/cart-panel.tsx:142**; bar **src/components/pos/terminal/mobile-pay-bar.tsx:14–70**.

**Kondisi/bukti:** cart mobile berupa aside fixed tanpa dialog/focus management; aside dan cart list sama-sama dapat scroll. Bottom pay menutup sheet sebelum menjalankan checkout.

**Dampak:** gesture scroll membingungkan, fokus dapat masuk ke konten belakang, dan kegagalan checkout menghilangkan konteks panel.

**Rekomendasi:** gunakan Dialog/Sheet proyek, satu area scroll, header/total/bayar tetap. Tutup hanya setelah sukses; saat gagal pertahankan input pembayaran/customer/cart.

**Kriteria penerimaan:** satu scroll utama, fokus terkelola, Escape/close konsisten, dan checkout gagal tidak menutup atau menghapus state.

### POS-NATIVE-11 — Medium — PaymentPanel terlalu padat untuk penjualan rutin

**Lokasi:** **src/components/pos/payment-panel.tsx:148–484**; logika **src/components/pos/terminal/use-payment-plan.ts:11–100**.

**Kondisi/bukti:** satu panel memuat mode tunggal/campuran, tunai, QRIS, konfirmasi non-tunai, referensi/fee, kredit retur, customer, jatuh tempo, quote/error, bayar, tahan. Mode memiliki label kecil dan cabang lanjutan bisa mendorong informasi penting ke bawah.

**Dampak:** kasir tunai memilah banyak kontrol yang tidak relevan; alasan Bayar nonaktif dan quote dapat kurang terbaca.

**Rekomendasi:** jalur tunai normal ringkas. Tampilkan QRIS, referensi, mix, piutang, kredit retur, fee secara kondisional tanpa menyembunyikan total/sisa. Tampilkan alasan disabled di dekat Bayar.

**Kriteria penerimaan:** pembayaran tunai normal cukup pilih/tinjau jumlah dan bayar; QRIS manual jelas memerlukan verifikasi kasir; piutang meminta customer/termin; mix menunjukkan sisa dan kembalian; tidak ada field irrelevant yang mengambil ruang.

### POS-NATIVE-12 — Medium — Ukuran target sentuh dan teks kerja belum konsisten

**Lokasi:** **payment-panel.tsx:154–169, 220–260, 457–473**; **cart-panel.tsx:112–127, 201–220, 236–362**; **product-catalog.tsx:605–625**; **pos-display.tsx:216–374**.

**Kondisi/bukti:** pencarian, kategori, metode bayar, Bayar dan stepper mendekati 44px. Select grup harga sekitar 32px, select unit sekitar 28px, pagination sekitar 32px, dan sejumlah label 10–11px. Ini inspeksi kelas CSS; kontras belum diukur.

**Dampak:** tindakan satu tangan (unit, diskon, tutup) lebih sulit saat antre; status risiko mudah terlewat.

**Rekomendasi:** target desain 44–48px untuk aksi sentuh utama/sering, jarak cukup, teks 10–11px hanya untuk metadata. Status stok/error/kembalian/sync dibuat mudah dibaca dan tidak hanya dibedakan dengan warna.

**Kriteria penerimaan:** tidak ada aksi inti di bawah 44px kecuali ada kontrol alternatif besar; teks status risiko lulus kontras dan keterbacaan perangkat.

### POS-NATIVE-13 — Medium — Preferensi display global dan default warna kategori berbeda

**Lokasi:** **src/components/pos/pos-display.tsx:29–43, 58–87**.

**Kondisi/bukti:** preferensi memakai satu key localStorage bisa.pos.display tanpa company/user/device. POS_DISPLAY_DEFAULTS.colorByCategory false, tetapi readPrefs() memakai true bila objek lama tidak punya field itu.

**Dampak:** kasir/outlet pada browser bersama berbagi layout; data lama bisa menampilkan warna berbeda dari default baru.

**Rekomendasi:** satukan default dan simpan per terminal/perusahaan atau kasir sesuai kebijakan. Sediakan preset Kasir Cepat, Sentuh Besar, Daftar; warna tetap untuk status penting, bukan dekorasi kategori.

**Kriteria penerimaan:** instalasi baru/data setting lama menghasilkan default konsisten; reset kembali ke preset yang tepat; setting kasir lain tidak berubah.

### POS-NATIVE-14 — Medium — Modal awal sesi terisi 500.000

**Lokasi:** **src/components/pos/session-manager.tsx:47–78**.

**Kondisi/bukti:** state uang awal adalah string 500000 dan dapat dipakai bila kasir tidak meninjau nilainya.

**Dampak:** sesi dapat dibuka dengan modal yang tidak sesuai laci dan membuat rekonsiliasi selisih salah.

**Rekomendasi:** default nol atau kebijakan outlet yang eksplisit; minta tinjauan sebelum buka; bila memakai nilai terakhir, sebut “nilai sebelumnya”.

**Kriteria penerimaan:** modal kas ditinjau secara eksplisit, tidak tampak seperti kas terhitung, dan audit mencatat nominal/pelaku.

### POS-NATIVE-15 — Low — Semantik pilihan, menu, dan dialog belum seragam

**Lokasi:** **payment-panel.tsx:154–217**; **pos-action-menu.tsx:46–62, 124–163**; **terminal-dialogs.tsx**.

**Kondisi/bukti:** mode/metode terlihat eksklusif tetapi semantik pilihan keyboard/screen reader belum terkonfirmasi. Menu POS ditandai menu/menuitem, sementara keyboard yang terlihat terutama Escape. Audit lama tidak menemukan focus trap/pemulihan fokus pada hold/resume custom dialog.

**Dampak:** status pilihan dan lokasi fokus kurang jelas bagi kasir keyboard/assistive tech.

**Rekomendasi:** gunakan Dialog/RadioGroup/Toggle primitive proyek, status pilihan aksesibel, focus management, Escape, pemulihan fokus; tautan biasa memakai semantik list/link.

**Kriteria penerimaan:** transaksi dapat dilakukan keyboard; status metode dibacakan; dialog mengunci fokus dan mengembalikannya; warna bukan satu-satunya penanda.

### POS-NATIVE-16 — Low — Label item/baris ambigu

**Lokasi:** **src/components/pos/terminal/mobile-pay-bar.tsx:24–34**; **src/components/pos/cart-panel.tsx:81–88**.

**Kondisi/bukti:** desktop menyebut jumlah “baris”, ponsel menyebut “item”; satu baris bisa berisi banyak unit.

**Rekomendasi/kriteria:** bedakan jumlah SKU dan unit, misalnya “3 produk · 7 unit”, konsisten di semua viewport.

## Workflow yang disarankan

### Jalur normal

1. Buka sesi hanya jika belum ada; tampilkan satu aksi jelas. Sesudah dibuka, fokus kembali ke scan.
2. Scan/cari; hasil barcode tunggal langsung masuk cart. Barcode kemasan memilih unit yang sesuai. Feedback singkat, tanpa dialog.
3. Cart desktop/tablet landscape selalu terlihat; ponsel menampilkan bar jumlah/total dan membuka sheet saat ditinjau.
4. Bayar tunai/metode favorit sebagai jalur utama; total, uang diterima, kembalian lebih menonjol daripada metadata.
5. Setelah server sukses, tampilkan pembayaran berhasil, nomor nota, total/dibayar/kembalian. Aksi utama Cetak struk; selanjutnya Transaksi baru; detail nota tetap tersedia. Gagal cetak tidak membatalkan penjualan.
6. Transaksi baru membersihkan data transaksi, mempertahankan gudang/setting aman, dan memfokuskan scanner.

Target alur kasir: scan → cart → bayar → hasil tanpa berpindah halaman. Ini sasaran untuk diuji, bukan hasil pengukuran saat ini.

### Cabang edge case

- **Tunai:** uang pas cepat; kembalian besar dan jelas untuk uang lebih; jangan hitung kembalian pada QRIS/transfer.
- **QRIS/non-tunai:** QR statis berarti kasir memverifikasi pembayaran di aplikasi luar dan mengonfirmasi manual. Bedakan dari integrasi provider yang memberi status otomatis.
- **Campuran:** setiap metode menunjukkan nominal, sisa, dan kembalian tunai; kelebihan non-tunai ditolak/dijelaskan sebelum submit.
- **Utang:** tampilkan customer/jatuh tempo/saldo hanya ketika utang dipilih; simpan konteks saat hold/resume.
- **Hold/resume:** label otomatis; tampilkan pemilik/waktu/jumlah baris/total/customer; jika cart aktif akan diganti, beri opsi simpan yang jelas.
- **Harga/stok berubah:** tampilkan nilai sebelum/sesudah; jangan ubah total diam-diam.
- **Stok habis:** blokir sesuai kebijakan; bila override supervisor ada, minta otorisasi dan catat.
- **Retur/void:** mulai dari nota asal, batasi kuantitas tersisa, konfirmasi metode refund; refund tunai terhubung ke sesi kas.
- **Tutup sesi:** hitung buta dahulu, lalu perbandingan dan alasan; kebijakan hold yang memblokir harus menyebut pemilik.
- **Offline:** status “belum tercatat server”; tampilkan antrean/umur/gagal. Jangan mengklaim katalog penuh offline bila lookup membutuhkan server.
- **Scanner:** jangan tampilkan hardware connected tanpa handshake; cegah karakter barcode masuk ke field yang sedang diedit.

## Redesign layar

### Desktop/tablet landscape

- Header satu baris: **Cari/scan** paling lebar, **Gudang**, **Tampilan** (tetap terlihat), **Lainnya**. Printer/sync sebagai indikator kecil.
- Katalog kiri sekitar 58–62%; cart kanan 38–42% dengan lebar cukup untuk nama, kuantitas, nominal; total dan Bayar tetap.
- Kategori pada chip horizontal yang dapat digeser, bukan membungkus toolbar.
- Kartu produk: nama maksimal dua baris, harga, satu badge stok/unit. SKU/kemasan opsional lewat Tampilan.
- Warna netral default; warna hanya menandai stok/status/pilihan. Gambar opsional, tidak menggantikan nama/harga.
- Satu scroll produk dan satu scroll cart; total/bayar tidak hilang.

### Tablet portrait/ponsel

- Katalog prioritas; bar bawah berisi jumlah produk/unit, total, dan Keranjang/Bayar.
- Keranjang/payment dalam Dialog/Sheet terkelola dengan satu area scroll, header tutup, total dan bayar lengket.
- Checkout gagal mempertahankan sheet dan nilai.
- Uji 320/390/768px portrait dan 1024px+ landscape; tanpa scroll horizontal atau kontrol terpotong.

### Tampilan yang bisa dikustom

Tombol Tampilan selalu tampak. Sheet pengaturan memuat preset Kasir Cepat, Sentuh Besar, Daftar; pilihan kolom, density, font, lebar cart, grid/list; visibilitas SKU/stok/kemasan/kategori; gambar dan warna kategori opsional; reset preset yang konsisten. Simpan per terminal/perusahaan atau per kasir sesuai penggunaan perangkat bersama.

## Kinerja, keamanan, dan batas desain

- Katalog sudah server pagination 24 item per halaman dan filter kategori/gudang. Jangan memuat seluruh daftar produk ke browser.
- Audit POS lama mencatat pencarian sekitar 180 ms pada 100 ribu produk; angka itu tidak diukur ulang dan tidak mewakili perangkat kasir saat ini. Ukur p50/p95 scan-to-cart, pencarian, quote, checkout dan sync pada katalog 10 ribu produk.
- Offline sync saat ini dibagi ke batch 25, mencatat asal kasir/sesi/perangkat, membandingkan snapshot total dengan quote kini, dan mengirim konflik ke review. Pertahankan idempotensi; jangan menambah concurrency tanpa uji urutan/duplikasi.
- Search/scan tetap server-side; katalog lokal dibutuhkan untuk kemampuan offline yang benar-benar penuh.
- Server quote/checkout menjadi sumber harga. Pembayaran non-tunai kini membutuhkan konfirmasi manual; tidak ada bukti gateway/callback otomatis.
- CostPrice difilter dengan permission inventory.cost dan unitCost quote disaring bagi kasir tanpa izin. voidReceivablePaymentAction sekarang memakai pos.void. Pertahankan minimal payload dan pemeriksaan permission server.
- Jangan sebut offline penuh selama katalog, pembayaran QRIS/provider, atau penyelesaian transaksi masih membutuhkan server.
- Printer ESC/POS dan browser ada, tetapi koneksi fisik, permission browser, spooler Ubuntu, ukuran kertas, cut, glyph Rupiah, duplikat cetak belum diuji. Jika aplikasi tidak mendapat status sensor printer, gunakan status “terkirim—periksa keluaran”, bukan “tercetak sukses”.
- Audit ini tidak melakukan profiling CPU/network/render.

## Rekonsiliasi temuan lama

Status dibandingkan dengan kode on-disk yang dibaca. “Belum diverifikasi ulang” berarti audit ini belum menguji semua route/runtime.

### Review workflow 16 November

| ID lama | Status | Catatan |
|---|---|---|
| POS-WF-01 Hold bisa berulang | Masih terjadi | use-held-sales.ts:183–225; lock/busy tidak tampak |
| POS-WF-02 Dialog tanpa manajemen fokus | Masih terjadi secara statis | terminal-dialogs.tsx custom overlay; focus trap/pemulihan belum terbukti |
| POS-WF-03 Label hold wajib manual | Masih terjadi | use-held-sales.ts:188–190 |
| POS-WF-04 Offline sukses tidak setara online | Masih terjadi | offline toast/queue, online success modal |

### POS2-01 sampai POS2-31

| ID | Status terbaru | Catatan |
|---|---|---|
| POS2-01 Bayar aktif tanpa quote valid | Sudah diperbaiki di kode | payDisabled menahan quote kosong/loading/error, sesi tertutup, atau pembayaran tak valid |
| POS2-02 Resume menimpa cart aktif | Sebagian diperbaiki | cart aktif dapat disimpan; customer/termin masih hilang |
| POS2-03 Scanner tidak global/format alfanumerik | Sebagian diperbaiki | capture global dan burst scan ada; input leakage/perangkat belum diuji |
| POS2-04 Dua panel hanya di layar sangat lebar | Sudah diperbaiki di kode | layout dua panel mulai breakpoint lg |
| POS2-05 Non-tunai tanpa konfirmasi/referensi | Sebagian diperbaiki | konfirmasi dan reference input ada; gateway tidak terbukti |
| POS2-06 Stok baru diketahui gagal saat checkout | Sebagian diperbaiki | katalog menandai/hide stok habis; balapan stok tetap perlu uji |
| POS2-07 Offline tidak mencari produk penuh | Masih terjadi sebagian | queue ada; search/barcode tetap server-side |
| POS2-08 Tutup sesi tanpa hitung buta | Sudah diperbaiki di kode | SessionManager punya tahap hitung lalu tinjau/alasan |
| POS2-09 Shortcut terbatas | Sebagian diperbaiki | useTerminalShortcuts dipasang; pemetaan belum divalidasi perangkat |
| POS2-10 Search tanpa pilihan eksplisit/kategori | Sebagian diperbaiki | highlight keyboard dan kategori ada; favorit belum terlihat |
| POS2-11 Hapus tanpa konfirmasi/undo | Sebagian diperbaiki | Kosongkan punya confirm; undo saat qty nol belum terbukti |
| POS2-12 Input angka sentuh | Belum diverifikasi ulang | perlu uji tablet tanpa keyboard |
| POS2-13 Target sentuh kecil | Sebagian diperbaiki | kontrol utama besar; select/pagination/detail tetap kecil |
| POS2-14 Struk kurang tender/referensi/NPWP | Belum diverifikasi ulang | periksa semua template setelah perubahan printer |
| POS2-15 Hasil cari retur terbatas/teks jumlah | Belum diverifikasi ulang | route retur tidak diuji ulang |
| POS2-16 Form retur tanpa ringkasan konfirmasi | Belum diverifikasi ulang | perlu uji layar dan submit |
| POS2-17 Panel piutang/error cari pelanggan | Sebagian/belum diverifikasi | panel debt ada; error vs tidak ditemukan/saldo belum diuji ulang |
| POS2-18 Busy/error route pendukung | Belum diverifikasi ulang | route riwayat, retur, tahan, sesi, piutang |
| POS2-19 Dialog/prompt belum aksesibel | Sebagian/belum diverifikasi | checkout memakai Dialog; hold/resume custom |
| POS2-20 Review offline kurang detail | Belum diverifikasi ulang | layar ada; kecukupan informasi kasir belum diuji |
| POS2-21 Riwayat sesi kurang sebagai serah-terima | Belum diverifikasi ulang | laporan cetak belum diuji |
| POS2-22 Teks status 9–11px | Masih terjadi sebagian | masih ada label kecil pada metode/status/metadata |
| POS2-23 Token warna custom | Belum diverifikasi ulang | butuh audit visual semua route |
| POS2-24 Status sesi selalu hijau/entry sesi tersembunyi | Sebagian diperbaiki | status kini ditampilkan; pengguna meminta agar tidak memenuhi toolbar |
| POS2-25 Daftar tahan tanpa cari/paging/pemilik | Belum diverifikasi ulang | route tahan tidak ditinjau penuh |
| POS2-26 Cetak ulang tanpa label/status retur | Belum diverifikasi ulang | isi nota pasca perubahan belum diuji |
| POS2-27 Struk tidak memakai SKU/QR hanya nomor | Belum diverifikasi ulang | perlu validasi template |
| POS2-28 Preferensi global browser | Masih terjadi | satu localStorage key global di pos-display.tsx |
| POS2-29 Ubah gudang/grup mengubah total tanpa konfirmasi | Belum diverifikasi ulang | perlu cek confirmation saat quote berubah |
| POS2-30 Modal awal otomatis/tabel sesi lebar | Masih terjadi sebagian | default 500.000 masih ada; riwayat perlu uji kecil |
| POS2-31 Hasil checkout lemah | Sudah diperbaiki online | success modal online; offline belum setara |

### POS3-01 sampai POS3-18

| ID | Status terbaru | Catatan |
|---|---|---|
| POS3-01 Queue >50 gagal sync | Sudah diperbaiki di kode | use-offline-queue memecah batch 25 |
| POS3-02 Sale offline atas nama penyinkron | Sudah diperbaiki di kode | origin cashier dan izin asal diperiksa |
| POS3-03 Sesi asal offline tutup | Sebagian diperbaiki | item masuk review; penyelesaian kas final perlu uji |
| POS3-04 Harga berubah saat sync | Sudah diperbaiki di kode | snapshot dibanding quote dan konflik direview |
| POS3-05 Review queue mengganda | Sudah diperbaiki di kode | pending lama disupersede untuk clientKey |
| POS3-06 Kasir membuang satu-satunya jejak gagal | Sudah diperbaiki di kode | aksi resolve dan kolom aksi halaman review memakai pos.void |
| POS3-07 Gangguan di tengah checkout tak masuk queue | Sudah diperbaiki di kode | queue dipanggil sebelum request saat offline dan ketika checkout melempar |
| POS3-08 Bukti offline persisten tidak ada | Masih terjadi | toast menghilang; belum ada success offline dengan ID lokal |
| POS3-09 Memory fallback/profil browser | Sebagian masih terjadi | IndexedDB ada; memory bukan storage tahan refresh |
| POS3-10 Harga pokok bocor ke payload kasir | Sudah diperbaiki di kode | includeCost dan quote unitCost difilter permission |
| POS3-11 Void penerimaan piutang memakai pos.sell | Sudah diperbaiki di kode | action memakai pos.void |
| POS3-12 Approval PIN supervisor | Belum diverifikasi/fitur tak tampak | putuskan perlu atau gunakan approval login supervisor teraudit |
| POS3-13 Hold lintas kasir dapat dihapus tanpa audit | Belum diverifikasi ulang | cek owner/delete/audit action |
| POS3-14 Riwayat semua kasir terlihat | Belum dipastikan sebagai bug | keputusan kebijakan toko diperlukan |
| POS3-15 Pencarian sekitar 180ms/100k | Belum diukur ulang | pagination membantu; angka lama bukan hasil audit kini |
| POS3-16 Sync sekuensial | Perlu improvement jika antrean besar | batch 25 ada; jangan ubah tanpa ukur/tes |
| POS3-17 Tanggal posting periode tutup | Sebagian diperbaiki di kode | resolvePostingDates ada; review dan report fiskal perlu uji |
| POS3-18 Klasifikasi konflik serial/batch | Belum diverifikasi ulang | uji konflik dan bedakan retryable/permanent |

## Urutan tahap improvement

### P1 — risiko uang/kehilangan pekerjaan

1. Tutup celah mutasi kas pada void tunai.
2. Lock hold dan gunakan idempotency key stabil sepanjang retry.
3. Beri status offline persisten dan jamin storage tahan reload.
4. Simpan/pulihkan customer dan termin saat hold/resume.
5. Pastikan stok/harga/sesi/error tidak menghilangkan transaksi atau memberi kesan already-posted.

### P2 — jalur kasir sehari-hari

1. Rapikan toolbar: Cari/scan, Gudang, Tampilan, Lainnya.
2. Buat bayar progresif; jalur tunai tetap ringkas.
3. Perbaiki sheet ponsel: fokus, satu scroll, tetap terbuka saat gagal.
4. Besarkan kontrol sentuh dan teks status operasional.
5. Putuskan kebutuhan katalog offline lokal.
6. Tetapkan policy tahan lintas kasir/tutup sesi, tampilkan pemilik/umur.
7. Tinjau default modal sesi 500.000.
8. Namespace preferensi display dan samakan default warna.

### P3 — setelah transaksi dan kas aman

1. Preset Tampilan per perangkat/kasir.
2. Favorit/produk populer berdasarkan kebutuhan terukur.
3. Customer display bila toko memakai layar kedua.
4. Shortcut tambahan, reduced-motion, suara/haptic bila perangkat mendukung.
5. Gambar produk opsional tanpa membebani jaringan.
6. Modifier/resep hanya untuk produk yang benar-benar membutuhkannya.

## Kriteria penerimaan sebelum POS dinyatakan siap kasir

- Scan barcode satu kali menambah produk/kemasan tepat satu kali dan siap untuk scan berikutnya; field lain tidak berubah.
- Tablet landscape menampilkan katalog + cart bersama dan total/Bayar tetap terlihat. Ponsel memakai sheet terkelola yang tetap terbuka jika checkout gagal.
- Setiap jalur bayar menampilkan total/sisa/kembalian; QRIS tidak disebut otomatis terverifikasi tanpa integrasi.
- Checkout online memberi nomor transaksi dan opsi cetak/baru. Offline hanya berlabel tersimpan lokal/belum posted sampai server mengonfirmasi.
- Retry, double tap, refresh tidak menggandakan hold/transaksi dan tidak menghapus antrean.
- Hold/resume mempertahankan customer/termin, harga, unit, diskon, seri, gudang, dan snapshot.
- Refund/void tunai selalu dapat direkonsiliasi ke sesi sah.
- Tahanan Kasir A tidak memengaruhi Kasir B kecuali kebijakan toko menyatakan demikian dengan penjelasan.
- Semua alur utama dapat disentuh/keyboard; target utama 44–48px; kontras teks normal minimal 4.5:1, large text minimal 3:1.
- Uji browser manual 320/390px, 768px portrait, 1024px landscape, 1280px desktop; uji USB-HID, printer aktual, jaringan lokal/server putus-reconnect, dan role kasir/supervisor. Belum dilakukan pada audit ini.

## Referensi riset resmi

| Sumber | Pelajaran yang dipakai |
|---|---|
| [Accurate POS — Membuat pesanan baru](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/pesanan-baru/membuat-pesanan-baru/) | Pilih barang, jumlah/satuan/diskon, bayar, customer opsional, metode, selesai. Referensi alur ringkas, bukan alasan menyalin semua fitur. |
| [Accurate POS — fitur/release notes](https://accurate.id/download/pos/) | Product page menyebut offline/local network, split payment, shift, permission, reprint, retur, multi-unit dan hardware. Klaim produk, bukan spesifikasi UI atau bukti kualitas. |
| [Accurate — manajemen karyawan POS](https://accurate.id/pos/fitur/management-karyawan/) | Role kasir/supervisor, PIN, shift, modal awal, akses sensitif. Dipakai sebagai pola izin, bukan keharusan menambah PIN. |
| [Odoo 19 — Workflow POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html) | Register, produk/cart/numpad, customer opsional, payment/validate, receipt, order/refund pada register. |
| [Odoo 19 — Products](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/products.html) | Kategori, unit/packaging, info stok/produk, gambar opsional. |
| [Odoo 19 — Payment methods](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/payment_methods.html) | Tunai, terminal kartu, customer account dan QR mengikuti konfigurasi payment method/journal. |
| [Odoo 19 — Receipts](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use/receipts.html) | Nomor nota, kasir/customer, item, diskon, harga, metode bayar, auto-print dan reprint. |
| [Odoo 19 — Customer display](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/hardware_network/customer_display.html) | Layar kedua opsional menampilkan item/harga/diskon/pajak/metode/kembalian. |
| [Lightspeed Retail R-Series — Sales screen](https://retail-support.lightspeedhq.com/hc/en-us/articles/360035206534-Using-the-Retail-POS-R-Series-Sales-screen) | Scan/search → cart → payment → finish → receipt. Referensi khusus R-Series. |
| [Lightspeed Retail R-Series — barcode scanner](https://retail-support.lightspeedhq.com/hc/en-us/articles/1260801415749-Setting-up-your-barcode-scanner) | USB scanner dapat berperilaku sebagai keyboard tanpa driver; tetap perlu uji perangkat toko. |
| [Lightspeed Retail R-Series — refunds and exchanges](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging) | Refund sebaiknya terkait penjualan asal; bedakan void sebelum selesai dari refund setelah transaksi. |
| [Square — offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode) | Transaksi offline pending, beberapa metode tak tersedia, sync berbatas waktu. Kebijakan Square tidak diterapkan mentah; pelajaran utama status dan risiko harus jelas. |
| [Square — customer-facing Register flow](https://squareup.com/help/us/en/article/6255-x2-accept-payments-on-your-square-register) | Scan/pilih, ubah qty, charge, tunggu konfirmasi, receipt/display pelanggan. |
| [Toast — offline payments overview](https://doc.toasttab.com/doc/platformguide/platformOfflinePaymentsOverview.html) | Metode tersedia/tidak tersedia dibedakan dalam offline mode. |
| [Toast — offline mode](https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html) | Offline membatasi sync/perangkat/metode; pesan offline harus memberi instruksi konkret. Konteks restoran, bukan desain wajib minimarket. |
| [Apple — UI Design Dos and Don’ts](https://developer.apple.com/design/tips/) | Apple menyarankan target 44×44 pt, layout muat layar, teks sekitar 11pt ke atas, dan kontras kuat. |
| [Android Accessibility — touch target](https://support.google.com/accessibility/android/answer/7101858?hl=en) | Android menyarankan target sentuh interaktif 48×48 dp. |
| [W3C WCAG 2.2 — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | WCAG AA minimum pointer target 24×24 CSS px dengan pengecualian/spacing; target POS kasir sebaiknya lebih besar. |
| [W3C WCAG 2.2 — Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Kontras teks normal minimal 4.5:1; large text minimal 3:1. Belum diukur pada tema POS ini. |

## Belum dapat diverifikasi

- Visual pada resolusi/tablet/ponsel, kontras numerik, keterbacaan dari posisi kasir.
- Keyboard/screen reader dan focus trap setiap dialog.
- Scanner HID toko: jenis kode, suffix Enter/Tab, latency, dan fokus pada input nominal.
- Printer thermal Ubuntu: izin browser, spooler, paper width/cut, glyph Rupiah, cetak duplikat, status fisik.
- QRIS: gateway/callback otomatis atau QR statis dan konfirmasi manual.
- Offline multi-terminal, reload/restart, IndexedDB quota/unavailable, sesi tutup, harga/stok berubah, serial/batch, periode fiskal, review supervisor.
- Transaksi bersamaan dan kas fisik untuk hold, tutup sesi, refund/void, sinkron.
- Visual seluruh route pendukung piutang, retur, riwayat, sesi, hold, offline, printer, terminal admin.
- Performa terkini; angka benchmark lama 180 ms/100k tidak dijalankan ulang.

