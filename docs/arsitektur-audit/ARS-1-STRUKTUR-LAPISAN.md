# ARS-1 — Struktur, Lapisan & Kesesuaian Dokumentasi

Audit baca-saja arsitektur Bisa ERP (tidak ada kode diubah). Semua angka di bawah adalah hasil perintah `grep`/`wc`/skrip graf impor yang dijalankan pada pohon kode saat audit, terhadap baseline Pemimpin yang terkonfirmasi persis: **313 berkas `src/`, 91.044 LOC**; berkas terbesar `inventory.ts` 3.050, `pos.ts` 3.028, `pos-terminal.tsx` 2.985, `reports.ts` 2.723, `schema.ts` 2.683. Ukuran per lapisan: `app` 17.130 · `components` 27.947 · `server` 37.403 · `lib` 4.875 · `db` 3.689 baris.

## Ringkasan vonis per aspek

| Aspek | Vonis | Alasan singkat |
|---|---|---|
| 1. Peta lapisan & arah impor | **SEHAT** | Arah ketergantungan satu arah terbukti terukur: 0 impor `server`/`lib` → `components`/`app`; komponen → `db` = 0; komponen → modul domain server hanya `import type` (6 berkas). |
| 2. Kopling antar modul domain | **SEHAT** | Graf 33 modul `src/server` adalah DAG — **0 siklus**. Hub ber-fan-in tinggi (`accounting` 15, `sequences` 16, `audit` 14) adalah kernel bersama yang disengaja, bukan kopling liar. |
| 3. Konsistensi pola & kepatuhan AGENTS.md | **RAWAN** | Kerangka pola dipatuhi hampir sempurna (`"use server"` 21/21, `guard` di semua berkas, `revalidatePath` 21/21), tetapi ada 62 titik `.parse()` mentah pada input pengguna dan 118 titik mutasi langsung di lapisan actions — dua penyimpangan sistemik, bukan insidental. |
| 4. Modular monolith & batas modul | **SEHAT** | Batas *tulis* terbukti keras: 0 modul di luar `accounting.ts` menyisipkan baris jurnal; POS menyentuh stok hanya lewat `applyStockMovement`. Batas *baca* lebih longgar (lihat ARS1-01). |
| 5. Organisasi berkas | **RAWAN** | 16 berkas >1.000 baris; fungsi domain rata-rata 160–189 baris di dua berkas inti; `schema.ts` monolit 97 tabel; 7 nama berkas bertabrakan lintas lapisan. |

**Jumlah temuan: 12 — P0: 0 · P1: 2 · P2: 4 · P3: 6.**

---

## Bukti fondasi yang terbukti kuat (bukan temuan — penyeimbang vonis)

- **Gerbang tunggal jurnal.** `grep` atas `insert(journalEntries|journalLines` di seluruh `src/server` di luar `accounting.ts`: **0 berkas**. Semua modul memposting lewat `postJournal` — invariant "jurnal seimbang + periode terbuka" punya satu titik penegakan.
- **Gerbang tunggal stok untuk POS.** `src/server/pos.ts` memuat **0** referensi langsung ke `stockMovements`/`stockOnHand`; seluruh mutasi stok lewat `applyStockMovement`/`getStock` dari `inventory.ts`.
- **Disiplin tenant.** 76/76 halaman `src/app/app` memakai `withCompany`/`withCompanyReadOnly`; tidak ada halaman/komponen mengimpor `@/db` (indeks) — hanya `src/lib/auth.ts` dan `src/lib/session.ts` (infrastruktur Better Auth).
- **Pola actions.** 21/21 berkas `src/server/actions/*.ts` diawali `"use server"`; jumlah panggilan `guard(` ≈ jumlah aksi di setiap berkas (total ±181 aksi); `revalidatePath` di 21/21 berkas; satu-satunya ekspor non-async adalah satu ekspor *tipe* (`actions/import.ts:460`).
- **Klaim AGENTS.md terverifikasi terukur** (sampel): halaman `force-dynamic` 76/76 di `/app/app`; migrasi tidak diedit (di luar lingkup audit ini — riwayat git); uang `numeric`+Decimal ditegakkan di lapisan domain (audit ARS-2). AGENTS.md adalah dokumen aturan yang *jujur* — penyimpangan di bawah adalah penyimpangan dari dokumen yang akurat, bukan dokumen yang mengklaim fiksi.

