# Audit Kode — POS + Pengaturan / Lintas-Modul (Bisa ERP)

- **Tanggal:** 2026-11-03 · **Jenis:** audit baca-saja (read-only), tidak ada kode sumber yang diubah.
- **Cakupan:** `src/app/app/pos/**`, `src/components/pos/**`, `src/server/pos.ts`, `src/server/actions/pos.ts`, `src/app/app/pengaturan/**`, `src/components/pengaturan/**`, `src/server/actions/settings.ts`, `src/server/actions/users.ts`, `src/server/sequences.ts`, `src/lib/permissions.ts`, `src/lib/modules.ts`, plus berkas pendukung yang dirujuk langsung (`src/server/catalog.ts`, `src/server/inventory.ts`, `src/server/reports.ts`, `src/server/accounting.ts`, `src/lib/session.ts`, `src/lib/money.ts`, `src/db/schema.ts`, `tests/**`).
- **Metode:** membaca kode baris demi baris dan membuktikan/menolak klaim README + `AGENTS.md` dari kode. Klaim yang tidak bisa dibuktikan dari kode statis ditandai **NOT_VERIFIED** (perlu uji runtime/DB/browser).
- **Status:** `WORKING` = terbukti benar di kode · `PARTIAL` = jalan sebagian / ada cacat terbatas · `BROKEN` = terbukti salah di kode · `NOT_IMPLEMENTED` = tidak ada di kode · `NOT_VERIFIED` = tidak bisa diputuskan dari kode saja.

## Ringkasan eksekutif

Fondasi POS sebenarnya kuat: harga dihitung ulang di server, checkout memakai fungsi quote yang sama dengan pratinjau, stok dikunci baris (`FOR UPDATE`) saat mutasi, jurnal penjualan terstruktur benar, dan hampir semua server action menegakkan `requirePermission`. Masalahnya terkonsentrasi pada **konsistensi angka di permukaan** (nota & keranjang menambahkan pajak dua kali), **alur sekunder yang tidak seketat checkout** (pesanan ditahan kehilangan kelompok harga; retur tanpa kunci baris; tukar barang dijurnal sebagai kas keluar), **semantik sesi kas yang bertolak belakang antara UI dan server**, dan **satu celah eskalasi hak akses** (admin non-owner bisa me-reset kata sandi owner).

**Jumlah temuan: 39 — P0: 1 · P1: 7 · P2: 19 · P3: 12.**

---

## Tabel fitur — POS

