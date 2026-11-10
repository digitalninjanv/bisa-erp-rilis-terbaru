# GDG-2 — Audit UI/UX & Workflow Gudang Bisa ERP

Tanggal: 2026-11-04
Sifat: **BACA-SAJA** — inspeksi kode JSX/CSS + skema + jalur server yang menentukan perilaku UI, tanpa perubahan aplikasi, tanpa commit.
Lingkup: alur penerimaan PO→stok, cetak GRN & label, transfer & opname dari layar (termasuk pemindaian barcode), kartu stok & riwayat mutasi, daftar stok & peringatan minimum/kedaluwarsa, impor produk, retur pembelian, konsistensi komponen vs sistem bersama, responsivitas tablet gudang, aksesibilitas dasar.
Pola audit: meniru `docs/akuntansi-audit/R2-AUDIT-DESAIN-UI.md` dan `docs/pos-audit/POS-2-UIUX-KASIR.md`.
Acuan workflow: Odoo Inventory & ERPNext Stock (penerimaan dari PO, putaway/lokasi, picking/transfer, lembar hitung opname, hitung buta).
Acuan internal: sistem bersama hasil FIX-R2 — `PageHeader`, `StatCard`, `StatusBadge`, `EmptyState`, `SearchForm`/`FilterChips`, `Pagination`, `.data-table`, token `--tone-*` di `globals.css`, dan `src/components/akuntansi/field-classes.ts` (label/field resmi: fokus = border ring + `ring-2 ring-ring/20`).

## Vonis ringkas

Gudang **tidak seburuk dugaan awal**: fondasi bersama dipakai luas (PageHeader di 22 berkas, StatusBadge 14, EmptyState 15, Pagination 10, `.data-table` di semua daftar), dokumen cetak (GRN/PO/retur) sudah kelas PrintShell bertanda tangan + QR, kartu stok punya saldo berjalan, transfer sudah dua tahap, dan opname punya mode muat-semua. Modul ini kira-kira berada di titik akuntansi **sebelum** FIX-R2 Tahap 2: sistemnya ada, disiplinnya belum.

Masalahnya terpusat di tiga hal:

1. **Pekerjaan fisik gudang tidak didukung layarnya.** Opname bukan hitung buta (kolom fisik terisi awal angka sistem), tidak ada mode pindai-untuk-menghitung, editor baris tidak menampilkan stok tersedia, dan tidak ada lembar hitung/surat jalan/label untuk dicetak.
2. **Dokumen stok tidak bisa diperiksa.** Penerimaan, opname, penyesuaian, dan transfer tidak punya halaman detail — riwayat hanya menampilkan hitungan item; satu-satunya cara melihat isi penerimaan adalah membuka halaman cetaknya.
3. **Sisa utang konsistensi FIX-R2 persis seperti yang dicurigai**: 42 kontrol `h-7` di 15 berkas, 0 berkas memakai `field-classes` bersama (≥11 salinan lokal dengan penanda fokus lebih lemah), 31 hex mentah + palet Tailwind lepas melewati token `--tone-*`, dan dua komponen `Metric` lokal di wizard impor — penyakit yang sama dengan RD2U-01/06/12, hanya belum diobati di modul ini.

Tidak ditemukan **P0**: tidak ada jalur UI yang merusak stok/angka dari layar (penjaga server dari audit GDG ronde 1 tetap berlaku). P1 di bawah adalah risiko integritas proses fisik dan kebuntuan telusur, bukan kerusakan data langsung.

**Total: 25 temuan — P0: 0 · P1: 4 · P2: 13 · P3: 8.**

## Nilai per area

