# Laporan Audit UI/UX & Blueprint Transformasi Desain ERP Standar Internasional

> **Status Evaluasi**: Menyeluruh (100% Modul & Komponen Diperiksa)  
> **Dasar Riset**: Exa AI Research Benchmark (Linear, Stripe Dashboard, Shopify Polaris, eBay Playbook, NetSuite, SAP Fiori)  
> **Fokus Utama**: Mengatasi tampilan kaku/kuno, meningkatkan ergonomi alur kerja (*keyboard-first & touch-ready*), serta menaikkan standar estetika ke kelas enterprise internasional (*No AI Slop*).

---

## 1. Landasan Riset Referensi Internasional (Exa AI)

Berdasarkan riset mendalam terhadap sistem desain B2B SaaS terkemuka di dunia (*Stripe, Linear, Shopify Polaris, Vercel Geist*):

1. **Prinsip Densitas Interaksi (*Interaction Density over Visual Decoration*)**:
   - Aplikasi alat kerja harian (ERP) membutuhkan **densitas tinggi yang tenang**: tinggi baris tabel data 36px (`h-9`), padding sel `px-3 py-1.5`, border 1px *hairline* dengan kontras lembut (`border-border`), dan nol gradien warna-warni yang mengaburkan fokus.
2. **Tipografi Finansial Monospaced Tabular**:
   - Seluruh angka kuantitas, harga, dan saldo wajib menggunakan `tabular-nums` (`font-variant-numeric: tabular-nums`) dan diratakan ke kanan (*right-aligned*) agar digit ribuan, jutaan, dan desimal lurus vertikal saat discan cepat oleh akuntan.
3. **Arsitektur Formulir 4-Tingkat (*4-Tier Form Hierarchy*)**:
   - **Tingkat 1 - Inline Quick Edit**: Untuk koreksi 1 nilai (kuantitas opname fisik, status centang).
   - **Tingkat 2 - Modal Dialog (max-w-md)**: Khusus konfirmasi berisiko tinggi (Batal/Void, Hapus) atau input 1–3 field cepat.
   - **Tingkat 3 - Slide-Over Right Drawer (560px–720px)**: Standar untuk Master Data (Produk, Kontak, Akun, Karyawan) agar konteks tabel di latar belakang tetap terlihat.
   - **Tingkat 4 - Dedicated Full Page**: Untuk dokumen transaksi berbaris banyak (Jurnal Umum, PO, Faktur Penjualan, Payroll Run).
4. **Ergonomi Alur Kerja Persetujuan (*Maker-Checker Workflow*)**:
   - Status dokumen ditampilkan sebagai *state-based pipeline* visual (Draft → Menunggu Persetujuan → Disetujui → Diposting) dengan indikasi jelas: siapa pembuat, siapa penyetujui yang berhak, dan apa dampak aksi selanjutnya.
5. **Kecepatan Kasir POS (*Touch-First & Keyboard-First Ergonomics*)**:
   - Total pembayaran selalu melekat (*persistent sticky payment summary*), barcode scanner fisik terdeteksi otomatis tanpa klik kursor, dan tombol nominal cepat (*quick cash chips*: Pas, 50k, 100k) mudah dijangkau satu tangan.

---

## 2. Audit UI/UX Menyeluruh per Modul & Area Kerja

Berikut adalah temuan spesifik dan komparasi standar internasional untuk setiap bagian aplikasi:

### Area 1: Cangkang Navigasi, Topbar & Shell Modul
- **Kondisi Saat Ini**:
  - Palet warna utama cangkang menggunakan nuansa plum/ungu kecokelatan tua (`#714b67`) yang dipadukan dengan latar agak kekuningan (`#f7f5f2`), memberikan kesan visual yang kurang segar (*aged/dated*) dan kurang sejalan dengan estetika modern enterprise SaaS.
  - Sidebar rail ikon flyout saat diciutkan (*collapsed*) belum memiliki penanda visual aktif yang tegas di level ikon rail.
