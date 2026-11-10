# Riset Teknologi A-24 — POS Lokal Linux, Pengemasan & Arsitektur Modul

Program A-24 (Perombakan Total), Riset 2 dari 2 · 2026-11-05
Stack terkunci (tidak dibahas untuk diganti): Next.js 16.4.3 (App Router,
Server Actions) · React 19 · PostgreSQL 18 · Drizzle · Better Auth · pnpm.
Riset ini menilai **pola penyebaran, pengemasan, dan struktur modul** di atas
stack yang ada — bukan penggantian stack.

## 0. Keadaan hari ini (terverifikasi dari repo)

- **Offline POS = PARTIAL, sudah berfungsi sebagai mekanisme, belum terbukti
  di peramban sungguhan.** Antrean lokal adalah pembungkus IndexedDB tulisan
  tangan di `src/lib/pos-offline.ts` (dua implementasi storage: IndexedDB +
  memori — **bukan** paket Dexie; `dexie` tidak ada di `package.json`).
  Sinkronisasi lewat `syncOfflineSalesAction` berpotong 25 item, kunci
  idempotensi per penjualan, hasil per item `synced/duplicate/conflict/failed`;
  saklar per perusahaan `company_settings.pos_offline_enabled` (bawaan mati);
  ada halaman "Peninjauan offline" di nav POS. Uji peramban sungguhan tercatat
  **NOT TESTED** sejak SIM-2/A-17 sampai hari ini.
- **Batas jujur mode offline hari ini:** tidak ada service worker dan tidak ada
  web app manifest di repo (`public/` hanya berisi aset bawaan Next). Artinya
  tidak ada precache app-shell: mode offline hanya menolong bila halaman
  terminal **sudah termuat** ketika koneksi putus. Reload atau membuka ulang
  peramban saat server tak terjangkau = terminal tidak bisa dibuka, karena
  semua halaman ERP `export const dynamic = "force-dynamic"` (HTML dibuat
  server per request).
- **Cetak struk hari ini:** `window.print()` (`src/components/pos/receipt-print.tsx`)
  — dialog cetak peramban ke printer bawaan OS. Tidak ada jalur ESC/POS mentah.
- **Pengemasan hari ini:** `docker-compose.yml` hanya untuk pengembangan
  (layanan db + mailpit + minio; **tidak ada layanan aplikasi, tidak ada
  Dockerfile di repo**) dan berkas itu sendiri memperingatkan agar tidak
  dipakai apa adanya di produksi. `scripts/backup.sh` + `scripts/restore.sh`
  sudah ada (pg_dump format custom, enkripsi AES opsional) dan
  `docs/RUNBOOK-BACKUP-RESTORE.md` terbukti (restore identik, SIM-2 S5),
  tetapi **backup terjadwal belum ada** (tercatat di PROGRESS).
- **Arsitektur:** modular monolith, vonis terakhir 6,7/10 (A-20,
  `docs/arsitektur-dalam/LAPORAN-MENDALAM.md`); penjaga: ratchet jalur baca
  ARS1-01 (`tests/unit/architecture-read-paths.test.ts`), komponen bersama
  `src/components/blocks/`, logika murni teruji unit di `src/lib/`.
- **Modul shell hari ini:** `ModuleKey = "pos" | "gudang" | "akuntansi"`
  (`src/lib/modules.ts`). HR hidup di bawah akuntansi: rute
  `/app/akuntansi/hr/{absensi,cuti,lembur}` plus `/app/akuntansi/{karyawan,
  kasbon,pinjaman,klaim,payroll}`; izinnya `payroll.view`/`payroll.manage`
  berlabel "Akuntansi: …"; grup nav "SDM & Payroll" sudah ada di sidebar
  akuntansi sejak A-22 K5.

## 1. Model penyebaran minimarket

Empat opsi dinilai atas stack yang ada. Satu fakta yang menentukan semuanya:
**Bisa ERP adalah aplikasi server** (SSR + Server Actions + PostgreSQL + RLS).
Setiap model harus menjawab: *di mana proses Node + PostgreSQL berjalan?*
UI web saja tidak pernah cukup.

