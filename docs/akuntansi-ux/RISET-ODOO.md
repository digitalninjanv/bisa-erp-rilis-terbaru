# Riset UI/UX Akuntansi Odoo — Referensi Perbaikan Workflow Modul Akuntansi Bisa ERP

Mandat pengguna 2026-11-05 16:04 WIB: perbaikan UI/UX modul akuntansi dengan fokus
**workflow** ("desainnya jelek… pastikan supaya mudah memakainya dan responsif"),
dengan riset referensi Odoo. Dokumen ini adalah bahan risetnya: pola Odoo yang
**terverifikasi dari sumber web nyata** (diakses 2026-11-05), masalah workflow
yang diselesaikan tiap pola, cara interaksi persisnya, terapan konkret ke halaman
Bisa ERP, dan penilaian kecocokan yang jujur untuk konteks Bisa ERP (toko/
minimarket UKM Indonesia; pengguna campuran non-akuntan + akuntan; bahasa
Indonesia; gaya compact yang sudah diputuskan; komponen bersama shadcn).

## Metode & catatan kejujuran sumber

- Acuan utama: dokumentasi resmi Odoo 19.0 & 17.0 (odoo.com), buku Enterprise
  Cybrosys v18/v19 (implementator bereputasi), dokumentasi fork komunitas
  eYssen/OCA 18.0, dan halaman resmi aplikasi/modul terkait. URL dicantumkan
  per pola; tidak ada URL karangan.
- **Versi penting untuk dibaca benar**: beberapa pola berubah antarversi.
  Contoh terbesar: widget rekonsiliasi dua panel klasik adalah tampilan
  Odoo ≤17 (dan fork komunitas 18); Odoo 19 memakai *Bank Matching view*
  per-baris dengan tombol aksi usulan. Keduanya didokumentasikan apa adanya.
- Yang tidak dapat diverifikasi dari sumber ditandai **TIDAK TERVERIFIKASI**
  dan tidak direkomendasikan.
- Konteks Bisa ERP saat riset: 32 halaman di `src/app/app/akuntansi`
  (ringkasan, jurnal + jurnal/baru + detail, buku-besar, laporan, bank,
  rekonsiliasi + rekonsiliasi-kontrol, piutang-utang, beban, akun, periode,
  HR: hr/absensi/cuti/lembur/karyawan, payroll, kasbon, pinjaman, klaim, aset)
  plus modal Catat Transaksi (input cepat dengan pratinjau jurnal) yang hidup
  di komponen akuntansi.

---

## Pola 1 — Dashboard akuntansi = kartu aksi per area kerja, bukan sekadar ringkasan angka

**Masalah workflow yang diselesaikan.** Pengguna membuka modul akuntansi untuk
*bekerja* (memvalidasi faktur, membayar tagihan, merekonsiliasi bank), bukan
untuk membaca laporan. Dashboard yang hanya menampilkan total memaksa
navigasi berburu menu untuk setiap tugas; antrean kerja tidak terlihat
sehingga yang mendesak (terlambat, belum divalidasi) kalah oleh yang mudah.

**Cara kerja di Odoo.** Dashboard menampilkan satu kartu per jurnal/area
(Customer Invoices, Vendor Bills, Bank, Cash, POS, Payroll, Miscellaneous).
Setiap kartu memuat: (a) tombol buat-baru langsung dari kartu (mis. *New
Invoice*, *New Bill*, unggah); (b) **penghitung antrean berlabel aksi** —
"N To Validate", "N Unpaid", "N Late" beserta nominalnya; (c) untuk jurnal
bank: tombol **"Reconcile N Items"**, tautan "N to check", dan **cincin
progres rekonsiliasi**; (d) menu pintar per kartu (daftar dokumen, nota
kredit, pencocokan pembayaran, butir jurnal, laporan umur). Mengklik nama
jurnal bank membuka semua transaksi; mengklik tombol rekonsiliasi membuka
hanya yang belum terekonsiliasi. Kartu penjualan/pembelian juga menunjukkan
pengelompokan jatuh tempo (Overdue / This week / Next week / Later) pada
presentasi resmi Odoo 19.

