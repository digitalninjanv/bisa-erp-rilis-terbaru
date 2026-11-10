# Matriks Verifikasi Fitur — Tahap 4, Integrasi Lintas-Modul & UI/UX Global (A-5)

**Tanggal:** 2026-11-04 · **Penyusun:** QA Engineer (agen) · **Sumber baris fitur:** commit batch Tahap 4 sejak `0670510` (T4-1 `ea4889d`, T4-2 `0e90da8`, T4-3 `91634b9`, T4-4 `41d6061`, T4-5a `facb0c1`, T4-5b `5b8157d`, T4-6a `ce56f0d`, T4-6b `e7981fa`, D-15 `1e2c002`) + keputusan D-11 s.d. D-15 di `PROGRESS.md`.
**Metode:** setiap baris ditelusur dengan grep ke `tests/` lalu berkas test-nya **dibuka dan dibaca** — bukti hanya diakui bila test benar-benar menjalankan fitur itu di level domain/action/halaman terhadap DB nyata, bukan dari nama berkas. Celah integrasi yang ditemukan ditutup di `tests/integration/feature-matrix-t4.test.ts` (11 test baru, kode M-T4-1 s.d. M-T4-5). Kode produksi **tidak diubah** oleh batch matriks ini; satu temuan dicatat bernomor di akhir dokumen.
**Status:** `TERBUKTI` = ada test otomatis yang menjalankan fitur end-to-end · `SEBAGIAN` = terbukti sebagian, sisa dijelaskan · `UI` = hanya bisa dibuktikan lewat build/halaman (gerbang e2e Tahap 5) · `CELAH` = belum ada bukti / belum dibangun, alasan dinyatakan apa adanya.

## Bagian A — T4-1 Laporan: kartu stok, valuasi, buku besar (GD-P2-5, GD-P2-6, AK-P3-04)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| A1 | Kartu stok per gudang: saldo berjalan hanya dari gerakan gudang terpilih | `stock-card-valuation.test.ts` "saldo berjalan hanya dari gerakan gudang terpilih, bukan campuran semua gudang" | TERBUKTI |
| A2 | Kartu stok berpaginasi: saldo awal halaman berikutnya = saldo akhir halaman sebelumnya; halaman terakhir dari 2.000 gerakan tetap tepat tanpa memuat semua baris | `stock-card-valuation.test.ts` (2 test pagination & volume) | TERBUKTI |
| A3 | Saldo berjalan Decimal eksak untuk qty pecahan 4 desimal | `stock-card-valuation.test.ts` "saldo berjalan Decimal eksak untuk qty pecahan 4 desimal (float akan meleset)" | TERBUKTI |
| A4 | Valuasi persediaan Decimal end-to-end: nilai per produk & total persis di atas `MAX_SAFE_INTEGER` (`"9007199254740993.0000"`) | `stock-card-valuation.test.ts` "nilai per produk dan total persis Decimal, bukan Number" | TERBUKTI |
| A5 | Valuasi berpaginasi: halaman membatasi baris, total tetap agregat SQL seluruh hasil | `stock-card-valuation.test.ts` "pagination membatasi baris tetapi total tetap agregat seluruh hasil" | TERBUKTI |
| A6 | Buku besar berpaginasi: tidak kehilangan baris di semua halaman, saldo berjalan berkesinambungan antarhalaman; akumulasi Decimal | `stock-card-valuation.test.ts` (AK-P3-04) "tidak kehilangan baris di semua halaman dan saldo berjalan berkesinambungan" | TERBUKTI |