| Fitur | Status | Bukti file:baris | Dampak |
|---|---|---|---|
| Harga dihitung di server (harga klien tidak dipercaya) | WORKING | `src/server/pos.ts:182` memakai `products.salePrice`; field `unitPrice` di `src/server/actions/pos.ts:24` diterima skema tetapi tidak pernah dipakai domain | Manipulasi harga dari klien tidak bisa; konsekuensinya kasir juga tidak bisa override harga sama sekali |
| Quote = checkout (sumber hitung sama) | WORKING | `src/server/pos.ts:324-330` `createSale` memanggil `quoteCart` yang sama; `src/server/actions/pos.ts:107-122` meneruskan `groupId` yang sama | Total pratinjau dan total final konsisten — khusus jalur checkout langsung |
| Diskon grup per produk (persen / harga tetap) + pembulatan harga grup | WORKING | `src/server/pos.ts:186-201` (aturan dibatasi 0..harga normal, dibulatkan, lalu dibatasi lagi ke harga normal) | Sesuai aturan proyek |
| Diskon manual menumpuk di atas harga grup, tidak melebihi bruto | WORKING | `src/server/pos.ts:204-225`; `src/lib/money.ts:119-133` (persen dari harga grup; nominal per unit, dibatasi bruto baris) | Cap total = bruto terbukti; catatan: `discountType/Value` tersimpan di baris adalah diskon manual terakhir (menimpa tipe aturan grup) — jumlah rupiah tetap benar |
| Diskon manual tanpa batas & tanpa izin khusus | BROKEN | Skema keranjang `src/server/actions/pos.ts:22-28`; diterapkan `src/server/pos.ts:204-214`; tidak ada izin `pos.discount` di `src/lib/permissions.ts:4-20` | Lihat POS-DISC-01 (P1) |
| Pembulatan total tunai kelompok (`roundCashTotal`) | WORKING | `src/server/pos.ts:258-275`; mode disimpan ke `sales.rounding_mode` | Jurnal selisih ke akun pembulatan laba/rugi juga dibuat (`src/server/pos.ts:556-601`) |
| Pembayaran campuran (mixed) | PARTIAL | Server `src/server/pos.ts:377-449`; UI `src/components/pos/pos-terminal.tsx:840-890` | Lihat POS-PAY-02 (P2): pembayaran non-tunai yang berlebih dipotong diam-diam; kembalian campuran di UI tidak memakai uang diterima (tendered) |
| Kembalian tunai (mode tunggal) | WORKING | `src/server/pos.ts:392-398`; UI `src/components/pos/pos-terminal.tsx:303-315` | Kembalian = tendered − porsi tunai yang dibatasi ke sisa tagihan |
| Metode kredit disembunyikan di POS | WORKING | `src/app/app/pos/page.tsx:48` memfilter `type !== "credit"`; `checkoutAction` (`src/server/actions/pos.ts:90-126`) bahkan tidak menerima `customerId`, jadi jalur kredit di domain tidak terjangkau dari POS | Sesuai aturan proyek (POS tanpa pemilih pelanggan terbukti: terminal hanya punya pemilih kelompok, `pos-terminal.tsx:560-585`) |
| Stok dicek & berkurang atomik | WORKING | Cek awal `src/server/pos.ts:339-343`; mutasi mengunci baris stok `src/server/inventory.ts:48-65` dan menolak hasil negatif → seluruh transaksi rollback | Dua kasir berebut stok terakhir tidak bisa oversell; cek quote per baris bisa menyesatkan untuk produk yang sama di dua baris, tetapi mutasi tetap menolak |
| Produk non-`trackStock` tetap dipotong stoknya | BROKEN | Sentinel stok hanya untuk tampilan/cek `src/server/pos.ts:256`; loop mutasi `src/server/pos.ts:518-533` tidak memeriksa `trackStock` | Lihat POS-STK-01 (P2) |
| Jurnal otomatis penjualan | WORKING | `src/server/pos.ts:556-601`: debit kas/bank per akun metode + piutang + diskon (contra-revenue) + selisih pembulatan rugi; kredit pendapatan bruto setelah pajak + PPN keluaran + pembulatan laba; HPP/persediaan terpisah. `postJournal` menegakkan seimbang + periode terbuka `src/server/accounting.ts:100-113` | Struktur sesuai aturan proyek; validasi kepemilikan akun di `postJournal` tidak ada (lihat POS-PAY-01) |
| Idempotency checkout | PARTIAL | Cek awal `src/server/pos.ts:302-317`; unique index `src/db/schema.ts:667`; kunci klien `src/components/pos/pos-terminal.tsx:118` hanya diganti setelah sukses (baris 380-387) | Klik ganda sekuensial aman; balapan konkuren dan replay-setelah-edit bermasalah — lihat POS-IDEM-01 (P2) |
| Wajib sesi kas untuk menjual | WORKING | `src/server/pos.ts:345-358` menolak tanpa sesi terbuka milik kasir itu sendiri | — |
| Void dengan alasan & izin | PARTIAL | Action mewajibkan `pos.void` + alasan ≥3 `src/server/actions/pos.ts:210-222`; domain mengunci baris, membalik stok+jurnal, mencatat mutasi kas & audit `src/server/pos.ts:682-760` | Parameter `pin` di skema tidak pernah diverifikasi dan UI tidak pernah memintanya — lihat POS-VOID-01 (P3) |
| Retur: sisa qty yang bisa diretur dijaga | PARTIAL | `src/server/pos.ts:815-845` menghitung retur sebelumnya dan menolak kelebihan | Penjagaan membaca snapshot **tanpa** mengunci baris penjualan — lihat POS-RET-01 (P1) |
| Retur tukar barang (exchange) | BROKEN | Akun penyelesaian jatuh ke `map.cash` untuk `refundMethod` selain transfer/store_credit `src/server/pos.ts:890-900`; tidak ada penjualan pengganti yang dibuat | Lihat POS-RET-02 (P1) |
| Refund tunai retur dicatat ke sesi asal | BROKEN | `src/server/pos.ts:935-950` memakai `sale.sessionId` walau sesi itu mungkin sudah ditutup | Lihat POS-RET-02 (P1) |
| Sesi kas buka/tutup & selisih | PARTIAL | Buka `src/server/pos.ts:1041-1080`; tutup menghitung expected dari mutasi dan menjurnal selisih `src/server/pos.ts:1083-1154` | Kepemilikan sesi tidak diperiksa saat tutup/mutasi; balapan buka ganda — lihat POS-SES-01 (P2) |
| Setoran / penarikan kas | BROKEN | UI: "Setoran menambah kas laci. Penarikan mengurangi, misalnya untuk setor ke bank" `src/components/pos/session-manager.tsx:222-226`; server: deposit bertanda **negatif** `src/server/pos.ts:1179` dan jurnalnya Dr Bank / Cr Kas (kas keluar ke bank) `src/server/pos.ts:1190-1207`; ringkasan menampilkan total deposit apa adanya (negatif) `src/server/reports.ts:813-819` | Lihat POS-CASH-01 (P1) |
| Pesanan ditahan (hold/resume/hapus) | BROKEN | Terminal mengirim hold **tanpa** `groupId` `src/components/pos/pos-terminal.tsx:400-417`; action membuangnya `src/server/actions/pos.ts:128-150`; domain `holdSale` tidak punya parameter grup `src/server/pos.ts:605-627` | Lihat POS-HOLD-01 (P1) dan POS-HOLD-02 (P2) |
| Nota cetak ulang dari data server | PARTIAL | Halaman nota membaca ulang dari DB `src/app/app/pos/nota/[id]/page.tsx:27-40` via `getSaleDetail` (`src/server/reports.ts:751-780`) | Angka per baris salah (pajak ganda) — lihat POS-RCPT-01 (P1); total & pembayaran benar |
| Jumlah per baris di keranjang & nota | BROKEN | `pos-terminal.tsx:671`, `nota/[id]/page.tsx:125`, estimasi retur `retur/page.tsx:69-70` semuanya `lineTotal + taxAmount`, padahal `lineTotal` sudah termasuk pajak (pajak inklusif `src/server/pos.ts:217-240`; pendapatan diakui `subtotal − pajak`) | Lihat POS-RCPT-01 (P1) |
| Pencarian produk & barcode | PARTIAL | Server: barcode eksak diprioritaskan `src/server/catalog.ts:149-175`, limit 24; klien debounce 220 ms `pos-terminal.tsx:158-168`, Enter menambahkan hasil pertama `pos-terminal.tsx:464-475` | Lihat POS-SCAN-01 (P2) dan POS-SRCH-01 (P2) |
| Katalog awal POS | PARTIAL | Halaman memuat 24 produk `src/app/app/pos/page.tsx:35-40`; cabang query tanpa kata kunci **tidak mengembalikan kolom stok** `src/server/catalog.ts:124-140` | Semua kartu awal tampil stok 0 (merah) — bagian dari POS-SRCH-01 |
| Shortcut keyboard | PARTIAL | Hanya F2 fokus cari, Enter tambah, Esc `pos-terminal.tsx:238-247, 464-475` | Tidak ada shortcut bayar/tahan/pindah metode — kasir tetap mouse-sentris untuk langkah akhir |
| Penanganan error klien | BROKEN | Tidak ada `try/catch/finally` di seluruh `src/components/pos/pos-terminal.tsx` (checkout baris 320-390, pencarian baris 145-168) | Lihat POS-ERR-01 (P2) |
| Offline POS | NOT_IMPLEMENTED | Tidak ada service worker / IndexedDB / antrean sinkron di `src/**`; satu-satunya `localStorage` adalah preferensi tampilan `src/components/pos/pos-display.tsx:39-89` | Keranjang hilang saat reload/crash; penjualan mustahil saat koneksi putus — nilai jujur: **tidak ada mode offline** |
| Pembayaran piutang dari POS | PARTIAL | `payReceivableAction` cukup dengan `pos.sell` `src/server/actions/pos.ts:244-277` | `accountId` bebas tanpa validasi — lihat POS-PAY-01 (P1) |

