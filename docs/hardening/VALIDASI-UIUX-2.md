# Validasi UI/UX Putaran 2 — Inspeksi Screenshot Langsung oleh Pemimpin (2026-11-07)

Sumber bukti: screenshot final A-28 (`~/workspace/bukti-a28/final/`, 15 berkas) + set audit U0 (26 permukaan) — dibaca langsung satu per satu untuk permukaan kunci (beranda, POS terminal, Kas & bank, Laba rugi, Pengaturan cetak, Payroll, Opname) + pemeriksaan kode cangkang (`src/components/shell/sidebar-nav.tsx`, `module-shell.tsx`).

## Yang tervalidasi SEHAT (sesuai standar internasional, bebas AI slop)

- **Satu bahasa visual di semua modul**: sidebar terang, satu warna aksen (plum merek), ikon Lucide satu gaya + label 13px, grup berkepala kapital kecil, item aktif berpenanda bilah kiri — pola yang sama dipakai Odoo 19/Linear/Shopify. Tidak ada gradien generik, glassmorphism, emoji dekoratif, atau kartu melayang tanpa makna.
- **POS**: hierarki benar — pencarian terfokus, grid produk, panel bayar tetap di kanan, satu tombol Bayar dominan; placeholder F2 kini nyata.
- **Laporan**: komparatif dua tahun, total tegas, aksi ekspor/cetak terlihat; **Opname & tutup sesi**: konsep hitung buta terkomunikasikan jelas di layar.
- **Pengaturan cetak**: pratinjau langsung berdampingan dengan formulir — standar aplikasi profesional.
- Angka selalu terformat id-ID, tanggal satu format, label Bahasa Indonesia konsisten.

## Temuan

### V-01 (P1) — Sidebar TIDAK bisa dikecilkan ke mode ikon
Terbukti kode: `sidebar-nav.tsx` hanya merender ikon+label; tidak ada keadaan ringkas di seluruh cangkang. Lebar tetap ±238px. Modul Akuntansi memuat 14 item/3 grup — di laptop 1366px sidebar memakan hampir seperlima layar selamanya. Standar internasional (Odoo, Zoho, Linear, Microsoft 365) menyediakan mode ikon-saja yang diciutkan pengguna.
**Saran**: tombol ciut di kaki sidebar → mode ikon 56–64px; tooltip label saat hover; lencana antrean tetap tampil (titik/angka kecil); grup menjadi garis pemisah tipis; pengalih aplikasi tetap berfungsi dari ikon; preferensi tersimpan per pengguna (localStorage cukup); di layar sempit bawaan ikut ringkas. Target sentuh ikon tetap ≥ 44px tinggi baris.

### V-02 (P1) — Navigasi GANDA di Pengaturan
Screenshot Pengaturan menunjukkan DUA kolom navigasi: sidebar modul + daftar nav kedua di dalam konten, dengan item yang sama persis muncul dua kali (Pengguna & peran, Cetak, Pemetaan akun, Modul, Kolom kustom). Membingungkan ("yang mana yang benar?") dan membuang ±210px lagi.
**Saran**: satu pintu — daftar dalam-konten dibuang; navigasi Pengaturan hidup di satu tempat (cangkang pengaturan yang sudah ada). Semua item tetap terjangkau dari satu daftar.

### V-03 (P2) — Kartu produk POS renggang
Kartu grid meregang tinggi: nama di atas, harga menempel di bawah, ruang kosong besar di tengah. Terlihat kosong dan mengurangi produk tampil per layar.
**Saran**: tinggi kartu mengikuti isi (harga tepat di bawah nama, stok sejajar), lebih banyak baris per layar; mode padat yang sudah ada dipertimbangkan jadi bawaan di layar ≤ 1366px.

### V-04 (P3) — Beranda: dekorasi pastel & jalan pulang
Lingkaran pastel samar di sudut kartu modul adalah satu-satunya elemen dekoratif murni di seluruh sistem — halus dan sewarna merek, tetapi tetap dekorasi tanpa fungsi. Jalan kembali ke Beranda dari dalam modul juga tidak eksplisit (mengandalkan pengalih modul/logo).
**Saran**: buang blob pastel (atau biarkan — selera pemilik; rekomendasi Pemimpin: buang demi nol dekorasi), dan pastikan logo/pengalih memuat "Beranda" yang jelas.

### V-05 (catatan) — Target sentuh sidebar
Tinggi baris sidebar ±29px: tepat untuk mouse/desktop (standar ERP padat), di bawah pedoman sentuh 40px+. Terminal POS punya permukaannya sendiri sehingga ini bukan cacat; dicatat agar mode ikon V-01 tidak memperkecil target di bawah 44px pada perangkat sentuh.

### V-06 (P3) — Laporan serba-nol terlihat berulang
Saat semua kelompok hampa, "Tidak ada mutasi" berulang per kelompok memenuhi layar.
**Saran**: bila seluruh kelompok hampa, tampilkan satu keadaan kosong ringkas; struktur kelompok kembali begitu ada mutasi.

## Urutan rekomendasi Pemimpin
1. **V-01 sidebar ciut-ke-ikon** (permintaan langsung pemilik + dampak harian terbesar).
2. **V-02 navigasi Pengaturan satu pintu**.
3. **V-03 kartu POS padat**.
4. V-04 + V-06 (kecil, satu paket poles penutup).

## Status implementasi (2026-11-07 — disetujui pemilik penuh 15:12 WIB; belum di-commit, menunggu Pemimpin)

