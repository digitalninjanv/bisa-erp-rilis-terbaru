# Arah Desain A-25 — Rombak UI/UX & Workflow Akuntansi, Gudang, HR, Pengaturan

**Status:** dokumen arah (Riset-2). Bukan kode. Eksekusi mengikuti urutan di §5.
**Cakupan:** modul Akuntansi, Gudang, HR, Pengaturan. **POS tidak termasuk** (lihat risiko §6).
**Bukti dasar:** screenshot keadaan kini di `~/workspace/bukti-menu/` (76 berkas),
`src/app/globals.css`, `src/components/ui/*` (shadcn v4/Base UI), `src/components/blocks/*`,
`src/components/shell/module-shell.tsx`. Referensi luar: catatan rilis Odoo 19
(odoo.com/odoo-19-release-notes), Frappe Framework v16 Desk UI, pola dashboard Accurate Online.

Prinsip penguasa dari pengguna: **SIMPEL, mudah dipakai semua peran termasuk non-teknis,
yang tidak penting disembunyikan (progressive disclosure), acuan utama Odoo.**
Semua usulan di dokumen ini bisa dibangun di atas stack yang ada — Next.js + Tailwind 4
(`@theme inline` + variabel CSS) + shadcn/Base UI + komponen `blocks/` yang sudah hidup.
Tidak ada usulan ganti framework, ganti font, atau pustaka UI baru.

---

## 1. Diagnosis — kenapa tampilan kini terasa "jelek"

Diagnosis ini menunjuk bukti, bukan selera. Nomor berkas merujuk folder `bukti-menu/`.

1. **Palet kusam menyeluruh.** Sidebar `#2c1e28` (ungu-cokelat sangat gelap), primer
   `#714b67` (plum pudar), latar krem `#f7f5f2`, garis `#e4ded7`. Semua warna berkontras
   rendah dan bernada "debu" — kombinasi ini terbaca tua dan kotor di semua layar
   (semua berkas). Warna status pastel (plum/teal/amber/red/green versi soft) dipakai
   sebagai cip ikon dekoratif di hampir semua kartu statistik, sehingga warna kehilangan
   makna: semuanya berwarna = tidak ada yang menonjol.
2. **Semua permukaan berbobot sama.** Kartu statistik, kartu tabel, kartu form, panel
   samping — semuanya kotak putih radius sama, border hairline sama, tanpa bayangan.
   Tidak ada hierarki kedalaman; halaman terbaca sebagai tumpukan kertas lepas
   (`02-gudang/beranda.png`, `03-akuntansi/beranda.png`).
3. **Beranda modul menenggelamkan pengguna.** Beranda Akuntansi menumpuk 9 kartu
   Input Cepat + 5 kartu Antrean Kerja + 8 kartu Ringkasan + 2 grafik + status neraca
   + 2 tabel dalam satu gulir sangat panjang; angka yang tampil justru didominasi
   "Rp 0" (`03-akuntansi/beranda.png`). Beranda Gudang membiarkan panel "Gudang aktif"
   dan "Dokumen terakhir" (kosong) memakan kolom kanan sementara tabel pergerakan
   mendominasi tanpa konteks antrean kerja.
4. **Satu halaman, banyak tugas yang tidak berhubungan.** Halaman Produk memuat daftar
   produk 30 baris **plus** pengelola Kategori **plus** pengelola Satuan dalam satu
   gulir raksasa (`02-gudang/produk.png`). Pengguna yang hanya mau cek harga harus
   melewati dua panel master data yang jarang disentuh.
5. **Aksi baris selalu tampil dan berisik.** Setiap baris tabel produk menampilkan
   tombol "Nonaktifkan" dan "Hapus" permanen; pola serupa berulang di kategori/satuan.
   Kolom AKSI menjadi elemen paling ramai di tabel, padahal aksi itu jarang dipakai
   dan salah satunya destruktif.
6. **Pengaturan adalah dinding form.** ±25 field dalam satu halaman, teks penjelasan
   2–4 baris di bawah **hampir setiap** field, navigasi ganda yang isinya sama persis
   (sidebar 10 item **dan** deretan pill tab), tombol Simpan hanya di dasar halaman —
   perubahan mudah hilang dan pengguna non-teknis takut menyentuh apa pun
   (`05-pengaturan/beranda.png`). Pola simpan tidak konsisten: Pengaturan memakai
   satu Simpan global, Organisasi HR memakai tombol Simpan di **setiap baris**
   (`04-hr/hr.png`).
