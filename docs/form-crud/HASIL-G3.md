# HASIL-G3 — Daftar & Tabel (Program Perbaikan Gabungan, Tahap G3)

> Tahap G3 dari rencana gabungan (AUDIT-FORM-CRUD-TABEL.md §6 + AUDIT-UIUX-4.md §6):
> UX4-01 (TBL-03 bagian daftar), TBL-01 + UX4-10 (pagination), UX4-07 (keadaan
> kosong), UX4-09 (kepadatan), TBL-02 (sorting terbatas). Diimplementasikan &
> diverifikasi 2026-11-08, **belum di-commit** — menunggu pemeriksaan & commit
> Pemimpin. Aturan bisnis & angka TIDAK berubah; pagination = batas baca
> tampilan; sorting = urutan tampilan di fungsi baca server (read-path
> ARS1-01 tetap: fungsi baca bernama di modul `src/server/*`).

---

## 1. UX4-01 — menu RowMenu ⋯ untuk semua aksi baris permanen (DITUTUP)

Pola teladan = Produk (`components/gudang/product-row-actions.tsx` +
`components/blocks/row-menu.tsx`): item `{key, label, href, danger, disabled,
note}` + `onAction` + `ConfirmDialog` (G1) utk aksi destruktif.

**Bermigrasi di tahap ini:**

| Permukaan | Sebelum | Sesudah |
|---|---|---|
| Pemasok & pelanggan (`gudang/pemasok`, tab keduanya) | Tombol permanen Ubah/Pasang pasangan + **Nonaktifkan + Hapus** (`PartnerRowActions`) | Satu menu ⋯ (`usePartyRowActions` di `partner-forms.tsx`): Ubah (membuka `SupplierForm`/`CustomerForm` yang kini bisa dikendalikan `open`/`onOpenChange`), Nonaktifkan, **Hapus (danger)** — keduanya di dalam menu; `PartnerRowActions` dihapus. Terverifikasi DOM: 3 tombol "Aksi untuk …", 0 tombol permanen Nonaktifkan/Hapus |
| Gudang & cabang (`pengaturan/forms/gudang-cabang.tsx`) | `WarehouseRowActions`: Hapus permanen | RowMenu satu item danger (duduk di samping tombol Ubah form — pola `AccountRowActions` A-28 UI-5) |
| Metode pembayaran (`pengaturan/forms/metode-pembayaran.tsx`) | `PaymentMethodRowActions`: Hapus permanen | Idem pola di atas |
| Pengguna & akses (`pengaturan/forms/user-access.tsx`) | Ikon Reset sandi + ikon Cabut akses permanen; Ubah + Hapus di kartu peran | Tombol ⋯ per baris (Reset sandi / Cabut akses), menu hanya dirender bila ada ≥1 item bagi baris itu; kartu peran: RowMenu (Ubah, Hapus peran danger). Konfirmasi & dialog yang sama persis (maksud sama) |
| Kelompok harga (`pengaturan/forms/group-pricing.tsx`) | Ubah + ikon Hapus permanen | RowMenu (Ubah, Hapus danger); tautan "Atur harga" tetap terlihat (navigasi utama, bukan aksi baris) |
| HR — organisasi (`hr/forms/master-org.tsx`) | Ubah permanen per baris (posisi/jabatan/divisi/departemen/tim) | RowMenu (Ubah → mode edit yang sama) |
| HR — shift (`hr/forms/shifts.tsx`) | Ubah permanen | RowMenu (Ubah) |
| HR — jenis cuti (`hr/forms/leave.tsx`) | Ubah permanen | RowMenu (Ubah) |
| Daftar dokumen stok: opname, penyesuaian, transfer (`gudang/dokumen`) | `VoidStockDocumentButton` permanen di daftar | `StockDocumentRowActions` baru (`components/gudang/void-buttons.tsx`, meniru `ReceiptRowActions`): menu ⋯ satu item danger "Batalkan dokumen" + `ConfirmDialog` alasan wajib — alasan & server action yang sama |
| Daftar piutang/utang (`akuntansi/piutang-utang`) | WriteOffButton + OpeningBalanceVoidButton permanen | Satu menu ⋯ `PartyRowSecondaryActions` baru (`components/akuntansi/party-row-actions.tsx`) memuat Hapus buku & Batalkan saldo awal; riwayat pembayaran: `PartyPaymentVoidButton asMenu` |
| Daftar bank, beban, payroll, kasbon (daftar + per karyawan), pinjaman (daftar + per karyawan) | Tombol Batalkan permanen | Lima tombol void kini punya pola `asMenu` (varian RowMenu satu item danger, `ConfirmDialog` yang sama): `BankTransferVoidButton`, `ExpenseVoidButton`, `PayrollVoidButton`, `LoanVoidButton`, `AdvanceVoidButton`; alasan nonaktif tertulis (kasbon dipegang karyawan lain / pinjaman aktif) menjadi `note` item menu (pola A-28 UI-5) |

