# Runbook Kios — Komputer Kasir Bisa POS (Linux)

Langkah 8 RENCANA-TAURI. Paket skrip: `deploy/kiosk/` —
`setup-kiosk.sh` (penyiapan), `check-kiosk.sh` (pemeriksaan
read-only per butir), `teardown-kiosk.sh` (pelepasan). Target:
**Ubuntu 22.04 + GNOME/GDM** (lantai platform D8). Varian sesi
minimal tersedia untuk mesin tanpa GNOME (LightDM).

## Prinsip (baca dulu)

- **Fullscreen saja tidak mengamankan perangkat.** Yang
  mengunci kios ini adalah: akun kasir **non-admin** + sesi
  grafis yang dikunci (dconf sistem + locks) + **kata sandi
  admin yang tidak diketahui kasir**.
- Akun admin terpisah adalah **prasyarat**, bukan hasil skrip.
  Semua perawatan (pasang aplikasi, pairing ulang, pemulihan)
  dilakukan dari akun admin.
- Data penjualan tidak tinggal di sesi: penjualan offline
  mengantre di database lokal dan tersinkron ke server saat
  jaringan kembali (idempoten per `clientKey` — pengiriman
  ulang aman).

## A. Pemasangan ujung-ke-ujung

1. **Instal OS**: Ubuntu 22.04 LTS (desktop). Buat akun
   pengguna pertama saat instalasi — akun inilah **akun
   admin** (anggota sudo). Beri kata sandi kuat dan JANGAN
   bagikan ke kasir. Disarankan: aktifkan enkripsi disk (LUKS)
   saat instalasi dan kata sandi BIOS/UEFI — lihat "Batas".
2. **Perbarui sistem** dari akun admin:
   `sudo apt update && sudo apt upgrade -y`, lalu reboot bila
   diminta.
3. **Instal aplikasi Bisa POS** (artefak rilis Langkah 7):
   - .deb: `sudo apt install ./bisa-pos_<versi>_amd64.deb`
     (biner di `/usr/bin/bisa-pos`), atau
   - AppImage: salin ke `/opt/bisa-pos/Bisa_POS.AppImage`,
     `sudo chmod +x` padanya.
   Pembaruan sesudah kios terkunci berjalan lewat updater
   aplikasi (AppImage) / pemasangan .deb ulang oleh admin.
4. **Jalankan aplikasi sekali sebagai calon kasir** — sebelum
   pengguna kasir dibuat, jalankan dari akun admin untuk
   memastikan aplikasi terbuka; tutup lagi. (Data uji di akun
   admin tidak dipakai terminal; pairing dilakukan sesudah
   pengguna kasir ada, pada langkah 6.)
5. **Buat pengguna kasir lebih dulu lewat setup** — lewati ke
   langkah 7 bila ingin satu jalan; untuk pairing lebih dulu:
   buat manual `sudo useradd -m -s /bin/bash kasir` lalu
   masuk sebagai kasir.
6. **Pairing terminal (Langkah 6)**: masuk sebagai kasir,
   buka Bisa POS → panel Terminal → masukkan URL server +
   kode pasangan sekali pakai dari admin web (POS → Terminal
   desktop). Token per-terminal tersimpan di keychain OS
   (gnome-keyring). Sesudah berpasangan, segarkan snapshot
   sampai katalog terisi.
7. **Atur printer (Langkah 5)**: panel Printer → host/IP
   printer jaringan (port 9100), lebar kertas 58/80mm →
   Simpan → **Tes cetak** harus menghasilkan struk uji; coba
   **Buka laci** dengan alasan (tercatat).
8. **Tutup sesi kas** yang mungkin terbuka dari pengujian.
9. **Periksa pra-kunci** dari akun admin:
   `bash deploy/kiosk/check-kiosk.sh` — butir pengguna &
   aplikasi akan masih GAGAL sebelum setup; butir printer,
   disk, dan jam harus sudah LULUS.
10. **Kunci kios** dari akun admin:
    `sudo bash deploy/kiosk/setup-kiosk.sh`
    Tinjau dulu tanpa mengubah apa pun:
    `bash deploy/kiosk/setup-kiosk.sh --dry-run`.
    Bendera opsional: `KIOSK_MASK_TTY=1` mematikan getty
    tty2–tty6 (pengalihan TTY teks); bawaan membiarkannya —
    pengalihan TTY mendarat di prompt login, bukan sesi kasir.
11. **Reboot**: `sudo reboot`. Mesin harus masuk sendiri ke
    sesi kasir dengan Bisa POS terbuka.
12. **Verifikasi akhir**: dari akun admin (SSH atau tty1),
    `bash deploy/kiosk/check-kiosk.sh` → tidak ada GAGAL.
13. **Uji offline wajib sebelum toko buka**:
    - cabut kabel jaringan / matikan Wi-Fi;
    - lakukan 2–3 penjualan tunai + 1 penjualan campuran;
      struk tercetak, laci menendang untuk tunai;
    - tutup sesi kas secara buta; buka lagi;
    - sambungkan jaringan → antrean outbox harus terkuras
      (panel Antrean menunjukkan synced) dan penjualan tampil
      di web;
    - matikan aplikasi di tengah (tahan tombol daya tidak
      perlu — cukup tutup jendela dari sesi admin pada mesin
      uji) lalu buka lagi: tidak ada penjualan hilang.

