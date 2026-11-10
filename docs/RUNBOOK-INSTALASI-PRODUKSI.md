# Runbook — Memasang & Merawat Bisa ERP di Toko

Panduan ini untuk **pemilik toko dan staf yang membantu pemasangan**,
bukan untuk programmer. Semua langkah ditulis berurutan — ikuti dari
atas, jangan melompat. Bila ada langkah yang hasilnya tidak seperti
tertulis, berhenti dan lihat bagian **Masalah Umum** di bawah.

> **Gambaran singkat.** Bisa ERP dipasang di **satu komputer server di
> toko** (Linux). Komputer kasir tidak memasang apa-apa: kasir cukup
> membuka alamat server dari peramban (Chrome/Chromium). Semua data
> tersimpan di server toko itu — internet mati tidak menghentikan
> kasir (terminal yang sudah terbuka tetap mencatat penjualan dan
> menyinkronkan sesudahnya; lihat catatan offline di akhir).

Ada **dua cara memasang** dari paket yang sama. Pilih satu:

- **Cara A — Tanpa Docker (systemd).** Paling sederhana untuk satu
  komputer toko. Dipakai di panduan utama di bawah.
- **Cara B — Docker Compose.** Bila toko sudah memakai Docker.

Paketnya adalah satu berkas: `bisa-erp-<versi>.tar.gz` (dibuat oleh
`deploy/build-release.sh` dari kode sumber). Simpan berkas ini baik-
baik — inilah "CD instalasi" Anda.

---

## 1. Yang dibutuhkan

1. Komputer server: Linux (Ubuntu 24.04 atau setara), RAM ≥ 4 GB,
   ruang disk kosong ≥ 10 GB, terhubung ke jaringan toko yang sama
   dengan kasir.
2. Berkas `bisa-erp-<versi>.tar.gz`.
3. Akun administrator (bisa `sudo`) di server.
4. Alamat IP server di jaringan toko, misalnya `192.168.1.10`. Usahakan
   alamat ini **tetap** (atur di router: reservasi DHCP untuk server),
   karena alamat inilah yang dibuka kasir setiap hari.

---

## 2. Cara A — Pasang tanpa Docker (systemd)

1. Salin berkas paket ke server, lalu buka terminal di server.
2. Jalankan satu perintah ini (ganti nama berkas sesuai versi Anda):

   ```bash
   sudo bash deploy/install.sh /lokasi/berkas/bisa-erp-0.1.0.tar.gz
   ```

   Bila Anda menjalankan perintah ini dari dalam folder hasil ekstrak
   paket, jalurnya relatif pun bisa. Skrip akan:

   - memeriksa Node.js & memasang PostgreSQL 18 bila belum ada;
   - membuat pengguna sistem `bisa` dan folder `/opt/bisa-erp`;
   - membuat berkas rahasia `/etc/bisa-erp/bisa-erp.env` **satu kali**
     (sandi database & kunci sesi dibuat acak di tempat — tidak ada
     sandi bawaan);
   - membuat database dan menjalankan **migrasi** (tercetak
     `MIGRASI sebelum=… sesudah=…` — ini langkah resmi, bukan sulap);
   - memasang layanan `bisa-erp` agar **menyala otomatis** setiap
     komputer dinyalakan, dan timer backup harian;
   - memeriksa `GET /api/health` sampai menjawab sehat.

3. Pemasangan berhasil bila baris terakhir berbunyi
   `SELESAI. Bisa ERP versi … melayani di port …`.
   Di mesin uji kami, pemasangan bersih selesai **di bawah 1 menit**
   (tidak termasuk unduh paket PostgreSQL di mesin yang benar-benar
   kosong).
4. **Jalankan ulang perintah yang sama kapan pun aman** — skrip ini
   idempoten: env tidak ditimpa, rilis yang sama tidak diekstrak ulang,
   migrasi yang sudah jalan dilewati.

Sesudah ini server **kosong** (belum ada toko/produk). Daftarkan akun
pemilik pertama dari halaman pendaftaran aplikasi, lalu atur toko dari
menu Pengaturan. (Data contoh/demo hanya untuk uji coba dan dipasang
dari checkout kode sumber oleh teknisi — bukan dari paket produksi.
**Peringatan:** akun demo `owner@bisa.id` sandinya diketahui umum;
jangan pernah memakai data demo di toko sungguhan.)

