# Audit UX Hands-On Seluruh Sistem (A-23) — Multi-Peran

Mandat: pengguna menilai UI/UX **seluruh sistem** jelek dan sulit dipakai —
tampilan pertama, sidebar, isolasi modul, visibilitas peran (kasir seharusnya
hanya bisa POS), gudang masih sulit, input nominal harus berformat dan mudah,
sistem harus terasa cepat dan rapi untuk karyawan minimarket (kasir, staf
gudang, akuntan). Audit ini melanjutkan A-22 (modul akuntansi, sudah ditutup
di PROGRESS §0F) dan **tidak mengaudit ulang** temuan akuntansi yang sudah
diperbaiki; akuntansi hanya dinilai dari konsistensinya dengan cangkang
sistem dan hal di luar cakupan A-22.

Metode (pola A-22): aplikasi sungguhan dijalankan (server produksi lokal,
`BISA_ALLOW_LOCALHOST_AUTH_URL=1`, data demo hasil reseed baseline: 65
produk, nilai persediaan Rp28.349.600). Dua pengguna uji dibuat lewat UI
Pengguna & peran: **kasir.a23@bisa.id** (peran Kasir) dan **gudang.a23@bisa.id**
(peran Staf Gudang), lalu audit dijalani dari mata masing-masing peran —
termasuk mengetik URL modul lain secara langsung. Workflow POS dan gudang
dijalani end-to-end dengan transaksi sungguhan (2 penjualan, 1 penerimaan
terposting, 1 opname sampai tinjau selisih, 1 sesi dibuka dan ditutup).
61 tangkapan layar bukti di `~/workspace/bukti-a23-audit/`, pada lebar
1440/1100/768/390. Sesudah audit, demo di-reseed kembali ke baseline dan
server dimatikan.

**Jumlah temuan: P1: 3 · P2: 7 · P3: 5.**

## Tabel langkah per workflow per peran (terukur)

Langkah = interaksi diskret (klik / isi / pilih). Titik awal: sudah login.

### Kasir (peran Kasir)

| # | Workflow | Langkah | Pindah halaman | Hasil & gesekan utama |
|---|---|---|---|---|
| K1 | Buka sesi kas | 2 (menu Sesi kas → Buka sesi) | 1 | Modal awal sudah terisi bawaan Rp500.000 — sesi bisa dibuka tanpa menghitung uang fisik. Dari terminal, satu-satunya petunjuk adalah strip kecil di bawah panel bayar; chip "Sesi kas belum dibuka" di atas tidak bereaksi saat diklik. |
| K2 | Jual 3 barang, tunai | ±8 (3× cari+klik, isi DITERIMA, Bayar) | 0, lalu 1 ke halaman nota | Cepat. Pencarian toleran ("beng" → Beng Beng). DITERIMA menampilkan angka mentah tanpa pemisah ribuan (SIS-07). Total dibulatkan +Rp200 oleh aturan pembulatan perusahaan dan terlabel jelas. |
| K3 | Diskon per baris | 3 per baris (klik Diskon → pilih %/Rp → isi) | 0 | Editor diskon sebaris yang rapi. |
| K4 | Jual 1 barang, QRIS | 4 (klik produk, QRIS, centang konfirmasi, Bayar) | 0, lalu 1 ke nota | Tombol Bayar nonaktif sampai kasir mencentang "Pembayaran sudah diterima", dan alasan nonaktifnya tertulis di panel — pola gerbang yang jujur. |
| K5 | Retur penjualan | **TIDAK ADA JALUR** | — | Menu Retur penjualan tidak ada di sidebar kasir, halaman nota tanpa aksi retur, URL langsung menghasilkan halaman error generik (SIS-03). |
| K6 | Tutup sesi | 3 (menu Sesi kas → isi uang fisik → Tutup sesi) | 1 | Satu klik langsung menutup tanpa dialog konfirmasi/selisih akhir (SIS-10). Input uang fisik mentah ("514500"). |

### Staf gudang (peran Staf Gudang)

