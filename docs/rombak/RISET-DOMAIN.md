# Riset Domain Minimarket & Acuan Akuntansi — Program A-24 (Riset 1)

Tanggal: 2026-11-05. Peneliti: agen riset domain & produk. Berkas ini adalah fondasi domain untuk rencana rombak total (Riset 2 = teknologi/native-offline; Riset 3 = audit fitur menyeluruh; laporan ini TIDAK mengulang keduanya).

**Metode & sumber.** (1) Dokumen repo: `docs/SPEK-FITUR-INTI.md` (termasuk status akhir §7 + addendum SIM-2), `PROGRESS.md` §0A–§0F, riset terdahulu `docs/akuntansi-ux/RISET-ODOO.md` (A-22, 10 pola akuntansi Odoo) dan `docs/ux-sistem/RISET-SISTEM.md` + `UX-AUDIT-SISTEM.md` (A-23, 23 pola + temuan SIS-01..15) — laporan ini membangun di atasnya, bukan menduplikasinya. (2) Web, sumber primer/tepercaya: dokumentasi resmi Odoo 19 (POS workflow, FEFO), pusat bantuan resmi Accurate (`help.accurate.id`), situs resmi Accurate (`accurate.id`), literatur SOP operasional ritel (Taqtics retail SOP & store operations; checklist rutinitas manajer toko Manifestly; blueprint operasi ritel CloudPOS). Koreksi kejujuran sumber ada di akhir berkas — baca sebelum mengutip angka dari laporan ini.

---

## 1. Workflow minimarket nyata, ujung ke ujung

Empat siklus yang benar-benar terjadi di toko setiap hari/minggu. Untuk tiap siklus: aktor, langkah, titik rawan kesalahan manusia (dari literatur SOP ritel & dokumentasi acuan), dan kewajiban kemudahan sistem. Prinsip lintas siklus dari literatur: kesalahan minimarket terkonsentrasi di **pergantian tangan** (shift, terima barang, tutup hari) dan di **angka yang diketik ulang** — sistem yang baik menghapus pengetikan ulang dan membuat setiap pergantian tangan meninggalkan jejak bernama.

### Siklus A — Hari toko: buka → jual → retur/tukar → tutup & rekonsiliasi kas

**Aktor:** kasir (pelaksana), supervisor/pemilik (pengecualian & penutup), pelanggan.

| Langkah | Yang terjadi | Titik rawan kesalahan manusia | Sistem wajib memudahkan |
|---|---|---|---|
| 1. Buka toko & buka sesi kas | Kasir menghitung uang modal (float) di laci, membuka sesi | Float salah hitung → selisih menempel seharian dan dituduhkan ke kasir yang salah; sesi dipakai bersama → pelaku selisih tak terlacak | Hitung pecahan per denominasi di satu layar (pola *Opening Control* Odoo: nominal pembuka + catatan, satu popover), sesi **per kasir** bukan per mesin, nominal pembuka menjadi acuan tutup yang tak bisa diedit diam-diam |
| 2. Cek kesiapan | Scanner/printer/EDC hidup, stok cepat-laku terisi, label harga sesuai | Harga di rak ≠ harga di sistem = konflik di kasir dan kehilangan kepercayaan | Harga satu sumber (master produk); daftar "stok menipis pagi ini" dari data semalam |
| 3. Penjualan | Scan/cari → keranjang → diskon (bila ada) → bayar (tunai/QRIS/kartu/campuran) → kembalian → struk | Salah scan/salah qty; kembalian salah hitung; diskon manual bebas = kebocoran; antrean menekan kasir melewatkan langkah | Scan-first & fokus otomatis (A-23 P2); kembalian **hidup** sebesar tombol Bayar (A-23 P4); diskon di atas ambang berizin (sudah hidup: ambang per perusahaan + izin `pos.discount`) |
| 4. Kas masuk/keluar non-penjualan | Ambil uang untuk beli plastik/kembalian, setor sebagian kas ke brankas/bank di tengah hari (*cash drop*) | Uang keluar tanpa catatan = selisih misterius saat tutup; alasan lupa dicatat | Cash In/Out **wajib beralasan** dari terminal (pola resmi Odoo: pilih jenis → nominal → alasan → konfirmasi; hanya peran berizin); setiap gerakan kas sesi terlihat di ringkasan tutup |
| 5. Retur / tukar barang | Pelanggan kembali dengan nota; barang dicek; refund tunai / tukar barang / kredit toko | Refund tanpa nota = modus fraud klasik; retur melebihi yang dibeli; kasir tidak punya jalur sama sekali sehingga penyelesaian terjadi di luar sistem | Retur **dari nota** (dokumen adalah kuncinya), plafon per baris terkunci, penyelesaian tiga cara tercatat. Keadaan Bisa ERP: domain ✅, jalur peran kasir ❌ (SIS-03) — lihat §2 |
| 6. Tutup sesi & rekonsiliasi | Kasir menghitung uang fisik (boleh per denominasi), sistem membandingkan dengan harapan per metode bayar; selisih dicatat beralasan; setoran akhir | Hitung terburu-buru; selisih "disesuaikan diam-diam"; tutup tanpa konfirmasi (keadaan hari ini: satu klik langsung menutup — SIS-10) | Popover tutup ala Odoo: jumlah order + harapan **per metode bayar** + penghitung pecahan yang mengisi nominal + selisih tampil sebelum tombol tutup aktif; selisih berjurnal otomatis (sudah hidup: `cash_short`/`cash_over`) dan **tidak pernah bisa dihapus**; literatur SOP: selisih di atas ambang wajib verifikasi orang kedua — di sistem: selisih besar wajib alasan tertulis |
| 7. Tinjau pengecualian (pemilik) | Pemilik membaca laporan sesi/Z-report: void, diskon besar, refund tanpa nota, no-sale | Pengecualian tak pernah dibaca = kontrol hanya teori | Satu layar pengecualian harian per toko (daftar transaksi menyimpang), bukan laporan mentah |

