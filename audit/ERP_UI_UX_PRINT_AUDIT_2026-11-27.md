# Audit Menyeluruh UI/UX, Cetak, dan Kemudahan Penggunaan Bisa ERP

**Tanggal:** 27 November 2026  
**Basis kode:** working tree setelah commit `a44918e`  
**Metode:** source audit + 77 route smoke + Chromium hidup (1440×900, 390×844, 360×844) + axe-core + riset Firecrawl/Exa + sub-audit cetak dan mobile.

---

## 1. Ringkasan eksekutif

Audit ini mencakup seluruh keluarga layar ERP yang dapat diakses tanpa parameter dinamis, tiga jalur cetak (nota web, HTML offline/Electron, ESC/POS), serta alur kerja yang paling sering dipakai kasir, gudang, akuntansi, dan admin.

**Hasil utama:**

- **77/77 route statis** merespons 200, tidak ada layar error, dan tidak ada console error.
- **15 pola layar kunci** diukur pada desktop dan mobile; **0 overflow horizontal**.
- **axe-core 0 violations** pada sampel akhir desktop/mobile setelah perbaikan.
- **1.266 test lulus**, build/typecheck lulus, lint **0 error** (7 warning lama).
- **18 temuan diperbaiki** pada putaran ini, termasuk 6 isu P1.
- **Sisa backlog** yang jujur didokumentasikan di §8; yang terbesar adalah first print yang masih memakai snapshot klien, adopsi DataTable yang belum merata, dan beberapa tabel mobile yang masih perlu isyarat gulir.

Prinsip yang dipakai: **overview first, detail on demand**; satu aksi utama per layar; konfirmasi untuk tindakan yang membuang data; dan nota thermal yang bisa dibaca dari atas ke bawah tanpa menebak.

---

## 2. Cakupan dan metode

### 2.1 Cakupan

| Area | Yang diperiksa |
|---|---|
| POS | terminal, pembayaran, tahanan, riwayat, retur, piutang, sesi, nota, faktur, offline |
| Gudang | ringkasan, produk, kategori/satuan, penerimaan, pembelian, transfer, opname, nilai persediaan, pergerakan |
| Akuntansi & HR | beranda, jurnal, buku besar, laporan, pajak, payroll, kasbon, pinjaman, aset, bank |
| Pengaturan | identitas/pajak, gudang/cabang, pengguna/peran, cetak, modul, metode bayar, penomoran |
| Cetak | nota thermal web, HTML offline/Electron, ESC/POS 58/80mm, faktur A4/A5, pratinjau pengaturan cetak |
| Lintas layar | shell, sidebar, command palette, topbar mobile, tabel, form, dialog, state kosong |

### 2.2 Bukti pengukuran

- **77 route statis** diuji otomatis: status HTTP, judul, teks error, console/page error.
- **15 pola layar** diukur pada 1440×900 dan 390×844: overflow, teks <11px, target sentuh, label input, jumlah `h1`, axe.
- **Uji regresi terarah:** topbar 360/390, focus trap command palette, filter produk, anchor kebijakan stok, batal jurnal, isi nota.
- **Screenshot:** `audit/checks/system-ux/beranda-mobile.png`, `produk-mobile.png`, `produk-desktop.png`, `penerimaan-desktop.png`, `pengguna-desktop.png`, `nota.png`, `nota-after.png`, `faktur.png`, `command-palette.png`, `settings-unsaved-dialog.png`, `journal-cancel-dialog.png`.

### 2.3 Riset eksternal

Riset dipakai untuk menilai nota dan hierarki layar, bukan untuk menyalin merek:

- **iSmartSync — POS Receipt Design**: urutan kop toko/outlet, nomor & waktu, kasir, item + qty/harga, diskon per baris, subtotal/pajak/total, metode bayar & kembalian, kebijakan retur, footer, QR opsional.
- **Repceipt — How receipts are actually designed**: nota nyata didominasi teks dan garis pemisah; urutan yang bertahan adalah identitas toko → metadata → aturan → item → aturan → total → pembayaran → footer → barcode/QR.
- **Shopify POS — printed receipt customization**: header/content/footer dipisah; nomor pajak, elemen baris, kebijakan retur, dan QR adalah blok yang dapat dikonfigurasi.
- **Nielsen Norman Group — progressive disclosure**: tampilkan yang paling sering dipakai lebih dulu; detail lanjutan di balik aksi.
- **UXmatters — Designing the ERP Dashboard UX**: angka ringkas dulu, detail di tabel/drill-down; visualisasi mengikuti tipe data.
- **ACM — Evaluation criteria for assessing the usability of ERP systems**: navigasi, pencarian, bantuan urutan langkah, pencegahan/pemulihan error adalah kriteria usability ERP, bukan tambahan kosmetik.
- **SCITEPRESS — Mastering ERP Interface Complexity**: overview → zoom/filter → detail on demand; label harus memakai bahasa pengguna.

