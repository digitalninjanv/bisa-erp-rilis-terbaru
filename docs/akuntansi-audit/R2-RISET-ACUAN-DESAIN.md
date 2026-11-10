# R2 — Riset Acuan: Seperti Apa Laporan Keuangan & Layar Akuntansi yang Profesional

Tanggal riset: 2026-11-04 · Sifat: baca-saja, riset web (sumber tercantum per butir)
Tujuan: daftar periksa yang bisa dipakai mengaudit & menaikkan kelas desain laporan Bisa ERP.

---

## Ringkasan eksekutif

Laporan terasa "profesional" bukan karena dekorasi, melainkan karena tiga hal yang
konsisten: **(1) struktur mengikuti standar** — PSAK 201/IAS 1 (dan arah IFRS 18)
menentukan isi minimum, subtotal, klasifikasi lancar/tidak lancar, larangan saling
hapus, dan informasi komparatif; **(2) disiplin tipografi angka** — angka tabular
rata kanan, negatif dalam kurung, garis tunggal di atas subtotal dan garis ganda di
bawah total akhir, satuan & mata uang dinyatakan di kepala laporan; **(3) identitas
dokumen yang lengkap** — nama entitas, judul laporan, periode/tanggal posisi, mata
uang & tingkat pembulatan, dan pada cetakan resmi: kop, footer bernomor halaman,
serta blok "Disiapkan oleh / Disetujui oleh". Produk pembanding (Accurate Online,
Odoo, Mekari Jurnal, Xero, QuickBooks) semuanya menambahkan lapisan interaksi yang
sama: drill-down angka → transaksi, kolom komparatif + varian %/$ dalam satu klik,
template laporan yang bisa disimpan, dan ekspor PDF/Excel yang tampilannya identik
dengan layar.

---

## (a) Daftar periksa "Laporan Profesional" — 34 butir

### Kelompok 1 — Struktur & Isi (mengacu PSAK 201 / IAS 1, PSAK 207 / IAS 7, IFRS 18)

1. **Satu paket lengkap lima komponen**: laporan posisi keuangan, laporan laba rugi
   & penghasilan komprehensif lain, laporan perubahan ekuitas, laporan arus kas,
   dan catatan atas laporan keuangan — bukan tiga laporan yang berdiri sendiri.
   *(PSAK 201 ¶10 / IAS 1.10; komponen lengkap wajib termasuk informasi komparatif.)*
2. **Pos minimum neraca tampil sebagai baris tersendiri**: aset tetap, properti
   investasi, aset takberwujud, aset keuangan, persediaan, piutang dagang & lain-lain,
   kas & setara kas, utang dagang & lain-lain, provisi, liabilitas keuangan, aset/
   liabilitas pajak kini & tangguhan, modal disetor & cadangan. *(IAS 1.54.)*
3. **Pos minimum laba rugi tampil**: pendapatan, biaya keuangan, bagian laba entitas
   asosiasi/ventura bersama (metode ekuitas), beban pajak. *(IAS 1.82.)*
4. **Klasifikasi lancar vs tidak lancar** untuk aset dan liabilitas, berurutan
   menurut likuiditas/jatuh tempo — bukan satu daftar datar. *(IAS 1.60–66; klasifikasi
   liabilitas diamendemen efektif 2023/2024.)*
5. **Subtotal berjenjang di laba rugi**: laba bruto → laba operasi → laba sebelum
   pajak → laba bersih periode berjalan. Subtotal "laba operasi" dan "laba sebelum
   pendanaan & pajak" akan menjadi **wajib terdefinisi** di IFRS 18 (pengganti
   IAS 1, efektif periode mulai ≥ 1 Jan 2027, komparatif disajikan kembali).
   *(IAS 1.85 praktik baik; IFRS 18.69 subtotal wajib: laba operasi; laba sebelum
   pendanaan dan pajak penghasilan.)*
