# Arsitektur Offline POS — Sumber Kebenaran

Dokumen resmi hasil **A-24 Tahap T6** (pembuktian offline POS), ditulis
2026-11-06. Status fitur sebelum T6: **PARTIAL / uji browser NOT TESTED**
(sejak SIM-2). Sesudah T6: **TERBUKTI BEKERJA** untuk tiga skenario di
bawah pada Chromium sungguhan melawan server produksi lokal, dengan dua
cacat nyata ditemukan dan diperbaiki (T6-01, T6-02). Batas yang tetap
NOT TESTED dinyatakan jujur di §9.

**Pembaruan T6B (2026-11-06):** pengerasan PWA terbatas yang
direkomendasikan §8 **sudah dibangun dan terbukti** — service worker
meng-cache shell terminal sehingga reload saat server mati kini
membuka terminal dari cache pada secure context (hasil lengkap di
§6.1, rancangan & jebakan scope di §8, batas yang tersisa di §9).

Konfigurasi: offline POS adalah **saklar per perusahaan**
(`company_settings.pos_offline_enabled`, bawaan **mati**). Bukti di
dokumen ini diambil dengan saklar perusahaan demo dinyalakan, lalu
dikembalikan mati dan demo di-reseed ke baseline (65 produk,
Rp28.349.600).

---

## 1. Model source-of-truth

- **Server (PostgreSQL) adalah satu-satunya otoritas** atas stok,
  jurnal, dan kas sesi. Tidak ada posting yang sah di luar server.
- **Terminal adalah snapshot**: katalog produk (harga, stok), quote,
  dan sesi kas yang tampil di terminal adalah salinan pada saat
  halaman dimuat/diperbarui — dapat basi, dan memang dirancang untuk
  basi dengan aman (lihat aturan konflik §4).
- **Antrean lokal adalah outbox niat, bukan ledger**: penjualan yang
  diantrekan di IndexedDB peramban (`bisa-pos-offline`, store `sales`)
  adalah *niat transaksi* bertanda tangan kunci idempotensi. Ia tidak
  mengubah stok/jurnal/kas apa pun sampai server memprosesnya.
- **Total offline adalah estimasi** (`expectedTotal`): dihitung dari
  harga snapshot katalog. Server menghitung ulang secara otoritatif
  saat sinkron; selisih tidak pernah diposting senyap — ia menjadi
  konflik peninjauan (§4).

## 2. Identitas transaksi & idempotensi

Satu identitas mengalir utuh dari terminal sampai jurnal:

```
clientKey (UUID, dibuat terminal per percobaan penjualan)
  = kunci primer baris IndexedDB antrean
  = sales.idempotency_key (unik per perusahaan) saat terposting
  = payload.clientKey pada baris outbox peninjauan
```

- Kunci **berotasi** sesudah setiap penjualan/percobaan, sehingga dua
  penjualan berbeda tidak pernah berbagi kunci.
- Jalur tangkap (checkout melempar, T6-02) memakai **kunci yang sama**
  dengan yang baru saja dikirim ke server (`attemptKey` dibekukan di
  awal pembayaran): bila penjualan ternyata sempat terposting sebelum
  koneksi putus, sinkron antrean dijawab `duplicate` — tidak pernah
  posting kedua.
- Server memeriksa `sales.idempotency_key` **sebelum** menilai apa
  pun: kunci yang sudah terposting selalu `duplicate`, walau harga
  dan stok sudah berubah.
- Terbukti (Skenario A): payload yang sama dikirim ulang lewat aksi
  sinkron menghasilkan `duplicate` dan jumlah penjualan untuk kunci
  itu tetap **1**.

## 3. Urutan sinkron

1. Pemicu: terminal termuat (mount), peristiwa `online` peramban,
   atau tombol **Sinkronkan** pada chip antrean.
2. Antrean dibaca FIFO; dikirim dalam **potongan 25 item** per
   panggilan aksi `syncOfflineSalesAction`.
3. Setiap item diproses server dalam **transaksinya sendiri**
   (`processOfflineSaleItem`): kegagalan satu item tidak membatalkan
   item lain dalam potongan yang sama.