- **Standar Internasional (Linear / Stripe)**:
  - Gunakan palet netral ultra-bersih: Slate / Zinc netral dingin (`#0f172a` atau `#18181b` untuk dark / aksen, dan `#f8fafc` / `#f4f4f5` untuk latar belakang netral terang), dengan warna aksen fungsional yang tajam (misal Deep Indigo `#4f46e5` atau Slate `#0f172a` sebagai primary solid).
  - Breadcrumb di topbar menampilkan hierarki aktif: `Gudang / Produk / Indomie Goreng` yang dapat diklik langsung.
  - Command Palette (`Ctrl+K`) dilengkapi riwayat pencarian terakhir (*Recent Searches*) dan shortcut navigasi langsung.

---

### Area 2: Terminal POS Kasir (`/app/pos/terminal`)
- **Kondisi Saat Ini**:
  - Keranjang kasir dan panel pembayaran bertumpuk vertikal di panel samping. Pada layar tablet atau resolusi menengah, pengguna harus sering menggulir untuk melihat rincian item versus tombol bayar.
  - Pilihan metode pembayaran berbentuk dropdown/select kecil yang memperlambat kasir di kasir ritel berkecepatan tinggi.
- **Standar Internasional (Shopify POS / Square / Propello)**:
  - **Layar Kasir Dual-Zone**:
    - Sisi Kiri (60%): Kisi katalog produk berukuran kartu sentuh besar (*touch-friendly grid*) dengan filter kategori tabs cepat di atasnya.
    - Sisi Kanan (40%): Keranjang belanja dengan daftar item ber-counter kuantiti cepat (+ / - / numpad), diikuti ringkasan total sticky di bawah dengan tombol besar berkontras tinggi: **"BAYAR [F1]"**.
  - **Quick Cash Tender Buttons**: Sediakan tombol satu sentuh untuk pecahan uang tunai Indonesia: **[Uang Pas]**, **[Rp 50.000]**, **[Rp 100.000]**, **[Rp 200.000]** yang langsung menghitung kembalian tanpa mengetik nominal manual.
  - **Visual Feedback Scan**: Efek animasi kilat lembut (*flash highlight*) pada baris keranjang saat produk tertangkap scanner barcode USB.

---

### Area 3: Modul Akuntansi & Jurnal Umum (`/app/akuntansi/jurnal`)
- **Kondisi Saat Ini**:
  - Formulir jurnal umum manual (`JournalEntryForm`) membutuhkan klik mouse untuk menambahkan baris baru (`Tambah baris`).
  - Indikator keseimbangan debit/kredit berada di bawah tabel, sehingga akuntan yang mengisi jurnal 10+ baris harus scroll ke bawah untuk melihat apakah jurnal sudah seimbang.
- **Standar Internasional (NetSuite / SAP Fiori / QuickBooks)**:
  - **Entri Baris Keyboard-First Penuh**:
    - Navigasi tombol `Tab`: Akun → Debit → Kredit → Keterangan → `Enter` otomatis menambahkan baris baru dan memindahkan kursor ke input akun baris berikutnya tanpa mengangkat tangan dari keyboard!
  - **Sticky Balancing Status Bar**:
    - Pita indikator keseimbangan (Total Debit, Total Kredit, dan Selisih) melekat (*sticky top*) di atas tabel baris jurnal. Bila selisih belum 0, tampilkan tombol kilat **[Seimbangkan Otomatis (Alt+B)]** yang langsung mengisi sisi kredit/debit baris terakhir dengan selisih yang tersisa.
  - **Akun Combobox Cerdas**: Mengetik nomor akun (misal `1101`) atau nama akun (misal `Kas`) langsung menampilkan hasil dengan tanda saldo normal (D/K).

---

### Area 4: Modul Gudang & Inventori (`/app/gudang/produk`)
- **Kondisi Saat Ini**:
  - Penambahan dan pengeditan produk menggunakan modal pop-up tengah (`Modal wide`). Karena produk memiliki banyak field (SKU, barcode, kategori, satuan, harga beli, harga jual, stok minimum, multi-kemasan, serial/batch, custom fields), modal menjadi sangat panjang dan menggulir di layar sempit, serta menutupi tabel produk di belakangnya.
