# S0-D — Audit Keamanan, Performa & Integritas Data (SIM-2 Fase S0)

**Sifat:** baca-saja. Tidak ada kode/data diubah; basis data hanya disentuh dengan SELECT/EXPLAIN.
**Metode:** pembacaan kode sumber langsung, pemindaian pola (grep) atas seluruh `src/`, pemeriksaan konfigurasi pustaka terpasang di `node_modules`, dan EXPLAIN atas DB dev `bisa` (PG 18, port 5433). Setiap temuan menyebut berkas:baris sebagai bukti. Angka waktu/biaya yang dikutip adalah keluaran planner PostgreSQL pada dataset dev — **bukan benchmark**; pengukuran beban sesungguhnya adalah pekerjaan Fase S4.
**Tanggal:** 2026-11-04 · **Suite saat audit:** 590/590 test (69 berkas).

---

## 1. Keamanan (kerangka OWASP ASVS)

### 1.1 Peta permukaan

| Permukaan | Bukti | Keadaan |
|---|---|---|
| Autentikasi | `src/lib/auth.ts` (Better Auth 1.7.x, `package.json:29`) | Email+sandi, sesi 7 hari (`auth.ts:22-25`), plugin organization + admin + twoFactor + nextCookies (`auth.ts:26-34`) |
| Otorisasi | `src/lib/session.ts:131-148`, `src/lib/permissions.ts` | `requirePermission` / `requirePermissionInModule` (gerbang saklar modul) di lapisan aksi; 15 izin, 7 peran bawaan + peran kustom |
| Isolasi tenant | `src/db/tenant.ts:11-27`, migrasi RLS | `withCompany` menetapkan `app.company_id` per transaksi; RLS ENABLE + **FORCE** sejak `src/db/migrations/0001_rls_and_guards.sql:25` |
| Rute API | `src/app/api/**` | 1 handler auth (Better Auth), 7 rute ekspor CSV, 2 rute impor — semuanya berpenjaga (lihat SEC-POS-2) |
| Unggahan | `src/app/api/import/parse/route.ts`, `src/server/actions/settings.ts` | Impor XLSX/CSV ≤20MB/25.000 baris; QRIS & logo sebagai data URL di DB |

### 1.2 Yang terverifikasi BAIK (dengan bukti)