6. **Kategori laba rugi terstruktur** (arah IFRS 18): setiap pos masuk tepat satu
   kategori — operasi, investasi, pendanaan, pajak penghasilan, operasi dihentikan.
   Struktur pengelompokan akun di sistem sebaiknya sudah memetakan kelimanya.
   *(IFRS 18.47.)*
7. **Tanpa pos "luar biasa"** — penyajian extraordinary item tidak diperkenankan.
   *(PSAK 201/IAS 1.)*
8. **Larangan saling hapus (offsetting)**: aset–liabilitas dan penghasilan–beban
   disajikan bruto, tidak dinetokan, kecuali standar membolehkan (mis. keuntungan
   pelepasan aset). Pendapatan dan HPP-nya selalu terpisah. *(IAS 1.32.)*
9. **Informasi komparatif periode sebelumnya untuk semua jumlah** — minimal dua
   neraca, dua laba rugi, dua arus kas, dua perubahan ekuitas + catatan terkait;
   neraca ketiga (awal periode komparatif) bila ada penerapan retrospektif/
   reklasifikasi material. *(IAS 1.36–38, 40A.)*
10. **Arus kas tiga aktivitas**: operasi, investasi, pendanaan — dengan subtotal
    bersih per aktivitas, rekonsiliasi kas awal → kas akhir yang cocok dengan
    neraca. *(PSAK 207/IAS 7.)*
11. **Metode arus kas operasi dinyatakan** (langsung atau tidak langsung); metode
    langsung dianjurkan standar; bila tidak langsung, rekonsiliasi mulai dari
    laba — dan menurut amendemen IFRS 18 atas IAS 7, titik awalnya adalah
    **laba operasi**. *(PSAK 207; IFRS 18 konsekuensial IAS 7.)*
12. **Perubahan ekuitas direkonsiliasi**: saldo awal → laba komprehensif → transaksi
    pemilik (setoran, dividen/prive) → saldo akhir, per komponen ekuitas.
    *(IAS 1.106.)*
13. **Materialitas & agregasi disiplin**: kelas pos material disajikan terpisah;
    pos tak sejenis tidak digabung kecuali tidak material; pos kecil yang tetap
    informatif masuk catatan, bukan hilang. *(IAS 1.29–31.)*
14. **Konsistensi penyajian antarperiode**: klasifikasi & urutan tidak berubah
    diam-diam dari periode ke periode; perubahan harus diungkapkan. *(IAS 1.45.)*

### Kelompok 2 — Tipografi & Angka

15. **Angka tabular (monospaced figures) & rata kanan**: setiap digit berlebar sama
    sehingga koma desimal sejajar vertikal dalam satu kolom; pemisah ribuan
    konsisten `1.250.000` (format id-ID). *(Praktik desain UI finansial: tabular-nums;
    Gapsy & AdminLTE dashboard design guides.)*
16. **Negatif dalam tanda kurung** `(42.000)`, bukan tanda minus, pada laporan
    formal — lebih mudah dibedakan saat memindai kolom; satu konvensi dipakai
    konsisten di semua laporan. *(Konvensi penyajian laporan keuangan; JohnTheCPA
    formatting rules; FE Training.)*
17. **Hierarki garis**: garis tunggal tepat di atas angka subtotal/total, garis
    ganda di bawah total akhir (grand total). Garis adalah bahasa: pembaca tahu
    angka mana hasil penjumlahan tanpa membaca label. *(Konvensi textbook
    akuntansi — McGraw-Hill; FE Training financial model formatting.)*
18. **Simbol mata uang hemat**: "Rp" hanya pada baris pertama suatu kelompok dan
    pada total/subtotalnya — bukan di setiap baris. *(McGraw-Hill; JohnTheCPA
    "Dollar signs: less is more".)*
19. **Presisi desimal seragam** dalam satu laporan (semua tanpa desimal, atau semua
    dua desimal); persen dengan jumlah desimal seragam. Campur `12,50%`, `8%`,
    `-3,7%` dalam satu tabel = tanda amatir. *(Number-formatting best practice.)*
