# SIM-2 Fase S6 — Keamanan & RBAC

**Tanggal:** 2026-11-04 · **Sumber temuan:** `docs/sim2/S0-D-KEAMANAN-PERFORMA.md` (SEC-01…SEC-10).
**Gerbang akhir:** `pnpm test` **796/796 lulus (84 berkas)** · `pnpm typecheck` lulus · `pnpm build` lulus · `pnpm lint` 0 error (1 warning warisan S5 di `tests/sim2/s5-roundtrip.test.ts`, bukan dari fase ini).
**Test baru fase ini: 91** — `tests/sim2/payroll-access.test.ts` (34), `tests/sim2/rbac-matrix.test.ts` (29), `tests/sim2/qris-validation.test.ts` (5), `tests/sim2/auth-hardening.test.ts` (6), `tests/sim2/import-parse-route.test.ts` (6), `tests/sim2/return-settlement-gate.test.ts` (6), `tests/unit/csv.test.ts` (5).
**Tidak ada commit** (menunggu pemeriksaan Pemimpin).

---

## 1. Status tiap temuan S0-D

| ID | Tingkat | Status | Bukti |
|---|---|---|---|
| SEC-01 | TINGGI | **TERTUTUP** | Izin baca baru `payroll.view`; 6 permukaan digerbang ulang; 34 test permusuhan |
| SEC-02 | SEDANG | **TERTUTUP** | Plugin `admin()` & `organization()` dicabut server+klien; endpoint 404; login/sesi terbukti hidup |
| SEC-03 | SEDANG | **TERTUTUP (dokumentasi)** | Peringatan di `docker-compose.yml`, `docker/init.sql`, README "Catatan deploy" — nilai dev tidak diubah sesuai mandat |
| SEC-04 | SEDANG | **SEBAGIAN** | `rateLimit` kini eksplisit & aktif di semua lingkungan + aturan khusus sign-in (10/60 dtk/IP). Sisa: penyimpanan in-memory per instance; tanpa CAPTCHA/penguncian akun — lihat §4 |
| SEC-05 | SEDANG | **TERTUTUP** | `xlsx` 0.18.5 (npm) → **0.20.3 dari CDN resmi SheetJS**; CVE-2023-30533 & CVE-2024-22363 tertambal; test rute parse + berkas bermusuhan |
| SEC-06 | RENDAH | **TERTUTUP** | Satu `qrisImageSchema` bersama di `src/lib/qris-image.ts` (raster PNG/JPEG/WebP, ≤900.000) untuk kedua jalur tulis; 5 test |
| SEC-07 | RENDAH | **TERTUTUP** | `toCsv` menetralkan awalan `= + - @` (termasuk sesudah spasi/tab); angka murni tidak diubah; 5 test unit |
| SEC-08 | RENDAH | **TERTUTUP** | `disableSignUp: true`; POST sign-up ditolak & tidak membuat akun (terbukti di handler sungguhan) |
| SEC-09 | RENDAH | **TERBUKA (diterima sadar)** | Halaman penampil audit log belum dibangun — di luar lingkup batch S6; audit tetap ditulis di 100+ titik. Kandidat fase lanjutan, bukan lubang keamanan |
| SEC-10 | RENDAH | **TERTUTUP** | Helper penyelesaian retur kini menghormati saklar modul per jalur izin; 6 test |

Temuan positif S0-D (SEC-POS-1…9) **terverifikasi ulang tetap berlaku** — lihat §3.

---

## 2. Batch 1 — SEC-01: data gaji hanya untuk pemegang izin payroll

**Perubahan izin** (`src/lib/permissions.ts`):
- Izin baru **`payroll.view`** — "Akuntansi: lihat data gaji & kasbon", anggota modul akuntansi.
- Peran bawaan: owner & admin (semua izin), **manager kini memegang `payroll.view`** (sebelumnya membaca lewat `accounting.view`). **Accountant & viewer TIDAK** — inilah paparan yang ditutup. Cashier & warehouse tidak berubah (memang tidak punya akses).
- Aksi tulis tidak berubah: tetap `payroll.manage` (owner/admin) — manager membaca data gaji tetapi tidak bisa memproses payroll, konsisten dengan matriks lama.

**Permukaan yang digerbang ulang** dari `accounting.view` → `payroll.view`:
1. `src/app/app/akuntansi/payroll/page.tsx` (daftar karyawan + gaji pokok/tunjangan/potongan per orang + agregat bruto/bersih)
2. `src/app/app/akuntansi/payroll/[id]/page.tsx` (detail run, net per karyawan)
3. `src/app/app/akuntansi/payroll/[id]/cetak/page.tsx` (slip gaji cetak)
4. `src/app/app/akuntansi/kasbon/page.tsx` (saldo kasbon semua karyawan)
5. `src/app/app/akuntansi/kasbon/[employeeId]/page.tsx` (riwayat kasbon per karyawan)
6. `src/app/api/export/payroll/route.ts` (ekspor CSV rekap setoran S2)
- Menu navigasi Payroll & Kasbon (`src/lib/modules.ts`) digerbang `payroll.view` juga; panel Input Cepat sudah memakai `payroll.manage` untuk pintasan "Proses Payroll" sejak A-8 — tidak berubah.
- Permukaan baca gaji lain tidak ada: pemindaian `baseSalary` di seluruh `src/app` + `src/components` hanya menemukan kelima halaman di atas dan panel payroll yang dirender darinya.

