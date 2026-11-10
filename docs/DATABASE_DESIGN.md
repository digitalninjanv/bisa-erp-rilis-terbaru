# Desain Database — Bisa ERP

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Sumber keadaan:
`src/db/schema.ts` (100 ekspor tabel, ±2.915 baris), `src/db/migrations/`
(55 berkas migrasi, 0000–0054), aturan proyek di `AGENTS.md`, dan verifikasi
T7 (`docs/TESTING_REPORT.md`). Dokumen ini menjelaskan *prinsip & peta*;
definisi kolom otoritatif tetap `schema.ts` + migrasi.

## 1. Platform & prinsip

- **PostgreSQL 18** — memakai `uuidv7()` native sebagai kunci primer
  (tidak pernah diganti `gen_random_uuid()`).
- **Multi-tenant satu database:** 92 tabel bisnis membawa `company_id`;
  isolasi ditegakkan **RLS PostgreSQL** (`app.company_id` disetel oleh
  `withCompany`/`withCompanyReadOnly` di `src/db/tenant.ts`) *dan*
  penyaringan eksplisit `ctx.company.id` di domain — dua lapis.
- **Dua peran koneksi:** `DIRECT_URL` = pemilik skema `erp` (migrasi &
  seed saja); `DATABASE_URL` = `app_user` (runtime aplikasi, terikat RLS).
- **Migrasi aditif saja.** Migrasi terapan tidak pernah diedit; perubahan
  = migrasi baru. Satu-satunya pengecualian sepanjang sejarah proyek:
  D-15 (ekstensi `pg_trgm` idempoten di kepala 0000 — instalasi baru
  selalu gagal tanpanya; dibuktikan dari database kosong).
- **Uang `numeric(19,4)`** sebagai string end-to-end; aritmetika
  Decimal.js di aplikasi (`src/lib/money.ts`). Tidak ada `float` untuk
  uang di skema.
- **Append-only untuk buku besar & jejak:** `journal_entries`/
  `journal_lines` terposting, `stock_movements`, `audit_log` — koreksi
  lewat baris pembalik/dokumen koreksi, tidak ada UPDATE/DELETE senyap
  (sebagian ditegakkan trigger database).
- **Reset seed menyeluruh:** `resetCompanyData` menghapus seluruh 92
  tabel ber-`company_id` kecuali daftar pengecualian beralasan tertulis
  (parameter statutori yang ditanam ulang idempoten); dikunci test
  `seed-reset-coverage` (T7-01).

## 2. Peta tabel per wilayah (100 tabel)

**Autentikasi & organisasi (Better Auth + multi-perusahaan):**
`user`, `session`, `account`, `verification`, `two_factor`,
`organization`, `member`, `invitation`, `company_roles`,
`company_settings` (saklar modul, pemetaan tampilan, parameter
perusahaan, definisi custom fields, pengaturan cetak/penomoran).

**Akuntansi:** `accounts` (CoA + `section`/`cash_flow_group` untuk
pengelompokan laporan terkonfigurasi), `account_mappings` (pemetaan kunci
transaksi → akun per perusahaan), `journal_entries`, `journal_lines`
(baris membawa tag pihak untuk subledger), `fiscal_periods` (status
bertingkat terbuka/tutup/kunci per bulan), `account_monthly_balances`
(ringkasan saldo bulanan — materialisasi yang dipelihara `postJournal`,
migrasi 0046), `bank_transfers`, `bank_statement_imports`,
`bank_statement_lines`, `expenses`, `party_payments`,
`party_opening_balances`, `party_credits`, `fixed_assets`,
`fixed_asset_categories`, `fixed_asset_depreciations`,
`fixed_asset_depreciation_runs`, `cash_sessions`, `cash_movements`
(sesi kas POS — wilayahnya POS, jurnalnya akuntansi).

**Katalog & pihak:** `products` (`costPrice` = AVCO global produk),
`categories` (bertingkat, `parent_id` anti-siklus), `units`,
`customer_groups`, `customer_group_discounts` (aturan harga sparse:
`percent`/`fixed`), `customers`, `suppliers`, `payment_methods`
(terhubung akun penampung + tarif fee per metode), `warehouses`,
`branches`.

**POS:** `sales`, `sale_lines`, `sale_payments` (fee dibekukan per
baris), `sale_returns`, `sale_return_lines` (termasuk `credit_used`
untuk penebusan kredit retur), `outbox` (antrean sinkronisasi offline:
status per item, hasil per item, kepemilikan penyinkron).

