# SIM-2 Fase S0-B — Audit Master Data Management (mandat §18)

Status: **BACA-SAJA** — tidak ada kode/data yang diubah. Bukti dari: `src/db/schema.ts`,
server actions (`src/server/actions/*.ts`), domain (`src/server/*.ts`), halaman UI,
rute ekspor/impor, dan kueri SELECT atas DB dev lokal (PG18 :5433, db `bisa`,
dijalankan sebagai owner — RLS tidak berlaku untuk pemeriksaan ini).

Catatan konteks DB: DB dev berisi perusahaan demo hasil seed **dan** banyak perusahaan
fixture test (id `01900000-…`). Angka kualitas data di §5 dibaca lintas semua perusahaan
dan diberi label mana yang berasal dari fixture test.

Legenda matriks: ✅ ada & terbukti di kode · ◐ sebagian/terbatas · ❌ tidak ada ·
**Unik-DB** = indeks unik PostgreSQL · **Validasi** = hanya pemeriksaan aplikasi.

---

## 1. Matriks per entitas master

Kolom: C=Create, V=View/List+Detail, E=Edit, Dup=Duplicate/Copy, Arc=Archive,
A/D=Activate/Deactivate, Res=Restore, Imp=Import, Exp=Export, BulkE=Bulk Edit,
BulkD=Bulk Delete berpenjaga, Hist=Change History (audit_log benar-benar ditulis),
QEdit=Quick/Inline Edit, Cari=Search/Filter/Sort/Pagination.

