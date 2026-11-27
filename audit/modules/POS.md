# POS — Deep Audit

**Scope:** catalog/search/barcode, packaging, pricing groups, discounts, tax/rounding, cart/hold, checkout and tender, credit/debt, returns/exchange/void, cash sessions, receipts/printing, offline/PWA, device/desktop APIs, inventory and journal effects.
**Evidence run:** 17 integration files, **151/151 passed** (`audit/checks/validate-pos-after-scan.log`; includes the new exact-code scan set); previous full-module run **144/144** (`audit/checks/validate-pos-full2.log`); PWA E2E **2/2** (`validate-pwa-final.log`); full unit suite **1,235/1,235** (`audit/checks/pos-unit-after-scan.log`).

## Inventory and traceability

| Surface | Main code | Notes |
|---|---|---|
| Terminal UI | `src/components/pos/pos-terminal.tsx` (801 lines), `components/pos/terminal/*` | Search, cart, payment, hold, offline queue, print queue, admin panel. |
| Actions | `src/server/actions/pos.ts`, `pos-offline.ts`, `pos-sessions.ts`, `pos-receipt.ts`, `pos-terminals.ts` | Permission + Zod + tenant transaction; checkout uses `pos.sell`. |
| Domain | `src/server/pos/{quote,sales-create,sales-payments,sales-persist,sales-stock,sales-void,returns,receivables,sessions,offline,terminals,receipt-token}.ts` | Shared by web, offline, and device sync. |
| Persistence | `src/db/schema/{sales,catalog,platform}.ts`, migrations 0087/0088 | Sales, payments, returns, cash sessions, outbox, terminals. |
| API | `/api/pos/{snapshot,sync,pair,telemetry,download,update,desktop/*}` | Bearer device token or authenticated user; pairing code is the credential. |

## Verified workflows

- **Server quote and price integrity:** client prices are ignored; `quoteCart` recomputes product/group/manual discounts, tax, rounding, packaging conversion, stock and reservation availability. `lockCosts:true` locks product rows (`quote.ts:408`) before COGS is snapshotted.
- **Checkout idempotency and replay:** `checkoutAction` takes a transaction-scoped advisory lock, claims `pos.sale` idempotency, compares a canonical fingerprint, handles held-sale claims, and writes sale/payments/stock/cash/journal/audit in one tenant transaction (`actions/pos.ts:257-364`, `sales-create.ts`). Concurrent replay and changed-payload rejection are exercised by `erp-concurrency-remediation` (passed) and the E2E lost-response scenario (passed).
- **Cash session serialization:** checkout and close lock the `cash_sessions` row (`sales-create.ts:344-394`, `sessions.ts:176-260`). Close recomputes expected cash, rejects stale previews, requires a reason beyond tolerance, and posts the difference. Fixture isolation was corrected; the full POS suite now passes 144/144.
- **Stock deduction:** `applyStockMovement` locks product then `stock_on_hand`, refuses negative results unless `allow_negative_stock`, appends the movement, and re-blends AVCO. Sales respect the company setting. Batch lines use FEFO; serials are validated.
- **Returns/voids:** origin sale row and lines are locked; return caps are computed from original line values; stock and serial/batch restoration use original slices; receivable offset and refund are separated; void is blocked when a posted return exists; AR payments and customer credits are reversed. Financial and original-print assertions now pass after the POS-005 fix.
- **Device/security:** device tokens are digest-only, resolved per terminal, revocable, and tenant-scoped; snapshot omits `costPrice`; pairing is throttled; updater requires a token and a real artifact+signature; Electron uses `sandbox`, `contextIsolation`, no Node, and origin navigation guards.
- **Telemetry:** bounded body/fields/values, reserved server keys (SEC-001 fixed).

## Critical POS scenarios

