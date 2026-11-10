# Audit UI/UX Putaran 4 — Validasi Visual & Pengukuran DOM Hidup (2026-11-08)

**Sifat:** ANALISA SAJA — nol perubahan kode. Putaran PELENGKAP atas analisa statis
CodeGraph kemarin (`docs/form-crud/AUDIT-FORM-CRUD-TABEL.md`, 17 temuan fragmentasi
pola FRM/CRUD/TBL) — putaran ini berbasis **screenshot + pengukuran DOM hidup**,
karena analisa statis tidak bisa melihat rasa visual.
**Acuan:** `docs/rombak-ui/ARAH-DESAIN-A25.md` (arah desain resmi).
**Bukti:** `~/workspace/bukti-validasi4/` — 242 screenshot, `measurements.json`
(230 kunjungan), `measurements-supp.json`, `measurements2.json`,
`measurements-responsive.json`; ZIP: `~/workspace/bisa-erp-screenshot-validasi4.zip`.

## Jawaban atas pertanyaan pemilik — "apakah hanya itu, atau masih banyak lagi?"

**Masih ada lagi — tetapi sifatnya berbeda dan tidak ada yang kritis.**
Di luar 17 temuan fragmentasi pola kemarin, putaran visual ini menemukan
**14 temuan baru: 0 P1 · 4 P2 · 10 P3.** Isinya bukan kekacauan baru, melainkan
**deviasi visual terukur dari arah desain A-25 yang tidak terlihat dari kode**:
lantai ukuran teks 11px dilanggar badge & label mikro, 10 halaman menampilkan
>1 tombol primer, aksi baris permanen (termasuk Hapus) masih hidup di daftar
pihak, dan tabel Jurnal terpotong di lebar sempit. Sebaliknya fondasi disiplin
terbukti kuat: warna patuh token, label form seragam di atas field, nol overflow
di desktop, truncasi nyaris nol. Sisa lama A-25: GDG-13 & PNG-05 **membaik**,
GDG-05 & UX-A06 **tetap sebagian** — tidak ada yang memburuk.

## 1. Cakupan & metode

- Server produksi lokal dari **reseed bersih** (65 produk, nilai persediaan
  Rp28.349.600 — cocok baseline), login pemilik demo.
- **Crawl BFS** dari 7 pintu modul mengikuti semua tautan internal: 230 kunjungan
  terukur pada 1440×900; lintasan tambahan bertarget untuk pola `[id]`/cetak yang
  tidak tertaut href. Hasil akhir: **69 dari 82 pola halaman ter-screenshot &
  terukur**, terorganisir per modul di folder bukti.
- **13 pola tidak terfoto** karena seed demo tidak memiliki data contohnya —
  bukan karena halamannya rusak: detail & cetak run payroll, dokumen stok,
  PO, penerimaan, purchase-request, retur pembelian, nota POS, cetak transfer.
  Pola halamannya (DocumentPage bersama) terwakili oleh detail jurnal/akun/
  pelanggan/kasbon/pinjaman yang terfoto.
- Halaman kunci (beranda, POS terminal, produk, riwayat POS, jurnal, payroll,
  pengaturan) juga difoto pada **1024px (tablet)** dan **390px (sempit)**.
- Pengukuran per halaman lewat DOM terkomputasi (bukan kesan): ukuran/bobot font,
  spacing, warna vs token tema (probe variabel di dalam `.theme-erp`),
  tombol berlatar `--primary`, radius, posisi label form, tinggi baris tabel,
  ukuran ikon, overflow-X, teks terpotong, keadaan kosong.
- **Catatan metode (jujur):** (a) tangkapan *fullPage* membuat elemen `sticky`
  tampak menimpa isi di titik jahitan — diverifikasi terpisah lewat tangkapan
  viewport (§5, bukan temuan); (b) agregat font/spacing dihitung dari kunjungan
  representatif terkaya per pola; (c) pengukuran warna putaran pertama sempat
  salah-probe di luar cakupan tema dan **diulang** dengan probe di dalam tema —
  angka warna di laporan ini dari putaran yang benar.

## 2. Statistik pengukuran (69 pola, desktop 1440px)

