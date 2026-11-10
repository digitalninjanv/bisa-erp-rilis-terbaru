# Audit UI/UX — Konsolidasi Resmi & Status Tutup per Temuan

**Dokumen resmi program A-24 (ditulis di T8, 2026-11-06).** Mengkonsolidasikan
tiga audit hands-on yang pernah dijalankan atas sistem ini dan menutup
status setiap temuannya dengan bukti:

1. **A-22** — Audit UX modul Akuntansi (`docs/akuntansi-ux/UX-AUDIT.md`,
   9 workflow diukur, 48 tangkapan; temuan UX-01…UX-12: P1:2 · P2:6 ·
   P3:4 — *catatan kejujuran: berkas audit terpotong di UX-08; badan
   UX-09…UX-12 tidak tersimpan dan tidak direkonstruksi di sini — yang
   tertulis adalah yang terbaca dari tabel workflow audit & pekerjaan
   tahap K yang ter-commit*).
2. **A-23** — Audit UX seluruh sistem (`docs/ux-sistem/UX-AUDIT-SISTEM.md`,
   61 tangkapan; temuan SIS-01…SIS-15: P1:3 · P2:7 · P3:5 + tabel langkah
   K1–K6/G1–G6/P1–P2).
3. **A-24** — Penutupan bertahap T1–T4 + verifikasi fungsi T7
   (`docs/TESTING_REPORT.md`) + pengukuran ulang gerbang final T8.

Prinsip penerimaan yang dipakai menilai (RISET-DOMAIN §4): satu komponen
per konsep; ketikan manusiawi tidak merusak angka; setiap angka
tertelusur ≤2 klik; peran menentukan dunia pengguna; tindakan
konsekuensial digerbang sebanding risiko; workflow inti tidak bertambah
langkah tanpa alasan tertulis.

---

## 1. Temuan A-22 — Akuntansi (UX-01…UX-12) → ditutup program A-22 (K1–K6)

| ID | Temuan | Penutup | Bukti |
|---|---|---|---|
| UX-01 (P1) | Pencarian daftar Jurnal menghasilkan halaman error dari UI (parameter ganda → TypeError) | **K1** `4cbf628` — cacat sekelas yang sama diperbaiki juga di riwayat POS & produk gudang; e2e pencarian jurnal ditambahkan | Gerbang A-22 1375/1375, e2e 16/16; diuji ulang T7 & T8 |
| UX-02 (P1) | Form Jurnal baru tidak terpakai di lebar 390 | **K2** `4ea773f` — form menjadi kartu di <lg + bilah total lengket | Tangkapan 29/29 `scrollWidth ≤ viewport` |
| UX-03 (P2) | Piutang & utang: pekerjaan tenggelam di bawah ringkasan di layar kecil | **K2** — lipatan aging + kartu dokumen | Bukti A-22; sapuan T8 |
| UX-04 (P2) | Laporan: kolom pembanding tahun lalu terpotong di 390 | **K2** — saklar "Bandingkan" di <md | Bukti A-22; sapuan T8 |
| UX-05 (P2) | Contoh format impor rekonsiliasi ditolak parsernya sendiri | **K3** `924b67c` — parser CSV menjadi lib bersama `statement-csv`; contoh UI adalah konstanta yang sama & terbukti lolos parser; hasil/error impor menetap di panel; model cepat Biaya admin/Bunga/PPh | Test parser + e2e rekonsiliasi (T7) |
| UX-06 (P2) | Dua jalur tugas sama tidak setara; panel Input Cepat tidak jujur | **K4** `ae99716` — Input Cepat berpenanda HALAMAN secara jujur; pratinjau == posting dari lib bersama (D-23) | Bukti A-22 K4 |
| UX-07 (P2) | Sidebar datar 18 item; klaster SDM tercampur di Akuntansi | **K5** `e415a4f` — sidebar berkelompok; **dituntaskan A-24 T2** — SDM keluar menjadi modul HR tersendiri | T2: pengalih 4 modul, sidebar akuntansi tanpa grup SDM (tangkapan t2-*) |
| UX-08 (P2) | Target sentuh kecil & teks 10px tersisa | **K2** (teks 10px → 11px, kontrol h-6 → h-8) + **K6** sapuan 35 rute × 3 lebar (0 overflow, 0 error, kontrol form 32px); serpihan permukaan Pengaturan ditutup **A-24 T1** | Lihat juga SIS-15 |
| UX-09 (P2) | Label arah uang menyesatkan ("MASUK KE" untuk uang keluar) — terbaca dari tabel workflow audit | **K4** — label bersama "Masuk ke / Bayar dari" per arah uang | Bukti A-22 K4 |
| UX-10 (P2) | Sinyal "siap diposting" jurnal bertentangan — terbaca dari tabel workflow audit | **K4/K2** — `BalanceIndicator` bersama di semua form jurnal & input cepat | Bukti A-22 |
| UX-11, UX-12 (P3) | Badan temuan hilang (berkas audit terpotong) — **tidak dikarang** | Ditutup lewat sapuan menyeluruh K6 (35 rute akuntansi × 3 lebar: 0 overflow, 0 halaman error) & gerbang final A-22 yang mengukur ulang 9 workflow; K6 juga menemukan & memperbaiki bug nyata di luar UX: halaman Aset Tetap error total tanpa pemetaan akun | Commit `143a2bc`, gerbang `e9c59da` |

