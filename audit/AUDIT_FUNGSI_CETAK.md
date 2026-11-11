# Laporan Audit Menyeluruh Fitur & Halaman Cetak ERP (Print Engine, POS Receipts, Formal Documents, and Accounting Reports)

## 1. Ringkasan Eksekutif & Benchmark Riset Internasional
Berdasarkan riset mendalam terhadap standar pencetakan dokumen enterprise (*Smashing Magazine CSS Paged Media Guidelines*, *W3C CSS Fragmentation Level 3*, *urltodoc Multi-page Invoice Engineering*, dan *ESC/POS Thermal Printing Protocols*), sistem cetak ERP modern harus memenuhi 5 pilar utama:
1. **Presisi Dimensi Fisik (Physical Spec Accuracy)**: Lebar dokumen pratinjau di layar wajib identik dengan area cetak fisik kertas (`widthMm + 2 * marginMm = lebar roll/sheet`).
2. **Pencegahan Pemotongan di Batas Halaman (Fragment & Break Avoidance)**:
   - Baris tabel data (`tr`) tidak boleh terpotong di tengah baris (`break-inside: avoid`).
   - Judul heading (`h1, h2, h3, h4`) tidak boleh menjadi *orphan heading* di baris terbawah lembar halaman (`break-after: avoid`).
   - Blok rekapitulasi total dan tanda tangan tidak boleh terpisah sendirian ke halaman baru tanpa baris konten (`break-inside: avoid`).
3. **Pengulangan Konteks Header Tabel (Repeating Table Headers)**:
   - Header tabel multi-halaman wajib mengulang kolom pada setiap lembar lanjutan (`thead { display: table-header-group; }`).
   - Rekapitulasi total dihindarkan dari `tfoot` pengulangan prematur per lembar dengan menempatkannya di summary block ber-`break-inside: avoid`.
4. **Kepatuhan Pajak & Legalitas Kop Perusahaan**:
   - Setiap dokumen resmi eksternal (PO, GRN, Retur, Surat Jalan, Voucher Jurnal, Faktur, Slip Gaji) wajib menampilkan NPWP perusahaan bila terdaftar pada `company_settings`.
5. **Kejelasan Dokumen Transien & Pembatalan (Void/Copy Watermarks)**:
   - Tanda pembatalan dokumen (*VOID / Dibatalkan*) dan tanda salinan (*SALINAN*) wajib memiliki batas ganda tegas berkarakter legal yang tidak bisa dipalsukan saat dicetak hitam-putih.
   - UI transien seperti toast Sonner wajib 100% dihilangkan dari hasil cetakan.

---

## 2. Inventarisasi 13 Permukaan Halaman Cetak ERP