### (a) Server lokal Linux di toko — aplikasi + DB di satu mesin toko, terminal = peramban LAN

- **Cara kerja:** satu mini-PC Linux di toko menjalankan Next.js
  (`pnpm start` atau output `standalone` resmi Next) + PostgreSQL 18; kasir
  membuka `http://<ip-server-toko>` dari Chromium di mesin kasir (bisa mesin
  yang sama). Semua fitur bekerja identik dengan pengembangan: tidak ada satu
  pun asumsi cloud di kode.
- **Internet mati:** tidak berpengaruh pada operasi toko. Yang hilang hanya
  hal yang memang butuh internet (pembaruan versi, backup offsite, akses
  pemilik dari rumah).
- **Server lokal mati:** semua terminal berhenti — satu titik gagal. Mitigasi
  realistis: systemd `Restart=on-failure`, UPS untuk mesin server, dan
  antrean offline yang sudah ada menahan penjualan di terminal yang
  halamannya sudah termuat selama server dipulihkan. Cadangan mesin tidak
  realistis untuk minimarket; yang realistis adalah **restore cepat** (backup
  lokal + prosedur runbook yang sudah terbukti).
- **Sinkronisasi:** tidak ada sinkron antar-server dalam model ini. Multi-toko
  berarti satu server per toko dan konsolidasi laporan menjadi pekerjaan
  terpisah — stack hari ini multi-company **dalam satu database**, bukan
  sinkronisasi banyak server. Jangan menjanjikan konsolidasi multi-toko dari
  model ini tanpa proyek tersendiri.
- **Perangkat keras:** paling luwes. Printer bisa menempel di mesin server
  atau mesin kasir via CUPS; scanner HID bekerja di mana pun (lihat §1.5).
- **Pemeliharaan oleh non-teknisi:** satu mesin untuk dirawat; pembaruan =
  satu skrip (§2). Risiko terbesar bukan teknis melainkan disiplin backup —
  dijawab backup otomatis terjadwal (§2).
- **Biaya/kompleksitas:** satu mini-PC (kelas Rp3–6 jt) + UPS; tanpa biaya
  langganan server. Kompleksitas pemasangan ditanggung installer §2, bukan
  pemilik toko.

### (b) PWA terpasang + service worker

- **Cara kerja yang sebenarnya:** service worker adalah event handler
  peramban (fetch/push/sync), **bukan server** — tidak ada socket, port, atau
  proses yang mendengarkan. Ia hanya bisa menyajikan aset yang sudah
  di-cache dan menjawab fetch dari cache/IndexedDB. Ia **tidak menjalankan**
  Next server, Server Actions, atau PostgreSQL.
- **Konsekuensi jujur untuk Bisa ERP:** PWA bukan model penyebaran tersendiri.
  Halaman ERP bersifat `force-dynamic` — service worker tidak bisa mengarang
  halaman akuntansi/gudang/laporan secara offline. Yang realistis dan
  berharga: precache app-shell + aset statis + **satu rute terminal POS**,
  supaya terminal bisa *dibuka* saat server tak terjangkau, dipasangkan
  dengan antrean IndexedDB yang sudah ada. Itu pun menuntut data katalog
  (produk/harga/stok) tersedia sebagai snapshot lokal — pekerjaan nyata,
  bukan saklar.
- **Jebakan LAN yang sering dilupakan:** service worker hanya terdaftar pada
  secure context (HTTPS atau `localhost`). Di LAN toko dengan alamat IP
  mentah via HTTP, service worker **tidak akan terdaftar** kecuali ada
  sertifikat lokal yang dipercaya terminal, atau terminal berjalan di mesin
  yang sama dengan server (`localhost`). Ini harus diputuskan sebelum
  menjanjikan PWA di toko.
- **Vonis:** pelengkap pengerasan terminal untuk model (a)/(d), dikerjakan
  sesudah model utama terbukti — bukan fondasi.

### (c) Pembungkus native (Tauri / Electron) untuk terminal

