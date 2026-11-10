# POS-2 — Audit UI/UX & Workflow Kasir Bisa ERP

Tanggal: 2026-11-04  
Sifat: **BACA-SAJA** — inspeksi kode, tanpa perubahan aplikasi, tanpa commit.  
Lingkup: terminal kasir, pencarian/barcode, keranjang, pembayaran, utang, retur/void, sesi kas, struk, halaman pendukung POS, responsivitas, target sentuh, konsistensi desain, keadaan kosong/error/loading, keyboard, dan aksesibilitas dasar.

Acuan pola kerja: alur cepat Odoo POS dan Square (scan → bayar → selesai tanpa berpindah konteks), serta pola aplikasi kasir Indonesia seperti Moka/Pawoon (katalog mudah dikenali, tombol uang jelas, sesi dan struk menjadi bagian dari alur harian). Acuan internal: `PageHeader`, `StatCard`, `StatusBadge`, `EmptyState`, `SearchForm`, `Pagination`, `.data-table`, `.num`, token `--tone-*`, dan pola formulir h-8 yang sudah dibakukan pada FIX-R2 akuntansi.

## Vonis ringkas

Inti POS Bisa ERP sebenarnya cepat dan cukup matang. Jalur tercepatnya sangat baik: dengan sesi terbuka, satu scan barcode dan satu klik **Bayar** dapat menyelesaikan penjualan tunai pas. Pencarian barcode memakai kecocokan persis, produk habis dikunci, keranjang dipulihkan per perusahaan + kasir, pembayaran campuran disimulasikan dengan benar, penjualan utang dapat diselesaikan tanpa meninggalkan terminal, dan sesi tutup menampilkan selisih secara langsung.

Masalahnya bukan ketiadaan fitur. Masalahnya adalah **keandalan workflow pada situasi nyata kasir**:

1. Tombol Bayar tetap aktif ketika quote tidak valid/gagal dan dapat bertuliskan “Bayar Rp 0”.
2. Melanjutkan pesanan ditahan dapat menimpa snapshot keranjang yang sedang aktif.
3. Scanner hanya tertangkap aman bila fokus sudah berada di kotak cari dan kodenya numerik panjang.
4. Tata letak dua panel baru muncul pada `xl`; layar kasir 1024–1279 px menumpuk produk, keranjang, lalu pembayaran secara vertikal.
5. Pembayaran non-tunai tidak menyediakan konfirmasi penerimaan atau pencatatan referensi dari terminal.
6. Mode offline belum benar-benar mendukung pencarian dan perhitungan harga saat koneksi putus di tengah transaksi.

Tidak ditemukan **P0** pada lingkup UI/UX ini: server tetap menghitung ulang checkout dan menolak banyak keadaan tidak sah. Temuan P1 di bawah terutama menyebabkan transaksi gagal di akhir, pekerjaan kasir hilang, atau kasir harus mengulang langkah pada saat antrean sedang berjalan.

**Total: 31 temuan — P0: 0 · P1: 8 · P2: 15 · P3: 8.**

## Nilai per area

| Area | Nilai | Penilaian singkat |
|---|---:|---|
| Kecepatan checkout dasar | B+ | Scan + Bayar benar-benar ringkas; status kesiapan quote melemahkannya. |
| Pencarian & barcode | C+ | Jalur barcode persis kuat, tetapi tertambat pada fokus dan format kode tertentu. |
| Keranjang | B− | Cepat dan persisten, tetapi destruktif tanpa undo dan stok berlebih terlambat diketahui. |
| Pembayaran | C+ | Tunai dan campuran baik; non-tunai belum punya bukti penerimaan/referensi yang layak. |
| Penjualan utang | B− | Lengkap dalam satu terminal, tetapi panel jauh di bawah dan konteks utang pelanggan tipis. |
| Retur & void | C | Domain tersedia, penemuan transaksi dan kejelasan formulir masih menghambat. |
| Sesi kas | B− | Ringkasan dan riwayat kuat; penutupan berselisih terlalu mudah dan belum ada Z-report. |
| Struk | B− | Fondasi Print Engine baik; bukti bayar dan identitas pajak belum lengkap. |
| Responsivitas & sentuh | C | Kartu produk dan Bayar baik; panel bertumpuk di bawah `xl`, banyak kontrol kecil. |
| Konsistensi desain | C+ | Halaman pendukung cukup selaras; terminal masih menjadi dialek visual sendiri. |
| Error/loading | C+ | Terminal tangguh; komponen pendukung tidak konsisten memulihkan busy/error. |
| Aksesibilitas dasar | B−/C+ | Label banyak tersedia dan rute POS masuk gerbang axe, tetapi dialog kustom belum dikelola fokusnya. |

## Metode & batas bukti

- Diperiksa 21 berkas TSX di `src/app/app/pos/**` dan `src/components/pos/**`, `src/app/globals.css`, komponen cetak bersama, serta potongan server action/domain yang menentukan perilaku UI.
- Hitungan langkah adalah **aksi utama** (scan, klik, pilihan, submit). Ketikan huruf/angka tidak dihitung per karakter; dialog cetak browser dihitung sebagai langkah eksternal sesudah nota terbuka.
- Ukuran target diturunkan dari kelas Tailwind (`h-7` = 28 px, `size-6` = 24 px, `h-11` = 44 px), bukan pengukuran piksel dari perangkat fisik.
- Audit ini tidak menjalankan aplikasi pada scanner wedge, printer thermal, atau layar sentuh fisik. Karena itu temuan perangkat adalah risiko yang dibuktikan dari jalur kode, bukan klaim hasil uji perangkat.

## Pengukuran alur utama

