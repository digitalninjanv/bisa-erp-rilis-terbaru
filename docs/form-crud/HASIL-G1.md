# HASIL G1 — Dialog Satu Pintu + Komponen Pusat Visual

Program Perbaikan Gabungan (persetujuan pemilik 2026-11-08), Tahap G1.
Sumber temuan: `docs/form-crud/AUDIT-FORM-CRUD-TABEL.md` (FRM-01, FRM-02,
FRM-04) + `docs/validasi-uiux-4/AUDIT-UIUX-4.md` (UX4-02 bagian pusat,
UX4-08). Aturan tahap: bisnis & angka TIDAK berubah — ini pemusatan pola
UI. Status: **SELESAI, semua gerbang hijau** (angka di §6). Belum
di-commit; menunggu pemeriksaan Pemimpin.

## 1. FRM-02 — window.prompt / window.confirm: NOL tersisa

27 titik pemanggilan dimigrasi ke `ConfirmDialog` bersama (prop `reason`
untuk pengumpulan alasan — pola yang sama dengan migrasi gudang
`void-buttons.tsx`/`approval-buttons.tsx`). Tidak ada komponen dialog
alasan baru: prop `reason` ConfirmDialog yang sudah ada terbukti cukup
untuk semua titik, termasuk alur dua langkah.

**Prompt → dialog alasan (16 titik):**

| Berkas | Titik |
|---|---|
| akuntansi/bank-transfer-form.tsx | void transfer |
| akuntansi/expense-form.tsx | void beban |
| akuntansi/payroll-panel.tsx | void run payroll |
| akuntansi/payment-form.tsx | write-off sisa (alasan) + void pembayaran pihak |
| akuntansi/advance-panel.tsx | void kasbon |
| akuntansi/loan-panel.tsx | void pinjaman |
| akuntansi/opening-balance-form.tsx | void saldo awal |
| akuntansi/fixed-asset-panel.tsx | void larian penyusutan (alasan OPSIONAL, minLength 0 — semantik lama dipertahankan) |
| akuntansi/period-manager.tsx | buka kembali periode terkunci (alasan wajib ≥3) |
| akuntansi/reimbursement-panel.tsx | sahkan klaim DUA langkah: nominal disahkan (divalidasi > 0, dialog tetap terbuka bila gagal) → catatan opsional; tolak: alasan wajib ≥3 |
| akuntansi/hr/overtime.tsx, hr/leave.tsx | catatan keputusan (opsional dua arah — semantik lama `note \|\| undefined` dipertahankan) |
| pos/offline-review-panel.tsx | catatan penyelesaian / alasan membuang antrean (opsional) |

**Confirm → ConfirmDialog (11 titik):** pengaturan/user-access.tsx ×2
(cabut akses, hapus peran), pengaturan/forms/gudang-cabang.tsx (hapus
gudang), pengaturan/forms/metode-pembayaran.tsx (hapus metode),
pengaturan/group-pricing.tsx ×2 (hapus kelompok, kosongkan aturan),
akuntansi/coa-migration-panel.tsx (eksekusi migrasi — sesudah centang
pernyataan paham), akuntansi/journal-entry-form.tsx (terapkan pola di
atas baris terisi), pos/held-actions.tsx (hapus pesanan ditahan),
pos/offline-review-panel.tsx (posting penyelesaian @ harga struk),
pos/terminal-admin-panel.tsx (cabut terminal).

Keputusan per kasus: titik POS di atas adalah komponen panel web
standar (bukan permukaan terminal offline), jadi tidak ada pengecualian
"POS offline kritis" yang dipertahankan — semuanya bermigrasi.

**Bukti:** `grep -rn "window.prompt\s*(\|window.confirm\s*(" src/` = 0
pemanggilan; sisa penyebutan hanya di komentar dokumentasi. Penjaga
permanen: §5.

## 2. FRM-01 — Modal bersama satu-satunya overlay form

19 situs overlay `fixed inset-0` racikan di 18 berkas non-POS
dimigrasi ke Modal bersama:

- **Akuntansi (11 situs):** account-form, advance-panel, loan-panel,
  fixed-asset-panel ×2 (kategori + registrasi aset), payroll-panel
  (form karyawan), reimbursement-panel (klaim baru), journal-reverse,
  opening-balance-form, payroll-payment-form, payment-form.
- **Gudang (6 situs):** party-merge-panel, product-form,
  purchase-request-panel, reservation-panel, taxonomy-manager,
  product-bulk-table.
- **Pengaturan (2 situs):** group-pricing (form kelompok);
  user-access — `Modal` LOKAL yang menduplikasi kontrak bersama
  dihapus; 3 pemanggilnya (Pengguna baru, Reset kata sandi, Peran —
  termasuk varian lebar) kini memakai Modal bersama.

Modal bersama diperkuat & diperluas secara terukur:

