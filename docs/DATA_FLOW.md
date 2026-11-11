# DATA FLOW

Sumber kebenaran: **jurnal** untuk akuntansi, **stock_movements** untuk kuantitas/nilai persediaan, dan dokumen transaksi untuk subledger. Laporan membaca sumber tersebut, bukan kolom saldo yang bisa diedit.

```mermaid
flowchart LR
  subgraph Input
    M[Form master]
    X[Import Excel/CSV]
    P[POS checkout]
    R[Penerimaan/PO]
    A[Penyesuaian/Opname/Transfer]
    H[Payroll/HR]
    E[Beban/Bank/Kas]
    S[Seed demo terpisah]
  end

  subgraph Domain
    CAT[Katalog: produk/kategori/satuan/pihak]
    INV[Inventory: receipt/return/adjustment/transfer]
    SALES[POS: quote/sale/return/session]
    ACC[Accounting: journal/mapping/period]
    HR[Payroll/HR]
  end

  subgraph Tabel
    T1[(products, categories, units, suppliers, customers)]
    T2[(stock_movements, stock_on_hand, stock_batches, stock_serials)]
    T3[(sales, sale_lines, sale_payments, sale_returns, cash_sessions)]
    T4[(journal_entries, journal_lines, account_monthly_balances, account_mappings)]
    T5[(payroll_runs, payroll_items, employees, ...)]
  end

  subgraph Output
    REP[Laporan: laba rugi, neraca, arus kas, buku besar, aging, PPN]
    DASH[Dashboard & Analisa]
    PRINT[Cetak nota/faktur/dokumen]
    EXP[Export Excel/CSV]
  end

  M --> CAT
  X --> CAT
  X --> INV
  X --> ACC
  P --> SALES
  R --> INV
  A --> INV
  H --> HR
  E --> ACC
  S --> CAT
  S --> INV
  S --> SALES

  CAT --> T1
  INV --> T2
  INV --> T4
  SALES --> T3
  SALES --> T2
  SALES --> T4
  ACC --> T4
  HR --> T5
  HR --> T4

  T4 --> REP
  T2 --> REP
  T3 --> DASH
  T3 --> REP
  T1 --> PRINT
  T3 --> PRINT
  T4 --> EXP
  T2 --> EXP
  T3 --> EXP
```

## Jalur tulis penting

| Data | Penulis utama | Dibaca oleh |
| --- | --- | --- |
| `stock_movements` | penerimaan, penjualan, retur, penyesuaian, opname, transfer | stok, nilai persediaan, HPP, rekonsiliasi |
| `stock_on_hand` | `inventory/movements.ts` (satu pintu) | POS, daftar produk, laporan stok |
| `journal_entries/lines` | `server/accounting.ts` + dokumen domain | semua laporan keuangan |
| `account_monthly_balances` | `postJournal` (ringkasan) | laporan periode |
| `sales`/`sale_lines` | `pos/sales-persist.ts` | POS, laporan penjualan, analisa |
| `sale_returns` | `pos/returns.ts`, `returns-settlement.ts` | laporan penjualan, P&L |
| `payroll_*` | `server/hr/payroll-*` | slip, rekap, jurnal |
| `import_jobs/rows` | API impor | wizard impor, audit |

## Risiko alur

- **Multi-writer**: tabel pihak, stok, dan jurnal ditulis beberapa domain. Setiap jalur wajib memakai lock yang sama dan jurnal seimbang.
- **Saldo laporan**: P&L memakai `section` + tipe; neraca memakai tipe; buku besar memakai `normalBalance`. Ketidaksesuaian metadata akun bisa membuat angka antar-laporan berbeda — kini divalidasi di form/impor dan ada fallback P&L.
- **Retur penjualan** punya dua jalur: dokumen retur (pendapatan/refund) dan penerimaan stok “customer_return” (biaya/HPP). Keduanya tidak boleh mencatat pendapatan ganda.
- **Stok negatif** dicegah di domain; `allow_negative_stock` adalah saklar sadar.
- **Void** harus membalik jurnal dan stok pada tanggal yang tepat; periode tertutup memaksa pembalik di periode berjalan (dicatat di audit).

## Titik integritas yang diperiksa

1. Σ debit = Σ kredit untuk setiap jurnal posted.
2. `stock_on_hand` = Σ `stock_movements` per produk/gudang.
3. Σ batch = `stock_on_hand` untuk produk batch.
4. Total penjualan = Σ baris + pembulatan.
5. Total penerimaan = Σ baris + pajak.
6. Nilai persediaan (qty × AVCO) = saldo GL akun persediaan.
7. Laporan penjualan = P&L setelah retur/PPN.
