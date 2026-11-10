# Status Tutup A-26 — Gerbang Final & Skor Ulang terhadap Kontrak Pemilik

**Tanggal:** 2026-11-07 · **Penilai:** `docs/PANDUAN-KUALITAS-KODE.md`
(kontrak pemilik 2026-11-06) · **Keadaan kode:** sesudah Q9 (HEAD
`fe23688`) · **Pembanding:** `AUDIT-KODE-A26.md` (Q0) &
`AUDIT-SENTRALISASI-A26.md` (Q0b), metode pengukuran sama persis.
Program ini refactor struktur murni — perilaku aplikasi tidak berubah
di tahap mana pun (dibuktikan paritas per tahap + gerbang di bawah).

## 1. Gerbang final (dari reseed bersih, tanpa pipa, exit code langsung)

| Gerbang | Hasil |
|---|---|
| Reseed (`pnpm db:reset`) | **65 produk, nilai persediaan Rp28.349.600** (keluaran seed sendiri) |
| `pnpm test` | **exit 0 — 1669/1669 lulus, 174 berkas** (termasuk `tests/integration/consistency.test.ts` 11/11 & seluruh fitness arsitektur) |
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **exit 0** (0 error; 26 warning unused-vars pra-ada) |
| `pnpm build` | **exit 0** |
| `pnpm test:e2e` | **exit 0 — 19/19 lulus** (server kelolaan Playwright, flag `BISA_ALLOW_LOCALHOST_AUTH_URL` dari config) |

Angka suite tidak turun dari keadaan akhir Q9 (1669) dan naik dari
baseline awal A-26 (1600, +69 test: fitness arsitektur, paritas,
karakterisasi pembayaran, helper bersama).

## 2. Tabel sebelum / sesudah (diukur ulang dari pohon final)

| Ukuran | Q0 (2026-11-06) | Q10 (final) |
|---|---|---|
| Berkas TS/TSX di `src/` | 432 | **583** |
| Total baris `src/` | 111.044 | **114.269** |
| Distribusi ≤200 / 201–400 / 401–500 | 262 / 95 / 20 | 364 / 146 / 30 |
| Distribusi 501–800 | 29 | 42 (13 di 501–600 + 29 di 601–800) |
| Berkas 801–1000 baris | 10 | **0** |
| Berkas **>1000 baris** | **16** (±22% LOC) | **1** (`db/seed.ts`, beku beralasan) |
| Berkas >800 baris | 26 | **1** |
| Berkas >600 baris | 47 | **30** (semua modul domain tunggal ≤800) |
| Berkas terbesar non-seed | `schema.ts` 2.915 | `payables.ts` 797 |
| Klon kode tulisan tangan (jscpd, min-lines 10, min-tokens 70, migrasi dikecualikan) | 3.137 baris / 110.975 = **2,83%**, 178 fragmen | 2.430 baris / 113.233 = **2,15%**, 151 fragmen — di bawah target ≤ ±3% |
| Graf Graphify | 6.544 node / 23.967 edge | **6.941 node / 24.563 edge / 252 komunitas** |
| God nodes teratas | `d()` 590 … **`schema.ts` (berkas) degree 329** | `d()` 635 · `AppError` 394 · `withCompany()` 382 · `withCompanyReadOnly()` 291 · `todayISO()` 290 · `guard()` 271 — **semua utilitas platform terpusat; tak ada berkas data/skema di 10 besar** |
| Siklus impor | Tepat 1 SCC type-only terdokumentasi; 0 runtime (klaim manual audit) | Sama — kini **dijaga test** `architecture-import-cycles` di suite |
| Folder domain server ber-barrel | 5 | **10** (bank-reconciliation, catalog, hr, import, inventory, master-data, opening-balances, pos, reports, supplier-returns) |
| Test arsitektur / fitness | **1 berkas** (`architecture-read-paths`) | **6 berkas**: read-paths, file-size (ratchet), module-boundaries, import-cycles, settings-reads, table-writers |
| Entri ratchet ukuran (CEILINGS) | 26 giants terkunci di Q1 | **1** — `db/seed.ts` 1061, beku dgn alasan tertulis di test-nya |
| Impor bypass barrel | 1 | **0** (dijaga `architecture-module-boundaries`) |
| Tulis tabel langsung di `server/actions/**` | ±121 titik | **108 titik** (lihat sisa §5 butir 6) |
| `db/schema.ts` | 1 berkas 2.915 baris / 100 tabel | **9 berkas domain + barrel 13 baris**; `db:generate` nol migrasi baru (Q2) |
| `server/catalog.ts` | 1.452 baris / 45 ekspor | **7 agregat + re-export 9 baris** (Q5) |
| `settings-forms.tsx` | 1.811 baris / 17 ekspor | **10 berkas topik + barrel 26 baris** (Q3) |
| `pos-terminal.tsx` | 1.448 baris (1 komponen 1.356) | **738 baris orkestrasi** + sub-panel (Q7) |

