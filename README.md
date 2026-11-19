# Bisa ERP

Minimarket ERP modular untuk POS, gudang, dan akuntansi. Satu aplikasi Next.js dengan PostgreSQL, modul terpisah, dan pembukuan double-entry otomatis.

## Fitur

- **POS** — barcode/pencarian, keranjang, harga khusus per kelompok dengan aturan per produk, pembayaran tunai/QRIS/transfer, pembayaran campuran, kembalian, pembulatan harga kelompok, pesanan ditahan, retur/tukar, void dengan alasan, cetak ulang nota, sesi kas dan setoran/penarikan.
- **Gudang** — master produk/SKU/barcode/kategori/satuan/pemasok, multi-gudang, penerimaan barang, penyesuaian (rusak, kedaluwarsa, hilang, karantina), retur pembelian, transfer, opname, kartu stok, pergerakan stok, nilai persediaan, impor Accurate.id.
- **Akuntansi** — bagan akun berhierarki dengan kelompok laporan fleksibel (aset lancar/tidak lancar, liabilitas jangka pendek/panjang, pendapatan lain-lain, beban operasional/lain-lain), halaman jurnal baru yang lengkap, jurnal pembalik, buku besar, periode fiskal (buka/tutup/kunci), neraca saldo, laba rugi dan neraca berkelompok dengan pembanding tahun sebelumnya, arus kas, perubahan ekuitas, beban (batalkan via jurnal pembalik), setoran modal, transfer bank dengan biaya, piutang/utang dengan aging 0–30/31–60/61–90/>90 hari, payroll hingga pembayaran gaji, laporan penjualan, ekspor CSV dan cetak.
- **Pengaturan** — identitas perusahaan, NPWP, tarif pajak, nota/printer, gambar QRIS, metode pembayaran, kelompok harga (aturan produk + pembulatan), gudang, cabang, pemetaan akun otomatis.
- **Pengguna & peran** — admin/owner dapat membuat akun login, memilih peran bawaan atau peran kustom, serta mengatur modul dan izin yang bisa diakses.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · Drizzle ORM · PostgreSQL 18 · Better Auth · Zod · Decimal.js · xlsx · Vitest.

## Menjalankan

Prasyarat: Node.js 22+, pnpm 11+, PostgreSQL 18 (wajib — `uuidv7()` native).

```bash
cp .env.example .env.local
# isi DATABASE_URL, DIRECT_URL, BETTER_AUTH_SECRET
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Buka `http://localhost:3000`, login dengan akun demo:

```text
owner@bisa.id / Bisa12345!
```

Untuk data demo besar (10.000+ produk, untuk menguji impor/kinerja):

```bash
pnpm db:seed:bulk
```

## Peran database

Dua koneksi digunakan:

- `DIRECT_URL` — pemilik skema. Dipakai migrasi, seed, dan skrip admin.
- `DATABASE_URL` — role aplikasi (`app_user`). Hanya boleh mengakses data tenant lewat RLS.

Setiap query bisnis harus lewat `withCompany(companyId, fn)` atau `withCompanyReadOnly(...)` di `src/db/tenant.ts`, yang mengeset `app.company_id` di transaksi. Jangan query tabel ber-`company_id` langsung dari `db` di luar wrapper tersebut.

## Diskon & pembulatan

- Harga khusus sepenuhnya berbasis **kelompok** (mis. Kampus, Sekolah). Tanpa memilih kelompok, semua produk memakai harga normal.
- POS memakai data pelanggan hanya untuk penjualan utang (opsi **Utang**): pelanggan dan jatuh tempo wajib, dan sisa limit kredit diperiksa. Penjualan lunas tidak memilih pelanggan.
- Setiap produk dalam kelompok dapat memakai aturan: **normal**, **diskon persen**, atau **harga tetap**.
- Harga kelompok dibulatkan memakai pengaturan kelompok: kelipatan (0/100/500/1.000) dan arah (ke bawah, ke atas, terdekat). Jadi harga seperti Rp 61.750 bisa menjadi Rp 61.500.
- Opsi **Bulatkan total transaksi** membulatkan total akhir transaksi; jika tidak dicentang, total memakai nilai apa adanya.
- Selisih harga normal dan harga kelompok dicatat sebagai diskon penjualan. Akun diskon dapat diatur per kelompok, atau mengikuti pemetaan akun global.
- Kelola di **Pengaturan → Kelompok harga** (`/app/pengaturan?tab=grup`). Kasir memilih kelompok di layar POS; ringkasan kelompok ada di **POS → Kelompok harga**.