| # | Workflow | Langkah | Pindah halaman | Hasil & gesekan utama |
|---|---|---|---|---|
| G1 | Penerimaan barang (posting) | 6 (Penerimaan baru → cari → pilih → qty → harga → Posting) | 0 (form sebaris di halaman yang sama) | Form terlabel baik + teks konsekuensi akuntansi. Harga beli tampil mentah 4 desimal ("2600.0000") (SIS-07). |
| G2 | Opname satu produk | 3 ke tinjau selisih (Muat semua produk → isi Fisik → Tinjau selisih), +1 posting | 0 | Hitung buta berjalan; layar tinjau selisih sangat jelas (dampak Rp2.667 untuk selisih −1 Aqua 600ml pada HPP rata-rata berjalan — angka cocok dengan AVCO sesudah penerimaan G1). |
| G3 | Transfer antar gudang | ±5 (2 pemilih gudang → cari+pilih produk → qty → Transfer stok) | 0 (form sebaris) | Sederhana; penjelasan halaman menyebut "satu transaksi". |
| G4 | Penyesuaian stok | ±5 (Penyesuaian baru → produk → qty → alasan → simpan) | 0 | Halaman pembuka menjelaskan batas Penyesuaian vs Retur Pembelian dengan baik. |
| G5 | Cek stok menipis | 1 (menu Rekomendasi beli) | 1 | Halaman menjelaskan definisinya dan cara membuat PO draf; pada data sehat tampil kosong yang sopan. Tidak ada daftar "mendekati minimum" — hanya yang sudah ≤ minimum. |
| G6 | Impor produk | **Tidak ada menu**; URL langsung → halaman error generik | — | Menu Impor data memang disembunyikan dari peran ini (keputusan izin), tetapi URL langsung menabrak error generik (SIS-04). |

### Pemilik (owner)

| # | Workflow | Langkah | Catatan |
|---|---|---|---|
| P1 | Tambah pengguna berperan | 5 (Pengguna baru → nama, email, kata sandi, peran → Simpan) | Dialog memuat peta modul per peran di label select ("Kasir · POS, Gudang") — transparan dan membantu. Dialog tidak menutup dengan tombol Escape (SIS-15). |
| P2 | Pengaturan perusahaan & metode bayar | Tab di dalam halaman Pengaturan | 11 tab; halaman tinggal di dalam cangkang modul Akuntansi (SIS-11). Field nominal mentah 4 desimal (SIS-07). |

## Matriks visibilitas peran (terverifikasi langsung)

Definisi modul per peran dibaca dari select Peran di dialog Pengguna baru;
kolom "terbukti" adalah hasil login sungguhan sebagai peran itu.

| Peran | Modul (definisi) | Terbukti terlihat | Terbukti tertolak |
|---|---|---|---|
| Owner / Admin / Manager | POS, Gudang, Akuntansi | Semua | — |
| **Kasir** | **POS, Gudang** | Terminal & seluruh menu POS **kecuali Retur penjualan**; dashboard gudang lengkap (nilai persediaan Rp28.349.600, potensi jual) dan 15 dari 16 menu gudang (semua kecuali Impor data); statistik keuangan perusahaan penuh di beranda (kas & bank Rp50.000.000, penjualan bulan ini) | Akuntansi: dialihkan ke beranda + banner merah yang jelas. Pengaturan/pengguna: **halaman error generik** (SIS-04). Aksi buat dokumen gudang disembunyikan, halamannya jalan buntu (SIS-05) |
| Staf Gudang | Gudang | Seluruh modul gudang termasuk posting penerimaan & opname | POS & Akuntansi: dialihkan + banner jelas. Pengaturan: **error generik**. Impor (URL langsung): **error generik** |
| Akuntan | Akuntansi, Gudang | Tidak diuji login (hanya dari definisi peran) | — |
| Lihat Saja (viewer) | Gudang, Akuntansi | Tidak diuji login (hanya dari definisi peran) | — |

Fakta penting: pengalih modul di sidebar **menyembunyikan** modul di luar
peran dengan benar (kasir hanya melihat POS/GDG; staf gudang hanya GDG) —
isolasi cangkang bekerja untuk modul yang memang diberikan. Masalahnya ada
pada **definisi perannya** (SIS-02), pada **rute di luar peta modul** yang
melempar error generik (SIS-04), dan pada **beranda bersama** yang tidak
menyesuaikan peran (SIS-06).

## Inventarisasi input uang per form (terverifikasi dengan mengetik)

Dua keluarga input uang hidup berdampingan dan perilakunya berlawanan:

