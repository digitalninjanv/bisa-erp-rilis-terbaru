# POS-3 — Audit Lintas, Ketahanan, Keamanan & Integrasi POS

**Sikap:** adversarial — semua klaim fitur dianggap salah sampai terbukti dari kode, probe, atau test yang benar-benar dijalankan.
**Sifat:** baca-saja. Tidak ada kode/migrasi diubah; tidak ada commit; perusahaan demo tidak disentuh. Probe memakai perusahaan fixture khusus `01900000-…-e807` (dibuat & dihapus oleh test probe itu sendiri; berkas probe dihapus dari repo sesudah dijalankan).
**Tanggal:** 2026-11-04.

## Vonis ringkas

Fondasi POS online **kuat dan terbukti**: isolasi tenant RLS lulus probe langsung, idempotensi checkout tahan balapan, harga/diskon selalu dihitung ulang di server, sesi kas hanya bisa dimanipulasi pemiliknya, void penjualan berpagar izin khusus.

Kelemahan terkonsentrasi di **offline POS** — fitur termuda (SIM-2 S7B-2, status resmi PARTIAL, uji browser NOT TESTED). Mesin antrean dan idempotensinya benar, tetapi **model kepemilikan sinkronisasi salah secara akuntansi**: penjualan offline menempel pada siapa pun yang menyinkron, bukan pada kasir/sesi asalnya; antrean di atas 50 transaksi tidak akan pernah bisa disinkron; dan perubahan harga di antara antre & sinkron diserap diam-diam atau menggagalkan penjualan yang sudah dibayar pelanggan. Dua temuan keamanan di jalur online: **harga pokok bocor ke kasir** lewat payload aksi, dan **kasir dapat membatalkan penerimaan piutang** hanya dengan izin menjual.

**Jumlah temuan: 18 — P0: 0 · P1: 5 · P2: 6 · P3: 7.**

---

## A. Offline POS & sinkronisasi

### POS3-01 (P1) — Antrean > 50 transaksi tidak akan pernah tersinkron

- **Bukti:** klien mengirim SELURUH antrean dalam satu panggilan (`src/components/pos/pos-terminal.tsx:767` — `syncOfflineSalesAction({ items })` atas `storage.list()` tanpa pemotongan), sedangkan skema aksi membatasi `items: z.array(...).min(1).max(50)` (`src/server/actions/pos-offline.ts:49`). Probe P-G (fixture e807): batch 51 item → `result.ok === false`, **0 penjualan tercatat** — penolakan bersifat keseluruhan, bukan per item.
- **Dampak:** toko yang padam seharian penuh mudah melewati 50 nota. Mulai saat itu sinkronisasi gagal total selamanya (setiap percobaan mengulang penolakan yang sama), antrean lokal terus tumbuh, dan satu-satunya jalan keluar adalah menghapus antrean — yaitu menghilangkan penjualan yang barang & uangnya sudah berpindah. Ini meniadakan janji inti §12 "tidak kehilangan transaksi" tepat pada skenario yang paling membutuhkannya.
- **Arah perbaikan:** potong batch di klien (mis. 25 item/panggilan, loop sampai antrean habis) dan/atau naikkan plafon server dengan tetap memproses per item dalam transaksi sendiri (pola isolasi per item sudah ada di aksi).

### POS3-02 (P1) — Penjualan offline menempel pada PENYINKRON, bukan kasir asal

