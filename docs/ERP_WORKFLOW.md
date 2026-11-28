# Workflow ERP Minimarket — Bisa ERP

> **Diperbarui 28 November 2026:** peta fitur/workflow per modul yang lebih lengkap ada di [`docs/worflow.md`](worflow.md). Dokumen ini dipertahankan sebagai catatan historis program A-24.

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Isi dikonsolidasikan
dari `docs/rombak/RISET-DOMAIN.md` (riset workflow minimarket nyata + acuan
Accurate/Odoo, 2026-11-05) dan keadaan sistem terverifikasi di
`docs/TESTING_REPORT.md` (matriks fungsi T7: 61/61 LULUS). Dokumen ini
menjelaskan *bagaimana toko bekerja* dan *bagaimana sistem melayaninya* —
aturan bisnis yang mengikat hidup di `docs/BUSINESS_RULES.md`.

Prinsip lintas siklus (dari literatur SOP ritel): kesalahan minimarket
terkonsentrasi di **pergantian tangan** (shift, terima barang, tutup hari)
dan di **angka yang diketik ulang**. Karena itu sistem dirancang menghapus
pengetikan ulang (scan-first, nominal terisi dari sisa, harga satu sumber)
dan membuat setiap pergantian tangan meninggalkan jejak bernama (sesi per
kasir, dokumen berseri, jurnal tertelusur ke sumbernya).

---

## 1. Siklus A — Hari toko: buka → jual → retur → tutup & rekonsiliasi kas

**Aktor:** kasir (pelaksana), supervisor/pemilik (pengecualian & penutup),
pelanggan.

| Langkah | Alur di Bisa ERP | Penjaga sistem |
|---|---|---|
| 1. Buka sesi kas | Kasir membuka sesi atas namanya dengan modal awal (float); sesi terikat orang, bukan mesin | Modal awal menjadi acuan tutup; sesi terbuka tunggal per kasir |
| 2. Penjualan | Scan/cari produk → keranjang → diskon (bila berhak) → bayar tunai/QRIS/kartu/campuran/utang → kembalian hidup → nota | Harga dari kelompok pelanggan terpilih (pembulatan per aturan grup); diskon manual di atas ambang per perusahaan wajib izin `pos.discount`; stok 0 tidak bisa masuk keranjang |
| 3. Penjualan utang | Porsi utang wajib menangkap pelanggan (pilih/tambah cepat) + tanggal jatuh tempo | Domain menolak piutang tanpa pelanggan & jatuh tempo; `credit_limit` ditegakkan bila > 0; jurnal Dr Piutang (bukan kas); nota mencetak nama & jatuh tempo |
| 4. Kas masuk/keluar non-penjualan | Cash In/Out dari terminal dengan alasan wajib | Setiap gerakan tercatat di sesi & terlihat di ringkasan tutup |
| 5. Retur penjualan | Retur dibuat **dari nota** oleh kasir berizin `pos.return` (template Kasir membawanya sejak A-24) | Plafon per baris terkunci ke qty terjual; penyelesaian refund tunai / tukar barang / kredit toko tercatat; kredit retur ditebus berdasar nomor dokumen retur |
| 6. Void penjualan | Kasir berizin `pos.void` membatalkan dokumen | Dokumen berstatus `void` + jurnal pembalik; stok pulih; kredit retur yang terpakai dikembalikan |
| 7. Tutup sesi | Kasir menghitung uang fisik; sistem menampilkan harapan per metode; selisih tercatat | Selisih berjurnal otomatis (`cash_short`/`cash_over`) dan tidak pernah bisa dihapus. **Catatan jujur:** gerbang tutup terpandu ala register Odoo (penghitung pecahan + ringkasan sebelum tombol aktif) adalah keputusan pemilik yang masih menunggu (SIS-10, RENCANA §3 butir 1) — domain & jurnal selisihnya sudah benar |
| 8. Tinjau pengecualian (pemilik) | Pemilik membaca riwayat sesi & transaksi menyimpang (void, diskon besar, selisih) | Audit log per tindakan bernama pelaku |
| 9. Offline (bila saklar perusahaan aktif) | Terminal tetap menjual saat jaringan/server mati; penjualan mengantre lokal; saat pulih tersinkron per item | Idempotensi per penjualan (kirim ulang = `duplicate`, bukan ganda); konflik harga/stok tertahan di daftar Peninjauan untuk diputuskan manusia; service worker membuka terminal dari cache saat reload pada server mati (konteks aman: localhost/HTTPS). Terbukti T6/T6B — lihat `docs/OFFLINE_POS_ARCHITECTURE.md` |

