# AUDIT RONDE 2 — Bagian 1: Desain Laporan Keuangan (Layar & Cetak)

Tanggal: 2026-11-04 · Sifat: baca-saja, bukti dari kode yang dirender.
Penilai: Design Auditor. Keluhan yang diuji: desain laporan "kurang intensional,
tidak sesuai profesional".

**Vonis ringkas: keluhan TERBUKTI pada lapis presentasi resmi.** Angka dan struktur
dasar laporan sehat (komparatif, subtotal bernama, kop cetak ada), tetapi laporan
keuangan diperlakukan sebagai *layar yang dicetak*, bukan *dokumen yang dirancang*:
tanpa pernyataan satuan mata uang, tanpa blok tanda tangan, tanpa garis total baku,
negatif bertanda minus alih-alih kurung, dan satu laporan (aging) bahkan tidak punya
jalur cetak sama sekali. Ironisnya, standar profesional itu **sudah ada di repo yang
sama** — slip gaji dan dokumen transaksi memakai PrintShell bertemplate lengkap
dengan tanda tangan & QR; laporan keuangan tidak.

**Jumlah temuan: 15 — P1: 4 · P2: 5 · P3: 6.**

---

## Nilai per laporan

| Laporan | Nilai | Alasan ringkas |
|---|---|---|
| Laba rugi | B− | Komparatif 2 tahun + subtotal bernama (Laba kotor/operasional/bersih) + kop cetak; minus hierarki datar, minus bukan kurung, tanpa satuan & tanda tangan |
| Neraca | C+ | Dua kolom di layar runtuh jadi tumpukan di cetak; laba berjalan dalam kotak `bg-muted` ala layar; judul bukan "Laporan Posisi Keuangan" |
| Arus kas | C+ | Kelompok berlabel Indonesia + subtotal; tanpa kolom pembanding; metode (langsung/tidak langsung) tak dinyatakan; 3 kolom Masuk/Keluar/Net berisik |
| Perubahan ekuitas | C | Tanpa pembanding; baris total membiarkan kolom Penambahan/Pengurangan kosong; laba berjalan hanya muncul di kolom saldo akhir |
| Neraca saldo | B− | Tabel bersih, drill-through, baris cek keseimbangan; tanpa subtotal per kelompok akun; baris nol "Rp 0" memenuhi dokumen |
| Buku besar | B | Kop cetak resmi memuat akun pada label periode; saldo berjalan; tetapi strip tipe akun bahasa Inggris mentah ikut tercetak |
| Aging piutang/utang | C− | Layar fungsional (kartu bucket + penanda terlambat); **tidak ada tombol cetak/kop cetak sama sekali**; ringkasan bucket berbentuk kartu, bukan skedul aging matriks baku |
| Penjualan | C+ | Kartu metrik + tabel mini terbaca; kolom "Jenis" berisi kode tipe mentah; tabel tanpa baris total; tanpa pembanding |
| Catatan atas LK | B− | Nama legal + dasar penyusunan ada; teks bebas tampil dalam kotak layar `bg-muted/20` apa adanya di cetak |
| Slip gaji & dokumen transaksi (pembanding internal) | A− | PrintShell: 3 template, kop, tanda tangan, QR, ukuran kertas per jenis dokumen — bukti standar profesional tersedia di repo |

---

## Temuan

### RD2-01 (P1, CETAK-LEMAH) — Laporan keuangan tidak memakai PrintShell: tanpa tanda tangan, template, dan kaki dokumen
PrintShell menyediakan blok tanda tangan terkonfigurasi (`src/components/print/print-shell.tsx:230-247`,
dirender bila `settings.showSignature`), pilihan template modern/classic/minimal dan ukuran
kertas (D-13). Slip gaji memakainya penuh (`src/app/app/akuntansi/payroll/[id]/cetak/page.tsx:12`).
Laporan keuangan hanya menempel kop lewat `ReportPrintHeader`
(`src/app/app/akuntansi/laporan/page.tsx:25,186`) lalu mencetak isi halaman — tidak ada blok
"Disiapkan oleh / Diketahui / Disetujui", tidak ada kaki dokumen, tidak ada pilihan template.
Laporan yang diserahkan ke bank/pemilik lazimnya ditandatangani; di sini tidak ada tempatnya.

