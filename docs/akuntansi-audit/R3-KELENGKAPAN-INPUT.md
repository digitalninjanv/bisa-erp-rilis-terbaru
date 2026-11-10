# R3 — Audit Kelengkapan Input Akuntansi (A-21)

Tanggal: 2026-11-05 · Mandat pengguna 11:11 WIB: modul akuntansi "banyak yang
nggak sesuai" — contoh terverifikasi: transfer lewat Catat Transaksi tanpa
input biaya admin. Contoh itu **sedang diperbaiki terpisah dan sengaja tidak
dijadikan temuan di sini**; polanya (jalur cepat/pendek tertinggal dari jalur
khusus) dipakai sebagai lensa untuk memeriksa semua permukaan input.

Metode: baca-saja atas kode formulir + skema validasi + domain posting untuk
tujuh permukaan: (1) Catat Transaksi lima jenis, (2) pembayaran piutang/utang
(halaman + POS), (3) rekonsiliasi bank, (4) jurnal manual, (5) transfer khusus
& halaman Bank, (6) beban/reimbursement/kasbon/pinjaman, (7) POS sisi
akuntansi. Keadaan dicatat atas HEAD `d6234bf` **ditambah catatan**: saat
audit berjalan, perbaikan fee transfer cepat sedang berlangsung di pohon
kerja (5 berkas termodifikasi belum ter-commit: modal, `lib/quick-entry.ts`,
aksi quick-entry, 2 berkas test) — teramati fee diteruskan ke
`createBankTransfer` dan pratinjau diperbarui konsisten. Semua temuan lain
berada di berkas yang tidak disentuh perbaikan itu.

**Total: 16 temuan — P1: 0 · P2: 11 · P3: 5.** Tidak ada temuan P1: tidak
ada jalur input yang terbukti menjurnal salah hari ini; yang ditemukan adalah
fungsi akuntansi inti yang absen (uang riil tidak bisa dicatat sebagaimana
terjadinya) dan penjaga yang tidak merata antar-jalur. Kelompok: (i)
ketidaksetaraan antar-jalur di repo sendiri, (ii) absen vs praktik nyata
Indonesia, (iii) sisa lama AK3-04/AK3-05 yang diverifikasi masih berlaku.

## Yang sudah tertutup sejak audit ronde 1 (jangan dibuka lagi)

- **PPN Masukan pada Beban input cepat — TERTUTUP.** Catatan D-23 (opsi pajak
  Beban tidak ditampilkan karena domain belum mendukung) sudah tidak berlaku
  sejak FIX-P1 Tahap 4: modal menampilkan "Termasuk PPN" untuk penjualan
  tunai **dan** beban (`quick-entry-modal.tsx:498`), aksi meneruskannya ke
  `createExpense` + `effectiveTaxRate` (aksi `quick-entry.ts` case expense),
  domain memisah ke akun 1180 (`expenses.ts:14-24, 56-105`), dan pratinjau
  memakai rumus belah yang sama (`lib/quick-entry.ts` case expense).
- **Pratinjau vs posting input cepat konsisten secara konstruksi** — klien
  dan server memakai fungsi murni yang sama (`splitCashSale`, `allocateFifo`
  di `lib/quick-entry.ts`); tidak ditemukan rumus ganda.
- **Selisih kas POS terjurnal** (kas lebih/kurang ke pemetaan
  `cash_over`/`cash_short`, `pos/sessions.ts:112-159`); setoran laci
  berplafon; referensi pembayaran non-tunai di POS ada
  (`payment-panel.tsx:369-422`, kolom `sale_payments.reference`).
- **Pembayaran saldo awal adalah implementasi rujukan** (validasi akun
  saluran + status + alokasi retur, `opening-balances.ts:362-442`) — bukti
  pola yang benar sudah dikenal codebase.
- **Reimbursement punya alur putusan** (ajukan → putuskan oleh orang lain →
  bayar, `reimbursements.ts:61/134/206`) dan satu-satunya metadata lampiran
  di repo (`attachmentName/attachmentNote`).

---

## (iii) Sisa lama yang diverifikasi MASIH berlaku

### R3-01 — Fee/MDR metode bayar tetap tidak ada di semua jalur (P2) [= AK3-04]