| Entitas | C | V | E | Dup | Arc | A/D | Res | Imp | Exp | BulkE | BulkD | Hist | QEdit | Cari/Filter/Sort/Paginasi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Produk | ✅ | ✅ list + detail `/gudang/produk/[id]` | ✅ form penuh | ❌ | ❌ (nonaktif sbg pengganti) | ✅ toggle | ✅ (=aktifkan lagi) | ✅ wizard produk | ❌ **tidak ada endpoint ekspor master produk** | ❌ | ❌ (hapus per baris berpenjaga) | ✅ create/update/delete/toggle teraudit | ❌ (hanya di wizard impor) | ✅ server-side: cari nama/SKU/barcode, filter kategori (inkl. keturunan) + stok menipis, paginasi 30; **sort tetap nama ASC** |
| Kategori | ✅ | ✅ manajer taksonomi | ✅ | ❌ | ❌ | ✅ toggle (beranak aktif ditolak) | ✅ | ❌ | ❌ | ❌ | ❌ (hapus per item berpenjaga) | ✅ create/update/delete/activate/deactivate | ◐ via manajer taksonomi | n/a (daftar kecil dimuat semua; bertingkat `parent_id` + anti-siklus) |
| Brand | ❌ **entitas tidak ada** (tidak ada tabel/kolom brand) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Satuan (units) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ toggle | ✅ | ❌ | ❌ | ❌ | ❌ (hapus berpenjaga) | ✅ | ◐ manajer taksonomi | n/a (dimuat semua) |
| Supplier | ✅ | ◐ list di `/gudang/pemasok` (tab Mitra); **tidak ada halaman detail** | ✅ form | ❌ | ❌ | ✅ toggle | ✅ | ✅ wizard master | ✅ CSV `/api/export/suppliers` | ❌ | ❌ (hapus per baris berpenjaga) | ◐ **hanya delete & deactivate teraudit; create/update TIDAK ditulis ke audit_log** | ❌ | ❌ listSuppliers memuat semua (tanpa paginasi/pencarian) |
| Customer | ✅ (form + tambah cepat POS) | ◐ list di halaman Mitra yang sama; **tidak ada halaman detail** | ✅ form | ❌ | ❌ | ✅ toggle | ✅ | ✅ wizard master | ✅ CSV `/api/export/customers` | ❌ | ❌ (hapus per baris berpenjaga) | ◐ **hanya delete & deactivate teraudit; create/update TIDAK teraudit** | ❌ | ❌ dimuat semua |
| Kelompok pelanggan + aturan harga | ✅ | ✅ di Pengaturan | ✅ | ❌ | ❌ | ✅ isActive | ✅ | ❌ | ❌ | ❌ | ◐ hapus kelompok (pelanggan di-null-kan grupnya, teraudit) | ✅ | ◐ edit aturan harga per produk dari halaman kelompok | n/a |
| Karyawan (employees) | ✅ form di panel Payroll | ◐ list di halaman Payroll & Kasbon; detail per karyawan hanya di Kasbon (`/akuntansi/kasbon/[employeeId]`) | ✅ (nama, jabatan teks bebas, gaji pokok, tunjangan, potongan tetap, tgl masuk, isActive) | ❌ | ❌ | ✅ via field isActive di form | ✅ | ❌ | ❌ (ekspor payroll = laporan, bukan master) | ❌ | ❌ **tidak ada aksi hapus karyawan sama sekali** | ◐ 1 event `employee` di actions (payroll) — cakupan create/update tidak seluas produk | ❌ | ❌ dimuat semua (aktif saja utk payroll) |
| Departemen / Jabatan | ❌ **tidak ada entitas** — `employees.position` teks bebas, tidak ada tabel departemen/jabatan | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Gudang | ✅ | ✅ Pengaturan | ✅ | ❌ | ❌ | ✅ toggle (teraudit) | ✅ | ❌ | ❌ | ❌ | ❌ (hapus per item, penjaga sangat lengkap) | ✅ | ❌ | n/a (dimuat semua) |
| Cabang (branches) | ✅ | ✅ Pengaturan | ✅ | ❌ | ❌ | ◐ kolom `is_active` ada; **tidak ada aksi toggle cabang** (hanya save) | — | ❌ | ❌ | ❌ | ❌ **tidak ada aksi hapus cabang** | ◐ save tidak selalu teraudit (lihat settings actions) | ❌ | n/a |
| COA (accounts) | ✅ | ✅ `/akuntansi/akun` | ✅ (tipe akun bertransaksi dikunci) | ❌ | ❌ | ✅ isActive via form | ✅ | ✅ wizard master `accounts` | ✅ CSV `/api/export/accounts` (dapat diimpor balik) | ❌ | ❌ (hapus per item, penjaga terlengkap: jurnal/sub-akun/pemetaan/metode bayar/akun diskon) | ✅ (create/update/delete; `account` 68 event delete terverifikasi di DB) | ❌ | ◐ daftar akun dimuat per halaman akun (bukan paginasi server umum) |
| Pemetaan akun (account_mappings) | — | ✅ Pengaturan | ✅ `saveMappingAction` tervalidasi ke daftar kunci resmi | — | — | — | — | ❌ | ❌ | — | — | ✅ (`company_settings`/mapping events) | ❌ | 23 kunci resmi (lihat §7) |
| Kategori beban | ❌ **tidak ada entitas kategori beban** — beban menunjuk langsung akun beban COA (`expenses.expense_account_id`) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Metode pembayaran | ✅ | ✅ Pengaturan tab pembayaran | ✅ **CRUD penuh (A-8.2)**: edit (kode terkunci), nonaktif, hapus berpenjaga transaksi | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ update/activate/delete teraudit | ❌ | n/a |
| Akun kas/bank | ◐ = akun COA berkunci pemetaan `cash`/`bank`/`qris` — bukan entitas tersendiri | ✅ | ✅ via COA + pemetaan | — | — | ✅ | — | — | ◐ via ekspor COA | — | — | ✅ | ❌ | — |
| Pajak & tarif | ◐ **satu tarif tunggal per perusahaan** (`company_settings.tax_rate`) + pemetaan `tax_output` (2200). Tidak ada tabel tarif pajak bertanggal/multi-tarif; tidak ada `tax_input` (PPN masukan tidak diposting domain beban — dicatat jujur di A-12) | ✅ Pengaturan | ✅ | — | — | — | — | ❌ | ❌ | — | — | ✅ via settings | ❌ | — |
| Price list | ◐ **bukan price list umum** — yang ada: harga jual tunggal per produk + aturan harga per **kelompok pelanggan** (`customer_group_prices`: percent/fixed per produk) + pembulatan kelompok. Tidak ada price list bernama/bertanggal/multi-mata-uang | ✅ | ✅ | ❌ | — | ✅ grup aktif/nonaktif | — | ❌ | ❌ | ❌ | ❌ | ✅ | ◐ | — |
| Diskon & promosi | ◐ diskon = aturan kelompok (di atas) + diskon manual POS berambang izin. **Tidak ada entitas promosi** (periode, kupon, beli-X-dapat-Y) | — | — | — | — | — | — | — | — | — | — | ◐ | — | — |
| Shift & jadwal kerja | ❌ **tidak ada** (sesi kas POS ada; shift karyawan/jadwal tidak ada) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Komponen gaji | ◐ **bukan master komponen** — tiga angka per karyawan (`base_salary`, `allowances`, `deductions`) + potongan kasbon terpisah. Tidak ada katalog komponen pendapatan/potongan yang bisa ditambah per perusahaan | ◐ | ✅ per karyawan | — | — | — | — | ❌ | ❌ | ❌ | — | ◐ | ❌ | — |
| Aset tetap & kategori aset | ❌ **tidak ada** (tidak ada tabel aset/penyusutan; akun aset di COA saja) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Cost center | ❌ **tidak ada** (tidak ada kolom cost center di jurnal/dokumen) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Perusahaan & pengguna/peran | ✅ multi-perusahaan (Better Auth organization) + pemilih perusahaan | ✅ Pengaturan → Pengguna | ✅ peran anggota, reset sandi, hapus anggota berpenjaga owner-terakhir | ❌ | — | ◐ nonaktif pengguna tidak ada; hapus anggota ada | — | ❌ | ❌ | ❌ | ❌ | ✅ user/member/role teraudit (A-13) | ❌ | ◐ peran kustom (`company_roles`) CRUD + hapus berpenjaga |
| Custom fields | ✅ definisi per perusahaan utk produk/supplier/customer | ✅ Pengaturan | ✅ | — | — | — | — | ◐ nilai ikut impor bila kolom dipetakan | ❌ | — | — | ✅ settings teraudit | — | tipe: teks/angka/tanggal/pilih (validasi `src/lib/custom-fields.ts`) |

