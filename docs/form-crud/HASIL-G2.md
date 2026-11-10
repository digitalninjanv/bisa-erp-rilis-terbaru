# HASIL G2 — Primitif Form: QtyInput + Helper Submit Bersama (FRM-03, FRM-05, UX4-05, UX4-06, UX4-11)

Program Perbaikan Gabungan, Tahap G2 (2026-11-08). Sumber: `docs/form-crud/AUDIT-FORM-CRUD-TABEL.md` (FRM-03, FRM-05) + `docs/validasi-uiux-4/AUDIT-UIUX-4.md` (UX4-05, UX4-06, UX4-11). Aturan tahap dipatuhi: **aturan bisnis & angka TIDAK berubah** — tahap ini memusatkan pola input/submit dan menutup deviasi visual bernama; nilai kanonis yang disimpan server di semua titik termigrasi identik dengan sebelum migrasi. Status: **SELESAI & TERVERIFIKASI, belum di-commit** (menunggu pemeriksaan & commit Pemimpin).

Komponen bersama baru (2 berkas, meniru kontrak yang sudah terbukti di repo):

- `src/lib/qty-input.ts` + `src/components/qty-input.tsx` — QtyInput bersama (FRM-03).
- `src/components/use-action-runner.ts` — helper submit bersama (FRM-05): `runActionResult(promise)`, `useActionRunner()` → `{ busy, run }`, `requireFilled(value, message)`.

## 1. FRM-03 — QtyInput bersama dibangun; 15 titik audit + titik sekelas dimigrasi

Keputusan A-28 yang menunda QtyInput ditinjau dengan bukti audit (pola pengganti disalin di ≥15 titik pada 11 berkas) dan **dibalik**: komponen bersama kini ada. Kontraknya sengaja meniru `lib/money-input`/`lib/percent-input` persis — satu model mental untuk semua input angka:

- Nilai kanonis tetap **string Decimal** yang sama seperti yang selama ini hidup di state form & disimpan server ("2.5000"); komponen hanya memusatkan cara nilai **ditampilkan, diketik, dan dijepit**.
- Tampilan mengikuti `formatQty`: ribuan ".", desimal ",", nol ekor dibuang ("2.5000" → "2,5"; "1500.0000" → "1.500").
- Mengetik: koma satu-satunya jalur desimal (kontrak SIS-01 yang sama dengan MoneyInput); mengetik "1.500" tetap 1500, bukan 1,5. Tempel: titik desimal polos & nilai kanonis 4 desimal diterima.
- `decimals` per konteks (bawaan 3, rentang 0–4); `min`/`max` menjepit **nilai yang diserahkan** saat ketik & blur — meniru penjepitan onChange yang dulu ditulis tangan di form retur POS.

Titik termigrasi (state tetap string kanonis, kecuali dua adaptor number di POS yang memang number sejak sebelumnya):

| Berkas | Titik | Perilaku yang dipertahankan |
|---|---|---|
| `gudang/line-editor.tsx` | qty baris dokumen | lebar w-20 (kini `wrapperClassName`); kelas peringatan `exceeds` tetap di input |
| `gudang/opname-form.tsx` | ×3: qty kemasan, hitung lepas, hitung polos | lebar w-16/w-16/w-20; placeholder & konteks kemasan utuh |
| `gudang/supplier-return-form.tsx` | qty baris retur | parse/jepit tangan lama diganti lib bersama, nilai terserah identik |
| `gudang/supplier-return-resolutions.tsx` | qty pengganti | — |
| `gudang/transfer-receive-form.tsx` | qty terima | — |
| `gudang/product-form.tsx` | stok minimum | — |
| `gudang/reservation-panel.tsx` | qty reservasi | `min="0"` dipertahankan sebagai prop |
| `gudang/purchase-request-panel.tsx` | qty permintaan | `min="0"` dipertahankan sebagai prop |
| `pos/return-form.tsx` | qty retur per baris (adaptor number) | jepit tangan `min(remaining, max(0,…))` → prop `min="0"`/`max={remaining}`: **semantik jepit onChange yang sama**, kini terpusat; kosong → 0 (setara `Number("") \|\| 0` lama) |
| `pos/cart-panel.tsx` | stepper qty keranjang (adaptor number ke `setQty`) | kosong = 0 → baris terhapus oleh `setCartLineQty`, persis semantik lama; kelas ditimpa agar menyatu dengan stepper |
| `akuntansi/hr/overtime.tsx` | jam lembur | validasi `Number(hours) > 0` tetap bekerja atas nilai kanonis |
| `akuntansi/hr/leave.tsx` | jatah hari per tahun | placeholder "tanpa jatah" dipertahankan; kosong tetap berarti tanpa batas (null di aksi) |
| `pengaturan/payroll-indonesia-form.tsx` | 3 kunci parameter desimal polos | lihat §3 (UX4-11) |

