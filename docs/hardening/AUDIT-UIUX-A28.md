# AUDIT UI/UX A-28 — Jalur UI/UX U0: Audit Visual & Workflow Empiris

Program **A-28, Jalur UI/UX — tahap U0** · Dijalankan 2026-11-07 terhadap build produksi lokal (server `pnpm start`, flag `BISA_ALLOW_LOCALHOST_AUTH_URL=1`) pada database demo berjalan (bukan reseed bersih — DB memuat aktivitas tahap-tahap A-28 sebelumnya; angka yang dikutip adalah angka terukur saat audit).
Metode: **26 screenshot permukaan kunci + 29 screenshot workflow** di `~/workspace/bukti-a28/uiux-audit/` dibaca satu per satu; **8 tugas utama dijalankan sungguhan di UI** dan tindakannya dihitung; dukungan keyboard dibuktikan dari kode **dan** praktik (tekan tombol nyata); inventaris cetak dari kode + halaman pengaturan + keluaran nyata. **Tidak ada kode aplikasi yang diubah di tahap ini.**
Fondasi yang diverifikasi: hasil A-25 (`docs/rombak-ui/STATUS-TUTUP.md`) dan baseline fungsional (`docs/hardening/AUDIT-BASELINE-A28.md`).

---

## 1. Vonis ringkas

Fondasi A-25 **terbukti utuh**: 26 permukaan seragam (sidebar terang, pengalih aplikasi, PageHeader, palet plum) — termasuk POS yang dulu dibekukan (penyeragaman U8 bertahan). Keluaran cetak utama (laporan resmi, GRN, slip gaji, struk) tampil profesional. Yang tersisa bukan perombakan, melainkan **satu janji keyboard yang palsu (F2), satu pengaturan cetak yang bercabang dua dengan field mati, dan gesekan workflow terukur** — dirinci di bawah sebagai temuan UX- per area mandat (A visual, B usability/input, C workflow, D template cetak).

## 2. Bukti screenshot (55 berkas gambar + 1 XLSX)

- Permukaan: `01-beranda` s.d. `26-pengaturan-status` (POS terminal & sesi, beranda tiap modul, katalog, penerimaan, PO, opname, nilai persediaan, laporan, jurnal & jurnal baru, kas & bank, buku besar, bagan akun, payroll, absensi, persetujuan, pengaturan umum/nota/cetak/payroll-indonesia/status).
- Workflow: `wf-01` s.d. `wf-27` (nota hasil checkout, dialog Tahan, panel campuran kosong & terisi, tutup sesi hitung & tinjau, form PO & detailnya, terima dari PO, opname cari/isi/tinjau, jurnal combobox & terisi, laporan cetak resmi, payroll langkah 2/3 & detail & riwayat, palet Ctrl+K, cetak GRN/PO/slip, POS 390px & 768px) + `wf-laporan-laba-rugi.xlsx` (25.333 byte, hasil unduhan nyata 1 klik).

## 3. Pengukuran langkah tugas utama (dijalankan, bukan diperkirakan)

Satu "tindakan" = satu klik / satu isian field / satu penekanan Enter. Navigasi antar halaman dihitung bila pengguna harus melakukannya.

