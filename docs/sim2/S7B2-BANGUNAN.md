# SIM-2 Fase S7B-2 — Pembangunan Lanjutan II (§6F / §8 / §12 + D-24 / D-25)

**Status: SELESAI — semua gerbang hijau, belum di-commit (menunggu Pemimpin).**

Gerbang akhir (dijalankan 2026-11-04):
- `pnpm test` — **881/881 lulus, 101 berkas** (test baru S7B-2: **40 test dalam 7 berkas**).
- `pnpm build` — **exit 0** (exit mentah, tanpa pipa).
- `pnpm typecheck` — bersih.

Migrasi baru: **`0038_s7b2_bangunan.sql`** (12 tabel baru + kolom aditif; RLS `tenant_isolation` + GRANT `app_user`). Rilis wajib migrate sampai 0038.

---

## Batch 1 — Pinjaman karyawan & reimbursement (§6F) — SELESAI

Domain: `src/server/employee-loans.ts`, `src/server/reimbursements.ts`. Actions: `src/server/actions/employee-loans.ts`, `src/server/actions/reimbursements.ts` (gerbang `payroll.manage`, modul akuntansi). UI: halaman `/app/akuntansi/pinjaman` (+ detail per karyawan), `/app/akuntansi/klaim`; nav Akuntansi: Pinjaman, Reimbursement.

- **Pinjaman** terpisah tegas dari kasbon: seri dokumen **PJM**, pola cicilan `tenor` (sisa ÷ sisa bulan, HALF_UP) atau `fixed`; jurnal pencairan Dr Piutang / Cr kas-bank (sourceType `employee_loan`). Akun piutang: pemetaan `employee_loan_receivable` bila perusahaan mengaturnya, else jatuh ke `employee_receivable` (1220) — pemisahan akun murni konfigurasi pemetaan (D-25).
- Cicilan terpotong otomatis di run payroll sebagai baris bernama sendiri **`loan_installment`** ("Cicilan pinjaman karyawan"), sesudah kasbon, dengan cap sisa bersih yang sama; `payroll_items.loan_deduction` + `payroll_runs.total_loan_deductions` tercatat; void run memulihkan sisa pinjaman. Pelunasan/setoran manual + void pinjaman (memulihkan) tersedia.
- **Final pay S7B-1 diperluas**: sisa pinjaman ditagih sesudah sisa kasbon; penjaga `acknowledgeShortfall` mencakup gabungan keduanya; hasil memuat `loanCharged`.
- **Reimbursement**: klaim (tanggal, kategori = akun COA beban aktif & postable, nominal, keterangan) dengan persetujuan maker-checker (pengaju ≠ penyetuju), pengesahan boleh lebih kecil dari klaim, penolakan wajib alasan; penjaga duplikat (karyawan+tanggal+akun+nominal+keterangan pada status aktif).
- **Keputusan arsitektur (tercatat): pembayaran reimbursement = tunai langsung (Dr Beban / Cr kas-bank, sourceType `reimbursement`, idempoten per klaim), BUKAN digabung ke payroll.** Alasan: klaim adalah penggantian biaya perusahaan, bukan penghasilan karyawan — menggabungkannya ke gaji mencampurnya dengan komponen kena pajak dan mengaburkan jejak beban. Akun piutang karyawan (1220) tidak tersentuh oleh reimbursement — dibuktikan test.

**Bukti** — `tests/sim2/hr-loans-reimbursement.test.ts` **9/9**: pinjaman Rp12 jt tenor 12 → dua run memotong tepat Rp1.000.000/run sebagai `loanDeduction`; void run memulihkan sisa ke Rp11 jt; setoran manual Rp1 jt → sisa Rp10 jt; kasbon full Rp300 rb + pinjaman fixed Rp400 rb terpotong sebagai dua baris berbeda; terminasi tanpa penegasan ditolak, dengan `acknowledgeShortfall` sisa Rp6 jt ditagih (bersih 0, sisa tetap piutang); klaim Rp750 rb disahkan Rp700 rb oleh penyetuju lain → Dr 6040 / Cr 1000 Rp700 rb dan saldo 1220 tidak berubah; klaim duplikat ditolak; klaim ditolak tidak dapat dibayar; pengaju tidak dapat mengesahkan klaim sendiri.

## Batch 2 — Aset tetap & penyusutan (§8) — SELESAI

Domain: `src/server/fixed-assets.ts`. Actions + UI: `/app/akuntansi/aset` (stat nilai buku/perolehan/akumulasi + kartu tie-out GL, daftar aset, riwayat run, tabel kategori).

