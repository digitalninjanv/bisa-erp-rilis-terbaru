# Audit POS — Laporan Gabungan (A-17)

Mandat pengguna 2026-11-04 21:30: periksa POS (lalu Gudang) dengan pola yang sama seperti audit akuntansi — cek semuanya, perbaiki, tes ulang, otomatis sampai selesai.

Tiga laporan sumber (semua berbukti probe/test yang dijalankan, fixture khusus, demo tidak disentuh):

- `POS-1-DOMAIN-ANGKA.md` — 13 temuan (probe 18 test: 13 gagal = terbukti-salah, 5 lulus = terbukti-benar)
- `POS-2-UIUX-KASIR.md` — 31 temuan (audit UI/workflow terhadap acuan kasir modern + sistem desain bersama)
- `POS-3-LINTAS-KETAHANAN.md` — 18 temuan (probe offline 7/7, probe RLS langsung sebagai app_user)

## Total: 62 temuan — P0: 0 · P1: 16 · P2: 25 · P3: 21

Fondasi yang TERBUKTI kuat (jangan diutak-atik): RLS 89/89 tabel paksa + probe lintas-tenant 0 baris; idempotensi checkout tahan balapan; kepemilikan sesi ditegakkan; checkout menulis penjualan+stok+jurnal+audit dalam satu transaksi; rekonsiliasi emas split tunai/QRIS/utang + diskon grup + PPN 11% + pembulatan cocok persis di semua kaki; void membalik penerimaan piutang; balapan stok terakhir tepat satu lolos. Klaim penutupan audit POS lama diverifikasi ulang: 61/61 test hijau.

## P1 (16) — dikelompokkan untuk FIX-POS

**A. Uang bocor di domain (POS-1):**
- POS1-01 Retur dibobol baris duplikat dalam satu permintaan: validasi terhadap snapshot sisa tanpa akumulasi baris sepermintaan → refund 160% (Rp80.000 atas penjualan Rp50.000), stok pulih 8 dari 5. **Pemimpin verifikasi langsung di kode: `createSaleReturn` Pass 1 tidak mengakumulasi; penjaga duplikat T3R-1 hanya ada di `quoteCart`.**
- POS1-02 Batas kredit ditembus checkout utang bersamaan (cek SUM tanpa kunci): limit 150 rb, dua checkout 100 rb bersamaan → piutang 200 rb.
- POS1-03 Setoran laci melebihi isi sesi menciptakan uang fiktif berantai: setor 200 rb dari laci 50 rb diterima → tutup sesi menjurnal "kas lebih" +150 rb sebagai pendapatan; penjaga saldo FIX-R2 menilai GL perusahaan, bukan laci sesi.

**B. Offline tidak aman (POS-3 + POS1-04):**
- POS3-01 Antrean > 50 transaksi ditolak utuh oleh batas skema `max(50)` — padam seharian = offline gugur saat paling dibutuhkan (probe 51 item: 0 tercatat).
- POS3-02 Penjualan offline menempel pada penyinkron, bukan kasir asal: payload tanpa identitas kasir/sesi asal; hak diskon, sesi, mutasi kas, dan audit override dinilai atas nama penyinkron.
- POS3-03 Tanpa sesi terbuka milik penyinkron semua item gagal; pemulihan lewat sesi orang lain menghitung kas yang sama dua kali (selisih sesi asal sudah terjurnal, lalu expectedCash sesi kedua menampungnya lagi). Halaman peninjauan tak punya jalur memposting.
- POS1-04/POS3-04 Harga berubah antara antre & sinkron: harga turun → terposting senyap dengan total baru + kembalian fiktif; harga naik → penjualan lunas menggagalkan diri. Payload tak membawa total saat offline.

**C. Izin & kebocoran data (POS-3):**
- POS3-10 Harga pokok bocor ke kasir lewat payload `searchProducts` (costPrice) dan `quoteAction` (unitCost) — hanya digerbang `pos.sell`, UI tak pernah memakainya.
- POS3-11 Kasir dapat membatalkan penerimaan piutang hanya dengan `pos.sell` (`voidReceivablePaymentAction`) — asimetris vs void penjualan yang mensyaratkan `pos.void`.

**D. Layar kasir berbahaya/lambat (POS-2):**
- POS2-01 Tombol Bayar tetap aktif saat quote gagal/basi, bisa bertuliskan "Bayar Rp 0".
- POS2-02 Melanjutkan pesanan ditahan menimpa keranjang aktif tanpa peringatan.
- POS2-03 Penangkap scanner hanya lewat input pencarian & hanya kode numerik ≥6 digit; tak ada penangkap global multi-format.
- POS2-04 Terminal baru dua panel di breakpoint `xl`; layar 1024–1279 px menumpuk tanpa sticky checkout.
- POS2-05 Pembayaran QRIS/bank/e-wallet tanpa konfirmasi penerimaan & tanpa field referensi, padahal domain mendukung referensi.

## P2/P3 ringkas

POS1-05 pembayaran piutang tanpa idempotensi (klik ganda = kas tercatat ganda); POS1-06 refund tunai atas penjualan berkredit pelanggan (kredit non-tunai dicairkan jadi kas laci); POS1-07 `customerId` lintas tenant diterima di jalur lunas; POS1-08..13 enam P3 domain (pesan eror menyesatkan untuk metode tanpa akun & penjualan Rp0, ambang izin diskon dinilai dari bruto, jatuh tempo lampau & tanggal mundur diterima, sesi dibaca tanpa kunci saat checkout). POS3-05/06/17 daftar peninjauan mengganda & basi, kasir dapat membuang jejak peninjauan, tanggal offline vs periode tertutup buntu permanen; POS3 sisa P2/P3 performa & integrasi. POS2 sisa 23 temuan alur/komponen/struk/responsivitas termasuk penyelarasan `h-7` & varian lokal POS terhadap sistem desain bersama.

## Rencana FIX-POS (bertahap, per pemilik berkas)

1. **Tahap 1 — Domain & uang** (POS1-01, 02, 03, 05, 06, 07 + P3 domain yang aman): akumulasi baris retur, kunci batas kredit, penjaga saldo laci sesi, idempotensi pembayaran piutang, refund mengikuti metode asal, validasi pelanggan setenant, pesan eror jujur.
2. **Tahap 2 — Offline & sinkronisasi** (POS3-01, 02, 03, 05, 06, 17 + POS1-04/POS3-04): pengiriman ber-chunk, identitas kasir/sesi asal terbawa & dinilai, jalur posting dari peninjauan tanpa kas ganda, kebijakan harga sinkron berbasis snapshot total offline + selisih terflag, gerbang izin buang antrean, tanggal offline vs periode tertutup.
3. **Tahap 3 — Izin & data** (POS3-10, POS3-11): cabut costPrice/unitCost dari payload kasir, void penerimaan piutang mensyaratkan `pos.void`.
4. **Tahap 4 — UI/UX kasir** (POS2 P1 + P2/P3 terpilih): gerbang tombol Bayar pada quote segar, peringatan timpa keranjang, penangkap scanner global, tata letak terminal & sticky checkout, konfirmasi + referensi pembayaran non-tunai, penyelarasan sistem desain.
5. **Tahap 5 — Gerbang FIX-POS Pemimpin** lalu lanjut Audit Gudang.