| # | Tugas | Tindakan terukur | Jalur terukur | Gesekan utama |
|---|---|---|---|---|
| 1 | Kasir: pindai → bayar tunai → cetak (1 item) | **4** (3 bila tanpa klik awal) | klik kotak cari → ketik barcode → Enter (produk masuk, fokus kembali ke cari) → klik Bayar → nota `?autoprint=1` tampil | Kotak cari **tidak autofocus** dan **F2 tidak berfungsi** — klik awal wajib (UX-B01). Jalur 2 item + Uang Pas terukur 5 tindakan |
| 2 | Kasir: bayar campuran (Tunai 50.000 + QRIS 22.000 dari 72.000) | **7** | klik cari → ketik nama → klik kartu → klik Campuran → isi Nominal Tunai → isi Nominal QRIS → klik Bayar → nota | Nominal tampil **mentah** ("50000"); tombol Bayar **aktif sejak Sisa masih penuh** (UX-B04, UX-B07). Tanpa checkbox konfirmasi non-tunai di mode campuran |
| 3a | Buka sesi kas | **2** | isi Modal awal (MoneyInput — terformat `500.000` saat ketik) → klik Buka sesi | — (terbaik di kelasnya) |
| 3b | Tutup sesi kas (buta) | **6** tipikal | isi field denominasi yang terpakai (3 dari 11 pada pengukuran; total berjalan tampil) → klik Kunci hitungan & tinjau → selisih tampil (−Rp57.000 pada pengukuran) → isi Alasan selisih (wajib di luar toleransi Rp0) → klik Tutup sesi | 11 field denominasi selalu tampil; langkahnya sendiri tertib dan jujur |
| 4 | Terima barang dari PO | **2** dari PO Terkirim; **3** dari PO Draf; buat PO dari nol **6** | detail PO → Terima → form penerimaan **terisi penuh dari sisa PO** (sumber, gudang, pemasok, baris, "Selisih vs sisa PO: Pas") → Posting penerimaan. PO Draf: wajib **Kirim PO** lebih dulu — tidak ada aksi Terima sama sekali pada status Draf | Langkah Kirim adalah kejutan administratif dari detail PO (UX-C01) |
| 5 | Opname satu produk | **7** | klik kotak pindai → ketik → klik hasil → isi Fisik → Tinjau selisih → **centang konfirmasi pemeriksaan** → Posting opname | Kotak pindai tidak autofocus (UX-B05). Centang konfirmasi adalah langkah yang **dibenarkan** (tombol posting nonaktif sebelumnya — pencegahan kesalahan yang baik) |
| 6 | Jurnal manual 2 baris seimbang | **8** | Keterangan (**autofocus** ✓) → combobox akun ketik kode → Enter → isi Debit (`150.000` terformat) → combobox baris 2 → Enter → isi Kredit → Posting jurnal → mendarat di detail jurnal | Combobox akun mendukung ArrowDown+Enter (terbukti); penjaga keseimbangan menuliskan alasan tombol nonaktif |
| 7 | Laporan laba rugi: layar / XLSX / cetak | **0 / 1 / 1** | Laba rugi "Bulan ini" adalah tampilan bawaan; Excel = 1 klik unduh (`laporan-laba-rugi-2026-11-01-2026-11-07.xlsx`); Cetak = 1 klik ke halaman cetak resmi ber-PrintShell | Tercepat dari semua tugas — pola yang layak ditiru tugas lain |
| 8 | Jalankan payroll (periode berjalan) | **3** | Lanjut → Lanjut → Posting payroll (periode terpilih bawaan; tanpa dialog konfirmasi tambahan) → run `PRL-2026-00001` TERPOSTING | Sesudah posting wizard kembali ke langkah 1; jalan ke detail run & slip tersembunyi (UX-C02) |

## 4. Keyboard-first POS — inventaris terbukti

| Kemampuan | Kode | Praktik terukur |
|---|---|---|
| Scanner wedge global (tangkap pindai di mana pun fokus berada, pulihkan field) | `use-barcode-scanner.ts` (capture + burst) | Badge "Scanner siap" tampil; pindai lewat Enter di kotak cari menambah produk |
| Enter di kotak cari = pindai (burst/angka ≥6 digit) atau tambah hasil pertama | `terminal/product-catalog.tsx:67–99` | Terbukti dua-duanya |
| Fokus kembali ke kotak cari sesudah tambah produk | `pos-terminal.tsx` `addProduct` (`searchRef.focus()`) | Terbukti: `activeElement` = input cari sesudah Enter & sesudah klik kartu |
| **F2 fokus cari** | **Tidak ada handler di seluruh `src/`** — hanya teks placeholder | **Terbukti mati**: tekan F2 dari body, fokus tetap BODY |
| Autofocus kotak cari saat terminal dimuat | Tidak ada | Terukur: `activeElement` = BODY |
| Navigasi panah pada hasil pencarian POS | Tidak ada (hasil = kisi tombol) | Terukur: ArrowDown tidak memindahkan fokus/highlight apa pun |
| Esc menutup dialog (Tahan, resume, void, panel tampilan) | Handler per dialog (`pos-terminal.tsx:562ff`, `sale-row-actions.tsx`, `pos-display.tsx`) | Terbukti pada dialog Tahan: Esc menutup, keranjang utuh |
| Shortcut Bayar / Tahan / Uang Pas / ganti mode / fokus Diterima | **Tidak ada** | Checkout tetap mouse-sentris untuk langkah akhir |
| Daftar/bantuan shortcut di terminal | **Tidak ada** | Satu-satunya petunjuk adalah placeholder "(F2)" yang terpotong di lebar 1440px menjadi "(F…" dan janji di dalamnya palsu |
| Palet perintah global Ctrl+K (panah + Enter + Esc) | `shell/command-palette.tsx` | Terbukti membuka, berkelompok per modul, tersaring peran |
| Combobox akun (jurnal) & pemilih produk (gudang): panah + Enter | `account-combobox.tsx`, `product-picker.tsx` | Terbukti di jurnal (ArrowDown+Enter memilih akun) |