| Area | Nilai | Penilaian singkat |
|---|---|---|
| Penerimaan barang | B− | 6 sumber jelas berpetunjuk, tautan PO mengisi baris dari sisa; tetapi tanpa stok pembanding, tanpa detail dokumen, PO→terima berputar. |
| Cetak GRN & dokumen | B | PrintShell + tanda tangan + QR rapi; GRN tidak memuat batch/kedaluwarsa/seri, transfer & opname tanpa dokumen cetak, label barcode tidak ada. |
| Transfer | B− | Dua tahap (dalam perjalanan → terima) benar; baris buta stok asal, tanpa surat jalan. |
| Opname | C+ | Muat-semua & ambil-ulang stok sistem baik; bukan hitung buta, tanpa draf/lembar hitung/konfirmasi selisih. |
| Kartu stok & mutasi | B | Saldo berjalan + saldo awal per halaman; referensi teks mati, label jenis mentah campur bahasa. |
| Daftar stok & peringatan | B− | Chip stok menipis + peringatan kedaluwarsa dashboard baik; daftar produk terkunci gudang bawaan, dashboard tak menaut daftar menipis. |
| Impor produk | B | Kerangka wizard seragam 7 jenis + contoh CSV; kartu metrik lokal + hex sendiri. |
| Retur pembelian | B+ | Area terbaik: draf, filter status, halaman detail & penyelesaian bertahap; produk dipilih bebas tanpa panduan dokumen asal. |
| Konsistensi desain | C+ | Fondasi bersama dipakai, tetapi h-7/hex/field lokal/prompt bawaan peramban tertinggal satu generasi dari akuntansi. |
| Responsivitas & sentuh | C+ | Tabel selalu `overflow-x-auto`, grid form `sm:` ramah tablet; target 24–28px di pekerjaan berdiri. |
| Aksesibilitas dasar | C+ | `aria-label` ada di titik penting (32), tetapi axe e2e hanya 1 rute gudang dan void memakai `window.prompt`. |

## Metode & batas bukti

- Diperiksa 29 berkas halaman di `src/app/app/gudang/**`, 26 komponen di `src/components/gudang/**`, komponen bersama `src/components/blocks/**`, `field-classes.ts`, `globals.css`, `src/lib/modules.ts`, `src/lib/permissions.ts`, potongan `src/server/catalog.ts` (pencarian produk), dan skema `warehouses` di `src/db/schema.ts`.
- Angka hitungan (h-7, hex, pemakaian komponen) adalah hasil `grep` atas kedua direktori gudang pada tanggal audit.
- Ukuran target diturunkan dari kelas Tailwind (`h-7` = 28px, `size-6` = 24px, `h-8` = 32px), bukan pengukuran perangkat fisik.
- Audit tidak menjalankan aplikasi di tablet/scanner/printer fisik; temuan perangkat adalah risiko yang dibuktikan dari jalur kode.
- Hitungan langkah adalah aksi utama (klik/pilih/submit/pindah halaman); ketikan tidak dihitung per karakter.

## Pengukuran alur utama

| Skenario | Langkah terukur dari kode/UI | Catatan |
|---|---|---|
| Terima barang lepas (tanpa PO) | **±6 aksi**: Penerimaan → Penerimaan baru → pilih sumber/gudang → pilih pemasok → picker per produk + isi qty/biaya → Posting | Form terlipat di halaman daftar; sesudah posting tidak ada tawaran cetak GRN (harus cari baris riwayat). |
| Terima terhadap PO dari detail PO | **±8 aksi**: detail PO → menu Penerimaan → Penerimaan baru → sumber → pemasok → pilih PO → sesuaikan qty → Posting | Tidak ada tombol "Terima barang" di detail PO; halaman PO sendiri menulis petunjuk berputarnya (`pembelian/[id]/page.tsx:195`). |
| Opname menyeluruh satu gudang | **3 tahap**: Opname → Muat semua produk → ketik fisik per baris → Posting | Tanpa draf, tanpa lembar hitung cetak, tanpa layar konfirmasi selisih — satu klik memosting semua selisih. |
| Transfer antar gudang | **4 aksi pengirim** (form → picker → qty → Transfer) + **1 aksi penerima** (Terima di daftar) | Status "Dalam Perjalanan" jelas; penerima tidak bisa melihat isi dokumen sebelum menerima (tak ada detail). |
| Menemukan GRN lama | **Tidak terukur pasti**: daftar penerimaan tanpa pencarian — paging 40/halaman sampai ketemu | Bandingkan halaman Produk/Pergerakan yang punya SearchForm. |
| Retur pembelian baru | **Halaman khusus** `/retur-pembelian/baru`: pemasok → gudang → alasan → picker produk → posting draf/terposting | Alur terbaik di modul; produk tidak dibatasi riwayat penerimaan pemasok itu. |

## Temuan

### P1 — menghambat pekerjaan fisik / integritas proses gudang

