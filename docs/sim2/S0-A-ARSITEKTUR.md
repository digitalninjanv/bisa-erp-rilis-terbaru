# SIM-2 Fase S0-A — Inventaris Fitur & Peta Dependensi

**Jenis pekerjaan:** audit BACA-SAJA (tanpa perubahan kode). **Tanggal:** 2026-11-04.
**Metode:** penelusuran kode `src/app` (rute), `src/server` (domain), `src/server/actions` (aksi), `src/db/schema.ts` (62 tabel, 27 migrasi s.d. 0026), dokumen program (`PROGRESS.md`, `docs/SPEK-FITUR-INTI.md` §7, laporan tahap 1–5, laporan A-8 s.d. A-13), dan keberadaan test yang menamainya.
**Baseline suite saat laporan ditulis (dijalankan penulis): `pnpm exec vitest run` → 69 berkas, 590/590 test lulus.**

**Definisi status:**
- **BERFUNGSI** — UI + aksi + domain + efek jurnal/stok nyata + ada test yang membuktikan.
- **SEBAGIAN** — ada dan bekerja, tetapi alur putus/dangkal pada titik yang disebutkan.
- **MOCK/TAMPILAN** — UI tanpa domain nyata. *(Hasil penting: tidak ditemukan satu pun fitur MOCK murni — semua yang tampil di UI terhubung ke domain nyata.)*
- **BELUM ADA** — tidak ditemukan di rute, domain, maupun skema.

---

## 1. Inventaris fitur per modul

### 1.1 Beranda (`/app`)

| Fitur | Rute | Domain / aksi | Tabel | Status |
|---|---|---|---|---|
| Dashboard ringkasan (penjualan hari ini & bulan ini, nilai persediaan dari GL, kas/bank/QRIS) | `/app` | `reports.getHomeSummary` | journal_lines, sales | BERFUNGSI |
| Panel perhatian (stok menipis, sesi kas terbuka, pesanan ditahan) | `/app` | reports + pos | stock_on_hand, cash_sessions, sales (hold) | BERFUNGSI |
| Pemilih perusahaan (pengguna multi-perusahaan) | shell global | `actions/company.ts`, cookie `bisa_company` | organization, member | BERFUNGSI (`company-switch.test.ts`) |
| Saklar modul per perusahaan (POS/Gudang/Akuntansi bisa dimatikan; Pengaturan selalu bisa diakses) | layout per segmen + gerbang di 53 aksi tulis | `lib/modules.ts`, `company_settings.enabled_modules` | company_settings | BERFUNGSI (`platform-t5.test.ts`, `modules-enabled.test.ts`) |

### 1.2 POS

Domain: `src/server/pos.ts` (2.100 baris, 15 ekspor); aksi `src/server/actions/pos.ts` (17 ekspor).

| Fitur | Rute | Domain | Tabel utama | Status |
|---|---|---|---|---|
| Terminal kasir (cari produk server-paginated 24/hal., barcode, keranjang, quote = checkout satu fungsi) | `/app/pos` | `quoteCart`, `createSale`, `catalog.searchProducts` | sales, sale_lines, stock_movements | BERFUNGSI (`feature-matrix-pos.test.ts`, `sale-flow.test.ts`) |
| Pembayaran tunai/QRIS/bank + split payment + chip uang cepat (Pas/10/20/50/100rb) | terminal | `createSale` kaki pembayaran per metode → akun metode | sale_payments, payment_methods | BERFUNGSI |
| Pembayaran kartu debit/kredit sebagai metode bertipe bank | terminal | sama seperti di atas | payment_methods (type `bank`) | SEBAGIAN — tercatat sebagai pembayaran ke akun bank; tidak ada integrasi EDC/otorisasi kartu (di luar rancangan; dicatat agar tidak dikira terhubung ke bank) |
| Penjualan **Utang** (D-19): wajib pelanggan + jatuh tempo, Dr Piutang, batas kredit ditegakkan, bisa split tunai+utang | terminal | `createSale` porsi kredit | sales.due_date, customers.credit_limit | BERFUNGSI (`pos-debt-sales.test.ts`) |
| Diskon: harga kelompok + aturan per produk + pembulatan kelompok; diskon manual berjenjang izin (`pos.discount` di atas ambang perusahaan) | terminal, `/app/pos/grup` | `catalog` customer groups | customer_groups, customer_group_prices | BERFUNGSI |
| Promosi/kupon/voucher terjadwal | — | — | — | **BELUM ADA** (yang ada hanya kredit retur sebagai alat bayar, lihat retur) |
| Hold & resume (seri HOLD, klaim atomik, hitung ulang harga + pemberitahuan selisih) | `/app/pos/ditahan` | `listHeldSales`, checkout `heldSaleId` | sales | BERFUNGSI (`pos-hold-cash.test.ts`) |
| Retur penjualan sebagian/penuh: refund tunai (ke sesi terbuka pemroses), tukar barang, kredit toko; penebusan kredit retur di checkout berikutnya | `/app/pos/retur` | `createSaleReturn`, penebusan via `sale_returns.credit_used` terkunci `FOR UPDATE` | sale_returns, sale_return_lines | BERFUNGSI (`pos-returns.test.ts`, `credit-redemption.test.ts`) |
| Sesi kasir: buka/tutup, modal awal, setor ke bank / tarik dari bank, hitung fisik, selisih berjurnal (cash_over/cash_short) | `/app/pos/sesi` | `cashDrawerMovement`, `closeCashSession` | cash_sessions, cash_movements | BERFUNGSI (`cash-session-history.test.ts`) |
| Riwayat sesi tersendiri + detail mutasi | `/app/pos/sesi/riwayat`, `/[id]` | `reports.listCashSessionHistory` | cash_sessions, cash_movements | BERFUNGSI |
| Cash drop khusus (uang ke brankas, bukan ke bank) | — | — | — | SEBAGIAN — fungsi uang keluar dari laci dipenuhi "Setor ke Bank" (Dr Bank/Cr Kas); tidak ada tipe mutasi drop-ke-brankas tersendiri |
| Riwayat penjualan + detail + cetak ulang nota | `/app/pos/riwayat`, `/app/pos/nota/[id]` | `reports.listSales`, `getSaleDetail` | sales | BERFUNGSI |
| Persistensi keranjang (localStorage per perusahaan+pengguna) | terminal | klien | — | BERFUNGSI (pemulihan crash/reload, BUKAN mode offline) |
| **Offline POS + sinkronisasi** | — | — | tabel `outbox` ada di skema | **BELUM ADA** (keputusan D-10; tabel `outbox` yatim — tidak ada klien, antrean, maupun worker yang memakainya; lihat utang teknis) |

