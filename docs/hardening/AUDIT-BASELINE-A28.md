# AUDIT BASELINE A-28 — Empiris Menyeluruh (Tahap 0)

Program **A-28** · Audit dijalankan terhadap HEAD `7e0acb5` (penutup A-27), 2026-11-07.
Metode: gerbang dijalankan apa adanya dari reseed bersih; simulasi dijalankan ulang; sapuan input dihitung dari kode; tolok ukur = checklist Must-Fix/Should-Fix riset `~/workspace/research_notes/minimarket-erp-hardening-best-practices-20261107-0128/report.md`.
**Tidak ada kode aplikasi yang diubah di tahap ini.** Temuan bernomor H-<modul>-<nn>; prioritas mengikuti riset.

---

## 1. Gerbang keadaan kini (dari reseed bersih)

| Gerbang | Hasil |
|---|---|
| Reseed `db:seed --force` | exit 0 — 65 produk, nilai persediaan **Rp28.349.600** |
| `pnpm test` | **exit 0 — 1741/1741 lulus, 183 berkas** |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (0 error; 26 warning lama pra-ada) |
| `pnpm build` | exit 0 |
| Reseed ulang → `pnpm test:e2e` | **exit 0 — 19/19** |

Keadaan awal program: **semua gerbang hijau.** Yang diaudit di sini bukan kerusakan, melainkan jarak terhadap standar produksi riset.

## 2. Simulasi minimarket dijalankan ulang

Harness: keluarga `tests/sim2/` — **28 berkas, 256 test, SEMUA LULUS** dalam suite di atas (bukan klaim lama; log larian tahap ini):

| Berkas | Test | Cakupan |
|---|---|---|
| sim-bisnis | 37 | Narasi ujung-ke-ujung S1.0–S1.9: modal awal → PO/penerimaan/utang → retur pembelian & kredit pemasok → POS (sesi, tunai/QRIS/split/utang, FEFO, hold, konkurensi tanpa oversell, tutup sesi berselisih terjurnal) → transfer & opname → beban/piutang/jurnal manual → kasbon & payroll → rekonsiliasi neraca/laba-rugi/subledger → tutup periode menolak posting |
| s5-roundtrip | 12 | Round-trip impor/ekspor; impor ulang tidak menggandakan produk (SKU diperbarui) |
| master-data | 29 | Data master & gabung pihak |
| rbac-matrix | 29 | Matriks izin per peran dijalankan sebagai peran itu |
| payroll-access | 34 | Akses & angka payroll per peran |
| payroll-indonesia (+desember) | 14 | Payroll statutori Indonesia |
| hr-* (6 berkas) | 31 | Absensi, cuti, lembur/THR, pinjaman/klaim, terminasi, riwayat organisasi |
| reservations-transfers | 6 | Reservasi & transfer antargudang |
| pos-offline-sync | 3 | Antrean offline & sinkronisasi bervalidasi server |
| serial-numbers | 7 | Produk bernomor seri |
| fixed-assets | 5 | Aset tetap & penyusutan |
| purchase-requests | 6 | Permintaan pembelian |
| auth-hardening | 6 | Penolakan kredensial & pencabutan sesi |
| import-parse-route | 6 | Parsing berkas impor |
| ppn-toggle / qris-validation | 8 | Saklar PPN & validasi QRIS |
| rem-* / return-settlement-gate | 12 | Integritas referensial, penampil audit, gerbang penyelesaian retur |

**Celah simulasi yang terlihat DARI HASIL JALAN** (skenario yang tidak ada, konsisten dengan temuan di bawah): tidak ada skenario penjualan atas batch **kedaluwarsa**; tidak ada skenario tutup sesi **buta/toleransi**; tidak ada skenario **restore dari backup**; narasi sim-bisnis satu perusahaan & satu bulan (lintas bulan hanya diuji sebagai penolakan posting periode tertutup); ekspor yang diuji CSV — tidak ada XLSX untuk dibandingkan.

