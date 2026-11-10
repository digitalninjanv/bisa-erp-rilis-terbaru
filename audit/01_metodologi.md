# 01. Metodologi Audit Sistem ERP BISA-ERP

Dokumen ini menjelaskan metodologi, instrumen audit, standar referensi empiris (Fase 0), dan batasan audit sistem ERP pada repositori **bisa-erp**.

---

## 1. Peran dan Pendekatan Tim Audit

Audit dilakukan menggunakan perspektif multi-disiplin:
1. **Senior Full-Stack Engineer**: Memeriksa arsitektur kode Next.js (App Router), efisiensi query Drizzle ORM, penanganan transaksi database (`tx`), idempotensi operasi, handling error/silent catch, dan dead code.
2. **UX Designer**: Mengevaluasi konsistensi tata letak, hierarki tipografi, interaksi keyboard, form friction (tab navigation, auto-focus, dropdown vs text), affordance tombol, serta konsistensi feedback (toast/modal).
3. **QA Lead**: Menguji batas logika (edge cases: minus, null, desimal, zero-value), error paths, integritas validasi Zod klien vs server, dan regresi workflow.
4. **Akuntan / Auditor Sistem Informasi (CISA / Akuntan Publik)**: Mengaudit kepatuhan standar akuntansi (PSAK/SAK EMKM, double-entry balance, general ledger immutability, sub-ledger reconciliation, period-end cut-off, PPh 21 TER PMK 168/2023, PP 35/2021).
5. **Data Integrity Specialist**: Menilai kepemilikan data tunggal (*Single Source of Truth*), atomisitas transaksi lintas modul, pencegahan *data race* / *orphan records*, integritas *foreign key*, dan keandalan *audit trail*.

---

## 2. Perangkat & Perkakas Audit (Tools Execution)

| Perkakas / Tool | Tujuan Penggunaan | Hasil / Status |
| :--- | :--- | :--- |
| **Exa AI Search MCP** | Riset standar industri ERP, UX, Akuntansi, POS, Payroll | Berhasil dieksekusi untuk 6 domain referensi |
| **TypeScript Compiler (`tsc --noEmit`)** | Validasi integritas tipe statis di seluruh file codebase | **Lolos (Exit 0)**: 0 error tipe pada level kompilasi TypeScript |
| **ESLint (`pnpm lint`)** | Pemeriksaan kualitas kode, konvensi Next.js, dan deteksi unhandled issues | Berhasil diinisiasi via script root |
| **Ripgrep / Grep / Find** | Penelusuran pemanggilan API, server actions, route handlers, dan transaksi ORM | Digunakan untuk tracing 77 route pages dan 19 route API |
| **Drizzle ORM Schema Inspection** | Audit integritas foreign key, check constraints, default value, dan unique index | Ditemukan di 9 modul schema di `src/db/schema/` |
| **Git Log / Blame** | Penelusuran jejak refactoring dan riwayat bug | Tersedia untuk audit komparatif riwayat revisi |
| **Vitest (`pnpm test`)** | Menjalankan suite unit test eksisting | Tersedia di konfigurasi proyek |
| **Playwright (`pnpm test:e2e`)** | Menjalankan suite e2e eksisting | Tersedia di konfigurasi proyek |

*Catatan Tools*: 
- Tidak ada tools external proprietary yang ditambahkan ke runtime; semua audit dijalankan strictly **read-only** pada kode dan database tanpa memodifikasi kode produksi.

---

## 3. Dasar Riset & Standar Industri (Fase 0)

Hasil riset eksternal berikut menjadi tolok ukur obyektif (*benchmark*) dalam menilai kelayakan dan temuan audit pada aplikasi:

### A. Best Practice Form UX & Data Entry ERP
- **HPE Design System - Forms Pattern**  
  *URL*: https://design-system.hpe.design/templates/forms  
  *Kriteria*: Form wajib meminimalkan beban kognitif, indikator field wajib (*asterisk*) konsisten, pesan validasi harus inline tepat di bawah field bersangkutan, tombol aksi primer dan sekunder diletakkan konsisten di kiri bawah, dan field relasi harus mendukung pencarian/autocomplete daripada input ID manual.
- **Civic Design - Guidelines for Productivity Tools & Data Entry UIs**  
  *URL*: https://civicdesign.org/wp-content/uploads/2019/06/UI.Guide_digital_v4.pdf  
  *Kriteria*: Efisiensi input cepat: wajib mendukung navigasi full-keyboard (Tab/Shift-Tab/Enter), auto-saving/batching, meminimalkan konfirmasi modal berlebih yang memperlambat operator kasir/gudang, dan visual feedback yang jelas.
- **Oracle E-Business Suite User Interface Standards for Forms-Based Products**  
  *URL*: https://docs.oracle.com/cd/E18727-01/doc.121/e12900/T458979T458988.htm  
  *Kriteria*: Pola data density terukur, urutan tabulasi logis atas-ke-bawah atau kiri-ke-kanan, dan penanganan format moneter/desimal secara seragam.

### B. Standar Pelaporan Akuntansi & Periode Fiskal
- **DualEntry - General Ledger in ERP: A Complete Modernization Guide**  
  *URL*: https://www.dualentry.com/blog/general-ledger-in-erp  
  *Kriteria*: Buku besar umum (*General Ledger*) adalah jangkar kebenaran keuangan. Setiap jurnal harus berpasangan seimbang (Debit = Kredit), tidak boleh ada baris tanpa akun COA yang valid, dan saldo buku besar harus merekonsiliasi sub-ledger piutang/utang/persediaan secara otomatis.