### 1.3 Gudang

Domain: `src/server/inventory.ts` (1.889 baris), `purchasing.ts`, `batches.ts`, `supplier-returns.ts` (1.652 baris), `catalog.ts`; aksi `actions/inventory.ts` (27 ekspor), `actions/purchasing.ts`, `actions/supplier-returns.ts`.

| Fitur | Rute | Domain | Tabel utama | Status |
|---|---|---|---|---|
| Master produk (SKU unik, **satu** barcode unik per produk, kategori bertingkat, satuan tunggal, pemasok utama, stok minimum, gambar, custom fields) | `/app/gudang/produk`, `/[id]` | `catalog` | products, categories, units | BERFUNGSI (`master-crud.test.ts`, `category-tree.test.ts`) |
| Brand produk | — | — | — | **BELUM ADA** (tidak ada kolom/tabel brand di skema) |
| Variasi produk (ukuran/warna sebagai varian) | — | — | — | **BELUM ADA** |
| Banyak barcode per produk | — | — | products.barcode tunggal + indeks unik | **BELUM ADA** |
| Stok maksimum / reorder point terpisah | — | — | products.min_stock saja | SEBAGIAN — ambang menipis = `minStock`; saran beli = maks(2×minStock − stok, 0); tidak ada max-stock/reorder-point mandiri |
| Penerimaan barang 3 skenario (kredit / tunai tanpa utang / non-pembelian: stok awal, bonus, retur pelanggan, lainnya) + nomor invoice pemasok + tautan PO | `/app/gudang/penerimaan` | `inventory.createReceipt` (jurnal per sumber, D-5) | stock_receipts, stock_receipt_lines | BERFUNGSI (`goods-receipt.test.ts`; simulasi pengguna §5 spek hijau) |
| Qty rusak/ditolak per baris penerimaan | — | — | — | **BELUM ADA** (keputusan sadar D-5: barang rusak saat tiba ditangani dokumen penyesuaian, bukan kolom penerimaan) |
| Purchase Order (draft→sent→partial→received/cancelled, terima sebagian, terima melebihi sisa PO **ditolak**, batal hanya bila belum ada penerimaan) | `/app/gudang/pembelian`, `/[id]`, `/[id]/cetak` | `purchasing` | purchase_orders, purchase_order_lines | BERFUNGSI (`purchase-order.test.ts`) |
| **Purchase Request** | — | — | — | **BELUM ADA** (alur dimulai langsung di PO; rekomendasi beli menggantikan sebagian fungsinya) |
| Perbandingan harga antar-pemasok | — | — | products.supplier_id + cost_price tunggal | **BELUM ADA** (tidak ada riwayat harga per pemasok maupun layar banding; harga perolehan historis hanya terbaca per dokumen penerimaan) |
| Diskon pembelian & biaya tambahan (ongkir dsb.) pada penerimaan | — | — | stock_receipts.total = Σ baris | **BELUM ADA** (tidak ada kolom diskon/biaya; total penerimaan murni qty × harga baris) |
| Penjaga faktur pemasok ganda | — | — | supplier_invoice_number teks bebas | SEBAGIAN — nomor invoice tersimpan & tampil, tetapi tidak ditemukan indeks unik (pemasok + nomor invoice) maupun peringatan duplikat saat input |
| Retur pembelian ke pemasok (seri RTB; alasan kategori + bebas wajib; stok keluar AVCO; Dr Utang FIFO per dokumen, kelebihan → aset Kredit Pemasok 1210; penyelesaian: ganti barang / terapkan ke utang / refund / cara lain; void memulihkan stok) | `/app/gudang/retur-pembelian`, `/baru`, `/[id]`, `/[id]/cetak` | `supplier-returns.ts` | supplier_returns, _lines, _resolutions, _allocations | BERFUNGSI (`supplier-returns.test.ts`) |
| Penyesuaian stok beralasan (rusak/kedaluwarsa/hilang/karantina/retur) + **approval maker-checker** di atas ambang perusahaan | `/app/gudang/penyesuaian` | `inventory` stock documents | stock_documents, stock_document_lines | BERFUNGSI (`adjustment-approval.test.ts`, `inventory-adjustment.test.ts`) |
| Transfer stok antargudang | `/app/gudang/transfer` | stock documents | stock_documents | BERFUNGSI — catatan: satu dokumen atomik (stok langsung berpindah) |
| Barang dalam perjalanan (kirim → terima dua tahap) | — | — | — | **BELUM ADA** (transfer tidak punya status in-transit) |
| Stock opname (hitung fisik, kunci baris terurut, anti-dobel) | `/app/gudang/opname` | stock documents | stock_documents | BERFUNGSI (`inventory-void-import.test.ts`, `warehouse-race.test.ts`) |
| Cycle counting terjadwal/rotasi | — | — | — | SEBAGIAN — opname dapat dibatasi pada produk pilihan secara manual; tidak ada jadwal/rotasi cycle count |
| Kartu stok per gudang + paginasi | `/app/gudang/pergerakan` | `reports.getStockCard` | stock_movements | BERFUNGSI (`stock-card-valuation.test.ts`, `movements-pagination.test.ts`) |
| Nilai persediaan (qty × AVCO, Decimal) | `/app/gudang/nilai` | `reports.getInventoryValuation` | stock_on_hand, products | BERFUNGSI |
| Daftar kedaluwarsa (kedaluwarsa & ≤30 hari) + stok menipis | `/app/gudang` | `batches.listExpiringBatches`, `lib/stock.isLowStock` | stock_batches | BERFUNGSI |
| Stock aging (umur persediaan per kelompok usia) | — | — | — | **BELUM ADA** |
| Dead stock / fast–slow moving | — | — | — | **BELUM ADA** |
| Batch & kedaluwarsa + FEFO + blokir jual batch kedaluwarsa (opt-in per produk) | produk, penerimaan, POS | `batches.ts` (invariant Σ batch = on_hand) | stock_batches | BERFUNGSI (`stock-batches.test.ts`) |
| **Serial number** per unit | — | — | — | **BELUM ADA** (hanya batch/lot) |
| **Reservasi stok** (untuk pesanan/hold) | — | — | — | **BELUM ADA** (hold POS tidak mengunci stok; stok baru bergerak saat checkout) |
| Rekomendasi pembelian + buat PO per pemasok | `/app/gudang/rekomendasi` | `purchasing` (definisi menipis kanonis D-4) | products, stock_on_hand | BERFUNGSI |
| Void dokumen gudang terposting (gerakan pembalik pada biaya asli + jurnal balik, berpenjaga stok terpakai) | halaman dokumen | `inventory` void | stock_documents, stock_receipts | BERFUNGSI |

