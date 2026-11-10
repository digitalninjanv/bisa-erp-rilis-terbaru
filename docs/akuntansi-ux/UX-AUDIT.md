# Audit UX Hands-On Modul Akuntansi (A-22) — Workflow & Responsif

Mandat: pengguna menilai UI/UX modul akuntansi "jelek" dan sulit dipakai; fokus
keluhan = **workflow + responsif**. Audit ini BUKAN audit token visual statis
(FIX-R2 sudah menata komponen bersama & desain laporan — lihat PROGRESS §0B);
fokusnya alur kerja, pemakaian nyata, dan perilaku di berbagai lebar layar.

Metode: aplikasi sungguhan dijalankan (server produksi lokal,
`BISA_ALLOW_LOCALHOST_AUTH_URL=1`, sesi demo owner via storageState e2e, data
demo hasil reseed terakhir). Sembilan workflow inti dijalani end-to-end dengan
interaksi nyata (klik/isi/pilih dihitung), delapan halaman kunci ditangkap pada
lebar 1440/1100/768/390 (32 tangkapan + 16 tangkapan workflow), dan metrik DOM
diukur per halaman-lebar (overflow halaman, lebar tabel, target sentuh <28px,
distribusi ukuran huruf). Semua tangkapan di `~/workspace/bukti-a22-audit/`.
Catatan data: perusahaan demo memuat residu uji program sebelumnya (mis. saldo
kas negatif, jurnal berlabel "Uji …") — itu keadaan data, bukan temuan UI, dan
tidak dinilai di sini.

## Tabel langkah per workflow (terukur)

Langkah = interaksi diskret (klik / isi / pilih). "Pindah halaman" dihitung
terpisah. Titik awal: pengguna sudah berada di modul Akuntansi.

| # | Workflow | Langkah | Pindah halaman | Hasil & gesekan utama |
|---|---|---|---|---|
| a | Catat beban (halaman Beban) | 5 | 1 | Berhasil (EXP-2026-00001). Form tersembunyi di balik tombol "Beban baru" — satu langkah ekstra sebelum bisa mengetik. |
| a2 | Catat beban (modal Catat Transaksi) | 3 untuk membuka + mengisi awal, +1 posting | 0 | Lebih cepat, tetapi kemampuannya tidak identik dengan jalur halaman (lihat UX-06). |
| b | Jurnal manual (pola cepat) | 7 | 1 (form → detail jurnal) | Berhasil (JE-2026-00033). Pola cepat mengisi akun kas tetapi akun beban tetap harus dipilih manual; sinyal "siap diposting" bertentangan (UX-10). |
| c | Bayar satu tagihan utang | 3 dari daftar (tab, Bayar, Simpan) | 0 (dialog) | Sangat baik: nominal terisi penuh dari sisa. Label akun "MASUK KE" untuk uang keluar (UX-09). |
| d | Terima pembayaran piutang | 3 dari daftar (tab, Terima, Simpan) | 0 (dialog) | Sama baiknya dengan (c); tombol aksi bernama "Terima" (jelas). |
| e | Transfer antar bank | 5 | 1 | Berhasil (BTF-2026-00002). Pemilih rekening berupa combobox cari — konsisten dengan pemilih akun lain. |
| f | Rekonsiliasi mutasi bank | 3 bila format benar (tempel, Impor, Cocokkan otomatis → "1 tertaut") | 0 | Mengikuti contoh placeholder UI: GAGAL (UX-05). Sesudah tahu rahasia header, alurnya sangat baik. |
| g | Drill-down laba rugi → dokumen sumber | 2 (nama akun → nomor JE) | 2 | Bekerja persis seperti seharusnya: Laporan → Buku besar terfilter → detail jurnal. Kekuatan, jangan diubah. |
| h | Tutup periode | 3 (menu, Tutup, "Ya, tutup periode") | 1 | Konfirmasi inline kaya konteks (30 jurnal, total debit) — pola terbaik di modul. Buka kembali = tombol "Buka" per baris. |
| i | Menemukan transaksi lama (pencarian jurnal) | **RUSAK dari UI** — pengiriman form menghasilkan halaman error; via URL bersih: 2 langkah dan ketemu | 1 | UX-01. Pencarian di halaman lain (piutang-utang, laporan, buku-besar) berfungsi normal. |

