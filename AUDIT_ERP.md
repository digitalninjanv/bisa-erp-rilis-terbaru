# AUDIT_ERP.md — Audit Menyeluruh Bisa ERP

**Tanggal:** 2026-11-10
**Repo:** `/home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp`
**Stack:** Next.js 16.4.5 (App Router) · React 19 · TypeScript 5 · Drizzle ORM 0.45 · PostgreSQL (`postgres` driver) · Better Auth · Tailwind 4 · shadcn/Base UI · Vitest + Playwright
**Mode:** Audit read-only. Tidak ada kode produksi yang diubah. Hanya satu berkas tes reproduksi baru (`tests/audit-repro/pos-paid-total-repro.test.ts`) dan laporan ini yang ditulis.
**Batas:** repo **bukan git repository** (tidak ada `.git`), sehingga `git log`/`git blame` tidak dapat dijalankan. Semua riwayat perubahan tidake terverifikasi.

---

## 1. Ringkasan Eksekutif — 10 Risiko Teratas

| # | Risiko | ID | Severity | Dampak singkat |
|---|---|---|---|---|
| 1 | Login menampilkan & mengisi bawaan kata sandi demo di kode klien | UI-028 | **Kritis** | Siapa pun dapat masuk sebagai `owner@bisa.id` pada lingkungan yang ter-seed demo. |
| 2 | Void penerimaan piutang menghapus porsi tunai dari `paidTotal` | POS-001 | **Tinggi** | `paidTotal`/`paymentStatus` salah; piutang naik palsu; limit kredit pelanggan terlampaui. |
| 3 | Penerimaan piutang tunai tidak mencatat mutasi kas ke sesi laci | POS-002 | **Tinggi** | `expectedCash` lebih rendah dari hitungan fisik → selisih kas fiktif saat tutup sesi. |
| 4 | Void/retur memulihkan stok dengan flag pelacakan produk **saat ini**, bukan saat penjualan | POS-003 | **Tinggi** | Stok permanen berkurang (atau menggelembung) saat `trackStock` diubah setelah penjualan. |
| 5 | Void penjualan tidak mengembalikan reservasi stok yang sudah dikonsumsi | POS-005 | **Tinggi** | Janji stok ke pelanggan hilang padahal stok fisik sudah dipulihkan. |
| 6 | Void penjualan tidak memulihkan `party_credits.used_amount` | WF-006 | **Tinggi** | Kredit pelanggan hilang; subledger kredit ≠ GL. |
| 7 | Periode `closed` dapat dibuka kembali oleh `accounting.manage` tanpa owner/alasan | WF-001 | **Tinggi** | Integritas penutupan periode & audit hilang; dokumen backdated bisa masuk. |
| 8 | Tutup buku tahunan tidak mensyaratkan periode ditutup/dikunci | WF-002 | **Tinggi** | Hasil tutup buku tidak valid bila masih ada bulan terbuka. |
| 9 | Persetujuan cuti & lembur tanpa maker-checker | WF-003/004 | **Tinggi** | User yang sama dapat mengajukan & menyetujui cuti/lembur sendiri; memengaruhi payroll. |
| 10 | Kepemilikan field ganda: `products.costPrice` & `salePrice` ditulis modul katalog **dan** mesin AVCO/penerimaan | DATA-001/002 | **Tinggi** | Harga pokok/jual saling menimpa; GL persediaan & margin drift. |

Temuan lengkap: **30 UI/UX**, **22 fungsional POS**, **29 workflow**, **12 integritas data**, **4 arsitektur/metodologi**. Total **97 temuan**. Rincian ada di §4.

Kesimpulan umum: **fondasi teknis sangat kuat** (gerbang jurnal tunggal, RLS terpusat + FORCE, trigger append-only & balanced, idempotent key di banyak dokumen, guard hapus lengkap, primitif uang terpusat). Masalah terbesar bukan pada fondasi, melainkan pada **(a) batas kepemilikan data lintas modul**, **(b) penjaga idempotensi/approval yang belum merata**, dan **(c) konsistensi UX/validasi sisi klien**. Suite berjalan **2206/2207 hijau** dengan 1 tes merah (§5).

---

## 2. Metodologi, Tools & Sumber Riset

### 2.1 Fase 0 — Riset referensi

Tools yang dipakai: **Exa AI** (`web_search_exa`) dan **web search bawaan**. Catatan jujur: Exa tersedia pada awal sesi (3 kueri pertama), lalu server MCP Exa sempat tidak tersedia, kemudian tersedia lagi; web search bawaan mengembalikan "No search results found" untuk dua kueri. Karena itu sebagian besar sumber di bawah berasal dari Exa, dan beberapa kueri dilengkapi dengan pencarian web yang gagal (disebutkan apa adanya).

| Topik | Sumber | URL |
|---|---|---|
| UX form ERP/enterprise | Pega UX Design System — Forms | https://design.pega.com/patterns/forms/ |
| UX form enterprise | SAP Engagement Cloud Design System — Forms | https://designsystem.emarsys.net/docs/patterns/forms/ |
| Desain formulir EPM | Oracle EPM — Form Design Considerations | https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/ebest/form_design_considerations.html |
| Pedoman desain form ERPNext | frappe/erpnext Wiki — Form Design Guidelines | https://github.com/frappe/erpnext/wiki/Form-Design-Guidelines |
| Pola form Infor | Infor Design System — Form | https://design.infor.com/patterns/interactions/form/ |
| Kontrak desain form | Maersk Design System — Forms | https://designsystem.maersk.com/guidelines/forms/ |
| Master data governance | SAP Learning — Introducing Central Governance of Master Data | https://learning.sap.com/courses/introducing-sap-master-data-governance/introducing-central-governance-of-master-data |
| MDM/SOT | SAP — Master Data Governance | https://www.sap.com/products/data-cloud/master-data-governance.html |
| ERP data governance | Flectic — ERP Master Data Governance Strategy | https://flectic.com/learn/erp-data-governance |
| SOT | Stibo Systems — Master data management: a single source of truth | https://www.stibosystems.com/blog/how-to-enable-a-single-source-of-truth-with-mdm-and-integration |
| Workflow dokumen | ERPNext Docs — Workflows | https://docs.frappe.io/erpnext/workflows |
| Approval state machine | Softa — Approval Flows | https://softa.io/en-US/docs/features/flow/approval/ |
| Siklus dokumen | Nama Docs — Document Lifecycle | https://docs.namasoft.com/platform/documents-and-records/document-lifecycle.html |
| Workflow state machine | DEV Community — Approval Workflows Are State Machines | https://dev.to/pytagotech/approval-workflows-are-state-machines-56h6 |
| Ledger immutable | ERPNext Docs — Immutable Ledger | https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext |
| Integrasi inventory-GL | Oracle Retail — Reviewing Process Integration for Inventory Valuation & Revenue Recognition | https://docs.oracle.com/en/industries/retail/retail-integration-cloud/latest/fiimp/reviewing-process-integration-inventory-valuation-and-revenue-recognition-accounting-entries.htm |
| Konsistensi terdistribusi | System Design Notes — Transactions Across Services (2PC, Sagas, Outbox, Idempotency) | https://harut8.github.io/system-design/distributed-systems/06-distributed-transactions-sagas-outbox-idempotency/ |
| Unik master data | Primentra — Composite Unique Keys in Master Data | https://primentra.com/blog/composite-unique-keys-master-data |
| Unik SKU/item | Rivane ERP — Item/SKU Master Creation and Maintenance | https://rivane.ai/blog/item-sku-master-creation-and-maintenance/ |
| Unik/bisnis key | Bizagi — Business Keys | https://help.bizagi.com/platform/en/business_keys.htm |
| Dedup master data | SysgenPro — Mitigating Duplicate Records During Master Data Migration to Odoo | https://sysgenpro.com/mitigating-duplicate-records-during-master-data-migration-to-odoo |
| Kode produk unik | ingeint/product_code_unique (GitHub) | https://github.com/ingeint/product_code_unique |

Kriteria audit yang dipakai dari riset: minimal input & progressive disclosure; label permanen (bukan placeholder); validasi inline on-blur + pesan spesifik; fokus ke field pertama; single source of truth + duplicate check di depan pintu; state machine eksplisit dengan transisi sah; ledger append-only (koreksi lewat reversal, bukan hapus/edit); transaksi atomik lintas tabel; idempotency key di every write.

### 2.2 Fase 1–5 — Tools & hasil

| Tool | Pemakaian | Hasil |
|---|---|---|
| `read` / `glob` / `grep` | Membaca skema, server, actions, komponen | Peta modul & semua temuan kode |
| `codegraph` | Index tersedia (`.codegraph/`) | Tidak dipakai sebagai alat utama karena pembacaan langsung lebih target |
| `shell` (bash) | Inspeksi DB, migrasi, skema | Lihat di bawah |
| Node `postgres` (read-only) | Query `information_schema`, `pg_indexes`, `pg_constraint`, `pg_trigger`, `pg_policies` | Terlihat di §3 & §4.4 |
| `pnpm typecheck` (`tsc --noEmit`) | Seluruh repo | **Lolos, 0 error** |
| `pnpm lint` (`eslint .`) | Seluruh repo | **0 error, 19 warning** (unused vars, hook deps) |
| `pnpm test` (`vitest run`) | 230 berkas tes | **2206 lolos, 1 gagal** — `tests/integration/review-fixes-t4rb.test.ts` (§5) |
| Playwright (Chromium) | Login + screenshot 23 halaman + alur form | Bukti visual §4.1; 4 halaman awal timeout `networkidle`, diulang dengan `domcontentloaded` |
| `pnpm build` / `pnpm start` | Menjalankan aplikasi produksi | Server hidup; build mutakhir (0 berkas `src` lebih baru dari `.next/BUILD_ID`) |
| `git log` / `git blame` | — | **Tidak tersedia** (bukan git repo) |
| `psql` | — | **Tidak terinstal**; diganti driver Node `postgres` |

Catatan DB: koneksi awal menampilkan 0 baris karena **FORCE RLS** menyembunyikan baris tanpa `app.company_id`; setelah `set_config('app.company_id', ..., false)` data muncul (1 organisasi, 1 perusahaan demo, 175 akun, 129 produk, 32 penjualan, 283 gerakan stok, 676 jurnal).

---

## 3. Peta Modul & Matriks Konflik Data

### 3.1 Peta modul → route → aksi → domain → tabel

