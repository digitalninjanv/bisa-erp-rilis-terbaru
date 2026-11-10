# Register Temuan — Program Audit Produksi

> Dibuka pada Tahap A0 (2026-11-08). Setiap temuan: ID stabil, risiko
> (P0 kritis – P3 rendah, per §9 mandat), modul, bukti terukur, status.
> Status awal: **OPEN** (belum ditangani), **BLOCKED** (menunggu
> keputusan/lingkungan), **NOT TESTED** (belum bisa diverifikasi),
> **MONITOR** (tidak ter-reproduksi pada A0, tetap dipantau),
> **INFO** (terverifikasi bukan cacat; dicatat agar tidak diungkit ulang).
> Rencana tahap: `docs/audit/RENCANA-AUDIT.md`.

## Hasil pemeriksaan A0 yang LULUS (bukti, bukan klaim)

| Pemeriksaan | Hasil |
|---|---|
| Suite penuh dari reseed bersih | 1992/1992 (209 berkas), exit 0 |
| Typecheck / lint / build | exit 0 / exit 0 (0 error, 27 warning) / exit 0 |
| E2E dari reseed bersih | 25/25, exit 0 |
| Jurnal posted tak seimbang (A1), tanpa baris (A2), total nol (A5) | 0 / 0 / 0 |
| Baris jurnal beda perusahaan / akun lintas perusahaan (A3/A4) | 0 / 0 |
| Stok: on_hand = Σmovements tenant hidup (G1), tanpa on_hand (B2), negatif (B3) | 0 / 0 / 0 |
| Duplikat barcode/SKU/barcode kemasan, tabrakan ruang nama barcode (C1–C4) | 0 |
| Kunci idempotensi & nomor dokumen duplikat (C5/C6) | 0 |
| RLS: tabel bertenant tanpa RLS/kebijakan (E1/E2) | 0 / 0 (97 tabel, 99 kebijakan) |
| Drift skema Drizzle vs DB hidup | 0 (105/105 tabel, 0 kolom menyimpang; 122 FK, 292 index) |
| Migrasi: berkas = jurnal meta = baris `__drizzle_migrations` | 66 = 66 = 66, terakhir 0065 |
| Graphify @ `82e8c15` | 8.862 node / 29.939 edge / 309 komunitas; god node terpusat pada `d()` uang, `withCompany(Only)`, `guard()`, `writeAudit()`, `postJournal` (degree 194, gerbang posting tunggal) |

## Hasil pemeriksaan A1 — audit statis & keamanan permukaan (2026-11-08, di atas A0 `a380665`)

| Pemeriksaan | Hasil |
|---|---|
| Cakupan izin server actions | **201 aksi ter-ekspor** di 49 berkas `"use server"` (55 berkas actions − 3 `shared.ts` − `import/commit-phases.ts` − `import/commit-packaging.ts` yang pola internal non-aksi): **201/201 berpenjaga** — 198 memanggil `requirePermission`/`requirePermissionInModule`/`requireAuth` di badannya; 3 sisanya (`applySupplierCreditAction`, `refundSupplierReturnAction`, `resolveSupplierReturnOtherAction`) lewat helper izin-ganda lokal `requireReturnSettlementPermission()` (`accounting.post` ATAU `inventory.manage`, menghormati saklar modul). 187 panggilan `.parse(`/`parseInput(`; validasi uang/qty memakai `amountField` bersama (`src/lib/action-validation.ts`: aturan positive/nonNegative/nonZero atas Decimal) + domain memvalidasi ulang positif (mis. `pos/quote.ts:601`, `pos/receivables.ts:166`) |
| Pengecualian bernama (sah, terverifikasi) | `switchCompanyAction` — sesi + validasi membership sebelum cookie ditulis, role dibaca ulang dari membership tujuan di setiap request; `searchPaletteAction` — `requireAuth` + cakupan per grup ditegakkan di server (`can()` per modul), grup di luar jangkauan = kosong, bukan bocor |
| Cakupan izin API routes (20) | 11 ekspor semuanya berpenjaga: akuntansi (`accounting.view` ×6: accounts/aging/journals/journal/[id]/ledger/report), gudang (`inventory.view` ×4: customers/suppliers/products/inventory), **payroll → `payroll.salary`** (pola H-HR-01 benar). Impor: `import.manage` ×2 (parse: batas 20MB & 25.000 baris, whitelist entitas, hash isi anti-duplikat). Perangkat POS ×4: token Bearer → digest (lihat baris pra-tenant). Update desktop: 401 tanpa token valid. Auth `[...all]` = handler Better Auth. `health` publik by-design: respons minimal (status/db/tag migrasi/timestamp), tanpa env/detail error |
| Jalur tenant | Semua route ekspor/impor memakai `withCompany(ReadOnly)`; route perangkat menyelesaikan identitas dari token lalu domain berjalan di `withCompany(device.companyId)` (`pos-device.ts:703,737,747`) |
| RLS hidup sebagai `app_user` (kueri langsung, DATABASE_URL) | Tanpa `app.company_id`: **0 baris** (fail-closed). Konteks demo: tepat **65 produk**. Konteks perusahaan lain: 0 produk demo. INSERT lintas-tenant (baris mengaku perusahaan lain): **ditolak kebijakan RLS**. UPDATE lintas-tenant: **0 baris terpengaruh** |
| Jalur pra-tenant perangkat | Sempit: kebijakan `device_digest_lookup` (migrasi 0060) hanya membuka baris `pos_terminals`/`pos_pairing_codes` yang `token_digest`/`code_digest` = digest SHA-256 pada setting transaksi `app.device_digest`; token perangkat 32 byte acak (base64url), server hanya menyimpan digest |
| Autentikasi & sesi | Better Auth: pendaftaran publik MATI (`disableSignUp`), kata sandi di-hash `hashPassword` (scrypt bawaan Better Auth), sesi 7 hari/updateAge 1 hari, plugin 2FA terpasang, plugin admin/organization DICABUT (SEC-02 — tidak ada model otorisasi kedua), rate limit EKSPLISIT: 100/10 dtk global + **sign-in 10/60 dtk** (penyimpanan in-memory per instance — batasan tercatat di kode), secret & URL dari env tervalidasi Zod; produksi menolak BETTER_AUTH_URL localhost kecuali flag `BISA_ALLOW_LOCALHOST_AUTH_URL` (hanya disetel harness Playwright, komentar `env.ts`) |
| Rahasia ter-hardcode | Pemindaian pola di `src`+`scripts`: satu-satunya temuan = kata sandi demo seed `Bisa12345!` di `src/db/seed.ts` (kredensial demo terdokumentasi publik di AGENTS.md — bukan rahasia produksi) |
| Error handling | `guard()` satu pintu: AppError diteruskan; 23505 dipetakan ke pesan duplikat ramah per constraint (tanpa nama tabel mentah); ZodError diformat Indonesia per baris; error tak dikenal → dicatat logger terstruktur + pesan generik INTERNAL ke klien. Nol jalur membocorkan `error.message` mentah ke klien (satu `issue.message` di sync POS = pesan validasi Zod, memang untuk klien). Dua `catch { return false }` = parser URL pengaturan (benign) |
| Duplikasi (jscpd, parameter A-26: min-lines 10, min-tokens 70, migrasi dikecualikan) | **2,12%** (2.656 baris klon, 168 fragmen, 546 berkas) — konsisten dgn penutup A-26 (2,15%); tidak ada regresi duplikasi |
| AUD-007 QRIS — verifikasi ulang | **Statis TERBUKTI bekerja sesuai desain**: metode bertipe `qris`, gambar QRIS perusahaan diunggah tervalidasi (`qrisImageSchema`) & tampil di terminal; pembayaran non-tunai tunggal (QRIS/bank) wajib **konfirmasi penerimaan eksplisit** kasir yang terikat (metode,total) sebelum tombol Bayar aktif (POS2-05); pembayaran QRIS teruji domain (`tests/integration/pos-guards.test.ts`). Tidak ada kode klien PSP/QR dinamis di mana pun → bagian dinamis tetap NOT IMPLEMENTED (keputusan pemilik) |
| AUD-012 xlsx — verifikasi ulang | Mekanisme terverifikasi: BUKAN unduhan runtime — tarball `cdn.sheetjs.com/xlsx-0.20.3.tgz` sebagai dependensi terkunci di `pnpm-lock.yaml` **dengan integrity sha512** (`sha512-oLDq3jw7…`); risiko sisa: ketersediaan CDN saat install + advisori npm tak menjangkau paket ini (kaitannya dgn AUD-004) |