| Aspek | Hasil terukur | Acuan A-25 | Nilai |
|---|---|---|---|
| Overflow-X 1440px | **0 halaman** | — | Sehat |
| Overflow tablet 1024 (7 kunci) | 0 | — | Sehat |
| Overflow sempit 390 (7 kunci) | **1 (Jurnal)** | — | UX4-04 |
| Ukuran font berbeda | 13 ukuran (9–26px); modus teks 11px (header tabel, sah) | skala §2.2 | Campuran |
| Teks < 11px | **526 elemen 10px + 34 elemen 9px, di 28 pola** | "tidak ada teks < 11px, termasuk badge" | **UX4-02** |
| Bobot font | 400/500/600 (+700 hanya 15) | — | Sehat |
| Tombol primer / halaman | 36 pola = 1 · 23 = 0 (mayoritas cetak/laporan) · **10 pola > 1** | tepat 1 (§4.2) | **UX4-03** |
| Warna non-token | ≈ nol; sisa = overlay hitam transparan (print) & token ber-alpha | token `.theme-erp` | Sehat |
| Kelas warna hex hardcoded | **13 instans** (keluarga aksen teal `#0d6b60` + `#256b3a`) | token | UX4-12 |
| Spacing di luar kelipatan 4px | 36,4% — didominasi langkah-setengah Tailwind sah (2/6/10px: padding badge, gap rapat) | skala 4px | Bukan temuan (lihat catatan) |
| Radius terkomputasi | dua basis: **7,04px (0,44rem) 481 sampel vs 8,8px (0,55rem token) 308**; ≥12px hanya 8 sampel | field 9 · kartu 12 · dialog 16 | **UX4-08** |
| Label form | di atas field di semua form terukur; 0 pola label-samping sejati | label di atas | Sehat |
| Tinggi baris tabel | modus **53/57px** (daftar) · 26–31px (laporan) | nyaman 40 · kompak 32 | **UX4-09** |
| Ikon (konten) | 6 ukuran 10–24px, modus 12px (262) | — (menu 16px) | UX4-14 |
| Teks terpotong tak disengaja | 1 kasus nyata (nama rekening di Bank, tanpa `title`) | — | Sehat |
| Halaman bertabel | 30 dari 69 pola | — | — |

Catatan spacing: angka 36,4% **tidak** dibaca sebagai pelanggaran — skala Tailwind
yang dipakai sistem memang memuat langkah setengah (0.5/1.5/2.5 = 2/6/10px) untuk
badge & gap rapat; terhadap skala Tailwind sendiri spacing nyaris sepenuhnya patuh.

## 3. Temuan

### UX4-01 (P2) — Aksi baris permanen termasuk "Hapus" masih hidup di daftar pihak
Halaman **Pemasok & pelanggan** menampilkan tiga tombol teks permanen di setiap
baris — Ubah · Nonaktifkan · **Hapus** — sementara halaman teladan (Produk)
sudah memakai satu menu ⋯. Arah desain §2.6/§4.1.3: aksi baris masuk menu ⋯ dan
aksi destruktif tidak pernah tampil sebagai tombol permanen di baris.
Bukti: `screenshots/gudang/app__gudang__pemasok.png` (bandingkan
`app__gudang__produk.png`). Ini konfirmasi visual dari TBL-03 putaran kemarin —
di halaman ini ia bukan fragmentasi abstrak, melainkan yang paling terlihat.

**Status sesudah G3 (2026-11-08): TERTUTUP.** Daftar Pemasok & pelanggan beralih ke satu menu ⋯ per baris (Ubah membuka form terkendali; Nonaktifkan & Hapus danger di dalam menu dgn ConfirmDialog G1; `PartnerRowActions` dihapus) — terverifikasi DOM: 3 tombol "Aksi untuk …", 0 tombol permanen Nonaktifkan/Hapus. Cakupan diperluas ke semua daftar lain yang masih beraksi baris permanen (pengaturan, HR master, dokumen stok, piutang/utang, bank, beban, payroll, kasbon, pinjaman); pengecualian tertulis di `docs/form-crud/HASIL-G3.md` §1.

### UX4-02 (P2) — Lantai ukuran teks 11px dilanggar secara sistemik
ARAH §2.2 menetapkan lantai mutlak: *"Tidak ada teks di bawah 11px di mana pun,
termasuk badge."* Terukur: **526 elemen teks 10px dan 34 elemen 9px** tersebar di
28 pola halaman. Sumber terbesarnya justru komponen bersama: **StatusBadge
`text-[10px]`** (muncul di hampir semua daftar), label mikro kartu modul di
beranda **9px** ("HARI INI", "TRANSAKSI", "KAS"), cip peran/pengguna 9px di
Pengguna & peran, dan teks petunjuk pengaturan 10px. Karena sumbernya komponen
pusat, perbaikannya juga terpusat — tetapi pelanggarannya nyata dan menyeluruh.