**Penyimpangan beralasan (diputuskan dari bukti, bukan diam-diam):**

1. Titik kedua audit di `pos/cart-panel.tsx` (±baris 334) adalah **nilai diskon** (persen/nominal per unit), BUKAN kuantitas → tidak dimigrasi ke QtyInput. Kandidat pasangan Percent/Money dwimodus di tahap lanjutan tersendiri.
2. `gudang/product-bulk-table.tsx` field nilainya campuran tiga semantik (stok minimum / persen / nominal Rp, negatif diperbolehkan) → tidak dimigrasi ke QtyInput.
3. Field `type="number"` bukan-kuantitas dibiarkan sebagai pola sadar repo: sortOrder metode pembayaran, padding penomoran, hitungan hari identitas-pajak, tahun periode, umur manfaat aset tetap.
4. Stepper POS: mengetik koma kini berstatus "pending" (tidak menyerahkan nilai) — perilaku lama koma menghasilkan NaN → 0 → baris terhapus seketika. Ini **perbaikan yang disadari**: ketikan setengah jadi tidak lagi menghapus baris; blur/angka lengkap menuntaskannya seperti input angka lain di aplikasi.

Test: `tests/unit/qty-input.test.ts` (37 test: format/parse/typed/regroup, jepit min/max termasuk paritas jepit form retur, langkah desimal per konteks, round-trip nilai kanonis, paritas parameter payroll) + penjaga adopsi di §5.

## 2. FRM-05 — helper submit bersama; adopsi bertahap pada titik identik lurus

`src/components/use-action-runner.ts` (satu rumah, tiga bentuk mengikuti pola dominan repo dari survei 78 berkas pemeriksa `result.ok` & 63 deklarasi busy):

- `runActionResult(promise)` — inti bersama: toast error `result.message` bila gagal; kembalikan **data sukses atau `null`** (pemanggil memeriksa `=== null`, lalu memakai data bertipe penuh).
- `useActionRunner()` → `{ busy, run }` — untuk form mandiri: busy selalu dilepas via `finally` (pola tangan lama melepaskan busy hanya di jalur tanpa pengecualian); pengecualian di luar kontrak ActionResult tetap terlempar, sama seperti pola tangan.
- `requireFilled(value, message)` — pengganti idiom `if (!x.trim()) { toast.error(...); return; }`; untuk pesan gabungan, dipanggil per field dengan pesan yang sama — rantai `||` berhenti di kegagalan pertama sehingga toast tampil **satu kali**, setara pola lama.

Titik termigrasi (hanya yang polanya identik lurus; diverifikasi per berkas sebelum disentuh):