| Skenario | Langkah terukur dari kode/UI | Catatan |
|---|---:|---|
| Tunai pas, sesi terbuka, barcode | **2 aksi**: scan → Bayar | Sesudah itu nota terbuka dan dialog cetak muncul otomatis; untuk transaksi berikutnya kasir masih perlu memilih tautan **Kasir**. |
| Tunai pas, cari nama dengan mouse | **3 aksi**: ketik → klik kartu produk → Bayar | Dengan Enter: ketik → Enter → Bayar, tetapi Enter memilih hasil pertama (lihat POS2-10). |
| Tunai tidak pas | **3–4 aksi**: scan → chip/isi diterima → Bayar | Tambah satu aksi bila metode tunai belum terpilih. |
| Sesi belum dibuka, mulai dari POS | **3 aksi sebelum menjual**: tautan sesi → Buka sesi → kembali ke Kasir | Modal awal sudah terisi Rp500.000; keranjang yang sudah dibuat tersimpan lokal, tetapi perpindahan konteks tetap terjadi. |
| Utang metode tunggal | **4 aksi minimum**: scan → Utang → pilih pelanggan → Bayar | Tanggal jatuh tempo sudah terisi bawaan. Tambah cepat: buka form → isi nama → Simpan & pilih → Bayar. |
| Retur dari Riwayat | **4 tahap**: buka Riwayat → cari/filter → ikon Retur → isi form dan Simpan retur | Dari halaman nota perlu kembali ke Riwayat dulu; nota sendiri tidak punya aksi retur/void. |
| Void dari Riwayat | **4 tahap**: buka Riwayat → ikon Void → isi alasan → Void transaksi | Ikon kecil, tetapi alur otorisasinya jelas. |
| Tutup sesi | **3 aksi**: buka Sesi kas → isi uang dihitung → Tutup sesi | Selisih tampil langsung, tetapi tidak ada konfirmasi kedua atau laporan Z siap cetak. |

---

# Temuan P1 — menghambat transaksi atau berisiko menghilangkan pekerjaan kasir

## POS2-01 — Tombol Bayar tidak mengetahui apakah quote valid; dapat aktif sebagai “Bayar Rp 0”

**Bukti.** `quote` dipaksa menjadi `null` bila keranjang kosong atau ada nomor seri yang belum lengkap (`src/components/pos/pos-terminal.tsx:315-340`). Kegagalan `quoteAction` juga mengosongkan data quote (`src/components/pos/pos-terminal.tsx:667-718`). Total berasal dari `quote?.total ?? 0` (`:377`). Namun tombol Bayar hanya dinonaktifkan oleh `submitting || cart.length === 0 || !sessionOpen` (`:2223-2231`); tidak ada syarat “quote terakhir berhasil dan segar”. Saat quote sedang dihitung, total lama tetap dipakai dan hanya ada teks 10 px “Menghitung…” di ringkasan (`:1750-1754`).

**Dampak.** Bila quote gagal karena diskon melewati ambang, stok berubah, jaringan putus, atau seri belum lengkap, kasir melihat total Rp0 atau total lama tanpa penjelasan yang menempel di panel pembayaran. Ia masih dapat menekan Bayar dan baru menerima penolakan server di akhir. Pada pembayaran tunai, nominal diterima juga dapat diisi berdasarkan total yang belum final.

**Arah perbaikan.** Turunkan satu status eksplisit: `quoteState = empty | loading | fresh | stale | error | blocked`, lengkap dengan alasan. Bayar nonaktif sampai quote segar berhasil; label berubah menjadi “Menghitung…”, “Lengkapi nomor seri”, atau “Perhitungan gagal — Coba lagi”. Tampilkan alasan sebagai banner persisten di panel pembayaran, bukan hanya toast.

## POS2-02 — Melanjutkan pesanan ditahan dapat menimpa keranjang aktif tanpa peringatan

**Bukti.** Efek pemulihan snapshot secara eksplisit melewatkan snapshot lokal bila ada `resumeId` (`src/components/pos/pos-terminal.tsx:584-617`). Efek penyimpanan kemudian berjalan sesudah `cartLoaded` menjadi true: keranjang awal yang masih kosong dan `heldSaleId` kosong menyebabkan snapshot lama dihapus (`:619-642`). Efek resume berjalan asinkron dan mengganti keranjang dengan isi tahanan (`:644-665`).

**Dampak.** Kasir yang sedang menyusun transaksi, membuka daftar tahanan, lalu memilih **Lanjutkan** dapat kehilangan keranjang aktifnya tanpa dialog pilihan. Ini bukan data akuntansi yang rusak, tetapi pekerjaan operasional yang hilang di tengah antrean.

**Arah perbaikan.** Jangan hapus/timpa snapshot sebelum resume berhasil dan pilihan pengguna jelas. Bila keranjang aktif tidak kosong, tawarkan “Tahan keranjang sekarang, lalu lanjutkan”, “Ganti keranjang”, atau “Batal”. Snapshot resume dan snapshot kerja aktif sebaiknya memakai kunci/entitas terpisah sampai transisi selesai.

## POS2-03 — Barcode scanner belum ditangkap global dan hanya dikenali sebagai angka panjang

**Bukti.** Satu-satunya penangkap scan berada pada `onKeyDown` input pencarian (`src/components/pos/pos-terminal.tsx:1304-1333`). Jalur khususnya hanya aktif untuk `/^\d{6,}$/`. `scanBarcode` sendiri memang aman—pencarian segar lalu kecocokan persis barcode/SKU (`:488-510`)—tetapi tidak ada listener scanner global. Pintasan yang ada hanya F2 untuk memfokuskan pencarian (`:724-733`).

**Dampak.** Scanner wedge mengirim karakter ke elemen yang sedang fokus. Sesudah kasir menyentuh qty, diskon, nominal, atau pelanggan, hasil scan dapat hilang atau justru mengubah field tersebut. Barcode/SKU alfanumerik dan kode pendek tidak masuk jalur persis; ia diperlakukan sebagai pencarian teks dan Enter dapat memilih hasil pertama.

**Arah perbaikan.** Tambahkan penangkap scan global berbasis kecepatan ketik + Enter, dengan pengecualian aman untuk textarea/dialog dan mode edit yang memang disengaja. Dukung EAN/UPC, Code 128 alfanumerik, SKU, dan kode pendek. Tampilkan status “Scanner siap” dan sediakan tombol/fokus scan yang jelas.

## POS2-04 — Terminal baru menjadi dua panel pada `xl`; layar kasir 1024–1279 px kehilangan konteks pembayaran

**Bukti.** Root terminal hanya memakai dua kolom pada `xl:grid-cols-[...]` (`src/components/pos/pos-terminal.tsx:1280-1288`). Di bawah itu section produk dirender dulu (`:1290`) dan aside keranjang/pembayaran sesudahnya (`:1471`). Shell modul sudah mengambil sidebar 232 px mulai `lg` (`src/components/shell/module-shell.tsx:27-28,104`). Tidak ada ringkasan total/Bayar yang sticky di bawah `xl`.