- **Cara kerja:** keduanya membungkus UI web; **backend Next tetap butuh
  server**. Dua bentuk: (i) pembungkus sekadar jendela kiosk yang menunjuk
  server (lokal/cloud) — setara peramban kiosk dengan ikon aplikasi; atau
  (ii) pembungkus men-spawn proses Node lokal sebagai sidecar yang
  menjalankan server standalone di mesin yang sama — itu model (a) yang
  dibungkus, dengan segala kewajiban merawat prosesnya.
- **Nilai tambah nyata:** mode kiosk terkunci, cetak senyap lewat API
  native, akses perangkat keras langsung, auto-update bawaan kerangka.
- **Biaya jujur:** rantai build + distribusi biner baru di luar keahlian
  stack saat ini. Electron membawa Chromium sendiri (konsisten antar-mesin,
  tetapi installer dan RAM jauh lebih besar). Tauri memakai webview sistem —
  di Linux itu **WebKitGTK**, mesin render yang berbeda dari Chromium
  (risiko perbedaan render/fitur; versinya mengikuti distro), untuk aplikasi
  yang seluruh pengujiannya hari ini berbasis Chromium/Playwright.
- **Vonis:** ditunda. Terminal Chromium mode kiosk di Linux memberi 90%
  manfaat kiosk tanpa rantai build baru. Pemicu evaluasi ulang yang sah:
  cetak dialog terbukti mengganggu di uji perangkat keras §1.6 dan jalur
  cetak senyap peramban (§1.5) tidak cukup — barulah nilai bentuk (i) dengan
  satu kerangka, diputuskan dari bukti itu.

### (d) Cloud dengan mode offline lokal

- **Cara kerja:** aplikasi + DB di VPS/cloud; toko hanya butuh peramban.
  Mekanisme offline yang sudah ada persis dirancang untuk kegagalan model
  ini: internet putus → terminal yang sudah termuat menjual ke antrean
  IndexedDB → sinkron saat internet pulih.
- **Internet mati:** POS bertahan (antrean), tetapi **seluruh modul lain
  lumpuh** — gudang dan akuntansi tidak punya mode offline. Di model (a)
  kegagalan yang setara (server mati) justru lebih jarang daripada internet
  toko yang tidak stabil.
- **Server cloud mati:** sama seperti internet mati dari sisi toko.
- **Kelebihan:** tanpa server di toko; backup, pembaruan, dan multi-toko
  terpusat (satu DB multi-company memang model data proyek ini); pemilik
  memantau dari mana pun.
- **Biaya/kompleksitas:** langganan VPS + domain + HTTPS (yang sekaligus
  menyelesaikan syarat secure context untuk service worker kelak); latensi
  tiap klik mengikuti kualitas internet toko.

### 1.5 Perangkat keras di Linux (berlaku untuk semua model)

- **Scanner barcode:** gunakan yang ber-mode HID keyboard-wedge — tampil
  sebagai ketikan keyboard, bekerja di peramban maupun native tanpa driver
  dan tanpa izin API. Scanner serial/USB-CDC menuntut WebSerial (Chromium
  saja, secure context, izin per perangkat) — hindari sebagai kebutuhan.
- **Printer thermal ESC/POS, dari yang paling sederhana:**
  1. **Keadaan hari ini** — `window.print()` ke printer default OS (CUPS).
     Berfungsi, tetapi dialog cetak per transaksi dan hasil render HTML,
     bukan ESC/POS mentah (potong kertas & laci tidak terkendali program).
  2. **Chromium `--kiosk-printing`** di terminal khusus: cetak ke printer
     default tanpa dialog. Nol kode baru; cocok untuk terminal kasir
     terdedikasi. Tetap render HTML.
  3. **Endpoint cetak di server lokal** (khusus model a): route API kecil di
     aplikasi yang menyusun byte ESC/POS struk dan mengirimnya ke printer
     (socket jaringan 9100 atau antrean raw CUPS, `lp -o raw`). Memberi
     potong kertas + perintah buka laci (laci kas umumnya menempel ke
     printer via RJ11 dan dibuka perintah ESC/POS dari printer) dan cetak
     identik dari terminal mana pun. Ini pekerjaan tahap tersendiri dengan
     uji perangkat fisik — jangan dibangun sebelum jalur 1–2 terbukti kurang.
  4. **Jembatan pihak ketiga** (QZ Tray — aplikasi lokal berbasis WebSocket,
     membutuhkan Java; atau JSPrintManager): cetak senyap dari peramban
     tanpa menulis endpoint sendiri, dengan harga satu perangkat lunak
     tambahan yang harus dipasang & dirawat di tiap terminal.
  5. **WebUSB/WebSerial dari peramban:** tanpa instalasi, tetapi perlu izin
     per perangkat, secure context, Chromium saja, dan dukungan printer
     ESC/POS generik bervariasi per vendor — belum teruji pada perangkat
     fisik di proyek ini; jangan jadikan satu-satunya jalur.
