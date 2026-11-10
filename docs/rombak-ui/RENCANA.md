# RENCANA A-25 — Rombak UI/UX & Workflow (Akuntansi, Gudang, HR, Pengaturan)

Mandat pengguna 2026-11-06 07:21 WIB: UI hasil A-24 dinilai "jelek semuanya" —
rombak total UI/UX + workflow TIAP FITUR di Akuntansi, Gudang, HR, Pengaturan.
POS tidak termasuk (perintah pengguna yang berlaku: terminal POS tidak disentuh).

Dasar: `docs/rombak-ui/AUDIT-UI-A25.md` (54 temuan: 12 P1, 32 P2, 10 P3) +
`docs/rombak-ui/ARAH-DESAIN-A25.md` (bahasa desain konkret 350 baris).

## Keputusan Pemimpin (mengikat program ini)

1. **Tema berlingkup disahkan**: token desain baru diterapkan lewat kelas tema
   pada cangkang 4 modul sasaran. `globals.css` bersama POS tidak diubah
   nilainya untuk POS; POS tetap tema lama (utang konsistensi tercatat sadar).
2. **Penyimpangan AGENTS.md proyek tercatat**: aturan "pertahankan bahasa
   visual compact Odoo yang ada" disimpangi atas keputusan pengguna sendiri
   (mandat di atas) — dicatat di PROGRESS §A-25. Arah baru tetap mengacu Odoo
   modern (sidebar terang, status bar dokumen), bukan gaya asing.
3. **Domain tidak berubah**: aksi server, aturan akuntansi/stok/payroll, dan
   angka hasil TIDAK diubah. Yang dirombak adalah penyajian & alur permukaan
   (tata letak, drawer, wizard, tab, pengelompokan) — bukan aturan bisnis.
   Gerbang angka: suite tidak boleh turun dari 1540/1540, e2e 19/19.
4. **Gerbang visual per tahap**: skrip screenshot `.local/shots/capture.mjs`
   dijalankan per tahap; Pemimpin membandingkan sebelum/sesudah dari berkas.
5. Keputusan pemilik lama (daftar RENCANA A-24 §3) tetap tidak dieksekusi.

## Tahap

- [x] **U0 — Fondasi tema berlingkup.** — SELESAI 2026-11-06, suite 1540/1540; tema `.theme-erp` berlingkup cangkang non-POS, POS identik byte-per-byte; format seragam & 404 terawat tertutup. Sisa diteruskan: komponen tanggal bersama (Chromium mengabaikan `lang` utk render mm/dd/yyyy) menjadi bagian **U2**; input persen statutori & konvergensi salinan label/field lokal menjadi bagian U6. Token baru (palet netral, tipografi,
  radius, bayangan kartu/pop) sebagai kelas tema di `globals.css` tanpa
  mengubah nilai tema POS; kelas diterapkan di layout cangkang modul non-POS;
  utilitas format tampilan seragam ditegakkan (tanggal id-ID satu pola, angka
  qty/uang selalu lewat formatter — temuan audit pola #3 & #4 ditutup di akar:
  render `{line.qty}` mentah dan uang statutori mentah dibetulkan di tempatnya
  sebagai bagian fondasi); halaman `not-found` dirawat. Bukti: screenshot
  beranda 4 modul sebelum/sesudah; suite tetap 1540.
- [x] **U1 — Cangkang baru.** — SELESAI 2026-11-06, suite 1540/1540, e2e 19/19; sidebar terang ber-token (POS gelap utuh, md5 identik), AppSwitcher, lencana antrean 3 item, PageHeader v2. Sisa: judul ganda di komponen anak & KPI nol per halaman → pola U2 + tahap modul; tombol Buat global & rel lipat tidak dibangun (di luar isi U1, dicatat). Sidebar terang + pengalih aplikasi (mengganti
  segmented control), header & breadcrumb ramping, PageHeader baru tanpa
  judul ganda dan tanpa deskripsi tutorial permanen (penjelasan jadi tooltip/
  terlipat), lencana antrean di menu. Menutup temuan pola #2 dan sebagian #9.
- [x] **U2 — Pola komponen bersama + 2 contoh.** — SELESAI 2026-11-06, suite 1562/1562 (+22), e2e 19/19; 11 komponen blocks + DateField terbangun & teruji, Produk & Jurnal terapan penuh. Di `src/components/blocks/`:
  `DataList` (satu pola filter/pencarian, aksi baris menu ⋯, KPI opsional
  bukan bawaan), `DocumentPage` (status bar tahap dokumen + rel aksi),
  `DocumentForm` (ringkasan sticky, field lanjutan terlipat), `WorkQueue`
  (antrean nol tidak dirender), `SettingsLayout` (navigasi satu, simpan
  sekaligus + indikator perubahan), `EmptyState` v2 ringkas, `WizardSteps`,
  `ApprovalInbox`. Diterapkan penuh pada 2 contoh: Produk (Gudang) dan Jurnal
  (Akuntansi) sebagai pola rujukan tahap modul. Menutup pola #1, #6, #7, #8.