- Skema `payment_methods` tanpa kolom tarif/biaya apa pun
  (`schema.ts:342-359`); formulir metode di Pengaturan hanya kode, nama,
  tipe, akun, instruksi, urutan (`settings-forms.tsx:490-495`).
- `sale_payments` tanpa kolom fee (`schema.ts:1212-1225`); jurnal penjualan
  POS mengkredit akun metode sebesar bruto. `party_payments` juga tanpa fee
  (`schema.ts:2552-2575`) — penerimaan piutang via transfer/QRIS yang
  dipotong bank pun dibukukan bruto.
- Dampak persis seperti AK3-04: saldo GL bank/QRIS permanen lebih tinggi
  dari mutasi riil sebesar akumulasi MDR; di rekonsiliasi bank selisih itu
  muncul sebagai baris buku tak tertaut yang tidak bisa dijelaskan dari
  dalam sistem. Satu-satunya jalan hari ini: jurnal manual berkala tanpa
  kaitan per transaksi.
- Rekomendasi terkecil: tarif per metode sebagai konfigurasi per perusahaan
  (persen dan/atau nominal tetap + saklar aktif, pola D-25) di
  `payment_methods`, diterapkan saat posting penjualan & penerimaan piutang:
  Dr akun metode (neto) + Dr beban fee (pemetaan `bank_fee` yang sudah ada) /
  Cr piutang/pendapatan (bruto). **Catatan keputusan**: PROGRESS §0D butir 5
  mencatat fee POS sebagai keputusan pemilik (bukan perilaku v1) — desain
  tarifnya perlu persetujuan itu; absensinya sendiri adalah fakta kode.

### R3-02 — Kelebihan bayar, DP & uang muka tetap tidak bisa dicatat (P2) [= AK3-05]

Penolakan `amount > sisa` terverifikasi di **lima** titik hari ini:
`pos/receivables.ts:139`, `payables.ts:72`, `opening-balances.ts:388`, dan
kedua FIFO modal di `quick-entry.ts:268` (terima) & `:342` (bayar). Tidak ada
dokumen/kolom kredit pihak dari pembayaran: pelanggan yang membayar lebih
atau membayar DP sebelum faktur terbit tidak punya rumah pencatatan selain
jurnal manual ke akun utang lain-lain tanpa kaitan pihak/dokumen (dan lihat
R3-09: baris jurnal manual bahkan tidak bisa ditag pihak). Kredit retur POS
adalah mekanisme terpisah (lahir dari retur, hanya bisa dipakai di POS),
bukan kredit dari kelebihan bayar.
Rekomendasi terkecil: izinkan pembayaran melebihi sisa pada jalur dokumen →
kelebihan menjadi dokumen kredit pihak (pemetaan `supplier_credit` sudah ada
untuk sisi pemasok dari A-9; sisi pelanggan mengikuti pola kredit retur yang
sudah hidup) yang dapat dialokasikan ke dokumen berikutnya termasuk FIFO.

---

## (i) Ketidaksetaraan antar-jalur di repo sendiri

### R3-03 — Validasi akun saluran ditegakkan domain hanya di sebagian jalur (P2) [= AK3-03, belum tertutup di lapisan domain]

Pola yang benar sudah ada dan dipakai tetangga:

- `payReceivable` memvalidasi akun penerimaan secara menyeluruh di domain
  (POS-PAY-01: milik perusahaan, postable, aktif, dan benar-benar akun metode
  aktif/akun kas terpeta — `pos/receivables.ts:157-214`).
- `postQuickCashSale` memvalidasi akun tujuan terhadap himpunan kas/bank/QRIS
  terpeta (`quick-entry.ts` domain, blok validasi awal).
- `payOpeningBalance` memakai `assertPaymentAccount`; kasbon, pinjaman, dan
  pembayaran klaim memakai `assertCashLikeAccount`
  (`employee-advances.ts:51`, dipakai di `employee-advances.ts:119,521`,
  `employee-loans.ts:109,405`, `reimbursements.ts:233`).

Yang **tidak** memvalidasi apa pun di domain:

- `payPayableDocument` (`payables.ts:25-131`) — `accountId` langsung dikredit;
  tidak ada pemeriksaan akun itu akun apa.
- `createExpense` (`expenses.ts:36-105`) — akun beban dan akun pembayaran
  tidak diperiksa tipenya maupun kelayakannya.