Pemeriksa integritas: `scripts/audit/db-integrity.sql` (baca-saja,
dijalankan penuh pada A0: exit 0, semua angka di atas ter-reproduksi).

## Hasil pemeriksaan A2 — rantai integrasi antarmodul (2026-11-08, di atas A1 `1afade9`)

Berkas bukti: `tests/integration/audit-a2-chains.test.ts` (**12 test,
semua lulus**) — perusahaan fixture buangan khusus (`…a201`), setiap
rantai diasersi dengan ANGKA (jurnal per akun, stok, saldo laporan),
dan seluruh baris fixture dihapus di `afterAll` (pola
pos-offline-tahap2; terverifikasi 0 residu sesudah larian). Matriks
kelengkapan 82 halaman: `docs/audit/MATRIKS-FITUR.md` (81
IMPLEMENTED, 1 PARTIAL = admin terminal desktop yang GUI-nya
NOT TESTED per AUD-009; tidak ditemukan fitur tampilan-saja).

| Rantai | Hasil | Angka kunci terverifikasi |
|---|---|---|
| (a) Beli: PO berkemasan → terima → utang → bayar sebagian → lunas | **PASS** | 2 Dus isi 40 @145.000 → stok +80, AVCO tepat 3.625; jurnal penerimaan Dr Persediaan 290.000 = Cr Utang 290.000; sisa utang 290.000 → 190.000 (status partial) → lunas & hilang dari daftar utang; neraca saldo: kas −290.000, utang neto 0, persediaan +290.000 |
| (a2) Kelebihan bayar utang | **PASS** (desain A-21 R3-02, lihat AUD-020) | Utang 50.000 dibayar 80.000 → dokumen lunas, dokumen kredit pemasok 30.000 lahir (status open, sisa 30.000), kas −80.000, akun kredit pemasok terdebit 30.000 |
| (b) Jual POS tunai+QRIS, diskon 10%, PPN 11% | **PASS** | Subtotal 20.000, diskon 2.000, total tertagih 18.000; jurnal seimbang: pendapatan = subtotal − pajak terekstrak (harga termasuk PPN, AUD-019), diskon contra debit 2.000, PPN keluaran = taxTotal quote, HPP 12.000 = kredit persediaan 12.000; stok 20 → 18; cetak ulang struk bertanda "Salinan — bukan nota asli", cetakan asli tidak (render halaman nota sungguhan) |
| (c) Retur jual sebagian berkemasan | **PASS** | Jual 2 Dus (stok 100 → 20) → retur 1 Dus: stok 60; Dr Retur Penjualan 145.000 = Cr Bank 145.000 (harga baris asal); HPP dibalik 120.000 (40 × AVCO 3.000) |
| (d) Retur beli | **PASS** | Terima 80 pcs → retur 1 Dus dari baris asal: stok 40, persediaan −145.000, saldo utang terkoreksi +145.000 (debit−kredit) |
| (e) Transfer dua tahap | **PASS** | Saklar dua tahap: kirim → status `in_transit`, asal 50 → 30, tujuan 0; terima → tujuan 20; total global tetap 50; ≥2 gerakan stok tercatat |
| (f) Void penjualan | **PASS** | Stok 7 → 10 kembali; jurnal asal tetap ada + pembalik lahir (≥2 entri, seimbang); neto kas/pendapatan dari penjualan kembali 0; **void kedua ditolak; retur atas penjualan void ditolak** |
| (g) Offline tepat sekali | **PASS** | Muatan sama dua kali: pertama `synced`, kedua `duplicate`, tepat 1 penjualan, stok −2 sekali; muatan stok kurang → `conflict`/`failed` tanpa penjualan & tanpa stok berubah; muatan bergaya desktop berkemasan (isiSnapshot 40) tersinkron, stok −40 |
| (h) Tutup sesi buta + tutup periode | **PASS** | Selisih −3.000 tanpa alasan → ditolak VALIDATION, sesi tetap terbuka; dengan alasan → tertutup, jurnal Dr Selisih Kas Kurang 3.000 = Cr Kas 3.000. Jurnal manual Agustus 75.000 terposting; periode ditutup → posting bertanggal Agustus **ditolak**; koreksi lewat jurnal pembalik bertanggal hari ini: seimbang, kas terkoreksi −75.000 |
| (i) Payroll satu siklus | **PASS** | Run 1 karyawan (bruto 6.500.000): jurnal seimbang, Dr Beban Gaji = bruto penuh, Cr Utang Gaji ≥ bersih 6.250.000; ekspor rekap **ditolak FORBIDDEN tanpa `payroll.salary`**, 200 + angka tampil dengan izin itu |
| (3) Konsistensi laporan vs jurnal | **PASS** | Neraca saldo berimbang (Σ saldo bertanda normal = 0 < 0,01); persamaan akuntansi neraca berlaku (Aset = Liabilitas + Ekuitas < 0,01); saldo kas neraca saldo == agregasi jurnal mentah akun yang sama |