**A. MoneyInput bersama** (`src/components/money-input.tsx` +
`src/lib/money-input.ts`) — dipakai modal Catat Transaksi, form pembayaran
piutang/utang, form beban, form transfer bank, panel payroll, kasbon,
pinjaman, reimbursement, aset tetap. Berformat id-ID saat blur, regroup saat
mengetik. **Tetapi cacat SIS-01 membuat ketikan ≥5 digit merusak nilai.**

**B. Input angka mentah (bukan MoneyInput)** — tidak ada pemisah ribuan saat
mengetik dan nilai awal ditampilkan sebagai string basis data mentah:

| Form / field | Bukti ketikan / tampilan awal |
|---|---|
| POS: DITERIMA | ketik `50000` → tampil `50000` (KEMBALIAN di sebelahnya terformat "Rp 35.500") |
| Sesi kas: MODAL AWAL | terisi bawaan `500000` mentah |
| Sesi kas: UANG FISIK DIHITUNG | ketik `514500` → tampil `514500` |
| Sesi kas: Setor/tarik bank "Nominal" | placeholder polos, tanpa format |
| Penerimaan: HARGA per baris | nilai awal `2600.0000` (4 desimal!) sementara SUBTOTAL di baris yang sama "Rp 2.600" |
| Pengaturan: AMBANG MAKSIMUM WRITE-OFF (RP) | tampil `0.0000` |
| Pengaturan: AMBANG PERSETUJUAN PENYESUAIAN STOK (RP) | tampil `1000000.0000` |
| Pengaturan: TARIF PAJAK (%) | tampil `0.0000` |

Kuantitas (qty) mentah di mana-mana — wajar dan tidak dinilai. Semua nilai
**hasil hitung** (total, subtotal, kembalian, saldo) selalu terformat rapi;
asimetrinya murni di sisi input, persis pada momen pengguna paling mudah
salah membaca nol.

## Temuan

### SIS-01 (P1 — nilai uang salah dari ketikan biasa) MoneyInput merusak nominal ≥5 digit yang diketik digit per digit

Reproduksi hidup di modal Catat Transaksi (peran owner): ketik `1500000`
pada field JUMLAH → field menampilkan `1,500000` dan **Pratinjau Jurnal
menghitung Debit/Kredit Rp 2** — transaksi Rp1.500.000 akan terposting
sebagai Rp2 bila pengguna menekan Posting. Mekanisme (terbaca dari kode):
pada ketukan ke-4 regroup menyisipkan pemisah ribuan id-ID menjadi `1.500`;
ketukan berikutnya membuat teks `1.5000`, yang oleh `parseMoneyText`
**cocok dengan pola "desimal titik polos"** (`^\d+\.\d{1,4}$`) sebelum pola
pengelompokan ribuan — nilai dibaca sebagai 1,5 dan dibulatkan tampil Rp 2.
Nominal ≤4 digit (≤ Rp9.999) mengetik dengan benar; tempel/isi seketika
juga benar — yang rusak persis pola pakai paling umum: mengetik nominal
invoice digit per digit. Komponennya dipakai bersama oleh 10+ form
(pembayaran, beban, transfer, payroll, kasbon, pinjaman, reimbursement,
aset, modal cepat), jadi cakupannya sistemik, bukan satu modal.
Bukti: `uang-modal-beban.png` (JUMLAH `1,500000`, pratinjau Rp 2).
Rekomendasi terkecil: uji regresi "ketik 1500000 digit per digit → nilai
1500000" untuk `MoneyInput`; perbaiki interaksi parse↔regroup (mis. parse
harus mengutamakan interpretasi pengelompokan untuk teks hasil regroup
sendiri, atau regroup tidak boleh menghasilkan teks yang ambigu terhadap
parsernya). Fitur pratinjau jurnal adalah penyelamat parsial — pengguna
yang teliti melihat Rp 2 — tetapi field yang menampilkan `1,500000` untuk
1,5 juta juga menyesatkan secara visual (koma = pemisah desimal di id-ID).

### SIS-02 (P1 — visibilitas peran) Peran Kasir bawaan mencakup modul Gudang hampir penuh