### Keunikan & kolom wajib (bukti skema)

| Entitas | Wajib (NOT NULL) | Keunikan ditegakkan DB |
|---|---|---|
| Produk | sku, name | `products_company_sku_uq` (company, sku); `products_company_barcode_uq` (company, barcode) — **barcode boleh NULL berulang** (NULL tidak berbenturan di indeks unik PG); barcode string kosong `''` akan berbenturan — form/impor menormalkan kosong→NULL (terverifikasi: 0 baris barcode `''` di DB) |
| Supplier/Customer | code, name | `(company, code)` unik-DB; **nama tidak unik** — duplikat nama sah secara skema |
| Kategori | name | `(company, name)` unik-DB — benturan nama kategori antar-induk pun ditolak (nama global per perusahaan, bukan per induk) |
| Satuan | code, name | `(company, code)` unik-DB |
| Gudang/Cabang | code, name | `(company, code)` unik-DB |
| COA | code, name, type, normal_balance | `(company, code)` unik-DB |
| Metode bayar | code, name, type | `(company, code)` unik-DB |
| Karyawan | code, name | `(company, code)` unik-DB |
| Kelompok pelanggan | name | `(company, name)` unik-DB |

**Catatan integritas referensial penting:** sebagian besar kolom relasi master **bukan
FK database** — `products.category_id/unit_id/supplier_id`, `customers.group_id`,
`sales.customer_id`, `stock_receipts.supplier_id`, `stock_on_hand.product_id/warehouse_id`
adalah `uuid` polos tanpa `.references(...)`. Yang ber-FK sungguhan antara lain
`journal_lines → accounts/entries`, `sale_lines → sales`, `customer_group_prices → groups/products`,
baris-baris dokumen → dokumen induknya, `categories.parent_id` (self-FK sejak 0021).
Konsekuensinya: integritas master dijaga penjaga aplikasi (pola CONFLICT saat hapus),
bukan oleh database — lihat temuan yatim di §5.

---

## 2. Product master khusus (§18C)