- **SEC-POS-1 — Semua aksi tulis berpenjaga.** Pemindaian per-fungsi atas 12 berkas `src/server/actions/*.ts` (129 fungsi ekspor): nol aksi tulis tanpa `requirePermission`/`requirePermissionInModule`. Pengecualian yang disengaja dan aman: `switchCompanyAction` (`src/server/actions/company.ts:22-38`) memeriksa sesi lalu memvalidasi keanggotaan sebelum menulis cookie perusahaan; tiga aksi penyelesaian retur memakai helper izin ganda `requireReturnSettlementPermission` (`src/server/actions/supplier-returns.ts:41-51`, mewajibkan `accounting.post` ATAU `inventory.manage`).
- **SEC-POS-2 — Semua rute API berpenjaga.** Setiap `route.ts` di luar handler auth memanggil `requirePermission` (ekspor laporan/jurnal/akun: `accounting.view`; impor: `import.manage`). Objek selalu diambil di dalam `withCompany(ctx.company.id)` sehingga ID milik perusahaan lain tidak terbaca (contoh: `src/app/api/export/journal/[id]/route.ts:11-15` mengembalikan "tidak ditemukan" untuk jurnal lintas tenant).
- **SEC-POS-3 — Isolasi tenant berlapis & teruji.** Koneksi runtime memakai peran `app_user` non-pemilik (`src/db/index.ts:5-13`, pool max 12); koneksi pemilik (`src/db/admin.ts`) hanya dipakai migrasi/seed (grep `adminDb`: hanya `src/db/seed.ts`). Domain juga memfilter `company_id` secara eksplisit (pertahanan berlapis di atas RLS). Test pengunci: `tests/integration/consistency.test.ts:194` (baca lintas perusahaan menghasilkan kosong), `tests/integration/credit-redemption.test.ts:552` (dokumen perusahaan lain tidak terlihat), `tests/integration/company-switch.test.ts` (cookie perusahaan palsu tidak bisa menyeberang tenant; logika di `src/lib/session.ts:64-79`).
- **SEC-POS-4 — Tidak ada injeksi SQL yang ditemukan.** Nol pemakaian `sql.raw` dan nol konkatenasi string ke `execute(` di seluruh `src/`. Seluruh templat `sql\`…\`` menginterpolasi objek kolom Drizzle (identitas) atau nilai yang terikat sebagai parameter — termasuk dua penghapusan SQL mentah di `src/server/actions/pos.ts:259-260,353-354` (parameter terikat, di dalam transaksi `withCompany` + RLS; catatan gaya, bukan kerentanan).
- **SEC-POS-5 — XSS bersih.** Satu-satunya `dangerouslySetInnerHTML` ada di `src/components/ui/chart.tsx:94` dan menyuntik CSS yang dibangun dari konfigurasi tema milik kode aplikasi (komponen chart shadcn standar), bukan data pengguna. Tidak ada jalur render HTML dari input pengguna.
- **SEC-POS-6 — CSRF posture standar framework.** Aksi tulis adalah Server Actions Next.js (pemeriksaan origin bawaan framework) dan endpoint auth Better Auth; `src/lib/auth.ts` tidak memasang override cookie/origin yang melemahkan bawaan (cookie sesi httpOnly + SameSite bawaan Better Auth). Satu-satunya POST non-aksi adalah impor (`import.manage` + sesi).
- **SEC-POS-7 — Penjaga peran owner konsisten.** Hanya owner yang boleh memberi peran owner; owner terakhir tidak bisa diturunkan/dihapus (`src/server/actions/users.ts:160-167,262` dst.); pembuatan pengguna menulis peran tingkat-auth selalu `"user"` (`users.ts:107`) — peran perusahaan hidup di `member.role`. Teruji: `tests/integration/user-management.test.ts` (16 test, A-13), `tests/integration/pos-guards.test.ts`, `tests/integration/hardening-t5.test.ts`.
- **SEC-POS-8 — Penanganan eror tidak membocorkan internal.** `guard()` menerjemahkan eror tak dikenal menjadi pesan generik "Terjadi kesalahan pada server" (`src/lib/errors.ts:35,118`); pesan validasi ber-Bahasa Indonesia yang disengaja yang tampil.
- **SEC-POS-9 — Audit log ditulis luas.** 109 titik `writeAudit` di aksi/server; tabel `audit_log` terindeks `(company_id, created_at)` dan `(company_id, entity_type, entity_id)` (`src/db/schema.ts:1462-1463`); jurnal/stok/audit append-only per aturan proyek.

### 1.3 Temuan keamanan

#### SEC-01 — TINGGI — Data gaji terbaca oleh semua pemegang `accounting.view`
Halaman Payroll dan Kasbon hanya digerbang `accounting.view`, sedangkan izin khusus `payroll.manage` hanya menyembunyikan *formulir*, bukan datanya:
- `src/app/app/akuntansi/payroll/page.tsx:21` — `requirePermission("accounting.view")`; halaman mengambil seluruh baris karyawan (termasuk `baseSalary`) dan item payroll, lalu merender kartu "Gaji kotor / bulan" dan "Gaji bersih / bulan" dari gaji semua karyawan (baris ±77-82) tanpa syarat `payroll.manage`.
- `src/app/app/akuntansi/payroll/[id]/page.tsx:21` — detail run (net per karyawan) juga `accounting.view`.
- `src/app/app/akuntansi/kasbon/page.tsx:26` dan `kasbon/[employeeId]/page.tsx:29` — saldo kasbon per karyawan sama.
Pemegang `accounting.view`: owner, admin, manager, **accountant, viewer**, dan peran kustom mana pun yang diberi izin lihat akuntansi (`src/lib/permissions.ts:103-145`). Ini bertentangan langsung dengan mandat §13 (data gaji sensitif; kasir memang aman karena tidak punya modul akuntansi, tetapi viewer/akuntan tanpa kebutuhan payroll dapat membaca gaji seluruh karyawan). **Test pengunci: tidak ada** — test payroll yang ada (`payroll-reverse.test.ts`, `employee-advances.test.ts`) mengunci posting/void, bukan batas baca per peran. Perbaikan arah S6: gerbang halaman-halaman ini dengan `payroll.manage` (atau izin baca payroll baru) dan sembunyikan agregat gaji dari peran tanpa izin itu.

