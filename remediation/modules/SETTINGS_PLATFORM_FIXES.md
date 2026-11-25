# SETTINGS & PLATFORM FIXES — Bisa ERP Remediation

Tanggal: 2026-11-21

## SET-01 — Mutasi historis metode pembayaran
- **Perubahan**: `updatePaymentMethodAction` menolak perubahan `type`/`accountId` bila `sale_payments` sudah memakai metode. Nama/urutan/fee/aktif tetap boleh.
- **Test**: `remediation-settings-guards.test.ts` — ubah cash→bank ditolak CONFLICT; ubah nama berhasil.
- **Status**: VERIFIED.

## PLAT-01 — Prune idempotency keys
- **Perubahan**: `scripts/prune-idempotency.ts` + `pnpm prune:idempotency` (argumen hari, default 30). Script berjalan per perusahaan via `withCompany` dan tidak dipanggil otomatis saat app boot.
- **Test**: unit `pruneExpiredIdempotencyKeys` yang sudah ada.
- **Status**: VERIFIED (script), cron operator belum dipasang.

## PLAT-02 — Tauri CSP
- **Status**: DEFERRED. Menghapus `'unsafe-inline'` berisiko mematahkan build statis Tauri; perlu build/verifikasi Tauri terpisah. Residual risk dicatat.

## PLAT-03 — Restore/PITR/offsite
- **Status**: BLOCKED. Tidak ada environment drill; bukan cacat kode. Tetap NOT_TESTED.
