# Audit Terukur Tabel & Form — Validasi UI/UX Putaran 3 (2026-11-08)

Keluhan pemilik: banyak tabel/form tidak rapi dan tidak simetris, contohnya kolom qty. Audit ini **mengukur DOM yang ter-render** (bukan kesan visual): skrip Playwright `~/workspace/bukti-a28/validasi3/measure.mjs` (+ `probe-shots.mjs`, `verify.mjs`) membaca computed style setiap kolom tabel dan field form pada **47 halaman** di semua modul sesudah reseed bersih (65 produk). Hasil mentah: `measurements.json` di folder yang sama; 15 screenshot di `~/workspace/bukti-a28/validasi3/01..16-*.png`.

**Cakupan terukur: 47 halaman · 36 tabel · 55 kolom numerik · ±330 field form** (halaman terpadat: Pengaturan Payroll Indonesia 219 field, Katalog produk 30 baris, Nilai persediaan 50 baris, Bagan akun 124 akun dalam 6 tabel).

Ringkasan vonis: keluhan pemilik **terbukti dan akar utamanya satu baris CSS bersama** — bukan selusin kesalahan per halaman. Angka-angka di bawah adalah nilai computed style aktual.

---

## TEMUAN TABEL

### T-01 (P1) — Header kolom numerik SELALU rata kiri di atas angka rata kanan — 55 dari 55 kolom (100%)

Di **setiap** tabel terukur, kolom numerik (Qty, HPP, Harga jual, Stok, Saldo, Debit, Jumlah, Pokok, Bersih, …) selnya rata kanan tetapi **headernya rata kiri**:

| Halaman | Kolom (header kiri, sel kanan) |
|---|---|
| Katalog produk | HPP `Rp 5.200`, Harga jual `Rp 7.500`, Stok `60`, Min. `12` |
| Pergerakan stok | **Qty `+12`**, HPP `Rp 9.000` |
| Nilai persediaan | Stok, HPP, Nilai `Rp 312.000`, Potensi |
| Jurnal | Nilai `Rp 1.600.000` |
| Buku besar, Bagan akun (×6 tabel) | Saldo s.d. `Rp 80.349.600` |
| Payroll & karyawan | Pokok `Rp 4.000.000`, Tunjangan, Potongan, Bersih |
| Sesi kas & Riwayat sesi | 6 kolom uang per tabel (Modal awal … Seharusnya) |
| Piutang & utang, Rekonsiliasi, Cuti, Akuntansi Beranda | Total/Dibayar/Sisa, Debit, Selisih, Jatah/Sisa |

**Akar komponen (terbukti di browser, `verify.mjs`):** di Pergerakan stok, `<th className="text-right">` di dalam `<table className="data-table">` ter-render `text-align: left`, sementara `<td className="num text-right">` pada kolom yang sama ter-render `right`. Penyebabnya aturan bersama di `src/app/globals.css`:

```css
.data-table thead th { @apply … px-3 py-2 text-left …; }
```

Aturan ini ditulis **di luar `@layer`** sehingga dalam kaskade Tailwind v4 ia mengalahkan utilitas `.text-right` (yang hidup di `@layer utilities`) — 208 pemakaian `<th className="text-right">` di kode sumber semuanya kalah tanpa ada yang menyadarinya. Sel tidak terkena karena aturan `.data-table tbody td` tidak menetapkan `text-align`.

**Kenapa masalah:** header adalah label kolom; label yang menempel di tepi berlawanan dari angkanya membuat setiap kolom terlihat "meleset" — inilah kesan tidak simetris yang dilaporkan pemilik, paling terasa pada kolom pendek seperti Qty/Stok.

**Pola perbaikan (terpusat, satu tempat):** pindahkan blok `.data-table` ke `@layer components` (utilitas lalu menang sebagaimana mestinya) **atau** hapus `text-left` dari aturan `thead th`. Satu perbaikan menyembuhkan **93 tabel** pemakai `.data-table`. Tambahkan test penjaga pola A-28 (computed-style/DOM test) agar tidak kambuh.