Sub-target RENCANA Q10 yang **tidak tercapai penuh, dicatat apa
adanya**: "semua berkas hasil pecah ≤500 baris". Mayoritas hasil pecah
memenuhi (quick-entry 491, payment-panel 475, catalog barrel 9,
settings barrel 26), tetapi tiga berkas hasil pecah masih di pita
500–800: `pos-terminal.tsx` 738, `inventory/receipts.ts` 758,
`bank-reconciliation-panel` 657. Ketiganya kini satu-concern, di bawah
plafon ratchet 800, dan tidak masuk daftar pengecualian — diterima
sebagai keadaan akhir, bukan diklaim ≤500.

## 3. Skor ulang per prinsip kontrak (format sama dgn AUDIT-KODE-A26 §1)

| # | Prinsip kontrak | Q0 | Q10 | Bukti ringkas |
|---|---|---|---|---|
| 1.1a | Dependency Rule | SEBAGIAN | **SEBAGIAN** (membaik) | 0 siklus runtime kini dijaga test siklus; domain tetap 0 impor Next/React; tulis langsung di actions 121→108. Sisa: orkestrasi run payroll masih di lapis aksi (§5.2) & pengecualian sadar CRUD platform — keduanya terdaftar, bukan bocor diam-diam |
| 1.1b | High Cohesion + Loose Coupling | SEBAGIAN | **SESUAI** | Kedua pengurang Q0 tertutup: `catalog.ts` & `settings-forms.tsx` bukan lagi god-module; 10 folder domain server kohesif ber-barrel; berkas >800 tinggal 1 beku |
| 1.1c | Blast Radius Minimal | SEBAGIAN | **SESUAI** | Berkas degree-329 hilang dari graf (skema per domain; god-nodes final murni utilitas terpusat); klaster berubah-bersama terburuk Q0b (pengaturan: 4 berkas/3 lapis) kini per topik (Q3) + kontrak baca settings (Q4); pola terukur tahap: fitur menyentuh 1 berkas skema domain + 1 berkas aksi domain |
| 1.1d | Screaming Architecture | SEBAGIAN | **SEBAGIAN** (keputusan sadar) | Struktur utama tetap lapis teknis (dipaksa Next.js App Router); domain "menjerit" di dalam lapis: `server/` 10 folder domain, `actions/` per domain, `components/` per modul/fitur, `lib/` 5 grup domain bernama (Q9). Penyimpangan dari tafsir paling ketat kontrak — tertulis di audit §3 butir 1, tidak diubah diam-diam |
| 1.2 | Modular Monolith + Vertical Slice | SEBAGIAN | **SEBAGIAN** (keputusan sadar) | Monolit modular menguat (boundary kini terjaga 6 fitness). Slice vertikal per fitur tetap bukan struktur utama — putusan audit §3 butir 1 dipertahankan: perdalam folder-domain di dalam lapis, bukan melawan framework |
| 1.3 | Boundary & public interface | SEBAGIAN | **SESUAI** | Barrel 5→10 wilayah, bypass 1→0 terjaga test; kepemilikan tabel bersama kini berkontrak tertulis + fitness penulis-tabel (Q9); baca settings berkontrak + ratchet (Q4); gerbang jurnal & ledger stok tetap tunggal |
| 1.4 | Extensibility / OCP | SESUAI | **SESUAI** | Tidak ada regresi: seluruh tahap A-26 sendiri dikerjakan sbg berkas baru + barrel (bukti hidup OCP); angka bisnis tetap konfigurasi per perusahaan |
| 2.1 | Ukuran berkas & fungsi (SRP) | MELANGGAR (di ekor) | **SEBAGIAN** | Ekor menyusut drastis: >1000 baris 16→1, >800 baris 26→1, fungsi 517/339/238/236 dipecah berfase bernama (Q6/Q8), komponen 1.356 baris menjadi orkestrasi 738 (Q7). Belum SESUAI karena: (a) `seed.ts` 1.061 beku (K-12), (b) sub-target "hasil pecah ≤500" tak tercapai penuh (§2) |
| 2.2 | Package by Feature | SEBAGIAN | **SEBAGIAN** (keputusan sadar) | Sama dgn 1.1d/1.2: arah folder-domain digeneralisasi ke server/actions/components/lib; struktur utama tidak dirombak (kontrak §1.2 sendiri melarang over-engineering & big-bang) |
| 2.3 | Prinsip kode inti | SEBAGIAN | **SESUAI** | Kedua pengurang Q0 tertutup: fungsi raksasa jalur kritis terpecah berfase + terkunci test karakterisasi (Q8: 15 test pembayaran, nol divergensi) & differential parity (Q1b); kepemilikan `lib/` kini bernama (5 grup + README + fasad kompatibilitas 11 baris) |
| 2.4 | Anti-bloat & fitness functions | SEBAGIAN | **SESUAI** | Penjaga mesin 1→6 berkas test arsitektur (ratchet ukuran hanya-boleh-menyusut, larangan impor internal, siklus, read-paths, settings-reads, penulis-tabel); klon terukur turun 2,83%→2,15% |
| 3 | UI/UX (§3 kontrak) | SEBAGIAN | **SEBAGIAN** | Komponen >800 baris: 7→0; target sentuh primer kasir efektif 44px (Q9, menutup K-11 sesuai putusan audit). Sisa: chrome modal bentuk-khusus tulisan tangan (§5.5) & kepadatan 32px tabel desktop = pengecualian sadar tertulis (audit §3 butir 2) |