4. Hasil per item diterapkan kembali ke antrean lokal:
   `synced`/`duplicate` → item **dihapus** dari antrean;
   `conflict`/`failed` → item **bertahan** dengan `lastStatus`/
   `lastError` dan dicerminkan ke antrean peninjauan server.
5. Peninjauan server disimpan sebagai baris `outbox`
   (`event_type = 'pos_offline_sale'`). Hasil semua status dicatat
   sebagai jejak audit; hanya `conflict`/`failed` yang berstatus
   *pending*. Hasil sinkron yang lebih baru untuk `clientKey` yang
   sama **menggantikan (supersede)** baris pending sebelumnya.
6. Sesudah potongan tersinkron, halaman terminal menyegarkan data
   server (`router.refresh()`), sehingga stok/katalog kembali
   otoritatif.

Penjualan tersinkron diposting lewat jalur dokumen yang **sama**
dengan checkout online (`postSaleDocuments`): stok AVCO, jurnal
seimbang, dan kas sesi identik mekanismenya — terbukti angka di
Skenario A §6.

**Penyelesaian oleh supervisor** (halaman `/app/pos/offline`,
Peninjauan Sinkronisasi Offline): setiap item pending dapat
**Posting ulang**, **Selesaikan pada harga struk** (hanya konflik
harga-turun), **Pindahkan ke sesi asal** (konflik sesi), **Tandai
selesai**, atau **Buang** dengan alasan wajib — semua teraudit di
baris outbox. Item lokal di terminal kasir asal dibersihkan pada
sinkron berikutnya (status peninjauan server menang).

## 4. Aturan konflik

Server menilai ulang setiap item antrean terhadap keadaan **saat
sinkron**, bukan saat penjualan:

| Keadaan saat sinkron | Hasil | kind | Penjelasan kasir |
|---|---|---|---|
| Kunci sudah terposting | `duplicate` | — | Dianggap selesai; tidak posting ulang |
| Semua cocok (total snapshot = total kini, stok cukup) | `synced` | — | Terposting ke sesi yang sedang terbuka |
| Harga berubah, total kini **naik** dari struk | `failed` | `price` | "Harga berubah sejak transaksi — Struk Rp X · kini Rp Y · selisih Rp Z" |
| Harga berubah, total kini **turun** | `conflict` | `price` | Supervisor dapat menyelesaikan pada harga struk |
| Stok tidak cukup (dan perusahaan melarang stok negatif) | `conflict` | `stock` | "Stok <produk> tidak cukup. Tersedia N" |
| Tidak ada sesi kas terbuka | `failed` | `session` | Ditinjau supervisor |
| Sesi asal payload ≠ sesi terbuka saat ini | `conflict` | `session_closed` | Dapat dipindah ke sesi asal atau diposting ulang |
| Kasir asal tidak lagi berhak atas sesi/perusahaan | `failed` | `origin_ineligible` | Ditinjau supervisor |
| Periode akuntansi tertutup | `failed` | `period` | Ditinjau supervisor |
| Payload tidak valid / kegagalan lain | `failed` | `other` | Tanpa baris peninjauan (gagal sebelum pencatatan) |

Prinsip yang dijaga kontrak ini: **tidak ada penjualan ganda**
(idempotensi), **tidak ada penjualan hilang diam-diam** (item gagal
bertahan di antrean lokal *dan* antrean peninjauan server), dan
**tidak ada posting pada harga/stok yang sudah berubah tanpa manusia
meninjau**.

## 5. Perbaikan T6 — cacat yang dibuktikan skenario

Eksplorasi Chromium headed (Xvfb) sebelum perbaikan membuktikan
mekanisme antrean+sinkron sendiri sehat, tetapi **tak terjangkau**
dalam dua keadaan nyata:

### T6-01 — Keranjang yang dibangun saat offline tidak bisa dibayar

