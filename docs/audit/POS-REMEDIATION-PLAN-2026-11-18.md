# RENCANA PERBAIKAN MODUL POS — BISA ERP

Tanggal: 2026-11-18  
Status: **IMPLEMENTASI SEBAGIAN — Fase 0–4 inti sudah dikerjakan; Fase 5 ditunda dengan keputusan produk**  
Sumber: Audit Total Modul POS 2026-11-18 + validasi ulang kode/dokumentasi  
Cakupan: POS web (`/app/pos`) dan POS Desktop (Tauri)  
Prinsip: **critical reliability dulu, baru kecepatan, baru fitur.**

---

## 1. Ringkasan Rencana

Audit menemukan 19 isu. Setelah validasi ulang, severity disesuaikan: **1 Critical bersyarat, 5 High, 10 Medium, 3 Low**. Beberapa temuan bergantung pada keputusan operasional (offline web, multi-printer, shared login). Urutan perbaikan tidak boleh berdasarkan kemudahan, tetapi berdasarkan risiko operasional:

1. **Fase 1 — Printing & offline receipt.** Ini yang menghentikan toko saat printer/internet bermasalah.
2. **Fase 2 — Navigasi & persepsi cepat.** Ini yang membuat kasir mau memakai fitur yang sudah ada.
3. **Fase 3 — Kontrol kas & fitur yang hilang.** Reprint audit, X report, Z prompt, expiry hold.
4. **Fase 4 — Observability, concurrency, keamanan antrean offline.** Agar kegagalan terlihat sebelum pelanggan mengeluh.
5. **Fase 5 — Parity & arsitektur jangka panjang.** Multi-printer, split bill, penyatuan web/desktop, HA.

**Estimasi kasar:**

| Fase | Estimasi solo | Estimasi 2 dev + QA | Hasil |
|---|---:|---:|---|
| 0. Baseline | 2 hari | 1 hari | Benchmark dan guardrail |
| 1. Printing | 12 hari | 6–7 hari | Print queue, offline receipt, audit cetak |
| 2. Navigasi | 13 hari | 7 hari | p95 navigasi <150 ms |
| 3. Kontrol kas | 9 hari | 5 hari | Reprint audit, X/Z, hold expiry |
| 4. Reliability | 19 hari | 9–10 hari | APM, alert, load test, queue hardening |
| **Total Fase 0–4** | **55 hari** | **29 hari** | **Siap operasi high-volume satu gerai** |
| 5. Jangka panjang | 40–60 hari | 20–30 hari | Multi-printer, split bill, parity, HA |

**Rekomendasi eksekusi:** Fase 0–1 dulu sebagai satu milestone “safe to operate offline”. Jangan mulai Fase 2 sebelum print queue stabil, karena navigasi cepat tanpa cetak yang andal hanya memindahkan masalah.

---

## 1A. Hasil Validasi Temuan & Referensi

Validasi ulang dilakukan pada 2026-11-18 terhadap kode aktual, dokumentasi Next.js 16.4.5 yang terpasang di `node_modules/next/dist/docs`, dokumentasi MDN, dan dokumentasi PostgreSQL. Tujuannya bukan membenarkan audit lama, tetapi mencari klaim yang terlalu kuat, severity yang salah, atau penyebab yang belum terbukti.

**Catatan metodologi:** angka navigasi pada tabel validasi adalah **satu run per kondisi**, bukan p95. Angka itu dipakai untuk menguji klaim sebab-akibat dan menunjukkan variansi, bukan menggantikan benchmark P0.1. Baseline lama juga bukan p95.

**Status validasi:**

- **Terbukti** — ada bukti kode/pengukuran yang konsisten.
- **Sebagian** — fenomena ada, tetapi angka atau penyebabnya belum terisolasi.
- **Bersyarat** — severity bergantung pada keputusan operasional.
- **Belum terbukti** — kandidat optimasi, bukan defect yang terbukti.

| ID | Status | Bukti validasi | Koreksi terhadap plan |
|---|---|---|---|
| C1 | **Terbukti** | `checkout-success-modal.tsx` memanggil `sendEscPosToPrinter()` langsung; `printInFlight` hanya per modal; tidak ada tabel job di `src`; desktop justru punya `print_jobs` | Severity **High**, bukan Critical murni. Critical hanya jika web adalah satu-satunya jalur struk dan tidak ada fallback manual |
| C2 | **Terbukti** | Offline hanya `enqueueOfflineSale()`; nota `/app/pos/nota/[id]` server-rendered; service worker hanya meng-cache `/app/pos` + aset statis | **Critical bersyarat**. Jika offline resmi hanya desktop, turun ke High/Medium dan wajib didokumentasikan sebagai batasan |
| H1 | **Sebagian** | Validasi ulang: drawer pointer 198 ms (request start 185 ms), keyboard 820 ms (request start 18 ms), tanpa animasi 377 ms (request start 50 ms), palette 800 ms (request start 4 ms) | Jangan klaim “drawer 200 ms” sebagai satu-satunya penyebab. Request-start dan commit klien adalah dua masalah terpisah; tambah P2.8 |
| H2 | **Terbukti** | `nota/[id]/page.tsx` hanya `requirePermissionPage("pos.sell")`; `sale-row-actions.tsx` memakai `<a>` biasa; tidak ada `writeAudit` pada cetak/reprint | High tetap. Perlu izin khusus + audit, bukan sekadar UI hide |
| H3 | **Terbukti** | Tidak ada `x_report`; Z report hanya di `/app/pos/sesi/riwayat/[id]/cetak`; close sesi hanya `router.refresh()` | Severity turun ke **Medium**: ini kontrol manajemen, bukan penghenti operasi. Z report sudah ada, hanya tidak otomatis |
| H4 | **Sebagian** | Ada `audit_log`, `src/lib/log.ts`, dan `/api/health`; tidak ada APM/trace/alert/error tracking | High tetap, tetapi plan harus mengakui logging/audit sudah ada. Gap-nya adalah korelasi, metrik, dan alert |
| H5 | **Terbukti** | `lockSaleSession()` memakai `FOR UPDATE`; pool `max: 12`; bench 20 konkuren p95 857 ms | **High bersyarat**. Untuk sesi kasir terpisah belum diuji; jangan generalisasi ke semua 20 kasir |
| H6 | **Terbukti** | Web hanya satu preferensi printer; desktop hanya satu `printer.json`; kitchen display bukan tiket dapur | **High untuk F&B, Medium untuk minimarket**. Bukan blocker minimarket |
| M1 | **Terbukti** | DB `bisa-pos-offline`, store `sales`, keyPath `clientKey`; tidak ada company/user/terminal | Severity Medium tetap. Klaim “tidak terenkripsi” harus dibaca sebagai tidak ada enkripsi aplikasi; OS/disk encryption tetap mungkin |
| M2 | **Terbukti** | `holdSale()` tidak punya TTL; daftar hold hanya membaca `createdAt` | Medium tetap. Tidak ada risiko stok karena hold tidak mereservasi stok |
| M3 | **Terbukti** | Hanya ada `src/app/app/pos/loading.tsx` berbentuk terminal; dokumentasi Next.js menyatakan `loading.js` membungkus page, bukan layout | Medium tetap. Perbaikan harus mencakup layout runtime, bukan hanya file skeleton |
| M4 | **Terbukti** | Validasi ulang: HTML **267.967 byte**, **22 prefetch RSC** untuk 25 baris | Medium tetap. Ini risiko performa/skala, bukan correctness |
| M5 | **Terbukti** | Tidak ada split bill per item/tamu; yang ada hanya mixed payment | Medium, tetapi **business-dependent**. Jangan dikerjakan tanpa keputusan produk |
| M6 | **Terbukti** | Promosi/loyalty/kitchen hanya di `pos-desktop`; web tidak mengimpor UI tersebut | Medium tetap. Ini utang arsitektur, bukan bug |
| M7 | **Terbukti** | Web menyimpan preferensi printer di `localStorage`; default `type: "none"`; tidak ada policy server | Medium tetap. Untuk web, koneksi fisik tetap butuh secure context + user gesture |
| M8 | **Sebagian** | Login 1.011 ms dan initial POS 513 ms adalah sampel tunggal/one run, bukan p95 | Medium tetap, tetapi baseline wajib diubah menjadi p50/p95 lewat P0.1 |
| L1 | **Terbukti** | `ModuleShell` memanggil `computeNavBadges()` dan `cookies()` setiap render layout | Low tetap. Dampaknya belum diukur; jangan jadikan prioritas sebelum H1 |
| L2 | **Terbukti** | `pos-action-menu.tsx` tidak memakai `prefetch={true}`; dokumentasi Next.js: dynamic route hanya prefetch sampai `loading.js`, client cache dynamic default 0 detik | Low tetap. Ini bagian dari H1, bukan temuan terpisah yang besar |
| L3 | **Belum terbukti** | Schema `sales` tidak punya `(company_id, session_id)`, tetapi ada index `(company_id, status)` dan `(company_id, date)` | Low tetap. Jangan sebut “missing index” sebagai defect; sebut kandidat optimasi setelah `EXPLAIN` |

