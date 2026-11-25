# MASTER IMPLEMENTATION PLAN — Bisa ERP Remediation

Tanggal: 2026-11-21
Branch: `remediation/erp-audit-2026-11-21`
Baseline commit: `6140f97`
Prinsip: Ponytail — perubahan terkecil yang benar, tanpa dependency baru, tanpa mengubah business rules yang tidak terbukti salah.

Urutan eksekusi: **P0 → P1 → P2 → P3**, dengan dependency-aware. Satu task diselesaikan dan diverifikasi sebelum task berikutnya yang bergantung padanya.

---

## Dependency Graph

```text
FIX-001 (schema columns)
 ├─ FIX-003 (receipt void)
 └─ FIX-004 (return reports)

FIX-002 (cash UI/idempotency) — independen
FIX-005 (closing) — independen
FIX-006..FIX-015 — independen (auth/HR/payroll/settings/device)
FIX-016..FIX-020 — P2, setelah P0/P1 stabil
FIX-021..FIX-022 — P3
```

---

## FIX-001 — Tambah kolom nilai stok penerimaan & nilai barang retur

| Field | Isi |
|---|---|
| Module | Inventory, POS/Reporting |
| Findings | INV-01, POS-03 |
| Root cause | Baris penerimaan/retur tidak menyimpan nilai yang menjadi dasar stok/laporan; dokumen menyimpan nilai bruto/kredit. |
| Priority | **P0** |
| Dependencies | — |
| Affected files | `src/db/schema/inventory.ts`, `src/db/schema/sales.ts`, migration baru, `src/server/inventory/receipts.ts`, `src/server/inventory/receipt-void.ts`, `src/server/pos/returns.ts`, `src/server/reports/sales.ts` |
| Solution | Tambah `stock_receipt_lines.stock_unit_cost` nullable dan `sale_returns.goods_total` nullable. Baris baru menulis nilai eksak; baris lama memakai fallback (inferensi DPP / `total`). |
| References | R-16, R-17, R-20 |
| Risk | Rendah: kolom nullable, tidak ada backfill destruktif. Perlu migrasi 0085. |
| Test plan | Migrasi di DB test; regression INV-01/POS-03. |
| Acceptance | Migrasi sukses; test lama tetap lulus; nilai baru tersimpan. |
| Rollback | Drop kolom pada migrasi balik; kode fallback tidak bergantung pada kolom baru. |
| Status | Todo |

## FIX-002 — Perbaiki semantik dan idempotensi mutasi kas

| Field | Isi |
|---|---|
| Module | POS |
| Findings | POS-01, POS-02, POS-06 |
| Root cause | UI memakai makna laci, domain memakai makna bank; key dibuat per submit; domain tidak membandingkan payload. |
| Priority | **P0** |
| Dependencies | — |
| Affected files | `src/components/pos/terminal/cash-movement-dialog.tsx`, `src/lib/pos/cash-movement.ts` (baru), `src/server/pos/sessions.ts`, test |
| Solution | Satu sumber pemetaan `cash_out → deposit`, `cash_in → withdrawal`. Key disimpan per pembukaan dialog dan dipertahankan saat retry. Domain menyimpan fingerprint payload; key sama + data berbeda → `CONFLICT`. |
| References | R-01, OWASP auth; perilaku domain existing |
| Risk | Perubahan label/arah; harus diuji dengan sesi kas. |
| Test plan | Unit mapping; integration cash movement replay/conflict; manual arithmetic. |
| Acceptance | “Kas Keluar” mengurangi laci; retry tidak menggandakan; payload berbeda ditolak. |
| Rollback | Revert UI mapping + fingerprint; data movement tetap valid. |
| Status | Todo |

## FIX-003 — Void penerimaan memakai nilai DPP