## 2. Siklus B — Stok: pesan → terima → pajang → opname → kadaluarsa/rusak

**Aktor:** staf gudang/pembeli, pemasok, kasir (penjualan menggerakkan stok),
pemilik (persetujuan & harga).

| Langkah | Alur di Bisa ERP | Penjaga sistem |
|---|---|---|
| 1. Keputusan pesan | Stok mencapai minimum → rekomendasi pembelian (qty saran terlabel jujur) → Purchase Request / Purchase Order per pemasok | PR di atas ambang per perusahaan butuh persetujuan; PO berseri unik; maker-checker PO = keputusan pemilik (belum dibangun) |
| 2. Penerimaan | **Mode Operasi scan-first (T3):** pindai barcode/PO → dokumen terbuka dalam 1 aksi; form menaut PO + nomor faktur pemasok + jumlah rusak per baris; qty tampil Diminta/Terkonfirmasi/Selisih sebelum posting | Tiga sumber dana adalah tiga jurnal berbeda: kredit pemasok (Dr Persediaan/Cr Utang), tunai (Dr Persediaan/Cr Kas-Bank, **tanpa utang**), non-pembelian bersumber alasan (akun lawan ditentukan sumber). Penerimaan sebagian sah: PO tetap terbuka sampai sisa diterima |
| 3. Retur ke pemasok | Retur dari penerimaan asal, alasan berkategori + teks bebas wajib | Plafon nilai = asal-usul dokumen; penyelesaian per retur bisa diganti: ganti barang / potong pembelian berikutnya / refund / cara custom — semuanya terlacak ke klaim Kredit Pemasok (1210) |
| 4. Pajang & rotasi | Penjualan mengambil batch **FEFO** otomatis; daftar kedaluwarsa terdekat sebagai antrean kerja | Blokir jual barang kadaluarsa. Peringatan bertingkat (tanggal peringatan & penarikan ala Odoo) = keputusan pemilik yang masih menunggu |
| 5. Transfer & reservasi | Transfer dua tahap (kirim → in-transit → terima di tujuan, selisih terlihat); reservasi mengurangi stok *tersedia*, bukan stok fisik | Setiap gerakan adalah `stock_movements` append-only berreferensi dokumen |
| 6. Opname | **Hitung buta bertugas (T3):** tugas opname per cakupan (termasuk cycle count terkonfigurasi), kolom sistem tersembunyi sampai peninjauan; selisih ditampilkan bernilai Rp sebelum posting; tugas selesai otomatis saat posting | Posting opname butuh izin; selisih besar menuntut alasan, bukan penyesuaian senyap |
| 7. Penyesuaian stok | Penyesuaian beralasan (kategori terkonfigurasi: rusak/hilang/kedaluwarsa/karantina/dll.) | Nilai Rp dampak tampil **sebelum** posting; di atas ambang per perusahaan wajib disetujui orang lain (maker-checker sempit, D-17) |
| 8. Harga | Harga jual & harga per kelompok pelanggan dari master produk (bulk edit berpratinjau) | Harga satu sumber — rak dan kasir tidak bisa berbeda sumber. Promosi bertanggal = keputusan pemilik (belum dibangun); yang ada: diskon kelompok + diskon manual berambang |

**Invariant siklus ini (terverifikasi T7 dengan SQL mentah):**
`stock_on_hand` = Σ `stock_movements` di semua gudang (0 selisih dua arah);
nilai persediaan = Σ qty × AVCO berjalan; `products.costPrice` adalah AVCO
global per produk.

