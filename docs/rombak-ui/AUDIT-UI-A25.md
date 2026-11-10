# Audit UI/UX & Workflow — Program A-25, Tahap Riset-1

**Tanggal:** 6 November 2026 · **Auditor:** Senior UX Auditor (agen riset A-25) · **Status:** dokumen riset, bukan perubahan kode.

**Mandat:** pengguna menilai tampilan saat ini "jelek semuanya" dan memerintahkan rombak UI/UX + workflow tiap fitur untuk modul **Akuntansi, Gudang, HR, Pengaturan**. POS **tidak** termasuk (wilayah beku) dan tidak diaudit di sini.

> **STATUS AKHIR (U7, 6 November 2026):** status tutup per temuan (34 tertutup · 16 tertutup sebagian · 4 sisa terjadwal) beserta pengukuran workflow ulang dan angka gerbang final tercatat di `docs/rombak-ui/STATUS-TUTUP.md`.

**Metode & bukti.** Seluruh 66 screenshot keadaan saat ini di `~/workspace/bukti-menu/` dibaca satu per satu: 02-gudang (31), 03-akuntansi (19), 04-hr (12), 05-pengaturan (3), 00-beranda (1, konteks cangkang). Setiap temuan mengutip nama berkas screenshot sebagai bukti. Klaim workflow dilengkapi pemeriksaan kode terarah (struktur form, kondisi render, komponen bersama) — dirujuk seperlunya. Tidak ada kode yang diubah dalam tahap ini.

**Definisi tingkat.** **P1** = menyulitkan pekerjaan harian (angka menyesatkan, aksi inti tenggelam/terbalik, halaman kerja tak bisa dipakai efisien). **P2** = mengganggu (inkonsistensi, langkah berlebih, informasi penting terkubur, teks salah). **P3** = polesan (redundansi kecil, gaya, label).

**Batas kejujuran bukti.** Screenshot diambil dari baseline demo sesudah reseed: banyak daftar memang kosong, jadi temuan soal *empty state* menilai pengalaman pengguna baru/awal — keadaan yang benar-benar pertama dilihat pengguna. Temuan keadaan terisi bersumber dari halaman yang padat data (produk, nilai, pergerakan, bagan akun, piutang-utang, payroll). Perilaku dinamis (dialog, toast, hover) tidak dinilai kecuali terlihat di gambar/kode.

**Ringkasan jumlah temuan: 54** — P1: 12 · P2: 32 · P3: 10. Rincian per modul di §4; akar pola bersama di §2 (dirombak per pola dulu, baru per halaman).

---

## 1. Kesan keseluruhan: mengapa terasa "jelek"

Aplikasi ini tidak rusak per halaman — ia **seragam dengan cara yang salah dan tidak seragam dengan cara yang benar**:

1. **Satu templat untuk semua tugas.** Hampir setiap halaman adalah: judul besar + deskripsi tutorial 2–3 baris + 4 kartu KPI + satu kartu isi. Halaman cek saldo, halaman kerja pencocokan, halaman konfigurasi pajak, dan halaman master data semuanya memakai ritme yang sama, sehingga tidak ada halaman yang terasa dirancang untuk pekerjaannya.
2. **Teks menjelaskan, bukan antarmuka memandu.** Deskripsi halaman, sub-deskripsi kartu, teks *empty state*, dan panel panduan permanen memenuhi layar. Pengguna membaca paragraf untuk memahami tombol — tanda workflow tidak terbaca dari bentuknya.
3. **Pola yang seharusnya satu justru beranak.** Filter tampil dalam ≥4 varian (tombol "Cari"/"Saring"/"Terapkan"/"Tampilkan"; select vs chip pill vs tab), format tanggal dalam 3 varian, tata letak detail dokumen dalam 3 varian, tautan jurnal dalam 2 gaya.
4. **Identitas visual templat pastel.** Latar krem, sidebar ungu-plum, kartu putih radius besar, chip ikon warna pastel acak, dekorasi lingkaran pastel di kartu modul (`00-beranda/beranda.png`). Tidak ada hierarki visual yang membedakan "angka penting" dari "teks pelengkap" selain ukuran font.

---

## 2. Temuan POLA — akar masalah bersama (rombak per pola dulu)

### POLA-01 — P1 · Halaman menumpuk banyak fungsi, semua terbuka sekaligus
Satu halaman memuat form buat + form lain + daftar/riwayat, tanpa tab/lipatan/langkah. Pengguna harus melewati form yang tidak ia pakai untuk mencapai yang ia cari, dan aksi posting finansial selalu dalam keadaan aktif.
Bukti: `02-gudang/transfer.png` (form + riwayat), `02-gudang/opname.png` (form tugas + form hitung + riwayat), `04-hr/hr-absensi.png` (5 fungsi), `03-akuntansi/bank.png` (form transfer + setoran modal + saldo + riwayat), `04-hr/hr-cuti.png`, `02-gudang/produk.png` (produk + CRUD kategori + CRUD satuan).

