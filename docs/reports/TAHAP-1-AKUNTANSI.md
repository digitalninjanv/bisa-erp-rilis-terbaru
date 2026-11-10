# Laporan Tahap 1 — Akuntansi

Tanggal: 2026-11-03 · Pemimpin: sesi utama · Status: **SELESAI** (seluruh P0/P1/P2 Akuntansi tuntas & terverifikasi; P3 menjadi utang terjadwal Tahap 4/5)

## 1. Temuan audit (docs/audit/AKUNTANSI.md — 23 temuan)

| ID | Temuan | Prioritas | Status akhir tahap |
|---|---|---|---|
| AK-P1-01 | Neraca & laporan ekuitas per tanggal lampau salah diam-diam (syarat tanggal di ON clause LEFT JOIN) | P1 | ✅ Diperbaiki `b981918` |
| AK-P1-02 | `postJournal` tidak memvalidasi akun; `journal_lines.account_id` tanpa FK | P1 | ✅ Diperbaiki `4a2df5f` (+ migrasi 0007, keputusan D-1) |
| AK-P1-03 | Jurnal payroll hanya Dr beban/Cr utang bersih — potongan gaji hilang dari buku besar | P1 | ✅ Diperbaiki `cbf4ee0` |
| AK-P1-04 | Jurnal sistem (penjualan, payroll, dst.) bisa dibalik dari halaman jurnal manual | P1 | ✅ Diperbaiki `cbf4ee0` |
| AK-P2-01 | Periode `locked` bisa dibuka sekali klik izin biasa, tanpa alasan | P2 | ✅ Diperbaiki `95c64f3` + wiring `a6264b4` |
| AK-P2-02 | Fungsi laporan tidak menyaring status `posted` (jurnal void/draft bocor ke laporan) | P2 | ✅ Diperbaiki `8614cf0` |
| AK-P2-03 | Pembayaran AR/AP selalu tanggal hari ini; tidak bisa di-void | P2 | ✅ Diperbaiki `9653df0` + `c9a8480` (migrasi 0008, D-2) |
| AK-P2-04 | Transfer bank & payroll run tanpa jalur void | P2 | ✅ Diperbaiki `9653df0` + `c9a8480` |
| AK-P2-05 | Void beban menelan hasil `reverseSourceJournal` null (dokumen void, jurnal tidak terbalik) | P2 | ✅ Diperbaiki `95c64f3` |
| AK-P2-06 | Kunci pemetaan akun bebas; akun tujuan tidak divalidasi | P2 | ✅ Diperbaiki `95c64f3` |
| AK-P2-07 | Kolom pembanding menghilangkan akun yang hanya aktif di periode pembanding | P2 | ✅ Diperbaiki `8614cf0` |
| AK-P2-08 | Arus kas mengabaikan `accounts.cash_flow_group`, menebak dari string sourceType | P2 | ✅ Diperbaiki `8614cf0` |
| AK-P2-09 | Saldo berjalan buku besar mentah — akun kredit-normal tampil negatif | P2 | ✅ Diperbaiki `8614cf0` |
| AK-P2-10 | Update akun/karyawan no-op diam-diam; ganti `type` akun bertransaksi tanpa penjaga; nominal gaji negatif diterima | P2 | ✅ Diperbaiki `95c64f3` |
| AK-P2-11 | Nilai persediaan dashboard (stok × harga pokok) ≠ saldo akun persediaan di GL | P2 | ✅ Diperbaiki `8614cf0` |
| AK-P2-12 | Penjaga hapus akun tak mencakup `payment_methods.account_id` & `customer_groups.discount_account_id` | P2 | ✅ Diperbaiki `95c64f3` |
| AK-P3-01…07 | Validasi longgar & pesan generik; jurnal manual tanpa idempotency; race payroll per periode; performa laporan (query tanpa batas, agregasi Number); UX pemilih akun & input nominal; tarif pajak tanpa validasi rentang; penomoran dokumen belum bisa dikustomisasi | P3 | ⏳ Utang terjadwal — P3-04 & P3-05 masuk Tahap 4 (performa/UI global), P3-07 masuk Tahap 4 (kustomisasi), P3-01/02/03/06 masuk Tahap 5 (hardening) |

Catatan lintas-modul yang ikut tuntas di tahap ini: **kedua P0 program** — GD-P0-1 (tanda penyesuaian stok terbalik, `14358a5`) dan SEC-P0-01 (reset kata sandi owner oleh non-owner, `05fd435`) — diperbaiki lebih awal karena sifatnya mengancam integritas data/keamanan.

## 2. Perbaikan yang dilakukan (semua TDD, diverifikasi ulang oleh Pemimpin sebelum commit)