## Tabel fitur — Pengaturan & lintas-modul

| Fitur | Status | Bukti file:baris | Dampak |
|---|---|---|---|
| Pengaturan umum (identitas, NPWP, alamat, gudang default, stok negatif) | WORKING | `src/server/actions/settings.ts:29-80`; form `src/components/pengaturan/settings-forms.tsx:137-242` | Tersimpan + audit `settings.update` |
| Tarif pajak per perusahaan | PARTIAL | Skema hanya `z.union([string, number])` tanpa rentang `src/server/actions/settings.ts:24`, disimpan `toDb` apa adanya baris 51; input teks bebas `settings-forms.tsx:196-199` | Lihat SET-TAX-01 (P2): tarif negatif / >100% lolos |
| Pengaturan pembulatan perusahaan (`roundingMode`) | BROKEN | Disimpan `settings.ts:18,44`; **tidak ada kontrol UI** yang mengikatnya (`settings-forms.tsx` hanya menyebutnya di tipe & submit); `roundTotal` (`src/lib/money.ts:77`) tidak pernah dipanggil jalur POS — quote hanya memakai pembulatan kelompok | Lihat SET-RND-01 (P2). Halaman nota bahkan menampilkannya seolah aktif (`nota/[id]/page.tsx:191-194`) |
| Nota & printer (header/footer, lebar, logo/kasir/pajak) | PARTIAL | `settings-forms.tsx:91-135`; dipakai nota `nota/[id]/page.tsx:70-190` | Header nota justru dirender di **bawah** nota (baris 186-190), bukan di atas — lihat SET-RCPT-01 (P3) |
| Unggah QRIS | WORKING | Klien batasi 600 KB + tipe gambar `settings-forms.tsx:200-235`; server `startsWith("data:image/")` + maks 900 KB `settings.ts:316-335` | QRIS statis saja (sesuai batasan README) |
| Metode pembayaran: tambah | WORKING | `settings.ts:83-122` (create/update by id); form `settings-forms.tsx:300-360` | — |
| Metode pembayaran: ubah / nonaktif / hapus dari UI | NOT_IMPLEMENTED (UI) | Form hanya mode buat-baru; tabel di `pengaturan/page.tsx:186-239` tanpa kolom aksi. Server sebenarnya mendukung update bila `id` dikirim (`settings.ts:100-108`) | Lihat SET-CRUD-01 (P2). Pilihan akun juga dibatasi 3 akun hasil pemetaan (`pengaturan/page.tsx:193-200`) — lihat SET-PAY-01 (P2) |
| Metode nonaktif masih bisa dipakai checkout | BROKEN | `createSale` memuat metode tanpa filter `isActive` `src/server/pos.ts:360-368` (bandingkan daftar kasir yang difilter `src/server/catalog.ts:270-276`) | Metode yang dinonaktifkan tetap menyelesaikan penjualan bila diminta (UI basi / request langsung) |
| Kelompok harga: CRUD kelompok | PARTIAL | `settings.ts:134-215` (buat/ubah/hapus; hapus me-null-kan `customers.groupId`, aturan harga cascade `src/db/schema.ts:483-486`) | Edit diam-diam mengaktifkan lagi kelompok nonaktif — lihat SET-GRP-01 (P2) |
| Kelompok harga: aturan per produk | WORKING | `settings.ts:352-426` upsert per produk, `normal` = hapus aturan, validasi persen ≤100 & grup/produk milik perusahaan; tabel terpaginasi + cari `group-pricing.tsx:300-470`; kosongkan semua aturan `settings.ts:405-426` | Lengkap per produk; tetapi satu-satu — lihat SET-GRP-02 (P3) untuk skala besar |
| Kelompok nonaktif tetap muncul di kasir | BROKEN | `listCustomerGroups` tanpa filter aktif `src/server/catalog.ts:248-254`; halaman POS meneruskan semua `src/app/app/pos/page.tsx:79-85`; quote menolak grup nonaktif `src/server/pos.ts:98-125` | Kasir memilihnya → setiap quote error. Lihat POS-GRP-01 (P2) |
| Gudang & cabang: tambah | WORKING | `settings.ts:223-313`; form buat-baru `settings-forms.tsx:368-490` | — |
| Gudang & cabang: ubah / nonaktif / hapus dari UI | NOT_IMPLEMENTED (UI) | Tabel hanya-baca `pengaturan/page.tsx:291-390`; tidak ada action hapus gudang/cabang sama sekali di `settings.ts` | Lihat SET-CRUD-01 (P2): koreksi kode gudang salah ketik mustahil dari UI |
| Pemetaan akun otomatis | PARTIAL | Editor `settings-forms.tsx:475-560` (21 kunci); action simpan ada di `src/server/actions/accounting.ts:702-720` | Izin timpang + tanpa validasi tipe akun — lihat SET-MAP-01 (P2) |
| Penomoran dokumen bisa diatur | NOT_IMPLEMENTED | Prefix dikunci di kode `src/server/sequences.ts:5-17`; format tetap `PREFIX-TAHUN-00001` baris 20-46; tidak ada action/UI penomoran (tidak ditemukan di actions/pengaturan) | Lihat SET-NUM-01 (P2) |
| Pengguna: buat / ubah peran / reset sandi / cabut akses | PARTIAL | `src/server/actions/users.ts:42-262`; UI `src/components/pengaturan/user-access.tsx` | Penjaga owner terakhir untuk **turun peran** ada (`users.ts:140-152`), cabut akses owner diblokir total (baris 234-236), ubah peran diri sendiri diblokir (baris 117-119) — tetapi reset sandi tanpa penjaga owner: lihat SEC-01 (P0) |
| Peran kustom: buat / ubah / hapus | WORKING | `users.ts:285-393`: sanitasi izin/modul `src/lib/permissions.ts:155-167`, modul wajib punya ≥1 izin, peran bawaan tidak bisa diubah/dihapus, peran terpakai tidak bisa dihapus | Ditegakkan di server, bukan hanya UI |
| Izin ditegakkan di server action (bukan hanya menu hilang) | WORKING | Semua action POS diawali `requirePermission` (`actions/pos.ts:44,68,108,133,155,192,210,232,250,282,303,332`); Pengaturan `settings.ts:31,86,137,190,225,282,318,341,354,407`; Pengguna `users.ts:52,112,182,221,296,356`. `requireAuth` menyelesaikan peran kustom dari DB per request dan jatuh ke viewer bila peran nonaktif/hilang `src/lib/session.ts:63-105` | Menu yang disembunyikan (`src/lib/modules.ts`) hanyalah lapisan tampilan |
| Admin = semua izin | WORKING (by design, berisiko) | `src/lib/permissions.ts:76-88`: owner **dan admin** menerima seluruh `PERMISSIONS` termasuk `users.manage` | Dikombinasikan SEC-01, admin setara owner tanpa menyandang gelar owner |
| Multi-perusahaan | PARTIAL | `requireAuth` mengambil membership **terawal saja** (`orderBy asc createdAt, limit 1`) `src/lib/session.ts:44-56` | Pengguna multi-perusahaan terkunci ke perusahaan pertama; pemilih perusahaan tidak terlihat di `session.ts` — lihat LINTAS-01 (P2) |
| Kolom diskon umum kelompok (legacy) | PARTIAL | `customer_groups.discountType/discountValue` `src/db/schema.ts:362-365` berkomentar "legacy" dan tidak dibaca `quoteCart` | Data lama yang mengandalkan diskon umum kelompok tidak berpengaruh apa-apa (senyap) |

