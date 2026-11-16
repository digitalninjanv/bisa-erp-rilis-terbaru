# Audit Repository Bisa ERP — 15 November 2026

## Ringkasan dan batas audit

Audit baca-saja ini memakai HEAD `21d4505644b8457d024b8e1f08655b28d0d296c6` (`main`, commit `feat(erp): impor multi-entitas, rate limit DB, dan penguatan retur/persediaan`). Status kerja saat audit: `.claude/CLAUDE.md` memiliki perubahan lokal yang tidak terkait dan dibiarkan apa adanya.

**Ini bukan sertifikasi bahwa seluruh sistem telah diaudit.** Repo memuat ratusan file aplikasi, sekitar seratus tabel, ratusan aksi/route, dan dokumentasi audit bertahap yang luas. Audit ini membaca peta arsitektur/aturan, register dan laporan terdahulu, menelusuri CodeGraph untuk batas tenant, otorisasi, jalur API, POS, jurnal, stok, serta memeriksa beberapa bukti aktual di HEAD. Tidak semua screen, action, migration, query produksi, integrasi eksternal, atau jalur UI diuji langsung pada sesi ini. Database, deployment, hardware POS, dan data produksi tidak diakses. Tidak ada kode, konfigurasi, atau database yang diubah; file laporan ini adalah satu-satunya artefak baru.

Metode ringkas: (1) tetapkan commit dan status kerja; (2) baca kontrak arsitektur, aturan bisnis, desain DB, rencana, dan audit terdahulu; (3) petakan jalur kritis memakai CodeGraph; (4) bandingkan workflow terhadap dokumen resmi Odoo, Accurate, dan SAP Fiori; (5) tandai setiap klaim sebagai bukti terbaru, bukti terdahulu yang perlu revalidasi, atau belum diverifikasi. Prioritas mengikuti dampak ke uang/stok/data/akses dan kemungkinan kejadian.

## Konteks repo dan arsitektur

Dokumentasi menetapkan modular monolith Next.js / React / TypeScript strict, Drizzle + PostgreSQL, Better Auth, validasi Zod, Decimal.js untuk uang, transaksi tenant melalui `withCompany`/`withCompanyReadOnly` dan RLS, gerbang jurnal `postJournal`, ledger stok append-only, serta pemisahan domain POS, Gudang, Akuntansi, HR, dan platform. Peta domain terdapat di [ARCHITECTURE.md](../ARCHITECTURE.md), [MODULE_BOUNDARIES.md](../MODULE_BOUNDARIES.md), [BUSINESS_RULES.md](../BUSINESS_RULES.md), dan [DATABASE_DESIGN.md](../DATABASE_DESIGN.md).

CodeGraph mengonfirmasi `withCompany` digunakan secara luas (417 pemanggil dalam indeks yang tersedia), `writeAudit` memiliki banyak pemanggil, dan jalur POS/API, aksi pengguna, impor, serta posting jurnal dapat ditelusuri. Potongan sumber yang dibaca menunjukkan `requirePermission` memanggil `requireAuth` lalu `assertCan`; `withCompany` membungkus transaksi dan mengatur `app.company_id`; route impor memeriksa izin, batas ukuran, entitas whitelist dan validasi file; aksi penghapusan role memeriksa tenant, role bawaan, pemakai role, dan mencatat audit. Ini indikasi kontrol desain yang baik, **bukan bukti menyeluruh bahwa setiap call site mematuhi kontrak**.

## Matriks cakupan fitur

Status mengacu pada inspeksi dokumentasi dan sampel code saat HEAD. `Belum Terverifikasi` berarti implementasi penuh atau hasil bisnis tidak diperiksa ulang pada audit ini. Status `Sesuai` di bawah terbatas pada bukti audit terdahulu yang disebut; bukan jaminan runtime produksi.