- `createBankTransfer` (`bank-transfers.ts:17-88`) — kedua rekening tidak
  diperiksa kelayakan kas/bank-nya; "transfer" bisa menjurnal pasangan akun
  postable apa pun.

`postJournal` tetap menangkap akun lintas perusahaan/non-postable/nonaktif,
jadi ini bukan lubang integritas data — ini lubang **semantik**: pembayaran
utang dapat dikreditkan ke akun pendapatan, beban dapat dibayar dari akun
utang, dst., bila aksi dipanggil di luar pilihan UI. UI memang membatasi
pilihan ke akun kas terpeta (mis. `piutang-utang/page.tsx:65-72`,
`listPaymentAccounts` di `accounting.ts:639-654`), sehingga AK3-03 hari ini
berstatus: **tertutup di UI, terbuka di domain** — persis jenis
ketidakkonsistenan yang dikeluhkan pengguna.
Rekomendasi terkecil: panggil `assertCashLikeAccount` yang sudah ada di
ketiga domain itu (dan validasi tipe akun beban di `createExpense`).

### R3-04 — Form khusus Beban & Transfer tanpa kunci idempotensi klien (P2)

Pola AK-P3-02 (kunci idempotensi per sesi formulir dari klien) sudah menjadi
standar repo: jurnal manual (`actions/accounting.ts:204,217`), modal Catat
Transaksi (tabel `quickEntrySubmissions` + kunci turunan per dokumen),
`payReceivable` (klaim kunci POS1-05). Tetapi:

- `expenseSchema`/`createExpenseAction` dan `transferSchema`/
  `createBankTransferAction` (`actions/accounting.ts`) tidak menerima kunci
  klien sama sekali.
- Kunci domain keduanya per-dokumen-baru — `` `expense:${expense.id}` ``
  (`expenses.ts:85`) dan `` `bank_transfer:${transfer.id}` ``
  (`bank-transfers.ts:68`) — tidak dapat mengenali pengiriman ulang, karena
  setiap pengiriman membuat dokumen (dan id) baru lebih dulu.

Tombol yang nonaktif selama `busy` hanya menutup klik ganda; respons yang
hilang sesudah commit (timeout, refresh, retry pengguna) menghasilkan beban
atau transfer **kedua** yang sah secara jurnal. Dampaknya uang nyata ganda
yang hanya bisa dikoreksi lewat void manual.
Rekomendasi terkecil: tambahkan `idempotencyKey` opsional ke kedua skema
aksi + teruskan sebagai kunci jurnal/dokumen, mengikuti pola jurnal manual
persis.

### R3-05 — Penjualan tunai input cepat: tanpa diskon, tanpa pihak (P2)

Payload modal (`lib/quick-entry.ts` `QuickEntryPayload`) untuk penjualan
tunai hanya punya jumlah, akun kas, akun pendapatan, opsi PPN, catatan.
Domainnya (`postQuickCashSale`) selalu menjurnal Dr Kas bruto / Cr Pendapatan
neto + PPN. Akibatnya:

- **Diskon tidak bisa dicatat.** Kebijakan tertulis repo (AGENTS.md):
  pendapatan dikredit bruto, diskon adalah contra-revenue `sales_discount`
  (4010) — POS menegakkannya. Jalur cepat penjualan non-stok tidak punya
  kolom diskon, jadi potongan harga pada penjualan jasa/non-stok hanya bisa
  dicatat neto (pendapatan & diskon sama-sama hilang dari laporan) atau
  lewat jurnal manual penuh.
- **Tidak ada tag pelanggan** pada baris jurnal (payload tanpa `partyId`
  untuk jenis ini), sehingga penerimaan pendapatan tidak teratribusi ke
  pihak mana pun — berbeda dari penjualan POS yang mencatat pelanggan.

Rekomendasi terkecil: kolom diskon opsional (baris Dr `sales_discount`
terpeta, pola jurnal POS) + pemilih pelanggan opsional yang menulis
`partyType/partyId` pada baris pendapatan.

### R3-08 — Nomor referensi/bukti tidak merata; pembayaran pihak tanpa rumah referensi (P2)

