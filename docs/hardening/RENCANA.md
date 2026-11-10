# RENCANA A-28 — Full Auto Audit + Hardening ERP Minimarket

Program **A-28** · Audit acuan: `docs/hardening/AUDIT-BASELINE-A28.md` (Tahap 0, HEAD `7e0acb5`).
Aturan program (mengikat semua tahap):

- **Urutan mandat pengguna**: POS → Gudang → Akuntansi → Pengaturan (standar input global) → HR → Cross-module + Simulasi → Penutup. Tahap berjalan berurutan; di dalam tahap, satu pemilik per berkas.
- **Angka bisnis tidak berubah** kecuali perubahan perilaku yang dinyatakan eksplisit per tahap (mis. larangan jual batch kedaluwarsa) dan dibuktikan test sebelum/sesudah.
- **Gerbang tiap tahap**: reseed bersih → suite penuh (≥ baseline tahap sebelumnya, tidak boleh turun) + typecheck/lint/build + e2e 19/19; tahap hanya dinyatakan selesai oleh Pemimpin sesudah bukti gerbang dibaca.
- Kontrak kualitas kode (`docs/PANDUAN-KUALITAS-KODE.md`) & penjaga arsitektur A-26 berlaku penuh: perbaikan lewat jalur terpusat yang ada (`postJournal`, `movements.ts`, `MoneyInput`, fungsi domain), jangan lemahkan test.
- Keputusan pemilik TIDAK dieksekusi diam-diam: H-POS-06 (PIN supervisor) dan gerbang harga massal tetap menunggu pemilik; tahap yang menyentuhnya hanya menyiapkan permukaan yang tidak mengubah kebijakan.

---

## Peta tahap

- [x] **Tahap 0 — Audit baseline empiris** (`AUDIT-BASELINE-A28.md`): gerbang kini hijau penuh (test 1741/1741, e2e 19/19), SIM-2 28 berkas/256 test lulus dijalankan ulang, sapuan input terhitung, jalur ganda diperiksa, 16 temuan bernomor (7 Must / 8 Should / 1 keputusan pemilik). Tanpa perubahan kode.

- [x] **Tahap 1 — POS** *(H-POS-01, 02, 03, 04, 05)*
  - Tutup sesi buta: formulir tutup tidak menampilkan expected/selisih sampai hitungan dimasukkan & dikunci (langkah dua tahap mengikuti pola hitung buta opname); selisih tampil sesudahnya.
  - Toleransi selisih sesi sebagai **pengaturan** (bukan angka mati): selisih melewati toleransi wajib alasan tertulis; alasan wajib juga untuk selisih berapa pun di luar nol bila diatur; jurnal selisih & audit yang ada dipertahankan.
  - Hitungan tunai berdenominasi (pecahan × jumlah, total dihitung sistem) sebagai cara masukan `countedCash`; angka total tetap satu-satunya nilai yang disimpan domain.
  - Cetak ulang bertanda: halaman nota menerima penanda salinan (dari riwayat/cetak ulang) dan mencetak pita "SALINAN — bukan nota asli"; cetakan pertama dari terminal tidak bertanda.
  - Struk mencetak identitas sesi (nomor sesi; terminal bila tersedia dari data sesi).
  - H-POS-06 (PIN) **tidak** dikerjakan — menunggu keputusan pemilik; dicatat di laporan tahap.
  - Pemilik berkas: `src/components/pos/session-manager.tsx`, `src/server/pos/sessions.ts`, halaman `src/app/app/pos/nota/[id]/page.tsx` + pemanggil cetak ulang, pengaturan sesi di `src/server/settings.ts`/formulir terkait.
  - Gerbang: suite + e2e; test baru: tutup buta (expected tak terhitung sebelum kunci), toleransi & alasan wajib, denominasi menjumlah benar, nota salinan bertanda & asli tidak.

- [x] **Tahap 2 — Gudang** *(H-GDG-01, 02)*
  - Batch kedaluwarsa **tidak dapat dialokasikan** ke penjualan/dokumen keluar penjualan: alokasi FEFO melewati batch yang expiry-nya sudah lewat tanggal dokumen; bila hanya batch kedaluwarsa yang tersedia → penolakan berpesan bernama (arahkan ke dokumen `expired`). Perilaku dokumen koreksi (adjustment `expired`, retur, opname) tidak berubah. Test paritas: skenario SIM S1.4 FEFO yang ada tetap hijau (lot belum kedaluwarsa), skenario baru membuktikan lot kedaluwarsa tertolak.
  - Peringatan kedaluwarsa: permukaan peringatan bertingkat yang sudah sebagian ada disatukan ke daftar kerja gudang (mendekati kedaluwarsa per ambang pengaturan); alur markdown harga adalah Should lanjutan — dikerjakan hanya bila ambang & daftarnya selesai tahap ini, sisanya dicatat jujur.
  - Pemilik berkas: `src/server/inventory/movements.ts` (alokasi), `src/server/pos/sales-stock.ts` (konsumen), permukaan peringatan gudang yang ada.
  - Gerbang: suite + e2e; SIM-2 penuh hijau.

- [x] **Tahap 3 — Akuntansi** *(H-AKT-01, 02)*
  - Ekspor **XLSX berformat** laporan keuangan (neraca, laba rugi, arus kas, buku besar, aging) dengan isi identik layar/CSV: hierarki grup, kolom komparatif + selisih, kop perusahaan & periode; memakai pustaka xlsx yang sudah ter-pin proyek (keputusan A-24: pertahankan 0.20.3) tanpa dependensi baru; test paritas angka CSV vs XLSX per laporan.
  - Satu definisi kas untuk laporan: subjek kas arus kas & kartu ringkasan diselaraskan ke definisi kelas kas/bank (atau keputusan tertulis sebaliknya di dokumen tahap) — angka dashboard & laporan harus rekonsiliasi.
  - Pemilik berkas: `src/app/api/export/report/route.ts` + modul ekspor baru di `src/server/reports/`, `src/server/reports/statements.ts`/`overview.ts` untuk definisi kas.
  - Gerbang: suite + e2e; test paritas ekspor.