- Kategori terkonfigurasi (umur manfaat bawaan, persen residu bawaan, akun per kategori). Akun diselesaikan **kategori > pemetaan perusahaan**; `ensureFixedAssetAccounts` menanam pemetaan tanpa menimpa yang sudah diatur: `fixed_asset` 1500, `accumulated_depreciation` 1510, `depreciation_expense` **6090 "Beban Penyusutan" (akun baru)**, `asset_disposal_gain` 4030, `asset_disposal_loss` 6070.
- Registrasi aset: seri **AST**, Dr Aset / Cr sumber dana; garis lurus; **bulan perolehan inklusif**, bulan terakhir menyerap sisa pembulatan, akumulasi tidak pernah melebihi cost − residu.
- Run bulanan: satu jurnal agregat per periode (diagregasi per akun beban/akumulasi), **idempoten** — proses ulang periode yang sama ditolak (CONFLICT + indeks parsial unik DB).
- **Keputusan arsitektur: membatalkan (void) run penyusutan membalik jurnalnya DAN menghapus baris rincian run** — indeks unik per (aset, periode) tidak punya kolom status, jadi baris harus hilang agar periode dapat diproses ulang; jurnal balik tetap menjadi jejak auditnya.
- Pelepasan: Dr akumulasi + Dr hasil / Cr cost, selisih ke gain/loss; penyusutan berhenti mulai bulan pelepasan.

**Bukti** — `tests/sim2/fixed-assets.test.ts` **5/5**: aset Rp12 jt umur 12 residu 0 diperoleh 2026-01-10 → run Jan/Feb/Mar masing-masing total Rp1.100.000 (aset utama Rp1 jt + rak Rp2,4 jt/24 bln = Rp100 rb); proses ulang 2026-02 ditolak; nilai buku aset utama sesudah 3 run Rp9.000.000; total akumulasi laporan Rp3,3 jt **= saldo GL 1510**; void run Maret → GL −Rp2,2 jt → proses ulang → −Rp3,3 jt; pelepasan 2026-04-15 hasil Rp8 jt → Dr 1510 Rp3 jt + Dr Kas Rp8 jt + Dr rugi Rp1 jt / Cr 1500 Rp12 jt; run April hanya rak Rp100 rb.

## Batch 3 — Purchase Request formal — SELESAI

Domain: `src/server/purchase-requests.ts`. UI: `/app/gudang/purchase-request` + halaman detail; nav Gudang: Purchase Request.

- PR: peminta, departemen (bila ada), baris produk (jasa = produk `trackStock=false`), qty, harga perkiraan, alasan; snapshot nama/SKU per baris (REM-02); seri **PRQ**.
- Status diajukan → disahkan/ditolak (maker-checker; penolakan wajib alasan). **Ambang persetujuan konfigurasi** `company_settings.pr_approval_threshold`: total di atas ambang hanya boleh disahkan peran owner/admin/manager.
- Konversi: PR disahkan → satu PO utuh lewat `createPurchaseOrder` (unitCost = harga perkiraan, catatan `Dari PR <nomor>`); status `converted` + `convertedPoId` tercatat; konversi ulang ditolak; PR ditolak tidak dapat dikonversi.

**Bukti** — `tests/sim2/purchase-requests.test.ts` **6/6**: PR 2 baris total Rp500 rb; self-approve ditolak; manager mengesahkan → konversi → PO berisi baris yang sama (10×Rp10 rb + 1×Rp400 rb); konversi ulang ditolak (PO tetap 1); penolakan tanpa alasan ditolak; ambang Rp1 jt: PR Rp4 jt disahkan accountant **ditolak**, manager lolos.

## Batch 4 — Reservasi stok & transfer dua tahap — SELESAI

Domain: `src/server/reservations.ts`; integrasi `src/server/pos.ts` (quote & checkout) dan `src/server/inventory.ts` (transfer). UI: `/app/gudang/reservasi`, seksi in-transit di halaman transfer; nav Gudang: Reservasi stok.

- **Definisi reservasi (ditegaskan)**: reservasi manual per produk+gudang dengan masa berlaku; mengurangi stok **TERSEDIA** (on hand − reserved) pada pemeriksaan ketersediaan POS (quote & checkout, termasuk baris batch yang biasanya melewati pra-cek) **tanpa menulis `stock_movements` dan tanpa mengubah `stock_on_hand`** — invariant ledger utuh. Kedaluwarsa dinilai saat dibaca (dari `expiresAt`, tanpa cron); rilis/batal eksplisit. Seri dokumen **RSV**.
- **Transfer dua tahap** di balik saklar `company_settings.transfer_two_step_enabled` (bawaan mati = mode satu tahap lama tidak berubah): kirim → status dokumen `in_transit`, hanya leg keluar tercatat, seri audit `inventory.transfer.ship`; terima di tujuan (`receiveTransfer`) menulis leg masuk (batch dipulihkan dari gerakan keluar dokumen yang sama → batch identik di tujuan), mengisi `receivedBy`/`receivedAt`. Ringkasan in-transit (jumlah dokumen, Σ qty, Σ nilai) tampil di halaman reservasi & transfer. Transfer `in_transit` dapat di-void (leg keluar dibalik).

