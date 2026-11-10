# Audit Form, CRUD & Tabel — Analisa Statis Berbasis CodeGraph (2026-11-08)

Mandat pemilik: kesan "banyak form tidak rapi" dianalisa **tanpa perbaikan kode** — fokus FORM, CRUD, TABEL — dengan **CodeGraph sebagai alat utama** (graf repo terindeks & auto-sync: 906 berkas, 15.917 node, 56.873 edge; perintah `query/callers/callees/node/impact/files/status`). Angka adopsi di bawah adalah jumlah pemanggil menurut CodeGraph; hitungan pola pelengkap memakai penelusuran pola sumber dan pembacaan sampel per berkas — keduanya dibedakan di setiap temuan.

**Yang TIDAK diaudit ulang** (sudah tertutup & berpenjaga): Putaran 3 (`docs/hardening/VALIDASI-UIUX-3.md`) menutup perataan header↔isi tabel (98%), `nowrap`, satu tinggi field 36px, satu kepadatan `.data-table` + varian `.data-table-dense`, lebar kolom aksi selebar isi, token `fieldWidths`, dan memasang penjaga permanen `e2e/table-form-guard.spec.ts`. Audit A1 (Program Audit Produksi) membuktikan cakupan penjagaan aksi 201/201. Audit ini hanya menilai **celah di luar cakupan itu**.

**Batas analisa (eksplisit):** ini analisa statis atas kode & graf. Ia membuktikan struktur, adopsi, dan duplikasi pola — ia **tidak** membuktikan rasa visual. Setiap temuan yang vonis akhirnya soal tampilan/pengalaman ditandai **"perlu validasi visual"** dan tidak diklaim sebagai cacat visual terbukti.

**Vonis ringkas:** tidak ditemukan P1. Kesan "tidak rapi" terdukung bukti statis sebagai **fragmentasi pola**: untuk hampir setiap pekerjaan form yang sama hidup dua-tiga implementasi yang mirip-tapi-beda (modal bersama vs overlay racikan; ConfirmDialog vs `window.confirm/prompt`; `parseInput` vs `.parse`; Field bersama vs Field salinan). Masing-masing bekerja; ketidakseragaman merekalah yang terlihat sebagai ketidakrapian. Total temuan: **FRM 8 (P2: 3 · P3: 4 · sehat 1) · CRUD 5 (P3: 3 · sehat 1 · terverifikasi-bukan-temuan 1) · TBL 4 (P2: 1 · P3: 2 · sehat 1)**.

---

## 1. Inventaris terukur

### 1.1 Komponen form bersama & adopsinya (CodeGraph `callers`)

Penyebut: **82 halaman** (`src/app/app/**/page.tsx`), **185 berkas komponen** tsx, ±64 page.tsx memuat markup tabel secara langsung.

| Komponen bersama | Rumah | Pemanggil (CodeGraph) | Bacaan |
|---|---|---|---|
| PageHeader | blocks/page-header.tsx | 116 | menang total |
| EmptyState | blocks/empty-state.tsx | 100 | menang total |
| DateField | components/date-field.tsx:31 | 83 | menang total (lihat FRM-08) |
| StatusBadge | blocks/status-badge.tsx | 82 | menang total |
| DataList (+Toolbar) | blocks/data-list.tsx:27 | 68 | kerangka daftar baku |
| MoneyInput | components/money-input.tsx:20 | 61 | kuat |
| fieldClass | blocks/field-classes.ts:31 | 53 | kuat |
| labelClass | blocks/field-classes.ts | 46 | kalah dari label mentah (FRM-04) |
| Pagination | blocks/pagination.tsx | 36 | slot opt-in (TBL-01) |
| ConfirmDialog | blocks/confirm-dialog.tsx | 33 | kalah sebagian dari window.* (FRM-02) |
| PercentInput | components/percent-input.tsx:22 | 18 | cukup |
| RowMenu | blocks/row-menu.tsx:36 | 16 | sebagian (TBL-03) |
| AccountCombobox | akuntansi/account-combobox.tsx:27 | 12 | satu-satunya combobox akun |
| Modal | blocks/modal.tsx:13 | 9 | kalah dari overlay racikan (FRM-01) |
| DocumentForm | blocks/document-form.tsx:24 | 8 | khusus dokumen |
| ProductPicker | gudang/product-picker.tsx:64 | 6 | 3 form dokumen langsung |
| SearchForm | blocks/search-form.tsx:4 | 6 | tersisih oleh DataListToolbar |
| fieldWidths (langsung) | blocks/field-classes.ts:46 | 4 | menyebar terutama lewat DataList/DateField |
| WizardSteps | blocks/wizard-steps.tsx:25 | 2 (1 permukaan nyata: PayrollWizard) | nyaris tak terpakai (FRM-06) |
| **QtyInput** | — | **tidak ada** | keputusan sadar A-28 (FRM-03) |
| PartyPicker / WarehousePicker | — | **tidak ada** | `<select>` native per form (FRM-07) |

Pola pendukung yang terukur di komponen: `toast` 543 pemakaian; pemeriksaan `result.ok` ditulis tangan di **78 berkas**; `toast.error` 310 pemakaian; state `busy` dideklarasikan sendiri di **63 berkas** dengan 111 ikatan `disabled={busy|submitting|pending}`; `router.refresh()` 156 pemakaian di 74 berkas; `<select>` native **151** (sesuai aturan proyek "prefer native `<select>`" — pilihan sadar, bukan temuan); `<input` mentah di luar primitif bersama **274** (mayoritas teks/kode yang sah memakai `fieldClass`); `<form>` HTML nyaris tidak dipakai sebagai wadah form aplikasi (7 titik di komponen: login, pencarian, filter GET) — form aplikasi adalah `useState` + `submit()` + tombol simpan.

### 1.2 Permukaan CRUD (server actions)

**49 berkas aksi** `"use server"` (±201 aksi; cakupan penjagaan terbukti A1) + 6 berkas helper bersama/domain di folder yang sama (4× `shared.ts`, `import/commit-phases.ts`, `import/commit-packaging.ts`). Peta modul: akuntansi 7 berkas, gudang/inventory 6, HR 4, impor 3 (+2 helper), pengaturan 9, POS 3, master-data/pihak termasuk di inventory & master-data.ts, sisanya berkas tunggal per domain (supplier-returns 9 aksi adalah berkas CRUD terpadat; pos.ts 17 aksi terpadat kedua).