**Terapan ke Bisa ERP.** Halaman `akuntansi/page.tsx` (Ringkasan): ubah kartu
area menjadi kartu aksi — Piutang (N belum lunas, N terlambat + nominal,
tombol ke daftar tertagih), Utang (N harus dibayar minggu ini), Bank per
rekening (N mutasi belum cocok + tombol "Rekonsiliasi" yang membuka daftar
tersaring belum-cocok), Jurnal (N draf menunggu posting bila konsep draf
dipakai), Beban (catat cepat). Aksi utama tetap juga tersedia lewat modal
Catat Transaksi yang sudah ada.

**Penilaian: COCOK.** Ini pola berdampak terbesar untuk pengguna non-akuntan:
dashboard berubah dari papan angka menjadi daftar kerja. Biaya implementasi
rendah karena datanya sudah dihitung modul server yang ada.

Sumber:
- https://www.cybrosys.com/odoo/odoo-books/v19/invoicing-and-accounting/
- https://doc.eyssen.com/applications/finance/accounting/bank/reconciliation.html
- https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html
- https://technextsg.github.io/technext-presentations/pdf/TechNext-Odoo-Accounting.pdf
- https://www.cybrosys.com/blog/an-overview-of-accounting-dashboard-in-odoo-16-erp

## Pola 2 — Daftar dokumen: chip filter status bawaan, pencarian facet, Group By, Favorites, aksi massal, navigasi keyboard

**Masalah workflow yang diselesaikan.** Daftar dokumen akuntansi cepat menjadi
ratusan baris; tanpa filter status satu-klik dan pengelompokan, pengguna
menggulir dan mencari manual — pekerjaan harian (mengejar yang terlambat,
memposting banyak draf) menjadi lambat dan rawan terlewat.

**Cara kerja di Odoo.** Di atas setiap daftar ada bilah pencarian dengan tiga
kelompok: **Filters** (filter bawaan bermakna bisnis: Draft, Posted, Unpaid,
Paid, **Overdue**, To Pay, In Payment, To Check, plus filter tanggal), **Group
By** (status, pihak, tanggal jatuh tempo per bulan/minggu, jurnal), dan
**Favorites** (menyimpan kombinasi pencarian sendiri). Daftar faktur/tagihan
juga tersedia sebagai **Kanban berkelompok status** sebagai alternatif tabel.
Memilih baris dengan checkbox memunculkan menu **Action** di tengah atas
(aksi massal atas yang terpilih; pada jurnal: *Post selected entries* adalah
contoh klasiknya). Pilihan cepat keyboard: Shift+Panah bawah/atas memperluas/
mengurangi pilihan berurutan (sejak Odoo 17); pintasan global Alt+Q
(pencarian), Alt+C (baru), Alt+S (simpan), Alt+L (list), Alt+K (kanban).

**Terapan ke Bisa ERP.** Halaman `akuntansi/jurnal`, `piutang-utang`,
`beban`, `klaim`, daftar payroll: tambahkan baris chip status satu-klik
(Semua / Belum lunas / Terlambat / Lunas / Draf bila ada), simpan filter
terakhir per pengguna (cukup lokal/dasar dulu), checkbox + bilah aksi massal
untuk operasi yang memang aman massal (posting draf jurnal, ekspor terpilih),
dan pastikan fokus keyboard & Enter membuka dokumen dari daftar.

**Penilaian: COCOK SEBAGIAN.** Chip status + Group By sederhana (per pihak /
per bulan jatuh tempo) berdampak besar dan murah. Favorites persisten dan
aksi massal penuh ala Odoo berisiko berlebih untuk volume UKM; ambil yang
terbukti dipakai (posting massal draf, ekspor) saja.

Sumber:
- https://www.cybrosys.com/odoo/odoo-books/v19/invoicing-and-accounting/customers/
- https://www.cybrosys.com/blog/how-to-record-supplier-bills-in-odoo-19-accounting
- https://doc.eyssen.com/applications/finance/accounting/payments/forecast.html
- https://www.forhimconsulting.com/odoo-tips-tricks-how-tos
- https://www.images.cybrosys.com/blog/an-overview-of-new-features-in-odoo-17-erp
- https://webkul.com/blog/odoo-shortcuts-keys/