---

## Temuan

### ARS1-01 (P1) — Dua jalur baca: 46 dari 76 halaman menulis kueri sendiri

**Bukti:** `grep -rln '\.select(' src/app/app --include='page.tsx'` → **46 berkas** dari 76 `page.tsx` menjalankan kueri Drizzle sendiri di dalam `withCompanyReadOnly` (contoh representatif: `src/app/app/akuntansi/akun/[id]/page.tsx:44-48` memilih dari `accounts` secara inline, di samping memanggil `listAccountBalances` dari modul server). Pada saat yang sama 72 berkas halaman mengimpor dari `@/server/` — artinya kedua pola hidup berdampingan tanpa aturan tertulis kapan memakai yang mana. Rute API ekspor menambah jalur ketiga yang lebih tipis: 4 berkas di `src/app/api` mengimpor `@/db/schema` langsung.

**Risiko:** klaim AGENTS.md "domain logic belongs in `src/server/*.ts`" pada praktiknya hanya berlaku untuk *tulis*. Untuk *baca*, logika pemilihan kolom, filter tenant tambahan, dan bentuk data tampilan tersebar di 46 halaman. Perubahan skema atau aturan baca (mis. kolom baru wajib tampil, filter status baru) harus diburu halaman per halaman; tidak ada read-model yang bisa diuji satuan selain lewat halaman itu sendiri.

**Rekomendasi:** tetapkan aturan tertulis di AGENTS.md: halaman hanya boleh (a) memanggil fungsi baca modul server, atau (b) kueri inline maksimal satu tabel tanpa join/agregasi untuk kebutuhan tampilan murni. Migrasikan bertahap halaman ber-join/agregasi (mulai dari `akuntansi/`) ke fungsi baca di modul pemiliknya. Jangan rewrite besar — pola inline untuk baca sederhana adalah idiom RSC yang sah; yang perlu ditutup adalah ketidakkonsistenannya.

### ARS1-02 (P1) — Berkas dan fungsi raksasa di inti domain

**Bukti:** 16 berkas `src` >1.000 baris (24 lagi di 500–1.000). `src/server/inventory.ts`: 3.050 baris / 19 fungsi = **160 baris per fungsi**; `src/server/pos.ts`: 3.028 / 16 = **189 baris per fungsi**; `src/components/pos/pos-terminal.tsx`: 2.985 baris / 9 fungsi. Ketiga berkas ini memuat **0** penanda seksi (`grep` pola header seksi), bandingkan `schema.ts` yang punya 28. Fungsi sebesar ini adalah tempat logika posting, validasi, dan orkestrasi transaksi bercampur dalam satu badan.

**Risiko:** ini adalah dua modul yang paling sering disentuh program perbaikan (POS & gudang adalah riwayat FIX terbanyak). Setiap perubahan menuntut membaca ratusan baris konteks; konflik gabung antar-agen/antar-fase sudah menjadi pola operasional nyata di proyek ini (fase diserialkan justru karena pohon yang sama). Tanpa penanda seksi, navigasi bergantung pada pencarian teks.

**Rekomendasi:** (1) Tambahkan penanda seksi berkomentar di `inventory.ts`, `pos.ts`, `pos-terminal.tsx` mengikuti pola `schema.ts` — murah, tanpa risiko perilaku. (2) Pecah mengikuti jahitan yang sudah ada di dalam berkas, bukan arsitektur baru: mis. `inventory.ts` → `inventory/movements.ts` (applyStockMovement & blend AVCO), `inventory/documents.ts` (receipt/adjustment/transfer/opname), `inventory/queries.ts`; `pos-terminal.tsx` → ekstrak panel pembayaran & panel keranjang yang sudah menjadi unit visual tersendiri. Lakukan oportunistik saat berkas disentuh untuk fitur, bukan sebagai proyek tersendiri.