## 3. Sapuan standar input global (contoh eksplisit pengguna: input uang berformat)

Komponen bersama yang ada: `MoneyInput` (`src/components/money-input.tsx`, format id-ID saat ketik + `parseMoneyText` di `src/lib/money-input.ts` yang toleran terhadap `1.500.000`, `1500,50`, tempelan berformat, dan menolak tak terbaca dengan pesan Indonesia), `PercentInput`, `DateField`/`DateRangeField`.

| Jenis | Berformat bersama | Mentah / pola bebas | Bukti hitungan |
|---|---|---|---|
| Uang | **46 pemakaian `MoneyInput` di 17 berkas komponen** (jurnal, pembayaran, kasbon/pinjaman, entri cepat, aset tetap, payroll statutori, harga pokok di line-editor, retur pemasok, pengaturan pajak) | **±15 field uang mentah di ±9 berkas** (rinci di H-PGT-01) | grep `<MoneyInput` vs inspeksi langsung berkas uang tanpa MoneyInput |
| Persen | `PercentInput` 6 pemakaian di 2 berkas (pengaturan pajak & payroll Indonesia) | persen mentah: sisa nilai aset tetap (`type="number"`), fee metode pembayaran | grep |
| Kuantitas | — (tidak ada komponen qty bersama) | input desimal polos `inputMode="decimal"` tersebar konsisten (line-editor, opname, keranjang POS, terima transfer, reservasi) | grep |
| Tanggal | `DateField`/`DateRangeField` dipakai di 23 berkas | **33 input `type="date"` mentah** di komponen/halaman lain | grep |

Keamanan parsing: **0 `parseFloat` di seluruh komponen/halaman** — nilai mentah dikirim sebagai string dan divalidasi server (Zod/Decimal). Jadi risiko field mentah bukan korupsi angka di server, melainkan **keterbacaan & salah ketik di layar** (persis keluhan pengguna: `1500000` tanpa pemisah) dan satu risiko format nyata: `feeValue` metode pembayaran memakai `type="number" step="any"` (metode-pembayaran.tsx:226) yang penafsiran koma/desimalnya bergantung lokal browser dan tidak membedakan mode persen vs nominal di tampilannya.

## 4. Jalur ganda & tumpang tindih — hasil pemeriksaan

**Terbukti SATU jalur (bersih):**
- **Ledger stok**: `stockMovements` hanya ditulis `src/server/inventory/movements.ts` — semua dokumen (penjualan, retur, penerimaan, transfer, penyesuaian, opname) lewat satu penulis; dibekukan juga oleh test penulis-tabel A-26.
- **Mesin posting jurnal**: `journalEntries` hanya ditulis `src/server/accounting.ts` (`postJournal`), dipanggil 33 berkas domain.
- **Catat Transaksi (quick-entry) vs formulir penuh**: bukan implementasi ganda — `src/server/quick-entry.ts` memanggil inti yang sama (`payPayableDocument`/`payExpensePayable` dari payables, `payReceivable`, `postJournal`).
- **Impor**: satu kerangka (analyze → review → commit di `src/server/import/`); pintu commit terpisah hanya per jenis data (master vs stok/saldo awal di `opening.ts`), bukan dua implementasi untuk pekerjaan yang sama.

**Dua pintu, satu penulis (bukan cacat, dicatat):** edit harga produk bisa dari formulir produk dan dari tabel edit massal (`product-bulk-table.tsx`) — penulis domain sama (catalog); gerbang persetujuan edit harga massal adalah keputusan pemilik lama (daftar A-24 §3), bukan dibangun/dihapus diam-diam.

## 5. Temuan per modul

### POS — H-POS