20. **Satuan dinyatakan bila dibulatkan**: bila angka dalam ribuan/jutaan, kepala
    laporan menulis "(dalam ribuan Rupiah)" — dan pembulatan tidak boleh menelan
    informasi material. *(IAS 1.51(e), 1.53.)*
21. **Nol ditampilkan konsisten**: pilih satu gaya — strip `—`, `0`, atau kosong —
    untuk semua laporan; kontra-akun (akumulasi penyusutan) tampil dalam kurung
    di dalam kelompoknya sebelum subtotal neto. *(Konvensi penyajian textbook.)*
22. **Indentasi hierarkis**: pos rincian menjorok dari judul kelompoknya; subtotal
    sejajar dengan judul kelompok; total akhir paling menonjol (tebal + garis
    ganda). Mata membaca struktur dari tepi kiri. *(Praktik standar laporan;
    struktur multi-step Accurate/Odoo.)*
23. **Label dwi-makna untuk angka yang bisa berubah tanda**: "Laba (Rugi) Bersih",
    "Kenaikan (Penurunan) Kas" — bukan "Laba Bersih" yang dipaksa negatif.
    *(Konvensi penyajian komparatif textbook.)*

### Kelompok 3 — Kop & Identitas Dokumen

24. **Kepala laporan memuat lima identifikasi wajib**, ditampilkan menonjol dan
    diulang bila perlu: (a) nama entitas pelapor, (b) keterangan entitas tunggal
    atau grup, (c) tanggal akhir periode / periode yang dicakup, (d) mata uang
    penyajian, (e) tingkat pembulatan. *(IAS 1.49–51.)*
25. **Rumusan periode berbeda per jenis laporan**: neraca = "Per [tanggal]"
    (posisi pada satu titik); laba rugi/arus kas/perubahan ekuitas = "Untuk
    Periode/Tahun yang Berakhir pada [tanggal]" (rentang waktu). Tertukar =
    langsung ketahuan tidak paham. *(Konvensi heading laporan; contoh Accurate.)*
26. **Kop cetak resmi**: logo + nama + alamat/kontak perusahaan di kepala halaman
    pertama (dan kepala ringkas di halaman berikutnya) — menegaskan identitas &
    keabsahan dokumen. *(Praktik surat/dokumen resmi Indonesia; Desain Cetakan
    Accurate.)*
27. **Footer setiap halaman cetak**: nomor halaman ("Halaman 2 dari 5"), judul
    laporan + periode, dan waktu/sistem penghasil ("Dicetak dari Bisa ERP,
    [tanggal jam]") agar lembar lepas tetap bisa dilacak asal-usulnya.
    *(Praktik dokumen resmi & sistem ERP.)*
28. **Blok persetujuan di akhir laporan resmi**: "Disiapkan oleh — (nama/jabatan,
    tanggal)" dan "Disetujui oleh — (nama/jabatan, tanggal)" dengan ruang tanda
    tangan; untuk laporan tahunan ditambah keterangan tanggal otorisasi
    penerbitan. *(Praktik pertanggungjawaban manajemen Indonesia; tanggal
    otorisasi: IAS 10/PSAK 208 pengungkapan di catatan.)*
29. **Referensi catatan menempel pada baris**: pos yang punya penjelasan di CALK
    membawa nomor catatan di kolom tersendiri, dan laporan selalu merujuk
    catatan yang menyertainya. *(IAS 1 struktur & isi; konvensi textbook.)*

### Kelompok 4 — Layar vs Cetak

30. **Layar ≠ cetak, tetapi angkanya identik**: layar boleh interaktif (lipat/
    bentang, drill-down, filter), cetak/PDF harus membekukan struktur yang sama —
    kop, subtotal, garis, footer halaman — tanpa elemen UI (tombol, menu) ikut
    tercetak. Pratinjau cetak tersedia sebelum benar-benar mencetak.
    *(Odoo: print preview & ekspor PDF/XLSX dari tampilan yang sama; QuickBooks
    management reports sebagai paket PDF berhalaman sampul.)*
