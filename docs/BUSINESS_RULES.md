# Aturan Bisnis — Bisa ERP

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Konsolidasi dari
`docs/SPEK-FITUR-INTI.md` (blueprint pengguna 2026-11-03), keputusan tercatat
D-1…D-25 di `PROGRESS.md`, dan aturan proyek `AGENTS.md` yang ditegakkan
test. Bila dokumen ini dan kode berbeda, kode + test yang berlaku — dan
perbedaannya adalah temuan yang harus dilaporkan, bukan dipilih diam-diam.

Prinsip pengguna yang mengikat semua aturan di bawah: **fitur yang
benar-benar berfungsi > daftar fitur terbanyak; fleksibilitas tidak boleh
mengorbankan validitas akuntansi dan stok; dokumen terposting tidak
diedit/dihapus diam-diam.**

## 1. Aturan umum & konfigurasi (D-25)

1. **Konfigurasi, bukan angka mati.** Tarif pajak, tarif fee metode,
   ambang (diskon POS, persetujuan penyesuaian, persetujuan PR, write-off),
   termin, penomoran dokumen, pemetaan akun, kategori awal, saklar modul
   & fitur — semuanya per perusahaan.
2. **Angka regulasi bertanggal efektif.** Parameter fiskal/payroll
   (PTKP, TER, tarif Pasal 17, program BPJS, upah minimum, aturan lembur)
   disimpan berversi tanggal; perhitungan periode lama tidak berubah oleh
   aturan baru.
3. **Saklar per komponen.** Komponen nonaktif = tidak dihitung, tidak
   tampil di dokumen/slip, tidak dijurnal — dibuktikan test per fitur
   (pola bawaan mati/netral untuk semua fitur finansial baru sejak A-21).
4. **Angka yang belum terverifikasi tidak disemai.** Batas JP 2026,
   lapisan TER harian, status DTP 2026 sengaja kosong sampai ada sumber
   resmi — sistem menolak mengarang angka regulasi.

## 2. Akuntansi

1. **Double-entry lewat satu gerbang.** Semua jurnal lahir dari
   `postJournal`: wajib seimbang dan periode wajib terbuka
   (`assertPeriodOpen`). Tidak ada jalur jurnal kedua.
2. **Pendapatan dikredit bruto.** Diskon penjualan adalah contra-revenue
   (4010 `sales_discount`), retur penjualan contra (4020
   `sales_return`) — pendapatan tidak pernah dinetokan di jurnal.
3. **Pembulatan:** selisih pembulatan untung → 9000, rugi → 9001.
4. **Append-only & koreksi reversal.** Jurnal terposting, gerakan stok,
   dan baris audit tidak diubah/dihapus; koreksi hanya `reverseJournal`
   (level jurnal) atau `reverseSourceJournal` (level modul). Dokumen
   yang divoid berstatus `void` dan reversal-nya tetap ada.
5. **Pemetaan akun menentukan jurnal otomatis** (Configuration Engine):
   kunci pemetaan per keperluan transaksi; pemetaan yang belum diatur
   menolak transaksi dengan pesan yang menunjuk pengaturannya — bukan
   jurnal tebakan.
6. **Periode bertingkat:** terbuka → tutup → kunci; buka kunci hanya
   pemilik beralasan. Tutup buku tahunan adalah proses nyata, bukan
   sekadar status.
7. **Laporan dari jurnal yang sama:** laba rugi & neraca wajib berkolom
   pembanding tahun sebelumnya; aging utang/piutang dari **tanggal
   dokumen**; pengelompokan laporan dari `accounts.section` &
   `cash_flow_group` (fallback hanya dari tipe akun — tidak pernah
   ditebak dari rentang kode); akun lawan arus kas yang tak terklasifikasi
   tampil eksplisit sebagai grup "Belum terklasifikasi".