| Field mandat §18C | Status | Bukti |
|---|---|---|
| Nama, SKU unik, barcode tunggal | ✅ | `products.name/sku/barcode`; unik-DB SKU & barcode |
| **Banyak barcode per produk** | ❌ | satu kolom `barcode`; tidak ada tabel barcode alias |
| Kategori | ✅ bertingkat | `category_id` + `parent_id` anti-siklus (D-17) |
| **Brand** | ❌ | tidak ada |
| **Variasi produk** (ukuran/warna dll.) | ❌ | tidak ada tabel varian/atribut varian (custom fields bukan varian stok) |
| Gambar produk | ◐ | kolom `image_url` ada di skema; **form produk tidak menampilkan field gambar** (grep form: tidak ada input imageUrl) — hanya bisa terisi via jalur lain |
| Deskripsi | ◐ | tidak ada kolom deskripsi produk; yang ada `notes` (catatan internal) |
| Satuan pembelian / persediaan / penjualan terpisah | ❌ | satu `unit_id` per produk |
| **Konversi satuan** | ❌ | **keputusan tercatat D-17: TIDAK dibangun** (mengubah matematika POS/penerimaan/stok) |
| Harga beli | ✅ | `cost_price` — **AVCO berjalan global per produk**, diperbarui penerimaan `purchase`; bukan sekadar field master statis |
| Harga jual | ✅ | `sale_price` |
| Harga grosir | ◐ | dicapai lewat aturan harga kelompok (`fixed`/`percent`), bukan field grosir per produk |
| **Multiple price lists** | ◐ | kelompok pelanggan ≈ price list per segmen; tidak ada price list bernama bebas/efektif-bertanggal |
| Supplier default | ✅ | `supplier_id` ("Pemasok utama" di form) |
| Kode produk supplier | ❌ | tidak ada kolom kode produk versi pemasok |
| Stok minimum | ✅ | `min_stock` (global per produk — keputusan D-4: bukan per gudang) |
| Stok maksimum | ❌ | tidak ada `max_stock` |
| Reorder point | ◐ | tidak ada kolom terpisah; rekomendasi pembelian memakai aturan `2 × minStock − stok` (D-6) yang dilabeli jujur di UI |
| Lokasi default (bin/rak) | ❌ | tidak ada kolom lokasi/bin; gudang bertipe saja (warehouse/store/quarantine) |
| Batch & kedaluwarsa | ✅ | `track_batch` opt-in per produk, `stock_batches` + FEFO + blokir jual kedaluwarsa (D-7) |
| **Nomor seri** | ❌ | batch ya, serial per unit tidak |
| Status produk | ◐ | `is_active` saja — tidak ada draft/archived |
| Akun persediaan/HPP/pendapatan per produk | ❌ | akun ditentukan **pemetaan perusahaan** (inventory/cogs/revenue), bukan per produk/kategori |
| Custom fields produk | ✅ | `attributes` jsonb dari definisi perusahaan (T5-2/D-16) |

### Snapshot transaksi (§18J) — bukti skema baris dokumen

- ✅ **Penjualan (POS)**: `sale_lines` menyimpan `product_name`, `product_sku`,
  `unit_price`, `unit_cost`, `tax_rate`, `discount_amount`, `line_total` — dokumen
  historis **tidak berubah** saat master produk diedit. `sale_return_lines` juga
  menyimpan `product_name` + harga/biaya asal.
- ◐ **Dokumen gudang & pembelian**: `purchase_order_lines`, `stock_receipt_lines`,
  `stock_document_lines`, `supplier_return_lines` menyimpan `product_id` + qty +
  **`unit_cost`/`unit_price` yang dibekukan saat posting** (nilai uang aman), tetapi
  **tanpa snapshot nama/SKU** — nama yang tampil di dokumen lama dibaca dari master
  saat ini (join), jadi mengganti nama produk mengubah tampilan dokumen historis
  (angkanya tidak). Risiko presentasi, bukan risiko angka.
- ✅ Jurnal: baris jurnal menyimpan akun + nominal; nama akun dibaca dari COA saat
  laporan dirender (pola yang sama — mengganti nama akun mengubah label historis,
  bukan angka).

---

## 3. Supplier & Customer (§18D)

| Aspek mandat | Supplier | Customer |
|---|---|---|
| Kode unik, nama, alamat, telepon, email, catatan | ✅ semua ada | ✅ semua ada |
| NPWP / NIK | ❌ tidak ada kolom NPWP/NIK di kedua tabel (bisa ditampung custom fields perusahaan, tidak tervalidasi format) | ❌ sama |
| Rekening pembayaran | ❌ tidak ada kolom bank/rekening | n/a |
| Termin pembayaran (hari) | ❌ tidak ada kolom termin; jatuh tempo utang dihitung per dokumen | ❌ tidak ada |
| Batas kredit | n/a | ✅ `credit_limit` ditegakkan POS utang (D-19; 0 = tanpa batas) |
| Kategori/tipe pihak | ❌ tidak ada tipe/kategori supplier/customer (customer punya kelompok harga) | ◐ kelompok pelanggan |
| Lampiran dokumen | ❌ | ❌ |
| Halaman detail + riwayat transaksi + saldo per pihak | ❌ **tidak ada halaman detail pihak**. Riwayat hidup di daftar global (penerimaan/PO/penjualan berpaginasi) dan saldo hidup di daftar Piutang/Utang agregat (`listReceivables`/`listPayables` + aging), bukan per halaman pihak | ❌ sama |
| Deteksi duplikat | ◐ saat **impor**: duplikat nama/kode di file ditandai, kode yang sudah ada dilewati. Di **form manual**: hanya kode unik-DB yang menolak; nama sama persis bisa dibuat berulang tanpa peringatan | ◐ sama |
| **Merge records** | ❌ **tidak ada** di seluruh kode (tidak ada fungsi merge pihak/master mana pun) | ❌ |