---

## 3. Cara B — Pasang dengan Docker Compose

Dari folder kode sumber (atau folder yang berisi `Dockerfile`,
`docker-compose.prod.yml`, dan folder `deploy/`):

```bash
bash deploy/setup-env.sh --untuk docker      # 1. buat .env.prod (rahasia acak, satu kali)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d db        # 2. database dulu
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate   # 3. migrasi (wajib)
docker compose -f docker-compose.prod.yml up -d           # 4. aplikasi
```

Periksa: `curl http://127.0.0.1:3000/api/health` harus menjawab
`{"status":"ok",…}`. Berkas `.env.prod` **tidak boleh ditimpa** —
di dalamnya ada sandi database; menghapusnya berarti database tidak
bisa dibuka lagi dengan sandi baru.

---

## 4. Membuka dari komputer kasir

1. Pastikan kasir dan server satu jaringan (Wi-Fi/LAN toko yang sama).
2. Di peramban kasir, buka: `http://<IP-server>:3000`
   (contoh: `http://192.168.1.10:3000`).
3. Masuk dengan akun staf. Jadikan alamat ini bookmark / layar awal
   kios (Chromium mode kiosk juga bisa).
4. Bila alamat tidak terbuka: periksa server menyala
   (`systemctl status bisa-erp` di server) dan IP server tidak
   berubah di router.

---

## 5. Menyalakan & mematikan

Cara A (systemd):

```bash
sudo systemctl status bisa-erp     # melihat keadaan
sudo systemctl restart bisa-erp    # menyalakan ulang
sudo systemctl stop bisa-erp       # mematikan aplikasi (database tetap aman)
sudo systemctl start bisa-erp      # menyalakan lagi
```

Cara B (Docker): ganti perintah di atas dengan
`docker compose -f docker-compose.prod.yml stop|start|restart`.

**Listrik padam?** Tidak perlu panik dan tidak ada langkah khusus:
layanan diatur menyala otomatis saat komputer hidup lagi
(`Restart=on-failure` + aktif sejak boot; compose memakai
`restart: unless-stopped`). Sesudah listrik kembali, tunggu ±1 menit
lalu buka lagi alamat server dari kasir. Transaksi yang sudah
tersimpan tidak hilang — database PostgreSQL aman dari mati mendadak.

---

## 6. Backup (cadangan data)

**Otomatis:** setiap hari pukul ±02.30, timer `bisa-erp-backup`
membuat cadangan ke `/var/backups/bisa-erp/` dan membersihkan yang
lama mengikuti aturan di `/etc/bisa-erp/backup.conf` (bawaan:
**14 cadangan harian + 4 cadangan mingguan** disimpan).

**Manual (kapan pun):**

```bash
sudo systemctl start bisa-erp-backup.service
ls -la /var/backups/bisa-erp/        # berkas terbaru: bisa-<tanggal>.dump
```

**Sangat dianjurkan:** sesekali salin berkas `.dump` terbaru ke tempat
di luar server (flashdisk/NAS/penyimpanan pemilik). Cadangan di mesin
yang sama tidak menolong bila mesinnya hilang/rusak. Pengaturan
salinan otomatis ke luar mesin ada di `backup.conf`
(`OFFSITE_CMD`, mati secara bawaan — isi juga `BACKUP_PASSPHRASE`
agar salinan yang keluar terenkripsi).

**Memeriksa timer hidup:** `systemctl list-timers bisa-erp-backup`.

## 7. Restore (memulihkan dari cadangan)

Restore menimpa database yang sedang berjalan — lakukan hanya saat
benar-benar perlu, dan ikuti **dokumen khusus yang sudah teruji**:
[RUNBOOK-BACKUP-RESTORE.md](RUNBOOK-BACKUP-RESTORE.md). Ringkasnya:
berkas dump dipulihkan dengan `pg_restore`/`scripts/restore.sh`,
lalu **grant untuk `app_user` wajib diterapkan ulang** di database
baru (jebakan tercatat RT-03 di dokumen itu), lalu periksa angka-
angkanya (jumlah produk, nilai persediaan, jurnal seimbang) sebelum
toko buka lagi.

