> **Catatan 2026-11-09:** templat bagan akun sudah diganti ke bagan referensi IFI MART (141 akun). Angka 124/5-digit di dokumen ini adalah keadaan historis program A-27.

# STATUS-TUTUP-A27 — Penutup Program A-27 Perbaikan Bagan Akun

Program **A-27** · Tahap **B8** (gerbang final & penutup) · Tanggal: 2026-11-07
Dokumen acuan: `AUDIT-A27.md` (temuan F-01…F-10 + akun hilang) · `RENCANA.md` (tahap B0–B8, templat §4, mapping §5, keputusan §7)

**Vonis penutup: program TUNTAS.** Keluhan asal — "tambah bank tidak bisa" — tertutup di akarnya: "bank" tidak lagi satu slot pemetaan, melainkan **kelas akun**. Bagan bawaan berubah dari 42 akun datar 4 digit menjadi templat 124 akun terstruktur 5 digit dengan header/detail nyata, seluruh akun wajib retail yang hilang kini tertanam, dan akun yang dulu permanen kini dapat diedit (termasuk kodenya) dengan penjaga — jurnal tetap mereferensikan `accountId`, sehingga seluruh sistem menyesuaikan secara otomatis sesudah akun diedit. Tidak ada angka bisnis yang berubah di seluruh program: tidak ada jurnal baru, tidak ada saldo yang bergerak, tidak ada aturan posting yang berubah.

---

## 1. Gerbang final B8 (dari reseed bersih, semua perintah tanpa pipa, exit code langsung)

