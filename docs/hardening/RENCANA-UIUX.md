# RENCANA Jalur UI/UX A-28 — Tahap UI-1 s.d. UI-5

Sumber temuan: `docs/hardening/AUDIT-UIUX-A28.md` (U0, audit empiris 2026-11-07). Urutan mengikuti mandat tambahan pengguna (`MANDAT-UIUX-TAMBAHAN.md`): workflow POS & keyboard lebih dulu, lalu template cetak customizable, desain laporan & nota, workflow lintas modul, dan poles konsistensi. **Aturan bisnis & angka tidak berubah di jalur ini** — yang berubah hanya penyajian, fokus, dan affordance. Gerbang setiap tahap: suite penuh + e2e hijau dari reseed bersih, pengukuran langkah ulang untuk tugas yang disentuh, dan screenshot sebelum/sesudah di `~/workspace/bukti-a28/uiux-<tahap>/`.

---

- [x] **UI-1 — Workflow & keyboard POS** *(UX-B01, B02, B03, B04, B07; target mandat C: alur kasir tercepat)*
  - Kotak cari terminal **autofocus** saat dimuat (dan sesudah checkout kembali ke terminal); wujudkan F2 sebagai penangkap fokus global terminal — atau, bila F2 dipilih tidak dipakai, hapus janji dari placeholder. Placeholder tidak lagi terpotong pada 1440px.
  - Navigasi **panah atas/bawah + Enter** pada hasil pencarian (highlight terlihat, Enter memilih yang ter-highlight; Enter tanpa highlight tetap hasil pertama seperti kini).
  - Peta shortcut langkah akhir yang tidak bertabrakan browser/scanner: Bayar, Tahan, fokus Diterima, ganti mode Tunggal/Campuran — ditampilkan lewat tombol bantuan `?` di terminal dan pada placeholder seperlunya.
  - Nominal tender & nominal campuran memakai `MoneyInput` (format saat ketik) — menutup sisa kategori terminal H-PGT-01.
  - Tombol Bayar mode Campuran **nonaktif sampai Sisa = 0**, dengan label menyatakan sisa ("Bayar — sisa Rp …") sebagai pencegahan kesalahan.
  - Gerbang khusus: pengukuran ulang tugas 1 & 2 (target: pindai→bayar tunai ≤3 tindakan tanpa klik awal; campuran ≤6 tindakan), e2e POS hijau, screenshot terminal sebelum/sesudah.

- [x] **UI-2 — Template cetak satu pintu & customizable** *(UX-D01, D02, D03, D05)*
  - **Satu pintu**: tab "Nota & printer" dilebur ke tab "Cetak" — saklar hidup (tampil kasir, tampil PPN) pindah menjadi pengaturan mesin cetak; field warisan Header nota & Logo yang mati **dihapus dari UI**; nilai Footer nota lama dimigrasikan menjadi teks kaki mesin cetak bila teks kaki masih kosong (satu kali, tercatat), lalu kolom warisan berhenti ditampilkan. Tidak ada lagi dua tempat untuk kop/kaki/logo.
  - **Unggah logo** sebagai berkas (pola unggah gambar QRIS), URL tetap didukung sebagai alternatif.
  - Saklar elemen struk diperluas: tampil pelanggan, tampil sesi, tampil QR sudah ada — samakan polanya; baris merek "Dicetak dari Bisa ERP" dapat dimatikan pemilik.
  - **Faktur penjualan format dokumen (A4/A5)** dari halaman nota/riwayat: dokumen penjualan berkerangka PrintShell (kop penuh + NPWP + tanda tangan Opsional) untuk pelanggan bisnis; struk thermal tidak berubah.
  - Label blok tanda tangan per jenis dokumen dapat diatur teksnya (peran penanda tangan), bawaan = label hari ini.
  - Gerbang khusus: uji asap cetak untuk ke-11 keluaran lama + faktur baru (render & label pengaturan terbaca konsisten), screenshot pengaturan cetak sesudah peleburan & contoh faktur.