---

## 3. Peta fungsi dan cetak

### 3.1 Modul dan alur utama

- **POS**: katalog + barcode → keranjang → dialog bayar → pembayaran → struk/nota → sesi kas; tahanan, retur, piutang, offline queue, dan cetak thermal.
- **Gudang**: master produk/kategori/satuan → permintaan/pesanan → penerimaan → stok/AVCO → transfer/opname/penyesuaian → retur pembelian.
- **Akuntansi**: COA → jurnal → buku besar → laporan → pajak → rekonsiliasi/bank → aset.
- **HR/Payroll**: karyawan → absensi/cuti/lembur → payroll → kasbon/pinjaman → slip gaji.
- **Pengaturan**: identitas/pajak, gudang/cabang, pengguna/peran, cetak, modul, pembayaran, penomoran.
- **Cetak**: satu mesin cetak dengan template global + override per dokumen; nota thermal, faktur, PO, GRN, retur, transfer, opname, jurnal, payroll, Z-report.

### 3.2 Tiga jalur nota

| Jalur | Kekuatan | Keterbatasan |
|---|---|---|
| Nota web `/app/pos/nota/[id]` | template, logo, kop/kaki, QR, audit cetak ulang, faktur | bergantung server; cetak ulang menulis audit saat halaman dibuka |
| HTML offline/Electron | instan, tanpa round-trip, bisa QR | bukan mesin template penuh; QR perlu data URL |
| ESC/POS | langsung ke printer thermal, laci kasir, cut | teks monospace; tidak ada logo/template |

Putaran ini menyelaraskan **identitas outlet, NPWP, sesi, jatuh tempo, jumlah item, status lunas, penanda retur/void, kuantitas pecahan, dan status pembayaran** di ketiga jalur.

---

## 4. Temuan dan tindakan

### 4.1 P1 — diperbaiki

| ID | Temuan | Tindakan |
|---|---|---|
| P1-01 | Topbar Beranda meluber di 360–390px; menu pengguna tidak terjangkau | Command palette menjadi ikon di mobile, subtitle merek disembunyikan <`sm`; terukur `maxRight` 339/369 pada viewport 360/390 |
| P1-02 | Kuantitas pecahan (0,25 / 0,5 / 1,5) dibulatkan menjadi 0/1/2 pada HTML & ESC/POS | `formatQty` + `qtyBase`; total item memakai satuan dasar yang sama dengan nota web |
| P1-03 | Baris harga grup tidak konsisten: “2 × Rp900” + diskon Rp200 tetapi subtotal Rp1.800 | Harga baris memakai harga normal + diskon grup, sehingga terbaca “2 × Rp1.000 − Rp200 = Rp1.800” |
| P1-04 | Nota retur/void bisa tercetak seperti nota asli di HTML/ESC/POS | `saleStatus` + banner **NOTA RETUR** / **VOID** di ketiga jalur |
| P1-05 | Command palette bukan dialog nyata: Tab keluar ke latar, Escape mati, fokus hilang | Focus trap, Escape global, scroll lock, `role=dialog`, fokus kembali ke pemicu |
| P1-06 | “Batal” di jurnal membuang draf tanpa konfirmasi | `ConfirmDialog` + `beforeunload` saat form kotor |

### 4.2 P2 — diperbaiki