| Berkas | Yang bermigrasi |
|---|---|
| `pengaturan/payroll-indonesia-form.tsx` | `runSaver` lokal menjadi adaptor boolean satu baris di atas `runActionResult` — seluruh saver seksi pengaturan (sudah terpusat sejak A-25 U6/POLA-05) kini berjalan di inti bersama; fallback pesan "Gagal menyimpan." gugur karena ActionResult selalu membawa `message` (semantik setara) |
| `pengaturan/group-pricing.tsx` | submit + hapus kelompok → runner; `clearAll` → runner (status `clearing`); loop simpan per baris `saveAll` → `runActionResult` per baris (toast per kegagalan + kumpul gagal, sama) |
| `akuntansi/capital-form.tsx` | submit → `useActionRunner` (sukses memakai `data.number`); validasi klien lama utuh |
| `gudang/product-form.tsx` | submit → runner; validasi nama/SKU → `requireFilled` |
| `gudang/adjustment-form.tsx` | submit → runner (cabang sukses status pending dipertahankan) |
| `akuntansi/hr/overtime.tsx` | submit pengajuan + tombol keputusan → runner (dialog ditutup sesudah run, urutan setara) |
| `akuntansi/hr/leave.tsx` | simpan jenis cuti, toggle aktif, submit pengajuan (sukses memakai `data.days`), tombol keputusan → runner |
| `akuntansi/hr/attendance.tsx` | form impor CSV → runner + `requireFilled` |
| `pos/return-form.tsx` | submit retur → runner (sukses memakai `data.number`/`data.warnings`) |

Validasi klien racikan → `requireFilled`: **10 dari 11 titik audit** — product-form (§di atas), `gudang/partner-forms.tsx` ×2 (pemasok & pelanggan), `gudang/taxonomy-manager.tsx` ×3 (kategori, satuan, sunting nama), `pengaturan/forms/gudang-cabang.tsx` ×2 (gudang & cabang), `gudang/receipt-form.tsx` ×1 (catatan wajib bersyarat sumber "other", di dalam `validate()` pengembali boolean), `akuntansi/hr/attendance.tsx` ×1, `pos/use-held-sales.ts` ×1 (label pesanan ditahan).

**Tidak setara — tidak dipaksa, dicatat sebagai adopsi lanjutan:**

- `akuntansi/bank-reconciliation/import-form.tsx` — saluran errornya **inline** (`setFailure`), bukan toast → migrasi mengubah perilaku tampil-error; di luar mandat "bila setara".
- `pos/use-held-sales.ts` untuk runner — submit-nya punya try/catch jaringan khusus POS-ERR-01; hanya validasinya yang bermigrasi.
- Sisa ±60 berkas pemeriksa `result.ok` di luar form utama per modul: **adopsi lanjutan** per modul pada tahap berikutnya (mandat tahap ini memang form utama per modul, bukan 141 berkas sekaligus). Penjaga §5 mengunci titik yang sudah bermigrasi agar tidak mundur.

## 3. UX4-11 — parameter payroll tidak lagi tampil "173.0000"

Di `pengaturan/payroll-indonesia-form.tsx`, kunci parameter yang nilainya **desimal polos** — `thr_min_months`, `thr_full_months`, `overtime_hourly_divisor` — kini disunting lewat QtyInput (kelas `h-9 text-[12px]`, sama seperti MoneyInput/PercentInput di baris yang sama). Server memperlakukan nilai-nilai ini sebagai desimal polos sehingga langkah desimal bawaan dipakai: tampilan "173.0000" → "173", "12.0000" → "12", "1.0000" → "1".

**Paritas nilai dibuktikan test** (`tests/unit/qty-input.test.ts` §"paritas parameter payroll"): format→parse mengembalikan nilai kanonis yang persis sama ("173.0000" → tampil "173" → simpan "173.0000"); nilai tersimpan tidak berubah. Kunci parameter berjenis uang/persen di berkas yang sama sudah memakai MoneyInput/PercentInput sejak sebelumnya dan tidak disentuh.

## 4. UX4-06 — eyebrow Beranda dihapus

Elemen eyebrow tanggal kapital 10px tracking 0.18em di `src/app/app/page.tsx` dihapus sesuai arah desain §2.2 (eyebrow dihapus; lantai teks 11px). Informasi tanggal **tidak hilang**: tanggal panjang kini tampil sebagai teks konteks biasa 12px di bawah judul sambutan.