### POLA-02 — P1 · Judul ganda + deskripsi tutorial di setiap halaman
Komponen `PageHeader` (dipakai 61 halaman) selalu diikuti kartu yang **berjudul sama** dengan deskripsi yang **mengulang** kalimat yang sama; deskripsi halaman sendiri berisi penjelasan konsep 2–3 baris (cara kerja retur, apa itu PO, apa itu rekonsiliasi). Setiap halaman membayar "pajak" ±120px teks sebelum konten.
Bukti: `02-gudang/penerimaan.png`, `02-gudang/pembelian.png`, `02-gudang/penyesuaian.png`, `02-gudang/retur-pembelian.png` (deskripsi 3 baris), `02-gudang/transfer.png`.

### POLA-03 — P1 · Format tanggal & waktu tidak seragam, sebagian mentah
Tiga varian hidup berdampingan: tampilan terformat "06 Nov 2026"; tanggal ISO mentah "2026-11-02"/"2026-04-01" di tabel (`02-gudang/pemasok-detail.png`, `04-hr/karyawan-detail.png`); dan input tanggal native browser format AS "mm/dd/yyyy" dengan penampung waktu 12-jam yang terpangkas "08:00 A" (`02-gudang/opname.png`, `02-gudang/pergerakan.png`, `03-akuntansi/jurnal.png`, `04-hr/hr-absensi.png`). Format AS pada input adalah risiko salah input nyata bagi pengguna Indonesia.

### POLA-04 — P1 · Angka kritis dirender tanpa format manusiawi
- Kuantitas di detail Purchase Request dirender mentah `{line.qty}` (`src/app/app/gudang/purchase-request/[id]/page.tsx:92`) sehingga qty 1 tampil **"10000"** — padahal `formatQty` yang benar ada dan dipakai halaman lain (`src/lib/money.ts:87`). Bukti: `02-gudang/purchase-request-detail.png`.
- Uang statutori di Payroll Indonesia tampil desimal mentah 4 angka tanpa pemisah ribuan — "12000000.0000" sampai **terpotong kolom** ("12000000.000("), PTKP "58500000.0000", persen "4.0000". Bukti: `05-pengaturan/payroll-indonesia.png`.
- Saldo nol akun kredit tampil "-Rp 0" berulang (`03-akuntansi/akun.png`); saldo hari cuti tampil 2 desimal "90.00"/"0.00" (`04-hr/hr-cuti.png`).

### POLA-05 — P1 · Simpan per baris di semua layar pengaturan
Setiap baris konfigurasi punya tombol "Simpan" sendiri: ±25 tombol Simpan dalam satu halaman Payroll Indonesia, 5 di Pengaturan HR — tanpa simpan sekaligus, tanpa indikator "ada perubahan belum disimpan". Mengubah banyak nilai = banyak klik + risiko terlewat satu.
Bukti: `05-pengaturan/payroll-indonesia.png`, `04-hr/hr.png`. (Kontras: Pengaturan Umum memakai satu tombol simpan di dasar form — membuktikan tidak ada satu pola simpan.)

### POLA-06 — P2 · Bar filter tidak seragam (≥4 varian)
Label tombol berubah-ubah — "Cari" (`02-gudang/pembelian.png`), "Saring" (`02-gudang/retur-pembelian.png`), "Terapkan" (`03-akuntansi/beban.png`, `03-akuntansi/bank.png`), "Tampilkan" (`03-akuntansi/rekonsiliasi-kontrol.png`) — dan mekanismenya berganti select native, chip pill (`02-gudang/nilai.png`), atau tab (`02-gudang/pemasok.png`). Posisi filter juga berpindah: di header kartu, di dalam kartu form (kasus transfer & opname: kotak cari *riwayat* terletak di dalam kartu *form*), atau berdiri sendiri.

### POLA-07 — P2 · Tombol aksi per baris selalu tampil; aksi destruktif sejajar aksi aman
Setiap baris tabel memajang semua aksinya sebagai tombol outline permanen: "Nonaktifkan"+"Hapus" ×30 baris di produk (60 tombol), "Ubah"+"Hapus" ×42 akun, "Terima"+"Void" berdampingan di piutang, "Batalkan" dokumen terposting sebagai tombol polos sejajar "Cetak". Noise visual besar dan risiko salah klik pada aksi yang tidak bisa dibatalkan.
Bukti: `02-gudang/produk.png`, `02-gudang/pemasok.png`, `03-akuntansi/akun.png`, `03-akuntansi/piutang-utang.png`, `02-gudang/penerimaan-detail.png`.

### POLA-08 — P2 · Empty state raksasa & kartu kosong bertumpuk
Seksi kosong dirender setinggi seksi berisi: halaman detail pihak = 6 kartu yang 5 di antaranya hanya berisi satu kalimat kosong; panel "Dokumen terakhir" di beranda gudang tampil sebagai kartu tanpa satu baris pun; footer "0 data" mengulang pesan kosong yang sama di kartu yang sama.
Bukti: `02-gudang/pemasok-detail.png`, `02-gudang/pelanggan-detail.png`, `02-gudang/produk-detail.png` (kartu Riwayat perubahan), `02-gudang/beranda.png`, `04-hr/kasbon.png`.

### POLA-09 — P2 · Empat kartu KPI nol mendahului hampir semua daftar
Halaman yang isinya kosong tetap membuka dengan 4 kartu KPI bernilai 0, dan pada halaman terisi pun KPI sering menggandakan angka yang ada di tabel bawahnya. Konten pertama yang dicari pengguna selalu mulai jauh di bawah lipatan.
Bukti: `02-gudang/purchase-request.png`, `02-gudang/reservasi.png`, `04-hr/kasbon.png`, `04-hr/klaim.png`, `04-hr/pinjaman.png`, `03-akuntansi/jurnal.png`, `03-akuntansi/buku-besar.png`.