---

## 4. Search / Filter / Sort / Pagination (§18F) — keadaan nyata

- **Produk**: satu-satunya master dengan paginasi server-side penuh + pencarian
  trigram (`products_company_name_trgm_idx`, GIN `pg_trgm`) + filter kategori
  keturunan + filter stok menipis. Sort **tidak bisa dipilih** (nama ASC tetap).
- **Dokumen/riwayat** (penerimaan, PO, dokumen stok, penjualan, sesi, jurnal,
  buku besar): berpaginasi server-side (pola `list*History`), beberapa dengan
  pencarian (pergerakan stok: nama/SKU/nomor referensi).
- **Supplier, customer, karyawan, akun, gudang, cabang, satuan, kategori, metode
  bayar, kelompok**: daftar **dimuat semua** ke halaman (jumlah master kecil–menengah
  masih aman, tetapi klaim "ratusan ribu record" di §18F **tidak terpenuhi** untuk
  entitas-entitas ini).
- **Saved views, kolom tampil/sembunyi yang bisa diatur, filter lanjutan
  multi-kondisi, ekspor mengikuti filter aktif**: ❌ tidak ada untuk master mana pun.
  Ekspor CSV selalu **seluruh perusahaan** (bukan hasil filter).

---

## 5. Data quality (§18G) — bukti kueri SELECT atas DB dev

Terbukti dari **data** (DB `bisa`, semua perusahaan termasuk fixture test):

| Pemeriksaan | Hasil | Interpretasi |
|---|---|---|
| SKU duplikat per perusahaan | **0** | indeks unik bekerja |
| Barcode (non-NULL) duplikat | **0** | indeks unik bekerja |
| Kode akun/kategori duplikat | **0 / 0** | indeks unik bekerja |
| Nama supplier duplikat | **0** | bersih |
| Nama customer duplikat | **2 kelompok** — "Pelanggan QE" ×6 dan "Pelanggan QE B" ×6 | **fixture test** (kode `CUST-QE-<timestamp>` dari test Quick Entry), bukan data demo; membuktikan nama memang bisa berduplikat tanpa peringatan |
| Produk tanpa barcode (NULL) | **1.055 dari 1.120** | mayoritas berasal dari perusahaan fixture impor/bulk (seed `db:seed:bulk` 10.000 produk & test impor); demo hasil seed normal jauh lebih kecil. Barcode kosong **sah** di sistem (bukan error — A-10) |
| Produk harga jual & beli sama-sama 0 | **1** | satu baris — layak ditandai laporan kualitas data |
| Produk yatim kategori/satuan/supplier | **0 / 0 / 0** | penjaga aplikasi bekerja pada data yang ada |
| Customer yatim kelompok | **0** | bersih |
| Penjualan yatim customer; penerimaan yatim supplier | **0 / 0** | bersih |
| **`stock_on_hand` yatim produk** | **32 baris** di perusahaan fixture `01900000-…-0001`, qty ≠ 0, produknya **tidak ada sama sekali** di `products` | yatim sungguhan: `stock_on_hand` tanpa FK ke produk; produk fixture dihapus langsung (jalur test/SQL) tanpa membersihkan stok. Di jalur UI mustahil (penjaga hapus produk menolak), tetapi **database tidak mencegahnya** |
| audit_log total | 7.611 baris; product 543, supplier 64, customer 64, account 68 event | audit hidup & terisi |

Terbukti dari **skema** (bukan data):

- Duplikat dicegah DB hanya untuk **kode** (SKU, barcode, kode pihak/akun/gudang/
  satuan, nama kategori/kelompok). Duplikat **nama** pihak, duplikat **nomor telepon/
  email**, dan kemiripan nama (fuzzy) **tidak dideteksi di mana pun** di luar analisis
  impor.
- Tidak ada validasi format telepon/NPWP/email di luar `z.string().max(...)` pada
  form pihak (email customer/supplier bahkan tidak memakai `.email()` di skema
  `saveCustomerAction`/`saveSupplierAction` — hanya batas panjang).
- Tidak ada laporan/ halaman "kualitas data" (data wajib kosong, yatim, duplikat)
  di UI mana pun.

---

