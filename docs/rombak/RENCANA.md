# Rencana Eksekusi Program A-24 — Rombak Total UI/UX & Pembuktian Fungsi

Ditulis: 2026-11-05. Penulis: agen penulis rencana; peninjau & satu-satunya
yang boleh mencentang: **Pemimpin** (sesi utama), sesudah verifikasi bukti.
Sumber: `docs/rombak/RISET-DOMAIN.md`, `docs/rombak/RISET-TEKNOLOGI.md`,
`docs/ux-sistem/UX-AUDIT-SISTEM.md` (temuan SIS-01..15),
`docs/ux-sistem/RISET-SISTEM.md`, `PROGRESS.md`, `docs/SPEK-FITUR-INTI.md`.
Format: setiap tahap adalah butir ber-centang; tahap dinyatakan selesai
hanya oleh Pemimpin sesudah diff ditinjau, test tahap dijalankan ulang,
dan bukti wajib ada (aturan main lengkap di §4 berkas ini).

---

## 1. Kepala

### 1.1 Mandat pengguna (2026-11-05 ±21:50, intinya)

Pengguna memerintahkan **rombak total, bertahap, otomatis sampai selesai**:
"rombak total semuanya… banyak yang sulit dipakai, input dll, input nomor
salah dll banyak banget itu yang error… rombak total UI UX tampilan dan
kodenya, arsitekturnya mudah diperbaiki, terstruktur, terpusat… akuntansi,
gudang, dan pos… bertahap: pertama analisa, baca dokumentasi, riset dulu
desain yang mudah dipakai — akuntansinya cari Accurate dll… perbaiki juga
fungsinya… pakai metode terbaiknya… hasil akhir jadi sistem ERP minimarket
yang bekerja, berfungsi penuh, mudah dipakai, aman dan benar… arsitektur
matang… supaya POS itu native, dipasang di lokal supaya kalau offline bisa
dipakai, pakai Linux… fokusnya mudah dipakai dan customizable fleksibel…
riset juga workflow di minimarket supaya tahu fiturnya yang paling
penting… semua fiturnya harus mudah dijangkau, tiap modul tersendiri — HR,
karyawan, dll, semuanya ada fungsi tersendiri."

Dua batas mandat yang mengikat seluruh rencana ini:

- **Terminal POS di `app/pos` TIDAK disentuh** — pengguna menyatakan
  bagian itu sudah bagus. Perubahan yang secara teknis menyentuh wilayah
  POS (mis. tutup sesi SIS-10) bukan tahap eksekusi; ia masuk daftar
  keputusan pemilik di §3 sampai pengguna sendiri mengubah batas ini.
- **Kebenaran akuntansi & stok tidak berubah.** Rombak ini adalah
  tampilan, workflow, visibilitas, pengemasan, dan pembuktian — bukan
  pembangunan ulang domain. Perubahan domain yang terbukti perlu menjadi
  tahap tersendiri yang dinyatakan, bukan diselipkan (prinsip 12 di §1.3).

### 1.2 Keadaan awal terverifikasi (fondasi, bukan dibangun ulang)

| Fondasi | Keadaan |
|---|---|
| Program A-19 (FIX-ARS) | Tuntas: fondasi operasi, ringkasan bulanan, gerbang suite 1195/1195 |
| Program A-20 | Analisis arsitektur mendalam selesai (vonis 6,7/10 — modular monolith berkonteks; tidak ada yang menuntut rewrite) |
| Program A-21 | Tuntas: kelengkapan input akuntansi; gerbang 1298/1298; migrasi sampai **0053** |
| Program A-22 | Tuntas: UI/UX akuntansi (workflow & responsif); gerbang 1375/1375, e2e 16/16 |
| Program A-23 S1 (`b44d934`) | Tuntas & terverifikasi Pemimpin: **SIS-01** input uang diketik benar (test urutan ketukan), **SIS-02** template Kasir = POS saja, **SIS-04** penolakan izin menjadi pantulan + banner, **SIS-06** beranda & pendaratan sadar peran. Suite terakhir **1417/1417 (146 berkas)**, typecheck/lint/build 0, e2e **16/16** |
| Program A-23 S2 | **Selesai — dibatalkan dari wilayah POS** atas perintah pengguna 21:50; seluruh suntingan POS dikembalikan ke HEAD; sisa di luar POS (izin retur kasir) ter-commit `7079687` dan tercatat tuntas di T1 |
| Baseline data demo | Reseed identik: 65 produk, nilai persediaan Rp28.349.600, consistency 11/11 |
| Stack terkunci | Next.js 16.4.3 · React 19 · TypeScript strict · Drizzle · PostgreSQL 18 · Better Auth · Zod · Decimal.js · Tailwind 4/shadcn — tidak diganti |
| Terverifikasi kuat, jangan diutak-atik | Penolakan level modul berbanner jelas; gerbang centang QRIS; halaman sesi kas berselisih live; opname hitung buta + tinjau selisih; form penerimaan terlabel; drill-down laporan → jurnal → dokumen 2 klik; muat halaman lokal <±550 ms (audit A-23) |

Catatan keadaan: `PROGRESS.md` terakhir diperbarui 19:05 (memuat sampai
A-22). Penulisan status A-23 & A-24 ke PROGRESS adalah bagian dari T8.

### 1.3 Empat belas prinsip penerimaan (dari RISET-DOMAIN §4)

Setiap tahap di §2 diukur terhadap prinsip ini; tahap yang melanggarnya
wajib menyebut alasannya tertulis atau ditolak.

1. **Satu komponen per konsep, di semua modul** — satu-satunya field uang
   adalah `MoneyInput`; satu lencana status, kartu statistik, dialog
   konfirmasi, keadaan kosong, bilah filter. Komponen kedua untuk konsep
   yang sama = temuan yang ditutup tahap itu juga.
2. **Satu pola per jenis layar** — daftar (chip status + pencarian + aksi
   seperlunya), form dokumen (baris sebaris + total berjalan + gerbang
   sebelum posting), dialog pembayaran (dari dokumen, nominal terisi
   sisa, keputusan sisa eksplisit), laporan (hierarki + pembanding +
   drill-down).
3. **Satu bahasa status & satu bahasa uang** — kosakata status dokumen
   adalah daftar tertutup lintas modul; format tampil uang = format yang
   diterima input; satuan selalu jelas.
4. **Ketikan manusiawi tidak boleh merusak angka** — setiap field angka
   terformat diuji dengan urutan ketukan digit-per-digit, bukan hanya
   pengisian sekaligus (pelajaran SIS-01).
5. **Setiap angka bisa ditelusur ke sumbernya dalam ≤2 klik** (laporan →
   jurnal → dokumen; dokumen → "Lihat jurnal"). Angka tanpa sumber yang
   bisa dibuka tidak boleh tampil.
6. **Dokumen terposting tidak diedit/dihapus diam-diam** — koreksi hanya
   void, reversal, atau dokumen penyesuaian tercatat.
7. **Workflow inti punya hitungan langkah acuan** (audit A-22/A-23,
   RISET-DOMAIN §1). Rombak tidak menambah langkah workflow inti tanpa
   alasan tertulis.
8. **Peran menentukan dunia pengguna** — menu tersaring izin (kerapian)
   **dan** aksi ditolak di server (keamanan); penolakan selalu tampil
   sebagai penjelasan, tidak pernah sebagai halaman rusak.
9. **Tindakan konsekuensial digerbang sebanding risikonya** — ringkasan
   akibat tampil **sebelum** tombol akhir aktif; tindakan kecil harian
   tetap satu-dua ketuk.
10. **Istilah permukaan = istilah pekerjaan penggunanya** — operasional
    berbahasa toko; istilah akuntansi hanya di modul akuntansi; istilah
    teknis sistem tidak pernah tampil mentah.
11. **Konfigurasi, bukan kode** (perluasan D-25) — tarif, ambang, termin,
    penomoran, pemetaan akun, kategori awal, saklar fitur: per
    perusahaan, bertanggal efektif untuk angka regulasi; komponen
    nonaktif = tidak dihitung, tidak tampil, tidak dijurnal (dibuktikan
    test).