## Pola 3 — Form jurnal/dokumen: baris inline-edit, total berjalan, gerbang keseimbangan, status Draf → Terposting sebagai bahasa visual

**Masalah workflow yang diselesaikan.** Entri jurnal manual adalah tempat
kesalahan paling mahal (tidak seimbang, salah akun). Form yang memisahkan
"isi baris" dari "lihat total" dan mengizinkan posting atas entri cacat
memindahkan kesalahan ke laporan.

**Cara kerja di Odoo.** Form entri jurnal punya tab *Journal Items*: tombol
"Add a Line" menambah baris yang diedit **di dalam tabel** (akun, pihak,
label, debit, kredit, pajak). Total debit/kredit berjalan selalu terlihat;
Odoo **memvalidasi keseimbangan sebelum mengizinkan posting**. Dokumen lahir
sebagai **Draft** (status terlihat sebagai lencana/ribbon), tombol **Post**
menguncinya menjadi Posted dan masuk laporan; koreksi atas yang terposting
lewat **Reverse Entry** (entri pembalik otomatis), bukan edit diam-diam.
Pada faktur/tagihan, tab *Journal Items* menampilkan jurnal hasil dokumen
sebelum final — pengguna memeriksa akibat akuntansinya di tempat yang sama.

**Terapan ke Bisa ERP.** `akuntansi/jurnal/baru` + editor baris jurnal manual:
pertahankan/semakin tegaskan total berjalan dengan indikator "Seimbang ✓ /
Selisih RpX" yang menonaktifkan tombol Posting (pola ini sudah hidup di
pratinjau modal Catat Transaksi — samakan bahasanya di editor jurnal manual);
lencana status konsisten di daftar & detail (`jurnal`, `jurnal/[id]`); tombol
pembalik selalu terlihat pada dokumen terposting. Prinsip proyek sendiri
(dokumen terposting tidak diedit diam-diam) selaras penuh dengan pola ini.

**Penilaian: COCOK.** Selaras dengan aturan integritas proyek; manfaatnya
pencegahan kesalahan di titik input, bukan kosmetik.

Sumber:
- https://www.cybrosys.com/odoo/odoo-books/v19/invoicing-and-accounting/accounting/
- https://www.cybrosys.com/odoo/odoo-books/v19/invoicing-and-accounting/customers/

## Pola 4 — Rekonsiliasi bank: mulai dari antrean, usulan pasangan otomatis, aksi per baris, baris lawan dari panel yang sama

**Masalah workflow yang diselesaikan.** Rekonsiliasi adalah pekerjaan
volume-tinggi berulang. Tanpa usulan otomatis dan tanpa kemampuan membuat
baris lawan (biaya bank, bunga) di tempat, pengguna bolak-balik antara layar
mutasi, jurnal, dan daftar faktur — dan antrean tak pernah habis.

**Cara kerja di Odoo (dua generasi, keduanya resmi).**
- **Klasik (≤17; fork komunitas 18)**: layar terbagi dua — kiri daftar kartu
  transaksi bank (tanggal, nominal, pihak, label; lencana *To check* /
  *Reconciled*); kanan entri hasil untuk transaksi terpilih: baris bank +
  baris lawan yang diusulkan/dipilih + **sisa terbuka**; tab *Match existing
  entries* (usulan terpilih-otomatis tampil pertama, tersaring ke pihak
  transaksi), *Manual operations* (buat baris lawan sendiri), dan tombol
  **model rekonsiliasi** di atas tab. Tombol **Validate aktif hanya saat
  entri seimbang**, lalu otomatis pindah ke transaksi berikutnya.
- **Odoo 19 (Bank Matching view)**: daftar baris transaksi (terbaru dulu);
  tiap baris membawa hingga dua **tombol aksi usulan** + menu elipsis:
  *Set Partner*, *Set Account* (tulis-bebas ke akun pilihan, nominal bisa
  disunting sebagian), *Receivable/Payable* (ke akun kontrol pihak),
  *Reconcile* (pilih satu/beberapa butir terbuka), *Batches*, tombol model
  rekonsiliasi, *Upload bills*, *Open Journal Entry*. Aturan pencocokan
  otomatis berjalan sekuensial: label dicocokkan ke nomor/referensi dokumen;
  bila pihak terisi, pencocokan berdasarkan nominal (exact → diskon termin →
  nominal-di-label). Sesudah cocok, tombol usulan **digantikan tampilan
  pasangan/akun lawannya**; membatalkan = hapus baris lawan. Transaksi duduk
  di akun suspense jurnal sampai terekonsiliasi penuh.
