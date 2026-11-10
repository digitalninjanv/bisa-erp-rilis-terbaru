# HASIL-G4 — Primer Tunggal, Idiom CRUD & Residu UX4 (Program Perbaikan Gabungan, Tahap G4)

> Tahap G4 dari rencana gabungan (AUDIT-FORM-CRUD-TABEL.md §6 tahap 3 +
> AUDIT-UIUX-4.md §3): UX4-03 (primer tunggal), CRUD-01 (idiom validasi satu
> ejaan), CRUD-02 (revalidatePath HR), UX4-04 (Jurnal 390px), UX4-12/13/14
> (residu kecil). Diimplementasikan & diverifikasi 2026-11-08, **belum
> di-commit** — menunggu pemeriksaan & commit Pemimpin. Aturan bisnis &
> angka TIDAK berubah: CRUD-01 murni penyeragaman ejaan validasi, CRUD-02
> hanya menambah revalidasi tampilan, UX4-03/04/12/13/14 hanya hierarki &
> gaya visual.

---

## 1. UX4-03 — satu tombol primer per halaman (DITUTUP)

Aturan yang ditegakkan: tepat satu tombol **aksi** berlatar `--primary` per
halaman. Panel sekunder turun ke varian outline repo (`border border-border
bg-card … hover:bg-muted`); primer yang bertahan dipilih per konteks:

| Halaman | Primer yang bertahan | Yang turun ke outline |
|---|---|---|
| Organisasi HR (`/app/akuntansi/hr`) | "Simpan perubahan" (bar simpan shell) | Submit `MasterSection` Departemen & Jabatan (`hr/master-org.tsx` — satu komponen, kedua instans seragam) |
| Payroll | "Lanjut" (`WizardSteps` bersama — memang dirancang sebagai primer tunggal alur) | Pemicu "Karyawan baru" (`payroll-panel.tsx`; varian "Ubah" di komponen yang sama sudah outline) |
| Terminal desktop | "Buat terminal" | "Tetapkan rilis" — varian `outlineButtonClass` baru segeometri tombol primer form di `terminal-admin-panel.tsx` |
| Aset tetap | "Daftarkan Aset" | "Proses Penyusutan" (`fixed-asset-panel.tsx`, diganti per blok `onClick={run}` karena kelas kedua tombol identik) |
| Pengguna & peran | "Simpan perubahan" (shell) | "Pengguna baru" + "Peran baru" (`user-access.tsx`) |
| Lembur | "Ajukan" (pengajuan lembur) | "Hitung THR" (`hr/thr.tsx`, panel THR) |
| Cuti | "Ajukan" (pengajuan cuti) | "Tambah jenis" (`hr/leave.tsx`, panel master jenis — diganti per blok label karena kelas kedua submit identik) |
| Pengaturan tab pembayaran/grup/lokasi | "Simpan perubahan" (shell) | Pemicu buat di dalam seksi: "Metode baru", "Kelompok baru", "Gudang baru", "Cabang baru" |
| Impor | "Unggah & baca" | Tab entitas aktif ("Produk" dkk.) — bukan aksi melainkan status navigasi: beralih ke gaya aktif repo `bg-primary-soft font-medium text-primary` (patokan nav Pengaturan) |
| Mode Operasi | "Buka" (form pindai) | CTA "Terima barang" pada keadaan antrean kosong (`operation-queue.tsx`; sejajar CTA "Transfer stok" di sebelahnya yang sudah outline) |
| Detail pemasok | "Bayar utang" | "PO baru": `PurchaseOrderForm` mendapat prop `triggerPrimary` (baku `true`); detail pemasok meneruskan `false`. Di halaman Pembelian "PO baru" tetap primer tunggal |

**Susulan dari pengukuran sendiri:** tautan "Atur harga" kelompok terpilih
(`group-pricing.tsx`) juga terhitung primer (keadaan terpilih berlatar
solid) — dilunakkan ke gaya terpilih soft yang sama
(`border-primary/50 bg-primary-soft text-primary`).