- **Bukti:** payload antrean (`src/lib/pos-offline.ts:27-39`) tidak membawa identitas kasir, perangkat, atau sesi asal sama sekali. Sinkronisasi memanggil `createSale` dengan `userId = ctx.user.id` milik penyinkron (`src/server/actions/pos-offline.ts:71-79`), dan `createSale` menulis `cashierId: input.userId`, `sessionId` = sesi terbuka penyinkron, mutasi kas ke sesi itu, serta audit atas nama itu (`src/server/pos.ts:578-588, 837, 955-966`). Probe P-B: penjualan yang disinkron manajer tercatat `cashierId = MANAGER`, `sessionId = sesi manajer`, satu-satunya `cash_movements` bertipe sale berada di sesi manajer. Probe P-F: diskon manual 50% pada item antrean **ditolak saat `canDiscount=false` dan lolos saat `canDiscount=true` milik penyinkron** — hak diskon yang dinilai bukan milik kasir yang memberi diskon di meja kas; audit `pos.discount.override` pun akan menamai penyinkron.
- **Dampak:** (1) riwayat & pertanggungjawaban penjualan bergeser ke orang yang salah; (2) uang tunai penjualan offline masuk hitungan `expectedCash` sesi orang lain (lihat POS3-03 untuk penggandaan); (3) kasir tanpa hak diskon dapat menitipkan diskon besar ke antrean lalu meminta manajer "menyinkronkan" — gerbang POS-DISC-01 terlewati secara prosedural, dan jejak auditnya justru menunjuk manajer.
- **Arah perbaikan:** payload wajib membawa `cashierId` asal + penanda perangkat/sesi asal; sinkron menilai hak diskon kasir asal; penjualan ditempelkan ke sesi asal bila masih terbuka, atau ke sesi kliring offline khusus milik kasir asal bila sesi asal sudah tutup (dengan persetujuan supervisor tercatat) — bukan ke sesi penyinkron.

### POS3-03 (P1) — Tanpa sesi terbuka milik penyinkron, seluruh antrean gagal; pemulihan memaksa distorsi kas

- **Bukti:** `createSale` menolak bila aktor tidak punya sesi kas terbuka (`src/server/pos.ts:578-588`). Probe P-A: item valid disinkron tanpa sesi → status `failed`, pesan "Buka sesi kas terlebih dahulu…". `docs/sim2/LAPORAN-AKHIR.md` §6 mengakui kendala ini, tetapi tidak menarik konsekuensi kasnya.
- **Dampak:** pola padam paling umum — koneksi pulih sesudah ganti shift/hari, sesi kasir asal sudah ditutup — membuat SEMUA item gagal. Padahal uang tunai offline itu kemungkinan besar sudah terhitung fisik saat tutup sesi asal dan selisihnya sudah terjurnal (kas lebih). Bila keesokan harinya seseorang membuka sesi dan menyinkron, mutasi kas yang sama masuk lagi ke `expectedCash` sesi baru: kas tercatat ganda terhadap laci, dan jurnal selisih hari pertama menjadi salah. Tidak ada jalur pemulihan lain — halaman peninjauan hanya bisa menandai "selesai/buang", tidak bisa memposting penjualan (lihat POS3-06).
- **Arah perbaikan:** bersama POS3-02 — tempelkan ke sesi asal; bila sesi asal tertutup, sediakan jalur posting terlambat berpersetujuan supervisor yang menjurnal ke akun kas (bukan ke sesi tertutup/asing) dengan keterangan "penjualan offline terlambat".

### POS3-04 (P2) — Perubahan harga di antara antre & sinkron: diserap diam-diam atau menggagalkan penjualan yang sudah lunas

- **Bukti:** payload tidak menyimpan harga/total hasil quote offline; sinkron menghitung ulang dari harga master TERKINI (`createSale` → `quoteCart`, `src/server/pos.ts:144 dst.`). Probe P-C: harga naik 15.000 → 20.000 sesudah antre, pembayaran antrean 15.000 → `failed` "Pembayaran kurang 5000…" — padahal pelanggan sudah membayar lunas dan pergi membawa barang. Probe P-D: harga turun ke 10.000, pembayaran 15.000 tunai → `synced` dengan `sales.total = 10000` dan **`changeTotal = 5000` (kembalian semu yang tidak pernah diberikan)**, pendapatan terjurnal 10.000 — toko mencatat lebih rendah dari yang diterima, dan selisihnya hilang dari pembukuan.
- **Dampak:** integritas pendapatan & kepercayaan pelanggan; sengketa tidak dapat diselesaikan karena tidak ada catatan harga saat transaksi terjadi.
- **Arah perbaikan:** simpan snapshot harga satuan + total quote di payload; saat sinkron, bandingkan dengan hitungan server: selisih nol → posting; selisih → status konflik khusus "harga berubah" yang menampilkan kedua total di daftar peninjauan. Jangan pernah mengarang kembalian.

