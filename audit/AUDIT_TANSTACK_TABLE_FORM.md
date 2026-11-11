# Audit Arsitektur Data Table & Form: Evaluasi Adopsi TanStack Table & TanStack Form Menuju Standar Enterprise

## 1. Ringkasan Eksekutif & Status Faktual Codebase

Berdasarkan audit menyeluruh terhadap `package.json`, `node_modules`, dan seluruh berkas di direktori `src/`:
- **Apakah Bisa ERP sudah menggunakan TanStack Table & TanStack Form?**
  **JAWABAN TEGAS: BELUM.**
  Saat ini modul `@tanstack/react-table` dan `@tanstack/react-form` **sama sekali belum terpasang** di dalam repositori.
- **Arsitektur Saat Ini**:
  - **Data Table**: Menggunakan **Next.js Server Components (RSC)** murni dengan URL search parameters (`?q=&page=&urut=&arah=`), pembungkus `DataList` + `DataListToolbar` + `Pagination`, serta tag `<table className="data-table">` atau komponen dasar shadcn `<Table>`. Seleksi massal (seperti pada `ProductBulkTable`) menggunakan React state manual (`useState<Set<string>>`).
  - **Form**: Menggunakan React controlled state (`useState`), `useActionRunner` kustom, validasi Zod manual (`requireFilled`, `schema.safeParse`), input kustom (`MoneyInput`, `QtyInput`, `DateField`), serta pembungkus layout `DocumentForm`.

---

## 2. Benchmark Internasional: Karakteristik Enterprise Table & Form

Berdasarkan riset mendalam melalui Exa AI, Context7 Documentation (`/tanstack/table` dan `/tanstack/form`), serta pola desain *shadcn/ui Data Table* dan aplikasi kelas enterprise (*Linear, Stripe Dashboard, Retool, Datadog*):

### A. Enterprise Data Table (TanStack Table v8/v9 Standard)
1. **Column Visibility (Tampil/Sembunyi Kolom)**: Pengguna dapat menyembunyikan atau menampilkan kolom tertentu melalui *Dropdown Menu* ("View / Kolom"). Preferensi visibilitas tersimpan di `localStorage` per pengguna.
2. **Column Pinning (Freeze Columns)**: Kolom identitas (misal SKU/Nama Produk atau Nomor Jurnal) dipin di sebelah kiri (`pin: 'left'`), dan kolom tindakan (*Row Actions Menu*) dipin di sebelah kanan (`pin: 'right'`) saat tabel digulir secara horizontal di layar kecil atau tablet.
3. **Faceted Filter Popovers**: Filter bukan sekadar `<select>` HTML standar, melainkan popover tombol berkas dengan pencarian internal, badge jumlah terpilih, dan ikon status.
4. **Row Selection & Floating Action Bar**: Checkbox baris dengan status *indeterminate* ("Pilih semua di halaman ini" vs "Pilih seluruh 1.450 data"), yang memicu *floating action dock* di dasar layar untuk aksi massal (*Bulk Delete, Bulk Export, Bulk Status Change*).
5. **Density Switching**: Pilihan kepadatan baris instan (*Compact* 32px untuk akuntan/operator entri data cepat, *Normal* 40px, *Comfortable* 48px).
6. **Multi-Column & Instant Client Sorting**: Pengurutan data instan tanpa harus me-reload halaman jika data berada dalam satu halaman/dataset.

### B. Enterprise Form (TanStack Form / React Hook Form Standard)
1. **Automated Dirty State Tracking (`isDirty`)**: Form melacak secara presisi apakah nilai saat ini berbeda dari `defaultValues` (bawaan server). Jika kotor, navigasi dicegah (*Unsaved changes dialog* & *beforeunload*).
2. **Field-Level Validation onBlur**: Validasi schema Zod dievaluasi saat pengguna berpindah field (*blur*), bukan menunggu tombol Simpan ditekan, dengan pesan kesalahan inline di bawah field.
3. **Keyboard Ergonomics**:
   - `Ctrl + Enter` / `Cmd + Enter` untuk submit dari input manapun.
   - `Esc` untuk menutup modal/sheet dengan konfirmasi jika form kotor.
   - Navigasi panah/Enter antar sel tabel input (*spreadsheet-like navigation*).
4. **Idempotency & Double Submit Prevention**: Penguncian tombol simpan otomatis dengan spinner status dan kunci idempoten (*idempotency key*) untuk mencegah duplikasi transaksi.

---

## 3. Matriks Komparasi: Arsitektur Saat Ini vs TanStack Ecosystem