**GDG2-01 (WORKFLOW-INTEGRITAS) — Opname bukan hitung buta dan memosting tanpa jeda.**
Di `opname-form.tsx`, setiap baris lahir dengan kolom Fisik **sudah terisi angka stok sistem** (`add()`: `counted: String(system)`; `loadAll()` idem), dan kolom Sistem tampil tepat di sebelah kolom Fisik. Petugas yang lelah dapat memosting opname "sempurna" tanpa menghitung apa pun — selisih selalu nol dan tidak ada yang curiga. Ditambah: submit langsung memosting (`createOpnameAction`) tanpa draf, tanpa lembar hitung untuk dibawa ke rak, dan tanpa layar konfirmasi "12 produk berselisih, total dampak Rp X — posting?". Odoo/ERPNext menyediakan hitung buta (qty sistem disembunyikan) dan status draf justru untuk mencegah ini.
Dampak: opname — satu-satunya kontrol fisik atas stok — bisa menjadi formalitas; kehilangan stok tak pernah terdeteksi.
Arah: bawaan kolom Fisik kosong + opsi "sembunyikan stok sistem" saat menghitung; simpan sebagai draf hitung; layar ringkasan selisih sebelum posting; lembar hitung cetak per gudang.

**GDG2-02 (TELUSUR) — Empat jenis dokumen stok tidak punya halaman detail.**
Tidak ada rute detail untuk penerimaan, opname, penyesuaian, dan transfer (bandingkan PO `pembelian/[id]`, retur `retur-pembelian/[id]`, produk — semuanya punya). Daftar riwayat hanya menampilkan nomor, tanggal, gudang, dan *jumlah item* (`penerimaan/page.tsx`, `opname/page.tsx`, `transfer/page.tsx`, `penyesuaian/page.tsx`). Untuk melihat isi sebuah penerimaan, satu-satunya jalan adalah membuka halaman **cetak** GRN-nya; isi opname/transfer/penyesuaian tidak bisa dilihat sama sekali dari layar (harus menyisir Pergerakan stok per produk). Penerima transfer harus menekan "Terima" tanpa bisa memeriksa isi kiriman lebih dulu.
Dampak: setiap pertanyaan "dokumen ini isinya apa?" — dari audit, komplain pemasok, sampai selisih stok — berujung menebak atau membuka cetak.
Arah: satu halaman detail dokumen stok generik (pola detail PO/retur) untuk keempat jenis: baris, batch/seri, jurnal terkait, riwayat void/persetujuan; nomor dokumen di semua daftar menjadi tautan ke sana.

**GDG2-03 (BARCODE) — Pemindaian barcode di gudang menangkap Enter terlalu dini dan tidak punya mode pindai.**
`ProductPicker` (dipakai penerimaan, penyesuaian, transfer, opname, retur) men-debounce pencarian 200 ms, dan `Enter` langsung mengambil `rows[0]` pada saat tombol ditekan (`product-picker.tsx:44-52`). Scanner wedge mengetik kode lalu Enter dalam hitungan milidetik — bila hasil belum kembali, Enter tidak melakukan apa-apa (atau mengambil hasil basi dari kata kunci sebelumnya), dan petugas harus menekan Enter kedua secara manual. Server sebenarnya sudah mengurutkan kecocokan barcode persis di peringkat pertama (`src/server/catalog.ts:306-312`) — fondasinya ada, penangkapannya yang belum: tidak ada "bila hasil teratas adalah barcode persis, tambahkan otomatis", tidak ada navigasi panah/penanda baris aktif. Lebih buruk di opname: memindai produk yang sudah terdaftar diabaikan diam-diam (`opname-form.tsx` `add()` return awal; `line-editor.tsx` dedupe) — padahal pola hitung fisik adalah pindai berulang = +1 hitungan.
Dampak: alur terima/hitung berbasis scanner — cara kerja utama gudang nyata — tersandung di setiap item; risiko salah produk dari `rows[0]` basi.
Arah: mode pindai pada picker (tunggu hasil; barcode persis → tambah & bunyi/beep visual; fokus tetap di kotak), di opname pindaian ulang menaikkan Fisik +1, penanda baris aktif untuk keyboard.

**GDG2-04 (WORKFLOW) — Editor baris tidak menampilkan stok tersedia; penolakan baru muncul sesudah semua baris terisi.**
Tipe `DocLine` sebenarnya punya kolom `stock?` (`line-editor.tsx:10`) tetapi tidak pernah diisi server maupun dirender, di semua mode: transfer tidak menunjukkan stok gudang asal, penyesuaian tidak menunjukkan stok berjalan, penerimaan tidak menunjukkan stok saat ini sebagai pembanding. Petugas mengisi qty dari ingatan/kertas, menekan submit, dan baru tahu stok kurang dari pesan error — lalu menebak baris mana (pesan domain menyebut produk, tetapi koreksinya tetap coba-coba per baris).
Dampak: bolak-balik submit-gagal pada dokumen banyak baris; transfer gagal sebagian waktu di jam sibuk.
Arah: isi & tampilkan stok tersedia per baris (dan per batch untuk produk terlacak), peringatan inline saat qty melebihi tersedia sebelum submit.