#### SEC-02 — SEDANG — Model otorisasi kedua: plugin admin & organization Better Auth aktif tetapi tidak dipakai UI
`src/lib/auth.ts:26-34` memasang plugin `organization()` dan `admin()`; endpoint-endpointnya hidup di `/api/auth/**`. Klien aplikasi hanya memakai `signIn.email` dan `signOut` (`src/components/auth/login-form.tsx:24`, `src/components/shell/user-menu.tsx:22`) — tidak ada satu pun pemanggilan plugin organization/admin/twoFactor dari UI, dan `src/lib/auth-client.ts:4-6` tetap mendaftarkan client plugin-nya. Risiko: (a) plugin organization menilai otorisasi dari kolom `member.role` yang sama dengan RBAC aplikasi tetapi dengan semantik berbeda (nama peran tumpang tindih: `owner`, `admin`) — jalur undangan/hapus anggota ala plugin tidak melewati penjaga aplikasi (mis. aturan owner terakhir versi aplikasi); (b) plugin admin memberi kuasa lintas-tenant (daftar pengguna, impersonasi — kolom `session.impersonated_by` ada di `src/db/schema.ts:53`) kepada akun dengan `user.role = 'admin'`; saat ini tidak ada jalur aplikasi yang menulis nilai itu (pembuatan pengguna menulis `"user"` — `users.ts:107`; seed menulis `"owner"` — `src/db/seed.ts:198`, bukan `adminRoles` bawaan plugin) sehingga jalur ini **inert hari ini, tetapi rapuh**: satu perubahan data/kode di masa depan mengaktifkannya tanpa tinjauan. Rekomendasi S6: cabut plugin yang tidak dipakai dari server (dan client) atau kunci perilakunya dengan test integrasi endpoint.

#### SEC-03 — SEDANG — Kredensial bawaan basis data & penyimpanan objek ter-commit di repo
`docker-compose.yml:8-9` (`POSTGRES_PASSWORD: erpdev`), `docker/init.sql` (peran `app_user` dengan sandi `'appdev'`), `docker-compose.yml:36` (`MINIO_ROOT_PASSWORD: minio-dev`), dan `.env.example` mencontohkan pola yang sama. Wajar untuk pengembangan lokal, berbahaya bila compose dipakai apa adanya ke produksi: tidak ditemukan mekanisme di repo yang memaksa/memperingatkan penggantian kredensial ini saat deployment. Rekomendasi S6: pisahkan compose dev/prod atau tambahkan pemeriksaan startup yang menolak kredensial bawaan di `NODE_ENV=production`.