**Gudang:** `stock_on_hand` (materialisasi per produk×gudang×batch),
`stock_movements` (buku besar stok append-only), `stock_documents`,
`stock_document_lines` (transfer/penyesuaian/pengeluaran beralasan),
`stock_receipts`, `stock_receipt_lines`, `purchase_orders`,
`purchase_order_lines`, `purchase_requests`, `purchase_request_lines`,
`supplier_returns`, `supplier_return_lines`,
`supplier_return_allocations`, `supplier_return_resolutions`,
`stock_batches` (kadaluarsa; FEFO), `stock_serials`,
`stock_serial_movements`, `stock_reservations`, `opname_tasks`
(tugas opname hitung buta, termasuk cycle count).

**HR & payroll:** `employees`, `employee_history` (riwayat perubahan
otomatis), `departments`, `job_positions`, `work_shifts`,
`employee_shift_assignments`, `attendance_records`, `leave_types`,
`leave_requests`, `overtime_requests`, `employee_advances` +
`employee_advance_entries` (kasbon), `employee_loans` +
`employee_loan_entries` (pinjaman), `reimbursement_claims`,
`payroll_runs`, `payroll_items`, `payroll_item_lines`,
`payroll_component_drafts` (draf komponen seperti THR),
`employee_statutory_enrollments`, `hr_parameters`, dan keluarga
parameter statutori bertanggal efektif: `payroll_statutory_settings`,
`payroll_statutory_programs`, `payroll_statutory_parameters`,
`payroll_ptkp_statuses`, `payroll_ter_brackets`, `payroll_tax_brackets`,
`payroll_minimum_wages`, `payroll_overtime_rules`.

**Platform:** `document_sequences` (seri penomoran per jenis dokumen per
perusahaan — upsert atomik), `idempotency_keys`, `audit_log`,
`import_jobs`, `import_rows` (impor bertahap tervalidasi per baris),
`quick_entry_drafts`, `quick_entry_submissions` (Catat Transaksi:
pratinjau == posting dari lib bersama).

## 3. Invariant yang dijaga skema + domain (terverifikasi T7)

| Invariant | Penegak | Bukti T7 |
|---|---|---|
| Jurnal terposting selalu seimbang (Σ Dr = Σ Cr) | `postJournal` (satu gerbang) | SQL mentah: 0 jurnal timpang |
| Posting hanya ke periode terbuka | `assertPeriodOpen` di `postJournal` | Test periode + matriks AKT-11 |
| `stock_on_hand` = Σ `stock_movements` | Domain movements + trigger append-only | SQL mentah dua arah: 0 selisih |
| Nilai persediaan = Σ qty × AVCO; AVCO di `products.costPrice` | Domain penerimaan/penjualan | Consistency 11/11 pada reseed |
| Ringkasan bulanan = agregat jurnal | Pemeliharaan tunggal di `postJournal` | SQL mentah dua arah: 0 selisih |
| Dokumen final menolak sunting; koreksi = reversal | Status dokumen + `reverseSourceJournal` | Matriks POS/AKT/GDG |
| Penomoran dokumen unik per seri | `document_sequences` upsert atomik | Test penomoran + penjaga reset seed |
| Satu checkout = satu dokumen | `idempotency_keys` + kunci per item outbox | Kirim ulang offline = `duplicate` (T6) |

## 4. Pola data yang disengaja

- **Snapshot pada dokumen:** nama/SKU/harga pihak & produk dibekukan di
  baris dokumen saat terbit — perubahan master tidak mengubah dokumen
  lama (riwayat tidak rusak oleh edit master).
- **Harga kelompok sparse:** `customer_group_discounts` hanya memuat
  pengecualian; tanpa aturan = harga normal. Mode pembulatan grup
  disimpan di `sales.rounding_mode` agar quote & checkout identik.
- **Parameter bertanggal efektif:** keluarga `payroll_*` menyimpan
  baris berversi tanggal — perhitungan periode lama tidak berubah oleh
  aturan baru (D-25).
- **Status dokumen = enum penjaga integritas** (D-16): bukan teks bebas
  dan bukan bisa dikustomisasi pengguna; status adalah bagian dari
  mesin kebenaran stok/akuntansi.
- **Custom fields aman:** definisi di `company_settings`, nilai di kolom
  `attributes` jsonb pada produk & pihak — fleksibilitas tanpa migrasi
  per perusahaan.
- **FK referensial ditegakkan database** (27 FK ditambahkan SIM-2);
  pengecualian tercatat: tag pihak di baris jurnal (`party_id` tanpa FK,
  keberadaannya diverifikasi aksi) — lihat R3-D di PROGRESS.

## 5. Backup & pemulihan

Dump PostgreSQL terjadwal (systemd timer, T5) memakai skrip di
`deploy/`; restore ke database sampingan terverifikasi identik
(round-trip SIM-2 S5 & T5). Round-trip transaksi tingkat aplikasi
**sengaja tidak dibangun** (by design — jalur sah pemulihan adalah
backup/restore DB). Prosedur: `docs/RUNBOOK-BACKUP-RESTORE.md`.