### P2 — gesekan nyata & utang konsistensi satu generasi

**GDG2-05 (CETAK) — GRN tidak memuat batch, kedaluwarsa, dan nomor seri; transfer & opname tanpa dokumen cetak.**
Baris pada GRN (`penerimaan/[id]/cetak/page.tsx`) hanya produk, qty, harga perolehan, subtotal — padahal penerimaan produk terlacak mewajibkan nomor batch & seri di form. GRN adalah dokumen yang dicocokkan petugas dengan barang fisik di dermaga; tanpa batch/seri tercetak, pencocokan itu tidak bisa dilakukan dari kertas. Transfer tidak punya surat jalan internal untuk dibawa pengirim/penerima, dan opname tidak punya lembar hitung (lihat GDG2-01).
Arah: tampilkan batch/kedaluwarsa/seri per baris GRN (data ada di mutasi/batch dokumen); tambah cetak dokumen transfer & lembar hitung opname memakai PrintShell yang sama.

**GDG2-06 (PENCARIAN) — Lima daftar dokumen tanpa pencarian/filter.**
`grep -L SearchForm` atas halaman daftar: penerimaan, pembelian, opname, transfer, penyesuaian — kelimanya hanya `Pagination` 40/halaman. Mencari penerimaan dari nomor/invoice pemasok, PO dari pemasok, atau opname bulan lalu berarti paging manual. Halaman Produk & Pergerakan di modul yang sama sudah memakai `SearchForm` bersama, jadi ini murni ketidakseragaman. (Retur pembelian adalah pengecualian baik: punya filter status.)
Arah: SearchForm bersama + filter relevan per daftar (nomor/pemasok/status/rentang tanggal).

**GDG2-07 (KONSISTENSI-FORM) — `field-classes` bersama dipakai 0 berkas gudang; ≥11 salinan lokal dengan fokus lebih lemah.**
`grep field-classes` di seluruh gudang: **0**. Sebaliknya `labelClass`/`fieldClass` didefinisikan ulang di receipt-form, opname-form, transfer-form, adjustment-form, purchase-order-form, supplier-return-form, supplier-return-resolutions, product-bulk-table, taxonomy-manager, partner-forms, purchase-request-panel, dan lainnya — salinan persis pola pra-FIX-R2 akuntansi. Isinya pun lebih lemah: `focus:border-ring` saja, tanpa `focus:ring-2 focus:ring-ring/20` standar; `grep focus:ring` di komponen gudang = **0 kemunculan** (kotak cari ProductPicker sama). Penanda fokus keyboard di gudang lebih tipis daripada di akuntansi.
Arah: impor dari satu sumber bersama (idealnya field-classes dipindah ke lokasi netral modul, mis. `components/blocks/`), hapus salinan lokal.

**GDG2-08 (TARGET-SENTUH) — 42 kontrol `h-7` (28px) di 15 berkas gudang.**
Hitungan `grep h-7`: 42 kemunculan — import-wizard, import-master-wizard, line-editor, opname-form, partner-forms, void-buttons, taxonomy-manager, product-row-actions, approval-buttons, supplier-return-form, supplier-return-resolutions, product-bulk-table, party-merge-panel, purchase-request-panel, reservation-panel. Ini sisa yang dicatat FIX-R2 Tahap 2 ("52 kemunculan h-7 di gudang/POS di luar lingkup") — akuntansi sudah 0. Input qty/harga/batch di LineEditor semuanya h-7 dan tombol hapus baris hanya `size-6` (24px) (`line-editor.tsx`, `opname-form.tsx`) — target kecil untuk pekerjaan berdiri dengan tablet/tangan berkeringat.
Arah: samakan ke h-8 seperti FIX-R2 (RD2U-16), tombol ikon baris minimal size-7/8.