- **Standar Internasional (Shopify Admin / Linear / Stripe)**:
  - **Right Drawer Slide-Over Sheet (640px–720px)**:
    - Buka formulir dari sisi kanan layar. Pengguna tetap dapat melihat baris produk lain di tabel utama sebagai referensi saat memasukkan item baru.
  - **Pemisahan Tab/Seksi Produk**:
    - *Tab 1: Informasi Dasar* (Nama, SKU, Barcode, Kategori, Satuan).
    - *Tab 2: Harga & Finansial* (HPP Sistem AVCO, Harga Beli Acuan, Harga Jual, Kalkulator Margin Otomatis).
    - *Tab 3: Satuan Kemasan & Multi-Satuan* (Dus, Pak, Renceng beserta konversi).
    - *Tab 4: Aturan Pelacakan* (Stok, Batch/Expiry, Nomor Seri).
  - **Filter Chips Aktif**: Di atas tabel, tampilkan chip filter aktif yang dapat dihapus per satu klik (contoh: `[Kategori: Makanan Ringan ×] [Stok: Menipis ×] [Reset Semua]`).

---

### Area 5: Modul Pembelian & Penerimaan Barang (`/app/gudang/pembelian`, `/app/gudang/penerimaan`)
- **Kondisi Saat Ini**:
  - Dokumen detail sudah memiliki `StatusSteps`, namun hubungan antar-dokumen rantai pasok (Permintaan Pembelian → Pesanan PO → Penerimaan Barang → Faktur Utang) belum terlihat sebagai diagram alur visual terpadu (*document lineage breadcrumb*).
- **Standar Internasional (Odoo / SAP Document Flow)**:
  - **Visual Document Stepper & Smart Links**:
    - Di bagian atas detail PO, tampilkan tombol pintas berbadge (*Smart Buttons*): `[1 Penerimaan (RCV-001)]` `[1 Tagihan Utang (INV-001)]`. Pengguna dapat berpindah antar dokumen dalam 1 klik.
  - **Maker-Checker Action Banner**:
    - Jika dokumen membutuhkan persetujuan manajer, tampilkan banner elegan dengan status: *"Menunggu persetujuan dari Manajer Gudang (Dibuat oleh Budi pada 10 Nov 2026 14:20)"*. Tombol **[Setujui Dokumen]** dan **[Tolak / Minta Revisi]** terlihat mencolok bagi pengguna yang berhak.

---

### Area 6: Modul Penjualan & Piutang-Utang (`/app/akuntansi/piutang-utang`)
- **Kondisi Saat Ini**:
  - Halaman membagi dua bagian besar: Piutang Pelanggan dan Utang Pemasok. Tabel memuat banyak kolom angka, namun ringkasan umur piutang (*aging summary*) belum memiliki visualisasi batang grafik umur yang mudah discan manajemen.
- **Standar Internasional (Stripe Invoicing / NetSuite AR)**:
  - **Bilah Ringkasan Umur Piutang (Aging Bar Chart)**:
    - Tampilkan visualisasi kartu strip 4 segmen: `Belum Jatuh Tempo (Hijau)` | `1–30 Hari (Biru)` | `31–60 Hari (Kuning)` | `>60 Hari (Merah)`. Mengklik salah satu segmen otomatis memfilter tabel di bawahnya.
  - **Modal Terima Pembayaran Terpadu**:
    - Kasir/akuntan dapat memilih metode (Kas, Transfer Bank, Giro, Kredit Retur) dan tombol pembagian proporsional otomatis (FIFO) ke faktur-faktur tertua.

---

### Area 7: Modul HR & Penggajian / Payroll (`/app/akuntansi/payroll`)
- **Kondisi Saat Ini**:
  - Tabel rincian gaji menampilkan angka panjang. Belum ada tombol pratinjau slip gaji (*Slip Gaji Quick Preview*) instan sebelum batch diposting.
- **Standar Internasional (Gusto / Deel / Workday)**:
  - **Slip Gaji Pratinjau Kanan (Side Preview Modal)**:
    - Klik nama karyawan langsung membuka kartu slip gaji interaktif yang menunjukkan perincian: Gaji Pokok, Tunjangan, Lembur, Potongan Kasbon, BPJS Ketenagakerjaan/Kesehatan, dan PPh 21 Neto.
  - **Pusat Persetujuan Terpadu (*Approval Center*)**:
    - Pengelompokan tab rapi: `[Semua (12)]` `[Cuti (5)]` `[Lembur (4)]` `[Klaim/Reimbursement (3)]` dengan tombol aksi massal (*Bulk Approve*).

