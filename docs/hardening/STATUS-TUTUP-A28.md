# STATUS TUTUP — A-28 Full Auto Audit + Hardening ERP Minimarket

Program **A-28** · Penutup dijalankan terhadap HEAD `c7374f7` (sesudah UI-5), 2026-11-07.
Dokumen ini adalah checklist production-ready gabungan mengikuti **9 keluaran mandat pengguna**: (1) ringkasan riset → (2) POS → (3) Gudang → (4) Akuntansi → (5) Pengaturan → (6) HR → (7) hardening sistem → (8) UI/UX → (9) checklist akhir. Status per temuan: **TERTUTUP** (perubahan terverifikasi test/screenshot), **SEBAGIAN** (inti tertutup, sisa dinyatakan), **SISA TERJADWAL** (belum dikerjakan, dengan alasan), **KEPUTUSAN PEMILIK** (tidak dieksekusi diam-diam).

Acuan: `AUDIT-BASELINE-A28.md` (16 temuan H-), `STATUS-UIUX-A28.md` (23 temuan UX-), checklist Must-Fix/Should-Fix riset `~/workspace/research_notes/minimarket-erp-hardening-best-practices-20261107-0128/report.md`.

---

## Gerbang final (dari reseed bersih, tanpa pipa, exit code per perintah)

| Gerbang | Exit | Hasil |
|---|---|---|
| Reseed `pnpm db:reset` | 0 | 65 produk, nilai persediaan Rp28.349.600 |
| `pnpm test` | 0 | **1872/1872 lulus, 199 berkas** (baseline Tahap 0: 1741 → +131 test selama program) |
| `pnpm typecheck` | 0 | — |
| `pnpm lint` | 0 | 0 error; 26 warning lama pra-ada (nol di berkas yang berubah selama A-28) |
| `pnpm build` | 0 | — |
| Reseed ulang → `pnpm test:e2e` larian 1 | 1 | 21/22 — satu flake `pos-offline` skenario A (tombol Bayar tetap nonaktif sesudah sinkron di bawah beban suite penuh); lulus terisolasi 2/2 |
| Reseed ulang → `pnpm test:e2e` larian 2 (penentu) | 0 | **22/22** |

**Baseline demo terverifikasi SQL** (perusahaan "Bisa Minimarket", sesudah reseed final): produk **65**; nilai persediaan **28349600.00000000** persis (Σ `stock_on_hand.qty × products.cost_price`); akun **124** dengan **0 kode di luar pola 5 digit** dan **31 non-postable** (29 header + 31020 sistem + 95000 cadangan); pemetaan **36/36**; akun berkelas kas/bank **11** (cash 2, bank 1, clearing 8); selisih neraca saldo **0.0000**; baris `stock_on_hand` yang tidak cocok dengan Σ `stock_movements` = **0**. Migrasi terakhir **0059**.

**Simulasi keluarga `tests/sim2/` dijalankan penuh di dalam suite: 29 berkas, 273 test, semua lulus.**

| Berkas | Test | Cakupan inti |
|---|---|---|
| sim-bisnis | 37 | Narasi ujung-ke-ujung S1.0–S1.9 (modal → procurement → POS → transfer/opname → HR/payroll → rekonsiliasi → tutup periode) |
| **a28-hardening-e2e** | **2** | **Rantai hardening A-28 satu hari**: terima lot segar+kedaluwarsa → jual di sesi (FEFO melompat ke lot segar) → tutup buta melewati toleransi ditolak tanpa alasan → terjurnal Dr Selisih Kurang/Cr Kas Rp8.000 dengan alasan → pendapatan bulan +8.000 persis; XLSX bulan berjalan dari jalur rute ter-parse, Laba bersih == domain |
| master-data | 29 | Data master & gabung pihak |
| rbac-matrix | 30 | Matriks izin dijalankan sebagai peran itu sendiri |
| payroll-access | 48 | Akses & angka payroll per peran, termasuk masking `payroll.salary` (Tahap 5) |
| s5-roundtrip | 12 | Round-trip impor/ekspor; impor ulang tidak menggandakan produk |
| payroll-indonesia (+desember) | 14 | Payroll statutori Indonesia |
| hr-* (6 berkas) | 31 | Absensi, cuti, lembur/THR, pinjaman/klaim, terminasi, riwayat organisasi |
| pos-offline-sync | 3 | Antrean offline & sinkronisasi bervalidasi server |
| serial-numbers | 7 | Produk bernomor seri |
| reservations-transfers | 6 | Reservasi & transfer antargudang |
| fixed-assets | 5 | Aset tetap & penyusutan |
| purchase-requests | 6 | Permintaan pembelian |
| auth-hardening | 6 | Penolakan kredensial & pencabutan sesi |
| import-parse-route | 6 | Parsing berkas impor |
| ppn-toggle / qris-validation | 8 | Saklar PPN & validasi QRIS |
| rem-* / return-settlement-gate / fix-p1 | 13 | Integritas referensial, penampil audit, gerbang retur, cuti tak dibayar |