Hitungan pola global di `src/server/actions/**`: `guard(` 202 · `requirePermission(InModule)` 253 · `revalidatePath` 311 · `parseInput(` **123** · `.parse(` **64** (di antaranya ±12 parse skalar/uuid inline) · `safeParse` 1. Definisi tunggal `parseInput` di `src/lib/action-validation.ts:158`.

### 1.3 Tabel

`<table` JSX 131 titik; kelas `.data-table` 102 titik; komponen shadcn `ui/table` tetap **0 pemakaian** (standar de-facto adalah `.data-table` — konsisten dengan catatan Putaran 3). Slot `pagination=` pada DataList diisi **13 halaman**; 18 berkas mengimpor Pagination langsung. `aria-sort` di seluruh repo: **0**.

---

## 2. Temuan FORM

### FRM-01 (P2) — Modal terfragmentasi: komponen bersama kalah dari overlay racikan per form

`blocks/Modal` (kontrak: overlay `fixed inset-0 z-[80]`, footer Batal/Simpan, prop `busy`) hanya punya **9 pemanggil** (CodeGraph). Di luar itu **21 berkas komponen** menulis overlay `fixed inset-0` sendiri — 18 di luar permukaan POS: `gudang/product-form.tsx:179`, `akuntansi/account-form.tsx`, `akuntansi/payment-form.tsx`, `akuntansi/fixed-asset-panel.tsx`, `akuntansi/advance-panel.tsx`, `akuntansi/loan-panel.tsx`, `akuntansi/reimbursement-panel.tsx`, `akuntansi/opening-balance-form.tsx`, `akuntansi/payroll-panel.tsx`, `akuntansi/payroll-payment-form.tsx`, `akuntansi/journal-reverse.tsx`, `gudang/reservation-panel.tsx`, `gudang/party-merge-panel.tsx`, `gudang/purchase-request-panel.tsx`, `gudang/taxonomy-manager.tsx`, `gudang/product-bulk-table.tsx`, `pengaturan/user-access.tsx`, `pengaturan/group-pricing.tsx`. `partner-forms.tsx:160,301` membuktikan pola bersama bekerja (Modal + onSubmit + busy) — jadi ini bukan ketiadaan komponen.

Perbedaan perilaku yang terbukti dari kode (bukan selera): z-index menyebar `z-[60]` ×2, `z-[70]` ×2, `z-[80]` ×22, `z-[90]` ×2; **Modal bersama tidak menangani tombol Escape sama sekali** (`blocks/modal.tsx` tanpa pendengar keydown), sementara `ConfirmDialog` menanganinya (`blocks/confirm-dialog.tsx:73-76`); hanya 9 berkas komponen di seluruh repo yang menangani Escape. Lebar panel, posisi gulir, dan perilaku tutup adalah salinan yang bisa menyimpang diam-diam per berkas.

**Akar pola:** komponen bersama **ada tapi kalah adopsi**; overlay racikan menyalin chrome Modal (bahkan z-[80] & gaya footer yang sama) tanpa kontrak bersama. Dampak rasa visualnya: **perlu validasi visual**; fragmentasi kodenya terbukti.

**Status sesudah G1 (2026-11-08): TERTUTUP.** 19 situs overlay racikan di 18 berkas non-POS dimigrasi ke Modal bersama; Modal lokal duplikat di user-access dihapus; Modal bersama kini menangani Escape + klik latar (selaras ConfirmDialog), lapisan resmi Modal z-[80] / ConfirmDialog z-[90]; prop opsional `wide`/`submitLabel`/`busyLabel`/`submitDisabled`/`footer` menampung variasi sah tanpa chrome baru. Adopsi Modal 9 → 26 pemakaian di 21 berkas. Pengecualian terdokumentasi hanya permukaan terminal POS (3 berkas) + shell + primitif ui/. Penjaga permanen: `tests/unit/architecture-dialog-patterns.test.ts`. Rincian: `docs/form-crud/HASIL-G1.md` §2.

### FRM-02 (P2) — Konfirmasi destruktif & pengumpulan alasan: dua dunia, migrasi berhenti di gudang

`ConfirmDialog` bersama (33 pemanggil) menyatakan tujuan eksplisitnya di `blocks/confirm-dialog.tsx:8`: menggantikan `window.prompt`/`window.confirm` bawaan peramban. Kenyataan terukur:

- **`window.confirm` hidup di ≥10 titik nyata:** `pengaturan/user-access.tsx:153` & `:422` (cabut akses, hapus peran), `pengaturan/forms/gudang-cabang.tsx:149` (hapus gudang), `pengaturan/forms/metode-pembayaran.tsx:294` (hapus metode bayar), `pengaturan/group-pricing.tsx:112` & `:378`, `akuntansi/coa-migration-panel.tsx:43`, `akuntansi/journal-entry-form.tsx:150`, `pos/held-actions.tsx:24`, `pos/offline-review-panel.tsx:34`, `pos/terminal-admin-panel.tsx:290`.
- **`window.prompt` hidup di 18 titik**, dan yang paling berat: **alasan membatalkan (void) dokumen keuangan dikumpulkan lewat prompt peramban** di `akuntansi/bank-transfer-form.tsx:167`, `akuntansi/expense-form.tsx:256`, `akuntansi/payroll-panel.tsx:377`, `akuntansi/payment-form.tsx:559` & `:613`, `akuntansi/advance-panel.tsx:298`, `akuntansi/loan-panel.tsx:297`, `akuntansi/opening-balance-form.tsx:176`, `akuntansi/fixed-asset-panel.tsx:301`, `akuntansi/period-manager.tsx:57` (tutup periode!), `akuntansi/reimbursement-panel.tsx:189,199,201`, plus catatan setuju/tolak HR di `akuntansi/hr/overtime.tsx:118` & `akuntansi/hr/leave.tsx:266`.

Padahal pola tujuan **sudah terbukti di modul sebelah**: gudang bermigrasi penuh — `gudang/void-buttons.tsx:17` mendokumentasikan "alasan tidak lagi dikumpulkan lewat window.prompt" (GDG2-09) dan `gudang/approval-buttons.tsx:19` memakai dialog bersama. Alasan void adalah data audit; mengumpulkannya lewat prompt berarti tanpa validasi panjang/isi, tanpa gaya bersama, dan perilakunya bergantung peramban/webview.

**Akar pola:** migrasi pola bersama **berhenti per modul** (gudang selesai; akuntansi, HR, pengaturan belum). Ini penyumbang statis terkuat untuk kesan tidak rapi di permukaan form akuntansi.