## 5. Template cetak — inventaris & kesenjangan

### Keluaran cetak yang ada (11)

| Keluaran | Rute | Mesin & kertas |
|---|---|---|
| Struk penjualan | `/app/pos/nota/[id]` | PrintSettings penuh (kertas nota) + saklar warisan kasir/PPN |
| Pesanan pembelian | `gudang/pembelian/[id]/cetak` | PrintSettings (kertas dokumen) |
| Bukti penerimaan (GRN) | `gudang/penerimaan/[id]/cetak` | sama |
| Retur pembelian | `gudang/retur-pembelian/[id]/cetak` | sama |
| Transfer gudang | `gudang/transfer/[id]/cetak` | sama |
| Lembar hitung opname | `gudang/opname/lembar-hitung` | sama |
| Laporan keuangan resmi | `akuntansi/laporan/cetak` | PrintSettings + kop laporan (nama legal, alamat, telepon, NPWP, satuan, ref, waktu cetak) |
| Buku besar | `akuntansi/buku-besar/cetak` | PrintShell |
| Jurnal | `akuntansi/jurnal/[id]/cetak` | PrintShell |
| Aging piutang/utang | `akuntansi/piutang-utang/cetak` | PrintShell |
| Slip gaji | `akuntansi/payroll/[id]/cetak` | PrintSettings (kertas dokumen); slip per karyawan bertumpuk dalam satu dokumen |

**Tidak ada**: faktur penjualan format dokumen A4 terpisah dari struk (di kertas A4 pun struk dibatasi 80mm di tengah halaman); cetak label harga/barcode produk; jalur cetak untuk daftar Kas & bank dan daftar produk (CSV saja).

### Yang bisa diatur pengguna hari ini

- **Pengaturan → Cetak (mesin cetak, satu pintu yang hidup penuh)**: template (Modern/Minimal/Klasik), jenis huruf (Sans/Serif/Mono), warna aksen, **URL logo**, teks kop, teks kaki, blok tanda tangan ya/tidak, QR nomor dokumen ya/tidak, kertas nota (Thermal 58/80, A5, A4), kertas dokumen (A4/A5) — dengan **pratinjau langsung** yang memakai komponen persis sama dengan halaman cetak asli.
- **Pengaturan → Umum**: nama legal, alamat, telepon, NPWP (hidup di semua kop), catatan atas laporan keuangan.
- **Pengaturan → Nota & printer (warisan)**: Header nota, Footer nota, Logo, Kasir, Pajak.

### Kesenjangan terbukti (lihat UX-D01 s.d. D05)

Nilai "Header nota" pada demo saat audit berisi teks gabungan tanpa spasi (`BISA MINIMARKETJl. Melati…Telp. 021-555-0123`) — dan **tidak berpengaruh apa pun**: halaman nota secara eksplisit tidak lagi membacanya (`nota/[id]/page.tsx:110–117`, header hanya dari teks kop mesin cetak). Saklar "Logo" di tab yang sama juga mati (logo hanya dari URL logo tab Cetak). "Footer nota" hanya menjadi cadangan bila teks kaki tab Cetak kosong. Halaman nota sendiri, pada kartu "Kustomisasi nota", hanya menunjuk **Pengaturan → Cetak** — dua pintu, satu yang bekerja.

## 6. Temuan bernomor

Prioritas: **P1** = menyesatkan / menghalangi tugas inti; **P2** = gesekan nyata berulang; **P3** = poles.

### Area A — Desain visual & hierarki