### 1.4 Akuntansi

Domain: `src/server/accounting.ts` (`postJournal`, `assertPeriodOpen`, `getAccountMap`), `reports.ts` (2.080 baris, 38 ekspor), `expenses.ts`, `bank-transfers.ts`, `bank-reconciliation.ts` (930 baris), `payables.ts`, `opening-balances.ts`, `quick-entry.ts`, `employee-advances.ts` (617 baris); aksi `actions/accounting.ts` (24 ekspor, 1.544 baris — termasuk payroll & karyawan).

| Fitur | Rute | Domain | Tabel utama | Status |
|---|---|---|---|---|
| Bagan akun (COA) CRUD berpenjaga + section/cash_flow_group untuk pengelompokan laporan | `/app/akuntansi/akun` | `actions/accounting.saveAccountAction` dst. | accounts | BERFUNGSI |
| Pemetaan akun (22+ kunci: cash, bank, qris, receivable, payable, inventory, revenue, sales_discount, sales_return, tax_output, customer_credit, supplier_credit, employee_receivable, equity, other_income, salary_*, dst.) | Pengaturan tab Akun | `getAccountMap` | account_mappings | BERFUNGSI |
| Jurnal manual (formulir halaman penuh, idempoten, status seimbang langsung, pola cepat) | `/app/akuntansi/jurnal`, `/baru`, `/[id]`, `/[id]/cetak` | `postManualJournalAction` → `postJournal` | journal_entries, journal_lines | BERFUNGSI (`journal-validation.test.ts`, `journal-source-print.test.ts`) |
| Jurnal otomatis dari semua modul (sumber terlabel Bahasa Indonesia + nomor dokumen sumber) | daftar jurnal | `postJournal` + `journalSourceLabel` | journal_entries.source_type | BERFUNGSI |
| Koreksi jurnal: balik jurnal manual & `quick_cash_sale`; jurnal sistem hanya bisa dibalik dari modul asal | detail jurnal | `reverseJournalAction` (penjaga sumber) | journal_entries.reversal_of | BERFUNGSI |
| Buku besar per akun + cetak resmi | `/app/akuntansi/buku-besar` | `reports.getLedger` | journal_lines | BERFUNGSI |
| Kas & bank: saldo per akun, transfer antar akun (+fee), void transfer | `/app/akuntansi/bank` | `bank-transfers.createBankTransfer` | bank_transfers, journal | BERFUNGSI |
| Beban operasional (akun beban × akun pembayaran, void beralasan) | `/app/akuntansi/beban` | `expenses.createExpense` | expenses | SEBAGIAN untuk mandat §8 — tanpa lampiran bukti, tanpa alur persetujuan, tanpa pemisahan PPN masukan (kolom-kolom itu tidak ada di tabel `expenses`; diakui terbuka di laporan A-12) |
| Piutang & utang: daftar gabungan dokumen + saldo awal, aging dari tanggal dokumen, bayar sebagian/penuh bertanggal, void pembayaran per pembayaran | `/app/akuntansi/piutang-utang` | `reports.listReceivables/listPayables`, `payables.payPayableDocument`, `opening-balances` | stock_receipts, sales, party_opening_balances, party_payments | BERFUNGSI (`payments-void-p2.test.ts`, `opening-balances.test.ts`) |
| Saldo awal hutang/piutang sebagai dokumen tersendiri (jurnal pembuka bertag pihak) | piutang-utang + impor | `opening-balances` (D-14) | party_opening_balances | BERFUNGSI |
| Rekonsiliasi bank: impor mutasi CSV (sidik jari anti-ganda), auto-match kandidat tunggal ±3 hari, taut/lepas manual, buat jurnal dari mutasi yatim, ringkasan saldo buku vs tertaut | `/app/akuntansi/rekonsiliasi` | `bank-reconciliation.ts` (14 ekspor) | bank_statement_imports, bank_statement_lines | BERFUNGSI (`bank-reconciliation.test.ts`) |
| Periode fiskal: tutup/kunci bertingkat, buka kunci hanya owner + alasan + audit; posting terblokir pada periode tertutup | `/app/akuntansi/periode` | `assertPeriodOpen`, `setPeriodStatusAction` | fiscal_periods | BERFUNGSI |
| Jurnal penutup tahun buku otomatis (memindahkan laba tahun berjalan ke laba ditahan) | — | — | — | SEBAGIAN — tutup periode = kunci posting; laporan ekuitas menghitung laba ditahan dari jurnal yang ada, tetapi tidak ada fitur jurnal penutup tahun eksplisit |
| **Catat Transaksi** (modal 5 jenis: penjualan tunai non-stok, beban, terima piutang FIFO, bayar utang FIFO, transfer; pratinjau jurnal dari fungsi yang sama dengan posting; draf server per pengguna; pintasan N) | modal di seluruh Akuntansi + Beranda | `quick-entry.ts` + domain lama | quick_entry_drafts, quick_entry_submissions | BERFUNGSI (`quick-entry.test.ts`) |
| Laporan keuangan: Laba Rugi (+pembanding tahun lalu), Neraca, Arus Kas, Perubahan Ekuitas, Neraca Saldo, Penjualan, Catatan (CALK teks) | `/app/akuntansi/laporan` (7 tab) | `reports.getIncomeStatement/getBalanceSheet/getCashFlow/getEquityStatement/getTrialBalance/getSalesSummary` | journal_lines (posted saja) | BERFUNGSI (`reports-p2.test.ts`, `contra-revenue.test.ts`) |
| Laporan pajak khusus (PPN keluaran/masukan, ringkasan SPT) | — | — | — | **BELUM ADA** (pajak hidup sebagai akun pemetaan `tax_output` dsb. di jurnal; tidak ada tab/laporan pajak) |
| Budget vs Actual | — | — | — | **BELUM ADA** |
| Laporan ringkasan payroll | — | — | payroll_runs | SEBAGIAN — detail per run ada di halaman Payroll; tidak ada laporan payroll di modul Laporan |

### 1.5 HR / Payroll yang ada (ringkas — audit mendalam di agen S0 lain)