7. **Label mikro huruf kapital di mana-mana.** Label form, header tabel, label kartu,
   dan eyebrow halaman semuanya `10–11px uppercase tracking-wide`. Hasilnya teks yang
   paling sering dibaca justru yang paling kecil dan paling sulit dibaca, dan halaman
   terasa "berteriak pelan" (`field-classes.ts`: label resmi memang 10px uppercase).
8. **Panel bantuan permanen memakan layar.** Form jurnal manual kehilangan ±25% lebar
   untuk panel "Panduan singkat" yang selalu terbuka, dan spanduk merah muda
   "Belum seimbang — selisih Rp 0" tampil **sebelum pengguna mengetik apa pun** —
   alarm palsu yang melatih pengguna mengabaikan peringatan sungguhan
   (`03-akuntansi/jurnal-baru.png`).
9. **Keadaan kosong terlihat rusak.** Grafik tanpa data dirender sebagai kotak putih
   raksasa dengan satu kalimat di tengah ("Belum ada penjualan bulan ini."),
   kartu antrean yang nol tetap ditampilkan basi ("Tidak ada kredit tersedia" dengan
   tautan mati). Kosong diperlakukan sebagai kegagalan render, bukan keadaan normal.
10. **Cangkang tidak skalabel & tidak informatif.** Pengalih modul berupa segmented
    control sempit 4 tombol di dalam sidebar gelap; tidak ada lencana jumlah antrean
    di menu (klaim menunggu, peninjauan offline); breadcrumb di topbar mengulang
    informasi yang sudah diberikan judul halaman; tidak ada tombol "Buat" global.
11. **Kepadatan tidak konsisten.** Tabel resmi `py-2` (baris ±33px, teks 12–13px) terasa
    sesak di daftar master, sementara kartu dan form sangat lapang. Tidak ada aturan
    kepadatan per jenis permukaan — masing-masing halaman menebak sendiri.
12. **Status dokumen lemah.** Dokumen terposting hanya ditandai badge kecil; tidak ada
    penanda tahap alur (Draf → Terposting → Lunas/Selesai) seperti status bar Odoo,
    sehingga langkah berikutnya pada dokumen tidak terbaca dari halamannya
    (`02-gudang/dokumen-detail.png` sebenarnya sudah rapi strukturnya — yang kurang
    adalah penanda tahap + satu aksi utama yang jelas).

Yang **sudah baik dan dipertahankan**: struktur halaman detail dokumen (meta grid +
tabel baris + jurnal terkait), pola cepat jurnal manual, Mode Operasi scan-first gudang,
komponen bersama `blocks/` (PageHeader, StatCard, EmptyState, StatusBadge, SearchForm,
Pagination, ConfirmDialog, document-journals, audit-history), token nada `--tone-*`
satu sumber, disiplin cetak (`.report-print`, garis total `rule-total`/`rule-final`).

---

## 2. Bahasa desain baru

### 2.1 Palet warna (token — menggantikan nilai di `globals.css` `:root`)

Prinsip: **netral terang bersih + satu warna merek yang dipakai hemat.** Plum
dipertahankan sebagai merek (ia juga warna primer Odoo), tetapi tidak lagi menjadi
warna sidebar, warna cip dekoratif, dan warna latar sekaligus.