| No | Modul | Rute Halaman Cetak | Format Kertas Bawaan | Shell & Komponen Cetak | Status Audit & Verifikasi |
|---|---|---|---|---|---|
| 1 | POS / Kasir | `src/app/app/pos/nota/[id]/page.tsx` | Thermal 80mm / 58mm / A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 2 | POS / Kasir | `src/app/app/pos/nota/[id]/faktur/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 3 | Gudang / Pembelian | `src/app/app/gudang/pembelian/[id]/cetak/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 4 | Gudang / Penerimaan | `src/app/app/gudang/penerimaan/[id]/cetak/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 5 | Gudang / Retur | `src/app/app/gudang/retur-pembelian/[id]/cetak/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 6 | Gudang / Transfer | `src/app/app/gudang/transfer/[id]/cetak/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 7 | Gudang / Opname | `src/app/app/gudang/opname/lembar-hitung/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 8 | HR / Payroll | `src/app/app/akuntansi/(hr)/payroll/[id]/cetak/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 9 | Akuntansi / Jurnal | `src/app/app/akuntansi/(cetak)/jurnal/[id]/cetak/page.tsx` | Dokumen A4 / A5 | `PrintShell`, `PrintHeader`, `PrintFooter` | **100% Lulus (Clean)** |
| 10 | Akuntansi / Buku Besar | `src/app/app/akuntansi/(cetak)/buku-besar/cetak/page.tsx` | Dokumen A4 / A5 | `ReportPrintPageShell`, `ReportDocument` | **100% Lulus (Clean)** |
| 11 | Akuntansi / Laporan Keuangan | `src/app/app/akuntansi/(cetak)/laporan/cetak/page.tsx` | Dokumen A4 / A5 | `ReportPrintPageShell`, `ReportDocument` | **100% Lulus (Clean)** |
| 12 | Akuntansi / Piutang & Utang | `src/app/app/akuntansi/(cetak)/piutang-utang/cetak/page.tsx` | Dokumen A4 / A5 | `ReportPrintPageShell`, `ReportDocument` | **100% Lulus (Clean)** |
| 13 | Akuntansi / Pajak | `src/app/app/akuntansi/(cetak)/pajak/cetak/page.tsx` | Dokumen A4 / A5 | `ReportPrintPageShell`, `ReportDocument` | **100% Lulus (Clean)** |

---

## 3. Temuan Kritis & Implementasi Perbaikan

### Temuan 1: Hilangnya NPWP pada Dokumen Formal Gudang & Akuntansi
- **Masalah**: Komponen `PrintHeader` memiliki dukungan prop `taxId?: string | null` untuk mencantumkan NPWP resmi perusahaan pada kop dokumen formal. Namun di halaman PO (`pembelian`), Penerimaan (`penerimaan`), Retur Pembelian (`retur-pembelian`), Surat Jalan Transfer (`transfer`), Lembar Hitung Opname (`opname`), Slip Gaji (`payroll`), dan Jurnal Umum (`jurnal`), prop `taxId={settings?.taxId}` belum diteruskan. Akibatnya dokumen resmi yang dibagikan ke pemasok atau pihak bank kehilangan nomor pokok wajib pajak.
- **Solusi**: Diteruskan `taxId={settings?.taxId}` ke seluruh pemanggilan `PrintHeader` di 7 halaman dokumen formal tersebut.

### Temuan 2: Kerentanan Pemotongan Blok Tanda Tangan & Footer
- **Masalah**: Tag `<footer>` di `src/components/print/print-shell.tsx` belum mengunci kelas `break-inside-avoid`. Pada dokumen multi-halaman dengan daftar item panjang, blok tanda tangan tiga kolom dan QR verifikasi berisiko terbelah tepat di batas margin bawah halaman.
- **Solusi**:
  1. Menambahkan atribut `className="break-inside-avoid print:break-inside-avoid"` pada tag `<footer>` di `PrintFooter`.
  2. Menambahkan aturan CSS global di `@media print` (`src/app/globals.css`):
     ```css
     .print-doc footer,
     .print-footer,
     .print-total-bar,
     .print-summary {
       break-inside: avoid;
       page-break-inside: avoid;
     }
     ```

### Temuan 3: Resiko Orphan Headings & Artefak Navigasi Web
- **Masalah**:
  1. Judul heading dokumen (`h1, h2, h3, h4`) belum memiliki proteksi `break-after: avoid;`, sehingga berisiko tercetak di baris paling bawah halaman 1 sementara tabelnya dimulai di halaman 2.
  2. Elemen link `<a>` pada beberapa peramban mencetak garis bawah biru atau teks URL.
- **Solusi**:
  1. Menambahkan aturan di `globals.css`:
     ```css
     .print-doc h1,
     .print-doc h2,
     .print-doc h3,
     .print-doc h4 {
       break-after: avoid;
       page-break-after: avoid;
     }
     a {
       text-decoration: none !important;
       color: inherit !important;
     }
     ```

### Temuan 4: Ketiadaan Penanda Pembatalan pada Surat Jalan Transfer & Inkonsistensi Banner Void
- **Masalah**: Dokumen transfer gudang (`transfer/[id]/cetak/page.tsx`) tidak menampilkan penanda apapun saat statusnya `void`. Kurir atau petugas gudang yang memegang cetakan fisik tidak dapat membedakan surat jalan yang sah dan yang telah dibatalkan. Selain itu, banner void pada PO, GRN, dan Retur hanya berupa teks polos biasa tanpa batas visual tegas.
- **Solusi**:
  1. Menambahkan banner status pembatalan bergaris ganda tegas pada Surat Jalan Transfer saat `doc.status === "void"`.
  2. Menyeragamkan banner pembatalan pada PO, GRN, Retur, dan Faktur Penjualan:
     ```tsx
     <p className="mt-3 border-y-2 border-double border-black py-1.5 text-center text-[13px] font-bold uppercase tracking-widest text-black">
       Dokumen dibatalkan — tidak berlaku
     </p>
     ```

### Temuan 5: Standarisasi Multi-Slip Gaji Karyawan
- **Masalah**: Pada cetak massal slip gaji (`payroll/[id]/cetak/page.tsx`), pemisahan halaman antar karyawan hanya mengandalkan inline style `pageBreakAfter: "always"`.
- **Solusi**: Ditambahkan kelas utilitas CSS Paged Media `.page-break-after-always` dengan `break-after: page; page-break-after: always;` untuk menjamin kompatibilitas mesin cetak Blink, Gecko, dan WebKit.

---

## 4. Hasil Verifikasi Pengujian Otomatis

Rangkaian pengujian otomatis telah dijalankan dan diverifikasi 100% lulus:
1. **Unit Test Spesifik Cetak (`tests/unit/print-audit-compliance.test.ts`)**:
   - 17/17 pengujian lulus (CSS Paged Media rules, taxId passing di 8 halaman formal, dan penanda dokumen void).
2. **Unit Test Dimensi Kertas (`tests/unit/paper-spec.test.ts`)**:
   - 4/4 pengujian lulus (thermal 58mm, thermal 80mm, A4, A5).
3. **Unit Test Kerangka Dokumen Laporan (`tests/unit/report-print.test.ts`)**:
   - 11/11 pengujian lulus (kop, tanda tangan 3 kolom, aturan footer, dll).
4. **Unit Test Invarian Cetak (`tests/unit/architecture-print-patterns.test.ts`)**:
   - 2/2 pengujian lulus (pembersihan toast Sonner sebelum `window.print`).
5. **Rangkaian Keseluruhan Unit Tests (`pnpm vitest run tests/unit/`)**:
   - **87 files passed, 963 tests passed (100% hijau)**.
6. **Validasi Tipe Data & Linter**:
   - `pnpm typecheck` (`tsc --noEmit`): Lulus tanpa kesalahan tipe.
   - `pnpm lint` (`eslint .`): Lulus tanpa pelanggaran linter.