| Modul | Route | Aksi server | Domain | Tabel utama |
|---|---|---|---|---|
| **POS** | `/app/pos`, `/riwayat`, `/retur`, `/ditahan`, `/sesi`, `/terminal`, `/offline`, `/grup` | `actions/pos.ts`, `actions/pos-offline.ts`, `actions/pos-terminals.ts` | `server/pos/*`, `server/pos-offline.ts`, `server/pos-device.ts` | `sales`, `sale_lines`, `sale_payments`, `sale_returns`, `cash_sessions`, `cash_movements`, `pos_terminals`, `party_payments`, `stock_movements`, `journal_entries` |
| **Gudang** | `/app/gudang/*` (18 route) | `actions/inventory/*`, `actions/purchasing.ts`, `actions/purchase-requests.ts`, `actions/supplier-returns.ts`, `actions/reservations.ts`, `actions/import/*` | `server/inventory/*`, `server/purchasing.ts`, `server/supplier-returns/*`, `server/catalog/*`, `server/import/*`, `server/reservations.ts` | `products`, `suppliers`, `customers`, `categories`, `units`, `product_packagings`, `customer_group_discounts`, `stock_on_hand`, `stock_movements`, `stock_batches`, `stock_serials`, `stock_documents*`, `stock_receipts*`, `purchase_orders*`, `purchase_requests*`, `supplier_returns*`, `purchase_advances*`, `stock_reservations`, `opname_tasks` |
| **Akuntansi** | `/app/akuntansi/*` (18 route) | `actions/accounting/*`, `actions/master-data.ts`, `actions/fixed-assets.ts`, `actions/bank-reconciliation.ts`, `actions/opening-balances.ts`, `actions/employee-*`, `actions/reimbursements.ts`, `actions/quick-entry.ts` | `server/accounting.ts`, `server/payables.ts`, `server/party-credits.ts`, `server/party-writeoffs.ts`, `server/fixed-assets.ts`, `server/bank-reconciliation/*`, `server/opening-balances/*`, `server/year-end-closing.ts`, `server/reports/*`, `server/coa-migration.ts`, `server/system-accounts.ts` | `accounts`, `account_mappings`, `journal_entries`, `journal_lines`, `account_monthly_balances`, `fiscal_periods`, `expenses`, `bank_transfers`, `bank_statement_*`, `party_payments`, `party_opening_balances`, `party_credits`, `fixed_assets*`, `quick_entry_*` |
| **HR/Payroll** | `/app/akuntansi/hr/*`, `/payroll`, `/kasbon`, `/pinjaman`, `/klaim` | `actions/hr/*`, `actions/payroll-indonesia.ts` | `server/hr/*`, `server/payroll-indonesia.ts`, `server/employee-advances.ts`, `server/employee-loans.ts`, `server/reimbursements.ts` | `employees`, `employee_history`, `departments`, `job_positions`, `work_shifts*`, `attendance_records`, `overtime_requests`, `leave_*`, `employee_advances*`, `employee_loans*`, `reimbursement_claims`, `payroll_runs`, `payroll_items`, `payroll_item_lines`, `payroll_*` (statutory) |
| **Pengaturan** | `/app/pengaturan/*` | `actions/settings/*`, `actions/users.ts`, `actions/company.ts` | `server/settings.ts`, `server/catalog/settings-reads.ts` | `company_settings`, `company_roles`, `user`, `session`, `member`, `organization`, `warehouses`, `branches`, `payment_methods`, `document_sequences` |
| **Analisa** | `/app/analisa` | — (read-only) | `server/analytics.ts`, `server/reports/*` | — (agregasi) |

### 3.2 Matriks Konflik Data (entitas × modul penulis × field × akibat)

| Entitas | Modul penulis | Field yang ditulis | Konflik / Akibat |
|---|---|---|---|
| **products** | Gudang (katalog) | `costPrice`, `salePrice`, `name`, `sku`, `barcode`, `track*` | **`costPrice` juga ditulis mesin AVCO** (`server/inventory/movements.ts:168`, `receipt-prices.ts:30`) → dua pemilik. Manual edit akan ditimpa AVCO berikutnya. |
| products | Gudang (impor) | semua field master | Impor membuat produk baru; dedup by name/code. |
| products | Master-data (bulk edit, merge) | `costPrice`, `salePrice`, `categoryId`, `unitId`, `isActive`, `minStock` | Bulk edit bisa menimpa harga tanpa disadari user. |
| **suppliers** | Gudang (katalog), impor, master-data merge | `name`, `code`, `taxId`, `bank*`, `paymentTermDays` | Merge tidak memindahkan `party_credits.party_id` & `purchase_advances.supplierId` (WF-016). |
| **customers** | Gudang (katalog), POS (quick add), impor, pengaturan (hapus grup), master-data merge | `name`, `code`, `groupId`, `creditLimit`, `taxId` | POS membuat customer dengan kode acak; katalog/impor bisa membuat duplikat name (belum ada unique `taxId`/`email`). |
| **accounts** | Akuntansi (katalog), impor, COA migration, system-accounts, fixed-assets | `code`, `name`, `type`, `parentId`, `cashBankKind` | Banyak penulis; `account_mappings.account_id` **tanpa FK** → bisa menunjuk akun perusahaan lain (DATA-003). |
| **employees** | HR (karyawan), HR final-pay | `baseSalary`, `allowances`, `deductions`, `employmentStatus` | SSOT jelas (HR). Payroll hanya membaca. |
| **stock_on_hand** | Gudang (movement, adjustment, transfer, opname, receipt), POS (sale/void), supplier returns, reservasi (insert 0) | `qty` | SSOT jelas (inventory/POS domain). Terkunci `FOR UPDATE`; invariant Σ movements = on-hand **terverifikasi 0 mismatch**. |
| **stock_batches** | Gudang (batch engine), POS (sale/void) | `qty` | Invariant Σ batch = on-hand untuk produk `trackBatch` **terverifikasi 0 mismatch**. |
| **journal_entries/lines** | Semua modul lewat `postJournal` | semua field | **SSOT kuat**: satu gerbang, trigger balanced + immutable. |
| **cash_sessions / cash_movements** | POS (checkout, refund, void, tutup sesi), payments | `status`, `expectedCash`, `difference` | `payReceivable` tidak menulis `cashMovements` (POS-002); refund void memilih sesi tanpa `FOR UPDATE` (POS-010). |
| **party_payments** | POS (receivable), Akuntansi (payable), party credits | `amount`, `status`, `partyId`, `accountId` | `partyId`/`accountId` **tanpa FK**; void sale tidak memulihkan kredit (WF-006). |
| **sales** | POS (checkout, void, return), Akuntansi (receivable payment) | `paidTotal`, `paymentStatus`, `status` | `paidTotal` ditulis POS dan dihitung ulang oleh `voidReceivablePaymentAction` (POS-001). |
| **fiscal_periods** | Akuntansi (periode, tutup buku) | `status` | `closed→open` tanpa owner/alasan (WF-001). |
| **payroll_runs** | HR (run, pay, void) | `status`, `total*` | Tanpa maker-checker (WF-022). |

---

## 4. Daftar Temuan

Format: **ID — Judul** · Severity · Modul · Bukti · Dampak · Rekomendasi · Effort · Keyakinan.

### 4.1 UI/UX

> Bukti visual: `/tmp/opencode/shots/*.png` (23 tangkapan layar + 4 alur form). Semua tangkapan diambil dari build produksi yang mutakhir.

**UI-001 — Modal bersama tidak punya focus trap / fokus awal** · **Tinggi** · Global
Bukti: `src/components/blocks/modal.tsx:53-59` (hanya Escape), `:61-86` (`role="dialog" aria-modal="true"`, tanpa autoFocus/trap/restore).
Dampak: pengguna keyboard/screen-reader dapat Tab ke belakang dialog; fokus tidak pindah ke dialog saat terbuka.
Rekomendasi: tambah focus trap + fokus ke elemen pertama + restore focus; atau pakai Base UI `Dialog` seperti `quick-entry-modal`.
Effort: **M** · Keyakinan: **tinggi**

**UI-002 — ConfirmDialog men-fokuskan tombol konfirmasi bahkan untuk aksi bahaya** · Sedang · Global
Bukti: `src/components/blocks/confirm-dialog.tsx:63-66` (`else confirmRef.current?.focus()`).
Dampak: Enter langsung mengonfirmasi tindakan destruktif.
Rekomendasi: untuk dialog `danger`, fokus ke Batal/input alasan.
Effort: **S** · Keyakinan: **tinggi**

**UI-003 — Dialog POS Hold/Resume adalah overlay kustom tanpa focus trap/backdrop** · Sedang · POS
Bukti: `src/components/pos/terminal-dialogs.tsx:17` (`fixed inset-0 z-[70] ...`), Escape ditangani parent (`pos-terminal.tsx:622-635`).
Dampak: perilaku modal tidak konsisten; backdrop click tidak menutup.
Rekomendasi: pakai `Modal`/`ConfirmDialog` bersama.
Effort: **M** · Keyakinan: **tinggi**

**UI-004 — Tombol paginationprev/next tetap bisa difokuskan saat disabled** · Sedang · Global
Bukti: `src/components/blocks/pagination.tsx:53-58` (`aria-disabled` + `pointer-events-none` pada `Link`, tanpa `tabIndex={-1}`).
Dampak: keyboard user dapat mengaktifkan halaman "nonaktif".
Rekomendasi: render sebagai `span`/`aria-hidden` atau `tabIndex={-1}`.
Effort: **S** · Keyakinan: **tinggi**

**UI-005 — Nama aksesibilitas duplikat pada aksi baris keranjang** · Sedang · POS
Bukti: `src/components/pos/cart-panel.tsx:186` `aria-label="Hapus"`, `:235` `"Kurangi"`, `:256` `"Tambah"` — identik di setiap baris.
Dampak: screen reader tidak tahu produk mana yang dimaksud.
Rekomendasi: sertakan nama produk (`Hapus ${name}`).
Effort: **S** · Keyakinan: **tinggi**

**UI-006 — Pola tablist tanpa navigasi arrow-key** · Sedang · Akuntansi
Bukti: `src/components/akuntansi/quick-entry/kind-tabs.tsx:18` `role="tablist"`, `:23` `role="tab"`; tidak ada `aria-controls`/ArrowLeft/Right.
Dampak: pola ARIA diumumkan tapi berperilaku seperti button group.
Rekomendasi: implementasi tab pattern lengkap atau ganti jadi toggle biasa.
Effort: **M** · Keyakinan: **tinggi**