**Pengecualian tertulis (tetap permanen, disengaja):**
- Produk & taksonomi kategori/merek/satuan — sudah RowMenu sebelum G3 (teladan).
- `AccountRowActions` (Bagan akun) — keputusan sadar A-28 UI-5: Ubah terlihat,
  Hapus di menu. Tidak diubah.
- Tombol keputusan workflow dokumen (approval penyesuaian, terima transfer,
  keputusan/bayar klaim, `approval-buttons` PO/PR, `period-manager`) — aksi
  primer alur kerja, bukan aksi baris daftar.
- Tombol void di halaman DETAIL dokumen (`dokumen/[id]`, detail penerimaan) —
  halaman detail adalah permukaan aksi utama dokumen; daftarnya yang beralih.
- `DisposeAssetButton` (form inline mengembang = aksi utama), `PaymentForm`
  Terima/Bayar (aksi utama AR/AP), tautan Cetak GRN (navigasi cetak).
- `EmployeeForm` Ubah & tautan "Atur harga": lihat tabel di atas.

**Inventaris ulang (bukti):** penjaga baru
`tests/unit/architecture-list-patterns.test.ts` mengunci permukaan RowMenu di
seluruh daftar di atas + ketiadaan `PartnerRowActions`; sapuan manual atas
`src/app/**/page.tsx` & komponen daftar menyisakan hanya permukaan pada daftar
pengecualian di atas.

## 2. TBL-01 + UX4-10 — pagination satu standar (DITUTUP)

**Keputusan: `LIST_PAGE_SIZE = 40`** (`src/lib/pagination.ts`, satu-satunya
sumber). Alasan tertulis: dokumen audit menawarkan Produk 30 vs Nilai 50;
inventaris repo menunjukkan 40 adalah nilai dominan (7 daftar dokumen gudang
sudah 40: pergerakan, opname, penyesuaian, transfer, penerimaan, retur
pembelian, reservasi), jadi 40 dipilih agar daftar yang sudah benar tidak
berubah perilaku. Nilai 30/25/50 yang menyimpang diselaraskan: produk 30→40,
jurnal 30→40, beban 25→40, rekonsiliasi 25→40, nilai persediaan 50→40.
**Pengecualian tertulis:** buku besar 50 (laporan, bukan daftar), sub-daftar
detail 20/10, daftar pengaturan 20, lembar hitung opname 200, ekspor 100 —
semuanya bukan "daftar yang tumbuh" dalam arti temuan. Default `pageSize` di
fungsi baca server tetap sebagai jaring pengaman API; halaman daftar wajib
mengoper `LIST_PAGE_SIZE` eksplisit.

**Slot Pagination DataList yang kini terisi (sebelumnya kosong):**
- **Daftar pihak (pemasok & pelanggan)** — pagination server sejati: fungsi
  baca baru `listSuppliersPage`/`listCustomersPage` (`src/server/catalog/
  parties.ts`, count + limit/offset via helper `src/lib/pagination.ts`, pola
  katalog `products.ts`). Varian `…Filtered` lama dipertahankan utuh (rute
  ekspor & total kartu). Tab nonaktif membaca pageSize 1 (angka total chip
  tetap benar tanpa membaca dua daftar penuh).
- **Reservasi stok** — `listReservationsPage` + `countReservationsSummary`
  baru (`src/server/reservations.ts`): pencarian pindah ke SQL `ilike`
  (nomor/nama/sku produk, gudang, alasan), KPI dibangun dari hitungan SQL
  (aktif efektif dinilai di SQL: status aktif & belum kedaluwarsa).
- **Permintaan pembelian** — `listPurchaseRequestsPage` +
  `countPurchaseRequestsByStatus` baru (`src/server/purchase-requests.ts`);
  `listPurchaseRequests` lama dipertahankan (dipakai shell modul lain).