### POLA-10 — P2 · Layar cetak dirender di dalam cangkang aplikasi
Semua pratinjau dokumen resmi tampil di dalam sidebar+topbar aplikasi sehingga kertas hanya memakai ±55% lebar layar; status mentah bahasa Inggris "posted" tercetak pada surat jalan yang keluar ke pihak lain (`02-gudang/transfer-detail-cetak.png`); slip gaji semua karyawan ditumpuk dalam satu kartu kontinu tanpa pemisah halaman yang jelas dan tiap slip ±1 halaman untuk 3 baris angka (`04-hr/payroll-detail-cetak.png`). Isi dokumennya sendiri rapi — yang bermasalah wadah & detail tampilannya.
Bukti juga: `02-gudang/pembelian-detail-cetak.png`, `02-gudang/opname-lembar-hitung.png`, `03-akuntansi/buku-besar-cetak.png`.

### POLA-11 — P2 · Halaman galat tidak dirawat sama sekali
Tidak ada `not-found.tsx` di repo (hanya `src/app/app/error.tsx`); rute cetak yang dibuka tanpa parameter persis menghasilkan **404 default Next.js** — teks Inggris "This page could not be found", tanpa merek, tanpa cangkang, tanpa jalan pulang.
Bukti: `03-akuntansi/laporan-cetak.png`, `03-akuntansi/piutang-utang-cetak.png` (kedua berkas adalah tangkapan 404 yang sama).

### POLA-12 — P2 · Bahasa campur & jargon internal bocor ke UI
Judul campur Inggris: "Purchase Request" (`02-gudang/purchase-request.png`), "Reimbursement Karyawan" (`04-hr/klaim.png`), status mentah "open" (`02-gudang/pemasok-detail.png`), "In-Transit" (`02-gudang/reservasi.png`). Lebih buruk: bahasa internal pengembang tampil ke pengguna bisnis — "(D-25: semua terkonfigurasi)" (`03-akuntansi/aset.png`), "migrasi 0044", "Σ qty × unitCost", "sisi GL" (`03-akuntansi/rekonsiliasi-kontrol.png`).

### POLA-13 — P2 · Teks panduan permanen yang tidak bisa dilipat
Panel "Panduan singkat" 6 bullet selalu terbuka di form jurnal (`03-akuntansi/jurnal-baru.png`), blok "Alur yang disarankan" di dasar halaman periode (`03-akuntansi/periode.png`), paragraf instruksi format CSV 2 baris penuh istilah teknis di halaman kerja rekonsiliasi (`03-akuntansi/rekonsiliasi.png`), kartu "Jurnal terkait" yang dirender hanya untuk menyatakan tidak ada jurnal (`02-gudang/dokumen-detail.png`). Bantuan yang berguna di minggu pertama menjadi pajak visual selamanya.

### POLA-14 — P3 · Identitas visual templat & hierarki datar
Palet pastel krem/plum + radius besar + chip ikon warna acak per kartu membuat semua halaman terasa seperti templat dashboard generik; judul halaman memakai font display besar bergaya editorial untuk halaman kerja teknis; label kapital-kecil di semua tempat (header tabel, label form, eyebrow) mengaburkan mana yang penting. Tidak ditemukan satu pun halaman dengan penekanan visual pada *satu* aksi/angka utama selain tombol primer plum yang sama di mana-mana.
Bukti: seluruh folder; paling jelas `00-beranda/beranda.png`, `03-akuntansi/beranda.png`.

### POLA-15 — P3 · Tata letak detail dokumen tidak seragam
Tiga varian detail hidup bersama: kartu meta penuh (`02-gudang/penerimaan-detail.png`), tanpa kartu meta — meta hanya sebaris teks (`02-gudang/pembelian-detail.png`, `02-gudang/retur-pembelian-detail.png`), dan kartu sempit di tengah halaman (`03-akuntansi/jurnal-detail.png`). Tautan jurnal pun dua gaya: blok tabel "Jurnal terkait" vs teks kecil "Jurnal posting: JE-…" (`02-gudang/retur-pembelian-detail.png`). Posisi baris total berpindah-pindah (di dalam tabel, di kaki tabel, di luar kartu).

### POLA-16 — P3 · Breadcrumb statis tidak menunjukkan posisi
Breadcrumb topbar selalu hanya "Beranda / <Modul>" apa pun halamannya (semua halaman gudang berlabel identik), sehingga tidak membantu orientasi di modul berisi 16 menu. Bukti: semua screenshot modul.

---

### Catatan arah visual (dari aturan proyek)
`AGENTS.md` repo menetapkan bahasa visual yang dimaksud: *compact Odoo-like* — skala huruf kecil, tabel padat, palet redup. Keadaan ter-render justru melayang ke arah sebaliknya: kartu besar berjarak lebar, judul display editorial, dekorasi pastel. Sebagian rasa "jelek" pengguna dapat dibaca sebagai **penyimpangan dari arah yang sudah ditetapkan proyek sendiri** — rombak sebaiknya menegakkan arah itu, bukan mengganti gaya ke arah lain yang sama jauhnya.

---

## 3. Yang sudah baik — jangan dibuang saat rombak