| Fitur | Rute | Domain | Tabel | Status |
|---|---|---|---|---|
| Master karyawan minimal (kode, nama, jabatan teks bebas, gaji pokok, tunjangan & potongan sebagai **satu angka agregat** masing-masing, tanggal masuk, aktif/nonaktif) | `/app/akuntansi/payroll` | `saveEmployeeAction` | employees | SEBAGIAN — tidak ada NIK/NPWP, departemen, cabang, atasan, jenis kontrak PKWT/PKWTT, tanggal akhir kontrak, riwayat jabatan/gaji (kolomnya tidak ada) |
| Run payroll bulanan (periode YYYY-MM; indeks unik parsial anti-proses-ganda; jurnal Dr beban gaji bruto / Cr utang gaji bersih / Cr utang potongan / Cr Piutang Karyawan untuk kasbon) | `/app/akuntansi/payroll`, `/[id]` | `runPayrollAction` | payroll_runs, payroll_items | BERFUNGSI untuk payroll sederhana (`payroll-reverse.test.ts`) |
| Bayar run payroll dari akun kas/bank; void run (posted, belum dibayar) membalik jurnal + memulihkan kasbon | detail run | `payPayrollAction`, `voidPayrollRunAction` | payroll_runs | BERFUNGSI |
| PPh 21 / TER, BPJS Kesehatan & Ketenagakerjaan, THR, lembur, upah minimum | — | — | — | **BELUM ADA** (wilayah Fase S2; tidak ada tarif/komponen terstruktur di skema — tunjangan & potongan hanya angka agregat yang diketik manual) |
| Absensi, shift, jadwal, lembur, cuti | — | — | tidak ada tabelnya | **BELUM ADA** |
| Slip gaji tercetak per karyawan | — | — | — | **BELUM ADA** (halaman detail run tidak punya cetak slip) |
| Export pembayaran gaji ke format bank | — | — | — | **BELUM ADA** |
| Payroll mingguan | — | — | period hanya YYYY-MM | **BELUM ADA** |
| Kasbon karyawan (pemberian Dr Piutang Karyawan 1220; rencana potongan penuh/cicilan nominal/cicilan persen; terisi otomatis di run, dibatasi gaji bersih ≥ 0, bisa diubah manual; setoran manual; void payroll memulihkan) | `/app/akuntansi/kasbon`, `/[employeeId]` | `employee-advances.ts` (15 ekspor) | employee_advances, employee_advance_entries | BERFUNGSI (`employee-advances.test.ts`) |
| Pinjaman karyawan (terpisah dari kasbon, bunga/jadwal cicilan formal) | — | — | — | **BELUM ADA** (kasbon mode cicilan menutup sebagian kebutuhan) |
| Reimbursement / klaim biaya karyawan dengan persetujuan | — | — | — | **BELUM ADA** (klaim biaya hari ini hanya bisa dicatat sebagai Beban biasa tanpa alur klaim/persetujuan per karyawan) |
| Terminasi & penyelesaian akhir (final salary, arsip akses) | — | — | employees.is_active | SEBAGIAN — karyawan bisa dinonaktifkan tanpa menghapus histori; tidak ada alur terminasi/final-pay terstruktur |

### 1.6 Pengaturan

| Fitur | Rute | Status |
|---|---|---|
| Perusahaan (identitas, NPWP, alamat), tarif pajak tunggal per perusahaan | `/app/pengaturan?tab=umum` | BERFUNGSI |
| Pengguna & peran: buat pengguna, peran bawaan 7 + **peran kustom** (modul + izin eksplisit), ubah peran, reset sandi berpenjaga owner, hapus berpenjaga owner terakhir | `/app/pengaturan/pengguna` | BERFUNGSI (`user-management.test.ts`; perbaikan A-13) |
| Undangan pengguna (invitation) | — | **BELUM ADA** di UI (tabel `invitation` warisan plugin Better Auth organization tidak dipakai; pengguna dibuat langsung oleh admin) |
| 2FA | plugin `twoFactor()` aktif di `src/lib/auth.ts` | SEBAGIAN — sisi server aktif; pengelolaan 2FA dari UI pengguna tidak ditemukan pada inventaris rute ini (verifikasi tuntas di Fase S6 keamanan) |
| Metode pembayaran CRUD penuh (kode terkunci, nonaktif, hapus berpenjaga transaksi) | `?tab=pembayaran` | BERFUNGSI (`payment-method-crud.test.ts`) |
| Kelompok harga pelanggan + aturan harga per produk + pembulatan | `?tab=grup` | BERFUNGSI |
| Gudang & cabang CRUD berpenjaga | `?tab=lokasi` | BERFUNGSI |
| Pemetaan akun | `?tab=akun` | BERFUNGSI |
| Penomoran dokumen kustom (15 jenis dokumen: awalan + lebar digit) | `?tab=nomor` | BERFUNGSI (`document-numbering.test.ts`) |
| Saklar modul, custom fields (produk & pihak), ambang approval penyesuaian, ambang diskon POS | `?tab=modul`, `?tab=kolom`, `?tab=umum` | BERFUNGSI (`platform-t5.test.ts`) |
| Multi-tarif pajak / tarif per produk / tarif bertanggal | — | SEBAGIAN — satu tarif perusahaan tervalidasi 0–100; tarif pajak bertanggal efektif pernah direncanakan di program R9 Arunika, di repo ini **belum ada** |
| Status dokumen kustom & form builder generik | — | **BELUM ADA** (keputusan D-16: ditolak sadar — status adalah enum penjaga integritas) |

### 1.7 Laporan & Ekspor

| Saluran | Isi | Status |
|---|---|---|
| Halaman Laporan (7 tab, berkop formal saat cetak + nomor halaman) | lihat 1.4 | BERFUNGSI |
| Ekspor CSV: laporan per tipe, jurnal (daftar & per-id), buku besar, akun, pelanggan, pemasok, persediaan | `src/app/api/export/*` (8 rute) | BERFUNGSI |
| Ekspor payroll / file bank gaji | — | **BELUM ADA** |
| Ekspor transaksi penjualan massal (mentah) | hanya agregat Laporan Penjualan via `export/report?type=penjualan` | SEBAGIAN |
| PDF | lewat Print Engine (cetak browser → PDF) untuk dokumen & laporan | BERFUNGSI (bukan generator PDF server) |

### 1.8 Impor

| Jenis impor | Jalur | Status |
|---|---|---|
| Produk (CSV/XLSX, pemetaan kolom, pratinjau tersimpan di server, klasifikasi baris, filter berhitungan, pilih massal, **edit di tempat tervalidasi ulang server**, deteksi duplikat berkas & katalog, update-existing) | `/app/gudang/impor`, `actions/import.ts`, `lib/import-classify.ts` | BERFUNGSI (`import-review.test.ts`, `import-row-edit.test.ts`, `import-hardening.test.ts`) |
| Master lain: suppliers, customers, accounts | `import-masters.ts` (1.260 baris) | BERFUNGSI (`import-expansion.test.ts`) |
| opening_stock (menjadi satu penerimaan sumber `opening`), opening_payables, opening_receivables | sama | BERFUNGSI |
| Template unduhan per entitas | `api/import/template/[entity]` | BERFUNGSI |
| Impor histori transaksi / migrasi saldo berjalan antar-periode | — | **BELUM ADA** (wilayah Fase S5 round-trip) |
| Rollback satu batch impor ter-commit | — | SEBAGIAN — job ter-commit tidak bisa dibatalkan sebagai batch; koreksi per dokumen (void) — keputusan tercatat sejak G5a |