- **H-POS-01 (MUST) — Tutup sesi TIDAK buta.** Formulir tutup sesi menampilkan "Kas seharusnya" dan selisih berjalan sebelum kasir selesai memasukkan hitungan (`src/components/pos/session-manager.tsx:131,156`). Riset mewajibkan hitung buta (expected-vs-counted tanpa expected terlihat lebih dulu).
- **H-POS-02 (MUST) — Tidak ada toleransi selisih, alasan selisih tidak wajib, tanpa persetujuan atas selisih.** `closeCashSession` hanya menerima `countedCash` + `notes?` opsional (`src/server/pos/sessions.ts:86`); selisih berapa pun langsung terjurnal ke akun selisih kas lebih/kurang (mekanisme jurnalnya sendiri benar & teraudit, baris 128–156).
- **H-POS-03 (SHOULD) — Hitungan tunai satu angka total**, tanpa rincian denominasi (pecahan × jumlah) yang menjadi standar hitung laci.
- **H-POS-04 (MUST) — Cetak ulang struk tanpa watermark.** Tombol "Cetak ulang" (`payment-panel.tsx:469`) membuka halaman nota yang **identik** dengan cetakan pertama; tidak ada tanda "SALINAN/CETAK ULANG" di `src/app/app/pos/nota/[id]/page.tsx` (yang bertanda hanya VOID). Riset: reprints watermarked.
- **H-POS-05 (SHOULD) — Identitas terminal/sesi tidak tercetak.** Isi struk selain itu memenuhi spek minimum riset: nama legal + alamat + telepon (PrintHeader), NPWP bila terisi, nomor urut, tanggal/jam, kasir, baris qty × harga + diskon per baris, subtotal, diskon, "termasuk PPN", pembulatan, TOTAL, per-tender + "Diterima" + referensi non-tunai, kembalian, sisa utang, QR nomor dokumen, footer dapat dikonfigurasi per toko, template/kertas diatur di Pengaturan → Cetak.
- **H-POS-06 (KEPUTUSAN PEMILIK, bukan dibangun diam-diam) — PIN supervisor per tindakan** (void/refund/override) belum ada; otorisasi saat ini berbasis izin peran. Ini butir lama daftar keputusan A-24 §3.
- *Sehat terverifikasi dari larian:* idempotensi penjualan, kembalian benar, split tender, penjualan utang berplafon, konkurensi tanpa oversell, antrean offline bervalidasi server saat sinkron, retur berkait nota asal & mengembalikan stok (SIM S1.4 + pos-offline-sync).

### Gudang — H-GDG

- **H-GDG-01 (MUST) — Batch kedaluwarsa ikut teralokasi FEFO ke penjualan.** Alokasi keluar mengurutkan FEFO tetapi **memasukkan batch kedaluwarsa** secara sengaja (`src/server/inventory/movements.ts:181`: "expired included — documents are the correction path"). Karena FEFO mengambil expiry tercepat lebih dulu, barang kedaluwarsa justru keluar pertama bila belum dibuatkan dokumen `expired`. Riset Must: *expired stock cannot be sold*. Jalur koreksi dokumen memang ada (tipe `expired` di adjustments dengan maker-checker), tetapi tidak mencegah penjualan.
- **H-GDG-02 (SHOULD) — Alur near-expiry (peringatan bertingkat → markdown) belum utuh.** Peringatan stok minimum terbukti aktif (SIM S1.5 + rekomendasi pembelian); peringatan kedaluwarsa bertingkat adalah keputusan pemilik lama yang belum dieksekusi; alur penurunan harga menjelang kedaluwarsa (riset Should) tidak ada.
- *Sehat terverifikasi:* **opname hitung buta adalah bawaan** (`opname-form.tsx:47–56,317` — kolom Fisik mulai kosong, angka sistem disembunyikan pada langkah hitung, lembar hitung kertas tanpa angka sistem; panel tugas opname juga tidak menampilkan stok sistem); penyesuaian berkode alasan dengan maker-checker untuk adjustment/damaged/expired/lost (`adjustments.ts:89,388`); transfer dokumen dua tahap; nomor seri tertib; satu penulis ledger.