- **Model rekonsiliasi** adalah pola pendampingnya: aturan bernama untuk
  kejadian berulang (contoh resmi dokumentasi: sisa $3 dari tagihan $100
  pada mutasi $103 ditutup tombol model "Bank Fees" yang membuat baris lawan
  biaya bank) — bisa otomatis, usulan, atau tombol manual.

**Terapan ke Bisa ERP.** `akuntansi/rekonsiliasi`: pertahankan dua lapis yang
ada, tetapi ubah rasa halamannya menjadi antrean kerja ala pola ini —
daftar mutasi belum-cocok sebagai daftar utama (bukan tabel arsip), panel/
baris terpilih menampilkan usulan pasangan (dokumen pihak + nominal cocok)
dengan satu klik terima, sisa selalu terlihat, tombol "Cocokkan & lanjut"
yang nonaktif sampai seimbang dan otomatis maju ke mutasi berikutnya, serta
tombol cepat bernama untuk kejadian berulang Indonesia ("Biaya admin bank",
"Bunga bank", "PPh bunga") yang membuat baris lawan dari panel yang sama —
perluasan dari kemampuan multi-baris yang sudah dibangun (A-21 R3-12).

**Penilaian: COCOK (dengan pilihan generasi yang sadar).** Untuk volume
mutasi UKM, pola daftar-baris + aksi usulan Odoo 19 lebih realistis di web
responsif daripada mereplikasi widget dua panel klasik secara harfiah;
tetapi *rasa* dua panel (mutasi kiri, pasangan kanan) layak dipertahankan
pada lebar desktop. Model rekonsiliasi bernama adalah adopsi bernilai
tertinggi dari pola ini.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html
- https://doc.eyssen.com/applications/finance/accounting/bank/reconciliation.html
- https://www.cybrosys.com/odoo/odoo-books/v19/invoicing-and-accounting/reconciliation/

## Pola 5 — Pembayaran dari dokumen: Register Payment satu dialog, parsial dengan keputusan eksplisit, kredit menonjol ditawarkan kembali

**Masalah workflow yang diselesaikan.** Pembayaran yang dicatat jauh dari
dokumennya (menu terpisah, pilih dokumen dari daftar panjang) lambat dan
rawan salah alokasi; pembayaran sebagian dan kelebihan bayar menjadi kasus
khusus yang membingungkan.

**Cara kerja di Odoo.** Dari faktur/tagihan terposting, tombol **Register
Payment / Pay** membuka satu dialog ringkas (jurnal/metode, tanggal, nominal
yang sudah terisi sisa tagihan) → pembayaran tercipta, dokumen berstatus
*In Payment*; status menjadi *Paid* sesudah akun outstanding-nya
terekonsiliasi dengan mutasi bank. **Parsial**: mengubah nominal memunculkan
bidang *Payment Difference* dengan dua pilihan eksplisit — **Keep open**
(dokumen berstatus Partial, sisa tetap tertagih) atau **Mark as fully paid**
(selisih diposting ke akun pilihan). **Kelebihan/kredit**: pembayaran tak
tertaut menjadi *outstanding credit/debit* pihak; saat dokumen baru pihak
yang sama divalidasi, muncul **banner biru** "ada kredit tersedia" dengan
tombol **ADD** di bagian *Outstanding Credits* dokumen itu — kredit terpakai
dalam satu klik dari dokumen berikutnya. Tersedia juga pembayaran kelompok
(satu pembayaran untuk banyak dokumen) dan alat *Payments Matching* yang
memproses dokumen terbuka satu per satu.