### Siklus B — Stok: pesan → terima → pajang → opname → kadaluarsa/rusak → harga & promosi

**Aktor:** staf gudang/pembeli, pemasok, kasir (penjualan menggerakkan stok), pemilik (persetujuan & harga).

| Langkah | Yang terjadi | Titik rawan | Sistem wajib memudahkan |
|---|---|---|---|
| 1. Keputusan pesan | Stok mencapai titik pesan; buat PR/PO ke pemasok | Pesan dari ingatan → kehabisan barang cepat-laku (penyebab hilang penjualan terbanyak menurut literatur replenishment) atau menumpuk barang lambat | Rekomendasi pembelian otomatis dari stok minimum (sudah hidup: qty saran terlabel jujur), PO dibuat dari rekomendasi per pemasok dalam beberapa klik |
| 2. Penerimaan | Barang datang dengan faktur/surat jalan pemasok; hitung fisik vs dokumen; catat batch & tanggal kadaluarsa untuk perishable; barang rusak/selisih dicatat saat itu juga | Terima tanpa cek → selisih qty/harga lolos menjadi stok & utang yang salah; tanggal kadaluarsa tak dicatat → FEFO mustahil dan barang mati di rak; penerimaan tunai tercatat sebagai utang (cacat klasik — sudah ditutup di Bisa ERP lewat penerimaan 3 skenario) | Form penerimaan **menaut PO + nomor faktur pemasok + jumlah rusak per baris** dalam satu layar; selisih terhadap PO terlihat sebelum posting; batch & kadaluarsa wajib untuk produk bertanda lacak-batch; jurnal mengikuti sumber dana (utang/kas/modal), bukan tebakan |
| 3. Pajang & rotasi | Barang ke rak, yang kadaluarsa paling dekat di depan (FEFO fisik) | Rotasi tidak dilakukan → yang baru terjual, yang lama kadaluarsa | Daftar "kadaluarsa terdekat" per gudang sebagai antrean kerja; strategi FEFO saat penjualan sudah hidup di Bisa ERP (D-7) — sempurnakan dengan tanggal **peringatan** & **penarikan** ala Odoo (lihat §3) |
| 4. Opname | Hitung berkala: siklus per kategori (cepat-laku lebih sering) + opname total berkala | Opname tidak buta = angka sistem disalin, selisih tak pernah ketahuan; selisih langsung disesuaikan tanpa penyelidikan (literatur: cek dulu salah terima, salah scan, salah label) | Opname **hitung buta bertugas** (sudah hidup: kolom sistem tersembunyi + tinjau selisih bernilai Rp sebelum posting); antrean selisih besar menuntut alasan, bukan penyesuaian senyap |
| 5. Kadaluarsa & rusak | Barang ditarik sebelum tanggal tarik; dicatat keluar beralasan (rusak/hilang/kedaluwarsa/karantina); yang masih bisa: retur ke pemasok | Barang kadaluarsa tetap di rak (risiko kesehatan & reputasi); penarikan tak tercatat → stok hantu | Daftar penarikan dari tanggal kadaluarsa; pengeluaran beralasan satu alur dengan pilihan lanjutannya (buang / karantina / retur pemasok 4 cara penyelesaian — sudah hidup) |
| 6. Perubahan harga & promosi | Harga beli berubah → harga jual ditinjau; promosi berjalan pada tanggalnya lalu berakhir | Label rak tidak diganti → harga rak ≠ kasir; promo lupa dimatikan → margin bocor diam-diam; promo tumpang tindih | Perubahan harga dari satu tempat dengan tanggal efektif; promosi **bertanggal mulai–berakhir** sehingga harga kembali sendiri (keadaan Bisa ERP: harga per kelompok pelanggan ✅; promosi bertanggal ❌ — lihat §2) |

### Siklus C — Uang: laci → setoran → biaya → utang pemasok → piutang pelanggan

**Aktor:** kasir (laci), pemilik/admin (setoran & biaya), akuntan (rekonsiliasi & laporan), pemasok, pelanggan kredit.

| Langkah | Yang terjadi | Titik rawan | Sistem wajib memudahkan |
|---|---|---|---|
| 1. Kas laci berputar | Float → penjualan → cash drop → tutup (Siklus A) | Lihat Siklus A langkah 1/4/6 | — |
| 2. Setoran ke bank | Uang tunai disetor; biaya admin bank muncul | Setoran tercatat dua kali (di sesi & di jurnal manual) atau tak tercatat; **biaya admin transfer tak bisa diinput dari jalur cepat** (keluhan nyata pengguna yang menutup A-21) | Transfer antar rekening satu form dengan field biaya (sudah hidup & diseragamkan A-21); setoran dari sesi adalah satu dokumen, bukan dua catatan |
| 3. Biaya operasional harian | Listrik, plastik, transport, ATK — tunai dari laci/kas kecil atau terutang ke pemasok | Bukti hilang; biaya dicatat belakangan dari ingatan dengan tanggal salah; kategori bebas → laporan tak terbaca | Catat beban ≤3 langkah dari mana pun (sudah hidup: modal Catat Transaksi), kategori dari daftar akun beban tersaring, mode tunai/terutang eksplisit |
| 4. Utang pemasok | Faktur penerimaan menjadi utang bertempo; dibayar sebagian/penuh saat jatuh tempo | Bayar tanpa melihat aging → bayar dobel / bayar yang belum tempo sementara yang tempo telat; kelebihan bayar hilang | Antrean "utang jatuh tempo & terlambat" bernominal (sudah hidup di dashboard akuntansi A-22); pembayaran parsial dengan keputusan sisa eksplisit; kelebihan bayar menjadi kredit pemasok yang ditawarkan kembali (sudah hidup A-21) |
| 5. Piutang pelanggan (bila toko memberi kredit) | Penjualan utang ke pelanggan/langganan; ditagih berkala | Piutang tak tertagih tak terlihat sampai besar; terima bayar tanpa alokasi dokumen | Aging piutang dari tanggal dokumen; pembayaran FIFO atau per dokumen; kredit pelanggan dari retur bisa ditebus di penjualan berikutnya |
| 6. Rekonsiliasi bank | Mutasi rekening dicocokkan dengan jurnal | Menebak format impor; selisih menumpuk berbulan-bulan | Impor dengan contoh yang lolos parsernya sendiri + hasil menetap di panel (sudah diperbaiki A-22 K3); antrean belum-cocok sebagai daftar utama |