### ARS1-03 (P2) — 62 titik `.parse()` mentah pada input pengguna di 5 berkas actions

**Bukti:** hitungan `.parse(` per berkas actions: `accounting.ts` 14, `inventory.ts` 16, `pos.ts` 13, `settings.ts` 13, `import.ts` 6 (total 62), sementara 16 berkas actions lain konsisten memakai `parseInput` dari `src/lib/action-validation.ts` dan nol `.parse(` mentah. Sampel: `actions/pos.ts:189,244,307` (`cartSchema.parse(input)` dsb.), `actions/settings.ts:241,291,343`. `guard()` di `src/lib/errors.ts:104` **tidak** memetakan `ZodError` — ia hanya menangani `AppError` dan pelanggaran unik; sisanya jatuh ke `INTERNAL` "Terjadi kesalahan pada server".

**Risiko:** ini persis kelas bug yang pernah diperbaiki sebagai temuan audit tersendiri (perbaikan Pengaturan → Pengguna: ZodError mentah menjadi pesan INTERNAL yang menyesatkan). Perbaikannya diterapkan perkasus lewat `parseInput`, tetapi akar strukturnya — dua idiom validasi yang hidup berdampingan — masih ada, sehingga jalur yang belum "kena" tetap memberi pesan server-error untuk kesalahan input biasa. Pengguna melihat kegagalan sistem; pendukung melihat log yang bising.

**Rekomendasi:** titik tunggal: buat `guard()` memetakan `ZodError` → kode `VALIDATION` dengan pesan Indonesia dari `parseInput` (satu perubahan di `src/lib/errors.ts` menutup seluruh 62 titik sekaligus tanpa menyentuh 5 berkas), lalu tetap jadikan `parseInput` idiom baku untuk aksi baru. Ini juga membuat pilihan idiom tidak lagi berkonsekuensi perilaku.

### ARS1-04 (P2) — 118 titik mutasi tabel langsung di lapisan actions

**Bukti:** `grep -cE '\.(insert|update|delete)\('` per berkas actions: `settings.ts` 26, `inventory.ts` 21, `import.ts` 19, `accounting.ts` 17, `payroll-indonesia.ts` 14, `users.ts` 11, `quick-entry.ts` 6, `pos.ts` 3, `hr.ts` 1 — total **118 titik** di 9 dari 21 berkas. AGENTS.md menyatakan "domain logic belongs in `src/server/*.ts`… actions own auth, parsing, revalidation".

**Risiko:** sebagian dapat dibenarkan — CRUD pengaturan dan pengguna memang tipis, dan memaksakan lapisan domain untuknya adalah over-engineering. Tetapi `actions/accounting.ts` (2.190 baris, berkas actions terbesar) dan `actions/inventory.ts` membawa mutasi yang berbagi tabel dengan modul domain; aturan bisnis yang sama lalu hidup di dua tempat dan hanya satu yang teruji integration di tingkat domain. Batas "actions tipis" saat ini adalah kebiasaan, bukan garis yang bisa ditunjuk.

**Rekomendasi:** bedakan secara tertulis di AGENTS.md: (a) CRUD master/pengaturan satu-tabel tanpa jurnal/stok — boleh di actions; (b) mutasi apa pun yang menyentuh jurnal, stok, atau lebih dari satu tabel — wajib lewat modul domain. Audit berkas `actions/accounting.ts` dan `actions/inventory.ts` terhadap garis itu pada kesempatan berikutnya keduanya disentuh; pindahkan hanya yang melanggar (b).