Definisi peran bawaan: "Kasir · POS, Gudang". Terbukti login: kasir membuka
dashboard Gudang lengkap (Nilai persediaan, Potensi jual, panel gudang
aktif), dan 15 dari 16 menu gudang terender penuh — Produk (termasuk kolom
HPP/harga pokok), Penerimaan, Purchase Request, Pesanan pembelian, Retur
Pembelian, Rekomendasi beli, Penyesuaian, Transfer, Reservasi stok, Stok
opname, Pergerakan stok, Nilai persediaan, Pemasok. Ini bertentangan
langsung dengan harapan pemilik bahwa kasir hanya bekerja di POS, dan
membocorkan data harga pokok & nilai persediaan ke peran garis depan.
Aksi **buat** dokumen memang disembunyikan per izin (kasir tidak bisa
memposting penerimaan dari UI — lihat SIS-05), jadi ini kebocoran
**baca/visibilitas**, bukan tulis; tetap P1 karena definisi perannya yang
salah untuk operasional minimarket.
Bukti: `peran-kasir-di-gudang.png`, `peran-kasir-penerimaan.png`.
Rekomendasi terkecil: modul peran Kasir → POS saja (definisi peran ada di
satu tempat, `src/lib/permissions.ts`); bila pemilik memang ingin kasir
bisa *melihat* stok, pisahkan sebagai izin baca stok yang eksplisit dan
berlabel, bukan seluruh modul gudang.

### SIS-03 (P1 — workflow inti hilang untuk peran pelaksananya) Kasir tidak punya jalur retur penjualan sama sekali

Tiga fakta yang saling mengunci: (1) sidebar POS untuk kasir tidak memuat
menu "Retur penjualan" (owner melihatnya); (2) halaman nota penjualan untuk
kasir hanya punya tombol Riwayat / Kasir / Cetak — tidak ada aksi retur;
(3) URL retur diketik langsung menghasilkan halaman error generik (SIS-04).
Sementara struk yang dicetak kasir sendiri berbunyi "Barang yang sudah
dibeli tidak dapat ditukar tanpa nota" — menyiratkan retur dengan nota
adalah layanan normal, tetapi orang yang memegang nota (kasir) tidak punya
satu pun jalan memprosesnya, dan UI tidak memberi petunjuk apa pun (tidak
ada tombol nonaktif, tidak ada catatan "retur lewat supervisor").
Bukti: `pos-nota-detail-kasir.png`, `pos-retur-langsung-kasir.png`.
Rekomendasi terkecil: putuskan sebagai kebijakan yang *terlihat* — bila
retur memang wewenang supervisor (sejalan penahan POS3-12 PIN supervisor),
tampilkan aksi "Retur" di nota untuk kasir yang membuka alur persetujuan
supervisor; bila bukan, beri kasir menu & aksi retur yang sama dengan
owner. Yang tidak boleh dipertahankan adalah ketiadaan total tanpa
penjelasan.

### SIS-04 (P2 — pesan error menyesatkan) Penolakan izin di rute non-modul tampil sebagai "crash"

Penolakan di batas **modul** bekerja baik: mengetik `/app/akuntansi`
sebagai kasir mengalihkan ke beranda dengan banner merah "Akun ini tidak
punya akses ke modul tersebut. Hubungi admin untuk mengubah peran."
Tetapi rute yang dijaga izin per halaman — bukan modul — melempar error
boundary generik **"Terjadi kesalahan — Halaman gagal dimuat. Coba lagi
atau hubungi admin jika masalah berlanjut."** Terbukti di tiga rute:
`/app/pengaturan` & `/app/pengaturan/pengguna` (kasir dan staf gudang),
`/app/pos/retur` (kasir), `/app/gudang/impor` (staf gudang). Pesannya
menyuruh "coba lagi" untuk sesuatu yang tidak akan pernah berhasil, dan
tampil tanpa cangkang aplikasi (halaman polos) sehingga terlihat seperti
sistem rusak.
Bukti: `peran-kasir-ditolak.png`, `peran-gudang-pengaturan.png`,
`pos-retur-langsung-kasir.png`.
Rekomendasi terkecil: tangkap galat FORBIDDEN secara khusus dan tampilkan
halaman "Tidak punya akses" di dalam cangkang (peran Anda X; butuh izin Y;
hubungi admin) untuk semua rute, samakan dengan pola banner modul.