**GDG2-09 (KONFIRMASI) — Pembatalan dokumen memakai `window.prompt`/`window.confirm` bawaan peramban.**
`window.prompt`: 6 kemunculan di 4 berkas (void-buttons ×2 jenis, approval-buttons, dan lainnya); `window.confirm`: 8 kemunculan. Batalkan penerimaan/penyesuaian — aksi berdampak stok + jurnal — dikonfirmasi lewat dialog bawaan peramban yang tidak bisa menampilkan ringkasan dampak ("stok produk X akan keluar kembali; jurnal pembalik dibuat"), tidak mengikuti tema, dan buruk diakses. Akuntansi sudah memakai dialog konfirmasi berisi ringkasan sejak FIX-P1 Tahap 5.
Arah: dialog konfirmasi bersama berisi nomor dokumen, dampak stok/nilai, dan kolom alasan — ganti semua prompt/confirm di gudang.

**GDG2-10 (TELUSUR) — Referensi dokumen di Pergerakan Stok & Kartu Stok adalah teks mati; label jenis mentah campur bahasa.**
Kolom Referensi di `pergerakan/page.tsx:111` dan kartu stok `produk/[id]/page.tsx` dirender sebagai teks polos — tidak tertaut ke dokumen asal (akuntansi mendapat drill-through laporan→buku besar→jurnal→dokumen pada FIX-P1; gudang belum). Jenis gerakan dirender `capitalize` + ganti `_` dari kode mentah (`pergerakan/page.tsx:116`, kartu stok idem, dashboard idem) sehingga tampil "Transfer in", "Sale return", "Purchase" — padahal daftar label Indonesianya sudah ada di halaman yang sama (`TYPES`, `pergerakan/page.tsx:14-29`).
Arah: satu peta label jenis gerakan bersama (dipakai filter, daftar, kartu stok, dashboard); referensi menjadi tautan ke detail dokumen (bergantung GDG2-02) atau minimal ke cetaknya.

**GDG2-11 (DASHBOARD) — "Dokumen terakhir" tidak tertaut dan urut gabungannya salah; kartu stok menipis tanpa jalan ke daftarnya.**
Di `gudang/page.tsx:243-257`, daftar Dokumen terakhir menggabungkan 5 penerimaan + 5 dokumen lalu `slice(0, 7)` **tanpa mengurutkan gabungan berdasarkan waktu** — penerimaan selalu mendahului dokumen stok walau lebih lama — dan nomornya bukan tautan. Kartu "Stok menipis" (`page.tsx:127`) hanya angka; melihat produk apa saja yang menipis harus menebak ke Produk → chip "Stok menipis".
Arah: gabung → urut tanggal → tautkan nomor ke dokumennya; kartu menipis menjadi tautan ke `/app/gudang/produk?lowStock=1`.

**GDG2-12 (WORKFLOW) — Daftar produk terkunci pada gudang bawaan; tidak ada pemilih gudang.**
Halaman Produk selalu menilai stok dari gudang bawaan (`produk/page.tsx:55-60`) dan hanya menyebutkannya di catatan kaki (`:165-167`). Petugas cabang/gudang kedua tidak bisa mengganti tampang stok dari halaman itu — harus mengubah gudang bawaan global di Pengaturan. Halaman Nilai di modul yang sama punya chip pemilih gudang (`nilai/page.tsx:54-71`), jadi polanya ada tetapi tidak dipakai di daftar utama.
Arah: pemilih/chip gudang di halaman Produk (param `?warehouse=`), konsisten dengan Nilai.

**GDG2-13 (KONSISTENSI-WARNA) — 31 hex mentah + palet Tailwind lepas melewati token `--tone-*`.**
FIX-R2 membakukan token nada di `globals.css` (`--tone-red/amber/green/teal/plum` + `-soft`), tetapi gudang masih menulis: pill kedaluwarsa `bg-[#fbe9e7]` / `bg-[#fdf3e0] text-[#8a6d1a]` (dashboard `:171-174`, produk detail `:330-336`), pill "Utama" `bg-[#e7f3ea] text-[#256b3a]` (`:253`), qty hijau `text-[#256b3a]` (dashboard, pergerakan, kartu stok, opname), sisa klaim retur `text-[#8a5a12]` (`retur-pembelian/page.tsx:149`), dan banner persetujuan penyesuaian memakai palet Tailwind mentah `border-amber-200 bg-amber-50 text-amber-900` (`adjustment-form.tsx:155`). Total `grep` hex 6-digit: 31; kelas emerald/amber/red Tailwind lepas: 8.
Arah: ganti ke kelas token nada bersama seperti yang dilakukan RD2U-06 di akuntansi.