#### SEC-04 — SEDANG — Pembatasan laju login hanya mengandalkan bawaan pustaka, tanpa kebijakan aplikasi
`src/lib/auth.ts` tidak mengatur `rateLimit` sama sekali. Bawaan Better Auth 1.7 (bukti dari paket terpasang): limiter **hanya aktif di production**, jendela umum 100 permintaan/10 detik per IP, jalur `/sign-in`, `/sign-up`, `/change-password`, `/change-email` diperlakukan khusus, dan penyimpanannya **in-memory per instance** (`node_modules/better-auth/dist/context/create-context.mjs:172-175`; `node_modules/better-auth/dist/api/rate-limiter/index.mjs:293,308`). Konsekuensi: batas berlaku per replika dan hilang saat restart; tidak ada penguncian akun dan tidak ada kebijakan kompleksitas sandi di luar minimum 8 karakter (`auth.ts:19`; `src/server/actions/users.ts` skema sandi min 8/max 128). Cukup untuk satu instance kecil; belum memenuhi ekspektasi ASVS untuk ketahanan credential-stuffing. Rekomendasi S6: tetapkan `rateLimit` eksplisit + pertimbangkan penyimpanan database/sekunder dan CAPTCHA/2FA (plugin twoFactor sudah terpasang tetapi tidak ada UI-nya — permukaan dorman lain).

#### SEC-05 — SEDANG — Parser XLSX server-side memakai versi dengan kerentanan terkenal yang belum tertambal di npm
`package.json:51` — `xlsx: ^0.18.5` (SheetJS). Versi 0.18.5 adalah rilis terakhir di npm; kerentanan prototype pollution CVE-2023-30533 (diperbaiki vendor di 0.19.3) dan ReDoS CVE-2024-22363 (0.20.2) tidak sampai ke jalur npm, sementara endpoint ini memang mem-parsing berkas tidak tepercaya: `src/app/api/import/parse/route.ts` (`XLSX.read` atas buffer unggahan). Mitigasi yang ada menekan dampak: endpoint bergate `import.manage`, batas 20MB dan 25.000 baris (`route.ts:12-13` dan pemeriksaan ukuran ±baris 45). Rekomendasi S6: ganti sumber paket ke rilis vendor terkini atau pustaka alternatif yang terpelihara, dan tambahkan uji berkas jahat.

#### SEC-06 — RENDAH — Dua jalur tulis gambar QRIS dengan validasi tidak sama
Jalur unggah khusus memvalidasi awalan: `uploadQrisAction` (`src/server/actions/settings.ts:660-664`) mewajibkan `data:image/` dan ≤900.000 karakter. Tetapi skema pengaturan umum hanya membatasi panjang: `qrisImage: z.string().max(900_000)` (`settings.ts:39`) — nilai apa pun sampai ±900KB dapat masuk lewat jalur simpan pengaturan. Selain itu pemeriksaan awalan tidak membatasi subtipe (`data:image/svg+xml` lolos kedua jalur), dan gambar disimpan sebagai teks data URL di baris `company_settings` (ikut membesarkan setiap baca pengaturan). Rekomendasi S6: satukan validasi (daftar putih subtipe raster: png/jpeg/webp) di satu skema bersama.

#### SEC-07 — RENDAH — Ekspor CSV tidak menetralkan injeksi formula
`src/lib/csv.ts:3-10` meng-escape tanda kutip/koma/newline dengan benar, tetapi nilai teks yang diawali `=`, `+`, `-`, atau `@` tidak dinetralkan. Nama produk/pelanggan/pemasok yang dikendalikan pengguna ikut diekspor (`src/app/api/export/customers/route.ts`, `suppliers`, `inventory`), sehingga berkas hasil ekspor dapat mengeksekusi formula saat dibuka di spreadsheet. Rekomendasi S6: awali sel teks berisiko dengan tanda kutip tunggal di `toCsv`.

#### SEC-08 — RENDAH — Endpoint pendaftaran publik terbuka tanpa UI pendaftaran
Tidak ada halaman daftar di aplikasi (hanya `/login`), tetapi handler Better Auth tetap melayani `/api/auth/sign-up/email` karena `emailAndPassword.enabled: true` + `autoSignIn: true` (`auth.ts:16-20`). Akun hasil pendaftaran tidak mendapat akses apa pun — `requireAuth` mengalihkan pengguna tanpa keanggotaan perusahaan ke `/login?error=no-company` (`src/lib/session.ts:78-79`) — jadi dampaknya terbatas pada pembuatan akun/sesi yatim dan permukaan spam. Rekomendasi S6: nonaktifkan sign-up publik (`disableSignUp`) bila pendaftaran memang hanya lewat manajemen pengguna.

