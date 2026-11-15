# SECURITY

Status: audit read-only + perbaikan putaran ini. Temuan terbuka ada di `docs/BLOKIR.md`.

## Kontrol yang sudah ada

- **Autentikasi**: Better Auth, password hash (`hashPassword`), `disableSignUp: true`, session 7 hari, `freshAge` 1 jam untuk aksi sensitif (payroll, user/role).
- **Otorisasi**: permission dicek di server action/API (`requirePermission`, `requirePermissionInModule`); RLS `FORCE` + `withCompany`/`withCompanyReadOnly` untuk isolasi tenant.
- **CSRF/origin**: ditangani Better Auth; cookie `SameSite=Lax`; origin production divalidasi.
- **SQL injection**: Drizzle query berparameter; tidak ditemukan `sql.raw`/interpolasi identifier dari input.
- **Secret**: `.env.local`/`.env.prod` di-ignore; repo hanya berisi contoh.
- **Upload**: batas 20 MB/25.000 baris, hanya `.xlsx/.xls/.csv`; parser XLSX.
- **Excel/CSV injection**: CSV menetralkan `= + - @`; XLSX memakai `cellFormula:false` (diuji).
- **Audit log**: dokumen, user, role, harga, void/refund, penyesuaian, payroll.
- **Backup**: `scripts/backup.sh` membuat dump custom terenkripsi dan terautentikasi (AES-256-GCM, PBKDF2-SHA256 600.000 iterasi) dan manifest; tanpa passphrase, backup gagal tertutup. Restore tersedia di `scripts/restore.sh`. Restore CBC historis tidak memberi autentikasi dan memerlukan override operator eksplisit.
- **Header**: CSP, HSTS, X-Frame-Options, nosniff.

## Perbaikan putaran ini

1. **Kontrak tipe akun pemetaan** mencegah mapping finansial salah arah.
2. **Role escalation**:
   - non-owner tidak bisa memberi peran `admin`/`owner`;
   - non-owner tidak bisa memberi izin yang tidak dimilikinya;
   - peran sendiri tidak bisa diedit;
   - reset password `admin`/`owner` hanya oleh owner;
   - reset password menghapus seluruh session user.
3. **Impor akuntansi** memerlukan izin akuntansi pada commit.
4. **Auth URL produksi wajib HTTPS**; HTTP hanya dengan flag eksplisit.

## Temuan terbuka (prioritas)

| ID | Risiko | Rekomendasi |
| --- | --- | --- |
| SEC-003 | HPP/nilai persediaan terlihat tanpa `inventory.cost`. | **SELESAI** — masking di PO/penerimaan/retur/dokumen/cetak + test matriks izin. |
| SEC-005 | Token terminal POS membaca snapshot setelah user dicabut/di-demote. | **SELESAI** — cek membership + `pos.sell`; token dicabut saat role/membership berubah. |
| SEC-006 | Route export mengembalikan 500 untuk 401/403/validasi. | **SELESAI** — `withApiError` memetakan 400/403/404/409/500 untuk 16 route. |
| SEC-008 | Upload membaca body/workbook sebelum batas baris; belum validasi magic bytes. | **SELESAI** — streaming 20MB, magic bytes XLSX/XLS/CSV, batas entri/rasio ZIP. |
| SEC-009 | Perubahan pemetaan akun belum diaudit before/after. | Tulis audit `account_mapping.update` dengan nilai lama/baru. |
| SEC-011 | Aksi PO/PR/reservasi memakai `requirePermission`. | **SELESAI** — `requirePermissionInModule(..., "gudang")`; uji modul nonaktif. |
| SEC-012 | Rate limit in-memory; `X-Forwarded-For` dipercaya. | **SELESAI** — storage `rate_limit` di database; `BISA_TRUSTED_PROXIES` membatasi hop yang dipercaya. Pair throttle POS masih in-memory (lapisan tambahan). |
| SEC-013 | CSP `script-src 'unsafe-inline'`; logo URL diblokir CSP. | **SELESAI** — CSP nonce per request di `src/proxy.ts`; `img-src` mengizinkan https/http untuk logo. |

## Aturan operasi

- Jangan pernah menaruh secret di kode/commit; gunakan env.
- Produksi wajib HTTPS, backup terenkripsi, dan passphrase disimpan di luar host yang menyimpan dump.
- Akses DB memakai role aplikasi; migrasi memakai `DIRECT_URL` owner.
- Setelah perubahan role/membership, cabut session/token terkait (sebagian sudah dilakukan untuk reset password).