| Modul / fitur yang terinventarisasi | Status audit | Bukti dan batas |
|---|---|---|
| Beranda, dashboard, navigasi peran | Perlu Improvement / Belum Terverifikasi | Audit dashboard 15 Nov ada; tiap antrean dan peran belum direproduksi di UI. |
| POS: terminal, barcode, keranjang, harga grup, diskon, pajak, rounding | Belum Terverifikasi | Matriks lama mencatat implementasi dan test domain; keyboard/hardware dan hasil perangkat aktual tidak diuji sekarang. |
| POS: tunai, QRIS statis, transfer, split, piutang pelanggan | Belum Terverifikasi | Bukti lama menyatakan alur statis diuji; integrasi PSP/QR dinamis belum tersedia menurut register lama. |
| POS: hold/resume, retur, void, nota/cetak ulang, sesi kas | Belum Terverifikasi | Rantai terdahulu mencakup beberapa alur nominal; tidak ada pengujian live/print saat audit ini. |
| POS: PWA offline, outbox, sinkronisasi/idempotensi, desktop Tauri | Perlu Improvement / Belum Terverifikasi | Tes offline/API terdahulu; GUI/installer dan perilaku jaringan/perangkat belum diverifikasi. |
| Produk, SKU/barcode, kategori, unit/kemasan, harga, import/export | Belum Terverifikasi | Ada parser dan hardening impor; round-trip 10k produk dan seluruh entitas baru tidak dijalankan. |
| Gudang: multi-gudang, penerimaan/PO parsial, stok awal/bonus, AVCO | Belum Terverifikasi | Laporan terdahulu mencatat rantai PO→receipt→utang dan AVCO teruji. Ulang pada HEAD tidak dilakukan. |
| Gudang: retur supplier, pembayaran/kredit/refund/replacement | Belum Terverifikasi | Source posting dan reversal sebagian ditelusuri; proses penuh seluruh bentuk settlement perlu uji angka. |
| Gudang: transfer, opname, adjustment, batch/serial/expiry, reservasi | Belum Terverifikasi | Laporan deep-audit menyatakan ada bukti tes dan perbaikan serial; tidak direplay pada HEAD. |
| Gudang: kartu stok, valuasi, laporan, ekspor | Belum Terverifikasi | Audit lama mencatat isu pencarian lintas halaman yang kemudian diperbaiki; tetap perlu cek regresi. |
| Akuntansi: COA, mapping, jurnal manual/otomatis, GL dan trial balance | Belum Terverifikasi | `postJournal` adalah gerbang terdokumentasi; audit sesi ini tidak memeriksa semua source type atau saldo DB. |
| Akuntansi: P&L, neraca, arus kas, ekuitas, aging, rekonsiliasi | Belum Terverifikasi | Rantai rekonsiliasi historis diklaim lulus; belum dibuktikan ulang dari database saat ini. |
| Akuntansi: utang/piutang, alokasi, kas/bank, transfer, rekonsiliasi | Belum Terverifikasi | Ada modul dan laporan terdahulu; seluruh kasus parsial/duplikat/concurrent belum diuji. |
| Akuntansi: pajak, periode, tutup buku, reversal | Belum Terverifikasi | Periode dan tanggal reversal memiliki pengujian historis; rezim pajak Indonesia dan pelaporan resmi bukan cakupan terverifikasi. |
| Akuntansi: beban, aset tetap, payroll journal, audit trail | Belum Terverifikasi | Keberadaan modul tercantum; perhitungan, kepatuhan, dan kelengkapan trail belum diinspeksi end-to-end. |
| HR: karyawan, organisasi, kehadiran, cuti, lembur, payroll, pinjaman/klaim | Belum Terverifikasi | Domain terdokumentasi, tapi aturan ketenagakerjaan/pajak/payroll terkini dan seluruh siklus belum diverifikasi. |
| Pengguna, role, permission, switch modul/perusahaan | Perlu Improvement / Belum Terverifikasi | Potongan implementasi ter-tenant dan gated; audit lama menyebut rate-limit auth in-memory, perlu verifikasi terhadap deployment multi-instance. |
| Pengaturan perusahaan/cabang/gudang/pajak/printer/metode pembayaran | Belum Terverifikasi | CRUD dan import multi-entitas tercatat dalam HEAD message; tidak semua action dan dampak histori ditelusuri. |
| Impor/ekspor dan jalur 10.000+ produk | Perlu Improvement / Belum Terverifikasi | Route parse memiliki batas upload/validasi; benchmark skala dan commit seluruh tipe entitas tidak dijalankan. |
| UI forms/tables/responsive/accessibility | Perlu Improvement / Belum Terverifikasi | Ada beberapa audit UI terdahulu; tidak ada inspeksi visual penuh pada semua rute/breakpoint pada sesi ini. |
| Deployment, backup/restore, operasi, observability | Belum Terverifikasi | Dokumentasi dan audit terdahulu mencatat blocker staging/installer; tidak melakukan deployment atau restore. |