---

## Temuan

### P0 — Kritis

**SEC-01 · Admin non-owner dapat mengambil alih akun owner lewat reset kata sandi.**
`resetUserPasswordAction` (`src/server/actions/users.ts:180-225`) hanya memeriksa `users.manage` dan keanggotaan target — tidak ada penjaga "target owner hanya boleh direset owner", tidak seperti `updateUserRoleAction` (baris 131-133) dan `removeCompanyUserAction` (baris 234-236) yang sama-sama menjaga owner. Tombol reset di UI pun dirender untuk **semua** pengguna termasuk owner (`src/components/pengaturan/user-access.tsx:236-245`). Karena peran admin memiliki seluruh izin (`src/lib/permissions.ts:76-88`), seorang admin dapat me-reset sandi owner lalu masuk sebagai owner. Pencabutan sesi lama target setelah reset juga tidak terlihat di `users.ts` (NOT_VERIFIED di lapisan Better Auth).
*Rekomendasi:* terapkan penjaga yang sama seperti ubah-peran (target owner ⇒ aktor wajib owner), tolak reset untuk akun owner oleh non-owner, dan cabut sesi aktif target setelah reset.

### P1 — Tinggi

**POS-HOLD-01 · Pesanan ditahan kehilangan kelompok harga di tiga lapis sekaligus.**
`hold()` di terminal tidak mengirim `groupId` (`pos-terminal.tsx:400-417`) → `holdAction` tidak meneruskannya (`actions/pos.ts:128-150`) → `holdSale` memang tidak menerima grup dan memanggil `quoteCart` tanpa grup (`src/server/pos.ts:605-627`). Akibatnya total pesanan ditahan dihitung dengan harga normal; saat dilanjutkan, `resumeHeldSaleAction` juga tidak mengembalikan `customerGroupId` (baris 152-188) sehingga checkout final memakai harga normal — pelanggan kelompok membayar lebih mahal dari harga yang dijanjikan di layar kasir, tanpa peringatan apa pun.
*Rekomendasi:* tambahkan `groupId` end-to-end (terminal → action → `holdSale` → kolom `sales.customerGroupId` saat hold), kembalikan saat resume, dan tampilkan perbedaan harga bila harga berubah.

**POS-RCPT-01 · Angka per baris di keranjang, nota, dan estimasi retur menambahkan pajak dua kali.**
Pajak bersifat inklusif: `lineTotal = gross − diskon` sudah mengandung pajak (`src/server/pos.ts:217-240`). Namun tiga tempat menampilkan `lineTotal + taxAmount`: keranjang (`pos-terminal.tsx:671`), nota cetak ulang (`nota/[id]/page.tsx:125`), dan estimasi retur (`retur/page.tsx:69-70`, dipakai `return-form.tsx:31-34`). Bila tarif pajak > 0, jumlah baris-baris nota **tidak sama** dengan TOTAL yang tercetak di nota yang sama, dan estimasi refund retur lebih besar dari refund yang benar-benar diproses server (server memakai `lineTotal` murni, `src/server/pos.ts:840-850`).
*Rekomendasi:* tampilkan `lineTotal` apa adanya di ketiga tempat; pajak cukup sebagai baris memo "termasuk PPN".

**POS-CASH-01 · Semantik setoran/penarikan bertolak belakang antara UI, jurnal, dan ringkasan.**
Teks UI: "Setoran menambah kas laci. Penarikan mengurangi, misalnya untuk setor ke bank" (`session-manager.tsx:222-226`) — kalimatnya sendiri tertukar. Server mengartikan deposit = kas keluar ke bank: mutasi bertanda negatif (`src/server/pos.ts:1179`), jurnal Dr Bank / Cr Kas (baris 1190-1207). Ringkasan sesi menjumlahkan mutasi deposit apa adanya sehingga "setoran" tampil sebagai angka negatif (`src/server/reports.ts:813-819`, ditampilkan `session-manager.tsx:188-192`). Kasir yang mengikuti label UI akan mencatat arah yang salah dan selisih tutup sesi menjadi tidak bisa dipercaya.
*Rekomendasi:* putuskan satu definisi (disarankan mengikuti jurnal: Setor = ke bank, kas laci berkurang; Tarik = dari bank, kas laci bertambah), samakan label, teks bantuan, tanda di ringkasan, dan label mutasi.

**POS-RET-01 · Retur tidak mengunci baris penjualan — balapan retur ganda bisa melebihi qty terjual.**
`createSaleReturn` membaca penjualan tanpa `.for("update")` (`src/server/pos.ts:765-790`) lalu memvalidasi sisa retur dari snapshot `alreadyReturned` (baris 815-845). Bandingkan `voidSale` (baris 689) dan `payReceivable` (baris 986) yang mengunci. Dua retur bersamaan untuk nota yang sama dapat sama-sama lolos validasi → stok kembali berlebih dan jurnal retur ganda.
*Rekomendasi:* kunci baris `sales` di awal `createSaleReturn`, atau kunci baris `sale_return_lines` per produk; tambahkan uji integrasi konkuren.