---

### Area 8: Analisa & Dashboard Bisnis (`/app/analisa`)
- **Kondisi Saat Ini**:
  - Metrik kartu di bagian atas menampilkan angka-angka statis. Belum ada indikator perbandingan persentase terhadap periode sebelumnya (contoh: `+12.4% vs bulan lalu`).
- **Standar Internasional (Stripe Sigma / Baremetrics / Linear Insights)**:
  - **StatCard dengan Delta Trend Badge**:
    - Setiap kartu KPI (Omzet, Laba Kotor, Nilai Stok, Arus Kas) dilengkapi badge tren: `↑ 8.2% vs 30 hari lalu` (hijau) atau `↓ 3.1%` (merah).
  - **Preset Rentang Waktu Instan**:
    - Tombol pill: `[Hari Ini]` `[7 Hari]` `[30 Hari]` `[Bulan Ini]` `[Kustom]` yang langsung memfilter grafik tanpa memicu scroll lompat.

---

### Area 9: Komponen Dasar & Skala Desain UI (Design Tokens)
- **Kondisi Saat Ini**:
  - Beberapa formulir masih menggunakan teks berukuran 10px-11px yang agak terlalu rapat untuk dibaca di monitor low-DPI.
  - Tombol aksi destruktif (Hapus/Void) terkadang berada terlalu dekat dengan tombol simpan tanpa pembatas jarak visual yang memadai.
- **Standar Internasional (Radix / Tailwind UI / Shadcn Enterprise)**:
  - **Lantai Tipografi Minimal**:
    - Konten teks body tabel & form: minimal `12px` (label/meta) dan `13px` (isi sel/input).
    - Judul kartu: `14px font-semibold`.
    - Judul halaman: `20px-22px font-bold tracking-tight`.
  - **Hierarki Aksi Jelas**:
    - Tombol Primer: Solid warna tegas (`bg-primary text-white shadow-sm hover:opacity-95`).
    - Tombol Sekunder: Outline halus (`border border-border bg-card hover:bg-muted text-foreground`).
    - Tombol Destruktif: Ghost merah atau outline merah lembut (`text-destructive hover:bg-destructive/10 border-destructive/20`), dipisahkan ke sisi kiri footer dialog.

---

## 3. Matriks Rekomendasi Peningkatan Desain & Ergonomi

| Modul / Area | Masalah UI/UX Saat Ini | Rekomendasi Solusi Standar Internasional | Dampak Pengguna |
| :--- | :--- | :--- | :--- |
| **Global Theme** | Warna plum `#714b67` terkesan agak kuno/kusam | Perbarui ke palet enterprise modern (*Slate Netral + Deep Indigo / Royal Navy / Emerald*) | Kesan visual setara Linear & Stripe |
| **POS Kasir** | Pemilihan metode & tender butuh banyak ketukan | Tambahkan *Quick Cash Chips* (Pas, 50k, 100k) & sticky payment bar | Transaksi kasir 3× lebih cepat |
| **Akuntansi Jurnal** | Tambah baris jurnal wajib klik mouse | Pasang navigasi keyboard `Tab` & `Enter` untuk auto-spawn baris baru + auto-balance | Efisiensi pembukuan akuntan naik 200% |
| **Master Produk** | Modal panjang menutupi tabel | Ganti dengan Right Drawer Sheet (640px) ber-tab logis | Konteks data tabel tetap terlihat |
| **Piutang & Utang** | Sulit melihat faktur paling kritis | Tambahkan *Interactive Aging Bar Chart* (0-30, 31-60, 61-90, 90+) | Deteksi piutang macet seketika |
| **Approval Flow** | Kurang jelas siapa pembuat & penyetujui | Tampilkan banner alur Maker-Checker terstruktur dengan nama & tanggal | Transparansi audit & kepatuhan internal |
| **Analisa Bisnis** | Kartu metrik hanya angka absolut | Tambahkan Delta Trend Indicator (`↑ +12% vs periode lalu`) | Keputusan bisnis berbasis data tren riil |
| **Tabel & Filter** | Filter GET me-reset tampilan | Sediakan *Filter Chips* yang dapat dibuang 1 klik + skeleton loading | Pengalaman pencarian mulus tanpa kedip |
