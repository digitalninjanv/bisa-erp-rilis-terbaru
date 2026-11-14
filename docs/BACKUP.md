# BACKUP & RESTORE

## Backup

Perintah proyek (gunakan file credential yang hanya dapat dibaca operator):

```bash
BACKUP_PASSPHRASE_FILE=/path/aman/backup-passphrase pnpm db:backup
```

- Menggunakan `DIRECT_URL` (owner) agar dump memuat RLS/policy/grant.
- Default folder `backups/`; produksi dapat memakai `BACKUP_DIR`.
- Format custom (`pg_dump -Fc`), nama `bisa-YYYYMMDD-HHMMSS-PID.dump.enc`; PID membedakan backup yang dimulai pada detik yang sama.
- Proses backup memakai file lock di direktori tujuan dan menunggu paling lama 30 menit agar dua dump tidak menulis nama arsip/manifest yang sama.
- Enkripsi autentikasi AES-256-GCM dengan kunci turunan PBKDF2-SHA256 (600.000 iterasi) wajib; bila passphrase kosong, skrip berhenti sebelum menjalankan `pg_dump` dan tidak membuat backup plaintext.
- Untuk pemakaian systemd produksi, installer memakai `LoadCredential` dari `/etc/credstore/bisa-erp-backup-passphrase`; isi file credential tidak diekspor sebagai environment variable.
- Simpan salinan passphrase terpisah dari server dan backup agar pemulihan tetap mungkin bila host hilang. Nilai di file dipakai persis, termasuk newline akhir bila editor menambahkannya.
- Manifest `backups/backup-manifest.json` mencatat file, waktu, ukuran, SHA-256.

### Backup yang dibuat pada audit ini

- `backups/bisa-pre-reset-20261111-082109.dump` — sebelum reset data.
- `backups/bisa-pre-migration-20261111-103520.dump` — sebelum migrasi `0070`/`0071`.

Keduanya adalah backup historis plaintext yang dibuat sebelum kebijakan enkripsi wajib. Backup baru plaintext tidak diizinkan. Keduanya dibuat dengan `pg_dump` dari container `bisa-erp-db`, diverifikasi dengan `pg_restore --list`. Format `.dump.enc` CBC historis hanya dapat dipulihkan setelah operator memberi `RESTORE_ALLOW_LEGACY_CBC=1`; format itu tidak memiliki autentikasi kriptografis dan perlu diganti dengan backup AES-GCM baru.

## Restore

```bash
# ke database kosong (JANGAN ke database aktif tanpa persetujuan)
podman exec bisa-erp-db createdb -U erp bisa_erp_restore_test
podman exec -i bisa-erp-db pg_restore -U erp --no-owner --no-privileges \
  --dbname=bisa_erp_restore_test < backups/bisa-pre-reset-20261111-082109.dump
```

Atau gunakan `scripts/restore.sh` dengan `BACKUP_FILE` dan
`BACKUP_PASSPHRASE_FILE=/path/aman/backup-passphrase`.

## Uji restore yang sudah dilakukan

Tanggal 2026-11-11:

1. Buat database `bisa_erp_restore_test`.
2. Restore `bisa-pre-reset-20261111-082109.dump`.
3. Verifikasi query:
   ```sql
   select (select count(*) from accounts),
          (select count(*) from products),
          (select count(*) from sales),
          (select count(*) from journal_entries);
   ```
   Hasil: `1379 | 1137 | 873 | 4314` — restore berhasil.
4. Database uji restore dihapus setelah verifikasi.

## Retensi & produksi

- Simpan backup harian minimal 7–14 hari; backup bulanan untuk tutup buku.
- Simpan di luar folder rilis (volume/backup server).
- Enkripsi backup yang memuat data pelanggan/karyawan.
- Uji restore berkala ke database kosong; jangan hanya mengandalkan keberhasilan `pg_dump`.
- Backup sebelum migrasi skema dan sebelum impor besar.