### 1.9 Cetak (Print Engine)

Komponen: `src/components/print/` (`print-shell.tsx`, `types.ts` `paperSpec`, `qr.ts`). Audit cetak khusus (26 temuan CT) sudah ditutup penuh di program Perbaikan Cetak.

| Permukaan | Ukuran | Status |
|---|---|---|
| Nota POS | thermal 58/80mm (MediaBox terukur 163,9/227,0 pt), A5, A4 (blok 80mm di tengah) | BERFUNGSI |
| GRN (penerimaan) & PO | A4/A5 per pengaturan dokumen | BERFUNGSI |
| Dokumen retur pembelian (RTB) | A4 | BERFUNGSI |
| Voucher jurnal | A4 | BERFUNGSI |
| Semua laporan (kop formal, judul kolom pembanding, nomor halaman) | A4 | BERFUNGSI |
| Template: modern/minimal/classic, logo URL, warna aksen, font, teks kop/kaki, tanda tangan, QR nomor dokumen | Pengaturan tab Cetak + pratinjau berskala | BERFUNGSI — batas: **satu template aktif per perusahaan**, bukan banyak template per jenis dokumen |
| Slip gaji | — | **BELUM ADA** |
| Bukti pembayaran hutang/piutang tercetak | — | **BELUM ADA** (pembayaran tampil di dokumen & daftar; tidak ada halaman cetak bukti bayar) |
| Bukti mutasi kas sesi tercetak per dokumen | — | SEBAGIAN — riwayat sesi terbaca di layar; cetak laporan sesi bukan permukaan Print Engine |

---

## 2. Peta dependensi antar-modul

Semua jalur tulis bermuara ke dua buku besar: **General Ledger** (`postJournal` di `src/server/accounting.ts` — satu-satunya gerbang jurnal; menegakkan keseimbangan + `assertPeriodOpen`) dan **Stock Ledger** (`applyStockMovement` di `src/server/inventory.ts` — `stock_on_hand` = Σ `stock_movements`, append-only). Semua domain juga memakai `nextDocumentNumber` (`sequences.ts`), `writeAudit` (`audit.ts`), dan `getAccountMap` (pemetaan akun perusahaan).

```
MASTER (catalog.ts, actions/settings, actions/users)
  products/categories/units/suppliers/customers/customer_groups/payment_methods
        │ dibaca oleh hampir semua transaksi
        ▼
POS (pos.ts) ──► stok: applyStockMovement + batches (FEFO) ──► stock_on_hand/batches
     │     ──► jurnal: Dr Kas/QRIS/Bank per metode, Dr Piutang (porsi utang),
     │              Cr Pendapatan bruto, Cr diskon kontra 4010 / retur 4020, Dr HPP/Cr Persediaan
     │     ──► sesi kas: cash_movements (sale/refund masuk laci)
     │     ──► retur: sale_returns.credit_used ──► ditebus sebagai metode bayar di createSale berikutnya
     ▼
GUDANG
  Penerimaan (inventory.createReceipt) ──► purchasing (progres PO) ──► stok masuk
     │     ──► jurnal per sumber: kredit Dr Persediaan/Cr Utang │ tunai Cr Kas/Bank │
     │              opening/bonus/other Cr ekuitas/other_income │ retur pelanggan Cr sales_return
     │     ──► melahirkan UTANG: stock_receipts terbaca listPayables
  Penyesuaian/Opname ──► stok ± jurnal write-off (akun per tipe dokumen)
  Transfer/Karantina ──► stok berpindah, jurnal persediaan delta Rp0
  Retur pemasok (supplier-returns.ts) ──► stok keluar AVCO
     │     ──► jurnal Dr Utang (alokasi FIFO per dokumen → supplier_return_allocations)
     │              + Dr Kredit Pemasok 1210 (kelebihan) / Cr Persediaan
     │     ──► listPayables & pembayaran utang mengurangi alokasi (anti bayar ganda)
     │     ──► resolusi: receiveReplacement → stok masuk; refund → Dr Kas;
     │              applySupplierCredit → Dr Utang/Cr 1210
        ▼
AKUNTANSI
  Pembayaran utang/piutang (payables.ts, opening-balances.ts, actions/accounting)
     ──► party_payments ──► jurnal Dr Utang/Cr Kas atau Dr Kas/Cr Piutang ──► status dokumen induk dihitung ulang
  Beban (expenses.ts) ──► jurnal Dr Beban/Cr akun pembayaran
  Transfer bank (bank-transfers.ts) ──► jurnal antar akun kas/bank (+fee)
  Payroll (actions/accounting.runPayroll) ──► jurnal gaji bruto
     ──► employee-advances.applyPayrollAdvanceDeductions (Cr Piutang Karyawan 1220, alokasi FIFO berplafon cicilan)
     ──► payPayroll: Dr Utang Gaji/Cr Kas-Bank; voidPayrollRun ──► jurnal balik + restorePayrollAdvanceDeductions
  Kasbon (employee-advances.ts) ──► jurnal Dr 1220/Cr Kas-Bank; setoran Dr Kas/Cr 1220
  Catat Transaksi (quick-entry.ts) ──► membungkus expenses/payables/party payments/bank-transfers
     + jurnal langsung khusus penjualan tunai non-stok (source quick_cash_sale)
  Rekonsiliasi bank ──► membaca journal_lines (tautan match saja) / postJournal untuk mutasi yatim
  Impor (actions/import.ts, import-masters.ts) ──► master (catalog/parties/accounts)
     ──► opening_stock → createReceipt sumber opening; opening_* → party_opening_balances + jurnal pembuka
  Laporan (reports.ts) ──► MEMBACA SAJA: journal_lines posted + subledger
     (sales, stock_receipts, party_opening_balances, stock_*, payroll_runs, cash_sessions)
PENGATURAN ──► account_mappings & company_settings dibaca SEMUA jalur jurnal otomatis;
               enabled_modules menggerbang layout + aksi tulis modul
```

**Sifat dependensi:** tidak ada impor melingkar antar-domain yang ditemukan pada penelusuran ekspor; pola konsisten "aksi tipis → domain (tx) → postJournal/stock ledger". Titik kopling terberat: `reports.ts` membaca hampir semua subledger (perubahan skema subledger mana pun berpotensi menyentuhnya), dan `actions/accounting.ts` menampung jurnal + beban + transfer + pembayaran + karyawan + payroll + akun + periode dalam satu berkas 1.544 baris.

