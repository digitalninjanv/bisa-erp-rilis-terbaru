# R2 — Audit Desain UI Akuntansi (Ronde 2, Bagian 2: Kualitas Desain di Luar Laporan)

Tanggal: 2026-11-04 · Sifat: BACA-SAJA (inspeksi kode JSX/CSS seluruh halaman &
komponen akuntansi + pembanding modul POS/gudang/pengaturan).
Ronde 1 (A5) menilai workflow & fungsi; dokumen ini menilai **kualitas &
kesengajaan desain visual** — menjawab keluhan pengguna bahwa tampilan
akuntansi "kurang intensional, tidak profesional".

## Vonis ringkas

Fondasi desain sebenarnya ADA: `PageHeader` bersama (dipakai 25 berkas
akuntansi), `StatCard`, `StatusBadge`, `EmptyState`, `SearchForm`, kelas
`.data-table`, dan `.num` (tabular-nums) — dan halaman terbaik (beranda,
formulir jurnal, detail jurnal) membuktikan tim bisa tampil profesional.
Masalahnya adalah **disiplin pemakaian**: hampir setiap halaman pada satu
titik berhenti memakai sistem bersama dan mengarang varian lokalnya sendiri —
kartu metrik lokal, pill status manual, filter manual, tabel bespoke. Hasilnya
satu modul yang terasa seperti ditulis banyak tangan tanpa editor desain:
benar semua, rapi tidak pernah. Keluhan pengguna **terbukti pada lapis
konsistensi visual**, bukan pada ketiadaan sistem.

Skala teks adalah masalah kenyamanan tersendiri: modul ini memakai **13
ukuran huruf berbeda (9px–22px)**, dengan 128 pemakaian `text-[10px]` dan 8
pemakaian `text-[9px]` — label dan angka sekunder di bawah ambang baca nyaman
untuk dokumen keuangan yang dibaca berjam-jam.

## Nilai desain per halaman