### Siklus D — Orang: shift, pergantian kasir, override supervisor, banyak peran satu toko

**Aktor:** kasir, kasir pengganti, supervisor/pemilik, staf gudang, akuntan — sering orang yang sama berganti topi dalam sehari di minimarket kecil.

| Langkah | Yang terjadi | Titik rawan | Sistem wajib memudahkan |
|---|---|---|---|
| 1. Mulai shift | Kasir login dengan akunnya sendiri, membuka sesi atas namanya | Akun dipakai bersama ("login pemilik" dipakai semua orang) → semua jejak audit tak berarti | Login cepat per orang; sesi terikat orang; beralih pengguna tidak mengharuskan menutup aplikasi |
| 2. Pergantian kasir di tengah hari | Kasir A selesai, kasir B mulai — di mesin yang sama | Laci diteruskan tanpa hitung serah-terima → selisih jadi sengketa | Pergantian = tutup sesi A (hitung fisik) + buka sesi B dalam alur terpandu; tidak ada penjualan di antara dua sesi aktif yang kabur pemiliknya |
| 3. Override supervisor | Diskon besar, void sesudah bayar, refund tanpa nota, buka laci tanpa penjualan | Override tanpa jejak = lubang fraud terbesar di ritel; sebaliknya semua hal kecil butuh supervisor = antrean berhenti | Tindakan berisiko berpagar **izin** dan tercatat audit dengan pelaku + alasan (sudah hidup untuk diskon: ambang + izin `pos.discount`); otorisasi PIN supervisor adalah **keputusan pemilik yang masih menunggu** (POS3-12, sejak D-10) — jangan dibangun setengah-setengah |
| 4. Pemilik memantau tanpa hadir | Cek penjualan hari ini, selisih kas, stok menipis, utang tempo dari ponsel | Harus membuka 5 laporan untuk 4 pertanyaan | Beranda per peran berisi antrean & angka perannya saja (pola A-22 K5 untuk akuntansi; A-23 untuk shell) |
| 5. Kasir/staf baru belajar | Orang baru menghadapi sistem pertama kali | Istilah akuntansi di permukaan operasional menakutkan; kesalahan awal mahal | Istilah pekerjaan pengguna di permukaan operasional ("Terima barang", "Tutup sesi"), istilah akuntansi hanya di modul akuntansi; keadaan kosong menunjuk aksi pertama (pola riset A-22 no. 8) |

---

## 2. Fitur terpenting minimarket — prioritas & keadaan Bisa ERP hari ini

Pemetaan berbasis **dokumen** (`SPEK-FITUR-INTI.md` §7 + addendum SIM-2, `PROGRESS.md` §0A–§0F, audit A-23 `UX-AUDIT-SISTEM.md`), per 2026-11-05 — bukan pengujian ulang kode (itu pekerjaan Riset 3). Status: ✅ **ada & berfungsi** = terdokumentasi lulus gerbang program terkait · 🟡 **ada tapi perlu dibuktikan/dijangkau** = domain ada, bukti atau jalur penggunanya belum tuntas · ❌ **belum ada** = tertulis belum/tidak dibangun di dokumen.

### Wajib inti — toko tidak bisa beroperasi tanpanya