- **Piutang & utang** — pagination lapisan tampil di atas `listReceivables`/
  `listPayables` (keputusan beralasan: kedua fungsi menggabungkan 2–3 sumber
  data di memori dengan matematika alokasi; halaman membutuhkan himpunan
  penuh untuk total kartu, aging & jumlah tab — mengambil satu halaman dari
  server akan memecah angka tersebut. Slice `LIST_PAGE_SIZE` diterapkan
  SESUDAH `filterArApRows` yang sudah berjalan di memori — pola yang sama
  dengan keputusan A-22 K6).

**Tetap tanpa pagination (alasan tertulis per daftar):** daftar pendek
terbatas master (gudang/cabang, metode pembayaran, pengguna, peran, kelompok
harga, tabel HR master) — jumlahnya dibatasi struktur organisasi/perusahaan,
bukan transaksi; laporan berkala (buku besar, jurnal per periode dibatasi
filter tanggal wajib) di luar cakupan "daftar yang tumbuh".

## 3. UX4-07 — keadaan kosong satu dialek (DITUTUP utk permukaan daftar)

`EmptyState` bersama (`components/blocks/empty-state.tsx`, termasuk varian
`compact` = kotak dashed ringkas) menjadi satu-satunya bentuk:
- Beranda: panel "Transaksi terakhir" (kotak dashed raksasa ±300px) →
  `EmptyState compact` di dalam panel; kartu dashed racikan "Belum ada modul"
  → `EmptyState compact`.
- Terminal POS (`pos/terminal`): dua teks polos → `EmptyState size="compact"`.
- `kasbon/[employeeId]` & `pinjaman/[employeeId]`: teks polos "Belum ada
  pergerakan …" → `EmptyState compact`.
- Detail PO (`pembelian/[id]`): panel teks polos "Penerimaan terhadap PO ini"
  → `EmptyState compact` (panduan status menjadi `description`).

**Sengaja tidak dimigrasi (alasan tertulis):** baris kosong `<td colSpan>` di
dalam tabel (Pengaturan, pengguna) adalah dialek baris-tabel, bukan panel;
permukaan laporan/cetak (neraca, laba rugi, faktur) bukan daftar aplikasi;
pemberitahuan gerbang ("belum ada gudang", gerbang POS) adalah pesan keadaan,
bukan keadaan kosong daftar.

## 4. UX4-09 — kepadatan baris lewat varian bersama (DITUTUP dgn catatan jujur)

**Mekanisme terpilih: prop `density` opt-in di `DataList`**
(`density?: "comfortable" | "compact"` → kelas `data-list--compact` + aturan
CSS terlingkup di `@layer components`): baris ringkas = padding vertikal sel
`py-1.5` (dari basis `.data-table` 13px/`py-2.5`), tipografi tidak berubah.
Ini BUKAN pengembalian override menyeluruh `.data-list` yang sengaja dihapus
Validasi 3 (T-03): override lama menimpa SEMUA tabel termasuk editor &
`.data-table-dense`; mekanisme baru hanya berlaku pada `DataList` yang
memilihnya. Diterapkan ke daftar utama terukur audit: produk, nilai
persediaan, pergerakan, pemasok/pelanggan, bagan akun, jurnal, piutang/utang
(dokumen), payroll (karyawan + riwayat), periode (`period-manager`).

**Pengukuran DOM (login UI, build produksi, sesudah reseed bersih):**

| Daftar | Sebelum (audit) | Sesudah | Baris/halaman |
|---|---|---|---|
| Produk | 56px | 47–47,5px | 40 (dari 30) |
| Nilai persediaan | 56px | 47–47,5px | 40 (dari 50) |
| Pergerakan | 54px | 45,5–46px | 40 |
| Pemasok / pelanggan | 53px | 44,5–45px | 3 / 4 (data demo) |
| Bagan akun | 53px | 44,5–48px | 124 |
| Periode | 53px | (periode-manager compact; data demo 3 baris) | — |
| Payroll | 53px | compact diterapkan (kedua DataList) | — |
| Piutang / utang | 74–75px | 66,2–66,7px | 2 (data demo) |
| Jurnal | 57–58px | 49–49,5px | 40 (dari 30) |