Referensi **ada** di: dokumen transfer (`bank_transfers.reference`,
`schema.ts:1352-1370`, ditampilkan form khusus `bank-transfer-form.tsx`),
saldo awal pihak (`partyOpeningBalances.reference`), pembayaran POS
(`sale_payments.reference`). Tetapi:

- Transfer lewat Catat Transaksi tetap tidak bisa mengisi referensi —
  skema payload aksi quick-entry (keadaan sesudah perbaikan fee yang sedang
  berjalan) memuat `fee` tetapi tidak ada `reference`, padahal
  `createBankTransfer` menerimanya. Pola yang sama dengan keluhan awal
  pengguna, pada kolom tetangganya.
- `party_payments` **tidak punya kolom referensi sama sekali**
  (`schema.ts:2552-2575`) — pembayaran piutang/utang dari semua jalur
  (halaman piutang-utang, POS, FIFO modal, saldo awal) hanya punya `notes`
  bebas untuk nomor bukti transfer/cek/VA. Jejak audit uang masuk/keluar
  bergantung pada kedisiplinan mengetiknya di catatan.

Rekomendasi terkecil: kolom `reference` di `party_payments` + kolomnya di
`PaymentForm` dan modal (satu pola dengan POS), dan `reference` pada payload
transfer cepat diteruskan ke domain.

### R3-09 — Baris jurnal manual tidak bisa ditag pihak (P2)

Skema baris jurnal manual hanya `accountId, debit, credit, description`
(`actions/accounting.ts:86-95`); formulirnya (`journal-entry-form.tsx`) tidak
menawarkan pemilih pihak — padahal `journal_lines` punya `party_type/
party_id` dan `postJournal` menerimanya (dipakai semua jalur pembayaran).
Akibatnya jurnal penyesuaian yang menyentuh akun kontrol Piutang/Utang tidak
bisa diatribusikan ke pelanggan/pemasok: halaman Rekonsiliasi Kontrol akan
menampilkan selisih GL vs subledger yang tidak dapat dijelaskan dokumen mana
pun, dan ini juga yang membuat workaround R3-02/R3-06 (jurnal manual) tidak
pernah benar-benar setara.
Rekomendasi terkecil: pemilih pihak opsional per baris (muncul untuk akun
bertanda kontrol piutang/utang), diteruskan ke `postJournal`.

### R3-10 — Reimbursement tidak bisa memisahkan PPN Masukan (P2)

`submitReimbursementClaim` (`reimbursements.ts:61-132`) tidak punya field
pajak apa pun, dan `payReimbursementClaim` (`reimbursements.ts:206-272`)
mendebit akun beban sebesar nominal bruto yang disetujui. Bandingkan
`createExpense` yang sejak FIX-P1 Tahap 4 memisah PPN ke 1180 — klaim atas
pembelian berfaktur pajak atas nama perusahaan (bahan, ATK, langganan)
kehilangan kredit PPN Masukannya dan membebankan pajak sebagai beban.
Rekomendasi terkecil: opsi "termasuk PPN" + tarif efektif pada pengajuan
klaim (pola `createExpense` persis), dibekukan di baris klaim, dipecah saat
pembayaran.

### R3-15 — Ketidakseragaman kecil antar-jalur (P3, kelompok)

- Penjaga tanggal pembayaran mendahului dokumen hanya ada di sisi piutang
  (POS1-12, `pos/receivables.ts:128-136`); `payPayableDocument` dan FIFO
  utang tidak punya penjaga setara — pembayaran utang bertanggal sebelum
  penerimaan barangnya lolos.
- Akun lawan beban: bootstrap input cepat menawarkan tipe `expense` **atau**
  `cogs` (aksi `quick-entry.ts` `getQuickEntryBootstrapAction`), halaman
  Beban khusus hanya `expense` (`listExpenseAccounts`,
  `reports.ts:2844-2857`). Dua jalur resmi, dua daftar berbeda.
- Pembayaran klaim reimbursement & kasbon/pinjaman rapi, tetapi pengajuan
  klaim tidak memeriksa tanggal vs periode dengan pesan khusus — mengandalkan
  `assertPeriodOpen` di pembayaran; klaim bertanggal periode tertutup baru
  gagal di ujung. (Kecil; dicatat apa adanya.)

---

## (ii) Absen vs praktik nyata Indonesia

### R3-06 — Tidak ada potongan pajak (withholding) pada pembayaran keluar (P2)

