# LAPORAN GABUNGAN — Audit Adversarial Modul Akuntansi Bisa ERP

Tanggal: 2026-11-04 · Mandat: mode ahli accounting, "anggap semua salah sampai terbukti benar".
Metode: 6 agen inspeksi paralel (buku besar, laporan, piutang/utang/kas, jurnal lintas modul,
UI/UX & workflow, probing serangan 52 probe eksekutabel) + verifikasi titik Pemimpin.
Laporan rinci: `A1-BUKU-BESAR.md`, `A2-LAPORAN.md`, `A3-PIUTANG-UTANG-KAS.md`,
`A4-JURNAL-LINTAS-MODUL.md`, `A5-UIUX-WORKFLOW.md`, `A6-PROBING.md` di folder ini.

## Vonis ringkas

Fondasi buku besar **terbukti kuat** (jurnal tak seimbang 0/5.312, append-only, RLS tahan
5/5 probe, race pembayaran tahan). Tetapi keluhan pemilik **terbukti benar**: ada cacat
uang-nyata di seputar retur & void penjualan/utang, satu laporan yang salah angka, jurnal
payroll yang menggelembungkan utang, dan workflow akuntan yang putus di banyak titik.

**Total: 86 temuan — P0: 0 · P1: 18 · P2: 30 · P3: 38** (sesudah dedup lintas laporan ±80 unik).

## Temuan P1 (deduplikasi, urutan perbaikan yang disarankan)

### Kelompok Retur & Void (uang keluar / saldo fiktif)
1. **Retur penjualan selalu GAGAL TOTAL bila penjualan asal memiliki penyesuaian
   pembulatan ≠ 0** — jurnal retur tak seimbang sebesar porsi pembulatan → rollback
   (AK4-01, pos.ts:1793–1827). Laten: belum pernah ada penjualan ber-pembulatan di test.
2. **Retur atas penjualan UTANG belum lunas bisa direfund tunai penuh; piutang tidak
   berkurang** dan sisa piutang masih bisa dibayar lagi (AK2-01 = AK4-03, pos.ts:1565–1712).
3. **Void penjualan tidak membalik pembayaran piutang** (terverifikasi Pemimpin:
   `voidSale` memuat 0 rujukan `partyPayments`) — GL piutang negatif, dokumen hilang dari
   subledger; `payReceivable` tidak memeriksa status sehingga penjualan void tetap bisa
   dibayar (AK3-01).
4. **Penerimaan yang sudah di-void tetap bisa dibayar** (terverifikasi Pemimpin:
   `payPayableDocument` tidak memeriksa `receipt.status`; void tidak menyentuh
   paymentStatus) — uang keluar atas utang yang tidak ada (AK3-02).
5. **Jalur retur pemasok warisan Gudang** mendebit Utang Usaha tanpa tag pemasok/alokasi
   (subledger tak berkurang → risiko bayar ganda) dan metode replacement mendebit Piutang
   Usaha untuk klaim ke pemasok (AK4-02, inventory.ts:986–1016). Modul A-9 benar; jalur
   warisan ini yang bocor.

### Kelompok Angka Laporan & Jurnal Salah
6. **Cuti tak berbayar dikredit sebagai utang di jurnal payroll & final pay** — Beban Gaji
   dan Utang Gaji sama-sama overstated permanen setiap periode; slip karyawan tetap benar
   sehingga tak terlihat (AK4-05).
7. **Laporan Perubahan Ekuitas salah untuk rentang yang tidak dimulai dari awal waktu**
   — terbukti angka: selisih persis laba periode sebelumnya (AK2-02, reports.ts:529–593).
8. **Rekonsiliasi valuasi stok ↔ GL tidak dijamin desain** — retur masuk pada biaya asal
   tanpa re-blend AVCO, void penerimaan tanpa hitung ulang AVCO, unitCost penyesuaian
   bebas ketik (AK4-06).

### Kelompok Periode & Integritas Jurnal
9. **Periode tanpa baris = terbuka selamanya** — backdating jurnal manual ke tahun mana
   pun yang belum pernah dibuat baris periodenya (AK1-01).
10. **Race tutup periode (TOCTOU)** — 30/36 jurnal paralel terposting SESUDAH commit
    penutupan pada probe; `assertPeriodOpen` membaca tanpa mengunci (AK6-02).
11. **Baris jurnal negatif & dua-sisi lolos lewat aksi resmi** — terposting sebagai jurnal
    sah; neraca saldo tetap tampak seimbang (AK6-01 = AK1-02).

### Kelompok Pajak & Konfigurasi
12. **PPN Masukan tidak ada sama sekali** — PKP tak bisa kompensasi; persediaan & beban
    tercatat bruto termasuk PPN (AK1-06 = AK4-04). Saklar PPN keluaran sendiri terbukti
    tidak bocor.