| Dimensi Fitur | Implementasi Saat Ini di Bisa ERP | Standar Enterprise (TanStack Table & Form) | Dampak & Kesenjangan (Gap) |
|---|---|---|---|
| **Bundle Size & Loading** | **Unggul**: Sangat ringan (RSC murni, 0kB JS client untuk tabel baca). | Memerlukan bundle `@tanstack/react-table` (±12-15kB gzip). | Arsitektur saat ini sangat cepat di koneksi lambat. |
| **URL-Driven State** | **Lengkap**: Filter & halaman ada di URL query string. | Didukung via integrasi manual URL state updater. | Saat ini sudah baik untuk bookmarking dan sharing link. |
| **Column Visibility** | **Tidak Ada**: Semua kolom tampil permanen; tabel lebar terpotong di layar kecil. | **Bawaan**: `columnVisibilityFeature` dengan popover pilih kolom. | **Kesenjangan Tinggi**: Pengguna laptop 13" kesulitan melihat kolom penting. |
| **Column Pinning** | **Tidak Ada**: Kolom bergeser semua saat scroll horizontal. | **Bawaan**: `columnPinningFeature` (freeze left/right). | **Kesenjangan Tinggi**: Kehilangan konteks nama produk/jurnal saat geser ke kanan. |
| **Faceted Filter UI** | **Sederhana**: `<select>` HTML native di `DataListToolbar`. | **Modern**: Popover tombol + badge count + multi-select filter. | Tampilan saat ini terkesan kaku/basic. |
| **Bulk Actions** | **Ada Sebagian**: Khusus `ProductBulkTable` dengan modal terpisah. | **Terstandarisasi**: Floating Action Dock melayang di bawah layar. | Tidak semua tabel memiliki kapabilitas aksi massal. |
| **Form Dirty Guard** | **Parsial**: Baru diimplementasikan di `receipt-form` & `product-form`. | **Otomatis**: `form.state.isDirty` pada setiap field. | Resiko kehilangan data saat pengguna tidak sengaja menutup sheet. |
| **Validation Timing** | **onSubmit**: Validasi manual saat tombol Simpan diklik. | **onBlur + onChange revalidation**: Umpan balik real-time per field. | Pengguna baru tahu error setelah menekan tombol simpan. |
| **Keyboard Ergonomics** | **Terbatas**: Tab index standar HTML. | **Lengkap**: `Cmd/Ctrl+Enter` submit, arrow key navigation. | Kecepatan entri operator kasir/gudang kurang optimal. |

---

## 4. Analisis Teknis & Rekomendasi Strategi Adopsi

### Mengapa TIDAK Semua Tabel Perlu Diubah ke TanStack Table?
Di arsitektur Next.js 16 App Router:
1. **Server Components (RSC) adalah kekuatan utama Bisa ERP**:
   Halaman daftar seperti `/app/akuntansi/jurnal`, `/app/gudang/produk`, dan `/app/pos/riwayat` yang memiliki ribuan data di database lebih efisien dipaginasi dan difilter langsung di PostgreSQL (lewat Drizzle ORM `limit` & `offset`), bukan menarik 10.000 data ke browser klien untuk diatur TanStack Table.
2. **Kapan TanStack Table WAJIB Digunakan?**
   TanStack Table sangat ideal untuk **Client Component Data Grid yang padat interaksi**, yaitu:
   - **Tabel Editor Baris Transaksi**: Input baris faktur, baris PO, dan baris voucher jurnal (multi-line dynamic row editor).
   - **Tabel Bulk Edit & Opname Fisik**: `ProductBulkTable` dan `OpnameCountTable` (dimana seleksi baris, sorting kolom instan, filter lokal, dan pinning sangat krusial).
   - **Tabel Pelaporan Interaktif**: Tabel perbandingan anggaran atau analisis aging yang membutuhkan toggle kolom dinamis.

### Roadmap Adopsi Bertahap (Enterprise Upgrade Plan)

#### Tahap 1: Penyempurnaan Shell Tabel Saat Ini (Peningkatan Cepat Tanpa Menambah Dependensi)
- Tambahkan **Column Pinning CSS murni** pada tabel lebar:
  - Kolom pertama: `sticky left-0 bg-background z-10 shadow-[1px_0_0_0_hsl(var(--border))]`
  - Kolom aksi: `sticky right-0 bg-background z-10 shadow-[-1px_0_0_0_hsl(var(--border))]`
- Standarisasi **Floating Action Bar** untuk aksi massal di `ProductBulkTable` dan tabel data lainnya.
- Tambahkan pintasan keyboard `Ctrl+Enter` / `Cmd+Enter` pada `DocumentForm` dan `SheetContent`.

#### Tahap 2: Instalasi & Adopsi Selektif `@tanstack/react-table` (v8/v9)
- Pasang paket `@tanstack/react-table`.
- Buat komponen bersama `src/components/blocks/data-table.tsx` yang membungkus:
  - `useReactTable` dengan `columnVisibilityFeature`, `rowSelectionFeature`, `rowSortingFeature`.
  - Komponen `DataTableColumnHeader` (pengurutan visual yang elegan).
  - Komponen `DataTableViewOptions` (dropdown menu saklar kolom tampil/sembunyi).
  - Komponen `DataTableFacetedFilter` (filter modern dengan badge jumlah).
- Terapkan pertama kali pada `ProductBulkTable` dan `OpnameCountTable`.

#### Tahap 3: Standarisasi Form Unsaved Changes & Keyboard Guard
- Buat custom hook `useFormGuard({ isDirty, onConfirmDiscard })` untuk semua modal, drawer sheet, dan halaman formulir utama.
- Pasang listener `keydown` global untuk kombinasi `Ctrl+Enter` pada seluruh form dokumen (`DocumentForm`).