- **Escape + klik latar** menutup (nonaktif saat `busy`) — menyamai
  ConfirmDialog; sebelumnya Modal bersama tidak menangani Escape.
  Ditambah `role="dialog"`/`aria-modal`/`aria-label`.
- **Lapisan distandarkan:** Modal z-[80], ConfirmDialog z-[90] selalu
  di atasnya (konfirmasi bisa dibuka dari dalam modal) — didokumentasikan
  di kepala kedua berkas.
- Prop opsional baru (bawaan = perilaku lama persis): `wide`
  (max-w-2xl), `submitLabel`/`busyLabel` (label aksi posting seperti
  "Posting kasbon", "Buat pembalik", "Simpan pembayaran" dipertahankan,
  bukan dipaksa menjadi "Simpan"), `submitDisabled` (gerbang di luar
  busy, mis. pratinjau party-merge), `footer` (baris aksi kustom —
  SATU pemakai: wizard pratinjau→terapkan product-bulk-table yang
  memang bukan berbentuk Batal/Simpan; chrome dialog tetap bersama).
- Paragraf deskripsi yang dulu hidup di kepala panel racikan dipindah
  menjadi paragraf pembuka isi Modal — teks tidak berubah.
- Adopsi Modal: 9 pemanggil (audit) → **26 pemakaian JSX di 21 berkas**.

**Pengecualian terdokumentasi (di luar cakupan, dengan alasan):**
`pos/pos-terminal.tsx` (pengambilalihan layar penuh terminal, bukan
dialog), `pos/terminal-dialogs.tsx` (dialog permukaan terminal z-[70]
di bawah lapisan kasir), `pos/sale-row-actions.tsx` (lembar aksi baris
di dalam terminal) — migrasi permukaan terminal membahayakan alur
offline kasir dan bukan form web standar. Overlay shell
(`shell/command-palette.tsx`, `shell/mobile-nav.tsx`) dan primitif
`ui/*` bukan overlay form per berkas. Semuanya dikunci sebagai
pengecualian bernama di test penjaga (§5) dengan uji anti-basi.

## 3. UX4-02 (bagian pusat) — lantai teks 11px di komponen bersama

- `blocks/status-badge.tsx`: `text-[10px]` → `text-[11px]` (sumber
  terbesar pelanggaran audit: badge tampil di hampir semua daftar).
- Beranda (`app/app/page.tsx`): label meta modul 9px → 11px.
- `shell/sidebar-nav.tsx`: lencana antrean 9px → 11px.
- Cip 9px di sumbernya: group-pricing (cip "Nonaktif"), user-access
  (6 cip: Anda/Bawaan/Kustom/modul ×2/teks izin), halaman Pengaturan
  (2 cip "Utama") → semua 11px.

Pengukuran DOM sesudah (§6): elemen 9px = **0 di kelima halaman
sampel** (sebelumnya 12 di /app, 6 di Pengguna & peran). Elemen 10px:
Jurnal 2→0, Akuntansi 1→0 (efek StatusBadge). Yang tetap: Produk 122
dan sisa kecil di /app (2) & Pengguna (2) — terbukti elemen LOKAL per
halaman, bukan komponen bersama: di Produk rincian terukurnya pil
status lokal `rounded-full … text-[10px]` 30×2, subteks `num
text-[10px]` 30, sufiks `ml-1 text-[10px]` 30, label seksi shell 3,
sisanya satuan. Itu cakupan G5 (pengukuran ulang per halaman) sesuai
rencana tahap — dicatat, tidak diperbaiki diam-diam di G1.

Sisa 9px yang SENGAJA tidak disentuh tahap ini: permukaan cetak
(`print/print-shell.tsx`, `akuntansi/report-document.tsx` — skala
cetak memang di bawah lantai layar) dan petunjuk kecil di
`pengaturan/forms/cetak.tsx:257`. Untuk G5.

## 4. UX4-08 — satu basis radius

Token di `@theme` (`src/app/globals.css`) diselaraskan ke hierarki
arah desain A-25 §2.3 dari basis tunggal `--radius` 0,55rem:

| Token | Sebelum | Sesudah (terkomputasi) | Untuk |
|---|---|---|---|
| --radius-md | turunan 0,8× (7,04px) | `var(--radius)` = **8,8px** | field & tombol (kelas `rounded-md`, 465 pemakaian) |
| --radius-lg | turunan 1,0× (8,8px) | ×1,4 = **12,32px** | kartu & panel (≥12px) |
| --radius-xl | — | ×1,8 = **15,84px** | dialog (≈16px) |
| --radius-2xl/3xl/4xl | — | ×2,2 / ×2,6 / ×3 | kelanjutan skala |

Perubahan hanya di token — ejaan kelas pemanggil tidak berubah di
seluruh repo; yang berubah nilai terkomputasinya.

**Bukti pengukuran DOM** (skrip `.local/g1-radius-measure.mjs`,
Playwright @1440px, 5 halaman, sebelum → sesudah):