13. **9 kunci pemetaan akun dipakai kode tapi mustahil diubah dari Pengaturan**
    (supplier_credit, employee_receivable, employee_loan_receivable, pph21_payable,
    bpjs_payable, payroll_employer_expense, fixed_asset, accumulated_depreciation,
    depreciation_expense) — janji konfigurabel D-25 belum terpenuhi di sini (AK1-03).

### Kelompok Workflow & UI/UX (AK5)
14. **Drill-through putus di 3 titik**: laporan → buku besar bukan tautan; buku besar →
    detail jurnal bukan tautan; dokumen sumber di detail jurnal hanya teks (AK5-01).
15. **Tidak ada alur tutup buku tahunan/jurnal penutup**; tutup/kunci periode satu klik
    tanpa konfirmasi/ringkasan (AK5-04, sejalan AK1-05).
16. **Formulir jurnal tidak tahu status periode** — kesalahan baru muncul sebagai toast
    sesudah form terisi penuh (AK5-03).
17. **Daftar jurnal lemah untuk volume besar** — tanpa ekspor, tanpa filter akun/status,
    filter sumber hanya 9 dari ±20 tipe nyata (AK5-02).
18. **Piutang/utang tanpa penanda lewat jatuh tempo**, tanpa ekspor aging, bayar satu
    dokumen per modal, label status Inggris mentah (AK5-05, sejalan AK3-07: utang
    pembelian bahkan tanpa kolom jatuh tempo; termin pihak hanya dipakai saldo awal).

## P2 pilihan (lengkapnya di laporan per bagian)
- INSERT baris liar ke jurnal posted tanpa trigger penjaga (AK6-03; prasyarat akses SQL).
- Arus kas mengklasifikasi per jurnal utuh menurut akun lawan terbesar; akun bergrup null
  jatuh diam-diam ke operasi (AK2-03). Fallback kelompok dari rentang kode string bisa
  salah mengklasifikasi akun wajar (AK2-04).
- Tidak ada fee/MDR metode bayar — saldo bank GL permanen lebih tinggi dari riil (AK3-04);
  kelebihan bayar & uang muka/DP tidak bisa dicatat sama sekali (AK3-05); pembayaran utang
  tak memvalidasi akun sumber (AK3-03); kredit pelanggan tak tampil sebagai saldo (AK3-06).
- Retur pelanggan via Gudang mengkredit 4020 sebesar biaya, bukan harga (AK4-07); final
  pay tanpa pesangon/UPMK/kompensasi PKWT (AK4-08); tak ada alur bayar setoran PPh 21/BPJS
  (AK4-09); tak ada akrual/prepaid (AK4-10).
- UI: pemilih akun buku besar tanpa pencarian; tak ada pencarian global; tak ada jurnal
  berulang/duplikasi; daftar kasbon/pinjaman/aset/klaim tanpa paginasi/pencarian/ekspor;
  menu HR tak ada di navigasi (AK5, kelompok P2).

## Yang terbukti BENAR (jangan diutak-atik tanpa bukti baru)
Penolakan jurnal tak seimbang dua lapis (JS + trigger deferred) — 0/5.312 jurnal timpang ·
semua jalur posting produksi lewat postJournal · append-only kode+trigger · RLS lintas
perusahaan 5/5 probe · race pembayaran utang & void ganda tertahan · rumus neraca saldo,
laba rugi (kontra 4010/4020 benar), neraca (balanced sah), ikatan arus kas ke GL ·
checkout POS, pembayaran piutang, penerimaan, retur pemasok A-9, kasbon & pinjaman,
penyusutan & pelepasan aset, transfer bank + fee — jurnalnya benar penuh (A4) ·
rekonsiliasi bank kokoh (impor CSV + auto-match + penjaga jurnal terbalik) · formulir
jurnal manual & Catat Transaksi adalah UI terkuat di repo (A5).

## Catatan higiene data demo (temuan samping A6, sudah ditangani Pemimpin)
Gerbang final SIM-2 mencemari perusahaan demo lokal dengan residu test (4 produk `TST-*`
+ mutasi; demo menjadi 69 produk/Rp28.632.045) karena sebagian test integrasi menulis ke
perusahaan demo, bukan fixture. Baseline sudah dipulihkan Pemimpin via
`pnpm db:seed -- --force` → **65 produk, Rp28.349.600** (terverifikasi). Rekomendasi:
audit test mana yang memakai perusahaan demo dan pindahkan ke fixture khusus.

## Rekomendasi urutan remediasi
1. Kelompok Retur & Void (P1 #1–5) — risiko uang nyata, perbaikan terkurung di POS/payables.
2. AK4-05 + AK2-02 (angka laporan salah yang berjalan terus).
3. Periode & integritas jurnal (P1 #9–11 + AK6-03).
4. PPN Masukan (P1 #12) — fitur, bukan sekadar perbaikan; perlu keputusan cakupan SPT.
5. Pemetaan lengkap di Pengaturan (P1 #13) — kecil, menutup janji D-25.
6. Workflow akuntan (P1 #14–18) — drill-through dulu, lalu tutup tahun + daftar jurnal.