## Bagian B — T4-2 Rekonsiliasi Bank (D-11)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| B1 | Akun yang dapat direkonsiliasi hanya kas/bank dari pemetaan & metode pembayaran | `bank-reconciliation.test.ts` test kelayakan akun (1100 & 1000 masuk, 4000 tidak) | TERBUKTI |
| B2 | Impor mutasi CSV (pemisah terdeteksi, nominal id-ID): baris rusak dilaporkan per baris; impor ulang anti-duplikat via sidik jari baris | `bank-reconciliation.test.ts` "impor CSV: baris rusak dilaporkan per baris, impor ulang melewati duplikat" (2 masuk, 1 error baris 4; impor kedua 0 masuk 2 dilewati) | TERBUKTI |
| B3 | Impor ke akun non-bank ditolak | `bank-reconciliation.test.ts` (VALIDATION untuk akun pendapatan) | TERBUKTI |
| B4 | Auto-match hanya kandidat TUNGGAL ±3 hari nominal sama persis; kandidat ganda dilewati sebagai ambigu | `bank-reconciliation.test.ts` "auto-match menautkan kandidat tunggal dan melewati kandidat ganda" | TERBUKTI |
| B5 | Auto-match TIDAK menautkan jurnal yang sudah dibalik maupun baris jurnal baliknya | `feature-matrix-t4.test.ts` (M-T4-2) — **celah ditutup batch ini**: jurnal Dr Bank dibalik, mutasi senominal tetap tak tertaut (`matchedCount` 1 hanya untuk jurnal live pembanding) | TERBUKTI |
| B6 | Match manual: nominal berbeda ditolak; nominal sama diterima | `bank-reconciliation.test.ts` "match manual menolak nominal berbeda; unmatch mengembalikan status" | SEBAGIAN — lihat temuan **T4M-01**: match manual tidak memeriksa jurnal yang sudah dibalik |
| B7 | Unmatch mengembalikan baris mutasi & baris buku ke status belum tertaut | `bank-reconciliation.test.ts` test yang sama (sesudah unmatch, baris buku muncul lagi sebagai unmatched) | TERBUKTI |
| B8 | Jurnal baru dari mutasi tanpa pasangan: seimbang, langsung tertaut, saldo buku berubah | `bank-reconciliation.test.ts` "buat jurnal dari mutasi biaya bank: seimbang, tertaut, saldo buku berubah" | TERBUKTI |
| B9 | Ringkasan 4 angka konsisten: Saldo Buku = Sudah Direkonsiliasi + Belum Direkonsiliasi (jurnal); Mutasi Belum Tertaut neto benar | `bank-reconciliation.test.ts` "ringkasan empat angka konsisten: buku = tertaut + belum tertaut" | TERBUKTI |
| B10 | Halaman `/app/akuntansi/rekonsiliasi` (impor, daftar, taut manual dari UI) | Build + halaman memakai domain yang sama dengan B1–B9; interaksi UI-nya sendiri tanpa test otomatis | UI — gerbang e2e Tahap 5 |

## Bagian C — T4-3 Penebusan Kredit Pelanggan (D-12)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| C1 | Penebusan berdasarkan nomor dokumen retur; retur exchange → kredit ditebus sebagian, sisa tunai; jurnal Dr 2300 & Dr Kas benar, `credit_used` naik | `credit-redemption.test.ts` test penebusan sebagian | TERBUKTI |
| C2 | Pemakaian melebihi sisa kredit ditolak; sisa parsial bisa dipakai persis sebesar sisa (tanpa kembalian dari kredit) | `credit-redemption.test.ts` test melebihi sisa | TERBUKTI |
| C3 | Konkurensi: dua checkout bersamaan memperebutkan kredit yang sama — tepat satu lolos sebesar sisa | `credit-redemption.test.ts` test balapan dua kasir | TERBUKTI |
| C4 | Void penjualan penebus mengembalikan `credit_used`; sisa kredit pulih | `credit-redemption.test.ts` test void penebus | TERBUKTI |
| C5 | Retur refund tunai tidak memiliki kredit: `getReturnCredit` null & penebusan atas nomornya ditolak | `credit-redemption.test.ts` test refund tunai | TERBUKTI |
| C6 | Isolasi tenant: nomor retur perusahaan lain tidak terlihat; nomor acak ditolak saat checkout | `credit-redemption.test.ts` test isolasi | TERBUKTI |
| C7 | Metode bertipe `customer_credit` ditegakkan memakai akun pemetaan `customer_credit` (2300) | Penegakan tipe metode berjalan di jalur checkout yang sama dengan C1–C3 (seed metode `CUSTCREDIT` → akun 2300 di fixture test yang sama) | TERBUKTI |
| C8 | Panel "Pakai Kredit Retur" di terminal POS | Domain & jurnal: C1–C6. **Batas jujur (dari laporan T4-3): terminal UI hanya menerima SATU entri kredit per penjualan**; domain mendukung banyak entri & teruji di level domain. Interaksi panel: build/UI | SEBAGIAN |