**Status sesudah G1 (2026-11-08): BAGIAN PUSAT TERTUTUP; sisa lokal ke G5.** StatusBadge 10→11px; label modul Beranda 9→11px; lencana sidebar 9→11px; cip 9px di user-access (6), group-pricing (1), halaman Pengaturan (2) → 11px. Pengukuran DOM ulang 5 halaman: elemen 9px = 0 di semua sampel; elemen 10px Jurnal 2→0 & Akuntansi 1→0. Yang tersisa terbukti elemen lokal per halaman (Produk 122: pil status lokal & subteks per baris) — cakupan G5 pengukuran ulang; sisa 9px permukaan cetak sengaja tidak disentuh (skala cetak). Rincian: `docs/form-crud/HASIL-G1.md` §3.

**Status final G5 (2026-11-08): SEBAGIAN — bagian pusat TERTUTUP; sisa lokal terpetakan bernama per elemen.** Pengukuran ulang G5 (metode & fungsi ukur sama seperti Putaran 4; sampel 27 pola): elemen **9px di permukaan aplikasi = 0** (agregat sampel 24 → 2, dan kedua sisa berada di permukaan cetak jurnal — skala cetak yang dikecualikan sadar). Sisa 10px kini bernama persis dari enumerasi DOM: subteks SKU/barcode per baris — Produk 40, Nilai persediaan 40, Pergerakan stok 40; pil status lokal daftar Produk 40; petunjuk field Pengaturan 15; sitasi regulasi (catatan kaki Perpres/PP) Payroll Indonesia 10; angka di dalam cip langkah wizard Impor 4 & Opname 2; subteks email + stempel waktu Pengguna & peran 2; tagline kaki Beranda 1; permukaan cetak jurnal 3×10px + 2×9px. Ini adalah sisa lokal yang G1 jadwalkan ke G5 utk dipetakan — terpetakan tuntas, dan permukaan yang sudah tertutup kini dikunci penjaga e2e permanen `e2e/ui-neatness-guard.spec.ts` (bukti gagal-dulu tercatat). Menaikkan sisa-sisa ini menyentuh kepadatan baris (UX4-09) dan merupakan keputusan desain lanjutan pemilik, bukan sisa pekerjaan yang belum ketahuan. Peta & tabel: `docs/form-crud/STATUS-TUTUP-GABUNGAN.md` §2.

### UX4-03 (P2) — Sepuluh halaman menampilkan lebih dari satu tombol primer
Aturan §4.2 (tepat satu primer per halaman) dilanggar 10 dari 69 pola, semuanya
halaman **panel majemuk** yang masing-masing panelnya membawa primer sendiri:
Organisasi HR **3** (Tambah departemen · Tambah jabatan · Simpan perubahan);
masing-masing 2: Terminal desktop (Buat terminal · Tetapkan rilis), Payroll
(Lanjut · Karyawan baru), Impor (Produk · Unggah & baca), Mode Operasi
(Buka · Terima barang), Aset tetap (Daftarkan Aset · Proses Penyusutan),
Pengguna & peran (Pengguna baru · Simpan perubahan), Lembur (Ajukan · Hitung THR),
Cuti (Tambah jenis · Ajukan), Detail pemasok (Bayar utang · PO baru).
Di layar, dua–tiga tombol plum solid bersaing sebagai "aksi utama".

**Status sesudah G4 (2026-11-08): TERTUTUP.** Satu primer aksi per halaman ditegakkan di semua halaman terukur >1 — cakupan terukur gabungan dua lintasan pengukuran putaran ini adalah 13 keadaan halaman (audit menamai 10; lintasan kedua juga menangkap tab Pengaturan pembayaran/grup/lokasi): panel sekunder turun ke varian outline `border bg-card hover:bg-muted` — MasterSection HR (primer halaman = "Simpan perubahan" shell), "Karyawan baru" (primer = "Lanjut" WizardSteps), "Tetapkan rilis" (primer = "Buat terminal", varian outline segeometri ditambah di panel terminal), "Proses Penyusutan" (primer = "Daftarkan Aset"), "Pengguna baru" + "Peran baru" (primer = "Simpan perubahan"), "Hitung THR" (primer = "Ajukan"), "Tambah jenis" cuti (primer = "Ajukan"), pemicu buat di seksi Pengaturan (Metode/Kelompok/Gudang/Cabang baru; primer = "Simpan perubahan"), CTA "Terima barang" di antrean operasi kosong (primer = "Buka"), dan "PO baru" di detail pemasok lewat prop `triggerPrimary={false}` (primer = "Bayar utang"; di halaman Pembelian tetap primer). Dua keadaan terpilih yang ikut terhitung primer dilunakkan ke gaya status aktif repo (`bg-primary-soft text-primary`): tab entitas aktif Impor & tautan "Atur harga" kelompok terpilih. Pengukuran DOM ulang (build produksi, reseed bersih, fungsi ukur yang sama seperti putaran 4): **14/14 halaman sampel tepat 1 tombol aksi primer**; satu-satunya elemen lain berlatar setara-primer adalah logo "Beranda" sidebar (token shell, konstan di semua halaman, tidak dihitung audit sebagai aksi). Rincian: `docs/form-crud/HASIL-G4.md` §1.