## Pengguna, peran, dan modul

- Buka **Akuntansi → Pengguna & peran** (`/app/pengaturan/pengguna`) sebagai owner/admin.
- **Pengguna**: buat akun (nama, email, kata sandi), ubah peran, reset kata sandi, cabut akses.
- **Peran bawaan**: Owner, Admin, Manager, Kasir, Staf Gudang, Akuntan, Lihat Saja. Peran bawaan tidak bisa diubah/dihapus.
- **Peran kustom**: pilih modul (POS/Gudang/Akuntansi) dan izin rinci per modul. Contoh: peran "Kasir Senior" hanya POS dengan izin jual, sesi kas, dan retur.
- Modul yang tidak diizinkan tidak muncul di beranda dan tidak bisa dibuka lewat URL langsung.
- Menu di dalam modul ikut disembunyikan jika izinnya tidak ada.
- Perubahan peran langsung berlaku pada permintaan berikutnya (peran dan izin dibaca ulang dari database setiap request).

## Alur akuntansi

- **Periode fiskal** (`/app/akuntansi/periode`): buka, tutup, atau kunci bulan. Jurnal ditolak pada periode tertutup/terkunci.
- **Jurnal**: halaman **Jurnal baru** (`/app/akuntansi/jurnal/baru`) menyediakan form debit/kredit penuh dengan memo per baris dan indikator keseimbangan. Dokumen posted tidak diedit; koreksi memakai **Balik jurnal** yang membuat entri pembalik dan tertaut ke jurnal asli.
- **Beban**: pembatalan membuat jurnal pembalik dan menandai dokumen `void`; laporan tidak menghitung beban void.
- **Payroll**: proses payroll membuat beban dan utang gaji; halaman detail payroll mencatat pembayaran utang gaji ke kas/bank.
- **Piutang/utang**: ringkasan aging dihitung dari tanggal dokumen, dengan empat kelompok umur.
- **Laporan**: laba rugi memisahkan pendapatan, pendapatan lain-lain, HPP, beban operasional, dan beban lain-lain; neraca memisahkan aset/liabilitas lancar dan tidak lancar. Keduanya menampilkan pembanding tahun sebelumnya dan preset Bulan ini, Bulan lalu, Tahun ini, Tahun lalu.
- **Kelompok laporan akun** dapat diubah per akun di COA (grup laporan dan grup arus kas), sehingga struktur laporan dapat disesuaikan tanpa mengubah kode.

## Aturan akuntansi

- Semua nilai uang disimpan `numeric(19,4)` dan dihitung dengan Decimal.js; jangan pakai `number` untuk aritmetika uang.
- Jurnal posted bersifat append-only. Koreksi dilakukan dengan jurnal pembalik, bukan edit/hapus.
- Jurnal wajib seimbang (debit = kredit) dan periode fiskal harus terbuka.
- Omzet dikredit bruto; diskon dicatat sebagai contra-revenue. Pembulatan laba ke akun `9000`, pembulatan rugi ke `9001`.
- Persediaan memakai rata-rata bergerak. `stock_on_hand` adalah cache dan harus selalu sama dengan jumlah `stock_movements`.
- Satu transaksi hanya boleh diproses sekali (idempotency key); dokumen final tidak boleh diedit.

## Impor Accurate.id

1. Buka **Gudang → Impor data**.
2. Unggah XLSX/CSV hasil ekspor Accurate.
3. Pemetaan otomatis mengenali header ekspor Accurate:
   - **Harga Jual** ← `Def. Hrg. Jual Satuan #1` (bukan `Harga dari rincian grup`, yang berisi TIDAK/YA);
   - **Stok Awal** ← `Kuantitas Saldo Awal` (bukan `Batas Minimum Stok`);
   - **Multi-satuan** ← `Satuan #2..#5` + `Rasio Satuan #2..#5` + `Def. Hrg. Jual Satuan #2..#5` menjadi kemasan ERP;
   - **Jenis Barang**, **Non Aktif**, **Menggunakan No. Seri**, **Pakai tanggal kadaluarsa** menjadi atribut produk.
4. Pratinjau validasi: baris lengkap, baris belum lengkap, duplikat SKU di file, SKU yang sudah ada, konflik barcode, kategori/satuan/pemasok baru. **Siap impor** hanya berisi baris dengan SKU, Nama, Barcode, Satuan, Harga beli > 0, dan Harga jual > 0; baris lain ada di **Belum lengkap** dan tidak ikut diimpor.
5. Pilih baris yang diimpor, opsi perbarui produk lama dan impor stok awal (dengan tanggal cut-off).
6. Impor diproses per batch 250 baris agar aman untuk 10.000+ produk.