**POS-RET-02 · Tukar barang dijurnal sebagai kas keluar; refund tunai dicatat ke sesi asal yang mungkin sudah ditutup.**
Untuk `refundMethod = "exchange"`, akun penyelesaian jatuh ke `map.cash` (`src/server/pos.ts:890-900`): jurnal mengkredit kas seolah uang keluar, padahal tidak ada uang yang dibayarkan dan tidak ada barang pengganti yang diterbitkan di sistem. Untuk refund tunai, mutasi kas ditulis ke `sale.sessionId` (baris 935-950) — sesi asal yang bisa sudah ditutup — sehingga mutasi sesi tertutup berubah setelah penutupan dan uang fisik yang keluar dari laci sesi berjalan tidak tercatat di sesinya. Kredit toko juga dikreditkan ke akun piutang (baris 893-898), menciptakan piutang negatif untuk penjualan tunai.
*Rekomendasi:* exchange jangan menjurnal kas (pisahkan alur tukar: retur + penjualan baru); refund tunai dicatat ke sesi kas **yang sedang terbuka** milik kasir pemroses (tolak bila tidak ada); kredit toko memakai akun liabilitas kredit pelanggan, bukan piutang.

**POS-PAY-01 · Pembayaran piutang oleh kasir dapat menjurnal ke akun sembarang.**
`payReceivableAction` hanya mensyaratkan `pos.sell` dan menerima `accountId` bebas (`src/server/actions/pos.ts:244-277`); domain tidak memvalidasi akun itu milik perusahaan / akun kas-bank yang postable (`src/server/pos.ts:958-1030`), dan `postJournal` sendiri tidak memvalidasi kepemilikan/jenis akun pada baris jurnal (`src/server/accounting.ts:88-145`). Kasir dapat mengarahkan debit pembayaran piutang ke akun pendapatan/beban mana pun (di kode aplikasi: juga akun perusahaan lain; penegakan RLS untuk kasus lintas-tenant ini NOT_VERIFIED).
*Rekomendasi:* validasi `accountId` ∈ akun kas/bank perusahaan yang postable, atau batasi ke akun dari metode pembayaran; pertimbangkan izin terpisah selain `pos.sell`.

**POS-DISC-01 · Diskon manual kasir tanpa batas, tanpa izin khusus, tanpa persetujuan supervisor.**
Kasir berizin `pos.sell` dapat memberi diskon persen hingga 100% atau nominal hingga bruto pada setiap baris (`src/server/pos.ts:204-225`); tidak ada izin `pos.discount`, ambang maksimal, atau PIN supervisor di mana pun di jalur ini. Satu transaksi dapat dikeluarkan dengan total Rp0 sementara stok berkurang penuh dan jurnal tetap seimbang (diskon menjadi contra-revenue) — vektor fraud klasik POS.
*Rekomendasi:* tambahkan izin `pos.discount` + ambang persen/nominal per perusahaan (pengaturan), dan otorisasi supervisor (PIN/akun) untuk diskon di atas ambang; catat diskon besar ke audit dengan identitas pemberi otorisasi.

### P2 — Sedang

**POS-IDEM-01 · Idempotency tidak tahan balapan dan kunci tidak diganti setelah kegagalan yang bisa diedit ulang.**
Pola cek-lalu-sisip (`src/server/pos.ts:302-317`) ditopang unique index (`src/db/schema.ts:667`), jadi penjualan ganda **tidak** terjadi — tetapi transaksi kedua yang kalah balapan gugur dengan error generik "Terjadi kesalahan pada server" (ditangkap `guard`, `src/lib/errors.ts`) alih-alih menerima hasil penjualan pertama. Di klien, kunci hanya diganti setelah sukses (`pos-terminal.tsx:118, 380-387`): bila checkout pertama sebenarnya tersimpan tetapi responnya hilang, lalu kasir mengubah keranjang dan membayar lagi dengan kunci yang sama, server mengembalikan penjualan lama dan klien membersihkan keranjang baru — item tambahan hilang senyap.
*Rekomendasi:* tangkap konflik unik lalu baca-ulang & kembalikan penjualan yang ada; ganti kunci setiap kali keranjang berubah setelah ada percobaan checkout.

**POS-SCAN-01 · Balapan scanner barcode: Enter dapat menambahkan produk yang salah.**
Pencarian didebounce 220 ms dan berjalan asinkron (`pos-terminal.tsx:158-168`); handler Enter menambahkan `products[0]` dari daftar saat ini (`pos-terminal.tsx:464-475`). Scanner yang mengirim kode + Enter lebih cepat dari 220 ms akan menambahkan hasil pencarian sebelumnya — atau produk pertama katalog awal — bukan barcode yang discan. Tidak ada jalur khusus barcode eksak (input cepat) yang menunggu hasil server.
*Rekomendasi:* bila input cocok pola barcode dan Enter ditekan, tunggu pencarian berjalan selesai dan cocokkan `barcode === input` secara eksak sebelum menambah; jangan pernah jatuh ke `products[0]` untuk input numerik panjang.

**POS-SRCH-01 · Pencarian memakai gudang default, bukan gudang terpilih; kartu awal selalu tampil stok 0.**
`searchProductsAction` selalu memakai `defaultWarehouseId` (`src/server/actions/pos.ts:41-53`) sementara quote/checkout memakai `selectedWarehouse` di terminal — stok hasil cari bisa milik gudang lain. Cabang query tanpa kata kunci tidak memilih kolom stok (`src/server/catalog.ts:124-140`), dan halaman POS memetakan ketiadaan kolom itu menjadi `0` (`src/app/app/pos/page.tsx:82-90`), sehingga 24 kartu produk awal selalu berlabel stok 0/merah.
*Rekomendasi:* kirim `warehouseId` terpilih ke action pencarian; samakan proyeksi kolom stok pada kedua cabang `searchProducts`.