## 5. UX4-05 — label kartu statistik sentence case 12px; cip ikon pastel dinetralkan

- **Pusat:** label di `src/components/blocks/stat-card.tsx` kini `text-[12px] font-medium` sentence case (tanpa `uppercase`/`tracking-wide`) sesuai §2.2. Pemanggil terverifikasi mengoper label sentence case literal, jadi tidak ada label yang berubah teks.
- **Cip ikon dekoratif dinetralkan** (prop `tone` dihapus → bawaan netral `--muted`) hanya di tiga permukaan audit, mengikuti §2.1 (warna hanya bermakna):
  - **Beranda** (`src/app/app/page.tsx`): 4 kartu (teal/plum/amber/green — semua dekoratif) → netral.
  - **Beranda Akuntansi**: Omzet (teal), Kas & bank (plum), Nilai persediaan (amber) → netral. **Dipertahankan:** Laba bersih `green/red` — warnanya bermakna tanda laba/rugi.
  - **Nilai Persediaan** (`gudang/nilai/page.tsx`): Nilai persediaan (amber), Potensi jual (teal), Total unit (plum) → netral. **Dipertahankan:** Stok menipis `red/green` — warnanya bermakna ada/tidaknya stok menipis.
- Permukaan lain yang memakai `tone` bermakna (status, peringatan) tidak disentuh; prop `tone` pada StatCard tetap ada untuk pemakaian bermakna.

**Penjaga baru** `tests/unit/architecture-form-primitives.test.ts` (2 test): daftar permukaan QtyInput terdaftar wajib mengimpor QtyInput bersama; daftar form terdaftar wajib mengimpor helper submit bersama — migrasi tidak boleh mundur diam-diam. Daftar sengaja hanya memuat titik yang benar-benar dimigrasi tahap ini.

## 6. Gerbang (semua tanpa pipa penutup; exit code per perintah; dari reseed bersih)

Reseed bersih terverifikasi lebih dulu: 65 produk, nilai persediaan Rp28.349.600 (cocok baseline).

| Gerbang | Hasil |
|---|---|
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **0 error**, 29 warning (semua warisan pra-G2; warning baru yang sempat muncul dari migrasi ini — impor `toast` tak terpakai di payroll-indonesia-form — diperbaiki & diverifikasi ulang) |
| `pnpm build` | **exit 0** (Next 16.4.5, semua rute ter-generate) |
| Suite penuh `pnpm test` | **2119/2119 lulus, 221 berkas** (baseline G1 2080/219 → **+39 test**: 37 qty-input + 2 penjaga primitif form) |
| E2E `BISA_E2E_RESEED=1 pnpm test:e2e` | **25/25 lulus** |

Catatan lingkungan: di tengah tahap, layanan VM restart sekali — build pertama terputus (bukan kegagalan kode; diulang penuh, exit 0) dan PostgreSQL mati sehingga dipulihkan dengan prosedur baku (user pguser dibuat ulang, `postmaster.pid` basi dibuang, `pg_ctl` start di port 5433) sebelum reseed.

## 7. Sisa & tindak lanjut (tidak dikerjakan diam-diam)

- **Adopsi lanjutan FRM-05:** ±60 berkas pemeriksa `result.ok` di luar form utama per modul + dua titik tak-setara bernama di §2 (import rekonsiliasi inline-error; hold POS POS-ERR-01) — bermigrasi per modul pada tahap berikutnya, ditambahkan ke daftar penjaga saat bermigrasi.
- **Diskon dwimodus cart-panel** (persen/nominal per unit, §1 butir 1): kandidat pasangan input bersama tersendiri, bukan QtyInput.
- **Sisa 10px lokal per halaman** (cakupan G1 §3, mis. Produk 122 elemen) tetap cakupan tahap visual berikutnya (G5 per rencana gabungan), tidak berubah oleh tahap ini.
- Aturan bisnis, angka, skema, dan migrasi database: **nol perubahan** di tahap ini.