### SIS-05 (P2 — jalan buntu) Halaman gudang untuk kasir menampilkan pesan yang salah dan menyesatkan

Halaman Penerimaan untuk kasir: tidak ada form, tidak ada tombol buat —
hanya pencarian dan riwayat kosong, plus pemberitahuan garis putus-putus
**"Tambahkan gudang terlebih dahulu di menu Pengaturan."** Padahal gudang
ada tiga dan kasir tidak bisa membuka Pengaturan (SIS-04). Pengguna dibawa
ke jalan buntu dengan instruksi yang mustahil dilakukan. Pola yang sama
kemungkinan muncul di halaman gudang lain yang datanya tersaring izin.
Bukti: `peran-kasir-penerimaan.png`.
Rekomendasi terkecil: bila peran tidak boleh membuat dokumen, tampilkan
keadaan "mode lihat" yang jujur (Anda dapat melihat dokumen, pembuatan
dokumen untuk peran Gudang/Pemilik) — jangan menampilkan pemberitahuan
prasyarat data yang tidak benar. Temuan ini lenyap dengan sendirinya bila
SIS-02 diputuskan kasir = POS saja.

### SIS-06 (P2 — visibilitas peran) Beranda bersama tidak menyesuaikan peran

Sesudah login, semua peran mendarat di beranda yang sama. Kartu modul
memang tersaring (staf gudang hanya melihat kartu Gudang), tetapi sisanya
tidak: kasir dan staf gudang sama-sama melihat statistik perusahaan penuh
(Penjualan bulan ini, Nilai persediaan, **Kas, Bank & QRIS Rp50.000.000**),
panel "Perlu perhatian", dan daftar "Pintasan" berisi tautan lintas modul —
staf gudang ditawari "Mulai transaksi kasir", kasir ditawari "Catat beban
operasional" dan "Lihat laporan keuangan" — yang semuanya memantul ke
banner penolakan. Untuk staf gudang, informasi sesi kas ("Sesi kas: Sedang
berjalan") juga tampil padahal bukan dunianya.
Bukti: `peran-kasir-ditolak-akuntansi.png`, `peran-gudang-landing-1440.png`.
Rekomendasi terkecil: beranda menyusun ulang per peran — statistik dan
pintasan hanya dari modul milik peran itu; peran bermodul tunggal idealnya
mendarat langsung di modulnya.

### SIS-07 (P2 — kemudahan input nominal) Input uang mentah tanpa format di permukaan berfrekuensi tinggi

Lihat tabel inventarisasi: DITERIMA di POS, modal awal & uang fisik sesi,
harga baris penerimaan — semuanya input teks polos tanpa pemisah ribuan
saat mengetik, dan beberapa menampilkan nilai basis data mentah 4 desimal
(`2600.0000`, `1000000.0000`, `0.0000`) sebagai nilai awal. Pada nominal
minimarket (jutaan), menghitung nol dari `1000000.0000` atau `50000` jauh
lebih rawan salah daripada `1.000.000` / `50.000`. Ini keluhan pengguna
yang paling harfiah ("input nominal harus berformat") dan jawabannya
tersebar: sebagian form sudah memakai MoneyInput, sebagian belum sama
sekali.
Bukti: `pos-bayar-tunai.png`, `gudang-penerimaan-baris.png`,
`shell-pengaturan-1440.png`, `pos-tutup-sesi-konfirmasi.png`.
Rekomendasi terkecil: satu komponen input uang untuk semua permukaan
(input POS boleh varian besar), nilai awal selalu dirender dari
`formatMoneyText`, bukan string DB; perbaiki SIS-01 dulu agar komponen
bersamanya bisa dipercaya.

### SIS-08 (P2 — responsif gudang) Daftar gudang belum punya mode kartu di layar kecil

Daftar Produk pada 390px tetap tabel lebar: kolom HPP terpotong di tepi
kanan (harus geser di dalam pembungkus), nama produk membungkus dua-tiga
baris ("Aqua Air / Mineral 1.5L"), dan nomor barcode 13 digit tercetak
penuh di bawah setiap SKU menambah kebisingan. Halaman tidak overflow
(terukur `scrollWidth == 390`) — masalahnya keterbacaan & jangkauan kolom
harga. A-22 sudah menyelesaikan pola yang sama di akuntansi (dokumen
menjadi kartu di bawah `lg`); pola itu tidak menjalar ke gudang. Daftar
gudang lain yang bertabel lebar (penerimaan, pergerakan, dokumen) besar
kemungkinan berbagi nasib yang sama.
Bukti: `gudang-produk-390.png`.
Rekomendasi terkecil: terapkan pola kartu A-22 ke daftar-daftar gudang
(produk: nama, SKU, stok per gudang terpilih, HPP/harga, aksi), dan
sembunyikan barcode penuh di tampilan daftar kecil.

### SIS-09 (P2 — navigasi gudang) Sidebar gudang datar 16 item, tanpa kelompok, istilah campur

Sidebar gudang adalah satu daftar datar 16 menu — pekerjaan harian
(Penerimaan, Stok opname, Produk) sejajar dengan yang jarang (Reservasi
stok, Nilai persediaan, Pergerakan stok) — sementara sidebar akuntansi
sudah dikelompokkan per jenis kerja pada A-22 (Harian / Buku & Laporan /
SDM & Payroll / Lainnya). Satu item berlabel bahasa Inggris, "Purchase
Request", di tengah menu yang seluruhnya berbahasa Indonesia. Untuk staf
gudang baru, 16 pilihan sejajar tanpa hierarki adalah beban orientasi
yang tidak perlu.
Bukti: `gudang-penerimaan-form.png`, `shell-gudang-1440.png`.
Rekomendasi terkecil: kelompokkan (Harian: Ringkasan, Penerimaan,
Penyesuaian, Transfer, Stok opname · Master & Stok: Produk, Pergerakan
stok, Reservasi stok, Nilai persediaan · Pembelian: Purchase Request →
"Permintaan Pembelian", Pesanan pembelian, Retur Pembelian, Rekomendasi
beli, Pemasok · Impor data) dengan komponen kelompok yang sama seperti
akuntansi.

### SIS-10 (P2 — gerbang tindakan konsekuensial) Tutup sesi kas satu klik tanpa konfirmasi

Mengisi uang fisik lalu mengklik "Tutup sesi" langsung menutup sesi
(toast "Sesi kas ditutup.") — tidak ada dialog ringkasan "Seharusnya
Rp514.500 · Dihitung Rp514.500 · Selisih Pas — tutup sesi?" dan tidak ada
jalan membatalkan dari UI. Selisih memang tampil live sebelum klik, tetapi
penutupan tanggung jawab kas adalah tindakan sekali-jalan yang di sistem
POS umumnya digerbang konfirmasi. (Perbandingan internal: tutup periode
akuntansi memakai konfirmasi inline kaya konteks — pola terbaik di
sistem ini — dan dokumen gudang memakai ConfirmDialog bersama.)
Bukti: `pos-tutup-sesi-konfirmasi.png` (keadaan tepat sesudah satu klik:
sesi sudah DITUTUP di riwayat).
Rekomendasi terkecil: dialog konfirmasi tutup sesi berisi seharusnya /
dihitung / selisih, dengan penekanan visual bila selisih ≠ 0.

### SIS-11 (P3 — arsitektur informasi) Pengaturan tinggal di dalam cangkang modul Akuntansi

Halaman Pengaturan (identitas perusahaan, metode pembayaran, gudang &
cabang, penomoran, modul aktif) dirender dengan breadcrumb "Beranda /
Akuntansi", pengalih modul pada posisi AKT, dan sidebar akuntansi penuh —
pemilik yang ingin mengganti metode bayar atau menambah gudang harus
"masuk Akuntansi" untuk melakukannya, dan Pengguna & peran pun tinggal di
menu yang sama. Secara mental, pengaturan adalah milik seluruh sistem,
bukan sub-bab akuntansi. Pintu masuknya pun hanya dari menu profil dan
dari dalam akuntansi.
Bukti: `shell-pengaturan-1440.png`, `pengaturan-pengguna-form.png`.
Rekomendasi terkecil: beri Pengaturan cangkang netral (sidebar pengaturan
sendiri: Umum, Pengguna & peran, Metode pembayaran, Gudang & cabang,
Cetak, Modul) di luar modul mana pun, dapat dijangkau dari beranda dan
menu profil.

### SIS-12 (P3 — pencarian global) Tidak ada pencarian lintas sistem

Header tidak memiliki kolom cari di modul mana pun, dan Ctrl+K tidak
membuka apa pun (terverifikasi: 0 dialog). Untuk melompat ke satu produk,
nota, atau dokumen, pengguna selalu menavigasi menu modul lalu memakai
pencarian lokal halaman itu. Sistem sekelas Odoo menyediakan pencarian/
pengalih global; untuk operasional minimarket (cek harga produk dari
halaman mana pun, cari nota dari gudang) ini penghemat langkah yang nyata.
Bukti: `shell-ctrlk-1440.png`.
Rekomendasi terkecil: palet perintah sederhana (Ctrl+K) untuk produk,
nota penjualan, dokumen stok, dan halaman — hasil membuka halaman pemilik
yang sudah ada.

### SIS-13 (P3 — visibilitas antar-kasir) Kasir melihat sesi & selisih kasir lain

Halaman Sesi kas dan Riwayat sesi menampilkan lima sesi terakhir **semua
kasir** — termasuk modal awal, seharusnya, dihitung, dan selisih kasir
lain, dan sesi pemilik yang masih terbuka. Teks halamannya sendiri
menyatakannya ("Lima sesi terbaru semua kasir"). Dicatat sebagai fakta
visibilitas hari ini; apakah ini kebijakan yang diinginkan adalah
keputusan pemilik yang sudah tercatat lama (POS3-14, saklar riwayat
lintas sesi) — audit ini hanya menegaskan bahwa keadaan bawaannya adalah
*terbuka untuk semua kasir*.
Bukti: `pos-buka-sesi-dialog.png`, `pos-tutup-sesi-konfirmasi.png`.

### SIS-14 (P3 — kebisingan kontekstual) Konten untuk peran/pengaturan lain tampil di permukaan kerja

Dua contoh terverifikasi: (1) halaman nota untuk kasir memuat kartu
"Kustomisasi nota — Template, kertas, kop & kaki diatur di Pengaturan →
Cetak" yang mengarahkan kasir ke halaman yang tidak bisa ia buka;
(2) dashboard gudang membuka dengan panel "Kedaluwarsa & mendekati
kedaluwarsa" sebesar sepertiga layar pertama yang isinya keadaan kosong
("Tidak ada batch bermasalah") — informasi nol yang mengubur pergerakan
stok terbaru di bawahnya pada hari-hari normal.
Bukti: `pos-struk-sukses.png`, `shell-gudang-1440.png`.
Rekomendasi terkecil: kartu kustomisasi nota hanya untuk peran berizin
pengaturan; panel kedaluwarsa dilipat/ringkas saat tidak ada batch
bermasalah (pola lipatan A-22 di piutang-utang).

### SIS-15 (P3 — konsistensi mikro & target sentuh sisa)

- Terminal POS: kartu produk 92px dan tombol Bayar sangat baik, tetapi
  pengalih "Tunggal/Campuran" hanya 23px, chip pecahan cepat (Uang Pas,
  Rp10.000, dst.) 27px, dan strip "Pakai Kredit Retur" 18px — di bawah
  target sentuh nyaman untuk pemakaian sentuh beruntun.
- Tab Pengaturan: 11 chip dalam satu baris mengular; halaman Pengaturan
  memiliki 11 target <28px (terukur).
- Dialog "Pengguna baru" tidak menutup dengan tombol Escape (dialog lain
  di sistem menutup) — inkonsistensi kecil yang terasa saat membatalkan
  cepat.
- Penanggalan pada riwayat sesi memakai format campuran mentah
  ("2026-11-05 13:38" di panel sesi berjalan vs "05 Nov 2026, 20.38" di
  tabel riwayat pada halaman yang sama).
Bukti: `pos-kasir-awal-1440.png` (pengukuran DOM), `shell-pengaturan-1440.png`,
`pos-buka-sesi-dialog.png`.

## Terverifikasi kuat — jangan diutak-atik

- **Penolakan level modul**: alihan ke beranda + banner merah eksplisit
  berbahasa manusia. Ini pola yang benar; SIS-04 hanya meminta pola yang
  sama diperluas ke rute non-modul.
- **Pengalih modul menyembunyikan modul di luar peran** dengan benar.
- **Kecepatan jual kasir**: pencarian produk toleran & cepat, kartu produk
  besar, tombol Bayar memuat nominal total, struk thermal lengkap
  (identitas toko, NPWP, pembulatan terlabel, QR) + toast bernomor nota.
- **Gerbang QRIS**: Bayar nonaktif sampai konfirmasi penerimaan dana
  dicentang, *dan alasannya tertulis* — gerbang yang mengajar, bukan
  menghalangi diam-diam.
- **Halaman sesi kas**: panel live (modal, penjualan tunai, refund, kas
  seharusnya), selisih live saat menghitung uang fisik, mutasi kas
  tercatat — fondasi rekonsiliasi laci yang baik.
- **Opname hitung buta + tinjau selisih**: stok sistem disembunyikan saat
  menghitung; layar tinjau menyatakan dampak rupiah dan secara eksplisit
  memperingatkan baris belum dihitung *tidak* dianggap nol. Angka dampak
  cocok dengan AVCO berjalan.
- **Form penerimaan**: sebaris tanpa pindah halaman, terlabel penuh, dan
  memuat teks konsekuensi ("Stok bertambah dan menjadi utang pemasok…").
- **Responsif struktural**: terminal POS (termasuk tata letak 390px dengan
  bilah Bayar lengket), dashboard gudang, dan daftar produk terukur
  `scrollWidth == innerWidth` pada 390/768/1100/1440 — tidak ada overflow
  halaman. Yang kurang hanya mode kartu daftar gudang (SIS-08).
- **Halaman login**: rapi, informatif, menjelaskan tiga modul dalam satu
  layar.
- **Kecepatan muat (kualitatif terukur, loopback lokal)**: DOMContentLoaded
  halaman-halaman berat — dashboard akuntansi ±511ms, terminal POS ±386ms,
  piutang-utang ±390ms, laporan ±107ms, produk gudang ±165ms — tidak ada
  halaman yang terasa berat di mesin uji; angka ini bukan ukuran jaringan
  produksi, hanya bukti tidak ada halaman yang secara lokal lamban.
- **Pembulatan total kasir** (penjualan Rp14.300 → Rp14.500) berasal dari
  pengaturan perusahaan "Pembulatan total kasir: Terdekat Rp500" dan
  **terlabel eksplisit** di terminal maupun struk — perilaku terkonfigurasi
  yang transparan, bukan cacat; dicatat agar pemilik sadar total yang
  dibayar pelanggan dapat lebih tinggi dari jumlah harga.

## Usulan kelompok perbaikan (berurutan)

1. **G1 — Peran & cangkang** (SIS-02, SIS-04, SIS-05, SIS-06, SIS-13):
   definisi Kasir → POS saja (atau izin baca stok yang eksplisit bila
   pemilik menghendaki); halaman "tidak punya akses" dalam cangkang untuk
   semua penolakan izin menggantikan error generik; beranda sadar peran
   (statistik & pintasan hanya modul sendiri; peran satu modul mendarat
   di modulnya); putuskan visibilitas riwayat sesi lintas kasir.
2. **G2 — Uang & input** (SIS-01, SIS-07): perbaiki cacat parse↔regroup
   MoneyInput + uji regresi ketikan digit per digit di semua permukaan
   pemakai; samakan semua input nominal ke komponen yang sama (termasuk
   DITERIMA POS, sesi kas, harga baris dokumen) dengan nilai awal
   terformat id-ID.
3. **G3 — POS dari mata kasir** (SIS-03, SIS-10, SIS-15): jalur retur yang
   diputuskan & terlihat (aksi retur + persetujuan supervisor, atau menu
   retur untuk kasir); konfirmasi tutup sesi berisi selisih; target
   sentuh panel pembayaran ≥32px.
4. **G4 — Gudang** (SIS-08, SIS-09, SIS-14): sidebar berkelompok se pola
   akuntansi + label Indonesia penuh ("Permintaan Pembelian"); mode kartu
   daftar di layar kecil; panel kedaluwarsa terlipat saat kosong.
5. **G5 — Selaras lintas sistem** (SIS-11, SIS-12, sisa SIS-15):
   Pengaturan bercangkang netral di luar akuntansi; pencarian global
   Ctrl+K; konsistensi dialog (Escape), format tanggal satu pola, target
   sentuh minimum di seluruh permukaan.