Tidak ada temuan cacat baru dari rantai A2 — dua koreksi ekspektasi
selama pembangunan test terbukti perilaku desain yang benar dan
terdokumentasi di kode (dicatat sebagai AUD-019/AUD-020 agar tidak
diungkit ulang sebagai dugaan bug).

## Hasil pemeriksaan A3 — peran langsung, injeksi, dependensi, volume & konfigurasi produksi (2026-11-08, di atas A2 `75147f2`)

Berkas bukti: `tests/integration/audit-a3-roles.test.ts` (**23 test,
semua lulus**) dan `scripts/audit/bench-a3-volume.ts` (skrip ukur
yang dapat diulang: generate/measure/concurrency/wipe). Pada berkas
peran, yang dipalsukan HANYA lapisan autentikasi Better Auth —
resolusi sesi ASLI (`member` → `permissionsFor` → `assertCan`)
berjalan terhadap baris member sungguhan di perusahaan buangan
(…a301); peran diganti dengan memperbarui baris member. Semua
perusahaan fixture dihapus total sesudahnya (terverifikasi 0 baris).

### Matriks peran × fungsi (pemanggilan aksi/route langsung)

| Peran | Fungsi yang diuji | Hasil |
|---|---|---|
| Owner | jurnal manual · ubah pengaturan · void POS · gerbang ekspor payroll | LOLOS semua (kontrol positif) |
| Admin | (preset identik owner menurut `BUILTIN_ROLES` — tidak diuji terpisah; resolusi izinnya satu jalur kode yang sama) | — |
| Kasir | jurnal manual · ubah pengaturan · ekspor jurnal & laporan · void POS | **DITOLAK BENAR** semua (FORBIDDEN) |
| Petugas Gudang | jurnal manual · ekspor payroll · jalankan payroll | **DITOLAK BENAR** semua |
| Petugas Gudang | ubah field non-harga produk | LOLOS (sah: `inventory.manage`) |
| Petugas Gudang | ubah HARGA produk | **DITOLAK BENAR** oleh gerbang level-field `inventory.price`; harga tersimpan tidak berubah |
| Akuntan | jurnal manual | LOLOS (sah: `accounting.post`) |
| Akuntan | void POS · ubah harga produk | **DITOLAK BENAR** (tak memegang `pos.void` / `inventory.manage`); penjualan tetap berlaku |
| Viewer | ekspor products/inventory/accounts/journals/ledger/report/aging/customers/suppliers | LOLOS — by design (memegang `inventory.view` + `accounting.view`); lihat AUD-013 untuk isi kolom biayanya |
| Viewer | ekspor payroll · jurnal manual | **DITOLAK BENAR** (`payroll.salary` / `accounting.post`) |

**Tidak ditemukan satu pun pasangan LOLOS SALAH.**

### Injeksi dasar (perusahaan buangan)

| Uji | Hasil |
|---|---|
| SQLi `' OR '1'='1` pada pencarian produk POS | 0 baris (bukan seluruh katalog); kontrol kata wajar menemukan produk |
| SQLi `'; DROP TABLE products; --` pada pencarian produk | Tabel utuh, jumlah baris identik sebelum/sesudah |
| SQLi pada pencarian pelanggan POS | 0 baris |
| XSS tersimpan `<script>alert(…)</script>` di nama produk | Render halaman daftar: ter-escape (`&lt;script&gt;`), tag mentah tidak muncul |
| XSS tersimpan `<img onerror>` di nama pelanggan | Render halaman detail pelanggan: ter-escape (`&lt;img`), tag mentah tidak muncul |

### Volume & performa (perusahaan buangan …a302; angka mesin dev ini)

Dataset SQL massal terbangun dalam **7,31 dtk**: 10.000 produk ·
25.000 penjualan · **100.000 baris penjualan** · 50.000 baris jurnal ·
10.000 baris stok. Pengukuran domain (median 5 larian, sesudah
pemanasan):

| Pengukuran | Hasil |
|---|---|
| listProducts hal. 1 (25 baris) | 5,7 ms |
| listProducts pencarian teks | 42,2 ms |
| searchProducts POS q kosong / q teks | 4,7 ms / 30,7 ms |
| getInventoryValuation hal. 1 (50 baris) | 97,2 ms |
| listSales hal. 1 (25 dari 25 rb) | 5,9 ms (EXPLAIN: index scan 0,1 ms) |
| getIncomeStatement 2025 (50 rb baris jurnal) | 213,2 ms |
| getTrialBalance 2025 | 220,1 ms |
| getLedger akun Kas hal. 1 (25 rb baris akun itu) | 335,1 ms |
| 5 penjualan bersamaan, produk sama (stok 100, @3) | **5/5 berhasil; stok akhir tepat 85** — tanpa oversell, tanpa deadlock pada larian ini |

Halaman nyata lewat HTTP (build produksi, sesi owner perusahaan
volume; larian hangat): produk 0,22 dtk · nilai persediaan 0,19 dtk ·
riwayat POS 0,04 dtk · laporan 0,46 dtk · buku besar 0,63 dtk.

**Batas klaim yang jujur:** yang terukur adalah SATU perusahaan
10 rb produk / 25 rb penjualan / 50 rb baris jurnal pada mesin dev
ini. Belum terukur: 100 rb+ penjualan sebagai dokumen (barisnya
setara 100 rb), banyak perusahaan aktif bersamaan, dan beban tulis
campuran berkelanjutan. Titik berat teramati dicatat sebagai
AUD-022/AUD-023.

### Konfigurasi & operasional produksi