| Token | Lama | Baru | Pemakaian |
|---|---|---|---|
| `--background` | `#f7f5f2` (krem) | `#f4f5f7` | Latar aplikasi — abu netral sangat terang, bukan krem |
| `--card` | `#ffffff` | `#ffffff` | Permukaan kartu (tetap) |
| `--foreground` | `#241f1b` | `#1d2129` | Teks utama — netral dingin, kontras 15,8:1 |
| `--muted-foreground` | `#6f675f` | `#5b6472` | Teks sekunder — lulus 4,5:1 pada putih di 12px+ |
| `--border` | `#e4ded7` | `#e2e5ea` | Garis kartu & tabel |
| `--input` | `#ddd6cd` | `#c9d0d9` | Border field — sengaja lebih tegas dari border kartu |
| `--primary` | `#714b67` | `#714b67` | **Tetap.** Hanya untuk: tombol utama, keadaan aktif, tautan penting |
| `--primary-hover` (baru) | — | `#5e3d55` | Hover tombol utama |
| `--primary-soft` (baru, = `--tone-plum-soft` diperluas) | `#f1e8ee` | `#f3eaf1` | Latar item navigasi aktif, cip terpilih |
| `--accent` | `#e8f2ef` / `#0d6b60` | tetap | Sorotan teal sekunder (status sehat, grafik) |
| `--destructive` | `#b42318` | tetap | Hanya aksi destruktif & error |
| Nada sukses | `--tone-green #256b3a` / soft `#e7f3ea` | tetap | Status selesai/lunas |
| Nada peringatan | `--tone-amber #8a5a12` / soft `#fbf0dd` | tetap | Jatuh tempo dekat, stok menipis |
| Nada bahaya | `--tone-red #a3362a` / soft `#fbe9e7` | tetap | Terlambat, stok habis, selisih |
| **Nada info (baru)** | — | `--tone-blue #175cd3` / soft `#eaf1fe` | Status informasional netral (draf, dalam perjalanan) |
| `--sidebar` | `#2c1e28` (gelap) | `#ffffff` | **Sidebar menjadi terang** (pola Odoo 19 & Frappe v16) |
| `--sidebar-foreground` | `#f3ede8` | `#2a2f38` | Teks menu |
| `--sidebar-accent` | `#3b2a36` | `#f3eaf1` | Latar item aktif (= primary-soft) |
| `--sidebar-border` | `#443140` | `#e2e5ea` | Garis kanan sidebar |
| `--ring` | `#714b67` | `#714b67` | Fokus (tetap) |
| `--chart-1..5` | plum/teal/amber/slate/terracotta | tetap | Sudah cukup kontras di atas putih |

Aturan pemakaian warna (mengikat):
- Warna nada (teal/amber/red/green/blue) **hanya** untuk makna status & data, tidak
  lagi cip ikon dekoratif di kartu statistik. Ikon kartu statistik satu gaya:
  kotak 28px `--muted` dengan ikon `--muted-foreground`.
- Maksimal satu elemen `--primary` solid per viewport selain tombol utama halaman.
- Mode gelap (`.dark`) disesuaikan nilainya mengikuti netral baru di fase fondasi;
  sidebar gelap lama dihapus dari tema terang. (Mode gelap bukan fitur yang dijanjikan
  ke pengguna saat ini — tokennya dijaga tidak rusak, bukan dipoles.)

### 2.2 Tipografi & skala

Font tetap **Inter** (sudah dimuat) + Geist Mono hanya untuk struk/cetak.
Perubahan kunci: **menghapus huruf kapital mikro sebagai gaya bawaan.**

| Elemen | Aturan baru |
|---|---|
| Judul halaman (h1) | 20px / 600 / tracking −0,01em (turun dari 22px) |
| Judul seksi/kartu (h2) | 14px / 600, sentence case |
| Teks isi | 13px / 400, line-height 1,55 |
| Teks tabel | 13px; angka `.num` tabular (tetap) |
| Label form | **13px / 500, sentence case** (menggantikan 10px uppercase di `field-classes.ts`) |
| Teks bantuan form | 12px `--muted-foreground`, hanya bila benar-benar membantu |
| Header kolom tabel | 11px / 600 uppercase tracking 0,06em `--muted-foreground` (satu-satunya uppercase yang dipertahankan — terbukti mudah dipindai) |
| Label kartu statistik | 12px / 500 sentence case (bukan uppercase) |
| Nilai kartu statistik | 24px / 600 (naik dari 20px — angka adalah isi utama kartu) |
| Lantai ukuran | Tidak ada teks di bawah 11px di mana pun, termasuk badge |
| Eyebrow halaman | **Dihapus.** Judul + deskripsi maksimal 1 baris; konteks modul sudah diberikan sidebar & breadcrumb |

### 2.3 Radius, bayangan, garis

- `--radius` tetap 0.55rem sebagai basis; pemakaian distandarkan: field & tombol
  `rounded-lg` (±9px), kartu `rounded-xl` (12px), dialog `rounded-2xl` (16px),
  badge/cip `rounded-full`.
- Bayangan diperkenalkan sebagai skala resmi (saat ini praktis nol):
  `--shadow-card: 0 1px 2px rgb(29 33 41 / 0.05)` untuk semua kartu;
  `--shadow-pop: 0 8px 24px -6px rgb(29 33 41 / 0.12), 0 2px 6px rgb(29 33 41 / 0.06)`
  untuk dropdown, dialog, dan bilah aksi menempel (sticky bar).
