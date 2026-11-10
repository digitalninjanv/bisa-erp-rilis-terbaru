# ADR — Strategi Isolasi Transaksi & Penguncian Posting

> Status: **Diterima (dokumentasi praktik yang sudah terbukti)** ·
> Program Rekayasa Tahap R1, 2026-11-08. Menutup baris matriks R0-13.
> ADR ini TIDAK mengubah kode: ia menuliskan strategi yang selama ini
> implisit dan terverifikasi uji, agar penyunting baru tidak menulis
> check-then-write tanpa kunci secara tidak sadar.

## Keputusan

1. **Level isolasi tunggal: Read Committed (bawaan PostgreSQL).**
   Tidak ada `isolationLevel` di seluruh repo (terverifikasi grep R0/R1:
   0 pemakaian); `withCompany`/`withCompanyReadOnly` di
   `src/db/tenant.ts` membuka `db.transaction` tanpa menaikkan level.
   Menaikkan isolasi global (RR/SSI) **ditolak**: mengubah profil
   deadlock/serialization-failure seluruh jalur posting tanpa kebutuhan
   terbukti.
2. **Aturan bisnis check-then-write WAJIB dikunci eksplisit** pada baris
   bersama yang diperiksa: `SELECT … FOR UPDATE` (Drizzle `.for("update")`)
   pada baris induk yang menjadi titik serialisasi alami (baris stok,
   baris sesi, baris periode, baris dokumen). Terhitung **74 titik kunci
   di 36 berkas** `src/server/` (grep R1, 2026-11-08).
3. **Semantik buat-sekali (create-once) dijaga constraint unik, bukan
   kunci**: pola payroll — periksa awal memberi pesan ramah, pelanggaran
   `23505` pada constraint penjaga diterjemahkan ke `AppError CONFLICT`
   yang sama.
4. **Urutan kunci konsisten** saat mengunci banyak baris setabel
   (pelajaran AUD-008: flake deadlock langka 40P01 di sekitar kunci
   `cash_sessions` pada suite paralel — invarian tidak pernah rusak,
   tetapi urutan kunci adalah disiplin yang wajib dijaga).
5. **Serializable & kunci advisory: belum dipakai, bersyarat.**
   Serializable hanya bila invarian masa depan membentang banyak baris
   yang tidak punya baris induk tunggal untuk dikunci — wajib disertai
   loop ulang pada `40001` dan amendemen ADR ini. Kunci advisory
   (`pg_advisory_*`: 0 pemakaian) hanya untuk pekerjaan singleton kasar
   bila tidak ada baris singleton alami; pola yang diutamakan tetap
   kunci baris periode/dokumen.

## Inventaris titik posting & pola kuncinya (bukti berkas:baris, R1)

| Jalur posting | Titik kunci / penjaga | Bukti |
|---|---|---|
| Gerakan stok & AVCO | Baris `stock_on_hand` dikunci sebelum baca qty; baris `products` dikunci sebelum hitung-ulang AVCO (`costPrice` global per produk — komentar kode menyatakannya); baca saldo terkunci utk dokumen | `src/server/inventory/movements.ts:67,129,368` |
| Dokumen stok (terima/transfer/penyesuaian/opname/void) | Baris dokumen dikunci sebelum transisi status | `inventory/documents.ts:64`, `receipts.ts`, `receipt-void.ts`, `transfers-receive.ts`, `adjustments-post.ts` |
| Jurnal & periode | `assertPeriodOpen` mengunci baris `fiscal_periods` (serialisasi posting vs tutup periode); `postJournal` adalah gerbang tunggal posting (keseimbangan + periode terbuka ditegakkan di dalamnya) | `src/server/accounting.ts:254` (kunci), `:228` (assert), `:287` (postJournal) |
| Penjualan POS | Baris `cash_sessions` dikunci di jalur buat penjualan (sesi eksplisit & penyelesaian offline) dan saat tutup sesi/mutasi laci | `pos/sales-create.ts:324,352`; `pos/sessions.ts:112,223` |
| Retur/void/pembayaran penjualan | Baris dokumen asal dikunci sebelum pembalikan/pelunasan | `pos/returns.ts`, `pos/sales-void.ts`, `pos/sales-payments.ts`, `pos/receivables.ts`, `pos/returns-settlement.ts` |
| Pembelian & utang | Baris PO dikunci saat transisi; baris dokumen utang dikunci saat bayar/void | `purchasing.ts:50`; `payables.ts:411,504,530,538,733` |
| Batch FEFO & serial | Baris batch/serial dikunci sebelum alokasi | `batches.ts:86,108`; `serials.ts:688` |
| Payroll | **Tanpa kunci baris**: constraint unik `payroll_runs_company_period_uq` + `payroll_runs_company_number_uq`; pelanggaran keduanya diterjemahkan ke CONFLICT yang sama (pengerasan A4 atas temuan AK-P3-03/AUD-008) | `src/server/actions/hr/payroll.ts:123` (pra-cek), `:618-627` (terjemahan 23505); skema `src/db/schema/payroll.ts` |
| Sesi kas (buka/tutup) | Baris sesi dikunci saat tutup & mutasi laci; buka sesi dijaga constraint/idempotensi jalur sesi | `pos/sessions.ts:112,223` |
| Lainnya (konsisten pola sama) | kasbon/pinjaman karyawan, reimbursement, aset tetap (run penyusutan), rekonsiliasi bank, tutup tahun, saldo awal, kredit pihak, reservasi, retur pemasok | `employee-advances.ts`, `employee-loans.ts`, `reimbursements.ts`, `fixed-assets.ts`, `bank-reconciliation/matching.ts`, `year-end-closing.ts:301`, `opening-balances/*.ts`, `party-credits.ts`, `party-writeoffs.ts`, `reservations.ts`, `supplier-returns/posting.ts:88,326` |

## Bukti uji konkurensi

- **Audit Produksi A3** (skrip `scripts/audit/bench-a3-volume.ts`
  mode `concurrency`, data volume 10 rb produk): **5 penjualan
  bersamaan atas produk yang sama → 5/5 berhasil, stok akhir tepat
  85 (= 100 − 5×3), tanpa oversell dan tanpa deadlock.**
- **A2 rantai (g)**: sinkron offline tepat-sekali — kirim ulang muatan
  yang sama menghasilkan `duplicate`, tidak ada penjualan ganda.
- **Pengecualian yang tercatat jujur (AUD-008, MONITOR)**: flake
  deadlock langka (40P01) pada test rantai sesi kas saat suite paralel
  penuh dan balapan pesan payroll — pada keduanya **invarian data
  terpegang** (tepat satu pemenang, kode CONFLICT benar); yang goyah
  hanya bentuk pesan/hasil pada pihak yang kalah. Inilah alasan aturan
  urutan kunci (keputusan 4) ditulis eksplisit.

## Konsekuensi

- Kode posting baru mengikuti pola tabel di atas; peninjau menolak
  check-then-write tanpa kunci baris/constraint penjaga.
- Perubahan strategi (Serializable per-domain, advisory lock, menaikkan
  isolasi global) wajib lewat amendemen ADR ini + uji konkurensi baru,
  bukan keputusan lokal di satu berkas.