| Pemeriksaan | Hasil |
|---|---|
| Start produksi TANPA flag localhost | **DITOLAK oleh validasi env** — "BETTER_AUTH_URL tidak boleh ber-host localhost pada NODE_ENV=production", server gagal disiapkan (penjaga bekerja) |
| Start produksi dengan flag harness | Naik; `/api/health` 200 (status/db/migrasi 0065) |
| Header keamanan (HTTP nyata: `/`, `/login`, `/api/health`, halaman terautentikasi) | **Tidak ada** CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/HSTS — hanya `X-Powered-By: Next.js` + Cache-Control. AUD-014 terkonfirmasi hidup |
| Ekspor tanpa autentikasi lewat HTTP | 307 ke login — tanpa data, tanpa jejak tumpukan; route tak dikenal 404 |
| Backup (`scripts/backup.sh`) | Berhasil (dump 22,2 MB) HANYA sesudah biner klien PG ditambahkan ke PATH manual — lihat AUD-021 |
| Drill restore dari dump segar 2026-11-08 | **GAGAL (exit 1) pada pg_restore**: pembuatan ulang FK `account_monthly_balances_account_id_accounts_id_fk` dan `employee_history_employee_id_employees_id_fk` dilanggar baris yatim residu dev — persis dua constraint AUD-002. Drill tidak pernah mencapai tahap verifikasi angka. Status terakhir AUD-001/002: TERBUKTI masih menghalangi drill |

## Hasil perbaikan A4 — temuan terbukti diperbaiki + regresi (2026-11-08, di atas A3 `b730aa8`)

| Pemeriksaan | Hasil |
|---|---|
| Suite penuh dari reseed bersih | **2039/2039 (213 berkas)** — baseline A3 2027 + 12 test baru A4 (6 unit throttle pair + 6 integrasi ekspor biaya). Dua run penuh berturut-turut hijau sesudah pengerasan pesan balapan payroll (lihat AUD-008) |
| Typecheck / lint / build | exit 0 / exit 0 (0 error, 29 warning — semuanya warisan HEAD; A4 menambah 0) / exit 0 |
| E2E (urutan rapuh suite→e2e, saklar AUD-003 aktif) | **25/25** dengan `BISA_E2E_RESEED=1` — reseed otomatis di global setup terbukti menembak (log `[e2e] BISA_E2E_RESEED=1`) |
| Header keamanan via HTTP nyata (build produksi) | `/`, `/login`, `/app` terautentikasi: CSP + nosniff + Referrer-Policy + X-Frame-Options SAMEORIGIN + HSTS hadir; header lama `/pos-sw.js` utuh (AUD-014) |
| db-integrity sesudah pembersihan | **Semua pemeriksaan pelanggaran = 0 global** (A/B/C/D/E/G semua 0; tersisa informasional F1=66 migrasi, R1=1 perusahaan, R2=158) |
| Drill restore dari dump bersih | **LULUS** — akun 124, nilai persediaan Rp28.349.600, selisih neraca saldo 0 cocok sumber↔restore (di A3 drill ini GAGAL pada residu AUD-001/002) |
| Residu sesudah suite penuh | Suite menciptakan kembali ±3–6 ribu baris milik perusahaan fixture TANPA organization (bootstrap fixture org-less yang memang persisten antar-run by design, datanya konsisten — D1 tetap 0). `scripts/audit/cleanup-fixture-residue.sh` (backup wajib → hapus satu transaksi → verifikasi 0) adalah remediasi satu perintah; idempoten |
| Defek warisan yang ditemukan & diperbaiki di sela A4 | `tests/integration/audit-a3-roles.test.ts` mengimpor `applyStockMovement` dari `@/server/pos` — member yang tidak ada (yang dipakai adalah alias dari `@/server/inventory`); suite lulus karena vitest tidak men-typecheck, tetapi `pnpm typecheck` di HEAD `b730aa8` sebenarnya merah olehnya. Import mati itu dibuang; typecheck kembali 0 |

## Hasil gerbang final & status akhir A5 — penutup program (2026-11-08, di atas A4 `55b47a4`)

Laporan akhir lengkap: `docs/audit/LAPORAN-AUDIT-PRODUKSI.md`
(§A–H mandat, termasuk Production Readiness Checklist & verdict).

| Gerbang final (dari reseed bersih, tanpa pipa) | Hasil |
|---|---|
| Reseed | exit 0 — 65 produk, nilai persediaan Rp28.349.600 |
| Suite larian 1 | 2037/2039, exit 1 — 2 gagal keluarga flake AUD-008 (`AK-P3-03` pesan balapan payroll; `POS-IDEM-01` bentuk hasil balapan idempotensi); invarian terpegang; kedua berkas lulus terisolasi 28/28 |
| Suite larian 2 | **2039/2039 (213 berkas), exit 0** |
| Typecheck / lint / build | exit 0 / exit 0 (0 error, 29 warning warisan) / exit 0 |
| E2E (saklar `BISA_E2E_RESEED=1`) | **25/25, exit 0** |
| db-integrity | exit 0 — semua cek pelanggaran tenant hidup = 0 (A1–A5, B2–B4, C1–C6c, D1, E1–E2, G1–G3); B1 global = 2, teratribusi penuh ke perusahaan fixture buangan tanpa organisasi (`…aa03`/`…aa05`, tenant_hidup=false); G4 residu fixture pasca-suite 3.430 baris konsisten (remediasi satu perintah tersedia); F1 = 66 migrasi; R1 = 1 organisasi |
| Backup + drill restore | backup exit 0; **drill LULUS exit 0** — akun/produk/nilai persediaan/selisih neraca saldo cocok sumber↔restore |

**Status final per temuan (sesudah A4 ter-commit `55b47a4` & gerbang
final A5):**