---

## 3. Cakupan mandat §3–§9, §12, §14 (di luar HR & master data)

### §3 Procurement & Supplier
- Supplier baru/ubah/nonaktif: **BERFUNGSI** (halaman Pemasok + form edit penuh + hapus berpenjaga).
- Rekening & info pembayaran pemasok: **BELUM ADA** — tabel `suppliers` hanya kode/nama/telepon/email/alamat/catatan + custom fields; termin pembayaran per pemasok juga tidak ada (jatuh tempo utang lahir dari dokumen, bukan termin master).
- Riwayat pembelian per pemasok: **SEBAGIAN** — utang & dokumen per pemasok terbaca di Piutang & Utang; tidak ada halaman riwayat pembelian khusus per pemasok.
- Banding harga pemasok: **BELUM ADA** (lihat 1.3).
- Purchase Request: **BELUM ADA**. PO buat/ubah/batal: **BERFUNGSI** dengan penjaga (batal hanya sebelum penerimaan; ubah pada status draft/sent mengikuti pola dokumen).
- Pembelian tanpa PO, tunai & kredit: **BERFUNGSI** (penerimaan langsung 3 skenario).
- Terima sebagian/seluruh: **BERFUNGSI**; terima melebihi pesanan: **ditolak** oleh domain (keputusan D-6, bukan celah).
- Barang kurang/rusak/ditolak saat terima: **SEBAGIAN** — kurang = terima sebagian; rusak/ditolak tidak punya kolom per baris (D-5 sadar), dialihkan ke penyesuaian/retur pemasok sesudah diterima.
- Terima tanpa supplier: **BERFUNGSI** (sumber non-pembelian, supplier nullable).
- Barang bonus/gratis: **BERFUNGSI** (sumber `bonus`, Cr other_income/pendapatan).
- Retur pembelian: **BERFUNGSI** penuh (RTB, lihat 1.3).
- Invoice supplier: **SEBAGIAN** — nomor invoice dicatat; tidak ada dokumen invoice pemasok tersendiri selain penerimaan, dan tidak ada penjaga duplikat nomor invoice.
- Hutang & pembayaran parsial & pelunasan: **BERFUNGSI**.
- Invoice ganda: **SEBAGIAN** — duplikasi dokumen dicegah idempotensi di jalur sistem, tetapi faktur pemasok bernomor sama bisa dimasukkan dua kali lewat dua penerimaan tanpa peringatan.
- Diskon pembelian & biaya tambahan: **BELUM ADA**.

### §4 Gudang
- Master produk/kategori/SKU/barcode: **BERFUNGSI** (brand & varian & multi-barcode **BELUM ADA**).
- Multi-satuan & konversi: **BELUM ADA** (keputusan D-17 — produk satu satuan dasar; tabel `units` hanya label satuan).
- Terima/keluar/transfer: **BERFUNGSI**. Reservasi: **BELUM ADA**. In-transit: **BELUM ADA**.
- Rusak & hilang: **BERFUNGSI** (tipe penyesuaian berjurnal). Karantina: **BERFUNGSI** (gudang tipe quarantine, perpindahan semantik).
- Penyesuaian + opname: **BERFUNGSI** (+ approval maker-checker). Cycle counting: **SEBAGIAN** (manual, tanpa jadwal).
- Stok minimum: **BERFUNGSI**; reorder recommendation: **BERFUNGSI** (rumus sederhana 2× min — dilabeli jujur di UI).
- Batch & expiry & FEFO: **BERFUNGSI**. Serial: **BELUM ADA**. FIFO biaya: tidak berlaku — metode resmi **AVCO/moving average** global (keputusan A-3); FEFO hanya untuk alokasi batch fisik.
- Kartu stok: **BERFUNGSI**. Valuasi: **BERFUNGSI**. Aging: **BELUM ADA**. Dead stock & fast/slow: **BELUM ADA**.
- Penjaga overselling/stok negatif: **BERFUNGSI** — `allowNegativeStock` adalah pengaturan perusahaan eksplisit; jalur POS/gudang mengunci baris stok `FOR UPDATE`; gerakan tanpa dokumen tidak ada (semua mutasi ber-reference dokumen).

### §5 POS & Kasir
- Tunai/QRIS/transfer/debit-kredit/split: **BERFUNGSI** (kartu = metode bank, lihat catatan 1.2).
- Diskon & promosi: diskon **BERFUNGSI**; promosi terjadwal/kupon **BELUM ADA**.
- Dengan/tanpa pelanggan: **BERFUNGSI** (tanpa pelanggan = bawaan; pelanggan hanya wajib untuk utang D-19 dan penebusan kredit retur berbasis nomor dokumen).
- Hold/resume: **BERFUNGSI**. Pembatalan (void) penjualan berpenjaga retur: **BERFUNGSI**.
- Retur sebagian/penuh, refund, tukar barang: **BERFUNGSI**.
- Cetak nota & cetak ulang: **BERFUNGSI**. "Invoice" penjualan formal (dokumen faktur terpisah dari nota): **SEBAGIAN** — nota POS adalah satu-satunya dokumen penjualan tercetak; tidak ada faktur penjualan B2B tersendiri.
- Buka/tutup kasir, kas masuk/keluar, hitung fisik, selisih: **BERFUNGSI**. Cash drop: **SEBAGIAN** (lihat 1.2).
- Kasir bersamaan & produk sama terjual bersamaan: **BERFUNGSI** — kunci baris stok, klaim hold atomik, indeks unik parsial satu sesi terbuka per pengguna, test balapan ada (`warehouse-race.test.ts`, test konkurensi retur & penebusan kredit).
- Konsistensi pembayaran/stok/HPP/pajak/jurnal: **BERFUNGSI** — quote=checkout satu fungsi, idempotency key wajib, pajak satu tarif perusahaan dari pemetaan.

