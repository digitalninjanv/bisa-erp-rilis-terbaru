# Runbook — Backup & Restore Database Bisa ERP

Prosedur ini **terbukti dijalankan** pada uji SIM-2 Fase S5, 2026-11-04
(lihat `docs/sim2/S5-BACKUP-ROUNDTRIP.md` untuk bukti angkanya).
Prinsip mandat §11: **backup tidak dianggap valid sebelum restore-nya
berhasil dan terverifikasi.**

## Prasyarat

1. **Client tools PostgreSQL harus ≥ versi server.** Server proyek ini
   PostgreSQL 18; `pg_dump` 16 menolak dump dengan
   `aborting because of server version mismatch` (terbukti di lingkungan
   dev). Pastikan `pg_dump --version` dan `pg_restore --version`
   menunjukkan major yang sama dengan server (18).
2. `.env.local` berisi `DIRECT_URL` (pemilik skema `erp`) sebagai
   identitas database sumber. Restore memerlukan `RESTORE_TARGET_URL`
   dan `RESTORE_CONFIRM_TARGET` secara eksplisit; tujuan tidak lagi
   otomatis memakai `DIRECT_URL`.
3. Node.js tersedia dan file credential passphrase dapat dibaca. Produksi systemd memakai `/etc/credstore/bisa-erp-backup-passphrase` melalui `LoadCredential`; backup baru plaintext ditolak. Simpan salinan kunci terpisah dari server.

## Backup

```bash
BACKUP_PASSPHRASE_FILE='/path/aman/backup-passphrase' pnpm db:backup
# → backups/bisa-YYYYMMDD-HHMMSS.dump.enc
```

Verifikasi berkas backup (wajib sebelum backup dinyatakan selesai):

```bash
ls -la backups/                         # berkas .dump.enc harus > 0
sha256sum backups/bisa-*.dump.enc       # cocokkan dengan manifest/sidecar
```

Backup baru menggunakan AES-256-GCM dengan kunci PBKDF2-SHA256 600.000
iterasi. Tag GCM memeriksa autentisitas saat dekripsi; sidecar SHA-256
mendeteksi kerusakan tak sengaja sebelum dekripsi. Format CBC historis
tidak mempunyai autentikasi kriptografis dan restore-nya ditolak secara
default. Setelah verifikasi asal dan hash arsip lama, operator dapat
memakai `RESTORE_ALLOW_LEGACY_CBC=1` untuk satu restore/drill yang
disengaja; segera buat backup AES-GCM baru setelah pemulihan.

Skrip menulis berkas dump dengan permission privat (umask 077), memeriksa
arsip memakai `pg_restore --list`, mengenkripsi sebelum publikasi,
mencatat sidecar berisi ukuran/SHA-256, lalu mengganti nama secara atomik. Restore dan restore drill memeriksa
sidecar atau manifest sebelum memakai dump. Backup yang gagal atau arsip
yang tidak dapat dibaca tidak memperbarui manifest.

## Restore aman ke database kosong yang berbeda

```bash
BACKUP_PASSPHRASE_FILE='/path/aman/backup-passphrase' \
RESTORE_TARGET_URL='postgres://erp@127.0.0.1:5433/bisa_restore_target' \
RESTORE_CONFIRM_TARGET='127.0.0.1:5433/bisa_restore_target' \
pnpm db:restore backups/bisa-YYYYMMDD-HHMMSS.dump.enc
```

Tujuan berbeda harus sudah dibuat kosong dan dapat diakses oleh role
`erp`. Skrip memvalidasi host, port, dan nama database dari URL terhadap
nilai konfirmasi, memeriksa arsip, lalu menjalankan restore sebagai satu
transaksi fail-fast. URL tidak dicetak ke log.

Untuk arsip lama tanpa sidecar dan tanpa manifest yang menunjuk file itu,
restore ditolak. Hanya setelah hash diverifikasi terpisah operator dapat
melewati pemeriksaan dengan `RESTORE_ALLOW_UNVERIFIED_BACKUP=1`.

Dump `.dump` tanpa `.enc` hanya untuk pemulihan arsip historis yang dibuat sebelum enkripsi diwajibkan. Untuk command manual, gunakan `BACKUP_PASSPHRASE_FILE` agar nilai rahasia tidak tertulis pada command line atau environment.

## Pemulihan in-place

Restore ke database yang sama dengan `DIRECT_URL` akan menghapus objek
lama. Skrip menolak ini kecuali operator memberi dua konfirmasi eksplisit
setelah memastikan backup dan target:

```bash
BACKUP_PASSPHRASE_FILE='/path/aman/backup-passphrase' \
RESTORE_TARGET_URL="$DIRECT_URL" \
RESTORE_CONFIRM_TARGET='127.0.0.1:5433/<nama-database>' \
RESTORE_ALLOW_IN_PLACE=1 \
pnpm db:restore backups/bisa-YYYYMMDD-HHMMSS.dump.enc
```

Untuk jalur ini skrip menambahkan `--clean --if-exists`; restore tetap
fail-fast dalam satu transaksi. Setelah selesai, verifikasi aplikasi,
jurnal, stok, dan data lintas modul sebelum mengalihkan layanan.

## Restore ke database/server BARU (disaster recovery penuh)

Dump dibuat dengan `--no-owner --no-privileges`, jadi hak akses peran
aplikasi (`app_user`) **tidak ikut terbawa**. Di database baru aplikasi
akan gagal dengan `permission denied for table …` sampai grant
diterapkan ulang. Langkah lengkapnya:

```bash
# 1. Buat database kosong (pemilik: erp)
psql "$DIRECT_URL" -c "CREATE DATABASE bisa_erp_baru OWNER erp"

# 2. Restore dump ke database baru yang kosong melalui guard target
BACKUP_PASSPHRASE_FILE='/path/aman/backup-passphrase' \
RESTORE_TARGET_URL='postgres://erp@<host>:5433/bisa_erp_baru' \
RESTORE_CONFIRM_TARGET='<host>:5433/bisa_erp_baru' \
pnpm db:restore backups/bisa-YYYYMMDD-HHMMSS.dump.enc

# 3. WAJIB: terapkan ulang grant app_user (blok yang sama dengan
#    migrasi 0001 / docker/init.sql)
psql "<url db baru sebagai erp>" <<'SQL'
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
SQL

# 4. Arahkan DIRECT_URL/DATABASE_URL di .env.local ke database baru,
#    lalu pastikan migrasi berada di head (harus no-op):
pnpm db:migrate
```

Catatan: restore ke database **yang sama** tidak membutuhkan langkah 3
karena default privileges yang sudah ada di database itu berlaku untuk
objek yang dibuat ulang selama restore.

## Verifikasi sesudah restore (wajib)

Restore hanya dinyatakan berhasil bila semua pemeriksaan ini lolos:

```sql
-- 1. Neraca saldo seimbang per perusahaan (selisih harus 0)
select company_id, sum(debit) - sum(credit) as selisih
from journal_lines jl join journal_entries je on je.id = jl.entry_id
where je.status = 'posted' group by 1;

-- 2. Jumlah baris tabel kunci masuk akal
select (select count(*) from products) produk,
       (select count(*) from journal_entries) jurnal,
       (select count(*) from sales) penjualan,
       (select count(*) from organization) perusahaan,
       (select count(*) from "user") pengguna;

-- 3. Nilai persediaan (bandingkan dengan angka sebelum backup)
select sum(soh.qty * p.cost_price)
from stock_on_hand soh join products p on p.id = soh.product_id;
```

Lalu buka aplikasi dan masuk sebagai pengguna demo/pemilik: beranda,
satu laporan keuangan, dan satu daftar master harus tampil tanpa error.

## Manifest & pemantauan di aplikasi (A-28 Tahap 6, H-X-01)

Sejak A-28 Tahap 6 backup terpantau dari dalam aplikasi:

- Setiap backup berhasil, `scripts/backup.sh` menulis
  **`backup-manifest.json`** di direktori backup yang sama (nama
  berkas, waktu selesai UTC, ukuran, SHA-256, status enkripsi) —
  ditulis atomik sesudah berkas dump final. Kegagalan backup tidak
  memperbarui manifest, jadi manifest basi = sinyal yang benar.
- Halaman **Pengaturan → Status sistem** membaca manifest itu
  (modul `src/server/backup-status.ts`) dan menampilkan backup
  terakhir + peringatan bila backup melewati ambang umur
  (bawaan 26 jam, env `BISA_BACKUP_MAX_AGE_HOURS`) atau belum ada
  catatan sama sekali. Direktori yang dibaca aplikasi:
  `BISA_BACKUP_DIR` (produksi: samakan dengan `BACKUP_DIR` di
  `/etc/bisa-erp/backup.conf`; lihat `deploy/env.prod.example`).