### Koreksi penting terhadap plan lama

1. **Navigasi bukan satu penyebab.** Validasi menunjukkan request RSC bisa mulai 4 ms (palette) tetapi total tetap ~800 ms. Sebaliknya, request bisa mulai 185 ms tetapi total ~198 ms karena data sudah ter-prefetch. Jadi:
   - memperbaiki drawer/request-start saja **tidak cukup**;
   - memperbaiki prefetch saja **tidak cukup**;
   - perlu task terpisah untuk mengisolasi biaya commit/render klien (P2.8).
2. **`loading.js` tidak menutupi data runtime di layout.** Dokumentasi Next.js menyatakan jika layout mengakses `cookies()`, `headers()`, atau data runtime, fallback `loading.js` tidak tampil untuk layout dan navigasi menunggu layout selesai. `ModuleShell` memakai `cookies()` dan query badge; ini kandidat penyebab penting.
3. **`afterprint` bukan bukti kertas tercetak.** MDN: event ini terjadi setelah dokumen mulai dicetak **atau** print preview ditutup. Untuk job status, gunakan `sent`/`dialog-closed`, bukan `printed`, kecuali ada konfirmasi operator atau ack perangkat.
4. **Baseline belum p95.** Angka login/initial POS/navigasi lama adalah sampel, bukan distribusi. P0.1 harus mengukur 10–20 runs dan menyimpan p50/p95.
5. **`staleTimes` adalah fitur experimental dan global.** Dokumentasi Next.js: default `dynamic: 0`, `static: 5 menit`; konfigurasi ini tidak per-route. Jangan aktifkan global tanpa invalidasi setelah void/retur/sync.
6. **`prefetch={true}` menambah beban.** Dokumentasi Next.js: `true` mem-prefetch seluruh route untuk static dan dynamic. Batasi ke 6 link POS dan ukur RSC/DB load; jangan pasang di semua link aplikasi.
7. **Web printer tidak bisa diatur sepenuhnya dari server.** Web Bluetooth/USB/Serial membutuhkan secure context; Web Bluetooth juga membutuhkan transient activation untuk memilih device baru. Policy server hanya bisa menyimpan default/preferensi, bukan membuka koneksi tanpa izin pengguna.
8. **“Tidak terenkripsi” perlu nuansa.** IndexedDB tidak memiliki enkripsi aplikasi; data masih bisa dilindungi enkripsi disk/OS. Jangan menjual enkripsi Web Crypto sebagai jaminan keamanan.
9. **X report bukan High murni.** Ringkasan sesi sudah ada di layar; yang hilang adalah snapshot cetak tengah shift. Severity Medium lebih jujur, kecuali ada kebutuhan audit eksternal.

### Referensi validasi

- Next.js 16.4.5, `Link` prefetch: `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` — `"auto"` pada dynamic route hanya sampai `loading.js`; `true` = full route.
- Next.js 16.4.5, `staleTimes`: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md` — experimental; `dynamic` default 0; `static` default 5 menit; `router.prefetch` memakai static TTL.
- Next.js 16.4.5, `loading.js`: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` — fallback tidak menutupi runtime data di layout; navigasi menunggu layout.
- Next.js 16.4.5, prefetching guide: `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` — dynamic route tanpa `loading.js` dilewati; dengan `loading.js` hanya layout sampai boundary; server roundtrip saat klik.
- MDN, `Window: afterprint` event: https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event — event terjadi setelah print dimulai atau preview ditutup, bukan konfirmasi kertas keluar.
- MDN, IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB — transaksi dan durability.
- MDN, Web Bluetooth: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API — secure context + transient activation.
- MDN, WebUSB: https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API — secure context.
- MDN, Web Serial: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API — secure context, limited availability.
- PostgreSQL, `SELECT ... FOR UPDATE`: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE — row lock sampai transaksi selesai.

---

## 2. Peta Temuan → Workstream

| ID | Temuan | Severity | Workstream | Task utama |
|---|---|---|---|---|
| C1 | Web print tanpa queue/retry/backpressure | High (Critical jika tanpa fallback struk) | Printing | P1.1–P1.3, P1.6 |
| C2 | Offline web tidak bisa cetak struk | Critical bersyarat | Printing/Offline | P1.4, P1.5 |
| H1 | Navigasi menu 300–900 ms | High | Navigasi | P2.1–P2.4, P2.8 |
| H2 | Reprint tanpa audit/batas peran | High | Kontrol kas | P3.1 |
| H3 | X report tidak ada; Z tidak otomatis | Medium | Kontrol kas | P3.2 |
| H4 | Tidak ada observability/alert | High | Reliability | P4.1–P4.2 |
| H5 | Konkurensi sesi sama p95 857 ms; pool 12 | High (shared login) | Reliability | P4.3 |
| H6 | Tidak ada multi-printer/kitchen/label | Medium (High untuk F&B) | Jangka panjang | P5.2 |
| M1 | Queue offline global, tanpa expiry/enkripsi | Medium | Reliability/Offline | P4.4 |
| M2 | Hold tanpa expiry | Medium | Kontrol kas | P3.3 |
| M3 | Skeleton terminal untuk semua subhalaman | Medium | Navigasi | P2.4 |
| M4 | Riwayat 268 KB + prefetch per baris | Medium | Navigasi/Performa | P2.5 |
| M5 | Split bill tidak ada | Medium | Jangka panjang | P5.3 |
| M6 | Web/desktop feature drift | Medium | Jangka panjang | P5.1, P5.4 |
| M7 | Printer config device-local, default none | Medium | Printing/Reliability | P4.5 |
| M8 | Login 1.011 ms; add-to-total 326–432 ms | Medium | Navigasi/Performa | P2.6 |
| L1 | `computeNavBadges` query tiap layout render | Low | Performa | P2.7 |
| L2 | Prefetch race / tidak ada `prefetch={true}` | Low | Navigasi | P2.1 |
| L3 | Tidak ada index `(company_id, session_id)` | Low | Reliability/DB | P4.3 |

---

## 3. Milestone & Urutan Eksekusi

| Milestone | Isi | Kriteria lulus | Target |
|---|---|---|---|
| **M0 — Baseline** | Harness benchmark, fixture, guardrail | Angka baseline tersimpan; test POS existing lulus | Hari 1–2 |
| **M1 — Safe to operate offline** | Print queue web, serialisasi ESC/POS, struk offline, audit cetak | 50 cetak berurutan tanpa interleave; offline sale menghasilkan struk; retry bekerja | Minggu 1–2 |
| **M2 — Fast enough** | Prefetch, drawer, skeleton, riwayat, login | Navigasi p95 <150 ms; first visit <250 ms; back <100 ms | Minggu 3 |
| **M3 — Controlled** | Reprint audit, X report, Z prompt, hold expiry | Kasir tidak bisa reprint tanpa izin; X report akurat; Z muncul setelah tutup | Minggu 4 |
| **M4 — Observable & scalable** | APM, alert, pool, load test, queue scoping | Dashboard hidup; 20 checkout p95 <300 ms; alert print/sync aktif | Minggu 5–6 |
| **M5 — 2026 parity** | Multi-printer, split bill, parity, HA | Keputusan produk dieksekusi; soak 8–12 jam lulus | Bulan 2–3 |

**Aturan urutan:**