**Bukti** — `tests/sim2/reservations-transfers.test.ts` **6/6**: stok 10, reservasi 7 → quote `stock` 3, jual 4 ditolak, jual 3 lolos, on-hand 7, Σ movements tetap 7 (reservasi tidak menulis ledger); rilis → jual 4 lolos; reservasi kedaluwarsa tidak mengurangi; mode satu tahap: transfer langsung `posted`; mode dua tahap: kirim 3 → asal berkurang, tujuan belum bertambah, ringkasan in-transit 1 dokumen qty 3 nilai Rp30.000, konservasi asal+tujuan+in-transit tetap; terima → tujuan bertambah, total konservasi; void transfer in-transit memulihkan asal.

## Batch 5 — Nomor seri — SELESAI

Domain: `src/server/serials.ts` (registrasi, konsumsi seri terpilih, konsumsi tertua, pemulihan void/retur, gerakan transfer, kartu seri). Kolom `products.track_serial` (pola `track_batch`, migrasi 0038). Status seri: `in_stock` / `in_transit` / `out` / `void`, unik per (perusahaan, produk, nomor seri).

- Penerimaan mewajibkan daftar seri per baris untuk produk serial (jumlah persis qty, unik); POS/barang keluar memilih seri yang tersedia di gudang itu (dikunci FOR UPDATE); seri tidak dapat keluar dua kali; dokumen stok lain (penyesuaian/opname/retur) mengonsumsi seri tertua; karantina merelokasi seri; transfer memindahkan seri (dua tahap: `in_transit`); retur pemasok & void/retur penjualan memulihkan seri.
- UI: toggle "Lacak nomor seri" di form produk, kartu seri di halaman detail produk, textarea seri per baris di form penerimaan, input seri per unit di terminal POS (quote terminal menahan pemanggilan server sampai seri lengkap, dengan petunjuk inline).

**Bukti** — `tests/sim2/serial-numbers.test.ts` **7/7**: terima 3 seri SN-A/B/C (tanpa seri ditolak; duplikat SN-A ditolak); jual SN-A lolos → `out`; jual SN-A lagi ditolak; tanpa seri ditolak; qty 2 dengan 1 seri ditolak; kartu seri SN-A = gerakan `["in","out"]` ber-nomor dokumen; void penjualan → SN-A `in_stock` lagi; transfer memindahkan SN-A ke gudang tujuan; produk non-serial tidak berubah perilaku. Regresi gabungan batch terkait: 55/55.

**Caveat jujur**:
1. Produk yang baru ditandai serial **sesudah** punya stok lama: stok lama tidak memiliki identitas seri — POS menuntut seri yang belum ada sampai stok diterima dengan seri. Berbeda dari batch (yang punya remainder "Tanpa batch"), seri tidak boleh mengarang identitas.
2. Pilihan seri pada penjualan yang **ditahan** (held sale) tidak persisten (baris tahanan tidak punya kolom seri) — kasir memilih ulang saat melanjutkan; stok belum terkonsumsi sehingga aman.

## Batch 6 — Offline POS (§12, tabel `outbox`) — SELESAI (dengan batas uji tertulis)

- **Klien** (`src/lib/pos-offline.ts`): lapisan antrean tipis di atas **IndexedDB API langsung — tanpa dependensi baru** (Dexie tidak ditambahkan: repo ini belum memakainya dan antrean satu-store tidak membenarkan dependensi). Logika antrean murni di atas antarmuka `OfflineQueueStorage` (enqueue dengan dedupe per `clientKey`, penerapan hasil sinkronisasi), adapter IndexedDB untuk browser + adapter memori untuk unit test.
- **Server** (`src/server/pos-offline.ts` + actions): saklar `company_settings.pos_offline_enabled` ditegakkan di gerbang domain; setiap item diproses dalam transaksinya sendiri lewat jalur checkout **NORMAL** (`createSale`) dengan idempotency key = `clientKey`, dicoba dalam **savepoint** agar kegagalan item tidak membatalkan pencatatan. Status per item: `synced` | `duplicate` (kunci sama sudah tercatat — hasil sama, tidak dobel) | `conflict` (stok tidak cukup saat sinkron — **tidak dipaksakan**) | `failed` (lainnya, mis. sesi kas tertutup/periode terkunci — dapat dicoba lagi). Setiap percobaan dicatat sebagai baris `outbox` eventType `pos_offline_sale`; conflict/failed membiarkan `processed_at` NULL = **daftar peninjauan** di `/app/pos/offline` (tandai selesai / buang dengan catatan, teraudit `pos_offline.resolve`).
- **Terminal**: indikator Online/Offline + jumlah antrean + tombol Sinkronkan (otomatis saat event `online` dan saat terminal dibuka); saat browser offline & saklar aktif, checkout mengantre payload dan membersihkan keranjang tanpa nomor nota.

