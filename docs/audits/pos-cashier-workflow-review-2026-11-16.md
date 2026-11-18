# Review workflow kasir POS — 16 November 2026

Audit statis read-only melalui CodeGraph. Dokumen ini mencatat hasil penelusuran checkout, pembayaran, tahan/lanjut pesanan, dan antrean offline; bukan bukti seluruh POS telah diuji. Tidak ada kode aplikasi atau database diubah oleh audit ini.

## Temuan

### POS-WF-01 — High — Tahan pesanan dapat dikirim berulang

**Bukti:** `src/components/pos/use-held-sales.ts:183` melakukan `holdAction` tanpa state/ref pengunci proses. Setiap panggilan membuat `newUuid()` pada baris 199. `src/components/pos/terminal-dialogs.tsx:60` menyediakan tombol Simpan tanpa `disabled` maupun indikator sedang menyimpan.

**Dampak:** klik cepat atau pengulangan saat jaringan lambat dapat menjadi permintaan berbeda dengan kunci idempotensi berbeda; kasir berisiko menemukan pesanan tahan duplikat. Ini temuan statis, belum direproduksi terhadap server.

**Rekomendasi:** gunakan kunci percobaan stabil dan pengunci sejak awal pengiriman; tampilkan Menyimpan serta pertahankan isi keranjang ketika gagal.

**Penerimaan:** klik ganda menghasilkan satu pesanan; retry setelah respons jaringan hilang menggunakan kunci sama; tombol aktif kembali sesudah gagal; keranjang hanya kosong setelah penyimpanan dipastikan sukses.

### POS-WF-02 — High — Dialog tahan dan lanjut pesanan belum mengelola fokus

**Bukti:** `src/components/pos/terminal-dialogs.tsx:28` dan `:93` membangun overlay `div` dengan `role=dialog`, listener Escape global, dan penutupan lewat backdrop. Tidak ada focus trap, inert latar, atau pengembalian fokus dalam kedua implementasi. Auto-focus hanya ada pada input dialog tahan.

**Dampak:** keyboard dapat berpindah ke kontrol kasir di belakang dialog; pengguna kehilangan posisi setelah menutup dialog. Atribut `aria-modal` sendiri tidak mengunci interaksi.

**Rekomendasi:** gunakan komponen Dialog Base UI yang sudah dimiliki proyek, tentukan fokus awal, cegah penutupan saat permintaan tahan sedang diproses, dan pulihkan fokus ke pencarian atau pemicu dialog.

**Penerimaan:** Tab/Shift+Tab tetap dalam dialog; Escape hanya menutup dialog teratas; fokus kembali konsisten; backdrop tidak menghilangkan permintaan yang sedang diproses.

### POS-WF-03 — Medium — Menahan pesanan selalu membutuhkan nama manual

**Bukti:** `src/components/pos/use-held-sales.ts:189` menolak label kosong. Sebaliknya alur menyelamatkan keranjang saat resume sudah membuat label otomatis pada `:241`.

**Dampak:** kasir harus mengetik saat hanya ingin berpindah cepat ke pelanggan berikutnya.

**Rekomendasi:** beri label bawaan bermakna, misalnya urutan pesanan dan waktu; nama pelanggan/catatan tetap opsional dan dapat diubah.

**Penerimaan:** tahan pesanan dapat dilakukan tanpa mengetik nama; daftar tahan tetap membedakan pesanan berdasarkan waktu, jumlah item, dan total.

### POS-WF-04 — Medium — Konfirmasi offline berbeda jauh dari checkout online

**Bukti:** `src/components/pos/terminal/use-terminal-checkout.ts:176` menyimpan antrean, menampilkan toast pada `:186`, lalu membersihkan keranjang dan memanggil `onSaleQueued` pada `:199`. Jalur online memanggil `onCheckoutSuccess` dengan nomor nota, total, dan kembalian pada `:335`.