**Status sesudah G1 (2026-11-08): TERTUTUP.** 27 titik pemanggilan (16 prompt + 11 confirm) dimigrasi ke ConfirmDialog bersama (prop `reason`); grep membuktikan nol pemanggilan `window.prompt`/`window.confirm` tersisa di src/ (sisa hanya penyebutan di komentar). Tidak ada pengecualian POS yang dipertahankan — titik POS yang bermigrasi adalah panel web standar. Penjaga permanen: `tests/unit/architecture-dialog-patterns.test.ts`. Rincian per titik: `docs/form-crud/HASIL-G1.md` §1.

### FRM-03 (P2, keputusan sadar terdokumentasi) — Kuantitas tanpa komponen bersama; logika parse disalin per form

`QtyInput` **tidak ada** — dan itu keputusan tahap yang tercatat: `docs/hardening/RENCANA.md:46` ("QtyInput bersama TIDAK dibangun — kuantitas tetap desimal polos konsisten `inputMode='decimal'`") dan `docs/hardening/STATUS-TUTUP-A28.md` (H-PGT-03 SEBAGIAN). Jadi ini **bukan pelanggaran diam-diam**. Yang dibuktikan audit ini adalah harga terkininya: pola pengganti disalin di **≥15 titik pada 11 berkas** — `gudang/line-editor.tsx:313`, `gudang/opname-form.tsx:491,509,529`, `pos/cart-panel.tsx:241,334`, `gudang/supplier-return-form.tsx:426`, `gudang/transfer-receive-form.tsx:346`, `gudang/product-bulk-table.tsx:459`, `akuntansi/hr/overtime.tsx:94`, `akuntansi/hr/leave.tsx:102`, `pengaturan/payroll-indonesia-form.tsx:442`, `gudang/product-form.tsx:232` — ditambah `type="number"` mentah untuk kuantitas di `gudang/reservation-panel.tsx:92`, `gudang/purchase-request-panel.tsx:149`, `pos/return-form.tsx:123`. Karena tidak ada komponen, **parse & penjepitan nilai ditulis ulang per form**: `pos/return-form.tsx:123-131` menjepit `min(remaining, max(0, …))` di onChange; form lain menyerahkan nilai mentah ke validasi server. Gaya tampilnya seragam (`fieldClass num text-right`), semantik ketiknya tidak terpusat.

**Akar pola:** komponen bersama **sengaja tidak dibuat** (keputusan A-28) — risiko duplikasi logika parse adalah sisa yang diterima keputusan itu; audit ini mencatatnya kembali dengan angka adopsi terbaru agar keputusan bisa ditinjau berbukti, bukan mengulanginya sebagai temuan baru.

**Status sesudah G2 (2026-11-08): TERTUTUP.** Keputusan A-28 ditinjau berbukti angka adopsi audit ini dan dibalik: QtyInput bersama dibangun (`src/lib/qty-input.ts` + `src/components/qty-input.tsx`, kontrak meniru money/percent-input: nilai kanonis string Decimal identik, jepit min/max & langkah desimal per konteks terpusat). Seluruh titik teridentifikasi audit bermigrasi (line-editor, opname ×3, supplier-return, transfer-receive, product-form, overtime, leave, payroll §UX4-11, reservation-panel, purchase-request-panel, pos/return-form) + titik sekelas (supplier-return-resolutions, stepper qty cart-panel). Dua titik audit terbukti BUKAN kuantitas dan tidak dipaksa: nilai diskon dwimodus cart-panel & field campuran product-bulk-table (beralasan di HASIL-G2 §1). Penjaga: `tests/unit/qty-input.test.ts` (37 test) + `tests/unit/architecture-form-primitives.test.ts`. Rincian: `docs/form-crud/HASIL-G2.md` §1.

### FRM-04 (P3) — Pembungkus Field (label + kontrol + petunjuk) disalin per berkas

Komponen `Field` lokal didefinisikan ulang di ≥5 berkas: `gudang/product-form.tsx:352`, `gudang/partner-forms.tsx:460`, `pengaturan/user-access.tsx:689`, `pengaturan/group-pricing.tsx:519`, `pos/pos-display.tsx:265`. Versi bersama **hanya ada di dalam lingkup pengaturan**: `pengaturan/forms/shared.tsx:26`. Selaras dengan itu, label mentah `<label className="space-y-1">` terhitung **212 pemakaian** melawan `labelClass` bersama **46 pemanggil** (CodeGraph). Putaran 3 (F-04) menilai sisi visualnya; sisi strukturnya tetap: tidak ada `Field` di `blocks/`, sehingga setiap form baru menyalin lagi keputusan label/petunjuk/error yang sama.

**Akar pola:** komponen bersama ada tetapi **terkurung satu lingkup** (pengaturan) dan tidak pernah diangkat ke `blocks/`.

**Status sesudah G1 (2026-11-08): TERTUTUP.** `Field` bersama kini global di `src/components/blocks/field.tsx`; `pengaturan/forms/shared.tsx` me-re-export dari blocks. 4 dari 5 salinan lokal teridentifikasi dimigrasi (product-form, partner-forms, user-access, group-pricing); kandidat kelima (`pos/pos-display.tsx`) terbukti BUKAN salinan (pembungkus div + grup tombol segmen popover POS) dan didokumentasikan di berkasnya. Rincian: `docs/form-crud/HASIL-G1.md` §5.

### FRM-05 (P3) — Submit, busy & tampil-error: satu pola, ditegakkan konvensi — bukan kode bersama

Tidak ada helper bersama untuk menjalankan aksi dari form (tidak ditemukan `runAction`/`toastResult`/hook submit bersama di `src/lib`/`blocks`). Akibatnya pola yang sama ditulis tangan di mana-mana: **78 berkas** memeriksa `result.ok` sendiri, **310** pemakaian `toast.error`, **63 berkas** mendeklarasikan `const [busy, setBusy]` sendiri, 111 ikatan `disabled={busy…}`, dan validasi klien racikan `if (!x.trim())` di 11 titik (mis. `gudang/product-form.tsx:105`). Tampil-error inline (`setError`) hanya 4 berkas — sisanya toast, jadi *perilaku* hari ini seragam; tetapi keseragaman itu tidak dijaga mesin apa pun: form baru boleh menyimpang tanpa test yang gagal (penjaga arsitektur yang ada tidak mencakup pola submit klien).

**Akar pola:** pola ganda tidak ada — yang ada adalah **pola tunggal tanpa rumah bersama**; risikonya penyimpangan diam-diam di form berikutnya.