- **Rincian Jurnal tertaut di halaman dokumen** (`02-gudang/penerimaan-detail.png`, `04-hr/payroll-detail.png`): pengguna menelusur dokumen → jurnal dalam satu klik. Konsep benar; yang perlu dirombak hanya konsistensi gayanya (POLA-15).
- **Daftar periksa akhir bulan** di halaman periode (`03-akuntansi/periode.png`): langkah bernomor dengan status — satu-satunya workflow terpandu sejati di aplikasi.
- **Pola cepat jurnal manual** (`03-akuntansi/jurnal-baru.png`): chip pola mengisi struktur baris; indikator seimbang real-time di rel kanan. Konsep kuat, eksekusi visualnya yang berisik.
- **Mode Operasi scan-first** (`02-gudang/operasi.png`): satu input selalu fokus untuk pemindai — pola yang benar untuk kerja gudang; kekurangannya hanya halaman di sekitarnya yang kosong.
- **Antrean kerja di beranda akuntansi** (`03-akuntansi/beranda.png`): kartu "yang menunggu tindakan Anda" adalah ide beranda yang tepat — terkubur di bawah tumpukan seksi lain.
- **Isi dokumen cetak rapi**: kop, tabel, total, blok tanda tangan, QR (`02-gudang/penerimaan-detail-cetak.png`, `03-akuntansi/jurnal-detail-cetak.png`).
- **Tabel TER terlipat per kategori** (`05-pengaturan/payroll-indonesia.png`): satu-satunya *progressive disclosure* di seluruh aplikasi — bukti pola yang dibutuhkan sudah dikenal tim.

---

## 4. Temuan per modul per fitur

### 4.1 Gudang — 13 temuan (P1: 2 · P2: 9 · P3: 2)

| ID | Halaman/Fitur | Temuan | Jenis | Tingkat | Bukti |
|---|---|---|---|---|---|
| GDG-01 | Retur Pembelian — form baru | **Urutan form terbalik dari urutan kerja**: pemasok/gudang/tanggal → kategori alasan → rencana penyelesaian → alasan wajib → catatan → *baru* picker barang di paling bawah. Barang yang diretur adalah inti pekerjaan, tapi tampil terakhir. Form juga mulai dari pemasok bebas, bukan dari dokumen penerimaan asal, sehingga isi retur disusun ulang dari ingatan; dan nilai retur tidak terlihat sama sekali selama pengisian (baru dihitung saat posting). | Workflow | **P1** | `retur-pembelian-baru.png` |
| GDG-02 | Detail Pemasok & Pelanggan | **Nol aksi kontekstual**: saldo utang/piutang ditampilkan besar, tetapi tidak ada tombol Bayar utang, Buat PO/Penerimaan, Catat pembayaran, atau bahkan Ubah profil di halaman ini. Semua pekerjaan harus dimulai ulang dari menu lain. | Workflow | **P1** | `pemasok-detail.png`, `pelanggan-detail.png` |
| GDG-03 | Produk & harga | Checkbox massal di setiap baris tanpa toolbar/petunjuk aksi massal yang tampak saat belum ada pilihan; pengguna tidak tahu checkbox itu untuk apa. (Aksi per baris sendiri tercatat di POLA-07; tumpukan Kategori+Satuan di POLA-01.) | Workflow | P2 | `produk.png` |
| GDG-04 | Detail dokumen transfer | Kolom TERKIRIM 2 / DITERIMA 0 / SISA 2 tampil menonjol, tetapi tidak ada aksi maupun penjelasan penerimaan di halaman. Kode membuktikan form terima hanya dirender untuk dokumen berstatus `in_transit` (`src/app/app/gudang/dokumen/[id]/page.tsx:120`) — pada dokumen selain itu, angka "sisa" menggantung tanpa konteks dan terbaca sebagai pekerjaan yang tertunda. | Workflow | P2 | `dokumen-detail.png` |
| GDG-05 | Nilai persediaan | Tanpa kotak pencarian (65+ baris harus digulir), dan fungsinya tumpang tindih dengan halaman Produk — data stok & nilai yang sama disajikan dua tempat dengan tampilan berbeda. Filter gudang di sini memakai chip pill, berbeda dari select di Produk (POLA-06). | Workflow/Visual | P2 | `nilai.png` |
| GDG-06 | Rekomendasi pembelian | Seluruh halaman hanya satu kalimat di kotak dashed. Tidak ada daftar "mendekati minimum" sebagai konteks, sehingga halaman terasa rusak padahal keadaan stok sedang sehat. | Visual/Workflow | P2 | `rekomendasi.png` |
| GDG-07 | Penyesuaian | Teks *empty state* **salah**: "Dokumen penyesuaian dan retur pembelian tampil di sini" — menyebut fitur lain, sisa salin-tempel. Mengikis kepercayaan pada teks UI lain. | Visual (teks) | P2 | `penyesuaian.png` |
| GDG-08 | Pergerakan stok | Tabel 40 baris sangat monoton: kolom Gudang/Jenis/Alasan berisi nilai yang sama berulang memenuhi layar; tidak ada pengelompokan per dokumen/hari; nomor referensi dokumen hanya teks polos, tidak tertaut ke dokumennya — padahal menelusur asal pergerakan adalah fungsi utama halaman ini. | Visual/Workflow | P2 | `pergerakan.png` |
| GDG-09 | Impor data | Kontrol pilih berkas adalah **input file native browser** "Choose File / No file chosen" berbahasa Inggris tanpa styling — elemen paling mentah di seluruh aplikasi. Alur 5 langkah (unggah → petakan kolom → validasi → pilih baris → commit, `import-wizard.tsx` 912 baris) tanpa indikator langkah; judul kartu mengasumsikan semua impor produk berasal dari "Accurate.id". Impor akun & saldo awal (ranah akuntansi) juga tinggal di menu Gudang. | Visual/Workflow | P2 | `impor.png` |
| GDG-10 | Mode Operasi | ±65% halaman kosong: satu input pindai + satu kotak antrean kosong. Saat antrean kosong tidak ada jalan pintas manual (buat penerimaan/transfer/opname) — *dead end*, pengguna dipaksa ke sidebar. | Visual/Workflow | P2 | `operasi.png` |
| GDG-11 | Beranda gudang | Info kedaluwarsa — kritis untuk minimarket — disembunyikan sebagai satu baris *collapse* tertutup di tengah halaman, mudah terlewat. (Panel "Dokumen terakhir" kosong tercatat di POLA-08.) | Workflow | P2 | `beranda.png` |
| GDG-12 | Detail produk | Angka 0 pada panel "Stok per gudang" berwarna **merah** untuk gudang yang memang tidak menyimpan produk itu — nol terbaca sebagai galat. Rel kanan juga mengulang SKU/barcode yang sudah menjadi judul halaman. | Visual | P3 | `produk-detail.png` |
| GDG-13 | Kemungkinan duplikat pihak | Utilitas yang jarang dipakai menempati halaman penuh tersendiri (dua kartu kosong raksasa saat bersih); layak menjadi panel/dialog di halaman Pemasok, bukan menu halaman. | Workflow (IA) | P3 | `pemasok-duplikat.png` |