- Fase 2 tidak boleh mengubah `createSale()` atau transaksi inti.
- Fase 3 menyentuh permission/audit; harus lewat test integrasi.
- Fase 4 menyentuh infrastructure; harus ada rollback plan.
- Fase 5 menyentuh model penjualan/pembayaran; harus ada test akuntansi dan migrasi.

---

## 4. Fase 0 — Baseline & Guardrail

**Tujuan:** memastikan perbaikan bisa diukur, bukan dirasakan.

### P0.1 — Buat harness benchmark POS yang reproducible

**Temuan:** semua angka audit saat ini tersebar di `/tmp`, tidak bisa dijalankan ulang oleh tim.

**Perubahan:**

- Tambah `scripts/audit/pos-bench.mjs` (Playwright) yang:
  - Login, buka POS, ukur initial load.
  - Ukur 6 route menu: click → heading visible, 3 ronde.
  - Ukur command palette (cold/warm).
  - Ukur search, add item → line visible, add → total ready, checkout.
  - Ukur print pertama dan 3 reprint (mock `window.print`).
  - Ukur heap/DOM setelah 20 siklus.
  - Simpan JSON ke `docs/reports/evidence/pos-bench-<tanggal>.json`.
- Tambah `scripts/audit/pos-print-soak.mjs` untuk 50–500 cetak (mock printer).
- Tambah `docs/reports/POS-REMEDIATION-BASELINE.md` berisi angka baseline dan environment.
- Setiap metrik dijalankan **10–20 kali** (cold dan warm) dan dilaporkan sebagai p50/p95, bukan satu sampel.

**Acceptance:**

- Script bisa dijalankan dengan `node scripts/audit/pos-bench.mjs`.
- Output JSON memuat `navigation`, `search`, `checkout`, `print`, `memory`, beserta `p50`/`p95`.
- Baseline lama dicatat sebagai **sampel tunggal**, bukan p95: navigasi 381–887 ms, print 1.115–1.278 ms sampai `window.print()` dipanggil, checkout 245 ms.
- Print diukur sampai `window.print()`/transport ack, dengan label eksplisit “bukan konfirmasi kertas keluar”.
- Environment dicatat: build produksi lokal, PostgreSQL lokal, Chromium, viewport, dan status prefetch.

**Verifikasi:** jalankan script di build produksi lokal; bandingkan p50/p95 dengan angka audit. Jangan memakai angka dev server untuk klaim produksi.

**Estimasi:** 1–2 hari. **Depends:** tidak ada.

### P0.2 — Guardrail test & CI

**Perubahan:**

- Pastikan `pnpm typecheck`, `pnpm lint`, `pnpm vitest run tests/unit/pos-*.test.ts` menjadi gate PR.
- Tambah test baru minimal untuk:
  - Print queue (unit, fake IndexedDB).
  - Serialisasi ESC/POS (mock transport).
  - Reprint permission (integration).
  - X report totals (integration).
- Jangan jalankan E2E penuh di setiap PR jika lambat; jalankan POS E2E di nightly.

**Acceptance:** PR POS tidak bisa merge jika typecheck/lint/unit POS gagal.

**Estimasi:** 1 hari. **Depends:** P0.1.

### P0.3 — Fixture printer & offline test

**Perubahan:**

- Siapkan simulator printer ESC/POS TCP (bisa memakai `socat`/Node TCP server) untuk menguji antrean tanpa hardware.
- Siapkan checklist hardware: 58 mm dan 80 mm, USB/Bluetooth/LAN, paper-out, paper jam, auto-cut, cash drawer.
- Siapkan skenario offline Playwright: `context.setOffline(true)`, restart browser, queue survive.

**Acceptance:** simulator menerima byte dan bisa menghitung jumlah struk; checklist hardware disetujui.

**Estimasi:** 1 hari. **Depends:** tidak ada.

---

## 5. Fase 1 — Printing & Offline Receipt

**Tujuan:** tidak ada lagi penjualan yang tidak bisa dicetak; tidak ada cetak berulang yang saling menimpa.

### P1.1 — Model print job web (IndexedDB)

**Temuan:** C1.

**Perubahan:**

- Buat modul `src/lib/pos/print-queue.ts`:
  - Store `print_jobs`, key `id`.
  - Index `status`, `createdAt`, `saleId`.
  - Field: `id`, `saleId`, `companyId`, `terminalId`, `copyIndex`, `kind` (`receipt`/`copy`), `payload` (ESC/POS bytes atau receipt JSON), `status`, `attempts`, `lastError`, `createdAt`, `sentAt`.
  - Status: `pending` → `printing` → `sent` (transport menerima byte / dialog print ditutup) → `failed`; tambah `uncertain` bila hasil fisik tidak bisa dipastikan.
- API:
  - `enqueuePrintJob()`
  - `listPrintJobs()`
  - `claimNextPrintJob()` (single worker)
  - `markSent()`, `markFailed()`, `markUncertain()`, `retryPrintJob()`
  - `subscribePrintQueue()`
- Idempotensi: `(saleId, copyIndex)` unik; enqueue ganda tidak membuat job ganda.
- Crash recovery: job `printing` yang lebih tua dari 2 menit dikembalikan ke `pending` saat startup; job `sent` tidak dianggap “kertas keluar”.
- Gunakan `navigator.locks` jika tersedia; fallback ke mutex modul.

**Acceptance:**

- Enqueue 3 job saat dua tab terbuka tidak menghasilkan duplikat.
- Job `printing` yang macet kembali `pending` setelah reload.
- Tidak ada job hilang saat IndexedDB penuh; error ditampilkan.

**Test:** unit `tests/unit/pos-print-queue.test.ts`; fake IndexedDB.

**Estimasi:** 3 hari. **Depends:** P0.3.

### P1.2 — Integrasi print queue ke checkout

**Temuan:** C1.

**Perubahan:**

- `checkout-success-modal.tsx` tidak memanggil `sendEscPosToPrinter()` langsung; ia `enqueuePrintJob()`.
- Auto-print tetap berjalan untuk printer direct, tetapi melalui queue.
- UI status: `Menunggu antrean`, `Mengirim…`, `Terkirim ke printer/dialog`, `Perlu konfirmasi`, `Gagal — Coba lagi`.
- Tambah badge antrean di header POS: jumlah pending/failed.
- Reprint dari dialog sukses menambah `copyIndex`, bukan mengulang job yang sama.

**Acceptance:**

- Checkout 5 transaksi cepat menghasilkan 5 job berurutan, tidak ada byte interleave.
- Jika printer mati, job `failed` dan tombol retry muncul; tidak ada toast hilang.
- Jika popup diblokir, job tetap `failed` dengan pesan yang bisa ditindaklanjuti.

**Test:** E2E dengan mock `window.print`; unit queue.

**Estimasi:** 2 hari. **Depends:** P1.1.

### P1.3 — Serialisasi akses printer

**Temuan:** C1.

**Perubahan:**

- Tambah mutex global di `src/lib/escpos/printer-connection.ts`.
- `sendEscPosToPrinter()` mengakuisisi lock, menulis semua chunk, release di `finally`.
- Tidak ada dua job yang boleh menulis bersamaan, termasuk Bluetooth/USB/Serial.
- Timeout per job (mis. 15 detik) dan error yang jelas.

**Acceptance:**

- Dua panggilan `sendEscPosToPrinter()` bersamaan menghasilkan urutan byte A lalu B, tidak berselang-seling.
- Jika satu job menggantung, job berikutnya menunggu maksimal timeout lalu gagal dengan pesan.

**Test:** unit dengan mock transport yang mencatat urutan byte.

**Estimasi:** 1 hari. **Depends:** P1.1.

### P1.4 — Struk offline dari payload antrean

**Temuan:** C2.

**Perubahan:**

- Simpan `receipt_profile` di IndexedDB/localStorage saat online: nama perusahaan, alamat, telepon, logo (data URL), footer, paper width, pajak, header.
- Buat `renderOfflineReceiptHtml(payload, profile)` dan/atau `formatReceiptToEscPos(payload, profile)`.
- Payload offline harus membawa snapshot yang cukup: item, qty, harga, diskon, pajak, total, pembayaran, kembalian, kasir, waktu, nomor nota lokal.
- Alur offline:
  - Enqueue sale.
  - Enqueue print job `kind: "offline-receipt"`.
  - Jika printer direct terhubung: cetak langsung.
  - Jika tidak: tampilkan status “Struk tersimpan, siap dicetak saat printer tersedia” + tombol cetak.