**Status sesudah G2 (2026-11-08): TERTUTUP untuk cakupan tahap (form utama per modul); adopsi lanjutan terjadwal.** Helper submit bersama dibangun di `src/components/use-action-runner.ts` (`runActionResult`, `useActionRunner` → `{busy, run}`, `requireFilled`). Bermigrasi: payroll-indonesia (inti `runSaver` → inti bersama), group-pricing (submit/hapus/clearAll/saveAll), capital-form, product-form, adjustment-form, HR overtime/leave/attendance, pos/return-form; validasi racikan → `requireFilled` di 10 dari 11 titik audit (titik ke-11, impor rekonsiliasi bank, beralur error inline bukan toast — tidak setara, tidak dipaksa). Sisa ±60 berkas pemeriksa `result.ok` di luar form utama = adopsi lanjutan per modul, dicatat terbuka di HASIL-G2 §2 & §7. Penjaga: `tests/unit/architecture-form-primitives.test.ts`. Rincian: `docs/form-crud/HASIL-G2.md` §2.

**Status final G5 (2026-11-08): SEBAGIAN.** Helper bersama dan migrasi form utama per modul tetap tertutup & terverifikasi; ±60 berkas pemeriksa `result.ok` di luar form utama tetap menjadi adopsi lanjutan bernama — status akhir program, dicatat di `docs/form-crud/STATUS-TUTUP-GABUNGAN.md`, bukan pekerjaan yang diklaim selesai.

### FRM-06 (P3) — Form terpanjang tetap satu halaman satu simpan; wizard bersama nyaris tak terpakai

`pengaturan/payroll-indonesia-form.tsx` — 641 baris, **219 field terukur** (Putaran 3) — tetap satu form pengaturan raksasa (terseksi internal: ProgramSection/ParameterSection/TerSection) dengan satu alur simpan. `WizardSteps` bersama hanya mencapai **2 pemanggil** CodeGraph dan satu permukaan nyata (`akuntansi/payroll-wizard.tsx:202`); wizard impor berjalan di cangkang sendiri (`gudang/import/wizard-shell.tsx`, 665 baris di `import-wizard.tsx`). Form dokumen besar lain: `gudang/opname-form.tsx` 690 baris, `gudang/receipt-form.tsx` 655, `akuntansi/payment-form.tsx` 641, `akuntansi/journal-entry-form.tsx` 605 — semuanya halaman/panel penuh (DocumentForm hanya 8 pemanggil), bukan drawer.

Klasifikasi jujur: pola halaman-penuh untuk dokumen adalah **pilihan arsitektur A-25 yang sah** (form dokumen memang halaman), dan pengaturan memang satu-halaman-per-topik; yang outlier terukur hanyalah skala Payroll Indonesia (219 field) yang tidak dipecah wizard maupun simpan-per-seksi. Vonis pengalamannya: **perlu validasi visual**.

**Status final G5 (2026-11-08): TETAP TERBUKA — keputusan pemilik bernama.** Syarat "validasi visual" terpenuhi di G5: halaman ter-screenshot & terukur ulang (0 elemen 9px; 10 elemen 10px = sitasi regulasi; tepat 1 primer; dokumen tidak overflow pada 390px; tabel Program BPJS tetap tergulir di dalam kartunya sesuai catatan PNG-05 lama). Parameter desimal mentah sudah terformat lewat UX4-11. Yang belum diambil adalah keputusan desainnya — memecah form 219 field menjadi wizard/simpan-per-seksi mengubah alur simpan pengaturan payroll; program tidak mengambil keputusan itu atas nama pemilik. Tercatat di `docs/form-crud/STATUS-TUTUP-GABUNGAN.md`.

### FRM-07 (P3) — Pemilih entitas: hanya produk & akun yang punya komponen; pihak & gudang = select mentah per form

`ProductPicker` mencapai 3 form dokumen secara langsung (`gudang/line-editor.tsx:55`, `gudang/opname-form.tsx:66`, `gudang/supplier-return-form.tsx:70`) dan sisanya lewat LineEditor; `AccountCombobox` 12 pemanggil. Untuk pemasok/pelanggan/gudang **tidak ada komponen pemilih** — setiap form merender `<select>` native berisi daftar penuh (bagian dari 151 pemakaian select native; sesuai aturan proyek, jadi pilihan sadar). Konsekuensi terbukti dari struktur: tidak ada pencarian pihak di dalam form dokumen; daftar pihak yang panjang menjadi select yang panjang. Ambang rasa sakitnya bergantung jumlah data: **perlu validasi visual** pada data produksi.

**Status final G5 (2026-11-08): TETAP TERBUKA — keputusan pemilik bernama.** Tekanan daftar panjang di permukaan daftar sudah turun lewat bacaan terpaginasi + sorting server (TBL-01/TBL-02 tertutup); di dalam form dokumen, `<select>` native tetap dipakai sesuai aturan proyek yang disadari. Komponen PartyPicker/WarehousePicker tidak dibangun: ambang sakitnya bergantung data produksi nyata yang tidak bisa dibuktikan dari seed demo, dan membangun pemilih baru adalah keputusan cakupan pemilik. Tercatat di `docs/form-crud/STATUS-TUTUP-GABUNGAN.md`.

### FRM-08 (sehat — dipertahankan) — Tanggal & uang: komponen bersama menang

`type="date"` native = **0 di seluruh repo** (sapuan A-28 bertahan penuh); DateField 83 + DateRangeField menutup semua permukaan tanggal. MoneyInput **61** & PercentInput **18** pemanggil; pada sampel penelusuran, tidak ditemukan field uang mentah model lama di luar pola kuantitas FRM-03 (klaim terbatas pada cakupan grep pola `inputMode="decimal"`/`type="number"` di komponen+app). Residu F-02 Putaran 3 tidak kambuh dalam bentuk aslinya.

---

## 3. Temuan CRUD

### Matriks modul × aspek pola (dari hitungan per berkas, Lampiran A)

| Modul (berkas aksi) | parseInput : .parse | guard ≈ aksi? | revalidatePath | Catatan |
|---|---|---|---|---|
| Akuntansi (7) | campuran per berkas (pembayaran 7:1; periode 0:4) | ya | ya, deras | periode penyimpang idiom |
| Gudang/Inventaris (6) | pihak 0:6 · taksonomi 0:5 · produk 3:5 · sisanya parseInput | ya | ya | dua berkas murni .parse |
| HR (4) | parseInput dominan | ya | **nol di 3 berkas** | lihat CRUD-02 |
| Pengaturan (9) | campuran (lokasi 0:4 · kelompok-harga 0:4 · pembayaran 2:4) | ya | ya | — |
| POS (3) | **pos.ts 0:13** (17 aksi) | ya (17:17) | ya | penyimpang idiom terbesar |
| Impor (3+2) | rows 0:4; commit via orkestrasi | ya di commit.ts | nol (sah: alur wizard bernavigasi) | helper terverifikasi (CRUD-05) |
| Domain tunggal (supplier-returns, payroll-indonesia, master-data, dll.) | parseInput dominan | ya | ya | pola terbersih |