Quote keranjang adalah server action; tanpa jaringan ia melempar,
tombol Bayar nonaktif berlabel kegagalan, total Rp 0 — antrean
offline tidak pernah tercapai untuk keranjang yang *dibangun/diubah*
saat offline. Hanya keranjang yang sudah ter-quote sebelum putus
yang bisa diantrekan ("jalur sempit").

**Perbaikan** (tanpa mengubah tampilan terminal): fungsi murni
`computeLocalOfflineQuote` di `src/lib/pos-offline.ts` mencerminkan
aritmetika `src/server/pos/quote.ts` memakai primitif uang yang sama
(`src/lib/money.ts`): harga master katalog, diskon baris, pajak
inklusif, pembulatan kelompok kas, else mode pembulatan perusahaan.
`use-quote.ts` memakai quote lokal **hanya** bila panggilan server
*melempar* (kegagalan transportasi) dan saklar offline perusahaan
menyala; putusan domain server (`{ ok: false }`) tidak pernah
digantikan. Batas yang disengaja: aturan harga *kelompok pelanggan*
per produk tidak diketahui klien (yang dipakai harga master) —
selisihnya diselesaikan kontrak §4 sebagai konflik harga di
peninjauan. Produk di luar katalog lokal → quote tetap gagal jujur.
Ambang diskon manual supervisor tetap wewenang server saat sinkron
(quote lokal tidak pernah mengesahkannya).

*Uji regresi:* `tests/unit/pos-offline-local-quote.test.ts` — 8 test
(RED 8/8 sebelum fungsi ada, GREEN 8/8 sesudahnya): multi-baris,
pajak inklusif 11%, diskon persen & nominal terjepit bruto,
pembulatan `nearest_500` (7.300 → 7.500), pembulatan kelompok kas
mengalahkan mode perusahaan, produk tak dikenal → null, baris
serial → null.

### T6-02 — Server mati (bukan "offline" peramban) tidak mengantrekan

`navigator.onLine` bernilai true saat server mati; checkout
dicoba, melempar, dan handler lama hanya menampilkan toast gagal —
antrean tetap kosong (penjualan hilang bila kasir tidak mencatat
manual), walau keranjangnya sendiri bertahan.

**Perbaikan:** blok pengantrean diekstrak menjadi satu fungsi
`queueSaleOffline(...)` di terminal yang dipakai dua pemicu —
peramban-offline sebelum kirim, dan **catch checkout melempar** —
dengan kunci idempotensi percobaan yang sama (§2).

### T6-03 — Reload/navigasi awal tanpa service worker

