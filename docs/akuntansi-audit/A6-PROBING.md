# A6 — Probing Serangan atas Invariant Buku Besar

**Bagian 6 dari Audit Adversarial Akuntansi Bisa ERP** · Dieksekusi 2026-11-04 · DB dev PostgreSQL 18 :5433
**Sikap:** mematahkan, bukan membuktikan. **Kode produksi tidak diubah.** Semua probe berjalan sebagai berkas
test sekali-pakai (`tests/a6-probing.test.ts`, `tests/a6-verify.test.ts`) yang **sudah dihapus** sesudah dipakai,
di atas 4 perusahaan fixture khusus (`…a601/a602/a603/a604`) yang **sudah dibersihkan total** dari DB.

## Ringkasan angka

| Ukuran | Jumlah |
|---|---|
| Probe serangan tercatat (P-01…P-44, termasuk sub-probe) | **52** |
| Probe verifikasi ulang koneksi segar (V-00…V-22, V-17R) | 6 |
| **LOLOS** (invariant patah — sesudah koreksi metodologi) | **8 record → 7 temuan (AK6-01…AK6-07)** |
| DITAHAN sistem | 37 |
| SESUAI-DESAIN (bukan pelanggaran) | 5 |
| SEBAGIAN (catatan/observasi) | 2 |
| Tingkat temuan | 2× P1 · 1× P2 · 4× P3 · 0× P0 |

**5 temuan teratas:** AK6-02 (race tutup periode — 30 dari 36 posting lolos masuk periode yang sudah ditutup),
AK6-01 (baris jurnal negatif & dua-sisi terposting lewat aksi resmi), AK6-03 (sisipan baris liar ke jurnal
posted tidak terjaga trigger), AK6-04 (replay idempotensi menelan payload berbeda tanpa peringatan),
AK6-05 (klasifikasi `section` akun berjurnal bisa diubah retroaktif).

---

## Temuan

### AK6-01 (P1) — Baris jurnal bernilai negatif dan baris dua-sisi LOLOS terposting
**Probe:** P-01, P-02 · **Jalur:** `postManualJournalAction` (aksi resmi jurnal manual, sesi akuntan sah).

- P-01: payload baris `{debit: "-100000", credit: "100000"}` + `{debit: "200000"}` → jurnal **JE-2026-00002
  TERPOSTING**. Baris tersimpan persis `Dr -100000.0000 / Cr 100000.0000` — ada baris **negatif** di buku besar.
- P-02: satu baris memuat debit **dan** kredit sekaligus → terposting; total mutasi bruto akun terpomba
  tanpa mengubah saldo.

**Akar masalah:** `postJournal` (`src/server/accounting.ts`) menyaring baris dengan `debit > 0 || credit > 0`
— baris ber-kredit positif lolos **beserta debit negatifnya**; tidak ada penolakan `debit < 0 || credit < 0`
maupun `debit > 0 && credit > 0`. Validasi aksi (`moneyStringOptional` di `src/lib/action-validation.ts`)
memakai rule "any" (hanya cek finite), jadi negatif lolos dari lapisan aksi juga. Trigger keseimbangan DB
hanya memeriksa Σdebit = Σkredit dan total ≠ 0 — jurnal ini seimbang secara jumlah, jadi lolos di semua lapis.
**Dampak:** pengguna berperan akuntan dapat mendistorsi total debit/kredit per akun di seluruh laporan
mutasi (neraca saldo tetap tampak seimbang), menyembunyikan/memompa perputaran akun.
**Perbaikan:** di `postJournal` tolak baris dengan sisi < 0 atau kedua sisi > 0; pertegas skema aksi jurnal
manual menjadi non-negatif.

### AK6-02 (P1) — Race tutup periode (TOCTOU): posting yang sedang berjalan commit ke periode yang sudah ditutup
**Probe:** P-36 · **Jalur:** `postJournal` domain bersamaan vs penutupan `fiscal_periods` (update langsung
setara `setPeriodStatusAction`).