12. **Rombak tampilan tidak menembus domain sembarangan** — patuh ratchet
    jalur baca ARS1-01 (`tests/unit/architecture-read-paths.test.ts`);
    halaman hanya memanggil fungsi baca modul server atau kueri satu
    tabel sah; modul tetap folder per domain di atas core bersama.
13. **Kecepatan adalah fitur yang terukur** — muat halaman operasional
    terukur pada data demo; skeleton meniru tata letak di semua modul;
    pencarian daftar operasional hidup tanpa tombol Cari.
14. **Selesai = terbukti, bukan terasa** — gerbang Pemimpin: suite + e2e
    hijau, tangkapan sebelum/sesudah pada lebar acuan, pengukuran ulang
    workflow yang disentuh, nol overflow terukur; yang belum terbukti di
    lingkungan nyatanya berlabel NOT TESTED tertulis.

---

## 2. Daftar tahap ber-centang

- [x] **T1 — Sisa audit sistem (SIS-05, sisa SIS-07 non-POS, P3 non-POS)** — SELESAI 2026-11-05, commit `55a7484`, suite 1441/1441 (+23 test), e2e 16/16; SIS-05 terbukti hidup utk peran lihat & diperbaiki (form-gate bersama + sapuan 12 titik), SIS-11 cangkang Pengaturan & SIS-12 palet Ctrl+K terbangun; nol berkas POS tersentuh. Bukti: ~/workspace/bukti-a24/
  - **Tujuan:** menutup seluruh sisa temuan audit A-23 yang berada di luar
    wilayah POS dan belum tertangani A-22/A-23 S1, supaya tidak ada
    temuan audit yang menggantung tanpa pemilik.
  - **Cakupan konkret:**
    - **SIS-05 (verifikasi lalu tutup):** halaman Penerimaan untuk peran
      tanpa izin buat menampilkan pemberitahuan yang salah — "Tambahkan
      gudang terlebih dahulu di menu Pengaturan" — padahal gudang ada.
      Catatan sumber: temuan ini dinyatakan audit "lenyap dengan
      sendirinya bila SIS-02 diputuskan kasir = POS saja", dan keputusan
      itu sudah diambil di A-23 S1. Pekerjaan tahap ini: (a) buktikan
      dengan login peran terbatas sungguhan bahwa jalan buntu itu sudah
      tidak terjangkau untuk Kasir; (b) inventarisasi pola pesan
      prasyarat yang sama di halaman gudang/akuntansi lain yang datanya
      tersaring izin (pola — bukan daftar yang dikarang di sini); setiap
      yang masih muncul untuk kombinasi peran × halaman apa pun diganti
      keadaan "mode lihat" yang jujur (peran Anda dapat melihat; membuat
      dokumen adalah peran X) — tidak pernah instruksi prasyarat yang
      tidak benar.
    - **Sisa SIS-07 non-POS:** samakan ke `MoneyInput` bersama (kontrak
      ketik A-23 S1; nilai awal selalu dirender dari `formatMoneyText`,
      bukan string basis data): field nominal di halaman Pengaturan yang
      terbukti tampil mentah 4 desimal — Ambang Maksimum Write-Off
      (tampil `0.0000`), Ambang Persetujuan Penyesuaian Stok (tampil
      `1000000.0000`), Tarif Pajak % (tampil `0.0000`) — di
      `src/app/app/pengaturan/page.tsx`; dan tampilan **harga per baris
      penerimaan** yang tampil `2600.0000` di form penerimaan gudang
      (baris yang sama menampilkan subtotal "Rp 2.600"). Nilai kanonis &
      perilaku posting tidak berubah.
    - **SIS-11 (P3):** Pengaturan keluar dari cangkang Akuntansi —
      `src/app/app/pengaturan/` (halaman utama, `pengguna/`,
      `payroll-indonesia/`) mendapat cangkang netral dengan sidebar
      pengaturan sendiri (Umum, Pengguna & peran, Metode pembayaran,
      Gudang & cabang, Cetak, Modul — mengikuti tab/seksi yang benar-
      benar ada), breadcrumb bukan lagi "Beranda / Akuntansi", terjangkau
      dari beranda dan menu profil. URL tidak berubah.
    - **SIS-12 (P3) + pola S4 riset A-23:** palet perintah Ctrl+K
      sederhana — produk, nota penjualan, dokumen stok, dan halaman —
      yang membuka halaman pemilik yang sudah ada. Indeks dibangun dari
      `NavItem` yang **sudah tersaring peran** secara konstruksi (modul
      terlarang tidak boleh bocor lewat pencarian); tanpa pencarian
      global kedua di luar palet ini (prinsip 1).
    - **Serpihan SIS-15 non-POS (P3):** target sentuh <28px pada tab &
      kontrol halaman Pengaturan dinaikkan mengikuti pola A-22; dialog
      "Pengguna baru" menutup dengan Escape seperti dialog lain di
      sistem.
    - [x] **Butir bersyarat — serpihan izin retur kasir di luar
      terminal: SELESAI sebelum rencana ini terbit.** Laporan re-scope
      A-23 S2 (2026-11-05 21:56) membuktikan serpihannya persis satu:
      template peran Kasir belum memenuhi izin `pos.return` yang
      menggerbangi menu & halaman Retur yang sudah ada. Pemimpin
      mempertahankannya dan ter-commit `7079687` (3 berkas, +24/−3;
      suite pohon hasil 1418/1418) — perubahan kemampuan murni di
      `src/lib/permissions.ts`, nol perubahan tampilan/perilaku POS.
      Seluruh pekerjaan S2 di wilayah POS dikembalikan ke HEAD.
      Catatan ketegangan yang diserahkan ke pemilik: bila "POS jangan
      disentuh" dimaksudkan termasuk kemampuan ini, pengembaliannya
      satu perintah (`git revert 7079687`) dan tidak ada yang
      bergantung padanya.
  - **Di luar cakupan:** seluruh permukaan POS dari inventarisasi SIS-07
    (DITERIMA, modal awal & uang fisik sesi kas, setor/tarik sesi) —
    wilayah A-23 S2; sisipan SIS-15 di terminal POS (pengalih
    Tunggal/Campuran, chip pecahan, strip kredit retur) dan format tanggal
    riwayat sesi (halaman POS); SIS-13 (visibilitas sesi lintas kasir —
    keputusan pemilik POS3-14, §3); SIS-10 (keputusan pemilik, §3);
    SIS-14 paruh POS (kartu kustomisasi nota — halaman POS) — paruh
    gudangnya masuk T3.
  - **Kriteria selesai terukur:** (1) nol field nominal non-POS dari
    inventarisasi audit tampil mentah — terverifikasi dengan mengetik &
    memuat ulang tiap field yang disebut audit; (2) login kasir & staf
    gudang: nol jalan buntu berpesan salah pada rute yang diinventarisasi;
    (3) Pengaturan terender di cangkang netral pada tangkapan 1440 &
    390, breadcrumb benar, nol rute berubah; (4) Ctrl+K sebagai kasir
    tidak mengembalikan satu pun hasil dari modul akuntansi/gudang;
    (5) gerbang tahap penuh hijau (aturan §4).
  - **Bukti wajib:** tangkapan sebelum/sesudah field Pengaturan &
    harga baris penerimaan (nilai terformat), tangkapan cangkang
    Pengaturan baru 1440/390, tangkapan palet Ctrl+K sebagai dua peran
    berbeda, catatan inventarisasi pola SIS-05 (halaman × peran yang
    diperiksa), test regresi untuk penyaringan peran palet.