**Sapuan screenshot akhir**: 15 permukaan kunci di `~/workspace/bukti-a28/final/` — semua **dibaca & diverifikasi isinya** (bukan sekadar diambil); nol overflow horizontal pada 1440px. Rincian per permukaan di §8.

---

## 1. Ringkasan riset (keluaran mandat 1)

Riset best practice 2025–2026 (Odoo/ERPNext/Square/Lightspeed/LS + referensi akuntansi & keamanan) menghasilkan checklist Must-Fix (28 butir berkelompok) & Should-Fix (8 butir). Vonis terpenting yang terbukti relevan: FEFO ≠ FIFO (pengambilan fisik menurut tanggal buang; biaya tetap AVCO), hitung tunai buta + toleransi selisih, cetak ulang ber-watermark, input uang = simpan mentah/tampil terformat id-ID, backup terpantau dengan restore **teruji berkala**, dan satu jalur bersih per proses. Statistik viral "42% kembali ke monolit" ditolak riset sendiri sebagai tidak terverifikasi — keputusan arsitektur berdiri di atas kebutuhan konsistensi. Status setiap butir checklist ada di §9.

## 2. POS (keluaran mandat 2) — Tahap 1 + UI-1

| Temuan | Status | Bukti |
|---|---|---|
| H-POS-01 tutup sesi tidak buta (MUST) | **TERTUTUP** | Hitung dua langkah ala opname: grid denominasi → kunci → baru perbandingan seharusnya/terhitung tampil. Test render membuktikan "Kas seharusnya" tidak ada pada langkah hitung; screenshot final `03-pos-sesi.png` (teks "secara buta" + tombol "Kunci hitungan & tinja
...[truncated 20887 chars]u" terlihat). Sisa jujur: agregat aktivitas sesi (penjualan tunai/refund per komponen) tetap terlihat sebagai log aktivitas — yang disembunyikan adalah total harapan & selisih live, sesuai definisi blind count riset. |
| H-POS-02 tanpa toleransi & alasan selisih tidak wajib (MUST) | **TERTUTUP** | Migrasi 0057: pengaturan `pos_session_difference_tolerance` (bawaan Rp0) + `cash_sessions.difference_reason`; server menolak tutup tanpa alasan bila \|selisih\| > toleransi (VALIDATION berpesan), tepat di batas = di dalam toleransi. Test integrasi penolakan/toleransi/jurnal utuh + rantai sim2 a28-hardening-e2e. |
| H-POS-03 hitungan satu angka total (SHOULD) | **TERTUTUP** | Lib `src/lib/pos/denominations.ts` (11 pecahan Rp100.000–Rp100); grid denominasi satu-satunya masukan `countedCash`; domain tetap menyimpan satu angka total. Terlihat di `03-pos-sesi.png`. |
| H-POS-04 cetak ulang tanpa watermark (MUST) | **TERTUTUP** | Parameter `salinan=1` mencetak pita "SALINAN — BUKAN NOTA ASLI" pada 5 tautan cetak ulang; cetakan pertama dari terminal tidak berubah. Test render nota SALINAN vs asli. |
| H-POS-05 struk tanpa identitas sesi (SHOULD) | **TERTUTUP** | Baris "Sesi" (8 karakter awal `sessionId`, konvensi deskripsi jurnal) tercetak; tidak ada entitas terminal di model data — nomor sesi adalah identitas yang tersedia. Juga tampil di pratinjau nota `14-pengaturan-cetak.png`. |
| H-POS-06 PIN supervisor per tindakan | **KEPUTUSAN PEMILIK** | Tidak dibangun — butir lama daftar A-24 §3. Otorisasi saat ini berbasis izin peran (matriks RBAC teruji sebagai peran). |

## 3. Gudang (keluaran mandat 3) — Tahap 2

| Temuan | Status | Bukti |
|---|---|---|
| H-GDG-01 batch kedaluwarsa teralokasi FEFO ke penjualan (MUST) | **TERTUTUP** | `applyDocumentMovement` membedakan `purpose`: `"sale"` melewati batch yang expiry-nya sebelum **tanggal dokumen** (batas inklusif: expiry == tanggal dokumen masih layak) dan menolak INSUFFICIENT_STOCK berpesan kedaluwarsa; bawaan `"correction"` (dokumen expired/damaged/lost, opname) tetap dapat mengambil batch kedaluwarsa agar barang tidak terkunci. `asOfDate` kini dari tanggal dokumen. 8 test baru `a28-gdg-fefo-expired.test.ts` + rantai sim2. |
| H-GDG-02 alur near-expiry belum utuh (SHOULD) | **SEBAGIAN** | Tertutup: ambang peringatan menjadi pengaturan perusahaan `expiryWarningDays` (migrasi 0058, bawaan 30 hari) terbaca di beranda Gudang, lencana dinamis "≤N hari". **Sisa terjadwal:** alur penurunan harga (markdown) menjelang kedaluwarsa tidak dibangun — membutuhkan keputusan kebijakan harga pemilik. Peringatan bersifat daftar kerja saat halaman dimuat, bukan notifikasi aktif. |

*Sehat terverifikasi ulang:* opname hitung buta bawaan (screenshot final `06-opname.png`: picker terfokus, kolom Fisik mulai kosong, stok sistem disembunyikan), penyesuaian berkode alasan dengan maker-checker, transfer dokumen dua tahap, satu penulis ledger stok (konsistensi Σ movements = on-hand terbukti 0 baris mismatch pada verifikasi SQL final).

## 4. Akuntansi (keluaran mandat 4) — Tahap 3 + UI-3

| Temuan | Status | Bukti |
|---|---|---|
| H-AKT-01 ekspor XLSX berformat tidak tersedia (MUST) | **TERTUTUP** (dengan batas jujur) | `format=xlsx` di tiga route ekspor + tombol Excel di Laporan/Buku besar/Piutang & utang; satu model tabel bersama layar/cetak/CSV/XLSX — CSV terbukti **byte-identik** dengan warisan (9 varian), XLSX memuat kop, hierarki terindentasi, kolom komparatif + Selisih, sel numerik berformat `#,##0`. Pustaka `xlsx` 0.20.3 ter-pin (keputusan A-24), tanpa dependensi baru. 6 test paritas (total XLSX == domain == CSV). **Batas:** SheetJS CE tidak menulis gaya sel (tebal/fill) & freeze panes. Tombol CSV/Excel/Cetak terlihat di `07/08/09/10-*.png`. |
| H-AKT-02 definisi "kas" belum satu antar permukaan (SHOULD) | **TERTUTUP** | Subjek arus kas & kartu ringkasan diselaraskan ke himpunan **kelas kas/bank** (`listCashBankAccounts`) yang sama dengan dashboard & Kas & bank — menutup sisa tercatat A-27 B2; bank tak terpetakan kini terhitung di semua permukaan (test rollback Rp7.000.000). |

*Sehat terverifikasi ulang:* jurnal otomatis per dokumen (SIM S1.8), komparatif tahun sebelumnya di semua laporan berkala (kolom 2026 vs 2025 terlihat di screenshot final), drill-down ke jurnal, periode tertutup mengunci posting, buku besar membuka di akun postable beraktivitas (AKT-08, terlihat membuka di 11101 Piutang Usaha beraktivitas periode berjalan di `10-buku-besar.png`), akun bersaldo nol tersembunyi bawaan dengan satu definisi bersama layar/cetak/ekspor (AKT-09), rincian baris jurnal dapat dilipat (AKT-05, terlihat "Rincian 2 baris" di `12-jurnal.png`; total debit == kredit, selisih Rp0).

## 5. Pengaturan & standar input global (keluaran mandat 5) — Tahap 4 + UI-2/UI-3

| Temuan | Status | Bukti |
|---|---|---|
| H-PGT-01 input uang belum satu standar (MUST — keluhan eksplisit pengguna) | **TERTUTUP** (satu pengecualian beralasan tertulis) | Semua situs daftar audit bermigrasi ke `MoneyInput` bersama (format id-ID saat ketik + parse toleran): harga pokok/jual produk, gaji pokok/tunjangan/potongan, saldo awal, limit kredit, kas sesi POS, potongan jurnal-dari-mutasi, dan `feeValue` mengikuti mode (persen → `PercentInput`, nominal → `MoneyInput`, label menyatakan mode). Tender POS menyusul tertutup di UI-1 (UX-B04). Sapuan terukur ulang: MoneyInput 46 → **50 pemakaian/23 berkas** (ditambah tender POS di UI-1), `parseFloat` tetap **0**. 18 test paritas payload `a28-tahap4-input-parity.test.ts`. **Pengecualian:** nilai operasi edit harga massal tetap mentah — satu field delta **bertanda** (negatif = turun) untuk tiga mode (persen/nominal/stok minimum); kontrak ketik komponen bersama menolak tanda minus dan mode stok minimum adalah kuantitas, jadi memaksakannya mengubah semantik. |
| H-PGT-02 persen & tanggal belum seragam (SHOULD) | **TERTUTUP** | Persen: residu aset tetap → `PercentInput` (Tahap 4). Tanggal: saldo awal → `DateField` (Tahap 4), lalu sapuan UI-3 menuntaskan **31 input `type="date"` native di 20 berkas → 0** (semua `DateField` dd/mm/yyyy, nilai tetap ISO) dengan penjaga permanen `date-input-pattern.test.ts`. Tanggal tampil dd/mm/yyyy di screenshot final (opname, kas & bank, jurnal, laporan). |
| H-PGT-03 kuantitas tanpa komponen bersama (SHOULD) | **SEBAGIAN** | Keputusan tahap tercatat: `QtyInput` bersama **tidak dibangun** — pola desimal polos `inputMode="decimal"` terbukti konsisten di semua formulir dan tidak ada kebutuhan presisi per-satuan yang terbukti di audit. Risiko yang ditangani temuan (ketidakseragaman) tertutup lewat konsistensi pola; komponen bersama tetap pekerjaan masa depan bila presisi per-satuan dibutuhkan. |

## 6. HR (keluaran mandat 6) — Tahap 5

| Temuan | Status | Bukti |
|---|---|---|
| H-HR-01 tidak ada izin lihat-gaji terpisah dari kelola (SHOULD) | **TERTUTUP** | Izin field-level **`payroll.salary`** (mengikuti pola `inventory.cost` vs `inventory.price`): pemegang `payroll.view` tanpa `payroll.salary` melihat struktur HR/payroll **tanpa nominal gaji** di 6 permukaan (daftar payroll, detail run + jurnal terkait, detail karyawan + riwayat gaji, kartu gaji di kasbon/pinjaman, draf THR); slip & ekspor rekap CSV digerbang server `payroll.salary`; aksi tulis tetap `payroll.manage`. Peran bawaan: owner/admin/manager menerima (mempertahankan akses efektif manager sebelumnya — bukan perluasan); kasir/gudang/akuntan tidak. +17 test (payroll-access 34 → 48, rbac-matrix +1). Halaman payroll terlihat utuh bagi pemilik berizin di `13-hr-payroll.png`. |

*Catatan mekanisme (jujur):* rencana awal membayangkan pemisahan `payroll.view` dari `payroll.manage`; keadaan terbukti di Tahap 5 adalah `payroll.view` sudah ada sebagai izin HR umum yang membuka halaman **beserta** angka gaji — jadi yang dibangun adalah gerbang level-field `payroll.salary` di atasnya, hasil akhirnya sama dengan maksud temuan.

## 7. Hardening sistem keseluruhan (keluaran mandat 7) — Tahap 6

| Temuan | Status | Bukti |
|---|---|---|
| H-X-01 backup/restore hanya permukaan ops, tanpa pemantauan & uji berkala terbukti (MUST) | **TERTUTUP** (permukaan aplikasi & bukti latihan; topologi deployment di §9) | `scripts/backup.sh` menulis `backup-manifest.json` atomik (berkas, waktu, ukuran, SHA-256, enkripsi); halaman **Pengaturan → Status sistem** membaca manifest via `src/server/backup-status.ts`: backup terakhir + peringatan basi (ambang `BISA_BACKUP_MAX_AGE_HOURS`, bawaan 26 jam; tanpa manifest dinyatakan "belum ada catatan", tidak dikarang). Skrip **`scripts/restore-drill.sh`** me-restore dump terbaru ke DB uji `bisa_restore_test_*` (menolak nama tak aman; sumber tak pernah ditulis; DB uji dihapus via trap), memverifikasi 4 angka (akun, produk, nilai persediaan, selisih neraca saldo); unit timer mingguan `bisa-erp-restore-drill.{service,timer}` + alternatif cron di runbook; ambang kesegaran latihan 92 hari. **Siklus penuh dijalankan & semua angka cocok** pada instalasi bersih setara produksi — dan hasilnya **terlihat di aplikasi** pada screenshot final `15-status-sistem.png`: backup "Tercatat & segar", latihan "Terbukti & segar", tabel verifikasi 124=124, 65=65, 28349600=28349600, 0.0000=0.0000. 6 test unit backup-status. |
| H-X-02 karakterisasi "dry-run" impor harus jujur soal staging (SHOULD) | **TERTUTUP** | `docs/KONTRAK-IMPOR.md` + teks wizard menyatakan eksplisit "pratinjau persisten (staging) — data master belum berubah sampai commit"; dibuktikan test karakterisasi `a28-import-staging.test.ts`: snapshot 10 tabel master identik sebelum/sesudah analyze (produk & pemasok), staging terbukti bertambah & beranotasi, status job tetap `preview`. |

*Sehat terverifikasi ulang:* audit trail `writeAudit` di 69 berkas server (append-only, memuat before/after — termasuk perubahan kode akun A-27), RLS multi-perusahaan, matriks RBAC dijalankan sebagai peran itu (30 test), satu jalur per proses (Tahap 0: satu penulis ledger stok, satu mesin jurnal `postJournal`, satu kerangka impor; penjaga arsitektur A-26 — 6 berkas fitness — tetap hijau di dalam suite), konsistensi stok/jurnal (0 mismatch SQL final).

## 8. UI/UX, usability, workflow & desain (keluaran mandat 8) — Jalur U0 + UI-1 s.d. UI-5

Status lengkap per temuan di `STATUS-UIUX-A28.md`; ringkasan hitungan:

- **23 temuan UX-: 18 TERTUTUP, 2 SEHAT-terverifikasi, 3 SISA TERJADWAL.**
  - Area A (visual & hierarki): A01 sehat; A02 judul ganda Penerimaan/PO tertutup; A03 beranda Akuntansi (Input Cepat panel terlipat) tertutup; A04 jargon/teks basi tertutup; A05 pola aksi baris satu (Riwayat POS, Penerimaan, Bagan akun — menu ⋯ + aksi utama berlabel) tertutup; **A06 strip KPI di atas daftar = SISA TERJADWAL** (pola DataList bersama warisan A-25; penilaian ulang hierarki daftar adalah pekerjaan desain tersendiri).
  - Area B (usability & input): B01 F2 nyata + autofocus terminal, B02 navigasi panah hasil cari, B03 shortcut F9/F8/F10/F4/Alt+M, B04 tender terformat MoneyInput, B05 fokus awal konsisten (POS/Mode Operasi/Opname — permukaan berpindai saja), B07 Bayar campuran nonaktif selama Sisa > 0 — semua tertutup; B06 umpan balik sehat.
  - Area C (workflow): C01 PO Draf "Kirim & terima" (tugas terima dari Draf 3 → 2 klik), C02 nomor run payroll tertaut, C03 referensi pergerakan stok terkelompok & tertaut, C06 wizard menandai periode terproses — tertutup; C05 sehat; **C04 duplikasi permukaan baca stok (Produk vs Nilai persediaan) = SISA TERJADWAL** (= GDG-05; penggabungan permukaan adalah keputusan desain modul).
  - Area D (cetak & kustomisasi): D01 pengaturan cetak satu pintu (tab dilebur, field mati dihapus, migrasi 0059), D02 unggah logo berkas tervalidasi (URL tetap didukung), D03 faktur penjualan A4/A5 dengan DPP/PPN terpisah & total identik struk, D05 label tanda tangan per jenis dokumen (8 jenis) — tertutup; **D04 kop per cabang = SISA TERJADWAL menunggu KEPUTUSAN PEMILIK** soal model cabang/multi-outlet.
- **Sisa A-25 yang diverifikasi ulang:** 8 tertutup (POLA-03 tanggal, POLA-07 RowMenu, POLA-12 label, GDG-08, GDG-10, AKT-02/03, AKT-05, AKT-08, AKT-09 — gabungan), 3 sisa terjadwal (**GDG-05** = UX-C04, **GDG-13** panel duplikat pihak di halaman Pemasok, **PNG-05** kolom pertama BPJS sempit — keduanya tercantum di RENCANA UI-5 tetapi di luar daftar butir mandat tahap UI-5 yang dijalankan), 1 tidak dinilai ulang (GDG-06, fungsi baca — bukan temuan UI).
- **Pengukuran workflow ulang (U0 → sesudah perbaikan):** pindai → tunai → cetak **4 → 3 tindakan** (target ≤3); campuran **7 → 6** (target ≤6); terima dari PO Draf **3 → 2 klik** (target ≤2); riwayat → slip gaji **2 klik**.

**Sapuan screenshot akhir tahap penutup** (`~/workspace/bukti-a28/final/`, 1440px, semua dibaca satu per satu; nol overflow horizontal):

| Berkas | Isi terverifikasi |
|---|---|
| `01-beranda.png` | KPI (persediaan Rp28.349.600, kas/bank Rp50.000.000), 4 kartu modul, indikator "Sesi kas terbuka" |
| `02-pos-terminal.png` | Kotak cari terfokus (autofocus terbukti), placeholder "(F2)" yang kini nyata, grid produk berharga + stok, panel Tunggal/Campuran, tender Tunai/QRIS/Transfer/Utang |
| `03-pos-sesi.png` | Tutup sesi buta: grid denominasi + "Kunci hitungan & tinjau", tanpa angka harapan pada langkah hitung; mutasi Modal Awal Rp500.000 |
| `04-katalog-produk.png` | Kolom HPP & Harga jual terformat Rp, SKU/barcode, stok & minimum, aksi ⋯ |
| `05-penerimaan.png` | Judul tunggal (UX-A02), pita aksi saja, keadaan kosong jujur |
| `06-opname.png` | Hitung buta: picker terfokus, penjelasan hitung buta, tanggal DateField 07/11/2026 |
| `07-laporan-laba-rugi.png` | Tab laporan, tombol CSV/Excel/Cetak, kolom komparatif 2026 vs 2025, saklar akun nol |
| `08-laporan-neraca.png` | Posisi keuangan dua kolom; Persediaan Rp28.349.600; Total aset Rp80.349.600 = liabilitas + ekuitas; "Neraca seimbang." |
| `09-laporan-arus-kas.png` | Operasi/Investasi/Pendanaan/Belum terklasifikasi; saldo awal = akhir Rp50.000.000; kolom NET 2025 |
| `10-buku-besar.png` | Membuka di akun postable beraktivitas (11101), kartu saldo awal/debit/kredit/saldo akhir, Unduh CSV/Excel/Cetak |
| `11-kas-bank.png` | 11 rekening aktif (hasil A-27), Kas Rp50.000.000, formulir transfer ber-DateField |
| `12-jurnal.png` | Total debit == kredit Rp2.850.000, selisih Rp0 "Seimbang", rincian baris dapat dilipat |
| `13-hr-payroll.png` | Wizard 3 langkah, KPI gaji (pemilik berizin `payroll.salary`), daftar karyawan berkolom pokok/tunjangan/potongan/bersih |
| `14-pengaturan-cetak.png` | Cetak satu pintu: template/huruf/aksen/logo unggah, teks kop/kaki, saklar elemen, **pratinjau langsung** GRN + nota (Kasir/Sesi/Pelanggan) |
| `15-status-sistem.png` | Backup tercatat & segar + latihan restore terbukti & segar dengan tabel verifikasi 4 angka cocok; teks utama ramah, rincian di "Detail teknis" terlipat |

## 9. Checklist akhir production-ready (keluaran mandat 9)

### 9.1 Status temuan program

| Kelompok | Tertutup | Sebagian | Sisa terjadwal | Keputusan pemilik |
|---|---|---|---|---|
| H- (16: 7 Must / 8 Should / 1 keputusan) | **13** | 2 (H-GDG-02, H-PGT-03) | — (sisa keduanya tercatat terjadwal) | 1 (H-POS-06) |
| UX- (23) | 18 (+2 sehat-terverifikasi) | — | 2 (UX-A06, UX-C04) | 1 (UX-D04) |
| Sisa A-25 terkait (12) | 8 | — | 3 (GDG-05, GDG-13, PNG-05) | — (+1 non-UI tidak dinilai) |

**Semua 7 temuan MUST baseline tertutup penuh.** Tidak ada temuan Must/Should yang hilang tanpa status.

### 9.2 Checklist riset — Must-Fix

**Inventory & POS**
- [x] Stok real-time satu transaksi (penjualan/retur/penerimaan/transfer) — SIM S1.x + konsistensi 0 mismatch.
- [x] Barcode untuk jual/terima/transfer/hitung + cetak label — pindai terbukti di POS, Mode Operasi, opname; cetak label produk tersedia dari katalog (fitur pra-A-28, tidak diubah program ini).
- [x] Lot + kedaluwarsa ditangkap saat penerimaan; FEFO; **barang kedaluwarsa tidak dapat dijual** (H-GDG-01).
- [~] Peringatan kedaluwarsa + alur pembuangan — peringatan ambang terkonfigurasi (H-GDG-02) & dokumen `expired` berkode alasan ada; peringatan **bertingkat** tetap keputusan pemilik lama.
- [x] Titik pesan ulang/minimum per gudang + peringatan stok rendah + rekomendasi pembelian (satu klik ke draf PO dari halaman Rekomendasi).
- [x] Transfer = dokumen dua tahap berstatus; tidak ada edit kuantitas on-hand langsung di UI mana pun (on-hand hanya dari movements).
- [x] Cycle count (tugas opname) + opname penuh hitung buta; selisih beralasan & berpenyetuju (maker-checker penyesuaian), terjurnal ke akun penyesuaian.
- [~] Shrinkage terukur & terlaporkan per kode alasan/toko/periode — penyesuaian berkode alasan & akun susut/hilang ada dan terjurnal; **laporan % shrinkage khusus belum dibangun** (terjadwal).

**POS integrity**
- [x] Idempotensi: ID stabil buatan klien + unik DB; uji retry/duplikat menghasilkan tepat satu penjualan (e2e offline skenario A + pos-offline-sync).
- [x] Offline: antrean persisten, status sinkron terlihat, validasi ulang server, konflik harga/stok masuk peninjauan manusia — tidak pernah diselesaikan/dihargai ulang diam-diam (e2e skenario C).
- [x] Sesi: tanpa sesi terbuka tidak ada penjualan; modal awal tercatat; setor/tarik beralasan tercatat; tutup harian berdenominasi, **buta**, toleransi + alasan wajib di luar toleransi, selisih lebih/kurang terjurnal per sesi (H-POS-01/02/03). Kembalian mengurangi kas harapan dengan benar (teruji SIM). *Catatan:* modal awal & hitungan per metode berlaku untuk tunai (metode non-tunai tanpa laci fisik; penyelesaiannya lewat akun kliring/settlement).
- [~] Void/refund/override: PIN supervisor per tindakan = **KEPUTUSAN PEMILIK** (H-POS-06); selain itu tertutup — retur berkait nota asal & mengembalikan stok lewat dokumen retur, penjualan selesai tidak dapat dihapus, riwayat sesi & audit trail menjadi dasar laporan pengecualian (laporan pengecualian harian khusus tidak dibangun).
- [x] Split tender satu penjualan; setiap tender memetakan ke akun jurnal/kliringnya sendiri (kelas `clearing` A-27).
- [~] QRIS dinamis lewat PSP berizin dengan callback tercatat — QRIS berfungsi sebagai tender kliring dengan validasi format teruji (qris-validation); **integrasi PSP (QR dinamis/callback) adalah integrasi eksternal sisi deployment**, bukan kekurangan kode aplikasi yang ditemukan audit; dinyatakan apa adanya.
- [x] Struk memenuhi spek minimum + Indonesia (nama legal, alamat, NPWP bila terisi, nomor urut, kasir, **sesi**, baris & diskon, PPN, per-tender + kembalian, QR nomor dokumen, footer terkonfigurasi per toko tanpa kode) dan **cetak ulang ber-watermark SALINAN** (H-POS-04/05); faktur penjualan format dokumen terpisah dari struk (UI-2).

**Accounting & reporting**
- [x] Setiap dokumen operasional ter-submit memposting jurnal seimbang otomatis; draf/order tidak memposting; operasi rutin tidak butuh jurnal manual (SIM S1.8).
- [x] Penilaian persediaan perpetual AVCO (satu kebijakan), HPP diakui saat penjualan.
- [x] Dokumen terposting tidak dapat dihapus/diubah — pembatalan/pembalik saja; baris GL tidak dapat diedit langsung; periode tertutup terkunci (pengecualian bernama & terlog lewat mekanisme pembalik).
- [x] Set laporan lengkap (neraca, laba rugi, arus kas, perubahan ekuitas, neraca saldo, buku besar, aging piutang/utang, penjualan) terkelompok lancar/tidak lancar, **kolom komparatif**, drill-down ke baris jurnal, ekspor CSV/XLSX identik isi dengan layar (H-AKT-01) & jalur cetak/PDF browser teruji visual.

**UX**
- [x] Semua field uang: ketik digit mentah, tampil terformat id-ID (`1.500.000`, Rp, 0 desimal), parse toleran titik/koma/tempelan, penyimpanan numerik, validasi server (H-PGT-01 + UX-B04; pengecualian edit massal beralasan di §5).
- [~] Persen tampil `%`; kuantitas menghormati desimal; tanggal lewat pemilih + format tampil; validasi per field dengan pesan berbahasa — persen & tanggal tertutup (H-PGT-02); kuantitas tetap pola desimal konsisten tanpa komponen bersama (H-PGT-03, sebagian).

**Security & governance**
- [x] Akun bernama unik per orang; RBAC model + record (RLS per perusahaan) + field (harga pokok `inventory.cost`, gaji `payroll.salary`); matriks peran **diuji sebagai peran itu** (rbac-matrix 30, payroll-access 48).
- [x] Audit trail who/what/when + before/after untuk peristiwa finansial/harga/stok/pengguna/pengaturan/impor; append-only, tidak dapat dimatikan dari aplikasi.
- [~] Kebijakan kata sandi NIST SP 800-63B-4, MFA admin/keuangan, timeout sesi server, kunci layar POS ber-PIN — fondasi ada (Better Auth, tabel two_factor, auth-hardening: penolakan kredensial & pencabutan sesi teruji); **penegakan panjang sandi NIST, kewajiban MFA per peran, dan kunci layar POS tidak menjadi temuan A-28 dan tidak dibangun** — kunci layar POS menyatu dengan keputusan PIN supervisor (pemilik).
- [~] Backup otomatis terpantau + restore teruji berkala — tertutup di permukaan aplikasi & bukti (H-X-01: manifest, peringatan basi, drill terbukti, timer mingguan, ambang 92 hari); **topologi 3-2-1 (salinan off-site/immutable) & dokumen RPO/RTO formal adalah keputusan deployment pemilik** mengikuti runbook, bukan kode.
- [x] Impor: template tervalidasi, pratinjau staging dengan laporan error per baris & **nol tulisan ke data master**, strategi duplikat eksplisit (SKU diperbarui), commit transaksional, ringkasan hasil + entri audit (H-X-02). Ekspor digerbang izin.

**Architecture**
- [x] Satu master per entitas; satu rantai dokumen per proses; satu mesin posting (`postJournal`); satu ledger stok append-only (`movements.ts`); jalur ganda diperiksa Tahap 0 = bersih dan dijaga 6 berkas fitness arsitektur A-26 yang tetap hijau.

### 9.3 Checklist riset — Should-Fix

- [~] Daftar harga per segmen: kelompok harga pelanggan (diskon %/tetap + pembulatan) **ada**; mesin promosi bertanggal (buy-X-get-Y, min-spend) & loyalitas/gift card/kupon **tidak dibangun** — promosi bertanggal adalah keputusan pemilik lama.
- [ ] Replenishment sadar permintaan (lead-time/safety-stock dari riwayat, ABC, musiman) — rekomendasi saat ini berbasis stok minimum; terjadwal.
- [ ] Alur markdown near-expiry — sisa H-GDG-02, menunggu kebijakan harga pemilik.
- [~] Dashboard eksekutif (margin, current ratio, debtor/creditor days, prakiraan kas, stock cover, shrink %) — beranda memuat KPI operasional & keuangan inti; set rasio eksekutif lengkap belum dibangun.
- [ ] Paket PDF laporan tahunan & pengiriman laporan terjadwal — tidak dibangun.
- [ ] QRIS Tap/CPM & e-receipt WhatsApp/email — bergantung PSP; tidak dibangun.
- [ ] Break-glass berbatas waktu, laporan tinjau akses kuartalan, laporan konflik SoD — tidak dibangun; matriks SoD ditegakkan lewat peran & teruji.
- [~] Lingkungan staging + runbook rehearsal migrasi/rollback + test batas arsitektur di CI — test batas arsitektur ada di suite; latihan restore & alat migrasi COA (dry-run → eksekusi terverifikasi) adalah bentuk rehearsal yang terbukti; **CI/remote git adalah keputusan pemilik lama** (daftar A-24 §3).

### 9.4 Sisa jujur lengkap & keputusan pemilik yang menunggu

**Keputusan pemilik (tidak dieksekusi diam-diam):**
1. **PIN supervisor POS** per tindakan (H-POS-06) — termasuk kunci layar POS.
2. **Gerbang persetujuan edit harga massal** (daftar A-24 §3).
3. **Matriks ECL** untuk mesin penyisihan CKPN (akun 11110 tersedia sejak A-27; mesinnya sengaja tidak dibangun).
4. **Renumber perusahaan berjalan** — alat migrasi opt-in siap (A-27 B7: dry-run → konfirmasi ganda → verifikasi saldo); menjalankannya per perusahaan adalah keputusan pemilik.
5. **Kop identitas per cabang** (UX-D04) — menunggu keputusan model cabang/multi-outlet.
6. Peringatan kedaluwarsa **bertingkat** & promosi bertanggal (daftar lama) — berkaitan dengan butir 9.3.

**Sisa terjadwal (bukan keputusan, pekerjaan masa depan):**
7. **Alur markdown harga menjelang kedaluwarsa** (sisa H-GDG-02) — butuh kebijakan harga; ambang peringatannya sudah terkonfigurasi.
8. **Strip KPI di atas daftar** (UX-A06) & **duplikasi permukaan baca stok** Produk vs Nilai persediaan (UX-C04/GDG-05) — pekerjaan desain tersendiri.
9. **GDG-13** panel duplikat pihak di halaman Pemasok & **PNG-05** kolom pertama BPJS — tercantum di RENCANA UI-5, di luar butir mandat tahap UI-5 yang dijalankan.
10. **Batas gaya sel XLSX** — SheetJS CE (0.20.3 ter-pin, keputusan A-24) tidak menulis tebal/fill/freeze panes; isi & angka identik layar.
11. **Baris yatim di DB dev bersama** — temuan Tahap 6: sisa teardown fixture SIM (35.810 baris `account_monthly_balances` + 159 `employee_history` yatim milik perusahaan fixture yang organisasinya terhapus; perusahaan demo 0 yatim; DB produksi tidak dapat menghasilkan keadaan ini). Tercatat di runbook sebagai catatan kebersihan DB dev; drill pertama atas DB dev gagal karenanya, siklus bersih setara produksi yang menjadi bukti.
12. Laporan % shrinkage khusus, set rasio dashboard eksekutif, dan `QtyInput` bersama (H-PGT-03) — terjadwal sesuai §9.2/9.3.

**Keadaan akhir tahap penutup:** demo tereseed baseline terverifikasi SQL (§Gerbang final), **server produksi lokal mati** (port 3000 bebas), PostgreSQL tetap berjalan di 5433. ZIP rilis dibangun Pemimpin dari commit final program ini.