- **Laci kas:** mengikuti jalur printer (perintah dari printer), bukan
  perangkat terpisah yang diatur aplikasi.
- **Listrik:** UPS untuk mesin server (model a) dan autostart semua layanan
  (systemd untuk server; sesi grafis terminal membuka Chromium kiosk saat
  login) menentukan apakah toko pulih sendiri sesudah listrik padam.

### 1.6 Rekomendasi model penyebaran

**Model utama: (a) server lokal Linux di toko**, dipasang dengan artefak
§2 (Docker Compose produksi atau systemd — satu artefak, dua jalur).
**Varian resmi kedua: (d) cloud**, memakai artefak dan aplikasi yang sama
untuk pemilik multi-toko atau yang internet tokonya andal. **(b) PWA
terbatas** (precache shell + rute terminal saja) sebagai tahap pengerasan
sesudah model utama terbukti di toko percontohan. **(c) native ditunda**
dengan pemicu evaluasi tertulis di §1(c).

**Langkah membuktikannya (menutup catatan NOT TESTED proyek):**

1. **Bukti pemasangan:** pasang artefak produksi di mesin/VM Linux bersih
   hanya dengan skrip installer §2; ukur waktu sampai halaman login
   terlayani; jalankan seed demo.
2. **Bukti offline di peramban sungguhan** — proyek e2e Playwright repo ini
   yang diperluas, dengan tiga skenario yang kriteria lulusnya ditulis
   sebelum dijalankan:
   - **Skenario A (jaringan peramban putus di tengah sesi):** terminal
     termuat, sesi kas terbuka → `context.setOffline(true)` → lakukan 3
     penjualan (tunai, QRIS, campuran) → antrean IndexedDB berisi 3 item →
     `setOffline(false)` → sinkron berjalan → ketiga penjualan muncul di
     riwayat, stok berkurang tepat, jurnal seimbang. Peringatan resmi
     Playwright yang wajib dihormati: emulasi offline hanya memengaruhi
     stack jaringan peramban sesudah navigasi awal dan **tidak** memengaruhi
     navigasi awal itu sendiri — maka skenario A tidak membuktikan apa pun
     tentang membuka terminal dari keadaan tertutup.
   - **Skenario B (server mati, bukan jaringan peramban):** proses server
     dihentikan sungguhan (systemctl stop / hentikan kontainer) di tengah
     hari → terminal yang sudah termuat tetap menjual ke antrean → server
     dinyalakan → sinkron → angka sama seperti skenario A. Dilanjutkan
     reload halaman saat server mati dan hasilnya dicatat apa adanya
     (hari ini: gagal termuat — inilah bukti kebutuhan/ketidakbutuhan
     pengerasan PWA §1(b), diputuskan dari hasil ini, bukan dari selera).
   - **Skenario C (konflik):** selagi terminal offline, harga produk diubah
     dan stok produk lain dikosongkan dari perangkat lain → terminal
     menjual keduanya → sinkron → hasil per item (`conflict`/`failed`)
     tertangani sesuai kontrak yang ada dan kasir melihat penjelasan,
     bukan kehilangan penjualan diam-diam.
   Uji otomatis memakai Chromium Playwright; satu putaran manual pada
   peramban Chromium sungguhan di mesin Linux (bukan hanya headless) tetap
   dicatat sebagai bukti akhir sebelum status NOT TESTED dicabut.