- [x] **T2 — HR menjadi modul shell sendiri (Opsi A riset teknologi)** — SELESAI 2026-11-05/06, commit `ce2115e`, suite 1470/1470 (+29), e2e 16/16; rute nol berpindah (route group), aksi payroll milik actions/hr.ts, 33 gerbang aksi keluarga payroll bermodul 'hr' per keputusan Pemimpin (matriks saklar teruji sesi asli). Bukti: ~/workspace/bukti-a24/ (t2-*)
  - **Tujuan:** HR berhenti menjadi "tamu" di sidebar akuntansi — modul
    tersendiri di pengalih, beranda, sidebar, dan pendaratan peran —
    sesuai mandat "tiap modul tersendiri, HR karyawan dll semuanya ada
    fungsi tersendiri", **tanpa memindah satu pun rute**.
  - **Cakupan konkret (persis Opsi A, `RISET-TEKNOLOGI.md` §3):**
    - Tambah `"hr"` ke `ModuleKey` + satu entri definisi modul HR di
      `src/lib/modules.ts`: kartu Beranda, entri pengalih modul, sidebar
      sendiri yang itemnya menunjuk **rute yang sama persis** —
      `/app/akuntansi/hr/absensi`, `/app/akuntansi/hr/cuti`,
      `/app/akuntansi/hr/lembur`, `/app/akuntansi/karyawan`,
      `/app/akuntansi/kasbon`, `/app/akuntansi/pinjaman`,
      `/app/akuntansi/klaim`, `/app/akuntansi/payroll`. Grup nav
      "SDM & Payroll" yang hidup di sidebar akuntansi sejak A-22 K5
      berpindah apa adanya menjadi nav modul HR; sidebar akuntansi
      kehilangan grup itu.
    - Penjaga modul: grup rute HR diperlakukan
      `requireModuleAccess("hr")` di titik layout yang relevan
      (mekanisme S1: pantulan + banner, bukan error); deteksi modul aktif
      dari rute memetakan rute-rute HR ke modul `hr`, bukan `akuntansi`,
      di module-shell (sidebar & mobile nav sumber bersama).
    - Izin butir **tidak diganti kuncinya**: tetap
      `payroll.view`/`payroll.manage`; hanya labelnya boleh dinetralkan
      dari "Akuntansi: …" menjadi label modul HR (perubahan teks semata)
      di `src/lib/permissions.ts`.
    - **Kepemilikan kode HR (perluasan Pemimpin 2026-11-05 dari
      CB-A2 audit Graphify):** aksi server payroll yang kini tinggal di
      `src/server/actions/accounting.ts`
      (`runPayrollAction`/`payPayrollAction` & kawanannya) dipindah ke
      berkas aksi milik HR (mis. `actions/hr.ts` di grup rute yang sama)
      dengan re-export kompatibilitas bila ada pemanggil lama —
      pemindahan mekanis murni, nol perubahan perilaku, dibuktikan
      suite payroll yang sama hijaunya. Inilah batas pemisahan kode T2;
      folder domain `src/server/` tidak dirombak di tahap ini.
    - Keanggotaan peran: modul HR terlihat oleh peran pemegang
      `payroll.view` (owner, admin, accountant, peran kustom yang diberi
      izin itu) mengikuti saringan peran ∩ saklar perusahaan yang sudah
      ada; `src/lib/landing.ts` memperlakukan `hr` seperti modul lain —
      pengguna satu-modul HR mendarat di HR.
    - Breadcrumb & label modul pada halaman HR menampilkan HR.
  - **Di luar cakupan:** Opsi B (memindah rute ke `/app/hr/*`) —
    **ditolak** oleh riset teknologi untuk sekarang (penanda buku rusak,
    sapuan ratchet/e2e tidak sebanding); fungsi HR/payroll apa pun
    (domain SIM-2 tidak berubah); perubahan kunci izin.
  - **Kriteria selesai terukur:** (1) matriks visibilitas per peran
    teruji: pemegang `payroll.view` melihat modul HR di pengalih &
    beranda, peran tanpa izin itu (kasir, staf gudang) tidak melihatnya
    dan mengetik URL HR langsung mendapat pantulan + banner; (2) seluruh
    URL HR identik dengan sebelum tahap (nol perubahan href — dibuktikan
    diff nav & test yang menyebut URL tetap hijau tanpa disunting);
    (3) pengguna satu-modul HR (peran kustom uji) mendarat di HR;
    (4) ratchet ARS1-01 tetap hijau; (5) gerbang tahap penuh hijau.
  - **Bukti wajib:** tangkapan pengalih & sidebar HR 1440/390,
    tangkapan beranda dengan kartu HR, tangkapan penolakan untuk kasir,
    test unit matriks modul × peran (pola `tests/unit/landing.test.ts`
    & nav-groups yang sudah ada).
  - **Catatan jujur yang diterima sadar:** URL tetap berbunyi
    `/app/akuntansi/…` untuk modul bernama HR — kejanggalan yang dicatat
    riset teknologi dan diterima; menilainya kembali hanya bila ada
    alasan produk, sebagai tahap tersendiri dengan redirect permanen
    teruji.

- [x] **T3 — Gudang mudah dipakai (audit A-23 wilayah gudang + pola G1–G4)** — SELESAI 2026-11-06, commit `88f6ce0`, suite 1497/1497 (+27; gerbang Pemimpin di pohon final), e2e 16/16, migrasi 0054; barcode-burst prasetel terbatas terbukti aman utk POS. Bukti: ~/workspace/bukti-a24/ (t3-*)
  - **Tujuan:** pekerjaan harian staf gudang — terima barang, kerjakan
    dokumen, opname, sesuaikan stok — menjadi terpandu, scan-first, dan
    terbaca di layar kecil, di atas domain gudang yang sudah teruji
    (FIX-GDG A-17 tidak dibongkar).
  - **Cakupan konkret:**
    - **SIS-09:** sidebar gudang dikelompokkan dengan komponen kelompok
      yang sama seperti akuntansi (`groupNavItems`): Harian (Ringkasan,
      Penerimaan, Penyesuaian, Transfer, Stok opname) · Master & Stok
      (Produk, Pergerakan stok, Reservasi stok, Nilai persediaan) ·
      Pembelian ("Purchase Request" → **"Permintaan Pembelian"**,
      Pesanan pembelian, Retur Pembelian, Rekomendasi beli, Pemasok) ·
      Impor data. Nol href berubah; label Indonesia penuh.
    - **SIS-08:** daftar-daftar gudang bertabel lebar (produk,
      penerimaan, pergerakan, dokumen) mendapat mode kartu di bawah `lg`
      mengikuti pola A-22 K2 — produk: nama, SKU, stok per gudang
      terpilih, HPP/harga, aksi; barcode penuh disembunyikan di tampilan
      daftar kecil. Tabel desktop tidak berubah.
    - **SIS-14 paruh gudang:** panel "Kedaluwarsa & mendekati
      kedaluwarsa" di dashboard gudang dilipat/ringkas saat tidak ada
      batch bermasalah (pola lipatan A-22 di piutang-utang); saat ada
      batch bermasalah, tampil penuh sebagai antrean.
    - **Pola G1 (adopsi penuh sebagai lapisan presentasi):** rute baru
      `/app/gudang/operasi` — Mode Operasi di dalam modul Gudang:
      antrean kartu besar ramah-sentuh untuk operasi yang menunggu
      (penerimaan dari pembelian, transfer menunggu diterima, opname
      berjalan), satu input scan yang selalu fokus; memindai barcode
      operasi membuka dokumen operasi itu; memindai produk menambah/
      memvalidasi baris. Dokumen & domain yang ada (`gudang/penerimaan`,
      `gudang/transfer`, `gudang/dokumen`, `gudang/opname`) tetap
      mesinnya; halaman membaca lewat fungsi baca modul server pemilik
      (ratchet ARS1-01). Pendengar burst memakai generalisasi
      `src/lib/barcode-burst.ts` menjadi utilitas bersama dengan prasetel
      perilaku per konteks.
    - **Pola G2 (adopsi penuh, penyajian):** halaman kerja penerimaan &
      penerimaan transfer menampilkan per baris **diminta · terkonfirmasi
      · selisih** berstatus warna; tombol Terima/Validasi membuka
      ringkasan selisih (ConfirmDialog bersama) bila ada selisih ≠ 0 —
      menyebut baris kurang/lebih dan akibatnya (terima sebagian /
      selisih tercatat, perilaku domain `transfer_difference` yang sudah
      ada) — dan langsung aktif tanpa dialog bila semua baris pas.
    - **Pola G3 (adopsi sebagian sesuai riset):** opname menjadi tugas —
      opname dibuat dengan penanggung jawab (pengguna berperan
      warehouse) dan cakupan (gudang/kategori); Mode Operasi menampilkan
      "tugas saya" untuk yang ditugasi; hitung buta yang sudah ada tidak
      berubah. Penjadwalan siklus otomatis ala Odoo **diturunkan** menjadi
      pengingat berkonfigurasi: frekuensi hitung per gudang/kategori
      sebagai konfigurasi, opname berikutnya yang jatuh tempo tampil
      sebagai kartu antrean di dashboard Gudang — bukan mesin penjadwalan
      otomatis penuh.
    - **Pola G4 (adopsi penuh, penyajian):** penyesuaian stok — alasan
      dipilih dari daftar **terkonfigurasi per perusahaan** (Rusak,
      Kedaluwarsa, Hilang, Koreksi hitung, Lainnya + teks; konfigurasi,
      bukan daftar mati di kode, per prinsip 11); form menampilkan
      **nilai selisih dalam rupiah** (selisih × harga pokok) saat baris
      diisi, dan hubungan dengan ambang persetujuan yang sudah ada
      dinyatakan di form **sebelum** simpan, bukan sebagai penolakan
      sesudahnya.
  - **Di luar cakupan:** terminal POS dalam bentuk apa pun — generalisasi
    `barcode-burst.ts` wajib menjaga perilaku POS **identik byte-perilaku**
    (test POS yang ada adalah kontraknya; komponen terminal tidak
    disunting); domain stok/AVCO/batch (tidak berubah); tanggal
    penarikan & peringatan kadaluarsa ala Odoo (keputusan pemilik, §3);
    daftar "mendekati minimum" di luar definisi menipis kanonis (bukan
    temuan tahap ini).
  - **Kriteria selesai terukur:** (1) workflow gudang audit diukur ulang:
    penerimaan dari Mode Operasi (scan dokumen → scan produk → validasi)
    ≤ langkah jalur lama G1 audit (6) dan tanpa langkah menebak;
    (2) validasi berselisih tidak bisa terlewat tanpa ringkasan selisih
    terbaca (dibuktikan skenario terima-kurang); (3) daftar produk pada
    390px: nol kolom terpotong di luar pembungkus, `scrollWidth ==
    innerWidth` terukur pada semua daftar yang disentuh; (4) penyesuaian
    menampilkan nilai Rp sebelum simpan pada 100% baris uji;
    (5) suite POS & e2e terminal hijau tanpa satu pun test POS disunting
    (bukti generalisasi burst tidak mengubah perilaku); (6) gerbang tahap
    penuh hijau.
  - **Bukti wajib:** tangkapan Mode Operasi (antrean + dokumen terbuka
    via scan) 1440/768/390, tangkapan ringkasan selisih validasi,
    tangkapan daftar produk mode kartu 390, tangkapan form penyesuaian
    bernilai Rp, tabel pengukuran ulang langkah workflow G1–G4 audit.