**UI-007 — Tidak ada penanda field wajib di seluruh form** · Sedang · Global
Bukti: pencarian `required=`/`aria-required` di `src/components/**/*.tsx` = 0; `product-form.tsx:203-213`, `partner-forms.tsx:179-180`.
Dampak: user tidak tahu field mana yang wajib sebelum submit.
Rekomendasi: tambah `required` di `Field` (bintang + `aria-required`).
Effort: **M** · Keyakinan: **tinggi**

**UI-008 — Pesan field wajib tidak menyebut field mana yang kosong** · Sedang · Global
Bukti: `product-form.tsx:125` `requireFilled(form.name, "Nama dan SKU wajib diisi.")`; `partner-forms.tsx:103`; `account-form.tsx:164`; `payroll-panel.tsx:108`; `gudang-cabang.tsx:50`. **Terbukti visual**: `/tmp/opencode/shots/flow-product-empty-submit.png` menampilkan toast "Nama dan SKU wajib diisi." padahal hanya Nama yang kosong.
Dampak: user menebak-nebak field yang harus diperbaiki.
Rekomendasi: pesan spesifik per field atau error inline.
Effort: **S** · Keyakinan: **tinggi**

**UI-009 — Error validasi hanya toast, tanpa error inline/fokus ke field** · Sedang · Global
Bukti: `src/components/use-action-runner.ts:30,:69` (`toast.error`); `receipt-form.tsx:260-301`; `supplier-return-form.tsx:173-203`.
Dampak: error transient & terlepas dari field; di form panjang mudah terlewat.
Rekomendasi: pasangkan toast dengan inline error + fokus/scroll ke field pertama.
Effort: **M** · Keyakinan: **tinggi**

**UI-010 — Aturan panjang-minimum tidak disebut di pesan** · Sedang · Akuntansi
Bukti: `account-form.tsx:163` (`length < 2` → "Kode dan nama akun wajib diisi."); `capital-form.tsx:48-49`; `payroll-panel.tsx:107`.
Dampak: user tidak tahu ada aturan panjang minimum.
Rekomendasi: sebutkan aturan ("minimal 2 karakter").
Effort: **S** · Keyakinan: **tinggi**

**UI-011 — PPN penerimaan memakai `input type=number` mentah, bukan `PercentInput`** · Sedang · Gudang
Bukti: `src/components/gudang/receipt-form.tsx:550-559` (`type="number" min="0" max="100" step="0.01"`).
Dampak: nilai `150` diterima kontrol, ditolak server; feedback tertunda.
Rekomendasi: pakai `PercentInput` + clamp di klien.
Effort: **S** · Keyakinan: **tinggi**

**UI-012 — Input angka mentah untuk hari/tahun/sort/padding** · Sedang · Pengaturan/Akuntansi
Bukti: `identitas-pajak.tsx:218-222,231,245,259`; `payroll-indonesia-form.tsx:633`; `metode-pembayaran.tsx:217`; `penomoran.tsx:124-132`.
Dampak: `Number("")` → 0; spinner/locale bervariasi; tanpa parse/clamp bersama.
Rekomendasi: pakai `QtyInput`/integer input bersama.
Effort: **M** · Keyakinan: **tinggi**

**UI-013 — Diskon keranjang POS mengonversi input invalid menjadi 0** · Sedang · POS
Bukti: `src/components/pos/cart-panel.tsx:337` (`Number(event.target.value) || 0`).
Dampak: input non-angka diam-diam menjadi 0; konsisten dengan MoneyInput di tempat lain.
Rekomendasi: pakai `MoneyInput`/`PercentInput`.
Effort: **S** · Keyakinan: **tinggi**

**UI-014 — Posting payroll tanpa dialog konfirmasi** · **Tinggi** · HR/Payroll
Bukti: `src/components/akuntansi/payroll-wizard.tsx:207` (`onNext` → `submit()`), `:170-187` langsung `runPayrollAction`; tidak ada `ConfirmDialog`.
Dampak: satu klik membuat run, memposting jurnal gaji, dan memotong kasbon — irreversibel tanpa void.
Rekomendasi: konfirmasi eksplisit dengan ringkasan dampak (periode, jumlah karyawan, total net).
Effort: **S** · Keyakinan: **tinggi**

**UI-015 — "Kosongkan" keranjang POS membersihkan semua tanpa konfirmasi** · Sedang · POS
Bukti: `src/components/pos/cart-panel.tsx:99` (`onClick={() => setCart([])}`).
Dampak: satu klik membuang semua baris (termasuk nomor seri & diskon).
Rekomendasi: `ConfirmDialog` atau undo toast.
Effort: **S** · Keyakinan: **tinggi**

**UI-016 — Hapus draf quick-entry tanpa konfirmasi** · Rendah · Akuntansi
Bukti: `src/components/akuntansi/quick-entry/draft-bar.tsx:56`; `quick-entry-modal.tsx:358-369`.
Dampak: draf terhapus permanen dengan satu klik.
Rekomendasi: `ConfirmDialog` kecil atau soft-delete.
Effort: **S** · Keyakinan: **tinggi**

**UI-017 — AccountForm menumpuk 20+ field dalam satu modal tanpa pengelompokan** · Sedang · Akuntansi
Bukti: `src/components/akuntansi/account-form.tsx:253-511` (satu `grid gap-2 sm:grid-cols-2`, tanpa `fieldset`).
Dampak: form panjang, sulit discan, salah input lebih tinggi.
Rekomendasi: kelompokkan (Identitas, Klasifikasi, Kas/Bank, PSAK 118, Status).
Effort: **M** · Keyakinan: **tinggi**

**UI-018 — SupplierReturnForm tidak punya aksi Batal/tutup** · Sedang · Gudang
Bukti: `src/components/gudang/supplier-return-form.tsx:345-363` hanya "Simpan sebagai Draf" & "Simpan & Posting".
Dampak: form panjang tidak bisa ditutup tanpa navigasi; data hilang senyap.
Rekomendasi: tambah aksi "Batal" dengan konfirmasi buang.
Effort: **S** · Keyakinan: **tinggi**

**UI-019 — Wizard payroll memungkinkan lanjut ke posting periode yang sudah diproses** · Sedang · HR
Bukti: `src/components/akuntansi/payroll-wizard.tsx:210` `nextDisabled` tidak mempertimbangkan `processedRun`; peringatan di `:224-239` tapi navigasi tetap aktif.
Dampak: user jalan 3 langkah lalu ditolak server.
Rekomendasi: nonaktifkan Next/Posting bila `processedRun` ada.
Effort: **S** · Keyakinan: **tinggi**

**UI-020 — Indikator langkah wizard tidak konsisten (WizardSteps vs StatusSteps)** · Sedang · Gudang/HR
Bukti: `opname-form.tsx:402`, `import-wizard.tsx:270` memakai `StatusSteps`; `wizard-steps.tsx` resmi hanya dipakai `payroll-wizard.tsx:202`.
Dampak: ukuran lingkaran, label, dan kata tombol navigasi berbeda antar wizard.
Rekomendasi: migrasi ke `WizardSteps`.
Effort: **M** · Keyakinan: **tinggi**

**UI-021 — Header tabel sticky tidak dipakai di tabel panjang** · Sedang · Global
Bukti: `globals.css:479-484` mendefinisikan `.sticky-head`, hanya 6 pemakaian; hilang di `payroll-wizard.tsx:274`, `line-editor.tsx:253-262`, daftar jurnal/produk.
Dampak: makna kolom hilang saat scroll; salah baca kolom numerik.
Rekomendasi: tambah `sticky-head` ke semua tabel dalam `max-h-* overflow-auto`.
Effort: **S** · Keyakinan: **tinggi**

**UI-022 — Pagination & ukuran halaman tidak konsisten** · Sedang · POS/Gudang
Bukti: `pos/riwayat/page.tsx:41` `pageSize: 25` vs `lib/pagination.ts:36` `LIST_PAGE_SIZE = 40`; import wizard memakai pager sendiri (`wizard-shell.tsx:226-244`).
Dampak: affordance & ukuran halaman berbeda antar layar.
Rekomendasi: pakai `LIST_PAGE_SIZE` seragam; tambah mode controlled di `Pagination`.
Effort: **M** · Keyakinan: **tinggi**

**UI-023 — Daftar Piutang & utang tidak berpaginasi** · Sedang · Akuntansi
Bukti: `src/app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx:82-91` memuat semua `listReceivables`/`listPayables`; tabel `:257-380` difilter klien, tanpa `Pagination`.
Dampak: kinerja menurun saat dokumen tumbuh.
Rekomendasi: paginasi server atau virtualize.
Effort: **M** · Keyakinan: **tinggi**

**UI-024 — Riwayat impor menampilkan status mentah & hilang saat kosong** · Sedang · Gudang
Bukti: `src/components/gudang/import/wizard-shell.tsx:288` `{job.status}`; `:261` `if (history.length === 0) return null;`.
Dampak: bahasa status tidak konsisten dengan `StatusBadge`; "tidak ada riwayat" vs "belum dimuat" tidak terbeda.
Rekomendasi: petakan ke label Indonesia + `StatusBadge`; `EmptyState` saat kosong.
Effort: **S** · Keyakinan: **tinggi**

**UI-025 — Tabel pengaturan tanpa empty state** · Rendah · Pengaturan
Bukti: `src/components/pengaturan/payroll-indonesia-form.tsx:598-621` (tabel upah minimum tanpa cabang kosong).
Dampak: perusahaan baru melihat tabel header-only tanpa panduan.
Rekomendasi: `EmptyState size="compact"` + petunjuk tambah.
Effort: **S** · Keyakinan: **sedang**

**UI-026 — Teks <11px masih dipakai luas; ukuran label KPI tidak sepakat** · Sedang · Global
Bukti: `summary-strip.tsx:47` `text-[10px]` vs `stat-card.tsx:46` `text-[12px]`; `piutang-utang/page.tsx:306` `text-[9px]`, `:54` `text-[10px]`; `pos/riwayat/page.tsx:165`; `opname-review-panel.tsx:66`; `cetak.tsx:257`.
Dampak: melanggar lantai 11px repo; keterbacaan menurun.
Rekomendasi: naikkan ke ≥11px; seragamkan KPI.
Effort: **M** · Keyakinan: **tinggi**

**UI-027 — Layer z-index dialog tidak konsisten** · Sedang · Global
Bukti: `ui/dialog.tsx:34/56` `z-50`; `terminal-dialogs.tsx:17/66` `z-[70]`; `modal.tsx:63` `z-[80]`; `confirm-dialog.tsx:86` `z-[90]`.
Dampak: stacking/fokus tidak konsisten; perubahan layer berisiko.
Rekomendasi: standarkan satu primitif dialog + satu skala z-index.
Effort: **M** · Keyakinan: **tinggi**