- Untuk mode kiosk/browser: buka blob URL HTML lokal, bukan route server.
- Jangan mengklaim kertas “tercetak”. `afterprint` hanya berarti dialog/preview selesai; ack transport hanya berarti byte terkirim. Gunakan status `sent` atau `uncertain`, dan minta konfirmasi operator untuk job yang tidak punya sensor kertas.

**Acceptance:**

- Offline sale menghasilkan struk dengan total dan item yang sama dengan layar.
- Tidak ada request jaringan saat mencetak struk offline.
- Jika printer tidak ada, struk bisa dicetak nanti tanpa kehilangan data.
- Nomor nota offline diberi penanda yang jelas dan tidak bertabrakan dengan nomor server.

**Test:** unit renderer (snapshot HTML/ESC/POS); E2E `context.setOffline(true)`.

**Estimasi:** 4 hari. **Depends:** P1.1, P0.3.

### P1.5 — Audit cetak & reprint

**Temuan:** C1, H2.

**Perubahan:**

- Tambah server action `recordPrintEvent()`:
  - `saleId`, `kind` (`first`/`reprint`/`offline-sync`), `status`, `deviceId`, `copyIndex`.
  - Tulis ke `audit_log` action `pos.receipt.print`.
- Reprint dari halaman riwayat wajib memanggil action ini sebelum membuka nota.
- Jika offline, event disimpan di queue dan dikirim saat sync.
- Jangan mencatat isi struk; cukup metadata.

**Acceptance:**

- Setiap reprint menghasilkan satu baris audit.
- Audit memuat siapa, kapan, nota apa, copy ke berapa.
- Tidak ada reprint tanpa audit, termasuk dari command palette.

**Test:** integration `tests/integration/pos-print-audit.test.ts`.

**Estimasi:** 2 hari. **Depends:** P1.2. Bagian reprint audit diselesaikan bersama P3.1; audit cetak pertama dan offline sync selesai di task ini.

### P1.6 — Print queue observability

**Temuan:** C1, H4.

**Perubahan:**

- Event log: `print.enqueue`, `print.start`, `print.success`, `print.fail`, `print.retry`.
- Metrik: queue depth, oldest pending age, failure rate per printer type.
- Tampilkan di halaman terminal admin atau badge POS.

**Acceptance:**

- Kegagalan printer terlihat di dashboard/log, bukan hanya toast.
- Ada alert jika oldest pending >2 menit, atau queue depth >10 selama 5 menit (hindari alert palsu saat rush).

**Estimasi:** 2 hari. **Depends:** P1.2 untuk event log dasar; integrasi APM penuh di P4.1.

---

## 6. Fase 2 — Navigasi & Persepsi Cepat

**Tujuan:** p95 navigasi <150 ms, first visit <250 ms, back <100 ms.

### P2.1 — Perbaiki prefetch & drawer

**Temuan:** H1, L2.

**Perubahan:**

- Tambah `prefetch={true}` pada semua `Link` di `pos-action-menu.tsx`; dokumentasi Next.js menyatakan `true` mem-prefetch full route untuk dynamic route, berbeda dari default `auto` yang hanya sampai `loading.js`.
- Prefetch saat `onPointerEnter` dan `onFocus`, bukan hanya saat drawer dibuka.
- Mulai navigasi saat `onPointerDown` (klik kiri) atau sebelum animasi keluar; jangan menunggu Sheet close.
- Jika memakai `router.push`, panggil sebelum `setOpen(false)`.
- Pastikan klik tengah/ctrl tetap membuka tab baru.
- Ukur ulang dengan P0.1. Catat dua metrik terpisah: **request start** dan **click → heading**.
- Jangan memasang `prefetch={true}` di semua link aplikasi; batasi ke 6 link POS dan ukur beban RSC/DB.

**Acceptance:**

- Request RSC mulai <50 ms setelah klik.
- Navigasi menu p95 <250 ms pada iterasi pertama; target akhir <150 ms.
- Back ke POS <100 ms.
- Tidak ada regresi aksesibilitas keyboard.
- **Catatan validasi:** pada uji 2026-11-18, request start bisa 4 ms tetapi total tetap ~800 ms; request start <50 ms adalah syarat perlu, bukan bukti p95 <150 ms. P2.8 wajib dijalankan bila target total belum tercapai.

**Test:** Playwright nav benchmark; manual keyboard.

**Estimasi:** 2 hari. **Depends:** P0.1.

### P2.2 — Navigasi persisten (rail/tab)

**Temuan:** H1, UX attention economy.

**Perubahan:**

- Tambah rail/tab persisten di desktop untuk 4 tujuan tersering: Riwayat, Ditahan, Sesi, Piutang.
- Drawer tetap ada untuk tujuan sekunder dan mobile.
- Jangan mengubah route; hanya shell navigasi.
- A/B bandingkan drawer vs rail dengan 3 kasir.

**Acceptance:**

- Kasir bisa pindah tujuan utama tanpa membuka drawer.
- p95 <150 ms untuk tujuan di rail.
- Tidak ada layout shift; target sentuh ≥44 px.

**Estimasi:** 3 hari. **Depends:** P2.1.

### P2.3 — Route cache terkontrol

**Temuan:** H1.

**Perubahan:**

- Evaluasi `staleTimes.dynamic` 15–30 detik untuk route non-terminal. Dokumentasi Next.js: fitur ini **experimental**, default `dynamic: 0`, `static: 5 menit`, dan bersifat global — bukan per-route.
- `router.prefetch` memakai TTL `static`, sedangkan `Link` dynamic tanpa full prefetch memakai `dynamic`; jangan mencampur asumsi keduanya.
- Jangan aktifkan untuk `/app/pos` terminal (harga/stok harus segar).
- Setelah void/retur/sinkron, panggil `router.refresh()`/`revalidatePath()` agar cache tidak menampilkan data basi.
- Jika global staleTimes terlalu berisiko, buat cache client-side khusus untuk riwayat/sesi dengan invalidasi eksplisit.

**Acceptance:**

- Navigasi kedua ke Riwayat/Sesi <100 ms.
- Data setelah void/retur tetap benar.
- Tidak ada staleness >30 detik untuk laporan.

**Estimasi:** 2 hari. **Depends:** P2.1.

### P2.4 — Skeleton per route

**Temuan:** M3.

**Perubahan:**

- Hapus ketergantungan pada `src/app/app/pos/loading.tsx` terminal untuk semua subroute.
- Dokumentasi Next.js: `loading.js` **tidak** menutupi data runtime di layout (`cookies()`, `headers()`, query); navigasi menunggu layout selesai. `ModuleShell` memakai `cookies()` dan `computeNavBadges()`, jadi P2.4 harus dikerjakan bersama P2.8.
- Tambah `loading.tsx`:
  - `riwayat/loading.tsx` — header + filter + tabel.
  - `sesi/loading.tsx` — kartu sesi + ringkasan.
  - `sesi/riwayat/loading.tsx` — tabel riwayat.
  - `piutang/loading.tsx` — kartu saldo.
  - `ditahan/loading.tsx` — daftar hold.
  - `offline/loading.tsx` — daftar review.
- Gunakan `aria-busy` dan ukuran yang mirip konten final.

**Acceptance:**

- Tidak ada grid produk muncul saat membuka Riwayat/Sesi.
- CLS <0,1 pada navigasi.
- Skeleton hilang saat konten siap.

**Estimasi:** 2 hari. **Depends:** tidak ada.

### P2.5 — Riwayat: kurangi prefetch & payload

**Temuan:** M4.

**Perubahan:**

- `Link` baris nota: `prefetch={false}` atau prefetch hanya saat hover/focus.
- Kurangi page size dari 25 ke 20, atau gunakan cursor pagination.
- Pertimbangkan virtualisasi tabel jika >50 baris.
- Ukur jumlah request dan HTML size sebelum/sesudah.

**Acceptance:**

- Request prefetch per halaman turun dari 17+ menjadi 0 saat idle.
- HTML Riwayat turun minimal 30%.
- Tidak ada regresi waktu buka detail.

**Estimasi:** 2 hari. **Depends:** P0.1.