- Kartu = border `--border` + `--shadow-card`. Tidak ada kartu di dalam kartu:
  seksi di dalam kartu dipisah garis, bukan kotak bersarang (penyebab utama kesan
  "tumpukan kotak" di beranda akuntansi).

### 2.4 Kepadatan & spasi

Skala spasi 4px. Dua tingkat kepadatan resmi, dipilih per jenis permukaan:

| Permukaan | Kepadatan |
|---|---|
| Tabel daftar & master (produk, jurnal, karyawan…) | **Nyaman:** baris 40px (`py-2.5`), teks 13px |
| Tabel laporan keuangan & buku besar | **Kompak:** baris 32px (`py-1.5`) — angka padat memang dibaca membandingkan, dan aturan cetak laporan tidak berubah |
| Kartu | padding 20px (`p-5`); kartu statistik `p-4` |
| Form | jarak antar-field 16px; antar-seksi 24px; field `h-9` (36px, naik dari `h-8` — target sentuh & klik lebih aman) |
| Halaman | padding `px-6 py-6`; lebar konten penuh, khusus halaman form & pengaturan dibatasi 1240px agar baris form tidak melebar tak terbaca |
| Tombol | bawaan `h-9` teks 13px; `sm h-8` untuk toolbar tabel; `xs h-7` hanya di dalam baris tabel |

### 2.5 Cangkang: sidebar & header

**Sidebar terang 248px** (dari 232px gelap), dapat dilipat menjadi rel ikon 64px
(pola sidebar Odoo 19; memakai komponen `Sheet` untuk <lg yang sudah ada):
- Puncak: blok perusahaan — logo "b" dalam kotak `--primary`, nama perusahaan,
  dan **pengalih aplikasi** berupa tombol lebar berisi ikon + nama modul aktif +
  chevron; membuka daftar 5 modul (POS, Gudang, Akuntansi, HR, Pengaturan) dengan
  ikon 20px & nama. Menggantikan segmented control 4 tombol.
- Grup menu seperti sekarang (grup dipertahankan — strukturnya sudah benar),
  label grup 11px uppercase `--muted-foreground`, item tinggi 34px radius 8px,
  ikon 16px. Item aktif: latar `--primary-soft`, teks `--primary`, bilah kiri 3px
  `--primary`. Item nonaktif hover `--muted`.
- **Lencana antrean** di item yang punya pekerjaan menunggu (angka kecil pill
  `--tone-red-soft`/`--tone-amber-soft`): Peninjauan offline (POS dikecualikan —
  hanya modul dalam cakupan yang diberi lencana di A-25), Klaim, Persetujuan PR,
  Opname jatuh tempo. Ini meminjam "activity stream" Odoo 19 dalam bentuk paling
  sederhana yang bisa dibangun dari data yang sudah ada.
- Dasar: kartu pengguna (avatar inisial, nama, peran) + tautan Pengaturan.
  "Beranda modul" dihapus — beranda modul dicapai dari pengalih aplikasi & logo.

**Topbar 56px putih** (dari 52px), isi kiri→kanan: tombol lipat sidebar (mobile),
judul konteks ringkas (nama modul — bukan breadcrumb dua tingkat), kolom pencarian
global Ctrl+K diperlebar (`w-80`, sudah ada komponen `command`), tombol
**Buat ▾** primer (menu dokumen tersering lintas modul: Penerimaan, PO, Beban,
Jurnal, Karyawan — tunduk izin peran), pengalih perusahaan (sudah ada),
avatar + menu pengguna. Sticky dengan `--shadow-card` saat menggulir.

### 2.6 Komponen: kartu, tabel, form, tombol, dialog

- **Kartu statistik:** label 12px, nilai 24px, satu baris konteks di bawah nilai
  (perbandingan periode lalu dengan cip ▲▼ nada sesuai makna — akurat hanya bila
  datanya ada; tanpa data pembanding tampilkan konteks faktual, bukan cip palsu).
  Kartu yang bisa diklik (menuju daftar tersaring) mendapat hover border `--ring/40`
  + chevron. Maksimal 4 kartu sebaris di beranda modul.