| ID | Temuan | Tindakan |
|---|---|---|
| P2-01 | Chip “Stok menipis” menghapus filter kategori & gudang | `FilterChips` membawa `category`, `warehouse`, `q`, `urut`, `arah`; diuji lewat URL |
| P2-02 | Guard “perubahan belum disimpan” produk mengabaikan stok minimum, batch/serial, status aktif, atribut, kemasan | Perbandingan baseline mencakup seluruh field + atribut + baris kemasan |
| P2-03 | Ubah massal & ekspor memakai gudang default, bukan gudang yang terlihat | `warehouseId` diteruskan ke preview/apply/export dan divalidasi terhadap daftar gudang perusahaan |
| P2-04 | Perubahan Pengaturan hilang saat pindah tab/sidebar | Konfirmasi navigasi internal + `beforeunload`; terverifikasi dialog muncul dan “Tetap di sini” mempertahankan halaman |
| P2-05 | Tautan “Ubah di Tab Umum” menuju `#kebijakan-stok` yang tidak ada | Target `id` ditambahkan + `scroll-mt`; terverifikasi URL `?tab=umum#kebijakan-stok` dan target terlihat |
| P2-06 | Nota kehilangan identitas outlet, NPWP, sesi, jatuh tempo, jumlah item, status | Ditambahkan di nota web, HTML offline, dan ESC/POS; outlet diambil dari cabang sesi kas |
| P2-07 | DPP faktur salah saat ada pembulatan/barang bebas pajak; NPWP pembeli tidak tercetak | DPP = jumlah neto baris kena PPN; NPWP pelanggan ditampilkan |
| P2-08 | Logo 58mm bisa melebihi lebar kertas; referensi panjang meluber | Logo dibatasi 100% lebar nota; referensi memakai `word-break` |
| P2-09 | QR hilang di HTML offline/Electron | QR data URL dihasilkan sebelum cetak pertama Electron |
| P2-10 | Pratinjau cetak tidak memperlihatkan PPN, pembayaran, kembalian, status | Pratinjau kini memuat baris-baris tersebut dan mengikuti saklar PPN |
| P2-11 | KPI Beranda menyisakan kartu ganjil di mobile; target sentuh 18–30px; teks produk 10px | Kartu terakhir mengisi dua kolom; target utama minimal 44px; teks produk naik ke 11px |
| P2-12 | axe: select peran tanpa nama, region gulir tidak fokusable, kontras chip analisa 3.1:1 | `aria-label`, `tabIndex`/`role=region`, opasitas kontras dihilangkan |

### 4.3 P3 — diperbaiki

| ID | Temuan | Tindakan |
|---|---|---|
| P3-01 | Tautan riwayat/piutang membuka nota tanpa penanda salinan | Ditambahkan `?salinan=1` pada tautan riwayat POS dan piutang |
| P3-02 | Label “Faktur A4” padahal dokumen bisa A5 | Label menjadi “Faktur” |
| P3-03 | Jatuh tempo ESC/POS bisa tercetak ISO mentah | Dinormalisasi ke format tanggal Indonesia |
| P3-04 | Label ringkasan memakai uppercase 11px, menyimpang dari bahasa desain | Menjadi sentence case 12px/500 |

### 4.4 Sisa backlog (belum ditutup)

| Prioritas | Sisa | Alasan / dampak |
|---|---|---|
| P1 | First print masih memakai quote klien; jika harga berubah antara quote dan commit, baris bisa berbeda dari TOTAL | Perlu `ReceiptData` dari sale yang sudah commit; perubahan menyentuh jalur checkout kritis |
| P2 | Beberapa tabel mobile (pengaturan pembayaran, pratinjau ubah massal) masih perlu gulir horizontal tanpa isyarat visual | Perlu pola kartu/scroll-hint bersama |
| P2 | Sebagian aksi primer mobile masih 32–36px (mis. tombol di panel lain) | Perlu sapuan target sentuh menyeluruh |
| P2 | Adopsi `DataTable` TanStack belum merata; banyak tabel masih HTML primitif | Pekerjaan migrasi bertahap, bukan satu file |
| P2 | Faktur kredit belum mencetak rekening tujuan transfer | Perlu data rekening bank perusahaan di faktur |
| P3 | Halaman A4/A5 yang dipakai sebagai nota masih mendapat nomor halaman | Perlu pengecualian `paged` untuk nota sheet |
| P3 | Label/istilah nota masih berbeda antarpath (“No.” vs “No. Nota”, footer default) | Perlu satu konstanta label bersama |
| P3 | `showQr` di HTML offline hanya aktif bila QR data URL tersedia | Jalur non-Electron perlu generator QR sendiri |
| P3 | Multi-outlet: `sales.branchId` historis masih kosong; jalur baca memakai cabang sesi | Perlu backfill/isi saat persist untuk laporan jangka panjang |

---

## 5. Desain nota — keputusan yang diterapkan

Urutan nota sekarang konsisten dengan praktik nota retail:

1. **Identitas penjual**: nama badan, outlet/cabang, alamat outlet, telepon, NPWP.
2. **Metadata**: nomor nota, tanggal/waktu, kasir, sesi, pelanggan, jatuh tempo.
3. **Aturan pemisah** yang jelas antara kop, item, total, dan footer.
4. **Item**: nama, SKU (web), qty × harga, diskon baris, subtotal baris.
5. **Ringkasan**: jumlah item (satuan dasar), subtotal, diskon, PPN termasuk, pembulatan, **TOTAL**.
6. **Pembayaran**: metode, nominal, diterima (tunai), referensi, kembalian, status **LUNAS / BELUM LUNAS**.
7. **Penanda khusus**: SALINAN, VOID, NOTA RETUR.
8. **Footer**: kebijakan retur bawaan, QR nomor dokumen (bila aktif), baris merek.

Prinsip yang dipakai: satu pandangan mata untuk TOTAL dan status; diskon tidak disembunyikan; outlet harus terlihat; nota retur/void tidak boleh menyamar sebagai nota asli.

---

## 6. Perbaikan kemudahan penggunaan yang paling terasa

1. **Kasir**: kuantitas pecahan benar, status lunas jelas, QR dan outlet ada, penanda retur/void tidak ambigu.
2. **Gudang**: filter kategori/gudang tidak hilang saat memilih “Stok menipis”; ubah massal dan ekspor memakai gudang yang benar; form produk memperingatkan perubahan batch/serial/status.
3. **Akuntansi**: “Batal” jurnal tidak lagi membuang draf; DPP faktur benar; command palette bisa dipakai keyboard tanpa jebakan fokus.
4. **Admin**: perubahan pengaturan tidak hilang diam-diam; tautan kebijakan stok benar-benar membuka kontrol yang dimaksud.
5. **Mobile**: topbar tidak meluber di 360px; kartu KPI ganjil mengisi lebar; tombol utama jurnal/produk/pengaturan naik ke 44px; teks produk tidak lagi 10px.

---

## 7. Verifikasi akhir

| Gerbang | Hasil |
|---|---|
| Unit test | **146 file / 1.266 test lulus** |
| Build + typecheck | **lulus** |
| Lint | **0 error**, 7 warning lama |
| Route smoke | **77/77 route** status 200, 0 layar error, 0 console error |
| axe-core | **0 violations** pada sampel desktop/mobile |
| Overflow | **0** pada 30 kombinasi halaman/viewport |
| Regresi topbar | 360px `maxRight=339`, 390px `maxRight=369`, tanpa overflow |
| Regresi command palette | 14× Tab tetap di dialog, Escape menutup, fokus kembali |
| Regresi filter produk | `category`, `warehouse`, `q`, `lowStock` semuanya bertahan |
| Regresi pengaturan | dialog konfirmasi muncul; “Tetap di sini” mempertahankan halaman |
| Regresi jurnal | dialog “Batalkan jurnal ini?” muncul |
| Nota | “Jumlah item” dan “Status LUNAS” tercetak |

**Screenshot bukti:** `audit/checks/system-ux/` (lihat §2.2).  
**Log mentah:** `audit/checks/full-route-smoke-final.log`, `system-ux-audit-final.log`, `ux-regression-final.log`, `axe-detail-after2.log`, `erp-ui-print-unit.log`, `erp-ui-print-lint2.log`, `erp-ui-print-build-final.log`.

---

## 8. Rekomendasi urutan kerja berikutnya

1. **P1**: buat snapshot `ReceiptData` dari sale yang sudah commit dan pakai untuk first print.
2. **P2**: sapu target sentuh 44px pada semua aksi primer mobile; tambahkan isyarat gulir pada tabel lebar.
3. **P2**: migrasikan tabel utama (produk, jurnal, riwayat POS, penerimaan) ke `DataTable` bertahap.
4. **P2**: tampilkan rekening tujuan transfer pada faktur kredit.
5. **P3**: satukan konstanta label/footer nota; kecualikan nomor halaman untuk nota sheet A4/A5; backfill `sales.branchId`.

Audit ini tidak mengklaim seluruh 97 pola dinamis diuji end-to-end; 77 route statis dan 15 pola kunci diuji hidup, sedangkan detail dinamis diwakili oleh nota, faktur, jurnal, payroll, dan dokumen yang disebut di atas. Sisa risiko utama ada pada perangkat keras printer, Windows/Electron, dan transaksi volume besar.