**Vonis akhir: SESUAI 6 · SEBAGIAN 6 · MELANGGAR 0** (Q0: SESUAI 1 ·
SEBAGIAN 10 · MELANGGAR 1). Empat dari enam SEBAGIAN adalah keputusan
sadar yang terdokumentasi sejak audit (struktur utama, slice vertikal,
package-by-feature, ekor ukuran dgn 1 berkas beku) — bukan pelanggaran
yang lolos: masing-masing punya putusan tertulis + penjaga mesin.

## 4. Status 12 pelanggaran K-01…K-12

| ID | Status | Bukti tutup |
|---|---|---|
| K-01 `schema.ts` 2.915 baris | **TERTUTUP** | Q2: 9 berkas domain + barrel 13 baris; nol pemanggil berubah; `db:generate` nol migrasi; berkas skema hilang dari god-nodes |
| K-02 `settings-forms.tsx` 1.811 | **TERTUTUP** | Q3: 10 berkas topik + barrel 26 baris; entri ratchet pensiun |
| K-03 actions raksasa + tulis langsung | **SEBAGIAN** | Q4: tiga actions dipecah per sub-domain, paritas 81 aksi identik; tulis langsung 121→108. Sisa terdaftar: §5.2 & §5.6 |
| K-04 `catalog.ts` read god-module | **TERTUTUP** | Q5: 7 agregat + re-export 9 baris; 37 pemanggil tak berubah; snapshot paritas 28 bidang identik |
| K-05 fungsi raksasa jalur kritis | **TERTUTUP** (di luar seed → K-12) | Commit impor 517→berfase (Q6/Q8); `postSupplierReturn` 339 & `createSupplierReturn` 238→berfase (Q8); `voidReceipt` 236→berfase (Q8); `getPartyDetail` 217→`master-data/parties` (Q8) |
| K-06 `pos-terminal.tsx` 1.448 | **TERTUTUP** | Q7: orkestrasi 738 + sub-panel di `components/pos/`; `payment-panel` 943→475; perilaku dibuktikan e2e POS + screenshot |
| K-07 panel multi-fitur | **TERTUTUP** | Q7: hr-panel→folder per fitur + barrel; quick-entry 1.049→491 per mode; bank-reconciliation-panel 856→657; wizard impor→kerangka bersama (Q6) |
| K-08 fitness functions kurang | **TERTUTUP** | 1→6 berkas test arsitektur (§2); ratchet terbukti menggagalkan pertumbuhan selama Q2–Q9 (entri pensiun 26→1) |
| K-09 kepemilikan tabel tak berkontrak | **TERTUTUP** (sbg kontrak) | Q9: tabel kepemilikan tulis 22 tabel bersama di MODULE_BOUNDARIES + fitness `architecture-table-writers`; multi-penulis by-design tetap ada — kini tertulis & terjaga, sesuai vonis audit bahwa cacatnya adalah ketiadaan kontrak |
| K-10 wilayah datar tanpa facade | **TERTUTUP** | Folder+barrel 5→10 wilayah; domain impor satu rumah `server/import` + `actions/import` (Q6); master-data/opening-balances/bank-reconciliation berfolder (Q8). Berkas domain tunggal ≤800 (payables 797, purchasing 781, serials 762) tetap satu berkas = modulnya sendiri, bukan lagi "raksasa tanpa facade" |
| K-11 target sentuh <44px | **TERTUTUP** (sesuai putusan) | Q9: permukaan sentuh primer kasir/mobile efektif 44px; kepadatan desktop 32px dipertahankan sbg pengecualian sadar tertulis (audit §3 butir 2) |
| K-12 `seed.ts` 1.061 / `seed()` 791 | **SISA BEKU beralasan** | Dinilai di Q8 & dipertahankan: satu fungsi menenun id antar keluarga data demo; pecahan bukan mekanis & risikonya ke baseline demo/e2e tak sebanding utk berkas dev-only. Satu-satunya entri CEILINGS tersisa, alasan tertulis di test ratchet |