| Perbaikan | Berkas utama | Pelaksana |
|---|---|---|
| Agregasi laporan bersyarat tanggal (pola `getTrialBalance`) | `src/server/reports.ts` | Backend Akuntansi |
| Konvensi tanda penyesuaian stok per arah + jurnal campuran dua arah | `src/server/inventory.ts`, `actions/inventory.ts`, `adjustment-form.tsx` | Backend Gudang |
| Penjaga reset kata sandi owner | `src/server/actions/users.ts`, `user-access.tsx` | Backend Keamanan |
| Validasi akun `postJournal` + FK `journal_lines.account_id` (migrasi 0007) | `src/server/accounting.ts`, `src/db/migrations/0007_*` | Backend Akuntansi + Pemimpin (test D-1) |
| Jurnal payroll tiga kaki (bruto/utang/potongan) + tolak bersih negatif; jurnal sistem tak bisa dibalik dari halaman jurnal | `src/server/actions/accounting.ts`, halaman detail jurnal | Backend Akuntansi |
| Filter `posted` di semua fungsi laporan; pembanding union akun; arus kas dari `cash_flow_group`; tanda buku besar per saldo normal; persediaan dashboard = saldo GL | `src/server/reports.ts` | Backend Laporan |
| Buka kunci periode owner+alasan+audit; void beban gagal keras; whitelist pemetaan; update hantu NOT_FOUND; tipe akun terkunci; penjaga hapus akun diperluas | `src/server/actions/accounting.ts`, `period-manager.tsx`, `periode/page.tsx` | Backend Akuntansi + Pemimpin (wiring) |
| Tanggal pembayaran dipilih pengguna; void payroll run; migrasi 0008 (status `party_payments`/`bank_transfers`); void pembayaran per-jurnal lewat idempotency key + hitung ulang sisa; void transfer bank | actions accounting/pos, `payment-form.tsx`, halaman bank & piutang-utang, `src/db/migrations/0008_*` | Backend Akuntansi |

## 3. Fitur yang ditambahkan / dilengkapi

- **Void yang sah untuk dokumen uang**: pembayaran utang, penerimaan piutang (termasuk kasus pembayaran sebagian berkali-kali — yang divoid hanya jurnal pembayaran itu), transfer bank (biaya admin ikut terbalik), dan payroll run (run yang sudah dibayar ditolak dengan arahan jelas). Semua void: alasan wajib, audit log, jurnal pembalik tertaut.
- **Tanggal pembayaran bisa dipilih** pada form pembayaran bersama (default hari ini) — pencatatan terlambat/backdate kini benar tanggalnya di dokumen dan jurnal.
- **Kontrol periode bertingkat yang nyata**: buka kunci hanya owner + alasan tercatat; tombolnya hanya tampil untuk owner.
- Perilaku yang dipertahankan secara sadar (bukan bug): bulan tanpa baris periode = terbuka (semantik proyek); `getInventoryValuation` tetap laporan gudang qty × HPP (yang dibetulkan hanya angka dashboard); hitungan jumlah dokumen di ringkasan jurnal tetap semua status (itu jumlah dokumen di daftar).

## 4. UI/UX sebelum → sesudah

- Form pembayaran: tanpa field tanggal → ada "Tanggal pembayaran" (default hari ini).
- Halaman piutang-utang: pembayaran tidak bisa dibatalkan & tak ada status → kolom Status + tombol Batalkan per pembayaran posted, baris void redup/tercoret, kartu total hanya menghitung pembayaran aktif.
- Halaman bank: transfer tak bisa dibatalkan → tombol Batalkan + label status; statistik tidak lagi menghitung transfer yang sudah divoid (termasuk feenya).
- Halaman payroll: run tak bisa dibatalkan → tombol void untuk run posted + label "dibatalkan"; periode run void bisa diproses ulang.
- Manajer periode: semua status bisa dibuka siapa pun berizin → periode locked hanya owner + prompt alasan wajib.
- Detail jurnal sistem: tombol "Buat jurnal pembalik" menyesatkan → label + banner "Jurnal sistem — batalkan dari modul asal".

## 5. Hasil tes & build (output nyata, dijalankan Pemimpin)

- Baseline awal program: unit 57/57, integrasi 14/14, build exit 0.
- Akhir Tahap 1: **suite penuh 115/115 lulus (11 berkas)** — termasuk 58 test regresi baru yang ditulis tahap ini (journal-validation 7, payroll-reverse 4, inventory-adjustment 4, reports-p2 6, accounting-actions-p2 12, payments-void-p2 9, consistency +16 di antaranya).
- `pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm build` exit 0 (terverifikasi pada commit `c9a8480`).
- Setiap perbaikan dibuktikan RED dulu dengan angka (contoh: jurnal void Rp555.000 bocor ke laba rugi; buku besar pendapatan −255.000 vs seharusnya +245.000; persediaan dashboard meleset Rp1,38 juta dari GL) lalu GREEN.
- Migrasi terverifikasi manual: 0007 menolak baris jurnal yatim (error 23503, data seed utuh); 0008 hanya dua ALTER penambahan kolom, baris lama otomatis `posted`.
- Utang tes yang dicatat jujur: penjaga reset kata sandi owner (SEC-P0-01) belum punya test otomatis khusus; pola mock sesi kini tersedia dari test payroll untuk menutupnya di Tahap 5.

## 6. Sisa masalah & rencana berikutnya

- 7 temuan P3 Akuntansi di atas — dijadwalkan ke Tahap 4 (performa laporan/pagination, UX pemilih akun & input nominal, kustomisasi penomoran) dan Tahap 5 (validasi skema bersama, idempotency jurnal manual, unique index payroll per periode, validasi tarif pajak).
- DB dev di-reseed pada gerbang tahap ini (polusi fixture test action-level dibersihkan; jurnal uji periode 2099 dari test lama hilang bersama reseed).
- Berikutnya: **Tahap 2 Gudang** — mulai dari GD-P1-2 (moving average dihitung per-gudang padahal harga pokok global), GD-P1-4 (produk non-stok digerakkan POS), GD-P1-5 (dokumen gudang posted tanpa void), GD-P1-6 (impor updateExisting menelan stok awal), GD-P1-7 (validasi qty/biaya), GD-P1-8 (CRUD master data), lalu P2/P3 Gudang.