### 4.2 Akuntansi — 12 temuan (P1: 2 · P2: 8 · P3: 2)

| ID | Halaman/Fitur | Temuan | Jenis | Tingkat | Bukti |
|---|---|---|---|---|---|
| AKT-01 | Rekonsiliasi bank | **Pekerjaan inti tidak bisa dikerjakan dari tampilannya**: daftar mutasi bank dan daftar baris jurnal ditumpuk *vertikal* dalam dua panel terpisah — mencocokkan berarti menggulir naik-turun, bukan membandingkan berdampingan. Yang mendominasi halaman justru formulir impor (textarea tempel CSV + paragraf instruksi format teknis). Impor adalah pekerjaan sesekali; pencocokan adalah pekerjaan hariannya — hierarkinya terbalik. | Workflow | **P1** | `rekonsiliasi.png` |
| AKT-02 | Beranda (Ringkasan keuangan) | Halaman terpadat di aplikasi: Input Cepat (9 kartu) + Antrean kerja (5) + seksi kedua yang **berjudul sama "Ringkasan keuangan"** (8 KPI) + Tren & Komposisi (kosong) + Neraca/margin + 2 tabel jatuh tempo, semua bertumpuk tanpa hierarki yang menang. Pengguna membuka beranda untuk orientasi cepat dan mendapat seluruh modul dalam satu guliran. | Visual | **P1** | `beranda.png` |
| AKT-03 | Beranda — Input Cepat | Sembilan kartu aksi mencampur dua perilaku berbeda — membuka modal di tempat vs berpindah halaman — hanya dibedakan label mungil "HALAMAN ↗" dan deskripsi 2–3 baris per kartu yang harus dibaca satu per satu. | Workflow | P2 | `beranda.png` |
| AKT-04 | Beranda — angka antrean | Kartu antrean menyatakan "Piutang terlambat: 1 nota", sementara tabel di halaman yang sama berjudul "Piutang jatuh tempo" memuat 2 nota. Label yang tak selaras membuat pengguna ragu angka mana yang benar. | Visual (teks) | P2 | `beranda.png` |
| AKT-05 | Jurnal umum (daftar) | Daftar tidak menampilkan rincian debit/kredit per jurnal; akuntan harus membuka jurnal satu per satu untuk memindai isi — padahal memindai adalah pekerjaan utama halaman daftar jurnal. (Bar filter 7 kontrol tercatat di POLA-06.) | Workflow | P2 | `jurnal.png` |
| AKT-06 | Jurnal baru | Panel status di keadaan awal **kontradiktif**: "Belum seimbang — selisih Rp 0". Selisih nol tetapi dinyatakan belum seimbang (penyebab sebenarnya: keterangan belum diisi) — pesan tidak menyebut penyebabnya, pengguna dibiarkan menebak. | Visual (teks) | P2 | `jurnal-baru.png` |
| AKT-07 | Jurnal detail | Ada **tombol hantu**: "Jurnal sistem — batalkan dari modul asal" dirender sebagai tombol tetapi tidak bisa diklik. Peringatan pentingnya justru terkubur sebagai paragraf kecil 3 baris di dalam kartu dokumen. | Visual/Workflow | P2 | `jurnal-detail.png` |
| AKT-08 | Buku besar | Alur mulai dari select akun native (daftar panjang) + tombol Cari: akuntan mulai *buta*. Tidak ada daftar akun beserta saldonya untuk diklik masuk, padahal itu cara alami membuka buku besar. Hasil kosong tetap menampilkan baris "0 data" di bawah baris saldo awal/akhir. | Workflow | P2 | `buku-besar.png` |
| AKT-09 | Laporan keuangan | Semua akun tetap tampil termasuk yang bersaldo nol di kedua tahun — tidak ada saklar "sembunyikan akun nol" — sehingga laporan menjadi lautan "Rp 0" dan baris yang bergerak tenggelam. Hierarki total/subtotal hanya mengandalkan bold tipis. | Visual/Workflow | P2 | `laporan.png` |
| AKT-10 | Piutang & utang | Header raksasa sebelum data: 4 kartu KPI + **8 kartu aging** (piutang & utang berdampingan, masing-masing 4 bucket) + cari + tab + 5 chip status + 3 tombol — ±45% layar sebelum baris pertama. Sel tabel menumpuk 3 baris metadata (nota + badge SALDO AWAL + ref + nomor jurnal; tanggal + tempo + status terlambat) sehingga baris sangat tinggi dan sulit dipindai. | Visual | P2 | `piutang-utang.png` |
| AKT-11 | Periode fiskal | Tombol "Kunci" tampil juga untuk bulan yang sudah DITUTUP (aksi tak relevan selalu hadir, 24 tombol untuk 12 bulan). Daftar periksa langkah 2 menyatakan persediaan "masih berselisih", sementara halaman Rekonsiliasi kontrol menyatakan selaras — beda tanggal acuan, tanpa penjelasan di tempat, pengguna melihat dua vonis bertentangan. | Visual/Workflow | P3 | `periode.png` |
| AKT-12 | Bagan akun — detail akun | Halaman detail nyaris kosong (kartu info 8 baris + kartu riwayat kosong besar, POLA-08) dan **tidak memuat mutasi terakhir akun itu** — hal pertama yang dicari dari sebuah akun. Tombol Ubah pun tidak ada di sini (hanya di daftar). | Workflow | P3 | `akun-detail.png` |