Baris disimpan di `import_jobs`/`import_rows`, sehingga pratinjau dan riwayat impor dapat diaudit.

**Batas yang jujur:**

- Rasio kemasan harus bilangan bulat ≥ 2. Baris dengan rasio pecahan (mis. 1 cup = 0,5 porsi) ditolak per baris dan harus ditangani manual.
- Bagan akun Accurate diimpor **datar** (tanpa hierarki akun induk) dan tidak mengubah pemetaan akun perusahaan. Untuk perusahaan yang sudah berjalan, lebih aman memetakan akun Accurate ke COA ERP yang ada daripada mengimpor COA kedua.
- Riwayat transaksi (penjualan/pembelian/jurnal) **tidak** diimpor oleh wizard ini; yang didukung adalah master data + saldo awal.
- Impor stok awal per gudang dari tab **Stok Awal** setelah master produk dan gudang tersedia. Petakan **Kode Barang**, **Kuantitas Saldo Awal**, **Nilai Satuan**, **Gudang Saldo Awal**, serta **Per Tanggal** jika tersedia. Gunakan kuantitas dan biaya dalam satuan dasar. Gudang dan cut-off pilihan di layar dipakai jika kolom baris kosong.
- Qty `0` eksplisit dicatat di dokumen impor tanpa mutasi atau jurnal. Qty kosong ditolak. Saldo minus dapat dimigrasikan pada SKU/gudang tanpa saldo atau mutasi aktif, dengan jurnal pembuka bertanda sesuai nilai. Biaya teks seperti `1.250` mengikuti format ribuan. Gunakan sel angka Excel untuk kuantitas pecahan dengan tiga digit desimal.
- Penerimaan stok positif memakai alur stok awal biasa. Dokumen stok nol dan minus dipisahkan per gudang dan tanggal. Impor ulang SKU yang sudah memiliki dokumen stok awal impor aktif dilewati pada gudang yang sama. Cocokkan jumlah dan nilai per gudang dengan laporan Accurate pada cut-off sebelum mulai bertransaksi.
- Produk ber-seri/batch tidak bisa menerima stok awal lewat impor produk; stoknya harus masuk lewat Penerimaan dengan daftar seri/batch.

Benchmark jalur impor tanpa database (10.000 baris, XLSX ~4 MB):

```bash
pnpm bench:import
```

Pada mesin pengembangan ini: parse + mapping ±0,44 detik (±22.000 baris/detik), heap ±74 MB. Commit ke database berjalan per batch 250 baris sehingga tetap responsif.

## Perintah

```bash
pnpm dev             # server pengembangan
pnpm build           # build produksi
pnpm start           # jalankan hasil build
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint
pnpm test            # unit + integration test
pnpm db:generate     # generate migrasi Drizzle
pnpm db:migrate      # terapkan migrasi
pnpm db:seed         # seed data demo (aman diulang)
pnpm db:seed -- --force  # hapus & seed ulang data demo
pnpm db:seed:bulk    # seed ulang + 10.000 produk
pnpm db:backup       # dump database ke ./backups
pnpm db:restore backups/<file>.dump --yes  # pulihkan dump (menimpa data)
```

> `db:seed --force` dan `db:seed:bulk` menghapus seluruh data perusahaan demo. Jangan jalankan pada database produksi.

## Struktur

```text
src/app/app/{pos,gudang,akuntansi,pengaturan}   halaman per modul
src/components/{pos,gudang,akuntansi,pengaturan} form & widget
src/server/*.ts                                  logika domain (POS, stok, akuntansi, laporan)
src/server/actions/*.ts                          server action + validasi Zod + RBAC
src/db/{schema,tenant,seed}.ts                   skema, wrapper RLS, data demo
src/db/migrations/                               SQL migrasi + RLS + trigger
tests/{unit,integration}                         Vitest
```

## Catatan deploy (WAJIB dibaca sebelum produksi)