| Field | Isi |
|---|---|
| Module | Inventory |
| Findings | INV-01 |
| Root cause | `receipt-void` memakai `lineTotal/qty` (bruto) untuk reversal; nilai stok masuk adalah DPP. |
| Priority | **P0** |
| Dependencies | FIX-001 |
| Affected files | `src/server/inventory/receipt-void.ts`, `src/server/inventory/receipts.ts`, test |
| Solution | Gunakan `stock_unit_cost` bila ada; fallback inferensi PPN inklusif dari total/tax/lineTotal untuk baris lama. |
| References | R-16, R-20, `supplier-return-valuation` (pola inferensi) |
| Risk | Sedang: menyentuh nilai persediaan; harus exact untuk PPN inklusif/eksklusif/diskon. |
| Test plan | Integration: stok lain + receipt PPN inklusif + void; PPN eksklusif; tanpa pajak. Assert costPrice/ledger/GL. |
| Acceptance | `Σ(qty×unit_cost)` = nilai GL; `costPrice` tidak berubah karena void. |
| Rollback | Kembalikan formula lama; kolom tetap aman. |
| Status | Todo |

## FIX-004 — Laporan retur memakai nilai barang

| Field | Isi |
|---|---|
| Module | POS/Reports |
| Findings | POS-03, REP-01 |
| Root cause | `sale_returns.total` = nilai kredit untuk store credit/exchange; laporan memakainya sebagai nilai barang. Top products hanya berangkat dari baris penjualan. |
| Priority | **P0/P1** |
| Dependencies | FIX-001 |
| Affected files | `src/server/pos/returns.ts`, `src/server/reports/sales.ts`, test |
| Solution | Tulis `goods_total = refundDue`; laporan memakai `coalesce(goods_total,total)`. Top products/kategori menggabungkan produk dari penjualan + retur. |
| References | R-20 |
| Risk | Sedang: angka laporan berubah; harus cocok dengan GL. |
| Test plan | Penjualan utang + retur store credit penuh; penjualan lunas + retur cash; retur periode sebelumnya. |
| Acceptance | Laporan neto = GL neto; retur tanpa penjualan periode muncul. |
| Rollback | Kembali ke `total`; data lama tetap. |
| Status | Todo |

## FIX-005 — Tutup buku setelah periode dikunci

| Field | Isi |
|---|---|
| Module | Accounting |
| Findings | ACC-01 |
| Root cause | `assertPeriodOpen` hanya mengizinkan `closed` untuk closing entry; pre-check menerima `locked`. |
| Priority | **P0** |
| Dependencies | — |
| Affected files | `src/server/accounting.ts`, test |
| Solution | Izinkan `closed` **atau** `locked` hanya untuk `allowClosingEntry`. |
| References | Audit finding ACC-01 |
| Risk | Rendah; hanya jurnal penutup. |
| Test plan | Lock 12 periode → posting closing sukses; jurnal manual tetap ditolak. |
| Acceptance | Closing seimbang, laba ditahan benar, manual journal tetap `PERIOD_CLOSED`. |
| Rollback | Kembalikan kondisi satu baris. |
| Status | Todo |

## FIX-006 — Cegah eskalasi `users.manage`

| Field | Isi |
|---|---|
| Module | Core/Auth |
| Findings | CORE-01 |
| Root cause | Assignment/reset/removal tidak menerapkan subset permission yang sudah dipakai di pembuatan role. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/actions/users.ts`, `src/lib/permissions.ts`, test |
| Solution | Non-owner hanya boleh mengelola role yang permission-nya subset dari permission actor; reset/removal target role juga dicek. Owner tetap penuh. |
| References | R-08, R-19 |
| Risk | Sedang: dapat mengubah alur admin pengguna; harus jelas pesan. |
| Test plan | Custom user-admin vs manager; reset manager; removal admin. |
| Acceptance | Eskalasi ditolak; owner tetap bisa; delegated role sah tetap bisa. |
| Rollback | Kembalikan guard; tidak ada perubahan data. |
| Status | Todo |

## FIX-007 — Payroll export mengikuti module switch

| Field | Isi |
|---|---|
| Module | Core/Export |
| Findings | CORE-03 |
| Root cause | Route hanya `requirePermission`, tanpa module gate. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/app/api/export/payroll/route.ts` |
| Solution | Tambah `assertModuleEnabled(ctx.enabledModules, "hr")`. |
| References | R-01, R-14 |
| Risk | Rendah. |
| Test plan | HR off → 403; HR on + permission → 200; tanpa permission → 403. |
| Acceptance | Module switch berlaku pada payroll export. |
| Rollback | Hapus satu baris. |
| Status | Todo |

## FIX-008 — Audit feed menyembunyikan data HR