### ARS1-05 (P2) — `schema.ts` monolit: 97 tabel dalam 2.683 baris

**Bukti:** `grep -c 'pgTable(' src/db/schema.ts` → **97**, dan 97 `export const` — seluruh skema basis data (akuntansi, POS, gudang, HR, payroll, impor, aset, pinjaman) dalam satu berkas yang diimpor praktis oleh semua lapisan. Berkasnya sendiri tertata baik (28 penanda seksi, ±27 baris per tabel), jadi ini bukan kekacauan — ini konsentrasi.

**Risiko:** (1) Titik konflik gabung permanen: setiap modul baru atau kolom baru menyentuh berkas yang sama — dalam mode kerja multi-agen/fase proyek ini, itu biaya nyata. (2) Waktu muat editor/typecheck dan beban navigasi tumbuh linear dengan produk. (3) Tidak ada kepemilikan skema per modul yang terlihat dari struktur berkas, padahal kepemilikan domain di lapisan server sudah jelas.

**Rekomendasi:** Drizzle mendukung skema banyak berkas secara native. Pecah mengikuti batas modul server yang sudah ada — `src/db/schema/{accounting,inventory,pos,hr,payroll,master}.ts` + satu `index.ts` yang menggabungkan ekspor agar seluruh impor yang ada (`@/db/schema`) tetap bekerja tanpa perubahan. Lakukan sebagai satu langkah mekanis terverifikasi typecheck+test penuh, bukan bertahap setengah-setengah.

### ARS1-06 (P2) — Batas lapisan tidak ditegakkan oleh perkakas apa pun

**Bukti:** `eslint.config.mjs` hanya merangkai `eslint-config-next/core-web-vitals` + `typescript` dan daftar ignore bawaan — tidak ada `no-restricted-imports`, tidak ada aturan boundaries, tidak ada pemeriksaan graf di CI/test. Seluruh disiplin yang terbukti baik di laporan ini (arah impor, gerbang jurnal, gerbang stok) ditegakkan oleh konvensi, AGENTS.md, dan review manusia/agen.

**Risiko:** bukti bahwa konvensi saja bocor sudah ada di laporan ini (ARS1-03, ARS1-04): penyimpangan masuk tanpa gesekan apa pun. Setiap penguat di masa depan — manusia baru atau agen baru — harus *tahu* aturannya; tidak ada yang *menolak* pelanggarannya. Ini utang yang murah ditutup sekarang dan mahal sesudah basis kode berlipat.

**Rekomendasi:** tambahkan aturan datar di `eslint.config.mjs` via `no-restricted-imports`: `src/components/**` dilarang mengimpor `@/db` dan `@/server/*` selain `@/server/actions/*` dan pola `import type` yang sudah menjadi praktik; `src/lib/**` dilarang mengimpor `@/server` dan `@/components`; `src/server/**` dilarang mengimpor `@/components`/`@/app`. Ditambah satu test unit murah yang menegaskan 0 penyisipan `journalEntries` di luar `accounting.ts` dan 0 referensi tabel stok di `pos.ts` (dua invariant yang hari ini benar — kunci sebelum berubah).

### ARS1-07 (P3) — Satu-satunya siklus impor di seluruh `src/`: `lib/permissions.ts ↔ lib/modules.ts`

**Bukti:** skrip graf atas seluruh impor `@/` di 313 berkas menemukan tepat **1 siklus**: `src/lib/permissions.ts:1` mengimpor *tipe* `ModuleKey` dari `@/lib/modules`, dan `src/lib/modules.ts:39` mengimpor *tipe* `Permission` dari `@/lib/permissions`. Graf modul server (33 modul) sendiri bersih tanpa siklus.

**Risiko:** rendah hari ini — kedua arah adalah `import type`, terhapus saat kompilasi, tidak ada siklus runtime. Rapuh besok: bila salah satu arah berubah menjadi impor nilai (mis. modules butuh daftar izin runtime), siklusnya menjadi nyata di kernel yang diimpor semua lapisan.