**Dampak.** Pada monitor/touchscreen kasir 1024–1279 px, kasir menggulir melewati kisi produk untuk mencapai keranjang dan pembayaran, lalu kembali lagi untuk menambah produk. Total dan status pembayaran hilang dari pandangan selama memilih produk. Ini memperlambat alur dan meningkatkan risiko salah total.

**Arah perbaikan.** Buat breakpoint POS sendiri: dua panel mulai sekitar 1024 px dengan sidebar modul yang dapat diciutkan/ mode kasir khusus. Di bawah itu, tampilkan bar total + jumlah item + tombol Bayar sticky yang membuka panel keranjang/pembayaran.

## POS2-05 — Pembayaran non-tunai tidak punya konfirmasi penerimaan maupun field referensi

**Bukti.** Tipe pembayaran klien memiliki field `reference` (`src/components/pos/pos-terminal.tsx:92`), dan checkout meneruskan referensi itu (`:1105-1124`). Namun tidak ada input referensi yang dirender untuk metode bank/e-wallet/QRIS. Mode tunggal non-tunai hanya menampilkan konten khusus QRIS berupa gambar dan instruksi (`:1855-1875`); mode campuran hanya menyediakan nominal dan, khusus tunai, uang diterima (`:1871-1990`). Satu-satunya referensi yang terisi dari UI adalah nomor kredit retur.

**Dampak.** Kasir menekan Bayar sebagai pernyataan implisit bahwa QRIS/transfer sudah diterima, tanpa tempat mencatat nomor referensi, kode persetujuan, atau bukti transfer. Rekonsiliasi dan penanganan komplain menjadi bergantung pada ingatan atau aplikasi lain.

**Arah perbaikan.** Panel metode non-tunai perlu status eksplisit “Pembayaran diterima”, field referensi yang wajib/opsional sesuai konfigurasi metode, dan ringkasan sebelum Bayar. Referensi yang tercatat harus ikut tampil pada nota (lihat POS2-14).

## POS2-06 — Kuantitas dapat melewati stok tanpa peringatan sampai checkout

**Bukti.** `addProduct` hanya menolak produk yang stok awalnya `<= 0`, lalu menambah qty produk yang sudah ada tanpa membandingkan qty keranjang dengan stok (`src/components/pos/pos-terminal.tsx:404-424`). Kartu produk juga hanya dinonaktifkan pada stok `<= 0` (`:1395-1410`). Di baris keranjang, peringatan hanya muncul bila `stock <= 0`, bukan bila `item.qty > stock` (`:1544-1621`).

**Dampak.** Produk stok 2 dapat dinaikkan menjadi 5 dan tetap tampak sah selama penyusunan. Kegagalan baru muncul ketika quote/checkout menolak, sesudah kasir dan pelanggan selesai memilih barang.

**Arah perbaikan.** Gunakan stok tersedia dari quote untuk membatasi tombol +, tampilkan “Sisa stok X” dan peringatan segera saat qty melewati stok. Bila kebijakan toko mengizinkan backorder, buat pengecualian itu eksplisit dan berizin—bukan diam-diam.

## POS2-07 — Mode offline belum mendukung penemuan produk dan perhitungan harga secara offline

**Bukti.** Banner menyatakan penjualan offline “diantrekan” (`src/components/pos/pos-terminal.tsx:1341-1378`). Tetapi pencarian produk memanggil server action (`:443-510`) dan quote juga memanggil server (`:667-718`). Jalur checkout offline hanya mengantrekan payload yang sudah terbentuk (`:1125-1168`). Katalog lokal yang tersedia hanyalah hasil pencarian terakhir/halaman aktif, bukan paket katalog + harga + pajak yang disiapkan untuk offline.

**Dampak.** Bila koneksi putus sebelum quote terakhir berhasil, kasir tidak dapat mencari produk lain secara andal dan total dapat menjadi null/Rp0. Mode ini bekerja untuk transaksi yang kebetulan sudah lengkap sebelum putus, tetapi belum menjadi mode jualan offline yang dapat dijanjikan kepada kasir.

**Arah perbaikan.** Pra-sinkronkan katalog aktif, harga, pajak, metode, dan stok indikatif saat online; implementasikan quote lokal yang hasilnya diverifikasi server saat sinkronisasi. Bila itu belum tersedia, ubah label ekspektasi menjadi mode antre terbatas dan blokir secara jelas fungsi yang tidak tersedia.

## POS2-08 — Tutup sesi berselisih selesai dalam satu klik, tanpa konfirmasi kedua atau Z-report

**Bukti.** Fungsi `close` langsung memanggil `closeSessionAction` setelah field uang dihitung terisi (`src/components/pos/session-manager.tsx:55-70`), dan tombol **Tutup sesi** langsung menjalankan fungsi itu (`:189-199`). Selisih memang dihitung langsung (`:171-188`), tetapi nominal selisih tidak mengubah langkah konfirmasi; catatan tetap opsional. Halaman rincian sesi tidak menyediakan aksi cetak laporan penutupan (`src/app/app/pos/sesi/riwayat/[id]/page.tsx:41-109`).

**Dampak.** Salah ketik uang fisik atau salah membaca selisih dapat menutup sesi tanpa jeda verifikasi. Sesudah tutup, kasir tidak mempunyai dokumen Z-report ringkas untuk diserahkan bersama uang.

**Arah perbaikan.** Bila selisih nol, satu konfirmasi ringkas cukup. Bila selisih tidak nol, tampilkan dialog khusus berisi seharusnya/dihitung/selisih, wajibkan catatan, dan pertimbangkan persetujuan supervisor sesuai kebijakan. Akhiri dengan layar/print Z-report.

---

# Temuan P2 — memperlambat, membingungkan, atau melemahkan kontrol harian

## POS2-09 — Pintasan keyboard praktis berhenti di F2

**Bukti.** Handler global terminal hanya menangani F2 dan Escape untuk fullscreen (`src/components/pos/pos-terminal.tsx:724-749`). Pencarian menangani Enter/Escape (`:1304-1333`). Tidak ada pintasan untuk Bayar, Tahan, Uang Pas, ganti metode, fokus qty, fokus uang diterima, transaksi baru, atau bantuan pintasan. Checkout hanya terikat pada klik tombol (`:2223-2231`).

**Dampak.** Kasir keyboard-first harus Tab melewati kartu produk dan banyak kontrol atau kembali memakai mouse untuk tahap pembayaran. Kecepatan jalur scan tidak diteruskan ke tahap akhir.