### POS3-05 (P2) — Daftar peninjauan mengganda setiap percobaan dan tidak pernah bersih sesudah sukses

- **Bukti:** `processOfflineSaleItem` menyisipkan baris `outbox` BARU pada setiap percobaan (`src/server/pos-offline.ts:49-70`); tidak ada penutupan baris pending lama untuk `clientKey` yang sama. Probe P-E: item konflik diproses 2× → 2 baris pending untuk clientKey yang sama; sesudah stok ditambah dan percobaan ke-3 `synced`, **2 baris konflik lama tetap pending**.
- **Dampak:** halaman peninjauan membengkak dan berbohong — item yang sudah tercatat tampak masih bermasalah; manajer dapat "membuang" baris basi itu sambil mengira membuang penjualan hidup, atau sebaliknya mengabaikan konflik sungguhan di antara tumpukan basi.
- **Arah perbaikan:** pada `record()`, tutup (processed_at + penanda superseded) semua baris pending terdahulu untuk `clientKey` yang sama, atau jadikan outbox upsert per clientKey dengan penghitung percobaan.

### POS3-06 (P2) — Kasir dapat "membuang" jejak server satu-satunya dari penjualan offline yang gagal

- **Bukti:** `resolveOfflineOutboxAction` hanya mensyaratkan `pos.sell` (`src/server/actions/pos-offline.ts:90`); halaman peninjauan memberi tombol kelola ke setiap pemegang `pos.sell` (`src/app/app/pos/offline/page.tsx` — `canManage = can(ctx, "pos.sell")`). Peran kasir bawaan memiliki `pos.sell` (`src/lib/permissions.ts` — cashier).
- **Dampak:** untuk penjualan konflik/gagal, baris outbox adalah satu-satunya catatan di server bahwa transaksi itu pernah ada (penjualan tidak tercatat, stok tidak bergerak). Kasir yang sama yang mengantrekan dapat menandainya `discarded` dari daftar — audit `pos_offline.resolve` memang ditulis, tetapi itu deteksi sesudah fakta untuk tindakan yang menghapus bukti transaksi beruang tunai.
- **Arah perbaikan:** naikkan gerbang penyelesaian peninjauan ke izin setara supervisor (mis. `pos.void` atau izin baru `pos.offline.resolve` untuk manajer+); kasir cukup melihat status antreannya sendiri.
...[truncated 10928 chars]
### POS3-07 (P2) — Deteksi offline bertumpu pada `navigator.onLine`; koneksi putus di tengah checkout tidak dialihkan ke antrean

- **Bukti:** pengalihan ke antrean hanya terjadi bila `posOfflineEnabled && !navigator.onLine` pada saat tombol bayar ditekan (`pos-terminal.tsx:1129`). `navigator.onLine` hanya menyatakan ada antarmuka jaringan — nilainya tetap `true` saat LAN hidup tetapi server/internet mati. Bila koneksi putus di tengah `checkoutAction`, jalur tangkapannya (`pos-terminal.tsx:1225-1231`) hanya menampilkan "Checkout gagal. Periksa koneksi lalu coba lagi." — tidak ada tawaran "simpan ke antrean offline".
- **Yang terbukti aman:** keranjang tidak dibersihkan dan kunci idempotensi tidak diganti pada kegagalan (diganti hanya sesudah sukses, `pos-terminal.tsx:1223`), sehingga coba-ulang manual aman dari dobel catat (klaim kunci POS-IDEM-01 di `pos.ts:514-540`).
- **Dampak:** pada gangguan paling umum (server mati, internet putus lokal tetapi Wi-Fi tersambung) terminal berperilaku seperti tidak punya mode offline; kasir harus menebak untuk mencoba lagi nanti, dan transaksi yang "gagal" di layar tetapi sebenarnya ter-commit di server mengandalkan coba-ulang berkunci yang sama untuk terungkap.
- **Arah perbaikan:** pada kegagalan jaringan checkout (bukan penolakan bisnis), tawarkan/aktifkan penyimpanan ke antrean offline bila saklar aktif; perlakukan kegagalan fetch aksi server sebagai sinyal offline, bukan hanya `navigator.onLine`.