- Penjadwalan & retensi otomatis sendiri sudah berjalan sejak
  A-24 T5: timer harian `bisa-erp-backup.timer` →
  `deploy/backup-run.sh` (retensi 14 harian + 4 mingguan dari
  `/etc/bisa-erp/backup.conf`; salinan luar mesin lewat `OFFSITE_CMD`
  tetap keputusan pemilik, bawaan mati).

## Latihan restore berkala (drill) — A-28 Tahap 6, H-X-01

Backup yang belum pernah dipulihkan adalah asumsi. Latihan restore
menjalankan siklus penuh secara aman:

```bash
scripts/restore-drill.sh            # dump terbaru di BACKUP_DIR
scripts/restore-drill.sh backups/bisa-YYYYMMDD-HHMMSS.dump
```

Yang dilakukan skrip (idempoten, aman diulang):

1. Membuat database uji baru bernama `bisa_restore_test_<stempel>`
   (skrip menolak nama tanpa `restore_test` dan menolak nama yang
   sama dengan database sumber; sumber tidak pernah ditulis).
2. Memulihkan dump ke DB uji (termasuk dekripsi bila `*.enc`) dan
   menerapkan ulang grant `app_user` (langkah 3 pemulihan bencana
   di atas ikut terbukti).
3. Memverifikasi isi terhadap sumber: **jumlah akun, jumlah produk,
   nilai persediaan, dan selisih neraca saldo per perusahaan** harus
   identik; setiap perusahaan pada sumber juga harus seimbang.
4. Menulis **`restore-drill-manifest.json`** di direktori backup —
   halaman Status sistem menampilkannya (latihan terakhir, hasil
   verifikasi, tabel angka sumber vs restore). Latihan yang gagal
   verifikasi keluar dengan kode 1 dan tercatat `ok: false`.
5. Menghapus DB uji dalam semua keadaan (trap).

Installer systemd mengaktifkan timer mingguan restore drill pada instalasi
baru. Pada host systemd lama, pasang/aktifkan unit berikut satu kali:

```bash
sudo cp deploy/systemd/bisa-erp-restore-drill.service \
        deploy/systemd/bisa-erp-restore-drill.timer /etc/systemd/system/
sudo systemctl enable --now bisa-erp-restore-drill.timer   # mingguan, Minggu 03:30
```

Alternatif cron (mesin tanpa systemd):
`30 3 * * 0 cd /opt/bisa-erp/current && BACKUP_DIR=/var/backups/bisa-erp scripts/restore-drill.sh >> /var/log/bisa-erp-drill.log 2>&1`.
Ambang kesegaran latihan di aplikasi: bawaan 92 hari (triwulanan,
env `BISA_RESTORE_DRILL_MAX_AGE_DAYS`); timer mingguan memberi
margin besar. Kegagalan terlihat di `systemctl status
bisa-erp-restore-drill.service`, di manifest (`ok: false`), dan
sebagai peringatan di Status sistem — bukan senyap.

### Bukti latihan A-28 Tahap 6 (2026-11-07)

Satu siklus penuh dijalankan terhadap instalasi bersih setara
produksi (database baru dari migrasi + seed demo proyek ini,
skrip proyek sendiri dari pohon terpisah):

| Pemeriksaan | Sumber | Hasil restore |
|---|---|---|
| Jumlah akun | 124 | 124 |
| Jumlah produk | 65 | 65 |
| Nilai persediaan | 28349600.00000000 | 28349600.00000000 |
| Selisih neraca saldo | 0.0000 | 0.0000 |

DB uji `bisa_restore_test_20261107041622` terverifikasi lalu
dihapus; manifest latihan tercatat `ok: true`.

**Temuan jujur dari latihan pertama di DB dev bersama:** restore
ketat atas dump DB dev *bersama* saat ini gagal pada pembuatan 2
constraint FK — bukan karena data demo (perusahaan demo: **0 baris
yatim**), melainkan sisa teardown fixture SIM di DB dev: baris
`account_monthly_balances` (35.810) & `employee_history` (159)
milik perusahaan fixture yang organisasinya sudah dihapus, yang
account/employee-nya ikut terhapus saat FK dimatikan oleh peran
replikasi pada teardown test. Database produksi tidak bisa
menghasilkan keadaan ini (tulisan peran aplikasi selalu kena FK);
DB dev bersama sebaiknya dibersihkan terpisah. Inilah gunanya
drill: kegagalannya terlihat dan tercatat, bukan senyap.