| Scenario | Result | Evidence / limit |
|---|---|---|
| Double-click checkout | **PASS** | UI blocks overlapping submit + server attempt lock/idempotency; `pos-guards`/`pos-audit-remediation` |
| Two cashiers selling the last stock | **PASS (probe)** | Product/on-hand `FOR UPDATE` + negative policy; disposable-DB probe: 4/8/20 concurrent same-SKU sales all committed, stock delta exact, no oversell. Single host, no production network. |
| Timeout after payment succeeds | **PASS (one scenario)** | Playwright lost-response replay returns the same sale once (`browser-guarded.log`) |
| Network interruption during checkout | **PASS (one scenario)** | Recovery record + retry path; E2E network failure case passed |
| Repeated rapid barcode scanning | **PARTIAL** | Exact barcode/SKU path now index-backed and measured at 10.2k/100k products; no physical scanner/rapid-fire hardware test |
| Failed payment / rollback | **PARTIAL** | Tenant transaction composes sale/stock/cash/journal; no injected DB failure mid-commit |
| Duplicate API request / retry | **PASS** | Fingerprint compare, same key/same payload replay, changed payload conflicts; 8-way replay probe produced one sale row |
| Refund and stock restoration | **PASS** | `pos-returns` stock/serial/batch and journal assertions; POS-005 print/token assertions pass |
| Discount/tax/rounding edge cases | **PASS (tested cases)** | `pos-quote-parity`, `packaging-pos`; no exhaustive property/fuzz test |
| Printer failure after committed sale | **NOT TESTED** | Print is outside the DB commit; no hardware/jam test. A failed print must not re-post the sale. |

## Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| POS-005 | **P1 — FIXED** | Post-checkout receipt/A4 links now carry the one-time `printToken`; only `salinan=1` marks a copy; A4 accepts a fresh token. | FIXED / VERIFIED (`p1-pos-receipts.log` 12/12) |
| POS-006 | **P2 — FIXED** | First offline reload now works: cache id persisted in Cache Storage + page postMessage; E2E 2/2. | FIXED / VERIFIED |
| POS-002 | **P2 — FIXED** | Outbox retention CLI (`prune:pos-outbox`) preserves unresolved rows; docs added. | FIXED (control) |
| QA-002 | **P2 — FIXED** | Fixture isolation and brittle assertions corrected; full POS 144/144. | FIXED / VERIFIED |
| POS-007 | **P2 — FIXED / VERIFIED** | Exact barcode/SKU scan resolved through unique indexes instead of an OR that seq-scanned the catalog. 100k-product p50 65.2 → 4.9 ms (13.4×); 10.2k 7.2 → 4.3 ms. | FIXED / VERIFIED |

### POS-007 detail (FIXED 2026-11-24)

The scan path called `searchProducts({ exactCode: true })`; its single OR predicate (`barcode = q OR sku = q OR EXISTS(packaging barcode = q)`) defeated the unique B-tree indexes and produced a sequential scan on every scan. EXPLAIN at 10.2k showed `Seq Scan on products`, 10,265 rows removed. The prior S4 benchmark had already measured **185 ms p50** for POS barcode search at 100k products (`docs/sim2/S4-BENCHMARK.md`), which grows linearly with catalog size. The fix resolves the code through `products.barcode`, `product_packagings.barcode`, then `products.sku` (same barcode → packaging → SKU priority as the old `ORDER BY`) and fetches one row by id; typed search and all other semantics are unchanged. A synthetic row at the end of the 100k heap scanned in 4.51 ms p50 after the fix, versus a 73.1 ms seq-scan plan for the old OR on the same code. Regression tests (`tests/integration/pos-search-exact.test.ts`, 7 cases) cover barcode/SKU/packaging matches, inactive packaging, both priority collisions, category filtering, and empty input. Evidence: `validate-pos-after-scan.log` 151/151, `pos-search-bench-100k-before.log` vs `pos-search-bench-100k-after.log`, `pos-search-bench-100k-late-after.log`.

### POS-005 detail (FIXED 2026-11-23)

The pre-fix path had `actions/pos.ts:315,359` returning `receiptToken`, while `checkout-success-modal.tsx` and `use-terminal-checkout.ts` navigated without it; `nota/[id]/page.tsx` treated `!fresh` as a copy and built-in Kasir lacked `pos.receipt.reprint`. The fix adds `src/lib/pos/receipt-links.ts`, propagates the token through the success modal/router/popup and receipt↔A4 links, makes `salinan=1` the only copy marker, and lets A4 accept a fresh token (historical views still require reprint permission and are audited). Evidence: `p1-pos-receipts.log` 12/12, `p1-unit-seed-links.log`; build/typecheck pass.

## POS-006 detail

