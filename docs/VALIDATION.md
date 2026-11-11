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
| Full suite di DB uji | **2254/2254 lulus (240 file)** pada putaran audit. Putaran cetak: **2252/2254**; 2 tes balapan (payroll & idempotensi POS) gagal saat beban tinggi, lalu **29/29 lulus** saat dijalankan terisolasi. |

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
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" pnpm test
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
