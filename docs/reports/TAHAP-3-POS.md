# Laporan Tahap 3 — POS (Kasir)

Tanggal: 2026-11-03 · Pemimpin: sesi utama · Status: **SELESAI** (seluruh P1 & P2 POS tertangani; LINTAS-01 & SET-RCPT-01 terjadwal ke Tahap 4 sesuai keputusan; offline dinyatakan tidak dibangun secara jujur)

## 1. Temuan audit (docs/audit/POS-DAN-LINTAS.md — bagian POS) & status akhir

| Kelompok | Isi ringkas | Status |
|---|---|---|
| POS-RET-01, RET-02 (P1) | Retur tanpa kunci baris penjualan; tukar barang berjurnal kas keluar; refund ke sesi tertutup; kredit toko mengkredit piutang | ✅ `bf824ad` (desain D-8) |
| POS-PAY-01 (P1) | Pembayaran piutang ke akun sembarang | ✅ `bf824ad` |
| POS-DISC-01 (P1) | Diskon manual kasir tanpa batas/izin — vektor fraud | ✅ `ab10d0f` (desain D-10) + ditutup review T3R-1 `e908445` |
| POS-RCPT-01 (P1) | Pajak ditampilkan ganda di keranjang, nota, estimasi retur | ✅ `06e92b9` |
| POS-HOLD-01 (P1) | Pesanan ditahan kehilangan kelompok harga di 3 lapis | ✅ `06e92b9` |
| POS-CASH-01 (P1) | Semantik setoran/penarikan tertukar UI vs jurnal vs ringkasan | ✅ `06e92b9` (desain D-9) |
| P2 (11 temuan) | IDEM-01 klaim idempotensi, SES-01 kepemilikan sesi + buka ganda, REF-01 validasi referensi, GRP-01 grup nonaktif, SRCH-01 pencarian per gudang, SCAN-01 balapan barcode, ERR-01 terminal macet, PAY-02 kembalian non-tunai, VOID-01 PIN mati, HOLD-02 resume destruktif, SET-RND-01 pembulatan perusahaan mati | ✅ Semua — `06e92b9`, `ab10d0f`; STK-01 terverifikasi sudah benar sejak Tahap 2 |
| LINTAS-01 (P2) | Pengguna multi-perusahaan terkunci ke membership terawal | ⏳ Tahap 4 (keputusan D-10) |
| SET-RCPT-01 (P3) | Header nota tercetak di bawah; keterangan nota menyesatkan | ⏳ Tahap 4 (Print Engine menyusun ulang nota) |
| POS-DATE-01 (P3) | Tanggal jurnal void/selisih/mutasi memakai UTC | ✅ `1325457` |

Di luar audit, tahap ini juga menutup **perbaikan darurat lintas-tahap**: bug tanda kontra-pendapatan di laporan laba rugi (ditemukan agen tahap ini; `d2e70b1`) — diskon & retur kini mengurangi pendapatan, neraca kembali seimbang pada data yang memuat retur/diskon.

## 2. Perbaikan (semua TDD, diverifikasi ulang Pemimpin per commit)

- **Retur menjadi aman & jujur**: baris penjualan dikunci sejak awal (balapan retur lintas tahun terbukti di kode lama kini mustahil); restore batch dihitung di bawah kunci; exchange & kredit toko masuk liabilitas 2300 Kredit Pelanggan (pemetaan wajib, tanpa tebakan); refund tunai ke sesi berjalan pemroses; void penjualan mengikuti pola sesi yang sama (review T3R-2).
- **Gerbang fraud diskon**: izin `pos.discount` + ambang per perusahaan (bawaan 10%, dapat diatur) + audit override; penilaiannya persen efektif terhadap bruto; baris duplikat ditolak agar ambang tak bisa dibelah.
- **Uang & sesi**: klaim idempotensi anti-balapan (yang kalah menerima penjualan pertama, bukan error); satu sesi terbuka per kasir ditegakkan indeks unik parsial (migrasi 0012) + kepemilikan sesi diperiksa; pembayaran non-tunai tak bisa melebihi sisa tagihan; kembalian hanya dari tunai.
- **Harga & pembulatan**: pembulatan perusahaan diterapkan (kelompok tetap didahulukan), jurnal pembulatan ke akun untung/rugi pembulatan yang benar; grup nonaktif tak lagi ditawarkan; gudang & metode divalidasi milik perusahaan + aktif di quote & checkout.
- **Terminal**: pencarian memakai gudang terpilih & kartu awal berstok nyata; Enter barcode hanya menambah kecocokan eksak; semua panggilan async ber-try/finally; kunci idempotensi berputar juga saat pembayaran berubah; keranjang persisten per pengguna/perusahaan (pemulihan crash, bukan offline); resume tahanan baca-saja & diklaim atomik saat checkout; peringatan tampil bila total berubah sejak ditahan.