### 4.3 HR — 7 temuan (P1: 1 · P2: 4 · P3: 2)

| ID | Halaman/Fitur | Temuan | Jenis | Tingkat | Bukti |
|---|---|---|---|---|---|
| HR-01 | Detail karyawan | **Form "Berhenti & pembayaran akhir" terbuka permanen** di profil karyawan aktif — lengkap dengan tanggal berhenti, alasan, checkbox penegasan hukum, dan tombol merah "Proses berhenti & pembayaran akhir". Aksi paling destruktif di HR diletakkan sejajar konten profil harian tanpa lipatan/gerbang; satu-satunya kartu yang selalu "siap tembak" di halaman yang kebanyakan dibuka untuk membaca. | Workflow | **P1** | `karyawan-detail.png` |
| HR-02 | Seluruh modul HR | **Navigasi ganda**: selain sidebar modul, halaman-halaman HR memuat deretan chip navigasi kedua ("Payroll & karyawan / Absensi & Shift / Lembur & THR / Cuti / Organisasi & Pengaturan HR") dengan isi tumpang tindih dan label tak identik dengan sidebar. Dua sistem navigasi bersaing dalam satu modul. | Visual (IA) | P2 | `hr.png`, `payroll.png`, `hr-cuti.png`, `hr-lembur.png` |
| HR-03 | Cuti — daftar jenis | Daftar jenis cuti **bukan tabel**: baris teks mengalir satu baris ("khusus · Cuti Khusus · tanpa jatah · berbayar") dengan kode kecil abu-abu, plus tombol Ubah/Nonaktifkan per baris. Tidak bisa dipindai, tidak sejajar kolom, terlihat seperti daftar definisi mentah. | Visual | P2 | `hr-cuti.png` |
| HR-04 | Lembur & THR | **Dua pemilih periode untuk periode yang sama** — satu di header halaman, satu di kartu Draf THR — bisa tidak sinkron dan pengguna tidak tahu mana yang berlaku. | Workflow | P2 | `hr-lembur.png` |
| HR-05 | Detail karyawan — data kepegawaian | Separuh field inti tampil "—" (Departemen, Atasan langsung, Cabang, Jenis kontrak, NIK/NPWP, Status PTKP) tanpa penanda mana yang wajib dilengkapi: profil terlihat setengah jadi dan tidak ada jalan melengkapi dari konteks yang hilang itu (pengguna harus menebak lewat tombol Ubah di halaman daftar). | Workflow | P2 | `karyawan-detail.png` |
| HR-06 | Payroll (daftar) | Panel "Riwayat payroll" kosong menempati rel kanan dan **menyempitkan tabel karyawan** yang menjadi isi utama; saat riwayat terisi pun dua isi berbeda fungsi berbagi satu layar tanpa pemisah tugas (POLA-01). | Visual | P3 | `payroll.png` |
| HR-07 | Payroll detail | Grid KPI janggal 4+1: kartu kelima hanya berisi badge status "TERPOSTING". Aksi per karyawan "Slip" hanya berupa teks kecil di tepi kanan baris tanpa gaya tombol — mudah terlewat padahal itu aksi yang paling sering dipakai dari halaman ini. | Visual | P3 | `payroll-detail.png` |

### 4.4 Pengaturan — 6 temuan (P1: 2 · P2: 3 · P3: 1)

