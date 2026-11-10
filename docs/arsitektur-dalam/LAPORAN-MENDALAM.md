# Analisis Arsitektur Mendalam Bisa ERP (A-20) — Laporan Gabungan

Mandat pengguna 2026-11-05 09:35 WIB: analisis objektif berbasis fakta terhadap
standar developer profesional 2025–2026, dengan daftar kerangka yang eksplisit.
Empat agen paralel baca-saja (AD-1 dependency & context, AD-2 SOLID &
ekstensibilitas dari arkeologi git, AD-3 sensus berkas berbasis AST, AD-4
longevity & fitness). Dinilai atas pohon ter-commit HEAD `67894dc` (sesudah
FIX-ARS Tahap 1–4). Dua perbaikan yang sedang berjalan saat analisis dimulai
sudah mendarat sesudahnya dan dicatat sebagai delta di akhir: pemecahan
terminal (T5, `bbdf45e`) dan penertiban jalur baca + ratchet (T6, `dc59a3b`).

## Vonis keseluruhan: **6,7/10 — modular monolith berkonteks yang disiplin, ditegakkan konvensi & test perilaku, belum oleh mesin penegak struktur**

| Dimensi | Skor |
|---|---|
| AD-1 Dependency, context & screaming | 7,0 |
| AD-2 SOLID & ekstensibilitas | 7,0 |
| AD-3 Kualitas berkas & modularitas | 6,7 |
| AD-4 Longevity & fitness functions | 6,0 |

## 1. Kesesuaian prinsip arsitektur profesional

### Dependency Rule — **SESUAI (8/10)**
Graf impor runtime yang dibangun dari pohon (1.650 tepi): **0 siklus**,
**0 impor framework (`next/*`/`react`) di domain server** (seluruh 22 impor
framework tinggal di lapisan actions), **0 pemakaian singleton `db` konkret di
domain** — 39/45 berkas domain bekerja lewat `tx: Tx` yang diinjeksikan, sisanya
type-only. Komponen → db = 0 tepi. Tepat **satu** tepi ke atas di seluruh graf:
`db/seed.ts → server/payroll-indonesia` (skrip CLI, bukan jalur request).
Satu-satunya siklus adalah type-only `permissions ↔ modules`.
Yang tampak sebagai 131 tepi `app → db` adalah *layer-skipping untuk baca*
(halaman membuka konteks tenant lewat `@/db/tenant` lalu berkuei) — bukan
inversi arah; pola itulah yang ditertibkan FIX-ARS T6 (lihat delta).

### Separation of Concerns + High Cohesion + Loose Coupling — **SEBAGIAN–SESUAI**
Kohesi tulis sangat kuat di titik integritas: `journal_entries/journal_lines`
ditulis hanya oleh konteks Akuntansi, `stock_movements` hanya oleh
Persediaan/Pembelian; **72 dari 92 tabel (78%) berpenulis tunggal per konteks**.
Kopling baca longgar terbalik: `reports.ts` membaca 49 tabel lintas konteks
tanpa read-model terpisah, dan 48/98 tabel direferensikan ≥2 konteks.
Shared kernel kecil dan sah: money, errors, permissions, tenant, sequences,
audit, idempotency.

### SOLID (level modul & use-case)
| Prinsip | Vonis | Skor | Bukti penentu |
|---|---|---|---|
| SRP | Sebagian–Sesuai | 7 | Modul domain umumnya satu tanggung jawab; pengecualian terukur: `reports.ts` (≥5 konteks baca, 43 ekspor) dan logika domain yang tinggal di lapisan aksi (`runPayrollAction` 553 baris, `commitImportBatchAction` 516). |
| OCP | **Sesuai** | 8 | Lihat laboratorium git di bawah — pola ekstensi terbukti dari 10 commit nyata, bukan teori. |
| LSP | Sebagian | 6 | Substitusi realistis hanya di titik integrasi yang memang dirancang (penyedia auth, storage antrean offline 2 implementasi); di tempat lain tidak ada kontrak substitusi — wajar untuk monolit, dicatat apa adanya. |
| ISP | Sesuai | 8 | Segregasi tipe publik disengaja: `QuoteResultPublic` vs internal (harga pokok tersembunyi dari kasir), named-import parsial skema (100 dari 103 pengimpor), DTO per use-case. |
| DIP | Sebagian | 6 | Domain bergantung pada abstraksi `Tx` yang diinjeksikan (kuat), tetapi tidak ada port untuk layanan luar selain auth; dependensi konkret Drizzle meresap sebagai bahasa kueri domain — pilihan pragmatis yang konsisten, bukan inversi penuh. |