| Field | Isi |
|---|---|
| Module | Core/Audit |
| Findings | CORE-06 |
| Root cause | Feed perusahaan tidak memfilter entity/field berdasarkan permission HR. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/audit.ts`, halaman Riwayat, test |
| Solution | Tambah opsi `excludeEntityTypes`; halaman menyembunyikan entity HR bila tidak punya `payroll.view`/`payroll.manage`. Facet actions/entityTypes/actors ikut difilter. |
| References | R-19 |
| Risk | Rendah: hanya visibilitas; data tetap di DB. |
| Test plan | Viewer tanpa HR: event loan tidak muncul; pemegang payroll.view melihat. |
| Acceptance | Tidak ada kebocoran nominal/field HR ke viewer. |
| Rollback | Hapus filter; feed lama. |
| Status | Todo |

## FIX-009 — Validasi akun pembayaran payroll

| Field | Isi |
|---|---|
| Module | HR/Accounting |
| Findings | ACC-02 |
| Root cause | `payPayrollRun` tidak memakai `listCashBankIds`. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/hr/payroll-runs.ts`, test |
| Solution | Tolak akun yang bukan kas/bank/kliring aktif/postable. |
| References | R-03/R-20 |
| Risk | Rendah; dapat menolak akun yang sebelumnya diterima. |
| Test plan | Akun pendapatan ditolak; akun kas diterima; run tetap posted saat ditolak. |
| Acceptance | Hanya akun kas/bank; jurnal benar. |
| Rollback | Hapus guard. |
| Status | Todo |

## FIX-010 — Bekukan tipe/akun metode pembayaran yang sudah dipakai

| Field | Isi |
|---|---|
| Module | Settings |
| Findings | SET-01 |
| Root cause | `sale_payments` join live ke `payment_methods`; update tidak cek pemakaian. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/actions/settings/pembayaran.ts`, test |
| Solution | Tolak perubahan `type`/`accountId` bila `sale_payments` sudah memakai metode. Nama/urutan/fee/aktif tetap boleh. |
| References | Audit finding, R-20 |
| Risk | Rendah; perubahan konfigurasi yang sebelumnya sah kini ditolak. |
| Test plan | Metode terpakai: ubah tipe ditolak; ubah nama boleh. |
| Acceptance | Sejarah tidak berubah. |
| Rollback | Hapus guard. |
| Status | Todo |

## FIX-011 — Harga kemasan melewati `inventory.price`

| Field | Isi |
|---|---|
| Module | Inventory/Settings |
| Findings | INV-02 |
| Root cause | `priceChanged` hanya membandingkan produk. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/actions/inventory/produk.ts`, test |
| Solution | Bandingkan harga kemasan existing; tolak perubahan harga tanpa `inventory.price`. |
| References | Audit finding |
| Risk | Rendah. |
| Test plan | Staf gudang ubah salePrice kemasan → FORBIDDEN; manager boleh. |
| Acceptance | Harga kemasan terkontrol. |
| Rollback | Hapus guard. |
| Status | Todo |

## FIX-012 — Netralkan karakter kontrol ESC/POS

| Field | Isi |
|---|---|
| Module | POS/Printer |
| Findings | POS-04 |
| Root cause | `text()` hanya mengganti karakter >=128. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/lib/escpos/encoder.ts`, unit test |
| Solution | Ganti karakter <0x20 dan 0x7f dengan spasi di `text()`. |
| References | R-21 |
| Risk | Rendah; teks kontrol tidak lagi diteruskan. |
| Test plan | Unit: byte kontrol tidak muncul. |
| Acceptance | Hanya perintah dari method encoder yang ada di output. |
| Rollback | Kembalikan mapping. |
| Status | Todo |

## FIX-013 — Token perangkat menghormati module switch

| Field | Isi |
|---|---|
| Module | POS/Desktop |
| Findings | CORE-04 |
| Root cause | Resolusi token tidak membaca `enabled_modules`. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/pos/terminals.ts`, test |
| Solution | Tolak token bila `isModuleEnabled(settings,"pos")` false. |
| References | R-14 |
| Risk | Rendah; terminal harus pairing ulang setelah modul dinyalakan. |
| Test plan | Modul off → resolve null; on → identity. |
| Acceptance | Kill switch berlaku. |
| Rollback | Hapus check. |
| Status | Todo |