**Cakupan jujur:** audit menamai 10 halaman; gabungan dua lintasan
pengukuran putaran 4 menangkap **13 keadaan halaman** >1 primer (tab
pembayaran/grup/lokasi Pengaturan ikut tertangkap lintasan kedua). G4
menutup ketigabelasnya — kriteria buktinya adalah nol halaman sampel >1,
bukan daftar nama.

**Bukti (DOM, build produksi, reseed bersih, fungsi ukur yang sama seperti
putaran 4 — elemen `button`/`a` terlihat berlatar terkomputasi `--primary`):**
14/14 halaman sampel kini tepat **1 tombol aksi primer** (daftar: 13 di atas
+ Pembelian sebagai kontrol yang tidak berubah). Satu elemen lain berlatar
setara-primer muncul konstan di semua halaman dan teridentifikasi bukan
aksi: logo "Beranda" di kepala sidebar (kelas token `bg-shell-*`, teks
inisial merek "b") — pengukuran putaran 4 juga tidak menghitungnya.

## 2. CRUD-01 — idiom validasi satu ejaan (DITUTUP)

Seluruh **64 titik `.parse(` di 20 berkas** `src/server/actions/**`
bermigrasi ke `parseInput(` (impor ditambah di 11 berkas yang belum punya).
Hitungan per berkas cocok persis Lampiran A audit: pos 13, pihak 6,
taksonomi 5, produk 5, settings/pembayaran 4, lokasi 4, kelompok-harga 4,
import/rows 4, periode 4, akun-pemetaan 3, saldo-awal 2, beban-transfer 2,
palette/migrasi-coa/karyawan/hr-payroll/pembayaran-acc/import-analyze/
import-commit/cetak masing-masing 1. Sisa `.parse(` mentah di actions = **0**
(grep atas sumber tanpa komentar).

**Paritas pesan (syarat mandat):** migrasi ini setara secara konstruksi —
`parseInput` dan jalur lama sama-sama Zod di dalam `guard(...)`, dan
`guard()` memetakan `ZodError` mentah lewat `formatZodIssues` yang sama
dengan pemetaan di dalam `parseInput` (komentar eksplisit di
`src/lib/errors.ts`: pesan mentah tidak pernah bocor). Bukti empiris:
suite penuh hijau **tanpa satu pun test yang menyentuh pesan validasi
diubah**.

**Penjaga permanen:** `tests/unit/architecture-action-patterns.test.ts` —
memindai semua berkas actions (komentar dibuang sebelum pindai) dan
melarang `.parse(` mentah; daftar pengecualian `PARSE_EXCEPTIONS` kosong
dengan cek anti-basi pola G1 (pengecualian yang berkasnya sudah bersih
membuat test gagal).

## 3. CRUD-02 — revalidatePath HR (DITUTUP, dengan koreksi premis)

**Penemuan korektif:** premis audit ("revalidatePath = 0 di HR") adalah
artefak hitungan token literal. Ketiga berkas HR **sudah** memanggil helper
bersama `revalidateHrPaths()` (`src/server/actions/hr/shared.ts`) yang
merevalidasi `/app/akuntansi/payroll`, `/app/akuntansi/hr`,
`/app/akuntansi` — panggilan `revalidatePath` hidup di dalam helper.
Celah sebenarnya: **subhalaman HR tidak tercakup helper**, sementara aksi
HR mengubah data yang tampil di subhalaman itu.

Perbaikan tertarget per aksi (helper tetap dipanggil; `router.refresh()`
klien tidak disentuh — kedua mekanisme seperti modul lain):

- `presensi.ts` (2 aksi): + `revalidatePath("/app/akuntansi/hr/absensi")`.
- `cuti-lembur.ts` (8 aksi): submit/keputusan lembur → `…/hr/lembur` +
  `…/hr/persetujuan`; `computeThr` & `voidComponentDraft` → `…/hr/lembur`;
  simpan/aktifkan jenis cuti → `…/hr/cuti`; submit/keputusan cuti →
  `…/hr/cuti` + `…/hr/persetujuan`.
- `organisasi.ts` **sengaja tidak diubah**: kedelapan aksinya tampil di hub
  HR yang sudah tercakup `revalidateHrPaths()` (terverifikasi dari struktur
  halaman — hub merender MasterOrgManager + HrParametersForm; lembur/cuti/
  absensi/persetujuan adalah halaman sendiri).