### UX4-04 (P2) — Tabel Jurnal terpotong di lebar sempit (390px)
Satu-satunya halaman kunci yang overflow terukur pada 390px: kolom DEBIT/KREDIT
berada di luar layar dan kolom KETERANGAN terpotong di tengah kata
("Saldo awal utang OP…"), tanpa gulir horizontal yang kentara di dalam kartu.
Enam halaman kunci lain aman; desktop & tablet aman total. Bukti:
`measurements-responsive.json` (overflowX: true) +
`screenshots/akuntansi/app__akuntansi__jurnal@sempit.png`.

**Status sesudah G4 (2026-11-08): TERTUTUP.** Diagnosis terukur meluruskan akar: tabel memang sudah di dalam `overflow-x-auto` (wadah 364px, tabel 921px tergulir di dalamnya), tetapi *scrollable-overflow* tabel merambat melewati wadah gulir + `overflow-hidden` kartu ke dokumen, sehingga halaman ikut bergeser. Perbaikan = kelas baku Tailwind `contain-paint` pada wadah gulir (memutus rambatan overflow tanpa mengubah tampilan/gulir di dalam wadah), diterapkan di Jurnal + dua blok tabel lebar bersama (`blocks/document-journals.tsx`, `blocks/audit-history.tsx`). Pengukuran DOM ulang 390px: **scrollWidth dokumen 890 → 390 = viewport, overflowX false**; tabel tetap 921px dan tergulir di dalam wadahnya. Rincian: `docs/form-crud/HASIL-G4.md` §4.

### UX4-05 (P3) — Label kartu statistik & cip ikon belum mengikuti bahasa desain
Label kartu statistik masih **uppercase 10–11px** (OMZET · LABA BERSIH ·
NILAI PERSEDIAAN …) padahal §2.2 menetapkan 12px/500 *sentence case*; dan cip ikon
pastel berwarna (teal/amber/plum/biru muda) masih menghiasi sudut kartu statistik
di Beranda, Beranda Akuntansi, dan Nilai Persediaan, padahal §2.1 menetapkan ikon
kartu statistik satu gaya: kotak `--muted` + ikon `--muted-foreground`. Warna
kehilangan makna karena semua kartu berwarna.

**Status sesudah G2 (2026-11-08): TERTUTUP.** Label StatCard bersama kini sentence case 12px/500 (`blocks/stat-card.tsx`, tanpa uppercase/tracking). Cip ikon dekoratif dinetralkan di tiga permukaan temuan: Beranda (4 kartu), Beranda Akuntansi (Omzet, Kas & bank, Nilai persediaan), Nilai Persediaan (Nilai persediaan, Potensi jual, Total unit). Tone bermakna dipertahankan: Laba bersih green/red (tanda laba/rugi) & Stok menipis red/green. Rincian: `docs/form-crud/HASIL-G2.md` §5.

### UX4-06 (P3) — Eyebrow halaman masih hidup di Beranda
Beranda masih membuka dengan eyebrow "MINGGU, 8 NOVEMBER 2026" (10px uppercase,
tracking 0.18em) — §2.2 menetapkan eyebrow **dihapus**. (Eyebrow serupa pada
kepala dokumen cetak dinilai wajar sebagai kop resmi, dicatat terpisah, bukan
bagian temuan ini.)

**Status sesudah G2 (2026-11-08): TERTUTUP.** Eyebrow di Beranda dihapus; tanggal panjang tetap tampil sebagai teks konteks biasa 12px di bawah judul sambutan (informasi tidak hilang, bentuk eyebrow yang hilang). Rincian: `docs/form-crud/HASIL-G2.md` §4.

### UX4-07 (P3) — Keadaan kosong tampil dalam tiga dialek; panel raksasa di Beranda
(a) Kotak dashed ringkas — sesuai EmptyState v2, terlihat benar di grafik
Beranda Akuntansi. (b) Teks polos di dalam kartu — Beranda: panel "Transaksi
terakhir" setinggi ±340px hanya berisi satu kalimat di tengah; ini sisa diagnosis
A-25 §1.9 (keadaan kosong terlihat rusak) yang belum tuntas khusus halaman itu.
(c) Teks polos tanpa kartu sama sekali — Terminal desktop, dua kali berturut-turut
di atas latar halaman. Tiga perlakuan untuk keadaan yang sama.