| ID | Status final |
|---|---|
| AUD-001 | **FIXED** — terverifikasi ulang A5 (D1 = 0; drill LULUS) |
| AUD-002 | **FIXED** — terverifikasi ulang A5 (D1 = 0 global) |
| AUD-003 | **FIXED** — terverifikasi ulang A5 (e2e bersaklar 25/25 sesudah suite) |
| AUD-004 | **NOT VERIFIED** — syarat verdict: jalankan `pnpm audit` di CI berjaringan penuh sebelum deploy produksi |
| AUD-005 | INFO (bukan cacat) |
| AUD-006 | **BLOCKED** — keputusan pemilik (P1) |
| AUD-007 | **OPEN** — dinamis NOT IMPLEMENTED (keputusan pemilik); statis terverifikasi |
| AUD-008 | **MONITOR** — tereproduksi persis pada larian suite pertama gerbang final A5; invarian selalu terpegang |
| AUD-009 | **BLOCKED** — lingkungan; uji lapangan desktop nyata disyaratkan verdict |
| AUD-010 | **BLOCKED** — keputusan pemilik |
| AUD-011 | OPEN — 29 warning lint warisan, 0 error |
| AUD-012 | OPEN — tinjau bersama penutupan AUD-004 |
| AUD-013 | **FIXED** — terverifikasi di suite A5 (test A4 hijau) |
| AUD-014 | **FIXED** — CSP aktif selama build & e2e A5 hijau |
| AUD-015 | **FIXED** — test unit throttle hijau di suite A5 |
| AUD-016 | **FIXED** |
| AUD-017 | **FIXED SEBAGIAN + KOREKSI** — 7 dependensi tercabut; `@tauri-apps/api` dipertahankan (terbukti terpakai) |
| AUD-018 | OPEN — keputusan kebijakan pemilik |
| AUD-019 | INFO (bukan cacat) |
| AUD-020 | INFO (bukan cacat) |
| AUD-021 | **FIXED** — backup A5 exit 0 dari PATH induk |
| AUD-022 | OPEN — tindak lanjut skala |
| AUD-023 | MONITOR — terukur, dalam batas wajar |

**FINAL VERDICT (A5): CONDITIONAL GO** — untuk operasional web,
dengan 4 syarat bernama (AUD-004 di CI berjaringan; uji lapangan
desktop AUD-009 sebelum desktop operasional; keputusan pemilik
AUD-006/007/018/010; tindak lanjut P3 AUD-008/011/022/023).
Alasan & batas verdict: `LAPORAN-AUDIT-PRODUKSI.md` §H.

## Temuan

