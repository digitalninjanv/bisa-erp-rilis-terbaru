# VALIDATION

## Perintah yang dijalankan

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm exec vitest run <subset>
pnpm test   # database uji terpisah
```

## Hasil putaran ini

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm exec tsc --noEmit` | **Lulus** |
| `pnpm lint` | **Lulus, 0 error** (warning hanya pada file non-perubahan) |
| `pnpm build` | **Lulus** |
| Tes akuntansi/retur/void/PPN | **Lulus** (lihat file test baru) |
| Tes impor/ekspor XLSX | **Lulus** (6 integration + 2 unit) |
| Tes RBAC/user management | **Lulus** |
| Arsitektur file size/module boundaries/table writers | **Lulus** |
| Restore backup ke DB kosong | **Lulus** — 1379 akun, 1137 produk, 873 sales, 4314 jurnal |
| Full suite di DB uji | **2444/2444 lulus (276 file)** pada putaran 2026-11-15; E2E production build **57/57 lulus**. Coverage terakhir lines 92,37% / branches 79,35%. |

## Tes regresi baru

- `tests/integration/accounting-integrity.test.ts` — kontrak tipe pemetaan, section impor, closing P&L.
- `tests/integration/sales-report-netting.test.ts` — retur penjualan & PPN inklusif.
- `tests/integration/receipt-void-avco.test.ts` — void penerimaan diskon & AVCO vs GL.
- `tests/integration/import-export-excel.test.ts` — template/ekspor XLSX, impor kategori/satuan/pemetaan.
- `tests/unit/xlsx.test.ts` — kode teks, angka number, formula tidak dieksekusi.
- `tests/integration/pos-guards.test.ts` — pembulatan tidak boleh nol.
- `tests/unit/env.test.ts` — HTTPS produksi + flag insecure.

## Cara menjalankan ulang

```bash
# 1. Siapkan DB uji terpisah (jangan DB produksi)
podman exec bisa-erp-db createdb -U erp bisa_erp_test
set -a; . ./.env.local; set +a
TEST_DATABASE_URL="${DATABASE_URL/\/bisa_erp/\/bisa_erp_test}"
TEST_DIRECT_URL="${DIRECT_URL/\/bisa_erp/\/bisa_erp_test}"
DIRECT_URL="$TEST_DIRECT_URL" DATABASE_URL="$TEST_DATABASE_URL" pnpm exec drizzle-kit migrate
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" pnpm db:seed --force

# 2. Suite
BISA_TEST_DATABASE_URL="$TEST_DATABASE_URL" \
BISA_TEST_DIRECT_URL="$TEST_DIRECT_URL" \
pnpm test
```

Konfigurasi Vitest menolak suite integrasi/simulasi bila URL database test
tidak diberikan eksplisit, nama DB tidak mengandung segmen `test`, atau host
bukan loopback. CI dengan service PostgreSQL terisolasi di jaringan container
harus mengatur `BISA_ALLOW_REMOTE_TEST_DATABASE=1`. Suite `tests/unit` saja
dapat dijalankan tanpa URL DB test:

```bash
pnpm exec vitest run tests/unit
```

## Bukti angka

- XLSX produk: 504 baris; SKU `100003` tetap string; harga numeric.
- XLSX akun: 189 baris.
- Template produk: sheet `Data`, `Petunjuk`, `Kategori`, `Satuan`, `Pemasok`.
- Restore DB: lihat `docs/BACKUP.md`.

## Verifikasi akses LAN

- Login dan POS via `http://192.168.18.253:3000` berhasil.
- Tidak ada error `crypto.randomUUID is not a function`; halaman POS menampilkan “Kasir”.

## Verifikasi cetak otomatis

- **Akar masalah**: ref penjaga `autoStarted` di `ReceiptPrint` membuat
  auto-print gagal di React Strict Mode (`next dev`). Efek dijalankan
  dua kali; run pertama dibatalkan cleanup, run kedua diblokir ref.
- **Perbaikan**: ref dihapus; cleanup membatalkan timer run pertama.
  Auto-print menunggu `document.fonts.ready` + 650 ms, memanggil
  `window.print()`, lalu `afterprint` mengarahkan kembali ke `/app/pos`.
- **Playwright** (Chrome headless, `window.print` direkam) pada nota
  asli: **1 panggilan cetak**, URL akhir `/app/pos`, tanpa page error.
- **Cetak ulang** `?salinan=1&autoprint=1`: **1 panggilan cetak** dan
  kembali ke `/app/pos`.
- **Launcher** `deploy/print/bisa-pos-print.sh` diuji dengan
  `BISA_BROWSER=/bin/echo`; URL default benar: `/app/pos`.
- **Pengaturan → Cetak**: petunjuk “Cetak otomatis tanpa dialog”
  tampil, tanpa error console.