## 3. Fitur yang ditambahkan / dilengkapi

Izin `pos.discount` di katalog & peran bawaan; pengaturan ambang diskon manual + kontrol pembulatan total kasir di Pengaturan; seri nomor HLD untuk pesanan ditahan; pemetaan akun `customer_credit` + akun COA 2300 Kredit Pelanggan; persistensi keranjang anti-crash; label Setor/Tarik ke Bank yang tak ambigu; snapshot harga tahanan dengan peringatan perubahan total.

## 4. UI/UX sebelum → sesudah

- Nota & keranjang: jumlah baris menggelembung pajak → sama persis dengan total; pajak tampil sebagai memo "termasuk PPN".
- Pesanan ditahan: harga kelompok hilang & pesanan lenyap saat dilanjutkan → grup & total snapshot kembali utuh, peringatan bila harga berubah, tahanan hanya hilang sesudah terbayar.
- Kas laci: label setoran tertukar arah → "Setor ke Bank (kas laci berkurang)" / "Tarik dari Bank (kas laci bertambah)" dengan ringkasan berlabel arah.
- Retur: metode tukar/kredit toko berlabel jujur "(kredit pelanggan)" + catatan sesi penanggung refund tunai.
- Pencarian: kartu awal selalu "stok 0" merah → stok nyata gudang terpilih; scanner tak lagi memasukkan produk pertama yang kebetulan tampil.

## 5. Hasil tes & build (output nyata, dijalankan Pemimpin)

- Awal tahap: 210 test → akhir tahap: **250/250 lulus (29 berkas)**; `pnpm typecheck`, `pnpm lint`, `pnpm build` exit 0 pada commit penutup `e908445`.
- **Matriks Verifikasi Fitur (A-5)**: `docs/reports/MATRIKS-FITUR-POS.md` — 41 fitur: 28 terbukti otomatis (termasuk split payment, kredit tempo ujung-ke-ujung, selisih sesi, void berpajak — semua baru pertama kali teruji di tahap ini), 7 sebagian, 4 UI/build, 2 celah (offline — tidak dibangun).
- **Review kode independen (A-7)**: 0 P0, 1 P1, 3 P2, 2 P3 — keenamnya ditindaklanjuti (`e908445`, 4 test konkurensi baru, semuanya tereproduksi RED di kode lama).
- Uji konkurensi nyata kini menjadi pola tetap: retur ganda, checkout ganda (idempotensi & tahanan), buka sesi ganda — semua dibuktikan dengan dua transaksi commit bersamaan.
- DB dev di-reseed pada gerbang tahap; consistency hijau.

## 6. Sisa masalah & rencana berikutnya

- **Offline POS tidak dibangun** (D-10/A-2): tidak ada penjualan saat koneksi putus; keranjang hanya persisten lokal. Mesin sinkronisasi offline adalah produk tersendiri — keputusan produk di luar program perbaikan ini.
- **Penebusan Kredit Pelanggan (2300) sebagai alat bayar belum ada**: saldo retur tukar/kredit toko terlacak di buku besar tetapi belum bisa dibelanjakan di kasir → kandidat Tahap 4/5 (gerbang keputusan Pemimpin; spek pengguna menyebut tukar barang, sehingga penebusannya adalah pasangan alami fitur itu).
- LINTAS-01 (pemilih perusahaan) & SET-RCPT-01 (tata letak nota) → Tahap 4.
- Rasio margin di halaman Akuntansi memakai penyebut bruto terhadap pembilang neto (observasi agen perbaikan darurat) → ditinjau Tahap 4 bersama pekerjaan laporan.
- Catatan deploy: migrasi 0012 (indeks unik parsial sesi) akan gagal pada data lama yang sudah memiliki dua sesi terbuka untuk pengguna yang sama — bersihkan data semacam itu sebelum migrasi di luar lingkungan dev.
- Berikutnya: **Tahap 4** — rekonsiliasi bank, Print Engine + template cetak, perluasan impor/ekspor, GD-P2-5/P2-6, LINTAS-01, loading states, pagination keyset, WCAG, penomoran dokumen kustom (AK-P3-07).