- **Tabel:** header latar `--muted/50`; **seluruh baris bisa diklik** menuju detail
  (kursor pointer, hover sudah ada); kolom aksi menyusut menjadi **satu tombol ⋯**
  berisi menu (Ubah, Duplikat, Nonaktifkan, —, Hapus berbatas konfirmasi).
  Pilihan massal: checkbox memunculkan **bilah aksi massal menempel** di atas tabel
  (jumlah terpilih + aksi), bukan tombol yang selalu tampil. Kolom angka rata kanan
  tabular; kolom status memakai `StatusBadge` terpusat (§3.10).
- **Form:** label di atas field; teks bantuan dipindah ke ikon ⓘ tooltip untuk
  field yang penjelasannya panjang (Pengaturan: penjelasan tetap terlihat hanya
  untuk field berisiko — stok negatif, ambang persetujuan; sisanya tooltip).
  Error: border `--destructive` + pesan 12px di bawah field, ringkasan error di
  puncak form yang bisa diklik menuju field. Seksi opsional = `Accordion`/`<details>`
  bertajuk "Opsi lanjutan", tertutup bawaan.
- **Tombol:** tepat **satu tombol primer solid per halaman** (§4.2); sekunder
  `outline`; tersier `ghost`; destruktif tidak pernah tampil sebagai tombol merah
  di baris tabel — hanya di dalam menu ⋯ dan dialog konfirmasi. Varian & ukuran
  memakai `buttonVariants` yang sudah ada (default/sm/xs), diselaraskan ke h-9/h-8/h-7.