**UI-028 — Form login mengisi bawaan kata sandi demo & menampilkannya** · **Kritis** · Auth
Bukti: `src/components/auth/login-form.tsx:14-15` (`useState("owner@bisa.id")`, `useState("Bisa12345!")`); `src/app/login/page.tsx:92-97` mencetak kredensial di kotak "Akun demo". **Terbukti visual**: `/tmp/opencode/shots/gudang-produk.png` (tangkapan layar login) menampilkan `owner@bisa.id · Bisa12345!`.
Dampak: kata sandi terbuka di sumber klien & DOM; siapa pun dapat masuk sebagai owner bila seed demo aktif.
Rekomendasi: kosongkan field kata sandi; tampilkan kredensial hanya sebagai instruksi; nonaktifkan akun demo di luar lokal/dev.
Effort: **S** · Keyakinan: **tinggi**

**UI-029 — `formGateState` hanya dipakai 2 dari halaman berform dokumen** · Rendah · Gudang
Bukti: `form-gate.ts:21-27`; hanya `penerimaan/page.tsx:81` & `transfer/page.tsx:58`; `penyesuaian/page.tsx:105-121` mengulang logika manual.
Dampak: logika gate bisa drift.
Rekomendasi: terapkan konsisten di semua halaman berform dokumen.
Effort: **S** · Keyakinan: **tinggi**

**UI-030 — Halaman jurnal menggambar KPI sendiri, bukan `StatCard`** · Rendah · Akuntansi
Bukti: `src/app/app/akuntansi/(akuntansi)/jurnal/page.tsx:116-142` (grid KPI 4 sel, label `text-[10px]`) vs `StatCard`/`SummaryStrip` di `pos/riwayat/page.tsx:80-87`, `gudang/produk/page.tsx:162-195`.
Dampak: duplikasi markup KPI dengan spacing/label berbeda.
Rekomendasi: pakai `StatCard`.
Effort: **S** · Keyakinan: **tinggi**

### 4.2 Fungsional & Integritas POS

**POS-001 — `voidReceivablePaymentAction` menghitung ulang `paidTotal` hanya dari `party_payments`** · **Tinggi** · POS/Akuntansi
Bukti: `src/server/actions/pos.ts:643-660` (jumlah `partyPayments` non-void → `sales.paidTotal`); bandingkan `sales-persist.ts:74` (`paidTotal` = semua pembayaran non-credit termasuk tunai) dan `receivables.ts:365-372`. **Terbukti dengan tes reproduksi**: `tests/audit-repro/pos-paid-total-repro.test.ts` → `expected +0 to be 8000`.
Dampak: pembayaran tunai hilang dari `paidTotal`; `paymentStatus` salah; piutang naik palsu; limit kredit terlampaui.
Rekomendasi: hitung ulang dari `sale_payments` + `party_payments` non-void, atau kurangi hanya `payment.amount` dari `sale.paidTotal` (pola `voidSale`).
Effort: **M** · Keyakinan: **tinggi**

**POS-002 — Penerimaan piutang tunai tidak mencatat mutasi kas ke sesi laci** · **Tinggi** · POS
Bukti: `src/server/pos/receivables.ts:287-307` (insert `partyPayments` + `postJournal`, tanpa insert `cashMovements`); `sessions.ts:116-120` menghitung `expectedCash` dari `sum(cashMovements.amount)`; UI menawarkan akun kas (`payment-form.tsx:176`).
Dampak: uang tunai pelanggan tidak masuk mutasi sesi → `expectedCash` lebih rendah dari fisik → selisih kas lebih fiktif.
Rekomendasi: bila `accountId` kelas `cash`, wajibkan sesi kas terbuka milik aktor & catat `cashMovements`.
Effort: **M** · Keyakinan: **tinggi**

**POS-003 — Void/retur memulihkan stok dengan flag pelacakan produk SAAT INI** · **Tinggi** · POS/Gudang
Bukti: `src/server/pos/sales-stock.ts:21-32` (`trackStockFlags` membaca `products.trackStock` sekarang); `sales-void.ts:161-168` (`if (trackStock.get(line.productId) === false) continue;`); `returns.ts:243-244,410,556`. `sale_lines` tidak menyimpan snapshot flag (`db/schema/sales.ts:74-106`).
Dampak: jika `trackStock` dipatikan setelah penjualan, void/retur tidak memulihkan stok (stok permanen berkurang); sebaliknya stok menggelembung.
Rekomendasi: simpan snapshot `trackStock/trackBatch/trackSerial` di `sale_lines` saat checkout.
Effort: **L** · Keyakinan: **tinggi**

**POS-004 — Retur sebagian produk serial memulihkan serial yang salah** · **Tinggi** · POS
Bukti: `src/server/serials.ts:297-335` (`const targets = outMovements.slice(0, limit); ... if (!serial || serial.status !== "out") continue;`); dipanggil `returns.ts:557-571`. On-hand ditambah penuh, jumlah serial `in_stock` kurang.
Dampak: retur berulang mengambil gerakan `out` tertua yang sama; serial dilewati → `in_stock` ≠ on-hand; penjualan serial berikutnya gagal.
Rekomendasi: pilih hanya gerakan `out` yang serialnya masih `out` (join `stock_serials`) sebelum memotong `qty`.
Effort: **M** · Keyakinan: **tinggi**

**POS-005 — Void penjualan tidak mengembalikan alokasi reservasi** · **Tinggi** · POS/Gudang
Bukti: `sales-create.ts:84-112` (`consumeReservationForSale`); `sales-void.ts` tidak menyebut reservation; `sales` tidak punya kolom `reservation_id` (`db/schema/sales.ts:25-73`).
Dampak: reservasi yang dipenuhi penjualan lalu di-void tetap berkurang/`fulfilled`; janji stok hilang padahal stok fisik dipulihkan.
Rekomendasi: simpan `reservationId` di `sales` dan pulihkan atomik saat void.
Effort: **M** · Keyakinan: **tinggi**

**POS-006 — Cek harga snapshot offline tidak atomik terhadap posting** · **Tinggi** · POS offline
Bukti: `src/server/pos-offline.ts:343-372` (`quoteCart` di luar transaksi posting) lalu `:374-393` `createSale` mengutip ulang di transaksi lain; komentar `:339-341` mengklaim ketidaksesuaian tidak diposting senyap.
Dampak: perubahan harga/produk di antara dua kutipan bisa memposting total berbeda dari struk.
Rekomendasi: teruskan `expectedTotal` ke `createSale` dan bandingkan di transaksi yang sama.
Effort: **M** · Keyakinan: **tinggi**

**POS-007 — Penyelesaian offline melewati cek total bila snapshot harga tak lengkap** · **Tinggi** · POS offline
Bukti: `src/server/pos-offline.ts:623` (`hasFrozenPrices = item.lines.every(...)`), `:640`, `:644` (`if (hasFrozenPrices && !d(sale.total).eq(d(snapshotTotal))) throw`).
Dampak: satu baris tanpa `unitPrice` → cek total dilewati; penyelesaian memposting jumlah berbeda dari struk.
Rekomendasi: selalu bandingkan `sale.total` dengan `snapshotTotal` pada mode `settle`.
Effort: **S** · Keyakinan: **tinggi**

**POS-008 — Sinkronisasi offline menolak produk nonaktif, bertentangan dengan komentarnya** · **Tinggi** · POS offline
Bukti: `src/server/pos/quote.ts:595` (`if (!product.isActive) throw ...`); komentar `resolveQuotePackagings` `:481-486` menyatakan master nonaktif tetap dibaca.
Dampak: penjualan offline yang produknya dinonaktifkan setelah transaksi tidak dapat disinkronkan/diselesaikan; revenue/stok/kas hilang.
Rekomendasi: izinkan produk nonaktif pada jalur offline (pakai snapshot) atau sediakan resolusi peninjauan.
Effort: **M** · Keyakinan: **tinggi**

**POS-009 — Urutan kunci batch-vs-on-hand tidak konsisten → potensi deadlock** · Sedang · POS/Gudang
Bukti: `src/server/batches.ts:66-88` (on-hand → batch), `:257-268` (`creditBatchById` batch saja); `inventory/movements.ts:47-85` (on-hand → product); `sales-stock.ts:88-124` (batch → on-hand).
Dampak: penjualan & retur/void bersamaan pada produk+gudang yang sama bisa deadlock.
Rekomendasi: terapkan urutan kunci tunggal (on-hand → batch → product).
Effort: **M** · Keyakinan: **sedang**

**POS-010 — Refund tunai retur/void memilih sesi kas tanpa `FOR UPDATE`** · Sedang · POS
Bukti: `src/server/pos/returns-settlement.ts:316-334` (tanpa `.for("update")`); `sales-void.ts:312-322`; `sessions.ts:101-112` (`closeCashSession` mengunci sesi).
Dampak: mutasi refund bisa masuk ke sesi yang baru ditutup transaksi lain; `expectedCash`/selisih rusak.
Rekomendasi: kunci baris sesi `FOR UPDATE` saat memilih sesi refund.
Effort: **S** · Keyakinan: **tinggi**

**POS-011 — Potensi deadlock `voidSale` vs `voidReceivablePaymentAction`** · Sedang · POS
Bukti: `sales-void.ts:103-108` (kunci `sales` dulu) lalu `:275-278` update `partyPayments`; `actions/pos.ts:573-595` (kunci `partyPayments` dulu) lalu `sales`.
Dampak: void bersamaan pada penjualan yang sama bisa deadlock.
Rekomendasi: seragamkan urutan kunci.
Effort: **S** · Keyakinan: **sedang**

**POS-012 — `holdAction` menerima `idempotencyKey` tapi mengabaikannya** · Sedang · POS
Bukti: `src/server/actions/pos.ts:313-317` (skema punya `idempotencyKey`), `:324-334` (`holdSale` tanpa key); `sales-hold.ts:15-30` tidak punya parameter; klien `use-held-sales.ts:179,220` membuat UUID baru per klik.
Dampak: klik ganda/retry menghasilkan pesanan ditahan duplikat.
Rekomendasi: simpan `idempotencyKey` untuk hold & klaim pola `claimSaleIdempotency`; perbaiki klien.
Effort: **M** · Keyakinan: **tinggi**

**POS-013 — `cashDrawerMovement` memakai UUID acak sebagai idempotency key** · Sedang · POS
Bukti: `src/server/pos/sessions.ts:268` (`cash_movement:${crypto.randomUUID()}`); `actions/pos.ts:737-753` skema tidak menerima key.
Dampak: retry/klik ganda menciptakan dua mutasi + dua jurnal.
Rekomendasi: terima `idempotencyKey` klien & klaim di `idempotencyKeys`.
Effort: **M** · Keyakinan: **tinggi**