## 6. Lifecycle (§18J)

| Entitas | Draft | Active | Inactive | Archived | Hapus berpenjaga |
|---|---|---|---|---|---|
| Produk | ❌ | ✅ | ✅ `is_active` | ❌ (nonaktif = arsip de facto) | ✅ sangat lengkap: stok>0, pergerakan, penjualan, penerimaan, dokumen, aturan harga — semua menolak dengan arahan nonaktifkan |
| Supplier/Customer | ❌ | ✅ | ✅ | ❌ | ✅ penerimaan/dokumen/produk-utama (supplier); penjualan & saldo (customer — pola sama) |
| Kategori/Satuan | ❌ | ✅ | ✅ | ❌ | ✅ (kategori beranak aktif & satuan terpakai dilindungi; pola taxonomy delete) |
| Gudang | ❌ | ✅ | ✅ | ❌ | ✅ terlengkap (default/stok/pergerakan/penjualan/dokumen) |
| Cabang | ❌ | ✅ | ◐ kolom ada, **tanpa aksi/UI toggle** | ❌ | ❌ tidak ada aksi hapus |
| COA | ❌ | ✅ | ✅ | ❌ | ✅ terlengkap (lihat §1) |
| Metode bayar | ❌ | ✅ | ✅ | ❌ | ✅ dipakai transaksi → tolak |
| Karyawan | ❌ | ✅ | ✅ | ❌ | ❌ tidak ada hapus (aman utk histori payroll, tetapi juga tanpa jalur arsip formal) |
| Kelompok pelanggan | ❌ | ✅ | ✅ | ❌ | ◐ hapus meng-nol-kan grup pelanggan |
| Perusahaan | — | ✅ | ❌ | ❌ | — |

Tidak ada status **archived** yang berbeda dari inactive di entitas mana pun, dan
tidak ada **tanggal efektif** untuk perubahan master (harga/kode berubah seketika;
dokumen lama terlindungi hanya oleh snapshot harga — lihat §2).

---

## 7. Configuration Center (§18K)

**Sudah configurable (terbukti di `company_settings` + Pengaturan, tervalidasi + izin):**

- Penomoran dokumen per jenis (awalan + padding, `document_numbering` — AK-P3-07).
- Custom fields produk/supplier/customer (definisi + nilai, D-16).
- Pemetaan akun: 23 kunci resmi (`cash, bank, qris, receivable, supplier_credit,
  employee_receivable, inventory, payable, revenue, sales_discount, sales_return,
  cogs, inventory_shrink, damaged, tax_output, rounding_gain/loss, cash_short/over,
  salary_expense, salary_payable, bank_fee, equity, customer_credit`) — divalidasi
  ke daftar resmi saat disimpan.
- Metode pembayaran CRUD penuh; kelompok harga pelanggan + aturan per produk.
- Pajak: tarif tunggal perusahaan + akun PPN keluaran terpetakan.
- Template cetak (3 template, logo URL, warna aksen, font, teks kop/kaki, kertas
  nota & dokumen, tanda tangan, QR — Print Engine D-13).
- Saklar modul per perusahaan (POS/Gudang/Akuntansi, D-16).
- Ambang persetujuan penyesuaian stok (maker-checker, D-17) & ambang diskon
  manual POS (D-10); mode pembulatan perusahaan.
- Peran kustom + matriks izin per modul (company_roles).
- Gudang default,izinkan stok negatif, mata uang/timezone/locale (kolom ada).

**Belum configurable:**

- ❌ Dropdown kustom generik (selain custom fields bertipe pilih per entitas).
- ❌ Form layout / susunan field formulir.
- ❌ Required/optional fields per perusahaan (kewajiban field terkunci skema Zod).
- ❌ Default values per perusahaan untuk form master (selain gudang default).
- ❌ Approval workflow generik (hanya penyesuaian stok yang berapproval).
- ❌ Price list bertanggal efektif; tarif pajak multi/bertanggal; termin pihak.
- ❌ Status dokumen kustom & form builder generik — **keputusan tercatat D-16:
  sengaja TIDAK dibangun** (status = enum penjaga integritas).

---

## 8. Impor & Ekspor master (§18H)

**Impor** (kerangka jobs/rows bersama, CSV **dan XLSX** — SheetJS di
`/api/import/parse`, maks 25.000 baris):