- [x] **T4 — Akuntansi pola Accurate (di atas hasil A-22)** — SELESAI 2026-11-06, suite 1517/1517 (+20), e2e 16/16; Rincian Jurnal kini di semua dokumen terposting non-POS (8 jenis baru), pemetaan 36 kunci berbahasa transaksi, daftar periksa akhir bulan dari keadaan nyata. Bukti: ~/workspace/bukti-a24/ (t4-*)
  - **Tujuan:** menutup celah kepercayaan & keterbacaan akuntansi yang
    diidentifikasi riset domain dari acuan Accurate — jurnal tidak terasa
    kotak hitam, pemetaan berbahasa transaksi, akhir bulan terpandu —
    sebagai **penyajian di atas mesin A-21/A-22 yang sudah teruji**.
  - **Cakupan konkret (dari RISET-DOMAIN §3.1):**
    - **"Lihat jurnal" satu klik dari setiap dokumen terposting**
      (pola "Rincian Jurnal" Accurate; kriteria penerimaan riset):
      setiap dokumen terposting — penerimaan, pembayaran piutang/utang,
      retur pembelian, penyesuaian stok, beban, transfer bank, dokumen
      saldo awal — punya aksi "Lihat jurnal" dari halaman dokumennya
      yang membuka jurnal terbentuknya (halaman detail jurnal yang sudah
      ada; arah sebaliknya laporan → jurnal → dokumen sudah menjadi
      kekuatan terverifikasi dan tidak diubah). Dokumen tanpa jurnal
      (draf/belum terposting) tidak menampilkan aksi mati — menampilkan
      statusnya. Prinsip 5: ≤2 klik dokumen → jurnal.
    - **Penyajian halaman pemetaan akun berbahasa transaksi:** seksi
      pemetaan akun di Pengaturan dikelompokkan & dilabeli per jenis
      transaksi dengan penjelasan satu baris per kunci (pola Preferensi →
      Akun Accurate), bukan daftar kunci teknis mentah; keadaan pemetaan
      kosong menunjuk persis ke pengaturan ini (pola penolakan D-8 yang
      sudah hidup). Kunci & semantik pemetaan tidak berubah.
    - **Konsistensi penyajian withholding di semua form pembayaran:**
      label, urutan field, dan penjelasan potongan PPh diseragamkan
      mengikuti keadaan A-21 (nominal putusan pengguna, jurnal saat
      membayar, saklar per perusahaan) — penyajian saja.
    - **Daftar periksa akhir bulan terpandu (penyajian):** satu halaman/
      seksi daftar periksa di atas mesin yang sudah ada — langkah →
      status → hasil: tutup periode bertingkat, penyusutan aset,
      peninjauan rekonsiliasi kontrol, tutup buku tahunan — masing-masing
      menaut ke halaman pemiliknya dan menampilkan status nyata dari
      fungsi baca modul server; bukan mesin proses baru, bukan jurnal
      baru.
  - **Di luar cakupan:** kebenaran akuntansi, pemetaan, dan jurnal —
    tidak berubah satu angka pun; laporan (format FIX-R2 tidak diganggu
    selain konsistensi komponen); **dokumen POS (nota & retur penjualan)
    untuk "Lihat jurnal": BERSYARAT** — halaman nota/riwayat berada di
    wilayah `app/pos` yang dinyatakan pengguna tidak disentuh; butir ini
    hanya dikerjakan bila Pemimpin memutuskan halaman nota bukan
    "terminal" dalam arti mandat, dan dicatat sebagai keputusan tertulis
    di laporan tahap. Tanpa keputusan itu, cakupan "setiap dokumen"
    tahap ini = dokumen akuntansi, gudang, dan HR.
  - **Kriteria selesai terukur:** (1) inventarisasi jenis dokumen
    terposting di luar POS: 100% punya aksi "Lihat jurnal" yang membuka
    jurnal yang benar (diverifikasi per jenis dengan dokumen sungguhan:
    nomor jurnal cocok dengan yang terbentuk saat posting); (2) halaman
    pemetaan: nol kunci teknis tampil tanpa label & penjelasan transaksi;
    (3) daftar periksa akhir bulan menampilkan status yang cocok dengan
    keadaan data (periode terbuka/tertutup terverifikasi silang);
    (4) suite akuntansi & test jurnal hijau tanpa penyesuaian angka;
    (5) gerbang tahap penuh hijau.
  - **Bukti wajib:** tangkapan aksi "Lihat jurnal" dari ≥4 jenis dokumen
    berbeda beserta jurnal tujuannya, tangkapan halaman pemetaan baru,
    tangkapan daftar periksa akhir bulan, daftar inventarisasi jenis
    dokumen × status aksi.