**Test permusuhan** (`tests/sim2/payroll-access.test.ts`, mock sesi dinamis yang menegakkan izin ASLI — bukan mock owner statis suite lama): sebagai cashier, warehouse, accountant, viewer → keenam permukaan menolak `FORBIDDEN`; peran kustom bergaya akuntan (`accounting.*` tanpa `payroll.view`) → ditolak; sebagai owner, admin, manager → semua halaman terbuka dan ekspor CSV berisi data karyawan; peran kustom dengan `payroll.view` eksplisit → terbuka.

**Dampak ke test lama:** tidak ada test lama yang membaca halaman payroll/kasbon sebagai peran non-payroll (suite lama memanggil aksi/domain dengan mock owner) — tidak ada test yang perlu diubah. 70 test suite payroll/kasbon/pengguna terkait dijalankan ulang: hijau.

Catatan desain: peran kustom yang hanya diberi `payroll.manage` tanpa `payroll.view` tetap bisa memanggil aksi tulis payroll secara langsung tetapi tidak membuka halamannya — konsisten dengan pola pasangan view/manage lain di repo (mis. `inventory.view`/`inventory.manage` pada warehouse diberikan berpasangan). Admin peran sebaiknya memberi keduanya.

---

## 3. Batch 2 — Matriks RBAC teruji (§13) + Batch 4 — Verifikasi ulang permukaan

### Matriks hasil uji (`tests/sim2/rbac-matrix.test.ts`)

Setiap sel ditegaskan dengan memanggil **aksi server sungguhan** sebagai peran itu: ✓ = lolos gerbang (untuk aksi murah dibuktikan berhasil penuh — produk tercipta/terhapus, harga bulk berubah tepat +10%, pihak tergabung, jurnal terposting, periode tertutup, sesi kasir buka-tutup; sisanya dibuktikan bukan `FORBIDDEN`), ✗ = `FORBIDDEN` dan data terbukti tidak berubah.