8. **Saldo awal adalah dokumen tersendiri** (D-14) — bukan penerimaan/
   penjualan samaran; stok tidak bergerak oleh saldo awal akun/pihak.
9. **Kelebihan bayar menjadi kredit pihak** (seri KRD): porsi teralokasi
   melunasi, kelebihannya menjadi kredit bertag pihak yang bisa menjadi
   sumber dana pembayaran berikutnya; kredit tampil sebagai daftar
   tersendiri, tidak dinetokan ke aging.
10. **Withholding PPh 23/4(2)** (bila saklar aktif): nominal adalah
    putusan pengguna, dijurnal **saat pembayaran** ke 2130; FIFO mengiris
    potongan ke dokumen tertua; void simetris.
11. **Write-off** sisa piutang/utang: izin `accounting.manage`, alasan
    wajib, dibatasi ambang maksimum per perusahaan (bawaan 0 = mati);
    piutang → 6100, utang → pendapatan lain-lain.
12. **Fee metode pembayaran** (bawaan mati): tarif tetap/persen per
    metode dibekukan di baris pembayaran; selalu beban perusahaan (6060).
13. **Beban terutang** dilunasi lewat mesin utang yang sama (FIFO bisa
    campuran dengan faktur pembelian); klaim reimbursement memisah PPN
    Masukan (1180) bertarif yang dibekukan di klaim.
14. **Rekonsiliasi bank** (D-11): pencocokan hanya menautkan, tidak
    mengubah jurnal; auto-match hanya kandidat tunggal ±3 hari nominal
    sama persis; impor ulang tidak menggandakan (sidik jari baris).
    Impor dapat menyimpan saldo akhir rekening koran + tanggal cut-off;
    sign-off hanya bila semua baris tertaut; impor yang sudah selesai
    atau masih tertaut tidak dapat dihapus.
15. **Approval jurnal manual** (bila ambang perusahaan diisi): jurnal
    dengan total debit ≥ ambang disimpan sebagai draf `pending`, bukan
    diposting. Pembuat tidak dapat menyetujui sendiri; penyetuju wajib
    memegang `accounting.manage`. Setujui = posting + audit; tolak =
    draf tetap tersimpan dengan alasan. Ambang kosong = approval mati.
16. **Lampiran bukti** disimpan per dokumen (jurnal/beban) sebagai
    PNG/JPEG/WebP/PDF maksimal 5 MB. Unggah/hapus memerlukan izin tulis
    akuntansi; penghapusan oleh selain pengunggah memerlukan
    `accounting.manage`; semua aksi masuk audit. Lampiran bukan
    pengganti jurnal — dokumen tetap menjadi sumber kebenaran.

## 3. Persediaan & pembelian

1. **Penilaian AVCO (moving average)** — metode biaya yang dikunci
   proyek; HPP mengikuti AVCO berjalan; `products.costPrice` adalah
   AVCO global produk.
2. **Setiap mutasi berreferensi dokumen** dan masuk `stock_movements`
   append-only; tidak ada perubahan stok tanpa dokumen (penerimaan,
   penjualan, retur, transfer, penyesuaian, opname, pengeluaran
   beralasan).
3. **Penerimaan tiga skenario** (spek pengguna §3): kredit pemasok
   (utang lahir), tunai (kas/bank berkurang, **utang tidak lahir**),
   non-pembelian bersumber alasan (akun lawan ditentukan sumber).
   Penerimaan sebagian sah terhadap PO.
4. **Opname hitung buta:** angka sistem tersembunyi dari penghitung
   sampai tahap peninjauan; selisih bernilai Rp ditinjau sebelum posting.
5. **Penyesuaian beralasan & berotorisasi:** alasan berkategori wajib;
   di atas ambang nilai per perusahaan wajib disetujui orang lain
   (bukan pembuat) — approval maker-checker untuk penyesuaian stok
   (sempit & nyata, D-17), sejajar dengan approval jurnal manual.