Metode: 3 ronde; tiap ronde 12 `postJournal` (20 baris, tanggal 2026-04-10) dijalankan paralel, dan pada
±25 ms sebuah transaksi lain mengubah periode 2026-04 menjadi `closed`. Hasil **konsisten di 3 ronde**:
12 sukses, **0 ditolak**, dan **10 dari 12 jurnal ber-`postedAt` SESUDAH waktu commit penutupan** — total
**30 dari 36** posting masuk ke periode yang pada saat commit-nya sudah tertutup.
**Akar masalah:** `assertPeriodOpen` membaca status periode di awal transaksi (READ COMMITTED) tanpa
mengunci baris periode; penutupan yang commit sesudahnya tidak membatalkan posting yang sedang berjalan.
**Dampak:** kontrol kunci akuntansi — "periode tertutup tidak berubah" — dapat dikalahkan oleh aktivitas
normal yang bersamaan (kasir/batch posting saat akuntan menutup bulan), bukan hanya oleh penyerang.
**Perbaikan:** kunci baris `fiscal_periods` `FOR UPDATE` di `assertPeriodOpen` (atau advisory lock per
perusahaan+periode yang juga diambil jalur penutupan), atau naikkan isolasi untuk transaksi posting.

### AK6-03 (P2) — INSERT baris liar ke jurnal posted tidak terjaga (defense-in-depth DB)
**Probe:** P-22, terverifikasi bersih V-22 · **Jalur:** SQL langsung sebagai `app_user` (kredensial aplikasi
sendiri), GUC `app.company_id` diset dengan benar.

Trigger yang ada: `journal_entries_immutable` & `journal_lines_immutable` hanya menjaga **UPDATE/DELETE**;
trigger keseimbangan `journal_entries_balanced` hanya menembak saat **INSERT ke `journal_entries`**.
**Tidak ada trigger/guard untuk INSERT ke `journal_lines`.** Bukti V-22 (koneksi segar, sengaja di-commit):
sisipan `Dr 777777` ke jurnal posted diterima; total baris menjadi **debit 827777.0000 vs kredit 50000.0000**
— buku besar timpang secara persisten, tanpa error di mana pun. Ironisnya, baris liar itu sesudahnya juga
tidak bisa dihapus oleh `app_user` karena `journal_lines_immutable` memblokir DELETE pada jurnal posted.
**Prasyarat:** akses SQL langsung sebagai `app_user` (SQL injection di masa depan, atau kredensial bocor) —
tidak ada jalur aplikasi yang menyisipkan baris seperti ini hari ini.
**Perbaikan:** trigger BEFORE INSERT pada `journal_lines` yang menolak bila jurnal induk berstatus posted
(dan/atau constraint trigger deferred di `journal_lines` yang memeriksa keseimbangan induk).

### AK6-04 (P3) — Replay kunci idempotensi tidak pernah membandingkan payload (jurnal manual)
**Probe:** P-42 · **Jalur:** `postManualJournalAction`.

Kunci `a6-idem-diff` dipakai dua kali: pertama nominal Rp100.000, kedua Rp999.999 dengan akun berbeda.
Panggilan kedua **mengembalikan jurnal pertama (JE-2026-00066) sebagai sukses**; jurnal Rp999.999 tidak
pernah terposting dan **tidak ada peringatan apa pun**. `postJournal` mengembalikan jurnal lama hanya
berdasarkan kunci. UI memakai `crypto.randomUUID()` per mount form sehingga tabrakan tak disengaja nyaris
mustahil, tetapi pemanggil API langsung dengan kunci yang diketahui/ditebak dapat menelan jurnal sah secara
diam-diam. Semantik sama di POS (P-44, SESUAI-DESAIN per POS-IDEM-01: kunci = identitas entitas).
**Perbaikan:** simpan hash payload bersama kunci; replay dengan payload berbeda → `CONFLICT`, bukan replay.