- [x] **T4B — Kebersihan arsitektur terukur (dari audit Graphify CB-A1/A3/D1)** — SELESAI 2026-11-06, suite 1517/1517 identik, e2e 16/16; paritas API 55/55+20/20+72/72; helper rollback terpusat (58 berkas); xlsx tetap CDN ter-pin → keputusan pemilik butir baru di §3
  - **Tujuan:** menutup utang struktur yang terukur dari graf & grep —
    berkas raksasa dan helper test tersalin — dengan pemindahan mekanis
    yang dibuktikan suite, BUKAN penulisan ulang logika.
  - **Cakupan:** (a) pecah `src/server/reports.ts` (3.093 baris),
    `supplier-returns.ts` (2.240), dan `hr.ts` (2.521) mengikuti pola
    folder domain FIX-ARS + re-export dari berkas asal, supaya pemanggil
    lama tidak berubah; `schema.ts` TIDAK dipecah (satu skema Drizzle
    memang satu berkas secara idiom). (b) `rollbackTransaction` yang
    terdefinisi ulang di 56 berkas test dipusatkan ke satu helper
    bersama `tests/helpers/` dan semua pemakai beralih (test saja, nol
    perubahan kode produksi). (c) `xlsx` dari tarball CDN: ganti ke
    versi registry HANYA bila terbukti drop-in (API & hasil ekspor
    sama, dibuktikan test ekspor yang ada); bila tidak, tetap dan
    dicatat sebagai keputusan pemilik di §3.
  - **Kriteria selesai:** suite penuh hijau dgn angka tidak turun;
    nol perubahan perilaku (diff hanya pemindahan + import);
    `affected` Graphify pada simpul yang dipecah menunjukkan pemanggil
    yang sama; graf disegarkan (`graphify update .`).

- [x] **T5 — Paket penyebaran lokal Linux (model utama riset teknologi)** — SELESAI 2026-11-06, suite 1517/1517, e2e 16/16; jalur systemd teruji penuh ujung-ke-ujung (pasang 9 dtk, migrasi 55/55, backup terjadwal + restore terverifikasi, update satu putaran); jalur Docker Compose tervalidasi berkas, runtime NOT TESTED (daemon tak bisa jalan di VM ini — tercatat jujur di runbook)
  - **Tujuan:** Bisa ERP bisa dipasang di satu mesin Linux di toko oleh
    non-teknisi dari satu artefak rilis — dan tetap terawat (backup
    otomatis, pembaruan aman) — menutup keadaan hari ini: tidak ada
    Dockerfile, compose yang ada hanya untuk pengembangan dan melarang
    dirinya dipakai produksi.
  - **Cakupan konkret (dari RISET-TEKNOLOGI §1.6 & §2; model utama =
    (a) server lokal Linux di toko; varian resmi kedua = (d) cloud dengan
    artefak yang sama):**
    - **Satu artefak rilis:** build dengan `output: "standalone"` resmi
      Next (langkah divalidasi terhadap panduan di
      `node_modules/next/dist/docs/` versi repo, per aturan riset);
      `.env` produksi yang sama untuk kedua jalur; secret dibangkitkan
      acak saat penyiapan — tidak ada secret bawaan terpublikasi.
    - **Jalur 1 — Docker:** `Dockerfile` multi-tahap (build: pnpm
      install + build standalone → runtime ramping Node LTS: salin
      `.next/standalone`, `.next/static`, `public/`) +
      `docker-compose.prod.yml` (`db`: postgres:18, volume bernama,
      healthcheck `pg_isready`; `app`: image bertag versi bukan
      `latest`, `depends_on` db sehat, healthcheck `GET /api/health`).
      Migrasi adalah langkah eksplisit sekali-jalan yang tercatat, bukan
      sulap saat boot. Compose pengembangan yang ada **tidak**
      dipromosikan.
    - **Jalur 2 — Tanpa Docker:** `install.sh` idempoten: periksa/pasang
      prasyarat (Node LTS, pnpm, PostgreSQL 18 dengan peran `erp` +
      `app_user` sesuai aturan proyek); pengguna sistem `bisa`; ekstrak
      ke `/opt/bisa-erp/releases/<versi>` + tautan
      `/opt/bisa-erp/current`; `.env` produksi di luar folder rilis dan
      tidak pernah ditimpa; migrasi; seed hanya bila DB kosong **dan**
      operator memintanya eksplisit; unit systemd `bisa-erp.service`
      (`Restart=on-failure`, `RestartSec=3`,
      `After=network.target postgresql.service`, `User=bisa`,
      `WantedBy=multi-user.target`); akhiri dengan memeriksa
      `GET /api/health` sampai 200 atau gagal dengan pesan jelas.
    - **Backup otomatis terjadwal:** systemd timer harian menjalankan
      `scripts/backup.sh` yang sudah ada (pg_dump format custom via
      `DIRECT_URL`; `BACKUP_PASSPHRASE` untuk salinan yang meninggalkan
      mesin) dengan retensi tertulis di satu tempat konfigurasi (usulan
      bawaan riset: 14 harian + 4 mingguan). Salinan offsite adalah opsi
      **mati secara bawaan**, diaktifkan pemilik. Restore mengikuti
      `docs/RUNBOOK-BACKUP-RESTORE.md` yang sudah terbukti (termasuk
      jebakan RT-03 grant `app_user`).
    - **Pembaruan aman:** `update.sh` (atau padanannya di jalur
      Compose) dengan urutan yang tidak bisa dilompati: backup dulu
      (gagal = batal) → artefak baru di samping yang lama → migrasi maju
      → alihkan `current`/tag → restart → verifikasi health + login +
      satu halaman per modul. Dokumentasi menyatakan terus terang:
      rollback versi = restore backup, bukan downgrade kode.
    - **Runbook pemasangan untuk non-teknisi:** dokumen Bahasa Indonesia
      berlangkah bernomor (pola bantuan Accurate): prasyarat mesin,
      pemasangan per jalur, membuka di terminal kasir (alamat LAN),
      backup & restore, pembaruan, pemecahan masalah dasar (layanan
      mati, listrik padam → autostart).
  - **Di luar cakupan:** pembungkus native Tauri/Electron (ditunda oleh
    riset, pemicu evaluasi tertulis di RISET-TEKNOLOGI §1(c)); PWA/
    service worker (tahap pengerasan sesudah model utama terbukti —
    kebutuhannya diputuskan dari bukti T6 skenario B); endpoint cetak
    ESC/POS & jalur perangkat keras lanjutan (uji perangkat §1.6 butir 3
    adalah pekerjaan perangkat tersendiri bila toko percontohan
    membutuhkannya); konsolidasi multi-toko antar-server (tidak
    dijanjikan dari model ini).
  - **Kriteria selesai terukur (bukti pemasangan riset §1.6 butir 1):**
    (1) pada mesin/VM Linux bersih, pemasangan hanya dengan artefak +
    runbook tahap ini berhasil sampai halaman login terlayani — waktu
    pemasangan terukur dan tercatat; (2) seed demo berjalan dan angka
    baseline cocok (65 produk, Rp28.349.600); (3) `GET /api/health`
    200; (4) timer backup menghasilkan berkas cadangan pertama dan
    **restore-nya diuji** pada DB uji (cadangan tanpa uji restore tidak
    dihitung); (5) satu putaran `update.sh` ke versi boneka berhasil
    dengan urutan backup-→migrasi-→verifikasi terbukti dari log;
    (6) gerbang tahap penuh hijau (suite tidak berubah perilaku).
  - **Bukti wajib:** log pemasangan bersih + waktu, tangkapan halaman
    login dari mesin uji, log timer & uji restore, log pembaruan,
    berkas artefak (`Dockerfile`, `docker-compose.prod.yml`,
    `install.sh`, unit & timer systemd, `update.sh`, runbook).