### T-02 (P1) — Tanpa `nowrap`: tabel lebar runtuh menjadi baris raksasa 89–91px

`.data-table` tidak menetapkan `white-space: nowrap` pada `th`/`td` (komponen shadcn `TableCell` yang tak terpakai justru punya). Akibat terukur pada tabel berkolom banyak:

- **Sesi kas & Riwayat sesi** (11 kolom): tinggi header **60,8px** (header "MASUK JUAL + TARIK BANK" membungkus 3 baris), tinggi baris **89px**; sel nama kasir membungkus 3 baris ("Nadia / Putri / Toko Utama"), lencana status membungkus 2 baris ("MASIH / TERBUKA").
- **Piutang & utang** (9 kolom): tinggi baris **91,3px**.
- Bandingkan tabel sempit sehat: 32,7–37px per baris.

**Pola perbaikan (terpusat):** `th, td { white-space: nowrap }` di `.data-table` + kontrak wadah gulir horizontal (pola `overflow-x-auto` yang sudah dimiliki komponen `ui/table` dan sebagian halaman). Kolom teks panjang yang memang harus membungkus diberi kelas pengecualian per halaman.

### T-03 (P2) — Tiga sistem kepadatan tabel hidup berdampingan

Padding vertikal sel terukur: **8px** (`.data-table` dasar), **10px** (override `.theme-erp .data-list .data-table td` — jadi tabel yang sama berubah kepadatan tergantung dibungkus `DataList` atau tidak), dan **6px** (tabel form racikan sendiri: `line-editor.tsx`, `journal-entry-form.tsx`, `opname-form.tsx` — padding 8/6px, font 12px, header 10px). Ukuran font sel antar-sistem: 12/13/14px. Rentang tinggi baris data di seluruh aplikasi: **32,7px s.d. 91,3px**.

**Pola perbaikan:** satu token kepadatan — jadikan varian `DataList` (10px/13px) sebagai satu-satunya standar `.data-table`, dan migrasikan 3 tabel form racikan ke kelas yang sama (atau ekstrak `.data-table` varian form resmi).

### T-04 (P2) — Kolom aksi: lebar 40px s.d. 317px, arah tidak konsisten

Kolom terakhir ("Aksi") terukur: Katalog **72px rata kiri**, Jurnal **56px**, Jurnal baru **40px**, Bagan akun **±140–167px rata kanan**, Cuti **151px rata kanan**, Metode pembayaran **230px**, Gudang & cabang **230px**, Periode fiskal **263,8px**, Pemasok **316,9px rata kiri** — kolom aksi terlebar justru yang isinya satu tombol ⋯/Ubah, menyisakan ruang kosong besar di tepi kanan tabel (terlihat jelas di screenshot Pemasok/Periode).

**Pola perbaikan (terpusat):** aturan bersama untuk kolom aksi — `th:last-child/td:last-child` selebar isi (mis. 48px untuk menu ⋯ tunggal, 96px untuk dua aksi) dan satu arah (kanan), atau adopsi sel aksi bersama (`RowMenu` yang sudah ada di `components/blocks/row-menu.tsx`) sebagai satu-satunya pola.

### T-05 (P3) — 8 kolom numerik yang selnya pun tidak rata kanan

Dari 55 kolom numerik, 8 selnya tidak rata kanan: kolom **Kode** di 6 tabel Bagan akun (`text-align: start`), **Urutan** (Metode pembayaran), **Tahun** (Payroll Indonesia). Kode akun bisa dibela sebagai teks, tetapi di dalam tabel yang sama Saldo rata kanan sehingga kolom kode terlihat mengambang. **Perbaikan:** kelas `.num` (sudah ada) diterapkan konsisten, atau putuskan kode = teks dan beri gaya monospace agar niatnya terbaca.

### T-06 (sehat — dipertahankan) — Angka tabular sudah 100%

