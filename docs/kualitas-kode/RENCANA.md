# RENCANA A-26 — Refactor Kualitas Kode Bertahap (Kontrak Pemilik 2026-11-06)

Dasar: `docs/kualitas-kode/AUDIT-KODE-A26.md` (tahap Q0) terhadap
`docs/PANDUAN-KUALITAS-KODE.md`. Prinsip pelaksanaan mengikat semua
tahap:

- **Perilaku aplikasi tidak berubah.** Semua tahap adalah refactor
  struktur: pecah berkas, barrel re-export, geser fungsi — permukaan
  ekspor & payload identik, dibuktikan test paritas bila tahap menyentuh
  API modul (preseden A-19 T4/T4B: paritas 55/55, 20/20, 72/72).
- **Satu pemilik berkas per tahap**, tahap berurutan (mengedit pohon
  yang sama; paralel hanya untuk audit baca-saja).
- **Gerbang setiap tahap** (tanpa pipa, exit code langsung): `pnpm
  test` ≥ jumlah berjalan (tidak boleh turun; naik karena test baru
  di Q1), `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build` 0,
  `pnpm test:e2e` **19/19** sesudah reseed.
- Agen tidak commit; Pemimpin memeriksa diff, menjalankan ulang
  gerbang, lalu commit atomik per tahap.
- Temuan di luar daftar tahap dicatat, tidak dikerjakan diam-diam.

## Keputusan eksplisit yang diminta mandat Q0

1. **`db/schema.ts`: PECAH per domain** (Q2) — bukan dipertahankan.
   Alasan: berkas dengan degree tertinggi di graf (329), 100 tabel dari
   ±10 domain, dan setiap fitur data masa depan akan terus menyentuh
   berkas yang sama (blast radius K-01). Pecah aman karena: nama tabel
   & nama ekspor tidak berubah, `src/db/schema/index.ts` me-re-export
   semuanya sehingga **nol impor pemanggil berubah**, dan drizzle-kit
   membaca skema dari titik masuk yang sama (diarahkan ke folder).
   Migrasi lama tidak disentuh. Alternatif "pertahankan" ditolak:
   keuntungannya hanya menghindari satu tahap mekanis, kerugiannya
   permanen.
2. **`lib/`: PERTAHANKAN logika murni di lib, akutkan kepemilikannya**
   (Q9) — bukan dipindah ke `server/`. Alasan: nilai `lib/` justru
   kemurniannya (teruji tanpa infra, tidak tahu Drizzle); memindahnya
   ke server akan mencampur logika murni dengan akses DB. Yang diubah
   hanya pengelompokan & penamaan kepemilikan (subfolder domain di
   `lib/` + barrel), plus dokumentasi di MODULE_BOUNDARIES.

## Tahap

- [x] **Q0 — Audit & rencana** (tahap ini): graf disegarkan, skor per
  prinsip kontrak, 12 pelanggaran terukur, rencana tahap. Dokumen:
  `AUDIT-KODE-A26.md` + berkas ini + PROGRESS §0I.
- [x] **Q1 — Fitness functions penjaga** (menutup K-08; prasyarat semua
  tahap sesudahnya). Tiga test arsitektur baru di `tests/unit/`:
  (a) **ratchet ukuran berkas** — daftar beku berkas >500 baris per
  keadaan Q0; test gagal bila berkas terdaftar *bertambah* baris atau
  berkas baru menembus 500 baris tanpa masuk daftar dgn alasan;
  daftar hanya boleh menyusut (tahap Q2–Q8 menghapus entri saat
  berkasnya terpecah). (b) **larangan impor internal lintas modul** —
  impor ke `@/server/<domain>/...` dari luar domain itu dilarang
  (barrel saja); memperbaiki 1 bypass yang ada
  (`module-shell.tsx → inventory/opname-tasks` diarahkan ke barrel).
  (c) **test siklus impor level berkas** — graf impor statis tanpa SCC,
  dengan satu pengecualian tertulis: pasangan type-only
  `permissions.ts ↔ modules.ts`. Nol perubahan kode aplikasi selain
  bypass (b). Gerbang: suite naik (test baru), e2e 19/19.
