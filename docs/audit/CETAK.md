# Audit Fungsi Cetak — Bisa ERP

Tanggal audit: 4 November 2026 · Auditor: subagen audit UX/cetak (baca-saja; tidak ada kode produksi yang diubah)
Metode: baca kode mesin cetak + render sungguhan via Playwright (emulasi media `print`, `page.pdf` dengan `preferCSSPageSize`, MediaBox PDF diukur) terhadap build produksi lokal (`pnpm start`, PG18 :5433, login demo `owner@bisa.id`).
Bukti visual: folder `hidden-audit-cetak/` di akar repo (tidak di-commit; dibersihkan Pemimpin). Nama berkas dirujuk per temuan.

## Data uji (fixture audit — dibuat lewat fungsi domain, ter-commit di perusahaan demo)

Perusahaan demo nyaris tidak punya dokumen (dibersihkan pengujian program), jadi dibuat fixture kecil dan dicatat di sini:

- 2 produk bernama panjang: `AUD-CT-…-A` "Kopi Bubuk Robusta Lampung Premium Kemasan 250 Gram — Edisi Spesial", `AUD-CT-…-B` "Minyak Goreng Kelapa Sawit Premium Jerigen 5 Liter Untuk Dapur Komersial dan Usaha Kuliner".
- Penerimaan **RCV-2026-00002** (PT Sumber Makmur, invoice `INV-SM/XI/2026-1147`, 6 baris, catatan panjang).
- Pesanan pembelian **PO-2026-00001** (CV Aneka Jaya, 6 baris).
- Penjualan **INV-2026-00002** (5 baris, diskon baris 10%, bayar split QRIS Rp50.000 + tunai, total Rp143.500, kembalian Rp6.500).
- Pengaturan cetak demo diubah sementara lewat kolom yang sama dengan yang ditulis formulir Pengaturan (template/kertas), lalu **dikembalikan persis ke nilai asli** (modern / thermal 80 / A4 / sans / teks kop & kaki kosong) — terverifikasi ulang sesudah tangkapan.

Catatan data: sebagian angka laporan (mis. saldo beban gaji negatif) berasal dari residu jurnal pengujian di basis data demo, bukan dari kode cetak. Temuan di bawah hanya menyorot lapisan cetak/presentasi.

## 1. Inventaris permukaan cetak

| # | Permukaan | Rute | Teknologi / jalur | Memakai PrintShell? |
|---|-----------|------|-------------------|---------------------|
| 1 | Nota POS (termasuk cetak ulang dari kasir & riwayat POS) | `/app/pos/nota/[id]` | `PrintShell` + `ReceiptPrint` (`window.print()`, autoprint saat `?autoprint=1`) | Ya |
| 2 | Bukti penerimaan barang (GRN) | `/app/gudang/penerimaan/[id]/cetak` | `PrintShell` + tombol Cetak | Ya |
| 3 | Pesanan pembelian (PO) | `/app/gudang/pembelian/[id]/cetak` | `PrintShell` + tombol Cetak | Ya |
| 4 | Laporan keuangan — 7 tab (laba rugi, neraca, arus kas, ekuitas, neraca saldo, penjualan, catatan) | `/app/akuntansi/laporan` | Halaman aplikasi biasa + `PrintButton` (`window.print()`); hanya mengandalkan `@media print` global | **Tidak** |
| 5 | Pratinjau di Pengaturan Cetak | `/app/akuntansi/pengaturan` tab Cetak | `PrintShell` dengan `pageStyle={false}` (tanpa `@page`) | Ya (pratinjau) |
| 6 | Buku besar | `/app/akuntansi/buku-besar` | **Tidak ada jalur cetak** — tidak ada tombol Cetak; Ctrl+P mencetak halaman apa adanya | Tidak |
| 7 | Detail jurnal | `/app/akuntansi/jurnal/[id]` | Tombol berikon Printer berlabel "Cetak / CSV" sebenarnya **hanya tautan unduh CSV** (`/api/export/journal/[id]`); tidak ada tampilan cetak | Tidak |
| 8 | Unduhan CSV (laporan, jurnal, buku besar, dll.) | `/api/export/*` | Bukan cetak — dicatat karena mudah tertukar dengan fungsi cetak | — |