## FIX-014 — Preserve redirect di `guard()`

| Field | Isi |
|---|---|
| Module | Core |
| Findings | CORE-07 |
| Root cause | Catch-all menelan `NEXT_REDIRECT`. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/lib/errors.ts`, test |
| Solution | Rethrow error dengan digest `NEXT_REDIRECT`/`NEXT_NOT_FOUND` sebelum mapping INTERNAL. |
| References | R-15 |
| Risk | Rendah; hanya control flow. |
| Test plan | Unit guard redirect; action dengan sesi hilang. |
| Acceptance | Redirect login, bukan INTERNAL. |
| Rollback | Kembalikan catch. |
| Status | Todo |

## FIX-015 — Offboarding HR yang aman

| Field | Isi |
|---|---|
| Module | HR/Core |
| Findings | HR-01 |
| Root cause | Pencocokan user berdasarkan nama. |
| Priority | **P1** |
| Dependencies | — |
| Affected files | `src/server/member-permissions.ts`, `src/server/hr/final-pay.ts`, test |
| Solution | Jangan mencabut otomatis bila nama ambigu/tidak unik; hanya cabut bila tepat satu kandidat non-owner. Catat alasan/peringatan. Relasi user eksplisit direkomendasikan sebagai follow-up. |
| References | R-08 |
| Risk | Sedang: beberapa terminasi tidak lagi auto-revoke; harus ditangani UI/admin. |
| Test plan | Dua user nama sama → tidak ada yang dicabut; satu kandidat → dicabut. |
| Acceptance | Tidak ada pencabutan akun salah; kasus ambigu jelas. |
| Rollback | Kembalikan perilaku lama (tidak disarankan). |
| Status | Todo |

## FIX-016 — Module gate pada write action (P2)

| Field | Isi |
|---|---|
| Findings | CORE-02 |
| Priority | P2 |
| Affected files | import, bank reconciliation, uang muka, payroll settings |
| Solution | `requirePermissionInModule` sesuai modul pemilik. |
| Test plan | Modul off → FORBIDDEN. |
| Status | Todo |

## FIX-017 — State recovery POS (P2)

| Field | Isi |
|---|---|
| Findings | POS-05, POS-07 |
| Solution | Bersihkan pending untuk error definitif; `openCashSession` mengembalikan status sesi closed dan terminal membuka sesi baru. |
| Status | Todo |

## FIX-018 — Batch query & batas baris (P2)

| Field | Isi |
|---|---|
| Findings | INV-03, INV-04 |
| Solution | Agregasi `GROUP BY` untuk batch availability; `.max(500)` pada schema penerimaan. |
| Status | Todo |

## FIX-019 — Lock pairing code (P2)

| Field | Isi |
|---|---|
| Findings | CORE-05 |
| Solution | `.for("update")` pada SELECT kode pairing. |
| Status | Todo |

## FIX-020 — Fingerprint jurnal manual (P2)

| Field | Isi |
|---|---|
| Findings | ACC-03 |
| Solution | Simpan fingerprint payload pada idempotency key jurnal; key sama + payload beda → CONFLICT. |
| Status | Todo |

## FIX-021 — Jadwalkan prune idempotency keys (P3)

| Field | Isi |
|---|---|
| Findings | PLAT-01 |
| Solution | Script CLI + dokumentasi cron; tidak dijalankan otomatis di app. |
| Status | Todo |

## FIX-022 — CSP Tauri (P3)

| Field | Isi |
|---|---|
| Findings | PLAT-02 |
| Solution | Evaluasi build statis; jika tidak memungkinkan, dokumentasikan sebagai residual risk. |
| Status | Todo |

---

## Task Execution Rules

1. Satu task, satu commit logis (bila memungkinkan).
2. Regression test ditulis sebelum/sesaat implementasi; test lama tidak boleh rusak.
3. Setelah perubahan: `pnpm typecheck`, test terkait, lalu full suite pada checkpoint.
4. Review diff dengan prinsip Ponytail: tidak ada abstraction/dependency baru yang tidak perlu.
5. Task hanya `VERIFIED` bila acceptance + test + review selesai.
6. Update `TASK_PROGRESS.md` setelah setiap task.
7. Tidak ada migrasi/deploy ke database produksi.
