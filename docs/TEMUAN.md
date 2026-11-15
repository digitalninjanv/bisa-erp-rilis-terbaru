# TEMUAN AUDIT

Status per 2026-11-11. Severity mengikuti dampak bisnis: **Kritis** = uang/stok/sesi bisa salah atau hilang; **Tinggi** = laporan/workflow salah; **Sedang** = UX/performa/penanganan error; **Rendah** = kosmetik/teknis.

## Kritis

| ID | Temuan | Bukti | Status |
| --- | --- | --- | --- |
| AKN-001 | Pemetaan akun menerima tipe akun apa pun; `revenue` bisa menunjuk akun beban → penjualan mengkredit beban, laba palsu. | `server/actions/accounting/akun-pemetaan.ts`, `server/import/commit.ts` | **DIPERBAIKI** — kontrak `MAPPING_ACCOUNT_TYPES` di `lib/akuntansi/account-mappings.ts`, divalidasi di form, impor, dan aksi; UI/DB test. |
| AKN-002 | Penerimaan “retur pelanggan” mengkredit `sales_return` (akun kontra pendapatan) → retur tampil sebagai pendapatan. | `server/inventory/receipt-journal.ts:75` | **DIPERBAIKI** — kini `Dr Persediaan / Cr HPP`; pendapatan/refund tetap milik dokumen retur penjualan. |
| POS-001 | Pembulatan `nearest_500` bisa membuat total penjualan 222 menjadi 0 (barang gratis). | `server/pos/quote.ts:233` | **DIPERBAIKI** — hasil bulat ≤0 pada nilai positif dikembalikan ke nilai sebelum pembulatan; tidak memblokir produk harga 0 yang sah. |

## Tinggi