### CRUD-01 (P3) — Dua idiom validasi input hidup berdampingan

`parseInput(` bersama dipakai **123** titik; `.parse(` langsung **64**. Keduanya Zod di dalam `guard(...)` yang sama dan A1 membuktikan pesan error satu pintu — jadi ini **bukan** perbedaan perilaku pengguna, melainkan dua ejaan untuk pekerjaan yang sama, terpetakan jelas per berkas (Lampiran A): penyimpang murni `.parse` adalah `actions/pos.ts` (13), `actions/inventory/pihak.ts` (6), `actions/inventory/taksonomi.ts` (5), `actions/accounting/periode.ts` (4), `actions/settings/lokasi.ts` (4), `actions/settings/kelompok-harga.ts` (4), `actions/import/rows.ts` (4); campuran di `actions/inventory/produk.ts` (3:5) & `actions/accounting/akun-pemetaan.ts` (2:3). Ini memperbarui catatan R1 Program Rekayasa (123 vs 52 pada hitungan lebih ketat) dengan peta per modul: penyimpangan terkonsentrasi, bukan menyebar acak.

**Akar pola:** helper bersama ada (`src/lib/action-validation.ts:158`) tetapi pemakaiannya tidak ditegakkan penjaga; modul yang ditulis pada gelombang berbeda membawa ejaan berbeda.

**Status sesudah G4 (2026-11-08): TERTUTUP.** Seluruh 64 titik `.parse(` di 20 berkas actions bermigrasi ke `parseInput(` — hitungan per berkas cocok persis Lampiran A (pos 13, pihak 6, taksonomi 5, produk 5, settings/pembayaran 4, lokasi 4, kelompok-harga 4, import/rows 4, periode 4, akun-pemetaan 3, saldo-awal 2, beban-transfer 2, dan 8 berkas ×1); sisa `.parse(` mentah di `src/server/actions/**` = **0**. Paritas pesan terbukti dari konstruksi: `guard()` memetakan ZodError mentah lewat `formatZodIssues` yang sama dengan yang dipakai `parseInput` (komentar eksplisit di `src/lib/errors.ts`), dan suite penuh hijau **tanpa satu pun test pesan validasi diubah**. Penjaga permanen: `tests/unit/architecture-action-patterns.test.ts` (memindai semua berkas actions, komentar dibuang; daftar pengecualian kosong + cek anti-basi pola G1). Rincian: `docs/form-crud/HASIL-G4.md` §2.

### CRUD-02 (P3) — Revalidasi server absen di seluruh aksi HR; HR hidup dari router.refresh klien

`revalidatePath` = **0** di `actions/hr/cuti-lembur.ts` (8 aksi), `actions/hr/organisasi.ts` (8 aksi), `actions/hr/presensi.ts` (2 aksi) — satu-satunya keluarga modul tanpa revalidasi server (impor juga 0, tetapi alurnya wizard bernavigasi penuh, klasifikasi sah). HR tetap segar karena komponennya memanggil `router.refresh()` (18 pemakaian di `components/akuntansi/hr/`; total repo 156 di 74 berkas). Modul lain memakai **kedua** mekanisme. Risiko terbukti dari struktur: bila aksi HR suatu hari dipanggil dari permukaan yang tidak me-refresh (atau refresh-nya terlewat di satu komponen), data basi tampil tanpa ada yang gagal. Hari ini tidak ada bukti kejadian basi — ini temuan konsistensi/kerapuhan pola, bukan bug terbukti.

**Status sesudah G4 (2026-11-08): TERTUTUP dgn koreksi premis.** Pemeriksaan ulang membuktikan hitungan "nol" audit adalah artefak token literal: ketiga berkas HR **sudah** memanggil helper bersama `revalidateHrPaths()` (`src/server/actions/hr/shared.ts`) yang merevalidasi hub HR, Payroll, dan Akuntansi — panggilan `revalidatePath` hidup di dalam helper, bukan di berkas aksi. Celah sebenarnya yang ditemukan & ditutup: **subhalaman HR tidak tercakup helper** — aksi presensi kini juga merevalidasi `/app/akuntansi/hr/absensi`; aksi cuti-lembur merevalidasi tertarget per aksi (`lembur`/`persetujuan` untuk lembur, `lembur` untuk THR, `cuti` untuk jenis cuti, `cuti`/`persetujuan` untuk pengajuan cuti); organisasi tidak diubah karena kedelapan aksinya tampil di hub yang sudah tercakup helper. `router.refresh()` klien tetap (kedua mekanisme, seperti modul lain). Bukti: penjaga `tests/unit/architecture-action-patterns.test.ts` memeriksa rentang per fungsi ekspor — helper memuat 3 path dasar, organisasi 8/8 aksi memanggil helper, presensi 2/2 memuat path absensi, cuti-lembur 8/8 memuat path tertargetnya; suite HR hijau. Rincian: `docs/form-crud/HASIL-G4.md` §3.

### CRUD-03 (P3) — Bentuk tanda tangan aksi delete tidak seragam (validasinya tetap ada)

12 aksi delete terpetakan. Dua memakai skema objek penuh (`deleteSupplierReturnAction` — `supplier-returns.ts:166`; `deleteTaxonomyAction` — `taksonomi.ts:252`). ±9 memakai `id: string` telanjang lalu memvalidasi inline di badan aksi (mis. `deleteProductAction` — `inventory/produk.ts:311`, validasi di `:315` `z.string().uuid().parse(id)`; pola sama di deleteSupplier/Customer/Account/Warehouse/PaymentMethod/CustomerGroup/HeldSale/CompanyRole). Jadi **tidak ada delete tanpa validasi Zod** — yang beda hanyalah bentuk kontraknya (skema bernama vs parse skalar inline), menyulitkan pembaca yang memindai konsistensi.

**Status final G5 (2026-11-08): TETAP TERBUKA — di luar cakupan program, bernama.** Program G1–G4 menyatakannya di luar cakupan secara sadar dan G5 tidak mengubahnya: tidak ada lubang perilaku (validasi Zod hadir di semua 12 aksi delete); penyamaan bentuk tanda tangan adalah refactor konsistensi untuk gelombang adopsi lanjutan. Tercatat di `docs/form-crud/STATUS-TUTUP-GABUNGAN.md`.