## Bagian D — T4-4 Print Engine (D-13)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| D1 | Pengaturan cetak tersimpan lewat action & terbaca kembali (10 kolom `company_settings`, migrasi 0015) | `print-settings.test.ts` "saves print settings through the action and reads them back" | TERBUKTI |
| D2 | Validasi pengaturan: warna aksen tidak sah & template tak dikenal ditolak | `print-settings.test.ts` "rejects an invalid accent color and an unknown template" | TERBUKTI |
| D3 | Komponen bersama PrintShell/Header/Footer: kop (identitas perusahaan) mendahului isi dokumen (SET-RCPT-01) | `print-settings.test.ts` "renders the header before the body, with the template class and QR image" (urutan indeks string ditegaskan) | TERBUKTI |
| D4 | Tiga template (Modern/Minimal/Klasik) tercermin sebagai kelas & gaya render | Komponen: `print-settings.test.ts` (klasik & minimal) · Halaman asli: `feature-matrix-t4.test.ts` (M-T4-4) klasik & minimal pada GRN | TERBUKTI |
| D5 | Ukuran kertas: dokumen A4/A5 & nota thermal58/thermal80 lewat `@page` + lebar konten | Komponen: `print-settings.test.ts` ("size: A4 portrait", "size: A5 portrait") · Halaman asli: M-T4-4 (A5 → A4 berganti sesuai pengaturan) | TERBUKTI |
| D6 | QR nomor dokumen digambar server-side sebagai data-URL & tertanam di dokumen; mati bila `showQr` nonaktif | `print-settings.test.ts` "renders a real QR data URL for a document number" + render footer · Halaman asli: M-T4-4 | TERBUKTI |
| D7 | Blok tanda tangan tampil/sembunyi sesuai `showSignature`; teks kop & kaki kustom tampil | `print-settings.test.ts` render footer dua keadaan · Halaman asli: M-T4-4 (label GRN "Diserahkan oleh/Diterima oleh" + "Kop Uji Matriks"/"Kaki Uji Matriks") | TERBUKTI |
| D8 | Halaman cetak GRN memakai pengaturan perusahaan (template, kertas, kop, QR, tanda tangan) — bukan hardcode | `feature-matrix-t4.test.ts` (M-T4-4, 2 test render halaman asli, termasuk pergantian pengaturan mengubah render) — **celah ditutup batch ini** | TERBUKTI |
| D9 | Halaman cetak PO memakai pengaturan yang sama | `feature-matrix-t4.test.ts` (M-T4-4) render halaman PO asli — **celah ditutup batch ini** | TERBUKTI |
| D10 | Nota POS memakai pengaturan cetak (kertas nota & template dari pengaturan bersama; lebar nota lama tidak lagi menggerakkan) | Komponen & pengaturan: D3–D7 dengan varian `receipt` · Render halaman nota asli dengan fixture penjualan: belum ada test render halaman | SEBAGIAN — gerbang e2e Tahap 5 |
| D11 | Tab "Cetak" di Pengaturan + pratinjau memakai komponen yang sama | Halaman pengaturan dirender dari komponen `src/components/print/` yang teruji di D3; interaksi tab: build/UI | UI — gerbang e2e Tahap 5 |

## Bagian E — T4-5a Perluasan Impor (tanpa migrasi)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| E1 | Setiap tipe impor punya contoh CSV yang ter-parse bersih & header terpetakan; rute template mengembalikan contoh persis; entitas asing ditolak | `import-expansion.test.ts` (2 test contoh & rute template) | TERBUKTI |
| E2 | Impor pemasok: duplikat & baris rusak per baris; kode otomatis untuk baris tanpa kode; pemasok hasil impor bisa dipakai | `import-expansion.test.ts` rangkaian impor pemasok | TERBUKTI |
| E3 | Impor pelanggan: kelompok dikenal terhubung, kelompok asing error baris, batas kredit terbaca id-ID | `import-expansion.test.ts` rangkaian impor pelanggan (batas kredit `2500000.00` dari format id-ID) | TERBUKTI |
| E4 | Impor akun: tipe tak dikenal error, kode yang sudah ada dilewati, akun baru bisa diposting jurnal seimbang | `import-expansion.test.ts` rangkaian impor akun | TERBUKTI |
| E5 | Impor stok awal: commit menghasilkan SATU penerimaan sumber `opening` per berkas, stok & jurnal ekuitas benar | `import-expansion.test.ts` "commit menghasilkan SATU penerimaan opening dengan stok & jurnal ekuitas yang benar" | TERBUKTI |
| E6 | Ekspor CSV padanan memuat baris hasil impor | Nama/kode saja: `import-expansion.test.ts` (3 asersi ekspor di rangkaian pemasok/pelanggan/akun) · **Nilai semua field pada baris yang sama**: `feature-matrix-t4.test.ts` (M-T4-3, 3 test) — **celah diperkuat batch ini**: pemasok 7 sel persis; pelanggan 9 sel persis termasuk batas kredit `1.500.000` → `1500000.00`; akun 5 sel substantif + status persis | TERBUKTI |
| E7 | Wizard impor master di UI (pemetaan kolom, pemilih gudang stok awal) | Alur action-nya: E2–E5; interaksi wizard: build/UI | UI — gerbang e2e Tahap 5 |