### AK6-05 (P3) — `section` akun yang sudah berjurnal dapat diubah — klasifikasi neraca seluruh riwayat berubah
**Probe:** P-26b · **Jalur:** `saveAccountAction`.

Penjaga AK-P2-10 memblokir perubahan `type` akun berjurnal (P-26a DITAHAN), tetapi `section` tidak dijaga:
mengubah Persediaan (1300) dari `current_asset` → `non_current_asset` **BERHASIL**, mengklasifikasi ulang
seluruh riwayat jurnal akun itu di neraca tanpa satu pun jurnal koreksi. `normalBalance`/`cashFlowGroup`
berada di permukaan yang sama (tidak ikut diuji).
**Perbaikan:** perluas penjaga AK-P2-10 ke `section`, `normalBalance`, dan `cashFlowGroup` untuk akun berjurnal.

### AK6-06 (P3) — Domain quick entry menerima tarif pajak di luar 0–100; tarif negatif terdegradasi diam-diam
**Probe:** P-30a, P-30b · **Jalur:** `postQuickCashSale` (domain) dengan `taxRate` bebas dari pemanggil.

Tarif `"-11"` (taxIncluded) → jurnal terposting **tanpa baris pajak sama sekali** (Dr 111000 / Cr pendapatan
111000): pajak negatif hilang diam-diam, bukan ditolak. Tarif `"1000"` → terposting dengan split yang
konsisten secara aritmetika. Jalur produksi mengambil tarif dari pengaturan perusahaan yang **sudah**
dibatasi 0–100 oleh skema pengaturan (AK-P3-06), jadi ini murni defense-in-depth: fungsi domain tidak
menegakkan kontraknya sendiri terhadap pemanggil lain di masa depan.

### AK6-07 (P3) — Diskon POS > 100% di-clamp diam-diam menjadi 100% (barang gratis)
**Probe:** P-29a · **Jalur:** `createSale` dengan `percentDiscount: 150`.

Penjualan **INV-2026-00001 terposting dengan total 0**: diskon di-clamp ke bruto alih-alih ditolak. Total
tidak pernah negatif (invariant aman), tetapi kesalahan ketik 15% → 150% berubah menjadi pemberian gratis
tanpa sinyal apa pun. **Perbaikan:** tolak persen diskon > 100 di domain (atau minta konfirmasi eksplisit).

---

## Koreksi metodologi (transparansi — 3 verdict awal saya sendiri salah)

Hasil putaran pertama mencatat P-17, P-20, P-21 sebagai LOLOS. Ketiganya **gugur** pada verifikasi ulang:

1. **P-20/P-21 (UPDATE/DELETE jurnal posted via SQL) — sebenarnya DITAHAN.** Putaran pertama memakai pool
   `adminSql` yang **tercemar oleh helper pembersih fixture saya sendiri**: `wipeOrg` menjalankan
   `SET session_replication_role = replica` di dalam transaksi pada koneksi pool; SET tanpa LOCAL bertahan
   di sesi sesudah commit, dan mode replica menonaktifkan trigger pengguna — jadi trigger immutable tidak
   menembak. Mekanisme ini saya buktikan deterministik dengan demo terpisah (pool max:1 — update ditolak
   di koneksi bersih, diterima sesudah `begin{SET replica}` commit). Verifikasi koneksi segar:
   **V-20a** (owner segar) DITOLAK `[23514] Jurnal yang sudah posted tidak boleh diubah atau dihapus`;
   **V-20b** (pool bersih tanpa wipe sebelumnya) DITOLAK sama; **V-21** (app_user segar + GUC benar) DITOLAK
   `[23514] Baris jurnal posted tidak boleh diubah atau dihapus`; `pg_trigger` menunjukkan ketiga trigger
   `tgenabled = 'O'` dan jurnal sasaran berstatus `posted`.
   *Observasi sampingan:* pola `SET session_replication_role` di dalam transaksi juga dipakai helper wipe
   pada suite test repo — di file test mana pun yang menjalankan wipe di tengah file, assertion berbasis
   trigger sesudahnya dalam proses yang sama berisiko vakum. Ini risiko higiene test, bukan bug produk.