3. **Bukti perangkat keras:** di mesin Linux uji dengan satu printer thermal
   USB ESC/POS generik + satu scanner HID: scan menambah barang, struk
   tercetak lewat jalur terpilih (§1.5), laci terbuka bila terhubung.

## 2. Pengemasan & pemasangan

Dua jalur resmi dari **satu artefak rilis** (hasil `pnpm build`), dipilih per
toko; keduanya memakai `.env` produksi yang sama. Compose pengembangan yang
ada **tidak** dipromosikan menjadi produksi (berkas itu sendiri melarangnya).

### Jalur 1 — Docker Compose produksi (satu perintah)

- `Dockerfile` multi-tahap: tahap build (pnpm install + build dengan
  `output: "standalone"` — mode keluaran resmi Next untuk penyebaran
  mandiri) → tahap runtime ramping (Node LTS, salin `.next/standalone`,
  `.next/static`, `public/`).
- `docker-compose.prod.yml`: layanan `db` (postgres:18, volume bernama,
  healthcheck `pg_isready`) dan `app` (image berversi tag, bukan `latest`;
  `depends_on` db sehat; healthcheck ke `GET /api/health` yang sudah ada).
- Migrasi adalah **langkah eksplisit yang tercatat** (perintah compose
  sekali-jalan sebelum app diperbarui), bukan sulap saat boot.
- Pemasangan oleh non-teknisi: `docker compose -f docker-compose.prod.yml up -d`
  sesudah satu skrip penyiapan menulis `.env` (secret dibangkitkan acak saat
  itu juga, tidak pernah ada secret bawaan yang terpublikasi seperti di
  compose pengembangan).

### Jalur 2 — Tanpa Docker: skrip + systemd

`install.sh` idempoten (aman dijalankan ulang), langkah konkret:

1. Periksa/pasang prasyarat: Node LTS, pnpm, PostgreSQL 18 (peran `erp`
   pemilik skema + `app_user` RLS sesuai aturan proyek).
2. Buat pengguna sistem `bisa`; ekstrak rilis ke `/opt/bisa-erp/releases/<versi>`
   dan tautkan `/opt/bisa-erp/current` ke rilis aktif.
3. Tulis `.env` produksi di luar folder rilis (bertahan lintas pembaruan);
   jangan pernah menimpa `.env` yang sudah ada.
4. Jalankan migrasi (`pnpm db:migrate` dengan env produksi), lalu seed hanya
   bila database kosong dan operator memintanya secara eksplisit.
5. Pasang unit systemd `bisa-erp.service`: `Type=simple`,
   `ExecStart=/usr/bin/node /opt/bisa-erp/current/server.js` (standalone)
   atau `pnpm start`, `Restart=on-failure`, `RestartSec=3`,
   `After=network.target postgresql.service`, `EnvironmentFile=…`,
   `User=bisa`, `[Install] WantedBy=multi-user.target`; `systemctl enable
   --now bisa-erp`; akhiri dengan memeriksa `GET /api/health` sampai 200
   atau gagal dengan pesan yang jelas.

### Pencadangan otomatis lokal

- systemd **timer** harian menjalankan `scripts/backup.sh` yang sudah ada
  (pg_dump format custom via `DIRECT_URL`; aktifkan enkripsi
  `BACKUP_PASSPHRASE` untuk salinan yang meninggalkan mesin) ke folder
  `backups/` dengan retensi tertulis (usulan bawaan: 14 harian + 4 mingguan,
  dapat diubah di satu tempat konfigurasi).
- Salinan offsite (rsync/rclone ke penyimpanan pemilik) adalah **opsi yang
  dimatikan secara bawaan** dan diaktifkan pemilik — data toko tidak
  meninggalkan toko tanpa keputusan itu.
- Restore mengikuti `docs/RUNBOOK-BACKUP-RESTORE.md` yang sudah terbukti,
  termasuk jebakan tercatatnya (grant `app_user` sesudah restore, RT-03).
  Cadangan yang tidak pernah diuji restore-nya tidak dihitung sebagai
  cadangan: uji restore masuk jadwal verifikasi berkala (§4).