## Bagian F — T4-5b Dokumen Saldo Awal Hutang/Piutang (D-14)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| F1 | Buat saldo awal AP: jurnal pembuka Dr ekuitas / Cr utang bertag pihak, seri OPB; tampil di daftar utang; bayar sebagian → lunas → hilang dari daftar | `opening-balances.test.ts` test AP penuh | TERBUKTI |
| F2 | Saldo awal AR simetris: Dr piutang bertag / Cr ekuitas, seri OPR; void pembayaran mengembalikan sisa | `opening-balances.test.ts` test AR | TERBUKTI |
| F3 | Void dokumen: yang sudah terbayar ditolak; yang belum terbayar berhasil & jurnalnya terbalik | `opening-balances.test.ts` test void dokumen | TERBUKTI |
| F4 | Validasi: jenis/pihak tak cocok, nominal nol, akun sembarang, bayar melebihi sisa — ditolak | `opening-balances.test.ts` test validasi | TERBUKTI |
| F5 | Pembayaran lewat `party_payments.opening_id`; izin bayar `accounting.post` atau `pos.sell` | Jalur pembayaran: F1/F2 (domain). Penegakan izin berada di action dengan pola `requirePermission` yang sama dengan action teruji lain; tidak ada test izin khusus saldo awal | SEBAGIAN |
| F6 | Impor massal saldo awal hutang/piutang: pihak dikenal menjadi dokumen, pihak tak dikenal error baris; contoh CSV ter-parse bersih | `opening-balances.test.ts` (test contoh CSV + test impor dua baris) | TERBUKTI |
| F7 | **Aging AR/AP memuat dokumen saldo awal pada bucket yang benar** (bucket dari tanggal dokumen; nilai = sisa) | `feature-matrix-t4.test.ts` (M-T4-1) — **celah ditutup batch ini**: perusahaan uji tanpa baris periode, 4 bucket AP & AR masing-masing (10/45/75/120 hari) + dokumen terbayar sebagian dihitung dari sisa 400.000; aritmetika bucket halaman dicerminkan persis di test karena `agingBuckets` adalah fungsi komponen tak-terekspor | TERBUKTI |
| F8 | Bucket aging mengikuti tanggal dokumen; `dueDate` disimpan & ditampilkan ("Tempo …") tanpa menggeser bucket (deviasi sadar D-14) | F7 membuktikan bucket dari tanggal dokumen; tampilan label tempo: build/UI | SEBAGIAN |

## Bagian G — T4-6a Pemilih Perusahaan & Penomoran Kustom (LINTAS-01, AK-P3-07)

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| G1 | `switchCompanyAction`: anggota → cookie httpOnly/lax/path `/` terbit; bukan anggota → FORBIDDEN tanpa cookie | `company-switch.test.ts` (2 test) | TERBUKTI |
| G2 | Resolusi murni `resolveMembership`: cookie sah memilih perusahaan ke-2/ke-3; cookie asing → terawal; tanpa cookie → terawal; daftar kosong → undefined | `tests/unit/company-selection.test.ts` (4 test) | TERBUKTI |
| G3 | `requireAuth` asli: cookie perusahaan asing tidak menggeser konteks; cookie sah berpindah & data `withCompany` mengikuti; tanpa cookie → perusahaan terawal | `feature-matrix-t4.test.ts` (M-T4-5, 3 test, modul sesi ASLI + DB nyata) — **celah integrasi ditutup batch ini** (sebelumnya hanya action & fungsi murni yang teruji) | TERBUKTI |
| G4 | UI pemilih perusahaan: 1 membership = lencana statis; >1 = `<select>` + reload penuh | Build/UI; logika resolusinya G2/G3 | UI — gerbang e2e Tahap 5 |
| G5 | Penomoran kustom: tanpa override format persis seperti sebelumnya; override prefix+padding berlaku hanya untuk jenisnya; penghapusan mengembalikan bawaan; override kotor yang tersimpan diabaikan | `tests/integration/document-numbering.test.ts` (3 test `nextDocumentNumber`) + `tests/unit/document-numbering.test.ts` (4 test modul murni) | TERBUKTI |
| G6 | `saveDocumentNumberingAction`: menyimpan override yang terbaca kembali & dipakai penerbitan; menolak prefix kotor & jenis tak dikenal; entri kosong menghapus override | `tests/integration/document-numbering.test.ts` (3 test action) | TERBUKTI |
| G7 | Penghitung nomor tidak pernah mundur (prefix efektif ditulis kembali ke `document_sequences` tiap penerbitan) | Terimplisit di G5/G6 (penerbitan berurutan memakai baris sequence yang sama); tidak ada test konkurensi penomoran khusus | SEBAGIAN |

