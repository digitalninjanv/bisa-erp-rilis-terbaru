# LAPORAN GABUNGAN RONDE 2 — Validasi Ulang Akuntansi: Desain Laporan & UI/UX

Tanggal: 2026-11-04 · Mandat pengguna 19:08: "validasi lagi bagian akuntansi… desain
laporannya kurang intensional, nggak sesuai profesional… riset lagi."
Metode: riset acuan sungguhan (PSAK 201/IAS 1, PSAK 207/IAS 7, dokumentasi Accurate/Odoo/
Mekari Jurnal/Xero/QuickBooks) → daftar periksa 34 butir; audit desain laporan (kode render);
audit kualitas desain UI; validasi ulang ANGKA atas perbaikan P1 ronde 1 (14 test skenario
baru, 4 fixture). Laporan rinci: `R2-RISET-ACUAN-DESAIN.md`, `R2-AUDIT-DESAIN-LAPORAN.md`,
`R2-AUDIT-DESAIN-UI.md`, `R2-VALIDASI-ANGKA.md` di folder ini.

## Vonis ringkas

**Angka: sehat dan kini terbukti.** Keenam perbaikan P1 kunci ronde 1 lulus uji ulang
dengan skenario angka baru (retur kombinasi, ekuitas rentang tengah, payroll cuti,
tutup buku tahunan tanpa hitung ganda, PPN Masukan gabungan 462.000, race periode 0 lolos)
dan regresi silang nol — skenario mini cocok hitung tangan di semua ukuran.

**Desain: keluhan pengguna TERBUKTI, pada dua lapis.**
1. **Laporan diperlakukan sebagai layar yang dicetak, bukan dokumen yang dirancang.**
2. **Satu modul, banyak tangan**: sistem desain bersama ada dan bagus, tetapi halaman
   terus mengarang varian lokal sehingga konsistensi — penanda utama profesional —
   runtuh di dalam modul sendiri.

Total temuan desain: **32 (P1: 9 · P2: 12 · P3: 11)** + validasi angka: 1 temuan baru P2,
1 P3, dan 3 sisa P2 ronde 1 terkonfirmasi masih berlaku berbukti angka.

## Temuan P1 desain (urutan perbaikan disarankan)

### Laporan sebagai dokumen (RD2)
1. **Laporan keuangan TIDAK memakai PrintShell** (terverifikasi Pemimpin: 0 berkas
   laporan memakainya; slip gaji, jurnal, GRN, PO, retur memakainya) — akibatnya laporan
   resmi perusahaan tidak punya template dokumen, blok tanda tangan
   "Disiapkan oleh / Disetujui oleh", dan kaki dokumen (RD2-01).
2. **Tidak ada pernyataan mata uang & satuan** ("Dalam Rupiah penuh") dan kop cetak
   tanpa alamat/NPWP — melanggar kebiasaan identifikasi dokumen IAS 1.51 (RD2-02).
3. **Aging piutang/utang tidak punya jalur cetak sama sekali** — Ctrl+P mencetak kartu
   statistik berwarna & form pencarian, tanpa kop resmi (RD2-03).
4. **Format amatir yang paling cepat terlihat**: negatif bertanda minus `−Rp …` bukan
   kurung akuntansi `(Rp …)`; total akhir tanpa garis ganda sehingga bobot visualnya
   setara subtotal (RD2-04).

### Konsistensi UI (RD2U)
5. **Empat varian kartu metrik** (StatCard resmi vs SummaryCard/MiniMetric/AgingCard
   lokal) — angka ringkasan tampil beda gaya di tiap halaman (RD2U-01).
6. **Status dirender 4 cara** (badge bersama, pill salin-tempel, teks polos, emerald
   lepas palet); beban menampilkan label Inggris "Posted" (RD2U-02).
7. **Skala teks liar**: 13 ukuran, 128× `text-[10px]`, teks sampai 9px, angka mutasi
   buku besar 11px redup — di bawah ambang nyaman untuk kerja akuntansi lama (RD2U-03).
8. **Bilah filter 3 varian** (SearchForm resmi vs manual tanpa ikon vs menyusut h-7)
   (RD2U-04).
9. **Rekonsiliasi bank sepenuhnya di luar sistem desain** (tabel bespoke, hijau emerald)
   — halaman terlemah di modul (RD2U-05, nilai C+).

## P2 pilihan
- Kolom pembanding hilang di arus kas/ekuitas/neraca saldo & dibuang di CSV (RD2-05);
  hierarki datar — akun tidak menjorok dari kelompok; elemen dashboard (`bg-muted` kotak)
  bocor ke neraca (RD2-06); pemutusan halaman laporan tak diatur — subtotal bisa yatim,
  neraca dua kolom runtuh di kertas (RD2-07); istilah tak baku ("Neraca" bukan Laporan
  Posisi Keuangan; kode mentah "asset · saldo normal debit" tercetak; `sourceType` Inggris
  di CSV) (RD2-08).
- `EmptyState` bersama tak pernah dipakai dalam bentuk dirancangnya (0/21 memakai ikon/
  aksi) (RD2U-08); ±15 hex mentah di luar token desain (RD2U-06); nol transisi mikro di
  seluruh modul (RD2U-07).
- **Angka**: saldo bank negatif bebas lewat jalur sah (beban 5 jt dari bank bersaldo 1 jt
  terposting → −4 jt) (RV2-01 = bukti baru AK3-11); klasifikasi arus kas per jurnal utuh
  (AK2-03) & fallback rentang kode (AK2-04: utang bank jangka panjang tampil jangka pendek
  + operasi) terkonfirmasi dengan angka baru; produk tetap tanpa rekonsiliasi kontrol vs
  subledger bawaan (AK2-07).

## Nilai per laporan (desain)
Laba rugi B− · Neraca saldo B− · Buku besar B · Arus kas C+ · Neraca C+ · Perubahan
ekuitas C · Aging C− · Pembanding internal repo: slip gaji & dokumen PrintShell A−.
Halaman UI tertinggi: jurnal baru A−, detail jurnal B+; terendah: rekonsiliasi C+.

## Catatan arah standar (dari riset)
IFRS 18 (efektif 2027) mewajibkan subtotal **laba operasi** terdefinisi dan kategori
operasi/investasi/pendanaan di laba rugi — struktur pengelompokan akun sebaiknya
diantisipasi saat merombak presentasi laporan, bukan sesudahnya.

## Rekomendasi paket perbaikan (bila dimandatkan)
1. **Paket Presentasi Laporan**: semua laporan keuangan masuk PrintShell (kop lengkap,
   pernyataan satuan, tanda tangan, footer halaman), negatif kurung akuntansi, garis
   ganda total, indentasi hierarki, perataan istilah baku (Laporan Posisi Keuangan),
   jalur cetak aging, aturan potong halaman, pembanding konsisten termasuk CSV,
   subtotal laba operasi berlabel (antisipasi IFRS 18).
2. **Paket Konsistensi UI**: satu kartu metrik, satu badge status, satu bilah filter,
   skala teks minimum 11px untuk konten (10px hanya label mikro), rekonsiliasi masuk
   sistem desain, EmptyState dipakai penuh, hex liar masuk token, transisi mikro dasar.
3. **Sisa angka P2**: penjaga saldo kas/bank negatif (konfigurabel: tolak/peringatkan),
   klasifikasi arus kas per baris lawan, fallback kelompok berbasis tipe+section dulu.