Tanpa service worker/manifest, membuka atau me-reload terminal saat
server tak terjangkau menghasilkan halaman galat peramban
(`ERR_CONNECTION_REFUSED`). Ini keadaan arsitektur saat ini, bahan
keputusan §8 — bukan cacat yang ditambal diam-diam di T6.
**Status sesudah T6B: TERTUTUP pada secure context** oleh service
worker shell terminal (§8); di luar secure context (LAN http://IP)
keadaan ini masih berlaku apa adanya (§9).

### T6-04 — Pencarian produk offline terbatas katalog termuat

Pencarian mengetik memanggil server; saat tak terjangkau ia gagal
(toast jujur "Pencarian produk gagal"), tetapi katalog awal yang
sudah termuat (halaman pertama, 24 produk pada demo) tetap dapat
diklik dan dijual. Produk di luar halaman termuat tidak terjangkau
sampai terminal memuat ulang katalog. Dicatat sebagai batas (§9),
bukan diubah di T6.

### Sentuhan di luar lib offline — dinyatakan

Perbaikan dibatasi sesuai mandat; tiga sentuhan di luar
`src/lib/pos-offline.ts` diperlukan dan dinyatakan di sini:
`src/components/pos/use-quote.ts` (fallback quote lokal pada
lemparan transportasi), `src/components/pos/pos-terminal.tsx`
(ekstraksi `queueSaleOffline`, kunci percobaan beku, penerusan
konfigurasi quote lokal — **tanpa mengubah tampilan/markup**), dan
`src/app/app/pos/page.tsx` (meneruskan tarif pajak efektif & mode
pembulatan perusahaan yang sudah termuat sebagai data halaman).
Tidak ada perubahan pada aksi server sinkron maupun halaman
Peninjauan — kontraknya terbukti benar oleh Skenario C.

## 6. Hasil skenario pembuktian (2026-11-06)

Kriteria kuantitatif ditulis **sebelum** skenario dijalankan.
Spec: `e2e/pos-offline.spec.ts` (Skenario A & C, harness Playwright
melawan server produksi lokal); Skenario B skrip profil persisten
terpisah. Putaran headed (Xvfb) atas spec A+C: **3 passed**.

### Skenario A — offline di tengah sesi: **PASS**

Terminal termuat → `context.setOffline(true)` → tiga keranjang
**dibangun sesudah** jaringan putus (mustahil sebelum T6-01):

| Penjualan | Isi | Bayar | Total |
|---|---|---|---|
| Kontrol (online, sebelum putus) | Aqua 600ml ×2 | Tunai | Rp8.000 |
| A1 | Aqua 600ml ×2 | Tunai | Rp8.000 |
| A2 | Beng Beng ×3 | QRIS | Rp9.000 |
| A3 | Coca Cola 390ml ×2 | Tunai 10.000 + QRIS 4.000 | Rp14.000 |

Ketiganya masuk antrean IndexedDB (`expectedTotal` 8000/9000/14000).
Jaringan kembali → sinkron tuntas, antrean kosong. Verifikasi DB:

- **Jurnal A1 identik multiset-nya dengan jurnal kontrol** (baris
  debit/kredit per akun sama persis) — penjualan offline yang
  tersinkron akuntansi-identik dengan penjualan online yang sama.
- Stok Gudang Utama turun tepat: Aqua −4 (kontrol+A1), Beng Beng −3,
  Coca Cola −2.
- Kas sesi: metode Tunai **+Rp26.000** (kontrol 8.000 + A1 8.000 +
  bagian tunai A3 10.000).
- **Idempotensi**: payload A1 dikirim ulang ke aksi sinkron →
  `duplicate`; jumlah penjualan untuk clientKey A1 tetap **1**.

### Skenario B — server dimatikan sungguhan: **PASS dengan catatan §9**

Profil peramban **persisten** (meniru mesin kasir; antrean harus
selamat dari peramban ditutup):

1. Terminal termuat, server dibunuh (SIGKILL, port terkonfirmasi
   mati). Peramban tetap merasa "online".
2. Keranjang **baru** dibangun: Aqua ×2 → tombol **"Bayar Rp 8.000"
   aktif** dari quote lokal (pra-perbaikan: mustahil, lihat T6-01/
   T6-02). Klik Bayar → checkout melempar → **jalur catch
   mengantrekan** penjualan.
3. Browser automation mati tak lama sesudah klik pada VM uji ini
   (lihat §9) — tetapi antrean IndexedDB **selamat di profil disk**.
4. Profil dibuka lagi dengan server hidup (B2): sinkron mount
   memposting penjualan itu — antrean **0**, stok Aqua **106 → 104**
   (delta tepat −2), penjualan terposting bertotal **Rp8.000**
   berkunci idempotensi `bc01e0ad-bf56-4652-8e0d-adecd113d50c`.
5. **Reload saat server mati**: halaman galat peramban
   `ERR_CONNECTION_REFUSED` ("This site can't be reached") — tanpa
   service worker terminal **tidak dapat dibuka sama sekali** saat
   server tak terjangkau. Terbukti pada eksplorasi pra-perbaikan;
   perbaikan T6 tidak menambah service worker sehingga perilaku ini
   tidak berubah (bahan §8).

### Skenario C — konflik harga & stok: **PASS**

Terminal memuat snapshot lalu offline; menjual Fanta ×1 (snapshot
Rp7.000) dan Ember ×1 (snapshot stok 6) ke antrean. Perangkat lain
(online) menaikkan harga Fanta → **Rp7.500** dan mengosongkan stok
Ember (membeli seluruh stok di POS-nya). Terminal online → sinkron:

- Kedua item **tertahan** di antrean lokal berstatus; **tidak ada
  penjualan** untuk kedua clientKey; jumlah penjualan perusahaan
  hanya +1 (pembelian perangkat lain itu sendiri).
- Baris peninjauan server: Fanta `failed` kind **`price`**, Ember
  `conflict` kind **`stock`**, keduanya pending.
- Halaman `/app/pos/offline` menampilkan keduanya berpenjelasan:
  "Harga berubah sejak transaksi … Struk Rp 7.000 · kini Rp 7.500 ·
  selisih Rp 500" dan "Konflik stok — Stok Ember Plastik 10L tidak
  cukup" (tangkapan `skenario-c-peninjauan.png`).
- Supervisor membuang kedua item dari halaman peninjauan; antrean
  lokal terminal dibersihkan; harga & stok dipulihkan lewat UI.

## 6.1 Hasil T6B — skenario B diulang dengan service worker (2026-11-06)

Kriteria ditulis sebelum dijalankan (RENCANA T6B). Dua jalur bukti:

**Spec harness** `e2e/pos-pwa.spec.ts` (server dikelola Playwright,
"jaringan mati" = emulasi `setOffline`): SW terdaftar dengan scope
tepat `/app/pos` & mengendalikan terminal; halaman di luar scope
(`/app/gudang`) tidak dikendalikan; reload saat jaringan mati membuka
terminal dari cache; penjualan dari halaman cache mengantre lalu
tersinkron dengan total & stok cocok di DB. **PASS.**

**Skrip terpandu profil persisten** (server dibunuh sungguhan;
skrip, log & tangkapan di `~/workspace/bukti-a24/t6b/`):

1. Server produksi lokal menyala → login → terminal dibuka: SW
   terdaftar & aktif, scope `http://localhost:3000/app/pos`, halaman
   terkendali (`clients.claim` — terkendali sejak muatan pertama).
   Penjualan pemanasan online Aqua ×1 Rp4.000 berjalan normal.
2. Server di-**SIGKILL**; port 3000 terkonfirmasi mati.
3. **RELOAD → terminal TERBUKA dari cache** — katalog, sesi, dan
   panel pembayaran ter-render penuh (tangkapan
   `skenario-b-reload-dari-cache.png`). Di T6 langkah yang sama
   menghasilkan `ERR_CONNECTION_REFUSED`.
4. Penjualan baru dibangun dari halaman cache: Aqua ×2 → quote lokal
   "Bayar Rp 8.000" → checkout melempar → jalur tangkap T6-02
   mengantrekan (clientKey `d15ee076-…`, expectedTotal 8000).
5. Profil peramban ditutup; server dinyalakan; profil dibuka lagi →
   sinkron mount menuntaskan antrean (0). Verifikasi DB: nota
   **INV-2026-00004** bertotal Rp8.000; stok Aqua **116 → 114**;
   kas sesi **+Rp8.000**; jurnal penjualan seimbang.

**Temuan implementasi T6B-01 (jebakan scope, terbukti empiris):**
pencocokan scope service worker adalah pencocokan *awalan string* —
scope `/app/pos/` **tidak pernah** mengendalikan halaman beralamat
tepat `/app/pos` (worker terdaftar & `activated`, tetapi nol halaman
terkendali dan reload offline tetap gagal; dibuktikan juga pada
server kontrol polos: `/sub` tak terkendali oleh scope `/sub/`,
`/sub/` & `/sub/page` terkendali). Karena itu worker dilayani dari
akar sebagai `/pos-sw.js` dan didaftarkan dengan scope tepat
`/app/pos`. Konsekuensi awalan yang diterima sadar: rute hipotetis
berawalan `/app/pos` (mis. `/app/posisi`) ikut tercakup scope —
tidak ada rute seperti itu; dan penangan fetch worker toh hanya
menjawab dokumen terminal persis serta aset statis.

## 7. Dasar keputusan penyebaran (dari RISET-TEKNOLOGI §1)

| Model | Vonis riset | Kaitan bukti T6 |
|---|---|---|
| (a) Server lokal di toko | Model utama untuk 1 toko: terminal = peramban di LAN, server di mesin toko | Skenario B adalah kegagalannya (server mati) — antrean + profil persisten menutupnya begitu server hidup lagi |
| (b) PWA (manifest + service worker) | **Pelengkap pengerasan**, sesudah model utama terbukti — bukan fondasi | Bukti B §8 |
| (c) Tauri/Electron | **Ditunda**: backend tetap butuh server; Tauri memakai WebKitGTK (mesin berbeda dari Chromium uji), Electron berat; Chromium kiosk memberi ~90% manfaat kiosk | Tidak ada bukti T6 yang mengubah vonis ini; pemicu evaluasi ulang tetap uji perangkat keras (cetak senyap) |
| (d) Cloud + offline lokal | Mekanisme antrean memang dirancang untuk ini | Skenario A adalah simulasinya persis (jaringan putus di tengah sesi) dan lulus angka |

## 8. Butir bersyarat PWA — bukti dan rekomendasi

Klausul rencana: pengerasan PWA terbatas (manifest + service worker
yang hanya meng-cache shell terminal, **tanpa mengubah desain**)
dikerjakan **bila** bukti reload/navigasi awal menuntutnya **dan**
Pemimpin memutuskan.

**Bukti (Skenario B butir 5):** tuntutan itu ada. Tanpa service
worker, terminal yang belum termuat — atau yang di-reload — saat
server mati menampilkan halaman galat peramban; kasir kehilangan
akses ke katalog & antrean sampai server hidup. Dengan shell
ter-cache, terminal tetap *terbuka* pada snapshot terakhir dan
seluruh kontrak §2–§4 (antrean, quote lokal, konflik peninjauan)
tetap bekerja, karena semua mekanismenya memang sisi-klien.

**Rekomendasi kepada Pemimpin (keputusan akhir di Pemimpin;
tidak dibangun oleh T6):** bangun pengerasan terbatas itu sebagai
tahap tersendiri, dengan dua syarat jujur dari riset §1(b):

1. Service worker hanya terdaftar pada *secure context* (HTTPS atau
   `localhost`) — penyebaran LAN dengan IP mentah via HTTP tidak
   akan mendaftarkannya; model alamat toko harus diputuskan dulu.
2. Shell ter-cache membawa katalog snapshot terakhir kali termuat —
   harga/stok basi ditangani kontrak konflik §4 yang sudah terbukti,
   tetapi kesegaran katalog antar-reload offline adalah batas yang
   harus diterima sadar.

**Keputusan & realisasi (T6B, 2026-11-06): DIBANGUN** sebagai tahap
tersendiri persis dalam batas di atas. Rancangannya:

- **Manifest** `src/app/manifest.ts` (konvensi App Router Next →
  `/manifest.webmanifest`, tertaut otomatis): nama "Bisa POS",
  `start_url` & `scope` `/app/pos`, `display: standalone`, ikon PNG
  192/512 di `public/` (dibangkitkan `scripts/generate-pwa-icons.mjs`,
  tanpa dependensi grafis), warna mengikuti tema aplikasi.
- **Service worker** `public/pos-sw.js`, didaftarkan hanya oleh
  halaman terminal dan hanya bila saklar `pos_offline_enabled`
  menyala (komponen tak terlihat
  `src/components/pwa/pos-service-worker.tsx`; saklar dimatikan →
  pendaftaran dicabut). Scope tepat `/app/pos` — alasan penempatan
  berkas di akar adalah jebakan awalan scope T6B-01 (§6.1).
- **Kontrak cache yang dikunci test** (`tests/unit/pos-pwa-sw.test.ts`,
  perilaku worker disimulasikan dalam vm): hanya navigasi dokumen
  `/app/pos` yang dicegat — *network-first* (jawaban jaringan selalu
  menang & memperbarui cache; cache hanya bila jaringan melempar) —
  dan aset immutable `/_next/static/*` + manifest/ikon secara
  *cache-first*. POST Server Action, permintaan RSC, API, dan
  navigasi halaman lain **tidak dicegat sama sekali**: tidak ada
  respons data bisnis yang pernah disajikan dari cache sebagai data
  segar. Salinan dokumen dibersihkan dari `Set-Cookie` sebelum
  disimpan. Header `Cache-Control: no-cache` untuk `/pos-sw.js`
  diatur di `next.config.ts` agar pembaruan worker segera terambil.
- **Pemanasan cache:** saat install, worker mem-precache dokumen
  terminal + aset statis yang dirujuk HTML-nya (upaya terbaik);
  kunjungan online normal memperbarui & melengkapinya (chunk jalur
  bayar ikut ter-cache begitu dipakai, meniru kasir yang sudah
  berjualan). Reload offline pertama sesudah pendaftaran pun sudah
  terbukti membuka terminal (§6.1).

## 9. Batas jujur & yang tetap NOT TESTED

- **Perangkat fisik NOT TESTED**: printer thermal, scanner barcode
  HID, laci uang, dan timbangan belum pernah diuji pada perangkat
  sungguhan (daftar uji di RISET-TEKNOLOGI §1.6). Semua bukti T6
  adalah Chromium (Playwright, headless & headed Xvfb) melawan
  server produksi lokal di VM yang sama — bukan mesin kasir fisik.
- **Kematian browser automation pada fase server-mati**: pada VM uji
  (RAM ±8 GB dipakai bersama server+DB+peramban), proses Chromium
  automation mati beberapa menit sesudah checkout melawan server
  mati — tidak terjadi pada aliran `setOffline`, tidak terjadi pada
  eksplorasi pra-perbaikan, dan tidak menghilangkan data (antrean
  profil persisten utuh, B2). Atribusi pastinya (tekanan memori
  lingkungan vs perilaku klien saat action gagal beruntun) belum
  terpisah; dicatat apa adanya agar tidak terbaca sebagai bukti
  perilaku di perangkat kasir sungguhan. (Catatan T6B: pada putaran
  skenario B ulang §6.1, automation bertahan melewati seluruh fase
  server-mati sampai sinkron tuntas — gejala T6 tidak terulang;
  atribusi asalnya tetap belum terpisah.)
- **Dua tab terminal bersamaan** pada fase server-mati juga membuat
  browser automation mati lebih cepat pada percobaan awal T6;
  terminal memang dirancang satu tab per mesin kasir.
- **Pencarian offline** terbatas katalog yang sudah termuat (T6-04);
  produk di luar halaman katalog awal tidak terjangkau offline.
- **Harga kelompok pelanggan** tidak dihitung quote lokal (harga
  master yang dipakai); selisih diselesaikan sebagai konflik harga
  di peninjauan (§4), bukan posting senyap.
- **Terminal yang dibuka dari cache mensyaratkan secure context &
  kunjungan online sebelumnya** (keadaan sesudah T6B): service
  worker hanya terdaftar pada HTTPS atau `localhost` — terminal di
  mesin yang sama dengan server (localhost) memetik manfaatnya;
  **terminal LAN via http://IP mentah BUKAN secure context sehingga
  worker tidak terdaftar di sana dan reload saat server mati tetap
  halaman galat peramban** (HTTPS lokal/sertifikat internal adalah
  keputusan & pekerjaan lanjutan pemilik, bukan bagian T6B). Shell
  juga hanya ada bila terminal pernah dibuka selagi online dengan
  saklar offline menyala; dan yang dilayani cache adalah muatan
  ulang/navigasi penuh — transisi navigasi sisi-klien *menuju*
  terminal dari halaman lain saat server mati tidak dijanjikan.
  Dokumen ter-cache dirender dari snapshot sesi terakhir di mesin
  itu; ia tidak membuka data server apa pun di luar snapshot yang
  memang sudah ter-render di mesin kasir tersebut, dan posting
  tetap mustahil tanpa sesi sah saat sinkron (§1–§2).
- Uji beban antrean besar (ratusan penjualan offline) belum
  dilakukan; sinkron per potongan 25 terverifikasi pada volume
  skenario saja.