### Pembaruan versi yang aman

`update.sh` (atau `update` pada jalur Compose), urutan yang tidak bisa
dilompati:

1. **Backup dulu.** Backup gagal = pembaruan batal, titik.
2. Ambil artefak versi baru (folder rilis baru / tag image baru), rilis lama
   tidak disentuh.
3. Jalankan migrasi maju. Migrasi proyek ini tidak pernah diedit dan hanya
   maju; **rollback versi = restore backup langkah 1**, dinyatakan terus
   terang di dokumentasi pembaruan, bukan dijanjikan sebagai downgrade kode.
4. Alihkan `current`/tag ke versi baru, restart layanan.
5. Verifikasi `GET /api/health` + halaman login + satu halaman per modul.
   Gagal → alihkan kembali ke rilis sebelumnya (untuk kegagalan non-migrasi)
   atau restore (bila migrasi sudah berjalan), dan laporkan.

## 3. Arsitektur modul & HR sebagai modul sendiri

### Keadaan

Pengalih modul, sidebar, beranda, dan pendaratan peran semuanya digerakkan
satu sumber: `src/lib/modules.ts` (`ModuleKey`, definisi nav per modul),
`src/lib/permissions.ts` (izin & peran bawaan), `src/lib/landing.ts`
(pendaratan per peran, A-23). HR hari ini bukan modul: rutenya anak
akuntansi, izinnya berlabel akuntansi, dan grup "SDM & Payroll" hidup di
dalam sidebar akuntansi.

### Opsi A — HR menjadi modul shell TANPA memindah rute (DIREKOMENDASIKAN)

- Tambahkan `"hr"` ke `ModuleKey` + satu entri definisi modul HR di
  `modules.ts`: kartu di Beranda, entri pengalih modul, sidebar sendiri yang
  itemnya menunjuk **rute yang sama persis** (`/app/akuntansi/hr/…`,
  `/app/akuntansi/karyawan/…`, dst.), grup nav yang sudah ada dipindah
  apa adanya menjadi nav modul HR.
- Penjaga modul: grup rute HR diperlakukan `requireModuleAccess("hr")` di
  titik layout yang relevan; izin butirnya tetap `payroll.view/manage`
  (kunci tidak diganti — hanya labelnya dinetralkan dari "Akuntansi: …"
  menjadi label modul HR bila diinginkan, perubahan teks semata).
- Keanggotaan peran: modul HR terlihat oleh peran yang memegang
  `payroll.view` (owner, admin, accountant, dan peran kustom yang pemilik
  beri izin itu); pendaratan `landing.ts` diperlakukan seperti modul lain
  (pengguna satu-modul HR mendarat di HR).
- **Dampak:** penanda buku & tautan pengguna **tidak berubah sama sekali**
  (URL identik); test yang menyebut URL tetap berlaku; yang diuji ulang
  adalah cangkang (matriks visibilitas per peran, breadcrumb/label modul
  pada halaman HR, deteksi modul aktif dari rute — rute HR harus memetakan
  ke modul `hr`, bukan `akuntansi`, di module-shell); konsistensi justru
  naik karena HR berhenti menjadi "tamu" di sidebar akuntansi. Satu-satunya
  kejanggalan yang tersisa dan diterima sadar: URL masih berbunyi
  `/app/akuntansi/…` untuk modul bernama HR.

### Opsi B — HR menjadi modul DENGAN memindah rute ke `/app/hr/*` (DITOLAK untuk sekarang)

- Manfaatnya hanya keindahan & konsistensi URL. Biayanya nyata: semua
  penanda buku dan tautan yang dibagikan pengguna rusak kecuali dipelihara
  redirect kompatibilitas selamanya; ratchet jalur baca, test e2e, dan test
  integrasi yang menyebut URL harus disapu; risiko regresi pada program
  yang sedang merombak UI/UX total tidak sebanding. Nilai ulang hanya bila
  ada alasan produk (mis. HR dijual sebagai modul terpisah) — dan kerjakan
  sebagai tahap tersendiri dengan redirect permanen teruji, bukan sebagai
  efek samping perombakan tampilan.

