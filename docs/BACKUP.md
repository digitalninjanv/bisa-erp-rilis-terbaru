# BACKUP & RESTORE

## Backup

Perintah proyek:

```bash
pnpm db:backup
```

- Menggunakan `DIRECT_URL` (owner) agar dump memuat RLS/policy/grant.
- Default folder `backups/`; produksi dapat memakai `BACKUP_DIR`.
- Format custom (`pg_dump -Fc`), nama `bisa-YYYYMMDD-HHMMSS.dump`.
- Enkripsi opsional:
  ```bash
  BACKUP_PASSPHRASE='...' pnpm db:backup
  ```
  menghasilkan `.dump.enc` (AES-256-CBC/PBKDF2).
- Manifest `backups/backup-manifest.json` mencatat file, waktu, ukuran, SHA-256.

### Backup yang dibuat pada audit ini

- `backups/bisa-pre-reset-20261111-082109.dump` — sebelum reset data.
- `backups/bisa-pre-migration-20261111-103520.dump` — sebelum migrasi `0070`/`0071`.

Keduanya dibuat dengan `pg_dump` dari container `bisa-erp-db`, diverifikasi dengan `pg_restore --list`.

## Restore

```bash
# ke database kosong (JANGAN ke database aktif tanpa persetujuan)
podman exec bisa-erp-db createdb -U erp bisa_erp_restore_test
podman exec -i bisa-erp-db pg_restore -U erp --no-owner --no-privileges \
  --dbname=bisa_erp_restore_test < backups/bisa-pre-reset-20261111-082109.dump
```

Atau gunakan `scripts/restore.sh` dengan `BACKUP_FILE`/`BACKUP_PASSPHRASE`.

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