31. **Ringkasan eksekutif di layar utama akuntansi**: kartu KPI (kas, laba
    periode berjalan, piutang/utang jatuh tempo) dengan **pembanding** ("+12%
    vs bulan lalu") dan grafik tren seperlunya; angka telanjang tanpa baseline
    dianggap dekorasi. Satu angka terpenting mendapat slot & ukuran terbesar.
    *(Xero Executive Summary; prinsip dashboard: AdminLTE/Gapsy — setiap angka
    wajib punya rujukan pembanding.)*
32. **Kepadatan dua rezim**: layar kerja akuntan = padat & ringkas (baris rapat,
    header lengket/sticky, angka tabular); layar eksekutif = longgar & besar.
    Kepadatan idealnya bisa diatur pengguna, bukan satu ukuran untuk semua.
    *(Prinsip desain dashboard finansial — data density & hierarchy.)*
33. **Keadaan kosong & memuat dirancang**: periode tanpa transaksi menampilkan
    keadaan kosong yang menjelaskan ("Belum ada jurnal pada periode ini")
    beserta tindakan berikutnya, dan pemuatan laporan berat menampilkan
    indikator — bukan tabel kosong membingungkan atau layar beku.
    *(Prinsip admin dashboard modern: "design the empty and pending states".)*

### Kelompok 5 — Interaksi

34. **Drill-down tanpa putus**: angka laporan → akun → jurnal → dokumen sumber
    (faktur/pembayaran) dalam klik berurutan, dan anotasi/catatan bisa ditempel
    pada laporan untuk penasihat/auditor. *(Accurate: drill-down; Odoo: drill
    down + annotate; Xero: drill dari Executive Summary.)*
35. **Komparatif & varian sekali klik**: periode sebelumnya, periode sama tahun
    lalu, dan/atau anggaran — lengkap dengan kolom selisih nominal **dan** %
    serta penanda arah yang menguntungkan/merugikan; juga kolom "% terhadap
    pendapatan" pada laba rugi. *(Xero compare + variance arrows; QuickBooks
    $ change/% change; Accurate kolom perbandingan bulan lalu; Odoo comparison
    hingga 12 periode.)*
36. **Template laporan tersimpan & konsisten antar-laporan**: filter, kolom,
    pengelompokan, dan urutan akun yang diatur pengguna tersimpan sebagai
    template bernama dan dipakai ulang; semua laporan memakai komponen &
    perilaku yang sama (satu pola filter, satu pola ekspor PDF/Excel/CSV).
    *(Accurate "Simpan Sebagai" template; QuickBooks Save Customization &
    Custom Reports; Mekari Jurnal custom report.)*

---

## (b) Pola tiap produk pembanding

**Accurate Online (Indonesia)** — Kekuatannya pada rasa "laporan standar
Indonesia": 200+ laporan terjurnal otomatis; laba rugi dua tampilan — Klasik
(satu periode) dan Multi Kolom (banding antarbulan/antarkuartal/tahun lalu);
fitur **Modifikasi** di atas laporan (tab Grup/Tampilan: urutkan, tampil/sembunyai
kolom & baris, persentase terhadap total, dengan/tanpa desimal, kolom perbandingan
bulan lalu) dan **Simpan Sebagai** template; drill-down dari angka ke rincian
transaksi; ekspor PDF/Excel/CSV; Desain Cetakan terpisah untuk dokumen transaksi
(kop, tata letak bisa didesain). Pelajaran: laporan bawaan sudah benar secara
standar sehingga pengguna tidak mulai dari nol — kustomisasi adalah lapisan di
atas standar, bukan penggantinya.