- [x] **T6 — Pembuktian offline POS (mencabut NOT TESTED sejauh bukti)** — SELESAI 2026-11-06, commit `cad8a66`, suite 1525/1525, e2e 18/18; skenario A/B/C PASS dgn angka; 2 cacat BROKEN ditemukan & diperbaiki (quote lokal + antre dari catch). Dokumen: docs/OFFLINE_POS_ARCHITECTURE.md
  - **Dokumen resmi:** hasil tahap ini ditulis ke `docs/OFFLINE_POS_ARCHITECTURE.md` (master prompt §12): model source-of-truth, identitas transaksi & idempotency, urutan sinkronisasi, aturan konflik, dan perbandingan Tauri/Electron/PWA dari RISET-TEKNOLOGI sebagai dasar keputusan.
  - **Tujuan:** status offline POS yang sejak SIM-2 berlabel **PARTIAL —
    uji browser offline sungguhan NOT TESTED** diganti bukti: tiga
    skenario riset teknologi dijalani apa adanya, cacat yang terbukti
    ditemukan diperbaiki pada lapis offline & sinkronisasi.
  - **Cakupan konkret (dari RISET-TEKNOLOGI §1.6 butir 2; saklar
    `pos_offline_enabled` per perusahaan dinyalakan untuk pengujian):**
    - **Skenario A — jaringan peramban putus di tengah sesi:** terminal
      termuat, sesi kas terbuka → `context.setOffline(true)` → 3
      penjualan (tunai, QRIS, campuran) → antrean IndexedDB berisi 3
      item → `setOffline(false)` → sinkron berjalan → ketiga penjualan
      muncul di riwayat, stok berkurang tepat, jurnal seimbang.
      Batas resmi emulasi Playwright dihormati tertulis: skenario ini
      tidak membuktikan apa pun tentang membuka terminal dari keadaan
      tertutup.
    - **Skenario B — server mati sungguhan:** proses server dihentikan
      (systemctl stop / hentikan kontainer) di tengah hari → terminal
      yang sudah termuat tetap menjual ke antrean → server dinyalakan →
      sinkron → angka sama seperti skenario A. Dilanjutkan reload
      halaman saat server mati dan hasilnya **dicatat apa adanya**
      (keadaan hari ini: gagal termuat).
    - **Skenario C — konflik:** selagi terminal offline, harga produk
      diubah dan stok produk lain dikosongkan dari perangkat lain →
      terminal menjual keduanya → sinkron → hasil per item
      (`conflict`/`failed` dari kontrak `syncOfflineSalesAction` yang
      ada) tertangani sesuai kontrak dan kasir melihat penjelasan di
      halaman Peninjauan offline — bukan kehilangan penjualan diam-diam.
    - **Perbaikan cacat terbukti:** setiap kegagalan skenario menjadi
      temuan bernomor; perbaikan **dibatasi** pada `src/lib/pos-offline.ts`,
      hook antrean (`src/components/pos/use-offline-queue.ts`), aksi
      sinkronisasi (`src/server/actions/pos-offline.ts`), dan halaman
      Peninjauan offline — dengan test regresi per cacat.
    - **Putaran manual akhir:** satu putaran pada peramban Chromium
      sungguhan di mesin Linux (bukan hanya headless) dicatat bertanggal
      sebagai bukti akhir sebelum status NOT TESTED dicabut.
    - [ ] **Butir bersyarat — pengerasan PWA terbatas:** hanya bila
      bukti reload skenario B menunjukkan kebutuhan dan Pemimpin
      memutuskan membangunnya: precache app-shell + satu rute terminal
      (+ snapshot katalog lokal) mengikuti batas jujur riset §1(b),
      termasuk keputusan secure context LAN (HTTPS lokal/localhost).
      Tanpa keputusan itu, hasil reload dicatat sebagai batas yang
      diketahui dan butir ini dicentang "tidak dibangun — keputusan
      tercatat".
  - **Di luar cakupan:** desain ulang terminal POS dalam bentuk apa pun
    (komponen terminal tidak disunting selain hook antrean bila cacat
    terbukti berasal dari sana — dan setiap sentuhan semacam itu
    dilaporkan tersendiri); mode offline untuk modul gudang/akuntansi
    (tidak ada dan tidak dijanjikan); perubahan kontrak sinkronisasi
    (hasil per item & kunci idempotensi yang ada adalah kontraknya).
  - **Kriteria selesai terukur:** (1) ketiga skenario LULUS dengan
    kriteria yang ditulis **sebelum** dijalankan (angka riwayat, stok,
    jurnal cocok); (2) setiap cacat yang ditemukan punya test regresi
    hijau; (3) putaran manual Chromium sungguhan tercatat; (4) status
    resmi di PROGRESS & spek ditulis ulang persis sebatas bukti: bagian
    yang lulus dicabut dari NOT TESTED, bagian yang tidak (mis. reload
    dari tertutup, bila tak dibangun) tetap berlabel jujur;
    (5) gerbang tahap penuh hijau.
  - **Bukti wajib:** berkas e2e skenario A & C (Playwright repo),
    catatan/log skenario B + putaran manual bertanggal, daftar temuan
    cacat × perbaikan × test regresinya, tangkapan halaman Peninjauan
    offline untuk hasil konflik.

- [x] **T6B — Pengerasan PWA terbatas (keputusan Pemimpin dari bukti T6 skenario B)** — SELESAI 2026-11-06, suite 1538/1538 (+13), e2e 19/19; skenario B lulus dua jalur bukti (server dibunuh sungguhan + spec harness); batas secure-context tertulis di OFFLINE_POS_ARCHITECTURE §9
  - **Alasan:** reload saat server mati = `ERR_CONNECTION_REFUSED` —
    terminal tidak bisa DIBUKA sama sekali tanpa service worker,
    padahal antreannya sendiri terbukti selamat & benar (T6).
    Mandat inti pengguna (POS tetap bisa dipakai saat mati)
    menuntut terminal bisa dibuka kembali.
  - **Cakupan TERBATAS:** `manifest.webmanifest` + service worker
    yang meng-cache HANYA shell terminal POS (halaman & aset statis
    yang dibutuhkan utk membuka terminal), strategi cache yang tidak
    pernah menyajikan data bisnis basi sebagai data segar (data tetap
    dari server/antrean; SW hanya utk shell & aset). Nol perubahan
    desain/perilaku terminal; registrasi SW tidak boleh mengganggu
    alur normal (dibuktikan e2e lama tetap hijau + skenario reload
    server-mati kini membuka terminal dari cache & antrean T6 tetap
    bekerja).
  - **Batas jujur yang wajib tertulis di dokumen:** service worker
    butuh secure context (HTTPS atau localhost) — di model server
    lokal, terminal di mesin server (localhost) memetik manfaatnya;
    terminal LAN via http://IP tidak (keputusan pemilik: HTTPS lokal
    / sertifikat internal adalah pekerjaan lanjutan tersendiri).
  - **Kriteria selesai:** skenario B diulang — reload dgn server mati
    membuka terminal dari cache; penjualan offline tetap mengantre
    & tersinkron saat server hidup; suite + e2e penuh hijau;
    OFFLINE_POS_ARCHITECTURE.md diperbarui dgn hasil & batasnya.