**Status sesudah G3 (2026-11-08): TERTUTUP utk permukaan daftar.** `EmptyState` bersama (varian `compact` = kotak dashed ringkas) menjadi satu-satunya bentuk: panel "Transaksi terakhir" Beranda & kartu "Belum ada modul" Beranda → compact; dua teks polos Terminal → `size="compact"`; teks polos kasbon/pinjaman per karyawan & panel penerimaan detail PO → compact. Sengaja tidak dimigrasi dgn alasan tertulis: baris kosong `<td colSpan>` dalam tabel (dialek baris-tabel), permukaan laporan/cetak, pemberitahuan gerbang. Rincian: `docs/form-crud/HASIL-G3.md` §3.

### UX4-08 (P3) — Dua basis radius hidup berdampingan
Radius terkomputasi terkonsentrasi pada **7,04px (0,44rem, 481 sampel)** dan
**8,8px (0,55rem = token, 308 sampel)**; radius kartu sesuai spesifikasi (≥12px)
hanya muncul 8 kali. Hierarki §2.3 (field 9 · kartu 12 · dialog 16) tidak
terwujud: mayoritas permukaan memakai salah satu dari dua radius yang berdekatan
tetapi tidak sama — perbedaan 1,76px yang terbaca sebagai ketidakseragaman halus
antar-halaman.

**Status sesudah G1 (2026-11-08): TERTUTUP.** Satu basis radius dari token: `--radius-md` = basis 0,55rem (8,8px, field/tombol), `--radius-lg` = ×1,4 (12,32px, kartu/panel), `--radius-xl` = ×1,8 (15,84px, dialog) — diubah di `@theme` globals.css, bukan per halaman. Pengukuran DOM ulang 5 halaman: 7,04px hilang di semua sampel; field 7,04→8,8px; kartu 8,8→12,32px; dialog 15,84px terwujud. Rincian: `docs/form-crud/HASIL-G1.md` §4.

### UX4-09 (P3) — Kepadatan baris menyimpang dua arah dari skala resmi
Baris daftar bermodus **53–57px** melawan target "nyaman" 40px (§2.4) — penyebabnya
pola sel dua baris (nama + SKU/barcode 10px) yang kini baku; baris laporan 26–31px
melawan target "kompak" 32px — lebih rapat dari targetnya. Di dalam jenisnya
masing-masing konsisten; yang menyimpang adalah kesetiaannya pada skala tertulis.
Dicatat sebagai deviasi terdokumentasi, bukan kekacauan.

**Status sesudah G3 (2026-11-08): TERTUTUP dgn catatan jujur.** Mekanisme = prop `density` opt-in di `DataList` (kelas terlingkup `data-list--compact`, padding sel py-1.5; BUKAN override menyeluruh yang dihapus Validasi 3) diterapkan ke daftar utama terukur. Pengukuran DOM ulang (build produksi, reseed bersih): produk 56→47px, nilai 56→47px, pergerakan 54→46px, pemasok 53→45px, akun 53→45–48px, jurnal 57→49px, piutang/utang 74→66px. Target 40px TIDAK tercapai penuh: sisa tinggi adalah konten sel dua baris, bukan padding — dinyatakan terbuka di `docs/form-crud/HASIL-G3.md` §4 sebagai keputusan desain lanjutan, bukan ditutup diam-diam.

### UX4-10 (P3) — Ukuran halaman pagination tidak seragam antar-daftar
Produk memaginasi **30/baris** ("1–30 dari 65"), Nilai Persediaan **50/baris**
("1–50 dari 65") — dua daftar saudara, dua ukuran. Bukti: footer paginasi pada
kedua screenshot gudang.

**Status sesudah G3 (2026-11-08): TERTUTUP.** Satu nilai baku repo `LIST_PAGE_SIZE = 40` (`src/lib/pagination.ts`): produk 30→40 & nilai 50→40 kini tampil "1–40 dari 65" (terverifikasi DOM: kedua daftar 40 baris/halaman); pengecualian tertulis utk laporan/sub-daftar/pengaturan/ekspor di `docs/form-crud/HASIL-G3.md` §2 (= status TBL-01).