Pencarian `pph23|pph 23|withholding|potong` di `src/server`, `src/lib`,
`src/components`: **0 hasil** di luar konteks potongan gaji (payroll PPh 21).
Tidak ada kolom potongan di `party_payments` maupun `expenses`; semua jurnal
pembayaran berbentuk Dr Utang/Beban bruto / Cr Kas bruto. Praktik nyata:
pembayaran jasa ke vendor kena PPh 23 (2%) atau PPh 4(2) yang **dipotong
pembayar** — jurnal benarnya Dr Utang bruto / Cr Kas neto / Cr Utang PPh.
Hari ini itu hanya bisa dirakit sebagai jurnal manual terpisah yang tidak
berkaitan dengan dokumen pembayaran (dan tanpa tag pihak, lihat R3-09),
sehingga utang pajak dari pemotongan tidak terlacak per pembayaran dan rawan
terlewat saat penyetoran (penyetorannya sendiri pun tidak ada alurnya —
sisa lama AK4-09).
Rekomendasi terkecil: kolom potongan opsional (nominal + akun utang pajak
terpeta, ditambah lewat pemetaan konfigurabel) pada `payPayableDocument` dan
`createExpense`, jurnal tiga baris seperti pola fee transfer.

### R3-07 — Tidak ada potongan/write-off pelunasan piutang/utang (P2)

Tidak ada jalur menutup sisa pembayaran dengan potongan yang disepakati atau
penghapusan: pencarian `bad_debt|write-off piutang` = 0 hasil relevan
(`writeOffRemainder` yang ada milik penyelesaian retur pemasok, konteks
berbeda). Sisa Rp50–500 karena pembulatan pihak atau selisih kurs lisan hanya
bisa (a) menggantung selamanya sebagai piutang/utang terbuka, atau (b)
ditutup dengan "pembayaran" tunai fiktif agar status lunas — keduanya buruk;
yang kedua merusak jejak kas. Piutang tak tertagih pun tidak punya jalur
penghapusan terbimbing (hanya jurnal manual tanpa tag pihak).
Rekomendasi terkecil: pada form pembayaran, mode penyelesaian sisa:
potongan (Dr/Cr akun potongan terpeta) atau write-off (akun beban piutang
tak tertagih terpeta), dengan izin terpisah dan alasan wajib — mengikuti
pola persetujuan penyesuaian stok yang sudah ada di Gudang.

### R3-11 — Beban selalu tunai: tidak ada beban terutang (P2) [manifestasi permukaan-input dari AK4-10]

Form Beban khusus dan jenis beban input cepat sama-sama **mewajibkan** akun
pembayaran kas/bank dan langsung mengkreditnya: beban yang jasanya sudah
diterima tetapi dibayar bulan depan (listrik, sewa, jasa profesional) tidak
dapat dicatat sebagai beban + utang. Satu-satunya jalan adalah jurnal manual
Dr Beban / Cr akun utang pilihan sendiri — tanpa dokumen beban, tanpa
dokumen utang yang muncul di halaman piutang-utang, dan pembayarannya kelak
tidak tertaut. AK4-10 (akrual/prepaid absen) tercatat sebagai sisa P2 ronde
1; temuan ini menegaskan permukaan inputnya: tidak ada mode "belum dibayar"
di satu pun form beban.
Rekomendasi terkecil: opsi "belum dibayar" pada `createExpense` → kredit ke
akun utang terpeta sebagai dokumen utang beban yang dapat dibayar dari
halaman piutang-utang (pola `party_payments` yang sama).

### R3-12 — Rekonsiliasi bank: jurnal dari mutasi hanya satu akun lawan (P3)