## Temuan

**Jumlah: P1: 2 · P2: 6 · P3: 4 (+1 catatan verifikasi RD2U).**

### UX-01 (P1 — workflow inti rusak) Pencarian daftar Jurnal menghasilkan halaman error dari UI
Form pencarian di `/app/akuntansi/jurnal` memancarkan parameter `from` dan
`to` **dua kali** pada URL (terbukti pada URL hasil kirim:
`?from=…&to=…&q=…&from=…&to=…&source=&account=&status=`), dan halaman melempar
error boundary ("Terjadi kesalahan — Halaman gagal dimuat") untuk parameter
tanggal duplikat. Reproduksi terisolasi: menduplikasi `from` saja atau `to`
saja sudah cukup memicu error; URL bersih (parameter tunggal) berfungsi —
termasuk pencarian referensi dokumen (BTF-2026-00002, OPB-2026-00002 ketemu
lewat keterangan). Halaman piutang-utang, laporan, dan buku-besar memakai pola
pencarian serupa tetapi TIDAK terkena — cacatnya spesifik pada komposisi form
halaman jurnal (kemungkinan besar SearchForm bersama + form tanggal halaman
sama-sama menulis from/to).
Bukti: `wf-i-cari-JE-2026-00034.png` (halaman error), matriks uji URL audit.
Rekomendasi terkecil: satu sumber kebenaran parameter filter di halaman jurnal
(hapus satu dari dua penulis from/to), tambah uji e2e "kirim pencarian jurnal
→ hasil tampil".

### UX-02 (P1 — responsif) Form Jurnal baru tidak terpakai di lebar 390
Tabel baris jurnal selebar 580px di dalam viewport 390px: kolom Debit/Kredit
terpotong di luar tepi kanan layar dan **halamannya sendiri** overflow
horizontal (metrik: `overflowX = true`, satu-satunya form inti dengan overflow
halaman di 390 selain piutang-utang & laporan). Pengguna ponsel tidak bisa
melihat kolom nominal tanpa menggeser seluruh halaman.
Bukti: `jurnal-baru-390.png`, `a22-metrics` (TABLE 580).
Rekomendasi terkecil: di bawah ±768px, baris jurnal menjadi kartu bertumpuk
(akun penuh, memo, lalu Debit/Kredit berdampingan) — pola kartu sudah dipakai
daftar beban; jangan sekadar mengecilkan tabel.

### UX-03 (P2 — responsif) Piutang & utang: pekerjaan tenggelam di bawah ringkasan pada layar kecil
Di 390px: 4 kartu statistik + 8 kartu umur piutang/utang menumpuk SEBELUM
daftar dokumen, dan tabel dokumen selebar 907px membuat halaman overflow.
Aksi utama halaman (Bayar/Terima per dokumen) berada jauh di bawah lipatan;
pengguna harus menggulir melewati ±12 kartu informasi murni dulu.
Bukti: `piutang-utang-390.png`, metrik (TABLE 907, overflowX true di 390).
Rekomendasi terkecil: di layar kecil lipat blok umur menjadi satu
`<details>`/accordion tertutup bawaan dan/atau tampilkan daftar dokumen lebih
dulu; tabel dokumen menjadi kartu per dokumen seperti pola daftar lain.

### UX-04 (P2 — responsif) Laporan: kolom pembanding tahun lalu terpotong di 390
Lima tabel laporan berukuran 399–430px pada viewport 390 (overflow halaman) —
kolom tahun pembanding (fitur wajib laporan menurut aturan proyek) berada di
luar layar; nama akun membungkus 2–3 baris ("4010 Diskon Penjualan",
"5000 Harga Pokok Penjualan").
Bukti: `laporan-390.png`, metrik.
Rekomendasi terkecil: di layar kecil sembunyikan kolom pembanding di balik
saklar "Bandingkan" (bawaan mati di <768) atau format dua baris per akun
(nama di atas, angka tahun ini–tahun lalu berdampingan kecil).