### UX4-11 (P3) — Angka mentah `numeric(19,4)` tampil apa adanya di field parameter
Pengaturan Payroll Indonesia menampilkan nilai parameter sebagai string mentah
4 desimal: pembagi upah sejam **"173.0000"**, THR masa kerja penuh **"12.0000"**,
masa kerja minimum **"1.0000"** — sementara field uang di tempat lain tampil
terformat. Bukti: `screenshots/pengaturan/app__pengaturan__payroll-indonesia.png`
(seksi Parameter perhitungan).

**Status sesudah G2 (2026-11-08): TERTUTUP.** Tiga kunci parameter desimal polos (`thr_min_months`, `thr_full_months`, `overtime_hourly_divisor`) kini disunting lewat QtyInput bersama — tampil "173"/"12"/"1". Paritas nilai dibuktikan test round-trip format→parse di `tests/unit/qty-input.test.ts`: nilai kanonis tersimpan identik sebelum/sesudah. Rincian: `docs/form-crud/HASIL-G2.md` §3.

### UX4-12 (P3) — Warna aksen ditulis literal, bukan token
13 instans kelas hex arbitrer terukur di DOM: `bg-[#e6f4f1]`, `text-[#0d6b60]`,
`border-[#cfe6e2]`, `bg-[#0d6b60]`, `bg-[#256b3a]` — pada cip "Sesi kas terbuka"
(Beranda) dan cip modul di Pengguna & peran. Nilainya sama dengan token
`--accent`/`--tone-green`, tetapi ditulis literal sehingga tak ikut bila token
berubah. Di luar keluarga ini, disiplin warna token terbukti bersih (§2).

**Status sesudah G4 (2026-11-08): TERTUTUP.** Semua kelas hex keluarga ini di `src/app` & `src/components` beralih ke token dgn nilai yang sama persis: cip "Sesi kas terbuka" → `bg-tone-teal-soft text-tone-teal` + titik `bg-tone-teal` (garis tepi `border-[#cfe6e2]` tak punya token bernilai sama → `border-tone-teal/25`); cip modul Pengguna & peran → `bg-tone-teal-soft text-tone-teal`; cip aktif Pengaturan → `bg-tone-green-soft text-tone-green`; titik status Beranda → `bg-tone-red` / `bg-tone-green` (titik amber nilainya persis `--chart-3` → `bg-chart-3`; `--tone-amber` bernilai beda dan tidak dipakai agar warna tampil tidak berubah). Sisa satu-satunya: larik warna JS `COLORS` di `charts.tsx` — data palet grafik yang memang mencerminkan token bagan (komentar di berkasnya), bukan kelas utilitas. Grep keluarga hex ini di tsx = 0 di luar itu. Rincian: `docs/form-crud/HASIL-G4.md` §5.

### UX4-13 (P3) — Header tabel editor baris jurnal memakai 10px
Standar header kolom adalah 11px (§2.2); header tabel editor baris di Jurnal baru
(AKUN · MEMO · DEBIT · KREDIT) terukur **10px**. Satu-satunya keluarga header di
bawah standar yang terdeteksi.

**Status sesudah G4 (2026-11-08): TERTUTUP.** Akar bersama ditemukan: keluarga header ini adalah varian `.data-table-dense` di `globals.css` (dipakai semua editor baris — jurnal, dokumen, opname) yang menetapkan `thead th` 10px. Satu perubahan di aturan bersama: 10px → **11px**; badan tabel tetap 12px sesuai desain varian padat T-03. Rincian: `docs/form-crud/HASIL-G4.md` §5.

### UX4-14 (P3) — Ukuran ikon konten menyebar tanpa skala yang ditegakkan
Ikon di area konten tampil dalam 6 ukuran (10/12/14/16/20/24px) dengan modus
12px (262 instans). Tidak ada aturan A-25 yang dilanggar secara eksplisit untuk
ikon konten, tetapi penyebarannya menunjukkan skala ikon tidak ditegakkan
komponen — ikon sejenis tampil beda ukuran antar-panel.

**Status sesudah G4 (2026-11-08): SEBAGIAN — skala terverifikasi, penegakan per instans menunggu titik bernama.** Temuan ini tidak menamai instans mana pun dan dokumen arah desain tidak menetapkan skala ikon konten umum, sehingga sapuan buta dilarang oleh mandat tahap ini sendiri. Bukti keadaan kini: distribusi kelas ukuran ikon di sumber didominasi pita §2.2 — `size-3.5` (14px) ×198 + `size-4` (16px) ×99 dari ±380 pemakaian; `ui/button` sudah membakukan ukuran svg per varian; pencilan terukur DOM (20/24px) adalah ikon penekanan semantik (Keadaan kosong, ubin pintasan POS/Beranda) dan 12px adalah konteks mikro (cip, aksi baris). Tidak ada perubahan spekulatif di G4; normalisasi per instans menunggu titik bernama dari putaran visual G5 (screenshot + pengukuran ulang), sama seperti sisa lokal UX4-02 berjalan ke G5. Rincian: `docs/form-crud/HASIL-G4.md` §5.