Gerbang dari reseed bersih: **suite 1883/1883 (200 berkas; 1872 baseline A-28 + 11 test baru)**, typecheck exit 0, lint 0 error, build sukses, **e2e 22/22**, baseline demo utuh (65 produk, Rp28.349.600). Bukti visual: `~/workspace/bukti-a28/validasi2/` (01 terbuka, 02 ringkas Akuntansi, 03 ringkas POS, 04 Pengaturan, 05 grid POS, 06 beranda, 07 laporan kosong) — semua dibaca & diverifikasi.

- **V-01 — SELESAI.** Komponen bersama baru `SidebarFrame` (`src/components/shell/sidebar-frame.tsx`) dipakai kedua cangkang: lebar ciut 64px, item ikon-saja 44px dengan tooltip label (pola Tooltip repo, isi = label + "· N menunggu" bila berlencana), lencana pil angka menempel ikon, grup → pemisah tipis, pengalih aplikasi → ubin ikon modul, kartu pengguna → avatar saja. Kepala/kaki (komponen server) menyesuaikan lewat aturan CSS `data-collapsed` di `globals.css`. Tombol ciut/lebar di kaki nav semua cangkang; terbukti hidup lewat klik UI sungguhan pada screenshot 02→03→05. **Penyimpangan terencana dari bunyi saran**: preferensi disimpan di **cookie** `bisa_sidebar_collapsed`, bukan localStorage — cookie dibaca server (`ModuleShell`/`SettingsShell`) sehingga HTML pertama sudah selebar mode akhir, tanpa kedip; alasan tertulis di `src/lib/sidebar-pref.ts`. Bawaan: terbuka; tanpa cookie, viewport < 1280px berangkat ringkas (1280px persis tetap terbuka).
- **V-02 — SELESAI.** Daftar dalam-konten dibuang: `SettingsPageFrame` tidak lagi membangun nav; `SettingsLayout.nav` menjadi opsional (konten lebar penuh tanpa nav; hub HR tetap memakai nav jangkarnya). Pemetaan 12 item → sidebar tunggal, href tak berubah: Umum `?tab=umum` · Pengguna & peran `/app/pengaturan/pengguna` · Payroll Indonesia `/app/pengaturan/payroll-indonesia` · Cetak `?tab=cetak` · Penomoran `?tab=nomor` · Metode pembayaran `?tab=pembayaran` · Kelompok harga `?tab=grup` · Gudang & cabang `?tab=lokasi` · Pemetaan akun `?tab=akun` · Modul `?tab=modul` · Kolom kustom `?tab=kolom` · Status sistem `/app/pengaturan/status`. `?tab=nota` warisan tetap sampai ke Cetak. Dikunci test kelengkapan; pemilih e2e digeser ke `aside.module-sidebar` dengan cakupan sama; screenshot 04 membuktikan satu daftar + konten lebar penuh + bilah simpan utuh.
- **V-03 — SELESAI.** `min-h` (92/70px) & `justify-between` dibuang dari kartu katalog: nama → harga tepat di bawah → chip stok sejajar pada baris harga. Mode tampilan (kolom/kepadatan/tampilkan stok) & perilaku klik/pindai/harga tidak berubah. Screenshot 05: 24 produk per halaman pada 1440px. Bagian saran "mode padat jadi bawaan ≤1366px" TIDAK diambil: mode tampilan adalah preferensi pengguna tersimpan — memaksanya per viewport akan melawan preferensi itu; keuntungan kepadatannya sudah diperoleh dari kartu mengikuti isi di kedua mode.
- **V-04 — SELESAI.** Blob pastel dibuang dari kartu modul beranda (screenshot 06). Jalan pulang eksplisit: item **"Beranda"** menjadi item pertama menu pengalih aplikasi di semua modul (di atas daftar modul, dengan pemisah), dan logo sidebar tertaut `/app` dengan `title`/aria "Beranda".
- **V-05 — SELESAI (sebagai batas desain V-01).** Baris nav mode ciut 44px (`h-11`), tombol ciut 44px, ubin pengalih 44px — tidak ada target di bawah 44px pada mode ikon; mode kembang mempertahankan kerapatan desktop yang ada.
- **V-06 — SELESAI.** Helper bersama `allStatementGroupsEmpty`/`isStatementGroupEmpty` di `src/lib/report-visibility.ts` (definisi hampa = definisi saringan akun nol UI-3). Laba rugi & neraca: semua kelompok hampa → satu keadaan kosong ringkas; arus kas: keempat seksi runtuh jadi satu catatan, baris saldo awal/akhir tetap tampil. **Halaman cetak menerapkan pola yang sama** (baris akhir & catatan keseimbangan tetap tercetak). Sebagian-hampa tidak berubah; total tidak berubah (saat semua kelompok terlihat-hampa total memang nol menurut konstruksi yang sama). E2e laporan disesuaikan secara sah: menegaskan keadaan ringkas pada periode demo, lalu saklar akun-nol mengembalikan struktur & angka yang ditegaskan sebelumnya. Screenshot 07.
- **Catatan penjaga kualitas:** penambahan V-06 membuat `laporan/page.tsx` 857 baris (> plafon ratchet 800). Sesuai pesan penjaga, berkas **dipecah** — komponen pernyataan pindah verbatim ke `report-statements.tsx` (378 baris) di folder yang sama, halaman (513 baris) tetap pemilik data — bukan ratchet baru, bukan penjaga yang dilemahkan.