**Arah perbaikan.** Tambahkan peta pintasan yang tidak bertabrakan dengan browser/scanner, misalnya F2 cari, F4 tahan, F8 uang diterima, F9/F12 bayar, dan tampilkan daftar pintasan lewat tombol `?`. Uji pintasan saat dialog terbuka dan saat fokus di input.

## POS2-10 — Pencarian teks memilih hasil pertama tanpa seleksi eksplisit; katalog sulit dijelajahi

**Bukti.** Enter pada teks non-barcode langsung menjalankan `addProduct(products[0])` (`src/components/pos/pos-terminal.tsx:1304-1322`). Karena pencarian berjalan debounce 220 ms (`:515-523`), Enter yang cepat dapat memakai hasil query sebelumnya. Kartu produk hanya menampilkan nama, harga, dan stok (`:1395-1438`)—tanpa SKU/barcode, kategori, atau gambar. Tidak ada filter kategori/favorit/sering terjual; navigasi katalog hanya pagination Sebelumnya/Berikutnya (`:1440-1468`).

**Dampak.** Query luas seperti “susu” atau “aqua” dapat memasukkan varian pertama yang bukan pilihan kasir. Produk bernama mirip sulit dibedakan sebelum masuk keranjang. Katalog besar mengandalkan hafalan nama.

**Arah perbaikan.** Beri status hasil aktif/terpilih secara visual dan hanya izinkan Enter memilih hasil dari query yang sudah selesai. Tambahkan SKU/barcode kecil pada kartu, filter kategori, serta kelompok Favorit/Sering terjual yang dapat dikonfigurasi.

## POS2-11 — Aksi destruktif keranjang tidak mempunyai konfirmasi atau undo

**Bukti.** Tombol **Kosongkan** langsung menjalankan `setCart([])` (`src/components/pos/pos-terminal.tsx:1494-1507`). Input qty memanggil `setQty(..., Number(value) || 0)` pada setiap perubahan, dan `setQty` menghapus baris untuk qty `<= 0` (`:849-858,1581-1592`). Menghapus isi field qty atau menekan minus pada qty 1 karena itu langsung menghilangkan baris. Tidak ada toast undo atau status keranjang terhapus.

**Dampak.** Salah sentuh kecil dapat menghapus satu baris atau seluruh keranjang tanpa jalan pemulihan selain memasukkan ulang produk.

**Arah perbaikan.** Bedakan nilai qty kosong sementara dari qty final 0; jangan hapus baris hanya karena field sedang dikosongkan. Untuk **Kosongkan**, gunakan konfirmasi ringan atau toast Undo berdurasi cukup. Minus pada qty 1 dapat berubah menjadi ikon hapus yang disengaja.

## POS2-12 — Entri angka sentuh bergantung pada keyboard eksternal dan angka mentah

**Bukti.** Chip tunai hanya menyediakan Uang Pas, 10/20/50/100 ribu (`src/components/pos/pos-terminal.tsx:195,197-243`). Field diterima, qty, diskon, nominal campuran, dan sesi memakai input angka mentah tanpa keypad layar atau pemformat ribuan saat mengetik (`:1581-1592,1805-1823,1876-1907`; `src/components/pos/session-manager.tsx:106-125,171-188`).

**Dampak.** Pada terminal sentuh tanpa keyboard fisik, kasir bergantung pada keyboard sistem yang menutupi layar dan tidak konsisten antarperangkat. Nominal besar seperti 250.000 atau 500.000 tetap harus diketik penuh, meningkatkan salah digit.

**Arah perbaikan.** Sediakan keypad numerik POS yang dapat dipanggil untuk qty, uang diterima, diskon, dan hitung sesi; tampilkan pemisah ribuan langsung. Tambahkan denominasi cepat yang dapat dikonfigurasi perusahaan.

## POS2-13 — Target sentuh pekerjaan berulang masih 21–28 px

**Bukti kelas.** Pagination produk `h-7` (28 px), stepper qty `size-6` (24 px), tombol aksi riwayat dan hapus tahanan `size-7` (28 px), serta chip uang dengan teks 10 px + `py-0.5` yang setara sekitar 21 px (`src/components/pos/pos-terminal.tsx:217-243,1451-1463,1576-1592`; `src/components/pos/sale-row-actions.tsx:47-79`; `src/components/pos/held-actions.tsx:28-42`; `src/components/pos/offline-review-panel.tsx:42-58`). Di seluruh POS masih ada **8 kemunculan `h-7`** dan **4 kemunculan `size-7`**. Kontrasnya, Bayar `h-11` (44 px) dan pencarian `h-10` (40 px) sudah layak (`pos-terminal.tsx:1326,2228`).

**Dampak.** Stepper, hapus, pagination, dan chip adalah kontrol yang dipakai dengan tangan bergerak cepat. Ukuran 24 px mungkin memenuhi batas minimum WCAG 2.5.8 pada banyak kasus, tetapi belum ergonomis untuk POS; target ±21–22 px bahkan berada di bawah patokan minimum tersebut.

**Arah perbaikan.** Tetapkan target POS: aksi primer 44 px, kontrol berulang minimum 40 px, ikon tabel minimum 32–36 px dengan jarak aman. Jangan menyamakan standar tabel back-office dengan standar terminal.

## POS2-14 — Struk tidak mencetak uang diterima, referensi pembayaran, dan NPWP penjual

**Bukti.** Detail penjualan di server sebenarnya mengambil `tendered` dan `reference` untuk setiap pembayaran (`src/server/reports.ts:1085-1095`). Halaman nota hanya mencetak nama metode + `amount`, lalu kembalian bila ada (`src/app/app/pos/nota/[id]/page.tsx:207-218`); `tendered` dan `reference` tidak dirender. Panggilan `PrintHeader` pada nota tidak meneruskan NPWP (`:99-114`), sementara `PrintHeader` memang hanya menampilkan NPWP untuk varian dokumen, bukan receipt (`src/components/print/print-shell.tsx:148-165`).

**Dampak.** Pelanggan tidak dapat memeriksa dari struk berapa uang yang diserahkan atau referensi QRIS/transfer yang dipakai. Untuk toko PKP atau pelanggan bisnis, struk juga tidak membawa identitas pajak penjual; yang tampil hanya total “termasuk PPN”.

**Arah perbaikan.** Cetak baris **Diterima** untuk tunai, referensi untuk non-tunai, dan NPWP perusahaan bila tersedia/diaktifkan. Pertahankan ringkas: informasi ini menggantikan kebutuhan menebak dari `amount + kembalian`, bukan menambah dekorasi.