| Halaman | Nilai | Catatan desain |
|---|---|---|
| Beranda akuntansi | B | Dirancang nyata: 8 StatCard, dua grafik, banner keseimbangan neraca, panel piutang/utang. Minus: dua baris kartu identik bertumpuk tanpa label kelompok; strip "Periode fiskal" berupa tombol + pill melayang di luar kartu; warna banner hex mentah. |
| Jurnal — daftar | B− | Kerangka rapi, tetapi kartu ringkasannya komponen lokal (`SummaryCard`, nilai 16px tanpa ikon) — bukan StatCard bersama (20px + ikon). |
| Jurnal — baru | A− | Permukaan terbaik di modul: panel samping status keseimbangan berwarna, pola cepat, peringatan periode inline, alasan tombol nonaktif selalu terlihat. Minus kecil: panduan memakai bullet "•" teks & tanda "✓" teks, bukan ikon. |
| Jurnal — detail | B+ | Terasa seperti dokumen yang didesain: eyebrow, nomor besar, banner konteks berwarna, footer sumber. Minus: lebar `max-w-3xl` menyimpang dari semua halaman daftar (lebar penuh) sehingga navigasi terasa melompat; tabelnya bespoke, bukan `.data-table`. |
| Buku besar | B− | Header akun & baris saldo awal/akhir baik. Tetapi metriknya varian lokal ketiga (`MiniMetric`, label **9px**, nilai 13px, `rounded-md`) dan angka mutasi hanya 11px. |
| Bagan akun (COA) | B− | Grup per tipe + StatCard rapi. Minus: pill status Aktif/Nonaktif manual (padahal `StatusBadge` punya status itu), chip filter manual (padahal `FilterChips` bersama ada), **tanpa keadaan kosong sama sekali** saat pencarian tak menemukan akun (grup hilang, halaman tinggal sunyi), indentasi hierarki memakai glyph teks "↳". |
| Periode fiskal | B | Panel tutup tahun + kartu "Alur yang disarankan" memberi rasa terkurasi; dialog konfirmasi kini berisi ringkasan. |
| Piutang & utang | B− | StatCard + penanda terlambat baik. Minus: kartu aging varian lokal keempat (`AgingCard`, label 9px), status pembayaran **teks polos** bukan badge, formulir cari manual (bukan `SearchForm`, tanpa ikon kaca pembesar), warna amber jatuh-tempo hex mentah sementara terlambat memakai token `destructive`. |
| Beban | B− | Pola form-di-atas-tabel konsisten. Minus: pill status manual lagi, dengan label campur bahasa — "Posted" (Inggris) di samping "Dibatalkan"; gaya void (abu-abu) berbeda dari halaman lain. |
| Kas & bank | B− | Daftar saldo rekening berupa list bersih. Minus: filter tanggal menyusut ke `h-7`/11px (varian ukuran filter ketiga), status transfer teks polos, keadaan kosong daftar rekening berupa `<li>` teks polos, bukan `EmptyState`. |
| Rekonsiliasi bank | C+ | Halaman paling tidak konsisten di modul: tabel buku besar **bespoke** (bukan `.data-table`, header tidak uppercase-muted, tanpa pola hover yang sama), status cocok memakai hijau **emerald Tailwind** (`bg-emerald-500/10 text-emerald-700`) — bukan palet rumah (#256b3a/#e7f3ea), label filter bergaya lain (11px polos, bukan uppercase muted), keadaan kosong baris jurnal berupa paragraf polos. |
| Payroll — daftar | B− | StatCard rapi; pill status aktif karyawan manual lagi (pola berulang). |
| Kasbon / Pinjaman | B | Sepasang halaman kembar yang konsisten satu sama lain; `StatusBadge` dipakai. |
| Aset tetap | B | `StatusBadge` + label status domain; pola kartu standar. |
| Reimbursement (klaim) | B | Konsisten dengan aset/kasbon. |
| HR (absensi/cuti/lembur) | B− | `EmptyState` konsisten; visual mengikuti pola panel bersama. |
| Pengaturan (akuntansi: pemetaan, pajak, termin) | C+ | Satu halaman sangat panjang; judul seksi konsisten (13px semibold) tetapi tombol-tombol kecil `h-7` menjadi varian ukuran keempat, dan tanpa hierarki visual yang membedakan seksi kritis (pemetaan akun) dari seksi kosmetik (nota). Kelompok pemetaan berlabel Indonesia (Tahap 4) membantu, tampilannya tetap daftar panjang. |

## Temuan

### P1 — merusak kesan profesional secara langsung

**RD2U-01 (POLA-BERBEDA) — Empat varian kartu metrik untuk konsep yang sama.**
`StatCard` bersama (label 11px uppercase, nilai 20px, ikon berwarna) dipakai
13 berkas, tetapi jurnal membuat `SummaryCard` lokal (label 10px, nilai 16px,
tanpa ikon — `jurnal/page.tsx:192`), buku besar membuat `MiniMetric` lokal
(label 9px, nilai 13px, radius lebih kecil — `buku-besar/page.tsx` akhir
berkas), dan piutang-utang membuat `AgingCard` lokal. Pengguna yang berpindah
halaman melihat angka ringkasan dalam tiga ukuran dan tiga gaya — inilah
sumber utama rasa "tidak didesain".

**RD2U-02 (DESAIN-TIDAK-KONSISTEN) — Status dirender dengan empat bahasa
visual.** (1) `StatusBadge` bersama (jurnal, kasbon, aset, klaim); (2) pill
manual dengan kelas disalin-tempel (akun, beban, payroll, period-manager —
padahal status `active`/`inactive`/`void` sudah ada di `StatusBadge`); (3)
teks polos tanpa pill (status pembayaran piutang/utang, status transfer bank
"Tercatat/Dibatalkan"); (4) hijau emerald Tailwind di rekonsiliasi. Label ikut
tidak seragam: beban menampilkan "Posted" berbahasa Inggris di halaman yang
selebihnya Indonesia. Warna void pun tiga macam: badge merah, pill abu-abu,
baris `opacity-60` + coret.

**RD2U-03 (TANPA-HIERARKI / keterbacaan) — Skala teks turun sampai 9–10px
untuk konten yang dibaca terus-menerus.** 13 ukuran huruf berbeda di modul;
label metrik 9px (`MiniMetric`, `AgingCard`), tanggal & angka mutasi buku
besar 11px, label status 10px uppercase, keterangan tabel 11–12px di atas
warna `muted-foreground`. Kekompakan ala Odoo memang disengaja (AGENTS.md),
tetapi Odoo menahan lantai ukuran pada teks primer; di sini teks sekunder
yang tenggelam (muted di atas `bg-muted/40`) membuat angka terasa "belum
selesai didesain" dan melelahkan untuk pekerjaan akuntansi berdurasi lama.

**RD2U-04 (POLA-BERBEDA) — Tiga varian bilah filter.** Pola resmi
`SearchForm` (input 13px + ikon cari + tombol "Cari" h-8) di jurnal/buku
besar/akun; formulir manual tanpa ikon cari di piutang-utang & beban (tombol
11px, label "Cari"/"Terapkan" bergantian untuk aksi yang sama); dan filter
bank yang menyusut ke `h-7` + teks 11px. Setiap halaman terasa beda produk.

**RD2U-05 (DESAIN-TIDAK-KONSISTEN) — Rekonsiliasi bank hidup di luar sistem
desain.** Tabel bespoke, hijau emerald, label filter bergaya sendiri,
keadaan kosong paragraf polos — halaman ini sendirian cukup menjelaskan
keluhan pengguna. (Detail di tabel nilai.)

### P2 — terasa oleh pengguna teliti, menggerogoti kredibilitas

**RD2U-06 (DESAIN-TIDAK-KONSISTEN) — Palet warna hidup sebagai hex mentah
yang disalin antar-berkas.** ±15 nilai hex unik dan 60+ pemakaian inline di
halaman/komponen akuntansi (#256b3a ×16, #8a5a12 ×7, dst.) di luar token
desain; `StatCard`/`StatusBadge` mendefinisikannya lagi secara terpisah;
grafik membawa palet hex ketiganya (`charts.tsx`, termasuk #3c567f & #c28b36
yang tidak muncul di tempat lain). Satu perubahan warna merek harus berburu
puluhan berkas, dan drift tinggal menunggu waktu.

**RD2U-07 (DETAIL-HILANG) — Nol transisi mikro di seluruh modul.** Pencarian
`transition*` di `src/app/app/akuntansi`, `src/components/akuntansi`, dan
`src/components/blocks` menghasilkan **0 hasil**: hover tombol/baris berubah
seketika tanpa `transition-colors`, tidak ada keadaan `:active`, tautan
hanya mengandalkan underline. Shell samping punya `transition-colors` —
kontennya tidak. Kesan akhirnya "statis", ciri khas UI yang belum dipoles.

**RD2U-08 (DETAIL-HILANG) — `EmptyState` tidak pernah dipakai dalam bentuk
dirancangnya.** Komponen bersama mendukung ikon lingkaran + tombol aksi,
tetapi dari 21 pemakaian di akuntansi, **nol** yang mengisi prop `icon` atau
`action` — semuanya judul + satu kalimat. Beberapa tempat bahkan tidak
memakainya: daftar rekening bank kosong (teks `<li>` polos), baris jurnal
rekonsiliasi kosong (paragraf polos), dan bagan akun saat pencarian kosong
(tidak ada keadaan kosong sama sekali). Keadaan kosong adalah momen pertama
pengguna baru — saat ini ia tampil sebagai halaman yang "kosong", bukan
yang "mengundang mulai".

**RD2U-09 (POLA-BERBEDA) — Satu skeleton untuk semua bentuk halaman.**
`loading.tsx` modul memakai `PageSkeleton` yang sama (4 kartu statistik +
tabel) untuk semua halaman termasuk formulir jurnal baru dan detail jurnal
sempit `max-w-3xl` — sesaat sebelum muat, tata letak melompat. Skeleton ada
(nilai plus), tetapi tidak mencerminkan halaman tujuannya.

**RD2U-10 (DESAIN-TIDAK-KONSISTEN) — Lebar kontainer berubah-ubah tanpa
aturan yang terbaca.** Halaman daftar & formulir memakai lebar penuh main
(`px-3..7`), detail jurnal & cetaknya menyempit `max-w-3xl` di tengah,
formulir jurnal baru memakai grid aside 320px. Masing-masing masuk akal
sendiri-sendiri; tanpa pola yang dinyatakan, perpindahan antar-halaman
terasa seperti berganti aplikasi.

**RD2U-11 (DETAIL-HILANG) — Ikon navigasi dipakai ulang untuk menu berbeda.**
Di `src/lib/modules.ts`: `Landmark` ×3 (Bank, Rekonsiliasi bank, Pinjaman),
`Building2` ×2 (Aset tetap, Bagan akun), `FileBarChart` ×2 (Buku besar,
Laporan), `ReceiptText` ×2 (Beban, Reimbursement). Menu samping adalah peta
utama modul; ikon kembar melemahkan pemindaian sekilas.

**RD2U-12 (POLA-BERBEDA) — Pola bersama hidup sebagai salin-tempel, bukan
komponen.** Konstanta `labelClass` yang identik disalin ke **16 berkas**
komponen akuntansi; gaya fokus terbagi tiga varian (`focus:border-ring`
saja ×18, `focus:ring…` ×6, SearchForm memakai ring penuh) sehingga
penanda fokus keyboard tidak seragam antar-formulir. Hari ini tampilannya
sama; tanpa sumber tunggal, ia akan menyimpang seperti kartu metrik.

### P3 — poles terakhir

**RD2U-13 (TANPA-HIERARKI)** — Judul seksi datar: semua tingkat memakai
13px semibold (kepala kartu, judul panel, judul seksi pengaturan), dan
judul di dalam kartu turun ke 12px (`AgingCard`) — dekat sekali dengan
ukuran isi 11–12px, sehingga struktur halaman sulit dipindai dari jauh.

**RD2U-14 (DETAIL-HILANG)** — Grafik beranda memakai isian gradasi area
(`charts.tsx`) — halus, tetapi AGENTS.md melarang bahasa gradasi generik;
sumbu grafik 10px ikut tren teks mini; tooltip bergaya sendiri (radius 8,
11px) di luar pola kartu.

**RD2U-15 (DESAIN-TIDAK-KONSISTEN)** — Glyph teks berperan sebagai ikon:
"↳" untuk indentasi COA, "✓" pada panel keseimbangan jurnal, "•" sebagai
bullet panduan — bercampur dengan ikon Lucide yang dipakai di tempat lain.

**RD2U-16 (DETAIL-HILANG)** — Tombol & label aksi tidak satu ukuran/bahasa:
standar h-8, tetapi pengaturan & sebagian panel memakai h-7; filter yang
sama dilabeli "Cari" di satu halaman dan "Terapkan" di halaman lain.

**RD2U-17 (DESAIN-TIDAK-KONSISTEN)** — Kelas permukaan bersama `.sheet` /
`.sheet-header` / `.sheet-body` terdefinisi di `globals.css` tetapi dipakai
**0 berkas** akuntansi; semua halaman menulis ulang `rounded-lg border
border-border bg-card`, dengan radius menyimpang sesekali (rounded-lg 82×
vs rounded-xl 11×). Sistem permukaannya ada di atas kertas saja.

## 10 cacat desain paling terasa (urutan dampak ke pengguna)

1. Kartu metrik empat varian — angka ringkasan beda gaya di tiap halaman (RD2U-01).
2. Status empat bahasa visual + label "Posted" berbahasa Inggris (RD2U-02).
3. Teks 9–11px untuk label & angka yang dibaca seharian (RD2U-03).
4. Rekonsiliasi bank tampil seperti modul lain yang menempel (RD2U-05).
5. Bilah filter tiga varian ukuran & gaya (RD2U-04).
6. Keadaan kosong selalu polos tanpa ikon/aksi; satu halaman tanpa keadaan kosong sama sekali (RD2U-08).
7. Warna hex mentah tersebar; hijau status tidak bersumber token (RD2U-06).
8. Tanpa satu pun transisi hover/aktif — UI terasa statis (RD2U-07).
9. Lebar halaman melompat antara daftar lebar penuh dan detail sempit (RD2U-10).
10. Ikon menu kembar & glyph teks pengganti ikon (RD2U-11, RD2U-15).

## Yang sudah meyakinkan (jangan diutak-atik tanpa bukti)

- **Formulir jurnal baru (A−)** — panel keseimbangan langsung, pola cepat,
  peringatan periode sebelum submit, alasan tombol nonaktif yang selalu
  terlihat: ini standar yang seharusnya ditiru halaman lain.
- **Beranda akuntansi (B)** — satu-satunya halaman yang terasa "dirancang
  sebagai produk": hierarki KPI → grafik → daftar jatuh tempo jelas.
- **Detail jurnal (B+)** — diperlakukan sebagai dokumen, lengkap dengan
  banner konteks dan tautan dokumen asal.
- **Fondasi bersama yang benar-benar ada**: `PageHeader`, `.data-table`
  (header uppercase muted, hover baris, tabular-nums via `.num`),
  `formatIDR`/`formatDate` yang dipakai konsisten untuk angka & tanggal,
  dan `PageSkeleton` — masalahnya bukan fondasi, melainkan halaman-halaman
  yang berhenti memakainya di tengah jalan.
- **Pasangan kasbon/pinjaman & aset/klaim** membuktikan pola kembar yang
  konsisten itu mungkin di repo ini.