Mesin bersama: `src/components/print/print-shell.tsx` (`PrintShell`, `PrintHeader`, `PrintFooter`, blok tanda tangan), `src/components/print/types.ts` (`paperSpec`: thermal58/80 → `size: "58mm auto"/"80mm auto"`, margin 2mm, `widthMm` = lebar rol penuh; A5 `widthMm` 128; A4 `widthMm` 186), `src/components/print/qr.ts` (QR = nomor dokumen polos). CSS cetak global hanya ada di `src/app/globals.css` (`@media print`: sembunyikan `.no-print`, reset `.print-area`, `@page { margin: 4mm }` **tanpa `size`**). Tidak ada `print:` variant Tailwind dan tidak ada penanganan print di `ModuleShell` di seluruh `src/`.

## 2. Temuan

Tingkat: **P1** = rusak/salah fungsi · **P2** = jelek (perataan, spasi, hierarki, keterbacaan) · **P3** = konsistensi/halus.

### P1 — Rusak / salah fungsi

| ID | Permukaan | Temuan | Bukti |
|----|-----------|--------|-------|
| CT-01 | Semua | **Kerangka aplikasi ikut tercetak.** Bilah atas (tombol ☰, breadcrumb "Beranda / …", pemilih perusahaan "Bisa Minimarket", chip pengguna "NP Nadia Putri OWNER") tercetak di semua PDF. Lebih buruk: sidebar gelap 232px hanya disembunyikan oleh breakpoint `lg:hidden`, sehingga pada lebar tata letak ≥1024px (A4 landscape ≈1122px, A3, Letter landscape) **seluruh sidebar ikut tercetak** (terverifikasi: di bawah media print @1400px, `aside` ber-`display:flex` lebar 232px). `ModuleShell` tidak punya penanganan print sama sekali. | `pdf-nota-80-modern-1.png`, `pdf-grn-a4-1.png`, `pdf-laporan-laba-rugi-1.png`, `nota-print-lebar1400.png` |
| CT-02 | Nota | **Ukuran kertas thermal tidak pernah diterapkan.** PrintShell menyuntikkan `@page { size: 80mm auto; margin: 2mm; }` (terbukti ada di DOM), tetapi Chromium tidak mendukung kata `auto` pada `@page size` sehingga aturan gugur: **semua PDF nota (58 & 80mm, ketiga template) berukuran Letter 612×792pt**. Di dialog cetak pengguna, kertas default bukan rol thermal; nota terapung kecil di halaman besar. | MediaBox semua `nota-*.pdf` = `0 0 612 792`; `pdf-nota-58-modern-1.png`, `pdf-nota-80-modern-1.png` |
| CT-03 | Laporan | **Laporan tercetak sebagai Letter, bukan A4.** `@page` global tidak menyatakan `size`, jadi hasil bergantung pada default/riwayat dialog browser pengguna. Semua PDF laporan terukur Letter 612×792pt. | MediaBox semua `laporan-*.pdf`; `pdf-laporan-*.png` |
| CT-04 | Nota | **Kop perusahaan tercetak dua kali.** `PrintHeader` merender nama resmi + alamat + telepon, lalu di bawahnya headerText yang — untuk nota — jatuh ke `receipt_header` warisan yang isinya teks identitas lengkap yang sama ("BISA MINIMARKET / Jl. Melati No. 21… / Telp. …" muncul dua kali berturut-turut). Pada seed demo ini kondisi bawaan, jadi dialami pengguna baru apa adanya. | `pdf-nota-80-modern-1.png`, `pdf-nota-a4-modern-1.png`, `nota-80-modern-print.png` |
| CT-05 | GRN & PO di A5 | **TOTAL tercetak di halaman 1 padahal tabel belum selesai.** Tabel 6 baris tumpah ke 2 halaman di A5; `tfoot` diulang Chromium di setiap fragmen halaman sehingga halaman 1 ditutup "TOTAL Rp 7.864.000" seolah dokumen lengkap dengan 5 dari 6 barang, lalu TOTAL yang sama tercetak lagi di halaman 2. Berisiko disalahbaca petugas gudang. | `pdf-grn-a5-1.png` + `pdf-grn-a5-2.png`; `pdf-po-a5-1.png` |
| CT-06 | Laporan | **Judul halaman dan tombol ikut tercetak.** `PageHeader` laporan tidak diberi `no-print`: teks "AKUNTANSI / Laporan keuangan", deskripsi, serta tombol **CSV** dan **Cetak** tercetak sebagai tombol di atas laporan resmi. (Tab & filter tanggal sudah benar `no-print`; yang bocor adalah PageHeader + kerangka, lihat CT-01.) | `pdf-laporan-laba-rugi-1.png`, `pdf-laporan-penjualan-1.png`, `laporan-ekuitas-print.png` |
| CT-07 | Buku besar | **Tidak ada jalur cetak; Ctrl+P mencetak formulir filter mentah** — kolom pencarian, dropdown tipe/akun, input tanggal, tombol "Cari" dan "Unduh CSV" semuanya masuk ke kertas. Buku besar adalah dokumen yang lazim diminta auditor; satu-satunya jalan keluar adalah CSV. | `pdf-buku-besar-1.png`, `buku-besar-print.png` |
| CT-08 | Detail jurnal | **Tombol "Cetak / CSV" menyesatkan**: ikon Printer + label Cetak, tetapi satu-satunya aksi adalah unduh CSV. Tidak ada tampilan cetak jurnal; Ctrl+P menghasilkan halaman aplikasi mentah (dengan bilah atas, CT-01). | Kode `src/app/app/akuntansi/jurnal/[id]/page.tsx:70`; `pdf-jurnal-detail-1.png` |