**Bukti** — `tests/sim2/pos-offline-sync.test.ts` **3/3** + `tests/unit/pos-offline-queue.test.ts` **4/4**: batch berisi valid + duplikat + konflik (qty 99) + gagal (metode tidak dikenal) → status per item tepat, hanya 1 penjualan tercatat, stok berkurang tepat 2; konflik & gagal masuk daftar peninjauan (2 baris outbox pending dari 4), resolusi menandai tuntas; saklar mati → gerbang domain menolak. Unit antrean: dedupe clientKey, synced/duplicate keluar antrean, conflict/failed tetap antre dengan pesan, urutan FIFO.

**Batas pengujian (jujur) & langkah acceptance manual** — uji browser offline sungguhan TIDAK tercakup Vitest. Acceptance manual sebelum rilis:
1. Aktifkan "Mode offline POS" di Pengaturan untuk perusahaan uji; buka terminal POS dengan sesi kas terbuka.
2. Di DevTools → Network, aktifkan "Offline"; lakukan penjualan tunai → toast antrean muncul, keranjang bersih, indikator menunjukkan "Offline" + 1 antre, tidak ada nomor nota.
3. Nonaktifkan "Offline" → sinkronisasi otomatis berjalan; penjualan muncul di Riwayat transaksi dengan nomor nota normal; antrean kosong.
4. Ulangi dengan stok yang sengaja dihabiskan oleh penjualan online lain sebelum sinkron → item masuk `/app/pos/offline` sebagai Konflik stok; tandai selesai/buang dengan catatan.
**Kendala desain yang disadari**: `createSale` mewajibkan sesi kas terbuka milik pengguna penyinkron — sinkronisasi di luar sesi terbuka menghasilkan status `failed` (dapat dicoba lagi), bukan penjualan paksa. Penjualan **tahanan** yang diantre offline juga tidak menghapus baris tahanannya saat sinkron; operator menghapus tahanan secara manual.

---

## Konfigurasi baru (D-25 — semua per perusahaan, tanpa angka regulasi di kode)

| Konfigurasi | Bentuk | Bawaan |
|---|---|---|
| `company_settings.pos_offline_enabled` | saklar | mati |
| `company_settings.transfer_two_step_enabled` | saklar | mati (satu tahap) |
| `company_settings.pr_approval_threshold` | nominal nullable | kosong (tanpa ambang) |
| Pemetaan `employee_loan_receivable` | akun via pemetaan | jatuh ke 1220 |
| Pemetaan aset tetap (5 kunci) + akun per kategori | pemetaan/kategori | ditanam `ensureFixedAssetAccounts` |
| Seri dokumen baru | PJM / RBS / AST / PRQ / RSV | — |

Ketiganya yang berupa pengaturan tampil di Pengaturan → Umum (checkbox + input ambang PR).

## Status mandat terkait

- §6F (pinjaman & reimbursement): **PASS** (Batch 1).
- §8 (aset tetap & penyusutan): **PASS** untuk garis lurus (Batch 2).
- §12 (offline POS): **PARTIAL** — domain, antrean, terminal, dan peninjauan terbukti di level Vitest; uji browser offline sungguhan menunggu acceptance manual di atas.
- Purchase Request, reservasi, in-transit, nomor seri (§6 area gudang/pembelian): **PASS** (Batch 3–5).

## Sisa NOT IMPLEMENTED (jujur)

- Metode penyusutan selain garis lurus (saldo menurun, dll.) — belum dimodelkan.
- Lampiran berkas reimbursement: hanya nama berkas/catatan teks — unggahan berkas sungguhan belum ada (konsisten keterbatasan lampiran repo saat ini).
- ESS slip mandiri (R-8 dari S2) — tetap belum.
- Mesin absensi fingerprint/geolocation — tetap belum (warisan S7B-1).
- Sinkronisasi offline untuk retur penjualan & penjualan tahanan — antrean saat ini hanya penjualan checkout biasa.
- Uji e2e browser offline (Playwright offline context) — belum otomatis; langkah manual tertulis di Batch 6.