## POS2-15 — Retur sulit ditemukan: daftar awal hanya 12 transaksi dan teksnya mengatakan 30

**Bukti.** Halaman retur mengambil `pageSize: 12` (`src/app/app/pos/retur/page.tsx:28`), tetapi keterangan UI menyatakan “Hanya transaksi selesai dalam 30 transaksi terakhir” (`:143-147`). Halaman retur tidak mempunyai formulir pencarian nomor nota/pelanggan/tanggal. Halaman nota sendiri hanya menyediakan Riwayat, Kasir, dan Cetak (`src/app/app/pos/nota/[id]/page.tsx:64-89`), tanpa Retur/Void.

**Dampak.** Untuk nota yang bukan 12 transaksi terakhir, kasir harus meninggalkan konteks retur, membuka Riwayat, mencari lagi, lalu memakai ikon retur di sana. Ketidaksesuaian angka 12/30 membuat batas pencarian tidak dapat dipercaya.

**Arah perbaikan.** Tambahkan pencarian nota langsung pada halaman retur dengan hasil yang sama seperti Riwayat, samakan batas dan teksnya, dan tambahkan aksi Retur/Void berizin pada halaman nota.

## POS2-16 — Formulir retur mempunyai taksonomi ganda dan tanpa ringkasan konfirmasi

**Bukti.** Form menyediakan **Jenis**: “Retur dana / Tukar barang” dan secara terpisah **Pengembalian**: “Tunai / Transfer bank / Kredit toko / Tukar barang” (`src/components/pos/return-form.tsx:136-164`). Memilih jenis Tukar barang mengisi metode menjadi exchange, tetapi pengguna masih dapat mengganti metode ke Tunai tanpa penjelasan kombinasi. Qty hanya berupa input angka + tombol Semua (`:103-126`), tidak ada stepper atau scan nota/barcode. Tombol **Simpan retur** langsung memproses (`:53-83,208-218`) tanpa dialog ringkasan barang, metode, potong piutang, dan refund.

**Dampak.** Dua kontrol yang tampak menjawab pertanyaan yang sama membuat kasir ragu, terutama saat retur penjualan utang yang sebagian memotong piutang dan sebagian refund. Kesalahan metode baru terlihat sesudah dokumen tersimpan.

**Arah perbaikan.** Jadikan satu alur keputusan: pilih hasil retur (refund/kredit/tukar), lalu metode yang relevan saja yang tampil. Tambahkan stepper qty dan langkah konfirmasi ringkas sebelum posting, dengan rincian potong piutang vs uang keluar.

## POS2-17 — Panel utang muncul jauh di bawah dan kegagalan cari pelanggan tampil sebagai “tidak ditemukan”

**Bukti.** Panel utang dirender sesudah panel Kredit Retur di dalam kartu pembayaran (`src/components/pos/pos-terminal.tsx:1992-2222`), sehingga pada daftar metode yang panjang ia tidak langsung terlihat saat metode Utang dipilih. Pencarian pelanggan menangkap kegagalan jaringan tanpa pesan dan membiarkan hasil kosong (`:1000-1012`); UI hasil kosong kemudian menyatakan pelanggan tidak ditemukan dan menyarankan tambah cepat (`:2150-2154`). Data pelanggan yang tampil hanya nama, telepon, dan batas kredit (`:66-72,2110-2134`), tanpa total piutang berjalan atau status tunggakan.

**Dampak.** Kasir dapat menggulir melewatkan kewajiban pelanggan/jatuh tempo, atau membuat pelanggan duplikat karena kegagalan jaringan disamarkan sebagai hasil kosong. Keputusan memberi utang juga tidak dibantu konteks piutang yang sudah ada.

**Arah perbaikan.** Gulirkan/fokuskan panel utang saat diaktifkan dan beri penanda tab/ringkasan utang di tombol Bayar. Bedakan status “gagal memuat” dari “tidak ditemukan”, tampilkan piutang berjalan dan tunggakan pelanggan terpilih, dan cegah tambah cepat sebelum pencarian berhasil dipastikan kosong.

## POS2-18 — Di luar terminal, status busy/error tidak dipulihkan secara konsisten

**Bukti.** `SessionManager` menjalankan open/close/movement tanpa `try/finally` (`src/components/pos/session-manager.tsx:43-94`). Pola sama terlihat pada `ReturnForm` (`src/components/pos/return-form.tsx:53-83`), `HeldActions` (`src/components/pos/held-actions.tsx:13-25`), dan `SaleRowActions` (`src/components/pos/sale-row-actions.tsx:25-44`): `setBusy(false)` hanya berjalan pada jalur normal. Loading route POS memakai `PageSkeleton` generik (`src/app/app/pos/loading.tsx:1-5`), bukan bentuk terminal.

**Dampak.** Penolakan promise karena jaringan dapat meninggalkan tombol dalam keadaan “Memproses…”/nonaktif sampai halaman dimuat ulang. Skeleton generik juga membuat terminal tampak akan menjadi halaman statistik/tabel, lalu tata letak melompat.

**Arah perbaikan.** Samakan helper aksi client: `try/catch/finally`, toast error jaringan, dan pemulihan busy. Buat skeleton terminal khusus (kisi produk + panel keranjang) dan skeleton sederhana untuk sesi/retur.

## POS2-19 — Dialog kustom dan prompt native belum memenuhi pola aksesibilitas yang sama

**Bukti.** Modal Tahan (`src/components/pos/pos-terminal.tsx:2257-2295`) dan modal Void (`src/components/pos/sale-row-actions.tsx:83-116`) adalah `div` tetap tanpa `role="dialog"`, `aria-modal`, label dialog, jebakan fokus, atau penanganan Escape untuk menutup. Hapus tahanan memakai `window.confirm` (`src/components/pos/held-actions.tsx:14`) dan penyelesaian offline memakai `window.prompt` (`src/components/pos/offline-review-panel.tsx:14-23`). Popover tampilan POS lebih baik—ada `role="dialog"`, Escape, dan klik luar (`src/components/pos/pos-display.tsx:129-145,183-187`)—tetapi fokus juga tidak dipindahkan/dikembalikan secara eksplisit.

**Dampak.** Pengguna keyboard dan pembaca layar dapat tetap menab ke latar belakang, kehilangan konteks dialog, atau menghadapi prompt sistem yang tidak konsisten dengan bahasa visual aplikasi.