## 8. Memperbarui versi

1. Simpan berkas paket versi baru di server.
2. Jalankan:

   ```bash
   sudo bash /opt/bisa-erp/current/deploy/update.sh /lokasi/bisa-erp-<versi-baru>.tar.gz
   ```

   Urutan di dalamnya **tidak bisa dilompati**: backup dulu (gagal =
   batal) → rilis baru diekstrak di samping yang lama → migrasi →
   layanan dialihkan & dimulai ulang → diperiksa (health + halaman
   login). Semua tercatat di `/var/log/bisa-erp/update-<tanggal>.log`.
3. **Tentang mundur versi (rollback), terus terang:** bila migrasi
   sudah berjalan, versi lama **tidak bisa** dipakai lagi begitu saja.
   Jalan pulih yang benar adalah **restore backup** yang dibuat
   otomatis di langkah 2 (nama berkasnya tercetak di log). Bila
   verifikasi gagal *sebelum* migrasi apa pun berjalan, skrip
   mengembalikan layanan ke rilis lama dengan sendirinya.

Cara B: ulangi langkah compose §3 dengan tag versi baru
(`BISA_VERSION=<versi-baru>` di `.env.prod`), termasuk langkah
migrasi `tools` sebelum `up -d`.

## 9. Masalah umum

| Gejala | Periksa dulu |
|---|---|
| Kasir tidak bisa membuka alamat | Server menyala? `systemctl status bisa-erp`. IP server berubah? Cek router. |
| Halaman terbuka tapi "database error" / health merah | `curl http://127.0.0.1:3000/api/health` di server; lalu `systemctl status postgresql` dan `journalctl -u bisa-erp -n 50`. |
| Sesudah update aplikasi tidak mau naik | Baca log update terakhir di `/var/log/bisa-erp/`; ikuti petunjuk rollback/restore di §8. |
| Disk penuh | Biasanya cadangan/log menumpuk: `du -sh /var/backups/bisa-erp /var/log`. Retensi diatur di `/etc/bisa-erp/backup.conf`. |
| Lupa sandi pemilik | Teknisi dapat mengatur ulang lewat database (dokumen RUNBOOK-BACKUP-RESTORE § pemulihan) — sandi tidak disimpan dalam bentuk terbaca di mana pun. |
| Mau pindah server | Pasang di server baru (§2/§3), restore cadangan terakhir (§7), arahkan kasir ke IP baru. |

## 10. Siapa yang dihubungi

- Masalah aplikasi & data: **[isi: nama/telepon dukungan Anda]**.
- Simpan bersama panduan ini: berkas paket versi yang terpasang,
  alamat IP server, dan lokasi salinan cadangan di luar mesin.
- Berkas rahasia `/etc/bisa-erp/bisa-erp.env` dan `.env.prod` **jangan
  dibagikan** ke siapa pun — di dalamnya ada sandi database.

---

### Catatan kejujuran cakupan (dari tahap A-24 T5)

- Cara A teruji sungguhan di mesin Linux dengan systemd: pemasangan
  bersih, migrasi 55/55, login, backup terjadwal, restore terverifikasi
  angka, dan satu putaran update. Di mesin uji itu PostgreSQL 18
  disediakan sebagai server eksternal (mode `BISA_SKIP_PG_INSTALL=1`);
  jalur pemasangan PostgreSQL lewat repositori PGDG di dalam
  `install.sh` mengikuti dokumentasi resmi PGDG tetapi **belum diuji
  di mesin kosong** — tandai NOT TESTED untuk sub-langkah itu.
- Cara B (Docker): berkasnya tervalidasi (`docker compose config`
  lolos), tetapi daemon Docker tidak dapat berjalan di mesin uji
  (iptables/nftables ditolak lingkungan VM), jadi build & run image
  **NOT TESTED** di sini — uji di mesin toko/VM dengan Docker aktif
  sebelum mengandalkannya.
- Offline kasir (penjualan saat server/internet mati) dibuktikan di
  tahap terpisah (A-24 T6), bukan oleh dokumen ini.