`public/pos-sw.js:62-103` fetches `/app/pos` during install, caches only `/_next/static/*` assets, and explicitly skips the document. `terminalDocument` caches the document only during a controlled successful navigation (`:160-177`). The first `/app/pos` navigation occurs before the new worker controls the page, so the per-session cache is empty. Pre-fix E2E failed \`net::ERR_FAILED\`. Fixed by storing the cache id in Cache Storage during install/navigation and accepting the page-posted id (CookieStore in a worker cannot read the `/app/pos` cookie because of the script-URL scope restriction). Post-fix E2E: 2/2 (`validate-pwa-final.log`).

## Measured performance (2026-11-24)

Disposable PostgreSQL 18.6 fixture, app role `app_user` under forced RLS, production standalone Next.js build on the same host. These are **lab measurements, not production SLOs**: no store LAN, no representative prod data, no physical scanner/printer, no multi-host pool contention. Raw logs are in `audit/checks/pos-*.log`.

**Server domain calls, 10,200 products (p50 / p95 ms; 40–60 runs):**

| Operation | Before POS-007 | After POS-007 |
|---|---:|---:|
| Exact barcode scan | 7.22 / 9.14 | **4.33 / 6.08** |
| Exact SKU scan | 7.16 / 8.08 | **4.53 / 6.20** |
| Typed name search ("Aqua") | 19.35 / 21.11 | unchanged |
| Empty catalog page (24) | 4.44 / 5.96 | unchanged |
| Quote 1 / 5 / 20 lines | 6.11 / 6.09 / 6.99 p50 | unchanged |
| Checkout 1 line (commit incl. journal/stock/cash) | 39.4 / 95.2 (n=10) | unchanged |

**Scaling probe, 100,200 products (90k synthetic no-stock rows added to the 10.2k fixture; 40 runs):**

| Operation | Before | After | Change |
|---|---:|---:|---:|
| Exact barcode | 65.23 / 72.25 | **4.88 / 7.28** | **13.4× p50** |
| Exact SKU | 63.71 / 66.41 | **4.93 / 6.55** | **12.9× p50** |
| Typed word | 159.95 / 168.51 | 158.60 / 174.08 | unchanged (not optimized) |

The synthetic 100k rows have no stock rows, so the old path is *faster* than S4's 185 ms p50 (which had stock rows); the before/after comparison is still apples-to-apples within this fixture. The result is not position-dependent: a synthetic row at the end of the 100k heap measured **4.51 / 6.13 ms p50/p95** after the fix, while the old OR query's `EXPLAIN` on that same code was **73.1 ms** (`Seq Scan`, 90,140 rows removed).

**Browser, Chromium, production build, 10.2k products, 3 baseline runs before POS-007** (the scan flow was re-run successfully after the fix; absolute times below are baseline):

| Interaction | Observed |
|---|---|
| `/app/pos` TTFB / DOMContentLoaded / load | 29–278 / 114–435 / 183–509 ms (first vs warm) |
| Scan → cart line visible | p50 **82–86 ms**, p95 **198–251 ms** (first scan slower) |
| Quote → Bayar enabled | **225–268 ms** (includes 180 ms debounce) |
| Bayar → success modal | **238–303 ms** end-to-end; server commit 84–110 ms, revalidation 0–1 ms |
| Typed search → refreshed cards | **343–378 ms** (includes 220 ms debounce; action 99–192 ms) |
| Long tasks (>50 ms) | 0–2 per run, max 51 ms; no console errors |

Text search deliberately keeps debounce rather than `useDeferredValue` alone: React's own guidance says `useDeferredValue` does not reduce network requests (https://react.dev/reference/react/useDeferredValue). The 220 ms debounce is what cuts requests; the measured first-char search is 25 ms server-side at 10.2k and 157 ms at 100k.

**Checkout concurrency and integrity (same-product lock queue):**

| Probe | Result |
|---|---|
| 4 simultaneous same-SKU sales | 4/4 committed, p50 189.5 ms, p95 258.6 ms |
| 8 simultaneous same-SKU sales | 8/8 committed, p50 344.9 ms, p95 544.6 ms |
| 20 simultaneous same-SKU sales | 20/20 committed, p50 787.5 ms, p95 1,344.4 ms |
| 16 simultaneous 2-product carts in opposite order | 16/16 committed, p50 758.6 ms, max 1,241.1 ms; no deadlock |
| 8 concurrent retries with one idempotency key | 8 fulfilled, **1 sale row / 1 id**, p50 50–68 ms |
| Stock delta after each run | exactly `−sold`, no oversell |

This confirms the serialized lock is safe and that opposite cart order does not deadlock (POS-009), but absolute times are single-host lab numbers; a 20-terminal same-SKU burst is a stress case, not a normal cashier load.

**Offline snapshot (direct domain call, 10.2k products):** full snapshot **1,083.7 ms / 3.21 MB**; immediate delta **22.4 ms / 13.4 KB**. Full sync is a one-time/offline initial cost; delta is the recurring sync path.

**Not measured:** production/staging network latency, pool-wait under mixed reporting + POS load, 100k-product browser run, long soak/memory, physical scanner inter-key timing, printer throughput/jam. The 100k probe is a scaling indicator, not a capacity guarantee.

## Test evidence and gaps

- `validate-pos-after-scan.log`: 17 files, **151/151 passed** after POS-007 (POS suite + exact-code regression).
- `p1-pos-receipts.log`: receipt/invoice P1 regression set **12/12 passed** (fresh token, no-token original, `salinan=1`, A4).
- `current-pos.log` (pre-fix): 14 files pass; `pos-audit-remediation` 2 fixture failures; the `pos-session-close-hardening` POS-005 failure is now fixed.
- `validate-pwa-final.log`: PWA online/offline reload + sync **2/2 passed**.
- **Not tested:** physical printer/jam/power loss, barcode scanner hardware/rapid scan, cross-browser matrix, full 23-file E2E suite, production RLS, load/concurrency at target volume, Electron install on cashier hardware.
- **No P0 confirmed** in the executed POS paths. POS-005, POS-006, and POS-007 are fixed; no active POS code finding remains. Full outage/retry lifecycle, target-volume load, and printer hardware remain untested.

## Electron desktop smoke — 2026-11-25

- Rebuilt AppImage from current source: `app.asar` contains `main.cjs`, preload/settings/offline scripts, both HTML files, and both view scripts; SHA-256 matches the artifact.
- Real Electron 45.4.1 under Xvfb: offline start → offline page; settings window → printer list/58–80mm controls; login → `/app/pos`; full cash sale → “Transaksi berhasil”; no page/console errors.
- 13 key ERP pages (POS, history/session/hold, warehouse, receipt/valuation, opening-stock import, accounting/reports) returned 200 with no error screen.
- Root cause of an initial React #441: disposable DB had not applied migration 0089 (`products.is_tax_exempt`); after `pnpm db:migrate`, POS opened normally. The server release tarball was rebuilt with 0089 and install/update scripts run `migrate.mjs` before serving.
- Residual desktop gaps: LAN `http://IP` is not a secure context, so the PWA offline shell does not register there; kiosk scripts/runbook still carry Tauri-era paths; no auto-update/code signing and Windows NSIS was not built on this host. See `audit/modules/PLATFORM_SECURITY.md` (ELE-001…ELE-005).