- **UX-A01 (terverifikasi sehat)** — Konsistensi A-25 utuh lintas modul termasuk POS: tema, sidebar, pola PageHeader/DataList/RowMenu pada mayoritas permukaan; keadaan kosong informatif (Persetujuan, PO, Absensi); POS 390px & 768px tanpa overflow horizontal dan dengan bar bayar tetap (U8 bertahan). Bukan lagi tampilan "demo" pada permukaan utama.
- **UX-A02 (P2)** — Judul ganda di daftar Gudang: Penerimaan dan PO menampilkan judul halaman, lalu kartu berisi judul yang sama persis di bawahnya (`08`, `09`) — sisa pola lama yang di permukaan lain sudah hilang (POLA-02 tidak tuntas di pola kartu-daftar gudang).
- **UX-A03 (P2)** — Beranda Akuntansi tetap permukaan terpadat (AKT-02/AKT-03 terverifikasi ulang): panel Input Cepat 9 kartu yang mencampur modal & halaman (dibedakan hanya label "HALAMAN ↗" + sub-teks), antrean kerja, 4 kartu KPI, dan strip neraca/margin/periode bersaing dalam satu layar (`12`).
- **UX-A04 (P3)** — Jargon teknis & teks basi lolos ke UI (sisa POLA-12): label tipe Inggris mentah di Kas & bank ("11001 · asset"); halaman Status sistem menampilkan nama variabel env dan path absolut server; deskripsi halaman Laporan masih berbunyi "siap cetak resmi atau unduh CSV" padahal Excel sudah ada sejak A-28 Tahap 3 (`13`, `16`, `26`).
- **UX-A05 (P2)** — Pola aksi baris belum satu (sisa POLA-07): Produk memakai menu ⋯; Riwayat POS memakai tiga tombol ikon tanpa label (cetak/retur/void — aksi destruktif sejajar tanpa pemisah); Penerimaan memakai tautan teks + tombol "Batalkan" terbuka; Bagan akun menampilkan Ubah + Hapus + ⋯ sekaligus, dan **Hapus tampil juga untuk akun berlencana Sistem** (server menolaknya, tetapi affordance-nya mengundang percobaan salah) (`04`, `06`, `08`, `18`).
- **UX-A06 (P3)** — Strip 4 kartu KPI di atas daftar masih menjadi pola bawaan di Riwayat POS, Nilai persediaan, dan Jurnal (`04`, `11`, `14`) — hierarki "daftar sebagai isi utama" yang ditegakkan A-25 di beranda akuntansi belum menjadi konsistensi lintas daftar.

### Area B — Usability & kemudahan input

- **UX-B01 (P1)** — **Janji F2 palsu + terminal tidak autofocus.** Placeholder berbunyi "Scan barcode atau cari produk… (F2)"; tidak ada penangan F2 di mana pun di `src/` (grep nol) dan pengukuran membuktikan fokus tetap di BODY sesudah F2 ditekan, dan tetap BODY saat halaman dimuat. Kasir keyboard-first wajib mengklik kotak cari dulu pada setiap kunjungan — dan petunjuknya sendiri terpotong ("(F…") pada lebar 1440px (`02`, pengukuran §4).
- **UX-B02 (P2)** — Hasil pencarian POS tidak bisa dinavigasi panah: ArrowDown tidak menghasilkan highlight/fokus apa pun (terukur); satu-satunya jalur keyboard adalah Enter yang mengambil **hasil pertama** — cepat tetapi rawan salah ambil saat hasil pertama bukan target. Berbeda kelas dengan combobox akun & palet Ctrl+K yang mendukung panah.
- **UX-B03 (P2)** — Tidak ada shortcut langkah akhir kasir (Bayar, Tahan, Uang Pas, fokus Diterima, ganti mode) dan tidak ada daftar shortcut yang bisa dibuka kasir. Temuan lama POS2-09 terverifikasi ulang masih berlaku; yang sudah membaik sejak itu: scanner global, Esc dialog, fokus-kembali-ke-cari.
- **UX-B04 (P2)** — Nominal tender POS tampil mentah tanpa pemisah saat ketik (terukur `50000` di campuran, `4000` di Diterima) — sisa kategori terminal dari H-PGT-01 (Tahap 4 A-28) yang kini terbukti di momen pembayaran campuran: nominal besar rawan salah baca digit.
- **UX-B05 (P3)** — Fokus awal tidak konsisten: Jurnal baru autofocus Keterangan ✓, Mode Operasi autofocus kotak pindai ✓ (klaim "selalu fokus" di halamannya benar), tetapi **Opname tidak autofocus** kotak pindainya padahal tugasnya digerakkan pindai, dan POS tidak autofocus (UX-B01) (terukur `activeElement` per halaman).
- **UX-B06 (terverifikasi sehat)** — Umpan balik sukses/gagal jelas: toast "Transaksi INV-… tersimpan" + nota autoprint; jurnal menuliskan alasan tombol posting nonaktif di tempatnya; tutup sesi menuliskan kewajiban alasan & toleransi pada langkah tinjau (`wf-01`, `15`, `wf-06`).
- **UX-B07 (P2)** — Pencegahan kesalahan campuran lemah: tombol "Bayar Rp 72.000" **aktif (enabled) saat Sisa tagihan masih Rp72.000 penuh** (terukur sebelum satu pun alokasi diisi) — kasir dapat mengklik dan baru bertemu penolakan di checkout. Status enabled terukur; klik dalam keadaan kosong tidak diuji agar tidak meninggalkan percobaan gagal di sesi berjalan.

