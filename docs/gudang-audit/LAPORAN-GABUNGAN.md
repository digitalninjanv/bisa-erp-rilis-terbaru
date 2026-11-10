# Audit Gudang — Laporan Gabungan (A-17)

Lanjutan mandat pengguna 2026-11-04 21:30 (sesudah FIX-POS tuntas). Tiga laporan sumber, semua berbukti probe/test yang dijalankan di fixture khusus, demo tidak ditulis:

- `GDG-1-DOMAIN-STOK.md` — 9 temuan (26 probe angka baru: 19 terbukti-benar, 7 terbukti-salah)
- `GDG-2-UIUX-GUDANG.md` — 25 temuan (audit UI/workflow + pengukuran alur)
- `GDG-3-LINTAS-INTEGRASI.md` — 16 temuan cacat + 4 blok terbukti-baik (probe 17/17; kontrol suite lama 97/97)

## Total: 50 temuan — P0: 0 · P1: 8 · P2: 26 · P3: 16

Fondasi yang TERBUKTI kuat: transfer netral nilai; RLS antar perusahaan menahan probe; maker-checker PR menolak self-approve; konkurensi mutasi stok aman; AVCO global dua gudang & hitung-ulang sesudah void benar; invariant Σbatch = on_hand sesudah rangkaian campur; blokir jual kedaluwarsa; seri anti-duplikat & anti-jual-ganda; penyelesaian campuran retur pembelian ΔGL persis; performa inti sehat (kartu stok 137 ms/30 rb mutasi, valuasi 5 rb produk 125 ms — indeks trigram TIDAK diusulkan ulang).

## P1 (8) — dikelompokkan untuk FIX-GDG

**A. Plafon & kepemilikan (uang/stok bocor):**
- GDG1-01 Retur pembelian tanpa plafon asal-usul: pemasok yang hanya pernah menjual 5 unit bisa menerima retur 40 unit → utang terpotong penuh + **Kredit Pemasok fiktif Rp350.000** yang dapat direfund tunai. Tak ada plafon kumulatif per pemasok/produk; `receiptLineId` opsional & tak membatasi.
- GDG3-07 `createReceipt` tidak memvalidasi kepemilikan `warehouseId`/`supplierId` (produk & akun bayar justru divalidasi): penerimaan perusahaan A terposting memakai gudang & pemasok perusahaan B. Penyesuaian/transfer/opname juga tak memvalidasi gudang; hanya reservasi yang benar.
- GDG3-16 Commit impor bersamaan menerapkan stok dua kali (+20 unit/Rp200.000) tetapi jurnal terdedupe idempotensi menjadi satu (+Rp100.000) → **GL vs subledger pecah senyap −Rp100.000 per kejadian**. Job/baris impor tidak dikunci saat commit.

**B. Nilai persediaan menyimpang:**
- GDG1-02 Isi ulang AVCO dari stok negatif mereset biaya: jual 5 dari stok 0 @10.000 (stok negatif diizinkan), terima 10 @20.000 → ledger & GL Rp150.000 tetapi `costPrice` akhir Rp20.000 (seharusnya Rp30.000) → subledger Rp100.000 vs GL Rp150.000, **selisih permanen Rp50.000**. Akar: syarat blend `globalBefore.gt(0)`.

**C. Pekerjaan fisik tak didukung layar (GDG2):**
- GDG2-01 Opname bukan hitung buta: kolom Fisik terisi awal angka sistem & kolom Sistem tampil di sebelahnya; submit langsung posting tanpa draf/lembar hitung/konfirmasi selisih — selisih selalu nol tanpa ada yang menghitung.
- GDG2-02 Penerimaan/opname/penyesuaian/transfer tanpa halaman detail: isi dokumen tak dapat diperiksa dari layar (penerima transfer menekan "Terima" buta).
- GDG2-03 Pemindaian barcode rapuh: debounce 200 ms + Enter mengambil hasil saat itu juga; scanner wedge lebih cepat dari hasil; pindai ulang di opname diabaikan diam-diam (tidak +1).
- GDG2-04 Editor baris buta stok: kolom `stock?` pada tipe baris tak pernah diisi/dirender; penolakan stok kurang baru muncul saat submit.