### RD2-02 (P1, DESAIN-AMATIR) — Tidak ada pernyataan mata uang/satuan; kop cetak tanpa alamat
Pencarian `Dalam Rupiah|satuan` di seluruh permukaan laporan: **nol hasil**. Kop cetak
(`src/components/akuntansi/report-print-header.tsx:22-33`) hanya memuat nama perusahaan,
judul, periode, dan waktu cetak — tanpa alamat, tanpa NPWP, tanpa pernyataan
"(Dalam Rupiah penuh)". Dokumen resmi PSAK selalu menyatakan satuan; ketiadaannya adalah
penanda amatir paling cepat terlihat oleh auditor/bank.

### RD2-03 (P1, CETAK-LEMAH) — Aging piutang/utang tidak punya jalur cetak sama sekali
`src/app/app/akuntansi/piutang-utang/page.tsx` tidak memuat `PrintButton` maupun
`ReportPrintHeader` (grep: nol rujukan print). Ctrl+P mencetak layar kerja apa adanya —
kartu statistik berwarna (`StatCard` tone amber/red/plum, baris 89-94), kartu bucket
`bg-muted/40`, formulir pencarian dan tab — tanpa kop perusahaan dan tanpa judul dokumen.
Aging adalah dokumen yang paling sering diminta penagih/bank; ia satu-satunya laporan
tanpa jalan keluar kertas yang resmi. (Ekspor CSV aging ada — Tahap 5 — tetapi itu berkas
data, bukan dokumen.)

### RD2-04 (P1, STRUKTUR-KURANG) — Negatif bertanda minus, total akhir tanpa garis ganda
`formatIDR` memakai `Intl.NumberFormat("id-ID", { style: "currency" })`
(`src/lib/money.ts:22-32`) → negatif tercetak `−Rp 1.234.567`. Konvensi laporan keuangan
Indonesia: negatif dalam kurung `(1.234.567)`. Dan di seluruh laporan, total akhir
(Laba bersih, Total aset, Total liabilitas + ekuitas) hanya dibedakan oleh `font-semibold`
+ `border-t` tunggal (`laporan/page.tsx` `ComparisonRow`, baris ±586-594) — bobot visualnya
setara subtotal; tidak ada garis ganda penutup (double rule) yang menjadi penanda baku
total final. `formatIDRSigned` (money.ts:40-44) hanya menormalkan nol, bukan gaya negatif.

### RD2-05 (P2, TIDAK-KONSISTEN) — Kolom pembanding hanya di 2 dari 5 laporan; CSV membuangnya
Layar laba rugi & neraca menampilkan tahun berjalan vs tahun lalu
(`laporan/page.tsx:199-263`); arus kas, perubahan ekuitas, dan neraca saldo tampil
satu periode tanpa pembanding. Lebih jauh, ekspor CSV membuang kolom pembanding yang
sudah ada di layar: `src/app/api/export/report/route.ts` untuk laba rugi (baris 143-167)
dan neraca (baris 42-69) hanya menulis satu kolom nilai. Tiga permukaan (layar, cetak,
CSV) menyajikan tiga versi kelengkapan yang berbeda untuk laporan yang sama.

### RD2-06 (P2, STRUKTUR-KURANG) — Hierarki visual datar; elemen layar bocor ke dokumen
Di `ComparisonGroup` (`laporan/page.tsx:545-583`) baris akun mulai pada x yang sama dengan
label subtotal "Total {kelompok}" di bawahnya — tidak ada indentasi akun di bawah judul
kelompok; judul kelompok, baris akun, dan subtotal hanya dibedakan ketebalan huruf.
Di neraca, "Laba periode berjalan" + "Total ekuitas" dirender sebagai kotak
`rounded-md bg-muted/40 px-3 py-2` (baris 254-257) — komponen bergaya kartu layar di tengah
dokumen keuangan; di kertas (latar belakang lazimnya mati) ia menjadi teks melayang tanpa
bingkai yang jelas, dan mematahkan pola tabel di sekitarnya.