| Aksi (izin) | owner | admin | manager | cashier | warehouse | accountant | viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| POS checkout (`pos.sell`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| POS void penjualan (`pos.void`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| POS retur penjualan (`pos.return`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| POS sesi kas (`pos.session`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Ubah & hapus produk (`inventory.manage`) | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Bulk edit produk (`inventory.manage`) | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Merge pihak (`inventory.manage`) | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Jurnal manual (`accounting.post`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Tutup periode (`accounting.manage`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Run payroll (`payroll.manage`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Kasbon karyawan (`payroll.manage`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Kelola pengguna (`users.manage`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Ubah pengaturan (`settings.manage`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Impor commit (`import.manage`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Baca data gaji (BARU, `payroll.view`)** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

**Hasil: nol ketidakcocokan (tidak ada temuan SEC6-xx baru).** Setiap gerbang aksi cocok dengan matriks yang dijanjikan `permissions.ts`; meta-test di berkas yang sama mencocokkan tabel ekspektasi tangan ke `permissions.ts` sehingga perubahan matriks di masa depan memaksa peninjauan berkas ini. Diskriminator penting yang terbukti: kasir bisa menjual tetapi tidak bisa void; manager bisa posting jurnal tetapi tidak bisa menutup periode; akuntan bisa menutup periode tetapi tidak menyentuh payroll & kasbon.

### Verifikasi ulang permukaan (Batch 4) atas kode terbaru termasuk S2/S3/S5

- **Aksi server:** pemindaian ulang seluruh ekspor di 15 berkas `src/server/actions/*.ts` (140+ fungsi): **nol aksi tanpa gerbang** (`requirePermission`/`requirePermissionInModule`/helper izin ganda retur/`requireAuth`+validasi keanggotaan untuk `switchCompanyAction` — pengecualian yang sama seperti S0-D dan tetap aman).
- **Rute API:** 12 `route.ts` — semua bergerbang kecuali handler auth itu sendiri. Termasuk rute baru: ekspor payroll (kini `payroll.view`), ekspor produk S3, template impor.
- **Halaman:** setiap `page.tsx` di bawah `src/app/app` memanggil gerbangnya sendiri; layout modul menambah `requireModuleAccess` dan layout akar `requireAuth`.
- **Injeksi/XSS:** tetap nol `sql.raw`; satu-satunya `dangerouslySetInnerHTML` tetap CSS tema chart shadcn (bukan data pengguna) — sama seperti S0-D.
- **Temuan baru dari pemindaian:** tidak ada. Satu-satunya perbaikan perilaku yang lahir dari batch ini adalah SEC-10 (§1).

---

## 4. Batch 3 — Penutupan temuan lain & sisa risiko yang diterima sadar

- **SEC-02 (plugin dorman):** terbukti dari pemindaian seluruh `src/` bahwa satu-satunya pemakaian auth adalah `signIn.email`, `signOut`, dan `auth.api.getSession`; perusahaan/keanggotaan dikelola lewat Drizzle langsung (seed & aksi menulis tabel `organization`/`member` sendiri), dan kolom plugin di tabel sesi (`activeOrganizationId`, `impersonatedBy`) nullable. Plugin `admin()` + `organization()` dicabut dari `src/lib/auth.ts` dan kliennya dari `src/lib/auth-client.ts`. Bukti tidak merusak: test handler sungguhan — endpoint plugin kini 404, sign-in benar → 200 + sesi terbaca, sandi salah → 401. Plugin `twoFactor()` **sengaja dipertahankan** (di luar mandat batch ini; permukaannya dorman serupa — kandidat keputusan terpisah: cabut, atau sekalian bangun UI 2FA-nya).
- **SEC-03 (kredensial docker):** nilai dev **tidak diubah** (agar setup dev yang ada tidak patah). Ditambahkan: blok peringatan di kepala `docker-compose.yml`, komentar di `docker/init.sql`, dan bagian "Catatan deploy (WAJIB dibaca sebelum produksi)" di README (ganti semua sandi, `BETTER_AUTH_SECRET`, sandi akun demo).
- **SEC-04 (sisa):** rate limit kini eksplisit, tetapi penyimpanannya in-memory per instance: batas hilang saat restart dan tidak terbagi antar-replika. Untuk deployment multi-instance, requirement lanjutan: aktifkan storage database Better Auth (perlu tabel rate limit) atau taruh limiter di reverse proxy; CAPTCHA/2FA tetap keputusan produk (plugin twoFactor tersedia tetapi tanpa UI).
- **SEC-05 (xlsx):** migrasi ternyata kecil & aman karena SheetJS menerbitkan perbaikan lewat CDN resminya dengan API identik: `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — nol perubahan kode. Konsekuensi yang disadari: `package.json`/`pnpm-lock.yaml` kini menunjuk tarball CDN vendor, jadi `pnpm install` saat deploy membutuhkan akses ke `cdn.sheetjs.com` (integrity hash terkunci di lockfile). Bila suatu saat akses itu tidak diinginkan, alternatifnya adalah mengganti parser ke pustaka npm lain — effort sedang (API & semantik sel berbeda) dan tidak dilakukan sekarang. Rute parse teruji: berkas sah (XLSX & CSV), berkas rusak → 400 anggun, data `__proto__` tidak mencemari `Object.prototype`, tanpa `import.manage` → 403. Mitigasi lama tetap berlaku (gate izin, ≤20MB, ≤25.000 baris).
- **SEC-08:** akun kini hanya lahir dari manajemen pengguna oleh owner/admin; alur buat-akun admin tidak pernah memakai endpoint sign-up (ia menulis baris langsung dengan `hashPassword`), terbukti oleh suite user-management yang tetap hijau dan test handler di fase ini.

### Sisa risiko yang diterima dengan sadar (ringkasan)

1. SEC-09 — audit log belum punya penampil UI (bukan lubang; data tercatat lengkap).
2. SEC-04 sisa — rate limit in-memory per instance; tanpa CAPTCHA & penguncian akun.
3. Plugin `twoFactor` masih terpasang tanpa UI (permukaan dorman, jauh lebih sempit dari admin/organization karena tidak memberi kuasa lintas-tenant).
4. Ketergantungan install pada CDN SheetJS untuk paket `xlsx` (integrity terkunci).
5. Kredensial dev tetap terpublikasi di repo secara desain (untuk lokal) — mitigasinya dokumentasi deploy yang tegas, bukan penghapusan.

---

## 5. Berkas yang berubah

**Kode:** `src/lib/permissions.ts` (izin `payroll.view` + manager), `src/lib/modules.ts` (gerbang menu), 5 halaman payroll/kasbon + `src/app/api/export/payroll/route.ts` (gerbang baca), `src/lib/auth.ts` (plugin dicabut, `disableSignUp`, rate limit eksplisit), `src/lib/auth-client.ts`, `src/lib/csv.ts` (SEC-07), `src/lib/qris-image.ts` (validator QRIS bersama, baru) + `src/server/actions/settings.ts` (memakainya di kedua jalur), `src/server/actions/supplier-returns.ts` (SEC-10), `package.json` + `pnpm-lock.yaml` (xlsx 0.20.3).

**Catatan insiden build (transparansi):** verifikasi build pertama fase ini sempat terbaca "lulus" karena exit code tertutup pipa (`| tail`) — build sebenarnya GAGAL: skema QRIS semula diekspor dari berkas aksi `"use server"`, dan Next.js melarang ekspor non-async dari berkas Server Actions. Perbaikan: skema dipindah ke `src/lib/qris-image.ts` (berkas aksi hanya mengimpornya). Sesudah perbaikan, seluruh gerbang dijalankan ulang tanpa pipa penutup exit code: build exit 0, typecheck lulus, suite penuh 796/796 exit 0.
**Dokumentasi:** `README.md`, `docker-compose.yml`, `docker/init.sql` (peringatan SEC-03).
**Test baru:** 7 berkas, 91 test (dirinci di kepala laporan).
