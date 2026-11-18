# Rencana aplikasi kasir Bisa POS Tauri

Tanggal: 16 November 2026  
Scope: aplikasi desktop POS di `pos-desktop/` dan `src-tauri/`, beserta API POS server yang memang diperlukan untuk autentikasi dan sinkronisasi. Tidak mencakup modul ERP lain.

## Riset dan kondisi repository

- POS web `/app/pos` adalah pengalaman utama, tetapi `PosTerminal` mengandalkan Server Actions dan antrean IndexedDB. POS desktop memakai static export, sehingga tidak dapat mengimpor `PosTerminal` utuh atau memanggil Server Actions. UI perlu memakai bahasa visual dan urutan kerja yang sama melalui adapter Tauri.
- Tauri v2, SQLite lokal, outbox, snapshot produk, cetak ESC/POS melalui TCP, layar pelanggan, updater, dan keyring OS sudah tersedia. Workspace kasir desktop kini memprioritaskan katalog dan checkout, menyediakan preferensi tampilan, pembayaran campuran, checkout lokal, riwayat lokal/server, serta detail dan aksi retur/void online. Pilihan cetak melalui antrean CUPS lokal juga tersedia untuk konfigurasi Linux yang kompatibel. Beberapa operasi masih lokal atau belum lengkap dibanding POS web.
- Token terminal mengikat perangkat ke company dan user, dapat dicabut, dan diperiksa ulang permission `pos.sell` saat sync. Penjualan offline harus tetap antre, idempoten, dan tidak disebut posted sebelum server menerima.
- Login pertama dan enrollment terminal wajib online. Setelah enrollment, login kasir dapat memakai fallback offline terbatas tujuh hari: password diverifikasi lokal dengan Argon2id dan hash PHC disimpan hanya di keychain OS. Password mentah dan cookie Better Auth tidak disimpan; cookie hanya berada di proses Rust sementara. Token perangkat tetap terpisah di keychain. Terminal didaftarkan otomatis setelah hak POS diverifikasi; kode pairing manual tidak ditampilkan dalam alur normal.
- Penukaran kode pairing tetap tersedia untuk kompatibilitas terminal yang sudah diprovisikan. Jangan menghapus jalur server tersebut sebelum migrasi perangkat lama terverifikasi.

## Referensi primer