## 5. Status 14 concern sentralisasi (Q0b) & temuan D-01…D-14

Concern di tabel Q0b §2 berjumlah 16 baris (ringkasan Q0b mengelompokkan
9 terpusat penuh / 4 sebagian / 1 tersebar pada pengelompokannya).
Status final per baris, diukur ulang:

- **Tetap TERPUSAT / TERPUSAT PENUH (14):** uang (hitung & format),
  jurnal (`postJournal`), tenant, nomor urut dokumen, pemetaan akun,
  izin, saklar modul, tarif pajak (catatan D-04-nya tertutup di Q1b —
  kini tanpa catatan), parameter bisnis & statutori, audit log,
  idempotensi, penanganan error aksi, CSV/ekspor, stok tersedia.
  Gerbang-gerbang ini tidak disentuh refactor kecuali dipindah utuh
  dgn paritas (barrel), dan fitness penulis-tabel/read-paths menjaga
  jalurnya tetap satu.
- **Pengaturan — baca: SEBAGIAN berkontrak** (dari SEBAGIAN). Q4
  menetapkan kontrak bernama `getCompanySettingsRow` + ratchet
  `architecture-settings-reads` (3 situs izinkan terdaftar); pembaca
  langsung lama berpindah oportunistik, belum semuanya — tidak
  diklaim terpusat penuh.
- **Paginasi: SEBAGIAN** (naik dari TERSEBAR, satu-satunya concern
  yang gagal uji 1-jalur di Q0b). Q5: helper kanonis `lib/pagination`
  — 9 situs server + 8 halaman bermigrasi; tersisa **7 situs `.offset((page`
  tulisan tangan** (5 `reports/*`, `audit.ts`, `actions/import/rows.ts`)
  yang semantiknya memang berbeda dan **terdaftar beralasan di kepala
  `lib/pagination.ts`** (batas 100 laporan/audit, `Math.floor` riwayat
  sesi kas, paginasi kondisional laporan persediaan, `listMovements`
  tanpa jepit bawah historis).

| ID | Status | Bukti |
|---|---|---|
| D-01 aging ganda (halaman vs ekspor) | **TERTUTUP** | Q1b: bucket & umur pindah ke `lib/due-date.ts` (`AGING_BUCKETS` bernama), kedua konsumen memakai yang sama + test batas |
| D-02 bayar utang dua implementasi | **TERTUTUP** | Q8: inti pembayaran bersama di `payables.ts`; dua fungsi publik kini pembungkus tipis; 15 test karakterisasi membuktikan nol divergensi nyata |
| D-03 wizard impor ganda (341 baris klon) | **TERTUTUP** | Q6: kerangka wizard bersama; klon antar-wizard 341→62 baris |
| D-04 tarif pajak efektif disalin | **TERTUTUP** | Q1b: 2 titik inline quick-entry memanggil `effectiveTaxRate` kanonis; varian Decimal quote & validasi receipts dipertahankan (beda semantik sah, tercatat di Q0b) |
| D-05 paginasi tersebar | **SEBAGIAN** | Lihat concern paginasi di atas |
| D-06 format mikro di luar lib (14 `toLocaleString` + chart tanpa locale) | **SISA RINGAN** | Tidak disentuh tahap mana pun di A-26; risiko satu-satunya (chart tanpa locale) tetap tercatat dari Q0b |
| D-07 `formatQty` nama sama perilaku beda | **TERTUTUP** | Q1b: varian retur diganti nama `formatQtyExact` |
| D-08 panel kasbon ↔ pinjaman kembar | **DITERIMA** | Putusan Q0b (Rule of Three — baru 2 instans, domain berbeda); dipantau via jscpd: klon total justru turun |
| D-09 MoneyInput ↔ PercentInput kembar kontrak | **DITERIMA terjaga** | Keputusan terdokumentasi U6/A-25; masing-masing terkunci test sendiri |
| D-10 quote offline cerminan server | **TERTUTUP** (penjaga) | Q1b: differential parity test menjalankan kedua implementasi atas fixture sama — nol selisih uang; klasifikasi tetap "cerminan disengaja terjaga" |
| D-11 halaman piutang-utang dua paruh simetris | **TERTUTUP** | Q8b: dua paruh AR/AP diekstrak ke komponen seksi bersama; md5 keluaran identik |
| D-12 chrome modal tulisan tangan (31 titik) | **SEBAGIAN** | Q7: Modal bersama berdiri di `components/blocks/modal.tsx` & teradopsi keluarga pengaturan (re-export `pengaturan/forms/shared.tsx`). Tersisa **31 titik `fixed inset-0` di 28 berkas** — modal bentuk-khusus panel akuntansi/gudang yang tidak dipaksa pindah (P-10 Q0b: berpindah oportunistik saat panel disentuh) |
| D-13 validasi pra-kirim per form | **DITERIMA** | Pemeriksaan UX per form memang spesifik; validasi otoritatif tetap satu tempat (165 skema Zod di server actions — tidak terduplikasi, temuan Q0b) |
| D-14 aritmetika selisih hari per tempat | **SEBAGIAN** | Jalur aging tertutup via D-01/`due-date`; pembagi `86_400_000` di situs lain (`pos-offline`, `hr/employees`, `bank-reconciliation`) tidak disentuh tahap mana pun — sisa ringan terdaftar |

