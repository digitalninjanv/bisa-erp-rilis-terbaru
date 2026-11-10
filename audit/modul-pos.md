# Laporan Audit Modul: POS (Point of Sale)

- **Kode Modul**: `pos`
- **Prefix Temuan**: `POS-*`
- **Lingkup**: Terminal Kasir Utama, Integrasi Barcode Scanner, Keranjang & Kalkulasi Quote, Diskon & Pajak, Pembayaran Campuran (Split Payment), Pesanan Ditahan (Hold/Resume), Void & Retur Penjualan, Sesi Kasir & Shift (Till Management), Rekonsiliasi Kas, Riwayat Transaksi, Cetak Nota Struk & Faktur, Mode Offline & Sinkronisasi, dan Terminal Desktop.

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 3.5 | Checkout, perhitungan diskon bertingkat, split payment, dan void/reversal berfungsi baik; terdapat bug pemutusan hook barcode scanner fisik dan penutupan shift saat transaksi hold masih aktif. |
| **Tampilan Visual (UI)** | 3.0 | Panel kasir ringkas dan responsif; modal bayar dan daftar produk responsif; kontras status pembayaran perlu diperbaiki. |
| **Pengalaman Pengguna (UX)** | 2.5 | Barcode scanner fisik macet/salah input bila kursor tidak fokus di kotak pencarian (karena hook global capture tidak dipanggil); navigasi keyboard pada dialog bayar belum optimal. |
| **Workflow & State Machine** | 3.5 | Shift kasir dapat ditutup padahal masih terdapat transaksi tertahan (*held sales*); alur void dan retur kasir sudah atomik dan berjejak audit. |
| **Integritas Data & Atomisitas**| 4.5 | Transaksi penjualan, pemotongan stok fisik, dan jurnal akuntansi diikat dalam satu transaksi database DB `tx` yang atomik; FEFO batch allocation berjalan solid. |
| **Laporan & Akurasi Angka** | 4.0 | Perhitungan subtotal, PPN, diskon, dan pembulatan (*rounding gain/loss*) akurat dengan `Decimal.js`. |
| **Performa & Query** | 3.5 | Quote lokal / server debounce bekerja dengan baik; antrean offline di-chunk per 25 transaksi. |
| **Hak Akses & Keamanan** | 4.0 | Kasir dibatasi hanya bisa menutup sesinya sendiri (`userId`); void nota dan diskon manual menuntut hak akses supervisor (`pos.void` / `pos.discount`). |

---

## 2. Rincian Temuan Audit

### POS-001: Hook Barcode Scanner Global Terputus di Terminal Kasir Utama (*Disconnected Hardware Hook*)
- **Severity**: **Kritis**
- **Kategori**: UX / Hardware Integration
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode dan warning ESLint)
- **Bukti Kode**:
  - `src/components/pos/pos-terminal.tsx:9` (`import { useBarcodeScannerCapture } from "@/components/pos/use-barcode-scanner"`)
  - Warning ESLint: `'useBarcodeScannerCapture' is defined but never used @typescript-eslint/no-unused-vars`
  - `src/components/pos/use-barcode-scanner.ts:1-60`
- **Deskripsi Masalah**:
  Sistem telah mengembangkan hook canggih `useBarcodeScannerCapture` untuk menangani *keyboard wedge* barcode scanner fisik (menelan input ketikan cepat agar tidak mengotori input quantity/nominal dan otomatis menambahkan item ke keranjang belanja). Namun, hook ini **hanya diimpor di baris 9 dan tidak pernah dipanggil di dalam komponen `PosTerminal`**.
  Akibatnya, saat kasir memindai barcode menggunakan scanner USB/Bluetooth fisik:
  - Jika kursor sedang fokus pada field quantity atau dropdown pelanggan, karakter angka barcode akan langsung terketik masuk ke field tersebut dan merusak nilai input.
  - Jika kursor berada di luar input text, hasil pindai hilang tanpa ada aksi penambahan produk ke keranjang belanja.
- **Dampak Bisnis**:
  Keluhan utama kasir minimarket: *"Scanner barcode sering macet atau angkanya masuk ke kolom jumlah"*. Transaksi di meja kasir melambat drastis, antrean pelanggan menumpuk.
- **Rekomendasi Perbaikan**:
  Aktifkan pemanggilan hook `useBarcodeScannerCapture` di dalam `PosTerminal`:
  ```typescript
  useBarcodeScannerCapture({
    onScan: handleBarcodeScan,
    enabled: !isPaymentDialogOpen,
  });
  ```
- **Estimasi Effort**: **S (Small)**

---

### POS-002: Shift Kasir Dapat Ditutup Saat Terdapat Pesanan Ditahan Aktif (*Unresolved Held Sales on Shift Close*)
- **Severity**: **Tinggi**
- **Kategori**: Workflow & Standar Kasir
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `sessions.ts`)
- **Bukti Kode**:
  - `src/server/pos/sessions.ts:87-192` (`closeCashSession`)