**POS-014 — Retur bernilai nol gagal di `postJournal`** · Sedang · POS
Bukti: `src/server/pos/returns.ts:666-675` selalu `postJournal`; `accounting.ts:344-348` menolak `< 2` baris bernilai; penjualan punya penjaga `hasNonZeroLine` (`sales-persist.ts:369-373`), retur tidak.
Dampak: retur barang harga jual 0 & biaya 0 membuat transaksi rollback; retur tidak bisa dicatat.
Rekomendasi: lewati `postJournal` bila semua kaki nol.
Effort: **S** · Keyakinan: **sedang**

**POS-015 — Jurnal retur selalu memakai `map.sales_discount`, abaikan akun diskon kelompok** · Sedang · POS
Bukti: `src/server/pos/returns.ts:657` (`{ accountId: map.sales_discount, credit: discountPortion }`); penjualan memakai `quote.discountAccountId ?? map.sales_discount` (`sales-persist.ts:345`); `discountAccountId` tidak disimpan di `sales`/`sale_lines`.
Dampak: laporan diskon per akun & GL tidak seimbang per akun.
Rekomendasi: simpan `discountAccountId` di `sales` dan pakai di jurnal retur.
Effort: **M** · Keyakinan: **tinggi**

**POS-016 — Void penjualan non-tunai tidak mencatat refund/outflow** · Sedang · POS
Bukti: `src/server/pos/sales-void.ts:301-354` hanya menghitung refund untuk `methodType === "cash"`; `reverseSourceJournal` membalik seluruh jurnal (termasuk QRIS/bank) tanpa mutasi keluar.
Dampak: saldo bank/QRIS GL berkurang tanpa dokumen arus keluar; potensi double-count.
Rekomendasi: larang void tender non-tunai, atau catat refund transfer bank eksplisit.
Effort: **M** · Keyakinan: **sedang**

**POS-017 — Dua checkout bersamaan dengan `reservationId` sama bisa sama-sama diposting** · Sedang · POS
Bukti: `src/server/pos/quote.ts:430-446` (`getConsumableReservation` tanpa `.for("update")`); konsumsi baru dikunci di `sales-create.ts:84-97`.
Dampak: janji stok pelanggan dilanggar.
Rekomendasi: kunci baris reservasi `FOR UPDATE` saat baca & validasi ulang.
Effort: **M** · Keyakinan: **tinggi**

**POS-018 — Unique index `idempotency_keys` tidak mencakup `scope`** · Rendah · POS
Bukti: `db/schema/platform.ts:295` (`uniqueIndex.on(companyId, key)`); `sales-create.ts:179-195` & `receivables.ts:90-101` memakai scope berbeda dengan key yang sama.
Dampak: klaim scope kedua gagal → `CONFLICT` permanen untuk key itu.
Rekomendasi: tambah `scope` ke unique index & `onConflict` target.
Effort: **S** · Keyakinan: **tinggi**

**POS-019 — API perangkat offline tidak memeriksa izin `pos.sell` aktor** · Sedang · POS
Bukti: `src/server/pos-device.ts:733-759` (`syncPosDeviceItems` hanya `assertOfflineEnabled`); `pos-offline.ts:285-299` pengecekan hak hanya `if (item.cashierId && input.originEntitlements)`; web action memakai `requirePermissionInModule("pos.sell","pos")`.
Dampak: perangkat anggota tanpa `pos.sell`仍 dapat menyinkronkan penjualan (terutama muatan warisa tanpa `cashierId`).
Rekomendasi: terapkan gerbang `pos.sell` pada `syncPosDeviceItems`.
Effort: **M** · Keyakinan: **sedang**

**POS-020 — Quote lokal offline menduplikasi rumus quote server** · Rendah · POS offline
Bukti: `src/lib/pos/pos-offline.ts:360-495` menduplikasi `cashRoundingForMode`, `lineDiscount`, `lineTax`, `roundTo`/`roundTotal`; padanannya `src/server/pos/quote.ts:170-253,569-768`.
Dampak: aturan harga/pembulatan harus diubah dua kali; bila berbeda, item offline masuk peninjauan harga massal.
Rekomendasi: ekstrak inti perhitungan ke modul bersama + tes parity.
Effort: **L** · Keyakinan: **tinggi**

**POS-021 — `createReturnAction` tidak memvalidasi konsistensi `type` vs `refundMethod`** · Rendah · POS
Bukti: `src/server/actions/pos.ts:454-473` (kombinasi bebas `return|exchange` × `cash|transfer|store_credit|exchange`); `returns.ts` tidak memakai `type` untuk akun/penyelesaian.
Dampak: statistik tukar barang vs retur biasa tidak dapat dipercaya.
Rekomendasi: tambah refinasi Zod.
Effort: **S** · Keyakinan: **tinggi**

**POS-022 — Void refund tunai tanpa sesi terbuka membiarkan laci tidak konsisten** · Sedang · POS
Bukti: `src/server/pos/sales-void.ts:323-354` (bila tak ada sesi, `refundSessionId` null & tanpa mutasi; audit `refundSessionNote`); `cashMovements` asal tetap berisi masukkan tunai penjualan.
Dampak: saldo laci ≠ GL kas; selisih tutup sesih berikutnya tidak terjelaskan.
Rekomendasi: wajibkan sesi kas terbuka untuk void tunai, atau catat penyesuaian laci eksplisit.
Effort: **M** · Keyakinan: **tinggi**

### 4.3 Workflow, Approval & Penghapusan

**WF-001 — Periode `closed` dapat dibuka kembali oleh `accounting.manage` tanpa alasan/owner** · **Tinggi** · Akuntansi
Bukti: `src/server/actions/accounting/periode.ts:74-88` (hanya `locked → non-locked` yang memakai cabang `unlocking`); transisi `closed → open` cukup `requirePermissionInModule("accounting.manage")` (`:36`) lalu update `:90-104`.
Dampak: periode tertutup bisa dibuka admin/akuntan, lalu dokumen backdated dimasukkan; integritas penutupan hilang (audit hanya `period.open` tanpa alasan).
Rekomendasi: wajibkan alasan + owner (atau dual-control) untuk `closed → open`; catat `previousStatus` + `reason`.
Effort: **S** · Keyakinan: **tinggi**

**WF-002 — Tutup buku tahunan tidak mensyaratkan periode ditutup/dikunci** · **Tinggi** · Akuntansi
Bukti: `src/server/year-end-closing.ts:183-189` hanya menolak bila sudah ada jurnal penutup aktif; `postJournal` (`accounting.ts:260-268`) mem-posting jurnal `year_end_closing` tanpa memeriksa 12 periode; `lockYearPeriods` aksi terpisah (`actions/accounting/periode.ts:205-217`).
Dampak: buku tahunan bisa "ditutup" sementara masih ada bulan terbuka; penyesuaian setelahnya membuat saldo pendapatan-beban tidak nol.
Rekomendasi: `postYearEndClosing` menolak bila ada periode tahun itu yang belum `closed`/`locked`.
Effort: **M** · Keyakinan: **tinggi**

**WF-003 — Persetujuan cuti tanpa maker-checker** · **Tinggi** · HR
Bukti: `src/server/hr/leave.ts:289-297` (hanya memeriksa `status === "pending"`; tidak ada `createdBy === userId`); aksi `actions/hr/cuti-lembur.ts:274-311` hanya `payroll.manage`.
Dampak: pemegang `payroll.manage` dapat mengajukan cuti untuk diri sendiri lalu menyetujuinya.
Rekomendasi: tambah `request.createdBy !== userId` di domain.
Effort: **S** · Keyakinan: **tinggi**

**WF-004 — Persetujuan lembur tanpa maker-checker** · **Tinggi** · HR
Bukti: `src/server/hr/overtime.ts:76-94` (update langsung dengan predicate `status = "pending"`, tanpa banding `createdBy`).
Dampak: lembur diajukan & disahkan user yang sama; memengaruhi payroll.
Rekomendasi: terapkan maker-checker.
Effort: **S** · Keyakinan: **tinggi**

**WF-005 — Cuti/lembur yang disetujui tidak dapat dibatalkan** · Sedang · HR
Bukti: `leave.ts:316-356` (approved menulis absensi `leave`); tidak ada aksi void untuk `leaveRequests`/`overtimeRequests`; status terminal hanya `approved`/`rejected` (`db/schema/hr.ts:325,239`).
Dampak: persetujuan salah permanen; saldo cuti & lembur terus terpakai.
Rekomendasi: sediakan void ber-alasan dengan pemulihan saldo & absensi.
Effort: **L** · Keyakinan: **tinggi**

**WF-006 — Void penjualan dengan pembayaran bersumber kredit pihak tidak mengembalikan `used_amount`** · **Tinggi** · POS/Akuntansi
Bukti: `src/server/pos/sales-void.ts:226-282` (`reverseVoidedSaleReceivables`) hanya membalik jurnal & `partyPayments.status = "void"` (`:277`); tidak ada `restorePartyCreditUsage`/`voidOriginPartyCredit`. Bandingkan jalur yang benar di `src/server/actions/pos.ts:632-640`. `restoreVoidedSaleCredit` (`sales-void.ts:365-410`) hanya menangani `sale_returns.creditUsed`, bukan `party_credits.used_amount`.
Dampak: penjualan yang dilunasi `partyCredits` di-void → jurnal baik, tetapi `party_credits.used_amount` tetap naik/`settled`; kredit pelanggan hilang; subledger ≠ GL.
Rekomendasi: panggil `restorePartyCreditUsage` di `reverseVoidedSaleReceivables`.
Effort: **M** · Keyakinan: **tinggi**

**WF-007 — `postStockAdjustment` tidak memeriksa status dokumen** · Sedang · Gudang
Bukti: `src/server/inventory/adjustments-post.ts:42-59` (hanya memuat dokumen + memeriksa `warehouseId`; tidak ada guard status). Pemanggil saat ini: `adjustments.ts:129` (draft transient) & `approveStockAdjustment` (pending).
Dampak: pemanggil baru/refaktor pada dokumen `posted` dapat double-posting.
Rekomendasi: tambah guard status di domain.
Effort: **S** · Keyakinan: **tinggi** (kode), **rendah** (eksploitabilitas saat ini)