## Bagian H — T4-6b AK-P3-05 & UI/UX Global

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| H1 | `MoneyInput` id-ID: menerima "1.500.000,50"/"Rp 1.500"; menolak "abc"/"1,2,3"/negatif/>4 desimal dengan pesan; nilai keluar string Decimal 4 desimal | `tests/unit/money-input.test.ts` (28 test atas helper murni `src/lib/money-input.ts`) | TERBUKTI |
| H2 | `listExpenses` berpaginasi + agregat server atas seluruh filter (total & bulan berjalan mengecualikan void) | `expenses-pagination.test.ts` "paginates and aggregates over the full filtered set" | TERBUKTI |
| H3 | `AccountCombobox` di form jurnal/beban/transfer/modal/payment (pola ProductPicker, filter lokal) | Komponen UI murni (daftar akun berasal dari query halaman yang sudah teruji di modul masing-masing); tidak ada test komponen | UI — gerbang e2e Tahap 5 |
| H4 | CSV tab `catatan` disembunyikan; rute `/api/export/report?type=catatan` → 400 (tidak lagi mengunduh file berisi pesan error) | Perubahan rute & UI; tidak ada test otomatis khusus untuk respons 400 ini | SEBAGIAN — kandidat test rute ringan Tahap 5 |
| H5 | Rasio margin dashboard memakai penyebut `netSales` | Perhitungan di komponen halaman dashboard; tidak ada test otomatis | UI — gerbang e2e Tahap 5 |
| H6 | `loading.tsx` di 5 segmen (app, akuntansi, gudang, pos, pengaturan) dengan skeleton tanpa teks/angka | Build + keberadaan berkas; perilaku streaming-nya properti Next | UI |
| H7 | Perbaikan WCAG statis: aria-label pada pagination/pencarian/POS/shell | Build + lint; **audit axe penuh tetap terjadwal Tahap 5** (klaim WCAG 2.2 AA penuh tidak dibuat di tahap ini) | SEBAGIAN |
| H8 | Performa data besar: valuasi 10.200 produk median 197,5 ms; kartu stok hal. 40 13,0 ms; daftar jurnal 6,1 ms; laba rugi 41,1 ms | `docs/reports/PERFORMA-BULK.md` — pengukuran terdokumentasi di DB scratch `bisa_bulk` (sudah di-drop) oleh batch T4-6b; bukan test regresi otomatis & ambang misi (<2 dtk halaman) terpenuhi pada angka-angka terukur ini | SEBAGIAN — bukan gerbang otomatis |

## Bagian I — D-15 Migrasi dari Database Kosong

| # | Fitur | Bukti uji | Status |
|---|---|---|---|
| I1 | Rantai migrasi penuh (0000–0017) + seed berhasil dari database kosong: `CREATE EXTENSION IF NOT EXISTS "pg_trgm"` di kepala migrasi 0000 (pengecualian satu kali aturan migrasi, D-15) | Verifikasi manual Pemimpin tercatat di `PROGRESS.md` (DB scratch dibuat, dirantai, di-seed, lalu di-drop; migrate di DB dev tetap no-op). Tidak ada test otomatis yang membuat database kosong | SEBAGIAN — bukti manual terdokumentasi, bukan test |

## Test penutup baru — `tests/integration/feature-matrix-t4.test.ts` (11 test)

