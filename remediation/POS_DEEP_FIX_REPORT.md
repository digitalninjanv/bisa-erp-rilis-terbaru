# POS Deep Hardening — Implementation Report

Tanggal: 2026-11-21  
Branch: `remediation/erp-audit-2026-11-21`  
Sumber audit: `audit-reports/POS_DEEP_AUDIT_2026-11-21.md`  
Rencana: `remediation/POS_DEEP_FIX_PLAN.md`

## Status

Seluruh temuan audit sudah divalidasi ulang terhadap kode current tree. Semua
temuan yang merupakan **cacat perilaku/kontrol** sudah diperbaiki. Tiga temuan
yang bersifat keputusan desain/lingkup produk ditangani dengan perubahan
perilaku yang aman atau dokumentasi pembatas yang eksplisit:

| Temuan | Status |
|---|---|
| POS-AUD-01 offline discard resurrection | Fixed: tombstone server + status `resolved` + client remove |
| POS-AUD-02 recovery lockup | Fixed: semua error definitif membersihkan attempt; aksi batalkan |
| POS-AUD-03 non-cash confirmation carry-over | Fixed: reset per transaksi |
| POS-AUD-04 stale held-sale linkage | Fixed: reset konteks satu pintu + auto-detach |
| POS-AUD-05 blind cash count | Fixed: two-phase count token, expected tidak dikirim awal, X/riwayat dibatasi |
| POS-AUD-06 reprint permission/audit | Fixed: gate + audit di nota/faktur/device; token cetak pertama |
| POS-AUD-07 cash receivable outside drawer | Fixed untuk konteks POS; accounting tetap jalur treasury |
| POS-AUD-08 credit limit bypass | Fixed: quick-add tanpa kredit, flag unlimited, saldo awal dihitung |
| POS-AUD-09 cash under-tender | Fixed: client gate + banner + label |
| POS-AUD-10 hidden serial after qty decrease | Fixed: trim serial + integer input |
| POS-AUD-11 serial return identity | Fixed: pilih seri aktual + restore exact |
| POS-AUD-12 web offline coverage | Documented limitation + setting/offline page wording |
| POS-AUD-13 cash movement label vs journal | Fixed: dialog menjadi setor/tarik bank; beban diarahkan ke Akuntansi |
| POS-AUD-14 shift-close controls | Fixed: force-close supervisor, branch, offline queue warning |
| POS-AUD-15 negative counted cash | Fixed: domain + token reject negative |
| POS-AUD-16 CSV formula injection | Fixed: shared `toCsv` |
| POS-AUD-17 print/PWA cross-user | Fixed: job user scope + PWA cache per session hash |
| POS-AUD-18 unbounded rows | Fixed: receivables DB pagination, statement filter, session movement cap |
| POS-AUD-19 receivable movement type | Fixed: `receivable` + reporting/labels |
| POS-AUD-20 silent inline scan | Fixed: beep success/error |
| POS-AUD-21 no manual offline sync | Fixed: tombol Sinkronkan |
| POS-AUD-22 history links 404 | Fixed: non-copy detail link + gated reprint |
| POS-AUD-23 no return voucher/exchange | Fixed: voucher cetak + prefill kredit penjualan pengganti |
| POS-AUD-24 held sales lose serials | Fixed: kolom snapshot seri + resume |
| POS-AUD-25 price group persists | Fixed: reset kelompok setelah transaksi |
| POS-AUD-26 rounding all tenders | Verified design: label “semua metode” |
| POS-AUD-27 offline payload exposure | Fixed: payload lengkap hanya untuk `pos.void` |
| POS-AUD-28 POS page sequential reads | Fixed: independent reads parallel |
| POS-AUD-29 minor validation/UX | Fixed: actor filter, try/finally, focus, reprint prop, dead code |

## Perubahan utama

### Checkout & payment

- `src/lib/pos/checkout-recovery.ts`: satu daftar kode error definitif.
- `use-terminal-checkout.ts`: retry definitif membersihkan pending; corrupt
  attempt dibuang; aksi “Batalkan percobaan” dengan konfirmasi; stale held-sale
  dilepas otomatis.
- `src/lib/pos/payment-plan.ts`: rencana pembayaran murni + deteksi tunai kurang
  untuk single/mixed.
- `use-terminal-pay-state.ts`: gate/label Bayar tunggal.
- `use-terminal-reset.ts` + `payment-state.ts`: reset konfirmasi non-tunai.
- `use-new-sale-reset.ts`: reset keranjang, pelanggan, pembayaran, grup, tahanan,
  reservasi dalam satu jalur.

### Offline

- `server/pos/offline-payload.ts`: tombstone resolution + pemetaan payload.
- `offline.ts`: item `discarded`/`done` mengembalikan status `resolved`.
- `lib/pos/pos-offline.ts`: `resolved` menghapus item lokal.
- `use-offline-queue.ts`: hitungan resolved + pesan.
- `offline-review-panel.tsx`: try/finally dan status resolved.
- `listOfflineReviewQueue(..., { includePayload })`: detail hanya supervisor.
- Tombol “Sinkronkan” di terminal.

