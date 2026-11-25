# BEFORE / AFTER COMPARISON — Bisa ERP Remediation

Tanggal: 2026-11-21
Baseline: commit `6140f97` sebelum remediasi.
After: branch `remediation/erp-audit-2026-11-21` (working tree).

## Ringkasan

| Status akhir | Jumlah |
|---|---|
| RESOLVED_VERIFIED | 18 |
| RESOLVED (code/script, runtime test belum) | 6 |
| DEFERRED | 2 (CORE-02, PLAT-02) |
| Total temuan | 26 |
| BLOCKED / NOT_TESTED (di luar 26 temuan) | 1 (PLAT-03) |

## Detail

| ID | Before | After | Status |
|---|---|---|---|
| POS-01 | “Kas Keluar” menambah laci; jurnal terbalik | Mapping `out→deposit`, `in→withdrawal`; integration 100.000−25.000=75.000 | RESOLVED_VERIFIED |
| POS-02 | Key baru setiap submit; retry bisa dobel | Key per pembukaan dialog; retry memakai key sama | RESOLVED_VERIFIED (unit/domain; E2E belum) |
| POS-03 | Laporan mengurangi nilai voucher kredit | `goods_total=refundDue`; laporan memakai goods_total | RESOLVED_VERIFIED |
| INV-01 | Void memakai harga bruto; AVCO melenceng | `stock_unit_cost` DPP; void memakai nilai stok; test PPN inklusif | RESOLVED_VERIFIED |
| ACC-01 | Closing ditolak di periode locked | `allowClosingEntry` menerima closed/locked; test | RESOLVED_VERIFIED |
| CORE-01 | user-admin bisa membuat/reset manager | Subset permission pada create/update/reset/remove; test | RESOLVED_VERIFIED |
| HR-01 | Nama sama → semua akun dicabut | Hanya satu kandidat; ambigu tidak mass-revoke; test | RESOLVED_VERIFIED |
| CORE-03 | Payroll export tetap saat HR off | `assertModuleEnabled(...,"hr")`; test payroll access | RESOLVED_VERIFIED |
| CORE-06 | Loan amounts terlihat viewer akuntansi | `excludeEntityTypes` HR; test | RESOLVED_VERIFIED |
| POS-04 | Byte kontrol lolos ke printer | `text()` menetralkan kontrol; unit test | RESOLVED_VERIFIED |
| INV-02 | Harga kemasan bypass izin | Perbandingan harga kemasan + FORBIDDEN; test | RESOLVED_VERIFIED |
| ACC-02 | Payroll bisa kredit akun non-kas | `listCashBankIds` guard; test | RESOLVED_VERIFIED |
| ACC-03 | Key jurnal sama + data beda replay | Fingerprint payload; CONFLICT; test | RESOLVED_VERIFIED |
| SET-01 | Tipe/akun metode historis bisa diubah | Ditolak bila method dipakai; test | RESOLVED_VERIFIED |
| CORE-02 | Beberapa action tanpa module gate | **DEFERRED** — perubahan ditunda karena mock test lama; risiko dicatat | DEFERRED |
| CORE-04 | Token perangkat abaikan module switch | `isModuleEnabled(settings,"pos")`; pos-device tests lulus | RESOLVED (code) |
| CORE-07 | Redirect login jadi INTERNAL | Rethrow NEXT_REDIRECT/NOT_FOUND; unit test | RESOLVED_VERIFIED |
| POS-05 | Error stok disimpan pending | Error definitif clear; code | RESOLVED (code) |
| POS-06 | Key kas sama + data beda diabaikan | Fingerprint; CONFLICT; test | RESOLVED_VERIFIED |
| POS-07 | Sesi closed dikembalikan sukses | `INVALID_STATE`; code | RESOLVED (code) |
| REP-01 | Retur-only product hilang | Union penjualan+retur; test | RESOLVED_VERIFIED |
| INV-03 | 2 query per produk batch | Dua agregasi GROUP BY; tests lulus | RESOLVED (code; benchmark belum) |
| INV-04 | Tanpa batas baris penerimaan | `.max(500)`; code | RESOLVED (code) |
| CORE-05 | Pairing race | Klaim atomik `usedAt` + pos-device test | RESOLVED_VERIFIED |
| PLAT-01 | Prune tidak pernah dipanggil | Script + package command; cron belum dipasang | RESOLVED (script) |
| PLAT-02 | CSP Tauri unsafe-inline | **DEFERRED** — perlu build Tauri | DEFERRED |
| PLAT-03 | Restore/PITR/offsite | Tidak berubah; **BLOCKED** | BLOCKED |

## Perubahan kode utama

- Schema: `stock_receipt_lines.stock_unit_cost`, `sale_returns.goods_total` (migration 0085).
- POS: mapping kas, idempotency dialog/domain, ESC/POS, recovery state, report netting.
- Inventory: void valuation, packaging price gate, batch query, receipt line cap.
- Accounting: closing exception, payroll account, journal fingerprint module.
- Auth/Audit: user-admin subset, audit feed filter, device module gate, redirect guard.
- HR: safe name-based revocation.
- Settings: payment method identity lock.
- Platform: prune script.