| Halaman | Radius sebelum | Radius sesudah |
|---|---|---|
| /app | 7,04×5 · 8,8×8 · 12,32×7 | **7,04 hilang** · 8,8×5 · 12,32×8 · **15,84×7 (dialog)** |
| /app/gudang/produk | field 7,04 · kartu 8,8 | **field 8,8 · kartu 12,32** · 7,04 hilang |
| /app/akuntansi/jurnal | 7,04×9 · 8,8×5 | **7,04 hilang** · 8,8×9 · 12,32×5 |
| /app/akuntansi | 7,04×8 · 8,8×14 | **7,04 hilang** · 12,32×14 |
| /app/pengaturan/pengguna | 7,04×2 · 8,8×3 | **7,04 hilang** · 12,32×3 · 8,8×2 |

Catatan kejujuran pengukuran: larian "sesudah" pertama menunjukkan
angka identik dengan "sebelum" karena DUA server dev lama masih
berjalan dan port 3000 dilayani build lama; pengukuran diulang dengan
satu server dev segar dan angka di atas adalah hasil ulangan itu.

## 5. FRM-04 — Field bersama global + test penjaga baru

- **Baru:** `src/components/blocks/field.tsx` — `Field` bersama global
  (definisi persis versi pengaturan: label `labelClass` + kontrol +
  petunjuk). `pengaturan/forms/shared.tsx` kini me-re-export `Field`
  (dan `Modal`) dari blocks — pemanggil Pengaturan tidak berubah.
- **Migrasi salinan lokal (4 berkas):** gudang/product-form.tsx,
  gudang/partner-forms.tsx, pengaturan/user-access.tsx,
  pengaturan/group-pricing.tsx — definisi lokal dihapus, impor dari
  blocks.
- **Penyimpangan terdokumentasi:** `pos/pos-display.tsx` TIDAK
  dimigrasi — "Field"-nya terbukti bukan salinan: ia membungkus
  `<div>` + grup tombol segmen di popover tampilan POS, bukan
  label+kontrol. Komentar penjelasan ditanam di berkas itu. Jadi
  hasilnya 4 termigrasi + 1 terbukti-bukan-salinan (audit menghitung
  5 kandidat).

**Test penjaga baru** `tests/unit/architecture-dialog-patterns.test.ts`
(3 test, gaya architecture-module-boundaries dengan peta pengecualian
anti-basi): (1) larang pemanggilan `window.prompt/confirm/alert` di
seluruh src (komentar dibuang sebelum pindai); (2) larang overlay
`fixed inset-0` di luar lapisan bersama + pengecualian bernama;
(3) pengecualian yang berkasnya tak lagi memuat pola = test gagal.

## 6. Gerbang (semua tanpa pipa penutup; exit code per perintah)

| Gerbang | Hasil |
|---|---|
| Suite terarah (7 berkas: penjaga baru + arsitektur + UI workflow) | **41/41 lulus**, exit 0 |
| Suite penuh — larian 1 | 2078/2080: 2 test balapan konkurensi gagal di bawah beban paralel (lint berjalan bersamaan atas kesalahan operasional tahap ini); keduanya lulus terisolasi 28/28 dan invarian datanya benar (tepat satu run/penjualan) — pola flake AUD-008 |
| Suite penuh — larian 2 (bersih) | **2080/2080 lulus, 219 berkas**, exit 0 |
| Typecheck (`tsc --noEmit`) | exit 0 |
| Lint (`eslint .`) | exit 0 — 0 error; 29 warning semuanya lama & tak satu pun di berkas G1 |
| Build (`next build`) | exit 0 — Compiled successfully |
| E2E — larian 1 | 24/25: `pos-offline` skenario C timeout karena spec masih mengemudikan `window.prompt` (handler `page.on("dialog")`) yang kini menjadi ConfirmDialog |
| E2E — spec diperbarui | `e2e/pos-offline.spec.ts`: pembuangan item peninjauan kini klik "Buang" (exact) + konfirmasi "Buang antrean"; maksud pengujian tidak berubah; spec tunggal **3/3 lulus** |
| E2E — larian 2 penuh (`BISA_E2E_RESEED=1`) | **25/25 lulus**, exit 0 |

Baseline suite sebelum G1: 2077 test / 218 berkas → sesudah: 2080 /
219 (bertambah tepat 3 test penjaga baru).

## 7. Sisa & tindak lanjut (di luar G1, tidak dikerjakan diam-diam)

- Elemen 10px lokal per halaman (Produk 122 dkk.) + sisa 9px cetak →
  **G5** pengukuran ulang, sesuai rencana gabungan.
- Overlay permukaan terminal POS (3 berkas, §2) tetap kekhususan
  terdokumentasi; peninjauan ulang hanya bila alur offline disentuh.
- FRM-03 (QtyInput), FRM-05 (helper submit), CRUD & tabel → tahap
  G2–G4 rencana gabungan, tidak berubah oleh G1.