#### SEC-09 — RENDAH — Jejak audit ditulis tetapi tidak dapat dibaca dari UI
109 titik `writeAudit` menulis siapa/melakukan apa (lihat SEC-POS-9), tetapi tidak ada halaman penampil audit log: pencarian `src/app` untuk "audit" hanya menemukan halaman periode (riwayat tutup periode). Untuk kebutuhan §13 (audit logs yang dapat ditinjau pemilik), ini setengah jalan. Rekomendasi S6: halaman audit read-only bergate `settings.manage`/`users.manage` memakai indeks yang sudah ada.

#### SEC-10 — RENDAH — Helper izin penyelesaian retur tidak menerapkan gerbang saklar modul
`requireReturnSettlementPermission` (`src/server/actions/supplier-returns.ts:41-51`) memeriksa izin tetapi tidak memanggil `assertModuleEnabled`, tidak seperti aksi tulis modul lain (`requirePermissionInModule`). Bukan eskalasi — izin uangnya setara — hanya inkonsistensi penegakan saklar modul D-16 untuk tiga aksi penyelesaian.

#### Catatan informasional
- `BETTER_AUTH_SECRET` dibaca tanpa fallback (`auth.ts:11`) — postur benar; kekuatannya tanggung jawab deployment. `baseURL` berfallback ke `http://localhost:3000` (`auth.ts:10`): bila `BETTER_AUTH_URL` lupa diset di produksi, pemeriksaan origin dapat mengunci login (risiko ketersediaan, bukan kerentanan).
- Seed demo memakai sandi terpublikasi `Bisa12345!` untuk `owner@bisa.id` (aturan proyek, `AGENTS.md`) — hanya untuk demo; harus diganti sebelum pemakaian nyata.

### 1.4 Matriks peran × data sensitif (dari `src/lib/permissions.ts:70-146`)

| Data sensitif | owner | admin | manager | cashier | warehouse | accountant | viewer | Bukti |
|---|---|---|---|---|---|---|---|
| Gaji & payroll (baca) | ✔ | ✔ | ✔ | ✘ (tanpa modul) | ✘ | ✔ ⚠ | ✔ ⚠ | Halaman bergate `accounting.view` (SEC-01) |
| Gaji & payroll (kelola) | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | `payroll.manage` hanya di OWNER (semua izin) |
| Kasbon karyawan (baca) | ✔ | ✔ | ✔ | ✘ | ✘ | ✔ ⚠ | ✔ ⚠ | `kasbon/page.tsx:26` |
| Harga beli / HPP (`inventory.cost`) | ✔ | ✔ | ✔ | ✘ | ✔ | ✔ | ✘ | Matriks izin |
| Jurnal & laporan keuangan | ✔ | ✔ | ✔ | ✘ | ✘ | ✔ | ✔ | `accounting.view` |
| Kelola pengguna & peran | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | `users.manage` |
| Pengaturan perusahaan | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | `settings.manage` |
| Impor data | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | `import.manage` |

⚠ = paparan berlebih menurut prinsip kebutuhan-minimum (temuan SEC-01). Peran kustom dapat diberi kombinasi apa pun oleh owner/admin lewat `company_roles` — termasuk `accounting.view` tanpa `payroll.manage`, sehingga paparan SEC-01 juga berlaku untuk peran kustom.

---

## 2. Performa & Data

### 2.1 Query terpanas dan pola pagination (bukti per fungsi/halaman)