**GDG2-14 (KARTU-METRIK-LOKAL) — Wizard impor punya komponen `Metric` lokal ganda.**
`import-wizard.tsx:892` dan `import-master-wizard.tsx:601` masing-masing mendefinisikan `Metric` sendiri (label 10px, nilai 18px, warna hex `#256b3a`/`#8a5a12` di dalamnya) — varian kartu metrik lokal kelima di produk ini, padahal `StatCard` (dan varian `size="compact"`) adalah standar sejak FIX-R2. Ini pengulangan persis pola RD2U-01.
Arah: pakai StatCard/compact; hapus kedua Metric.

**GDG2-15 (WORKFLOW-PO) — Menerima barang terhadap PO berputar ±4 langkah ekstra.**
Detail PO menampilkan daftar penerimaan terkait dengan baik, tetapi tidak punya tombol "Terima barang". Petugas harus: pindah ke Penerimaan → buka form → pilih sumber pembelian → pilih pemasok yang benar → pilih PO dari dropdown (`receipt-form.tsx` alur tautan PO). Halaman detail PO bahkan menuliskan petunjuk berputar itu sebagai teks bantuan (`pembelian/[id]/page.tsx:193-197`) — bukti alurnya diakui tidak langsung. Salah memilih pemasok menyembunyikan PO yang dicari (daftar PO difilter per pemasok).
Arah: tombol "Terima barang" di detail PO (dan baris daftar PO berstatus terkirim/sebagian) yang membuka form penerimaan dengan pemasok + PO terpilih.

**GDG2-16 (PEMILIH-MASTER) — Reservasi & Purchase Request memakai `<select>` berisi seluruh produk.**
`reservation-panel.tsx:93` dan `purchase-request-panel.tsx:135` merender `<select>` dengan **semua** produk sebagai opsi (halaman reservasi memuat seluruh produk tanpa batas ke props). Pada katalog ratusan–ribuan SKU, dropdown ini tidak bisa dipakai dan tidak bisa dicari — sementara modul yang sama sudah punya `ProductPicker` berpencarian server yang dipakai form lain. Pola sama, lebih ringan, pada pemilih pemasok form penerimaan/PO/retur: `<select>` penuh tanpa pencarian.
Arah: samakan ke ProductPicker (dan pemilih pihak berpencarian untuk pemasok utama).

**GDG2-17 (KEPUTUSAN-CAKUPAN) — Tidak ada putaway/lokasi rak, dan tidak ada cetak label.**
Skema `warehouses` (`src/db/schema.ts:205-219`) hanya kode/nama/tipe — tidak ada sub-lokasi (rak/bin/zona), jadi penerimaan berhenti di "pilih gudang" dan detail produk tidak bisa menjawab "disimpan di rak mana". Bersamaan: tidak ada cetak label produk/barcode sama sekali (`grep` cetak label: nihil) — alur standar terima barang → tempel label rak/barcode tidak didukung. Untuk skala minimarket ini bisa jadi keputusan yang sah, tetapi saat ini ia tidak tercatat sebagai keputusan — hanya absen.
Arah: putuskan secara sadar & catat (seperti D-16/D-17): bila diterima, tambah lokasi sederhana per gudang + tampilkan di penerimaan/kartu stok, dan cetak label barcode dari daftar produk & GRN.

### P3 — polesan & konsistensi kecil

**GDG2-18 (SKALA-TEKS) — Teks konten 10px masih 89 kemunculan.**
`text-[10px]`: 89× dan `text-[11px]`: 236× di gudang. Sebagian sah (label mikro uppercase bergaya labelClass), tetapi SKU di bawah nama produk, nama gudang, dan jenis gerakan pada tabel utama tampil 10–11px `muted` — di bawah lantai konten 11px yang diterapkan FIX-R2 di akuntansi (RD2U-03), dan lebih sulit dibaca di bawah pencahayaan gudang.
Arah: naikkan teks konten tabel ke minimum 11px (SKU boleh tetap 10px hanya bila diperlakukan sebagai label mikro yang konsisten).

**GDG2-19 (NAVIGASI) — Ikon menu duplikat & label tidak sama.**
Di `src/lib/modules.ts:92-107`, ikon `ClipboardList` dipakai tiga menu sekaligus (Purchase Request, Pesanan pembelian, Penyesuaian) — RD2U-11 membedakan ikon menu akuntansi untuk alasan yang sama. Label nav "Pemasok" membuka halaman berjudul "Pemasok & pelanggan" (pelanggan hanya bisa ditemukan dari tab halaman itu).
Arah: bedakan ikon (mis. FilePlus/ListOrdered/SlidersHorizontal), samakan label nav dengan cakupan halaman.