- [x] **UI-3 — Desain laporan & dokumen keuangan** *(AKT-09, AKT-08 sisa, AKT-05, UX-A04 sebagian)*
  - Saklar **"Sembunyikan akun bersaldo nol"** di Laporan (layar + cetak + XLSX berbagi model tabel yang sama — satu perilaku di tiga permukaan).
  - Buku besar membuka pada **akun postable beraktivitas pertama** sebagai bawaan (bukan header 10000); daftar akun bersaldo tetap sebagai pemilih.
  - Daftar jurnal menampilkan rincian debit/kredit per baris jurnal (ringkas, dapat dilipat) tanpa membuka detail.
  - Perbaiki teks basi: deskripsi halaman Laporan menyebut CSV **dan Excel**; label tipe akun di Kas & bank memakai Bahasa Indonesia.
  - Gerbang khusus: screenshot laba rugi/neraca saldo/buku besar/jurnal sebelum/sesudah; paritas angka laporan tidak berubah (test laporan hijau).

- [x] **UI-4 — Workflow lintas modul** *(UX-C01, C02, C03, C06)*
  - Detail PO Draf mendapat aksi **"Kirim & terima"** berkonfirmasi (satu alur: kirim lalu langsung form penerimaan terisi) di samping Kirim biasa; StatusSteps menjelaskan langkah berikutnya pada setiap status.
  - Riwayat payroll: **nomor run menjadi tautan** ke detail (periode tetap teks); sesudah posting, wizard menampilkan tautan "Buka run PRL-…" sebagai langkah selesai.
  - Wizard payroll menandai periode yang sudah diproses di langkah 1 ("Sudah diproses — PRL-…") sebelum pengguna berjalan lebih jauh.
  - Beranda Gudang: referensi pergerakan stok menjadi **tautan ke dokumen asal**; baris terkelompok per dokumen/hari seperti daftar Pergerakan stok.
  - Gerbang khusus: pengukuran ulang tugas 4 (target terima dari PO Draf ≤2 klik sesudah detail) & tugas 8 (jalan ke slip ≤2 klik dari riwayat), screenshot.

- [x] **UI-5 — Poles konsistensi lintas modul** *(UX-A02, A03, A05, A06, B05, C04 + sisa A-25: POLA-03, GDG-13, PNG-05)* — SELESAI untuk butir mandat tahap (A02, A03, A04, A05, B05); A06/C04/GDG-13/PNG-05 dinyatakan SISA TERJADWAL di `STATUS-UIUX-A28.md` (POLA-03 sudah tertutup lebih dulu oleh UI-3).
  - Judul kartu ganda pada daftar Gudang (Penerimaan, PO, dan pola sejenis) dibuang mengikuti pola PageHeader murni.
  - Pola aksi baris diseragamkan: daftar operasional memakai menu ⋯ dengan destruktif terpisah di dasar (pola RowMenu A-25); Riwayat POS & Penerimaan menyusul; tombol Hapus pada baris akun Sistem di Bagan akun masuk ke menu ⋯ (tidak tampil sebagai tombol terbuka).
  - Beranda Akuntansi diringkas bertahap: Input Cepat dipadatkan (satu baris kartu kecil atau panel terlipat bawaan) agar antrean kerja & KPI menjadi hierarki pertama (AKT-02/03 — tanpa menghapus satu pun jalan pintas).
  - Sapuan tanggal native → `DateField` pada permukaan yang teridentifikasi audit (filter Laporan, form transfer Kas & bank, Berlaku sejak Payroll Indonesia, dan sisa prioritas dari hitungan POLA-03).
  - Fokus awal opname: kotak pindai autofocus seperti Mode Operasi.
  - Kolom pertama tabel Program BPJS diperlebar agar nama program + catatan tidak membungkus berlebihan (PNG-05).
  - Utilitas duplikat pihak menjadi panel/dialog di halaman Pemasok (GDG-13, sisa terjadwal A-25).
  - Gerbang khusus: sapuan screenshot ulang himpunan 26 permukaan U0 dan perbandingan berdampingan; tidak ada perubahan angka/perilaku domain (suite & e2e hijau).

**Di luar cakupan jalur ini** (tetap keputusan pemilik, tidak dibangun diam-diam): PIN supervisor POS (H-POS-06), gerbang harga massal, matriks ECL, renumber COA perusahaan berjalan. Identitas kop per cabang (UX-D04) dicatat sebagai kebutuhan multi-outlet lanjutan — menunggu keputusan pemilik soal model cabang, bukan dikerjakan sepihak.