| ID | Risiko | Modul | Temuan & bukti | Status |
|---|---|---|---|---|
| AUD-001 | P2 | Platform / DB dev | **290.896 baris residu perusahaan fixture mati** di 57 dari 97 tabel bertenant (G4 skrip audit) — organisasi fixture (id sintetis `…f501`, `…aa03`, dst.) sudah dihapus tetapi datanya tertinggal: journal_lines 69.983, account_monthly_balances 49.115, audit_log 35.209, journal_entries 24.464, stock_movements 18.403, dst. Teardown fixture test tidak lengkap. Akibat: drill backup→restore di DB dev gagal keras pada deteksi yatim (tercatat sejak A-28) dan setiap pemeriksaan global terpolusi. **Tenant hidup bersih (G1–G3 = 0)** — bukan cacat jalur produksi yang terbukti, tetapi menghalangi verifikasi operasional di dev. **Bukti terbaru A3 (2026-11-08)**: drill dari dump segar GAGAL (exit 1) pada pg_restore — pembuatan ulang dua FK AUD-002 dilanggar baris yatim residu; drill tidak mencapai tahap verifikasi angka (rincian di seksi A3). | **FIXED di A4 (commit-pending)** — akar: 25 berkas test menyalin daftar `COMPANY_TABLES` tulis-tangan yang membeku (tabel baru tak pernah masuk daftar) + berkas pola-hapus-organisasi-saja yang meninggalkan baris `audit_log` (trigger append-only). Perbaikan: helper bersama `tests/helpers/wipe-company.ts` (enumerasi dinamis information_schema, satu transaksi, opsi `onlyTables` untuk reset sebagian dua berkas jurnal) dipakai 29 berkas fixture; dua bootstrap fixture (pos-guards aa03, review-t3 aa05) kini menulis gerakan `opening` padan untuk stok awalnya (invarian B1 utuh); 9 berkas fixture org-less kini mengisi `cashBankKind` eksplisit (dulu bergantung diam-diam pada residu ter-backfill A-27 — terbukti: 65 test gagal sesudah pembersihan pertama sampai fixture diperbaiki). Pembersihan satu-kali: `scripts/audit/cleanup-fixture-residue.{sql,sh}` menghapus **266.130 baris** (backup wajib dulu, satu transaksi, kriteria = company_id tanpa baris `organization`, tenant hidup struktural tak tersentuh); bukti subset: residu 20 org fixture yang dijalankan = **0**; db-integrity global = 0; drill LULUS |
| AUD-002 | P2 | Akuntansi / HR (data) | **FK yatim pada 2 constraint bernama** (D1): `account_monthly_balances_account_id_accounts_id_fk` = 47.742 baris dan `employee_history_employee_id_employees_id_fk` = 199 baris menunjuk induk yang sudah tidak ada. 100% milik perusahaan fixture mati (demo: 0; terlingkup tenant hidup: 0). Bagian data dari AUD-001, dicatat terpisah karena menyangkut constraint konkret. Seluruh 122 FK repo adalah satu kolom → cakupan cek D1 lengkap. **A3**: kedua constraint ini persis yang membuat pg_restore pada drill 2026-11-08 gagal (pesan kesalahan menamai keduanya). | **FIXED di A4 (commit-pending)** — kedua FK yatim 100% milik perusahaan mati yang dihapus pembersihan AUD-001; cek D1 db-integrity kini **0 global** dan pg_restore drill LULUS (di A3 gagal persis pada dua constraint ini) |
| AUD-003 | P3 | Test / E2E | **E2E berbagi DB dev dengan suite vitest** — menjalankan e2e tepat sesudah suite penuh menggagalkan 1 spec (`e2e/akuntansi.spec.ts` "laporan laba rugi tampil dengan baris angka", ekspektasi keadaan kosong periode berjalan) karena transaksi fixture suite ter-commit bertanggal periode berjalan. Bukti A0: larian gabungan 24/25; sesudah reseed spec tunggal 5/5 dan e2e penuh 25/25. Bukan bug aplikasi; kerapuhan isolasi test. | **FIXED di A4 (commit-pending)** — mitigasi bersih yang dipilih: reseed otomatis di global setup Playwright **di balik saklar** `BISA_E2E_RESEED=1` (`e2e/global-setup.ts`; tanpa saklar perilaku lama persis — e2e harian tidak direset diam-diam). Terbukti pada urutan persis yang dulu rapuh: suite penuh → e2e bersaklar = **25/25**. DB e2e terpisah tidak dipilih (biaya operasional harness lebih besar daripada manfaatnya untuk gerbang lokal) |
| AUD-004 | P3 | Dependensi / Keamanan | **Audit kerentanan dependensi tidak terverifikasi di lingkungan ini**: `pnpm audit --json` gagal (`fetch failed` ke endpoint advisori npm, dicoba 2026-11-08). `pnpm outdated` berhasil: hanya tertinggal patch/minor (next 16.4.3→16.4.5, better-auth 1.7.15→1.7.18, react 19.3.0→19.3.1, dll.). **Percobaan ulang A3 (2026-11-08)**: `pnpm audit --json` kembali `fetch failed`; `pnpm audit --prod --json` kali ini MENCAPAI registry tetapi endpoint advisori massal ditolak **403 `policy_denied`** oleh proksi lingkungan ("POST /-/npm/v1/security/advisories/bulk not permitted by policy") — dua bukti kegagalan berbeda, keduanya di luar aplikasi. `pnpm outdated` A3: dependensi runtime tetap hanya patch/minor (next 16.4.3→16.4.5, better-auth 1.7.15→1.7.18, react 19.3.0→19.3.1, postgres 4.0.0→4.1.0, recharts 3.8.0→3.10.1); ketertinggalan mayor hanya di devDependencies (@types/node 20→26, eslint 9→10, typescript 5.9→7.0, dotenv 17→18). | NOT VERIFIED — tetap wajib dijalankan di CI berjaringan penuh sebelum verdict akhir; jangan diklaim bersih |
| AUD-005 | P3 | Arsitektur | **Siklus impor tipe-saja dua arah** `src/lib/modules.ts` ↔ `src/lib/permissions.ts` (keduanya `import type`). Terhapus saat kompilasi — bukan siklus runtime; test siklus impor repo (yang mengecualikan impor tipe) lulus. Temuan SCC Graphify 1 dari 5.470 tepi impor berkas. | INFO — dicatat; tak perlu tindakan kecuali saat salah satu berkas mulai mengimpor nilai runtime dari yang lain |
| AUD-006 | P1 | POS / Keamanan | **PIN supervisor POS belum ada** — otorisasi tindakan sensitif kasir (void/retur/selisih tutup sesi) belum berpagar PIN supervisor. Warisan A-28 (H-POS-06). | BLOCKED — keputusan pemilik; audit tidak membangun tanpa keputusan |
| AUD-007 | P2 | POS / Pembayaran | **QRIS dinamis via PSP berizin belum terintegrasi** — QRIS yang ada bersifat statis dengan verifikasi manual. Warisan A-28; sesuai riset hardening: QRIS dinamis memang tidak bisa offline dan butuh PSP berizin. **Verifikasi A1**: perilaku statis + konfirmasi manual terbukti bekerja (rincian di tabel A1) → bagian statis PASS; dinamis tetap NOT IMPLEMENTED. | OPEN — status fitur: NOT IMPLEMENTED (dinamis, keputusan pemilik); statis TERVERIFIKASI A1 |
| AUD-008 | P3 | Test / POS | **Flake deadlock langka pada test rantai A-28** (`tests/sim2/a28-hardening-e2e.test.ts`): PostgreSQL 40P01 saat dua transaksi paralel mengunci tuple `cash_sessions` di `lockSaleSession` (tercatat di penutup Satuan Kemasan S6, larian tengah; larian final bersih). Pada A0 **tidak ter-reproduksi**: suite 1992/1992 lulus penuh. | MONITOR — **bukti A4 (2026-11-08)**: sesudah DB dev dibersihkan dari residu (AUD-001), dua test balapan konkuren menjadi lebih sering gagal di bawah beban suite penuh — `AK-P3-03` payroll konkuren (hardening-t5) dan `POS-IDEM-01` (pos-guards) — keduanya selalu mempertahankan invarian (tepat satu pemenang; yang kalah tertolak CONFLICT), yang berbeda hanya pesan/teks jalur penolakannya; terisolasi & batch kecil selalu lulus. Untuk payroll ditemukan & diperbaiki celah nyata: catch penerjemah hanya memetakan `payroll_runs_company_period_uq`, sedangkan balapan kadang tertangkap `payroll_runs_company_number_uq` → pesan generik; kini keduanya diterjemahkan ke CONFLICT "sudah pernah diproses" yang sama (dua run suite penuh berturut-turut hijau sesudahnya). POS-IDEM-01 tetap MONITOR keluarga ini (klaim kunci idempotensi domain sudah benar; penolakan pihak kalah di bawah kontensi paralel belum tertangkap bentuk errornya) |
| AUD-009 | P2 | POS Desktop | **Utang bukti lapangan desktop**: installer (.deb/.AppImage/NSIS) belum pernah ter-build dan jendela GUI belum pernah terbuka — VM tanpa pustaka GTK/WebKit sehingga crate Tauri penuh tidak terkompilasi di sini. Yang terbukti: kontrak HTTP (API perangkat 18/18 di dalam suite), harness Rust berkas-sama 64/64, ekspor statis exit 0 (program POS Native, dipertahankan di A0 lewat suite). | BLOCKED — lingkungan; perlu mesin Linux desktop nyata untuk uji installer/jendela/printer fisik/keychain OS |
| AUD-010 | P3 | Platform | **Scheduler `a24-lanjut-otomatis` belum diputus pemilik** (matikan/biarkan) — diajukan berulang sejak penutup A-24 tanpa jawaban. | BLOCKED — keputusan pemilik |
| AUD-011 | P3 | Kualitas kode | **27 warning lint** (0 error) — semuanya `@typescript-eslint/no-unused-vars` warisan di berkas lama; nol berasal dari berkas program-program terakhir. | OPEN — pembersihan oportunistik; bukan penghalang gerbang |
| AUD-012 | P3 | Dependensi | **`xlsx` dipin dari CDN SheetJS** (tarball `cdn.sheetjs.com/xlsx-0.20.3`) bukan registry npm — keputusan lama terdokumentasi (versi npm tertinggal; dipakai ekspor laporan keuangan A-28 dgn test paritas). **Verifikasi A1**: tarball terkunci di `pnpm-lock.yaml` dengan integrity sha512 — bukan unduhan runtime; risiko sisa hanya ketersediaan CDN saat install & advisori yang tak menjangkau paket ini. | OPEN — tinjau di A3 bersama AUD-004 |
| AUD-013 | P2 | Keamanan / Gudang (izin level-field) | **Ekspor produk & nilai persediaan membocorkan harga pokok ke pemegang `inventory.view` tanpa `inventory.cost`** — terbukti dgn uji negatif langsung (probe vitest sementara, sesi ASLI + route ASLI, 3/3 lulus lalu probe dihapus): konteks peran builtin **viewer** ditolak `requirePermission("inventory.cost")`, tetapi `GET /api/export/products` menjawab 200 dgn kolom **"Harga Beli"** berisi nilai harga beli nyata (dicocokkan ke DB) dan `GET /api/export/inventory` menjawab 200 dgn kolom **HPP + Nilai Persediaan**. Padahal bidang yang sama sengaja ditutupi di UI daftar/detail produk & payload POS di balik izin level-field `inventory.cost` (pola A-28 yang sama dgn `payroll.salary` — dan ekspor payroll sudah benar bergerbang `payroll.salary`). Halaman Nilai Persediaan sendiri juga menampilkan HPP di balik `inventory.view` saja. Peran terdampak bawaan: viewer (lihat-saja); peran kustom pemilik tanpa `inventory.cost` juga. Rekomendasi A5: gerbang kolom biaya di kedua ekspor (dan nilai halaman) di balik `inventory.cost` — kolom disembunyikan/ditolak, meniru pola ekspor payroll. | **FIXED di A4 (commit-pending)** — ekspor produk: kolom "Harga Beli"/"Harga Beli Kemasan" hanya bila `inventory.cost` (`productExportHeaders`/`toProductExportRow` menyaring per indeks header); ekspor persediaan: kolom HPP + Nilai Persediaan hilang tanpa izin (Potensi Jual tetap); halaman Nilai Persediaan menyembunyikan kolom HPP/Nilai + KPI nilai persediaan dari peran tanpa izin. Test pembuktian baru `tests/integration/audit-a4-cost-exports.test.ts` (6 test: viewer 200 TANPA nilai biaya di kedua ekspor & halaman; owner menerima semuanya) + test karakterisasi A3 diperbarui ke perilaku tetap (viewer TANPA "Harga Beli") |
| AUD-014 | P3 | Keamanan / Platform | **Tidak ada header keamanan global**: `next.config.ts` hanya menyetel header untuk `/pos-sw.js` (Content-Type + Cache-Control); tidak ada CSP/`frame-ancestors`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, atau HSTS di config maupun middleware (tidak ada berkas middleware). Risiko clickjacking teredam sebagian oleh cookie sesi SameSite bawaan Better Auth, tetapi ERP ber-sesi tetap lazim memasang header ini. Rekomendasi A5: set header dasar di `next.config` (frame-ancestors 'self', nosniff, referrer-policy; CSP konservatif yang tidak mematahkan aplikasi — perlu uji regresi UI). **Konfirmasi A3 lewat HTTP nyata pada build produksi**: respons `/`, `/login`, `/api/health`, dan halaman terautentikasi semuanya tanpa header keamanan apa pun (hanya `X-Powered-By: Next.js` + Cache-Control). | **FIXED di A4 (commit-pending)** — `next.config.ts`: header global pada `/:path*` (nosniff, Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options SAMEORIGIN, HSTS 63072000 includeSubDomains) + CSP konservatif yang terbukti kompatibel: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` ('unsafe-inline' skrip/gaya tak terhindarkan untuk App Router streaming + recharts; tanpa websocket di aplikasi). Bukti HTTP nyata pada build produksi: kelima header hadir di `/`, `/login`, dan `/app` terautentikasi (200); header khusus `/pos-sw.js` lama dipertahankan; build + e2e 25/25 hijau di bawah CSP ini. Sisa tercatat: CSP tanpa nonce (memakai 'unsafe-inline') — pengetatan nonce = pekerjaan terpisah bila diinginkan |
| AUD-015 | P3 | Keamanan / POS Desktop | **`POST /api/pos/pair` tanpa throttle percobaan** — tidak ada rate limit di route maupun domain `consumePairingCode`. Mitigasi yang ada terverifikasi: kode 10 karakter dari alfabet 31 simbol (entropi ±49,5 bit, `randomBytes`), TTL 15 menit, sekali pakai, kode baru membakar kode lama, jawaban 401 seragam; brute-force daring dalam jendela TTL tidak realistis pada entropi ini. Rekomendasi pengerasan A5: throttle percobaan per IP/terminal di route. | **FIXED di A4 (commit-pending)** — modul `src/lib/pair-throttle.ts`: jendela tetap 10 menit, maks 20 kegagalan per sumber (X-Forwarded-For pertama → X-Real-IP → "unknown"); hanya kegagalan yang dihitung, sukses mereset; sumber ter-throttle menerima 401 yang PERSIS sama dengan kode tidak berlaku (respons tetap seragam). In-memory per instance — batasan yang sama dengan rate limit Better Auth, dicatat di kode. Test unit 6 (`tests/unit/pair-throttle.test.ts`) |
| AUD-016 | P3 | Kualitas kode | **3 fungsi ter-ekspor tanpa pemanggil** (terverifikasi grep silang `src`+`tests`+`e2e`, hanya definisinya yang muncul): `allocateFefo` (`src/server/batches.ts:332` — implementasi alokasi FEFO alternatif yang mati; FEFO produksi hidup di `src/server/inventory/movements.ts`, risiko drift bila ada yang memasangnya kelak), `getAvailableSerials` (`src/server/serials.ts`), `listInTransitTransfers` (`src/server/reservations.ts`). Metode: pindai ekspor `src/server/**` vs seluruh korpus referensi, kandidat diverifikasi manual satu-satu (3 dari 3 sah). | **FIXED di A4 (commit-pending)** — ketiga fungsi dihapus sesudah verifikasi ulang nol pemanggil di seluruh repo (src/tests/e2e/scripts/pos-desktop/src-tauri, termasuk pola dinamis); `planFefo`/`insufficientError` dipertahankan (dipakai `applyBatchDelta`). Suite/typecheck/build hijau |
| AUD-017 | P3 | Dependensi | **7 dependensi runtime terpasang tanpa pemakaian** (depcheck + verifikasi grep di `src`: 0 berkas): `react-hook-form`, `@hookform/resolvers`, `@tanstack/react-query`, `@tanstack/react-table`, `clsx`, `tailwind-merge` (`cn` repo berasal dari paket `cn`), `pg-boss`; ditambah `@tauri-apps/api` nyasar di devDependencies root (pos-desktop punya manifest sendiri). Positif palsu yang disingkirkan: `tw-animate-css` (dipakai via `@import` CSS), `shadcn` (CLI), `server-only` (modul virtual Next). Dampak: permukaan rantai pasok & bobot install tanpa fungsi. | **FIXED SEBAGIAN + KOREKSI di A4 (commit-pending)** — 7 dependensi dicabut via `pnpm remove` (react-hook-form, @hookform/resolvers, @tanstack/react-query, @tanstack/react-table, clsx, tailwind-merge, pg-boss); lockfile konsisten, build/typecheck/suite hijau. **KOREKSI atas klaim register: `@tauri-apps/api` TERBUKTI TERPAKAI** — `pos-desktop/lib/pos-bridge.ts` mengimpor `@tauri-apps/api/core` + `/event`, dan pos-desktop SENGAJA tanpa node_modules sendiri (manifestnya menyatakan memakai instalasi repo induk, tanpa field dependencies). Pembuktian sesuai mandat: cabut → `pnpm pos:export` GAGAL "Module not found: Can't resolve '@tauri-apps/api/core'"; kembalikan (`@tauri-apps/api@^2.12.4`) → export hijau. Paket itu DIPERTAHANKAN di devDependencies root |
| AUD-018 | P3 | Keamanan / Auth | **Kebijakan panjang kata sandi minimum 8** (`minPasswordLength: 8` di `src/lib/auth.ts`) — di bawah rekomendasi NIST SP 800-63B (≥15) yang dicatat riset A-28; mitigasi yang ada: rate limit sign-in eksplisit 10/60 dtk + plugin 2FA tersedia. Checklist penutup A-28 memang mencatat penegakan NIST/MFA sebagai sisa terjadwal. | OPEN — keputusan kebijakan pemilik (A5 menaikkan minimum hanya untuk kata sandi BARU bila disetujui) |
| AUD-021 | P3 | Platform / Backup | **`scripts/backup.sh` tidak punya fallback jalur biner klien PostgreSQL** yang dimiliki `restore-drill.sh` (blok `.local/pg18-client/...`): pada mesin dev ini `pnpm db:backup` gagal langsung — "pg_dump tidak ditemukan" — sampai direktori biner klien ditambahkan ke PATH secara manual; sesudah itu backup berhasil (exit 0, dump 22,2 MB). Produksi memakai pola PG_BIN dari `/etc/bisa-erp/backup.conf`, jadi ini celah kekokohan jalur dev/operator, bukan jalur produksi — tetapi skrip yang gagal diam-diam di mesin operator adalah risiko operasional nyata. Rekomendasi A5: samakan blok fallback PATH dengan restore-drill.sh. | **FIXED di A4 (commit-pending)** — `scripts/backup.sh` mendapat blok fallback biner klien PG yang sama dengan restore-drill.sh (+ variabel PG_BIN dari env kini juga dihormati jalurnya). Bukti: `env -i PATH=/usr/bin:/bin bash scripts/backup.sh` exit 0 dan menghasilkan dump ±13,5 MB padahal `pg_dump` tidak ada di PATH induk |
| AUD-022 | P3 | Performa / Gudang & POS | **Pencarian teks produk = sequential scan ILIKE tanpa indeks trigram** — terukur A3 (perusahaan 10.000 produk): EXPLAIN ANALYZE menunjukkan Seq Scan pada `products` (17–23 ms SQL; 17.361 baris tersaring di DB dev bersama), terasa sebagai 30,7 ms (searchProducts POS) dan 42,2 ms (listProducts) di tingkat domain. Pada skala minimarket hari ini masih di bawah ambang rasa, tetapi biayanya LINEAR terhadap ukuran katalog gabungan per perusahaan dan akan menjadi keluhan pertama saat katalog/pencarian membesar. Opsi tindak lanjut (keputusan A5/pemilik): indeks `pg_trgm` pada name/sku/barcode atau pembatasan pola pencarian. | OPEN — terukur A3; bukan penghalang skala saat ini |
| AUD-023 | P3 | Performa / Akuntansi | **Buku besar & laporan keuangan adalah permukaan baca terberat** — terukur A3 pada 50.000 baris jurnal / 25.000 baris akun Kas: getLedger hal. 1 = 335 ms (saldo berjalan dihitung melintasi seluruh riwayat akun dalam rentang), getIncomeStatement 213 ms, getTrialBalance 220 ms; halaman laporan & buku-besar lewat HTTP 0,46–0,86 dtk (halaman terberat aplikasi). getInventoryValuation hal. 1 = 97 ms pada 10.000 produk. Semua masih dalam batas pakai wajar untuk operasional minimarket, tetapi tumbuh bersama volume jurnal — pantau; optimasi (agregasi saldo berjalan ter-materialisasi per bulan) hanya bila angka nyata menuntut. | MONITOR — terukur A3 |
| AUD-019 | INFO | Akuntansi / POS | **Konvensi harga jual TERMASUK PPN terverifikasi konsisten** (A2 rantai b): pendapatan dikredit = `subtotal − taxTotal` (`sales-persist.ts`: `revenueGross = subtotal − taxTotal`), diskon tetap contra terpisah, PPN keluaran dikredit sebesar pajak terekstrak dari total tertagih (18.000 × 11/111 = 1.783,78 pada rantai uji). Jurnal seimbang dan LR konsisten. Bukan cacat — dicatat karena ekspektasi "pendapatan = subtotal bruto pra-pajak" akan keliru membaca angka ini sebagai selisih. | INFO — terverifikasi A2 |
| AUD-020 | INFO | Akuntansi / Utang | **Kelebihan bayar utang TIDAK ditolak — menjadi kredit pemasok** (desain A-21 R3-02, terverifikasi A2 rantai a2): porsi teralokasi dibatasi sisa utang, kelebihan terdebit ke akun kredit pemasok dan lahir sebagai dokumen `party_credits` terbuka yang dapat dipakai pembayaran berikutnya. Perilaku disengaja & terjurnal seimbang; dicatat agar tidak diungkit sebagai "overpayment lolos". | INFO — terverifikasi A2 |

## Yang HARUS diverifikasi ulang di tahap berikut (warisan, belum dinilai A0)

- Perilaku QRIS statis & verifikasi manualnya dari UI kasir (A1) — AUD-007.
- ~~Drill backup→restore end-to-end pada DB bersih dari residu (A5) — AUD-001.~~ **SELESAI di A4: drill LULUS dari dump bersih (lihat seksi A4).**
- Matriks izin 5 peran lewat pemanggilan endpoint langsung (A3) — termasuk
  izin level-field `payroll.salary` dan `inventory.cost` dari A-28.
- Batas performa terukur (A4): klaim skala apa pun menunggu benchmark.
- Vonis visual pemilik atas screenshot program-program terakhir (di luar
  kewenangan audit teknis; verdict akhir mencatatnya sebagai belum dinilai
  bila masih kosong).