**POS-GRP-01 · Kelompok nonaktif tetap bisa dipilih di kasir dan membuat quote gagal berulang.** Lihat tabel: `catalog.ts:248-254` tanpa filter aktif vs penolakan di `pos.ts:98-125`.
*Rekomendasi:* filter `isActive` di `listCustomerGroups` untuk konteks POS (atau teruskan status dan nonaktifkan opsi di select terminal).

**POS-REF-01 · Referensi checkout tidak divalidasi aktif/kepemilikannya di domain.**
Metode pembayaran dimuat tanpa filter `isActive` (`src/server/pos.ts:360-368`); `warehouseId` tidak pernah diperiksa milik perusahaan & aktif di `quoteCart`/`createSale` (hanya dipakai untuk stok, baris 177, 326) — berbeda dengan grup yang diperiksa lengkap (baris 98-125). Request langsung dapat memakai metode nonaktif atau id gudang perusahaan lain (baris stok akan dibuat dengan `company_id` sendiri + `warehouse_id` asing).
*Rekomendasi:* validasi gudang (milik perusahaan, aktif) dan metode (milik perusahaan, aktif) di awal `createSale`.

**POS-SES-01 · Sesi kas: kepemilikan tidak diperiksa; buka ganda tidak dicegah skema.**
`closeCashSession` dan `cashDrawerMovement` memilih sesi hanya dari `companyId + id` (`src/server/pos.ts:1083-1092, 1169-1177`) — pemegang `pos.session` mana pun dapat menutup/menggerakkan laci kasir lain. `openCashSession` berpola cek-lalu-sisip (baris 1041-1055) dan skema tidak punya unique index parsial untuk sesi terbuka per pengguna (`src/db/schema.ts:758-775` hanya index biasa), jadi dua submit bersamaan dapat membuka dua sesi.
*Rekomendasi:* tambahkan `userId` aktor pada seleksi tutup/mutasi (atau izin supervisor eksplisit), dan unique index parsial `(company_id, user_id) where status='open'`.

**POS-STK-01 · Produk non-lacak-stok tetap dibuatkan mutasi stok negatif.** `createSale` menggerakkan stok untuk semua baris (`src/server/pos.ts:518-533`) tanpa memeriksa `trackStock`; produk jasa/non-stok akan menumpuk `stock_on_hand` negatif dan kartu stok semu.
*Rekomendasi:* lewati mutasi untuk produk `trackStock = false` (HPP tetap diposting dari biaya baris).

**SET-RND-01 · Pengaturan pembulatan perusahaan mati di dua ujung.** Tidak ada kontrol UI untuk mengubah `roundingMode`, dan POS tidak pernah menerapkannya (`roundTotal` yatim selain di unit test, `tests/unit/money.test.ts:20-38`). Pengguna yang mengira telah menyetel pembulatan total dari Pengaturan tertipu — halaman nota bahkan mencetak mode itu sebagai keterangan (`nota/[id]/page.tsx:191-194`).
*Rekomendasi:* pilih satu: terapkan `roundingMode` perusahaan sebagai bawaan bila tidak ada kelompok (dan beri kontrol UI), atau hapus field dari skema/nota agar tidak menjanjikan fitur.

**SET-TAX-01 · Tarif pajak diterima tanpa rentang.** `settings.ts:24,51` — nilai negatif atau 999% lolos Zod dan langsung dipakai `lineTax` untuk semua penjualan.
*Rekomendasi:* `z.coerce.number().min(0).max(100)` + validasi klien; pertimbangkan riwayat tarif bertanggal (di luar cakupan audit ini).

**SET-CRUD-01 · CRUD Pengaturan timpang: metode pembayaran, gudang, cabang hanya bisa ditambah.**
Server mendukung update (parameter `id` di `settings.ts:100-108, 245-255, 295-305`) tetapi UI tidak pernah mengirim `id`: form selalu mode "baru" (`settings-forms.tsx:300-490`) dan tabel tanpa aksi (`pengaturan/page.tsx:186-390`). Tidak ada penghapusan gudang/cabang sama sekali; penonaktifan metode/gudang juga tidak terjangkau UI padahal kolom `isActive` ada.
*Rekomendasi:* tambahkan mode edit + saklar aktif pada ketiga form/tabel mengikuti pola `CustomerGroupManager` yang sudah lengkap.

**SET-PAY-01 · Akun metode pembayaran dibatasi hanya pada 3 akun hasil pemetaan.**
Dropdown akun form metode hanya berisi akun yang kebetulan terpetakan sebagai `cash`/`bank`/`qris` (`pengaturan/page.tsx:193-200`). Akun bank kedua tidak akan pernah bisa dipilih; bila pemetaan belum diisi, dropdown kosong tanpa penjelasan dan metode baru mustahil dibuat.
*Rekomendasi:* tawarkan semua akun kas/bank yang postable; beri petunjuk bila daftar kosong.

**SET-MAP-01 · Pemetaan akun: izin timpang dan tanpa validasi jenis akun.**
Halaman Pengaturan dibuka dengan `settings.manage` (`pengaturan/page.tsx:44`), tetapi `saveMappingAction` mensyaratkan `accounting.manage` (`src/server/actions/accounting.ts:702-720`) — peran kustom yang hanya diberi `settings.manage` dapat membuka tab Pemetaan tetapi setiap simpanan gagal FORBIDDEN. Action juga menerima akun apa pun untuk kunci apa pun (mis. akun pendapatan sebagai "Kas"), tanpa cek postable/tipe.
*Rekomendasi:* samakan izin (atau tampilkan tab sesuai izin yang benar) dan validasi tipe akun yang wajar per kunci pemetaan.

**SET-GRP-01 · Mengedit kelompok diam-diam mengaktifkannya kembali.**
Form kelompok tidak pernah mengirim `isActive` (`group-pricing.tsx:84-100`), sedangkan action update menulis `isActive: data.isActive ?? true` (`settings.ts:158-168`). Kelompok yang dinonaktifkan (lewat jalur lain/DB) akan aktif lagi setiap kali namanya disunting; dan memang tidak ada saklar nonaktif di UI kelompok sama sekali.
*Rekomendasi:* sertakan status aktif saat ini dalam payload edit dan tambahkan saklar aktif/nonaktif eksplisit.