**Arah perbaikan.** Gunakan satu komponen Dialog bersama untuk Tahan, Void, tutup sesi berselisih, dan penyelesaian offline: fokus awal, focus trap, Escape, pengembalian fokus, `aria-labelledby`, dan tombol batal yang selalu setara.

## POS2-20 — Peninjauan offline tidak memberi rincian cukup untuk mengambil keputusan

**Bukti.** Tabel peninjauan hanya menampilkan waktu sinkron, kunci klien yang terpotong, tanggal jual, jumlah baris, total pembayaran, status, dan pesan yang terpotong satu baris (`src/app/app/pos/offline/page.tsx:52-94`). Tidak ada kasir, gudang, nama produk/baris, pelanggan, atau rincian pembayaran yang dapat dibuka.

**Dampak.** Peninjau diminta menandai selesai/buang dari identifier teknis dan pesan ringkas, padahal keputusan yang aman membutuhkan isi transaksi. Ia harus menebak atau mencari data di tempat lain.

**Arah perbaikan.** Tambahkan detail expandable/drawer berisi baris produk, qty, gudang, kasir, pembayaran, dan riwayat percobaan sinkron. Kunci klien tetap tersedia sebagai data teknis sekunder, bukan identitas utama.

## POS2-21 — Riwayat sesi lengkap di layar, tetapi tidak menjadi laporan penutupan yang dapat diserahkan

**Bukti.** Rincian sesi menampilkan kasir, cabang, modal, penjualan tunai, refund, setor/tarik, total masuk/keluar, saldo seharusnya, hitungan, selisih, catatan, dan mutasi (`src/app/app/pos/sesi/riwayat/[id]/page.tsx:51-145`). Namun tidak ada tombol cetak/PDF/ekspor khusus dan tidak ada rincian total per metode pembayaran. `PageHeader` halaman itu tidak membawa action apa pun (`:41-49`).

**Dampak.** Pemilik/kasir dapat membaca rekonsiliasi di layar, tetapi alur tutup buku harian masih membutuhkan salinan manual untuk arsip atau serah terima. Total non-tunai juga harus dicari dari riwayat transaksi terpisah.

**Arah perbaikan.** Buat Z-report sesi memakai Print Engine: identitas sesi, ringkasan kas, total per metode, retur/void, selisih, catatan, dan tanda tangan kasir/penyetuju. Sediakan tombol Cetak pada saat tutup dan pada rincian riwayat.

## POS2-22 — Teks risiko dan status penting masih 9–11 px

**Bukti hitungan.** Regex atas 21 berkas TSX POS menemukan **231 kemunculan** ukuran teks arbitrer 9–14 px: 9 px ×3, 10 px ×46, 11 px ×66, 12 px ×88, 13 px ×25, 14 px ×3. Di terminal, badge tipe metode memakai 9 px (`src/components/pos/pos-terminal.tsx:1765,1790`), sedangkan status quote, peringatan stok, catatan batas kredit, dan peringatan kelebihan bayar non-tunai banyak memakai 10 px (`:1617-1621,1979-1990,2119-2132`).

**Dampak.** Ukuran kecil untuk label dekoratif dapat diterima pada POS padat. Masalahnya, teks 10 px di sini membawa informasi risiko: stok tidak cukup, pembayaran berlebih, batas kredit, dan status perhitungan. Teks tersebut mudah terlewat pada layar terang/terpasang di dinding kasir.

**Arah perbaikan.** Tetapkan lantai POS: nama produk dan angka kerja 12–13 px, peringatan/status operasional minimum 11–12 px dengan ikon + warna, dan 9–10 px hanya untuk metadata yang tidak menentukan tindakan.

## POS2-23 — Token dan varian lokal masih menjadi dialek visual POS

**Bukti.** Token resmi `--tone-teal`, `--tone-amber`, dan kawanannya sudah ada di `src/app/globals.css:24-39,87-100`. Meski begitu, POS masih memiliki **45 kemunculan hex enam digit**; terminal sendiri 30, termasuk peta `methodTone` lokal (`src/components/pos/pos-terminal.tsx:186-191`) dan warna Bayar/peringatan yang ditulis mentah. `SessionStatusBadge` adalah badge lokal terpisah dari `StatusBadge` (`src/components/pos/session-history-list.tsx:38-49`), dan panel offline memakai hijau `emerald` Tailwind (`src/components/pos/offline-review-panel.tsx:46`). Ketinggian field dalam satu terminal berubah-ubah: cari h-10, kelompok h-8, uang h-9, nominal campuran h-8 (`pos-terminal.tsx:1326,1519,1818,1889`). Label tipe metode juga dirender mentah dari `method.type` dan hanya diperkeras dengan uppercase (`:1765`), bukan label Bahasa Indonesia bersama.

**Dampak.** Perubahan warna/status harus berburu banyak berkas, dan halaman POS terasa berkaitan tetapi tidak identik dengan sistem yang baru dibakukan di akuntansi. Ini adalah utang konsistensi, bukan sekadar selera warna.

**Arah perbaikan.** Buat primitif khusus POS di atas token bersama: `PosMethodBadge`, `PosField`, `PosIconButton`, dan status sesi berbasis `StatusBadge`. Migrasi hex ke `--tone-*`; label tipe pembayaran memakai pemetaan Bahasa Indonesia yang sama dengan modul lain.

---

# Temuan P3 — poles, kejelasan, dan konsistensi lanjutan

## POS2-24 — Indikator sesi selalu berdot hijau dan pintu masuk sesi tersembunyi di bawah pembayaran

**Bukti.** Indikator status sesi selalu memakai dot `bg-emerald-500`, termasuk ketika teksnya “Sesi kas belum dibuka” (`src/components/pos/pos-terminal.tsx:1341-1349`). Tautan untuk membuka sesi baru muncul sebagai peringatan di bagian bawah panel pembayaran (`:2240-2248`). Halaman Sesi kas tidak memiliki action “Ke kasir” pada `PageHeader` (`src/app/app/pos/sesi/page.tsx:37-45`).

**Dampak & arah.** Warna memberi sinyal “sehat” yang bertentangan dengan teks. Gunakan dot/tone sesuai status dan jadikan indikator sesi sebagai tautan langsung. Sesudah sesi dibuka, tampilkan tombol **Mulai menjual** yang kembali ke terminal.