2. **P-17 (retur pembelian ke periode locked) — sebenarnya DITAHAN.** `createSupplierReturn` hanya membuat
   **draft** (belum ada jurnal); probe awal berhenti di situ dan teks catatan saya keliru menyebut
   "terposting". Langkah posting sebenarnya, `postSupplierReturn`, memanggil `assertPeriodOpen` bertanggal
   dokumen — **V-17R: DITOLAK `[PERIOD_CLOSED] Periode 02/2026 sudah dikunci.`** Draft bertanggal periode
   terkunci dapat dibuat, tetapi tidak memposting apa pun (setara draft faktur — bukan pelanggaran).

---

## Terbukti tahan (37 probe)

**Keseimbangan & bentuk jurnal (K1):** jurnal tak seimbang polos ditolak dengan pesan jumlah kedua sisi
(P-03); semua baris nol / satu baris ditolak validasi (P-04, P-05); akun perusahaan lain di jurnal sesi A
ditolak — akun divalidasi per perusahaan (P-06); akun nonaktif dan akun induk non-postable ditolak dengan
pesan eksplisit (P-07a/b); serangan pembulatan 4dp (0.00004+0.00004 vs 0.00008 — seimbang pra-pembulatan,
timpang pasca-pembulatan) **ditangkap trigger deferred DB** `[23514] … tidak seimbang: debit 0.0000, kredit
0.0001` (P-08); overflow `numeric(19,4)` ditolak (P-09b, meski pesannya generik INTERNAL — lihat observasi).

**Periode tertutup/locked lewat jalur non-manual (K2) — semua ditolak `PERIOD_CLOSED`:** jurnal manual
(P-10), pembayaran utang (P-11, `paidAmount` terverifikasi tetap 0), penerimaan barang (P-12), quick entry
(P-13), POS `createSale` domain (P-14; aksi POS sendiri memaksa tanggal hari ini), run payroll (P-15),
penyusutan aset tetap (P-16), pembalikan jurnal bertanggal tertutup (P-19), posting retur pembelian (V-17R).

**Void/edit ganda & master (K3):** void beban kedua → `INVALID_STATE` (P-23); void pembayaran utang kedua →
`INVALID_STATE`, tepat 1 jurnal pembalik (P-24); membalik jurnal yang sama dua kali → `CONFLICT` (P-25a);
ubah `type` akun berjurnal diblokir AK-P2-10 (P-26a); hapus akun Kas berjurnal → `CONFLICT` (P-27);
UPDATE/DELETE jurnal posted via SQL pada koneksi bersih (V-20a/b, V-21).

**Angka ekstrem (K4):** qty 0 dan qty negatif (dengan pembayaran negatif) ditolak POS (P-28a/b); pelunasan
pecahan 4dp persis (33333.3333×3 + 0.0001) diterima sampai lunas dan kelebihan 0.0001 sesudah lunas ditolak
`Utang sudah lunas` (P-32).

**Konkurensi (K5):** dua pembayaran penuh bersamaan atas utang yang sama → tepat 1 berhasil, pihak kalah
`INVALID_STATE`, `paidAmount` akhir tepat, 1 baris pembayaran (P-33, kunci baris `FOR UPDATE` bekerja);
dua `postJournal` bersamaan berkunci idempotensi sama → tepat 1 jurnal commit (P-34; pihak kalah menerima
23505 mentah di level domain — aksi menerjemahkannya menjadi pesan ramah, lihat observasi); dua checkout
POS bersamaan berkunci sama → 1 penjualan, kedua pemanggil menerima penjualan pemenang (P-35).