**WF-008 — Retur penjualan lahir `posted`, tanpa jalur void; retur posted memblokir void penjualan** · Sedang · POS
Bukti: `src/server/pos/returns.ts:469-510` (`insertSaleReturnDocument` set `status: "posted"`); tidak ada update `saleReturns` ke `void`; `sales-void.ts:124-143` menolak void bila ada retur posted.
Dampak: retur salah tidak dapat di-void; penjualan asal jadi tidak bisa di-void (dead-end).
Rekomendasi: sediakan void retur posted (pemulihan stok + pembalikan jurnal + pelepasan kredit).
Effort: **L** · Keyakinan: **tinggi**

**WF-009 — `holdAction` menerima `idempotencyKey` tapi mengabaikannya** · Sedang · POS
Bukti: `src/server/actions/pos.ts:313-338`; `holdSale` (`pos/sales-hold.ts:15-31`) tidak punya parameter.
Dampak: klik ganda/retry menghasilkan dua pesanan ditahan identik.
Rekomendasi: simpan key & klaim, atau hapus field dari skema.
Effort: **M** · Keyakinan: **tinggi**

**WF-010 — `createReturnAction` tanpa idempotency** · Sedang · POS
Bukti: `src/server/actions/pos.ts:445-490`; `saleReturns` tidak punya kolom idempotency (`db/schema/sales.ts:128-154`).
Dampak: retry/klik ganda membuat dokumen retur kedua.
Rekomendasi: tambah `idempotencyKey` + unique index.
Effort: **M** · Keyakinan: **tinggi**

**WF-011 — `cashDrawerMovement` memakai UUID acak sebagai idempotency key** · Sedang · POS
Bukti: `src/server/pos/sessions.ts:261-268` (`cash_movement:${crypto.randomUUID()}`).
Dampak: idempotensi non-efektif; retry menggandakan mutasi & jurnal.
Rekomendasi: terima key klien.
Effort: **M** · Keyakinan: **tinggi**

**WF-012 — `submitOvertimeRequest` tanpa penjaga duplikat** · Sedang · HR
Bukti: `src/server/hr/overtime.ts:32-64` (tanpa pemeriksaan tumpang tindih; bandingkan `submitLeaveRequest` dengan `overlapping` di `leave.ts:228-243`).
Dampak: lembur sama dapat diajukan berkali kali & semuanya di-approve → upah lembur digandakan.
Rekomendasi: tolak duplikat per (employee, date, dayType) atau unique index parsial.
Effort: **S** · Keyakinan: **tinggi**

**WF-013 — `createOpeningBalance` tanpa idempotency** · Sedang · Akuntansi
Bukti: `src/server/opening-balances/documents.ts:136-149` (input tidak punya key; jurnal memakai `opening:${docId}` `:196` yang hanya unik setelah dokumen dibuat).
Dampak: klik ganda membuat dua dokumen saldo awal + dua jurnal pembuka.
Rekomendasi: terima kunci idempotensi klien.
Effort: **M** · Keyakinan: **tinggi**

**WF-014 — `createPurchaseOrder` & `createPurchaseRequest` tanpa idempotency** · Rendah · Gudang
Bukti: `src/server/purchasing.ts:99-121`, `src/server/purchase-requests.ts:51-62`; `purchaseOrders`/`purchaseRequests` tidak punya kolom idempotency.
Dampak: retry membuat PO/PR duplikat (komitmen ganda).
Rekomendasi: tambah `idempotencyKey` + unique index.
Effort: **M** · Keyakinan: **tinggi**

**WF-015 — `registerFixedAsset` tanpa idempotency** · Rendah · Akuntansi
Bukti: `src/server/fixed-assets.ts:214`; aksi `actions/fixed-assets.ts:72-101`.
Dampak: klik ganda mendaftarkan aset dua kali (dua nomor, dua jurnal).
Rekomendasi: tambah idempotency key dari form.
Effort: **S** · Keyakinan: **tinggi**

**WF-016 — Merge pihak tidak memetakan `party_credits.party_id` & `purchase_advances.supplierId`** · Sedang · Master data
Bukti: `src/server/master-data/merge.ts:53-67` (daftar referensi tidak memuat `partyCredits`/`purchaseAdvances`; pemetaan ulang `:268-336`).
Dampak: kredit pihak & uang muka tetap menunjuk pihak duplikat nonaktif; kredit/DP "nyangkut".
Rekomendasi: tambahkan `partyCredits` & `purchaseAdvances` ke referensi merge.
Effort: **M** · Keyakinan: **tinggi**

**WF-017 — `deleteSupplier`/`deleteCustomer` tidak memeriksa `partyOpeningBalances` & `partyPayments`** · Sedang · Master data
Bukti: `src/server/actions/inventory/pihak.ts:323-380` (supplier: hanya `stockReceipts`, `stockDocuments`, `products`); `:407-444` (customer: hanya `sales`); `partyOpeningBalances.partyId` & `partyPayments.partyId` **tanpa FK** (`db/schema/accounting.ts:530-554,464-521`).
Dampak: pemasok/pelanggan dengan saldo awal/pembayaran dapat dihapus → `party_id` yatim.
Rekomendasi: tambah pemeriksaan (dan idealnya FK).
Effort: **M** · Keyakinan: **tinggi**

**WF-018 — `deleteWarehouseAction` pemeriksaannya tidak lengkap** · Rendah · Pengaturan
Bukti: `src/server/actions/settings/lokasi.ts:125-174` tidak memeriksa `stockDocuments.toWarehouseId`, `stockBatches.warehouseId`, `stockSerials.warehouseId`, `supplierReturns.warehouseId`.
Dampak: FK RESTRICT menolak dengan error DB mentah, bukan pesan domain; UX buruk.
Rekomendasi: lengkapi pemeriksaan.
Effort: **S** · Keyakinan: **sedang**

**WF-019 — `deleteProductAction` pemeriksaannya tidak lengkap** · Rendah · Gudang
Bukti: `src/server/actions/inventory/produk.ts:323-377` tidak memeriksa `purchaseOrderLines`, `purchaseRequestLines`, `supplierReturnLines`, `saleReturnLines`, `stockBatches`, `stockSerials`, `stockReservations`.
Dampak: produk yang hanya ada di draft PO/PR mengembalikan error teknis, bukan pesan "masih dipakai".
Rekomendasi: tambah pemeriksaan referensi tersisa.
Effort: **S** · Keyakinan: **sedang**

**WF-020 — `voidFixedAssetDepreciationRun`: alasan opsional, tidak teraudit di domain, periode tertutup memblokir** · Sedang · Akuntansi
Bukti: `src/server/fixed-assets.ts:508-538` (`reason?: string | null` opsional; tidak ada `writeAudit` di domain; pembalik memakai `date: periodEnd(run.period)` `:523` → `assertPeriodOpen` menolak bila periode ditutup). Aksi `actions/fixed-assets.ts:131-155` menulis audit tanpa `reason`.
Dampak: (a) pembatalan penyusutan tidak terdokumentasi alasannya; (b) kesalahan penyusutan tidak bisa dibatalkan setelah periode tertutup.
Rekomendasi: wajibkan `reason`; pertimbangkan reversal bertanggal hari ini.
Effort: **M** · Keyakinan: **tinggi**

**WF-021 — Retur pemasok tanpa gerbang persetujuan/maker-checker** · Sedang · Gudang
Bukti: `src/server/supplier-returns/posting.ts:305-316` (langsung memposting; hanya syarat `inventory.manage` di `actions/supplier-returns.ts:152-166`).
Dampak: satu pemegang `inventory.manage` dapat membuat & memposting retur bernilai besar tanpa pengawasan.
Rekomendasi: terapkan maker-checker/ambang persetujuan.
Effort: **M** · Keyakinan: **tinggi**

**WF-022 — Payroll run & pembayaran gaji tanpa maker-checker** · Sedang · HR
Bukti: `src/server/hr/payroll-runs.ts:24-66` (`payPayrollRun`), `actions/hr/payroll.ts:634-659`; `runPayrollAction` (`:71-633`) tanpa pemisahan peran; void (`payroll-runs.ts:68-160`) juga.
Dampak: satu user dapat menjalankan, membayar, & membatalkan payroll.
Rekomendasi: tambah pemisahan peran (run vs pay vs void).
Effort: **L** · Keyakinan: **tinggi**

**WF-023 — Transfer dua tahap: pengirim dapat menerima sendiri** · Sedang · Gudang
Bukti: `src/server/inventory/transfers-receive.ts:63-75` (hanya memeriksa `type === "transfer"` & `status === "in_transit"`; tidak ada `createdBy !== userId`).
Dampak: pemisahan tahap pengiriman/penerimaan tidak berarti.
Rekomendasi: tolak penerimaan oleh pembuat dokumen.
Effort: **S** · Keyakinan: **tinggi**

**WF-024 — Aset tetap: perolehan & pelepasan tanpa gerbang persetujuan** · Rendah · Akuntansi
Bukti: `src/server/fixed-assets.ts:214` (`registerFixedAsset`), `:550-617` (`disposeFixedAsset`); aksi hanya `accounting.manage`.
Dampak: pencatatan/pelepasan aset tanpa persetujuan.
Rekomendasi: tambah persetujuan untuk pelepasan di atas ambang.
Effort: **M** · Keyakinan: **tinggi**

**WF-025 — Tugas opname tetap `done` merujuk dokumen yang di-void** · Rendah · Gudang
Bukti: `src/server/inventory/opname-tasks.ts:198` (`status: "done"`, `documentId`); `voidStockDocument` (`src/server/inventory/documents.ts:266-269`) tidak menutup/merevisi `opname_tasks`.
Dampak: riwayat penugasan menunjuk dokumen batal.
Rekomendasi: set ulang tugas terkait ke `open`/`cancelled` saat void opname.
Effort: **S** · Keyakinan: **tinggi**

**WF-026 — `createReservation` tanpa idempotency** · Rendah · Gudang
Bukti: `src/server/reservations.ts:66-164` (tidak ada key; hanya penjaga ketersediaan di bawah kunci baris `:104-132`).
Dampak: retry/klik ganda membuat dua reservasi.
Rekomendasi: terima kunci idempotensi klien.
Effort: **S** · Keyakinan: **tinggi**

**WF-027 — `journal_entries.sourceId`/`sourceType` & `stock_movements.referenceId` tanpa FK** · Rendah · Akuntansi/Gudang
Bukti: `db/schema/accounting.ts:109-113`, `db/schema/inventory.ts:104-106`, `db/schema/sales.ts:133` (`saleReturns.saleId` tanpa `.references`).
Dampak: tidak ada penegak integritas dokumen→jurnal/gerakan; orphans hanya terdeteksi laporan rekonsiliasi.
Rekomendasi: tambah FK/trigger, atau rekonsiliasi berkala.
Effort: **L** · Keyakinan: **tinggi**