### UX-05 (P2 — workflow rekonsiliasi) Contoh format impor di UI ditolak oleh parsernya sendiri
Placeholder textarea impor menampilkan contoh baris TANPA header
(`03/11/2026;Setoran tunai;1.500.000;`), tetapi menempel persis format contoh
itu menghasilkan toast error "Header CSV tidak dikenali…". Pengguna wajib
menebak bahwa baris pertama harus header `Tanggal;Keterangan;Debit;Kredit`.
Sesudah header ditambahkan, impor + "Cocokkan otomatis" menyelesaikan
pencocokan dalam 2 klik dengan ringkasan jelas ("1 tertaut, 0 ambigu").
Gesekan pendamping: pesan kesalahan hanya berupa toast sesaat (tidak
menempel di panel), dan kontrol unggah berkas adalah `<input type=file>`
mentah berbahasa Inggris ("Choose File / No file chosen").
Bukti: `wf-f-rekon-sesudah-impor.png` (toast error + isian contoh),
`wf-f2-sesudah-cocokkan.png` (alur sukses).
Rekomendasi terkecil: terima tempelan tanpa header (deteksi baris pertama)
ATAU sertakan header pada contoh placeholder + tombol "Pakai contoh";
tampilkan kesalahan impor sebagai pesan menetap di dalam panel impor.

### UX-06 (P2 — konsistensi) Dua jalur untuk tugas yang sama, paradigma panel Input Cepat tidak jujur
Panel Input Cepat berjanji "Semua pencatatan harian dalam satu tempat — tanpa
berburu menu", tetapi dari 9 kartunya: ±5 membuka tab modal sungguhan
(Penjualan Tunai, Catat Beban, Transfer, Bayar Utang, Terima Piutang),
sedangkan "Jurnal Manual" menavigasi ke halaman form penuh, "Setoran Modal"
mengarah ke formulir di halaman Kas & bank, dan "Setor / Tarik Kas" adalah
aksi sesi POS. Kemampuan jalur juga berbeda (form beban halaman punya mode
terutang & konteks riwayat; modal punya pratinjau jurnal langsung). Pengguna
harus menghafal jalur mana yang lengkap untuk kebutuhan mana.
Bukti: `dashboard-akuntansi-1440.png`, `dashboard-akuntansi-390.png`,
perbandingan langkah (a) vs (a2).
Rekomendasi terkecil: beri penanda visual/jenis pada kartu yang meninggalkan
modal (ikon "buka halaman" + teks "di halaman …"), dan samakan kemampuan inti
antar-jalur untuk tugas yang sama.

### UX-07 (P2 — navigasi) Sidebar datar 18 item tanpa kelompok; klaster SDM tercampur di Akuntansi
Semua tugas satu klik dari mana pun (kedalaman baik), tetapi daftar menu
tunggal memuat: Ringkasan, Jurnal, Buku besar, Periode fiskal, Laporan, Beban,
Bank, Rekonsiliasi bank, Rekonsiliasi kontrol, Piutang & utang, **Payroll,
Kasbon, Pinjaman, Reimbursement** (klaster SDM), Aset tetap, Bagan akun,
Pengguna & peran, Pengaturan. Tidak ada pengelompokan maupun urutan frekuensi;
di 390 daftar ini menjadi guliran panjang di balik hamburger.
Bukti: seluruh tangkapan bersidebar; inventaris menu audit.
Rekomendasi terkecil: kelompokkan tanpa mengubah rute — mis. Harian
(Jurnal, Beban, Bank, Piutang & utang), Buku & Laporan (Buku besar, Laporan,
Periode, Rekonsiliasi ×2), SDM (Payroll, Kasbon, Pinjaman, Reimbursement),
Data & Pengaturan (Aset tetap, Bagan akun, Pengguna, Pengaturan).

### UX-08 (P2 — responsif/detail) Target sentuh kecil & teks 10px masih tersisa (sisa RD2U-03)
Elemen interaktif lebih pendek dari 28px ter
...[truncated 8182 chars]