### Akuntansi — H-AKT

- **H-AKT-01 (MUST) — Ekspor XLSX berformat laporan keuangan tidak tersedia.** Ekspor laporan = CSV yang isinya setara layar (kolom pembanding tahun sebelumnya dipertahankan untuk semua laporan berkala, label Indonesia sama dengan layar & cetak — `src/app/api/export/report/route.ts:25–31`); PDF lewat jalur cetak browser. Kode mengakui eksplisit: "Ekspor Excel/PDF berformat tetap belum tersedia". Riset Must: laporan tersedia PDF/XLSX dengan isi identik layar.
- **H-AKT-02 (SHOULD) — Definisi "kas" belum satu di semua permukaan laporan.** Sesudah A-27 B2: total kas dashboard memakai himpunan kelas kas/bank, sedangkan subjek kas laporan arus kas & kartu ringkasan memakai penunjukan pemetaan (sisa tercatat B2) — satu definisi harus dipilih agar angka antar-laporan konsisten.
- *Sehat terverifikasi:* jurnal otomatis per dokumen ujung-ke-ujung terbukti SIM S1.8 (neraca saldo seimbang, laba rugi & neraca cocok hitungan tangan, subledger = akun kontrol); komparatif tahun sebelumnya di laporan berkala; drill-down ke jurnal per dokumen; periode tertutup mengunci posting; bagan akun hasil A-27 (kelas kas/bank, header/detail, tagging PSAK 118).

### Pengaturan & standar input — H-PGT

- **H-PGT-01 (MUST) — Input uang belum satu standar (keluhan eksplisit pengguna).** Field uang mentah tanpa format saat ketik, terinspeksi langsung:
  - `gudang/product-form.tsx:187,191` — **harga pokok & harga jual produk** (teks polos `inputMode="decimal"`);
  - `gudang/product-bulk-table.tsx:445` — edit harga massal;
  - `akuntansi/payroll-panel.tsx:182,186,190` — **gaji pokok, tunjangan, potongan** karyawan;
  - `akuntansi/opening-balance-form.tsx:123` — nominal saldo awal;
  - `gudang/partner-forms.tsx:307` — limit kredit pelanggan;
  - `pengaturan/forms/metode-pembayaran.tsx:226` — `feeValue` (`type="number" step="any"`; risiko lokal + mode persen/nominal tak terbedakan);
  - `pos/session-manager.tsx:110,175,252` — modal awal, hitungan tunai, kas masuk/keluar (numeric polos; konteks POS, tetap dicatat);
  - `akuntansi/bank-reconciliation-panel.tsx:606` — nominal baris mutasi manual;
  - tender POS `pos/payment-panel.tsx` & `pos/payment/mixed-entries.tsx` — nominal tender pola terminal (kategori sendiri; tampilannya angka mentah).
- **H-PGT-02 (SHOULD) — Persen & tanggal belum seragam.** Persen mentah di luar `PercentInput`: sisa nilai aset tetap (`fixed-asset-panel.tsx:97`, `type="number" step="0.5"`) & fee metode (H-PGT-01). Tanggal mentah `type="date"` 33 titik vs `DateField` 23 berkas — termasuk formulir saldo awal (`opening-balance-form.tsx:115,119`).
- **H-PGT-03 (SHOULD) — Kuantitas tanpa komponen bersama.** Pola `inputMode="decimal"` konsisten tetapi disalin per formulir (line-editor, opname, keranjang, terima transfer, reservasi, retur); tidak ada `QtyInput` bersama sehingga presisi desimal per satuan tidak terpusat.

### HR — H-HR

