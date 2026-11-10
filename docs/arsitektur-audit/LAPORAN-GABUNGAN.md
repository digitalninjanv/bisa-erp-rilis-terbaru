# Audit Arsitektur Bisa ERP — Laporan Gabungan (A-18)

Mandat pengguna 2026-11-05 05:02 WIB: analisa arsitektur kode — kesesuaian dengan
dokumentasi & prinsip developer profesional, kemudahan perawatan/perbaikan/baca,
ketahanan jangka panjang (tidak bengkak), dan optimasi. Empat agen paralel,
baca-saja, semua klaim berbukti terukur. Baseline terverifikasi bersama:
313 berkas src, 91.044 LOC, 97–98 tabel, 46 migrasi, 1.137 test + 15 e2e hijau.

## Vonis keseluruhan: **6,9/10 — fondasi kelas satu, rumah belum selesai dibangun di atasnya**

| Dimensi | Skor | Satu kalimat |
|---|---|---|
| ARS-1 Struktur & lapisan | 7/10 | Modular monolith sejati: graf modul DAG tanpa siklus, gerbang posting jurnal tunggal, POS hanya lewat applyStockMovement — tetapi jalur baca ganda (46/76 halaman menulis kueri sendiri) dan berkas inti raksasa. |
| ARS-2 Kualitas kode | 7/10 | Disiplin langka: strict nyata (0 `any`), AppError konsisten, 0 TODO — tetapi PosTerminal satu fungsi ±2.683 baris dan fungsi transaksi raksasa (createSale ±790 baris). |
| ARS-3 Data & performa | 7/10 | Transaksi/kunci/indeks tenant kuat dan berbasis EXPLAIN — tetapi agregasi laporan memindai seluruh riwayat jurnal per permintaan; di ±250 rb baris jurnal halaman laporan menembus 4–5 detik. |
| ARS-4 Ketahanan & operasi | 6,5/10 | Ekstensibilitas & konfigurasi fiskal terbaik di kelasnya — tetapi tanpa CI, tanpa git remote, tanpa logging/health check, env tak divalidasi saat start. |

**Total temuan: 49 — P0: 0 · P1: 9 · P2: 19 · P3: 21.** Tidak ada satu pun
temuan yang menuntut rewrite. Semua risiko bersifat penataan bertahap terlokalisasi
atau penambahan infrastruktur operasi — bukan pembongkaran.

## Yang terbukti KUAT (terukur, jangan diutak-atik)

1. **Batas modul nyata, bukan kosmetik.** Graf 33 modul server adalah DAG
   (0 siklus runtime). Hanya `accounting.ts` yang boleh menyisipkan jurnal;
   `pos.ts` memuat 0 referensi tabel stok (semua lewat `applyStockMovement`).
   Komponen tidak pernah menyentuh db.
2. **Disiplin tipe & error.** TypeScript strict terasa sungguhan (0 `any`
   sebagai tipe, 0 ts-ignore); AppError 711× vs `throw new Error` 10×;
   0 catch kosong; 0 TODO/FIXME/HACK di seluruh src.
3. **Disiplin data.** withCompany struktural (385 lokasi), ±60 FOR UPDATE
   berurutan kunci terdokumentasi anti-deadlock, uang konsisten numeric(19,4) +
   Decimal, indeks pernah dicabut dengan bukti (migrasi 0030 — keberanian yang
   jarang), migrasi tak pernah diedit di luar satu pengecualian tercatat.
4. **Konfigurasi fiskal D-25 terbaik di kelasnya.** Tarif/BPJS/PTKP/TER
   bertanggal efektif per perusahaan + saklar per program; defaults terbukti
   hanya seed, engine membaca DB. Saklar modul ditegakkan 3 lapis. Jejak audit
   178 titik writeAudit. Runbook backup/restore matang & pernah dibuktikan.

## Sembilan P1 (perbaiki dalam urutan ini)

1. **ARS4-01 — Tanpa CI, tanpa git remote.** Seluruh gerbang kualitas bertumpu
   pada manusia; seluruh repo hidup di satu disk. Perbaikan termurah & paling
   bernilai di seluruh daftar ini: remote + CI yang menjalankan gerbang yang
   sudah ada (test/typecheck/lint/build/e2e).
2. **ARS3-01 — Agregasi laporan memindai seluruh sejarah.** Neraca/neraca saldo/
   beranda 4–5 detik pada skala 1 jt baris jurnal; target <2 detik jebol mulai
   ±250 rb baris. Perbaikan cepat: paralelkan 5 mappedBalance. Perbaikan
   sesungguhnya: tabel ringkasan saldo bulanan per akun yang diperbarui saat
   posting (requirement R-4 sejak SIM-2 S4).