| Permukaan | Pola | Bukti |
|---|---|---|
| Valuasi persediaan | Agregasi SQL `GROUP BY` produk + `SUM` atas `stock_on_hand`; **pagination server-side** (≤200/hal); total dihitung SQL atas seluruh set, bukan halaman | `src/server/reports.ts:767-862` |
| Daftar jurnal | Pagination server-side (≤100/hal) + agregat nominal satu batch per halaman (perbaikan AK-P3-04; bukan subquery per baris) | `reports.ts:1432-1499` |
| Buku besar | Pagination + saldo awal via subquery terurut; total rentang selalu utuh | `reports.ts:1624+` (komentar AK-P3-04) |
| Daftar penjualan POS | Pagination server-side (≤100/hal); catatan: `itemCount` masih subquery korelasi per baris hasil (≤100 baris/hal, terindeks `sale_lines_sale_idx`) | `reports.ts:937-995` |
| Neraca saldo / Laba rugi / Neraca / Arus kas | Agregasi SQL atas `journal_lines` join `journal_entries` per periode; tanpa pagination (memang laporan ringkas per akun) | `reports.ts:153,196,315,396` |
| Pencarian produk POS | `limit`/`offset` server (bawaan 20) di kedua cabang pencarian | `src/server/catalog.ts:171-172,201-202` |
| Halaman daftar UI | Komponen `Pagination` dipakai di 16 halaman (produk, pergerakan, penerimaan, jurnal, buku besar, beban, riwayat penjualan, riwayat sesi, retur, dll.) | grep `Pagination` di `src/app` |
| Ringkasan beranda | ±6 query agregat sekuensial terindeks per muat | `reports.ts:78-152` |

### 2.2 Temuan performa

#### PERF-01 — SEDANG — N+1 pada halaman Payroll untuk usulan potongan kasbon
`src/app/app/akuntansi/payroll/page.tsx:47-60`: untuk **setiap** karyawan aktif dengan kasbon, halaman menjalankan dua query berurutan (`getOpenAdvanceTotal` lalu `proposeAdvanceDeductions`) di dalam loop `for`. Waktu muat halaman tumbuh linear dengan jumlah karyawan berkasbon; pada skala ratusan karyawan ini menjadi halaman terberat di akuntansi. Rekomendasi S4: agregasi satu query (saldo kasbon terbuka per karyawan) + hitung usulan di memori.

#### PERF-02 — SEDANG — Ekspor CSV dibangun utuh sebagai string di memori; beberapa ekspor memuat semua baris
`src/lib/csv.ts:1-18`: `toCsv` mengembalikan satu string dan `csvResponse` membungkusnya — tidak ada streaming di rute mana pun. `getInventoryValuation` tanpa `opts` sengaja memuat **seluruh** produk untuk ekspor & dashboard gudang (`reports.ts:772-774,818-822`), dan kueri `lowRows` pendampingnya juga tanpa batas. Ekspor akun/pelanggan/pemasok mengikuti pola daftar-penuh yang sama. Pada dataset mandat §10 (100.000 produk, jutaan baris jurnal) ekspor laporan/jurnal berisiko latensi tinggi dan tekanan memori proses. Rekomendasi S4: streaming CSV (ReadableStream + kursor keyset) untuk ekspor besar dan batas eksplisit untuk jalur muat-semua.

#### PERF-03 — RENDAH (kondisional skala) — Indeks yang terlihat hilang untuk pola query utama
Indeks yang ada kuat (59 indeks di `src/db/schema.ts`; pola jurnal/stok/penjualan utama terindeks). Kandidat yang hilang, dibuktikan dari pola `where/orderBy` di kode:
1. **Pencarian jurnal `ilike '%…%'`** atas `journal_entries.number/description` (`reports.ts:1452`) — tidak ada indeks trigram (produk punya `products_company_name_trgm_idx`, jurnal tidak). EXPLAIN di bawah menunjukkan filter diterapkan di atas bitmap `company_id` saja: pada jutaan entri, pencarian = pindai seluruh entri perusahaan.
2. **`sales` urutan riwayat `created_at desc`** (`reports.ts:987`) — indeks yang ada berbasis `date`, bukan `created_at`; pencarian riwayat juga `ilike` pada `sales.number`/`customers.name` tanpa trigram.
3. **`expenses` tanpa indeks sekunder sama sekali** di skema, padahal `listExpenses` menyaring per perusahaan + rentang tanggal + status dan sudah berpaginasi (`reports.ts:1942`; test `expenses-pagination.test.ts`). Kandidat `(company_id, date)`.
4. **`payroll_items` hanya terindeks `(run_id)`** (`schema.ts:1282`) — rekap per karyawan lintas periode memindai; kandidat `(company_id, employee_id)`.
5. Pool koneksi aplikasi `max: 12` (`src/db/index.ts:14-17`) — parameter yang wajib diukur pada uji konkuren S4 (banyak kasir + laporan bersamaan), bukan vonis.