| # | Fitur | Status | Bukti / catatan dokumen |
|---|---|---|---|
| 1 | Penjualan POS scan/cari, keranjang, qty, harga per kelompok pelanggan | ✅ | SPEK §7; FIX-POS A-17 (suite 1072→1137) |
| 2 | Pembayaran multi-metode (tunai/QRIS/transfer/debit) + split + kembalian | ✅ | SPEK §7 Tahap 4; metode terhubung akun penampung, dapat dikonfigurasi |
| 3 | Sesi kasir: buka (float) → kas masuk/keluar beralasan → tutup dengan hitung fisik & selisih berjurnal | ✅ domain; 🟡 gerbang tutup | Selisih `cash_short/cash_over` ✅; audit A-23 SIS-10: tutup sesi **satu klik tanpa konfirmasi/selisih akhir** — UX gerbangnya perlu diperbaiki, bukan domainnya |
| 4 | Retur penjualan dari nota: refund / tukar / kredit toko, plafon per baris | ✅ domain; 🟡 jalur peran | Domain & jurnal ✅ (D-8, D-12 penebusan kredit); audit SIS-03 (P1): **kasir tidak punya jalur sama sekali** (menu absen, URL error) — peran pelaksana hariannya tidak menjangkau fitur yang ada |
| 5 | Master produk: SKU, barcode, kategori (bertingkat), satuan, harga jual & harga per kelompok | ✅ | SPEK §7; kategori bertingkat & bulk edit berpreview (SIM-2 S3) |
| 6 | Penerimaan barang 3 skenario (kredit pemasok / tunai tanpa utang / non-pembelian bersumber alasan) + cetak GRN + no. faktur pemasok & jumlah rusak per baris | ✅ | Batch G6 (SPEK §7) — menutup gap inti spek pengguna |
| 7 | Purchase Order + penerimaan terhadap PO (sebagian/penuh, status) + rekomendasi pembelian dari stok minimum | ✅ | Batch G7 (D-6); maker-checker PO = keputusan pemilik menunggu |
| 8 | Stok real-time per gudang, kartu stok, stok minimum & peringatan menipis | ✅ | SPEK §7; definisi menipis kanonis D-4 |
| 9 | Opname hitung buta + penyesuaian beralasan, berizin, maker-checker di atas ambang | ✅ | FIX-GDG A-17; ambang persetujuan per perusahaan (D-17) |
| 10 | Batch & tanggal kadaluarsa, penjualan FEFO, blokir jual barang kadaluarsa | ✅ | Batch G8 (D-7); tanggal *peringatan/penarikan* ala Odoo (lihat §3) belum disebut dokumen → bagian dari ❌ di baris 24 |
| 11 | Jurnal otomatis dari semua transaksi operasional lewat pemetaan akun; jurnal terposting append-only, koreksi via reversal | ✅ | Arsitektur inti sejak Tahap 1; gerbang jurnal tunggal terverifikasi A-18/A-20 |
| 12 | Input nominal uang berformat ribuan yang **benar saat diketik** | 🟡 cacat P1 terbukti, perbaikan berjalan | Audit SIS-01: MoneyInput merusak nominal ≥5 digit yang diketik digit-per-digit (contoh terukur: ketik 1500000 → terbaca 1,5; pratinjau Rp 2). Perbaikan dimandatkan sebagai pekerjaan pertama A-23 S1; status final menunggu gerbang program itu — **jangan dianggap selesai dari laporan ini** |
| 13 | Kas & bank: transfer + biaya admin, mutasi, rekonsiliasi impor mutasi | ✅ | A-21 (fee semua jalur) + A-22 K3 (impor jujur, antrean cocok) |
| 14 | Utang & piutang: aging dari tanggal dokumen, bayar parsial/penuh/FIFO, kelebihan bayar → kredit pihak, write-off berambang berizin | ✅ | Tahap 1 + A-21 R3-B/R3-A (migrasi 0050–0053) |
| 15 | Laporan inti: laba rugi, neraca, arus kas, buku besar, neraca saldo — dengan pembanding periode lalu & drill-down ke dokumen | ✅ | FIX-R2 A-16; komponen laporan bersama A-22 |
| 16 | Peran & izin per modul: kasir hanya POS, gudang hanya gudang, akuntan hanya akuntansi; penolakan rapi | 🟡 ditegakkan di program berjalan | Audit SIS-02 (P1: peran Kasir bawaan mencakup Gudang hampir penuh, termasuk harga pokok) & SIS-04/06 (penolakan tampil sebagai *crash*; beranda membocorkan statistik keuangan). Pengetatan dimandatkan di A-23 S1 — status final menunggu gerbangnya |
| 17 | Cetak nota & dokumen operasional (thermal 58/80, A5/A4) + template logo/warna/font/QR/tanda tangan | ✅ | Print Engine Tahap 4 (D-13); batas jujur: satu template aktif per perusahaan, bukan banyak template per dokumen |
| 18 | Tutup periode bertingkat & tutup buku tahunan nyata | ✅ | Tahap 1 + FIX-P1 Tahap 5 (migrasi 0041) |

### Penting — membedakan sistem yang "jalan" dari sistem yang enak dipakai setiap hari

| # | Fitur | Status | Catatan |
|---|---|---|---|
| 19 | POS offline: tetap menjual saat internet/server mati, sinkron idempoten saat pulih | 🟡 **ada tapi belum terbukti** | Dibangun SIM-2 (IndexedDB + tabel `outbox` + daftar konflik, saklar per perusahaan, D-24); status resmi **PARTIAL — uji browser offline sungguhan NOT TESTED**. Untuk mandat "POS native lokal" pengguna (2026-11-05 21:50), ini baris paling kritis di daftar ini: mesinnya ada, buktinya belum |
| 20 | Dasbor antrean kerja per peran (yang menunggu saya, bernominal, satu klik ke antreannya) | ✅ akuntansi; 🟡 modul lain | A-22 K5 untuk akuntansi; beranda sadar peran = pekerjaan A-23 |
| 21 | Transfer stok antar gudang dua tahap (in-transit) + reservasi stok | ✅ | SIM-2 S7B-2 (migrasi 0038), bersaklar per perusahaan |
| 22 | Retur ke pemasok dengan 4 penyelesaian (ganti barang / potong pembelian berikut / refund / kredit pemasok) | ✅ | A-9 (D-20) + penyelesaian per retur SIM-2 |
| 23 | Impor/ekspor master & awal: produk, pemasok, pelanggan, akun, stok awal, saldo awal utang/piutang — berpratinjau & bervalidasi | ✅ | Tahap 4 (D-14); edit baris impor di tempat ❌ (keputusan: unggah ulang) |
| 24 | Peringatan kadaluarsa bertingkat (tanggal peringatan & penarikan sebelum kadaluarsa, ala Odoo) | ❌ | Dokumen hanya menyebut tanggal kadaluarsa + FEFO; daftar "segera tarik" belum menjadi antrean kerja |
| 25 | Promosi bertanggal (harga promo mulai & berakhir otomatis) + riwayat perubahan harga | ❌ | Yang ada: diskon manual berambang, diskon per kelompok, harga khusus kelompok. Promosi terjadwal tidak disebut di SPEK/PROGRESS |
| 26 | HR operasional toko: data karyawan, shift & absensi, cuti, lembur, kasbon, pinjaman, reimbursement berpersetujuan | ✅ | SIM-2 S7B-1 (migrasi 0033–0037) |
| 27 | Payroll Indonesia: PPh 21 TER + hitung ulang Pasal 17, BPJS per program — semua konfigurasi bertanggal efektif + saklar per komponen (D-25), slip gaji | ✅ dengan batas jujur | SIM-2 S2; batas JP 2026, TER harian, status DTP **sengaja belum disemai** (belum terverifikasi) — bukan cacat, keputusan kehati-hatian tercatat |
| 28 | Aset tetap & penyusutan garis lurus terikat GL | ✅ | SIM-2 S7B-2 |
| 29 | Pencarian global / command palette lintas modul (Ctrl+K) | ❌ | Audit SIS-12 (P3); pola riset A-23 S4 — indeks wajib tersaring peran |
| 30 | Laporan stok analitis: aging stok, barang mati / lambat / cepat bergerak | ❌ | Tertulis eksplisit "tetap belum" di addendum SIM-2 |
| 31 | Saldo awal & migrasi awal yang terpandu (setup perusahaan baru: akun → saldo awal → stok awal → siap jual) | 🟡 | Bahan-bahannya ✅ (impor saldo awal, stok awal, kartu langkah awal akuntansi A-22); alur setup satu rangkaian terpandu belum terdokumentasi sebagai satu fitur |