**Rekomendasi:** pindahkan tipe `ModuleKey`/`Permission` ke satu berkas tipe netral (mis. `src/lib/permission-types.ts`) yang tidak mengimpor keduanya; `permissions.ts` dan `modules.ts` sama-sama mengimpor dari sana.

### ARS1-08 (P3) — 7 nama berkas bertabrakan lintas lapisan

**Bukti:** `accounting.ts` ada di `lib/`, `server/`, dan `server/actions/`; begitu pula `pos-offline.ts`, `payroll-indonesia.ts`, `quick-entry.ts`, `hr.ts` (masing-masing 3 salinan nama); `inventory.ts` dan `pos.ts` masing-masing 2. Pembagian perannya konsisten (lib = logika murni/tipe, server = domain tx, actions = gerbang aksi) dan jalur impor selalu penuh (`@/server/pos` vs `@/lib/pos-offline`), jadi tidak ada ambiguitas mesin — hanya beban manusia: hasil pencarian "pos.ts" mengembalikan banyak kandidat, dan risiko salah membuka/menyunting berkas ada di lapisan yang salah selalu mengintai.

**Rekomendasi:** jangan rename massal (biaya > manfaat). Tambahkan satu baris komentar kepala di setiap berkas yang namanya bertabrakan menyebut peran lapisannya dan menunjuk dua kembarannya — pola yang sudah dipakai baik oleh shim `field-classes` (ARS1-12). Terapkan saat berkas disentuh.

### ARS1-09 (P3) — Inversi arah kecil: `master-data` bergantung pada `reports`

**Bukti:** `src/server/master-data.ts:19` mengimpor `listPayables, listReceivables` dari `@/server/reports` (untuk detail pihak: saldo piutang/utang). `reports.ts` sendiri ber-fan-out 0 (hanya mengimpor `lib`), sehingga tidak ada risiko siklus; tetapi secara semantik pelaporan adalah lapisan *hilir* — modul master data yang *hulu* bergantung padanya membalik intuisi pembaca graf.

**Rekomendasi:** pindahkan dua fungsi daftar piutang/utang itu ke modul pemilik datanya (`payables.ts`/penerima sejenis) dan biarkan `reports.ts` mengimpornya dari sana untuk kebutuhan laporan — arah menjadi master → domain → reports. Perubahan kecil, satu berkas konsumen.

### ARS1-10 (P3) — Lima penyimpangan kecil dari huruf konvensi (semua terkendali)

**Bukti & penilaian satu per satu:**
1. `src/server/actions/company.ts` — satu-satunya berkas actions tanpa `requirePermission` (0 panggilan); memakai `getSession` + validasi membership manual untuk ganti perusahaan aktif. Terkomentar jelas dan memang mendahului konteks perusahaan; penyimpangan disengaja dari huruf "call requirePermission".
2. `src/lib/qris-image.ts` — satu-satunya berkas `"use server"` di luar `src/server/actions/` (dipakai `actions/settings.ts`). Aksi yang tinggal di `lib/` melanggar peta mental "aksi hanya di actions/".
3. Cek peran by-name di halaman: tepat 2 titik — `akuntansi/periode/page.tsx:95` (`ctx.role === "owner"` untuk buka-kunci periode) dan `pengaturan/pengguna/page.tsx:106` (`canAssignOwner`). AGENTS.md melarang cek peran by-name, tetapi juga memandatkan aturan owner-spesifik itu sendiri; keduanya adalah pengecualian yang dimandatkan dokumen yang sama — catat sebagai pengecualian resmi di AGENTS.md agar tidak ditiru untuk kasus umum.
4. `src/server/member-permissions.ts:24` membaca tabel `member` (Better Auth) dengan `db` langsung di luar `withCompany` — dibenarkan: tabel auth bukan tabel bisnis ber-RLS dan konteks tenant belum terbentuk pada titik itu; jalur peran kustomnya sendiri memakai `withCompanyReadOnly`.
5. `src/server/supplier-returns.ts:1177` membaca `stockMovements` langsung (1 titik, baca-saja, memverifikasi gerakan milik retur itu sendiri saat void) sementara mutasinya tetap lewat `applyStockMovement` — kebocoran baca kecil melintasi batas inventory.

