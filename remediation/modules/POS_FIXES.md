# POS FIXES — Bisa ERP Remediation

Tanggal: 2026-11-21

## POS-01 — Arah kas
- **Perubahan**: `src/lib/pos/cash-movement.ts` menjadi satu sumber pemetaan: `Kas Keluar → deposit` (laci berkurang), `Kas Masuk → withdrawal` (laci bertambah). Dialog memakai mapping + toast helper.
- **Test**: `tests/unit/pos-cash-movement.test.ts`; integration `cashDrawerMovement` opening 100.000 + Kas Keluar 25.000 = 75.000.
- **Status**: VERIFIED.

## POS-02 — Retry mutasi kas
- **Perubahan**: dialog menyimpan idempotency key per pembukaan (`useRef` + reset saat open/success); retry memakai key sama.
- **Test**: domain replay/conflict (POS-06). E2E UI belum dijalankan.
- **Status**: VERIFIED (unit+domain), E2E NOT_TESTED.

## POS-03 — Laporan retur
- **Schema**: `sale_returns.goods_total` nullable.
- **Write**: `goods_total = refundDue`; `total` tetap nilai voucher.
- **Reports**: sales summary/by day/by cashier memakai `coalesce(goods_total,total)`; tax proportion ikut.
- **Test**: penjualan utang 400 + retur store credit penuh → summary total 0, returned 400, profit 0; `goods_total` 400.
- **Status**: VERIFIED.

## POS-04 — ESC/POS
- **Perubahan**: `EscPosEncoder.text()` menetralkan byte <0x20/0x7f.
- **Test**: `tests/unit/pos-escpos.test.ts` — input berisi ESC/GS tidak menyisakan kontrol selain init.
- **Status**: VERIFIED.

## POS-05 — Pending checkout
- **Perubahan**: error definitif (termasuk INSUFFICIENT_STOCK/PERIOD_CLOSED/CONFLICT/ALREADY_POSTED) membersihkan attempt; hanya transport/unknown yang pending.
- **Status**: VERIFIED (code).

## POS-06 — Idempotency mutasi kas
- **Perubahan**: `cashDrawerMovement` menyimpan fingerprint payload; key sama + data berbeda → CONFLICT; key sama + data sama → replay.
- **Test**: integration memanggil key sama dengan tipe/nominal berbeda → AppError.
- **Status**: VERIFIED.

## POS-07 — Sesi tertutup
- **Perubahan**: `openCashSession` dengan `sessionId` yang sudah closed melempar `INVALID_STATE`, bukan mengembalikan sesi sebagai sukses.
- **Status**: VERIFIED (code).

## REP-01 — Top products retur-only
- **Perubahan**: `getTopProducts` menggabungkan produk yang hanya muncul di sisi retur.
- **Test**: retur November atas penjualan Oktober → produk muncul dengan total -400.
- **Status**: VERIFIED.