### 2.3 Bukti EXPLAIN (DB dev `bisa`, PG 18 @5433 — dibaca 2026-11-04)

Konteks dataset: perusahaan demo "Bisa Minimarket" 133 produk; seluruh DB berisi 1.136 produk, 1.237 penjualan, 13.533 `journal_lines`, 3.697 `stock_movements` (termasuk residu perusahaan uji). Metode: `EXPLAIN` (tanpa ANALYZE) atas SQL yang setara bentuknya dengan kueri Drizzle di `reports.ts`, terikat pada perusahaan demo. Biaya = estimasi planner.

| Kueri | Rencana (ringkas) | Kesimpulan |
|---|---|---|
| Inti neraca saldo (agregasi `journal_lines` ⋈ `journal_entries`, 1 bulan, group by akun) | Bitmap Index Scan `journal_lines_company_account_idx` + Hash Join + HashAggregate (cost ≈677) | Terindeks; sisi `journal_entries` memilih Seq Scan (3.286 baris, selektivitas rendah pada skala ini — wajar) |
| Valuasi tergroup (produk ⟕ `stock_on_hand`, limit 50) | Bitmap Heap Scan produk via indeks perusahaan + Hash Right Join + Sort (cost ≈77) | Terindeks; `stock_on_hand` Seq Scan kecil (1.165 baris) |
| Pencarian jurnal `ilike '%gaji%'` | Bitmap Heap Scan via `journal_entries_company_date_idx`, Filter ilike (cost ≈210) | Bukti PERF-03.1: tidak ada indeks untuk pola teks |
| Penjualan per hari (1 bulan) | Bitmap Heap Scan `sales` via indeks perusahaan (cost ≈53) | Terindeks |
| Buku besar per akun | Bitmap Index Scan `journal_lines_company_account_idx` + Index Scan PK entri (cost ≈384) | Terindeks |

**Tidak ada** seq scan pada tabel bisnis besar pada skala demo, dan tidak ada angka latensi yang diklaim dari pengukuran ini. Rencana pengukuran Fase S4 (belum dijalankan): dataset benih `pnpm db:seed:bulk` (10.000 produk) + generator data sintetis menuju 100.000 produk / 1.000.000 detail / 5.000.000 ledger sesuai §10; ukur p50/p95/p99 untuk valuasi, neraca saldo periode setahun, pencarian jurnal, ekspor CSV penuh, dan muat halaman payroll (PERF-01) sebelum–sesudah optimasi; sertakan `EXPLAIN (ANALYZE, BUFFERS)` dan uji konkuren terhadap pool 12 koneksi.

---

## 3. Backup / Restore & Round-trip — keadaan saat ini vs mandat §11