## POS2-25 — Daftar pesanan ditahan tanpa pencarian, pagination, kasir, atau penuaan

**Bukti.** Halaman ditahan merender seluruh hasil `listHeldSales` dalam satu tabel (`src/app/app/pos/ditahan/page.tsx:31-71`). Query domain tidak membatasi jumlah, tidak memilih kasir, dan hanya mengurutkan terbaru (`src/server/reports.ts:1113-1128`). Penghitung pada terminal menghitung semua pesanan ditahan perusahaan (`src/app/app/pos/page.tsx:47-50`), bukan hanya milik kasir aktif.

**Dampak & arah.** Daftar yang tumbuh sulit dipindai dan pesanan lama tidak menonjol. Tambahkan cari label/nomor, filter kasir, pagination, kolom kasir, serta penanda umur untuk tahanan lama.

## POS2-26 — Cetak ulang tidak ditandai sebagai salinan dan status retur nota tidak ditampilkan

**Bukti.** Halaman nota mengambil daftar retur terkait (`src/app/app/pos/nota/[id]/page.tsx:38-44`), tetapi hasil itu tidak ikut dirender; destrukturisasi data bahkan tidak mengambil `returns` (`:47`). `PrintFooter` mencetak nomor dokumen dan teks “Dicetak dari Bisa ERP”, tanpa penanda salinan/cetak ulang (`src/components/print/print-shell.tsx:254-289`). Ikon printer pada Riwayat membuka halaman nota di tab baru tanpa `autoprint`, sehingga pengguna masih perlu menekan Cetak lagi (`src/components/pos/sale-row-actions.tsx:47-56`).

**Dampak & arah.** Struk hasil cetak ulang tampak sama dengan struk pertama, dan kasir tidak melihat dari nota apakah transaksi sudah pernah diretur. Tambahkan label “SALINAN” untuk cetak sesudah cetakan pertama, tampilkan status/riwayat retur pada layar nota, dan samakan makna ikon printer: pratinjau atau cetak langsung.

## POS2-27 — Baris struk tidak memakai SKU yang tersedia dan QR hanya berisi nomor dokumen

**Bukti.** Skema baris penjualan menyimpan `productSku` (`src/db/schema.ts:1101-1122`), tetapi baris struk hanya mencetak nama produk, qty × harga, diskon, dan total (`src/app/app/pos/nota/[id]/page.tsx:151-171`). QR dibuat dari `sale.number` saja (`:53`) dan footer menampilkan nomor yang sama (`src/components/print/print-shell.tsx:267-288`).

**Dampak & arah.** Untuk produk bernama sama/varian, SKU pada struk membantu retur dan komplain. QR nomor polos berguna untuk pencarian internal, tetapi jangan diberi kesan verifikasi publik. Cetak SKU kecil bila nama berpotensi ambigu, dan labeli QR sebagai kode nota internal atau arahkan ke URL verifikasi yang benar-benar dapat dibuka.

## POS2-28 — Preferensi tampilan POS berlaku global per browser, bukan per kasir/perusahaan

**Bukti.** Preferensi kerapatan, kolom, lebar keranjang, badge stok, dan fullscreen disimpan pada satu kunci `bisa.pos.display` (`src/components/pos/pos-display.tsx:28-80`). Sebaliknya snapshot keranjang secara benar dibedakan per perusahaan + pengguna (`src/components/pos/pos-terminal.tsx:117-127`). Bila `showStock` dimatikan, kartu stok habis tetap nonaktif dan buram, tetapi label alasannya hilang karena badge stok tidak dirender (`:1400-1431`).

**Dampak & arah.** Pada terminal bergantian, preferensi satu kasir/perusahaan terbawa ke kasir/perusahaan lain. Simpan preferensi per perusahaan + pengguna atau per profil terminal yang eksplisit. Label “Stok habis” harus tetap tampil walau badge stok biasa disembunyikan.

## POS2-29 — Mengganti gudang atau kelompok harga mengubah total keranjang tanpa ringkasan perubahan

**Bukti.** Select gudang dan kelompok langsung mengganti state (`src/components/pos/pos-terminal.tsx:1330-1343,1511-1524`), dan quote dihitung ulang berdasarkan keduanya (`:667-718`). Banner perubahan total hanya tersedia untuk pesanan yang dilanjutkan dari tahanan (`:1718-1729`); keranjang biasa tidak mendapat penjelasan “total berubah dari X ke Y karena gudang/kelompok”.

**Dampak & arah.** Kasir dapat tidak sadar bahwa tindakan administratif mengubah harga/stok yang dijanjikan ke pelanggan. Tampilkan perubahan total sementara dan tandai baris yang stok/harganya berubah; pertimbangkan konfirmasi bila keranjang tidak kosong.

## POS2-30 — Modal awal sesi terisi otomatis dan tabel riwayat sesi sangat lebar untuk layar kecil

**Bukti.** State modal awal dibuka dengan nilai tetap `"500000"` (`src/components/pos/session-manager.tsx:31`), dan form buka sesi hanya menyediakan satu input nominal tanpa rincian denominasi (`:97-125`). Tabel riwayat sesi mempunyai 11 kolom dan teks 10–12 px, hanya ditangani dengan `overflow-x-auto` (`src/components/pos/session-history-list.tsx:78-153`).

**Dampak & arah.** Nilai bawaan memang mempercepat, tetapi dapat diterima tanpa penghitungan laci yang sebenarnya. Sediakan pilihan “isi dari hitungan denominasi” dan jangan jadikan nominal tetap sebagai pengganti hitungan. Untuk riwayat pada layar kecil, gunakan baris ringkas/card atau kolom prioritas, bukan sekadar geser horizontal.

## POS2-31 — Sesudah checkout, orientasi keberhasilan dan ajakan transaksi berikutnya lemah

**Bukti.** Checkout berhasil langsung `router.push` ke nota dengan `autoprint=1` (`src/components/pos/pos-terminal.tsx:1204-1224`), dan komponen cetak memanggil `window.print()` setelah 400 ms (`src/components/pos/receipt-print.tsx:5-11`). Kembalian memang tercetak pada nota, tetapi dialog cetak segera menutupi layar. Halaman nota hanya memberi tautan kecil **Kasir**, **Riwayat**, dan **Cetak** (`src/app/app/pos/nota/[id]/page.tsx:64-89`), tanpa panel sukses yang menonjolkan nomor, kembalian, dan tombol **Transaksi baru**.