6. **Retur pembelian berplafon asal-usul:** nilai retur tidak boleh
   melebihi dokumen asal; kelebihannya di atas utang terbuka menjadi
   aset Kredit Pemasok (1210) dengan penyelesaian terlacak (ganti
   barang / potong pembelian berikut / refund / custom bertulis).
7. **FEFO & blokir kadaluarsa:** penjualan mengambil batch
   berkadaluarsa terdekat; barang kadaluarsa tidak bisa dijual.
8. **Stok minimum kanonis** (D-4) menjadi dasar peringatan menipis &
   rekomendasi pembelian; qty saran terlabel sebagai saran.
9. **Konversi kemasan faktor tetap tersedia** (Satuan Kemasan S1–S6; menggantikan batas D-17 lama): produk memiliki satuan dasar dan kemasan berfaktor tetap; seluruh transaksi menyimpan faktor cuplikan. Konversi UOM arbitrer tidak disediakan.

## 4. POS & penjualan

1. **Harga hanya dari kelompok pelanggan terpilih** (aturan harga +
   pembulatan grup); tanpa grup = harga normal. Mode pembulatan yang
   sama wajib sampai ke quote dan checkout (`sales.rounding_mode`).
2. **Diskon manual boleh menumpuk di atas harga grup tetapi tidak
   pernah melewati bruto**; di atas ambang persen per perusahaan wajib
   izin `pos.discount` dan tercatat audit (D-10).
3. **Penjualan utang (D-19):** metode kredit hanya muncul sebagai opsi
   khusus "Utang"; wajib pelanggan + tanggal jatuh tempo; batas kredit
   ditegakkan bila > 0 (0 = tanpa batas); porsi utang dijurnal Dr
   Piutang, bukan kas.
4. **Setiap checkout membawa kunci idempotensi**; dokumen final menolak
   suntingan.
5. **Retur dari nota:** plafon per baris = qty terjual; penyelesaian
   refund/tukar/kredit; kredit retur ditebus berdasarkan nomor dokumen
   retur (D-12) dan pemakaiannya terkunci baris (anti pakai-ganda).
6. **Sesi kas per kasir:** modal awal menjadi acuan; kas masuk/keluar
   wajib beralasan; tutup sesi menghitung fisik vs harapan per metode;
   selisih berjurnal (`cash_short`/`cash_over`) dan tidak bisa dihapus.
7. **Offline (bila saklar perusahaan aktif):** penjualan mengantre lokal
   dengan kutipan harga lokal yang merupakan cermin murni domain
   (primitif uang yang sama); sinkronisasi idempoten; konflik harga/
   stok tidak dipaksakan — tertahan untuk peninjauan manusia.

## 5. HR & payroll

1. **Gaji tidak terbaca tanpa `payroll.view`** — menutup SEC-01; modul
   HR mengikuti saklarnya sendiri termasuk di lapisan aksi (T2).
2. **Kasbon (D-22):** Dr 1220 Piutang Karyawan; rencana potong dipilih
   saat dibuat (penuh di gaji berikut / cicilan nominal / cicilan
   persen); potongan payroll dibatasi sisa kasbon & gaji bersih — tidak
   pernah membuat gaji negatif; kelebihan terbawa ke periode berikut;
   pelunasan manual di luar payroll didukung.
3. **Pinjaman karyawan terpisah dari kasbon** (akun & alur sendiri).
4. **Saldo cuti hanya berkurang sesudah persetujuan** atasan; koreksi
   presensi hanya berotorisasi dan tercatat.
5. **Payroll terposting tidak diedit:** koreksi lewat reverse run;
   jurnal ringkasan masuk akuntansi lewat `postJournal` — HR tidak
   menulis jurnal dengan caranya sendiri.
6. **Indeks unik payroll parsial** (`status <> 'void'`) agar alur
   koreksi sah (void → proses ulang) tidak patah (deviasi AK-P3-03
   yang disahkan, tercatat di D-16).