**WF-028 — Transisi `open → locked` langsung (melewati `closed`)** · Rendah · Akuntansi
Bukti: `src/server/actions/accounting/periode.ts:74` (hanya `locked → non-locked` yang diatur ketat); update `:90-104` menerima semua status.
Dampak: admin dapat melompati status `closed`.
Rekomendasi: pertahankan, atau wajibkan `closed` dulu sebelum `locked`.
Effort: **S** · Keyakinan: **tinggi**

**WF-029 — Void dokumen tidak memeriksa periode dokumen asal (reversal masuk periode hari ini)** · Rendah · Semua modul
Bukti: `voidSale` (`sales-void.ts:23-30`), `voidReceipt` (`receipt-void.ts:273-288`), `voidSupplierReturn` (`posting.ts:651-666`), `voidPayablePayment` (`payables.ts:568-574`), `voidPayrollRun` (`payroll-runs.ts:115-122`); pengecualian `fixed-assets.ts:523` memakai `periodEnd(run.period)`.
Dampak: koreksi atas periode tertutup tidak mengubah laporan periode tertutup (bagus), tapi efek pembalik jatuh ke periode berjalan dan mendistorsi laba rugi berjalan.
Rekomendasi: dokumentasikan kebijakan; pertimbangkan penanda "reversal of closed period".
Effort: **M** · Keyakinan: **tinggi**

### 4.4 Integritas Data & Kepemilikan Field

**DATA-001 — `products.costPrice` punya dua pemilik: formulir katalog & mesin AVCO** · **Tinggi** · Gudang
Bukti: formulir mengirim `costPrice` (`src/server/actions/inventory/produk.ts:187-205`, field `product-form.tsx:251-260` "Harga beli (HPP)"); mesin AVCO menulis `products.costPrice` di `src/server/inventory/movements.ts:168` & `receipt-prices.ts` (komentar: "harga pokok sudah otomatis menjadi moving average lewat pergerakan stok"). `product-form.tsx` tidak menampilkan petunjuk bahwa field ini diturunkan sistem.
Dampak: edit manual akan ditimpa blend AVCO berikutnya; sebaliknya edit manual mendistorsi AVCO/COGS & GL persediaan.
Rekomendasi: pisahkan "harga pokok sistem (AVCO)" dari "harga beli manual"; nonaktifkan/readonly field AVCO di form, atau tampilkan penanda "dihitung otomatis".
Effort: **M** · Keyakinan: **tinggi**

**DATA-002 — `products.salePrice` ditulis formulir katalog & baris penerimaan pembelian** · **Tinggi** · Gudang
Bukti: `src/server/inventory/receipt-prices.ts:30` (`applyReceiptSalePrices` update `products.salePrice` untuk sumber `purchase` bila baris membawa harga jual); `line-editor.tsx:486-500` menampilkan input "Harga jual" tanpa peringatan; `receipt-form.tsx:353` mengirim `salePrice`.
Dampak: posting penerimaan diam-diam menimpa harga jual master; konflik dengan harga kelompok & riwayat harga.
Rekomendasi: jadikan eksplisit (checkbox "perbarui harga jual master") dan catatan audit before/after.
Effort: **M** · Keyakinan: **tinggi**

**DATA-003 — Reference akun kunci tanpa FK** · **Tinggi** · Akuntansi/Gudang/HR
Bukti (skema & DB `pg_constraint`): `account_mappings.account_id` (`db/schema/accounting.ts:77-87`) tanpa FK; `expenses.expense_account_id` (`:193-240`); `party_payments.account_id` (`:464-521`); `bank_transfers.from_account_id`/`to_account_id` (`:241-267`); `employee_advances.account_id` (`db/schema/hr.ts:337-363`); `employee_loans.account_id` (`:406-430`); `customer_groups.discount_account_id` (`db/schema/catalog.ts:26-46`). Validasi aplikasi ada di `saveMappingAction` (`actions/accounting/akun-pemetaan.ts:649+`) & `postJournal` (`accounting.ts:363-403`), tetapi DB tidak menegakkan.
Dampak: referensi yatim lintas-tenant mungkin lewat jalur impor/tulis langsung; salah pemetaan → jurnal mendarat di akun salah.
Rekomendasi: tambah FK (setidaknya untuk `account_mappings`, `expenses`, `party_payments`, `bank_transfers`) setelah membersihkan data lama.
Effort: **L** · Keyakinan: **tinggi**

**DATA-004 — Reference dokumen kunci tanpa FK** · Sedang · Semua modul
Bukti: `sales.warehouse_id` (`db/schema/sales.ts:31`, `notNull` tanpa `.references`), `sale_lines.product_id` (`:82`), `sale_payments.method_id` (`:115`), `sale_returns.sale_id` (`:133`), `sale_return_lines.product_id` (`:163`), `cash_sessions.user_id` (`:190`), `cash_movements.session_id` (`:220`), `supplier_return_allocations.receipt_id` (`db/schema/inventory.ts:465`). Query orphan di DB demo: 0 (data masih bersih) — tetapi DB tidak mencegah.
Dampak: orphan bisa lahir lewat impor/tulis langsung; laporan jadi tidak konsisten.
Rekomendasi: tambah FK bertahap (product/warehouse/method/session) dengan `ON DELETE RESTRICT`.
Effort: **L** · Keyakinan: **tinggi**

**DATA-005 — `party_opening_balances.party_id` & `party_credits.party_id` tanpa FK** · Sedang · Akuntansi/Master data
Bukti: `db/schema/accounting.ts:530-554`, `:578-607`; `merge.ts:53-67` tidak memetakan `partyCredits`; `pihak.ts:323-444` tidak memeriksa `partyOpeningBalances`/`partyPayments` sebelum hapus.
Dampak: kredit/saldo awal bisa menunjuk pihak yatim; merge menambahkannya.
Rekomendasi: tambah FK + lengkapi merge & guard hapus.
Effort: **M** · Keyakinan: **tinggi**

**DATA-006 — Database demo tercemar transaksi tes yang di-commit** · Sedang · Semua modul
Bukti (tangkapan layar & query): dashboard gudang menampilkan "Produk SKU-P18-GERAK" dengan SKU `SKU-P18-GERAK-TERHAPUS-01a1c5a0` dan dokumen "Tanpa dokumen asal"; daftar jurnal mengandung "Uji AK-P1-04 ...", "uji-void-import.csv", "Uji B4 — saldo awal akun bertransaksi", "Void penjualan INV-2026-00033"; 16 gerakan `adjustment` & 16 `opening` dengan `reference_type`/`reason`/`created_by` NULL. Audit log: `import.complete` 368 baris, `settings.modules.update` 48, dst.
Dampak: laporan & konsistensi DB demo tidak mencerminkan keadaan produksi; audit/QA salah membaca.
Rekomendasi: pisahkan DB tes dari demo; jalankan `BISA_E2E_RESEED=1` sebelum gate; bersihkan fixture tes yang commit.
Effort: **M** · Keyakinan: **tinggi**

**DATA-007 — Saldo bank/kas negatif diperbolehkan dengan kebijakan bawaan "warn"** · Sedang · Akuntansi/POS
Bukti: `company_settings.cash_negative_policy` bawaan `"warn"` (`db/schema/platform.ts:219-228`); dashboard demo menampilkan "Kas, bank & QRIS **-Rp 897.508.430**" (`/tmp/opencode/shots/beranda.png`); akun 11010201 buku besar −11.100.
Dampak: saldo negatif terbentuk senyap; laporan kas menyesatkan; void/reversal bisa terhalang.
Rekomendasi: pertimbangkan bawaan `block` untuk lingkungan produksi; tampilkan peringatan keras di UI.
Effort: **S** · Keyakinan: **tinggi**

**DATA-008 — 16 gerakan stok `adjustment` tanpa dokumen sumber** · Sedang · Gudang
Bukti: query `select movement_type, count(*), sum(qty) ... where reference_type is null` → `adjustment` 16 baris (−80) & `opening` 16 baris (+80), semua `reason`/`reference_number`/`created_by` NULL; `stock_documents` = 0 baris.
Dampak: jejak audit stok putus; tidak bisa ditelusuri dokumen mana yang menggerakkan stok.
Rekomendasi: dokumentasikan asal data (seed/impor) dan pastikan jalur produksi selalu menulis `reference_type`/`reference_id`.
Effort: **S** · Keyakinan: **sedang** (data demo), **tinggi** (pola)

**DATA-009 — 17 produk dijual di bawah harga pokok** · Rendang-Rendah · Gudang
Bukti: query `select count(*) from products where sale_price < cost_price` → 16 (demo); UI "Margin negatif 17" (`/tmp/opencode/shots/gudang-produk.png`).
Dampak: margin negatif mengindikasikan data harga tidak terjaga.
Rekomendasi: tampilkan peringatan di form produk & daftar; tidak memblokir.
Effort: **S** · Keyakinan: **tinggi**

**DATA-010 — Tabel `outbox` tidak dipakai** · Rendah · Platform
Bukti: `db/schema/platform.ts:315-326` (komentar menyatakan sengaja dipertahankan tanpa pemakai runtime); tidak ada insert/select di `src/`.
Dampak: skema mati; menyesatkan developer.
Rekomendasi: hapus atau tandai sebagai cadangan arsitektur.
Effort: **S** · Keyakinan: **tinggi**

**DATA-011 — Tidak ada CHECK constraint untuk qty/status/total** · Sedang · Semua modul
Bukti: `pg_constraint` hanya memuat 2 domain check (`cardinal_number_domain_check`, `yes_or_no_check`); `stock_on_hand.qty` bisa negatif di level DB (penjaga hanya di `movements.ts:72`); `status` bebas teks.
Dampak: integritas bergantung penuh pada aplikasi; jalur impor/SQL langsung bisa melanggar.
Rekomendasi: tambah `CHECK (qty >= 0)` (atau sesuai `allow_negative_stock`), `CHECK (status IN (...))` per tabel, `CHECK (total >= 0)`.
Effort: **L** · Keyakinan: **tinggi**

**DATA-012 — 33 baris `stock_on_hand` bernilai nol** · Rendah · Gudang
Bukti: query count `qty = 0` → 33.
Dampak: pertumbuhan tabel; bukan cacat fungsional.
Rekomendasi: pembersihan berkala (opsional).
Effort: **S** · Keyakinan: **tinggi**

### 4.5 Arsitektur & Kualitas Kode