## Electron desktop 0.1.2 — 2026-11-27

Desktop shell disamakan dengan terminal POS yang baru, tanpa mengubah jalur transaksi:

- Jendela terminal 1440×900 (minimum 1024×700), langsung dimaksimalkan; latar `#e7ddcc` mencegah kilatan putih saat halaman dimuat, menu bar auto-hide. Uji Xvfb: jendela benar-benar maximized 1536×835 pada work area 1536×864 dan langsung terlihat.
- Halaman offline dan Pengaturan Printer & Server memakai palet POS: kanvas hangat, panel putih, border kuat, aksi hijau, focus ring emas. Status server dan tips laci kasir tetap terlihat.
- Pengaturan kini satu kartu full-height: isi form scroll, tombol **Uji Cetak / Tutup / Simpan** selalu di dasar. Diuji pada 560×660, 540×540, dan lebar minimum 440×503 — tombol Simpan selalu terlihat.
- Label versi dinaikkan ke 0.1.2; AppImage dibangun ulang dari sumber saat ini, SHA-256 `13f17d6bc369958bb7ee40a2586e32f255b1b24c8aa3843d65e10d5183a4d272`.
- Smoke Electron 45.4.1: offline → halaman offline, Pengaturan menampilkan 3 printer + pilihan 58/80 mm, login → `/app/pos`, checkout tunai → “Transaksi berhasil”. 0 console/page error.
- axe-core pada halaman offline dan Pengaturan: **0 violations** (WCAG 2.0/2.1 A/AA). Screenshot: `electron-offline-0.1.2.png`, `electron-settings-0.1.2.png`, `electron-settings-540x540.png`, `electron-settings-420x540.png`.
- Sisa: installer Windows 0.1.2 dibangun lewat CI dan belum diuji pada PC kasir fisik; tanda tangan kode/auto-update belum ada.