| ID | Temuan | Status |
| --- | --- | --- |
| AKN-003 | Jurnal tutup buku ikut dihitung di P&L periode → P&L tahun tertutup menjadi 0. | **DIPERBAIKI** — `getIncomeStatement(..., {excludeClosing:true})` untuk P&L/dashboard/export; neraca & ekuitas tetap memakai closing. |
| AKN-004 | Void beban/payroll/penjualan/transfer bank memakai tanggal hari ini → beban/pendapatan bulan berjalan negatif. | **DIPERBAIKI** — `reverseSourceJournalPreferringDate` memakai tanggal dokumen asal; fallback hari ini hanya bila periode tertutup. |
| AKN-005 | `isPostable=false` pada akun berjurnal menghapus histori dari P&L. | **DIPERBAIKI** — guard `CONFLICT` bila `journalLineCount > 0`. |
| AKN-006 | Section akun impor dipercaya; beban bisa masuk kelompok pendapatan atau hilang dari P&L. | **DIPERBAIKI** — matriks tipe→section di impor + fallback P&L ke section tipe. |
| AKN-007 | Laporan penjualan menghitung penjualan yang sudah diretur; retur tidak mengurangi omzet/profit. | **DIPERBAIKI** — summary, per hari, per kasir, per kategori, top produk mengurangi retur; PPN retur diproporsikan. |
| AKN-008 | Kategori/top produk menambahkan `taxAmount` lagi padahal `lineTotal` sudah termasuk pajak. | **DIPERBAIKI** — hanya `lineTotal`. |
| GDG-001 | Void penerimaan memakai harga bruto, bukan DPP/diskon → AVCO ≠ GL. | **DIPERBAIKI** — memakai `lineTotal/qty`; test void diskon + GL lulus. |
| GDG-002 | Void retur pemasok/dokumen stok tidak menghitung ulang AVCO. | **DIPERBAIKI** — AVCO dihitung ulang; serial adjustment/opname/karantina kini juga dipulihkan (`restoreSerialsForStockDocumentVoid`). |
| POS-002 | Refund tunai memilih sesi kas tanpa lock → bisa masuk sesi yang baru ditutup. | **DIPERBAIKI** — `FOR UPDATE` pada sesi refund. |
| POS-003 | Default pembulatan grup 500/down membuat harga grup 1.000 menjadi 500. | **DIPERBAIKI** — default grup baru 0 (tanpa pembulatan); grup lama perlu diedit manual. |
| DATA-001 | Unique index idempotency di migrasi awal `(company_id,key)`, sedangkan runtime `(company_id,scope,key)` → checkout gagal di instalasi baru. | **DIPERBAIKI** — migrasi `0070` membuat index yang benar; diterapkan + backup. |
| SEC-001 | Eskalasi peran: non-owner bisa memberi admin/owner, mengedit peran sendiri, atau memberi izin yang tidak dimiliki. | **SEBAGIAN** — admin/owner hanya owner, izin dibatasi subset aktor, peran sendiri tidak bisa diedit, reset password memutus sesi. Audit peran kustom masih terbatas. |
| SEC-002 | `import.manage` bisa membuat akun/pemetaan/saldo awal tanpa izin akuntansi. | **DIPERBAIKI** — commit impor akuntansi memerlukan `accounting.manage`/`accounting.post` pada konteks produksi. |
| SEC-003 | `inventory.cost` bocor di dashboard gudang, pergerakan, PO/penerimaan/retur/dokumen/reservasi. | **DIPERBAIKI** — dashboard, pergerakan, nilai, PO, penerimaan, retur, dokumen, dan cetak dokumen memakai gerbang `canSeeInventoryCost`; test matriks izin lulus. |
| SEC-011 | Aksi PO/PR/reservasi memakai `requirePermission` biasa; modul Gudang nonaktif tetap bisa diakses. | **DIPERBAIKI** — semuanya memakai `requirePermissionInModule(..., "gudang")`. |
| SEC-006 | Route export mengembalikan 500 untuk 401/403/validasi. | **DIPERBAIKI** — `withApiError` memetakan AppError/ZodError ke 400/403/404/409/500; test mapper lulus. |
| SEC-008 | Upload impor membaca body/workbook sebelum validasi ukuran/format. | **DIPERBAIKI** — streaming limit 20MB, magic bytes XLSX/XLS/CSV, batas entri/rasio/ukuran ZIP; test valid/palsu/oversize/zip bomb lulus. |
| GDG-UI-01 | Pencarian Nilai Persediaan hanya menyaring 50 baris halaman tampil. | **DIPERBAIKI** — filter nama/SKU/kategori server-side sebelum paginasi + ekspor. |
| GDG-UI-02 | Jatuh tempo utang pembelian hanya tanggal penerimaan + termin; tanggal faktur pemasok tidak tersimpan. | **DIPERBAIKI** — `supplier_invoice_date` & `due_date` pada penerimaan; form, koreksi, detail, cetak, dan aging utang memakainya. |
| SEC-004 | Default installer memakai HTTP untuk auth; cookie tidak Secure. | **DIPERBAIKI di runtime** — produksi wajib `https` kecuali `BISA_ALLOW_INSECURE_AUTH_URL=1`; contoh installer masih perlu diperbarui (BLOKIR). |
| SEC-005 | Token terminal POS tetap bisa membaca snapshot setelah user dicabut/di-demote. | **DIPERBAIKI** — resolusi token mengecek membership, role custom aktif, dan `pos.sell`. |
| SEC-007 | Reset password tidak mencabut session lama. | **DIPERBAIKI** — session user dihapus. |
| QA-001 | Banyak tes lama bergantung pada seed demo; database pengguna sengaja kosong. | **SELESAI** — suite penuh di DB uji terpisah `bisa_erp_test`: 2254/2254 lulus; analytics test dibuat mandiri. |

## Sedang/Rendah (ringkas)

- Route export mengembalikan 500 untuk 401/403/validasi (belum dibungkus mapper error) — TERBUKA.
- Upload impor membaca seluruh body/workbook sebelum cek baris; belum ada validasi magic bytes — TERBUKA.
- Perubahan mapping belum menulis audit before/after — TERBUKA.
- Laporan penjualan: transaksi retur masih dihitung sebagai transaksi; nilai sudah neto.
- PPN retur diproporsikan dari total penjualan asal; bukan pajak per baris.
- HR list kasbon/klaim/pinjaman belum search/pagination.
- Label aksesibilitas textarea impor absensi/mutasi bank dan select gudang impor — TERBUKA.
- `eyebrow` PageHeader no-op — RENDAH.
- Logo cetak URL diblokir CSP `img-src 'self' data: blob:` — TERBUKA.
- Rate limit in-memory; `X-Forwarded-For` dipercaya — TERBUKA (deployment satu instance).