**Terapan ke Bisa ERP.** `akuntansi/piutang-utang` + form pembayaran bersama:
Bisa ERP sudah punya mesinnya (pembayaran per dokumen & FIFO, dokumen kredit
pihak seri KRD dari A-21 R3-B, write-off berizin) — yang diadopsi adalah
*penyajiannya*: dialog bayar selalu berangkat dari dokumen dengan nominal
terisi sisa; bila nominal < sisa, tampilkan pilihan eksplisit "Biarkan sisa
terbuka / Tutup sebagai write-off (bila berizin & dalam ambang)" meniru
keputusan dua-pilihan Odoo; bila pihak punya kredit tersedia, tampilkan
banner di atas form dokumen/pembayaran pihak itu dengan tombol pakai —
bukan mengharuskan pengguna mengingat nomor dokumen kredit.

**Penilaian: COCOK.** Mesin domainnya sudah selesai dibangun (A-21); ini
murni perbaikan alur & penyajian, dampaknya langsung ke pekerjaan harian
penagihan/pembayaran.

Sumber:
- https://www.odoo.com/documentation/17.0/applications/finance/accounting/payments.html
- https://www.odoo.com/documentation/saas-18.1/applications/finance/accounting/payments.html

## Pola 6 — Laporan & bagan akun: hierarki hidup di laporan (grup akun + baris laporan bisa dilipat), drill-down angka → butir jurnal → dokumen

**Masalah workflow yang diselesaikan.** Angka laporan yang tidak bisa ditelusur
mati sebagai angka: akuntan tidak percaya, pemilik tidak bisa menjawab
"ini dari mana". Hierarki yang kaku di bagan akun juga mengunci fleksibilitas
penyajian laporan.

**Cara kerja di Odoo (dengan koreksi fakta penting).** Bagan akun Odoo modern
pada dasarnya **datar**; hierarki dibentuk oleh **Account Groups** — grup
berdasarkan awalan kode akun, bisa berinduk, yang dipakai laporan saat opsi
hierarki diaktifkan — dan oleh **baris laporan yang bisa dilipat (foldable)**
dengan rumus atas baris anak. Laporan keuangan (Neraca, Laba Rugi, Buku
Besar) mendukung **Unfold All / lipat per bagian**, filter satu baris di atas
laporan (tanggal, jurnal, pihak, banding periode), dan **drill-down**:
mengklik baris/bagian membuka butir jurnal penyusunnya, dan dari sana entri
jurnal serta dokumen sumbernya. Buku Besar mengelompokkan per akun dengan
saldo awal/berjalan/akhir; *Partner Ledger* dan *Aged* melakukan hal yang
sama per pihak dan keranjang umur. Jejak audit (Audit Trail) mencatat siapa
mengubah apa pada dokumen keuangan.

**Terapan ke Bisa ERP.** `akuntansi/laporan` + `akuntansi/buku-besar` +
`akuntansi/akun`: Bisa ERP sudah punya komponen dokumen laporan bersama,
kolom pembanding tahun lalu, dan subtotal bertingkat — langkah berikutnya
yang sejalan pola ini: setiap angka pada laporan & buku besar menjadi tautan
drill-down (angka → daftar butir jurnal penyusun dengan filter yang sama →
detail jurnal → dokumen sumber), bagian laporan bisa dilipat per kelompok
akun (mengikuti pemetaan kelompok laporan yang sudah ada), dan dari halaman
akun, saldo akun menaut ke buku besar tersaring akun itu. Di halaman bagan
akun sendiri cukup pengelompokan visual per tipe akun — jangan memaksakan
pohon akun.

**Penilaian: COCOK SEBAGIAN.** Drill-down-nya cocok penuh dan menaikkan
kepercayaan angka. Hierarki bagan akun ala pohon **tidak cocok** — dan
ternyata bukan pola Odoo modern juga; hierarki yang benar tinggal di
laporan, yang sudah menjadi arah Bisa ERP.

Sumber:
- https://doc.eyssen.com/developer/howtos/accounting_localization.html
- https://www.cybrosys.com/odoo/odoo-books/odoo-17-accounting/account-groups/
- https://www.cybrosys.com/odoo/odoo-books/v18/accounting/reporting/
- https://www.slideshare.net/slideshow/guide-to-general-ledger-in-odoo-19-enterprise-edition/289043706

