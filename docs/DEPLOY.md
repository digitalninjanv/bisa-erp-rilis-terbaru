# DEPLOY CHECKLIST

## Persyaratan

- Node 22+, pnpm, PostgreSQL 16/18.
- Domain HTTPS (wajib produksi).
- `DATABASE_URL` (role aplikasi, RLS) dan `DIRECT_URL` (owner migrasi).
- `BETTER_AUTH_SECRET` ≥32 karakter acak.
- `BETTER_AUTH_URL=https://...`; HTTP hanya untuk harness lokal dengan `BISA_ALLOW_INSECURE_AUTH_URL=1`.
- Storage logo/QRIS bila memakai upload.

## Langkah

1. **Backup** database produksi:
   ```bash
   BACKUP_PASSPHRASE_FILE=/path/aman/backup-passphrase pnpm db:backup
   ```
2. **Pasang kode** dan dependency:
   ```bash
   pnpm install --frozen-lockfile
   ```
3. **Migrasi** dengan `DIRECT_URL`:
   ```bash
   pnpm exec drizzle-kit migrate
   ```
   Migrasi `0070` memperbaiki unique index idempotency; `0071` default pembulatan grup 0;
   `0083` membuat tabel `rate_limit` untuk rate limit login terpusat (SEC-012).
4. **Build**:
   ```bash
   pnpm build
   ```
5. **Jalankan** di belakang reverse proxy TLS. Untuk jalur systemd,
   `deploy/install.sh` sekarang memasang nginx + sertifikat (self-signed
   bila `BISA_TLS_CERT`/`BISA_TLS_KEY` tidak diberikan), menulis
   `BETTER_AUTH_URL=https://...`, dan `BISA_TRUSTED_PROXIES=127.0.0.1`:
   ```bash
   sudo bash deploy/install.sh /path/bisa-erp-<versi>.tar.gz
   # sertifikat resmi:
   BISA_TLS_CERT=/etc/ssl/erp/fullchain.pem BISA_TLS_KEY=/etc/ssl/erp/privkey.pem \
     BISA_TLS_SERVER_NAME=erp.toko.local sudo -E bash deploy/install.sh <tarball>
   ```
   Jalur Docker: terminasi TLS di reverse proxy eksternal yang meneruskan
   ke port aplikasi, lalu isi `BETTER_AUTH_URL` HTTPS dan
   `BISA_TRUSTED_PROXIES` dengan IP proxy.
6. **Health check**:
   ```bash
   curl -fsS https://DOMAIN/api/health
   ```
7. **Seed demo** hanya bila ingin data contoh; jangan ke database produksi berisi data asli.
   Di development/test:
   ```bash
   pnpm db:seed --force
   ```
   Pada `NODE_ENV=production`, seed demo **ditolak** kecuali operator secara eksplisit memakai
   `--allow-production-seed` **dan** mengisi `BISA_SEED_OWNER_PASSWORD` minimal 16 karakter
   (password unik, tidak dicetak, dan wajib dirotasi). Ini tetap menanam katalog demo, bukan
   jalur bootstrap produksi yang ideal; untuk produksi nyata gunakan prosedur provisioning
   owner terpisah/backup yang disetujui.
8. **Login owner**, buat pengguna kasir, atur role, gudang, pemetaan akun, produk. Ganti
   password owner sebelum operasi normal.
9. **Uji** satu penerimaan, satu penjualan tunai, satu split payment, satu void/refund, tutup shift, laporan, ekspor Excel.
10. **Aktifkan backup terjadwal** + retensi; uji restore ke DB kosong.

## Checklist keamanan produksi

- [ ] HTTPS aktif, HSTS, cookie Secure.
- [ ] Secret di env, bukan repo.
- [ ] `BISA_ALLOW_INSECURE_AUTH_URL` tidak diset.
- [ ] Role kasir minimum (POS saja).
- [ ] `inventory.cost` hanya untuk owner/akuntan.
- [ ] Backup terenkripsi + retensi.
- [ ] Restore drill berhasil.
- [ ] Rate limit login tersimpan di tabel `rate_limit` (bukan memori proses).
- [ ] `BISA_TRUSTED_PROXIES` diisi IP/CIDR reverse proxy, bukan rentang klien.
- [ ] CSP dokumen memakai nonce (`script-src` tanpa `'unsafe-inline'`).
- [ ] Log audit dipertahankan.
- [ ] Firewall: DB tidak terbuka ke publik.

## Rollback

1. Hentikan aplikasi.
2. Restore dump terakhir ke database baru:
   ```bash
   podman exec -i DB pg_restore -U erp --no-owner --no-privileges \
     --dbname=bisa_erp_restore < backups/....dump
   ```
3. Arahkan `DATABASE_URL`/`DIRECT_URL` ke DB restore, verifikasi health + laporan.
4. Deploy kode versi sebelumnya.
5. Migrasi `0070`/`0071` aman untuk rollback index/default; tidak menghapus kolom/data.

## Retensi data operasional (cron)

Jalankan pembersihan terjadwal dari cron/systemd, bukan saat boot aplikasi:

```bash
# idempotency key lama (default 30 hari; key jurnal dipertahankan)
pnpm prune:idempotency 30

# ringkasan/outbox POS offline yang sudah terminal (default 180 hari;
# baris yang belum diselesaikan tidak pernah dihapus)
pnpm prune:pos-outbox 180
```

Tinjau periode retensi dengan pemilik data/audit sebelum mengaktifkan jadwal.
