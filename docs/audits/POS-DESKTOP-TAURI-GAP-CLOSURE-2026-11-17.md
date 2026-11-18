# Rencana penutupan gap Bisa POS Desktop

Tanggal: 17 November 2026  
Scope: POS desktop Tauri, layar pelanggan desktop, serta API POS yang hanya dibutuhkan aplikasi desktop. Tidak mencakup modul ERP lain.

## Dasar riset

- [Odoo 19 — Workflow POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html): sesi/register, penjualan, pembayaran, bukti transaksi, retur, hak akses, serta fungsi POS saat koneksi terputus.
- [Odoo 19 — Local Network Access](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/hardware_network/pos_lna.html) dan [Receipt Printers](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/hardware_network/receipt_printers.html): akses printer harus eksplisit dan perangkat jaringan sebaiknya memakai alamat tetap.
- [Accurate POS — Pembayaran](https://accurate.id/pos/fitur/pembayaran/): tunai/non-tunai, QRIS, piutang, serta pembayaran campuran.
- [Accurate POS — Manajemen Karyawan](https://accurate.id/pos/fitur/management-karyawan/): sesi kas, identitas kasir, batas tindakan supervisor, dan audit aktivitas.
- [Next.js 16.4 — Static Exports](https://nextjs.org/docs/app/guides/static-exports): shell desktop tetap memakai Client Component dan adapter Tauri karena bundle statis tidak dapat menjalankan Server Actions secara lokal.

Referensi dipakai sebagai pembanding alur dan kontrol operasional, bukan sebagai alasan menambah fitur yang tidak dibutuhkan minimarket.

## Bukti gap yang diperiksa

1. Sesudah server menyatakan token perangkat tidak sah, status `authFailed` ditampilkan tetapi checkout lokal masih dapat merekam penjualan yang tidak akan bisa disinkronkan.
2. Layar pelanggan menerima harga satuan katalog, sehingga harga kelompok, diskon, pajak inklusif, dan pembulatan berbeda dari quote kasir.
3. Snapshot layar pelanggan diminta sebelum listener dipasang; kegagalan listener disembunyikan dan bisa meninggalkan nominal lama tanpa status koneksi.
4. Kasir tidak dapat langsung memanggil hold ketika keranjang aktif; belum ada dialog aman yang menahan keranjang aktif dahulu.
5. Kegagalan jaringan ketika membuat hold server dapat membuat hold lokal tanpa pemulihan kunci idempotensi, padahal server mungkin sudah commit.
6. Riwayat transaksi desktop belum memiliki filter rentang tanggal pada sumber lokal maupun server.
7. Hold web menyimpan total saat ditahan dan menampilkan peringatan bila quote berubah; desktop belum menampilkan peringatan tersebut.
8. Dialog transaksi berhasil desktop belum menyajikan rincian uang diterima/kembalian dan perilaku fokus yang setara dengan alur kasir web.

## Urutan eksekusi

1. **Keselamatan transaksi:** hentikan checkout baru setelah token ditolak server; transaksi lama tetap tersimpan dan dapat ditinjau.
2. **Kesamaan nominal:** kirim quote kasir yang sudah dihitung ke layar pelanggan dan tampilkan status koneksi/snapshot secara benar.
3. **Hold yang aman:** sediakan pilihan tahan keranjang aktif lalu resume; pertahankan request/key hold yang belum terkonfirmasi dan rekonsiliasi dengan key yang sama sebelum checkout; perlihatkan perubahan total dari snapshot hold.
4. **Riwayat:** tambahkan filter tanggal awal/akhir pada pencarian lokal dan server dengan validasi rentang di server.
5. **Sukses checkout:** tampilkan ringkasan pembayaran/kembalian, status sinkronisasi dan cetak; kelola fokus keyboard setelah dialog ditutup.

## Kriteria penerimaan

- Token yang telah dicabut/ditolak membuat transaksi baru tidak bisa masuk SQLite; antrean yang sudah ada tetap utuh.
- Total dan subtotal yang tampak pada layar pelanggan berasal dari quote yang sama dengan terminal kasir, termasuk kelompok harga, diskon, dan pembulatan.
- Layar pelanggan memasang listener sebelum snapshot, mengabaikan snapshot yang lebih lama dari event terbaru, dan memperlihatkan keadaan tidak tersambung.
- Resume hold tidak menimpa keranjang aktif; hold server yang hasilnya ambigu memakai request/key sama untuk rekonsiliasi dan tidak menghasilkan pesanan yatim ketika checkout.
- Peringatan muncul ketika harga/total hasil hitung ulang berbeda dari total hold yang tersimpan.
- Filter tanggal menyaring transaksi lokal dan server, menolak tanggal kalender tidak valid, serta menolak tanggal awal setelah tanggal akhir.
- Sesudah pembayaran, ringkasan menunjukkan nominal yang ditagih, tender tunai/kembalian jika relevan, status sinkronisasi, dan aksi nota; keyboard tetap dapat melanjutkan ke scan.

## Batas verifikasi

Pemeriksaan kode, typecheck, static export, dan kompilasi Tauri dapat dilakukan di workspace. Login online/offline pada sistem keychain, token yang benar-benar dicabut, jaringan putus setelah commit hold, pencetakan, dan layar pelanggan pada monitor fisik tetap membutuhkan server serta perangkat operasional; hasil build lokal tidak dianggap sebagai bukti untuk alur tersebut.

## Referensi tambahan yang ditinjau

- [Accurate POS — fitur dan perangkat](https://accurate.id/download/pos/): Accurate menyebut transaksi tanpa internet, jaringan lokal multi-device, pembayaran campuran, retur parsial, shift, hak akses, dan jenis printer. Ini bukti kapabilitas produk, bukan spesifikasi perilaku tiap langkah.
- [Accurate — membuat pesanan baru](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/pesanan-baru/membuat-pesanan-baru/): pelanggan bersifat opsional untuk transaksi rutin; produk, kuantitas, diskon, pembayaran, dan penyelesaian berada dalam alur ringkas.
- [Accurate — retur dan ganti barang](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/riwayat-penjualan/retur-ganti-barang/): retur dimulai dari transaksi asal, memilih barang/kuantitas, metode refund, alasan, dan akses karyawan.
- [Accurate — printer Wi-Fi/LAN](https://help.accurate.id/product/accurate-pos/fitur-apos/setting-printer/cara-setting-printer-wifi-lan/): perangkat harus berada dalam jaringan yang sama; daftar printer dan alamat IP manual merupakan jalur konfigurasi.
- [Odoo 19 — POS overview](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale.html) dan [alur transaksi](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html): register, cart, numpad, hold/resume, receipt, refund, serta keterbatasan spesifik ketika offline.
- [Odoo 19 — employee login](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/employee_login.html), [payment methods](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/payment_methods.html), dan [cash rounding](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/pricing/cash_rounding.html): PIN/role, shortcut metode, nominal uang diterima, dan pembulatan yang dapat diaudit.
- [Tauri v2 architecture](https://v2.tauri.app/concept/architecture/), [security](https://v2.tauri.app/security/), dan [capabilities](https://v2.tauri.app/security/capabilities/): UI desktop berjalan di WebView dan kemampuan native harus tetap dibatasi pada IPC yang diperlukan.
- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports): shell POS lokal dapat diekspor statis; database lokal dan operasi perangkat tetap ditangani adapter Tauri/Rust.

Pelajaran tentang urutan tindakan dan batasan offline di atas bersumber langsung dari dokumentasi vendor. Keputusan untuk menyimpan request hold ke SQLite sebelum mengirimnya adalah inferensi desain idempotensi/write-ahead agar terminal bisa memulihkan hasil ketika respons jaringan hilang.

## Hasil implementasi

| Kriteria | Hasil kode | Bukti / batas |
|---|---|---|
| Penjualan baru diblokir setelah token terminal ditolak | Selesai | `handleRecordSale` memeriksa `authFailed`; transaksi antrean lama tetap disimpan. Belum diuji terhadap token yang benar-benar dicabut. |
| Nilai layar pelanggan sama dengan quote kasir | Selesai | Baris mengirim harga kelompok, diskon, total baris, dan total quote termasuk pajak/pembulatan. UI menampilkan diskon. Belum diuji di monitor kedua fisik. |
| Layar pelanggan memasang event listener sebelum snapshot | Selesai | Event yang datang lebih dulu menaikkan versi lokal sehingga snapshot lama tidak menimpa cart lebih baru; kegagalan listener ditampilkan. Perlu validasi dua jendela di perangkat. |
| Hold ambigu aman dipulihkan | Selesai pada jalur kode | Request hold dan idempotency key disimpan lokal sebelum HTTP. Resume mengulang request yang sama dan tidak membuka checkout sebelum rekonsiliasi. Belum diuji dengan pemutusan jaringan sesudah server commit. |
| Resume tidak menimpa cart aktif | Selesai | Dialog meminta kasir menahan cart aktif dahulu, lalu memanggil target. Total saat hold dibandingkan dengan quote sekarang. |
| Riwayat dapat difilter berdasarkan tanggal | Selesai | Filter `from/to` berjalan pada SQLite lokal dan endpoint server; tanggal kalender/rentang divalidasi. Perlu verifikasi terhadap data produksi besar. |
| Dialog sukses menyajikan kembalian dan menjaga fokus | Selesai | Nominal uang tunai/kembalian, fokus dialog, Escape, siklus Tab, dan fokus kembali ke pemindai. Perlu pemeriksaan keyboard/manual di desktop. |
| Login offline tidak menurunkan akun MFA menjadi password-only | Selesai pada kebijakan kode | Akun yang melewati TOTP tidak diberi kredensial offline berbasis password; credential lama tanpa kebijakan baru ditolak sampai otorisasi online. Perlu uji keychain pada mesin target. |

## Verifikasi workspace

- `pnpm typecheck` — berhasil.
- `pnpm pos:export` — berhasil; route `/` dan `/display` dibuat sebagai static export.
- `cargo check --manifest-path src-tauri/Cargo.toml` — berhasil; ada warning `dead_code` yang tidak menggagalkan kompilasi.
- `pnpm tauri build --bundles deb,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'` — berhasil.
- `git diff --check` — berhasil.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` — tidak bersih; rustfmt mengusulkan perubahan format pada banyak file crate. Format massal tidak diterapkan agar tidak menyentuh area yang tidak diperlukan.
- Test suite tidak dijalankan sesuai batas pengerjaan.

Artefak Linux terbaru:

- `src-tauri/target/release/bundle/deb/Bisa POS_0.1.0_amd64.deb` (7.02 MiB)
- `src-tauri/target/release/bundle/appimage/Bisa POS_0.1.0_amd64.AppImage` (113.62 MiB)

## Risiko yang masih perlu verifikasi operasional

- Server URL HTTP masih dapat digunakan untuk jaringan lokal. Untuk login/enrollment di Wi-Fi yang tidak sepenuhnya dipercaya, gunakan HTTPS; build ini tidak memasang sertifikat atau mengubah konfigurasi server.
- Printer thermal USB/CUPS/TCP, scanner fisik, auto-login startup desktop, monitor pelanggan kedua, update bertanda tangan, dan pemulihan setelah proses dimatikan mendadak perlu diuji pada PC/outlet target.
- Akun yang mewajibkan TOTP tidak dapat memakai password-only offline login. Terminal tersebut harus memperoleh koneksi untuk autentikasi kasir; transaksi lokal yang sudah diantrikan tetap ada.
- Penutupan sesi lokal menghitung mutasi kas penjualan yang ada dalam database terminal. Pembatalan/refund online yang belum tercermin di snapshot lokal dapat membuat pratinjau selisih berbeda sampai server memproses penutupan resmi; jangan memakai hasil pratinjau lokal sebagai rekonsiliasi final tanpa koneksi.

## Addendum verifikasi dan perbaikan sesi — 17 November 2026

### Perubahan yang ditutup

- Setoran dan penarikan sesi kini tersimpan sebagai intent SQLite lokal yang idempoten. Setoran tidak bisa melebihi kas laci yang dihitung terminal; transaksi tunai lokal, setoran, dan penarikan menjadi dasar pratinjau hitung kas. Pembatalan/refund tunai server tetap ditampilkan sebagai batas rekonsiliasi terminal.
- Saat tersambung, mutasi memakai domain `cashDrawerMovement` yang sama dengan POS web, termasuk jurnal, pemeriksaan sesi pemilik, audit trail, dan validasi saldo setoran. Tutup sesi menunggu seluruh mutasi lebih dahulu diterima server.
- API desktop kini memeriksa izin `pos.session` untuk buka/tutup/mutasi kas. Penolakan bisnis disimpan sebagai `needsReview`; layar sesi menampilkan pesan server dan tindakan kirim ulang dengan client key yang sama. Pembukaan sesi juga dapat dikirim ulang setelah hak akses atau penyebab penolakan diperbaiki.
- Status waktu intent offline tertua ditampilkan sebagai detail aksesibilitas/tooltip, tanpa menambah elemen permanen pada toolbar kasir.
- Konfirmasi retur di riwayat transaksi tidak lagi memakai state setter sinkron dalam effect. Riwayat sesi menandai loading saat diminta dari interaksi/event, bukan dari awal effect React.

### Verifikasi yang dijalankan

- `pnpm typecheck` — berhasil.
- ESLint pada `pos-desktop/app/page.tsx` dan `src/server/pos-device.ts` — berhasil.
- `pnpm exec vitest run tests/unit/pos-terminal-ui1.test.ts` — 17 test berhasil.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 76 test berhasil, termasuk idempotensi mutasi dan pemulihan pembukaan sesi.
- `pnpm pos:export` — berhasil; `/` dan `/display` terbentuk sebagai static export.
- `pnpm tauri build --bundles deb,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'` — berhasil. Artefak: `src-tauri/target/release/bundle/deb/Bisa POS_0.1.0_amd64.deb` (7.09 MiB) dan `src-tauri/target/release/bundle/appimage/Bisa POS_0.1.0_amd64.AppImage` (113.67 MiB).
- `git diff --check` — berhasil.

Suite integrasi/API yang memerlukan PostgreSQL khusus tidak dijalankan ulang karena `BISA_TEST_DATABASE_URL` dan `BISA_TEST_DIRECT_URL` tidak tersedia. Sebelumnya satu pemanggilan Vitest dengan filter unit yang salah sempat memuat dua suite integrasi yang tidak dimaksud; proses dihentikan, dua suite yang tampak gagal memakai helper transaksi rollback, dan tidak ada seed, migrasi, reset, atau restore yang dijalankan. Saya tidak mengklaim hasil database operasional bebas perubahan secara absolut dan tidak melakukan pembersihan otomatis.

### Batas yang masih memerlukan outlet/perangkat

Build membuktikan aplikasi dapat diekspor dan dipaketkan, bukan bahwa perangkat kasir sudah tervalidasi. Login/enrollment pada server, otorisasi per role, pemutusan Wi-Fi di tengah commit, alur retur dan refund tunai terhadap sesi server, scanner fisik, printer USB/CUPS/TCP, layar pelanggan kedua, dan pemulihan sesudah proses dimatikan tetap perlu uji di terminal serta server outlet. Pemeriksaan kode, UI, kompilasi, dan unit test di addendum ini sendiri tidak membutuhkan database.

Riset pembanding yang dipakai untuk alur sesi, pembayaran, struk, dan kontrol kas adalah [Odoo 19 POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html), [Odoo 19 payment methods](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/payment_methods.html), [Accurate POS — penyelesaian shift](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/karyawan/menyelesaikan-shif/), dan [Accurate POS — retur sebagian](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/riwayat-penjualan/mencatat-retur-pengembalian-sebagian/). Tidak ada Exa MCP terpasang pada sesi kerja ini; nama “iFimart” juga tidak menghasilkan dokumentasi resmi POS yang cukup untuk memverifikasi workflow, sehingga tidak dipakai sebagai dasar klaim.

## Addendum pratinjau tutup sesi per antrean sesi — 17 November 2026

Sebelumnya layar tutup sesi mensyaratkan seluruh outbox terminal kosong dan menganggap setiap kegagalan drain sebagai bukti saldo sesi belum sinkron. Item offline/tertahan milik sesi lain dapat memaksa kasir memakai estimasi terminal meskipun semua transaksi sesi aktif sudah diterima server. Pemeriksaan sekarang menghitung outbox dan intent berdasarkan ID sesi; untuk penjualan lama tanpa `originSessionId`, ia mempertahankan aturan kompatibilitas gudang + waktu buka sesi yang sama dengan kalkulasi kas lokal. Jika antrean sesi aktif masih pending/held atau tidak dapat diverifikasi, UI tetap menandai estimasi lokal; bila antrean sesi bersih, UI memakai ringkasan kas server tanpa diblokir antrean yang tidak terkait. Gerbang `pending_intents` untuk penutupan juga memakai aturan gudang + waktu tersebut, sehingga penjualan warisan yang pending atau held menahan tutup sesi sampai server benar-benar menerima penjualan.

Tes Rust mencakup antrean tertahan sesi lain, penjualan sesi aktif, penjualan warisan tanpa ID sesi, intent mutasi kas lintas sesi, dan gerbang tutup sesi saat penjualan warisan pending/held. Verifikasi terbaru: `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 81 berhasil; 4 suite POS (UI desktop, tutup sesi, timeline sinkronisasi, dan ESC/POS) — 30 berhasil; `pnpm typecheck` — berhasil; ESLint untuk `pos-desktop/app/page.tsx` dan `pos-desktop/lib/pos-bridge.ts` — berhasil; `pnpm pos:export` — berhasil untuk `/` dan `/display`; `git diff --check` — berhasil. `cargo fmt --check` tetap tidak bersih karena rustfmt mengusulkan perubahan lama dan luas di banyak berkas crate; formatter tidak diterapkan secara massal.

Paket Linux dibangun ulang dengan updater artifact dimatikan sementara karena private signing key belum tersedia: `pnpm tauri build --bundles deb,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'` berhasil. DEB (7.12 MiB, SHA-256 `0d67a5e530774ea107d62d4df181f97d15927db84351c55b861110c59d12733b`) dan AppImage (113.68 MiB, SHA-256 `ce103700cb2e54f0298a037ceb9c6ad1c6665be0d0daaed04475919420efcb31`) teridentifikasi sebagai paket Debian v2 dan ELF x86-64; AppImage runtime melaporkan versinya. Build ini memuat gerbang penutupan sesi terbaru. AppImage dijalankan memakai `XDG_DATA_HOME` sementara yang terisolasi; proses Tauri tetap aktif, membuat database kosong di profil itu, lalu dihentikan dengan SIGINT. Ini memverifikasi startup dasar, bukan rendering visual, transaksi, pairing server, atau operasi printer/scanner. Paket belum diuji pada PC kasir outlet.

Lingkungan kerja tidak memiliki `BISA_TEST_DATABASE_URL`/`BISA_TEST_DIRECT_URL` dan `lpstat` tidak menemukan printer CUPS. Karena itu, API yang bergantung pada PostgreSQL dan cetak fisik USB/CUPS tidak bisa divalidasi di sini; tidak ada data perusahaan atau printer fisik yang disentuh.

## Addendum nominal awal shift dibuat eksplisit — 17 November 2026

Audit layar pembukaan shift menemukan nominal Rp100.000 sudah terisi sebelum kasir menghitung laci. Ini dapat merekam modal yang tidak sesuai bila kasir hanya menekan “Mulai shift”. Nominal awal kini kosong; kasir harus memasukkan uang yang dihitung atau memilih preset “Tanpa modal”, Rp50.000, Rp100.000, atau Rp200.000. Setelah sesi berhasil dibuka, nilai masukan dikosongkan lagi agar tidak terbawa ke shift berikutnya.

Pola ini mengikuti prinsip pembukaan kas Odoo yang meminta saldo awal dikonfirmasi saat register dibuka ([Odoo 19 POS workflow](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html)) dan alur Accurate POS yang meminta kasir mengisi modal awal sebelum siap transaksi ([Accurate POS — memulai shift](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/karyawan/memulai-shift/)). Ini mengurangi kemungkinan angka sesi tercatat tanpa pemeriksaan fisik.

Verifikasi perubahan: `pnpm typecheck`, ESLint untuk `pos-desktop/app/page.tsx`, dan seluruh sembilan suite unit POS (`pnpm exec vitest run tests/unit/pos-*.test.ts`; 63 test) berhasil; `git diff --check` bersih. Interaksi jumlah uang masih perlu pemeriksaan manual di terminal kasir; basis data outlet tidak tersedia.

Paket desktop dibangun ulang sesudah perubahan: `pnpm tauri build --bundles deb,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'` berhasil; static export menghasilkan `/` dan `/display`. AppImage dibuka memakai direktori data sementara terisolasi, membuat basis data SQLite kosong, lalu dihentikan. Ini memverifikasi startup dasar saja. DEB SHA-256 `b632dc557705509e3e6bd309974a8ff3dcc27084cb6eeb301744d64b9ec4d814`; AppImage SHA-256 `0854e3e1cd3257deaca3ab41a074a7c0ab349c67afd97bee7245c622e2c60b90`. Artefak updater tetap tidak dibuat karena kunci penandatangan privat tidak tersedia.

## Addendum retry void yang aman — 17 November 2026

Audit alur void pada riwayat desktop menemukan celah saat server sudah membalik transaksi tetapi respons hilang: pengulangan permintaan lama ditolak sebagai “sudah void”, sehingga kasir tidak dapat membedakan transaksi berhasil dari transaksi yang belum diproses. Klien desktop kini menyimpan kunci UUID dan fingerprint alasan per nota sebelum mengirim permintaan; permintaan ulang memakai kunci dan alasan yang sama. API desktop mengklaim kunci dalam transaksi yang sama dengan `voidSale`, menyimpan fingerprint hasil, lalu mengembalikan sukses saat menerima replay dengan isi yang identik. Kunci yang digunakan untuk nota/alasan berbeda ditolak sebagai konflik. Pembacaan ulang detail nota menghapus kunci lokal yang ambigu setelah status server berhasil dimuat. Kunci API opsional hanya untuk kompatibilitas biner desktop lama; klien baru selalu mengirimkannya.

Kriteria penerimaan kode: satu void menghasilkan satu efek domain/audit; retry identik menghasilkan sukses tanpa posting kedua; key yang dipakai dengan alasan berbeda menghasilkan HTTP 409; payload klien lama tetap diterima. Tes integrasi PostgreSQL untuk tiga kondisi tersebut ditambahkan ke `tests/integration/pos-device-api.test.ts`, tetapi belum dijalankan karena `BISA_TEST_DATABASE_URL` dan `BISA_TEST_DIRECT_URL` tidak tersedia. Kode sudah lolos `pnpm typecheck`, ESLint pada berkas route/klien/test yang berubah, serta sembilan suite unit POS (63 test). Pemeriksaan transaksi nyata tetap memerlukan basis data uji.

Pola ini memperkuat pembatalan yang dapat dipulihkan ketika jawaban jaringan hilang; aturan bisnis void tetap menggunakan domain `voidSale` yang sama dengan POS web, termasuk pembalikan stok dan jurnal. Referensi workflow retur/void yang ditinjau tetap [Odoo 19 POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html) dan [Accurate POS — retur dari riwayat transaksi](https://help.accurate.id/product/accurate-pos/pengaturan-aplikasi/riwayat-penjualan/retur-ganti-barang/).

Setelah perbaikan retry void, paket dibangun ulang memakai `pnpm tauri build --bundles deb,appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'`. AppImage berjalan memakai `XDG_DATA_HOME` sementara yang terisolasi dan dihentikan dengan SIGINT setelah startup; ini bukan validasi tampilan atau transaksi terhadap server. DEB SHA-256 `6ce7ffee191f7b724656c50379dfdf2cd0ce543606ffd9acb61fe54868487f3f`; AppImage SHA-256 `a1c39ac3c6989ec5e6eeb75030245ed7fb196da43843dff837039569f7b21a2c`. Updater signatures tetap tidak tersedia karena kunci privat belum ada.

Verifikasi setelah rebuild: `pnpm typecheck`, ESLint untuk route desktop/terminal/test, 9 suite unit POS (63 test), `cargo test --manifest-path src-tauri/Cargo.toml --lib` (81 test), static export POS desktop saat build, dan `git diff --check` berhasil. Test integrasi yang memakai PostgreSQL tetap belum dapat dijalankan di workspace ini.
