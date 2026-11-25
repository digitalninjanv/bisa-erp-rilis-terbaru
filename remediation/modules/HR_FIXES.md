# HR FIXES — Bisa ERP Remediation

Tanggal: 2026-11-21

## HR-01 — Offboarding berbasis nama
- **Perubahan**: `revokeEmployeeUserAccess` tidak lagi mass-revoke semua nama yang sama. Hanya mencabut bila tepat satu kandidat non-owner; nol kandidat → `not_found`, >1 → `ambiguous`, hanya owner → `owner_only`. Final pay mencatat `accessRevocation` di audit.
- **Perilaku baru**: kasus ambigu tidak lagi mencabut akun secara otomatis; admin harus menyelesaikan di Pengaturan → Pengguna. Ini mencegah lockout akun yang salah, dengan residual risk: akun yang tepat belum tercabut otomatis sampai ditindaklanjuti.
- **Status**: VERIFIED (code); test khusus nama ambigu belum dijalankan.

## ACC-02 (lintas modul) — Akun pembayaran payroll
- **Perubahan**: lihat `ACCOUNTING_FIXES.md`. Pembayaran gaji hanya ke akun kas/bank.
- **Status**: VERIFIED.

## Rekomendasi lanjutan
- Tambah `employees.user_id` (nullable) untuk relasi eksplisit employee → user; gunakan pada offboarding dan audit. Ini task follow-up, bukan blocker remediasi saat ini.