- [Accurate POS](https://accurate.id/download/pos/) — acuan untuk scan-ke-keranjang, alur kasir, pembayaran, shift, retur/hold, dan perangkat kasir.
- [Odoo 19 POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale.html) dan [alur operasi POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html) — pemisahan kasir/manajer, sesi kas, dan pemulihan saat koneksi terputus.
- [Better Auth sign-in email](https://better-auth.com/docs/authentication/email-password), [API server](https://better-auth.com/docs/concepts/api), dan [2FA](https://better-auth.com/docs/plugins/2fa) — API autentikasi dan challenge 2FA.
- [Next.js static export](https://nextjs.org/docs/app/guides/static-exports) — Server Actions dan handler dinamis tidak tersedia dalam bundle desktop statis.
- [Tauri v2 security model](https://v2.tauri.app/security/) — operasi rahasia/jaringan tetap di Rust; WebView memakai IPC terbatas.
- [RustCrypto Argon2](https://docs.rs/argon2/latest/argon2/) — API hashing password Argon2id menghasilkan PHC string bersalt acak dan memverifikasinya tanpa menyimpan password mentah.
- [CUPS command-line printing](https://www.cups.org/doc/options.html) dan [lpstat](https://www.cups.org/doc/man-lpstat.html) — antrean lokal dapat ditemukan melalui `lpstat -p` dan job dapat dikirim ke antrean tertentu.
- [OpenPrinting: printer applications and drivers](https://openprinting.github.io/cups/drivers.html) dan [CUPS v3](https://openprinting.github.io/cups/cups3.html) — antrean raw sudah deprecated sejak CUPS 2.2 dan dihapus pada CUPS 3; USB lokal di CUPS 3 membutuhkan printer application yang menerima format printer.

## Rencana eksekusi

### Tahap A — shell kasir dan login

1. Buat gerbang masuk kasir saat aplikasi dibuka; setelah berhasil, tampilkan workspace kasir.
2. Gunakan endpoint Better Auth email/password dari Rust, dukung challenge TOTP, lalu enrollment terminal otomatis berbasis identitas instalasi. Jangan mengirim password atau token terminal ke localStorage/WebView; token terminal tetap di keyring.
3. Catat user kasir aktif pada sesi lokal dan payload penjualan. Tolak pergantian kasir saat sesi masih terbuka atau outbox belum kosong agar transaksi lama tidak disinkronkan sebagai aktor yang salah.
4. Pertahankan login offline hanya untuk identitas yang pernah terautentikasi di perangkat; login pertama tidak dapat dilakukan tanpa server.

### Tahap B — POS satu layar

1. Utamakan layar transaksi: pencarian/barcode, kategori/katalog dan stok di sisi kiri; keranjang, total, pembayaran, dan aksi utama di sisi kanan.
2. Pindahkan snapshot/sinkronisasi, printer, layar pelanggan, update, riwayat outbox, serta administrasi terminal ke lembar/panel pengaturan yang tidak memenuhi layar kasir.
3. Gunakan target sentuh minimal 44 px, tipografi dan kontras yang terbaca, fokus keyboard scanner, serta tata letak yang responsif. Gunakan presentasi POS web sebagai acuan tanpa menarik Server Actions ke bundle statis.
4. Setelah transaksi lokal tersimpan, tampilkan hasil sukses dengan status “menunggu sinkronisasi” atau “tersinkron” dan aksi cetak/ulang cetak yang tidak menggagalkan penjualan.

### Tahap C — kesetaraan fitur dan operasi

1. Petakan tiap kemampuan desktop terhadap POS web dan lengkapi bertahap melalui service Tauri/Rust: keranjang, pelanggan/utang, pembayaran campuran, tahan/panggil pesanan, retur/kredit, diskon/serial, sesi kas, dan akses supervisor.
2. Untuk fitur yang belum didukung SQLite/outbox/server transport, tentukan kontrak data dan idempotensi sebelum UI menampilkannya sebagai tersedia. Jangan membuat saldo lokal yang tidak dapat direkonsiliasi dengan transaksi server.
3. Uji build desktop dan validasi statis setiap tahap; transaksi end-to-end, printer USB fisik, login 2FA, serta sinkronisasi offline tetap perlu diverifikasi pada perangkat dan server yang terhubung.

## Status implementasi saat ini

| Area | Status | Batas yang masih berlaku |
|---|---|---|
| Login kasir, TOTP, pilihan perusahaan, enrollment otomatis, dan unlock offline | Terimplementasi | Login awal/enrollment tetap perlu server. Fallback offline hanya berlaku untuk terminal, server, kasir, dan perusahaan yang sudah terdaftar; tujuh hari sejak autentikasi online; verifikator hanya disimpan di keychain OS. Penolakan kredensial server (mis. password salah) tidak memakai fallback. |
| Workspace kasir, kontrol tampilan, dan checkout tablet | Sebagian | Pengaturan grid/list, kolom, density, skala teks, bentuk kartu, lebar keranjang, informasi produk, dan fullscreen memakai skema preferensi POS web. Panel checkout bawah tersedia pada layar sempit. Shell desktop masih memakai komponen sendiri untuk static export, jadi paritas visual belum identik di seluruh keadaan. |
| Scan, snapshot katalog, kategori, SKU/barcode, harga kelompok, kemasan, serial, pelanggan, pembayaran campuran dan biaya metode | Terimplementasi sebagian besar | Fitur utama tersedia di terminal dan disimpan lokal. Belum ada validasi transaksi nyata pada server usaha; konfigurasi multi-gudang masih mengikuti gudang terminal. |
| Siklus sesi kas dan sinkronisasi transaksi | Implementasi diperbaiki, perlu validasi operasional | Intent buka sesi memakai ID lokal yang sama di server; intent tutup menunggu seluruh penjualan sesi berstatus tersinkron, lalu memakai gerbang penutupan/jurnal server. Typecheck dan kompilasi lolos, tetapi belum diuji dengan server dan database yang terhubung. |
| Simpan penjualan offline, antrean idempoten, customer display, struk lokal dan antrean cetak | Terimplementasi sebagian | SQLite dan outbox tersedia. Cetak mendukung TCP dan antrean CUPS lokal berformat raw; jalur CUPS perlu printer USB terpasang sebagai antrean sistem dan raw queue hanya didukung CUPS 2.x. Tidak diuji pada printer fisik. Unlock offline kini tersedia tujuh hari sejak login online; perubahan password, pencabutan akun, atau permission server belum diketahui terminal sampai tersambung lagi. |
| Tahan/panggil pesanan | Terimplementasi sebagian | Hold baru dibagi lintas terminal melalui server saat online dan disalin ke SQLite terminal pembuat; hold yang dipanggil online juga di-cache. Salinan lokal yang tampak di daftar server disembunyikan agar tidak dobel; cache stale dibersihkan saat daftar server lengkap termuat. Hold dari terminal lain yang belum pernah dibuka/disimpan di terminal ini belum tersedia offline. Checkout pesanan server mengunci dan menghapus hold secara atomik saat outbox tersinkron. |
| Riwayat transaksi, retur/refund, void, pencetakan ulang dari riwayat, serta persetujuan supervisor | Sebagian | Riwayat lokal terhalaman dan cetak ulang nota per terminal tersedia saat offline, tetapi daftar lokal masih berupa ringkasan. Riwayat server lintas terminal, detail nota, filter status, retur parsial/tukar/refund, dan void memakai API bertoken serta domain server dengan izin yang diperiksa ulang. Cetak ulang nota server kini membentuk salinan ESC/POS dari data server lalu mengirim langsung lewat TCP/CUPS; jalur ini perlu online dan tidak memakai antrean cetak yang dapat dicoba ulang. Filter tanggal server dan persetujuan supervisor berbasis PIN masih belum tersedia. |
| Kesetaraan semua fitur POS web | Belum selesai | Shell statis meniru alur transaksi melalui adapter Tauri; belum seluruh tampilan identik. Hold server membutuhkan jaringan saat dipanggil. Printer USB langsung belum didukung di luar antrean OS; beberapa filter riwayat dan langkah persetujuan masih berbeda. |

Verifikasi implementasi terbaru: `pnpm typecheck`, `pnpm pos:export`, `cargo check --manifest-path src-tauri/Cargo.toml`, `git diff --check`, dan `pnpm tauri build --bundles deb,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'` berhasil. `cargo check` menampilkan 11 warning dead-code yang tidak menggagalkan build. Installer DEB (7.02 MiB) dan AppImage x86_64 (113.62 MiB) berhasil dibungkus. Updater artifact sengaja tidak dibuat oleh opsi build tersebut. Tidak ada database usaha/server atau perangkat printer fisik yang dipakai. Build lokal tidak membuktikan autentikasi jaringan, alur login offline pada OS keychain sebenarnya, sinkronisasi transaksi/retur, saldo kas, atau hasil cetak pada perangkat nyata.

## Batasan dan kriteria penerimaan

- Startup menampilkan login kasir; setelah online enrollment, kasir dapat membuka POS offline dengan email/password yang sama selama tujuh hari tanpa pairing manual. Server online tetap menjadi sumber kebenaran autentikasi dan izin.
- Setelah login server berhasil, perangkat memperoleh token terbatas dan status terminal muncul di daftar admin; server tetap dapat mencabut token dan memvalidasi permission.
- Kegagalan jaringan tidak menghapus katalog, transaksi lokal, atau outbox. Transaksi belum diterima server selalu berlabel belum tersinkron.
- Layar kasir memusatkan scan, produk, keranjang, total, dan pembayaran; pengaturan perangkat tidak mengambil ruang utama. Riwayat lokal hanya menampilkan transaksi yang dibuat pada terminal tersebut dan tidak menggantikan riwayat server lintas terminal.
- Fitur yang belum punya implementasi domain lokal/server tidak ditandai selesai atau tersedia.

## Risiko yang perlu ditutup sebelum rilis

- Login langsung melalui LAN HTTP dapat mengekspos password; produksi harus memakai HTTPS dengan sertifikat yang dipercaya perangkat. Jangan menonaktifkan verifikasi sertifikat.
- Multi-company dan user yang memiliki lebih dari satu entitlement POS perlu pilihan yang tervalidasi; auto-enrollment tidak boleh memilih tenant arbitrer.
- Pergantian kasir saat masih ada sesi/outbox menimbulkan atribusi salah; pergantian harus dikunci sampai transaksi antrean selesai dan sesi tutup.
- Aplikasi offline tidak dapat mengetahui pencabutan akun/password/permission server sampai tersambung lagi. Fallback password lokal juga tidak dapat memvalidasi ulang 2FA server; terminal harus dijaga secara fisik, dan kebijakan tujuh hari perlu disetujui sebelum penggunaan multi-kasir.
- Antrean CUPS raw tidak kompatibel dengan CUPS 3; printer lokal di sana perlu Printer Application yang mendukung format thermal, atau jalur koneksi lain. Dukungan USB melalui CUPS bergantung pada konfigurasi antrean OS dan belum diuji pada perangkat fisik.