### P2.6 — Login & initial POS

**Temuan:** M8.

**Perubahan:**

- Instrumentasi login: auth query, password verify, session cookie, redirect.
- Kurangi query berurutan di `pos/page.tsx`; kelompokkan yang independen atau pindahkan ke query tunggal.
- Target login <600 ms; initial POS <350 ms.
- Jangan mengorbankan pengecekan sesi/izin.

**Acceptance:**

- Login p95 <600 ms di lokal.
- Initial POS p95 <350 ms.
- Tidak ada query duplikat di log.

**Estimasi:** 3 hari. **Depends:** P0.1 untuk baseline; instrumentasi penuh menyusul di P4.1.

### P2.7 — Cache nav badge

**Temuan:** L1.

**Perubahan:**

- `computeNavBadges` saat ini memanggil `countHeldSales` + `listOfflineReviewQueue` setiap layout render.
- Pindahkan badge ke komponen client dengan fetch 15–30 detik, atau cache server-side per company dengan invalidasi.
- Jangan memblokir render shell jika badge gagal.

**Acceptance:**

- Layout tidak melakukan query badge pada setiap navigasi.
- Badge tetap akurat dalam 30 detik.
- Shell tetap tampil jika query badge error.

**Estimasi:** 1 hari. **Depends:** P2.1.

### P2.8 — Isolasi biaya commit klien & layout runtime

**Temuan:** H1.

**Latar validasi:** request RSC bisa mulai 4 ms tetapi click → heading tetap ~800 ms. Sebaliknya, request bisa mulai 185 ms tetapi total ~198 ms karena data sudah ter-prefetch. Artinya ada biaya commit/render/hydration yang belum terisolasi. Dokumentasi Next.js juga menyatakan `loading.js` tidak menutupi runtime data di layout, dan `ModuleShell` memakai `cookies()` + `computeNavBadges()`.

**Perubahan:**

- Tambah performance marks:
  - `click`
  - `request-start`
  - `rsc-done`
  - `skeleton-visible`
  - `content-committed`
  - `heading-visible`
- Profil React untuk route Riwayat/Sesi/Piutang: cari commit yang >50 ms.
- Pisahkan shell statis dari data runtime:
  - Auth tetap berjalan untuk keamanan.
  - Badge, company switcher, dan user menu yang tidak kritis dibungkus `<Suspense>` atau diambil client-side setelah shell tampil.
  - Jangan memblokir page fallback oleh query badge.
- Uji varian secara terpisah:
  1. prefetch penuh;
  2. navigasi pointerdown;
  3. layout tanpa badge query;
  4. route cache/staleTimes;
  5. skeleton per route.
- Jika total p95 tetap >150 ms setelah semua varian, ajukan keputusan arsitektur: POS shell dengan tab client-side yang mempertahankan state, bukan navigasi route penuh.

**Acceptance:**

- Ada breakdown waktu click → request → RSC → commit → paint.
- Diketahui komponen/query mana yang menyumbang >100 ms.
- Total navigasi p95 <150 ms, atau ada rekomendasi arsitektur yang disetujui.
- Auth/tenant isolation tidak melemah.

**Test:** Playwright performance marks + React Profiler; benchmark P0.1.

**Estimasi:** 3 hari. **Depends:** P2.1, P2.4.

---

## 7. Fase 3 — Kontrol Kas & Fitur yang Hilang

### P3.1 — Reprint permission & audit

**Temuan:** H2.

**Perubahan:**

- Tambah permission `pos.receipt.reprint` di `src/lib/permissions.ts`, `MODULE_PERMISSIONS.pos`, editor peran, dan preset manager/supervisor.
- Default: owner/supervisor; kasir biasa tidak.
- `/app/pos/nota/[id]?salinan=1` menolak jika tidak punya izin.
- Tombol “Cetak ulang” di Riwayat hanya muncul untuk yang berizin.
- Setiap reprint menulis audit `pos.receipt.reprint` dengan `saleId`, `copyIndex`, `deviceId`.
- Tetap izinkan cetak pertama dari checkout dengan `pos.sell`.

**Acceptance:**

- Kasir tanpa izin mendapat 403/hidden saat reprint.
- Supervisor bisa reprint; audit tercatat.
- Cetak pertama setelah checkout tidak terblokir.

**Test:** integration permission + audit.

**Estimasi:** 2 hari. **Depends:** P1.5.

### P3.2 — X report & Z prompt

**Temuan:** H3.

**Perubahan:**

- Tambah halaman `/app/pos/sesi/x-report` (atau `/cetak-x`) dengan print shell; akses `pos.session`.
- Isi X report:
  - Identitas sesi, kasir, cabang, waktu buka.
  - Modal awal.
  - Penjualan tunai/non-tunai per metode.
  - Refund, setoran, penarikan.
  - Kas seharusnya.
  - Jumlah transaksi.
  - Waktu cetak.
  - Tidak ada “kas dihitung” (itu Z).
- Tombol “Cetak X” di halaman sesi terbuka.
- Setelah tutup sesi sukses, tampilkan dialog “Sesi ditutup. Cetak Z sekarang?” dengan link cetak Z; jangan auto-popup yang bisa diblokir.
- Tambah audit `pos.session.x_report` dan `pos.session.z_report`.

**Acceptance:**

- X report tidak menutup sesi.
- Total X report sama dengan ringkasan sesi.
- Z prompt muncul setelah close; bisa ditutup tanpa mencetak.
- Audit tercatat.

**Test:** integration totals; E2E print mock.

**Estimasi:** 3 hari. **Depends:** tidak ada.

### P3.3 — Hold expiry & reminder

**Temuan:** M2.

**Perubahan:**

- Tambah setting `pos_hold_ttl_hours` (default 24) di company settings: migrasi kolom + form Pengaturan + validasi 1–168 jam.
- Hitung `expiresAt = createdAt + ttl`; tidak perlu kolom baru di `sales`.
- Di daftar hold: badge “Kedaluwarsa”/“Sisa X jam”.
- Saat resume hold kedaluwarsa: peringatan, tetapi izinkan dengan konfirmasi; jangan hapus otomatis.
- Tambah aksi “Bersihkan hold lama” dengan izin `pos.void` dan audit.
- Jangan reserve stok untuk hold (sudah benar).

**Acceptance:**

- Hold >24 jam ditandai.
- Tidak ada penghapusan otomatis.
- Supervisor bisa membersihkan dengan audit.

**Estimasi:** 2 hari. **Depends:** tidak ada.

### P3.4 — Split bill (dipindah ke Fase 5)

**Temuan:** M5.

**Keputusan:** Apakah bisnis membutuhkan split bill per item/tamu? Jika ya, ini perubahan domain pembayaran dan jurnal; jangan dicampur dengan perbaikan printing/navigasi. Jadwalkan di P5.3.

### P3.5 — Web promotions/loyalty/kitchen parity (dipindah ke Fase 5)

**Temuan:** M6.

**Keputusan:** Web saat ini tidak memuat promosi/loyalty/kitchen yang ada di desktop. Porting ke web membutuhkan validasi server agar tidak bisa dimanipulasi client. Jadwalkan di P5.4; jangan kerjakan sebelum Fase 1–3 selesai.

---

## 8. Fase 4 — Observability, Concurrency, Offline Hardening

### P4.1 — APM, error tracking, event log

**Temuan:** H4.

**Perubahan:**

- Pilih transport: Sentry (SaaS/self-hosted GlitchTip) atau OpenTelemetry + collector.
- Instrumentasi server:
  - `checkout.duration`, `quote.duration`, `createSale.duration`.
  - `print.event`, `sync.event`, `offline.queue_age`.
  - Error dengan `companyId`, `userId`, `requestId`, `terminalId`.
- Instrumentasi client:
  - Error boundary reports.
  - `unhandledrejection`.
  - Print failure, popup blocked, printer disconnect.
- Jangan log PII/kartu/password; sanitasi seperti `src/lib/log.ts`.

**Acceptance:**

- Error produksi punya stack + tenant + terminal.
- Checkout latency dan print failure terlihat di dashboard.
- Tidak ada kebocoran data sensitif di log.

**Estimasi:** 4 hari. **Depends:** P0.2.

### P4.2 — SLO & alert

**Temuan:** H4.