**Yang sudah ada (bukti):**
- `scripts/backup.sh` — `pg_dump --format=custom --no-owner --no-privileges` memakai `DIRECT_URL` ke `./backups/bisa-<stempel>.dump`, dengan fallback menjalankan pg_dump di dalam container Podman (`BISA_PG_CONTAINER`).
- `scripts/restore.sh` — restore dump yang sama, menolak jalan tanpa flag `--yes` eksplisit.
- Keduanya terdokumentasi singkat di `README.md:123-124` sebagai `pnpm db:backup` / `pnpm db:restore`.
- Ekspor tingkat aplikasi (satu arah, CSV, berizin): COA, pelanggan, pemasok, persediaan, buku besar, laporan (6 jenis), jurnal per dokumen (`src/app/api/export/**`).
- Impor tingkat aplikasi: CSV/XLSX master (produk/pemasok/pelanggan) + dokumen saldo awal dengan pemetaan kolom, pratinjau, validasi per baris, deteksi duplikat, dan edit baris (program A-10).

**Celah persis terhadap §11:**
1. **Tidak ada backup otomatis/terjadwal** — tidak ada cron, timer, atau layanan backup di repo; `docker-compose.yml` hanya berisi layanan `db`, `mailpit`, `minio`. Retensi dan rotasi sepenuhnya manual.
2. **Tidak ada enkripsi backup** — dump tersimpan plaintext di `./backups`; tidak ada penandatanganan/checksum yang diverifikasi saat restore.
3. **Tidak ada uji restore berkala terdokumentasi** — skrip restore ada dan pernah dipakai ad hoc, tetapi tidak ada runbook "backup dianggap valid setelah restore berhasil" maupun catatan uji restore terakhir.
4. **Round-trip tingkat aplikasi belum ada untuk data transaksional penuh.** Ekspor bersifat laporan CSV satu arah; impor hanya menerima master + saldo awal. Tidak ada jalur "ekspor seluruh perusahaan → basis data kosong → impor kembali → rekonsiliasi saldo/stok/jurnal/payroll" sebagaimana dituntut §11. Round-trip yang *sudah* terbukti adalah di tingkat basis data (dump → restore), bukan tingkat aplikasi.
5. **Lampiran berkas tidak dikelola aplikasi** — tidak ada penyimpanan lampiran (bukti transaksi, dokumen karyawan); gambar QRIS/logo hidup sebagai data URL di dalam DB sehingga ikut ter-backup otomatis. Layanan `minio` di compose tidak dirujuk oleh kode aplikasi mana pun (grep `minio` di `src/` kosong).
6. **Dokumentasi migrasi antar-environment minim** — selain dua baris README, tidak ada prosedur tertulis memindahkan perusahaan ke server/basis data lain atau keterangan versi skema ekspor.

---

## 4. Offline POS — keadaan sebenarnya (3 bukti)

1. `package.json` tidak memuat Dexie/IndexedDB/pustaka antrean offline; satu-satunya persistensi klien adalah `localStorage` untuk keranjang POS (`src/components/pos/pos-terminal.tsx:89,119`) dan preferensi display (`src/components/pos/pos-display.tsx:39,86`).
2. Tabel `outbox` memang ada di skema (`src/db/schema.ts:1538`, indeks `outbox_pending_idx`) tetapi **nol pemakaian runtime** — grep `outbox` di `src/server`, `src/components`, `src/app` di luar skema tidak menemukan penulis/pembaca.
3. Keputusan tercatat D-10 (`PROGRESS.md:33`): yang dibangun hanya persistensi keranjang agar selamat dari reload/crash; **penjualan offline penuh dengan sinkronisasi TIDAK dibangun**. Terhadap mandat §12 dan kriteria penerimaan §17, statusnya **NOT IMPLEMENTED** (keputusan pemilik yang harus diambil — lihat PROGRESS A-14).

---

## 5. Rekomendasi Prioritas

### Fase S6 (keamanan) — urutan
1. **SEC-01** — Gerbang baca payroll & kasbon dengan izin khusus payroll; tambahkan test matriks peran × data sensitif (termasuk peran kustom). *(Tinggi, dampak langsung ke kerahasiaan gaji.)*
2. **SEC-02** — Putuskan nasib plugin admin/organization: cabut dari server+client bila tidak dipakai, atau kunci perilaku endpoint plugin dengan test (terutama inv
...[truncated 2099 chars]