| ID | Halaman/Fitur | Temuan | Jenis | Tingkat | Bukti |
|---|---|---|---|---|---|
| PNG-01 | Cangkang Pengaturan | **Navigasi ganda identik**: 12 item yang sama tampil sebagai sidebar modul *dan* sebagai deretan 11 chip tab di atas konten, berdampingan dalam satu layar. Pengguna dipaksa memilih satu dari dua salinan menu yang sama setiap kali berpindah seksi. | Visual (IA) | **P1** | `beranda.png` |
| PNG-02 | Tab Umum | **±20 field kebijakan lintas modul dalam satu kartu tanpa pengelompokan yang bisa dilipat**: identitas perusahaan, pajak, ambang write-off, termin utang POS, kedaluwarsa reservasi, pembulatan kasir, ambang diskon supervisor, stok negatif, mode offline, transfer dua tahap — semua tercampur dalam satu formulir raksasa (`settings-forms.tsx` 1.789 baris). Hampir setiap field disertai paragraf bantuan 2–5 baris sehingga teks jauh lebih banyak daripada kontrolnya. Menemukan satu pengaturan = menggulir dan membaca esai. | Visual/Workflow | **P1** | `beranda.png` |
| PNG-03 | Tab Umum — menyimpan | Satu-satunya tombol "Simpan pengaturan" ada di **dasar** formulir raksasa; tidak ada bar simpan lengket dan tidak ada indikator perubahan belum tersimpan. Pengguna yang mengubah field di atas harus menggulir jauh untuk menyimpan, dan tidak bisa memastikan apakah perubahan terakhirnya sudah tersimpan. | Workflow | P2 | `beranda.png` |
| PNG-04 | Tab Umum — panel QRIS | Panel unggah QRIS pembayaran mengambang di rel kanan tab Umum, terputus dari konteksnya (metode pembayaran/nota), sejajar dengan field identitas perusahaan. Penempatan acak menambah rasa "tumpukan". | Visual | P2 | `beranda.png` |
| PNG-05 | Payroll Indonesia — keterbacaan seksi | Di luar angka mentah (POLA-04) dan simpan per baris (POLA-05): setiap baris program BPJS disertai deskripsi regulasi 3 baris teks kecil yang mengubur kontrolnya, dan perlakuan antar seksi tidak konsisten — tabel TER terlipat rapi per kategori, sementara tabel BPJS/PTKP/parameter semuanya terbuka penuh dalam halaman yang sama. | Visual | P2 | `payroll-indonesia.png` |
| PNG-06 | Pengguna & peran | Peran pengguna diganti lewat select inline di dalam sel tabel — satu klik tanpa konfirmasi untuk perubahan sekuat mengganti Owner. Aksi per baris hanya berupa ikon kunci kecil tanpa label (reset kata sandi?) yang harus ditebak. | Workflow/Visual | P3 | `pengguna.png` |

---

## 5. Lima halaman/fitur terburuk

### 1. Payroll Indonesia — Pengaturan (`05-pengaturan/payroll-indonesia.png`)
Halaman konfigurasi paling berisiko di aplikasi justru yang paling tidak terbaca. Angka uang statutori tampil sebagai string desimal mentah 4 angka di belakang koma, tanpa pemisah ribuan: batas upah BPJS Kesehatan "12000000.0000" **terpotong oleh kolomnya sendiri** ("12000000.000("), PTKP tampil "58500000.0000", tarif tampil "4.0000"/"1.2700". Untuk memverifikasi satu angka, pengguna harus menghitung nol dengan mata. Di atas itu: ±25 tombol "Simpan" terpisah, 10 baris program yang masing-masing terkubur deskripsi regulasi 3 baris, dan halaman gulir yang sangat panjang. Salah baca di sini = salah potong gaji & pajak seluruh karyawan.

### 2. Stok Opname — Gudang (`02-gudang/opname.png`)
Tiga pekerjaan berbeda (membuat tugas opname, menghitung opname, melihat riwayat) ditumpuk sebagai tiga form/kartu yang semuanya terbuka. Form tugas memeras 5 field sebaris sampai label "CATATAN (OPSIONAL)" patah dua baris dan kolom tanggalnya menyempit; input tanggalnya berformat AS mm/dd/yyyy; kotak cari *riwayat* terletak di dalam kartu *form hitung*; tombol utama "Tinjau selisih" tampil nonaktif abu-abu tanpa penjelasan. Ini pekerjaan berkala yang menegangkan (hitung fisik toko) dan halamannya adalah yang paling membebani secara kognitif di Gudang.

### 3. Rekonsiliasi Bank — Akuntansi (`03-akuntansi/rekonsiliasi.png`)
Satu-satunya halaman yang *bentuknya menghalangi pekerjaan intinya*: pencocokan mutasi bank ↔ baris jurnal menuntut perbandingan berdampingan, tetapi kedua daftar ditumpuk vertikal — yang satu di tengah halaman, yang lain di bawahnya. Urutan halaman pun terbalik: formulir impor CSV (pekerjaan sesekali) dengan textarea tempel dan paragraf instruksi format teknis menempati paruh atas; antrean pencocokan (pekerjaan harian) tenggelam di bawah 4 kartu KPI bernilai nol.