**Bukti:** penjaga yang sama (`architecture-action-patterns.test.ts`)
memeriksa rentang sumber per fungsi ekspor: helper memuat 3 path dasar;
organisasi 8/8 aksi memanggil `revalidateHrPaths();`; presensi 2/2 aksi
memuat path absensi; cuti-lembur 8/8 aksi memuat path tertarget yang
diharapkan per aksi. Suite HR & suite penuh hijau.

## 4. UX4-04 — Jurnal pada 390px (DITUTUP)

Diagnosis terukur (biseksi DOM + uji intervensi gaya di halaman hidup)
meluruskan gambaran audit: tabel **sudah** berada di dalam
`overflow-x-auto` yang bekerja (wadah 364px; tabel 921px tergulir di
dalamnya; kartu `overflow-hidden`), tetapi *scrollable-overflow* tabel
tetap merambat melewati kedua lapisan itu ke dokumen — dokumen terukur
890px pada viewport 390px. Intervensi yang terbukti memutus rambatan
tanpa mengubah tampilan: `contain: paint` pada wadah gulir (390px persis;
cara lain yang diuji — overflow-y, display grid, max-width, overflow clip —
tidak berpengaruh).

Perbaikan: kelas baku Tailwind **`contain-paint`** ditambahkan di samping
`overflow-x-auto` pada:

- halaman Jurnal (`akuntansi/(akuntansi)/jurnal/page.tsx`) + komentar
  alasan G4;
- dua blok tabel lebar bersama sejenis: `blocks/document-journals.tsx`
  (jurnal dokumen di halaman detail) & `blocks/audit-history.tsx`.

**Bukti sesudah (DOM 390px, build produksi):** `scrollWidth` dokumen
**890 → 390 = lebar viewport, overflowX false**; tabel tetap 921px dan
tergulir horizontal di dalam wadahnya (gulir dalam wadah kentara, halaman
tidak ikut bergeser).

## 5. UX4-12 / UX4-13 / UX4-14 — residu kecil