### Domain-driven boundaries vs technical layering — **SEBAGIAN (6/10)**
Label yang jujur secara DDD: **modular monolith berkonteks dengan database
bersama** — bukan bounded context penuh. Batas konteks adalah batas *modul &
kepemilikan tulis*, bukan batas data: satu `schema.ts` 98 tabel, master data
ditulis hingga 4 konteks (`customers`), struktur folder disusun lapisan teknis
dulu (app/components/server/lib/db) dan konteks kedua (folder `pos/`,
`inventory/`, rute bisnis). Untuk ERP UKM satu deployment ini adalah pilihan
yang tepat — yang tidak boleh dilakukan adalah mengklaimnya sebagai
bounded-context DDD.

### Pola besar yang sesuai konteks
**Modular Monolith** adalah pola yang benar-benar hidup dan merupakan pilihan
tepat untuk konteksnya. **Clean/Hexagonal**: hanya sebagian — arah dependensi
dan injeksi `Tx` selaras, tetapi tidak ada port/adapter formal (dan bukti
menunjukkan itu bukan kekurangan untuk skala ini). **Vertical Slice**: hidup
di lapisan rute & fitur UI (89/89 rute per fitur), tidak di lapisan domain.

### Screaming Architecture — **SEBAGIAN (7/10)**
Struktur berteriak bisnis di rute (per modul: pos/gudang/akuntansi/pengaturan)
dan komponen (70 berkas per fitur vs 47 bersama). Pengecualian terukur:
`src/lib/` tampak seperti laci utilitas (hanya 2/34 nama berkas berkosa domain)
padahal **±66% LOC-nya adalah logika domain murni** — mesin payroll Indonesia
dan mesin impor tinggal di sana tanpa pengakuan struktural.

## 2. Ekstensibilitas & kemudahan dikembangkan

### OCP dibuktikan dari riwayat fitur (AD-2)
Rasio OCP = persen baris baru sebuah fitur yang masuk ke **berkas baru**
(ekstensi murni) vs berkas lama; baris terhapus di berkas lama adalah proksi
perubahan perilaku lama.

| Fitur | Rasio baru | Hapus di lama |
|---|---|---|
| Retur Pembelian (domain + UI) | 91% / 89% | 19 / 2 |
| Kasbon Karyawan | 89% | 16 |
| Payroll Indonesia SIM-2 | 84% | 61 |
| SIM-2 S7B-2 (7 fitur sekaligus) | 87% | 22 |
| Catat Transaksi | 94% | 184 |
| Ringkasan Saldo (FIX-ARS T2) | 73% | 137 (satu hook aditif di `postJournal` +42/−1) |
| Penjualan Utang POS | 44% | 59 (fitur kecil di dalam alur lama: +14/−1 di pos.ts) |
| Konsumsi Reservasi | 52% | 158 (kait +83/−1 ke modul reservations) |

Pola yang terbukti: fitur berbentuk modul/dokumen baru mendarat **84–94%
di berkas baru** tanpa menulis ulang fungsi inti; fitur yang hidup di dalam
alur lama membayar sentuhan inti yang kecil, aditif, dan terlokalisasi
(parameter + validasi + panggilan ke modul pemilik). Tidak ada satu pun fitur
dalam riwayat yang menuntut mengubah kontrak fungsi inti modul lain.

### Extension points yang hidup
Pemetaan akun (data), saklar modul per perusahaan (3 lapis penegakan),
konfigurasi fiskal bertanggal efektif + saklar per program, kolom kustom
terbatas sadar, metode pembayaran & seri dokumen sebagai data, pola
idempotensi bersama, katalog peran/izin, PrintShell & komponen laporan.
Yang ABSEN: plugin registry / event bus / injeksi strategi runtime —
dinilai **bukan cacat** untuk konteks ini; ekstensi berjalan lewat data,
konfigurasi, dan modul baru, dan riwayat membuktikan jalur itu cukup.