### P2 — Jelek (tata letak & keterbacaan)

| ID | Permukaan | Temuan | Bukti |
|----|-----------|--------|-------|
| CT-09 | GRN, PO, nota | **Padding `.print-area` tidak direset saat print** (`globals.css` hanya menolkan border/margin/width). Padding `p-6` (±12,7mm) / `p-4` tetap hidup sehingga lebar efektif dokumen selalu lebih sempit dari `paperSpec` (shell menyusut via `max-w-full`). Paling parah di A5: dokumen 128mm terjepit menjadi ±115mm — nomor invoice pemasok patah di tengah string menjadi 3 baris ("INV- / SM/XI/2026- / 1147"), label & nilai grid info bertumpuk. | `pdf-grn-a5-1.png`, `pdf-grn-a4-1.png` |
| CT-10 | GRN, PO | **Label dan nilai TOTAL menempel tanpa jarak**: tercetak "TOTALRp 7.864.000" / "TOTALRp 9.096.000" di semua kertas (sel label `colSpan` rata kanan bersebelahan langsung dengan sel nilai tanpa padding). | `pdf-grn-a4-1.png`, `pdf-po-a5-1.png` |
| CT-11 | GRN | **Grid info sempit & tidak sejajar**: sel berisi flex label–nilai di setengah lebar; "Status / pembayaran" membungkus dua baris sementara nilainya ("Utang — terbayar Rp 0 dari Rp 7.864.000") mulai di baris pertama dan menggantung — pasangan label–nilai sulit dibaca bahkan di A4. | `pdf-grn-a4-1.png` |
| CT-12 | Laporan | **Laporan tercetak tanpa identitas formal**: tidak ada nama perusahaan, tidak ada tanggal/waktu cetak, tidak ada nomor halaman. Kolom pembanding tahun lalu **tanpa judul kolom** — satu-satunya petunjuk adalah catatan abu-abu 10px "Kolom pembanding adalah periode yang sama tahun sebelumnya." yang nyaris tak terbaca di cetakan hitam-putih. Untuk dokumen yang diserahkan ke bank/akuntan ini kekurangan serius. | `pdf-laporan-laba-rugi-1.png`, `pdf-laporan-laba-rugi-2.png`, `pdf-laporan-neraca-1.png` |
| CT-13 | Laporan | **Angka pada baris ringkasan membungkus di tengah nilai**: kolom `ComparisonRow` tetap 120px; "Total liabilitas −Rp 64.236.000" tercetak dengan tanda minus sendirian di satu baris dan "Rp 64.236.000" di baris berikutnya. Nilai ≥ ±Rp10 juta yang negatif berisiko mengalaminya. | `pdf-laporan-neraca-1.png` |
| CT-14 | Laporan arus kas | **Label sumber mentah & struktur membingungkan**: sumber kas tampil sebagai kosakata sistem bahasa Inggris hasil olahan `snake_case` ("Bank Transfer Reversal", "Manual Reversal", "Opening", "Payroll Payment", "Sale Reversal"); total per kelompok tercetak *sebelum* daftar rincian yang datar dan tidak dikelompokkan di bawah kelompoknya, sehingga pembaca kertas tidak bisa mencocokkan total dengan rinciannya. | `pdf-laporan-arus-kas-1.png` |
| CT-15 | Neraca saldo | **Negatif nol tercetak di mana-mana**: saldo awal/akhir akun bersaldo normal kredit tampil "− Rp 0" (≥8 baris: Akumulasi Penyusutan, Utang Gaji, Laba Ditahan, Selisih Kas Lebih, dst.). Terlihat seperti kesalahan di dokumen resmi. | `pdf-laporan-neraca-saldo-1.png`, `pdf-laporan-neraca-saldo-2.png` |
| CT-16 | Pratinjau Pengaturan Cetak | **Pratinjau dokumen meluber keluar kartunya**: shell selebar 186mm dirender tanpa skala di dalam kolom ±500px; sisi kanan terpotong — blok judul/nomor dokumen contoh dan kolom tanda tangan tidak terlihat, jadi pengguna tidak bisa menilai hasil pengaturan dari pratinjau (klaim "kerangka cetak yang sama seperti aslinya" tidak terbukti secara visual). Pratinjau nota di bawahnya normal. | `pengaturan-cetak-preview-screen.png` |
| CT-17 | Nota di A4 | **Nota melebar mengikuti kertas lebar**: di kertas dokumen A4, baris label–nilai (No./Tanggal/Kasir, total) berjarak belasan sentimeter; tidak ada batas lebar atau penengahan khusus nota, sehingga hasil cetak terlihat seperti struk yang diregangkan, bukan dokumen. | `pdf-nota-a4-modern-1.png` |
| CT-18 | Laporan | **Palet layar dipakai apa adanya**: teks `muted` dan hairline `border` sangat pucat di kertas; makna bergantung warna (hijau "Laba bersih", hijau "Debit dan kredit seimbang.") tanpa `print-color-adjust` dan tanpa penegasan hitam-putih. Tidak ada stylesheet cetak khusus laporan selain reset umum. | Semua `pdf-laporan-*.png` |