- **ERPNext Documentation - Closing Accounting Books in v15**  
  *URL*: https://docs.frappe.io/erpnext/closing-accounting-books-in-erpnext  
  *Kriteria*: Tutup buku (*Period Closing*) memindahkan saldo sementara (Pendapatan & Beban) ke Laba Ditahan (*Retained Earnings*), dan periode yang sudah dikunci (*Closed*) **mutlak dilarang** menerima entri baru, edit, maupun hapus tanpa prosedur pembukaan resmi (*Reopening*).
- **Tranquil BS - Accounting Fundamentals in ERP Systems: From Journal Cycle to Financial Statements**  
  *URL*: https://www.tranquilbs.com/accounting-fundamentals-in-erp-systems/  
  *Kriteria*: Integritas alur dokumen dari dokumen sumber (faktur/receipt) → entri jurnal → buku besar → neraca saldo → laporan laba rugi dan neraca. Laba bersih berjalan pada Laba Rugi harus sama persis dengan angka penambah ekuitas pada Neraca.

### C. Pola Workflow & State Machine Dokumen ERP
- **Horizon Docs - Concepts: Documents and Posting**  
  *URL*: https://docs.horizonplatform.ai/finance/concepts/documents-and-posting/  
  *Kriteria*: Dokumen keuangan wajib mengikuti siklus state yang ketat: `Draft` (dapat diedit bebas, belum mempengaruhi stok/buku besar) → `Submitted`/`Approved` (terkunci) → `Posted` (telah membuat mutasi stok dan jurnal akuntansi) → `Cancelled`/`Reversed` (dokumen posted TIDAK BOLEH di-delete fisik/hard-delete, melainkan harus melalui jurnal balik/reversal berdokumen).
- **Light Inc - Accounting Document Types and Lifecycle**  
  *URL*: https://light.inc/help/general-ledger/document-types-lifecycle  
  *Kriteria*: *Immutability* dokumen yang sudah diposting. Setiap pembatalan wajib memunculkan dokumen pembalik bertaut (*linked reversal entry*) dan jejak audit siapa yang membatalkan.

### D. Standar POS & Penggajian (HR / Payroll Indonesia)
- **Kasir.mu & Eleo Docs - POS Shifts & Cash Drawer Reconciliation**  
  *URL*: https://kasir.mu/en/docs/shifts/  
  *URL*: https://eleo.app/documentation/cash-management/cash-shifts  
  *Kriteria*: Manajemen kasir wajib memiliki pembukaan shift (modal awal), pencatatan setoran/penarikan kas tengah hari (*cash in/out*), penghitungan blind count pada penutupan shift, perhitungan varians (selisih lebih/kurang), dan shift tidak boleh ditutup jika masih ada transaksi gantung/hold yang belum diselesaikan atau dibatalkan.
- **Kinerjio & Poveku - Metodologi Perhitungan Payroll Indonesia (PP 35/2021 & PMK 168/2023)**  
  *URL*: https://kinerjio.com/blog/cara-menghitung-payroll-karyawan-lengkap-gaji-pokok-bpjs-pph-21-dan-lembur  
  *URL*: https://poveku.com/pages/metodologi  
  *Kriteria*: Perhitungan lembur wajib sesuai PP 35/2021 (faktor 1.5x jam pertama, 2x jam berikutnya, upah sejam = 1/173 x upah sebulan); BPJS Ketenagakerjaan (JKK 0.24%-1.74%, JKM 0.30%, JHT 3.7% perusahaan + 2% karyawan, JP 2% perusahaan + 1% karyawan batas pagu); BPJS Kesehatan (4% perusahaan + 1% karyawan batas pagu); PPh 21 menggunakan skema Tarif Efektif Rata-Rata (TER Kategori A, B, C) sesuai PMK 168/2023.

### E. Pola Konsistensi Data & Immutability Lintas Modul
- **Stabiso Docs - The Ledger and Its Controls**  
  *URL*: https://stabiso.com/docs/erp/ledger/  
  *Kriteria*: Transaksi lintas modul (misal POS → Inventory → General Ledger) harus atomik dalam satu blok transaksi database (`db.transaction`). Jika salah satu gagal (misal stok tidak cukup atau akun COA hilang), seluruh transaksi harus rollback.
- **ERPNext Documentation - Immutable Ledger**  
  *URL*: https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext  
  *Kriteria*: Tabel buku besar dan kartu stok adalah *append-only*. Perubahan status atau nilai dilakukan melalui transaksi baru dengan nilai berlawanan, bukan modifikasi nilai baris yang telah ada.

### F. Standar Cetak Dokumen & Lokalisasi
- **Kazir & Fuze Store - Thermal Receipt Printing Guidelines**  
  *URL*: https://kazir.co.id/bantuan/pengaturan-toko/template-struk-thermal  
  *URL*: https://www.fuze-store.com/docs/app/printer/receipt-design  
  *Kriteria*: Lebar kertas 58mm (maks 32 karakter monospace per baris) dan 80mm (maks 48 karakter). Margin minimal, layout tanpa overflow horizontal, pemisahan jelas antara harga satuan, kuantiti, diskon, dan subtotal.
- **Format Regional Indonesia (id-ID)**  
  *Kriteria*: Format mata uang `Rp 1.250.000,00` (titik sebagai pemisah ribuan, koma sebagai pemisah desimal), penanggalan `DD/MM/YYYY` atau `DD MMMM YYYY` (bukan format US MM/DD/YYYY yang memicu salah tafsir jatuh tempo/periode faktur).