### POS3-08 (P3) — Penjualan terantre tidak memberi bukti apa pun ke pelanggan

- **Bukti:** sesudah `enqueueOfflineSale`, terminal hanya menampilkan toast dan membersihkan keranjang (`pos-terminal.tsx:1149-1168`); komentar kode sendiri menegaskan "TANPA nomor nota (belum tercatat)". Tidak ada nota sementara bercap clientKey/"belum tercatat", dan penjualan tidak tampak di Riwayat sampai tersinkron.
- **Dampak:** pelanggan membayar & membawa barang tanpa bukti pembelian; pengembalian/keluhan di hari yang sama tidak dapat diverifikasi; toko tidak dapat membedakan "sudah dibayar tunai" dari klaim.
- **Arah perbaikan:** cetak nota sementara berisi clientKey, rincian, total, dan cap tegas "NOTA SEMENTARA — belum tercatat di sistem".

### POS3-09 (P3) — Daya tahan antrean: fallback memori senyap & antrean bersama per profil browser

- **Bukti:** `getBrowserOfflineStorage()` jatuh ke `MemoryOfflineStorage` bila `indexedDB` tidak terdefinisi (`src/lib/pos-offline.ts:144-151`) — antrean itu hilang saat reload tanpa peringatan berbeda dari mode persisten. Antrean IndexedDB terikat profil browser: dua kasir yang bergantian memakai profil yang sama berbagi satu antrean (memperbesar POS3-02), dan perangkat/profil yang rusak sebelum sinkron berarti penjualan hilang tanpa jejak di mana pun.
- **Arah perbaikan:** tampilkan peringatan eksplisit bila penyimpanan hanya memori; pertimbangkan penanda kasir/perangkat per item (sekalian memperbaiki POS3-02) dan ekspor antrean darurat.

---

## B. Keamanan & izin

### POS3-10 (P1) — Harga pokok (cost) bocor ke kasir lewat payload pencarian & quote

- **Bukti:** `searchProducts` memproyeksikan `costPrice: products.costPrice` pada kedua cabangnya (`src/server/catalog.ts:269, 292`). Gerbangnya hanya `pos.sell` (`src/server/actions/pos.ts:61`), dan halaman POS menyematkan hasil yang sama sebagai produk awal (`src/app/app/pos/page.tsx:30`). `quoteAction` (juga hanya `pos.sell`) mengembalikan `QuoteResult` utuh yang per barisnya memuat `unitCost` (`src/server/pos.ts:79, 396`). Peran kasir bawaan sengaja TIDAK diberi `inventory.cost` ("Gudang: lihat harga beli", `src/lib/permissions.ts`) — tetapi menerima seluruh data pokok itu di setiap respons aksi, terbaca lewat perkakas pengembang/jaringan browser. Komponen POS tidak pernah menampilkan nilai ini (pencarian `costPrice|unitCost|margin` di `src/components/pos/` & halaman POS: nol hasil) — paparannya murni kelebihan kirim, tanpa kebutuhan UI.
- **Dampak:** margin & harga beli — data yang oleh desain peran dinyatakan bukan hak kasir — dapat dibaca, dicatat, dan dipakai (mis. untuk tawar-menawar di luar sistem atau kebocoran ke pesaing). Ini kegagalan otorisasi di lapisan proyeksi, bukan sekadar tampilan.
- **Arah perbaikan:** buat proyeksi khusus POS tanpa `costPrice`/`unitCost` (domain tetap memakai biaya secara internal dari baris DB, bukan dari hasil quote yang dikirim ke klien); uji regresi: respons aksi untuk peran kasir tidak memuat kolom biaya.