**Hasil A-22:** dashboard akuntansi mendapat "Antrean kerja" 5 kartu
(K5) — pola antrean per peran yang kemudian menjadi pola sistem;
drawer mobile yang rusak di semua modul diperbaiki (portal ke body).

## 2. Temuan A-23 — Seluruh sistem (SIS-01…SIS-15) → ditutup A-23 S1 & A-24 T1–T3

| ID | Temuan | Penutup | Bukti |
|---|---|---|---|
| SIS-01 (P1) | `MoneyInput` merusak nominal ≥5 digit yang **diketik** digit-per-digit (ketik `1500000` → terbaca 1,5; pratinjau Rp 2) | **A-23 S1** `b44d934` — kontrak ketik dipisah (`parseTypedMoneyText`: titik = ribuan sedang terbentuk, koma satu-satunya desimal); parser tempel/commit tidak diubah; regresi urutan ketukan +31 test | Bukti hidup: ketik 1500000 → field `1.500.000`, pratinjau Rp 1.500.000 seimbang |
| SIS-02 (P1) | Peran Kasir bawaan mencakup Gudang hampir penuh (termasuk HPP) | **A-23 S1** — template peran menjadi konstanta pusat `BUILTIN_ROLES`; Kasir = modul `pos` saja; peran kustom tidak ditimpa | Test permissions ditulis ulang ke kontrak baru (lebih ketat) |
| SIS-03 (P1) | Kasir tidak punya jalur retur penjualan sama sekali | **`7079687`** — template Kasir memenuhi izin `pos.return` yang sudah menggerbangi menu/halaman Retur yang lama ada (perubahan izin, nol perubahan terminal; bisa dibalik satu perintah) | Matriks T7 POS-06 LULUS |
| SIS-04 (P2) | Penolakan izin di rute non-modul tampil sebagai halaman crash generik | **A-23 S1** — 74 halaman memakai `requirePermissionPage` (pantulan + `ForbiddenBanner` bersama); aksi server tetap melempar untuk `guard()` | Bukti hidup 13/13; probe T7 dua arah |
| SIS-05 (P2) | Pesan prasyarat halaman gudang salah untuk peran lihat ("tambahkan gudang dahulu" padahal gudang ada) — jalan buntu menyesatkan | **A-24 T1** `55a7484` — **terbukti masih hidup** lewat pengguna peran sungguhan sebelum diperbaiki: lib `form-gate` + `GateNotice` bersama (formulir / prasyarat hilang / mode lihat) + sapuan 12 titik EmptyState sadar-peran. Kasir: ditutup-tanpa-cacat (memang terpantul rapi) | Tangkapan before/after sis05-*; matriks T7 PLT-02 |
| SIS-06 (P2) | Beranda bersama membocorkan statistik keuangan ke peran terbatas | **A-23 S1** — beranda & pintasan tersaring modul terjangkau; pengguna satu modul mendarat langsung di modulnya (`landing.ts`) | Bukti sis06-*; probe T7 |
| SIS-07 (P2) | Input uang mentah tanpa format di permukaan berfrekuensi tinggi (DITERIMA, modal sesi, harga penerimaan `2600.0000`, field Rp Pengaturan `1000000.0000`) | **Bertahap:** kontrak ketik diperbaiki S1; field Pengaturan (tarif pajak, ambang write-off, ambang penyesuaian, ambang PR) & harga baris penerimaan → `MoneyInput` bersama di **A-24 T1** (ketik `2500000` terbukti → `2.500.000`). **Batas jujur:** permukaan *terminal POS* tidak diubah atas perintah pemilik (2026-11-05 21:50) — domain & kontrak lib-nya sama, komponen terminalnya di luar jangkauan program | Tangkapan after-pengaturan-* & after-penerimaan-harga-baris |
| SIS-08 (P2) | Daftar gudang belum punya mode kartu di layar kecil | **A-24 T3** — mode kartu produk & penerimaan di 390 | Tangkapan t3-after-produk-kartu-390, t3-after-penerimaan-kartu-390 |
| SIS-09 (P2) | Sidebar gudang datar 16 item tanpa kelompok, istilah campur | **A-24 T3** — pengelompokan nav gudang + **Mode Operasi** scan-first sebagai pintu kerja harian | Tangkapan t3-after-operasi-* (1440/768/390 + scan barcode) |
| SIS-10 (P2) | Tutup sesi kas satu klik tanpa konfirmasi/selisih akhir | **KEPUTUSAN PEMILIK — belum ditutup** (RENCANA §3 butir 1): wilayah terminal POS yang dinyatakan tidak disentuh. Domain selisihnya benar (berjurnal, tak terhapus); yang menunggu adalah gerbang terpandunya | Terukur ulang di T8: perilaku masih sama, dicatat apa adanya |
| SIS-11 (P3) | Pengaturan tinggal di dalam cangkang modul Akuntansi | **A-24 T1** — cangkang Pengaturan sendiri (`settings-shell` + nav 12 item tersaring izin); URL nol berubah | Tangkapan after-pengaturan-cangkang-1440/390 |
| SIS-12 (P3) | Tidak ada pencarian lintas sistem | **A-24 T1** — palet Ctrl+K: indeks halaman tersaring peran ∩ saklar + pencarian entitas tergating server (kasir: nol hasil gudang/akuntansi) | Test palette 10 (kunci anti-bocor kasir); tangkapan after-palet-* |
| SIS-13 (P3) | Kasir melihat sesi & selisih kasir lain | **KEPUTUSAN PEMILIK — belum ditutup** (RENCANA §3 butir 16: saklar riwayat lintas-kasir per perusahaan; keadaan bawaan hari ini terbuka) | — |
| SIS-14 (P3) | Kebisingan kontekstual: konten peran/pengaturan lain tampil di permukaan kerja | **A-24 T3** (wilayah gudang) bersama pola tersaring peran T1/S1 (beranda, palet, gerbang form) | Bukti T3 + T1 |
| SIS-15 (P3) | Konsistensi mikro & target sentuh sisa (chip tab 22px, dialog tak menutup dengan Escape) | **A-22 K2/K6 + A-24 T1** — chip & toggle Pengaturan → h-8 (32px); dialog akses menutup Escape/klik-latar terbukti hidup. **Sisa jujur terukur:** target <28px hanya pada chrome cangkang bersama semua modul (tautan brand 16px, chip pengalih 27px, breadcrumb 16px) & 5 checkbox native 13px terbungkus label terklik penuh — keputusan pola lintas-modul, bukan sisa satu permukaan | Pengukuran DOM T1 pada permukaan Pengaturan |