## 3. Siklus C — Uang: laci → setoran → biaya → utang → piutang

**Aktor:** kasir (laci), pemilik/admin (setoran & biaya), akuntan
(rekonsiliasi & laporan), pemasok, pelanggan kredit.

| Langkah | Alur di Bisa ERP | Penjaga sistem |
|---|---|---|
| 1. Setoran/transfer bank | Satu form transfer antar rekening **dengan field biaya admin** (semua jalur, termasuk Catat Transaksi) | Jurnal: Dr rekening tujuan + Dr beban fee 6060 / Cr rekening asal (nominal + fee); setoran dari sesi kas adalah satu dokumen, bukan dua catatan |
| 2. Biaya operasional | Catat beban ≤3 langkah dari modal Catat Transaksi (tombol **N**) atau halaman Beban; mode **tunai** atau **terutang** dipilih eksplisit | Beban terutang → Cr payable bertag pemasok dan dilunasi lewat mesin utang yang sama (FIFO terbukti campuran); kategori dari daftar akun beban tersaring |
| 3. Utang pemasok | Penerimaan menjadi utang bertempo; antrean "jatuh tempo & terlambat" bernominal di dashboard akuntansi | Pembayaran parsial dengan keputusan sisa eksplisit (sisa / write-off beralasan / kelebihan → kredit pihak); withholding PPh 23/4(2) (bila saklar aktif) dipotong saat membayar → 2130 Utang PPh Dipotong; kelebihan bayar menjadi kredit pemasok yang ditawarkan kembali |
| 4. Piutang pelanggan | Aging dari **tanggal dokumen**; pembayaran FIFO atau per dokumen; kredit pelanggan dari retur penjualan ditebus di penjualan berikut (POS & akuntansi) | Write-off sisa piutang berambang & berizin → 6100 Beban Piutang Tak Tertagih (alasan wajib) |
| 5. Fee metode pembayaran | Tarif fee/MDR per metode (tetap/persen, saklar per metode, **bawaan mati**) dibekukan di baris pembayaran saat transaksi | Selalu beban perusahaan ke 6060 — tidak pernah mengurangi hak pihak; ekspektasi tender sesi kas = neto fee |
| 6. Rekonsiliasi bank | Impor mutasi CSV/tempel: contoh di UI adalah konstanta yang sama dengan yang lolos parser; cocok-otomatis; hasil & error menetap di panel; baris tanpa pasangan bisa menjadi jurnal (termasuk model cepat Biaya admin/Bunga/PPh) | Impor ulang berkas sama tidak menggandakan (sidik jari baris); match/unmatch tidak mengubah jurnal |
| 7. Laporan & tutup | Laporan keuangan dari jurnal terposting yang sama (laba rugi, neraca, arus kas, buku besar, neraca saldo — berkolom pembanding tahun lalu); drill-down laporan → jurnal → dokumen; setiap dokumen non-POS punya **Rincian Jurnal satu-klik** (T4) | Tutup periode bertingkat (terbuka → tutup → kunci) dengan **daftar periksa akhir bulan terpandu** (T4); posting ke periode tertutup/terkunci ditolak `assertPeriodOpen`; tutup buku tahunan nyata |

## 4. Siklus D — Orang: karyawan → shift → presensi → payroll → jurnal

**Aktor:** HR/admin (pengelola), karyawan, akuntan (penerima jurnal),
pemilik (persetujuan).

HR adalah **modul tersendiri** (sejak A-24 T2): pengalih modul, sidebar,
beranda, dan pendaratan peran tersendiri; izinnya tetap `payroll.*`; 33
gerbang aksi keluarga payroll mengikuti saklar modul `hr`. URL tidak
berpindah dari grup akuntansi lama (mekanisme route group) — yang berubah
adalah dunia pengalamannya, bukan alamatnya.