### §7 Akuntansi menyeluruh
- COA, jurnal umum & otomatis, pendapatan, pembelian, HPP, beban operasional, hutang/piutang, kas masuk/keluar, transfer, rekonsiliasi, uang muka (saldo awal + kasbon), retur, koreksi jurnal, period closing: **BERFUNGSI** (rincian 1.4), dengan pengecualian: beban gaji & BPJS perusahaan **SEBAGIAN** (beban gaji bruto benar; BPJS perusahaan tidak ada komponennya — wilayah S2), kas kecil **SEBAGIAN** (akun 1010 Kas Kecil ada sebagai akun biasa; tidak ada modul petty cash dengan pengisian ulang/imprest), penyusutan aset **BELUM ADA** (akun 1510 Akumulasi Penyusutan ada di COA bawaan, tanpa modul aset), jurnal penutup tahun **SEBAGIAN** (lihat 1.4).
- Laporan yang diminta mandat: P&L ✓, Balance Sheet ✓, Cash Flow ✓, GL ✓, Trial Balance ✓, Journal Report ✓ (daftar jurnal + ekspor), AP ✓, AR ✓, Cash & Bank ✓ (halaman Bank + rekonsiliasi), Inventory Valuation ✓, Stock Movement ✓, Payroll Summary **SEBAGIAN**, Salary Expense ✓ (dari jurnal/COA), Tax Report **BELUM ADA**, Fixed Asset Report **BELUM ADA**, Budget vs Actual **BELUM ADA**.
- Invariant terverifikasi test: debit=kredit dipaksakan `postJournal`; neraca seimbang (identitas diuji termasuk sesudah retur/diskon — perbaikan darurat kontra-pendapatan 4010/4020); nilai stok laporan = GL; HPP dari AVCO; hutang/piutang = saldo dokumen (termasuk alokasi retur); periode terkunci menolak posting (`assertPeriodOpen` di gerbang jurnal tunggal).

### §8 Expense, Petty Cash, Fixed Asset
- Expense operasional (listrik/air/internet/sewa/dll. sebagai akun beban): **BERFUNGSI** sebagai pencatatan beban sederhana. Bukti transaksi/lampiran: **BELUM ADA**. Kategori beban: **SEBAGIAN** (= pilihan akun beban di COA, bukan master kategori terpisah). Persetujuan beban: **BELUM ADA**. Laporan beban: **SEBAGIAN** (daftar beban berpaginasi + P&L).
- Petty cash khusus (dana tetap, pengisian ulang, pertanggungjawaban): **BELUM ADA** sebagai modul; kas kecil hanya akun GL biasa.
- Fixed asset: registrasi, umur manfaat, metode & jadwal penyusutan, akumulasi, perbaikan/pemindahan/pelepasan, laporan nilai buku: **SELURUHNYA BELUM ADA** (hanya akun-akun COA bawaan bertema aset/penyusutan di seed).

### §9 Siklus harian/mingguan/bulanan/tahunan
- Harian (buka shift → terima barang → jual → beban → kasbon → tutup shift → cek stok): **BERFUNGSI** ujung-ke-ujung; dibuktikan e2e simulasi minimarket + test integrasi per kaki. Absensi karyawan pada kaki harian: **BELUM ADA** (itu kaki HR, bukan sistem).
- Mingguan (cek stok, reorder, bayar supplier, rekonsiliasi kas, evaluasi penjualan): **BERFUNGSI** dari fitur-fitur penyusunnya; persetujuan reimbursement **BELUM ADA**; penjadwalan shift **BELUM ADA**.
- Bulanan (payroll, bayar payroll, jurnal gaji, bayar hutang, rekonsiliasi bank, opname, valuasi, closing periode, P&L & neraca): **BERFUNGSI** kecuali komponen pajak gaji/BPJS/THR/penyusutan (belum ada) — payroll bulanan berjalan untuk komponen agregat.
- Tahunan (tutup buku, rekap pajak, rekap gaji tahunan, saldo awal tahun baru): **SEBAGIAN** — saldo awal tahun baru berjalan lewat mekanisme periode + saldo awal; rekap pajak & rekap gaji tahunan **BELUM ADA**; jurnal penutup tahun eksplisit **BELUM ADA**; backup arsip = wilayah S5.

### §12 Offline & kegagalan jaringan
- **BELUM ADA** sebagai mode: tidak ada antrean transaksi offline, tidak ada sinkronisasi, tidak ada resolusi konflik harga/stok lintas perangkat. Yang ada: persistensi keranjang localStorage (transaksi yang sedang disusun selamat dari reload/crash, tetapi belum menjadi penjualan), idempotency key checkout (retry aman saat jaringan putus di tengah submit), dan transaksi DB atomik per dokumen (kegagalan di tengah posting membatalkan seluruhnya). Tabel `outbox` di skema **tidak dipakai kode mana pun** (hanya disebut di daftar tabel seed) — sisa rancangan lama. Keputusan D-10 masih berlaku; mandat SIM-2 §12/§17 menuntut keputusan pemilik baru (sudah dicatat di PROGRESS A-14).

### §14 Cetak dokumen (sudut kelengkapan; audit visualnya sudah tuntas di program cetak)
- Nota ✓, GRN ✓, PO ✓, retur ✓ (RTB + retur penjualan via nota), laporan keuangan ✓, laporan gudang (kartu stok/valuasi bisa dicetak dari halaman laporan? — valuasi & kartu stok tampil di halaman gudang dengan kerangka cetak aplikasi; bukan dokumen Print Engine khusus) **SEBAGIAN**, invoice penjualan formal **SEBAGIAN** (nota saja), bukti pembayaran **BELUM ADA**, bukti kas **SEBAGIAN**, slip gaji **BELUM ADA**.
- Kustomisasi layout/logo/font/header/footer/warna: **BERFUNGSI** (satu template aktif per perusahaan; kolom dokumen tidak bisa diatur per kolom — struktur dokumen tetap).
- Pratinjau = hasil cetak: **BERFUNGSI** (pratinjau Pengaturan memakai kerangka yang sama; pelajaran audit CT — kerangka aplikasi tidak lagi ikut tercetak, kertas thermal benar).

---

## 4. Utang teknis