| Gerbang | Hasil |
|---|---|
| Reseed (`pnpm db:reset`) | exit 0 — "Produk: 65, nilai persediaan: 28349600" |
| `pnpm test` | **exit 0 — 1741/1741 test lulus** (179 berkas) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (0 error; 26 warning pra-ada, bukan dari A-27) |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` (sesudah reseed ulang) | **exit 0 — 19/19** |
| Test konsistensi (`tests/integration/consistency.test.ts`) | lulus penuh di dalam suite (13/13 pada berkasnya) |

**Baseline demo terverifikasi via SQL sesudah reseed final** (perusahaan demo "Bisa Minimarket"):

| Ukuran | Nilai |
|---|---|
| Akun | **124** (semua kode 5 digit: 124/124 cocok pola `^[0-9]{5}$`) |
| Pemetaan | **36/36 kunci** |
| Produk | **65** |
| Nilai persediaan | **Rp28.349.600** (identik baseline pra-A-27) |
| Struktur | 29 header non-postable + 95 detail; 2 detail di antaranya non-postable menurut desain (31020 sistem, 95000 dicadangkan) → 31 non-postable / 93 postable terukur |
| Akun berkelas kas/bank (`cash|bank|clearing`) | **11** (kas, kas kecil, Bank BCA, 4 settlement, kas dalam perjalanan, 3 kliring/suspense) |

Paritas angka B6 sudah membuktikan neraca saldo per tipe identik dengan baseline pra-B6; gerbang B8 menegaskan ulang tidak ada pergeseran hingga akhir program.

## 2. Uji asap visual akhir (`~/workspace/bukti-a27/final/`)

Server produksi lokal (flag `BISA_ALLOW_LOCALHOST_AUTH_URL=1`), login demo asli, server dimatikan sesudahnya:

| Berkas | Isi bukti |
|---|---|
| `bagan-akun.png` + `bagan-akun-penuh.png` | Halaman Bagan akun: total 124 akun; hierarki terlihat (10000 Aset → 11000 Aset Lancar → 11001 Kas berlencana **Sistem**, 11011 Bank BCA dengan nomor rekening termasker `BCA • •••••6789`, settlement 11061–11064, header 11100 Piutang); kartu ringkasan Aset Rp80.349.600 = Liabilitas Rp4.000.000 + Ekuitas Rp76.349.600 (neraca seimbang) |
| `formulir-akun-bank.png` | Formulir "Akun baru" dengan **Kelas kas/bank = Bank**: rincian bank kondisional tampil (Nama bank, Nomor rekening, Cabang, Atas nama, Mata uang rekening IDR) + catatan "Akun ini tampil sebagai akun kas/bank di seluruh aplikasi" + penanda akun kontra |
| `kas-bank.png` | Halaman Kas & bank: **11 rekening aktif**, Kas Kecil (11002) tampil sebagai rekening dan tersedia di dropdown transfer antar rekening (F-03 tertutup secara visual) |
| `migrasi-coa.png` + `migrasi-coa-dryrun.png` | Halaman Migrasi bagan akun; dry-run dijalankan pada demo dan menyatakan: *"Bagan akun perusahaan ini sudah mengikuti templat 5 digit — tidak ada akun yang perlu di-renumber dan tidak ada akun templat yang hilang. Tidak ada yang perlu dimigrasi."* |

Uji asap fungsional tambah bank (bank kedua berfungsi penuh tanpa merebut pemetaan Bank BCA) sudah dibuktikan 12 test di B3 (`tests/integration/a27-b3-add-bank.test.ts`) dan tidak diulang sebagai klaim tanpa bukti di B8.

## 3. Status temuan F-01…F-10

| Temuan | Status | Tertutup di | Bukti utama |
|---|---|---|---|
| **F-01** (KRITIS) "Bank" = satu slot pemetaan, bukan kelas akun | **TERTUTUP** | B1 (skema kelas `cash_bank_kind` + rincian bank + backfill deterministik dari pemetaan, migrasi 0055) + B2 (keanggotaan himpunan diturunkan dari kelas via `listCashBankAccounts`) | `a27-b1-cash-bank-class.test.ts`, `a27-b2-cash-bank-class-reads.test.ts` |
| **F-02** (KRITIS) Tambah bank dari UI jalan buntu (dropdown metode dibatasi 3 akun terpetakan) | **TERTUTUP** | B3 (formulir akun berkelas + rincian kondisional; dropdown metode mengikuti kelas per tipe metode; validasi server per kelas) | `a27-b3-add-bank.test.ts` (12 test: Bank Mandiri berfungsi penuh — Kas & bank, metode baru, transfer, rekonsiliasi — tanpa mengubah pemetaan `bank`); screenshot `formulir-akun-bank.png` |
| **F-03** (TINGGI) Kas Kecil 1010 yatim dari modelnya sendiri | **TERTUTUP** | B1 (seed berkelas `cash`) + B2 (keanggotaan dari kelas) | Test paritas B2: himpunan demo menjadi `[11001, 11002, 11011, 11061]` — Kas Kecil masuk secara eksplisit; screenshot `kas-bank.png` (11002 tampil & dapat dipilih untuk transfer) |
| **F-04** (SEDANG) Daftar rekonsiliasi timpang dua arah (bank baru tak masuk; Piutang Usaha & Kredit Pelanggan ikut) | **TERTUTUP** | B2 (daftar rekonsiliasi = kelas kas/bank/clearing postable+aktif; aturan gabungan metode dihapus) + B3 (sisi tulis: metode divalidasi kelasnya per tipe) | `a27-b2-cash-bank-class-reads.test.ts` — daftar demo tidak lagi memuat akun piutang/kredit pelanggan |
| **F-05** (SEDANG) Nonaktifkan tanpa penjaga; kode akun tidak bisa diedit sama sekali | **TERTUTUP** | B4 (penjaga nonaktif setara hapus — menolak dengan menyebut ikatannya; pratinjau dampak `getAccountImpact`; nonaktif bersaldo wajib konfirmasi eksplisit; **kode dapat diedit** berpenjaga unik + audit log `account.code_change`; mata uang terkunci sesudah berjurnal) | `a27-b4-account-guards.test.ts` |
| **F-06** (SEDANG) Hierarki tidak ditegakkan saat tulis & tidak dipakai (0 header; induk postable & siklus lolos; subtotal hitung ganda) | **TERTUTUP** | B4 (induk wajib non-postable; akun beranak tak boleh postable; anti-siklus rantai induk; subtotal grup = detail saja) + B6 (struktur diterapkan: 29 header berinduk di templat) | `a27-b4-account-guards.test.ts`; hitungan SQL B8 (§1) |
| **F-07** (SEDANG) Tidak ada penanda akun sistem/permanent | **TERTUTUP** | B4 (`is_system` **turunan** dari ikatan pemetaan/metode — selalu akurat, tanpa kolom yang bisa basi — + lencana kunci "Sistem" di halaman bagan akun) | `a27-b4-account-guards.test.ts`; screenshot `bagan-akun.png` (lencana Sistem pada 11001/11011/11061) |
| **F-08** (RENDAH) Kode teks bebas; blok 8xxx/9xxx campur tipe | **TERTUTUP sesuai keputusan desain** | B4 (kode dapat diedit berpenjaga) + B6 (templat 5 digit beranatomi formal; blok campur dibubarkan: selisih kas → 62009/71002, pembulatan → 71003/81001, 9xxxx khusus pajak penghasilan). Kode **tetap bebas** — tidak ada standar yang mewajibkan pola digit (riset audit §5.6.1); kerapian datang dari templat, bukan paksaan pola | `a27-b6-chart-template.test.ts`; SQL B8: 124/124 kode 5 digit pada demo |
| **F-09** (RENDAH) `accountId` metode tak tervalidasi & tanpa FK | **TERTUTUP** | B1 (FK `payment_methods.account_id → accounts.id`; pemeriksaan pendahuluan: 142 metode, 0 yatim) + B3 (validasi server: ada, sekantor, postable, aktif, kelas sesuai tipe metode, pesan bernama) | `a27-b1-cash-bank-class.test.ts`, `a27-b3-add-bank.test.ts` |
| **F-10** (INFO) Kategori tertutup di kode tanpa validasi koherensi type↔section | **TERTUTUP** | B4 (matriks koherensi type↔section ditegakkan di server; `normalBalance` tetap eksplisit karena akun kontra adalah pengecualian sah). Enum tertutup itu sendiri dipertahankan — sesuai praktik terbaik (taksonomi tipe memang dimiliki sistem di semua ERP acuan) | `a27-b4-account-guards.test.ts` |

**Ringkasan: 10/10 temuan tertutup** — 9 tertutup penuh, F-08 tertutup sesuai keputusan desain terdokumentasi (kode bebas + templat rapi, bukan pola yang dipaksakan).

## 4. Status akun hilang dari COA bawaan

Seluruh akun wajib retail yang dinyatakan hilang oleh audit **kini tertanam di templat B6** (`src/lib/akuntansi/chart-template.ts`, satu sumber untuk perusahaan baru dan seed demo) dan terpetakan bila punya kunci:

| Akun hilang (audit) | Kode templat | Catatan |
|---|---|---|
| Cadangan Kerugian Piutang (CKPN) | 11110 | Kontra piutang (`is_contra`, pasangan 11101). **Mesin penyisihan/ECL tidak dibangun** — lihat §6 |
| Pendapatan Diterima Dimuka (grup) | 21030 (header) + 21031 Uang Muka Pelanggan, 21032 Voucher & Gift Card, 21033 Kredit Pelanggan | |
| Prive / Dividen | 31035 Prive Pemilik · 31030 Dividen | Dipisah per bentuk badan (koreksi riset) |
| Ongkos Kirim Pembelian | 51010 | Freight-in, komponen biaya perolehan |
| Diskon Pembelian / Retur Pembelian | 51002 / 51003 | Kontra HPP — **akun penyesuaian HPP perpetual** (RENCANA §6), bukan model periodik |
| Beban Penyusutan | 62010 | Kunci `depreciation_expense` kini terpetakan di seed |
| Settlement EDC / e-wallet / marketplace | 11062 / 11063 / 11064 | Kelas `clearing`; blok settlement 11060–11089 |
| Laba Tahun Berjalan (system-reserved) | 31020 | Non-postable + tertandai sistem (dihitung tutup buku) |
| Lainnya dari peta rentang riset | 11091 kas dalam perjalanan · 11901–11903 kliring/suspense · 21201 cerukan · 21040 hutang konsinyasi · 12901 deposit jaminan · 11121 piutang pinjaman karyawan · 21102 utang potongan gaji · 72001 bunga deposito (investing) · 82001/82002 beban bunga (financing) · 91001/91002/91010 pajak penghasilan · 95000 operasi dihentikan (dicadangkan) | Enam kunci pemetaan yang dulu malas/tak terpetakan kini tertanam: total **36/36 kunci** |

Pemetaan 42 akun lama → baru: **42/42 satu-ke-satu** (0 digabung, 0 dibagi, 0 dihapus) — tabel lengkap di `RENCANA.md` §5.

## 5. Keadaan sebelum → sesudah

| Aspek | Sebelum A-27 | Sesudah A-27 |
|---|---|---|
| Model kas/bank | Satu slot pemetaan per kunci (`bank` menunjuk tepat 1 akun); himpunan kas/bank = maks 3 akun terpetakan, tersebar di 17 tempat | **Kelas akun** (`cash|bank|clearing`) + rincian bank di `accounts`; keanggotaan diturunkan dari kelas lewat satu fungsi baca; pemetaan `cash/bank/qris` turun peran menjadi penunjuk bawaan (kas sesi POS, bank bawaan, penampung QRIS bawaan) |
| Tambah bank | Akun GL bisa dibuat tetapi tak pernah berfungsi penuh; bank kedua mustahil tanpa merebut slot bank pertama | Satu langkah di formulir akun (kelas Bank + rincian kondisional pola Accurate) → langsung anggota Kas & bank, dapat dipilih di metode pembayaran, dapat ditransfer, masuk rekonsiliasi |
| Bagan bawaan | 42 akun, 4 digit, **datar** (0 header, 0 berinduk), 30/36 kunci terpetakan | **124 akun, 5 digit, terstruktur** (29 header + 95 detail, hierarki eksplisit), **36/36 kunci** terpetakan, satu modul templat sebagai satu-satunya sumber |
| Editabilitas akun | Kode **tidak bisa diubah sama sekali**; nonaktif tanpa penjaga; hierarki longgar (siklus lolos) | Kode dapat diedit (unik per perusahaan + audit); ganti nama bebas; nonaktif berpenjaga setara hapus + pratinjau dampak; hierarki ditegakkan (induk non-postable, anti-siklus); mata uang rekening terkunci sesudah berjurnal |
| Akun sistem | Tak terlihat (28 akun terikat pemetaan tak terbedakan) | Lencana "Sistem" turunan ikatan — selalu akurat; perlindungan mengikuti ikatan, bukan nama |
| Kesiapan PSAK 118 | Hanya `cash_flow_group` (arus kas) | Tag per akun laba rugi: `psak118_category` + `expense_nature` + `expense_function` + penanda kontra (B5) — **tagging saja; penulis laporan tidak diubah** (fase laporan adalah program tersendiri) |
| Perusahaan berjalan | — | Alat migrasi B7 opt-in: dry-run jujur (renumber/baru/kustom/bentrok) → eksekusi satu transaksi dengan verifikasi saldo per `accountId` (selisih = batal total); tidak pernah dijalankan diam-diam |

## 6. Sisa jujur (terkumpul, tidak disembunyikan)

1. **Subjek kas pada laporan arus kas & kartu ringkasan tetap penunjukan pemetaan** (keputusan B2, tercatat): permukaan laporan itu memang membutuhkan *satu* akun subjek yang ditunjuk, bukan himpunan kelas. Keanggotaan himpunan di semua permukaan operasional sudah dari kelas.
2. **CKPN (11110) tanpa mesin penyisihan/ECL** — akunnya ada dan dapat diposting manual oleh akuntan; mesin penyisihan berkala **sengaja tidak dibangun**: matriks ECL adalah keputusan pemilik yang sudah lama menunggu (daftar keputusan A-24 §3 butir matriks ECL) dan tidak boleh dibangun diam-diam.
3. **Jalur ganti-templat-utuh untuk perusahaan tanpa transaksi tidak dibangun** (B7): destruktif dan tidak diminta; yang tersedia adalah renumber terpetakan + tambah akun templat yang hilang. **Editor mapping UI juga tidak dibangun** — parameter domain migrasi tersedia, panel hanya menjalankan dry-run/eksekusi bawaan.
4. **Akun kustom perusahaan berjalan tetap bertag `operating`** untuk PSAK 118 sampai akuntannya menyesuaikan lewat formulir — backfill B5 tidak menebak kategori dari nama/kode akun kustom (kejujuran data, keputusan RENCANA §7 butir 6).
5. **Lencana sistem hanya dari ikatan.** Akun 31020 Laba Tahun Berjalan tampil tertandai sistem karena statusnya ditanam sebagai data templat (non-postable + tertandai), bukan karena dirujuk pemetaan/metode — akun templat lain yang tidak terikat apa pun tampil sebagai akun biasa, sesuai desain turunan F-07.
6. **Multi-mata-uang penuh di luar cakupan**: kolom `currency` adalah data rincian bank (bawaan IDR, terkunci sesudah berjurnal); saldo & jurnal tetap IDR.
7. **Laporan berformat PSAK 118 belum dibangun**: B5 adalah kesiapan data (tagging) sesuai panduan implementasi (fase mapping/tagging mendahului fase laporan); kewajiban PSAK 118 sendiri bergantung pilar SAK entitas.

## 7. Keputusan pemilik yang masih menunggu

| # | Keputusan | Keadaan |
|---|---|---|
| 1 | **Renumber perusahaan yang sudah berjalan** ke skema 5 digit — opt-in per perusahaan lewat alat B7 (dry-run → persetujuan → eksekusi) | Alat siap & terbukti; **belum dijalankan untuk perusahaan mana pun**; tidak pernah otomatis |
| 2 | **Matriks ECL** untuk mesin penyisihan CKPN | Menunggu dari daftar keputusan lama (A-24 §3); akun 11110 sudah tersedia begitu keputusan diambil |
| 3 | Keputusan turunan RENCANA §7 yang diambil Pemimpin dan dapat dibalik pemilik | Selisih kas tetap dua akun (62009/71002); PPh dipotong tetap satu akun (21016) dengan celah blok untuk pemecahan kelak; seed demo beralih templat 5 digit (sudah berjalan sejak B6) |

---

*Keadaan akhir tahap B8: demo tereseed baseline terverifikasi (124 akun · 36 pemetaan · 65 produk · Rp28.349.600), server lokal mati, PostgreSQL tetap berjalan. Berkas berubah pada tahap ini menunggu commit Pemimpin: dokumen ini (baru), `PROGRESS.md` (§0J ditutup), `RENCANA.md` (B8 tercentang). ZIP rilis dibangun Pemimpin dari commit final program.*