### POS3-11 (P1) — Kasir dapat membatalkan penerimaan piutang (pembalikan uang masuk) hanya dengan izin menjual

- **Bukti:** `voidReceivablePaymentAction` digerbang `requirePermissionInModule("pos.sell", "pos")` (`src/server/actions/pos.ts:467`) — izin yang dimiliki kasir. Bandingkan `voidSaleAction` yang mensyaratkan `pos.void` (manajer+). Aksi ini membalik jurnal penerimaan (`reverseJournalEntry`), menandai pembayaran void, dan membuka kembali piutang penjualan mana pun di perusahaan — termasuk penerimaan via transfer bank yang dicatat akuntan, bukan hanya penerimaan di meja kas. Alasan wajib dan baris audit `ar.payment.void` ditulis (`src/server/actions/pos.ts:545-558`) — deteksi ada, pencegahan tidak.
- **Dampak:** pola fraud klasik menjadi mungkin bagi kasir: batalkan penerimaan → piutang tampak belum dibayar → "tagih" kembali tunai ke pelanggan → kantongi. Asimetri dengan void penjualan menunjukkan kelas tindakan yang sama (membalik dokumen uang terposting) digerbang tidak konsisten.
- **Arah perbaikan:** samakan gerbangnya ke `pos.void`; atau batasi kasir pada penerimaan yang ia catat sendiri di sesi terbukanya, sisanya supervisor.

### POS3-12 (P2) — Tidak ada mekanisme persetujuan supervisor di terminal (PIN/otorisasi seketika)

- **Bukti:** PROGRESS.md D-10 mencatat eksplisit "Otorisasi PIN supervisor TIDAK dibangun (belum ada penyimpanan PIN di sistem)". Diskon di atas ambang dinilai dari izin AKTOR yang login (`quoteCart` via `canDiscount`, `src/server/pos.ts:427-437`). Tidak ada jalur bagi manajer mengotorisasi satu transaksi tanpa menyerahkan sesi loginnya.
- **Dampak:** tekanan operasional nyata: terminal cenderung dibiarkan login sebagai manajer agar diskon sah tidak tersangkut — yang meniadakan seluruh RBAC kasir (termasuk gerbang void & sesi) pada praktiknya. Risiko ini prosedural, bukan bug kode, tetapi menentukan nilai nyata semua gerbang lain.
- **Arah perbaikan:** bangun PIN supervisor ter-hash per pengguna berizin `pos.discount`/`pos.void`: otorisasi per transaksi tercatat di audit sebagai pemberi persetujuan, sesi tetap milik kasir.

### POS3-13 (P3) — Pesanan ditahan lintas-kasir: dapat dilanjutkan & DIHAPUS kasir lain, penghapusan tanpa audit dan bersifat hard-delete

- **Bukti:** `resumeHeldSaleAction` dan `deleteHeldSaleAction` hanya mensyaratkan `pos.sell` tanpa cek kepemilikan (`src/server/actions/pos.ts:302-361`); penghapusan menjalankan `delete from sale_lines` + `delete from sales` secara fisik dan tidak menulis baris audit (berbeda dari hampir semua mutasi POS lain yang teraudit).
- **Dampak:** terbatas (tahanan belum memposting uang/stok), tetapi pesanan pelanggan yang diparkir kasir A dapat dihapus kasir B tanpa jejak — sabotase/kehilangan pesanan yang tak dapat dijelaskan.
- **Arah perbaikan:** batasi hapus ke pemilik tahanan atau pemegang `pos.void`; tulis audit `pos.held.delete`; pertimbangkan soft-delete.

### POS3-14 (P3) — Riwayat transaksi terbuka untuk semua kasir (termasuk penjualan kasir lain)