**Dampak & arah.** Alur cetak otomatis cocok untuk toko yang selalu mencetak, tetapi kasir tidak mendapat momen verifikasi kembalian yang jelas dan harus mencari jalan kembali. Tambahkan layar sukses singkat—terutama nilai kembalian—dengan pilihan Cetak, Tanpa cetak, dan Transaksi baru; autoprint tetap dapat menjadi konfigurasi perusahaan.

---

# Yang sudah baik — jangan diutak-atik tanpa bukti

- **Jalur tunai tercepat benar-benar cepat.** Scan menambahkan produk, membersihkan pencarian, dan mengembalikan fokus ke input (`src/components/pos/pos-terminal.tsx:404-424`). E2E minimarket membuktikan pola isi produk → klik produk → Bayar → nota (`e2e/simulasi-minimarket.spec.ts:60-79`).
- **Barcode persis tidak menebak.** `scanBarcode` mengambil hasil segar dan hanya menerima barcode/SKU yang sama persis; kegagalan tampil sebagai toast (`pos-terminal.tsx:488-510`).
- **Produk habis dikunci di UI dan jalur scan.** Kartu berlabel “Stok habis”, nonaktif, dan `addProduct` menolaknya (`pos-terminal.tsx:404-410,1395-1438`).
- **Keranjang tahan reload dan terpisah antar-kasir.** Snapshot memakai kunci perusahaan + pengguna dan memulihkan gudang/kelompok/tahanan (`pos-terminal.tsx:117-127,584-642`)—kelemahannya spesifik pada transisi resume di POS2-02.
- **Pembayaran campuran disimulasikan dengan jujur.** Kembalian hanya berasal dari kelebihan tunai; kelebihan non-tunai diberi peringatan, bukan dianggap kembalian (`pos-terminal.tsx:829-871,1966-1990`).
- **Penjualan utang lengkap pada satu layar.** Ada pencarian pelanggan, tambah cepat, batas kredit yang dijelaskan, jatuh tempo bawaan dari pengaturan, dan tombol **Sisa tagihan** (`pos-terminal.tsx:1000-1058,2100-2222`). Nota mencetak pelanggan dan jatuh tempo (`src/app/app/pos/nota/[id]/page.tsx:131-145`).
- **Tahanan memberi peringatan perubahan total.** Pesanan yang dilanjutkan membandingkan total lama dan total quote baru secara eksplisit (`pos-terminal.tsx:1718-1729`).
- **Penutupan sesi dapat diaudit.** Selisih dihitung langsung saat uang fisik diketik (`session-manager.tsx:171-199`), dan riwayat rincian menampilkan Pas/Kurang/Lebih sebagai teks, bukan hanya warna (`session-history-list.tsx:52-75`).
- **Fondasi struk sudah rapi.** Print Engine mengatur 58/80 mm, A5, A4; kerangka aplikasi tidak ikut tercetak; ada kop, footer, QR, total menonjol, alasan void, sisa utang, dan jatuh tempo (`src/app/app/pos/nota/[id]/page.tsx:52-238`; `src/components/print/types.ts:126-148`).
- **Halaman pendukung banyak memakai sistem bersama.** `PageHeader` dan `EmptyState` dipakai luas; Riwayat memakai `StatCard`, `SearchForm`, `FilterChips`, `StatusBadge`, `.data-table`, dan `Pagination` (`src/app/app/pos/riwayat/page.tsx:50-183`). Masalah konsistensi terberat terkonsentrasi pada terminal dan komponen POS kustom, bukan seluruh modul.
- **Aksesibilitas dasar mempunyai fondasi.** Input pencarian, gudang, qty, diskon, pelanggan, dan tombol ikon utama banyak yang berlabel; rute terminal POS termasuk dalam gerbang axe WCAG A/AA untuk pelanggaran critical/serious (`e2e/aksesibilitas.spec.ts:11-18`). Celahnya adalah dialog dinamis dan target kecil, bukan ketiadaan label secara menyeluruh.
- **Preferensi tampilan kasir nyata dan berguna.** Kasir dapat mengatur kerapatan, kolom produk, lebar keranjang, badge stok, dan mode layar penuh (`src/components/pos/pos-display.tsx:17-35,149-295`).

# Urutan perbaikan yang disarankan

## Batch 1 — jangan sampai transaksi gagal di akhir

1. POS2-01: status kesiapan quote + alasan memblokir Bayar.
2. POS2-06: batas stok pada qty keranjang.
3. POS2-02: lindungi keranjang aktif saat resume tahanan.
4. POS2-05 + POS2-14: konfirmasi/referensi non-tunai dan cetak bukti bayar yang lengkap.

## Batch 2 — kecepatan perangkat kasir nyata

5. POS2-03: penangkap scanner global multi-format.
6. POS2-04: tata letak kasir dua panel dari 1024 px + sticky checkout.
7. POS2-09: peta pintasan pembayaran dan bantuan pintasan.
8. POS2-12 + POS2-13: keypad layar dan target sentuh POS.

## Batch 3 — alur sesudah jual dan tutup hari

9. POS2-15 + POS2-16: pencarian retur dan formulir retur satu keputusan.
10. POS2-08 + POS2-21: konfirmasi selisih sesi dan Z-report.
11. POS2-07: putuskan kontrak offline yang sebenarnya—katalog/quote lokal atau label mode terbatas yang jujur.
12. POS2-17 + POS2-20: konteks utang dan detail peninjauan offline.

## Batch 4 — poles sistem desain dan aksesibilitas

13. POS2-18, POS2-19, POS2-22, POS2-23: helper busy/error, dialog bersama, lantai teks operasional, token/primitif POS.
14. POS2-10, POS2-11, POS2-24 s.d. POS2-31: pencarian katalog, undo keranjang, dan poles workflow pendukung.

## Kesimpulan

POS Bisa ERP tidak perlu dirombak total. Fondasi domain dan jalur cepatnya sudah benar. Prioritasnya adalah membuat terminal **selalu tahu kapan ia siap dibayar, tidak menghilangkan pekerjaan kasir, menangkap scanner seperti perangkat kasir sungguhan, dan tetap dua-panel pada ukuran layar kasir yang umum**. Sesudah empat hal itu, perbaikan non-tunai, retur, sesi, dan konsistensi visual akan terasa sebagai peningkatan produk yang utuh—bukan sekadar penambahan fitur.