| Langkah | Alur di Bisa ERP | Penjaga sistem |
|---|---|---|
| 1. Master karyawan | Data pribadi/kontak, NIK/NPWP, jabatan, departemen, atasan, status kepegawaian, tanggal masuk, kontrak, PTKP | Riwayat perubahan tercatat otomatis; data gaji tidak terbaca tanpa `payroll.view` (SEC-01 tertutup) |
| 2. Shift & jadwal | Shift kerja + penugasan mingguan per karyawan | Jadwal menjadi acuan penilaian presensi (terlambat/pulang awal) |
| 3. Presensi | Check-in/out (manual/CSV), terlambat, pulang awal, tidak hadir; koreksi hanya berotorisasi | Rekap per periode dari catatan yang sama |
| 4. Cuti & izin | Pengajuan → persetujuan atasan → saldo berkurang | Saldo hanya berkurang sesudah persetujuan; 5 jenis cuti bawaan + jenis kustom per perusahaan |
| 5. Lembur & THR | Lembur menurut aturan bertanggal efektif; draf komponen THR termakan run payroll | Tarif lembur = konfigurasi, bukan angka mati |
| 6. Payroll | Run per periode: gaji pokok + tunjangan + lembur + insentif − potongan − kasbon/pinjaman (ikuti rencana cicilan, dibatasi gaji bersih) | **Semua komponen statutori konfigurasi per perusahaan bertanggal efektif + saklar per komponen (D-25):** PPh 21 TER + hitung ulang Pasal 17 di Desember, BPJS Kesehatan/JHT/JKK/JKM/JP/JKP per program, PTKP. Komponen nonaktif = tidak dihitung, tidak tampil di slip, tidak dijurnal — dibuktikan test. Angka regulasi yang belum terverifikasi (batas JP 2026, TER harian, DTP 2026) **sengaja tidak disemai** |
| 7. Persetujuan & pembayaran | Run disetujui → dibayar dari kas/bank pilihan → slip per karyawan | Jurnal ringkasan Dr beban gaji / Cr kas-bank lewat `postJournal` yang sama dengan semua modul; Rincian Jurnal tersedia dari dokumen payroll |
| 8. Pembatalan | Reverse run mengembalikan jurnal & status persis | Koreksi hanya via reversal — payroll terposting tidak diedit diam-diam |
| 9. Kasbon, pinjaman, klaim | Kasbon (Dr 1220 Piutang Karyawan) dengan rencana potong fleksibel; pinjaman terpisah dari kasbon; klaim reimbursement berpersetujuan memisah PPN Masukan bertarif beku | Potongan masuk run otomatis mengikuti rencana; pelunasan manual di luar payroll didukung |

## 5. Alur lintas modul (kontrak integrasi)

Seluruh integrasi berjalan lewat domain server + `postJournal` — tidak ada
modul menulis tabel modul lain dari lapisan UI, dan tidak ada jurnal kedua
di luar gerbang tunggal:

```
Pembelian → Penerimaan → Stok+ → Utang → Pembayaran → Jurnal (postReceiptJournal → postJournal)
Penjualan POS → Pembayaran → Stok− (FEFO) → HPP → Jurnal → Laba Rugi
Retur penjualan → Stok kembali → Refund/kredit → Jurnal balik (4020)
Retur pembelian → Stok− → Klaim 1210 → Penyelesaian terlacak
Presensi → Rekap → Payroll → Persetujuan → Pembayaran → Jurnal ringkasan
Penyesuaian stok → Mutasi → Dampak nilai (AVCO) → Jurnal
```

Setiap rantai di atas adalah baris matriks `docs/TESTING_REPORT.md` §4–§5
dengan bukti test bernama + bukti manual bertanggal (status akhir: semua
LULUS, invariant jurnal/stok/ringkasan 0 selisih).

## 6. Yang sengaja tidak menjadi workflow (keputusan tercatat)

Bukan kelalaian — keputusan pemilik/Pemimpin yang terdokumentasi, dirujuk
bukan diulang: promosi bertanggal; peringatan kadaluarsa bertingkat; PIN
supervisor POS; tutup sesi terpandu; maker-checker PO; konversi
multi-satuan (D-17); tender kredit pihak di terminal POS; status dokumen
kustom & form builder generik (D-16). Daftar hidup: `docs/rombak/RENCANA.md`
§3 dan `PROGRESS.md` §0D/§0G.