- [x] **Q1b — Sentralisasi kecil dari audit Q0b.** Aging dipindah ke lib/due-date.ts (D-01), quick-entry memanggil effectiveTaxRate kanonis (D-04), formatQty retur diganti nama (D-07), differential parity test quote offline↔server (P-05), perbaikan N+1 pratinjau quick-entry (I-01). Usulan P-04/P-06/P-07/P-08 dilipat ke Q8/Q5/Q6/Q4-Q10.
- [x] **Q2 — `db/schema.ts` dipecah per domain** (K-01). Folder
  `src/db/schema/`: `auth.ts` (user/session/organization/member/
  roles), `platform.ts` (branches, warehouses, companySettings,
  paymentMethods), `accounting.ts` (accounts, mappings, periods,
  journals, monthly balances), `catalog.ts` (groups, customers,
  suppliers, categories, units, products, group prices), `inventory.ts`
  (stock*, purchaseOrders & keluarga gudang), `sales.ts` (sales &
  keluarga POS), `hr.ts` (employees & keluarga SDM), `payroll.ts`
  (statutory), `import.ts`, `index.ts` barrel re-export identik.
  Isi definisi tabel berpindah utuh (potong-tempel terverifikasi diff);
  `src/db/schema.ts` menjadi re-export dari folder **atau** dihapus
  dengan titik masuk drizzle-kit disesuaikan — pilih yang membuat
  semua impor `@/db/schema` tetap sah tanpa edit pemanggil. Bukti:
  `pnpm db:generate` tidak menghasilkan migrasi baru (skema logis
  identik), suite & e2e hijau.
- [x] **Q3 — `settings-forms.tsx` dipecah per topik** (K-02). Folder
  `src/components/pengaturan/forms/`: identitas-pajak, qris,
  metode-pembayaran, gudang-cabang, pemetaan-akun, cetak, penomoran,
  modul, kolom-kustom — mengikuti pengelompokan saver U6 yang sudah
  hidup; berkas asal menjadi barrel re-export agar pemanggil halaman
  pengaturan tidak berubah. Entri ratchet Q1 untuk berkas ini dihapus.
- [x] **Q4 — Lapisan aksi dipecah per domain + batas aksi/domain
  ditegakkan** (K-03). `actions/accounting.ts` → folder
  `actions/accounting/` (jurnal, pembayaran, beban-transfer, master
  akun-pemetaan, periode-tutup-tahun); `actions/hr.ts` → folder
  `actions/hr/` (organisasi, presensi, cuti-lembur, karyawan,
  payroll); `actions/inventory.ts` → folder `actions/inventory/`
  (produk-taksonomi, penerimaan, penyesuaian, transfer, opname,
  pihak). Berkas asal = barrel re-export (pemanggil komponen tidak
  berubah). Dalam tahap yang sama: tulis tabel langsung di actions
  yang berupa *logika domain* (void berantai, pembayaran, run
  payroll) digeser ke fungsi domain pemiliknya di `src/server/`;
  CRUD platform murni (akun, pemetaan, karyawan) boleh tetap di aksi
  dan dicatat sebagai pengecualian sadar di AGENTS.md proyek.
- [x] **Q5 — `catalog.ts` dipecah per agregat baca** (K-04). Folder
  `src/server/catalog/`: `products.ts` (daftar/cari/ekspor produk),
  `parties.ts` (pemasok/pelanggan/grup), `stock-documents.ts`
  (gerakan, riwayat penerimaan/PO/dokumen, stok per produk),
  `group-prices.ts`, `settings-reads.ts` (settings, gudang, metode
  bayar); barrel `catalog/index.ts` + `catalog.ts` re-export. 37
  pemanggil halaman tidak berubah; ratchet ARS1-01 tetap hijau.
- [x] **Q6 — Domain impor disatukan** (K-10 sebagian, K-05 sebagian).
  Folder `src/server/import/`: `import-masters.ts` berpindah utuh,
  fungsi di `actions/import.ts` dipecah internalnya —
  `commitImportBatchAction` 517 baris dipecah menjadi tahap-tahap
  bernama (validasi, panggung, posting, finalisasi) di berkas yang
  sama/folder aksi impor; `lib/import-parse` & `lib/import-classify`
  tetap murni (kepemilikannya diakui di Q9).
- [x] **Q7 — Komponen raksasa UI dipecah** (K-06, K-07). Berurutan per
  berkas, satu pemilik: (a) `pos-terminal.tsx` — lanjutkan pola T5
  A-19: ekstrak sub-panel murni yang masih tertanam (daftar produk,
  bilah sesi) ke `src/components/pos/`, komponen induk menjadi
  orkestrasi; **perilaku & tampilan terminal tidak berubah** (bukti
  screenshot + e2e POS). (b) `hr-panel.tsx` → folder
  `components/akuntansi/hr/` per fitur (organisasi, shift, presensi,
  lembur, cuti, terminasi, parameter) + barrel. (c)
  `quick-entry-modal.tsx` — `QuickEntryForm` 797 baris dipecah per
  mode transaksi ke folder `components/akuntansi/quick-entry/`.
  `payment-panel.tsx` 943, `import-wizard.tsx` 937,
  `bank-reconciliation-panel.tsx` 856: masuk daftar ratchet; dipecah
  di tahap ini bila waktu & gerbang mengizinkan, bila tidak menjadi
  sisa terjadwal eksplisit — bukan diklaim selesai.