## 6. Platform & master data

1. **Perubahan master tidak merusak histori:** dokumen membekukan
   snapshot nama/SKU/harga saat terbit.
2. **Status dokumen adalah enum penjaga integritas** — status kustom &
   form builder generik **tidak dibangun** (D-16); yang dibangun:
   saklar modul per perusahaan & custom fields produk/pihak.
3. **Penomoran dokumen per seri per perusahaan** (urutan atomik);
   seri yang hidup: INV, RCV, RTB, KSB, PJM, RBS, AST, PRQ, RSV, KRD,
   dan seri jurnal/dokumen per jenis di `document_sequences`.
4. **Pengguna & peran:** hanya pemilik bisa memberi peran pemilik;
   pemilik terakhir tidak bisa diturunkan/dihapus; manajemen pengguna
   wajib `users.manage`. Template peran bawaan adalah konstanta pusat
   (`BUILTIN_ROLES`); anggota peran bawaan mengikuti template pada sesi
   berikut; **peran kustom tidak pernah ditimpa template**.
5. **Cetak (D-13/D-18):** satu template aktif per perusahaan
   (modern/minimal/classic, logo/warna/font/QR/tanda tangan bisa
   diatur); kertas thermal memakai tinggi rol 297mm; @page global A4;
   yang diatur di pratinjau = yang tercetak.
6. **Impor bertahap tervalidasi:** pratinjau → klasifikasi baris →
   sunting baris (khusus impor produk, D-21) → commit dengan validasi
   ulang server — server tidak pernah percaya klien.

## 7. Keputusan yang sengaja menahan fitur (dirujuk, tidak diulang)

Promosi bertanggal · peringatan kadaluarsa bertingkat · PIN supervisor
POS · tutup sesi terpandu · maker-checker PO · tender kredit pihak di
terminal · refund tunai kredit tak terpakai · git remote/CI wajib ·
kebijakan SIM-2 yang belum diputuskan · matriks ECL · write-down NRV ·
ekspor ulang Accurate Opsi A · gerbang harga bulk-edit · pembatasan
gudang per pengguna · saklar riwayat lintas-kasir · pemetaan khusus PPh
bunga · xlsx registry vs CDN. Daftar otoritatif: `docs/rombak/RENCANA.md`
§3 (19 butir) & `PROGRESS.md` §0D/§0G.


## 8. Guard integritas ERP (remediasi 13 November 2026)

- Harga pokok produk yang sudah memiliki stock movement tidak boleh ditimpa bulk edit atau impor master. Penerimaan dan dokumen persediaan mengubah cost pool; perubahan harga jual tetap terpisah.
- Valuasi perusahaan mencakup stok produk nonaktif dan stok transfer yang masih dalam perjalanan. Valuasi gudang tertentu hanya menghitung stok fisik gudang tersebut.
- Jurnal memakai angka canonical 4 desimal yang sama untuk detail dan summary. Residual pembulatan dialokasikan pada sisi yang sama; jurnal harus seimbang sebelum disimpan. Baris jurnal hanya dapat ditambahkan dalam transaksi yang membuat header.
- Retur penjualan memiliki kunci operasi agar retry tidak menggandakan refund. Pilih layak jual untuk restock, atau rusak/tidak layak jual untuk tanpa restock dan reklasifikasi HPP ke akun penyusutan persediaan. Pisahkan dokumen untuk kondisi campuran.
- Sinkronisasi offline dari kasir lain membutuhkan otoritas supervisor. Faktor kemasan yang berubah tidak langsung diterima; supervisor memeriksa rincian faktor, jumlah dan bukti transaksi sebelum settlement historis.

Guard ini tidak menetapkan kebijakan baru untuk GRNI, credit note pemasok, koreksi retur posted, pajak atau negative stock. Keputusan yang belum disahkan tetap tercatat pada laporan audit dan remediasi.