## P2/P3 ringkas

GDG1-03 void retur pemasok tidak memulihkan nomor seri (stok 3, seri hidup 2); GDG1-04 replacement produk serial masuk tanpa seri (unit tak bisa dijual); GDG1-05 replacement baris ganda mengganti 2× lipat (pola baris duplikat POS1-01 di domain gudang); GDG1-06 = GDG3-14 balapan reservasi (2×8 atas stok 10 → 16 terkunci); GDG1-07 transfer dua tahap tanpa penerimaan sebagian/selisih (barang hilang di jalan tak bisa dicatat); GDG1-08 qty negatif diterima domain transfer; GDG1-09 reservasi tanpa kedaluwarsa mengunci selamanya & tanpa jalur pemenuhan. GDG3-02 periode tertutup hanya membekukan jurnal — mutasi stok tak bernilai/transfer/opname neto-nol bertanggal tertutup tetap bergerak; GDG3-03 rekonsiliasi kontrol persediaan (hasil FIX-R2) memberi selisih palsu untuk tanggal lampau; GDG3-04 faktur pemasok sama diterima 2× → utang ganda tanpa peringatan; GDG3-06 dokumen gudang tanpa kunci idempotensi (submit ganda = dokumen ganda); GDG3-10 ambang persetujuan penyesuaian bawaan null → maker-checker mati secara bawaan (Rp50 jt terposting sendiri); GDG3-11 peran warehouse dapat mengubah harga jual (gerbang hanya `inventory.manage`); GDG3 P3: PO tanpa maker-checker (PR punya), netting selisih opname antar produk, pencarian mutasi 531 ms, tak ada pembatasan gudang per pengguna, laporan stok lambat tak ada. GDG2 sisa: GRN tanpa batch/seri, tak ada surat jalan transfer/lembar hitung opname/label barcode, 42 kontrol h-7, field-classes 0 terpakai, 31 hex lokal, 2 Metric lokal impor, 6 prompt + 8 confirm bawaan browser, 5 daftar tanpa pencarian.

## Rencana FIX-GDG (bertahap)

1. **Tahap 1 — Plafon & kepemilikan:** GDG1-01 (plafon kumulatif retur per pemasok/produk dari penerimaan), GDG3-07 (validasi setenant semua referensi dokumen gudang), GDG3-16 (kunci job impor saat commit), GDG3-15 (sidik berkas impor: impor ulang terdeteksi & ditolak/diperingatkan), GDG3-06 (kunci idempotensi dokumen gudang), GDG3-04 (peringatan/penolakan faktur pemasok duplikat).
2. **Tahap 2 — AVCO, seri, reservasi, transfer:** GDG1-02 (matematika blend dari stok negatif), GDG1-03/04/05 (seri pada void & replacement + akumulasi baris replacement), GDG1-06/GDG3-14 (kunci reservasi), GDG1-07 (penerimaan transfer sebagian + selisih tercatat), GDG1-08/09 (validasi domain + kedaluwarsa bawaan & jalur pemenuhan reservasi), GDG3-02 (kunci periode mencakup mutasi stok), GDG3-03 (rekonsiliasi as-of: nilai dari unitCost mutasi & penanggalan selaras).
3. **Tahap 3 — Izin & kebijakan:** GDG3-10 (ambang persetujuan penyesuaian ber-bawaan hidup, terkonfigurasi per D-25), GDG3-11 (gerbang harga jual terpisah dari inventory.manage), GDG3-P3 PO maker-checker setara PR.
4. **Tahap 4 — UI/UX gudang:** GDG2-01 (opname hitung buta berdraf + lembar hitung + konfirmasi selisih), GDG2-02 (halaman detail 4 dokumen), GDG2-03 (mode pindai), GDG2-04 (editor baris sadar stok), GRN memuat batch/seri + surat jalan transfer, paket konsistensi (h-7→h-8, field-classes, token, dialog ganti prompt/confirm, pencarian daftar).
5. **Tahap 5 — Gerbang final program A-17 Pemimpin** (suite penuh, e2e, reseed, ZIP).