## 3. Penutupan A-24 per tahap (di luar temuan audit lama)

| Tahap | Perubahan UX | Temuan asal |
|---|---|---|
| T1 | Cangkang Pengaturan; palet Ctrl+K; gerbang form jujur; MoneyInput Pengaturan & penerimaan | SIS-05, SIS-07 (sisa), SIS-11, SIS-12, SIS-15 (serpihan) |
| T2 | HR modul sendiri: pengalih 4 modul, sidebar HR, pendaratan peran HR; grup SDM keluar dari akuntansi | UX-07 (tuntas), CB-U2/CB-P2 |
| T3 | Gudang: Mode Operasi scan-first (pindai → dokumen terbuka 1 aksi), antrean operasi berkartu, opname bertugas dengan tinjau selisih bernilai Rp, penyesuaian beralasan dengan nilai dampak terlihat sebelum posting, mode kartu layar kecil | SIS-08, SIS-09, SIS-14, CB-U1 |
| T4 | Akuntansi pola Accurate: **Rincian Jurnal satu-klik dari semua dokumen non-POS** (8 jenis dokumen tertaut, teruji `fix-a24-t4-journal-links`), daftar periksa akhir bulan terpandu di atas mesin tutup periode yang ada | CB-U3, pola Accurate §3.1 RISET-DOMAIN |
| T7 | Bukan perubahan — pembuktian: 61/61 baris matriks fungsi LULUS termasuk seluruh workflow di atas pada build akhir | — |
| T8 | Pengukuran ulang workflow per peran & sapuan visual multi-lebar atas build final (laporan tahap T8 menyertai dokumen ini) | Prinsip 7 & 14 RISET-DOMAIN |

## 4. Yang terverifikasi KUAT sejak audit (jangan diutak-atik)

Dari audit A-23 §"Terverifikasi kuat" dan dibuktikan ulang T7: opname
hitung buta; sesi kas dengan selisih live; gerbang QRIS yang jujur
(tombol Bayar nonaktif + alasan tertulis); muat halaman lokal <±550 ms;
0 overflow pada rute terukur; isolasi staf gudang di level modul;
pratinjau jurnal Catat Transaksi yang identik dengan postingnya.

## 5. Sisa UX yang diakui terbuka (bukan disembunyikan)

1. **SIS-10 & SIS-13** — keputusan pemilik (wilayah POS & kebijakan
   visibilitas antar-kasir). Lihat RENCANA §3 butir 1 & 16.
2. **Target sentuh chrome bersama <28px** (brand/breadcrumb/chip
   pengalih) — keputusan pola lintas-modul; kontrol *form* sudah 32px.
3. **Ekspor laporan berformat Excel/PDF** belum ada (hanya CSV) —
   keputusan pemilik (CB-P4).
4. **Bahasa perangkat fisik** (printer/scanner) tidak teruji di
   lingkungan ini — NOT TESTED eksternal, langkah pembuktiannya di
   `docs/OFFLINE_POS_ARCHITECTURE.md`.