### Pelengkap — nilai tambah, bukan penentu operasional

| # | Fitur | Status | Catatan |
|---|---|---|---|
| 32 | Anggaran vs realisasi (budget vs actual) | ❌ | Tertulis belum di addendum SIM-2 |
| 33 | Laporan pajak & SPT / e-Faktur / e-Bupot | ❌ | Kompensasi PPN akhir masa & SPT manual (batas jujur A-15); withholding PPh 23/4(2) saat membayar ✅ (A-21) tetapi bukan pelaporan pajak |
| 34 | Petty cash khusus dengan pengisian kembali (imprest) | ❌ | Tertulis belum di addendum SIM-2; kas kecil bisa dimodelkan sebagai akun kas biasa |
| 35 | Produk: varian, multi-barcode, brand, banding harga pemasok | ❌ | Tertulis belum di addendum SIM-2 |
| 36 | Konversi multi-satuan (beli karton, jual ecer) | ❌ tidak dibangun | Keputusan D-17 (mengubah matematika semua jalur); untuk minimarket ini kebutuhan nyata — masuk daftar keputusan pemilik §5 |
| 37 | Program loyalitas & poin pelanggan; integrasi marketplace/e-commerce | ❌ | Tidak disebut di dokumen mana pun |
| 38 | Barcode timbangan (produk timbang dengan harga tertanam di barcode) | ❌ | Tidak disebut di dokumen mana pun; relevan untuk minimarket berjualan sayur/daging timbang |
| 39 | Slip gaji mandiri karyawan (ESS), payroll mingguan, pesangon otomatis | ❌ | Tertulis belum di addendum SIM-2 |
| 40 | Custom fields produk & pihak; saklar modul per perusahaan | ✅ | Tahap 5 (D-16); status kustom & form builder generik ❌ **sengaja tidak dibangun** — status dokumen adalah penjaga integritas (prinsip spek pengguna sendiri) |

**Kesimpulan §2 untuk perencanaan:** fondasi transaksi Bisa ERP pada dasarnya lengkap dan teruji (baris ✅ mendominasi daftar wajib). Yang menentukan keberhasilan rombak **bukan** menambah fitur, melainkan menutup empat kelas celah yang terbukti: (i) fitur ada tetapi peran pelaksananya tidak menjangkau (retur kasir, visibilitas peran); (ii) gerbang tindakan konsekuensial yang terlalu longgar (tutup sesi satu klik); (iii) input yang merusak angka pada pemakaian manusiawi biasa (SIS-01); (iv) fitur yang mesinnya ada tetapi buktinya belum ada (offline POS) — plus dua kekosongan domain nyata untuk minimarket: promosi bertanggal dan peringatan kadaluarsa bertingkat.

---

## 3. Acuan desain akuntansi: Accurate (resmi) + tambahan Odoo di luar riset A-22

### 3.1 Accurate Online — pola yang membuatnya terasa mudah (sumber: `help.accurate.id` & `accurate.id` resmi)

Accurate adalah acuan paling relevan untuk pengguna Indonesia: bukan karena fiturnya terbanyak, tetapi karena **bahasa dan bentuk layarnya adalah bahasa pekerjaan pengguna Indonesia**. Pola terverifikasi dari dokumentasi bantuan resminya:

1. **Dashboard sebagai speedometer, bukan laporan.** Halaman pertama sesudah login menyajikan panel-panel pantau — aktivitas terakhir, arus kas, grafik penjualan, penjualan per hari (total, jumlah transaksi, jumlah barang) — sehingga pertanyaan harian ("hari ini bagaimana?") terjawab tanpa membuka satu pun laporan. *Terapan:* Bisa ERP sudah bergerak ke sini (dashboard antrean kerja A-22 K5 untuk akuntansi; beranda peran A-23) — jadikan pola ini konsisten: setiap peran membuka hari pada layar "keadaan + antrean", bukan pada menu.
2. **Modul dinamai jenis transaksinya, dokumen mengikuti alur bisnis.** Penjualan mengalir Penawaran → Pesanan → Pengiriman → Faktur → Penerimaan; Pembelian mengalir Permintaan → Pesanan → Penerimaan → Faktur → Pembayaran. Pengguna memikirkan *pekerjaannya*, bukan akunnya. *Terapan:* pertahankan & pertegas penamaan dokumen Bisa ERP yang sudah mengikuti alur (PO → Penerimaan → Utang → Pembayaran); audit istilah teknis yang masih bocor ke permukaan operasional masuk daftar perbaikan.
3. **"Rincian Jurnal" dari setiap transaksi.** Di Accurate, jurnal otomatis yang terbentuk dari faktur/retur/penerimaan apa pun dapat dibuka dari menu titik-tiga dokumen itu sendiri — pengguna memverifikasi akibat akuntansi **tanpa meninggalkan dokumen dan tanpa membuka Jurnal Umum**. Ini pola kepercayaan terpenting akuntansi otomatis: jurnal tidak pernah terasa seperti kotak hitam. *Terapan:* Bisa ERP sudah punya pratinjau jurnal di jalur cepat (pratinjau == posting, A-12/A-21) dan drill-down laporan → jurnal → dokumen (kekuatan terverifikasi A-22). Yang belum menjadi **pola wajib**: setiap dokumen terposting (penerimaan, penjualan, pembayaran, retur, penyesuaian) punya aksi "Lihat jurnal" satu klik dari halamannya. Jadikan itu kriteria penerimaan rombak.
4. **Pemetaan akun diatur sekali, dalam bahasa transaksi.** Accurate menaruhnya di Preferensi → tab Akun: daftar akun perkiraan per keperluan ("Penjualan", "Pembelian Belum Tertagih", "Akun Diskon", "Akun Pembulatan") yang kemudian dipakai jurnal otomatis semua modul. *Terapan:* arsitektur Bisa ERP identik (pemetaan akun sebagai Configuration Engine) — yang diadopsi adalah **penyajiannya**: halaman pemetaan dikelompokkan & dilabeli per jenis transaksi dengan penjelasan satu baris per kunci, bukan daftar kunci teknis; pemetaan kosong menunjuk persis ke pengaturan ini (pola yang sudah dipakai retur POS D-8: tolak dengan pesan mengatur pemetaan dulu).
5. **Pajak muncul di dalam form, pada momen yang benar.** Pada pembelian jasa kena PPh 23, nilai potongan tampil otomatis di faktur, nomor bukti potong diinput saat pembayaran, dan jurnal potongan terbentuk **saat pembayaran** (bukan saat faktur) — persis semantik yang benar, disajikan tanpa pengguna memikirkan jurnalnya. *Terapan:* pola ini sudah diadopsi A-21 (withholding: nominal putusan pengguna, jurnal saat membayar, saklar per perusahaan bawaan mati per D-25); pekerjaan rombak adalah konsistensi penyajian (label, urutan field, penjelasan) di semua form pembayaran.
6. **Proses Akhir Bulan sebagai satu fitur terpandu.** Accurate menggabungkan penyesuaian rutin bulanan (penyusutan aset, selisih kurs, dll.) ke dalam satu "Proses Akhir Bulan" yang jurnalnya dapat ditinjau di Jurnal Umum. *Terapan:* Bisa ERP punya tutup periode bertingkat + tutup buku tahunan + penyusutan aset; pertimbangkan menyajikannya sebagai satu daftar periksa akhir bulan terpandu (langkah → status → jurnal hasil) di atas mesin yang sudah ada — penyajian, bukan mesin baru.
7. **Laporan standar Indonesia, real-time, dari jurnal yang sama.** Laba rugi/neraca/arus kas mengikuti format yang dikenal pengguna Indonesia dan selalu terbentuk dari jurnal terposting — tidak ada "laporan versi lain". *Terapan:* sudah menjadi keadaan Bisa ERP (FIX-R2: format kurung akuntansi, pembanding tahun lalu, kop ber-NPWP); jangan diganggu di rombak selain konsistensi komponen.
8. **Istilah Indonesia penuh & panduan di dalam produk.** Seluruh bantuan resmi Accurate berbahasa Indonesia dengan langkah bernomor per tugas. *Terapan:* teks bantuan kontekstual di titik rawan (tutup sesi, penerimaan, opname) mengikuti pola langkah-bernomor, bukan paragraf.

### 3.2 Tambahan Odoo (dokumentasi resmi 19) yang belum tercakup riset A-22/A-23

Riset A-22 mencakup pola layar akuntansi Odoo; riset A-23 mencakup pola terminal POS & operasi gudang. Yang berikut adalah **mekanisme domain** dari dokumentasi resmi Odoo 19 yang belum tertulis di kedua riset itu:

1. **Kontrol buka/tutup register sebagai popover terstruktur** (dok. resmi POS *Workflow*): buka = verifikasi nominal pembuka di *Opening Control*; tutup = *Closing Register* menampilkan jumlah order + **harapan per metode bayar**, dengan penghitung koin/lembaran yang menghitung nominal untuk pengguna, *clone* untuk menyalin harapan ke hitungan, dan catatan penutup; Odoo secara eksplisit menyarankan register ditutup setiap akhir hari. *Terapan:* cetak biru gerbang tutup sesi baru untuk menutup SIS-10 (Siklus A langkah 6).
2. **Cash In/Out berpagar hak akses** — dokumentasi resmi menyebut hanya karyawan berhak yang boleh melakukan kas masuk/keluar; setiap gerakan wajib alasan dan tercatat di log register harian yang terbaca saat tutup. *Terapan:* selaraskan izin gerakan kas sesi Bisa ERP dengan pola ini (alasan sudah wajib; tampilkan log gerakan di ringkasan tutup).
3. **Empat tanggal per batch** (dok. resmi *FEFO removal*): tanggal kadaluarsa, *best before*, **tanggal penarikan** (hari sebelum kadaluarsa, dapat dikonfigurasi per produk — barang harus sudah keluar rak pada tanggal ini), dan **tanggal peringatan**; strategi FEFO diatur per lokasi/kategori; laporan stok dapat menampilkan kolom kadaluarsa & penarikan per lot. *Terapan:* menutup baris 24 di §2 — model data Bisa ERP sudah punya batch + kadaluarsa (D-7), tambahan tanggal penarikan/peringatan adalah perluasan kecil dengan nilai operasional besar untuk perishable.
4. **Penegasan urutan dokumen sebagai bahasa status** — status dokumen Odoo (Draf → Terkonfirmasi → Selesai) menjadi bahasa visual yang sama di semua modul. *Terapan:* sudah sebagian hidup (lencana status bersama A-22); jadikan kosakata status satu daftar tertutup lintas modul di rombak.