### Area C — Workflow efficiency

- **UX-C01 (P2)** — Terima dari PO mengharuskan status Terkirim: detail PO **Draf tidak memiliki aksi Terima sama sekali**; alur nyata dari Draf = Kirim PO → Terima → Posting (3 klik) dan langkah Kirim tidak dijelaskan di konteks penerimaan (detail hanya menampilkan StatusSteps). Sesudah Terkirim, alurnya sendiri sangat baik (form terisi penuh dari sisa PO).
- **UX-C02 (P2)** — Tautan detail run payroll menempel pada **teks periode** ("November 2026"), sedangkan nomor run (`PRL-2026-00001`) tampil sebagai teks polos redup tanpa tautan — terbalik dari semua daftar lain yang menautkan nomor dokumen. Sesudah posting, pengguna yang mencari "nomor run-nya" tidak menemukan jalan masuk yang jelas ke detail/slip/bayar (`wf-26`, kode `payroll/page.tsx:227`).
- **UX-C03 (P3)** — Beranda Gudang: kolom REFERENSI pada "Pergerakan stok terbaru" menampilkan nomor dokumen sebagai teks polos tanpa tautan, dan baris tidak terkelompok per dokumen (sisa GDG-08 terverifikasi visual) — drill-down dari permukaan yang paling sering dibuka justru putus (`05`).
- **UX-C04 (P3)** — Duplikasi permukaan baca stok tetap ada (sisa GDG-05): Produk dan Nilai persediaan sama-sama mendaftar stok per produk; halaman Nilai tidak membawa satu pun aksi baris (murni laporan di tengah modul operasional) (`06`, `11`).
- **UX-C05 (terverifikasi sehat)** — Sisa GDG-10 **tertutup**: antrean Mode Operasi yang kosong kini menyediakan jalan pintas Terima barang / Transfer stok / Stok opname (`07`). Opname hitung buta, lembar hitung, dan langkah konfirmasi tetap menjadi pola terbaik di sistem.
- **UX-C06 (P3)** — Wizard payroll kembali menawarkan periode yang **sudah diproses** dengan estimasi penuh di langkah 1 (terlihat sesudah PRL-2026-00001 terposting untuk November 2026); perlindungan satu-periode-satu-kali baru terasa di hilir. Observasi visual dari `wf-24`, bukan uji tabrakan posting ulang.

### Area D — Template cetak & kustomisasi