- **Bukti:** `/app/pos/riwayat` digerbang `pos.sell` dan `listSales` tidak disaring per kasir (`src/app/app/pos/riwayat/page.tsx:26-44`); ringkasan periode (total penjualan & diskon) tampil untuk semua. Halaman sendiri menyatakannya sebagai desain ("Semua nota penjualan…").
- **Dampak:** rendah–sedang dan sebagian disengaja untuk toko kecil; tetapi memperluas permukaan POS3-11 (kasir dapat memetakan penerimaan mana yang layak dibatalkan) dan membocorkan kinerja rekan. Catat sebagai keputusan desain yang sebaiknya dibuat eksplisit per perusahaan (saklar "kasir hanya melihat transaksinya sendiri").

### Yang TERBUKTI kuat di keamanan (jangan diutak-atik tanpa bukti baru)

- **RLS tenant:** probe katalog langsung — 89/89 tabel ber-`company_id` berstatus `relrowsecurity=t, relforcerowsecurity=t` dan memiliki policy. Probe sebagai `app_user` (koneksi `DATABASE_URL`): dengan konteks perusahaan e806, baris `sales`/`outbox` milik perusahaan lain terbaca **0**; tanpa konteks perusahaan sama sekali juga **0** (fail-closed).
- **Kepemilikan sesi:** tutup sesi & mutasi laci menyaring `userId = aktor` sehingga sesi orang lain terbaca "tidak ditemukan" (`pos.ts:2216-2240, 2292-2310`); buka sesi ganda dicegah indeks unik parsial + terjemahan eror (POS-SES-01).
- **Diskon & harga:** harga selalu dari DB (input `unitPrice` klien diabaikan domain); diskon manual dinilai persen EFEKTIF terhadap bruto dan ambang ditegakkan di fungsi yang sama untuk quote & checkout; baris produk duplikat ditolak agar ambang tak diakali (T3R-1/T3R-6).
- **Pembayaran piutang:** akun penerimaan divalidasi daftar-putih (metode aktif / pemetaan kas-bank-QRIS; metode kredit dikecualikan) — POS-PAY-01.
- **Idempotensi online:** klaim kunci lebih dulu di dalam transaksi yang sama; pemenang balapan dibaca ulang, bukan eror generik (POS-IDEM-01).

---

## C. Performa & skala

### POS3-15 (P3) — Pencarian kata kunci POS ±180 ms pada katalog 100 ribu produk (trade-off terdokumentasi)

- **Bukti:** benchmark resmi S4 (`docs/sim2/S4-BENCHMARK.md`): pada 100.000 produk, "POS cari kata" 177,8–186,1 ms dan barcode 185,3–200,6 ms, tidak membaik oleh indeks karena pola `ilike '%q%'` (`src/server/catalog.ts:304-308`) tidak dilayani b-tree dan trigram sengaja tidak dipakai ulang (bukti RLS S4; keputusan tercatat "jangan memasang trigram lagi tanpa bukti baru"). Pada 10.000 produk: ±20 ms — nyaman. Kisi kosong diperbaiki indeks nama (2,7 ms). Terminal memberi debounce 220 ms (`pos-terminal.tsx:489-514`).
- **Penilaian:** dapat diterima pada skala target (minimarket ≤ ±10 ribu SKU); menjadi keluhan nyata di atas ±50 ribu SKU, terutama karena pencarian berjalan per ketikan. Pagination kisi berbasis offset terurut nama (`catalog.ts:280-282`) memadai untuk kedalaman halaman yang wajar.
- **Arah perbaikan (bila skala menuntut):** batasi pencarian substring ke awalan SKU/nama terindeks untuk query pendek, atau kolom pencarian ternormalisasi — dengan bukti benchmark baru, bukan mengembalikan trigram.

### POS3-16 (P3) — Throughput sinkronisasi: sekuensial, satu transaksi penuh per item