Inventaris historis menyebut 82 halaman (81 implemented, 1 partial untuk GUI terminal desktop yang belum diuji) dalam [MATRIKS-FITUR.md](../audit/MATRIKS-FITUR.md). Angka itu tidak diperlakukan sebagai hitungan kondisi HEAD tanpa rekonsiliasi route terbaru. Semua domain HR, pembelian, stok, POS, accounting, import/export, report, dashboard, dan setting tercakup pada matriks tematik di atas, tetapi beberapa subfitur sengaja berstatus belum diverifikasi.

## Temuan audit

### BERP-01 — Rate limiting autentikasi perlu penyimpanan bersama untuk deployment multi-instance

- **Modul/fitur:** Platform — login/authentication.
- **Lokasi:** konfigurasi Better Auth (ditunjuk oleh `docs/audit/AUDIT-REGISTER.md` bagian A1; path/function tepat belum diverifikasi pada HEAD sesi ini).
- **Kondisi/bukti:** register audit 8 Nov mencatat rate-limit sign-in 10/60 detik tersimpan in-memory per instance. Fakta itu belum dikonfirmasi ulang di file auth pada HEAD.
- **Masalah/dampak:** bila layanan berjalan pada beberapa instance tanpa sticky routing, tiap instance dapat menerapkan kuota sendiri; kontrol brute-force terdistribusi menjadi lebih lemah dan hasilnya tidak konsisten.
- **Prioritas:** Medium (naik ke High bila layanan internet-facing dan multi-instance tanpa kontrol edge lain).
- **Rekomendasi:** periksa konfigurasi deployment aktual dan rate-limit store; gunakan counter bersama/edge throttle bila instance dapat diskalakan. Hindari mengganti desain jika runtime satu instance dan ada mitigasi perimeter yang terdokumentasi.
- **Kriteria penerimaan:** simulasi permintaan login berulang yang tersebar ke beberapa instance tetap dibatasi oleh satu kuota efektif; respons tidak membocorkan keberadaan akun.
- **Referensi:** [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — pertahanan terhadap percobaan autentikasi otomatis.

### BERP-02 — Pengujian integrasi historis belum membuktikan keadaan runtime HEAD/produksi

- **Modul/fitur:** seluruh modul dan rantai transaksi.
- **Lokasi:** [AUDIT-REGISTER.md](../audit/AUDIT-REGISTER.md), [DEEP-AUDIT-2026-11-15.md](../audit/DEEP-AUDIT-2026-11-15.md), `tests/integration/`, database dan deployment yang digunakan.
- **Kondisi/bukti:** dokumentasi terdahulu mencatat suite 2440 lulus, 6 skipped, e2e 44/44, serta rangkaian nominal dan integritas DB pada baseline tertentu. HEAD sekarang lebih baru (`21d4505`, termasuk impor multi-entitas dan penguatan retur); audit ini tidak menjalankan test, tidak menyambungkan DB, dan tidak mengeksekusi UI.
- **Masalah/dampak:** hasil terdahulu tidak membuktikan tidak adanya regresi pada commit terbaru, migrasi/database aktif, konfigurasi produksi, perangkat printer/scanner, ataupun concurrency nyata.
- **Prioritas:** High untuk keputusan kesiapan rilis; ini gap assurance, bukan klaim terdapat bug.
- **Rekomendasi:** sebelum rilis, jalankan suite dan pemeriksaan integritas pada database disposable yang dibuat dari migrasi HEAD; tambahkan smoke test production build serta uji skenario multi-user dan device di staging. Jangan jalankan test yang terhubung ke DB tanpa memastikan target disposable.
- **Kriteria penerimaan:** hasil terikat ke SHA HEAD, versi migrasi dan konfigurasi lingkungan; semua rantai finansial/stock direkonsiliasi dengan angka; skipped dan blocker dicatat.
- **Referensi:** [OWASP Secure Code Review](https://owasp.org/www-project-devsecops-guideline/latest/2-Process/2-2-Develop/2-2-3-Secure-Code-Review/) — automated checks melengkapi, bukan menggantikan review konteks.

### BERP-03 — Jalur pembelian/retur/valuasi membutuhkan replay menyeluruh sesudah commit terkini

- **Modul/fitur:** Gudang & Pembelian → Akuntansi.
- **Lokasi:** `src/server/purchasing.ts`, `src/server/supplier-returns/`, `src/server/inventory/`, `src/server/accounting.ts`; halaman dokumen terkait. Referensi aktual: [DEEP-AUDIT](../audit/DEEP-AUDIT-2026-11-15.md) §§4–6 dan [BUSINESS_RULES](../BUSINESS_RULES.md) §3.
- **Kondisi/bukti:** source retur yang terindeks menunjukkan reversal mencari jurnal posted berdasarkan `companyId`, `sourceType`, `sourceId`, dan belum-reversal; pemulihan stok menggunakan gerakan sumber dan memulihkan batch/serial. Audit lama menguji beberapa alur supplier return dan AVCO. Namun semua jenis settlement (potong utang, kredit, refund, replacement, DP, other), parsial/void/concurrent, pemetaan pajak, GL dan aging tidak direplay di HEAD.
- **Masalah/dampak:** proses ini berdampak langsung pada nilai persediaan, utang supplier, kas/bank, dan laporan; bukti lama yang tidak mencakup commit terbaru menyisakan risiko salah saldo yang material.
- **Prioritas:** High sebagai prioritas verifikasi; belum terbukti cacat.
- **Rekomendasi:** jalankan fixture disposable per skenario; cocokkan dokumen asal→mutasi→AVCO→jurnal→subledger→GL/laporan dan pastikan void/retry idempotent serta perubahan dokumen posted ditolak.
- **Kriteria penerimaan:** saldo stok = agregasi ledger; nilai persediaan dan akun kontrol cocok dalam toleransi nol/aturan pembulatan; saldo utang/kredit/refund benar; jurnal seimbang; uji duplikat dan dua transaksi bersamaan tidak menggandakan dampak.
- **Referensi:** [Odoo Accounting — Inventory Valuation](https://www.odoo.com/documentation/20.0/applications/finance/accounting/get_started/inventory_valuation.html); [Accurate — Retur Pembelian](https://help.accurate.id/product/accurate-online/fitur-aol/pembelian/retur-pembelian/penjelasan-dan-fungsi-retur-pembelian/).

### BERP-04 — Coverage cabang historis di bawah sasaran dan belum diukur ulang pada HEAD

- **Modul/fitur:** seluruh domain bercabang, khususnya aturan peran, kondisi transaksi dan error handling.
- **Lokasi:** [DEEP-AUDIT](../audit/DEEP-AUDIT-2026-11-15.md) §5, `vitest` coverage config (path belum diperiksa ulang).
- **Kondisi/bukti:** laporan terdahulu menyatakan branch coverage 79,35% (kurang 26 cabang dari ambang internal yang dipakai saat itu); angka tidak diukur ulang pada commit ini.
- **Masalah/dampak:** branch yang tidak tercakup berpotensi menyembunyikan cacat pada partial/void/retry/role atau batas error. Coverage bukan ukuran kebenaran, tetapi gap memberi sinyal jalur alternatif yang belum tervalidasi.
- **Prioritas:** Low/Medium.
- **Rekomendasi:** ukur coverage pada HEAD dan fokuskan penambahan pemeriksaan pada cabang bernilai finansial/otorisasi, bukan mengejar angka global tanpa konteks.
- **Kriteria penerimaan:** coverage terbaru dilaporkan dengan SHA dan daftar cabang penting tanpa test; cabang posting, reversal, role denial, offline duplicate/conflict, dan validasi batas memiliki pemeriksaan terarah.
- **Referensi:** [OWASP Secure Code Review](https://owasp.org/www-project-devsecops-guideline/latest/2-Process/2-2-Develop/2-2-3-Secure-Code-Review/) — alat otomatis mendukung, bukan menggantikan pemeriksaan manual.

### BERP-05 — Paket SheetJS dari CDN menambah risiko ketersediaan dan provenance supply chain

- **Modul/fitur:** import XLSX, build/install.
- **Lokasi:** `package.json` dependency `xlsx` mengarah ke tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (bukti HEAD); detail lock integrity dan pemindaian advisori dicatat register lama tetapi tidak diperiksa ulang.
- **Kondisi/bukti:** bukan unduhan runtime menurut audit lama; paket diambil ketika dependency install. Sumber tarball di luar registry biasa dapat mengalami outage atau memiliki provenance/advisory coverage berbeda.
- **Masalah/dampak:** build/recovery bisa bergantung pada ketersediaan vendor CDN; pemantauan vulnerability/provenance mungkin tidak sama dengan paket registry yang diawasi.
- **Prioritas:** Low (naik bila pipeline harus reproducible/terisolasi atau ada advisory relevan).
- **Rekomendasi:** verifikasi integrity lockfile, lisensi, sumber rilis, advisory versi yang digunakan, dan prosedur caching/mirroring yang sesuai kebijakan organisasi.
- **Kriteria penerimaan:** build bersih dapat direproduksi dari lockfile dengan dependency terverifikasi; advisori dan sumber paket tercatat; tidak ada perubahan versi tanpa alasan.
- **Referensi:** [OWASP DevSecOps Secure Code Review](https://owasp.org/www-project-devsecops-guideline/latest/2-Process/2-2-Develop/2-2-3-Secure-Code-Review/) — dependency dan provenance perlu diperiksa.

## Perbandingan workflow dan UX dengan referensi

- **Pembelian dan valuasi:** referensi Odoo membedakan valuasi periodik/perpetual dan menghubungkan penerimaan/faktur dengan inventory valuation serta GL. Accurate menjelaskan retur pembelian terhubung dokumen asal, mengurangi stok dan utang/kredit serta mencatat jurnal. Aturan Bisa ERP mendokumentasikan AVCO dan supplier return; validasi end-to-end untuk HEAD masih diperlukan (BERP-03). Fitur kompetitor yang tidak relevan seperti manufaktur/restaurant tidak direkomendasikan.
- **POS:** Odoo mendokumentasikan POS berbasis browser, operasi saat gangguan jaringan, metode pembayaran, perangkat, dan reporting. Arsitektur Bisa memiliki PWA/offline dan terminal desktop; perbedaan yang harus ditutup audit adalah verifikasi perangkat, pemulihan antrean, dan dukungan operasional nyata, bukan menyalin fitur restoran.
- **Form:** SAP Fiori merekomendasikan pengelompokan logis, label singkat dan bermakna, pesan error yang membantu, serta layout responsif. Audit dokumentasi UI yang ada belum menjadi inspeksi visual semua halaman HEAD; belum ada temuan per halaman yang dapat dinyatakan sebagai bug pada sesi ini.
- **Tabel:** Fiori membedakan kebutuhan line-item dan jumlah data besar. Audit berikutnya perlu memeriksa bahwa filter/sort/pagination dilakukan di server untuk dataset besar, kolom penting mudah dipindai, dan aksi baris dapat digunakan via keyboard. Pencarian valuasi lintas halaman pernah tercatat dan diklaim diperbaiki; status regresinya belum diuji ulang.

## Rekonsiliasi audit terdahulu

| Temuan / klaim terdahulu | Status pada audit ini | Catatan |
|---|---|---|
| Pencarian valuasi hanya di halaman saat ini (DEEP-AUDIT §4.1) | Sebagian diperbaiki menurut laporan; belum diverifikasi ulang | Laporan menyebut pemindahan filter ke SQL dan test. Lakukan cek regresi pada HEAD dan dataset >1 halaman. |
| Purchasing/PR/reservasi melewati saklar modul (DEEP-AUDIT §4.2) | Sebagian diperbaiki menurut laporan; belum diverifikasi ulang | Laporan menyebut `requirePermissionInModule(..., "gudang")`; belum semua action dipetakan di audit ini. |
| Void adjustment/opname/karantina serial (DEEP-AUDIT §4.3) | Sebagian diperbaiki menurut laporan; belum diverifikasi ulang | Ada penjelasan helper/test; perlu re-run kasus seluruh tipe dokumen dan serial. |
| Tanggal void payroll/penjualan/transfer bank (DEEP-AUDIT §4.4) | Sebagian diperbaiki menurut laporan; belum diverifikasi ulang | Aturan tanggal reversal dilaporkan memilih tanggal sumber saat periode terbuka; perlu replay tutup periode. |
| Pelanggaran import boundary (DEEP-AUDIT §4.5) | Diperbaiki menurut laporan; belum diverifikasi ulang | Barrel import diklaim memperbaiki arah dependensi; CodeGraph sesi ini tidak memeriksa ulang seluruh cycle/boundary. |
| Admin terminal desktop GUI/installer (MATRIKS-FITUR) | Belum terverifikasi | Audit lama menyatakan kontrak API/harness pass tetapi GUI/installer belum diuji. |
| QRIS dinamis / payment gateway | Belum tersedia menurut laporan lama; belum diverifikasi ulang | QRIS statis dan konfirmasi kasir bukan integrasi PSP. Status perlu tetap eksplisit dalam product scope. |
| Rate limit in-memory login (AUDIT-REGISTER) | Belum dapat diverifikasi ulang pada HEAD | Risiko bergantung deployment; menjadi temuan BERP-01. |
| Coverage branch 79,35% (DEEP-AUDIT) | Belum diverifikasi ulang | Menjadi BERP-04; data historis, bukan ukuran HEAD. |
| SheetJS tarball CDN (AUDIT-REGISTER) | Terlihat di manifest HEAD; detail provenance belum diverifikasi | Menjadi BERP-05. |
| RLS, drift schema, integritas DB dan test counts dalam register | Belum diverifikasi pada HEAD | Angka lama tidak dipresentasikan sebagai kondisi database terkini. |

Tidak ada temuan lama yang bisa dinyatakan **masih terkonfirmasi sebagai bug aktif** hanya dari bukti yang dikumpulkan sesi ini. Klaim “sudah diperbaiki” di tabel adalah status berdasarkan laporan historis, bukan hasil reproduksi independen. Audit juga tidak menemukan dasar yang cukup untuk menyebut modular monolith atau gerbang `postJournal` perlu diganti.

## Rencana audit lanjutan yang diperlukan

1. Buat DB disposable dari migrasi HEAD; ukur integritas RLS, jurnal, stok/AVCO, idempotency, constraint, drift dan migrasi.
2. Petakan semua route/action/halaman terbaru; cocokkan permission action, module switch, tenant wrapper, validation, audit trail dan sensitivitas output.
3. Replay skenario nominal lengkap untuk POS online/offline, purchase partial/cash/credit, seluruh supplier return settlement, void/reversal, pembayaran/alokasi, bank reconciliation, payroll dan laporan.
4. Jalankan stress/concurrency/perf pada dataset sintetis 10k+ produk, riwayat ledger besar dan checkout bersamaan; catat p95, query count, memori dan hasil konsistensi.
5. Inspeksi UI semua rute melalui production build pada desktop/tablet/mobile dan keyboard; simpan screenshot serta langkah reproduksi tiap temuan.
6. Verifikasi staging: auth throttling multi-instance, backup/restore, HTTPS installer, update desktop, printer/scanner, observability dan recovery offline.

## Referensi riset eksternal

- [OWASP DevSecOps — Secure Code Review](https://owasp.org/www-project-devsecops-guideline/latest/2-Process/2-2-Develop/2-2-3-Secure-Code-Review/) — review berbasis risiko dan keterbatasan scanner.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — kontrol autentikasi dan percobaan login otomatis.
- [Odoo 20 — Point of Sale](https://www.odoo.com/documentation/20.0/applications/sales/point_of_sale.html) — kemampuan POS, jaringan, pembayaran, perangkat dan laporan.
- [Odoo 20 — Accounting](https://www.odoo.com/documentation/20.0/applications/finance/accounting.html) — double-entry, invoice dan metode valuasi.
- [Odoo 20 — Inventory Valuation](https://www.odoo.com/documentation/20.0/applications/finance/accounting/get_started/inventory_valuation.html) — perpetual/periodic, AVCO dan rekonsiliasi valuasi.
- [Accurate Online — Retur Pembelian](https://help.accurate.id/product/accurate-online/fitur-aol/pembelian/retur-pembelian/penjelasan-dan-fungsi-retur-pembelian/) — relasi retur, stok, utang/kredit dan jurnal.
- [Accurate Online — Data usaha dan barang](https://help.accurate.id/product/accurate-online/memulai-aol/buat-data-usaha-baru/) — klasifikasi barang, satuan, harga, stok awal dan pemetaan akun.
- [SAP Fiori — Form Usage](https://www.sap.com/design-system/fiori-design-web/v1-71/ui-elements/form/usage) — susunan field, label, pengelompokan, validasi dan responsivitas.
- [SAP Fiori — Table Overview](https://www.sap.com/design-system/fiori-design-web/v1-38/foundations/best-practices/ui-elements/tables/table-overview) — pemilihan tabel untuk line-item dan interaksi.

**Sumber versi:** hasil pencarian Exa pada 15 Nov 2026 mengembalikan dokumentasi Odoo 20.0, Accurate Online Help, dan SAP Fiori Design Web. Framework yang tercatat di manifest ialah Next.js 16.4.5, React 19.3.0, Drizzle 0.45.4, Zod 4.6.7, Tailwind 4, Better Auth 1.7.15; dokumentasi API versi terkini tidak dijadikan dasar temuan implementasi spesifik karena perilaku framework tidak diuji pada sesi ini.

## Bukti dan keterbatasan verifikasi

- Pemeriksaan read-only: branch/commit/status, daftar dokumen, manifest dependency (tanpa membaca `.env.local`), CodeGraph explore pada arsitektur, auth/tenant, API import, POS dan accounting/inventory, serta pencarian Exa atas referensi di atas.
- Tidak menjalankan unit/integration/e2e, lint, typecheck, build, benchmark, migration, seed, query DB, aplikasi, atau browser. Tidak memeriksa credential, data produksi, installer, printer, scanner, dan deployment runtime.
- Untuk kepatuhan payroll/pajak/akuntansi Indonesia, perlu pemeriksaan ahli domain terhadap aturan resmi yang berlaku pada tanggal transaksi; audit ini tidak menyatakan sertifikasi SAK, pajak, atau ketenagakerjaan.
- Putusan kesiapan produksi dari bukti sesi ini: **belum dapat diputuskan**. Laporan ini adalah baseline audit berbukti dan daftar kerja; bukan klaim “seluruh sistem sudah diaudit”.
