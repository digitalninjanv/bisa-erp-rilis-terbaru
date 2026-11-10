# STATUS TUTUP — Program Perbaikan Gabungan (Form/CRUD/Tabel + Validasi UI/UX Putaran 4)

Penutup Tahap G5, 2026-11-08. Program menggabungkan dua audit: audit statis
form/CRUD/tabel (`AUDIT-FORM-CRUD-TABEL.md`, 17 temuan FRM/CRUD/TBL) dan
Validasi UI/UX Putaran 4 (`../validasi-uiux-4/AUDIT-UIUX-4.md`, 14 temuan
UX4) — total **31 temuan**. Tahap: G1 `HASIL-G1.md`, G2 `HASIL-G2.md`,
G3 `HASIL-G3.md`, G4 `HASIL-G4.md`, G5 = dokumen ini.

Metode penutup: pengukuran ulang DOM + screenshot dengan **fungsi ukur
dan metode yang sama persis** seperti Putaran 4 (fungsi diekstrak verbatim
dari skrip Putaran 4) pada build produksi dari reseed bersih, sampel 27
pola (7 halaman terburuk Putaran 4 + teladan + sampel lintas modul +
detail pemasok & cetak jurnal dinamis) dan 11 halaman pada lebar 390px.
Bukti mentah: `~/workspace/bukti-gabungan/` (measurements-after.json,
measurements-after-390.json, before.json, screenshots/); bukti Putaran 4
di `~/workspace/bukti-validasi4/`. ZIP pasangan sebelum/sesudah:
`~/workspace/bisa-erp-screenshot-gabungan.zip`.

Satu-satunya perubahan kode G5 adalah penjaga e2e baru
(`e2e/ui-neatness-guard.spec.ts`) — UX4-14 tidak menghasilkan titik
perbaikan (§3), jadi tidak ada perubahan produk spekulatif di tahap ini.

---

## 1. Status final 31 temuan

| Kode | Status final | Tahap | Sisa bernama |
|---|---|---|---|
| FRM-01 | **TERTUTUP** | G1 | — |
| FRM-02 | **TERTUTUP** | G1 | — |
| FRM-03 | **TERTUTUP** | G2 | — |
| FRM-04 | **TERTUTUP** | G1 | — |
| FRM-05 | **SEBAGIAN** | G2 | Helper bersama + form utama per modul tertutup; ±60 berkas pemeriksa `result.ok` di luar form utama = adopsi lanjutan per modul |
| FRM-06 | **TERBUKA — keputusan pemilik** | (validasi visual G5 terpenuhi) | Pecah form Payroll Indonesia 219 field jadi wizard/simpan-per-seksi = keputusan desain pemilik |
| FRM-07 | **TERBUKA — keputusan pemilik** | — | PartyPicker/WarehousePicker tidak dibangun; select native = aturan proyek sadar; ambang sakit bergantung data produksi |
| FRM-08 | **SEHAT — dipertahankan** | audit | — |
| CRUD-01 | **TERTUTUP** | G4 | — |
| CRUD-02 | **TERTUTUP** (koreksi premis audit) | G4 | — |
| CRUD-03 | **TERBUKA — di luar cakupan, bernama** | — | Bentuk tanda tangan delete tak seragam; validasi Zod ada di semua delete (bukan lubang perilaku) |
| CRUD-04 | **SEHAT — dipertahankan** | audit | — |
| CRUD-05 | **BUKAN TEMUAN — terverifikasi** | audit | — |
| TBL-01 | **TERTUTUP** | G3 | — |
| TBL-02 | **TERTUTUP sesuai batas mandat (terbatas)** | G3 | Daftar lain = keputusan sadar BELUM beralasan tertulis |
| TBL-03 | **SEBAGIAN** | G3 | Bagian daftar tertutup; fragmentasi komponen aksi di panel & halaman detail tidak dikerjakan |
| TBL-04 | **SEHAT — dipertahankan** | audit | — |
| UX4-01 | **TERTUTUP** | G3 | — |
| UX4-02 | **SEBAGIAN** | G1 (pusat) + G5 (peta sisa) | Sisa lokal 10px bernama per elemen — lihat §2 |
| UX4-03 | **TERTUTUP** | G4, terverifikasi ulang G5 | — |
| UX4-04 | **TERTUTUP** | G4, terverifikasi ulang G5 | — |
| UX4-05 | **TERTUTUP** | G2 | — |
| UX4-06 | **TERTUTUP** | G2 | — |
| UX4-07 | **TERTUTUP** (permukaan daftar) | G3 | Pengecualian tertulis: baris `<td>` tabel, laporan/cetak, pesan gerbang |
| UX4-08 | **TERTUTUP** | G1, terverifikasi ulang G5 | — |
| UX4-09 | **TERTUTUP dgn catatan** | G3, terverifikasi ulang G5 | Target 40px tidak penuh — sisa = konten sel dua baris (keputusan desain lanjutan) |
| UX4-10 | **TERTUTUP** | G3 | — |
| UX4-11 | **TERTUTUP** | G2 | — |
| UX4-12 | **TERTUTUP** | G4 | Sisa hanya larik palet JS `charts.tsx` (beralasan) |
| UX4-13 | **TERTUTUP** | G4 | — |
| UX4-14 | **TERTUTUP-terverifikasi** | G5 | Tidak ada titik material — bukti distribusi §3 |