**SET-NUM-01 · Penomoran dokumen tidak dapat dikustomisasi.**
Prefix (`INV`, `RTN`, `JE`, …) tertanam di `src/server/sequences.ts:5-17`, format dan lebar nomor tetap di baris 36-46, tidak ada pengaturan per perusahaan, tidak ada reset/penyesuaian nomor awal dari UI. `document_sequences` sebenarnya menyimpan `prefix` per perusahaan — kapasitas kustomisasi ada di skema tetapi tidak diekspos.
*Rekomendasi:* ekspos prefix + nomor awal per jenis dokumen di Pengaturan dengan validasi bentrok nomor unik.

**POS-OFF-01 · Tidak ada mode offline dan keranjang tidak persisten.**
Tidak ada service worker, IndexedDB/outbox, atau penyimpanan keranjang (grep `offline|serviceWorker|indexedDB` di `src/**` hanya menemukan preferensi tampilan, `pos-display.tsx:39-89`). Reload, crash browser, atau putus jaringan di tengah antrean = keranjang hilang dan penjualan berhenti total — di bawah standar POS minimarket modern.
*Rekomendasi:* minimal persistenkan keranjang + antrean checkout ke penyimpanan lokal dengan kunci idempotensi yang sama, lalu sinkronkan saat daring (pekerjaan besar — jadwalkan sebagai fase tersendiri, jangan diklaim ada sebelum jadi).

**POS-ERR-01 · Penolakan promise membuat terminal macet.**
`checkout()` menyetel `submitting=true` lalu `await checkoutAction(...)` tanpa `try/finally` (`pos-terminal.tsx:356-390`); `searchProducts` serupa (`pos-terminal.tsx:145-168`). Error jaringan/lemparan tak tertangkap dari server action membiarkan tombol Bayar nonaktif permanen dan/atau indikator "Mencari produk…" menggantung sampai halaman dimuat ulang.
*Rekomendasi:* bungkus semua pemanggilan action dengan `try/catch/finally`, tampilkan toast error, dan pulihkan state sibuk.

**POS-PAY-02 · Kembalian campuran menyesatkan.**
State klien menghitung kembalian campuran dari jumlah nominal (`paidAmount − total`, `pos-terminal.tsx:303-315`) dan mengabaikan kolom "Diterima" untuk tunai campuran; sebaliknya server membatasi setiap pembayaran ke sisa tagihan menurut urutan entri dan menghitung kembalian dari tendered per metode tunai (`src/server/pos.ts:377-412`). Pembayaran non-tunai yang berlebih ditampilkan sebagai "kembalian" di UI padahal QRIS/transfer tidak memberi kembalian, dan urutan pemotongan di server bergantung urutan objek entri.
*Rekomendasi:* samakan model: kembalian hanya dari kelebihan tendered tunai; tolak/beri peringatan untuk pembayaran non-tunai melebihi sisa.

**LINTAS-01 · Pengguna multi-perusahaan terkunci ke membership terawal.**
`requireAuth` selalu mengambil baris member pertama menurut `createdAt` (`src/lib/session.ts:44-56`) tanpa mekanisme ganti perusahaan di lapisan sesi. Klaim "multi-company" README benar di level skema/RLS, tetapi satu akun yang menjadi anggota dua perusahaan tidak dapat berpindah konteks.
*Rekomendasi:* tambahkan pemilih perusahaan yang menulis pilihan ke sesi/cookie dan hormati di `requireAuth`. (Keberadaan pemilih di luar `session.ts`/cakupan berkas ini: NOT_VERIFIED.)

**POS-HOLD-02 · Resume pesanan ditahan bersifat destruktif dan harga tidak dikunci.**
`resumeHeldSaleAction` **menghapus** baris pesanan ditahan di dalam aksi resume itu sendiri (`src/server/actions/pos.ts:159-185`): bila kasir membatalkan kelanjutan, pesanan hilang. Harga juga dihitung ulang dari harga produk terkini saat checkout (bukan harga saat ditahan), dan nomor pesanan ditahan sudah mengonsumsi nomor final seri `SALE` (`src/server/pos.ts:622-625`) sehingga menghapus pesanan ditahan meninggalkan lubang nomor faktur.
*Rekomendasi:* resume cukup membaca (hapus hanya setelah checkout sukses dengan referensi asal), simpan snapshot harga per baris saat hold, dan beri seri nomor terpisah untuk pesanan ditahan.

### P3 — Rendah

**POS-VOID-01 · PIN supervisor untuk void adalah parameter mati.** Skema menerima `pin` (`src/server/actions/pos.ts:213`) tetapi tidak diteruskan/diperiksa; UI void tidak meminta PIN (`sale-row-actions.tsx:19-95`). Selain itu tombol void tampil untuk status `held` (baris 57) padahal server menolaknya (`src/server/pos.ts:693`) — tombol yang selalu gagal.
*Rekomendasi:* hapus parameter & tombol mati itu, atau implementasikan PIN supervisor sungguhan.

**POS-DATE-01 · Tanggal jurnal void/mutasi/selisih kas memakai UTC, bukan zona perusahaan.** `src/server/pos.ts:718, 1107, 1196` memakai `new Date().toISOString().slice(0,10)` (UTC), sedangkan checkout memakai `todayISO()` berzona lokal (`src/lib/format.ts:3-10`). Pada 00:00–06:59 WIB jurnal pembalik bisa tercatat di hari (bahkan periode) sebelumnya.
*Rekomendasi:* pakai `todayISO()` di semua jalur server.

**SET-RCPT-01 · Header nota tercetak di bagian bawah nota.** Blok `receiptHeader` dirender setelah rincian pembayaran, tepat sebelum footer (`nota/[id]/page.tsx:186-190`), bukan di kepala nota di bawah nama toko (baris 70-76). Keterangan halaman juga menyebut "Lebar · Pembulatan {roundingMode}" yang menyesatkan (lihat SET-RND-01).
*Rekomendasi:* pindahkan header ke atas; koreksi keterangan.

**SET-GRP-02 · Aturan harga kelompok hanya bisa disetel satu produk per simpan.** `GroupPriceTable` menyimpan per baris (`group-pricing.tsx:317-345`); tidak ada terapan massal per kategori/semua produk atau impor aturan. Untuk katalog ±10.000 produk (skenario seed bulk proyek), menyetel satu kelompok secara manual tidak praktis.
*Rekomendasi:* tambah aksi massal (persen untuk kategori/hasil pencarian) yang tetap menulis baris `customer_group_prices` yang sama.