**Rekomendasi:** dokumentasikan (1), (3), (4) sebagai pengecualian bernama di AGENTS.md; pindahkan (2) ke `server/actions/` atau beri komentar alasan; (5) dapat ditutup dengan fungsi baca kecil di `inventory.ts` bila berkasnya disentuh.

### ARS1-11 (P3) — `quick-entry` adalah konsentrator kopling (by design, titik rapuh)

**Bukti:** `src/server/quick-entry.ts` mengimpor 6 modul domain — `accounting, audit, opening-balances, payables, pos, supplier-returns` — fan-out tertinggi bersama `hr.ts` (6) dan di bawah trio 7 (`inventory`, `pos`, `supplier-returns`). Ini fasad modal "Catat Transaksi" yang memang dirancang menjangkau banyak domain dari satu pintu.

**Risiko:** bukan cacat — fasad memang begitu — tetapi ia adalah berkas pertama yang pecah bila tanda tangan domain mana pun berubah, dan tempat termudah bagi logika domain baru untuk "dititipkan" daripada ditempatkan di modul pemiliknya.

**Rekomendasi:** jaga disiplin yang ada: `quick-entry` hanya boleh *memanggil* fungsi domain, tidak memuat aturan domain sendiri. Tambahkan ke daftar periksa review bila berkas ini tumbuh melewati ±1.000 baris.

### ARS1-12 (P3) — Shim re-export `field-classes` belum selesai dimigrasikan

**Bukti:** definisi gaya formulir kini tinggal di `src/components/blocks/field-classes.ts`; `src/components/akuntansi/field-classes.ts` adalah shim `export *` yang terdokumentasi sangat baik (menyebut riwayat FIX-R2 & FIX-GDG). Namun **20 berkas** masih mengimpor jalur lama vs **17 berkas** jalur baru — migrasi berhenti di tengah.

**Risiko:** kecil dan tidak berbahaya (satu sumber definisi tetap), tetapi selama shim hidup, pembaca baru tidak tahu jalur mana yang baku.

**Rekomendasi:** selesaikan migrasi impor 20 berkas itu dalam satu commit mekanis (sed-replace jalur impor + typecheck), lalu hapus shim. Bila sengaja dipertahankan permanen, nyatakan itu di kepala berkasnya.

---

## Skor ARS-1: **7 / 10**

Justifikasi: fondasi strukturalnya di atas rata-rata untuk monolit modular seusia ini — graf impor tanpa siklus runtime, arah lapisan yang bersih terukur, dua gerbang invariant terpenting (jurnal dan stok) yang benar-benar tunggal dan terbukti dengan grep, pola actions yang seragam di 21/21 berkas, dan dokumen aturan (AGENTS.md) yang klaimnya terbukti akurat saat diuji, bukan sekadar aspirasi. Yang menahan skor adalah skala tanpa pemecahan: dua berkas domain inti dan satu komponen terminal masing-masing ±3.000 baris dengan fungsi 160–189 baris, skema 97 tabel dalam satu berkas, serta dua penyimpangan sistemik yang dibiarkan hidup berdampingan dengan pola bakunya — 62 titik validasi mentah yang memberi pesan error menyesatkan dan 118 titik mutasi yang mengaburkan garis "actions tipis" — semuanya tanpa satu pun penegakan perkakas yang mencegah penyimpangan berikutnya. Tidak ada temuan P0: tidak ada yang mengancam keberlanjutan hari ini; semua P1/P2 adalah utang yang masih murah dibayar sekarang dan terbukti akan membengkak mengikuti laju pertumbuhan berkas yang sama.