## Pola 7 — Responsif & mobile: tampilan Kanban sebagai wajah kecil, aplikasi mobile resmi, panel kontrol yang melipat

**Masalah workflow yang diselesaikan.** Pemilik toko memeriksa piutang dan
menyetujui dari ponsel; tabel akuntansi lebar yang dipaksa menyusut tidak
terbaca dan tombol aksi hilang dari jangkauan.

**Cara kerja di Odoo (dibedakan tegas per kanal).**
- **Web**: dokumen daftar seperti faktur & tagihan punya tampilan **Kanban
  berkelompok status** (kartu per dokumen) sebagai alternatif resmi tabel —
  inilah wajah yang masuk akal di layar kecil, sementara tabel tetap untuk
  desktop. Modul komunitas OCA *Web Responsive* melangkah lebih jauh:
  navigasi laci aplikasi dan **menampilkan kanban untuk layar kecil** pada
  aksi/field tertentu. Klaim bahwa tabel akuntansi inti Odoo *otomatis
  berubah menjadi kartu* di web **TIDAK TERVERIFIKASI** dari dokumentasi
  resmi — jangan dijadikan acuan desain.
- **Aplikasi mobile resmi Odoo** (Enterprise, Android/iOS): semua aplikasi
  basis data tersedia dari satu aplikasi dengan "pengantaran konten adaptif"
  agar setiap layar optimal di ukuran perangkat apa pun, plus notifikasi
  dorong untuk hal yang diikuti.

**Terapan ke Bisa ERP.** Daftar padat akuntansi (`piutang-utang`, `jurnal`,
`beban`, `klaim`, daftar mutasi `bank`/`rekonsiliasi`): pada lebar kecil
beralih ke daftar kartu ringkas (pihak, sisa/nominal, status, satu aksi
utama) — pola yang sama seperti pemecahan panel POS yang sudah terbukti di
proyek ini — sementara tabel penuh hanya di ≥lg; form entri (jurnal manual,
pembayaran) menjadi satu kolom dengan total & tombol aksi lengket di bawah.
Dashboard kartu aksi Pola 1 secara alami responsif (tumpukan satu kolom).

**Penilaian: COCOK SEBAGIAN.** Prinsip "kartu untuk kecil, tabel untuk
besar" cocok dan sejalan preseden POS. Meniru aplikasi mobile native Odoo
tidak cocok (di luar panggung); cukup web responsif yang disiplin.

Sumber:
- https://www.cybrosys.com/odoo/odoo-books/v19/invoicing-and-accounting/customers/
- https://apps.ODOO.com/apps/modules/11.0/web_responsive
- https://play.google.com/store/apps/details?id=com.odoo.mobile&hl=en

## Pola 8 — Onboarding & keadaan kosong: banner langkah-berurutan di dashboard + empty state yang menunjuk aksi pertama

**Masalah workflow yang diselesaikan.** Perusahaan baru menghadapi modul
akuntansi kosong tanpa tahu urutan setup (data perusahaan → bank → periode →
bagan akun), dan daftar kosong yang bisu membuat pengguna pertama menyangka
fitur rusak.

**Cara kerja di Odoo.** Saat pertama membuka aplikasi, *Accounting Overview*
menampilkan **banner onboarding langkah-berurutan** yang menetap sampai
ditutup pengguna, terdiri dari empat langkah: **Company Data → Bank Account →
Accounting Periods → Chart of Accounts**; paket lokalisasi fiskal negara
terpasang otomatis dari negara basis data sehingga bagan akun, pajak, dan
laporan bawaan sudah terisi sebelum pengguna mulai. Langkah bagan akun
sekaligus tempat meninjau akun dan mengisi saldo awal. Di luar onboarding,
daftar yang kosong di Odoo umumnya menampilkan ajakan membuat catatan
pertama dari tombol New yang sama.