**Perubahan:**

- Definisikan SLO:
  - Navigasi p95 <150 ms.
  - Checkout p95 <300 ms.
  - Print invocation p95 <800 ms (browser) / <500 ms (direct).
  - Offline sync <60 detik setelah online.
  - Error rate <0,1%.
  - Print failure <1%.
- Alert:
  - Checkout p95 >500 ms 10 menit.
  - Print failure >5% 15 menit.
  - Offline queue oldest >30 menit.
  - Sync conflict >0.
  - DB pool saturation >80%.
- Dashboard operasional per terminal.

**Acceptance:**

- Alert dikirim ke channel yang disepakati.
- Dashboard bisa difilter per company/terminal.
- Ada runbook singkat untuk print failure/offline conflict.

**Estimasi:** 3 hari. **Depends:** P4.1.

### P4.3 — DB concurrency & index

**Temuan:** H5, L3.

**Perubahan:**

- Naikkan pool dari 12 ke 20–30, sesuaikan `max_connections` PostgreSQL.
- Pertimbangkan PgBouncer untuk produksi.
- `EXPLAIN (ANALYZE, BUFFERS)` untuk:
  - `countSessionTransactions`
  - `getCashSessionSummary`
  - `listCashSessionHistory`
  - `listSales`
- Tambah index `(company_id, session_id)` pada `sales` jika terbukti seq scan.
- Tambah `lock_timeout`/`statement_timeout` untuk transaksi POS.
- Load test:
  - 10/20/50 checkout dengan sesi berbeda.
  - 20 checkout dengan sesi sama (skenario shared login).
  - 8 jam soak.

**Acceptance:**

- 20 checkout sesi berbeda p95 <300 ms.
- 20 checkout sesi sama p95 <500 ms atau ada rekomendasi tegas larang shared login.
- Tidak ada deadlock.
- Index baru tidak memperlambat checkout.

**Estimasi:** 5 hari. **Depends:** P4.1.

### P4.4 — Offline queue scoping & lifecycle

**Temuan:** M1.

**Perubahan:**

- Upgrade IndexedDB ke versi 2:
  - Key `id` = `${companyId}:${userId}:${terminalId}:${clientKey}`.
  - Index `companyId`, `userId`, `createdAt`, `status`.
  - Migrasi dari store lama; jangan hapus sebelum migrasi sukses.
- Hapus antrean saat logout (dengan konfirmasi jika masih ada item pending).
- Expiry 72 jam; item lebih lama masuk review, bukan dihapus diam-diam.
- Minimalisasi PII: jangan simpan nama pelanggan jika tidak perlu; cukup ID.
- Enkripsi best-effort dengan Web Crypto jika key tersedia; jangan klaim sebagai jaminan keamanan.
- Tampilkan umur antrean dan terminal asal.

**Acceptance:**

- Dua kasir di browser yang sama tidak melihat antrean satu sama lain.
- Logout tidak menghapus item pending tanpa konfirmasi.
- Item >72 jam ditandai, tidak hilang.
- Tidak ada kebocoran data antar perusahaan.

**Test:** unit migration; E2E multi-user.

**Estimasi:** 4 hari. **Depends:** P1.1 (pola storage).

### P4.5 — Printer policy & health

**Temuan:** M7.

**Perubahan:**

- Simpan profil printer default per company/cabang/terminal di server:
  - Nama, tipe, paper width, auto print, routing.
- Client memakai profil sebagai default; koneksi fisik tetap local.
- Batasan web yang harus dihormati: Web Bluetooth/USB/Serial membutuhkan **secure context**; Web Bluetooth juga membutuhkan **transient activation** untuk memilih device baru. Policy server tidak bisa membuka koneksi printer tanpa izin pengguna. Untuk desktop, `printer.json` tetap dapat dikelola sebagai profil perangkat.
- Heartbeat printer: `connected`, `lastSeen`, `lastError`, `queueDepth`.
- Halaman admin terminal menampilkan status printer.
- Jangan menyimpan kredensial printer di server.

**Acceptance:**

- Terminal baru mendapat default printer policy.
- Admin melihat printer offline sebelum kasir mencetak.
- Tidak ada kredensial di server.

**Estimasi:** 3 hari. **Depends:** P1.6, P4.1.

### P4.6 — Soak test 8–12 jam

**Temuan:** C1, C2, H5, M1.

**Perubahan:**

- Jalankan:
  - 8 jam navigasi + checkout + print (simulator).
  - 500 struk berurutan.
  - Putus/printer mati di tengah antrean.
  - Offline 30 menit lalu online.
- Ukur heap, DOM, queue depth, failure rate, p95.
- Simpan laporan di `docs/reports/POS-SOAK-<tanggal>.md`.

**Acceptance:**

- Heap stabil (<20% growth).
- Tidak ada job stuck >2 menit.
- Tidak ada duplicate sale/print.
- Semua struk bisa direkonsiliasi.

**Estimasi:** 3 hari. **Depends:** P1–P4.

---

## 9. Fase 5 — Parity & Arsitektur Jangka Panjang

### P5.1 — Satukan kontrak web/desktop

**Temuan:** M6.

**Perubahan:**

- Ekstrak kontrak bersama:
  - Offline sale payload.
  - Receipt renderer.
  - Print job status.
  - Conflict labels.
- Web dan desktop memakai kontrak yang sama; tidak perlu rewrite UI.
- Tambah contract test yang membandingkan payload web vs desktop.

**Acceptance:**

- Tidak ada duplikasi definisi payload.
- Perubahan kontrak memecahkan test di kedua client.
- Fitur baru tidak lagi diimplementasikan dua kali.

**Estimasi:** 8–10 hari.

### P5.2 — Multi-printer routing

**Temuan:** H6.

**Perubahan:**

- Model routing:
  - `customer_receipt` → printer kasir.
  - `kitchen_ticket` → printer dapur (berdasarkan kategori produk).
  - `label` → printer label.
- Queue terpisah per printer.
- Fallback jika printer offline.
- Web: satu printer customer; multi-printer via desktop agent/print service.
- Kitchen display tetap ada sebagai fallback.

**Acceptance:**

- Satu transaksi bisa menghasilkan customer receipt + kitchen ticket.
- Kegagalan satu printer tidak memblokir printer lain.
- Tidak ada tiket dapur tercetak di printer kasir.

**Estimasi:** 10–15 hari.

### P5.3 — Split bill

**Temuan:** M5.

**Perubahan:**

- Model split per item/tamu.
- Pembayaran parsial, struk per split, alokasi pajak/diskon.
- Jurnal dan retur harus tetap seimbang.
- Jangan mengubah `createSale()` tanpa test akuntansi.

**Acceptance:**

- Total split = total sale.
- Tidak ada pembayaran berlebih/hilang.
- Jurnal seimbang.
- Retur per split bekerja.

**Estimasi:** 15–20 hari.

### P5.4 — Promotions/loyalty/kitchen web parity

**Temuan:** M6.

**Perubahan:**

- Port promosi/loyalty dari desktop ke web.
- Validasi promosi di server, bukan hanya client.
- Kitchen display web atau desktop-only decision.
- Jangan menambah fitur jika printing/navigasi belum stabil.

**Estimasi:** 10–15 hari.

### P5.5 — HA, backup, multi-store

**Temuan:** arsitektur SPOF.

**Perubahan:**

- PostgreSQL streaming replica + PITR.
- Load balancer + health check.
- Backup terjadwal + restore drill.
- Tenant isolation review untuk multi-store.
- Zero-downtime deploy.

**Estimasi:** 10–15 hari.

---

## 10. Definition of Done Global

Setiap task dianggap selesai hanya jika:

- [ ] Ada test yang gagal sebelum implementasi (unit/integration/E2E) atau benchmark baseline.
- [ ] Implementasi minimal, tidak menambah abstraksi spekulatif.
- [ ] `pnpm typecheck` lulus.
- [ ] `pnpm lint` lulus (0 error baru).
- [ ] Test terkait lulus.
- [ ] `pnpm build` lulus.
- [ ] Tidak ada regresi pada checkout/stock/journal.
- [ ] Angka before/after dicatat di `docs/reports/`.
- [ ] Rollback plan ditulis untuk perubahan DB/infrastructure.
- [ ] Tidak ada data produksi yang tercemar.