### Prinsip menjaga arsitektur tetap terpusat & mudah diperbaiki

Berlaku untuk seluruh perombakan A-24, bukan hanya HR:

1. **Satu sumber kebenaran per konsep:** modul di `modules.ts`, izin di
   `permissions.ts`, pendaratan di `landing.ts`, uang di `lib/money.ts`,
   komponen visual bersama di `src/components/blocks/`. Perombakan tampilan
   mengubah konsumen sumber-sumber ini, tidak menggandakannya per halaman.
2. **Logika murni di `src/lib/` teruji unit; halaman hanya merender** —
   ditegakkan ratchet ARS1-01 yang sudah ada; perombakan tidak melonggarkan
   ratchet, pengecualian hanya lewat peta `EXCEPTIONS` beralasan tertulis.
3. **Pola folder+barrel yang terbukti** (pos/, inventory/) adalah pola untuk
   pemecahan berkas besar berikutnya; jangan menambah berkas raksasa baru.
4. **Setiap tahap berakhir pada gerbang yang sama** (suite penuh +
   typecheck + lint + build + e2e) sebelum tahap berikut mulai, dan tidak
   ada dua pekerja menyunting pohon yang sama bersamaan — pola yang
   terbukti di program-program sebelumnya.

## 4. Verifikasi fungsi menyeluruh — rancangan matriks

Tujuan: tidak ada fitur yang "diklaim berfungsi" tanpa bukti. Proyek sudah
punya preseden: Matriks Verifikasi Fitur POS (41 fitur) dan berkas
`tests/integration/feature-matrix-{pos,gudang,t4}.test.ts` serta status per
fitur di `docs/SPEK-FITUR-INTI.md`. Rancangan ini **memperluas** preseden
itu ke semua modul, bukan membuat sistem baru.

### Format matriks (satu baris per fitur, disimpan sebagai dokumen program)

| Kolom | Isi |
|---|---|
| ID | Kode stabil per modul, mis. `POS-01`, `GDG-07`, `AKT-12`, `HR-03`, `PLT-02` |
| Fitur | Nama fitur sebagaimana terlihat pengguna |
| Peran penguji | Peran yang seharusnya bisa (dan yang seharusnya tidak bisa) |
| Skenario ujung-ke-ujung | Langkah di aplikasi sungguhan + hasil terharap **terukur**: dokumen/nomor yang terbit, angka jurnal/stok/saldo yang harus cocok |
| Bukti otomatis | Berkas test (unit/integrasi/e2e) yang menaungi, atau `—` bila belum ada |
| Bukti manual | Tangkapan layar / catatan putaran manual bertanggal di aplikasi sungguhan |
| Status | `LULUS` / `SEBAGIAN` / `GAGAL` / `BELUM DIUJI` |
| Commit & tanggal uji | Versi yang diuji |

Cakupan baris: POS (jual tunai/kredit/campuran, diskon & kelompok harga,
retur, sesi kas, offline §1.6), Gudang (penerimaan, PO/PR, retur pembelian,
transfer, reservasi, opname, penyesuaian, impor), Akuntansi (jurnal, beban,
transfer bank + biaya, piutang/utang + kredit pihak, fee/potongan/write-off,
rekonsiliasi, laporan + pembanding, tutup periode & tahun), HR (karyawan,
absensi/cuti/lembur, payroll + komponen, kasbon, pinjaman, klaim),
Pengaturan & platform (pengguna & peran, metode bayar, pengaturan
perusahaan, backup/restore, kesehatan `/api/health`).

### Kriteria lulus

- **Per fitur:** skenario berhasil dijalani lewat UI/aksi resmi (bukan
  suntikan data langsung) dengan peran yang benar; peran yang salah
  **ditolak dengan rapi**; angka hasil cocok dengan invariant proyek
  (jurnal seimbang, `stock_on_hand` = Σ `stock_movements`, ringkasan
  bulanan = agregat jurnal); bukti otomatis hijau **atau** bukti manual
  bertanggal ada — fitur inti wajib punya keduanya.