## 6. Sisa jujur terdaftar (tidak diklaim selesai)

1. **`db/seed.ts` beku** — 1.061 baris, satu-satunya berkas >800 &
   satu-satunya entri ratchet; alasan tertulis di
   `tests/unit/architecture-file-size.test.ts` (dev-only, penenunan id
   antar keluarga; K-12).
2. **`runPayroll` belum relokasi ke domain** — orkestrasi run payroll
   (±550 baris) masih hidup di `src/server/actions/hr/payroll.ts`
   (671 baris) sbg `runPayrollAction`; yang terpecah di Q4 adalah
   berkas aksinya per sub-domain, bukan pemindahan orkestrasi ke
   fungsi domain `server/hr/`. Terdaftar sbg sisa K-03.
3. **`payOpeningBalance` di luar inti** — pembayaran saldo awal tetap
   implementasi sendiri di `server/opening-balances/payments.ts`;
   penyatuan inti Q8 hanya menutup dua jalur dokumen di `payables.ts`
   (penilaian-ulang P-04 Q0b memutuskan tidak memaksakan jalur ketiga
   ini ke inti yang sama).
4. **Sisa paginasi terdaftar** — 7 situs offset tulisan tangan
   beralasan tertulis di kepala `lib/pagination.ts` (butir concern
   paginasi §5).
5. **Sisa modal bentuk-khusus** — 31 titik overlay tulisan tangan di
   28 berkas (D-12); Modal bersama tersedia & teradopsi terbatas.
6. **Tulis tabel langsung di actions tersisa 108 titik** (dari 121) —
   termasuk pengecualian sadar CRUD platform murni (akun, pemetaan,
   karyawan) sesuai keputusan Q4 bahwa itu boleh tetap di aksi; angka
   ini tidak ditargetkan nol.
7. **Target sentuh** — kepadatan 32px tabel desktop dipertahankan
   sbg pengecualian sadar tertulis terhadap §3.2 kontrak (putusan
   audit §3 butir 2); yang ditegakkan 44px hanya permukaan sentuh
   primer kasir/mobile (Q9).
8. **Format mikro D-06 & sisa D-14** — ringan, terdaftar di §5,
   tidak disentuh A-26.
9. **Struktur utama** — package-by-layer berdomain dipertahankan
   (putusan audit §3 butir 1); kontrak ditafsirkan terpenuhi lewat
   folder-domain di dalam lapis + boundary terjaga mesin, bukan
   restrukturisasi ke `features/`.

## Penutup

A-26 menutup dgn gerbang penuh hijau dari reseed bersih dan skor
kontrak naik dari **1 SESUAI / 10 SEBAGIAN / 1 MELANGGAR** menjadi
**6 SESUAI / 6 SEBAGIAN / 0 MELANGGAR**, tanpa satu pun perubahan
perilaku: yang berubah hanya struktur — dan struktur itu kini dijaga
6 fitness functions agar pelanggaran yang sama tidak kembali
diam-diam. Sisa-sisa di §6 adalah daftar kerja sadar untuk program
berikutnya, bukan utang yang disembunyikan.