- **Bukti:** `syncOfflineSalesAction` memproses item satu per satu, masing-masing `withCompany` + checkout penuh (`src/server/actions/pos-offline.ts:66-79`). Untuk batch sah 50 item dengan jurnal & mutasi lengkap, ini detik-detik, bukan menit — bukan masalah pada plafon saat ini; menjadi relevan hanya bila POS3-01 diperbaiki dengan menaikkan plafon tanpa memikirkan waktu tunggu terminal (aksi berjalan sinkron dalam satu request HTTP).
- **Arah perbaikan:** bila plafon dinaikkan, pertahankan pemotongan klien per ±25 item agar setiap request tetap singkat dan kemajuan terlihat per potong.

---

## D. Integrasi POS ↔ akuntansi ↔ stok

### POS3-17 (P2) — Tanggal penjualan offline vs periode fiskal tertutup: gagal berulang tanpa jalan keluar

- **Bukti:** payload membawa `date` hari offline (`pos-terminal.tsx:1138`); sinkron meneruskannya ke `createSale`, yang memposting jurnal pada tanggal itu (`pos.ts:1010-1019`) — `postJournal` menegakkan `assertPeriodOpen`. Padam yang melewati tutup buku (akhir bulan) membuat item `failed` permanen; setiap coba-ulang menambah baris peninjauan (POS3-05). Nomor dokumen pun diambil dari urutan tanggal offline (`nextDocumentNumber(..., input.date)`), bercampur ke bulan tertutup. Tidak ada opsi tanggal posting pengganti berpersetujuan di jalur peninjauan.
- **Dampak:** penjualan sah akhir bulan yang tersinkron awal bulan berikutnya tidak dapat dicatat pada tanggal aslinya maupun tanggal berjalan — buntu administratif di fitur yang justru dirancang untuk keadaan darurat.
- **Arah perbaikan:** pada peninjauan, izinkan supervisor memilih "posting pada tanggal berjalan" dengan tanggal asal tersimpan sebagai keterangan & audit; bedakan status gagal-periode dari gagal lain agar tidak tercampur.

### POS3-18 (P3) — Klasifikasi konflik tidak konsisten untuk produk serial/batch saat sinkron

- **Bukti:** hanya eror berkode `INSUFFICIENT_STOCK` yang dipetakan ke status `conflict`; semua eror lain `failed` (`src/server/pos-offline.ts:136-142`). Nomor seri yang sudah terjual ke orang lain selama offline melempar eror validasi dari `consumeSerials` → tercatat `failed` ("dapat dicoba lagi") padahal tidak akan pernah bisa dicoba lagi — sama menyesatkannya dengan POS3-04 tetapi di klasifikasi.
- **Arah perbaikan:** petakan juga konflik seri habis/terpakai ke status konflik dengan pesan spesifik.

### Yang TERBUKTI kuat di integrasi

- **Satu transaksi, satu kebenaran:** checkout menulis penjualan, baris, pembayaran, mutasi stok (termasuk irisan FEFO batch & konsumsi seri), mutasi kas sesi, jurnal (pendapatan bruto + diskon contra + PPN + HPP), dan audit dalam satu transaksi DB yang sama (`createSale`, `pos.ts:828-1057`) — tidak ada jendela POS-tercatat-tetapi-jurnal-tidak.
- **Produk non-stok/jasa:** baris `trackStock=false` dilewati penuh oleh mutasi & HPP (tidak ada stok negatif semu), dan void mengikuti jejak yang sama (`pos.ts:927-929, 1317-1319`). Produk batch dinilai dari ketersediaan segar (kedaluwarsa tidak pernah ter-quote) per tanggal jual.
- **Void vs retur:** penjualan ber-retur terposting tidak dapat di-void (T4R-1) dan void membalik penerimaan piutang satu per satu (AK3-01) — keduanya terverifikasi pada audit akuntansi FIX-P1 dengan angka.
- **Laporan:** pendapatan POS masuk jurnal sumber `sale` sehingga laporan penjualan (Riwayat, berbasis dokumen) dan jurnal pendapatan (berbasis GL) berasal dari penulisan yang sama; rekonsiliasi kontrol FIX-R2 menutup sisi GL vs subledger piutang/persediaan secara periodik.

---

## Matriks klaim vs bukti