## B. Pemulihan

### Aplikasi tidak mau start

1. Masuk sebagai admin (SSH / tty1: `Ctrl+Alt+F1`... bila
   `KIOSK_MASK_TTY=1`, pakai SSH atau lepas kios dulu).
2. Periksa autostart: `ls -l /home/kasir/.config/autostart/`
   dan isi `bisa-pos.desktop` (Exec menunjuk biner yang ada).
3. Jalankan biner sebagai kasir untuk melihat galat:
   `sudo -u kasir /usr/bin/bisa-pos` (dari terminal admin;
   berhenti dengan Ctrl+C sesudah galat terbaca).
4. Untuk AppImage: pastikan berkas masih executable dan FUSE
   tersedia (`sudo apt install libfuse2` di 22.04 bila
   AppImage menolak berjalan).

### Database lokal rusak / aplikasi mengeluh data

DB lokal: `/home/kasir/.local/share/id.bisa.pos/bisa-pos.db`
(SQLite WAL; token TIDAK di sini — token di keychain).

1. Tutup aplikasi sepenuhnya.
2. Periksa integritas (sebagai admin):
   `sudo -u kasir sqlite3 /home/kasir/.local/share/id.bisa.pos/bisa-pos.db "PRAGMA integrity_check;"`
   → harus menjawab `ok`. (`sudo apt install sqlite3` bila
   belum ada.)
3. **Cadangan berkala yang benar**: salin DB hanya saat
   aplikasi tertutup — idealnya tepat **sesudah tutup sesi**
   (checkpoint alami: antrean sudah terkuras / tercatat):
   `sudo -u kasir sqlite3 <db> ".backup /media/usb/bisa-pos-$(date +%F).db"`
   Perintah `.backup` aman terhadap WAL; menyalin berkas
   mentah saat aplikasi berjalan TIDAK aman.
4. **Restore**: hentikan aplikasi → ganti `bisa-pos.db`
   dengan berkas cadangan (pemilik `kasir:kasir`, izin 0600)
   → buka aplikasi. Outbox di dalam cadangan akan tersinkron
   (ulang) dengan aman karena server menolak duplikat per
   `clientKey`.
5. Bila `integrity_check` gagal DAN tidak ada cadangan:
   jangan menghapus DB sebelum antrean diperiksa — DB rusak
   bisa berarti penjualan offline belum tersinkron. Salin
   berkas apa adanya ke media lain, hubungi pengelola server,
   baru pertimbangkan mulai dari DB kosong + pairing ulang
   (snapshot akan turun penuh; penjualan yang belum pernah
   tersinkron dan tidak bisa diselamatkan dari DB adalah
   kehilangan yang harus dicatat, bukan ditutupi).

### Mesin ganti / terminal dicabut

- Cabut terminal dari admin web (POS → Terminal desktop →
  Cabut): token mati di server pada kontak berikutnya.
- Mesin pengganti: instal aplikasi → pairing dengan kode
  baru → snapshot turun penuh. Token lama tidak bisa dipindah
  (memang begitu desainnya).

## C. Pelepasan kios

Dari akun admin:

```bash
sudo bash deploy/kiosk/teardown-kiosk.sh          # tinjau: --dry-run
sudo reboot
```

Auto-login, autostart, penguncian dconf, dan mask layanan
dibatalkan; **data aplikasi & pengguna kasir dipertahankan**.
Menghapus akun kasir (beserta home & data aplikasinya)
hanya dengan `--remove-user` + `KIOSK_CONFIRM_REMOVE_USER=1`
— lakukan hanya bila antrean offline sudah kosong dan DB
sudah dicadangkan.

## D. Batas jujur

- Penguncian ini menahan **kasir yang jujur dan rasa
  penasaran biasa**, bukan penyerang berakses fisik: boot
  dari USB / melepas disk tetap bisa melewati sesi. Mitigasi
  berlapis yang disarankan: kata sandi BIOS/UEFI + urutan
  boot terkunci + enkripsi disk LUKS + token terminal yang
  bisa dicabut dari server (langkah B).
- Tanpa `KIOSK_MASK_TTY=1`, `Ctrl+Alt+F3` dsb. membuka prompt
  login teks — bukan sesi kasir, dan tanpa kata sandi admin
  tidak memberi apa-apa; tetap dicatat sebagai permukaan.
- GNOME adalah target yang ditulis & ditinjau; varian sesi
  minimal LightDM disediakan apa adanya (tanpa penguncian
  dconf — keamanannya bertumpu pada tidak adanya shell/desktop
  di sesi itu).
- Skrip kios tidak pernah dijalankan terhadap mesin
  pengembangan/CI: pembuktiannya adalah `bash -n`, mode
  `--dry-run`, dan pemeriksaan `check-kiosk.sh`. Pembuktian
  lapangan pertama adalah mengikuti bagian A di mesin kasir
  sungguhan dan menyimpan keluaran `check-kiosk.sh`-nya.