**UX4-12 (DITUTUP) — hex aksen → token.** Semua kelas hex keluarga audit
di `src/app` & `src/components` beralih ke kelas token bernilai sama
persis: cip "Sesi kas terbuka" Beranda → `bg-tone-teal-soft`,
`text-tone-teal`, titik `bg-tone-teal` (`--tone-teal` = #0d6b60,
`--tone-teal-soft` = #e6f4f1); garis tepi `#cfe6e2` tidak punya token
bernilai sama → `border-tone-teal/25`; cip modul Pengguna & peran →
pasangan teal yang sama; cip status aktif Pengaturan (5 titik) →
`bg-tone-green-soft text-tone-green`; titik status Beranda →
`bg-tone-red`/`bg-tone-green`, dan titik amber → `bg-chart-3` (nilainya
persis #c28b36; `--tone-amber` bernilai #8a5a12 — tidak dipakai agar
warna tampil tidak berubah). Sisa satu-satunya hasil grep keluarga ini:
larik `COLORS` di `components/akuntansi/charts.tsx` — data palet JS untuk
mesin grafik yang menurut komentarnya sendiri mencerminkan token bagan;
bukan kelas utilitas dan tidak bisa dirujuk ke token Tailwind.

**UX4-13 (DITUTUP) — header editor jurnal 10px → 11px.** Akar bersama:
varian `.data-table-dense` di `globals.css` (dipakai semua editor baris:
jurnal, dokumen, opname) menetapkan `thead th` pada 10px. Satu perubahan
di aturan bersama → **11px** (lantai header §2.2); badan varian tetap
12px sesuai desain padat T-03.

**UX4-14 (SEBAGIAN — dinyatakan terbuka) — skala ikon.** Temuan audit
tidak menamai instans mana pun ("ikon sejenis tampil beda ukuran
antar-panel", tanpa titik), dan ARAH-DESAIN-A25 tidak menetapkan skala
ikon konten umum — mandat tahap ini sendiri melarang sweep buta.
Keadaan terverifikasi: distribusi kelas ukuran ikon di sumber
didominasi pita standar — `size-3.5` (14px) ×198 dan `size-4` (16px)
×99 dari ±380 pemakaian; `ui/button` membakukan ukuran svg per varian;
pencilan DOM 20/24px adalah penekanan semantik (ikon EmptyState, ubin
pintasan) dan 12px konteks mikro (cip/aksi baris). **Tidak ada perubahan
spekulatif di G4.** Normalisasi per instans menunggu titik bernama dari
putaran visual G5 — diperlakukan sama seperti sisa lokal UX4-02 yang
berjalan ke G5.

## 6. Gerbang (semua tanpa pipa penutup; angka apa adanya)

| Gerbang | Hasil |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (0 error; 29 warning lama, tidak bertambah dari berkas G4) |
| `pnpm build` | exit 0 |
| Suite penuh `pnpm test` | **2135/2135 lulus, 223 berkas** (baseline G3 2129 + 6 test penjaga baru) |
| E2E `BISA_E2E_RESEED=1 pnpm test:e2e` | **25/25 lulus** dari reseed bersih (baseline seed terverifikasi: 65 produk, nilai persediaan Rp28.349.600) |
| Pengukuran DOM UX4-03 | 14/14 halaman sampel tepat 1 tombol aksi primer |
| Pengukuran DOM UX4-04 | Jurnal 390px: scrollWidth 890 → 390 = viewport |

## 7. Berkas yang berubah (45)

- **CRUD-01 (20 berkas actions):** pos; inventory/{pihak, taksonomi,
  produk}; accounting/{periode, akun-pemetaan, saldo-awal, beban-transfer,
  pembayaran, migrasi-coa}; settings/{lokasi, kelompok-harga, pembayaran,
  cetak}; import/{rows, analyze, commit}; hr/{karyawan, payroll}; palette.
- **CRUD-02:** `actions/hr/{presensi, cuti-lembur}.ts` (+ helper `shared.ts`
  tidak berubah; organisasi tidak berubah beralasan).
- **Penjaga baru:** `tests/unit/architecture-action-patterns.test.ts` (6 test).
- **UX4-03:** `hr/master-org.tsx`, `payroll-panel.tsx`,
  `pos/terminal-admin-panel.tsx`, `fixed-asset-panel.tsx`,
  `pengaturan/user-access.tsx`, `hr/thr.tsx`, `hr/leave.tsx`,
  `pengaturan/forms/{metode-pembayaran, gudang-cabang}.tsx`,
  `pengaturan/group-pricing.tsx` (+ gaya terpilih), `gudang/impor/page.tsx`,
  `gudang/operation-queue.tsx`, `gudang/purchase-order-form.tsx`,
  `gudang/pemasok/[id]/page.tsx`.
- **UX4-04:** `akuntansi/jurnal/page.tsx`, `blocks/document-journals.tsx`,
  `blocks/audit-history.tsx`.
- **UX4-12:** `app/page.tsx`, `app/pengaturan/page.tsx`,
  `pengaturan/user-access.tsx`.
- **UX4-13:** `app/globals.css` (satu aturan bersama `.data-table-dense`).
- **Dokumen:** HASIL-G4.md ini; status temuan di
  `docs/form-crud/AUDIT-FORM-CRUD-TABEL.md` (CRUD-01, CRUD-02) &
  `docs/validasi-uiux-4/AUDIT-UIUX-4.md` (UX4-03/04/12/13/14); PROGRESS §0K.

## 8. Sisa terbuka (jujur)

- **UX4-14** per instans — menunggu titik bernama dari putaran visual G5
  (lihat §5).
- Penjaga e2e untuk hitungan primer per halaman & overflow sempit
  **belum** ditambahkan sebagai test permanen — mandat G5 memang
  menjadwalkan perluasan penjaga e2e (overflow sempit, lantai font,
  hitungan primer) di sana; bukti G4 berupa pengukuran DOM langsung yang
  terdokumentasi di §1 & §4.
- CRUD-03 (bentuk tanda tangan delete) tidak termasuk cakupan G4 dan
  tidak disentuh.