3. **ARS3-02 — Arus kas memuat seluruh baris lawan ke memori.** O(total baris
   dalam rentang), atribusi di JS. Pindahkan agregasi per kelompok ke SQL.
4. **ARS1-01 — Dua jalur baca hidup berdampingan.** 46/76 halaman berkuei
   sendiri; klaim "logika di src/server" hanya berlaku untuk tulis. Tetapkan
   aturan tertulis + migrasi bertahap halaman ke fungsi baca modul.
5. **ARS1-02/ARS2-01/ARS2-02 — Tiga berkas inti raksasa.** PosTerminal satu
   fungsi ±2.683 baris (47 useState), createSale ±790, createReceipt ±528 —
   persis modul dengan churn & risiko tertinggi. Ekstrak hook/sub-fungsi per
   fase; tanpa mengubah perilaku (suite 1.137 adalah jaring pengamannya).
6. **ARS4-02 — Kebutaan produksi.** Logging nyaris nol (console.error tanpa
   konteks), tanpa /api/health, tanpa instrumentation. Tambahkan logger
   terstruktur minimal + endpoint health.
7. **ARS4-03 — Env tidak divalidasi saat start.** BETTER_AUTH_SECRET dapat
   kosong secara senyap. Validasi env fail-fast saat start.
8. **Akar gabungan ARS1-03/ARS2-04 — 62 titik `.parse()` mentah.** Satu
   perbaikan titik-tunggal menutup semuanya: petakan ZodError → VALIDATION di
   `guard()` (kelas bug A-13 yang akarnya masih hidup).

## Pola P2 yang berulang (19 temuan)

- **Aset yatim dari niat baik**: pg-boss terpasang 0 pemakaian; 6 dependensi
  produksi tak terpakai (react-query, react-table, react-hook-form, date-fns,
  …); komponen PrintButton mati; xlsx dipin ke tarball CDN di luar npm.
- **Utang test**: `rollbackTransaction` identik tersalin di 48 berkas (ekstrak
  `tests/helpers/`); suite serial ±3,5 menit mempersulit CI nantinya.
- **Skala yang bisa diperkirakan**: listReceivables/Payables tanpa paginasi;
  ekspor CSV dibangun sebagai string utuh (+151–196 MB heap pada 100 rb
  produk); celah indeks journal_lines & sale_lines; pool 12 koneksi; tabel
  append-only tanpa strategi retensi/partisi pada laju ±6 jt baris/tahun.
- **Dokumen basi yang bertentangan**: README & dokumen S0-A masih menyebut
  offline/PR/serial/reservasi "belum ada"; tabel status PROGRESS §4 tertinggal.
- **Satu berkas skema** (2.683 baris/98 tabel) dan `company_settings` monolit —
  dinilai wajar hari ini, dicatat sebagai titik pantau, bukan utang mendesak.

## Jawaban atas pertanyaan pengguna, satu per satu

- *Sudah sesuai dokumentasi & prinsip profesional?* Pola yang dijanjikan
  AGENTS.md terverifikasi akurat pada sampel terukur (force-dynamic 76/76,
  pola actions seragam 21/21, gerbang jurnal tunggal). Yang belum profesional
  bukan polanya, melainkan ketiadaan pagar otomatisnya (CI/lint arsitektur).
- *Metode terbaik?* Untuk kelas produk ini, ya: modular monolith + RLS +
  Decimal + append-only adalah pilihan yang benar dan dieksekusi disiplin.
  Microservices/rewrite akan merugikan.
- *Mudah dirawat, diperbaiki, dibaca?* Sebagian besar repo ya. Pengecualian
  terpusat dan terukur: tiga berkas inti raksasa + jalur baca ganda. Keduanya
  dapat ditata bertahap tanpa rewrite, dengan suite test sebagai pengaman.
- *Tahan lama, tidak bengkak?* Struktur tahan lama; yang mengancam umur bukan
  desain modul melainkan (a) performa agregasi pada volume besar, (b) operasi
  (CI/remote/backup terjadwal) yang belum ada. Keduanya terukur & terencana.
- *Optimasi?* Titik beratnya satu: agregasi laporan. Selebihnya indeks &
  paginasi lokal.

Detail per temuan: ARS-1-STRUKTUR-LAPISAN.md, ARS-2-KUALITAS-KODE.md,
ARS-3-DATA-PERFORMA.md, ARS-4-KETAHANAN-OPERASI.md di folder ini.
