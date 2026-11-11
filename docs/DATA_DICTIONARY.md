# DATA DICTIONARY — TABEL INTI

| Tabel | Isi | Kunci/relasi | Catatan |
| --- | --- | --- | --- |
| `accounts` | Bagan akun | `company_id, code` unik; `parent_id` | 187 akun demo; `type`, `normal_balance`, `section`, `is_postable` |
| `account_mappings` | Pemetaan akun otomatis | `company_id, key` unik; `account_id` | Kunci resmi di `lib/akuntansi/account-mappings.ts` |
| `journal_entries` | Header jurnal | `company_id, number`; `source_type/source_id` | Posted/void; jurnal manual/otomatis |
| `journal_lines` | Baris debit/kredit | `entry_id`, `account_id` | Σ debit = Σ kredit dijaga trigger + domain |
| `account_monthly_balances` | Ringkasan bulanan | `company_id, account_id, year_month` | Turunan jurnal posted |
| `products` | Master produk | `company_id, sku` unik; `barcode` | `cost_price` AVCO, `sale_price`, `category_id`, `unit_id`, `supplier_id` |
| `product_packagings` | Kemasan/dus | `product_id` | `isi`, harga beli/jual, barcode, default |
| `categories` | Kategori produk | `company_id, name` unik; `parent_id` | Boleh bertingkat |
| `units` | Satuan | `company_id, code` unik | PCS/BTL/BOX/KG |
| `suppliers` / `customers` | Pihak | `company_id, code` unik | NPWP, termin, rekening, group |
| `warehouses` | Gudang | `company_id, code` unik | `branch_id`, default |
| `stock_receipts` / `stock_receipt_lines` | Penerimaan | `receipt_id` | `unit_cost` bruto, `line_total` DPP setelah diskon |
| `stock_movements` | Ledger stok | `company_id, product_id, warehouse_id` | Sumber kebenaran qty/nilai; `movement_type` |
| `stock_on_hand` | Saldo stok | `company_id, warehouse_id, product_id` | Cache dari ledger; dijaga invariant |
| `stock_batches` | Batch/ED | `product_id, warehouse_id, batch_number` | FEFO |
| `sales` / `sale_lines` | Penjualan | `sale_id` | `total` inklusif PPN; `cost_total` HPP |
| `sale_payments` | Pembayaran POS | `sale_id`, `method_id` | Split payment, fee, tendered |
| `sale_returns` / `sale_return_lines` | Retur penjualan | `sale_id` | Refund/store credit/exchange |
| `cash_sessions` / `cash_movements` | Sesi kas | `session_id` | Expected/counted/difference |
| `purchase_orders` / `purchase_order_lines` | PO | `order_id` | Draft → sent → received |
| `purchase_advances` | DP pembelian | `supplier_id`; origin return | Bisa dari retur |
| `supplier_returns` / lines / resolutions / allocations | Retur pemasok | `return_id` | Klaim, refund, DP, alokasi utang |
| `expenses` | Beban | `supplier_id` opsional | Bisa terutang |
| `employees` / `payroll_runs` / `payroll_items` | HR/payroll | `employee_id`, `run_id` | Statutory, PPh 21, BPJS |
| `import_jobs` / `import_rows` | Riwayat import | `job_id` | Preview/commit, error per baris |
| `audit_log` | Jejak audit | `company_id`, `entity_type/entity_id` | Harga, void, refund, role, dll. |
| `document_sequences` | Nomor dokumen | `company_id, doc_type` | Reset menghasilkan nomor dari 1 |
| `company_settings` | Profil & kebijakan | `company_id` | Pajak, cetak, modul, pembulatan |