### 3.3 Yang TIDAK diadopsi dari acuan (sadar, tercatat)

- **Kecerdasan buatan & integrasi marketplace Accurate** (Ailita, SmartLink e-Commerce): di luar kebutuhan inti minimarket satu toko dan di luar bukti kebutuhan pengguna; bukan penentu operasional.
- **Multi mata uang**: minimarket pengguna beroperasi rupiah tunggal (R3-16 A-21 mencatat mata uang tunggal sebagai cakupan, bukan cacat).
- **Struktur modul Accurate yang sangat dalam** (penawaran, tukar faktur, dsb.): alur dagang B2B yang tidak terjadi di konter minimarket; alur Bisa ERP yang lebih pendek adalah keunggulan, bukan kekurangan.

---

## 4. Prinsip desain rombak total — kriteria penerimaan rencana

Sintesis dari riset A-22 (10 pola akuntansi), riset A-23 (23 pola sistem + 15 temuan audit SIS), riset domain ini, prinsip tertulis pengguna di `SPEK-FITUR-INTI.md`, dan pelajaran gerbang program-program sebelumnya (PROGRESS §0A–§0F). Setiap prinsip ditulis sebagai **kriteria yang bisa diperiksa**, bukan slogan: rencana tahap yang melanggarnya harus menyebut alasannya secara tertulis atau ditolak.

**Komponen & pola**
1. **Satu komponen per konsep, di semua modul.** Satu-satunya field uang adalah `MoneyInput`; satu-satunya lencana status, kartu statistik, dialog konfirmasi, keadaan kosong, bilah filter. Menemukan komponen kedua untuk konsep yang sama = temuan yang harus ditutup tahap itu juga.
2. **Satu pola per jenis layar.** Daftar (chip status + pencarian + aksi massal seperlunya), form dokumen (baris sebaris + total berjalan + gerbang sebelum posting), dialog pembayaran (dari dokumen, nominal terisi sisa, keputusan sisa eksplisit), laporan (hierarki + pembanding + drill-down). Halaman baru wajib menunjuk pola yang diikuti.
3. **Satu bahasa status & satu bahasa uang.** Kosakata status dokumen adalah daftar tertutup lintas modul; format tampil uang = format yang diterima input, satuan selalu jelas.

**Kebenaran angka & input**
4. **Ketikan manusiawi tidak boleh merusak angka.** Setiap field angka terformat diuji dengan urutan ketukan digit-per-digit (bukan hanya pengisian sekaligus) — pelajaran SIS-01: cacat terburuk program ini lolos bertahun-tahun karena pengujian tidak mengetik seperti manusia.
5. **Setiap angka bisa ditelusur ke sumbernya dalam ≤2 klik** (laporan → jurnal → dokumen; dokumen → "Lihat jurnal"). Angka tanpa sumber yang bisa dibuka tidak boleh tampil.
6. **Dokumen terposting tidak diedit/dihapus diam-diam** — koreksi hanya void, reversal, atau dokumen penyesuaian tercatat (prinsip spek pengguna; tidak bisa ditawar oleh kemudahan UI).

**Workflow & peran**
7. **Workflow inti punya hitungan langkah acuan** (diukur di audit A-22/A-23 dan §1 laporan ini). Rombak tidak boleh menambah langkah workflow inti tanpa alasan tertulis; targetnya mengurangi atau mempertahankan sambil menutup celah kontrol.
8. **Peran menentukan dunia pengguna.** Sesudah login, pengguna mendarat di pekerjaan perannya; menu tersaring izin (kerapian) **dan** aksi ditolak di server (keamanan) — dua lapis yang tidak dicampur; penolakan selalu tampil sebagai penjelasan, tidak pernah sebagai halaman rusak.
9. **Tindakan konsekuensial digerbang sebanding risikonya.** Tutup sesi, posting dokumen stok/uang, void, diskon di atas ambang: ringkasan akibat tampil **sebelum** tombol akhir aktif; tindakan kecil harian tetap satu-dua ketuk. Gerbang ≠ menghalangi — gerbang = memperlihatkan.
10. **Istilah permukaan = istilah pekerjaan penggunanya.** Operasional berbahasa toko ("Terima barang", "Tutup sesi", "Uang fisik"); istilah akuntansi hanya di dalam modul akuntansi; istilah teknis sistem (nama tabel, kunci pemetaan) tidak pernah tampil mentah.

**Konfigurasi & arsitektur**
11. **Konfigurasi, bukan kode** (perluasan D-25): tarif, ambang, termin, penomoran, pemetaan akun, kategori awal, saklar fitur — per perusahaan, bertanggal efektif untuk angka regulasi, dan komponen nonaktif berarti tidak dihitung, tidak tampil, tidak dijurnal (dibuktikan test).
12. **Rombak tampilan tidak menembus domain sembarangan.** Ikuti aturan jalur baca yang sudah tertulis (halaman hanya memanggil fungsi baca modul server atau kueri satu tabel sah — ratchet `architecture-read-paths`); modul tetap folder per domain di atas core bersama; perubahan UI yang membutuhkan perubahan domain dinyatakan sebagai tahap domain tersendiri, bukan diselipkan.
13. **Kecepatan adalah fitur yang terukur.** Muat halaman operasional terukur pada data demo (audit A-23: <±550 ms lokal); skeleton meniru tata letak di semua modul; pencarian daftar operasional hidup tanpa tombol Cari.