**Status final G5 (2026-11-08): TERTUTUP-terverifikasi — tidak ada titik material yang ditemukan.** Pengukuran ulang G5 (sampel 27 pola yang sama, enumerasi DOM penuh di dalam `<main>`, 192 ikon terhitung): distribusi ukuran ikon **14px ×97 · 16px ×77 · 12px ×11 · 20px ×7**; **nol ikon 10px dan nol ikon 24px** di seluruh sampel; 91% ikon berada di pita standar 14/16px. Setiap pencilan terperiksa satu per satu dan terbukti anggota keluarga bernama yang konsisten internal: (1) indikator urut header tersortir 12px — seragam di Produk, Pemasok, Piutang/utang; (2) ikon di dalam tombol sebaris kecil 12px — seragam (Terima/Tambah Saldo Awal piutang-utang, Ubah-simpan payroll ×4 & detail pemasok); (3) penekanan/ilustrasi 20px — 4 ubin modul Beranda seragam, ikon EmptyState (piutang-utang, aset), ikon pemberitahuan halaman cetak. Telaah visual screenshot penutup mengonfirmasi tak ada ikon sejenis yang tampil beda ukuran dalam satu permukaan. Karena tak ada titik menyimpang yang material, tak ada perubahan kode — menutup temuan dengan bukti distribusi, bukan sapuan spekulatif. Bukti: `docs/form-crud/STATUS-TUTUP-GABUNGAN.md` §3; data `~/workspace/bukti-gabungan/measurements-after.json`.

## 4. Halaman terburuk (gabungan bukti ukur + visual)

1. **Pengaturan Payroll Indonesia** — 231 kontrol; angka mentah 4 desimal
   (UX4-11); tabel Program BPJS 1.222px di dalam wadah 1.094px sehingga kolom
   "Berlaku sejak" hanya terjangkau gulir horizontal tak kentara di dalam kartu
   (§5/PNG-05); baris program bertumpuk dua baris catatan.
2. **Beranda (/app)** — panel kosong raksasa (UX4-07b), label mikro 9px (UX4-02),
   eyebrow yang seharusnya dihapus (UX4-06), cip ikon pastel (UX4-05).
3. **Jurnal umum @lebar sempit** — satu-satunya overflow; kolom keuangan tak
   terlihat (UX4-04).
4. **Organisasi & Pengaturan HR** — 3 tombol primer sekaligus (UX4-03).
5. **Pemasok & pelanggan** — aksi baris permanen termasuk Hapus (UX4-01).
6. **Terminal desktop** — keadaan kosong polos tanpa bingkai ×2, 2 primer (UX4-03/07c).
7. **Pengguna & peran** — cip 9px, hex hardcoded, 2 primer (UX4-02/03/12).

Sebaliknya halaman **teladan** putaran ini: **Produk & harga** (menu ⋯, checkbox
+ paginasi, satu primer, kategori/satuan sudah jadi tombol header),
**Jurnal baru** (indikator seimbang netral, panduan terlipat, bilah aksi menempel,
satu primer), dan **Beranda Akuntansi** (antrean kerja di atas, strip metrik,
keadaan kosong grafik ringkas) — ketiganya membuktikan bahasa desainnya bekerja
bila diterapkan penuh.

## 5. Verifikasi sisa lama

| Sisa | Status putaran ini | Bukti |
|---|---|---|
| **GDG-13** (duplikat pihak → panel di Pemasok) | **MEMBAIK** — tidak lagi item menu; tombol "Cek duplikat" kini di halaman Pemasok & pelanggan. Sisa bentuk: masih halaman terpisah `/gudang/pemasok/duplikat`, belum panel/dialog | screenshot pemasok (sidebar tanpa item duplikat; tombol di header) + screenshot halaman duplikat |
| **PNG-05** (kolom pertama BPJS sempit; Parameter tak dilipat) | **MEMBAIK, tetap sebagian** — kolom pertama kini lebar & terbaca penuh; sisa: tabel 1.222px > wadah 1.094px (`overflow-x-auto`) → kolom terakhir butuh gulir dalam kartu; angka parameter mentah (UX4-11) | pengukuran lebar tabel vs wadah; screenshot payroll-indonesia |
| **GDG-05 / UX-C04** (duplikasi baca stok Produk vs Nilai persediaan) | **TETAP sebagian** — kedua permukaan masih memuat daftar 65 produk yang sama dengan kolom tumpang tindih (Produk/Kategori/Satuan/Stok/HPP); keduanya rapi secara individual; penyatuan tetap keputusan desain pemilik | screenshot produk & nilai berdampingan |
| **UX-A06** (strip KPI di atas daftar) | **TETAP sebagian, membaik** — strip KPI kini hadir di Beranda Akuntansi, Jurnal (4 kartu), Produk/Nilai; belum menjadi pola seragam semua daftar (Pemasok & pelanggan tanpa strip) | screenshot jurnal/akuntansi/produk/nilai vs pemasok |
| Sampel "sebagian" A-25 lain | POLA label form: **tertutup terverifikasi** (label 13px sentence case, di atas field, di semua form terukur). Panel Kategori/Satuan di halaman Produk: **tertutup** (menjadi tombol header "Kategori & satuan") | pengukuran label; screenshot produk |