**GDG2-20 (KEADAAN-KOSONG & IZIN) — Halaman Nilai tanpa EmptyState dan tanpa gerbang izin biaya.**
`nilai/page.tsx` merender tabel tanpa keadaan kosong (daftar lain memakai EmptyState berikon+aksi), dan menampilkan HPP/nilai/potensi untuk setiap pemegang `inventory.view` — sementara halaman Produk menghormati izin terpisah `inventory.cost` (`allowCost`) dan detail produk menyembunyikan kartu harga pokok tanpa izin itu. Pergerakan stok juga menampilkan kolom HPP tanpa gerbang yang sama (`pergerakan/page.tsx:120`). Peran bawaan gudang memang memegang `inventory.cost`, tetapi peran kustom yang hanya diberi `inventory.view` mendapat data biaya dari dua halaman ini.
Arah: terapkan `can(ctx, "inventory.cost")` yang sama di Nilai & Pergerakan; tambah EmptyState di Nilai.

**GDG2-21 (ANGKA-TAMPILAN) — Subtotal LineEditor dihitung dengan aritmetika `Number` JS.**
`line-editor.tsx:157,172` menghitung subtotal & total tampilan dengan `Number(qty) * Number(unitCost)` — menyimpang dari aturan proyek (uang selalu Decimal via `src/lib/money.ts`). Ini hanya tampilan (server menghitung ulang dengan Decimal), tetapi pada qty desimal/harga besar tampilan bisa berbeda satu-dua rupiah dari total dokumen yang terposting, dan petugas membandingkan keduanya di GRN.
Arah: pakai helper `d()`/Decimal yang sama untuk total tampilan.

**GDG2-22 (AKSESIBILITAS) — Cakupan axe e2e gudang hanya 1 rute; dialog kustom tanpa pengelolaan fokus.**
`e2e/aksesibilitas.spec.ts` hanya memuat `/app/gudang/produk` untuk modul ini (akuntansi memuat 5 rute pada gerbang FIX). Form dokumen terlipat, wizard impor multi-langkah, dan modal kustom (mis. overlay `product-bulk-table.tsx:308` `fixed inset-0 z-[80]`) tidak terverifikasi axe dan tidak menunjukkan pengelolaan fokus (trap/return-focus) di kode. `aria-label` ada 32 kemunculan — titik pentingnya terlabel (tombol hapus baris, pemilih), sisanya mengandalkan teks terlihat.
Arah: tambah rute gudang inti ke gerbang axe (penerimaan, opname, produk detail, impor) dan pola dialog bersama untuk modal kustom.

**GDG2-23 (FORM-PANJANG) — Form dokumen terlipat di atas daftar membuat halaman sangat panjang saat bekerja.**
Penerimaan & penyesuaian memakai form terlipat di halaman daftar yang sama (`receipt-form.tsx`, `adjustment-form.tsx`): saat form terbuka dengan banyak baris, riwayat terdorong jauh ke bawah dan petugas yang bergantian memeriksa riwayat ↔ mengisi form harus menggulir panjang; di tablet, keyboard virtual memperparahnya. Pola ini konsisten internal gudang (dan cepat untuk dokumen pendek), jadi dinilai ringan — tetapi untuk penerimaan besar, halaman form penuh seperti jurnal manual akuntansi (`/jurnal/baru`) akan lebih nyaman.
Arah: pertimbangkan rute form penuh untuk penerimaan (tetap sediakan form ringkas), atau jangkar "kembali ke riwayat" yang lengket.

**GDG2-24 (WORKFLOW-RETUR) — Retur pembelian memilih produk bebas, tidak dipandu dokumen asal.**
Form retur (`supplier-return-form.tsx:265`) memakai ProductPicker umum sesudah memilih pemasok & gudang: petugas bisa memilih produk apa pun yang ada stoknya, termasuk yang tidak pernah dibeli dari pemasok itu, dan kebenaran klaim bergantung pada ingatan. Pola Odoo/ERPNext memulai retur dari penerimaan/PO asal sehingga baris, batch, dan harga asal terbawa.
Arah: tawarkan mode "pilih dari penerimaan pemasok ini" yang mengisi baris dari GRN asal (produk/batch/harga perolehan), ProductPicker tetap sebagai jalan manual.