### CRUD-04 (sehat — dipertahankan) — Semantik hapus & idempotensi seragam

- **Master data:** hard-delete **berpenjaga pemakaian** + alternatif nonaktifkan, seragam antar entitas — produk menolak bila berstok/bermutasi (`produk.ts:322-340`, CONFLICT dengan pesan mengarahkan ke nonaktif), kategori menolak bila dipakai produk (`taksonomi.ts:266-274`), pola sama di akun/gudang/metode bayar.
- **Dokumen:** tidak pernah di-delete; void + jurnal pembalik (aturan proyek). Satu-satunya `.delete(` dokumen adalah retur pemasok **status draf** (`server/supplier-returns/returns.ts:416`) dan baris kemasan yang belum terpakai (`server/catalog/packaging.ts:376`) — keduanya memang belum menjadi fakta akuntansi.
- **Idempotensi:** kunci idempotensi ada di semua aksi pembuat dokumen (pos, penerimaan, penyesuaian, transfer, opname, jurnal, beban-transfer, payroll, retur pemasok, quick-entry, commit impor) dan absen di create master data — di sana penjaganya constraint unik (SKU/barcode/kode) + busy-state klien (FRM-05). Pembagian ini koheren dan tidak ditemukan pengecualian.

### CRUD-05 (terverifikasi BUKAN temuan) — Helper impor di folder actions

`import/commit-phases.ts` & `import/commit-packaging.ts` menunjukkan nol di semua kolom pola — tetapi berkasnya secara eksplisit **bukan** `"use server"` (komentar kepala `commit-phases.ts`: "Bukan berkas \"use server\" (pola shared.ts); aksi di commit.ts tinggal orkestrasi") dan fungsi-fungsinya berparameter `tx` (domain), dipanggil `commit.ts` yang ber-`guard`/`requirePermission`. Konsisten dengan cakupan A1 (201/201). Dicatat agar hitungan nol itu tidak dibaca sebagai lubang oleh pembaca berikutnya.

---

## 4. Temuan TABEL (di luar cakupan Putaran 3)

### TBL-01 (P2) — Pagination adalah slot opt-in: daftar yang tumbuh tidak otomatis terpaginasi

`DataList` menyediakan slot `pagination` tetapi tidak memasangnya (kontrak di `blocks/data-list.tsx:47-52`: pemanggil yang mengisi). Terukur: slot diisi **13 halaman** (jurnal, beban, nilai, opname, penerimaan, penyesuaian, pergerakan, produk, transfer, pembelian, retur-pembelian, riwayat POS, riwayat sesi) dan 18 berkas mengimpor `Pagination` langsung. Sebaliknya **±40 dari 64 page.tsx bertabel** tanpa pagination apa pun — mayoritas sah (halaman detail `[id]`, cetak, dashboard, daftar terikat alami seperti bagan akun 124 baris templat & payroll per bulan). Yang tumbuh bersama data dan **tanpa** pagination maupun batas baca terukur dari kode: **Piutang & utang** (`app/akuntansi/(akuntansi)/piutang-utang/page.tsx`; permukaan yang di A3 juga terukur berat), **daftar Pemasok/Pelanggan** (baca daftar `server/catalog/parties.ts:10,18` `listSuppliers/listCustomers` tanpa `.limit`), **Purchase request** & **Reservasi** (daftar dokumen operasional). Pola batas server sebenarnya sudah ada dan terbukti di katalog (`server/catalog/products.ts:139` `.limit(pageSize)`, `group-prices.ts:88`) — ia hanya tidak menjadi bawaan daftar.

**Akar pola:** pagination **opt-in per halaman**, bukan bawaan kerangka daftar. Rasa sakit aktualnya bergantung volume data produksi: **perlu validasi visual/volume**; ketiadaan mekanismenya terbukti dari kode.

**Status sesudah G3 (2026-11-08): TERTUTUP.** Ukuran halaman distandarkan ke satu konstanta repo `LIST_PAGE_SIZE = 40` (`src/lib/pagination.ts` — nilai dominan: 7 daftar dokumen gudang sudah 40; yang menyimpang diselaraskan: produk 30→40, jurnal 30→40, beban 25→40, rekonsiliasi 25→40, nilai 50→40; pengecualian tertulis: buku besar 50, sub-daftar detail 20/10, pengaturan 20, lembar hitung 200, ekspor 100). Slot Pagination kini terisi di semua daftar yang tumbuh: daftar pihak lewat bacaan server terpaginasi baru `listSuppliersPage`/`listCustomersPage`, reservasi lewat `listReservationsPage` + `countReservationsSummary`, purchase request lewat `listPurchaseRequestsPage` + `countPurchaseRequestsByStatus`, piutang/utang lewat pagination lapisan tampil di atas fungsi baca gabungan (alasan tertulis di HASIL-G3 §2). Daftar pendek terbatas master tetap tanpa pagination dgn alasan tertulis per daftar. Penjaga: `tests/unit/architecture-list-patterns.test.ts`. Rincian: `docs/form-crud/HASIL-G3.md` §2.

### TBL-02 (P3) — Tidak ada pengurutan kolom interaktif di mana pun

`aria-sort` = **0** di seluruh repo; tidak ada header tabel yang bisa diklik untuk mengurutkan pada satu pun dari 131 titik `<table`. Urutan selalu tetap dari server (biasanya tanggal/nama). Ini seragam — tetapi seragam dalam ketiadaan: untuk tabel panjang (pergerakan, jurnal, nilai) pengguna tidak punya cara mengurutkan ulang selain filter. Klasifikasi: **keputusan yang tidak pernah diambil secara sadar**, bukan pelanggaran pola yang ada. Standar tabel data pada riset Putaran 3 mengharapkan sorting pada kolom kunci; audit ini mencatatnya sebagai celah kemampuan, bukan cacat.

**Status sesudah G3 (2026-11-08): TERTUTUP sesuai batas mandat (sorting TERBATAS).** Pola: header dapat diklik + `aria-sort` + sorting di fungsi baca server. Terpasang: Produk (nama/harga jual/stok — `listProducts` menerima `sort`/`dir`, terbukti hidup via pengukuran DOM), daftar pihak (nama/kode — bacaan terpaginasi server), piutang/utang (tanggal/tempo/sisa — di model baca halaman). Daftar lain dinyatakan keputusan sadar BELUM dgn alasan tertulis (kepala kolom didominasi tanggal dokumen; urutan bawaan sudah urutan kerja) — bukan dikerjakan setengah. Rincian: `docs/form-crud/HASIL-G3.md` §5.

### TBL-03 (P3) — Isi kolom aksi: menu ⋯ terwujud sebagian; komponen aksi baris terfragmentasi per modul