- **Deskripsi Masalah**:
  Pada fungsi penutupan sesi kasir (`closeCashSession`), sistem hanya menghitung selisih uang fisik kasir vs saldo sistem (`cashMovements`), namun **sama sekali tidak memeriksa keberadaan transaksi gantung** (`sales.status = 'held'`) yang masih aktif di kasir tersebut. Kasir dapat menutup shift dan pulang, sementara terdapat 5 transaksi pending di keranjang gantung yang barangnya mungkin sudah diambil sebagian oleh pembeli atau stoknya terblokir reservasi.
- **Dampak Bisnis**:
  Pelanggaran standar POS retail (*Till Management*). Transaksi gantung menjadi "terlantar" di sistem, menimbulkan selisih stok fisik vs catatan, dan mempersulit serah terima shift kasir berikutnya.
- **Rekomendasi Perbaikan**:
  Pada `closeCashSession`, tambahkan validasi:
  ```typescript
  const [held] = await tx.select({ count: count() }).from(sales).where(and(eq(sales.companyId, input.companyId), eq(sales.userId, input.userId), eq(sales.status, "held")));
  if ((held?.count ?? 0) > 0) {
    throw new AppError("INVALID_STATE", `Terdapat ${held.count} transaksi tertahan (hold) yang belum diselesaikan atau dibatalkan. Selesaikan transaksi tersebut sebelum menutup sesi.`);
  }
  ```
- **Estimasi Effort**: **S (Small)**

---

### POS-003: Memory Leak & Stale State pada React Hook Dependencies Terminal POS
- **Severity**: **Sedang**
- **Kategori**: Kualitas Kode & Stabilitas UI
- **Tingkat Keyakinan**: **Tinggi** (Terdeteksi via ESLint)
- **Bukti Kode**:
  - `src/components/pos/pos-terminal.tsx:357` (Missing `setSearch`)
  - `src/components/pos/use-cart-persistence.ts:164` (Missing `setCart`, `setGroupId`, dll.)
  - `src/components/pos/use-held-sales.ts:104, 121, 161` (Missing dependencies)
  - `src/components/pos/use-quote.ts:181` (Missing `offlineQuote` properties)
- **Deskripsi Masalah**:
  Beberapa hook inti POS memiliki dependency array yang tidak lengkap pada `useCallback` dan `useEffect`. Hal ini menyebabkan closure state menjadi *stale* (basi), terutama saat kasir melakukan resume transaksi hold atau saat beralih antara kelompok harga diskon pelanggan (*pricing group*).
- **Dampak Bisnis**:
  Keranjang belanja kasir sesekali menampilkan total harga lama atau gagal memulihkan transaksi hold secara bersih saat koneksi jaringan fluktuatif.
- **Rekomendasi Perbaikan**:
  Lengkapi seluruh array dependensi React Hooks atau bungkus state setter menggunakan callback functional updates (`prev => ...`).
- **Estimasi Effort**: **S (Small)**

---

### POS-004: Quick Add Customer POS Tidak Memvalidasi Duplikasi Nomor Telepon
- **Severity**: **Sedang**
- **Kategori**: Integritas Data & Konsistensi Master
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `pos.ts`)
- **Bukti Kode**:
  - `src/server/actions/pos.ts:25-50` (`quickAddCustomerAction`)
- **Deskripsi Masalah**:
  Fitur "Tambah Cepat Pelanggan" di meja kasir hanya menerima `name` dan `phone`. Fungsi ini langsung melakukan `insert into customers` dengan kode acak `CUST-<UUID>` tanpa memeriksa apakah nomor telepon tersebut sudah terdaftar pada pelanggan lain.
- **Dampak Bisnis**:
  Terjadi penumpukan data pelanggan duplikat di database setiap kali kasir menginput pelanggan yang sama dengan ejaan nama sedikit berbeda. Riwayat poin/piutang pelanggan terpecah menjadi beberapa akun terpisah.
- **Rekomendasi Perbaikan**:
  Lakukan pengecekan nomor telepon sebelum insert: jika nomor telepon sudah ada, tawarkan kasir untuk memilih pelanggan yang sudah terdaftar alih-alih membuat baris baru.
- **Estimasi Effort**: **S (Small)**

---

### POS-005: Dialog Cetak Otomatis (Autoprint) Bergantung pada Timeout Browser Transien
- **Severity**: **Rendah**
- **Kategori**: UX / Cetak Struk
- **Tingkat Keyakinan**: **Sedang**
- **Bukti Kode**:
  - `src/components/pos/receipt-print.tsx:25` (`setTimeout(printClean, 400)`)
- **Deskripsi Masalah**:
  Pemicu cetak nota otomatis memakai timer statis 400ms untuk menyingkirkan toast sebelum membuka dialog print browser. Pada komputer kasir yang spesifikasinya rendah (*low-end POS terminal*), waktu render 400ms seringkali tidak cukup sehingga dialog print muncul saat CSS styling nota belum selesai dikalkulasi browser, menghasilkan margin cetak yang terpotong.
- **Dampak Bisnis**:
  Struk thermal kasir sesekali tercetak dengan header miring atau kosong pada komputer kasir minimarket berspesifikasi hemat daya.
- **Rekomendasi Perbaikan**:
  Gunakan event `requestAnimationFrame` ganda atau callback render selesai alih-alih `setTimeout` arbitrer.
- **Estimasi Effort**: **S (Small)**