---

## 11. Verification Matrix

| Perbaikan | Test/benchmark | Target |
|---|---|---|
| Print queue | 50 cetak berurutan, 2 tab | Tidak ada interleave/duplikat |
| Serialisasi ESC/POS | Mock transport concurrent | Urutan byte A→B |
| Offline receipt | Playwright offline | Struk tampil/cetak tanpa jaringan |
| Reprint audit | Integration | 1 audit per reprint |
| Navigasi | Playwright 6 route × 3 ronde | p95 <150 ms |
| Back ke POS | Playwright | <100 ms |
| Skeleton | Screenshot + CLS | Tidak ada grid produk di Riwayat |
| Riwayat prefetch | Resource timing | 0 prefetch idle per baris |
| Login | Playwright | p95 <600 ms |
| Initial POS | Playwright | p95 <350 ms |
| X report | Integration totals | Sama dengan summary |
| Hold expiry | Unit + UI | Badge muncul, tidak auto-delete |
| Concurrency | k6/Node 10/20/50 | p95 <300 ms sesi berbeda |
| Offline queue scoping | E2E 2 user | Tidak saling melihat |
| Soak | 8 jam | Heap stabil, tidak ada job stuck |
| Multi-printer | Simulator 2 printer | Customer + kitchen terpisah |

---

## 12. Risiko & Rollback

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Print queue menduplikasi struk setelah crash | Pelanggan bingung, kertas boros | Idempotensi `(saleId, copyIndex)`, status `sent` hanya setelah ack transport; `uncertain` untuk kondisi tanpa ack |
| Offline receipt salah harga | Sengketa | Gunakan snapshot payload; tandai “struk offline”; review saat sync |
| Prefetch berlebihan membebani server | RSC storm | Batasi 6 link; ukur; matikan jika p95 server naik |
| `staleTimes` menampilkan data basi | Laporan salah | Invalidasi setelah mutasi; hanya route non-terminal |
| Naikkan pool membebani PostgreSQL | Koneksi habis | Sesuaikan `max_connections`; PgBouncer; load test |
| Hold expiry menghapus pesanan aktif | Kehilangan pesanan | Soft warning, bukan auto-delete; izin supervisor |
| Reprint permission mengunci kasir | Operasional macet | Default supervisor; fallback owner; audit |
| Split bill merusak jurnal | Data keuangan salah | Test akuntansi; migrasi bertahap; feature flag |
| Multi-printer menambah kompleksitas | Queue macet | Satu queue per printer; fallback; health check |
| Unifikasi web/desktop | Regresi besar | Strangler: kontrak dulu, UI belakangan |

**Rollback:**

- Print queue: feature flag `pos_print_queue`; fallback ke direct print.
- Offline receipt: feature flag; fallback ke “struk dicetak saat online”.
- Navigasi: revert shell changes; route tidak berubah.
- DB pool/index: migration reversible; index drop aman.
- Observability: SDK bisa dimatikan via env.

---

## 13. Keputusan Awal (Keputusan Final Ada di §17.3)

1. **Offline resmi:** apakah web harus bisa cetak offline, atau offline penuh hanya desktop?  
   - Jika web: P1.4 wajib.  
   - Jika desktop-only: C2 diturunkan menjadi “dokumentasikan batasan”, bukan Critical.
2. **Multi-printer:** apakah dibutuhkan sekarang (F&B) atau bisa desktop-only?
3. **Split bill:** apakah model bisnis membutuhkan? Jika minimarket, bisa ditunda.
4. **Observability:** SaaS (Sentry) atau self-hosted (GlitchTip/OTel + Grafana)?
5. **Navigasi persisten:** boleh mengubah drawer menjadi rail/tab, atau harus tetap drawer?
6. **Printer hardware:** apakah tersedia printer 58/80 mm untuk uji paper-out/jam?
7. **Shared login:** apakah satu akun kasir boleh dipakai di beberapa terminal? Jika tidak, perlu penegakan sesi per terminal.

---

## 14. Sepuluh Task Pertama yang Akan Dikerjakan

Urutan ini yang saya sarankan untuk dimulai setelah plan disetujui:

1. **P0.1** — Harness benchmark POS.
2. **P0.3** — Simulator printer & checklist hardware.
3. **P1.1** — Print job store IndexedDB.
4. **P1.3** — Mutex ESC/POS.
5. **P1.2** — Integrasi queue ke checkout.
6. **P1.4** — Struk offline.
7. **P1.5** — Audit cetak.
8. **P2.1** — Prefetch & drawer.
9. **P2.4** — Skeleton per route.
10. **P3.1** — Reprint permission & audit.

Setelah 10 task ini, jalankan benchmark ulang. Jika print queue dan navigasi sudah lulus, lanjut P2.2/P2.3 dan P3.2.

---

## 15. Yang Tidak Boleh Dilakukan Dulu

- Jangan rewrite POS.
- Jangan memecah monolith menjadi microservices.
- Jangan menambah fitur besar (split bill, promo web, multi-printer) sebelum Fase 1–3 selesai.
- Jangan mengubah `createSale()` tanpa test integrasi dan rollback.
- Jangan mengejar navigasi <100 ms dengan mengorbankan kesegaran stok/harga terminal.
- Jangan menambah cache global untuk semua halaman; cache hanya route non-kritis.
- Jangan mengaktifkan `staleTimes` global tanpa invalidasi setelah void/retur/sync.
- Jangan menganggap `afterprint` atau ack transport sebagai bukti kertas keluar.
- Jangan menjanjikan koneksi printer web tanpa secure context + izin pengguna.

---

## 16. Referensi

### Dokumentasi framework & platform

- Next.js 16.4.5 — `Link` prefetch: `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`.
- Next.js 16.4.5 — `staleTimes`: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`.
- Next.js 16.4.5 — `loading.js`: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`.
- Next.js 16.4.5 — Prefetching guide: `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`.
- MDN — `Window: afterprint`: https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event.
- MDN — IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB.
- MDN — Web Bluetooth: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API.
- MDN — WebUSB: https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API.
- MDN — Web Serial: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API.
- PostgreSQL — `SELECT ... FOR UPDATE`: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE.

### Kode yang diaudit

- Navigasi: `src/components/pos/pos-action-menu.tsx`, `src/app/app/pos/layout.tsx`, `src/components/shell/module-shell.tsx`, `src/app/app/pos/loading.tsx`.
- Printing: `src/components/pos/terminal/checkout-success-modal.tsx`, `src/components/pos/receipt-print.tsx`, `src/components/pos/receipt-print-window.ts`, `src/lib/escpos/printer-connection.ts`.
- Offline: `src/lib/pos/pos-offline.ts`, `src/components/pos/use-offline-queue.ts`, `public/pos-sw.js`.
- Kontrol kas: `src/app/app/pos/nota/[id]/page.tsx`, `src/components/pos/sale-row-actions.tsx`, `src/app/app/pos/sesi/page.tsx`, `src/components/pos/session-manager.tsx`.
- Database: `src/db/index.ts`, `src/server/pos/sales-create.ts`, `src/server/pos/sales-persist.ts`, `src/db/schema/sales.ts`.
- Desktop: `src-tauri/src/posdb.rs`, `src-tauri/src/device.rs`, `pos-desktop/app/page.tsx`.

### Bukti pengukuran

- Audit awal: `docs/reports/evidence/pos-audit-prod-2026-11-18.json`, `docs/reports/evidence/pos-audit-print-2026-11-18.json`, `docs/reports/evidence/pos-bench-concurrent-2026-11-18.log`.
- Validasi navigasi 2026-11-18: `docs/reports/evidence/pos-nav-validation-2026-11-18.json`.
- Validasi Riwayat 2026-11-18: `docs/reports/evidence/pos-history-validation-2026-11-18.json` — 267.967 byte, 22 prefetch, 25 baris.
- Benchmark navigasi final: `docs/reports/evidence/pos-nav-bench-final-2026-11-18.json` — 18 sampel, p50 297 ms, p95 373 ms.
- Smoke final: `docs/reports/evidence/pos-smoke-final-2026-11-18.json`; checkout: `docs/reports/evidence/pos-checkout-smoke-2026-11-18.json`.
- Bukti sudah disalin dari `/tmp` ke `docs/reports/evidence/`.