Diverifikasi **bukan** temuan (agar tidak jadi isu hantu): bilah "Simpan
perubahan" yang tampak menimpa baris BPJS pada tangkapan fullPage adalah artefak
jahitan — pengukuran viewport membuktikan bilah itu `position: sticky` setinggi
58px di dasar viewport, pola SettingsLayout yang sah.

## 6. Yang sudah rapi — dinyatakan sehat, jangan diutak-atik

- **Disiplin warna token**: sesudah probe diperbaiki, warna non-token ≈ nol di
  69 pola (di luar UX4-12 yang terpusat).
- **Label & form**: label selalu di atas field, 13px sentence case; DateField &
  MoneyInput tetap menang (konsisten dengan FRM-08 kemarin).
- **Desktop & tablet**: nol overflow di 1440px (230 kunjungan) dan 1024px (7/7).
- **Truncasi**: nyaris nol kasus tak disengaja di 69 pola.
- **Cangkang**: sidebar terang + pengalih aplikasi + topbar 57px (target 56)
  konsisten di semua modul; status badge satu komponen di semua daftar.
- **Jurnal baru & Beranda Akuntansi & Produk**: lihat halaman teladan di §4.

## 7. Perbandingan jujur vs putaran sebelumnya

- Putaran 3 (tabel & form) menutup perataan/kepadatan yang dijaga e2e — putaran
  ini **tidak menemukan regresinya**: header sejajar & tinggi field seragam
  tidak muncul sebagai masalah pada pengukuran maupun screenshot.
- Analisa statis kemarin benar tentang fragmentasi pola, tetapi **buta** terhadap
  seluruh isi laporan ini: tak satu pun dari UX4-02/03/04/05/06/07/08/11 bisa
  terlihat dari graf kode — semuanya hanya muncul dari DOM hidup & screenshot.
  Kedua putaran saling melengkapi, bukan saling menggantikan.
- Terhadap A-25: arah desainnya terbukti sebagian besar terwujud (cangkang,
  halaman teladan, pola dokumen). Sisa ketidakrapian terkonsentrasi pada
  **konsistensi mikro lintas halaman** — bukan pada halaman yang "jelek semua"
  seperti vonis awal A-25.

## 8. Usulan rencana perbaikan bertahap (BELUM dieksekusi — untuk keputusan pemilik)

1. **Tahap 1 — Komponen pusat (murah, dampak menyeluruh):** StatusBadge &
   label mikro naik ke lantai 11px; label kartu statistik 12px sentence case +
   ikon statistik satu gaya muted; eyebrow Beranda dihapus; keluarga hex aksen
   diganti kelas token.
2. **Tahap 2 — Daftar:** RowMenu ⋯ untuk daftar pihak; satu ukuran halaman
   pagination untuk semua DataList; strip KPI diseragamkan sebagai pola daftar.
3. **Tahap 3 — Primer tunggal:** panel sekunder turun ke outline di 10 halaman
   panel majemuk (HR, terminal, impor, operasi, aset, pengguna, lembur, cuti,
   payroll, detail pemasok).
4. **Tahap 4 — Permukaan:** EmptyState ringkas untuk panel Beranda & Terminal;
   satu basis radius (token 0,55rem) & pemakai 0,44rem diselaraskan; header
   editor jurnal 11px; nilai parameter payroll ditampilkan terformat.
5. **Tahap 5 — Sempit & penjaga:** tabel lebar pada ≤480px dibungkus gulir
   horizontal yang kentara; penjaga e2e Putaran 3 diperluas dengan cek overflow
   sempit, lantai font, dan hitungan primer — agar putaran 5 tidak perlu
   mengulang pengukuran ini dari nol.