- **UX-D01 (P1)** — **Dua sumber kebenaran cetak nota.** Tab "Nota & printer" (Header nota, Footer nota, Logo) tumpang tindih dengan tab "Cetak" (teks kop, teks kaki, URL logo): Header nota **mati**, saklar Logo **mati**, Footer nota hanya cadangan bersyarat. Pengguna yang menyesuaikan nota dari tab Nota akan menyimpulkan kustomisasi rusak. Bukti kode: `pos/nota/[id]/page.tsx:110–117,290` (header hanya dari mesin cetak; footer = `printSettings.footerText ?? receiptFooter ?? bawaan`); bukti visual: `23` vs `24` dan kartu "Kustomisasi nota" di halaman nota yang hanya menunjuk tab Cetak (`wf-01`).
- **UX-D02 (P2)** — Logo hanya bisa berupa **URL eksternal**; tidak ada unggah berkas (kontras: gambar QRIS punya unggah berkas di Pengaturan Umum). Toko tanpa tempat hosting gambar tidak dapat memasang logo pada dokumen apa pun.
- **UX-D03 (P2)** — Tidak ada **faktur penjualan format dokumen**: satu-satunya dokumen penjualan adalah struk; pada kertas A4/A5 struk tetap selebar 80mm di tengah halaman. Saklar per elemen struk terbatas (kasir, PPN, QR); baris "Dicetak dari Bisa ERP" selalu tercetak dan tidak dapat diatur — untuk dokumen yang diserahkan ke pelanggan bisnis, keduanya terasa.
- **UX-D04 (P3)** — Identitas kop satu untuk semua outlet: nama/alamat/NPWP dari Pengaturan Umum dipakai semua gudang/cabang; tidak ada identitas kop per cabang.
- **UX-D05 (P3)** — Blok tanda tangan hanya saklar global; label penanda tangan per dokumen tertanam di kode (GRN: Diserahkan oleh/Diterima oleh/Mengetahui dengan peran baku) dan tidak dapat diganti nama/perannya dari Pengaturan (`wf-22`).

## 7. Status sisa A-25 yang diverifikasi ulang

| Sisa A-25 | Status pada audit ini |
|---|---|
| POLA-03 input tanggal native | **Masih terbuka, terbukti visual**: filter Laporan berformat AS `11/01/2026` (native) sementara Jurnal memakai `01/11/2026` (DateField) — dua format tampil berdampingan antar halaman, bahkan dalam satu halaman Kas & bank (form transfer native vs filter riwayat DateField); "Berlaku sejak" Payroll Indonesia juga native (`13`, `14`, `16`, `25`) |
| POLA-07 RowMenu tidak merata | Masih terbuka (UX-A05) |
| POLA-12 label Inggris/jargon | Masih terbuka sebagian (UX-A04) |
| GDG-05 stok tampil di dua tempat | Masih terbuka (UX-C04) |
| GDG-06 daftar "mendekati minimum" | Tidak dinilai ulang (fungsi baca tidak berubah; tidak ada bukti baru) |
| GDG-08 pergerakan tak terkelompok/tautan referensi | Masih terbuka (UX-C03) |
| GDG-10 jalan pintas antrean kosong | **Tertutup** (UX-C05) |
| GDG-13 duplikat pihak halaman tersendiri | Masih terjadwal — rute `gudang/pemasok/duplikat` tetap halaman menu tersendiri |
| AKT-02/03 beranda akuntansi padat | Masih terbuka (UX-A03) |
| AKT-05 daftar jurnal tanpa rincian debit/kredit baris | Masih terjadwal — daftar hanya membawa satu kolom Nilai (`14`) |
| AKT-08 buku besar dari daftar akun bersaldo | **Sebagian membaik**: dropdown akun kini memuat saldo per akun, tetapi halaman **membuka pada akun header 10000 · Aset · Rp 0** tanpa satu pun baris — kesan pertama tetap buku besar kosong (`17`) |
| AKT-09 saklar sembunyikan akun nol | Masih terjadwal — laporan layar menampilkan semua akun Rp 0 tanpa saklar (versi cetak menampilkannya sebagai "—", layar tidak) (`13`, `wf-17`) |
| PNG-05 kolom pertama BPJS sempit | Masih terbuka — nama program + catatan hukum membungkus sangat tinggi (`25`) |

## 8. Ringkasan prioritas

| Prioritas | Temuan |
|---|---|
| P1 | UX-B01 (F2 palsu + tanpa autofocus), UX-D01 (pengaturan nota bercabang, field mati) |
| P2 | UX-A02, UX-A03, UX-A05, UX-B02, UX-B03, UX-B04, UX-B07, UX-C01, UX-C02, UX-D02, UX-D03 |
| P3 | UX-A04, UX-A06, UX-B05, UX-C03, UX-C04, UX-C06, UX-D04, UX-D05 + sisa A-25 (POLA-03, AKT-05/08/09, GDG-13, PNG-05) |

Perbaikan dirancang sebagai tahap UI-1 s.d. UI-5 di `docs/hardening/RENCANA-UIUX.md`. Aturan bisnis & angka tidak disentuh oleh satu pun temuan di dokumen ini.