### Parallel development — **terlemah (5/10)**
Churn terkonsentrasi: `schema.ts` disentuh 34/173 commit, `@/db/schema`
diimpor 103 berkas, `companySettings` dirujuk 23 berkas lintas area; tidak ada
CODEOWNERS. Tiga–lima developer paralel per konteks akan bekerja — batas
modulnya nyata — tetapi berkas bersama (skema, pengaturan, komponen bersama)
adalah titik konflik yang dapat diprediksi. Blast radius commit terukur:
median 12 berkas `src/` per commit berkode, p90 36 (yang terbesar adalah
sapuan standardisasi komponen bersama & bundel satu tahap — struktural,
bukan kebocoran acak).

## 3. Kualitas kode & modularitas berkas (AD-3, sensus AST)

- **Ukuran berkas** (330 berkas, 92.880 LOC): ≤200 baris 59,4% · 201–400
  22,7% · 401–800 11,2% · >800 6,7%. **82,1% berada dalam patokan ≤400**;
  median 164,5; p90 671. Masalah terkonsentrasi di ekor, bukan badan.
- **Panjang fungsi** (4.837 fungsi, span AST): hanya **37 fungsi (0,8%)**
  >250 baris. Di domain server `pos/`+`inventory/` sesudah T4: **nol**
  (`createSale` kini 118 baris). Raksasa tersisa berpindah tempat: komponen
  UI (`ImportWizard` 742, `QuickEntryForm` 583, `MasterImportWizard` 556)
  dan lapisan aksi (`runPayrollAction` 553, `commitImportBatchAction` 516).
- **Package by Feature vs by Layer: by-feature dominan & sehat (8/10)** —
  rute 89/89 per fitur, komponen per modul, domain server per konteks.
  Pengecualian: `server/actions/` satu lapisan teknis (dimitigasi berkas per
  domain) dan `lib/` campuran.
- **God-file**: dari 15 berkas terbesar, satu-satunya god-file sejati pada
  saat penilaian adalah `pos-terminal.tsx` ter-commit (sudah dipecah di T5 —
  lihat delta). `reports.ts` adalah konsentrasi-fitur tertinggi di server
  (aspek terlemah AD-3: 5/10). `schema.ts` 2.718 baris dinilai **bukan
  masalah**: deklaratif, dan 100 dari 103 pengimpornya memakai impor parsial.
- **Smell lain**: duplikasi global rendah (1,10% shingle terbagi); pasangan
  kembar nyata: dua wizard impor (±250 jendela identik) dan halaman
  kasbon/pinjaman. Kode mati sempit (6 dependensi runtime 0-impor).

## 4. Maintainability & longevity (AD-4)

### Penegakan batas: oleh apa?
Bukan oleh mesin penegak struktur: **tidak ada architecture test, tidak ada
aturan lint batas, tidak ada dependency-cruiser/madge**. Yang menegakkan,
dari terkeras: (a) invariant database (trigger jurnal seimbang, posted
immutable, append-only, RLS konsisten sampai migrasi 0046); (b) test perilaku
yang sangat tebal (129 berkas, ±50 ribu baris — termasuk penjaga konsistensi
lintas-modul); (c) konvensi + audit berkala (graf bersih 0 siklus adalah
*hasil kebiasaan yang diverifikasi*, bukan yang dikunci). CI 4 job sudah
ditulis (FIX-ARS T1) tetapi **belum operasional**: remote kosong, belum
pernah terpicu, tanpa branch protection. Delta T6 menambah fitness function
struktural pertama (ratchet jalur baca) — lihat akhir laporan.

### Trajektori bloat (tonggak git)
| Tonggak | Berkas | LOC | Rata-rata | >1.000 |
|---|---|---|---|---|
| Baseline | 149 | 26.455 | 177,6 | 4 |
| Perbaikan awal | 197 | 46.301 | 235,0 | 10 |
| SIM-2 | 284 | 78.906 | 277,8 | 15 |
| FIX-R2 | 299 | 84.121 | 281,3 | 15 |
| A-17 | 313 | 91.044 | 290,9 | 16 |
| HEAD T4 | 330 | 92.880 | **281,5** | 16 |

Dua fase pertama didominasi penggemukan berkas lama; pertumbuhan melambat
sesudah SIM-2; interval terakhir adalah yang pertama rata-rata berkas
**turun (−3,2%)** — trajektori terbukti bisa dibalik oleh penataan.
Test tumbuh ×49 hingga ±54% dari LOC sumber: aset terbesar sekaligus beban
(suite serial; helper rollback tersalin di 49 berkas).