| Kode | Isi | Hasil |
|---|---|---|
| M-T4-1 | Aging: dokumen saldo awal AP (4 bucket + 1 terbayar sebagian) & AR (4 bucket) di perusahaan uji tanpa baris periode; baris union bertanda `source: "opening"`, sisa & status parsial benar, total per bucket persis | Lulus |
| M-T4-2 | Rekonsiliasi: jurnal Dr Bank yang sudah dibalik + jurnal baliknya tidak tertaut auto-match; jurnal live pembanding tertaut pada run yang sama | Lulus |
| M-T4-3 | Round-trip impor→ekspor master pada level nilai field: pemasok (7 sel), pelanggan (9 sel, batas kredit id-ID), akun (5 sel substantif + status) | Lulus (3 test) |
| M-T4-4 | Render halaman cetak GRN & PO ASLI: template/kertas/kop/QR/tanda tangan mengikuti pengaturan perusahaan; pergantian pengaturan mengubah render; angka dokumen tidak berubah | Lulus (3 test) |
| M-T4-5 | `requireAuth` ASLI: cookie asing → konteks perusahaan terawal; cookie sah → berpindah + data tenant mengikuti; tanpa cookie → terawal | Lulus (3 test) |

## Temuan

### T4M-01 — Match manual rekonsiliasi menerima baris jurnal yang sudah dibalik (P3, integritas data)

- **Lokasi:** `src/server/bank-reconciliation.ts` `matchLine` (±baris 538–581).
- **Gejala:** `matchLine` hanya memeriksa jurnal berstatus `posted`, akun sama, belum diklaim, dan nominal sama. Ia **tidak** memeriksa apakah jurnal asal sudah dibalik atau apakah baris itu milik jurnal balik — padahal kandidat auto-match & daftar baris buku (`liveBookLineWhere`, baris ±409–417) mengecualikan keduanya. UI tidak pernah menawarkan baris seperti itu (daftar kandidat berasal dari `listBookLines` yang live), tetapi batas action menerima tautan bila dipanggil langsung.
- **Reproduksi (terverifikasi empiris oleh QA, probe sekali pakai di transaksi rollback, berkas probe sudah dihapus):** posting jurnal Dr Bank 7.770.019 → balik jurnalnya → impor mutasi debit 7.770.019 → `matchLine` ke baris bank jurnal asal → **DITERIMA**, mutasi tertaut ke jurnal yang sudah dibalik.
- **Dampak:** saldo "Sudah Direkonsiliasi" bisa mencakup jurnal yang neto-nya sudah nol karena pembalikan — rekonsiliasi tampak cocok padahal buku sudah berubah.
- **Saran perbaikan (untuk Pemimpin, tidak dikerjakan di batch ini):** terapkan predikat live yang sama di `matchLine` (tolak VALIDATION bila `reversalOfId` terisi atau jurnal sudah memiliki jurnal balik posted), plus test regresi di `bank-reconciliation.test.ts`.

## Ringkasan

- **Total baris fitur: 66** (A 6 · B 10 · C 8 · D 11 · E 7 · F 8 · G 7 · H 8 · I 1) — TERBUKTI 49 · SEBAGIAN 10 · UI 7 · CELAH 0.
- Tidak ada fitur Tahap 4 yang belum dibangun diam-diam: semua baris CELAH potensial ternyata punya bukti, atau dinyatakan SEBAGIAN/UI apa adanya (render halaman nota D10, izin saldo awal F5, penghitung nomor G7, CSV catatan H4, margin dashboard H5, audit axe H7, performa H8, migrasi DB kosong I1).
- **Celah ditutup batch ini: 5 kelompok (11 test baru)** — aging saldo awal (M-T4-1), auto-match vs jurnal balik (M-T4-2), round-trip impor→ekspor level field (M-T4-3), render halaman cetak GRN/PO (M-T4-4), resolusi `requireAuth` (M-T4-5).
- **Temuan baru: 1** — T4M-01 (P3) match manual menerima jurnal yang sudah dibalik; dilaporkan ke Pemimpin, tidak diperbaiki di batch matriks ini.
- Gerbang akhir batch ini (dijalankan QA, untuk diverifikasi ulang Pemimpin): `pnpm exec vitest run` (seluruh suite), `pnpm typecheck`, `pnpm lint`, `pnpm build` — hasil aktual dicantumkan pada laporan serah terima batch matriks ke Pemimpin.