Putaran 3 menutup **lebar** kolom aksi (T-04). Soal **isinya**: `RowMenu` bersama mencapai **16 pemanggil** CodeGraph — termasuk pembungkus `AccountRowActions`, `ProductRowActions`, `SaleRowActions` — sementara modul-modul lain mempertahankan komponen aksi barisnya sendiri: `gudang/void-buttons.tsx`, `gudang/approval-buttons.tsx`, `gudang/purchase-order-actions.tsx`, `gudang/supplier-return-actions.tsx`, `gudang/purchase-request-panel.tsx`, `akuntansi/period-manager.tsx`, dan aksi inline di beberapa halaman pengaturan. Arah A-25 ("satu tombol utama per halaman; aksi baris masuk menu ⋯") dengan demikian terwujud penuh hanya pada permukaan RowMenu; permukaan lain menampilkan gugus tombol langsung dengan susunan & label yang ditentukan per komponen. Berapa halaman persisnya menyimpang hanya bisa dipastikan per render: **perlu validasi visual** untuk vonis per halaman; fragmentasi komponennya terbukti dari graf.

**Status sesudah G3 (2026-11-08): BAGIAN DAFTAR TERTUTUP.** Semua aksi baris permanen di daftar bermigrasi ke RowMenu ⋯ (daftar pihak, gudang/cabang, metode pembayaran, pengguna & peran, kelompok harga, HR master, daftar dokumen stok, piutang/utang, bank, beban, payroll, kasbon, pinjaman) — nol aksi destruktif permanen tersisa di daftar; pengecualian tertulis (tombol keputusan workflow dokumen, void di halaman DETAIL, aksi utama form) & inventaris ulang di `docs/form-crud/HASIL-G3.md` §1, dikunci penjaga `architecture-list-patterns.test.ts`. Sisa fragmentasi komponen aksi di luar daftar (panel & halaman detail) bukan cakupan tahap ini.

**Status final G5 (2026-11-08): SEBAGIAN.** Bagian daftar tetap TERTUTUP & terkunci penjaga; sisa bernama — fragmentasi komponen aksi di panel & halaman detail — tidak dikerjakan program gabungan ini dan tercatat sebagai sisa terbuka final di `docs/form-crud/STATUS-TUTUP-GABUNGAN.md`.

### TBL-04 (sehat — dipertahankan) — Format sel & keadaan kosong sangat disiplin

`formatIDR` **649**, `formatQty` **163**, `formatDate*` **214** pemakaian; `Intl.NumberFormat` mentah hanya 1 (di `blocks/empty-state.tsx`, bukan sel data); `toLocaleString` 10. Keadaan kosong: `EmptyState` **100 pemanggil** + slot `isEmpty/empty` bawaan DataList. Angka tabular & perataan sudah menjadi wilayah Putaran 3 (tertutup). Tidak ada temuan baru di aspek format.

---

## 5. Usulan rencana perbaikan bertahap (BELUM dieksekusi — untuk keputusan pemilik)

Urutan mengikuti akar terpusat dulu, sesuai pelajaran Putaran 3 (satu perbaikan bersama menyembuhkan banyak halaman).

| Tahap | Isi | Menutup | Cakupan estimasi |
|---|---|---|---|
| **1 — Dialog & konfirmasi satu pintu** | Migrasikan 18 `window.prompt` + ≥10 `window.confirm` ke `ConfirmDialog` + dialog "alasan" bersama meniru pola gudang (`void-buttons`/`approval-buttons`); tambahkan penanganan Escape ke `blocks/Modal`; pasang test arsitektur baru: larang `window.confirm/prompt` & overlay `fixed inset-0` racikan di luar primitif | FRM-01 (sebagian), FRM-02 | ±20 berkas komponen (akuntansi 11, HR 2, pengaturan 4, gudang/pos sisa 3) + 2 berkas blocks + 1 test penjaga |
| **2 — Primitif form bersama** | Angkat `Field` bersama ke `blocks/` dan migrasikan 5 salinan lokal; bangun `QtyInput` (meninjau keputusan A-28 dengan bukti FRM-03) dan adopsi pertama di editor baris + opname + keranjang POS; ekstrak helper submit bersama (`busy` + `result.ok` + toast) dan adopsi per modul | FRM-03, FRM-04, FRM-05 | 1 berkas blocks baru ×3 primitif; adopsi ±25 berkas form (bertahap per modul: gudang → akuntansi → pengaturan/HR) |
| **3 — Keseragaman idiom CRUD** | Samakan `parseInput` di berkas penyimpang (pos.ts, pihak, taksonomi, periode, lokasi, kelompok-harga, import/rows, campuran produk/akun-pemetaan); tambahkan `revalidatePath` pada 18 aksi HR; seragamkan tanda tangan delete ke skema objek; kunci dengan test arsitektur pola-aksi (rasio idiom tidak boleh mundur — pola ratchet A-26) | CRUD-01, CRUD-02, CRUD-03 | 10 berkas actions + 1 test penjaga; nol perubahan perilaku (paritas dibuktikan suite) |
| **4 — Tabel: pagination & keputusan sorting** | Jadikan pagination bawaan DataList untuk daftar dokumen (atau wajib-isi slot untuk daftar bertipe dokumen); paginasi/batas baca untuk piutang-utang, daftar pihak, purchase-request, reservasi; ambil keputusan sorting secara sadar (terapkan di 3 tabel terpanjang atau tolak tertulis); perluas RowMenu ke permukaan aksi-baris yang tersisa | TBL-01, TBL-02, TBL-03 | 4-6 halaman + reads terkait; RowMenu ±6 komponen aksi khusus dinilai satu per satu |
| **5 — Validasi visual penutup** | Ulangi pengukuran DOM ala Putaran 3 (skrip measure + screenshot) pada permukaan yang disentuh Tahap 1-4 + halaman Payroll Indonesia (FRM-06: putuskan pecah wizard/simpan-per-seksi berbukti layar, bukan berbukti kode) | FRM-06, FRM-07, sisa "perlu validasi visual" | 1 putaran pengukuran ±47 halaman seperti Putaran 3 |

Catatan urutan: Tahap 3 murni ejaan kode (risiko terendah, paritas suite) dan bisa bertukar tempat dengan Tahap 2 bila pemilik memprioritaskan kerapian kode di atas pengalaman form; Tahap 1 didahulukan karena menyentuh data audit (alasan void) dan konsistensi destruktif — dua hal yang paling terasa "tidak rapi" dari bukti statis.

---