- Entitas: `products`, `suppliers`, `customers`, `accounts`, `opening_stock`,
  `opening_payables`, `opening_receivables`. **Tidak ada** impor karyawan, gudang,
  cabang, kategori/satuan (kategori/satuan produk dibuat otomatis? — pemetaan kolom
  produk menerima nama kategori/satuan; lihat wizard produk), metode bayar.
- Alur: unggah → pemetaan kolom (deteksi header + delimiter) → analisis per baris
  (isu tersimpan) → pratinjau berpaginasi & tersaring → commit.
- Produk (A-10/D-21): filter berhitungan (barcode kosong, harga kosong, duplikat
  dalam berkas & katalog), pilih massal per filter, **edit baris di tempat** dengan
  analisis ulang server; commit memvalidasi ulang penuh. `updateExisting` per SKU
  tersedia (stok awal ikut diposting & anti-ganda sejak G2).
- Master (pihak/akun): duplikat nama/kode **di dalam file** ditandai (baris pertama
  dipakai); kode yang sudah ada di DB → **dilewati** ("Kode sudah ada — akan
  dilewati"), **bukan** diperbarui — impor master bersifat create-only.
- Per baris: status imported/skipped/error + alasan; baris gagal tidak menghentikan
  batch (commit parsial sah). **Retry baris gagal**: tidak ada tombol retry khusus —
  baris error tetap di job dan pengguna memperbaiki lewat unggah ulang/edit
  (produk). **Rollback per batch impor**: ❌ tidak ada (koreksi = void/hapus manual;
  job ter-commit bahkan ditolak untuk dibatalkan dengan ringkasan dampak — G5a).
- Template contoh CSV per entitas dapat diunduh (`/api/import/template/[entity]`).
- Round-trip master: ekspor COA/pihak berbentuk CSV berbahasa Indonesia yang
  **dirancang dapat diimpor kembali** (komentar eksplisit di rute ekspor akun);
  produk **tidak punya ekspor**, jadi round-trip produk mustahil saat ini.

**Ekspor** (semua CSV, selalu seluruh perusahaan, berizin):

- `/api/export/accounts`, `/customers`, `/suppliers`, `/inventory` (valuasi stok,
  bukan master produk), `/journal/[id]`, `/ledger`, `/report`.
- ❌ Ekspor master produk, karyawan, gudang/cabang, metode bayar, kelompok harga.
- ❌ Ekspor terfilter / mengikuti filter halaman; ❌ format XLSX untuk ekspor.

---

## 9. Audit trail (§18I)

- Tabel `audit_log` (company, user, action, entity_type, entity_id, **before &
  after jsonb**, request_id, ip, created_at) + `writeAudit` dipakai luas:
  ±110 titik pemanggilan di 19 berkas server; entitas terverifikasi di DB:
  product, category, unit, supplier, customer, account, warehouse, payment_method,
  company_role, user, member, stock_document, stock_receipt, purchase_order,
  sale, sale_return, supplier_return, payroll_run, employee_advance, expense,
  bank_transfer, party_payment, party_opening_balance, journal_entry,
  fiscal_period, import_job, cash_session, company_settings, customer_group(_price).
- **Celah terbukti**: `saveSupplierAction` & `saveCustomerAction` (create **dan**
  update pihak) **tidak memanggil writeAudit** — di DB hanya ada
  `supplier/customer.deactivate` & `.delete`. Mengubah nama/alamat/kontak/batas
  kredit pihak **tidak meninggalkan jejak** siapa & kapan. (Produk sebaliknya
  lengkap: create/update/delete/toggle.)
- Sumber perubahan (manual/impor/API) tidak dibedakan sebagai kolom khusus;
  impor tercatat per job (`import_job` events), bukan per baris master hasil impor.
- Alasan perubahan (reason) hanya ada di alur void/approval tertentu, bukan di
  edit master umum.
- Tidak ada **halaman penampil audit trail per record** di UI (data ada di DB;
  pengguna tidak bisa melihat riwayat perubahan sebuah produk/pihak dari aplikasi).

---

## 10. Rekomendasi prioritas untuk Fase S3

Urutan berdasarkan nilai × keamanan (semua mengikuti pola repo yang ada):

1. **Ekspor master produk (CSV)** — meniru persis rute ekspor akun/pihak yang ada;
   membuka round-trip produk. Kecil, aman, membuka §18H. Sertakan semua kolom
   master + nama kategori/satuan/supplier.
2. **Audit untuk create/update supplier & customer** — dua `writeAudit` di
   `saveSupplierAction`/`saveCustomerAction` (before/after), menyamai produk.
   Menutup celah §18I termurah dan paling memalukan.
3. **Penampil riwayat perubahan per record** — halaman/drawer membaca
   `audit_log` per (entity_type, entity_id) untuk produk, pihak, akun. Data sudah
   ada; murni baca.
4. **Bulk edit produk terbatas & berpreview** — pilih banyak (checkbox + pilih
   semua hasil filter daftar produk yang sudah berpaginasi) → terapkan satu dari:
   ubah kategori, aktif/nonaktif massal, naik/turun harga jual % atau nominal,
   ubah stok minimum, ganti pemasok utama. Wajib: pratinjau sebelum→sesudah +
   jumlah terdampak + konfirmasi + satu `writeAudit` per batch (bukan per baris)
   + penjaga izin `inventory.manage`. Ini mandat §18B/E yang paling sering dipakai
   (contoh pengguna: +5% harga 200 produk).
5. **Deteksi duplikat pihak di form & daftar** — peringatan (bukan penolakan) saat
   nama/telepon pihak baru mirip yang sudah ada + halaman daftar calon duplikat
   (nama ternormalisasi + telepon sama). Fondasi sebelum merge.
6. **Merge supplier/customer** — sesudah #5: pilih record utama, petakan ulang
   referensi (penerimaan, PO, retur pemasok, dokumen stok, saldo awal, pembayaran
   pihak, produk.supplier_id / penjualan customer), nonaktifkan record korban
   (jangan hapus), satu transaksi + audit `party.merge` berisi peta id. Saldo tidak
   digabung secara aritmetika — saldo mengikuti dokumen yang berpindah.
7. **Halaman detail pihak** — `/gudang/pemasok/[id]` & pelanggan: profil + saldo
   berjalan + riwayat dokumen pihak itu (query yang ada sudah berpaginasi;
   tambahkan filter supplier/customer). Menutup §18D tanpa skema baru.
8. **Field pihak yang hilang** — migrasi aditif: `suppliers.tax_id (NPWP)`,
   `suppliers.bank_account/bank_name`, `suppliers.payment_term_days`,
   `customers.tax_id`, `customers.payment_term_days`. Kecil dan membuka kepatuhan
   §18D; termin dipakai bawaan jatuh tempo dokumen berikutnya.
9. **Lifecycle jujur** — sebut & perlakukan `is_active=false` sebagai "Arsip" di
   UI master (label + filter arsip) tanpa migrasi status baru; tambahkan toggle
   cabang yang hilang. Draft untuk master **tidak** direkomendasikan (tidak ada
   kebutuhan integritasnya).
10. **Kualitas data terjadwal** — halaman/panel "Kualitas Data" membaca query
    seperti audit ini (duplikat nama pihak, harga 0, barcode kosong, yatim)
    agar §18G bisa dipantau pengguna, bukan hanya auditor.

**Sengaja TIDAK direkomendasikan untuk S3** (keputusan tercatat / risiko tinggi):
konversi multi-satuan (D-17), price list bertanggal & multi-mata-uang, varian
produk, multi-barcode, merge akun COA, bulk delete (hapus per item berpenjaga
sudah benar), status archived terpisah dari inactive.

---

## 11. Lima celah master-data terbesar (ringkasan)

1. **Tidak ada bulk edit sama sekali** — mengubah harga/kategori/status ratusan
   produk harus satu per satu (§18B/E gagal total), padahal daftar produk sudah
   berpaginasi & tersaring.
2. **Tidak ada merge records & deteksi duplikat pihak lemah** — nama pihak bisa
   berduplikat tanpa peringatan di form manual; duplikat yang sudah telanjur ada
   tidak bisa digabungkan tanpa mengorbankan histori (§18G).
3. **Create/update supplier & customer tidak teraudit** — perubahan data pihak
   (termasuk batas kredit pelanggan) tidak meninggalkan jejak siapa/kapan,
   melanggar §18I; produk justru lengkap.
4. **Tidak ada ekspor master produk & tidak ada halaman detail pihak** —
   round-trip migrasi produk mustahil, dan riwayat+saldo per supplier/customer
   tidak bisa dilihat dari satu tempat (§18D/H).
5. **Master produk belum memenuhi §18C untuk bisnis umum** — tanpa brand, varian,
   multi-barcode, kode produk supplier, stok maksimum, lokasi default, satuan
   ganda/konversi (D-17), dan price list hanya berupa kelompok pelanggan;
   ditambah integritas referensial master sebagian besar **tanpa FK database**
   (terbukti 32 baris `stock_on_hand` yatim di data fixture).
