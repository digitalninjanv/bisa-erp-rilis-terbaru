# INVENTORY FIXES — Bisa ERP Remediation

Tanggal: 2026-11-21

## INV-01 — Void penerimaan PPN inklusif
- **Schema**: `stock_receipt_lines.stock_unit_cost` nullable (migration 0085).
- **Write**: `receipts.ts` menyimpan `stockUnitCost` (DPP) saat posting.
- **Void**: `receipt-void.ts` memakai `stockUnitCost`; untuk baris lama, inferensi `taxIncluded` dari `receipt.total == Σ lineTotal` lalu mengurangi porsi PPN proporsional.
- **Test**: `remediation-audit-fixes.test.ts` — stok lain 10×100 + receipt PPN 111 + void → `costPrice` 100, ledger 1000.
- **Status**: VERIFIED.

## INV-02 — Harga kemasan
- **Perubahan**: `saveProductAction` membandingkan harga kemasan existing; perubahan/penambahan harga kemasan tanpa `inventory.price` ditolak.
- **Test**: `remediation-settings-guards.test.ts` — staf gudang ubah `salePrice` kemasan → FORBIDDEN.
- **Status**: VERIFIED.

## INV-03 — N+1 batch availability
- **Perubahan**: `getBatchAvailability` memakai dua query agregat untuk semua produk (on-hand + batch), bukan 2 query/produk.
- **Status**: VERIFIED (code); benchmark belum.

## INV-04 — Batas baris penerimaan
- **Perubahan**: schema action `lines` diberi `.max(500)`.
- **Status**: VERIFIED (code).

## Catatan
- Baris lama tanpa `stock_unit_cost` memakai inferensi kompatibel; tidak ada backfill destruktif.
- Migrasi 0085 hanya menambah kolom nullable (aman untuk tabel besar).