- **H-HR-01 (SHOULD) — Tidak ada izin "lihat gaji" yang terpisah dari "kelola payroll".** Akses angka gaji digerbangi `payroll.manage` (kelola) di area HR/akuntansi; terbukti tertib per peran oleh `payroll-access` (34 test) & `rbac-matrix` (29) — tetapi peran yang hanya perlu *melihat* (mis. pemilik/auditor baca-saja) tidak punya jalur lihat-tanpa-ubah khusus field gaji, berbeda dengan harga pokok yang punya `inventory.cost` (lihat) terpisah dari `inventory.price` (ubah).
- *Sehat terverifikasi:* tidak ditemukan bentrok HR↔modul lain dari larian penuh — payroll membayar lewat mesin pembayaran & jurnal yang sama; kasbon/pinjaman/klaim terintegrasi piutang karyawan (SIM S1.7 + hr-loans-reimbursement); input gaji mentah tercatat di H-PGT-01 (milik tahap standar input).

### Cross-module — H-X

- **H-X-01 (MUST) — Backup/restore hanya permukaan ops, tanpa pemantauan & uji berkala yang terbukti terjadwal.** Mekanisme ada dan pernah terbukti: `scripts/backup.sh` (pg_dump, enkripsi AES opsional) + `scripts/restore.sh` + timer deploy (`deploy/backup-run.sh`) + `docs/RUNBOOK-BACKUP-RESTORE.md`; restore identik terverifikasi pada A-24 T5 (CHANGELOG). Tetapi: tidak ada permukaan di aplikasi (pemilik tidak bisa memicu/melihat status backup dari UI), tidak ada peringatan kegagalan backup di dalam aplikasi, dan tidak ada bukti uji restore **berkala terjadwal** di repo (runbook bersifat manual). Riset Must: automated + monitored with failure alerts + quarterly tested restores.
- **H-X-02 (SHOULD) — Karakterisasi impor perlu dinyatakan jujur di rencana:** "dry-run" impor menulis baris **staging** (batch impor) — nol tulisan ke data master sebelum commit, laporan error per baris tersedia di review, strategi duplikat SKU = diperbarui (terbukti s5-roundtrip). Ini sesuai substansi riset (zero writes ke data bisnis + laporan error penuh), tetapi istilah & dokumentasinya harus menyatakan staging secara eksplisit agar tidak terbaca sebagai "tanpa tulisan sama sekali".
- *Sehat terverifikasi:* audit trail `writeAudit` dipakai 69 berkas server (termasuk before/after perubahan kode akun hasil A-27 B4); RBAC level field harga pokok ada (`inventory.cost` lihat, `inventory.cost_override`, `inventory.price` ubah; form produk mengunci harga tanpa izin — `product-form.tsx:57,187`); RLS multi-perusahaan & matriks peran teruji sebagai peran itu sendiri; konsistensi ledger/stok/laporan diuji `consistency` 11/11 di dalam suite.

## 6. Ringkasan hitungan

| Modul | Temuan | MUST | SHOULD | Keputusan pemilik |
|---|---|---|---|---|
| POS | 6 | 3 (01, 02, 04) | 2 (03, 05) | 1 (06 PIN) |
| Gudang | 2 | 1 (01) | 1 (02) | — |
| Akuntansi | 2 | 1 (01) | 1 (02) | — |
| Pengaturan/Input | 3 | 1 (01) | 2 (02, 03) | — |
| HR | 1 | 0 | 1 (01) | — |
| Cross-module | 2 | 1 (01) | 1 (02) | — |
| **Total** | **16** | **7** | **8** | **1** |

**Must-fix teratas (urutan dampak):** H-GDG-01 (barang kedaluwarsa bisa terjual — risiko barang & kepatuhan), H-POS-01+H-POS-02 (disiplin kas: hitung buta & toleransi/alasan selisih), H-PGT-01 (standar input uang — keluhan langsung pengguna, menyentuh harga produk & gaji), H-POS-04 (watermark cetak ulang), H-AKT-01 (ekspor XLSX laporan), H-X-01 (backup terpantau & uji restore berkala).