### Cash session

- `server/pos/session-close-token.ts`: token hitungan 15 menit, expected guard.
- `prepareSessionCloseAction` + `closeSessionAction`: two-phase blind count.
- `session-manager.tsx`: hitungan dikunci, expected baru tampil setelah token;
  peringatan antrean offline; branch selector; tidak ada edit setelah reveal.
- `force-close-session.tsx` + aksi `pos.void`: penutupan supervisor.
- X report sesi terbuka dan detail sesi terbuka dibatasi `pos.void`.
- Riwayat menyembunyikan expected untuk sesi terbuka non-supervisor.
- `countedCash` negatif ditolak.
- Movement `receivable` terpisah dari penjualan.

### Reprint/audit

- `receipt-token.ts`: token cetak pertama 10 menit dari checkout.
- Halaman nota: cetak pertama via token; cetak ulang historis wajib
  `pos.receipt.reprint` + audit; tanpa izin hanya ringkasan non-cetak.
- Faktur A4 wajib reprint + audit.
- Device receipt endpoint wajib reprint + audit.
- Link riwayat memakai detail non-copy; aksi cetak dipisah.

### Receivables/credit

- `payReceivable`/void: konteks POS (`source: "pos"`) mewajibkan sesi laci.
- Piutang POS memakai `listReceivablesPage` + kredit per party halaman.
- Statement memfilter party di query.
- Quick-add customer `creditLimitUnlimited = false`.
- `validateReceivableTerms` + pencarian pelanggan menghitung opening balance.
- Master customer punya checkbox “Limit 0 = tanpa batas kredit”.

### Returns/serial

- Migrasi `0086_aromatic_boomer.sql`:
  - `sale_lines.serial_numbers`
  - `sale_return_lines.serial_numbers`
  - `customers.credit_limit_unlimited`
- Hold/sale/resume menyimpan seri.
- Retur meminta seri aktual, memvalidasi terhadap penjualan asal, dan
  memulihkan seri exact lewat `server/serial-restore.ts`.
- Voucher retur baru: `/app/pos/retur/[id]/cetak`.
- Link “Buat penjualan pengganti” membawa `?credit=` dan terminal menerapkannya.
- Qty serial integer; seri ekor dibuang saat qty turun.

### Security/performance/UX

- CSV sesi memakai `toCsv` (formula neutralization).
- Print job user/terminal scoped.
- PWA shell cache per hash sesi + cookie proxy + clear on logout.
- POS page reads parallel.
- Actor terminal hanya user dengan `pos.sell`.
- Retur voucher, force close, online review try/finally.
- Barcode inline beep.
- Label pembulatan “semua metode”.

## Verifikasi

Dijalankan pada current tree:

| Perintah | Hasil |
|---|---|
| `pnpm test` (unit) | **133 file / 1.190 test PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS** |
| `BISA_TEST_BUILD=1 pnpm build` | **PASS** |
| `pnpm drizzle-kit check` | **PASS** |

Integration/E2E POS belum dijalankan ulang karena shell ini tidak memiliki
`BISA_TEST_DATABASE_URL`/`BISA_TEST_DIRECT_URL` ke database test khusus. Test
integrasi yang diperbarui (rekayasa sesi, RBAC) harus dijalankan di environment
test sebelum rilis.

## Residual / deployment notes

1. **Migration 0086 belum diterapkan** ke database mana pun. Jalankan migrasi
   pada deployment; default `credit_limit_unlimited = true` mempertahankan
   perilaku pelanggan lama (0 = tanpa batas).
2. **Web offline belum setara desktop**: katalog penuh, pencarian pelanggan,
   kredit retur, dan aturan harga kelompok offline tetap terbatas. Ini sekarang
   dinyatakan eksplisit di Pengaturan dan halaman Peninjauan Offline; terminal
   desktop tetap jalur offline penuh.
3. **Blind count** memakai two-phase token dan tidak lagi mengirim expected di
   payload awal. Pemanggil server yang berniat jahat masih dapat memanggil
   preview berulang; kontrol organisasi tetap memerlukan supervisor untuk
   koreksi/force-close.
4. **`source: "pos"`** pada pembayaran piutang adalah penanda konteks dari
   halaman POS. Jalur akuntansi memakai `source: "accounting"` (treasury),
   sehingga penerimaan tunai non-POS tidak dipaksa ke sesi laci.
5. **Print job lama tanpa `userId`** tidak akan diklaim oleh terminal baru;
   bersihkan job lama saat deployment bila ada.
6. **Exchange** diimplementasikan sebagai retur kredit + voucher + prefill
   penjualan pengganti, bukan satu dokumen exchange gabungan.
7. **No browser E2E/Tauri test** dijalankan. Jalankan smoke Playwright untuk
   recovery dialog, blind count, hold clear, serial return, dan reprint.