**Hitungan: TERTUTUP 21 · SEBAGIAN 3 · SEHAT/BUKAN-TEMUAN terverifikasi 4 ·
TERBUKA bernama 3. Total 31.**

---

## 2. Tabel pengukuran SEBELUM (Putaran 4) → SESUDAH (G5)

Sampel = 27 pola yang sama, kunjungan pertama per pola, fungsi ukur sama.
"Baris" = modus/median tinggi baris tabel. Kunjungan pertama Putaran 4
untuk Produk terekam tanpa baris tabel ter-render, sehingga kolom font
Produk tidak sebanding langsung — angka pembanding Produk yang sah
adalah hitungan G1 sendiri (122 elemen 10px pada 30 baris/halaman).

| Pola | 9px | 10px | Primer | Baris |
|---|---|---|---|---|
| Pengaturan Payroll Indonesia | 0 → 0 | 10 → 10 (sitasi regulasi) | 1 → 1 | 57/57 → 57/57 |
| Beranda | **12 → 0** | 2 → 1 (tagline) | 0 → 0 | — |
| Jurnal | 0 → 0 | 2 → **0** | 0 → 0 | 57/58 → **49/50** |
| Organisasi HR (hub) | 0 → 0 | 0 → 0 | **3 → 1** | — |
| Pemasok & pelanggan | 0 → 0 | 3 → **0** | 1 → 1 | 53/53 → **45/45** |
| Terminal desktop | 0 → 0 | 0 → 0 | **2 → 1** | — |
| Pengguna & peran | **6 → 0** | 2 → 2 | **2 → 1** | — |
| Produk | 0 → 0 | G1: 122 → **82** (±2,05/baris dari 4,07) | 1 → 1 | (G3 56) → 48/48 |
| Beranda Akuntansi | 0 → 0 | 1 → **0** | 1 → 1 | 37/38 → 37/38 |
| Nilai persediaan | 0 → 0 | 52 → 42 (50→40 baris) | 0 → 0 | 56/56 → **48/48** |
| Jurnal baru (teladan) | 0 → 0 | 5 → **0** | 1 → 1 | 49/49 → 49/49 |
| Riwayat POS | 0 → 0 | 0 → 0 | 0 → 0 | — |
| Pengaturan (hub) | 0 → 0 | 15 → 15 (petunjuk field) | 1 → 1 | — |
| Pergerakan stok | 0 → 0 | 40 → 40 (subteks SKU/baris) | 0 → 0 | 54/54 → **46/46** |
| Piutang & utang | 0 → 0 | 2 → **0** | 0 → 0 | 74/75 → **66/67** |
| Pembelian | 0 → 0 | 0 → 0 | 1 → 1 | — |
| HR lembur | 0 → 0 | 0 → 0 | **2 → 1** | — |
| HR cuti | 0 → 0 | 0 → 0 | **2 → 1** | 41/41 → 41/41 |
| Payroll | 0 → 0 | 4 → **0** | **2 → 1** | 53/53 → **45/45** |
| Impor | 0 → 0 | 4 → 4 (angka langkah) | 1 → 1 | — |
| Operasi gudang | 0 → 0 | 0 → 0 | 1 → 1 | — |
| Aset tetap | 0 → 0 | 0 → 0 | **2 → 1** | — |
| Opname | 0 → 0 | 2 → 2 (angka langkah) | 1 → 1 | — |
| Buku besar | 0 → 0 | 0 → 0 | 0 → 0 | 39/41 → 39/41 |
| Laporan cetak | **4 → 0** | 3 → **0** | 1 → 0 | — |
| Cetak jurnal [id] | 2 → 2 (skala cetak) | 3 → 3 (skala cetak) | 1 → 1 | 46/46 → 46/46 |
| Detail pemasok [id] | 0 → 0 | 0 → 0 | 1 → 0* | 39/39 → 39/39 |

\* Primer detail pemasok bergantung keadaan data (tombol "Bayar utang"
hanya tampil bila ada utang terbuka pada pemasok contoh yang dikunjungi).

**Agregat & metrik lintas sampel:**

- **Elemen 9px:** agregat sampel 24 → **2**; kedua sisa berada di
  permukaan **cetak** jurnal. Di permukaan aplikasi: **nol**.
