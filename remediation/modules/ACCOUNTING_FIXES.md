# ACCOUNTING FIXES — Bisa ERP Remediation

Tanggal: 2026-11-21

## ACC-01 — Tutup buku setelah lock
- **Perubahan**: `assertPeriodOpen` mengizinkan `closed` atau `locked` hanya saat `allowClosingEntry` (sourceType year-end closing/reversal).
- **Test**: `remediation-audit-fixes.test.ts` — lock 12 periode 2025 lalu `postYearEndClosing` sukses; jurnal manual ke periode locked tetap ditolak (logika lama).
- **Status**: VERIFIED.

## ACC-02 — Akun pembayaran payroll
- **Perubahan**: `payPayrollRun` memakai `listCashBankIds` dan menolak akun non-kas/bank/kliring.
- **Test**: integration — akun revenue ditolak, run tetap `posted`; akun kas diterima.
- **Status**: VERIFIED.

## ACC-03 — Idempotensi jurnal manual
- **Perubahan**: modul baru `src/server/journal-idempotency.ts` menyimpan fingerprint payload di `idempotency_keys` (scope `accounting.journal`). Key sama + payload beda → CONFLICT; payload sama → replay.
- **Test**: integration — replay mengembalikan id sama; nominal berbeda → AppError.
- **Status**: VERIFIED.

## Catatan
- `accounting.ts` tetap di bawah ratchet 800 baris (785) karena helper idempotensi dipisah.
- `postJournal` tetap menjadi satu-satunya gerbang insert jurnal; perilaku validasi tidak berubah.
