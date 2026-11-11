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
- **Backup**: `scripts/backup.sh` mendukung dump custom, enkripsi opsional, manifest; restore di `scripts/restore.sh`.
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
| SEC-003 | HPP/nilai persediaan terlihat oleh `inventory.view` tanpa `inventory.cost` di beberapa halaman. | Pusatkan masking biaya di query/helper; tambah test matriks izin. |
| SEC-005 | Token terminal POS tetap bisa membaca snapshot setelah user dicabut/di-demote. | Cek membership + `pos.sell` di snapshot; cabut token saat role/membership berubah. |
| SEC-006 | Route export mengembalikan 500 untuk 401/403/validasi. | Helper error mapper `AppError`/`ZodError` → status HTTP benar. |
| SEC-008 | Upload membaca body/workbook sebelum batas baris; belum validasi magic bytes. | Batas body di proxy, validasi signature, batas sheet/row saat baca. |
| SEC-009 | Perubahan pemetaan akun belum diaudit before/after. | Tulis audit `account_mapping.update` dengan nilai lama/baru. |
| SEC-011 | Beberapa aksi PO/PR/reservasi memakai `requirePermission`, bukan `requirePermissionInModule`. | Ganti ke gerbang modul; uji modul nonaktif. |
| SEC-012 | Rate limit in-memory; `X-Forwarded-For` dipercaya. | Rate limit terpusat / proxy tepercaya untuk multi-instance. |
| SEC-013 | CSP `script-src 'unsafe-inline'`; logo URL diblokir CSP. | Nonce/hash; ubah logo URL menjadi data URL/upload. |

## Aturan operasi

- Jangan pernah menaruh secret di kode/commit; gunakan env.
- Produksi wajib HTTPS dan backup terenkripsi.
- Akses DB memakai role aplikasi; migrasi memakai `DIRECT_URL` owner.
- Setelah perubahan role/membership, cabut session/token terkait (sebagian sudah dilakukan untuk reset password).