- **Pola >1 primer:** 7 pola pelanggar pada sampel sebelum → **0 pola**
  sesudah (semua halaman sampel ≤ 1; konsisten dengan pengukuran G4
  14/14 tepat 1).
- **Radius:** nilai basis lama 7,04px: **407 → 0** pada sampel. Sesudah:
  8,8px (field/tombol) 406 · 12,32px (kartu) 139 · 15,84px (dialog) 8 —
  satu basis token seperti diklaim G1.
- **Overflow 390px:** Jurnal **true → false** (scrollWidth 890 → 390,
  pekerjaan G4). Kesebelas halaman sempit yang diukur sesudah
  (Beranda, Terminal, Produk, Riwayat POS, Jurnal, Payroll, Pengaturan,
  Payroll Indonesia, Piutang/utang, Buku besar, Nilai) — **semuanya
  overflowX = false**; empat di antaranya (Payroll Indonesia,
  Piutang/utang, Buku besar, Nilai) baru terukur pada putaran ini.
- **Kepadatan:** daftar utama turun sesuai klaim G3 (jurnal 49–50,
  pemasok 45, nilai 48, pergerakan 46, piutang/utang 66–67, payroll 45,
  produk 48 px modus). Buku besar (39) & tabel parameter Payroll
  Indonesia (57) tidak berubah — keduanya bukan daftar `DataList`
  (baris laporan & tabel parameter), konsisten dengan cakupan G3.

### Peta sisa elemen < 11px sesudah (enumerasi DOM penuh, per elemen)

| Sisa | Jumlah | Sifat |
|---|---|---|
| Subteks SKU/barcode per baris — Produk | 40 | lokal per baris |
| Pil status lokal daftar Produk (`text-[10px]` racikan, bukan StatusBadge) | 40 | lokal satu daftar |
| Subteks SKU per baris — Nilai persediaan | 40 (+2 catatan) | lokal per baris |
| Subteks SKU per baris — Pergerakan stok | 40 | lokal per baris |
| Petunjuk field (hint) Pengaturan | 15 | lokal per field |
| Sitasi regulasi (catatan kaki Perpres/PP) Payroll Indonesia | 10 | gaya catatan kaki |
| Angka dalam cip langkah wizard — Impor 4 · Opname 2 | 6 | glif angka, bukan teks bacaan |
| Subteks email + stempel waktu — Pengguna & peran | 2 | lokal |
| Tagline kaki Beranda | 1 | lokal |
| Permukaan cetak jurnal — 3× 10px + 2× 9px | 5 | skala cetak, dikecualikan sadar sejak G1 |

Total sisa permukaan aplikasi = 198 elemen, seluruhnya terpetakan di
atas; tidak ada sisa yang tidak bernama. Keputusan menaikkan sisa-sisa
ini menyentuh kepadatan baris (UX4-09) → keputusan desain lanjutan
pemilik, tercatat sebagai sisa UX4-02 SEBAGIAN.

---

## 3. UX4-14 — vonis G5: TERTUTUP-terverifikasi, tanpa titik material

Enumerasi DOM penuh ikon di dalam `<main>` (sampel 27 pola, 192 ikon):

| Ukuran | Jumlah | Keluarga terverifikasi |
|---|---|---|
| 14px | 97 | pita standar (isi tombol/aksi baris) |
| 16px | 77 | pita standar (tombol & menu ⋯) |
| 12px | 11 | indikator urut header tersortir (seragam: Produk, Pemasok, Piutang/utang) · ikon tombol sebaris kecil (seragam: Terima/Tambah Saldo Awal, Ubah-simpan) |
| 20px | 7 | penekanan/ilustrasi: 4 ubin modul Beranda (seragam), ikon EmptyState (piutang-utang, aset), ikon pemberitahuan cetak |
| 10px / 24px | **0 / 0** | — |

91% ikon berada di pita standar 14/16px; setiap pencilan diperiksa satu
per satu (konteks + kelas terekam di data mentah) dan terbukti anggota
keluarga yang konsisten internal — tidak ada ikon sejenis yang tampil
beda ukuran dalam satu permukaan, dan telaah visual screenshot penutup
mengonfirmasinya. Mandat G5 hanya mengizinkan perbaikan pada titik yang
bernama material; karena tidak ada, **tidak ada perubahan kode** untuk
temuan ini.

---

## 4. Penjaga permanen baru + bukti gagal-dulu

`e2e/ui-neatness-guard.spec.ts` (3 test, pola table-form-guard Putaran 3;
fungsi ukur meniru fungsi ukur audit, dipersempit ke `<main>`):

- (a) **lantai font** — nol elemen teks < 11px pada 6 halaman kunci yang
  terukur nol di penutup ini (Jurnal, Pemasok, HR, Payroll, Jurnal baru,
  Buku besar). Sampel & sisa bernama yang dikecualikan tertulis di
  komentar kepala spec.
