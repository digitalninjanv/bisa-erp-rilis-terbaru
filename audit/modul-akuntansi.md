# Laporan Audit Modul: Akuntansi Dasar & Keuangan (Accounting)

- **Kode Modul**: `akuntansi`
- **Prefix Temuan**: `AKN-*`
- **Lingkup**: Bagan Akun (COA), Jurnal Umum, Jurnal Penyesuaian, Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Arus Kas, Kas & Bank, Rekonsiliasi Bank, Aset Tetap & Penyusutan, Pajak (PPN), Periode Fiskal & Tutup Buku, Rekonsiliasi Kontrol, dan Migrasi COA.

---

## 1. Ikhtisar & Skor Modul

| Dimensi Audit | Skor (1-5) | Catatan Ringkas |
| :--- | :---: | :--- |
| **Fungsi (Happy & Error Path)** | 3.5 | Double-entry balance dan period closing dilindungi dengan baik; terdapat cacat logika pada ringkasan rekonsiliasi bank dan izin jurnal manual ke akun kontrol. |
| **Tampilan Visual (UI)** | 3.0 | Tabel jurnal dan laporan keuangan fungsional namun padat; format angka di beberapa modal tidak konsisten dengan `id-ID`. |
| **Pengalaman Pengguna (UX)** | 3.0 | Menu Accurate-like memudahkan akuntan, tetapi tidak ada peringatan dini saat pengguna memasukkan jurnal ke akun kontrol sub-ledger. |
| **Workflow & State Machine** | 4.5 | Pola append-only ledger sangat kuat (larangan hard-delete jurnal posted, reversal berdokumen, lock periode fiskal). |
| **Integritas Data & Atomisitas**| 4.0 | Jurnal seimbang (Debit = Kredit), baris satu sisi dan non-negatif ditegakkan di level aplikasi dan DB. |
| **Laporan & Akurasi Angka** | 3.5 | Laba Rugi dan Neraca sinkron (balanced flag < 0.01), namun rumus rekonsiliasi bank rentan menghasilkan nilai negatif artifisial. |
| **Performa & Query** | 2.5 | `evaluateCashNegativeGuard` mengeksekusi iterasi `.reduce()` di memori Node.js atas seluruh baris historis akun kas/bank tanpa indeks/agregasi DB. |
| **Hak Akses & Keamanan** | 4.0 | Pemisahan izin `accounting.view`, `accounting.post`, dan `accounting.manage` terpasang rapi di seluruh server actions. |

---

## 2. Rincian Temuan Audit

### AKN-001: Rumus Rekonsiliasi Bank Menghasilkan Nilai Negatif (*Flawed Reconciliation Formula*)
- **Severity**: **Tinggi**
- **Kategori**: Logika Akuntansi & Pengujian
- **Tingkat Keyakinan**: **Tinggi** (Terbukti gagal pada suite tes integrasi)
- **Bukti Kode**:
  - `src/server/bank-reconciliation/reads.ts:89-98`
  - `tests/integration/review-fixes-t4rb.test.ts:252:55` (`AssertionError: expected false to be true; expect(d(afterFuture.unreconciledTotal).gte(0)).toBe(true)`)
- **Deskripsi Masalah**:
  Pada fungsi `getReconciliationSummary`:
  ```typescript
  unreconciledTotal: toDb(bookBalance.minus(reconciledTotal))
  ```
  Sistem hanya melakukan pengurangan skalar `bookBalance - reconciledTotal`. Dalam standar akuntansi (reconciliation statement), rekening bank memiliki mutasi dua arah (debit untuk setoran masuk, kredit untuk penarikan/cek keluar/biaya bank). Apabila mutasi penarikan (kredit) lebih besar atau rekening mengalami cerukan/overdraft, perhitungan skalar sederhana ini menghasilkan nilai negatif dan tidak memisahkan pos *Deposit in Transit* (setoran dalam perjalanan) dari *Outstanding Checks* (cek yang belum dicairkan).
- **Dampak Bisnis**:
  Akuntan perusahaan melihat angka "selisih belum terekonsiliasi" bernilai negatif pada dashboard bank, memicu kebingungan interpretasi audit dan menyulitkan pelacakan selisih riil kas fisik vs mutasi rekening koran.
- **Rekomendasi Perbaikan**:
  Ubah struktur output rekonsiliasi bank mengikuti standar formal rekonsiliasi 4-kolom atau pemisahan jelas:
  1. Saldo Buku vs Saldo Bank.
  2. Ditambah: Setoran dalam proses (*Deposit in Transit*).
  3. Dikurang: Pengeluaran belum tercatat bank (*Outstanding Payments*).
  4. Saldo Rekonsiliasi Disesuaikan (*Adjusted Balance*).
- **Estimasi Effort**: **M (Medium)**

---

### AKN-002: Jurnal Manual Bebas Memposting ke Akun Kontrol (*Control Accounts Pollution*)
- **Severity**: **Tinggi**
- **Kategori**: Integritas Data & Workflow
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `postManualJournalAction`)
- **Bukti Kode**:
  - `src/server/actions/accounting/jurnal.ts:25-95`
  - `src/server/reports/control.ts:47-50`
- **Deskripsi Masalah**:
  Pada `postManualJournalAction`, sistem memvalidasi eksistensi pihak bertag (`partyId`), namun **tidak melarang** pengguna memilih akun kontrol sub-ledger sistem (misal akun Piutang Usaha `110300`, Hutang Usaha `210100`, atau Persediaan `110500`). 
  Dokumentasi internal di `control.ts` bahkan mencatat: *"Jurnal manual yang menyentuh akun kontrol — tersangka pertama bila selisih ≠ 0, karena jalur modul tidak pernah memposting ke akun kontrol di luar subledgernya."*