- [x] **T7 — Verifikasi fungsi menyeluruh (matriks fitur per modul)** — SELESAI 2026-11-06, suite 1540/1540, e2e 19/19; matriks 61/61 LULUS (nol inti BELUM DIUJI), probe peran 11/11, invariant SQL 0/0/0; cacat higiene seed diperbaiki + penjaga permanen. Laporan: docs/TESTING_REPORT.md
  - **Tujuan:** tidak ada fitur yang "diklaim berfungsi" tanpa bukti —
    memperluas preseden Matriks Verifikasi Fitur proyek (A-5) ke semua
    modul, dijalani ujung-ke-ujung pada aplikasi sungguhan, pada hasil
    T1–T6.
  - **Cakupan konkret (format RISET-TEKNOLOGI §4):** dokumen matriks
    program (satu baris per fitur) dengan kolom: **ID** stabil per modul
    (`POS-…`, `GDG-…`, `AKT-…`, `HR-…`, `PLT-…`) · Fitur (nama
    sebagaimana terlihat pengguna) · Peran penguji (yang seharusnya bisa
    **dan** yang seharusnya tidak bisa) · Skenario ujung-ke-ujung
    (langkah di aplikasi sungguhan + hasil terharap terukur: dokumen/
    nomor yang terbit, angka jurnal/stok/saldo yang harus cocok) ·
    Bukti otomatis (berkas test yang menaungi, atau `—`) · Bukti manual
    (tangkapan/catatan putaran bertanggal) · Status (`LULUS` /
    `SEBAGIAN` / `GAGAL` / `BELUM DIUJI`) · Commit & tanggal uji.
    Cakupan baris per modul mengikuti §4 riset teknologi: POS (jual
    tunai/kredit/campuran, diskon & kelompok harga, retur, sesi kas,
    offline hasil T6), Gudang (penerimaan 3 skenario, PO/PR, retur
    pembelian, transfer, reservasi, opname, penyesuaian, impor),
    Akuntansi (jurnal, beban, transfer bank + biaya, piutang/utang +
    kredit pihak, fee/potongan/write-off, rekonsiliasi, laporan +
    pembanding, tutup periode & tahun), HR (karyawan, absensi/cuti/
    lembur, payroll + komponen, kasbon, pinjaman, klaim), Pengaturan &
    platform (pengguna & peran, metode bayar, pengaturan perusahaan,
    backup/restore, `/api/health`).
  - **Aturan tindak lanjut (mengikat):** setiap baris `GAGAL` — dan
    setiap `SEBAGIAN` pada fitur inti — menjadi **tahap perbaikan
    tersendiri yang dicatat sebagai butir baru di §2 rencana ini**
    (bernomor T7a, T7b, … dengan cakupan & kriteria sendiri) dan
    dikerjakan + diuji ulang (baris terdampak + regresi penuh)
    **sebelum** program ditutup. Fitur yang merupakan keputusan pemilik
    (§3) tidak masuk matriks sebagai `GAGAL` — dicatat terpisah sebagai
    keputusan tertunda.
  - **Di luar cakupan:** pembangunan fitur baru yang tidak terkait
    kegagalan matriks; pengujian perangkat keras fisik (printer/scanner
    — langkah pembuktian tersendiri riset §1.6 butir 3, statusnya
    dicatat apa adanya di matriks sebagai bukti manual bila sudah
    dilakukan).
  - **Kriteria selesai terukur:** (1) 100% fitur inti berstatus `LULUS`
    (skenario lewat UI/aksi resmi dengan peran yang benar; peran yang
    salah ditolak rapi; invariant cocok: jurnal seimbang,
    `stock_on_hand` = Σ `stock_movements`, ringkasan bulanan = agregat
    jurnal); (2) fitur inti punya bukti otomatis **dan** bukti manual;
    (3) nol baris `BELUM DIUJI` pada fitur inti; (4) semua tahap
    perbaikan turunan (T7a…) selesai & ter-centang; (5) gerbang tahap
    penuh hijau.
  - **Bukti wajib:** dokumen matriks terisi lengkap dengan commit &
    tanggal per baris, tangkapan putaran manual per modul, daftar tahap
    turunan yang lahir dari matriks beserta hasil uji ulangnya.

- [x] **T8 — Gerbang final & rilis program A-24** — SELESAI 2026-11-06: gerbang dari reseed bersih test 1540/1540, typecheck/lint/build 0, e2e 19/19; pengukuran ulang workflow semua peran berhasil; sapuan 67 pemeriksaan 0 error (satu temuan beku: /app/pos/sesi 390px, wilayah pemilik); set dokumen resmi tertulis; graf akhir 6.258 node/23.014 edge
  - **Tujuan:** menutup program dengan standar yang sama seperti
    program-program sebelumnya: gerbang dijalankan Pemimpin sendiri,
    workflow diukur ulang, status resmi ditulis, paket rilis dikirim.
  - **Cakupan konkret:**
    - Gerbang penuh dari reseed bersih: suite test, typecheck, lint,
      build, e2e — semua **tanpa pipa penutup** (exit code dibaca
      langsung), reseed identik baseline (65 produk, Rp28.349.600,
      consistency 11/11).
    - **Pengukuran ulang workflow per peran:** tabel langkah audit A-23
      (kasir K1–K6, gudang G1–G6, pemilik P1–P2) dan 9 workflow audit
      A-22 dijalani ulang pada build final; hasil sebelum → sesudah
      ditulis berdampingan; workflow inti tidak bertambah langkah tanpa
      alasan tertulis (prinsip 7); dua workflow yang berubah status
      dicatat eksplisit: retur kasir (K5: tidak ada jalur → keadaan
      sesudah keputusan/re-scope) dan offline (status bukti T6).
    - **Uji visual multi-lebar:** permukaan yang disentuh T1–T6 pada
      1440/768/390 (POS juga 1100): nol overflow terukur
      (`scrollWidth <= innerWidth`), aksi utama terjangkau.
    - **PROGRESS.md diperbarui:** seksi program A-24 lengkap per tahap
      (pola §0F), status A-23 (S1 & hasil re-scope S2) ditulis masuk,
      daftar keputusan pemilik diselaraskan dengan §3 rencana ini,
      header tanggal diperbarui.
    - **ZIP rilis** dibangun dari commit final (`git archive`), jumlah
      entri & integritas diverifikasi (`testzip`), dan dikirim ke
      pengguna sebagai lampiran laporan penutup.
    - **Scheduler dimatikan:** penjadwal kelanjutan otomatis program
      ini dihentikan pada penutupan; item pelacakan A-24 ditutup
      `completed` dengan entri hasil.
  - **Di luar cakupan:** pekerjaan baru apa pun — temuan yang muncul di
    gerbang final menjadi tahap perbaikan tercatat (pola T7) atau
    daftar keputusan, bukan dikerjakan diam-diam di tahap penutup.
  - **Kriteria selesai terukur:** semua angka gerbang hijau pada larian
    Pemimpin; tabel pengukuran ulang terisi; PROGRESS & ZIP terbit dari
    commit yang sama persis dengan yang lulus matriks T7; scheduler
    terbukti mati; nol butir tahap di §2 yang belum ter-centang atau
    belum berkeputusan tertulis.
  - **Bukti wajib:** keluaran gerbang lengkap, tabel sebelum/sesudah
    workflow, tangkapan multi-lebar, tautan berkas ZIP rilis.

---

## 3. Butir menunggu keputusan pemilik (BUKAN tahap eksekusi)

Dikumpulkan dari RISET-DOMAIN §5, PROGRESS §0D/§0C, dan sisa program
sebelumnya. Tidak satu pun dikerjakan dari rencana ini; masing-masing
baru menjadi tahap bila pemilik memutuskan — dan keputusan itu dicatat
sebagai keputusan baru di PROGRESS.

1. **Tutup sesi terpandu di wilayah POS (SIS-10)** — tutup sesi kas hari
   ini satu klik tanpa konfirmasi/selisih akhir; pola perbaikannya jelas
   (ringkasan seharusnya/dihitung/selisih ala Closing Register Odoo),
   tetapi wilayahnya terminal POS yang dinyatakan pengguna tidak
   disentuh. Perlu konfirmasi eksplisit: apakah gerbang tutup sesi
   dikecualikan dari larangan itu?
2. **PIN supervisor POS** (POS3-12, menunggu sejak D-10) — override
   diskon besar, void, refund tanpa nota: cukup izin peran + audit, atau
   wajib PIN per tindakan? Bila wajib: pemegangnya siapa, PIN per orang
   atau per toko?
3. **Maker-checker Purchase Order** (GDG3-P3) — PO di atas nilai
   tertentu wajib disetujui orang lain sebelum barangnya bisa diterima?
4. **Promosi bertanggal** (RISET-DOMAIN §2 baris 25) — dibangun sebagai
   fitur (harga promo mulai/berakhir otomatis per produk/kategori),
   atau cukup diskon kelompok + diskon manual berambang seperti sekarang?
5. **Peringatan kadaluarsa bertingkat** (RISET-DOMAIN §2 baris 24, pola
   Odoo empat tanggal) — perluas model batch dengan tanggal penarikan &
   peringatan, atau cukup kadaluarsa + daftar "menuju kadaluarsa"?