**GDG2-25 (BAHASA-LABEL) — Istilah Inggris tertinggal di permukaan gudang.**
Label sumber status dan sebagian teks masih campur: status transfer dirender lewat StatusBadge berlabel "Dalam Perjalanan" (baik), tetapi jenis gerakan mentah (GDG2-10), menu "Purchase Request" berbahasa Inggris di antara label Indonesia lainnya (`modules.ts:95`), dan label halaman "Reservasi Stok"/"Stok opname" membedakan diri dari istilah dokumen "Opname" di riwayat. Kecil, tetapi terasa di modul yang dipakai staf non-teknis.
Arah: samakan label jenis & menu ke Bahasa Indonesia lewat peta label bersama (satu tempat, seperti `JOURNAL_SOURCE_LABELS` akuntansi).

## Yang sudah baik (dengan bukti)

- **Fondasi bersama benar-benar dipakai**: PageHeader 22 berkas, StatusBadge 14, EmptyState 15, Pagination 10, StatCard di dashboard/nilai/reservasi; semua daftar memakai `.data-table` dengan `overflow-x-auto`. Dashboard gudang (`gudang/page.tsx`) setara halaman terbaik akuntansi pra-FIX-R2.
- **Dokumen cetak kelas atas**: GRN, PO, dan retur memakai PrintShell/PrintHeader/PrintFooter dengan blok tanda tangan tiga pihak dan QR dokumen (`penerimaan/[id]/cetak/page.tsx`); total GRN ditaruh di luar tabel agar tidak terulang per halaman (CT-05/CT-10).
- **PO adalah alur paling matang**: daftar & detail punya bilah progres penerimaan per baris, sisa qty eksplisit, dan daftar penerimaan terkait (`pembelian/page.tsx`, `pembelian/[id]/page.tsx`).
- **Kartu stok layak telusur**: per gudang lewat chip, saldo berjalan per baris, dan baris "Saldo awal halaman" saat berpindah halaman (`produk/[id]/page.tsx:170-234`); dilengkapi stok per batch + FEFO, kartu nomor seri, dan riwayat audit master di halaman yang sama.
- **Opname mode menyeluruh**: "Muat semua produk di gudang ini" (maks 1.000) dan stok sistem diambil ulang dari server saat gudang diganti agar kolom Sistem tidak basi (perbaikan GD-P3-9, `opname-form.tsx`).
- **Transfer dua tahap nyata**: status `in_transit` + tombol Terima di daftar (`transfer/page.tsx`), bukan perpindahan instan yang menghilang dari pengawasan.
- **Peringatan kedaluwarsa proaktif**: dashboard menampilkan batch kedaluwarsa/≤30 hari dengan tautan ke produk, dan UI menyatakan batch kedaluwarsa tidak bisa dijual (`gudang/page.tsx:130-186`).
- **Retur pembelian beralur dokumen penuh**: draf → terposting → penyelesaian bertahap (penggantian/potongan/refund), filter status, sisa klaim terlihat di daftar (`retur-pembelian/page.tsx`).
- **Impor seragam**: satu kerangka wizard untuk 7 jenis data dengan petakan kolom, validasi per baris, contoh CSV per jenis, dan riwayat job (`impor/page.tsx`).
- **Form penerimaan berpetunjuk jujur**: 6 pilihan sumber masing-masing dengan penjelasan akibat akuntansinya, tautan PO mengisi baris dari sisa pesanan, dan validasi batch/seri di muka dengan pesan menyebut produk (`receipt-form.tsx`).

## Rekomendasi urutan perbaikan (untuk Pemimpin)

1. **Paket proses fisik (P1)**: GDG2-01 (opname draf + hitung buta + konfirmasi selisih), GDG2-03 (mode pindai picker + pindai-ulang opname), GDG2-04 (stok tersedia per baris).
2. **Paket telusur (P1/P2)**: GDG2-02 (halaman detail dokumen stok) → GDG2-10 (referensi tertaut + label bersama), GDG2-06 (pencarian daftar), GDG2-15 (tombol terima dari PO).
3. **Paket cetak fisik (P2)**: GDG2-05 (batch/seri di GRN, surat jalan transfer, lembar hitung opname), GDG2-17 (keputusan lokasi & label).
4. **Paket konsistensi (P2/P3)** — meniru FIX-R2 Tahap 2: GDG2-07 (field-classes bersama), GDG2-08 (h-7→h-8), GDG2-13 (token nada), GDG2-14 (Metric→StatCard), GDG2-09 (dialog konfirmasi), GDG2-19/25 (ikon & label), GDG2-18/20/21/22/23/24 seperlunya.