**ARCH-001 — Repo bukan git repository** · Rendah · Proses
Bukti: `git status` → `fatal: not a git repository`.
Dampak: tidak ada riwayat perubahan/blame; audit tidak bisa menelusuri kapan bug masuk.
Rekomendasi: `git init` + commit baseline; aktifkan CI (CBS-A7 lama).
Effort: **S** · Keyakinan: **tinggi**

**ARCH-002 — 1 tes gagal dari 2207** · Sedang · Kualitas
Bukti: `pnpm test` → `tests/integration/review-fixes-t4rb.test.ts` gagal: `expected false to be true` di `:252` (`expect(d(afterFuture.unreconciledTotal).gte(0)).toBe(true)`). Tes dijalankan ulang terisolasi → tetap gagal.
Dampak: gate suite merah; assertion mengasumsikan saldo bank non-negatif, padahal fixture demo punya saldo −11.100 (DATA-007). Perilaku produk benar (federal journal masa depan tidak mengubah ringkasan, terbukti `:250-251` lulus).
Rekomendasi: perbaiki assertion tes (mis. `toBeGreaterThanOrEqual(before.unreconciledTotal)` atau pakai akun dengan saldo non-negatif); jangan mengubah kode produk.
Effort: **S** · Keyakinan: **tinggi**

**ARCH-003 — Warning lint 19 (unused vars, hook deps)** · Rendah · Kualitas
Bukti: `pnpm lint` → 19 warning, 0 error. Contoh: `pos-terminal.tsx:357` (useCallback missing dep `setSearch`), `use-cart-persistence.ts:164` (useEffect missing deps), `use-held-sales.ts:104,121,161`, `use-quote.ts:181`.
Dampak: potensi bug tutup-ubah (stale closure) & utang kualitas.
Rekomendasi: betulkan deps hook; hapus import tak terpakai.
Effort: **M** · Keyakinan: **tinggi**

**ARCH-004 — E2E suite tidak dijalankan** · Sedang · Proses
Bukti: `playwright.config.ts:35-46` memakai `webServer` dengan `reuseExistingServer: false`; server audit sudah menempati port 3000, dan `BISA_E2E_RESEED=1` akan menghapus data demo yang tercemar (DATA-006).
Dampak: gate UI e2e (termasuk `table-form-guard`, `ui-neatness-guard`, `aksesibilitas`) tidak diverifikasi pada build ini.
Rekomendasi: jalankan e2e pada worktree/DB terpisah dengan `BISA_E2E_RESEED=1`.
Effort: **M** · Keyakinan: **tinggi**

---

## 5. Tes Reproduksi

| Berkas | Bug | Cara menjalankan | Status |
|---|---|---|---|
| `tests/audit-repro/pos-paid-total-repro.test.ts` | POS-001 — `voidReceivablePaymentAction` menghapus porsi tunai dari `paidTotal` | `pnpm vitest run tests/audit-repro/pos-paid-total-repro.test.ts` | **Gagal sekarang** (`expected +0 to be 8000`); akan hijau setelah diperbaiki |

Catatan: tes ini memakai perusahaan demo, membuat fixture sendiri, dan membersihkannya di `afterAll`. Tidak mengubah kode produksi. Tes gagal yang sudah ada (`review-fixes-t4rb.test.ts`) adalah bukti ARCH-002, bukan tes baru.

---

## 6. Rencana Perbaikan Bertahap

### 6.1 Quick win (1–2 minggu, risiko rendah)
1. **UI-028**: kosongkan prefill kata sandi demo; tampilkan kredensial sebagai teks petunjuk saja.
2. **POS-001**: hitung ulang `paidTotal` dari `sale_payments` + `party_payments` non-void.
3. **POS-002**: catat `cashMovements` saat `payReceivable` dengan akun kelas kas.
4. **WF-001**: wajibkan owner + alasan untuk `closed → open`.
5. **WF-003/WF-004**: tambah maker-checker cuti & lembur.
6. **WF-006**: panggil `restorePartyCreditUsage` saat void penjualan.
7. **POS-010/POS-011**: kunci sesi `FOR UPDATE` & seragamkan urutan kunci.
8. **UI-008/UI-009/UI-007**: pesan validasi spesifik per field + indikator wajib + inline error.
9. **UI-014/UI-015**: konfirmasi sebelum posting payroll & mengosongkan keranjang.
10. **ARCH-002**: perbaiki assertion tes rekonsiliasi.
11. **ARCH-003**: betulkan 19 warning lint.

### 6.2 Perbaikan struktural (1–2 bulan)
1. **Field ownership**: pisahkan `costPrice` AVCO (sistem) dari input manual; jadikan `salePrice` penerimaian eksplisit + audit.
2. **Idempotensi merata**: tambah `idempotencyKey` + unique index untuk `sales` (hold), `saleReturns`, `cashMovements`, `stockReservations`, `purchaseOrders`, `purchaseRequests`, `partyOpeningBalances`, `fixedAssets`; kunci klien, bukan UUID acak.
3. **Maker-checker**: retur pemasok, payroll run/pay/void, transfer dua tahap, pelepasan aset, cuti/lembur.
4. **FK bertahap**: `account_mappings`, `expenses`, `party_payments`, `bank_transfers`, `sales.warehouse_id`, `sale_lines.product_id`, `sale_payments.method_id`, `cash_movements.session_id`, `party_credits.party_id`, `party_opening_balances.party_id`.
5. **CHECK constraints**: `qty >= 0` (sesuai kebijakan), `status IN (...)`, `total >= 0`.
6. **Snapshot flag pelacakan** di `sale_lines` (POS-003) & `discountAccountId` di `sales` (POS-015).
7. **Reservasi**: simpan `reservationId` di `sales` & pulihkan saat void (POS-005).
8. **Serial restore**: pilih gerakan `out` yang serialnya masih `out` (POS-004).
9. **Periode**: tutup buku tahunan menolak bila ada periode terbuka (WF-002).
10. **Data demo**: pisahkan DB tes/demo; bersihkan fixture yang commit.

### 6.3 Perubahan arsitektur (3–6 bulan)
1. **Sistem reservasi & kredit terpadu**: satukan `stock_reservations`, `sale_returns.creditUsed`, dan `party_credits` di bawah satu model "commitment" agar void/reversal selalu memulihkan semua porsi.
2. **Ledger append-only penuh**:.jurnal/gerakan sudah append-only; perluas ke `stock_on_hand` (rapat mutasi) dan `cash_sessions` (mutasi) agar tidak ada update retroaktif.
3. **Idempotensi terpusat**: lapisan `idempotencyKeys` dengan `scope` di unique index dan helper klaim bersama untuk semua aksi tulis.
4. **Policy engine**: pindahkan ambang (maker-checker, diskon, write-off, toleransi) ke konfigurasi per perusahaan yang terpusat (pola D-25 sudah dimulai).
5. **Parity offline**: ekstrak inti perhitungan quote ke modul bersama + tes parity otomatis (POS-020).
6. **Arsitektur data ownership**: dokumen "field ownership matrix" sebagai kontrak antar-modul; every write di luar pemilik harus lewat API domain.

---

## 7. Yang Belum Bisa Diverifikasi

1. **Riwayat perubahan (git)**: repo bukan git repository → tidak ada `git log`/`git blame`; tidak dapat menentukan kapan/oleh siapa bug masuk.
2. **Eksploitabilitas runtime POS-009/POS-011 (deadlock)**: urutan kunci terbukti di kode, tetapi deadlock memerlukan dua transaksi bersamaan pada resource yang sama; tidak direproduksi.
3. **POS-006/POS-007/POS-008 (offline)**: memerlukan terminal offline sungguhan / browser dengan koneksi putus; hanya diverifikasi dari kode.
4. **Perilaku di perangkat desktop POS (Tauri)**: tidak dijalankan; `pos-desktop/` dan `src-tauri/` tidak diaudit mendalam.
5. **E2E suite**: tidak dijalankan (konflik port & risiko reseed lihat ARCH-004).
6. **Kinerja skala besar**: tidak ada benchmark beban yang dijalankan; beberapa query (piutang/utang tanpa paginasi, UI-023) berisiko pada volume tinggi.
7. **Kebenaran data produksi**: hanya DB demo yang diperiksa; DB produksi tidak tersedia.
8. **Master data import skala besar**: alur impor diuji dari kode, tidak dengan berkas nyata bervolume tinggi.
9. **Perilaku `allowNegativeStock` per perusahaan**: hanya membaca kode; tidak menguji semua kombinasi kebijakan.
10. **Aksesibilitas penuh (screen reader nyata)**: hanya audit kode + alat otomatis; tidak diuji dengan NVDA/VoiceOver.

---

## 8. Apa yang Sudah Kuat (jangan diutak-atik tanpa alasan)

- **Gerbang jurnal tunggal** `postJournal` + trigger `assert_journal_balanced` (DEFERRABLE) & `forbid_posted_journal_*_mutation`.
- **Isolasi tenant terpusat** `withCompany`/`withCompanyReadOnly` + RLS FORCE di 100+ tabel.
- **Primitif uang terpusat** (`d()`, `toDb()`, `formatIDR()`), kontrak `MoneyInput`.
- **Invariant stok terjaga**: query `stock_on_hand` vs Σ `stock_movements` = **0 mismatch**; `stock_batches` vs `stock_on_hand` untuk produk `trackBatch` = **0 mismatch**.
- **Invariant jurnal**: 0 jurnal tidak seimbang; 0 jurnal tanpa baris; `account_monthly_balances` = 0 mismatch vs agregat mentah.
- **Idempotensi di banyak dokumen**: `sales`, `stock_receipts`, `supplier_returns`, `stock_documents`, `purchase_advances`, `journal_entries`, `quick_entry_submissions`, `bank_transfers`, `expenses`.
- **Guard hapus lengkap** untuk produk, gudang, akun, pemasok, pelanggan, metode pembayaran (memeriksa riwayat & referensi sebelum hapus).
- **Audit trail** terpusat (`writeAudit`) + trigger append-only pada `audit_log`.
- **Validasi backend Zod + pesan Indonesia spesifik** (`parseInput`, `guard`, pemetaan unique constraint).
- **Desain system UI** (`StatusBadge`, `Field`, `Modal`, `ConfirmDialog`, `Pagination`, `EmptyState`) dengan guard e2e kerapian.
- **Typecheck & lint bersih** (0 error).

---

*Laporan ini disusun dari pembacaan kode, inspeksi DB read-only, eksekusi suite, dan bukti visual. Temuan ditandai keyakinan tinggi/sedang/rendah; yang tanpa bukti konkret ditandai "perlu verifikasi".*