- **Dialog:** radius 16px, `--shadow-pop`, judul 15px/600 + tombol tutup; lebar:
  konfirmasi 420px, form 560px, form lebar 720px. Kaki dialog: Batal (ghost) kanan,
  aksi utama paling kanan. Konfirmasi destruktif menyebut nama objek ("Hapus produk
  Aqua 600ml?") dan memakai `ConfirmDialog` bersama yang sudah ada.
- **Drawer (Sheet kanan 480px):** pola resmi untuk buat/ubah master data cepat
  (produk, kategori, satuan, pemasok, karyawan ringkas) tanpa meninggalkan daftar —
  meminjam pola sidebar detail Frappe/ERPNext. Halaman penuh hanya untuk dokumen
  transaksi & form yang memang panjang.
- **Toast:** tetap Sonner; toast sukses pembuatan dokumen wajib membawa aksi
  "Lihat" menuju dokumennya.

---

## 3. Pola komponen bersama — dibangun sekali, dipakai semua modul

Semua dibangun sebagai evolusi `src/components/blocks/` (bukan folder baru),
mengikuti ratchet yang sudah berlaku: halaman tidak mengarang pola sendiri.

1. **`DataList`** — pola daftar resmi. Komposisi: toolbar (pencarian `SearchForm` +
   tombol **Filter** tunggal membuka popover berisi semua filter — pola ERPNext,
   menggantikan deretan select yang selalu tampil), area tabel `.data-table`
   kepadatan nyaman, bilah aksi massal, `Pagination`, `EmptyState` di dalam bingkai
   tabel, dan skeleton `PageSkeleton` saat memuat. Mendukung saklar daftar/kartu
   untuk daftar yang memang visual (produk, karyawan).
2. **`PageHeader` v2** — evolusi blocks yang ada: tanpa eyebrow; judul 20px;
   deskripsi ≤1 baris; slot kanan = satu aksi primer + menu ⋯ aksi sekunder.
3. **`MetricStrip`** — evolusi `StatCard`: maksimal 4 metrik, nilai 24px,
   konteks/perbandingan jujur, bisa diklik menuju daftar tersaring.
4. **`WorkQueue`** — kartu antrean kerja resmi untuk beranda modul: judul pekerjaan,
   jumlah + nilai, satu CTA. Antrean nol **tidak dirender** (menghapus kartu basi
   "Tidak ada kredit tersedia"). Dipakai di beranda Akuntansi (piutang terlambat,
   utang jatuh tempo, klaim menunggu), Gudang (opname jatuh tempo, stok menipis,
   PR menunggu persetujuan), HR (klaim/kasbon/cuti menunggu persetujuan).
5. **`DocumentPage`** — pola detail dokumen resmi (menyatukan yang sudah baik di
   dokumen gudang): kepala = nomor dokumen besar + **StatusSteps** (penanda tahap
   horizontal: Draf → Terposting → Selesai/Lunas, tahap aktif berwarna primer,
   pola status bar Odoo) + aksi utama langkah berikutnya + Cetak + menu ⋯;
   badan dua kolom: kiri tabel baris & total, kanan rel 320px berisi meta dokumen,
   `DocumentJournals` (sudah ada), dan `AuditHistory` (sudah ada) yang dilipat.
6. **`DocumentForm`** — pola form dokumen: kartu kepala (pihak, tanggal, gudang),
   editor baris bersama (pemilih produk dengan barcode burst yang sudah ada di
   gudang, qty, harga, hapus baris, "+ Tambah baris"), rel kanan ringkasan total
   yang menempel (sticky) — menggantikan panel bantuan permanen; bantuan pindah ke
   bagian "Panduan" yang **dilipat bawaan** di dasar rel. Bilah aksi menempel di
   dasar viewport: Batal (ghost) + Simpan draf (outline, bila dokumen mendukung
   draf) + satu primer ("Posting").
7. **`MasterSheet`** — drawer buat/ubah master data (§2.6): dua tingkat field —
   inti selalu tampil, sisanya di "Opsi lanjutan" tertutup.
8. **`SettingsLayout`** — pola Pengaturan resmi: sub-navigasi **vertikal kiri**
   (daftar seksi dengan ikon, menggantikan pill tab ganda), konten per seksi dalam
   kartu, **satu bilah Simpan menempel** yang hanya aktif & mencolok saat ada
   perubahan (dirty state), dan pencarian pengaturan di puncak. Berlaku juga untuk
   Organisasi & Pengaturan HR (menyatukan pola simpan yang kini berbeda).
9. **`WizardSteps`** — untuk alur bertahap yang memang panjang: indikator langkah
   di puncak (1 Tujuan — 2 Isi — 3 Tinjau), satu langkah per layar, langkah Tinjau
   merangkum sebelum posting. Dipakai: Impor data, Opname (buat → hitung → tinjau
   selisih → posting), Payroll (periode → tinjau pengecualian → posting & bayar),
   Tutup periode (daftar periksa akhir bulan yang sudah ada di T4 menjadi langkah).
10. **`StatusBadge` terpusat per jenis dokumen** — perluasan blocks yang ada:
    satu peta status→nada untuk semua dokumen (draf=blue, terposting=green,
    menunggu=amber, batal/void=red, selesai=green, sebagian=amber) agar status yang
    sama tidak berbeda warna antar-modul.
11. **`EmptyState` v2** — dua ukuran: penuh (ikon 40px, satu kalimat, satu tombol
    primer) dan **ringkas untuk panel/grafik** (bingkai dashed tinggi tetap 120px,
    teks 12px) — menghapus kotak putih raksasa pada grafik kosong.
12. **`ApprovalInbox`** — daftar persetujuan resmi: baris ringkas (jenis, pemohon,
    nilai, umur), aksi Setujui/Tolak inline dengan konfirmasi, dipakai HR
    (klaim/kasbon/cuti) dan Gudang (PR & penyesuaian di atas ambang) dan Akuntansi
    (klaim yang masuk antrean kerja).

---

## 4. Pola workflow

### 4.1 Aturan progressive disclosure (mengikat semua modul)

1. Field opsional/lanjutan selalu di balik "Opsi lanjutan" tertutup; field inti
   sebuah form dokumen ≤ 6.
2. Penjelasan panjang → tooltip ⓘ di samping label; teks bantuan permanen hanya
   untuk konsekuensi berisiko (maksimal 1 per seksi).
3. Aksi baris tabel → menu ⋯; aksi massal → muncul saat ada pilihan.
4. Beranda modul maksimal: 4 metrik + antrean kerja (yang tidak nol saja) +
   aktivitas/dokumen terbaru. Semua sisanya hidup di halaman modulnya.
5. Panduan & "cara kerja" → panel dilipat bawaan, atau tautan "Pelajari" —
   tidak pernah kolom permanen.
6. Pengaturan jarang (ambang persetujuan, pemetaan akun lanjutan) → seksi
   tertutup di `SettingsLayout`; yang tampil pertama hanya yang disentuh bulanan.
7. Peringatan konteks hanya tampil saat keadaannya benar (form jurnal tidak lagi
   berteriak "belum seimbang" saat kosong — indikator keseimbangan netral
   "Debit = Kredit" dan hanya memerah saat selisih ≠ 0 **dan** ada baris terisi).

### 4.2 Aturan aksi utama tunggal

Setiap halaman punya tepat satu tombol primer solid, ditentukan oleh jenis halaman:
daftar → "+ Baru/Buat"; detail dokumen → langkah alur berikutnya (Posting /
Terima / Bayar / Selesaikan); form → "Posting/Simpan"; beranda → tidak ada
(tombol Buat global di topbar mengambil peran itu); pengaturan → "Simpan"
pada bilah menempel. Semua aksi lain turun ke outline/ghost/menu ⋯.

### 4.3 Pengurangan langkah — 5 alur tersering per modul

Langkah dihitung dari membuka modul sampai hasil selesai. "Kini" = keadaan pada
screenshot & pola A-24; "Target" = sesudah pola §3–§4 diterapkan.

**Gudang**
| Alur | Kini | Target | Cara |
|---|---|---|---|
| Terima barang dari pemasok | ±7 (Beranda → Penerimaan → Baru → pilih sumber → pilih pemasok → tambah baris → posting) | 4 | Mode Operasi menjadi pintu utama: pindai PO/barcode membuka form penerimaan terisi; tombol primer global "Terima barang" di beranda & topbar Buat |
| Cek stok & harga satu produk | 3–4 (Produk → cari → gulir) | 1–2 | Ctrl+K menemukan produk + stok semua gudang di hasil pencarian; baris daftar menampilkan stok per gudang tanpa membuka detail |
| Opname berkala | ±6 (Opname → Buat → Lembar hitung → isi → tinjau → posting) | 3 langkah wizard | `WizardSteps` + tugas opname dari `WorkQueue` beranda langsung membuka langkah Hitung |
| Transfer antar gudang | ±5 | 3 | Aksi "Kirim ke gudang lain" dari kartu stok/detail produk membuka `DocumentForm` transfer terisi produknya |
| Tambah produk baru | ±5 + halaman tercampur panel kategori/satuan | 2 | `MasterSheet` 6 field inti dari daftar produk; kategori/satuan dibuat sebaris dari dropdown "+ Baru" — panel kategori/satuan pindah ke Pengaturan master/pengelolaan sendiri, keluar dari halaman Produk |

**Akuntansi**
| Alur | Kini | Target | Cara |
|---|---|---|---|
| Catat beban harian | 3–4 (Input Cepat → modal / menu Beban → form) | 2 | Buat ▾ global → "Beban": form 5 field inti, akun lawan terisi dari pemetaan, kategori terakhir dipakai diingat |
| Bayar utang pemasok | ±5 (Piutang & utang → cari tagihan → buka → bayar → konfirmasi) | 3 | Dari `WorkQueue` beranda / daftar utang: tombol "Bayar" membuka dialog bayar terisi penuh (FIFO seperti sekarang), satu konfirmasi |
| Terima pembayaran piutang | ±5 | 3 | Pola dialog yang sama dari daftar piutang & antrean "Piutang terlambat" |
| Buka laporan & telusur ke jurnal | 3 (Laporan → pilih → klik angka → jurnal) | 3 (dipertahankan, diperjelas) | Daftar laporan menjadi kartu berkelompok (Keuangan/Operasional/Pajak) dengan favorit terpin; drill-down yang sudah ada dipertahankan, target klik diperbesar |
| Jurnal manual | ±5 (Jurnal → Baru → pilih pola → isi baris → posting) | 3 | Pola cepat menjadi langkah 1 yang menonjol (kartu pola, bukan deretan pill kecil); panduan dilipat; indikator seimbang netral (§4.1.7) |

**HR**
| Alur | Kini | Target | Cara |
|---|---|---|---|
| Jalankan payroll bulanan | ±6 (Payroll → Jalankan → tunggu → buka run → periksa → bayar) | 3 langkah wizard | `WizardSteps`: Periode & komponen → Tinjau (hanya pengecualian ditampilkan: karyawan berubah gaji, absensi kosong) → Posting & bayar; slip terkirim dari langkah terakhir |
| Setujui klaim/kasbon/cuti | 3 menu terpisah, masing-masing ±3 | 2 | Satu `ApprovalInbox` "Persetujuan" di HR (lencana antrean di sidebar); setujui/tolak inline |
| Tambah karyawan | 1 form sangat panjang | 3 bagian dalam `MasterSheet` lebar / form berlangkah | Data diri → Pekerjaan & gaji → Bank & pajak (l
...[truncated 9113 chars]
## 5. Target sentuh primer (A-26 Q9, K-11) — daftar & keputusan sadar

Kontrak kualitas kode §3.2 meminta target sentuh ≥44px; dokumen ini
membatasinya secara sadar (keputusan konflik audit A-26 §3): **44px
hanya wajib untuk target sentuh PRIMER kasir & mobile** di daftar
bawah. Tabel padat desktop dan form desktop adalah permukaan mouse —
kepadatan Odoo yang disengaja sejak A-25 — dan seluruh permukaan
tetap memenuhi minimum WCAG 2.5.8 AA (24px). Ukuran diukur dari kelas
Tailwind di kode pada 2026-11-06 (h-11/size-11 = 44px, h-9 = 36px,
size-9 = 36px, size-8 = 32px, size-6 = 24px). Teknik perluasan area
tanpa mengubah visual mengikuti pola yang sudah dipakai komponen
shadcn repo (checkbox/switch): `relative` + `after:absolute
after:-inset-*`.

**Sudah ≥44px (terverifikasi di kode):**

| Target | Ukuran | Tempat |
|---|---|---|
| Tombol Bayar — panel pembayaran desktop | `h-11` = 44px | `components/pos/payment-panel.tsx` |
| Tombol Bayar — bar bayar mobile | `h-11` = 44px | `components/pos/terminal/mobile-pay-bar.tsx` |
| Kartu produk katalog (ketuk untuk tambah) | `min-h-[70px]`/`[92px]` | `components/pos/terminal/product-catalog.tsx` |

**Diperbaiki di Q9 (perubahan visual satu-satunya A-26, disahkan
RENCANA Q9):**

| Target | Sebelum | Sesudah | Cara |
|---|---|---|---|
| Stepper qty keranjang (−/+) | `size-6` = 24px | visual 36px, **area sentuh efektif 44×44px** | `size-9` + `after:-inset-1` di `components/pos/cart-panel.tsx`; input qty `h-9`. Baris keranjang bertambah 12px; grid halaman & panel tidak berubah |
| Tombol Hapus baris keranjang | ±22px (`p-1` + ikon 14px) | area sentuh 44×44px, visual sama | `after:-inset-[11px]` di berkas yang sama |
| Pemicu menu mobile (hamburger) | `size-8` = 32px | area sentuh 44×44px, visual sama | `after:-inset-1.5` di `components/shell/mobile-nav.tsx` |
| Baris menu drawer mobile | ±37px (`py-2`) | ≥44px | `min-h-11` di berkas yang sama |

**Keputusan sadar — tetap di bawah 44px, dengan alasan:**

| Target | Ukuran | Alasan |
|---|---|---|
| Chip uang cepat (10rb/20rb/50rb/100rb/Uang Pas) | ±25px | Baris `flex-wrap` rapat (`gap-1`) di panel pembayaran: perluasan area pseudo akan tumpang-tindih chip tetangga/baris sebelah dan menimbulkan salah-ketuk nominal uang — risiko salah uang lebih buruk daripada target kecil; menaikkan visual ke 44px mengubah tata letak panel. Kasir memilih chip dengan mouse/ketuk terarah di terminal desktop pada umumnya |
| Tombol Buka/Tutup Sesi & aksi sesi (`h-9`/`h-8`) | 36/32px | Halaman manajemen sesi adalah form desktop yang dipasangkan dengan field `h-9`; bukan permukaan sentuh primer. Dinaikkan seragam bila halaman sesi suatu saat dirombak untuk tablet |
| Aksi baris di daftar (`size-8`: `sale-row-actions`, `held-actions`) | 32px | Tabel padat desktop; tombol bertetangga rapat (`gap-1`) sehingga perluasan pseudo saling tumpang-tindih antar-aksi yang berbeda makna (termasuk aksi destruktif) |
| Tombol Diskon per baris keranjang | ±21px | Aksi sekunder per baris (bukan primer); bersebelahan langsung dengan total baris dan stepper — perluasan area akan menutupi keduanya |
| Field & tombol form umum (`h-9`) | 36px | Skala form tema A-25 untuk desktop; konsisten di semua modul dan di atas minimum WCAG AA |
| Baris sidebar desktop & topbar | ±36px | Permukaan mouse; versi mobile-nya adalah drawer di daftar perbaikan atas |