**Dampak:** sesudah menerima pembayaran offline, kasir hanya mendapat pesan sementara, bukan ringkasan kembalian serta status tersimpan lokal yang setara dengan checkout online. Callback induk belum ditelusuri penuh; jangan menganggap bukti ini mencakup seluruh UI antrean.

**Rekomendasi:** layar hasil transaksi yang konsisten dengan status eksplisit Tersimpan di perangkat—belum tersinkron, ID lokal, total/kembalian, dan akses antrean. Hindari memberi nomor nota server atau label tersinkron sebelum posting benar-benar selesai.

**Penerimaan:** koneksi terputus tetap menghasilkan konfirmasi persisten; kasir dapat menemukan transaksi lokal sesudah menutup konfirmasi; sinkronisasi tidak menggandakan transaksi.

### POS-WF-05 — Medium — Panel pembayaran terlalu padat dan memiliki kontrol kecil

**Bukti:** `src/components/pos/payment-panel.tsx:151` judul 13px; mode Tunggal/Campuran 10px pada `:154`; setiap metode menampilkan nama sekaligus badge tipe pada `:175`; kolom tunai menempatkan Diterima dan Kembalian berdampingan pada `:220`, dengan label 11px pada `:222` dan `:248`.

**Dampak:** banyak informasi sekunder bersaing dengan total, nominal diterima, dan aksi menyelesaikan pembayaran. Badge tipe sering mengulang nama metode. Ini evaluasi statis terhadap skala dan struktur, belum pengukuran keterbacaan layar atau kontras aktual.

**Rekomendasi:** metode utama memakai pilihan berlabel jelas dengan status terpilih aksesibel; Pembayaran campuran menjadi aksi sekunder; total dan uang diterima lebih menonjol; rincian fee, referensi, dan kredit ditampilkan sesuai kebutuhan. Target sentuh utama setidaknya 44px sebagai pilihan desain kasir, bukan klaim seluruh standar mensyaratkannya.

**Penerimaan:** tunai uang pas dan tunai dengan kembalian dapat diselesaikan dengan keyboard; metode terpilih terbaca screen reader; kontrol inti tidak membutuhkan scroll horizontal; layar sempit tetap menampilkan total dan aksi bayar.

## Hal yang sudah baik dan harus dipertahankan

- Checkout menolak keranjang kosong, sesi kas tertutup, dan utang tanpa pelanggan/jatuh tempo (`use-terminal-checkout.ts:202`).
- Keranjang online dibersihkan setelah hasil server `ok` (`:309–319`).
- Snapshot offline disimpan sebelum keranjang dibersihkan (`:176–188`).
- Payload offline mempertahankan kasir, sesi asal, expectedTotal, harga, dan kemasan (`:124–174`).
- Resume memberi pilihan menyelamatkan keranjang aktif dan memulihkannya ketika pemuatan gagal (`use-held-sales.ts:149–176`, `terminal-dialogs.tsx:105`).

## Rancangan alur yang disarankan

1. Sesi kas siap → fokus pencarian/scanner.
2. Scan/pilih produk → umpan balik item ditambahkan → koreksi jumlah/satuan pada baris terpilih.
3. Bayar → total tetap jelas → metode pembayaran dan hanya field yang relevan.
4. Konfirmasi penyimpanan → ringkasan nominal/kembalian → Cetak struk atau Transaksi baru.
5. Transaksi baru mengembalikan fokus pencarian. Tahan, lanjut, retur, dan riwayat berada pada aksi yang konsisten.
6. Ketika offline, hasil transaksi menggunakan status lokal dan menyediakan akses rekonsiliasi antrean.

## Batas cakupan

Belum diperiksa penuh dalam sub-audit ini: scanner HID/camera, seluruh kart/barcode lookup, retur dan void server, detail rekonsiliasi offline, sesi kas, printer fisik, tampilan desktop/tablet/mobile langsung, navigasi screen reader, dan pengukuran kontras. Tidak menjalankan transaksi atau pengujian database. Referensi eksternal digabungkan oleh audit induk; rekomendasi di sini diturunkan dari bukti kode dan tujuan operasional kasir.