**Odoo Accounting** — Laporan generik dinamis (Neraca, Laba Rugi, Buku Besar,
Neraca Saldo, Arus Kas, Executive Summary, Aged Partner, Tax Report) dengan pola
interaksi seragam: baris bisa dilipat/dibentangkan, panah untuk drill ke jurnal/
faktur/pembayaran, **anotasi** pada laporan, menu Comparison (periode sebelumnya,
periode sama tahun lalu, kustom, hingga 12 periode ke belakang), ekspor PDF/XLSX
dari tombol yang sama di semua laporan. Di Enterprise, **struktur laporan adalah
data, bukan kode** (Account Reports: baris bertipe View/Accounts/Account Type/
Report Value) sehingga layout PSAK bisa disusun tanpa mengubah program.
Pelajaran: satu kerangka laporan untuk semua jenis laporan = konsistensi gratis.

**Mekari Jurnal (Indonesia)** — 40–80+ laporan real-time sesuai SAK; laba rugi,
neraca, arus kas (arus kas tersedia **dua metode: langsung & tidak langsung**),
perubahan ekuitas, buku besar, jurnal umum; periode fleksibel (per tanggal s.d.
tahun lalu) dan ekspor PDF/Excel/CSV; custom report (kolom, filter, dimensi,
custom field) dan konsolidasi cabang; lapisan analisis: dashboard + AI (Airene)
yang merangkum tren laba rugi & margin. Menyebut eksplisit kesesuaian SAK EMKM
(posisi keuangan, laba rugi, CALK) untuk UMKM. Pelajaran: paket standar
ditambah ringkasan naratif membuat laporan terasa "dibuatkan akuntan", bukan
sekadar dibuang dari database.

**Xero** — Executive Summary sebagai beranda: KPI kas/profitabilitas/posisi
dengan drill ke laporan dasarnya; opsi **Compare with** (periode sebelumnya /
rata-rata) yang otomatis menambah kolom varian % dengan panah naik/turun
berwarna menguntungkan (hijau) / merugikan (merah); kolom "% of turnover" pada
laba rugi; layout editor drag-and-drop (baris/kolom, rumus, catatan, tautan ke
schedule), layout tersimpan & favorit; Budget Variance membandingkan aktual vs
anggaran nominal + %. Pelajaran: pembanding bukan fitur tambahan — ia bawaan
setiap layar ringkasan.

**QuickBooks Online** — Reports Center berkategori; kustomisasi laporan meliputi
periode, kolom per bulan, **Compare another period** dengan $ change dan
% change, metode kas/akrual, format angka (bagi 1000, tanpa sen, sembunyikan
nol), filter per pelanggan/dimensi; **Save Customization** → Custom Reports;
**Management Reports**: paket PDF formal berisi halaman sampul, daftar isi,
surat pengantar/intro, laporan-laporan, dan catatan akhir — inilah pola
"laporan resmi untuk pihak luar" yang paling eksplisit di kelasnya.
Pelajaran: ada perbedaan sadar antara laporan kerja (layar) dan paket laporan
resmi (PDF beridentitas lengkap).

---

## (c) 10 kesenjangan desain yang paling sering membuat laporan terasa amatir

1. **Tanpa kop identitas** — laporan dibuka langsung dengan tabel; tidak ada nama
   perusahaan, judul laporan, atau periode. Sekali dicetak/diforward, lembar itu
   yatim: tak jelas milik siapa dan periode apa. *(Melanggar IAS 1.51.)*
2. **Negatif bertanda minus dan angka tidak sejajar** — font proporsional membuat
   digit bergeser; pembaca tidak bisa memindai kolom. Ini kesalahan yang paling
   cepat terlihat oleh akuntan mana pun.
3. **Total tanpa bahasa garis** — subtotal dan total akhir hanya dibedakan oleh
   label teks; tidak ada garis atas subtotal dan garis ganda penutup, sehingga
   struktur penjumlahan harus ditebak.
4. **Daftar datar tanpa subtotal berjenjang** — laba rugi langsung melompat dari
   pendapatan ke laba bersih; tak ada laba bruto/laba operasi; neraca tak
   memisahkan lancar/tidak lancar. Terasa seperti ekspor database, bukan laporan.