## Lampiran A — Hitungan pola per berkas actions (mentah)

Kolom: aksi ekspor · parseInput( · .parse( · guard( · requirePermission · revalidatePath. (Berkas helper bersama ditandai *.)

| Berkas | Aksi | pInp | .parse | guard | req | rPath |
|---|---|---|---|---|---|---|
| accounting/akun-pemetaan.ts | 4 | 2 | 3 | 4 | 5 | 7 |
| accounting/beban-transfer.ts | 4 | 3 | 2 | 4 | 5 | 11 |
| accounting/jurnal.ts | 4 | 3 | 0 | 4 | 7 | 6 |
| accounting/migrasi-coa.ts | 2 | 0 | 1 | 2 | 3 | 5 |
| accounting/pembayaran.ts | 7 | 7 | 1 | 7 | 8 | 18 |
| accounting/periode.ts | 4 | 0 | 4 | 4 | 5 | 9 |
| accounting/saldo-awal.ts | 4 | 3 | 2 | 4 | 3 | 9 |
| bank-reconciliation.ts | 5 | 6 | 0 | 5 | 6 | 6 |
| company.ts | 1 | 0 | 0 | 1 | 0 | 2 |
| employee-advances.ts | 3 | 4 | 0 | 3 | 4 | 4 |
| employee-loans.ts | 3 | 4 | 0 | 3 | 4 | 4 |
| fixed-assets.ts | 5 | 6 | 0 | 5 | 6 | 3 |
| hr/cuti-lembur.ts | 8 | 9 | 0 | 8 | 9 | **0** |
| hr/karyawan.ts | 3 | 3 | 1 | 3 | 5 | 4 |
| hr/organisasi.ts | 8 | 9 | 0 | 8 | 9 | **0** |
| hr/payroll.ts | 3 | 3 | 1 | 3 | 4 | 9 |
| hr/presensi.ts | 2 | 3 | 0 | 2 | 3 | **0** |
| import/analyze.ts | 1 | 0 | 1 | 1 | 2 | 0 |
| import/commit.ts | 1 | 0 | 1 | 1 | 2 | 0 |
| import/rows.ts | 4 | 0 | 4 | 4 | 5 | 3 |
| inventory/opname.ts | 4 | 5 | 0 | 4 | 5 | 10 |
| inventory/penerimaan.ts | 3 | 4 | 0 | 3 | 4 | 14 |
| inventory/penyesuaian.ts | 4 | 5 | 0 | 4 | 5 | 10 |
| inventory/pihak.ts | 6 | 0 | 6 | 6 | 7 | 11 |
| inventory/produk.ts | 8 | 3 | 5 | 8 | 11 | 7 |
| inventory/taksonomi.ts | 5 | 0 | 5 | 5 | 6 | 11 |
| inventory/transfer.ts | 1 | 2 | 0 | 1 | 2 | 3 |
| master-data.ts | 5 | 6 | 0 | 5 | 7 | 4 |
| palette.ts | 1 | 0 | 1 | 1 | 0 | 0 |
| payroll-indonesia.ts | 6 | 7 | 0 | 6 | 7 | 8 |
| pos-offline.ts | 4 | 4 | 0 | 4 | 6 | 6 |
| pos-terminals.ts | 4 | 5 | 0 | 4 | 5 | 4 |
| pos.ts | 17 | 0 | 13 | 17 | 21 | 21 |
| purchase-requests.ts | 3 | 4 | 0 | 3 | 4 | 4 |
| purchasing.ts | 6 | 6 | 0 | 6 | 7 | 11 |
| quick-entry.ts | 5 | 4 | 0 | 5 | 6 | 8 |
| reimbursements.ts | 3 | 4 | 0 | 3 | 4 | 3 |
| reservations.ts | 3 | 4 | 0 | 3 | 4 | 7 |
| settings/cetak.ts | 2 | 2 | 1 | 2 | 3 | 7 |
| settings/identitas-pajak.ts | 2 | 2 | 0 | 2 | 3 | 3 |
| settings/kelompok-harga.ts | 4 | 0 | 4 | 4 | 5 | 9 |
| settings/kolom-kustom.ts | 1 | 2 | 0 | 1 | 2 | 3 |
| settings/lokasi.ts | 4 | 0 | 4 | 4 | 5 | 9 |
| settings/modul.ts | 1 | 2 | 0 | 1 | 2 | 3 |
| settings/operasi-gudang.ts | 2 | 3 | 0 | 2 | 3 | 5 |
| settings/pembayaran.ts | 5 | 2 | 4 | 5 | 6 | 11 |
| settings/penomoran.ts | 1 | 2 | 0 | 1 | 2 | 2 |
| supplier-returns.ts | 9 | 10 | 0 | 9 | 9 | 5 |
| users.ts | 6 | 8 | 0 | 7 | 7 | 8 |
| *accounting/shared.ts, hr/shared.ts, import/shared.ts, inventory/shared.ts, import/commit-phases.ts, import/commit-packaging.ts* | helper | 0 | 0 | 0 | 0 | 0 |

Pengecualian bernama yang sudah terverifikasi program sebelumnya: `company.ts` (keanggotaan, bukan izin modul) & `palette.ts` (requireAuth + cakupan server) — lihat CRUD-05 & register Audit Produksi.

## Lampiran B — Metode & reproduksi

- CodeGraph: `codegraph status` (906 berkas/15.917 node/56.873 edge), `codegraph query <nama>` untuk rumah komponen, `codegraph callers <nama>` untuk angka adopsi di §1.1 (pemanggil termasuk pemanggil tak langsung lewat pembungkus tempat dicatat).
- Pola sumber: penelusuran `grep` atas `src/components`, `src/app`, `src/server/actions` untuk `<input`, `type="number"`, `inputMode="decimal"`, `fixed inset-0`, `window.confirm|prompt`, `parseInput(`, `.parse(`, `guard(`, `revalidatePath`, `formatIDR|formatQty|formatDate`, `aria-sort`, `pagination={` — hasil mentah apa adanya, tanpa pemangkasan selain yang dinyatakan.
- Sampel baca penuh: `blocks/data-list.tsx`, `blocks/modal.tsx`, `blocks/confirm-dialog.tsx` (kepala), `actions/inventory/produk.ts:311-340` (delete berpenjaga), `actions/inventory/taksonomi.ts:252-274`, `pos/return-form.tsx:112-132`, `pengaturan/forms/identitas-pajak.tsx:210-265`, `actions/import/commit-phases.ts:1-8` (status helper).
- Tidak ada kode yang diubah oleh audit ini; tidak ada test dijalankan (analisa statis murni).
