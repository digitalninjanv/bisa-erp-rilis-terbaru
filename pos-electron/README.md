# Bisa POS Desktop

Aplikasi membuka POS yang sama di `/app/pos`. Data transaksi tersimpan pada layanan Bisa ERP dan PostgreSQL. Satu komputer dapat menjalankan layanan dan aplikasi kasir. Terminal lain di toko dapat memakai aplikasi yang sama dengan alamat HTTPS layanan toko.

## Instalasi

1. Siapkan build Bisa ERP yang mencakup integrasi desktop ini. Di root repo jalankan `bash deploy/build-release.sh 0.1.0-pos-local --without-tauri-bundles`. Gunakan prosedur deployment ERP yang sudah dipakai toko. Installer systemd berbasis Debian dan jalur Docker dijelaskan di direktori `deploy/`.
2. Di direktori `pos-electron/`, jalankan `pnpm install --frozen-lockfile` dan `pnpm run package --linux AppImage`. Untuk paket Windows, jalankan `pnpm run package --win nsis` di mesin build Windows. Hasil berada di `dist-release/pos-electron/`.
3. Jalankan paket dengan `--erp-url=https://alamat-erp-toko` untuk menyimpan alamat ERP. URL juga bisa memakai `http://localhost:3000` jika server berjalan di komputer kasir yang sama. Alamat HTTPS harus memakai sertifikat yang dipercaya komputer kasir. Ganti alamat hanya saat jendela Bisa POS ditutup sepenuhnya.
4. Untuk Linux, dari root repo jalankan `bash pos-electron/install-linux.sh "/path/ke/Bisa POS-0.1.0.AppImage"` untuk menambahkan ikon **Bisa POS** ke menu aplikasi pengguna. Jika sistem tidak menyediakan FUSE, jalankan AppImage dengan `--appimage-extract-and-run`.

## Printer

Tambahkan printer USB atau LAN lewat pengaturan sistem operasi dan cetak halaman uji OS. Di menu **Bisa POS → Atur printer**, pilih perangkat, ukuran **58 mm** atau **80 mm**, lalu pilih **Uji cetak**. Pilihan tersimpan per profil OS. Pilihan **Cetak struk** pada transaksi online akan mengirim nota ke printer tersebut. Pilihan **Tanpa cetak** langsung melanjutkan ke transaksi baru. Tombol cetak di Riwayat tetap memakai aturan izin cetak ulang ERP.

Notifikasi sukses berarti driver menerima permintaan cetak. Periksa hasil pada kertas sebelum mengulang job yang statusnya belum pasti. Selama ERP tidak dapat dihubungi, struk lokal dari checkout offline memakai jalur printer langsung POS web bila perangkatnya tersedia.

## Pengembangan

Dengan ERP lokal aktif, jalankan `pnpm start` dari direktori ini. Untuk alamat ERP selain localhost, gunakan `pnpm start --erp-url=https://alamat-erp-toko`.