### 4. Absensi & Shift — HR (`04-hr/hr-absensi.png`)
Lima fungsi dalam satu halaman, seluruhnya form terbuka: Master shift, Penugasan shift, Catat absensi manual, Impor absensi CSV (textarea), dan Rekap periode. Yang paling sering dicari — rekap — berada paling bawah, di bawah empat formulir. Input waktu native tampil terpangkas ("08:00 A", "05:00 P") dan semua tanggal mm/dd/yyyy. Halaman ini adalah POLA-01 dalam bentuk paling ekstrem di HR.

### 5. Detail Pemasok / Pelanggan — Gudang (`02-gudang/pemasok-detail.png`, `pelanggan-detail.png`)
Halaman yang isinya paling sedikit dibanding ruang yang dipakainya: enam kartu bertumpuk, lima di antaranya hanya berisi satu kalimat "Belum ada …", dan tanggal di satu-satunya tabel tampil ISO mentah ("2026-11-02") dengan status "open" berbahasa Inggris. Lebih buruk dari tampilannya: halaman ini adalah titik alami untuk bekerja dengan pihak (bayar utang, buat PO, catat penerimaan) tetapi **tidak menyediakan satu pun aksi itu** — saldo ditampilkan, lalu pengguna dibiarkan pergi ke menu lain untuk bertindak.

*Sebutan khusus:* Beranda Akuntansi (`03-akuntansi/beranda.png`) — halaman terpadat di aplikasi dengan judul seksi yang menggandakan judul halaman; dan Pengaturan Umum (`05-pengaturan/beranda.png`) — formulir ±20 field lintas modul dengan navigasi ganda.

---

## 6. Implikasi urutan rombak (untuk tahap rencana)

Sesuai mandat, rombak dikerjakan **per pola dulu, baru per halaman**, karena 16 temuan pola menyentuh hampir semua dari 66 halaman:

1. **Pola cangkang & header** (POLA-02, 14, 16): satu header halaman tanpa judul ganda; deskripsi maksimal satu baris atau hilang; hierarki tipografi & palet ditegakkan ke arah *compact Odoo-like* yang sudah ditetapkan `AGENTS.md` repo.
2. **Pola angka & tanggal** (POLA-03, 04): satu pemformat tanggal/waktu/kuantitas/uang untuk *semua* render (termasuk input), tanpa kecuali render mentah.
3. **Pola halaman kerja** (POLA-01, 08, 09, 13): pisahkan form dari daftar/riwayat (halaman/dialog/langkah), empty state ringkas, KPI hanya bila bermakna, panduan bisa dilipat.
4. **Pola tabel & aksi** (POLA-06, 07): satu bar filter; aksi baris masuk menu konteks; aksi destruktif terpisah & bergaya bahaya.
5. **Pola pengaturan** (POLA-05, PNG-01/02/03): satu navigasi, pengelompokan per domain, satu mekanisme simpan dengan indikator perubahan.
6. **Pola dokumen & cetak** (POLA-10, 15): satu tata letak detail dokumen; pratinjau cetak tanpa cangkang aplikasi; status selalu diterjemahkan.
7. **Pola galat & bahasa** (POLA-11, 12): `not-found` kustom berbahasa Indonesia; sapuan istilah mentah & jargon internal dari UI.
8. Baru kemudian **perbaikan khas halaman** (§4): urutan form retur, pencocokan berdampingan rekonsiliasi, gerbang form pemberhentian karyawan, dan seterusnya.

---

## 7. Lampiran — cakupan bukti

66 berkas dibaca: `00-beranda/beranda.png`; `02-gudang/` (beranda, operasi, produk, produk-detail, penerimaan, penerimaan-detail, penerimaan-detail-cetak, pembelian, pembelian-detail, pembelian-detail-cetak, purchase-request, purchase-request-detail, retur-pembelian, retur-pembelian-baru, retur-pembelian-detail, retur-pembelian-detail-cetak, transfer, dokumen-detail, transfer-detail-cetak, penyesuaian, opname, opname-lembar-hitung, pergerakan, reservasi, nilai, rekomendasi, impor, pemasok, pemasok-detail, pemasok-duplikat, pelanggan-detail); `03-akuntansi/` (beranda, jurnal, jurnal-baru, jurnal-detail, jurnal-detail-cetak, buku-besar, buku-besar-cetak, laporan, laporan-cetak, piutang-utang, piutang-utang-cetak, beban, bank, rekonsiliasi, rekonsiliasi-kontrol, akun, akun-detail, aset, periode); `04-hr/` (hr, payroll, payroll-detail, payroll-detail-cetak, karyawan-detail, hr-absensi, hr-cuti, hr-lembur, kasbon, klaim, pinjaman, pinjaman-detail-karyawan); `05-pengaturan/` (beranda, pengguna, payroll-indonesia).

Pemeriksaan kode pendukung (baca saja, tanpa perubahan): `src/app/app/gudang/purchase-request/[id]/page.tsx:92` (render qty mentah), `src/lib/money.ts:87` (`formatQty`), `src/app/app/gudang/dokumen/[id]/page.tsx:120` (syarat render form terima transfer), ketiadaan `not-found.tsx` di `src/app` (hanya `src/app/app/error.tsx`), pemakaian `PageHeader` di 61 halaman, ukuran berkas form (`settings-forms.tsx` 1.789 baris, `import-wizard.tsx` 912, `journal-entry-form.tsx` 547, `receipt-form.tsx` 541).