### P3 — Konsistensi & hal-hal halus

| ID | Permukaan | Temuan | Bukti |
|----|-----------|--------|-------|
| CT-19 | Nota 58mm | QR 20mm memakan ±34% lebar kertas 58mm — sangat dominan untuk isi yang hanya nomor dokumen polos (bukan URL verifikasi yang bisa dipindai pelanggan). | `nota-58-modern-print.png`, `pdf-nota-58-modern-1.png` |
| CT-20 | Nota (template) | Perbedaan ketiga template tipis: badan nota **identik** antar-template (font & pembungkusan sama — terverifikasi crop 200dpi + probe computed style); yang berubah hanya gaya garis pemisah, aksen warna judul (modern), dan font serif judul (classic). Nama template menjanjikan perbedaan yang lebih besar daripada yang diberikan. | `crop-hi-classic-1.png` vs `crop-hi-minimal-1.png`; probe DOM |
| CT-21 | Laporan penjualan | Format tanggal tidak konsisten: "Penjualan per hari" memakai ISO mentah `2026-11-04`, sedangkan semua permukaan lain memakai format id-ID ("04 Nov 2026"). | `pdf-laporan-penjualan-1.png` |
| CT-22 | Detail jurnal | Baris kaki tercetak memuat **UUID mentah** ("Sumber sale · 01a1a381-ac71-…") dan label sumber bahasa Inggris ("Sale"); banner petunjuk UI di dalam kartu ("Jurnal ini dibuat otomatis oleh modul POS dan tidak bisa dibalik dari halaman ini…") ikut tercetak ke voucher. | `pdf-jurnal-detail-1.png` |
| CT-23 | Laporan — tab catatan | Keadaan kosong mencetak kotak petunjuk UI ("Belum ada catatan. Isi di Pengaturan → Umum → Catatan atas laporan keuangan.") ke dalam dokumen catatan atas laporan keuangan. | `laporan-catatan-print.png` |
| CT-24 | Pengaturan | Kolom warisan `receipt_width_mm` masih tersimpan (skema & seed, nilai 58) tetapi **tidak dibaca komponen cetak mana pun** sejak lebar diatur `paperSpec` — pengaturan yatim yang membingungkan bila kelak ditampilkan lagi. | grep `receipt_width_mm` di `src/` (hanya skema/tipe) |
| CT-25 | Semua dokumen multipel-halaman | Tidak ada nomor halaman ("Halaman 1 dari 2") dan tidak ada kepala dokumen berulang di halaman 2+; halaman 2 laporan laba rugi berdiri tanpa judul/konteks apa pun. (`thead` tabel GRN/PO/neraca saldo berulang dengan benar — lihat §4.) | `pdf-laporan-laba-rugi-2.png`, `pdf-grn-a5-2.png` |
| CT-26 | Nota 58mm | Kepadatan baris rincian rendah: nama produk panjang menjadi 3–4 baris dan baris qty "1 × Rp 24.000 − Rp 2.400" patah di tengah frasa; nota 5 barang sudah sangat panjang di kertas 58mm. | `nota-58-modern-print.png` |