**Terapan ke Bisa ERP.** `akuntansi/page.tsx`: bila perusahaan belum punya
jurnal/bagan belum ditinjau (kondisi terdeteksi dari data), tampilkan kartu
langkah berbahasa Indonesia ("1. Periksa bagan akun → 2. Hubungkan rekening
bank → 3. Atur periode & pajak → 4. Catat transaksi pertama") yang hilang
permanen sesudah selesai/ditutup. Samakan bahasa semua `EmptyState` bersama
di modul akuntansi menjadi ajakan bertindak ("Belum ada beban — catat beban
pertama", dengan tombolnya), bukan sekadar pernyataan kosong.

**Penilaian: COCOK.** Murah, berdampak langsung pada aktivasi pengguna baru
non-akuntan; sejalan komponen EmptyState bersama yang sudah ada.

Sumber:
- https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started.html
- https://www.odoo.com/documentation/saas-15.4/applications/finance/accounting/getting_started/initial_configuration/setup.html
- https://jidokasystem.co.id/blog/dokumentasi-odoo-3/post/initial-setup-of-odoo-accounting-and-odoo-invoicing-18

---

## Pola pendamping yang ditemukan (bernilai, di luar daftar wajib)

- **Pengingat tindak-lanjut piutang (follow-up)**: daftar piutang menampilkan
  status & jumlah pengingat yang sudah dikirim per pelanggan; pengingat
  berjalan dari daftar terlambat. Terapan: kolom/badge "sudah diingatkan"
  sederhana di `piutang-utang` sebelum membangun otomatisasi penuh.
  (Sumber: https://www.cybrosys.com/odoo/odoo-books/v19/contacts/)
- **Indikator pengecualian di dashboard**: penghitung "To Check",
  urutan nomor tidak beraturan (*Irregular Sequences*), dan draf menunggu
  validasi sebagai penghitung yang bisa diklik menuju antreannya — memperkuat
  Pola 1 untuk peran akuntan.
  (Sumber: https://doc.eyssen.com/applications/finance/accounting/bank/reconciliation.html)

## Yang TIDAK diadopsi / tidak terverifikasi (dicatat agar tidak dibangun atas asumsi)

1. **Widget rekonsiliasi dua panel persis klasik** sebagai satu-satunya
   tampilan — itu tampilan ≤17/fork; Odoo 19 sendiri meninggalkannya ke
   daftar-baris beraksi-usulan. Adopsi rasanya, bukan replika pikselnya.
2. **Pohon bagan akun bisa dilipat di halaman CoA** — bukan pola Odoo modern
   (bagan datar + grup akun untuk laporan). Membangunnya adalah karangan,
   bukan referensi.
3. **Tabel web yang otomatis menjadi kartu di layar kecil pada inti Odoo** —
   TIDAK TERVERIFIKASI dari dokumentasi resmi; yang terverifikasi adalah
   Kanban sebagai tampilan alternatif dan perilaku modul komunitas OCA.
4. **Digitasi/OCR tagihan dari dashboard** (unggah PDF → draf terisi) adalah
   fitur Enterprise/IAP Odoo — nyata, tetapi di luar jangkauan & panggung
   Bisa ERP saat ini; dicatat sebagai inspirasi jangka panjang, bukan
   rekomendasi tahap ini.

## Urutan dampak workflow (ringkasan untuk perencanaan tahap)

1. Dashboard kartu aksi berantrean (Pola 1) — `akuntansi/page.tsx`.
2. Rekonsiliasi rasa-antrean: usulan pasangan satu-klik, sisa terlihat,
   tombol model bernama, lanjut-otomatis (Pola 4) — `akuntansi/rekonsiliasi`.
3. Penyajian pembayaran Odoo: dialog dari dokumen, keputusan parsial
   eksplisit, banner kredit tersedia (Pola 5) — `akuntansi/piutang-utang`.
4. Chip filter status + Group By ringan + aksi massal aman di daftar
   dokumen (Pola 2) — `jurnal`, `piutang-utang`, `beban`, `klaim`.
5. Gerbang keseimbangan & bahasa status yang konsisten di editor jurnal
   manual (Pola 3) — `jurnal/baru`, daftar & detail jurnal.
6. Drill-down angka laporan → butir jurnal → dokumen sumber (Pola 6) —
   `laporan`, `buku-besar`, `akun`.
7. Daftar kartu di lebar kecil + aksi lengket pada form (Pola 7) — semua
   daftar padat akuntansi.
8. Onboarding langkah + EmptyState berajakan (Pola 8) — dashboard &
   seluruh modul.