Seluruh 55 kolom numerik terukur memakai `font-variant-numeric: tabular-nums` (kelas `.num` diterapkan disiplin pada `td`). Digit sejajar vertikal dengan benar; yang rusak murni posisi header (T-01), bukan bentuk angka.

### T-07 (P3) — Laporan keuangan memakai sistem keempat: grid div, bukan tabel

Laporan Laba rugi/Neraca dirender sebagai **grid CSS div** (`.report-compare-grid`, kolom nilai tetap 104px → 150px pada ≥sm), bukan `<table>`. Di dalamnya konsisten, tetapi lebar kolom nilai terkunci 150px tanpa memandang isi, dan sistem ini tidak berbagi token apa pun dengan `.data-table` — perbaikan T-01/T-03 tidak akan menyentuhnya. **Perbaikan:** samakan token lebar/padding kolom nilai dengan standar tabel saat T-03 dikerjakan.

### Catatan baris total

Hampir tidak ada tabel daftar yang memiliki baris total di dalam tabel (hanya form Jurnal baru yang punya `tfoot` — dan totalnya rata kanan dengan benar). Nilai persediaan (50 baris) menampilkan totalnya sebagai kartu KPI di luar tabel. Ini pilihan desain yang sah, dicatat agar tidak dibaca sebagai cacat; yang tidak konsisten adalah tidak adanya pola baku kapan total masuk tabel vs keluar.

---

## TEMUAN FORM

### F-01 (P1) — Dua tinggi field (32px vs 36px) bercampur di halaman yang sama

Tinggi field terukur hanya dua nilai — **32px** (`h-8`) dan **36px** (`h-9`) — tetapi keduanya muncul **bersamaan dalam satu halaman/form**:

| Halaman | 32px | 36px |
|---|---|---|
| Jurnal baru | 6 field | 4 field |
| Sesi kas | 12 field | 1 field |
| Pengaturan Umum | 6 field | 11 field |
| Pengaturan Gudang & cabang | 11 field | 5 field |
| Pengaturan Payroll Indonesia | 178 field | 41 field |
| Kas & bank | 2 field | 7 field |

**Akar komponen:** standar bersama `fieldClass` (`components/blocks/field-classes.ts`) adalah `h-8`, yang di dalam lingkup `.theme-erp` dinaikkan tema menjadi `h-9` — sementara input mentah shadcn (`Input`/`Select`) bawaan `h-9` dan permukaan di luar lingkup tema tetap 32px. Tiga sumber tinggi tanpa penegakan. Deretan filter/form yang tingginya belang adalah penyumbang besar kesan "tidak rapi" kedua sesudah T-01.

**Pola perbaikan (terpusat):** kunci SATU tinggi (36px) — samakan bawaan `Input`/`Select` shadcn ke token yang sama dan sapu pemakai `fieldClass` di luar tema; tambahkan penjaga pola seperti `date-input-pattern.test.ts`.

### F-02 (P2) — Field uang di luar MoneyInput masih rata kiri & tak tabular

Di tempat `MoneyInput` bersama dipakai, hasilnya benar 100% (Kas & bank 2/2 rata kanan + tabular; Pengaturan Umum 5/7). Sisanya adalah input mentah yang lolos dari sapuan A-28 T4: field jumlah di **HR Lembur & Cuti** (rata kiri, tak tabular) dan 2 field berlabel uang di **Pengaturan Cetak**. **Perbaikan:** selesaikan sapuan MoneyInput pada ±3 permukaan ini (daftar residu yang sama dengan catatan jujur A-28 T4).

### F-03 (P2) — Tidak ada skala lebar untuk jenis field yang sama

Lebar field sejenis berbeda antar-halaman tanpa pola: field tanggal terukur **118 / 144 / 154 / 158 / 170px** di berbagai filter; di Pengaturan Payroll Indonesia lebar field menyebar **96–369px** (219 field); bar filter Jurnal memakai 118/203/220/227px berdampingan. Sebagian adalah konsekuensi grid, tetapi tidak ada token lebar baku untuk tanggal/nominal pendek sehingga setiap halaman menebak sendiri.