## 3. Rekomendasi perbaikan per temuan

- **CT-01** — Di `ModuleShell` (`src/components/shared/module-shell.tsx`): bungkus `<aside>` dan header atas dengan kelas `no-print`, atau tambahkan ke `@media print` di `globals.css`: `.module-sidebar, .module-topbar { display: none !important }`. Uji pada lebar A4 landscape. Ini satu perbaikan yang menyembuhkan semua permukaan sekaligus.
- **CT-02** — Chromium tidak mendukung `size: <length> auto`. Untuk thermal, terbitkan `@page { size: 80mm 297mm; margin: 2mm }` (tinggi rol maksimum umum) atau `size: 80mm` persegi tidak ideal; praktik yang dipakai aplikasi POS web: nyatakan lebar tetap + tinggi panjang standar dan biarkan driver memotong. Apa pun pilihannya, uji MediaBox PDF harus menjadi lebar rol (226,8pt / 164,4pt), bukan 612pt. Ubah di `paperSpec` (`src/components/print/types.ts`).
- **CT-03** — Tambahkan `size: A4; margin: 10mm` pada `@page` global untuk halaman aplikasi (dokumen PrintShell sudah menimpa dengan `@page`-nya sendiri).
- **CT-04** — Pisahkan semantik: untuk nota, `PrintHeader` jangan merender blok alamat perusahaan bila `headerText` terisi; atau ubah fallback nota agar tidak memakai `receipt_header` berisi identitas (jadikan `receipt_header` murni teks tambahan, dan migrasi/seed contohnya diganti teks non-identitas). Perbaikan terkecil: di halaman nota, teruskan `headerText={printSettings.headerText}` saja (tanpa fallback warisan).
- **CT-05** — Cegah `tfoot` berulang: pindahkan baris TOTAL keluar dari `<tfoot>` menjadi baris ringkasan sesudah `</table>` (atau `tfoot { display: table-row-group }` saat print — tidak standar; cara aman: elemen terpisah dengan `break-inside: avoid`). Tambahkan juga `tr { break-inside: avoid }` agar baris produk tidak terbelah antar-halaman (terlihat di PO A5, nama produk terpotong di kaki halaman 1).
- **CT-06** — Tambahkan prop/kelas `no-print` pada `PageHeader` di halaman laporan (dan idealnya jadikan aturan umum: `PageHeader` selalu `no-print`, karena setiap halaman yang bisa dicetak memakainya).
- **CT-07** — Beri buku besar jalur cetak resmi: tombol Cetak + bungkus filter dengan `no-print` + kop laporan standar (nama perusahaan, periode, tanggal cetak) seperti rekomendasi CT-12; atau rute `/cetak` khusus memakai PrintShell A4 landscape (tabel buku besar lebar).
- **CT-08** — Pisahkan dua aksi: tombol "Unduh CSV" (ikon unduh) dan tombol "Cetak" yang membuka tampilan cetak jurnal (PrintShell A4 dengan kop, nomor jurnal, baris debit/kredit, total, dan kaki "Dibuat … · Sumber <nomor dokumen>" — bukan UUID, lihat CT-22).
- **CT-09** — Di `@media print`, tambahkan `.print-area { padding: 0 !important }`. Lebar konten kembali persis `paperSpec.widthMm`; uji ulang A5: invoice pemasok tidak boleh patah.
- **CT-10** — Beri jarak pada baris total dokumen: sel label `pr-3` atau pisahkan dengan `gap`; satu baris CSS di komponen tabel GRN/PO (`src/app/app/gudang/**/cetak/page.tsx`).
- **CT-11** — Grid info dokumen: ganti flex label–nilai di sel sempit menjadi label di atas nilai (`flex-col`) untuk sel "Status pembayaran", atau jadikan grid info 1 kolom di A5 via kelas lebar shell (`print-doc--a5`). Pola label-di-atas-nilai juga menyelesaikan CT-09 sebagian.
- **CT-12** — Buat komponen kop laporan bersama (dipakai laporan & buku besar): nama perusahaan, judul laporan, periode, "Dicetak <tanggal jam>" dan judul kolom eksplisit untuk pembanding ("2026" / "2025"). Nomor halaman: `@page { @bottom-center { content: "Halaman " counter(page) " dari " counter(pages) } }` — didukung Chromium.
- **CT-13** — Lebarkan kolom angka `ComparisonRow` (120px → `minmax(150px, auto)`) dan tambahkan `whitespace-nowrap` pada nilai; selaraskan dengan kolom tabel `ComparisonGroup` agar kedua komponen berbagi lebar yang sama.
- **CT-14** — Petakan `source_type` arus kas ke label Indonesia di satu tempat (`src/lib/format.ts`: `opening → Saldo awal`, `sale → Penjualan`, `payment → Penerimaan pembayaran`, `payroll_payment → Pembayaran gaji`, `*_reversal → Pembalikan …`, dst.) dan render rincian terkelompok di bawah subtotal kelompoknya (atau subtotal sesudah rincian).
- **CT-15** — Di formatter tampilan laporan, normalkan negatif nol: nilai yang dibulatkan menjadi 0 dirender "Rp 0" tanpa tanda minus (perbaiki di pemanggil neraca saldo / `formatIDR` varian bertanda — jangan ubah semantik `formatIDR` global tanpa uji).
- **CT-16** — Pratinjau Pengaturan: bungkus pratinjau dokumen dengan transform skala agar pas kolom (`scale` dihitung dari lebar kontainer, atau render pada lebar tetap dengan `zoom`/CSS `transform: scale(...)` + tinggi terkoreksi). Judul & nomor dokumen contoh harus terlihat penuh.
- **CT-17** — Untuk kertas dokumen (A4/A5) pada nota: batasi lebar isi nota (mis. maks 80mm, `margin-inline: auto`) di dalam shell, sehingga nota tercetak sebagai blok nota yang masuk akal di kertas lebar — atau tawarkan templat "faktur A4" terpisah; jangan regangkan struk.
- **CT-18** — Stylesheet cetak laporan: paksa teks utama hitam (`color: #000`), hairline lebih tegas (`border-color: #999` ke atas), dan tegaskan baris kunci dengan bobot/garis, bukan warna. Tambahkan blok `@media print` khusus `.report-print` di `globals.css`.
- **CT-19** — Ukuran QR proporsional per kertas: 20mm untuk 80mm/A4, ±14mm untuk 58mm (parameter ukuran di `PrintFooter`/shell berdasarkan `paper`). Pertimbangkan QR berisi URL verifikasi dokumen agar layak dipindai.
- **CT-20** — Pertegas pembeda template (mis. minimal: tanpa kop alamat lengkap; classic: garis ganda + serif juga untuk judul bagian; modern: aksen warna pada total) atau turunkan janji nama di UI Pengaturan.
- **CT-21** — Format tanggal laporan penjualan per hari melalui formatter tanggal id-ID yang sama (`formatDate`) — saat ini me-render string tanggal mentah dari API.
- **CT-22** — Kaki detail jurnal: tampilkan nomor dokumen sumber (INV-…/RCV-…) hasil join, bukan UUID; petakan label sumber ke bahasa Indonesia; beri banner petunjuk kelas `no-print`.
- **CT-23** — Keadaan kosong catatan: bungkus kotak petunjuk dengan `no-print`; saat kosong dan mencetak, render baris netral "Tidak ada catatan tambahan." atau kosongkan.
- **CT-24** — Hapus `receipt_width_mm` dari skema/tipe pengaturan (migrasi drop column) atau hubungkan kembali sebagai override lebar thermal; jangan biarkan pengaturan tanpa efek.
- **CT-25** — Nomor halaman via `@page` margin boxes (lihat CT-12) untuk laporan dan dokumen PrintShell A4/A5; untuk laporan, ulangi judul laporan sebagai kepala berjalan (elemen `position: fixed` print-only adalah trik yang didukung Chromium, atau terima nomor halaman saja).
- **CT-26** — Nota 58mm: rapatkan rincian (font rincian 10px, baris qty menyatu dengan nama bila muat) dan cegah patah frasa pada baris qty dengan `whitespace-nowrap` per segmen harga.