| Klaim | Status | Bukti |
|---|---|---|
| Antrean offline di IndexedDB, dedupe per clientKey | **TERBUKTI** | `src/lib/pos-offline.ts`; 4 test unit lulus (dijalankan ulang auditor: 7/7 bersama test integrasi) |
| Sinkron idempoten — kirim ulang tidak menggandakan | **TERBUKTI** | Test resmi `pos-offline-sync.test.ts` (duplikat → saleId sama, stok berkurang tepat sekali); mekanisme kunci sama dengan POS-IDEM-01 |
| Konflik stok tidak dipaksakan, masuk peninjauan | **TERBUKTI** | Test resmi + probe P-E (status `conflict`, baris pending) |
| Saklar offline per perusahaan menegakkan di server | **TERBUKTI** | Test resmi gerbang `assertOfflineEnabled` |
| "Tidak kehilangan transaksi" (§12/§17) | **KLAIM TERLALU LUAS** | Gugur pada: antrean > 50 (POS3-01), sesi tutup (POS3-03), harga berubah (POS3-04), periode tutup (POS3-17), perangkat hilang (POS3-09) |
| Uji browser offline sungguhan | **TIDAK-TERUJI** | Diakui resmi: LAPORAN-AKHIR §6/§17 "NOT TESTED", acceptance manual 4 langkah belum dijalankan; tidak ada test e2e offline (`grep` di `e2e/`: nol) |
| Indikator status sinkron jujur ke kasir | **SEBAGIAN** | Badge Online/Offline + hitungan antre + tombol sinkron + toast hasil per kategori terbukti di kode (`pos-terminal.tsx:1345-1378`, `755-793`); tetapi status per item (konflik terakhir per nota) hanya terlihat di halaman peninjauan, bukan di terminal; dan deteksinya sendiri rapuh (POS3-07) |
| Kasir tidak dapat melihat harga pokok | **SALAH (terbukti bocor)** | POS3-10 |
| Aksi sensitif butuh supervisor | **SEBAGIAN** | Void penjualan & diskon > ambang: ya (izin). Void penerimaan piutang & buang peninjauan: tidak (POS3-11, POS3-06). PIN seketika: tidak ada (POS3-12) |
| Isolasi antarperusahaan | **TERBUKTI** | Probe katalog 89/89 + probe baca lintas-tenant 0 baris (lihat B) |
| Performa katalog besar | **TERBUKTI (dengan batas)** | Benchmark S4 pada 10 ribu/100 ribu produk; lihat POS3-15 |

## Lampiran — probe yang dijalankan auditor

1. **Probe RLS (SQL langsung, koneksi `app_user`):** konteks perusahaan asing → `sales` lintas-tenant terbaca 0, `outbox` 0; tanpa konteks → 0. Katalog: 0 dari 89 tabel ber-`company_id` tanpa RLS paksa.
2. **Test probe fixture e807 (7 test, semua lulus — lulus = perilaku yang diduga terbukti ada):** P-A gerbang sesi; P-B atribusi penyinkron; P-C harga naik → failed; P-D harga turun → total baru + kembalian semu 5.000; P-E duplikasi & kebasian baris peninjauan; P-F hak diskon penyinkron; P-G batch 51 ditolak keseluruhan. Berkas probe `tests/integration/zz-pos3-probe.test.ts` dibuat khusus, dijalankan, lalu **dihapus**; fixture DB dibersihkan oleh `afterAll`-nya sendiri.
3. **Test resmi dijalankan ulang:** `tests/sim2/pos-offline-sync.test.ts` + `tests/unit/pos-offline-queue.test.ts` → 7/7 lulus.
4. **Pemeriksaan statis:** `pos.ts` (2.360 baris), `pos-offline.ts` (server & lib), aksi POS & offline, `catalog.ts`, `permissions.ts`, terminal POS, halaman riwayat/offline, skema & migrasi RLS 0001, benchmark S4, LAPORAN-AKHIR SIM-2 §6/§17, PROGRESS.md (D-10, D-24).