**SET-PREV-01 · Pratinjau harga grup di Pengaturan bisa berbeda dari harga POS.** Pratinjau klien (`group-pricing.tsx:330-360`) dan daftar server (`src/server/catalog.ts:430-441`) tidak membatasi hasil pembulatan ke harga normal dan memakai aritmetika `Number`, sedangkan quote POS membatasi ke harga normal dengan Decimal (`src/server/pos.ts:186-201`). Untuk arah pembulatan "ke atas", pratinjau dapat menampilkan harga grup di atas harga normal yang tidak akan pernah terjadi di kasir.
*Rekomendasi:* samakan rumus (Decimal + cap) atau tampilkan pratinjau dari hasil `quoteCart`-like server.

**SEC-02 · Kebijakan kata sandi lemah; pencabutan sesi tidak terlihat.** Sandi pengguna baru/reset hanya `min 8, max 128` tanpa kompleksitas (`src/server/actions/users.ts:22`); tidak ada kode pencabutan sesi/rotasi token setelah reset sandi, ubah peran, atau cabut akses di `users.ts` (efek akhirnya di Better Auth: NOT_VERIFIED).
*Rekomendasi:* naikkan kebijakan sandi dan verifikasi/cabut sesi aktif target pada ketiga aksi tersebut.

**USR-01 · Owner tidak pernah bisa dicabut akses, bahkan bila owner lebih dari satu.** `removeCompanyUserAction` menolak semua target berperan owner (`users.ts:234-236`), lebih ketat dari penjaga turun-peran yang menghitung jumlah owner (baris 140-152) — inkonsistensi kecil yang membingungkan admin.
*Rekomendasi:* samakan semantik: blokir hanya bila target adalah owner terakhir.

**UI-TOUCH-01 · Target sentuh langkah keranjang terlalu kecil untuk kasir cepat.** Tombol +/− qty hanya `size-6` (24 px) dan tombol aksi baris riwayat `size-7` (28 px) (`pos-terminal.tsx:630-657`; `sale-row-actions.tsx:40-68`) — memenuhi minimum WCAG 2.2 AA (24 px) tetapi jauh dari kenyamanan 44 px untuk pemakaian sentuh berulang; kartu produk sendiri cukup besar (min-h 70/92 px, baris 505).
*Rekomendasi:* naikkan target interaktif keranjang ke ≥36–44 px pada mode sentuh.

**UI-RESP-01 · Di bawah breakpoint `xl`, keranjang menumpuk di bawah grid produk.** Layout terminal satu kolom sampai `xl` (`pos-terminal.tsx:423-428`) — di tablet potret (768–1024 px) kasir harus menggulir melewati seluruh katalog untuk mencapai tombol Bayar. Tidak ada ringkasan total lengket (sticky) di layar kecil.
*Rekomendasi:* tambahkan bar total + Bayar lengket di bawah pada <xl, atau tata letak dua kolom mulai `lg` untuk mode kasir. (Perilaku render aktual per viewport: NOT_VERIFIED — perlu uji browser.)

**SET-AUDIT-01 · Jejak audit Pengaturan tidak lengkap.** `writeAudit` ada untuk `settings.update`, hapus kelompok, dan aturan harga (`settings.ts:63-71, 203-211, 386-395`), tetapi buat/ubah metode pembayaran, gudang, cabang, dan kelompok tidak diaudit sama sekali.
*Rekomendasi:* tambahkan audit pada semua mutasi master Pengaturan mengikuti pola yang sudah ada.

**SET-LEGACY-01 · Kolom diskon umum kelompok (legacy) diabaikan senyap.** `customer_groups.discountType/discountValue` (`src/db/schema.ts:362-365`) tidak dibaca jalur mana pun yang diaudit; data/seed lama yang berharap diskon umum per kelompok tidak berpengaruh tanpa pesan apa pun.
*Rekomendasi:* migrasi/hapus kolom, atau tegakkan kembali dengan jelas.

**TST-01 · Cakupan uji POS tipis untuk risiko yang ditemukan audit ini.** Test integrasi yang ada (`tests/integration/sale-flow.test.ts:44, 244, 362, 400`) membuktikan alur jual sekuensial, idempotensi sekuensial, diskon grup, dan wajib sesi — tetapi tidak ditemukan uji untuk: idempotensi konkuren, hold+resume kelompok, retur konkuren, tukar barang, setoran/penarikan sesi, dan angka baris nota. Status lulus aktual seluruh suite: NOT_VERIFIED (audit ini baca-saja, tidak menjalankan test/DB).
*Rekomendasi:* jadikan daftar itu backlog uji regresi sebelum perbaikan kode.

---

## Urutan perbaikan yang disarankan

1. **SEC-01** (P0) — penjaga reset sandi owner.
2. **POS-RCPT-01** — satu perubahan rumus tampil di 3 tempat; dampak kepercayaan nota paling besar per usaha.
3. **POS-HOLD-01 + POS-HOLD-02** — `groupId` end-to-end pada hold/resume; resume tidak destruktif.
4. **POS-CASH-01** — samakan semantik setoran/penarikan UI ↔ jurnal ↔ ringkasan.
5. **POS-RET-01 + POS-RET-02** — kunci baris retur; pisahkan alur tukar barang; refund ke sesi berjalan.
6. **POS-DISC-01 + POS-PAY-01** — izin/ambang diskon dan validasi akun pembayaran piutang.
7. Sisanya per prioritas P2 → P3; **POS-OFF-01** sebagai fase fitur tersendiri.

## Yang tidak terverifikasi (NOT_VERIFIED)

- Perilaku runtime/DB: penegakan RLS untuk akun lintas-tenant di `journal_lines`, pencabutan sesi Better Auth setelah reset/ubah peran, dan hasil aktual menjalankan `pnpm test` / test integrasi (memerlukan PostgreSQL 18).
- Perilaku browser nyata: autoprint nota pada printer termal, responsivitas per viewport (320–1920 px), dan performa render katalog pada 10.000 produk.
- Keberadaan pemilih perusahaan di luar berkas cakupan audit ini (LINTAS-01 hanya berpijak pada `src/lib/session.ts`).