Biaya admin bulanan dan bunga bank **bisa** dicatat dari rekonsiliasi —
`createJournalFromLine` (`bank-reconciliation.ts:667-744`, tombol "Buat
jurnal" di panel) menerima akun lawan bebas. Batasannya: tepat **satu** akun
lawan sebesar nominal penuh baris mutasi. Mutasi neto yang secara akuntansi
harus dipecah — bunga bank bruto dikurangi PPh final 20% yang dipotong bank
adalah kasus bulanan paling umum — tidak bisa dicatat dalam satu langkah
dari sini; pengguna harus keluar ke jurnal manual dan menautkan baris mutasi
secara terpisah.
Rekomendasi terkecil: izinkan baris lawan kedua opsional pada
`createJournalFromLine` (akun + nominal), jurnal tiga baris.

### R3-13 — Jurnal manual: tanpa draf dan tanpa pemisahan pembuat/pemeriksa (P3)

Formulir jurnal manual langsung memposting; skema `journal_entries`
mendukung status `draft` tetapi tidak ada jalur pembuatan draf dari form
ini, dan izinnya datar (`accounting.post` untuk membuat sekaligus
memposting; tidak ada izin periksa/setuju). Untuk jurnal penyesuaian bernilai
besar — jenis jurnal paling rawan salah — tidak ada four-eyes di dalam
sistem. (Reimbursement membuktikan pola putusan dua orang sudah dikenal
repo.) Dicatat sebagai kelengkapan kontrol, bukan cacat angka.

### R3-14 — Lampiran/acuan bukti hampir tidak ada (P3)

Satu-satunya acuan bukti di seluruh permukaan input adalah
`attachmentName/attachmentNote` pada klaim reimbursement — dan itu pun teks
nama berkas, bukan unggahan/penyimpanan berkas (tidak ada infrastruktur
lampiran di skema selain dua kolom itu). Jurnal manual, beban, dan
pembayaran tidak punya tempat mencatat acuan bukti selain menuliskannya di
keterangan/notes. Terkait R3-08; perbaikannya satu paket (kolom acuan +
kebijakan nama berkas), unggahan berkas sungguhan adalah keputusan cakupan
terpisah.

### R3-16 — Mata uang tunggal & tanggal nilai (P3, catatan cakupan)

- Mata uang: satu-satunya kolom mata uang adalah
  `company_settings.currency` (bawaan IDR, `schema.ts:227`); tidak ada
  permukaan input yang menerima mata uang lain atau kurs. **Absen by
  scope**, dicatat karena pengguna menanyakannya — bukan cacat terverifikasi
  untuk target UKM domestik; menjadi temuan sungguhan hanya bila ada
  transaksi valas nyata.
- Tanggal nilai vs tanggal catat tidak dibedakan (transfer dan pembayaran
  memakai satu `date` sebagai tanggal jurnal). Dampak terukur rendah:
  rekonsiliasi bekerja dari tanggal mutasi bank, dan selisih satu hari
  antar-rekening tertangani sebagai item rekonsiliasi biasa. PERLU
  VERIFIKASI hanya bila pengguna mengalami selisih rekonsiliasi berulang
  karena value-date — cara membuktikannya: cocokkan pola selisih di halaman
  Rekonsiliasi selama satu siklus mutasi.

---

## Usulan kelompok perbaikan (untuk dijadikan tahap berurutan)

1. **R3-A Biaya & potongan pada pembayaran** — R3-01 (tarif fee per metode,
   menunggu keputusan pemilik soal desain tarif) + R3-06 (withholding PPh
   pada bayar utang & beban) + R3-07 (potongan/write-off pelunasan berizin).
   Satu keluarga skema: pembayaran berhenti menjadi satu angka.
2. **R3-B Kelebihan bayar & kredit pihak** — R3-02: dokumen kredit pihak dari
   kelebihan bayar/DP, dapat dialokasikan FIFO maupun per dokumen.
3. **R3-C Penjaga domain diseragamkan** — R3-03 + R3-04 + R3-15:
   `assertCashLikeAccount` di tiga domain yang belum, kunci idempotensi
   klien di form beban & transfer, penjaga tanggal sisi utang, samakan
   daftar akun beban. Murah, murni konsistensi pola yang sudah teruji.
4. **R3-D Kelengkapan dokumen input** — R3-05 + R3-08 + R3-09: diskon & tag
   pelanggan penjualan tunai cepat, kolom referensi pembayaran pihak +
   referensi transfer cepat, tag pihak per baris jurnal manual.
5. **R3-E PPN & akrual pinggiran** — R3-10 (PPN klaim) + R3-11 (beban
   terutang) + R3-12 (lawan kedua rekonsiliasi).
6. **Backlog kontrol P3** — R3-13 (draf/periksa jurnal), R3-14 (acuan bukti),
   R3-16 (cakupan, hanya bila kebutuhan nyata muncul).