## Contrast & readability audit — 2026-11-25 (riwayat; digantikan redesign 2026-11-26)

The POS palette was raised from a white-on-white hierarchy to a neutral canvas + white surfaces + strong component boundaries. Layout and workflow are unchanged.

| Token/role | Value | Contrast |
|---|---|---|
| Main text / white | `#0f172a` / `#ffffff` | 17.85:1 |
| Secondary text / white | `#475569` / `#ffffff` | 7.58:1 |
| Field border / white | `#64748b` / `#ffffff` | 4.76:1 |
| Component border / white | `#77869a` / `#ffffff` | 3.71:1 |
| Component border / tray | `#77869a` / `#e9eef5` | 3.29:1 |
| Action green / white | `#047857` / `#ffffff` | 5.48:1 |

Changes: canvas `#e4eaf1`, tray `#e9eef5`, header `#e2e8f0`; product/payment/cart panels use `--pos-border-strong`; fields use `--input: #64748b`; accurate action primary darkened `#059669 → #047857`; selected cards use the full action-soft fill; stock badges use `slate-200/slate-800`; payment content is a tinted band; category bar and pagination footer are tinted; payment footer is sticky with a solid action button. `@media (prefers-contrast: more)` strengthens borders/backgrounds, and the existing forced-colors rules remain.

Verification: axe-core WCAG 2 A/AA scan of `/app/pos` with two cart lines reports **0 violations** (`audit/checks/pos-axe-final.log`); screenshot `audit/checks/pos-contrast-after.png`; unit suite 1,249/1,249, typecheck/build/lint pass. No contrast claim is made for physical displays or unmeasured color-blind simulations.

## Redesign "Pasar Modern" — 2026-11-26 (menggantikan audit kontras 2026-11-25)

Permintaan pemilik: POS masih terlalu putih, hierarki warna lemah, dan panel pembayaran terlalu banyak menu. Perubahan kali ini adalah redesign tampilan + penyederhanaan alur, bukan sekadar ganti warna.

**Arah visual.** Kanvas hangat `#efe9de`, permukaan kertas `#fffdf8`, bilah perintah hijau tua (diturunkan dari tema aksi, bawaan `#065f46`), dan aksen emas `#f3b63f` untuk total/CTA. Warna kategori hanya menjadi pita 4px di sisi kiri kartu; tidak ada isian warna acak. Tidak memakai gradient dekoratif, glassmorphism, atau bayangan berlebih.

**Penyederhanaan alur pembayaran.**
- Toggle "Tunggal/Campuran" di header dihapus. Metode utama tampil sebagai kartu besar; maksimal empat metode, sisanya dilipat di "Metode lain (n)".
- "Bayar dengan beberapa metode" menjadi tautan di bawah alur tunai, dan mode campuran punya tombol "Kembali ke tunggal".
- Fee/MDR dilipat ke disclosure "Biaya MDR"; nilai bawaan tetap dikirim walau tidak dibuka.
- Kredit retur tetap tersedia tetapi collapsed; utang hanya muncul setelah metode Utang dipilih.
- Input "Uang diterima" dan "Kembalian" diperbesar (56px) dengan chip uang pas/pecahan di bawahnya.
- Pemilih kelompok harga dipindah ke header keranjang (satu baris), menghapus baris "Harga" terpisah.
- Diskon per baris menjadi ikon tag 44px di samping tombol hapus; editor tetap muncul saat dipilih.
- Toolbar katalog di layar kecil kini dua baris rapi (cari; gudang + tampilan + printer + menu), bukan tiga baris.
- Bar bayar mobile memakai bilah hijau tua + tombol emas dengan teks gelap.

**Kontras terukur (default Hijau Retail).**