5. **Tidak ada komparatif** — angka satu periode berdiri sendiri; pembaca tak
   bisa menilai naik/turun. Standar mewajibkan komparatif; produk pembanding
   menjadikannya satu klik.
6. **Saling hapus diam-diam** — pendapatan disajikan neto terhadap retur/diskon
   tanpa baris bruto, atau pos-pos dinetokan; melanggar IAS 1.32 dan menyembunyikan
   informasi yang justru ingin dilihat pemilik.
7. **Satuan & presisi campur aduk** — sebagian angka berdesimal, sebagian tidak;
   "Rp" di semua baris atau tak ada sama sekali; angka dibulatkan tanpa
   keterangan satuan. Inkonsistensi kecil yang meruntuhkan kredibilitas.
8. **Cetak adalah tangkapan layar** — PDF berisi tombol, menu, dan kolom terpotong;
   tanpa kop berulang, tanpa nomor halaman, tanpa blok tanda tangan; halaman
   kedua kehilangan konteks kolom.
9. **Mati di angka** — angka laporan tidak bisa diklik; untuk memeriksa satu angka
   pengguna harus membuka modul lain dan mencari manual. Audit trail visual
   putus = kepercayaan putus.
10. **Setiap laporan dunia sendiri** — pola filter, tombol ekspor, format angka,
    dan istilah berbeda-beda antar-laporan; pengguna harus belajar ulang di
    setiap halaman. Profesional = satu sistem desain yang dipakai semua laporan.

---

## Sumber utama

- PSAK 201 / IAS 1 — komponen lengkap, pos minimum, komparatif, identifikasi
  ¶49–51: Kledo (kledo.com/blog/psak-201); Kamus PSAK (kamuspsak.balancioindo.com);
  teks IAS 1 (ifrs.org — IAS 1 HTML standard); ringkasan IAS 1 (Moore Global).
- IFRS 18 (pengganti IAS 1, efektif 2027) — kategori & subtotal wajib: CLA
  Emirates; UQ Consulting IFRS 18 guide; RSI Journals review.
- PSAK 207 / IAS 7 — tiga aktivitas, dua metode: IAI (web.iaiglobal.or.id);
  Kamus PSAK PSAK 207; Kledo laporan arus kas.
- Konvensi format — kurung negatif, garis tunggal/ganda, simbol mata uang hemat,
  heading empat unsur: McGraw-Hill (The Four Basic Financial Statements);
  JohnTheCPA formatting rules; FE Training financial model formatting.
- Accurate Online — tampilan klasik/multi-kolom, modifikasi, drill-down,
  template: accurate.id (Cara Membuat Laporan Keuangan; Jenis Laporan Keuangan);
  trainingaccurate.com (Modifikasi Laporan Keuangan); aplikasiumkm.com.
- Odoo — dokumentasi Reporting 17/18/19 (odoo.com/documentation): drill-down,
  anotasi, comparison, ekspor PDF/XLSX; Odoo Accounting cheat sheet (struktur
  laba bruto → laba operasi); Cybrosys Odoo 16 Accounting Book.
- Mekari Jurnal — jurnal.id (Fitur Laporan Keuangan; Panduan UKM): ekspor,
  template kustom, arus kas dua metode, SAK EMKM, Airene.
- Xero — Xero Central (Executive Summary: compare & variance); xero.com
  financial reports; Stryde (Xero report options: % of turnover, compare).
- QuickBooks — Intuit Support (Customize reports; P&L comparison: PY/PP,
  $/% change; Management Reports berisi sampul & daftar isi).
- Prinsip desain layar — Gapsy (financial app design: tabular figures);
  AdminLTE (admin dashboard design: density, one verdict per screen, empty
  states); Elmtnl/FD Capital (dashboard: progressive disclosure, pembanding
  wajib).