- **Batas browser**: cetak tanpa dialog hanya mungkin dengan
  Chrome/Edge `--kiosk-printing` dan printer thermal sebagai default
  OS. Browser biasa selalu membuka dialog dan tidak bisa memilih
  printer sendiri.

## Optimasi memori dev Turbopack

- **Gejala**: `next dev` langsung memakan RAM besar dan bisa crash (swap penuh). Akar: cache Turbopack dev membengkak (`.next/dev` ~3.7GB) dan `turbopackServerFastRefresh` menyebabkan pertumbuhan RAM tak terbatas pada sesi panjang.
- **Perbaikan**:
  - `experimental.turbopackGc: true`
  - `experimental.turbopackMemoryEviction: "full"`
  - `experimental.turbopackServerFastRefresh: false`
  - `turbopack.root = process.cwd()`
  - Bersihkan `.next/dev` dan `.next-remediation`.
- **Fallback**: `pnpm dev:webpack` (hindari Turbopack) atau `pnpm dev:clean`.
- **Catatan**: kebocoran per-render (~3.9MB/render) pada dev runtime belum diperbaiki oleh config (#97555). Untuk sesi panjang, restart dev server berkala atau gunakan `pnpm build && pnpm start` untuk pengujian berat.

## Audit Gudang → Akuntansi (2026-11-15)

Database disposable: `bisa_erp_audit_test` dan `bisa_erp_audit_full_test`
(seed baru; database pengguna tidak disentuh).

### Perbaikan yang diuji

| Perubahan | Test | Hasil |
| --- | --- | --- |
| Pencarian Nilai Persediaan server-side (`q` sebelum paginasi + ekspor) | `stock-card-valuation.test.ts` | Lulus (test baru) |
| Gerbang modul purchasing/PR/reservasi | `purchase-order`, `purchase-requests`, `reservations-transfers`, `gdg3-audit-probe`, `feature-matrix-gudang`, `review-fixes-t2` | 79 lulus |
| Void penyesuaian/opname/karantina memulihkan seri | `fix-gdg-tahap2.test.ts` (GDG1-03b) | 2 lulus |
| Tanggal void penjualan/payroll/transfer bank | `sale-flow`, `payments-void-p2` | 14 lulus |
| Batas modul arsitektur (barrel catalog/supplier-returns) | `architecture-module-boundaries.test.ts` | Lulus |

### Suite penuh

`bisa_erp_analisafull_test` (fresh migrate + seed): **2444 lulus, 0 gagal,
6 skipped (276 file)** — `EXIT:0`.

Payroll/HR dipulihkan pada putaran ini: engine statutory (TER/PPh 21,
BPJS, THR/lembur, cuti tidak berbayar, kasbon, pinjaman, final pay)
kembali terpasang di `runPayrollAction` dan `final-pay.ts`. Sebelumnya
21 test payroll gagal; sesudah perbaikan seluruh 41 test payroll lulus.

Tiga berkas >800 baris juga dipecah (`receipt-form`,
`supplier-return-form`, `supplier-returns/posting`), sehingga ratchet
arsitektur lulus.

### Tahap 7 — coverage & E2E role/modul

- `pnpm exec vitest run --coverage` pada modul inti akuntansi/stok/pos:
  **lines 87.04%**, **statements 83.81%**, **functions 86.28%**,
  **branches 79,35%** setelah penambahan test cabang (naik dari 72,39%);
  ambang 80% tinggal 26 cabang lagi.
- Test baru `tests/integration/vat-report.test.ts` menutup laporan PPN yang
  sebelumnya 0% (PPN keluaran/masukan/neto + kasus pemetaan kosong).
- E2E `e2e/role-module-matrix.spec.ts` — 5 test: viewer tanpa HPP, kasir
  ditolak dari gudang/akuntansi, role HR tanpa `payroll.view`, modul gudang
  dimatikan, dan kontrol positif owner.
- E2E total **44/44 lulus**.

### Tahap 8 — impor massal master

- Entitas baru: `branches`, `warehouses`, `payment_methods`,
  `customer_groups`, `employees`, `fixed_assets`.
- Template CSV/XLSX + sheet referensi (cabang, akun, kategori aset,
  karyawan); petunjuk kolom per entitas.
- Commit idempoten: kode kosong otomatis (BRN/GD/PM/EMP), duplikat
  kode/nama/NIK dilewati, baris error menyimpan pesan di `import_rows`.
- Aset tetap memakai `registerFixedAsset` (jurnal perolehan + validasi
  akun/umur manfaat) dan kunci idempoten nama+tanggal+harga.
- Test integrasi `tests/integration/import-export-excel.test.ts` —
  **11 lulus**, termasuk cabang→gudang, akun metode bayar, kelompok harga,
  karyawan, dan jurnal aset tetap.
- E2E `e2e/import-master-tabs.spec.ts` — tab master tampil dan template
  CSV tiap entitas dapat diunduh; total E2E **40/40**.

### SEC-012/013 — rate limit terpusat, trusted proxy, CSP nonce

- Migrasi `0083` menambah tabel `rate_limit`; Better Auth memakai
  `storage: "database"` sehingga batas login berlaku lintas instance.
  Bukti: 3 percobaan login menghasilkan baris `127.0.0.1|/sign-in/email`
  dengan `count=3`; test `auth-hardening` memverifikasi baris tersebut.
- `BISA_TRUSTED_PROXIES` (IP/CIDR) membatasi hop `X-Forwarded-For` yang
  dipercaya; tanpa daftar, rantai multi-hop tidak ditebak. Implementasi
  `src/lib/client-ip.ts` dipakai throttle pairing POS.
- `src/proxy.ts` membuat nonce per request; `script-src` memakai
  `'nonce-...' 'strict-dynamic'` tanpa `'unsafe-inline'`.
  `style-src` tetap `'unsafe-inline'` (nonce+unsafe-inline saling
  meniadakan menurut CSP3 dan memblokir lebar kolom laporan).
- E2E `e2e/security-headers.spec.ts` memverifikasi header dan nonce
  terpasang pada skrip; E2E laporan komparatif kembali sejajar.

### Tahap 9 — restore drill & installer HTTPS

- Restore `backups/bisa-pre-migration-invoice-20261115-122313.dump` ke
  `bisa_erp_restore_drill` (kosong) berhasil: 1.708 akun, 1.887 produk,
  5 penjualan, 34 jurnal; `sum(debit)-sum(credit)=0` pada jurnal posted.
- Migrasi ke head (83 migrasi, termasuk `0083`) berhasil; kolom
  `supplier_invoice_date`/`due_date` dan tabel `rate_limit` ada.
- Server production build dijalankan terhadap DB hasil restore:
  `GET /login` → **200**, `/app` → **307**, CSP nonce terkirim.
- Migrasi `0083` diterapkan ke DB pengguna `bisa_erp` (aditif, hanya
  membuat tabel `rate_limit`) dengan baseline backup terenkripsi
  `backups/bisa-20261115-070332-98091.dump.enc` dan dump pra-migrasi
  `bisa-pre-migration-invoice-20261115-122313.dump`; smoke
  `GET /login` pada DB pengguna → **200**.
- `deploy/install.sh` default HTTPS: nginx + TLS (self-signed bila
  sertifikat tidak diberikan), `BETTER_AUTH_URL=https://...`,
  `BISA_TRUSTED_PROXIES=127.0.0.1`, HTTP→HTTPS redirect, HSTS.
  `bash -n` lulus; konfigurasi nginx setara diuji `nginx -t` → sukses.
  Instalasi penuh di mesin bersih belum dijalankan pada sesi ini
  (membutuhkan root/systemd/apt) — dicatat sebagai langkah staging.

### SEC-008 — hardening upload impor

- Streaming body dibatasi 20MB sebelum `formData()` selesai membaca.
- Magic bytes: ZIP/XLSX, OLE/XLS, teks/CSV; ekstensi yang tidak cocok ditolak.
- ZIP: maksimum 2.000 entri, 128MB terdekompresi, rasio 100x.
- `tests/unit/import-file-validation.test.ts` — 5 test lulus (CSV valid/NUL,
  XLSX asli/palsu, entri berlebih, rasio ekstrem, streaming oversize).
- `tests/sim2/import-parse-route.test.ts` — file rusak tetap 400.

### SEC-006 — mapper error export

- `src/lib/api-error.ts` memetakan `AppError`/`ZodError` ke status HTTP tepat;
  seluruh 16 route export memakai `withApiError`.
- `tests/unit/api-error.test.ts` — 4 test lulus (status, Zod issue, redaksi
  error internal, wrapper sukses/denied).
- Test payroll-access, fresh-session, dan audit-a2 diperbarui: route kini
  mengembalikan `403` JSON, bukan melempar error boundary.

### Faktur pemasok

- Migrasi `0082` menambah `stock_receipts.supplier_invoice_date` dan `due_date`.
- `goods-receipt.test.ts` memverifikasi `createReceipt` menyimpan tanggal faktur
  & jatuh tempo, dan `recordReceiptInvoiceNumber` dapat mengoreksinya.
- `fix-p1-workflow.test.ts` memverifikasi aging `listPayables` dan
  `listPayablesPage` memakai jatuh tempo eksplisit (mengalahkan termin).
- Migrasi diterapkan ke DB pengguna setelah backup
  `backups/bisa-pre-migration-invoice-20261115-122313.dump`.

### Catatan

- `pnpm typecheck`, `pnpm lint`, dan `pnpm build` lulus.
- Suite penuh dan E2E tidak dijalankan pada database pengguna.
- E2E production build: **44/44 lulus** (auth, POS keyboard, POS offline,
  PWA/service worker, gudang, akuntansi, pengaturan, laporan, aksesibilitas,
  penjaga tabel/form, dan kerapian UI).