- [x] **Tahap 4 — Pengaturan & standar input global** *(H-PGT-01, 02, 03)*
  - Migrasi field uang mentah ke `MoneyInput` per daftar H-PGT-01 (harga produk & edit massal, gaji panel HR, saldo awal, limit kredit, mutasi manual rekonsiliasi, kas sesi POS); nilai & payload server **tidak berubah** (MoneyInput menghasilkan string kanonis yang sama dengan yang dikirim field mentah hari ini — dibuktikan test paritas payload per formulir utama).
    - *Hasil:* semua situs daftar bermigrasi KECUALI nilai operasi edit harga massal — tetap mentah beralasan tertulis di PROGRESS §0K (field delta bertanda tiga mode; kontrak komponen bersama menolak minus). Tender POS tetap kategori terminal (target Tahap 7).
  - `feeValue` metode pembayaran: input mengikuti mode fee (persen → `PercentInput`, nominal → `MoneyInput`), label menampilkan mode secara eksplisit.
  - Persen mentah tersisa → `PercentInput` (sisa nilai aset tetap); tanggal mentah pada formulir bisnis utama → `DateField` (saldo awal lebih dulu; sisanya terdaftar bila tidak selesai).
  - Komponen `QtyInput` bersama (desimal terpusat per presisi) diadopsi line-editor & opname lebih dulu; konsumen lain terdaftar.
    - *Hasil (keputusan tahap, menyimpang dari rencana awal & dicatat):* `QtyInput` bersama TIDAK dibangun — kuantitas tetap desimal polos konsisten `inputMode="decimal"` di semua formulir, sesuai arahan tahap; tidak ada kebutuhan presisi per-satuan yang terbukti di audit.
  - Pemilik berkas: berkas formulir per daftar audit (satu pemilik menyapu per modul permukaan), `src/components/money-input.tsx`/`percent-input.tsx` hanya bila perlu ekstensi kecil.
  - Gerbang: suite + e2e; screenshot sebelum/sesudah formulir kunci (produk, karyawan, saldo awal).

- [x] **Tahap 5 — HR** *(H-HR-01)*
  - Izin `payroll.view` (lihat) terpisah dari `payroll.manage` (kelola), mengikuti pola `inventory.cost` vs `inventory.price`: halaman/daftar gaji dapat dibuka baca-saja oleh pemegang view; semua aksi ubah tetap manage; matriks peran bawaan diperbarui (pemilik/admin mendapat view; manage tidak berubah); `payroll-access` & `rbac-matrix` diperluas membuktikan lihat-tanpa-ubah.
  - Pemilik berkas: `src/lib/permissions.ts`, gerbang halaman HR terkait, test sim2 akses.
  - Gerbang: suite + e2e.

- [x] **Tahap 6 — Cross-module + Simulasi** *(H-X-01, H-X-02)*
  - Backup terpantau: status backup terakhir (waktu, ukuran, hasil) terbaca dari artefak timer yang ada dan tampil di Pengaturan/Kesehatan sistem; kegagalan/ketiadaan backup segar memunculkan peringatan di aplikasi. Uji restore terjadwal didokumentasikan sebagai prosedur berkala di runbook + satu **latihan restore terbukti** dijalankan tahap ini ke DB buangan dan hasilnya dicatat (bukan DB demo).
  - Dokumentasi impor menyatakan staging secara eksplisit (UI wizard + dokumen): "pratinjau persisten — data master belum berubah sampai commit".
  - **Simulasi diperluas** menutup celah Tahap 0: skenario baru di keluarga sim2 — (a) penjualan atas batch kedaluwarsa tertolak & FEFO melompat ke lot segar; (b) tutup sesi buta dengan selisih melewati toleransi (alasan wajib) terjurnal benar; (c) paritas ekspor XLSX vs layar untuk satu bulan simulasi; (d) restore drill tercatat sebagai bukti tahap (di luar suite).
  - Pemilik berkas: permukaan kesehatan/pengaturan, `docs/RUNBOOK-BACKUP-RESTORE.md`, wizard impor (teks), test sim2 baru.
  - Gerbang: suite (termasuk skenario baru) + e2e.

- [x] **Tahap 7 — Penutup**
  - Gerbang penuh dari reseed bersih; sapuan input dihitung ulang (target: 0 field uang mentah di luar kategori terminal POS yang dinyatakan); status tutup per temuan H-* di `docs/hardening/STATUS-TUTUP-A28.md`; PROGRESS §0K ditutup; ZIP rilis dari commit final; daftar keputusan pemilik yang masih menunggu disampaikan bersih (PIN supervisor, gerbang harga massal, sisa Should yang tidak selesai bila ada).

## Keputusan pemilik yang dibawa (tidak dieksekusi diam-diam)

1. **PIN supervisor POS** (H-POS-06) — dari daftar A-24 §3; Tahap 1 tidak membangunnya.
2. **Gerbang persetujuan edit harga massal** — dari daftar A-24 §3; Tahap 4 hanya memigrasikan inputnya ke MoneyInput.
3. **Renumber perusahaan berjalan** (A-27 B7) & **matriks ECL** — tetap per perusahaan / menunggu pemilik, tidak tersentuh A-28.