### RD2-07 (P2, CETAK-LEMAH) — Pemutusan halaman tidak diatur untuk tabel laporan
Aturan anti-potong `break-inside: avoid` hanya berlaku untuk `.print-doc tr`
(`src/app/globals.css:236-238`) — kelas dokumen PrintShell. Tabel `.report-print` tidak
mendapat perlindungan setara: kelompok laporan (judul + baris + subtotal) dapat terpotong
di tengah dengan subtotal yatim di halaman berikutnya, dan tidak ada pengulangan judul
kelompok di halaman baru. Neraca saldo berisi seluruh COA — dokumen multi-halaman yang
paling terpapar. Tata letak neraca dua kolom layar (`lg:grid-cols-2`) juga runtuh menjadi
satu kolom pada lebar kertas A4, jadi hasil cetak tidak sama dengan yang dilihat pengguna.

### RD2-08 (P2, TIDAK-KONSISTEN) — Istilah tidak baku & kode mentah tampil di dokumen
- Judul resmi neraca adalah "Neraca" (`REPORT_TITLES`, `laporan/page.tsx:40-48`) — istilah
  SAK/PSAK adalah **Laporan Posisi Keuangan**; pola judul pun campur: sebagian berawalan
  "Laporan …", sebagian tidak ("Neraca", "Neraca Saldo").
- Buku besar mencetak strip meta akun mentah: `{account.type} · saldo normal {account.normalBalance}`
  → "asset · saldo normal debit" (`src/app/app/akuntansi/buku-besar/page.tsx:120`) — enum
  Inggris di dokumen resmi.
- Laporan penjualan kolom "Jenis" berisi `row.type` mentah (`laporan/page.tsx:435`).
- CSV arus kas menulis `row.sourceType` mentah (kode Inggris) padahal layar sudah memakai
  `journalSourceLabel()` (`export/report/route.ts:79`).

### RD2-09 (P2, DESAIN-AMATIR) — Ekspor laporan hanya CSV angka mentah, tanpa identitas perusahaan
Satu-satunya unduhan laporan adalah CSV (`/api/export/report`), dengan
`moneyCsv = toFixed(2)` (`src/lib/csv.ts:40-43`) — angka mentah tanpa pemisah ribuan,
kepala berkas hanya baris judul + periode tanpa nama perusahaan, tanpa kolom pembanding
(RD2-05). Tidak ada ekspor Excel/PDF berformat untuk laporan keuangan (paket `xlsx` hanya
dipakai jalur impor: `src/app/api/import/parse/route.ts:2`). Berkas yang diteruskan ke
auditor/bank tidak membawa identitas penerbitnya.

### RD2-10 (P3, STRUKTUR-KURANG) — Perubahan ekuitas: total & baris laba tak lengkap secara visual
Footer tabel hanya mengisi Saldo awal & Saldo akhir; kolom Penambahan/Pengurangan pada
baris Total ekuitas kosong (`laporan/page.tsx:378-384`), dan baris "Laba periode berjalan"
hanya terisi di kolom Saldo akhir (baris 365-369) — pembaca kertas harus menebak arus
masuknya. Tidak ada baris bernama "Laba ditahan" yang memisahkan modal disetor dari
akumulasi laba (akumulasi periode sebelumnya baru tampil sebagai akun generik hasil
perbaikan AK2-02, bukan sebagai komponen ekuitas bernama).

### RD2-11 (P3, DESAIN-AMATIR) — Nol tercetak "Rp 0" di mana-mana; kelompok kosong tetap dirender
`formatIDRSigned` menormalkan nol menjadi "Rp 0" (money.ts:40-44) dan seluruh baris akun
— termasuk yang tak bergerak — tercetak penuh; kelompok tanpa mutasi tetap dirender dengan
baris "Tidak ada mutasi." + total Rp 0 (`ComparisonGroup`, laporan/page.tsx:557-559).
Dokumen resmi lazimnya memakai strip "–" untuk nihil dan menekan kelompok kosong; versi
sekarang ramai dan terasa seperti dump data, bukan laporan yang dikurasi.

### RD2-12 (P3, DESAIN-AMATIR) — Tabel layar panjang tanpa header menempel & tanpa zebra
Tidak ada `sticky` pada thead di halaman laporan/buku besar (grep: nol). Neraca saldo dan
buku besar adalah daftar rol panjang (ratusan baris); saat menggulir, judul kolom hilang.
Tabel laporan dirender manual dengan `divide-y` saja — tanpa zebra dan tanpa hover baris
(pola `.data-table` yang punya hover, globals.css:151-158, tidak dipakai di halaman
laporan), sehingga pelacakan mata antar-kolom lebar (5 kolom angka) melelahkan.

### RD2
...[truncated 2340 chars]