Prioritas pengerjaan yang disarankan: CT-01 → CT-02/CT-03 (kertas & kerangka: fondasi semua cetakan) → CT-04, CT-05, CT-09 (nota & dokumen gudang yang dipakai harian) → CT-06, CT-12, CT-07, CT-08 (kelayakan laporan/dokumen akuntansi untuk pihak luar) → sisanya.

## 4. Yang sudah baik (terverifikasi dari render)

- **Isi nota itu sendiri rapi**: angka rata kanan dengan pemisah ribuan id-ID konsisten, hierarki TOTAL jelas, garis pemisah putus-putus khas struk, footer & QR tertata di tengah, nama produk panjang membungkus wajar di 80mm. Terlihat pada crop 200dpi (`crop-hi-classic-1.png`, `crop-hi-minimal-1.png`). Masalah nota ada di sekelilingnya (kertas, kop ganda, kerangka), bukan di badannya.
- **Tabel GRN/PO di A4 sehat strukturnya**: kolom numerik rata kanan tabular, SKU sebagai subbaris redup, satuan tampil ("120 Botol"), judul dokumen & nomor tegas di kop, blok tanda tangan tiga peran berjarak baik dengan nama peran di bawah garis.
- **`thead` berulang benar** di halaman 2 untuk tabel GRN/PO dan neraca saldo (`pdf-laporan-neraca-saldo-2.png`).
- **Kontrol lokal sudah benar `no-print`**: kartu "Kustomisasi nota", tombol Cetak halaman dokumen, tab & filter laporan, dan baris aksi detail jurnal tidak ikut tercetak. Yang bocor adalah kerangka bersama (CT-01) dan PageHeader laporan (CT-06).
- **Template benar-benar diterapkan** (aksen/garis/font judul berubah sesuai pilihan) dan pengaturan kertas dokumen A4/A5 dihormati ukurannya (MediaBox A4 595×842pt, A5 420×595pt persis).
- **Format angka & tanggal dokumen konsisten** memakai `formatIDR` dan format id-ID ("04 Nov 2026") di nota, GRN, PO, dan sebagian besar laporan (pengecualian: CT-15, CT-21).
- **Pratinjau nota di Pengaturan Cetak akurat** terhadap hasil nyata (kerangka yang sama), dan halaman Pengaturan sendiri tertata baik.

## 5. Ringkasan hitungan

- **P1: 8 temuan** (CT-01 s.d. CT-08) — kerangka tercetak, kertas thermal & laporan salah ukuran, kop nota ganda, TOTAL prematur di A5, tombol laporan tercetak, buku besar tanpa jalur cetak, tombol cetak jurnal yang sebenarnya unduh CSV.
- **P2: 10 temuan** (CT-09 s.d. CT-18).
- **P3: 8 temuan** (CT-19 s.d. CT-26).
- Total **26 temuan**, semuanya berujuk berkas bukti di `hidden-audit-cetak/` (17 PDF + tangkapan layar layar/print + render PDF per halaman).