> ⚠️ **Ganti semua kredensial bawaan.** `docker-compose.yml` dan
> `docker/init.sql` berisi sandi pengembangan yang terpublikasi di
> repo: Postgres `erpdev`, peran aplikasi `app_user` = `appdev`,
> MinIO `minio-dev`. Compose tersebut hanya untuk pengembangan lokal.
> Sebelum deployment nyata:
>
> 1. Ganti `POSTGRES_PASSWORD`, sandi `app_user` (di `docker/init.sql`
>    untuk volume baru, atau `ALTER ROLE app_user PASSWORD '...'`
>    untuk volume lama), dan `MINIO_ROOT_PASSWORD`; selaraskan
>    `DATABASE_URL`/`DIRECT_URL` di `.env` produksi.
> 2. Set `BETTER_AUTH_SECRET` acak yang kuat dan `BETTER_AUTH_URL`
>    ke origin produksi yang benar.
> 3. Ganti sandi akun demo `owner@bisa.id` (bawaan seed `Bisa12345!`)
>    atau jangan jalankan seed demo sama sekali di produksi.
> 4. Pendaftaran akun publik sudah dimatikan di konfigurasi auth —
>    pengguna hanya dibuat lewat Pengaturan → Pengguna oleh
>    owner/admin.

## POS Desktop dan deployment VPS

Bisa POS Desktop (Electron) membuka `/app/pos` yang sama dengan versi web. **Bisa ERP dan PostgreSQL 18** berjalan di VPS atau server LAN toko. **Aplikasi desktop dan driver printer thermal** dipasang di komputer kasir. Setiap kasir bisa memilih printer USB atau LAN serta ukuran kertas 58 atau 80 mm. Setelah **Bayar**, kasir memilih **Cetak struk** atau **Tanpa cetak**.

1. **Deploy ERP terbaru.** Commit integrasi desktop sebelum push. Bangun paket server dengan versi rilis baru agar updater memakai hasil build terbaru. Folder `dist-release/` diabaikan Git, jadi buat paket dari kode yang sudah dipush atau unggah artefaknya secara terpisah. Untuk VPS yang sudah punya data, gunakan prosedur update yang membuat backup sebelum migrasi. [Runbook deployment](docs/RUNBOOK-INSTALASI-PRODUKSI.md)
2. **Siapkan HTTPS.** Gunakan domain dan sertifikat yang dipercaya komputer kasir. Samakan origin yang dipakai kasir dengan `BETTER_AUTH_URL`. Jika reverse proxy menangani akses publik, batasi akses langsung ke port aplikasi 3000.
3. **Hubungkan terminal kasir.** Pasang AppImage Linux x86‑64 di komputer kasir. Saat aplikasi tertutup, jalankan dengan `--erp-url=https://erp.tokoanda.id` untuk menyimpan alamat VPS. Pasang printer lewat pengaturan sistem operasi, lalu buka **Atur printer** di Bisa POS dan jalankan **Uji cetak**. [Panduan instalasi desktop](pos-electron/README.md)

### Checklist pilot satu kasir

- [ ] Periksa `/api/health` dan login dari komputer kasir dengan domain VPS.
- [ ] Scan produk, bayar, dan periksa struk fisik. Uji juga **Tanpa cetak** serta cetak ulang dari riwayat.
- [ ] Putuskan koneksi sebentar, lalu verifikasi status transaksi dan pastikan sinkronisasi tidak menggandakan penjualan.
- [ ] Ukur waktu **scan → item masuk**, **Bayar → tersimpan**, dan **Cetak → struk keluar** pada perangkat toko.

Pada setup VPS, checkout dan pengambilan nota bergantung pada koneksi toko ke server. Antrean offline web memiliki cakupan terbatas dan cetak lewat driver desktop untuk transaksi offline belum tersedia. Jika toko perlu menjalankan seluruh alur saat internet luar putus, gunakan server ERP di LAN toko. AppImage dan cetak dengan driver simulasi sudah diuji secara lokal. Hasil di VPS dan printer thermal fisik perlu diverifikasi lewat pilot.

## Keamanan & audit

- RBAC per peran: owner, admin, manager, cashier, warehouse, accountant, viewer.
- RLS PostgreSQL memaksa isolasi perusahaan.
- `audit_log` mencatat aksi penting (penjualan, void, retur, sesi kas, beban, transfer, payroll, pengaturan).
- Dokumen posted dilindungi trigger append-only.

## Batasan yang diketahui

- Integrasi pembayaran QRIS bersifat statis (unggah gambar QR), belum melalui payment gateway.
- Pajak memakai satu tarif inklusif per perusahaan; belum ada multi-tarif per produk.
- Belum ada modul e-faktur/pelaporan pajak resmi; laporan keuangan mengikuti struktur SAK umum, bukan klaim kepatuhan.
- Job antrean (`outbox`) sudah disiapkan di skema tetapi belum ada worker produksi.
