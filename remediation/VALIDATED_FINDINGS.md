# VALIDATED FINDINGS — Bisa ERP Remediation

Tanggal: 2026-11-21
Basis audit: `audit-reports/FINAL_ERP_AUDIT.md` (commit `6140f97`)
Branch remediasi: `remediation/erp-audit-2026-11-21`

Klasifikasi: `CONFIRMED`, `FALSE_POSITIVE`, `ALREADY_FIXED`, `NEEDS_INVESTIGATION`, `BLOCKED`.

Tidak ada temuan yang langsung diperbaiki tanpa pembacaan ulang kode. Semua status di bawah adalah hasil verifikasi ulang terhadap source saat ini; bukti dinamis yang sudah dijalankan dicatat.

## Ringkasan

| Total temuan | Confirmed | False positive | Already fixed | Blocked/Not tested |
|---|---|---|---|---|
| 26 | 25 | 0 | 0 | 1 (PLAT-03) |

## Temuan dan hasil revalidasi

| ID | Severity | Status | Revalidasi |
|---|---|---|---|
| POS-01 | CRITICAL | CONFIRMED | `cash-movement-dialog.tsx` masih memetakan “Kas Keluar” → `withdrawal`; domain `sessions.ts` masih menambah laci untuk `withdrawal`. Reproducer lama tetap berlaku. |
| POS-02 | HIGH | CONFIRMED | Dialog masih membuat `crypto.randomUUID()` pada setiap submit; tidak ada key ref yang dipertahankan. |
| POS-03 | HIGH | CONFIRMED | `returns.ts` masih mengisi `sale_returns.total` dengan `excessPortion` untuk store_credit/exchange; `reports/sales.ts` masih mengurangi kolom itu. |
| INV-01 | HIGH | CONFIRMED | `stock_receipt_lines` masih tidak menyimpan nilai DPP/stok; `receipt-void.ts` masih memakai `lineTotal/qty` (bruto). |
| ACC-01 | HIGH | CONFIRMED | `year-end-closing.ts` masih menerima periode `locked`; `accounting.ts` masih hanya mengizinkan `closed` untuk closing entry. |
| CORE-01 | HIGH | CONFIRMED | `assertCanAssignRole` masih hanya memblokir owner/admin; reset password/removal masih hanya melindungi owner/admin. |
| HR-01 | HIGH | CONFIRMED | `final-pay.ts` masih memanggil `revokeEmployeeUserAccess(..., employee.name, ...)`; query masih `user.name = employeeName`. |
| CORE-03 | HIGH | CONFIRMED | `api/export/payroll/route.ts` masih `requirePermission("payroll.salary")` tanpa module gate HR. |
| CORE-06 | HIGH | CONFIRMED | `listCompanyAuditTrail` masih mengembalikan semua entityType; halaman Riwayat masih hanya `accounting.view`; audit pinjaman masih memuat `amount`. |
| POS-04 | MEDIUM | CONFIRMED | `EscPosEncoder.text()` masih meneruskan karakter kontrol < 0x20. |
| INV-02 | MEDIUM | CONFIRMED | `priceChanged` di `produk.ts` masih hanya membandingkan harga produk; harga kemasan tidak dibandingkan. |
| ACC-02 | MEDIUM | CONFIRMED | `payPayrollRun` masih mengkredit `input.accountId` tanpa `listCashBankIds`. |
| ACC-03 | MEDIUM | CONFIRMED | `postJournal` masih replay berdasarkan key saja; tidak ada fingerprint payload. |
| SET-01 | MEDIUM | CONFIRMED | `updatePaymentMethodAction` masih mengizinkan perubahan `type`/`accountId` tanpa cek pemakaian; `sale_payments` tidak menyimpan snapshot. |
| CORE-02 | MEDIUM | CONFIRMED | Import/rekonsiliasi/uang muka/payroll settings masih memakai `requirePermission` tanpa module gate. |
| CORE-04 | MEDIUM | CONFIRMED | `resolvePosTerminalByToken` masih hanya cek membership + `pos.sell`; tidak cek `enabled_modules`. |
| CORE-07 | MEDIUM | CONFIRMED | `guard()` masih menangkap semua rejection; reproducer redirect → `INTERNAL` tetap berlaku. |
| POS-05 | LOW | CONFIRMED | `use-terminal-checkout.ts` masih menyimpan error non-transport sebagai pending. |
| POS-06 | LOW | CONFIRMED | `cashDrawerMovement` masih return tanpa membandingkan payload saat key sudah ada. |
| POS-07 | LOW | CONFIRMED | `openCashSession` dengan `sessionId` masih mengembalikan sesi `closed`. |
| REP-01 | LOW | CONFIRMED | `getTopProducts`/`getSalesByCategory` masih membangun daftar dari baris penjualan saja. |
| INV-03 | LOW/MEDIUM | CONFIRMED | `getBatchAvailability` masih 2 query per produk batch. |
| INV-04 | LOW | CONFIRMED | Schema action penerimaan masih tanpa `.max()` pada `lines`. |
| CORE-05 | LOW | CONFIRMED | `consumePairingCode` masih SELECT tanpa `FOR UPDATE`. |
| PLAT-01 | LOW/MEDIUM | CONFIRMED | `pruneExpiredIdempotencyKeys` masih tanpa pemanggil produksi. |
| PLAT-02 | LOW | CONFIRMED | CSP Tauri masih `script-src 'self' 'unsafe-inline'`. |
| PLAT-03 | NOT_TESTED | BLOCKED | Restore/PITR/offsite tetap tidak dapat diverifikasi tanpa environment drill; bukan bug kode. |

## Root cause groups

1. **Cash drawer semantics** — POS-01, POS-02, POS-06.
2. **Receipt inventory valuation** — INV-01.
3. **Return reporting value** — POS-03, REP-01.
4. **Period closing exception** — ACC-01.
5. **Authorization/module boundary** — CORE-01, CORE-02, CORE-03, CORE-04, CORE-06, CORE-07, SET-01, INV-02.
6. **HR identity/offboarding** — HR-01.
7. **Payroll payment account** — ACC-02.
8. **Printer text safety** — POS-04.
9. **UI recovery state** — POS-05, POS-07.
10. **Scale/retention** — INV-03, PLAT-01.
11. **Pairing concurrency** — CORE-05.
12. **Input bounds / defense in depth** — INV-04, PLAT-02.
13. **Manual journal idempotency** — ACC-03.

## Catatan validasi

- Semua temuan diverifikasi pada commit yang sama dengan audit; tidak ada commit baru yang mengubah kode terkait.
- Reproducer POS-01, POS-03, INV-01, ACC-01, POS-04, POS-06, CORE-07 dijalankan pada database test terpisah/helper dan tetap menghasilkan perilaku yang dilaporkan.
- Tidak ada FALSE_POSITIVE yang ditemukan. PLAT-03 adalah keterbatasan environment, bukan cacat kode.