**Lintas perusahaan (K6) — RLS + validasi domain menahan semuanya:** tulis jurnal companyId B dari transaksi
RLS A ditolak validasi akun (P-37a); baca jurnal B dari A → 0 baris (P-37b); bayar penerimaan A dari konteks
B → `NOT_FOUND` (P-38); checkout dengan gudang B → `NOT_FOUND` (P-39); trial balance B dari transaksi A →
0 baris bersaldo (P-40).

**Idempotensi (K7):** replay kunci+payload identik → jurnal yang sama, tepat 1 commit (P-41); run payroll
periode sama dua kali → `CONFLICT` (P-43).

## Sesuai desain (bukan pelanggaran)
Nominal tepat di batas `numeric(19,4)` terposting sah (P-09a); posting ke bulan **tanpa** baris
`fiscal_periods` diperbolehkan — sesuai model AGENTS.md "bulan tanpa baris = terbuka", dengan risiko tata
kelola bahwa periode lama yang belum pernah di-seed tidak terlindungi (P-18); diskon tepat 100% = penjualan
gratis yang sah (P-29b); beban Rp0,0001 valid secara Decimal — kebisingan buku besar, bukan pelanggaran
(P-31); checkout POS kunci sama isi beda mengembalikan penjualan asal (P-44, semantik POS-IDEM-01; keluarga
yang sama dengan AK6-04).

## Observasi minor (bukan temuan bernomor)
- **P-25b (SEBAGIAN):** membalik jurnal pembalik (re-reversal) **diizinkan level domain**
  (`reverseJournalEntry`); level aksi menolaknya (sourceType `manual_reversal` tidak diizinkan). Rantai
  balik-membalik dapat tumbuh di tangan pemanggil domain langsung.
- **P-34:** di level domain, pihak kalah race idempotensi menerima error mentah PG 23505; pemetaan ke pesan
  ramah (T5R-4) hanya ada di lapisan aksi/guard.
- **P-09b:** overflow nominal menghasilkan pesan `INTERNAL` generik, bukan validasi yang menyebut batas.

## Keadaan akhir basis data
- Keempat perusahaan fixture A6 (a601–a604) **terhapus seluruhnya**; jumlah organisasi di DB kembali **1**
  (hanya perusahaan demo). Berkas probe (`tests/a6-probing.test.ts`, `tests/a6-verify.test.ts`, `a6-scratch/`)
  **sudah dihapus**; `git status` bersih dari sisa probing (kode produksi tidak disentuh sama sekali).
- **Perusahaan demo: probing A6 tidak menyentuhnya** — seluruh penulisan A6 terjadi di perusahaan fixture;
  tidak ada baris demo yang bertanda waktu dalam jendela sesi A6 (17:10–18:20 WIB).
- **Namun keadaan demo saat ini ≠ baseline penutupan SIM-2**, dan penyebabnya **mendahului A6**: demo kini
  berisi **69 produk** dan Σ `stock_movements × cost_price` = **Rp28.632.045,4645**, berbanding baseline
  65 produk / Rp28.349.600. Forensik: 4 produk ekstra adalah residu suite test proyek sendiri bertanda
  waktu **2026-11-04 08:05–08:17 UTC (15:05–15:17 WIB, sesi gerbang final SIM-2)** — SKU `TST-VI-IMP-…`,
  `TST-OPEN-…-A/B`, `SKU-P18-GERAK-TERHAPUS-…` (nilai mutasinya Rp35.000; tanpa keempatnya jumlah produk
  kembali tepat 65). Sisa selisih ±Rp247.445,4645 berasal dari mutasi test pada produk demo reguler di
  jendela yang sama. Mengembalikan baseline persis adalah wewenang pemilik (`pnpm db:seed -- --force`,
  destruktif) — **tidak** dilakukan oleh audit ini; dilaporkan apa adanya.