6. **Konversi multi-satuan** (D-17) — beli per karton, jual ecer:
   membuka kembali keputusan tidak-membangun?
7. **Tender kredit pihak di terminal POS** (penundaan tercatat A-21
   R3-B; domain pembayaran tercakup, UI terminal belum).
8. **Refund tunai atas kredit pihak tak terpakai** (penundaan tercatat
   A-21 R3-B).
9. **Git remote + branch protection + required CI** (ARS4-01 — CI sudah
   tertulis & tervalidasi lokal; status GitHub NOT TESTED sampai remote
   ada; satu-satunya P1 arsitektur yang tidak bisa ditutup dari kode).
10. **Tujuh keputusan kebijakan SIM-2** (daftar di PROGRESS §0D/§0).
11. **Matriks ECL** (cadangan kerugian piutang).
12. **Write-down NRV** persediaan.
13. **Berkas ekspor ulang Accurate Opsi A.**
14. **Gerbang harga pada bulk-edit massal** (matriks RBAC hari ini
    memberinya ke peran warehouse).
15. **Pembatasan gudang per pengguna** (GDG3 P3).
16. **Saklar riwayat lintas-kasir per perusahaan** (POS3-14; ditegaskan
    audit SIS-13: keadaan bawaan hari ini terbuka — semua kasir melihat
    sesi & selisih kasir lain).
17. **Pemetaan khusus akun PPh atas bunga** di model cepat rekonsiliasi
    (sisa A-22 K3 — hari ini heuristik nama akun; kandidat pemetaan
    khusus bila pemilik menginginkan).
18. **Kedalaman investasi offline & perangkat konter** (RISET-DOMAIN
    §5 butir 6) — bentuk penyebaran sudah direkomendasikan riset
    teknologi (server lokal Linux, T5) dan pembuktiannya berjalan di
    T6; yang tetap milik pemilik: apakah toko harus bisa menjual penuh
    saat internet mati berjam-jam (menentukan nasib butir PWA bersyarat
    di T6) dan perangkat apa yang benar-benar dipakai di konter
    (menentukan uji perangkat keras).

---

19. **xlsx dari tarball CDN SheetJS (dari T4B, 2026-11-06):**
    registry npm mentok 0.18.5 yang mendahului perbaikan CVE
    polusi-prototipe (0.19.3) & ReDoS (0.20.2); repo memakai 0.20.3
    ter-pin dgn integritas lockfile & test SEC-05 yang menegaskan
    versi itu. Pilihan pemilik: (a) pertahankan (rekomendasi
    Pemimpin), (b) setujui migrasi ke pustaka spreadsheet lain
    (penulisan ulang fitur ekspor/impor Excel, bukan drop-in).

### 3.1 Keputusan Pemimpin atas ambiguitas sumber (2026-11-05, sebelum eksekusi)

1. **T5 mengantar KEDUA jalur pengemasan** (Docker Compose produksi
   DAN install.sh + systemd) dari satu artefak bersama, mengikuti
   bingkai RISET-TEKNOLOGI §2 — bukan salah satu.
2. **Dokumen POS di luar T4**: aksi "Lihat jurnal" untuk dokumen
   penjualan/retur POS TIDAK dibangun di T4 selama batas "POS jangan
   disentuh" berlaku; halaman nota/riwayat dianggap wilayah POS.
   Butirnya hidup di daftar keputusan §3 sampai pemilik mengizinkan.
3. **Generalisasi `barcode-burst.ts` di T3 diizinkan terbatas**:
   perubahan lib bersama boleh bila perilaku terminal terbukti tidak
   berubah (suite POS + e2e = kontrak) dan nol suntingan pada
   komponen terminal; bila bukti itu tidak bisa diberikan, butir
   dibatalkan, bukan dipaksakan.
5. **Utang arsitektur Graphify (CB-A1/A3/D1) menjadi tahap T4B**
   (bukan sisa oportunistik), dan kepemilikan kode aksi payroll
   dipindah ke HR di T2 (CB-A2). Dokumen resmi master prompt
   (ERP_WORKFLOW, ARCHITECTURE, DATABASE_DESIGN, BUSINESS_RULES,
   DEVELOPMENT_GUIDE, MODULE_BOUNDARIES) ditulis di T8 dari bahan
   riset/audit yang sudah ada; OFFLINE_POS_ARCHITECTURE di T6.
   Konversi multi-satuan tetap mengikuti keputusan pemilik D-17
   (ditolak) sampai pemilik mengubahnya — master prompt §7 tidak
   mengalahkan keputusan tercatat pemilik.
4. **SIS-05** dikerjakan sebagai verifikasi-lalu-tutup (sesuai
   catatan audit sendiri bahwa ia mungkin sudah lenyap oleh
   keputusan SIS-02), bukan sebagai cacat yang diasumsikan ada.

## 4. Aturan main program

Pola yang terbukti di program A-15 sampai A-23; mengikat semua tahap §2.

1. **Agen per tahap tidak pernah commit.** Agen mengerjakan satu tahap,
   menjalankan gerbangnya, dan melapor (per butir: keputusan, berkas,
   bukti, angka gerbang, penyesuaian test + alasan, sisa jujur).
2. **Pemimpin memverifikasi sebelum mencentang:** membaca diff tahap,
   menjalankan ulang test tahap (dan test kunci tahap sebelumnya yang
   disentuh), memeriksa bukti visual dengan mata sendiri — baru commit
   atomik per tahap dan mencentang butirnya di §2 berkas ini. Klaim
   lisan agen tidak pernah menjadi dasar centang (pola yang berulang
   sejak F20/F22/R5).
3. **Gerbang tanpa pipa penutup.** Perintah test/build/lint dijalankan
   tanpa `| tail` dan sejenisnya; exit code dibaca langsung (pipa pernah
   menghasilkan klaim "build lulus" yang salah).
4. **Satu pohon kode, satu tahap, satu waktu.** Tahap berjalan berurutan;
   paralel hanya untuk pekerjaan baca-saja (riset/audit) atau folder yang
   benar-benar terpisah. Dua agen tidak menyunting pohon yang sama
   bersamaan (pola kontaminasi yang terbukti merusak gerbang).
5. **Di dalam tahap, TDD & debugging sistematis:** test regresi ditulis
   dari reproduksi cacat (RED) sebelum perbaikan (GREEN); kegagalan
   diselidiki akarnya, bukan ditambal gejalanya; penyesuaian test lama
   selalu dinyatakan dengan alasan — tidak ada test yang dilemahkan
   diam-diam.
6. **Keputusan pemilik tidak dieksekusi diam-diam.** Yang termasuk §3
   berhenti di daftar itu; agen yang menemukan kebutuhan keputusan baru
   mencatatnya ke §3 lewat Pemimpin, tidak membangunnya setengah-setengah
   (preseden: fee POS & PIN supervisor).
7. **Label jujur sampai terbukti.** Status PARTIAL / NOT TESTED /
   SEBAGIAN hanya berubah sesudah bukti pada lingkungan nyatanya ada
   (preseden: offline POS). Fitur simulasi tidak pernah disajikan
   sebagai fitur nyata.
8. **Data demo dijaga:** bukti visual & uji manual boleh memakai data
   demo, tetapi setiap tahap berakhir dengan demo tereseed ke baseline
   (65 produk, Rp28.349.600) dan tidak ada konfigurasi panggung yang
   tertinggal (pelajaran gerbang A-21: fee QRIS panggung menggagalkan
   test yang tidak terkait).
9. **Penyimpangan dicatat, bukan disembunyikan.** Setiap tahap yang
   menyimpang dari rencana ini — cakupan, urutan, atau pendekatan —
   menulis alasannya di laporan tahap; rencana diperbarui oleh Pemimpin,
   bukan oleh agen tahap.
10. **Setiap tahap berakhir pada gerbang yang sama** (suite penuh +
    typecheck + lint + build + e2e hijau) sebelum tahap berikut mulai.