---

## 17. Status Implementasi & Keputusan (2026-11-18)

### 17.1 Selesai

| Task | Implementasi | Bukti |
|---|---|---|
| P1.1 | Antrean cetak IndexedDB (`src/lib/pos/print-queue.ts`): idempoten `(saleId, copyIndex)`, status `pending/printing/sent/failed/uncertain`, retry, reset job macet, cleanup 24 jam | `tests/unit/pos-print-queue.test.ts` 7/7 |
| P1.2 | Checkout memakai antrean, bukan kirim langsung; modal memantau status job | `checkout-success-modal.tsx`; smoke checkout 249 ms tanpa error |
| P1.3 | Mutex writer printer diekstrak ke `src/lib/escpos/printer-write-lock.ts`; timeout 15 detik; tidak ada dua job menulis bersamaan | `printer-connection.ts`; targeted lint/typecheck |
| P1.4 | Struk offline direct ESC/POS dari snapshot keranjang/pembayaran; job `offline-receipt` disimpan dan dicetak saat printer tersedia | `use-terminal-checkout.ts`, `print-queue.ts`; formatter ESC/POS existing |
| P1.5 | Audit reprint `pos.receipt.reprint` saat halaman nota dibuka dengan `salinan=1`; metadata sale/autoprint | audit DB terverifikasi: `pos.receipt.reprint` |
| P2.1 | `prefetch={true}` pada link menu; drawer ditutup saat pointerdown; route prefetch idle | `pos-action-menu.tsx`; benchmark nav |
| P2.2 | Quick nav persisten di header keranjang: Riwayat, Sesi, Piutang | `cart-panel.tsx`; build/typecheck |
| P2.8 | Instrumentasi `nav.transition` (pointerdown → pathname) ke telemetry | `src/components/shell/nav-metrics.tsx`, `module-shell.tsx` |
| P2.4 | Skeleton per route: riwayat, sesi, sesi/riwayat, piutang, ditahan, offline | `src/app/app/pos/*/loading.tsx` |
| P2.5 | Riwayat: page size 20, `prefetch={false}` pada link baris | `riwayat/page.tsx` |
| P2.7 | Cache badge nav 15 detik per company/permission | `module-shell.tsx` |
| P3.1 | Permission `pos.receipt.reprint`; gate halaman salinan; tombol cetak disembunyikan tanpa izin; audit | `permissions.ts`, `nota/[id]/page.tsx`, `sale-row-actions.tsx`; test UI 13/13 |
| P3.2 | X report memakai halaman Z dengan `?x=1`; tombol “Cetak X”; prompt Z setelah tutup sesi; audit X/Z | `session-manager.tsx`, `sesi/riwayat/[id]/cetak/page.tsx`; smoke X lulus |
| P3.3 | Badge usia hold 24 jam di daftar ditahan; tidak ada auto-delete | `held-age.tsx`, `ditahan/page.tsx` |
| P4.1 | Telemetri POS: endpoint `/api/pos/telemetry`, event print sukses/gagal, error klien, durasi checkout di log server | `src/lib/pos/telemetry.ts`, `api/pos/telemetry/route.ts`, `actions/pos.ts` |
| P4.3 | Pool DB 12 → 24 | `src/db/index.ts` |
| P4.4 | Scope antrean offline per company/user/terminal + fallback item legacy per kasir | `pos-offline.ts`, `use-offline-queue.ts`; test scope 3/3 |
| P0.1 | Benchmark navigasi reusable | `scripts/audit/pos-nav-bench.mjs`; p50 297 ms / p95 373 ms |

### 17.2 Parsial / belum

| Task | Status | Alasan |
|---|---|---|
| P1.4 kiosk offline | Parsial | Direct ESC/POS sudah; mode kiosk offline belum membuat blob receipt. |
| P1.6 | Parsial | Event print sudah dicatat; dashboard/alert belum. |
| P2.1 target | Parsial | p95 373 ms, belum <150 ms. Bottleneck commit/layout belum sepenuhnya diisolasi. |
| P2.2 rail persisten | Parsial | Quick nav ikon di header keranjang sudah; rail/tab penuh belum diuji kasir. |
| P2.3 staleTimes | Belum | Fitur experimental/global; risiko data basi setelah void/retur. |
| P2.6 login/initial | Belum | Belum ada profiling/query refactor. |
| P2.8 commit/layout | Parsial | `nav.transition` sudah dicatat; React Profiler/breakdown commit→paint belum. |
| P3.3 setting TTL | Parsial | Badge 24 jam hardcoded; setting perusahaan dan bulk cleanup belum. |
| P4.2 SLO/alert | Belum | Butuh infrastruktur monitoring. |
| P4.3 index/load test | Parsial | Pool naik; index `(company_id, session_id)` belum diuji EXPLAIN; load test belum. |
| P4.4 expiry/enkripsi | Parsial | Scoping selesai; expiry 72 jam, enkripsi, dan clear-on-logout belum. |
| P4.5 printer policy | Belum | Butuh tabel/kebijakan per terminal. |
| P4.6 soak 8–12 jam | Belum | Hardware/printer dan waktu belum tersedia. |

### 17.3 Keputusan yang diambil

1. **Offline web:** direct ESC/POS adalah jalur offline resmi. Mode kiosk/browser tanpa printer tetap memerlukan koneksi atau konfigurasi printer direct. Ini batasan yang harus terlihat di UI.
2. **Multi-printer:** ditunda. Untuk minimarket, satu printer kasir cukup; routing customer/kitchen/label akan dikerjakan bersama desktop print service, bukan di web satu printer.
3. **Split bill:** ditunda. Pembayaran campuran sudah tersedia; split per item/tamu adalah perubahan domain pembayaran/jurnal yang tidak aman dikerjakan tanpa kebutuhan produk.
4. **Promosi/loyalty/kitchen web:** ditunda; tetap desktop-only sampai ada keputusan produk.
5. **HA/multi-store:** ini pekerjaan infrastruktur (replica, PITR, load balancer), bukan perubahan aplikasi yang bisa diverifikasi di sesi ini.
6. **Shared login:** pool dinaikkan ke 24, tetapi penegakan satu sesi per terminal belum diimplementasikan. Operasional harus melarang satu akun kasir dipakai di beberapa terminal.

### 17.4 Verifikasi

- `pnpm typecheck` — **lulus**.
- `BISA_TEST_BUILD=1 pnpm build` — **lulus**; route `/api/pos/telemetry` terdaftar.
- Test targeted: print queue 7/7, printer lock 3/3, offline scope 3/3, UI actions 13/13, arsitektur dialog/file-size 7/7, offline/ESC/POS existing — **65/65 lulus** (10 file).
- Playwright smoke: navigasi 3 route, X report, checkout — **tidak ada page error**; checkout 249 ms; sale uji `INV-2026-00040` sudah di-void.
- Audit DB: `pos.receipt.reprint`, `pos.session.x_report` tercatat.
- Benchmark nav final (`scripts/audit/pos-nav-bench.mjs`, 18 sampel): **p50 297 ms, p95 373 ms**. Sebelum perbaikan 381–887 ms; target <150 ms **belum tercapai**.
- Full suite awal pada DB test lama: 2.480/2.492 lulus. Setelah perbaikan, rerun targeted 39/47 lulus; 8 kegagalan tersisa di `pos-device-api` dan `review-fixes-t3` (file yang diubah tidak menyentuh area tersebut; perlu DB test segar/migrasi). Full suite belum dijalankan ulang. Ini **bukan klaim full-suite hijau**.

### 17.5 Risiko yang tersisa

- Navigasi masih 2–2,5× target; P2.8/P2.2/P2.3 belum dikerjakan.
- Kiosk offline belum punya struk.
- Full suite belum hijau di DB test lama.
- Belum ada APM/alert; telemetri hanya masuk ke log server.
- Belum ada uji printer fisik/paper jam/soak.

---

**Status plan:** implementasi inti selesai; Fase 5 dan item yang tercantum di §17.2 belum selesai.  
**Langkah berikutnya:** kerjakan P2.8 (profiling commit/layout) dan P2.2 (rail) untuk mengejar p95 <150 ms; lalu P4.2/P4.5/P4.6 bila infrastruktur tersedia.