- [x] **U3 — Gudang menyeluruh.** — SELESAI 2026-11-06, suite 1562/1562, e2e 19/19, nol perubahan server. Sisa tercatat di laporan tahap (RowMenu 3 daftar menunggu pemilik komponen bersama; pencarian retur & paginasi Nilai butuh perubahan fungsi baca = di luar mandat penyajian; label StatusBadge PR/reservasi ditugaskan sekalian ke U4). Semua halaman Gudang ke pola baru: opname
  dipecah per pekerjaan (tugas/lembar/papan tidak lagi bertumpuk terbuka),
  detail pemasok/pelanggan beraksi (bayar utang, buat PO, ubah) bukan kartu
  kosong, PR/PO/penerimaan/retur/transfer dokumen memakai DocumentPage,
  tanggal & angka seragam. Workflow terima barang dipersingkat via Mode
  Operasi sebagai pintu utama (arah desain §d).
- [x] **U4 — Akuntansi menyeluruh.** — SELESAI 2026-11-06, suite 1562/1562, e2e 19/19. Sisa tercatat: RowMenu tak diterapkan pada baris berdialog-trigger-sendiri (batasan komponen, sama seperti U3); AKT-05 & AKT-08 penuh tidak dibangun. Semua halaman Akuntansi ke pola baru:
  rekonsiliasi bank berdampingan (daftar mutasi vs buku, bukan bertumpuk),
  halaman cetak keluar dari cangkang aplikasi (lebar penuh, tanpa status
  mentah), beranda akuntansi diringkas (tanpa tumpukan 20+ kartu), bayar
  utang/terima piutang dari antrean WorkQueue (5→3 langkah), jurnal manual
  tanpa peringatan palsu saat kosong.
- [x] **U5 — HR menyeluruh.** — SELESAI 2026-11-06, suite 1562/1562 (diverifikasi ulang Pemimpin di pohon final), e2e 19/19. Absensi & Shift dipecah: rekap di atas, form
  masuk drawer/tab (bukan 5 form terbuka); payroll menjadi wizard 3 langkah;
  persetujuan (cuti, lembur, kasbon, klaim, pinjaman) digabung satu
  ApprovalInbox; daftar karyawan & detail memakai DataList/DocumentPage.
- [x] **U6 — Pengaturan menyeluruh.** — SELESAI 2026-11-06, suite 1600/1600, e2e 19/19, uji asap saver 6/6. Semua halaman Pengaturan ke
  SettingsLayout: navigasi tunggal, simpan sekaligus dengan indikator
  perubahan (menutup P1 simpan-per-baris ±25 tombol), Payroll Indonesia
  diformat terbaca (angka berpemisah ribuan, tak terpotong), field
  dikelompokkan per topik dengan bagian lanjutan terlipat.
- [x] **U7 — Gerbang final & rilis.** — SELESAI 2026-11-06: gerbang dari
  reseed bersih suite 1600/1600, typecheck/lint/build exit 0, e2e 19/19;
  POS beku terbukti identik byte-per-byte (md5 `dfe3ffaa…`); screenshot
  sesudah semua menu 77 berkas + ZIP terkirim; status tutup 54 temuan
  (34 tertutup / 16 sebagian / 4 sisa terjadwal) di
  `docs/rombak-ui/STATUS-TUTUP.md`; pengukuran workflow ulang per modul
  tercatat di dokumen yang sama. Suite penuh + typecheck/lint/build/e2e
  dari reseed bersih; pengukuran ulang workflow alur tersering per modul
  (dibandingkan angka audit A-25); screenshot sesudah untuk SEMUA menu
  (skrip capture) dan ZIP screenshot baru dikirim ke pengguna; dokumen audit
  ditutup per temuan (status akhir di AUDIT-UI-A25); PROGRESS ditutup; ZIP
  rilis dari commit final.

## Yang TIDAK dikerjakan program ini

Wilayah POS (semua), perubahan aturan bisnis/domain, fitur baru dari daftar
keputusan pemilik A-24, ekspor berformat, perangkat fisik.
- [x] **U8 — POS menyusul (perintah pengguna 2026-11-06, beku dicabut).** — SELESAI 2026-11-06, suite 1600/1600 (terverifikasi ulang Pemimpin), e2e 19/19. Cangkang & sidebar POS = theme-erp; halaman POS ke pola baru; terminal struktur utuh, kulit token baru; overflow 390px sesi diperbaiki.