**Bukti**
14. **Selesai = terbukti, bukan terasa.** Setiap tahap ditutup gerbang yang dijalankan ulang pemimpin: suite + e2e hijau, tangkapan sebelum/sesudah pada lebar acuan (1440/768/390, POS juga 1100), pengukuran ulang workflow yang disentuh, dan nol overflow terukur. Fitur yang belum terbukti di lingkungan nyatanya (mis. offline di browser sungguhan) berlabel NOT TESTED secara tertulis — tidak pernah disajikan sebagai berfungsi.

---

## 5. Keputusan yang hanya pemilik bisa jawab

Dikumpulkan agar tidak ditanyakan satu-satu; tidak satu pun dieksekusi dari laporan ini:

1. **PIN supervisor POS** (menunggu sejak D-10 / POS3-12): apakah override diskon besar, void, dan refund tanpa nota cukup berpagar izin peran + audit, atau wajib PIN supervisor per tindakan? Bila wajib: siapa pemegangnya & apakah PIN per orang atau per toko?
2. **Maker-checker Purchase Order** (GDG3-P3): PO di atas nilai tertentu wajib disetujui orang lain sebelum bisa diterima barangnya?
3. **Promosi bertanggal** (baris 25): dibangun sebagai fitur (harga promo mulai/berakhir otomatis per produk/kategori), atau cukup diskon kelompok + diskon manual berambang seperti sekarang?
4. **Tanggal penarikan & peringatan kadaluarsa** (baris 24, pola Odoo §3.2.3): perluas model batch dengan dua tanggal ini, atau cukup kadaluarsa + daftar "30 hari menuju kadaluarsa"?
5. **Konversi multi-satuan** (D-17, baris 36): minimarket membeli per karton dan menjual ecer — apakah kebutuhan ini cukup nyata untuk membuka kembali keputusan tidak-membangun?
6. **POS native lokal & offline** (mandat pengguna 2026-11-05 21:50; baris 19): mesin offline sudah ada tetapi NOT TESTED di browser — keputusan bentuk akhirnya (aplikasi web terpasang lokal di Linux vs bentuk lain) menunggu Riset 2 (teknologi); yang perlu diputuskan pemilik di sini: **apakah toko harus tetap bisa menjual penuh saat internet mati berjam-jam** (menentukan seberapa jauh investasi offline) dan perangkat apa yang benar-benar dipakai di konter.
7. **Tender kredit pihak di terminal POS & refund tunai atas kredit tak terpakai** (penundaan tercatat A-21 R3-B).
8. **Pemetaan khusus akun PPh atas bunga** di model cepat rekonsiliasi (sisa A-22 K3 — hari ini heuristik nama akun).
9. **Git remote + branch protection + CI wajib** (ARS4-01 — satu-satunya P1 arsitektur yang tidak bisa ditutup dari kode; CI sudah tertulis & tervalidasi lokal, status GitHub NOT TESTED).

## 6. Koreksi kejujuran sumber

- **Susunan panel dashboard Accurate** (aktivitas terakhir, arus kas, grafik penjualan, penjualan per hari) bersumber dari studi kasus pihak ketiga atas tangkapan layar produk (Medium, 2025), dikonfirmasi searah oleh materi resmi `accurate.id` yang menyebut dashboard sebagai speedometer pantau — tetapi susunan panel persisnya **bukan** dari dokumentasi resmi. Pola yang diadopsi adalah prinsipnya (pantau tanpa membuka laporan), bukan replika panelnya.
- **Perilaku persis Accurate** yang dikutip sebagai pola (Rincian Jurnal dari dokumen, Preferensi → Akun sebagai sumber jurnal otomatis, Proses Akhir Bulan, PPh 23 terbentuk saat pembayaran) bersumber dari **pusat bantuan resmi** `help.accurate.id` — tingkat kepercayaan tertinggi di laporan ini. Daftar fitur dari situs mitra resmi (ProConsulting, Szeto) adalah materi pemasaran: dipakai hanya untuk keberadaan fitur, tidak untuk perilaku.
- **Perilaku POS Odoo** dari buku Cybrosys v19 adalah sumber sekunder (buku mitra atas edisi Enterprise); alur inti yang dipakai di sini (kontrol buka/tutup, kas masuk/keluar beralasan, harapan per metode) dikonfirmasi oleh **dokumentasi resmi Odoo 19** (`applications/sales/point_of_sale/use.html`). FEFO & empat tanggal batch murni dari dokumentasi resmi Odoo 19.
- **Literatur SOP ritel** (Taqtics, Manifestly, CloudPOS) adalah panduan praktik komersial, bukan standar formal; dipakai untuk titik rawan & urutan kerja, **bukan** untuk angka baku — contoh: nilai float dan ambang pengecualian dalam dolar AS di sumber-sumber itu konteks Amerika dan tidak diadopsi sebagai angka di sini.
- **Pemetaan status fitur §2 berbasis dokumen repo** per 2026-11-05 ±19:05 (pembaruan terakhir `PROGRESS.md`) ditambah audit A-23 yang ter-commit sesudahnya. Status "ada & berfungsi" berarti terdokumentasi lulus gerbang program yang disebut — riset ini tidak menjalankan ulang satu pun test; verifikasi fitur satu-per-satu adalah mandat Riset 3 / Matriks Verifikasi (A-5).
- Dua pekerjaan yang statusnya **berubah sesudah dokumen terakhir ditulis** (perbaikan SIS-01 dan pengetatan peran, keduanya dimandatkan ke A-23 S1) sengaja ditulis sebagai "perbaikan berjalan", bukan selesai — mengklaimnya selesai di sini akan mengulangi kesalahan yang program ini ada untuk memberantas.