- **Per modul:** 100% fitur inti `LULUS`; fitur `SEBAGIAN`/`GAGAL` menjadi
  temuan bernomor yang diperbaiki dan diuji ulang (hanya baris terdampak +
  regresi penuh) sebelum modul dinyatakan selesai.
- **Per rilis:** tidak ada fitur inti berstatus `BELUM DIUJI`; gerbang
  teknis penuh hijau (test, typecheck, lint, build, e2e); matriks
  ditandatangani dengan commit yang persis sama dengan yang dikemas §2.
- Fitur yang memang keputusan pemilik (belum dibangun) tidak masuk matriks
  sebagai `GAGAL` — ia dicatat terpisah sebagai keputusan tertunda, persis
  pola daftar keputusan pemilik di PROGRESS selama ini.

## 5. Koreksi kejujuran — yang tidak terverifikasi dari dokumentasi resmi

- Angka ukuran installer/RAM Tauri vs Electron (±3–10 MB vs 85–150 MB)
  berasal dari blog & perbandingan komunitas, **bukan dokumentasi resmi**
  kedua proyek; yang resmi dan pasti hanyalah mekanismenya (Tauri memakai
  webview sistem — WebKitGTK di Linux; Electron membundel Chromium).
  Keputusan §1(c) tidak bergantung pada angka persisnya.
- Klaim komunitas tentang "Web Printing API yang stabil di Chrome" untuk
  cetak tanpa dialog **tidak terkonfirmasi** di dokumentasi resmi Chromium
  pada riset ini — tidak dijadikan dasar rekomendasi apa pun di §1.5.
- Perilaku emulasi offline Playwright dikutip dari dokumentasi resmi
  Playwright (opsi `offline` pada konteks/`test-use-options`, dan batasnya:
  tidak memengaruhi navigasi awal, hanya stack jaringan peramban) —
  karena batas resmi itulah §1.6 mewajibkan skenario server-mati sungguhan
  di samping emulasi.
- Mode keluaran `standalone` Next.js dan pola Dockerfile multi-tahap dirujuk
  dari panduan self-hosting Next.js (termasuk kompilasi pihak ketiga atas
  dokumentasi Next 16) — langkah §2 wajib divalidasi terhadap panduan di
  `node_modules/next/dist/docs/` versi repo ini saat tahap pengemasan
  dikerjakan (aturan proyek sendiri memerintahkan itu).
- **Tidak ada pengujian perangkat fisik yang dilakukan riset ini.** Semua
  penilaian printer/scanner/laci adalah rancangan berbasis dokumentasi &
  dokumentasi komunitas; statusnya berubah menjadi terbukti hanya sesudah
  langkah pembuktian §1.6 butir 3 dijalankan pada perangkat sungguhan.
- Perilaku Chromium `--kiosk-printing` dirujuk dari pengetahuan umum
  operasional Chromium, tidak dibuka dari dokumentasi resmi Google dalam
  riset ini; verifikasi termasuk dalam uji perangkat keras §1.6.

## Sumber

- Dokumentasi resmi Playwright — opsi jaringan `offline`:
  https://playwright.dev/docs/test-use-options
- Panduan self-hosting Next.js (kompilasi atas dokumentasi Next 16.3.4):
  https://nextjs.deployment.to/
- Dokumentasi systemd (`systemd.service`, `Restart=`, `WantedBy=`) —
  freedesktop.org, dirujuk lewat ringkasan teknis yang memuat kutipan
  halamannya; verifikasi ulang saat menulis unit di tahap pengemasan.
- Keadaan repo: `src/lib/pos-offline.ts`, `src/lib/modules.ts`,
  `src/lib/permissions.ts`, `src/components/pos/receipt-print.tsx`,
  `docker-compose.yml`, `scripts/backup.sh`, `docs/RUNBOOK-BACKUP-RESTORE.md`,
  `PROGRESS.md`, `docs/arsitektur-dalam/LAPORAN-MENDALAM.md`.