- **Dampak Bisnis**:
  Jika pengguna memasukkan penyesuaian manual langsung ke akun Piutang atau Persediaan lewat Jurnal Umum, saldo Buku Besar (GL) akan langsung menyimpang permanen dari kartu stok gudang dan sub-ledger piutang/utang. Laporan Rekonsiliasi Kontrol (`/app/akuntansi/rekonsiliasi-kontrol`) akan selamanya menunjukkan *discrepancy* (selisih).
- **Rekomendasi Perbaikan**:
  Terapkan proteksi ketat pada `postManualJournalAction`: periksa apakah `accountId` termasuk dalam akun kontrol yang terpetakan (`account_mappings`). Jika ya, tolak dengan pesan: *"Akun kontrol persediaan/piutang/utang hanya dapat dimutasi melalui dokumen operasional terkait (penerimaan gudang, faktur, retur)."*
- **Estimasi Effort**: **S (Small)**

---

### AKN-003: N+1 Memory Bottleneck pada `evaluateCashNegativeGuard`
- **Severity**: **Sedang**
- **Kategori**: Performa & Skalabilitas Database
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode)
- **Bukti Kode**:
  - `src/server/accounting.ts:280-320`
- **Deskripsi Masalah**:
  Fungsi penjaga saldo kas negatif (`evaluateCashNegativeGuard`) dieksekusi pada setiap pemanggilan `postJournal`. Untuk setiap akun kas/bank yang mengalami pengeluaran, sistem menjalankan:
  ```typescript
  const postedLines = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalLines.accountId, accountId), eq(journalEntries.status, "posted")));
  const balance = postedLines.reduce((acc, row) => acc.plus(row.debit).minus(row.credit), d(0));
  ```
  Query ini mengambil **seluruh baris historis** akun kas/bank ke dalam memori Node.js dan menjumlahkannya menggunakan array `.reduce()` di JavaScript.
- **Dampak Bisnis**:
  Pada minimarket yang beroperasi selama setahun dengan 50.000+ transaksi kas, query ini menarik ribuan baris data ke server pada setiap transaksi checkout kasir, memicu latensi tinggi (*lag*), konsumsi RAM melonjak, dan potensi transaksi timeout di kasir.
- **Rekomendasi Perbaikan**:
  Ganti query raw fetch + reduce dengan agregasi SQL langsung di database engine:
  ```sql
  SELECT coalesce(sum(debit) - sum(credit), 0) FROM journal_lines ...
  ```
  Atau gunakan tabel ringkasan saldo bulanan `account_monthly_balances` ditambah saldo bulan berjalan.
- **Estimasi Effort**: **S (Small)**

---

### AKN-004: Penanganan Potongan Pajak PPh (Withholding) Tidak Terintegrasi Otomatis ke Laporan SPT
- **Severity**: **Sedang**
- **Kategori**: Kepatuhan Pajak (Tax Compliance)
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari inspeksi modul pajak)
- **Bukti Kode**:
  - `src/server/reports/vat.ts`
  - `src/app/app/akuntansi/(akuntansi)/pajak/page.tsx`
- **Deskripsi Masalah**:
  Menu Pajak (`/app/akuntansi/pajak`) saat ini **hanya menangani PPN** (Pajak Pertambahan Nilai 11%). Walaupun pada transaksi pembayaran utang (`payPayableAction`) terdapat saklar dan akun pemotongan PPh Pasal 23/21 (`withholding`), sistem tidak menyediakan laporan kompilasi bukti potong PPh, daftar objek pemotongan pajak, maupun rekap SPT Masa PPh 21/23.
- **Dampak Bisnis**:
  Bagian keuangan harus merekapitulasi bukti potong PPh secara manual di luar sistem ERP saat masa pelaporan pajak bulanan ke DJP Online, memperbesar risiko denda keterlambatan atau salah hitung pajak.
- **Rekomendasi Perbaikan**:
  Tambahkan tabulasi pelaporan PPh pada modul Pajak: rekapitulasi nilai bruto, tarif pemotongan, NPWP pihak terpotong, dan nomor bukti potong.
- **Estimasi Effort**: **M (Medium)**

---

### AKN-005: Form Beban Mandiri Menjadi Rute Orphan Tanpa Navigasi Terpadu
- **Severity**: **Rendah**
- **Kategori**: Navigasi & UX
- **Tingkat Keyakinan**: **Tinggi** (Terbukti dari kode `beban/page.tsx`)
- **Bukti Kode**:
  - `src/app/app/akuntansi/(akuntansi)/beban/page.tsx:1-14`
- **Deskripsi Masalah**:
  Halaman `/app/akuntansi/beban` berisi pengalihan hardcode `redirect("/app/akuntansi/jurnal/baru")`. Tidak ada banner edukasi atau penjelasan kepada pengguna yang mengakses rute lama bahwa modul beban telah dilebur ke Jurnal Umum.
- **Dampak Bisnis**:
  Pengguna lama yang memiliki bookmark atau mencari menu "Beban Operasional" merasa bingung karena tiba-tiba diarahkan ke formulir Jurnal Umum yang memiliki tampilan multi-debit/kredit lebih teknis.
- **Rekomendasi Perbaikan**:
  Berikan *toast* atau infobox transisi di `/app/akuntansi/jurnal/baru?source=beban`: *"Pencatatan beban operasional kini disatukan ke Jurnal Umum satu pintu untuk memastikan kepatuhan pembukuan."*
- **Estimasi Effort**: **S (Small)**