- [x] **Q8 — Fungsi raksasa domain dipecah internal** (K-05 sisa,
  K-10 sisa). `supplier-returns/returns.ts`: `postSupplierReturn` 339
  & `createSupplierReturn` 238 dipecah menjadi langkah bernama dalam
  folder yang sama (menutup catatan tertunda sejak A-24 T4B).
  `inventory/receipts.ts`: `voidReceipt` 236 serupa.
  `master-data.ts` 1.165 → folder `server/master-data/`:
  `bulk-edit.ts` vs `parties.ts` (duplikat/gabung/detail pihak).
  `seed.ts` (K-12) dipecah per keluarga data demo hanya bila murah;
  bila tidak, tetap satu berkas dengan alasan tertulis (dev-only).
- [x] **Q8b — Raksasa tersisa.** pos/sales.ts (1718) & pos/returns.ts (923) dipecah per concern di folder server/pos; actions/settings.ts (1287) dipecah per topik pola Q4; inventory/transfers.ts (863) & adjustments.ts (842) diturunkan <800; halaman piutang-utang (886) — dua paruh AR/AP diekstrak ke komponen seksi bersama (D-11 audit Q0b).
- [x] **Q9 — Pengakuan struktural `lib/` + kontrak kepemilikan tabel**
  (K-09, §4 audit). (a) Berkas logika domain murni di `lib/`
  dikelompokkan ke subfolder domain (`lib/pos/`, `lib/payroll/`,
  `lib/import/`, `lib/akuntansi/`, `lib/gudang/`) dengan barrel per
  folder dan/atau re-export dari jalur lama — jalur impor pemanggil
  diusahakan tidak berubah; yang berubah: kepemilikan terlihat.
  (b) MODULE_BOUNDARIES ditambah tabel kepemilikan tulis per tabel
  bersama (`partyPayments`, `stockReceipts`, `stockOnHand`, `sales`):
  siapa boleh menulis lewat fungsi apa — mengubah K-09 dari keadaan
  tak tertulis menjadi kontrak. (c) Target sentuh (K-11): daftar
  permukaan sentuh primer kasir/mobile yang wajib ≥44px ditulis di
  dokumen UI proyek; perbaikan stepper qty POS masuk tahap ini
  sebagai satu-satunya perubahan visual yang diizinkan A-26.
- [x] **Q10 — Gerbang final & penilaian ulang**. — SELESAI
  2026-11-07: gerbang penuh dari reseed bersih (suite 1669/1669,
  typecheck/lint/build exit 0, e2e 19/19); graf disegarkan (6.941
  node/24.563 edge); skor per prinsip kontrak diukur ulang di
  `docs/kualitas-kode/STATUS-TUTUP-A26.md` (6 SESUAI / 6 SEBAGIAN /
  0 MELANGGAR; per K-ID & D-ID); target nol berkas >1000 baris di
  luar pengecualian tertulis TERCAPAI (tersisa hanya `db/seed.ts`
  beku), sub-target semua hasil pecah ≤500 TIDAK tercapai penuh —
  tercatat apa adanya di STATUS-TUTUP-A26 §2; PROGRESS §0I ditutup;
  ZIP rilis dibangun Pemimpin dari commit final.

## Urutan & ketergantungan

Q1 → Q2 → Q3 → Q4 → Q5 → Q6 → Q7 → Q8 → Q9 → Q10. Q1 harus pertama
(penjaga sebelum operasi); Q2 kedua (blast radius terbesar, paling
mekanis, membuka jalan bagi semua pecah lain tanpa konflik skema).
Q3–Q9 boleh ditukar urutannya oleh Pemimpin bila ada konflik berkas,
asal satu pemilik berkas per tahap dan gerbang tidak berubah.
Yang *tidak* dilakukan A-26: memindah struktur utama ke
features/, mengubah URL/rute, mengubah skema logis/migrasi, mengubah
aturan bisnis atau angka, mengganti pola Tx-injection, memindah
logika `lib/` murni ke server.