| Pasangan | Rasio |
|---|---:|
| Teks utama `#1c1917` / kanvas `#efe9de` | 14.47:1 |
| Teks sekunder `#57534e` / panel `#fffdf8` | 7.50:1 |
| Garis komponen `#7d7463` / panel `#fffdf8` | 4.54:1 |
| Garis komponen `#7d7463` / tray `#e9e1d3` | 3.55:1 |
| Putih / command `#065f46` | 7.68:1 |
| Command-muted `#c7e0d4` / command `#065f46` | 5.50:1 |
| Emas muda `#fde68a` / command `#065f46` | 6.17:1 |
| Putih / aksi `#047857` | 5.48:1 |
| Putih / QRIS `#6d28d9` | 7.10:1 |
| Putih / bank `#1d4ed8` | 6.70:1 |
| Putih / utang `#b45309` | 5.02:1 |
| Teks emas `#3f2c05` / tombol emas `#f3b63f` | 7.35:1 |

Ambang mengikuti WCAG 2.2 SC 1.4.3 (teks normal 4.5:1) dan SC 1.4.11 (komponen/grafis 3:1). Referensi arah: W3C WCAG 2.2; Shopify "POS System Design" (satu layar transaksi, minimal click-path); floow.design "UI kasir Indonesia" (total terbesar, Rupiah konsisten, QRIS tanpa memilih dompet); BikinDigital DigiKasir v1.0.10 (satu warna aksi, kanvas hangat, angka tabular).

**Verifikasi.**
- `pnpm test`: **146 files / 1.250 tests passed** (termasuk 57 test POS terarah).
- `pnpm build` (termasuk `tsc --noEmit`) lulus; `pnpm lint` 0 error (8 warning lama di luar POS).
- axe-core WCAG 2 A/AA di `/app/pos` dengan dua baris keranjang: **0 violations**.
- Chromium: desktop 1440×900, laptop 1366×768, dan mobile 390×844; tidak ada console/page error. Pada 1366×768 input "Uang diterima" terlihat tanpa scroll; chip saran dan tombol Bayar tetap terjangkau.
- Checkout nyata lewat UI baru (5 scan → Bayar → Uang Pas → "Transaksi berhasil"): quote 318 ms, checkout 360 ms, 0 console error (`audit/checks/pos-redesign-checkout-smoke.log`).
- Screenshot: `audit/checks/pos-contrast-after.png` dan `audit/checks/pos-mobile-redesign.png`.

**Sisa risiko.** Belum diuji dengan kasir sungguhan, pembaca layar nyata, printer fisik, atau Windows/Electron setelah redesign. Uji pengguna singkat (5 kasir, skenario scan → tunai → QRIS → campuran) tetap disarankan sebelum rollout produksi.

## Audit UX lanjutan & perbaikan — 2026-11-27

Audit mendalam (Playwright 1920/1536/1366/390, axe, riset Exa/Firecrawl/web-search) menemukan tiga masalah utama: footer menutup chip tunai pada 1366/1536, keranjang tidak auto-scroll ke item terbaru, dan placeholder “Pas: …” hanya 2.33:1 serta tampak seperti nilai terisi. Perbaikan yang sudah diterapkan: panel pembayaran dipadatkan (2 metode utama + dialog opsi), total keranjang dipindah ke dialog “Rincian transaksi”, auto-scroll + fade keranjang, placeholder `0` (7.50:1), kartu 126px dengan harga 22px, grid katalog mengikuti lebar area (3–6 kolom), checkmark metode aktif, tombol Bayar 56px, dan ringkasan total dihapus dari alur utama. Verifikasi akhir: 1.257 unit test, build/typecheck, lint 0 error, axe 0 violations di semua viewport termasuk dialog, checkout 5 item 327ms tanpa console error. Tindak lanjut: panel pembayaran dipindah ke dialog fokus (ala Accurate) yang baru muncul setelah tombol Bayar; kolom kanan menjadi satu kartu native dengan daftar mengisi tinggi, footer Total + Bayar + Tahan tetap, harga produk hijau, kanvas lebih kontras, dan simpan hold tanpa toast sukses. Detail: [`audit/POS_UX_AUDIT_2026-11-27.md`](../POS_UX_AUDIT_2026-11-27.md).