### Risiko 12 bulan: drift lumpur, bukan over-engineering
Bukti lumpur: skema diimpor 103 berkas & disentuh 34/173 commit, jalur baca
ganda (sedang ditertibkan T6), 118 mutasi langsung di lapisan aksi, data
turunan yang bergantung pada disiplin jalur tulis. Bukti over-engineering
nyata tetapi **sempit dan statis**: 6 dependensi tak terpakai + 22/28 primitif
UI tak terjangkau graf impor — satu pembersihan mencabutnya. Inti sistem
justru tidak over-engineered (antarmuka hampir semua DTO; satu-satunya port
sungguhan punya 2 implementasi nyata).

### Keputusan, tumpukan, onboarding
PROGRESS.md + keputusan D-1..D-25 berfungsi sebagai ADR de-facto (alasan +
supersesi eksplisit) tetapi satu berkas ±12 ribu kata tanpa indeks/`docs/adr/`
dan ada bagian yang basi. Tumpukan segar & terpin (Next 16.4.3, React 19.3,
TS 5.9.3, Drizzle 0.45.4) dengan permukaan API standar (API eksotis Next = 0)
→ jalur upgrade mudah; catatan: xlsx masih tarball CDN (integrity terkunci di
lockfile), Node tidak selaras antar CI/README/types, tanpa dependabot.
Onboarding dinilai 5,5/10: perubahan UI kecil aman di hari yang sama,
perubahan domain transaksional pertama 2–5 hari; hambatan terbesar: tidak ada
peta arsitektur mutakhir, invariant kritis implisit & tersebar, alur test
bespoke.

## 5. Struktur & organisasi — ringkasan putusan
- **Folder**: lapisan teknis di luar, konteks bisnis di dalam; by-feature
  dominan. Skor gabungan 7–8/10.
- **Ownership data**: kuat untuk tulis (78% penulis-tunggal; dua tabel paling
  kritis bergerbang tunggal), longgar untuk baca (laporan lintas konteks
  tanpa read-model — disengaja dan konsisten dengan pilihan monolit).
- **Public vs internal**: penetrasi impor ke internal `pos/`/`inventory/`
  dari luar modul = **0**; semua lewat barrel. Pola folder+barrel baru
  mencakup 2 dari ±7 konteks dan layak digeneralisasi oportunistik
  (`reports.ts`, `supplier-returns.ts`, `hr.ts` saat disentuh).

## Delta sesudah penilaian (pekerjaan yang mendarat selama analisis berjalan)
1. **T5 (`bbdf45e`)**: `PosTerminal` ±2.683 → ±1.294 baris; berkas
   2.985 → 1.384; lima hook + panel terpisah. God-file sejati terakhir hilang;
   komponen tetap besar untuk ukuran komponen (±1.294) tetapi bukan lagi
   satu-satunya titik konsentrasi UI. Skor AD-3 untuk panjang fungsi akan
   naik bila diukur ulang.
2. **T6 (`dc59a3b`)**: halaman berkuei sendiri 47 → 16 (semua sisa satu-tabel
   sah), join/agregasi di halaman → 0, aturan tertulis di AGENTS.md, **dan
   ratchet test arsitektur pertama** (`architecture-read-paths.test.ts`)
   yang menggagalkan suite bila pola lama kembali. Ini menutup sebagian
   temuan AD-4 tentang penegakan oleh kebiasaan — untuk satu batas yang
   paling sering dilanggar. Rekomendasi AD-4 berikutnya (ratchet graf impor
   umum, ratchet mutasi langsung di aksi, rekonsiliasi ringkasan bulanan di
   test konsistensi) tetap terbuka sebagai pekerjaan bernilai-biaya terbaik
   berikutnya.
3. CI tetap **belum operasional** sampai remote dipilih pemilik — satu-satunya
   rekomendasi teratas yang tidak dapat diselesaikan dari dalam kode.

Detail penuh: AD-1-DEPENDENCY-CONTEXT.md, AD-2-SOLID-EKSTENSIBILITAS.md,
AD-3-KUALITAS-BERKAS.md, AD-4-LONGEVITY-FITNESS.md di folder ini.