1. **Tabel `outbox` yatim** (`schema.ts` baris ±1528): tidak ada pembaca/penulis selain daftar nama tabel di seed. Membingungkan pembaca skema dan menyiratkan fitur offline yang tidak ada. Opsi: hapus lewat migrasi atau beri komentar keputusan — jangan dibiarkan ambigu.
2. **Ekspor domain mati**: `reports.listCashSessions` tidak lagi dipanggil halaman mana pun (digantikan `listCashSessionHistory` sejak A-8.3; dipertahankan sadar saat itu agar tidak mematahkan pemakai lain — penelusuran fase ini: pemakai lain tidak ada). Kandidat hapus dengan test.
3. **Dua wizard impor paralel**: `components/gudang/import-wizard.tsx` (901 baris, produk — dengan klasifikasi/edit A-10) dan `import-master-wizard.tsx` (610 baris, master lain) berbagi backend yang sama (parse/analyze/commit) tetapi mengimplementasikan ulang langkah pratinjau & seleksi secara terpisah; perilaku keduanya bisa menyimpang diam-diam (sudah terjadi: filter & edit hanya ada di wizard produk).
4. **Berkas domain sangat besar**: `pos.ts` 2.100 baris, `reports.ts` 2.080, `inventory.ts` 1.889, `supplier-returns.ts` 1.652, `actions/accounting.ts` 1.544 (menampung ±9 subdomain akuntansi termasuk payroll & karyawan), `actions/import.ts` 1.291, `import-masters.ts` 1.260. Bukan cacat fungsi, tetapi biaya perubahan & review naik; `actions/accounting.ts` paling layak dipecah per subdomain mengikuti pola ekstraksi yang sudah dimulai (`expenses.ts`, `bank-transfers.ts`, `payables.ts` diekstrak dari action pada A-12).
5. **Pola menyimpang yang tersisa**: (a) `categories` punya indeks unik `(company_id, name)` datar — nama subkategori yang sama tidak bisa dipakai di bawah dua induk berbeda (bertabrakan dengan model bertingkat; wilayah agen master data, dicatat di sini sebagai temuan skema); (b) tanggal pembayaran & tanggal dokumen memakai `date` lokal tanpa zona waktu konsisten di beberapa jalur historis — sudah diperbaiki untuk pembayaran (Batch C Tahap 1), pola sejenis perlu diawasi; (c) dua sumber label status dokumen (badge bersama vs string lokal) pernah menyimpang — kini terpusat di `status-badge.tsx` untuk status baru, tetapi label lama tersebar di halaman masing-masing.
6. **Skema & migrasi — keadaan sehat**: 27 migrasi aditif berurutan (satu pengecualian tercatat D-15 pada 0000); setiap tabel bisnis ber-`company_id`; kebijakan RLS `tenant_isolation` terpasang lewat migrasi 0001 + migrasi fitur (34 pernyataan kebijakan di 10 berkas migrasi) dan dinyatakan lolos uji RLS (app_user tanpa konteks melihat 0 baris); tabel framework Better Auth (user/session/account/verification/organization/member/invitation/twoFactor) berada di luar RLS tenant secara desain (diakses lewat lapisan auth, bukan `withCompany`). Indeks kunci sehat: jurnal (company+number unik, company+idempotency unik, company+date, company+source), baris jurnal (entry, company+account), gerakan stok (company+product+created, company+warehouse+created, company+ref), produk (SKU & barcode unik per perusahaan, trigram nama). Indeks unik parsial yang penting: payroll per periode (non-void), satu sesi kas terbuka per pengguna.
7. **Kesiapan pengembangan**: fondasi siap untuk fase SIM-2 — gerbang jurnal/stok tunggal, pemetaan akun sebagai mesin konfigurasi, pola dokumen (nomor seri + status + void beralasan) konsisten di semua modul; menambah dokumen baru (mis. Purchase Request, aset tetap) mengikuti pola yang sudah terbukti. Risiko terbesar bukan fondasi, melainkan lebar permukaan: menambah modul HR penuh menyentuh `actions/accounting.ts` yang sudah gemuk (lihat butir 4).

---

## 5. Ringkasan eksekutif — 10 temuan terpenting untuk fase remediasi

1. **Tidak ada satu pun fitur MOCK.** Semua yang tampil di UI terhubung ke domain + jurnal/stok nyata dan sebagian besar teruji (baseline 590/590). Risiko program ini bukan "fitur palsu", melainkan **fitur yang memang belum dibangun** pada daftar di bawah.
2. **HR masih embrio.** Master karyawan hanya 8 kolom fungsional; tidak ada absensi/shift/cuti/lembur, kontrak, departemen, NIK/NPWP. Payroll berjalan untuk komponen agregat (pokok + satu angka tunjangan − satu angka potongan + kasbon). Ini celah terbesar terhadap mandat §6 dan prasyarat Fase S2.
3. **Payroll Indonesia belum ada sama sekali**: PPh 21/TER, BPJS Kesehatan & Ketenagakerjaan, THR, lembur terhitung, upah minimum — tidak ada tarif, tabel, maupun komponen terstruktur di skema. Harus dibangun sebagai mesin konfigurasi (tarif tidak boleh hardcode) di Fase S2 sesudah riset regulasi resmi.
4. **Offline POS tetap BELUM ADA dan kini menjadi keputusan pemilik yang eksplisit** (mandat §12/§17 vs keputusan lama D-10). Tabel `outbox` yatim memperkeruh keadaan — putuskan bangun atau hapus jejaknya; jangan biarkan status ambigu masuk laporan akhir.
5. **Aset tetap & penyusutan: nol.** Tidak ada registrasi aset, jadwal penyusutan, maupun laporan nilai buku — hanya akun COA bertema aset di seed. Mandat §8 tidak terpenuhi sama sekali di kaki ini.
6. **Master produk belum setara ERP acuan**: tidak ada brand, varian, multi-barcode, multi-satuan/konversi (D-17), stok maksimum/reorder point mandiri, maupun akun per produk. Untuk minimarket satu-satuan ini cukup; untuk klaim "fleksibel lintas bisnis" ini daftar kerja Fase S3.
7. **Procurement belum lengkap di tepinya**: Purchase Request tidak ada; termin & rekening pemasok tidak ada di master; banding harga pemasok tidak ada; diskon pembelian/biaya tambahan penerimaan tidak ada; nomor invoice pemasok tanpa penjaga duplikat; penerimaan tanpa kolom rusak/ditolak per baris (dialihkan, bukan hilang).
8. **Analitik persediaan berhenti di valuasi & kartu stok**: stock aging, dead stock, fast/slow moving, dan reservasi stok semuanya BELUM ADA; transfer tidak mengenal in-transit; cycle count tanpa jadwal. Data mentahnya (stock_movements bertanggal + batch berkedaluwarsa) sudah lengkap untuk membangunnya tanpa migrasi besar.
9. **Dokumen pendukung uang belum tercetak**: slip gaji, bukti pembayaran hutang/piutang, dan faktur penjualan formal (di luar nota) tidak punya permukaan cetak — padahal Print Engine-nya sudah matang dan teruji; ini pekerjaan murah berdampak nyata untuk Fase remediasi.
10. **Utang teknis terkonsentrasi, bukan menyebar**: dua wizard impor paralel, `actions/accounting.ts` 1.544 baris multi-subdomain, satu ekspor mati (`listCashSessions`), dan tabel `outbox` yatim. Fondasi (RLS, indeks, gerbang jurnal/stok tunggal, 27 migrasi aditif) dalam keadaan sehat dan **tidak** membutuhkan rewrite — sesuai perintah mandat.

*Status keseluruhan untuk cakupan S0-A: inti transaksi (POS–Gudang–Akuntansi–Procurement–Impor–Cetak) BERFUNGSI dan terintegrasi; celah terkonsentrasi di HR/Payroll Indonesia, aset tetap, offline, dan analitik persediaan lanjutan.*