**Pola perbaikan:** token lebar semantik di `field-classes.ts` (mis. `field-date w-[10.5rem]`, `field-money-sm w-40`, `field-qty w-24`) yang dipakai filter bar & form.

### F-04 (P3) — Label: dua gaya hidup berdampingan

Pola dominan terukur adalah label-di-atas via `<label className="space-y-1">` (±236 pemakaian) di samping pola resmi `labelClass` (mikro uppercase 10px yang ditemakan menjadi 13px sentence-case). Di layar keduanya tampak mirip di dalam `.theme-erp`, tetapi di luar lingkup tema (sebagian Pengaturan) label kembali mikro 10px — inkonsistensi yang sama akarnya dengan F-01. Posisi tombol simpan sendiri sudah baku (bilah lengket bawah di Pengaturan; kanan-bawah di form dokumen) dan **bukan** temuan.

---

## PETA AKAR: komponen bersama vs per halaman

| Temuan | Jenis | Rumah perbaikan |
|---|---|---|
| T-01 header numerik | **Komponen bersama** | `globals.css` `.data-table thead th` (1 baris) → 93 tabel sembuh |
| T-02 nowrap | **Komponen bersama** | `globals.css` `.data-table th/td` + kontrak gulir |
| T-03 kepadatan | **Komponen bersama** | `globals.css` `.data-table` vs override `.data-list`; migrasikan `line-editor/journal-entry-form/opname-form` |
| T-04 kolom aksi | Bersama + per halaman | aturan `last-child` di `.data-table` + adopsi `RowMenu` |
| T-05 sel numerik | Per halaman (8 kolom) | terapkan `.num` |
| T-07 grid laporan | Komponen tersendiri | `report-statements.tsx` samakan token |
| F-01 tinggi field | **Komponen bersama** | `field-classes.ts` + bawaan `ui/input.tsx`/`select.tsx` + cakupan tema |
| F-02 MoneyInput | Per halaman (±3) | sapuan residu A-28 T4 |
| F-03 skala lebar | Komponen bersama | token lebar di `field-classes.ts` |

**Urutan perbaikan yang disarankan:** T-01 (satu baris, dampak terbesar) → F-01 → T-02 → T-03/T-04 → sisanya. Komponen shadcn `ui/table.tsx` saat ini dipakai **0 berkas** — putuskan: jadikan `.data-table` CSS sebagai standar resmi (dokumentasikan) atau migrasikan; jangan biarkan keduanya hidup tanpa pemilik.

## Lampiran — angka per halaman (pilihan)

| Halaman | Tabel | Padding sel (px) | Tinggi baris | Catatan |
|---|---|---|---|---|
| Katalog produk | 1 (30 baris) | 12/10 | 53,8 | 4 kolom numerik header-kiri |
| Pergerakan stok | 1 (40 baris) | 12/10 | 52,4 | Qty terbukti `text-right`→`left` |
| Nilai persediaan | 1 (50 baris) | 12/10 | 53,8 | tanpa baris total dalam tabel |
| Sesi kas | 2 | 12/8 & 12/10 | 36,5 & **89** | header 60,8px (T-02) |
| Jurnal | 1 | 12/10 | 57,3 | Nilai header-kiri |
| Jurnal baru | 1 (form) | 12/6 | 48,5 | bukan `.data-table`; total tfoot benar |
| Buku besar | 1 | 12/8 | 37 | — |
| Bagan akun | 6 | 12/10 | 53 | Kode `start` (T-05), Aksi ±140–167 kanan |
| Piutang & utang | 1 | 12/10 | **91,3** | T-02 |
| Payroll & karyawan | 1 | — | — | Pokok/Tunjangan/Potongan/Bersih header-kiri |
| Pengaturan Payroll ID | 6 | 12/8 | 34–66 | 219 field, tinggi 32+36 bercampur |
