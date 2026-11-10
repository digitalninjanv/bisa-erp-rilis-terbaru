# Laporan Tahap 5 — Hardening, Platform & Gerbang Akhir

Pemimpin: sesi utama Muse · Status: **SELESAI — program tuntas.** Suite akhir: **442 test unit/integrasi hijau (56 berkas)** + **15 test e2e Playwright hijau**, typecheck & lint bersih, build produksi sukses. Gerbang data sesudah reseed: 65 produk, nilai persediaan Rp28.349.600, consistency 11/11 — identik di semua tahap.

## 1. Temuan yang ditangani

Seluruh sisa audit program: AK-P3-01/02/03/06, utang test SEC-P0-01 & balapan gudang, serta temuan review tahap ini:

| ID | Prioritas | Temuan | Status |
|---|---|---|---|
| T5R-1 | P1 (review) | Mematikan modul Akuntansi mengunci Pengaturan itu sendiri — pemulihan mustahil dari UI, bertentangan dengan janji teks bantuannya | ✅ Segmen Pengaturan bebas gerbang modul; jalur pemulihan teruji |
| T5R-2 | P2 (review) | Saklar modul hanya ditegakkan di layout; action tetap menulis (kasir berterminal termuat terus bertransaksi) | ✅ 53 action tulis digerbangi; domain/jurnal otomatis sengaja tidak digerbangi |
| T5R-3 | P2 (review) | Impor melewati kolom kustom wajib tanpa jejak | ✅ Catatan hasil baris terlihat pada pratinjau & hasil impor |
| AK-P3-03 | P3 | Payroll ganda satu periode hanya dicegah cek aplikasi | ✅ Indeks unik parsial di DB (run void tetap boleh diproses ulang) |
| AK-P3-01 | P3 | Tanggal/nominal longgar; error duplikat jatuh ke pesan generik | ✅ Skema bersama `isoDate`/`moneyString` + pemetaan 23505 per entitas |
| AK-P3-02 | P3 | Jurnal manual tanpa kunci idempotensi | ✅ Kunci per sesi form diteruskan ke postJournal |
| AK-P3-06 | P3 | Tarif pajak tanpa validasi rentang | ✅ Refine 0–100 dengan pesan Bahasa Indonesia |

## 2. Pekerjaan per batch

- **T5-1** (`6f5b9f8`) — Empat P3 akuntansi di atas + **test otomatis SEC-P0-01** (admin mereset kata sandi owner → FORBIDDEN, hash tidak berubah; owner → berhasil) + **test balapan gudang**: dua checkout memperebutkan stok terakhir (tepat satu berhasil, stok tidak negatif) dan dua opname konkuren (satu jurnal, stok akhir benar).
- **T5-2** (`88e8234`) — **Saklar modul per perusahaan** (POS/Gudang/Akuntansi; Beranda & Pengaturan selalu aktif; jsonb rusak tidak pernah mengunci perusahaan) dan **custom fields** produk/supplier/customer (definisi per perusahaan: teks/angka/tanggal/pilihan, wajib opsional; validasi ketat di jalur form; nilai di kolom `attributes` jsonb baru — migrasi 0020). Action yatim `finalizeImportAction` dihapus; satuan bisa dinonaktifkan.
- **T5-3** (`43bb0cf`) — **Approval penyesuaian stok maker-checker** (D-17): ambang nilai per perusahaan; di atas ambang dokumen `pending` tanpa gerakan/jurnal; penyetuju wajib pengguna lain berizin; jalur posting tunggal dipakai ulang untuk buat-langsung & persetujuan; balapan approve tepat satu yang menerapkan. **Kategori bertingkat**: induk-anak dengan anti-siklus, daftar terindentasi, filter produk memuat keturunan (FK `parent_id` ditambahkan migrasi 0021; kolomnya sendiri sudah ada sejak 0000).
- **T5R-A** (`054fef3`) — Tindak lanjut review (lihat tabel).
- **Gerbang e2e** (`ed476dd`) — Playwright 1.64: login, **simulasi minimarket pengguna lewat UI penuh** (terima 100 tunai → stok +100 → jual 1 di POS → nota tampil → stok akhir tepat −1 dari titik sesudah penerimaan), perjalanan akuntansi & pengaturan, **axe WCAG pada 5 rute utama: 0 pelanggaran di semua tingkat dampak**.

## 3. Keputusan yang dicatat jujur (bukan diam-diam)

- **Status dokumen kustom & form builder generik tidak dibangun** (D-16): status dokumen adalah enum penjaga integritas akuntansi/stok; prinsip spek pengguna sendiri melarang fleksibilitas yang mengorbankan validitas.
- **Konversi multi-satuan tidak dibangun** (D-17): produk memakai satu satuan dasar; konversi mengubah matematika POS/penerimaan/stok di semua jalur dan bukan fitur inti blueprint pengguna.
- **Offline POS tidak dibangun** (D-10, sejak Tahap 3): yang ada persistensi keranjang per pengguna.
- **Approval hanya untuk keluarga write-off** (penyesuaian/rusak/kedaluwarsa/hilang) sesudah koreksi T5R-5 — retur pembelian & karantina selalu langsung terposting.
- Catatan deploy: migrasi 0018 (indeks unik tautan rekonsiliasi) akan gagal pada DB yang sudah punya tautan ganda nyata — lepas dulu secara manual. Catatan lingkungan e2e: unduhan browser Playwright dari CDN terputus di sandbox ini; suite berjalan di atas biner headless-shell Chrome for Testing yang diunduh manual dengan revisi persis yang diharapkan Playwright — di mesin pengembang normal, `pnpm exec playwright install chromium` adalah jalurnya.

## 4. Hasil akhir program (lintas tahap)

| Tahap | Hasil | Suite |
|---|---|---|
| 1 Akuntansi | Seluruh P1+P2 akuntansi & kedua P0 program; laporan dibersihkan total | 115 |
| 2 Gudang | 27/29 temuan; terima barang 3 skenario + GRN, PO, batch/FEFO; simulasi pengguna hijau | — |
| 3 POS | Seluruh P1+P2 POS; retur/kredit/diskon berjenjang/hold/kas; bug kontra-pendapatan lintas-tahap ditemukan & diperbaiki | 250 |
| 4 Integrasi | Rekonsiliasi, penebusan kredit, Print Engine, impor+saldo awal, pemilih perusahaan, penomoran kustom; instalasi DB baru diperbaiki (D-15) | 355 |
| 5 Hardening | Sisa P3, platform (modul & custom fields), approval, kategori bertingkat, e2e + axe | **442 + 15 e2e** |

Dari audit awal 91 temuan (P0:2 · P1:18 · P2:41 · P3:30): seluruh P0, P1, P2 tuntas; P3 tuntas kecuali yang secara eksplisit ditunda dengan keputusan tercatat di atas (offline POS, multi-satuan, status kustom, form builder, impor edit-di-tempat, T4R-6 sidik jari transaksi identik, T4R-9 risiko hash migrasi pada upgrade drizzle mendatang).