**Catatan jujur:** target arah desain "40px kelas dense" TIDAK tercapai penuh
— tinggi sisa ditentukan konten sel (sel dua baris: nama + subteks/SKU;
piutang-utang: sel pihak + sel status multi-baris), bukan padding. Padding
sudah pada varian ringkas bersama; menekan lebih jauh berarti mengubah
struktur sel (di luar mandat tahap & berisiko keterbacaan). Permukaan yang
dikecualikan tertulis: POS (target sentuh), editor baris (`.data-table-dense`
tetap varian editor), sub-tabel detail.

## 5. TBL-02 — sorting kolom TERBATAS (DITUTUP sesuai batas mandat)

Pola: header `<th>` berisi tautan pengalih arah + `aria-sort` pada `<th>`
aktif; sorting dijalankan fungsi baca server (bukan klien).

- **Produk** — `listProducts` menerima `sort: "nama" | "harga" | "stok"` +
  `dir`; stok mengurutkan ekspresi SQL yang sama dengan kolom tampil; ikatan
  urut nama menaik. Terbukti hidup via DOM: urut nama → baris pertama "Aqua
  Air Mineral 1.5L"; urut harga desc → "Beras Pandan Wangi 5kg".
- **Daftar pihak** — `listSuppliersPage`/`listCustomersPage` menerima urut
  nama/kode × naik/turun (ikatan nama→kode); header Kode & Nama dapat diklik
  dgn `aria-sort` (parameter `urut`/`arah` dipertahankan lintas filter &
  pagination).
- **Piutang/utang** — pengurutan di model baca halaman atas hasil
  `listReceivables`/`listPayables`: kunci Tanggal, Jatuh tempo, Sisa
  (dokumen tanpa tempo selalu terakhir pada kedua arah; ikatan tanggal lalu
  nomor; arah bawaan Sisa = desc, lainnya asc). Kolom Tanggal membawa dua
  tautan urut (Tanggal · Tempo); kolom Sisa terurut.

**Keputusan sadar BELUM (bukan dikerjakan setengah):** daftar lain (pergerakan,
dokumen stok, jurnal, beban, bank, HR) tidak diberi sorting di tahap ini —
kepala kolomnya didominasi tanggal dokumen (urutan bawaan tanggal terbaru
sudah menjadi urutan kerja) dan nilai tambah sorting belum terbukti; pola di
atas siap ditiru per daftar bila dibutuhkan.

## 6. Penjaga baru

`tests/unit/architecture-list-patterns.test.ts` (10 test): konstanta
`LIST_PAGE_SIZE` tunggal & tidak ada literal ukuran halaman daftar di halaman;
halaman daftar mengimpor konstanta; permukaan RowMenu hadir di semua daftar
termigrasi; `PartnerRowActions` lenyap; `StockDocumentRowActions` dipakai 3
daftar dokumen & tombol void permanen absen di sana; pola `asMenu` hadir di 6
berkas komponen void; fungsi baca server terpaginasi bernama ada utk pihak/
reservasi/PR; `Pagination` terpasang di reservasi & PR; `density` bersama ada
& permukaan compact terpasang; `EmptyState compact` di Beranda & Terminal.

## 7. Gerbang (tanpa pipa penutup, dari reseed bersih 65 produk / Rp28.349.600)

- Typecheck: exit 0. Lint: 0 error, 29 warning (baseline warisan, nol baru).
- Build produksi: exit 0.
- Suite penuh: **2129/2129 (222 berkas)** = baseline 2119 + 10 penjaga baru,
  exit 0 pada larian pertama (flake AUD-008 tidak muncul).
- E2E: **25/25** (`BISA_E2E_RESEED=1`), exit 0.

Bisnis, angka, skema & migrasi DB: nol perubahan (satu-satunya perubahan
server = fungsi baca baru & opsi urut; tidak ada aksi tulis yang berubah
semantik — form pihak kini terkendali `open` dengan aksi simpan yang sama).

## 8. Sisa & tindak lanjut

- Tinggi baris 44,5–49,5px (bukan 40px) — sisa konten sel; keputusan pemilik
  desain bila ingin menekan struktur sel (lihat §4).
- Pagination reservasi & PR tidak terverifikasi visual (data demo kosong) —
  tertutup oleh penjaga + pola yang sama dgn daftar pihak; verifikasi visual
  menyusul bila data contoh tersedia (G5 dapat memotretnya).
- Sorting daftar non-utama: keputusan sadar belum (§5).
- Sisa UX4 lain (lantai teks lokal per halaman, >1 tombol primer per halaman)
  tetap milik G5 sesuai rencana gabungan.