- (b) **primer tunggal** — ≤ 1 tombol aksi berlatar `--primary` pada 8
  halaman (bekas pelanggar UX4-03 + kontrol).
- (c) **overflow sempit** — nol overflow horizontal dokumen pada 390px
  untuk 5 halaman bertabel lebar.
- Larangan `window.prompt/confirm` (FRM-02) **dirujuk**, tidak
  diduplikasi: penjaganya sudah hidup di
  `tests/unit/architecture-dialog-patterns.test.ts`.

**Bukti gagal-dulu (wajib, dijalankan 2026-11-08):**

1. Spec pada pohon bersih: **4 passed** (termasuk setup auth).
2. Satu nilai diturunkan sementara — `StatusBadge`
   (`src/components/blocks/status-badge.tsx`) `text-[11px]` →
   `text-[10px]`, rebuild produksi — spec dijalankan ulang:
   **exit 1; test (a) GAGAL** dengan pesan tepat
   `/app/akuntansi/jurnal: 10px "Terposting" <span>`; test (b) & (c)
   tetap lulus (properti yang berbeda). Log: `/tmp/g5-guard-fail.log`.
3. Nilai dikembalikan persis (`git diff` kosong untuk berkas itu),
   rebuild, gerbang e2e penuh: **28 passed** — penjaga menangkap kelas
   pelanggaran yang ia jaga, bukan sekadar hijau.

---

## 5. Gerbang akhir program (dari reseed bersih, tanpa pipa penutup)

| Gerbang | Hasil |
|---|---|
| Reseed bersih | 65 produk · nilai persediaan Rp28.349.600 |
| Suite unit+integrasi (`pnpm test`) | **2135/2135 lulus, 223 berkas, exit 0** (= baseline G4) |
| Typecheck (`pnpm typecheck`) | exit 0 |
| Lint (`pnpm lint`) | exit 0 — 0 error, **29 warning warisan** (tidak bertambah) |
| Build (`pnpm build`) | exit 0 |
| E2E (`BISA_E2E_RESEED=1 pnpm test:e2e`) | **28 passed, exit 0** (25 lama + 3 penjaga baru) |
| db-integrity (`scripts/audit/db-integrity.sql`) | 22 cek bernilai 0; **seluruh cek terlingkup tenant hidup = 0** (G1–G3). Non-nol hanya blok informasional/residu: F1 67 baris migrasi (0066+jurnal), R2 rincian, G4 8.225 baris residu perusahaan mati, B1 global 2 yang terlingkup tenant hidup (G1) = 0 — pola residu fixture pasca-suite yang sama seperti preseden penutup Audit Produksi A5 |
| Backup (`pnpm db:backup`) | exit 0 → `backups/bisa-20261108-142905.dump`. Catatan jalur: `pg_dump` bawaan sistem (16.15) menolak server 18.6 — backup wajib memakai klien PG18 repo (`.local/pg18-client/.../bin` di PATH), sebagaimana putaran-putaran sebelumnya |
| Restore drill (`scripts/restore-drill.sh`) | **BERHASIL, exit 0** — 4/4 COCOK (jumlah akun 719, produk 281, nilai persediaan cocok, selisih neraca saldo 0,0000); DB uji dihapus |

---

## 6. Sisa terbuka final program (seluruhnya bernama)

1. **FRM-05** — adopsi helper submit bersama ke ±60 berkas di luar form
   utama (gelombang adopsi lanjutan per modul).
2. **FRM-06** — keputusan pemilik: pecah form Payroll Indonesia
   (wizard/simpan-per-seksi) atau pertahankan satu halaman terseksi.
3. **FRM-07** — keputusan pemilik: bangun PartyPicker/WarehousePicker
   bila data produksi membuktikan ambang sakitnya.
4. **CRUD-03** — penyamaan bentuk tanda tangan aksi delete (refactor
   konsistensi; tidak ada lubang perilaku).
5. **TBL-03** — penyatuan komponen aksi di panel & halaman detail
   (bagian daftar sudah satu pola RowMenu).
6. **TBL-02** — daftar di luar tiga daftar pertama: keputusan sadar
   BELUM beralasan tertulis per daftar.
7. **UX4-02** — sisa lokal 10px terpetakan (§2): menaikkannya adalah
   keputusan desain yang berinteraksi dengan kepadatan UX4-09.
8. **UX4-09** — sisa tinggi baris = konten sel dua baris; target 40px
   penuh menunggu keputusan desain lanjutan.

Tidak ada sisa lain. Program dinyatakan **tuntas pada batas mandatnya**
oleh tahap ini; penetapan "selesai" resmi & commit adalah wewenang
Pemimpin setelah memeriksa diff dan angka di atas.
