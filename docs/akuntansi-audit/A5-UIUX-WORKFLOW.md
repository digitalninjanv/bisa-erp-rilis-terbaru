# A5 — Audit Adversarial Akuntansi: UI/UX & Workflow Modul Akuntansi

 Auditor: UX Auditor + Product Designer (perspektif akuntan) · Sifat: **BACA-SAJA** (inspeksi kode UI)
 Tanggal: 2026-11-04 · Sikap audit: setiap halaman dianggap menyulitkan akuntan sampai terbukti memudahkan.
 Kerangka nilai: gaya compact khas Odoo yang dipertahankan proyek (AGENTS.md) — bukan desain marketing.

## Vonis ringkas

Keluhan pengguna **terbukti pada lapis workflow, bukan pada lapis formulir**. Formulir inti
(jurnal manual, Catat Transaksi, pembayaran) justru termasuk yang paling dipikirkan di repo ini.
Yang putus adalah *perjalanan antar-halaman* seorang akuntan: memverifikasi satu angka dari
laporan sampai ke dokumen sumbernya memerlukan navigasi manual berulang dengan filter yang
diisi ulang dari nol, karena rantai drill-through putus di tiga titik. Ditambah: tidak ada
alur tutup buku tahunan (jurnal penutup), tidak ada pencarian global, tidak ada jurnal
berulang, dan beberapa daftar penting (piutang/utang, kasbon, pinjaman, aset) tidak
berpaginasi, tidak bisa dicari, dan tidak bisa diekspor.

**Jumlah temuan: 21 — P0: 0 · P1: 5 · P2: 10 · P3: 6.**
Tidak ada P0: tidak ada temuan yang menghalangi pekerjaan secara mutlak atau mengancam
kebenaran angka; semua tugas *bisa* diselesaikan, tetapi banyak yang memakan langkah berlebih.

---

## Temuan

### P1 — menghambat pekerjaan harian secara nyata

**AK5-01 · WORKFLOW-PUTUS · Rantai drill-through putus di tiga titik.**
- Baris akun di Laba Rugi / Neraca / Neraca Saldo (`laporan/page.tsx`, komponen
  `ComparisonGroup`/`TrialBalance`) adalah teks polos — tidak ada tautan ke buku besar akun itu.
- Baris buku besar (`buku-besar/page.tsx`) menampilkan nomor jurnal sebagai teks polos —
  tidak ada tautan ke detail jurnal.
- Detail jurnal (`jurnal/[id]/page.tsx`) menyebut dokumen sumber di footer sebagai teks
  ("Sumber … · nomor") — bukan tautan ke dokumen/modul asalnya; banner "batalkan dari modul
  asal" juga hanya teks, tanpa tautan langsung.
Akibatnya tugas verifikasi paling dasar akuntan — "angka ini datang dari mana?" — selalu
berarti: catat kode akun → buka Buku Besar → pilih akun dari dropdown → isi ulang rentang
tanggal → catat nomor jurnal → buka Jurnal → cari nomor itu → baca footer untuk tahu dokumen
asalnya → buka modul asal manual. ±4 kali pengisian ulang konteks untuk satu angka.

**AK5-02 · FUNGSI-UI-HILANG · Daftar jurnal lemah untuk volume besar.**
`jurnal/page.tsx`: ada pencarian nomor/keterangan, rentang tanggal, dan paginasi 30 — tetapi
(a) **tidak ada ekspor daftar jurnal** (CSV hanya per satu jurnal di halaman detail);
(b) **tidak ada filter akun** (semua jurnal yang menyentuh akun X hanya bisa dilihat dari
buku besar per akun); (c) **tidak ada filter status** (posted/void tercampur tanpa cara
menyaring); (d) **filter sumber tidak lengkap** — dropdown hanya memuat 9 nilai
(sale, sale_return, purchase, expense, capital, payroll, bank_transfer, manual, opening),
padahal tipe sumber nyata ±20 (payment, cash_session, cash_movement, purchase_return,
adjustment, opname, supplier_return, kasbon, pinjaman, aset, quick entry, dst. — bandingkan
peta `SOURCE_MODULE_LABEL` di detail jurnal). Jurnal dari sumber di luar 9 itu tidak bisa
disaring sama sekali; (e) tidak ada pilihan urutan sortir.

**AK5-03 · WORKFLOW-PUTUS · Formulir posting tidak tahu status periode.**
Halaman `jurnal/baru/page.tsx` hanya mengambil akun + pemetaan — **tidak ada data status
periode sama sekali**. Akuntan mengisi formulir jurnal lengkap, menekan Posting, barulah
error `PERIOD_CLOSED` muncul sebagai toast. Panduan di sisi formulir hanya berupa teks
statis "Pastikan periode fiskal masih terbuka". Pola yang sama berlaku di formulir beban,
pembayaran, dan transfer: tidak ada indikator "periode tanggal ini: tertutup" yang hidup
mengikuti tanggal yang dipilih.

**AK5-04 · FUNGSI-UI-HILANG · Tidak ada alur tutup buku tahunan; tutup periode satu klik tanpa pemeriksaan.**
- Pencarian di seluruh `src/` tidak menemukan jurnal penutup / closing entry / tutup buku
  tahunan. Akhir tahun akuntan harus menyusun jurnal penutup (pendapatan/beban → ikhtisar →
  laba ditahan) secara manual dari nol.
- `period-manager.tsx`: tombol Tutup/Kunci langsung mengeksekusi `setPeriodStatusAction`
  **tanpa dialog konfirmasi, tanpa ringkasan isi periode** (berapa jurnal, apakah ada yang
  belum seimbang/draf menggantung, status rekonsiliasi). Satu klik keliru menutup bulan.
  (Membuka periode terkunci justru dijaga baik: wajib alasan + hanya owner.)

**AK5-05 · CAMPURAN · Piutang & utang: tanpa penanda keterlambatan, tanpa ekspor, bayar satu-satu.**
`piutang-utang/page.tsx`:
- Tanggal tempo ditampilkan sebagai teks polos "Tempo 12 Nov 2026" — **tidak ada penanda
  "lewat jatuh tempo N hari"**, tidak ada pewarnaan baris terlambat; untuk halaman yang
  gunanya menagih, ini kekurangan inti.
- **Tidak ada ekspor CSV aging** — daftar penagihan untuk pemilik/kolektor harus disalin manual.
- Seluruh daftar dimuat tanpa paginasi dan disaring di memori; tidak ada sortir per tempo/nilai.
- Kolom status merender `paymentStatus` mentah dengan `capitalize` CSS → tampil Inggris
  "Unpaid"/"Partial", bukan "Belum bayar"/"Sebagian" (lihat juga AK5-16).
- Pembayaran hanya bisa per dokumen lewat modal `PaymentForm`; membayar 15 faktur satu
  pemasok = 15 kali modal. Alokasi FIFO per pihak memang ada — tetapi lewat modal Catat
  Transaksi di beranda, tidak tertaut dari daftar ini.
- Nomor nota/penerimaan bukan tautan ke dokumen sumbernya.

### P2 — gesekan berarti / fungsi yang lazimnya ada

**AK5-06 · FUNGSI-UI-HILANG · Buku besar: pemilih akun polos & satu akun saja.**
Pemilih akun adalah `<select>` native berisi seluruh COA tanpa pencarian (perusahaan dengan
100+ akun harus menggulir); bandingkan formulir jurnal yang sudah memakai `AccountCombobox`
berpencarian. Hanya satu akun per tampilan — tidak ada mode "semua akun" untuk mencetak buku
besar lengkap satu periode. Paginasi 50 & ekspor CSV per akun sudah baik.

**AK5-07 · FUNGSI-UI-HILANG · Tidak ada pencarian global transaksi.**
Tidak ada command palette/pencarian lintas modul di shell. Menemukan satu transaksi dari
nomornya mengharuskan tahu dulu ia jurnal, nota, penerimaan, atau pembayaran — lalu membuka
daftar yang tepat. Akuntan yang menerima pertanyaan "transaksi ini apa?" dari pemilik selalu
mulai dari tebakan modul.

**AK5-08 · FUNGSI-UI-HILANG · Tidak ada jurnal berulang & tidak ada duplikasi jurnal.**
Pola cepat di formulir jurnal hanya mengisi *struktur baris tanpa nominal* dan tidak terjadwal.
Transaksi rutin identik (sewa bulanan, langganan, gaji harian) selalu diketik dari nol; dari
detail jurnal pun tidak ada aksi "Buat serupa/duplikat" untuk memulai jurnal baru dari yang ada.

**AK5-09 · FUNGSI-UI-HILANG · Beban tanpa lampiran, tanpa penerima, tanpa pencarian.**
Formulir & daftar beban (`expense-form.tsx`, `beban/page.tsx`): grep tidak menemukan kolom
lampiran/bukti maupun PPN pada beban; daftar tidak menampilkan penerima/vendor (memang tidak
ada field-nya di tampilan), tidak ada pencarian keterangan, tidak ada filter per akun beban,
tidak ada ekspor. Untuk beban, bukti transaksi adalah dokumen kerja utama akuntan — ketiadaan
lampiran terasa setiap audit. Status di daftar memakai badge rakitan sendiri bertuliskan
Inggris "Posted" (lihat AK5-16).

**AK5-10 · FUNGSI-UI-HILANG · Rekonsiliasi tanpa laporan per tanggal statement.**
Mesin rekonsiliasinya sendiri kuat (impor mutasi, auto-match, taut manual, buat jurnal dari
mutasi). Tetapi: (a) tidak ada filter rentang tanggal pada baris mutasi/buku — hanya filter
status; (b) kartu ringkasan adalah total sepanjang waktu, bukan rekonsiliasi *per tanggal
rekening koran* (saldo menurut bank, saldo menurut buku, selisih, daftar item menggantung)
yang bisa dicetak sebagai berita acara rekonsiliasi; (c) status rekonsiliasi tidak terikat
ke periode fiskal (periode bisa ditutup sementara rekonsiliasi bulannya belum tuntas, tanpa
peringatan apa pun dari halaman Periode).

**AK5-11 · KURANG-JELAS · Kas & Bank hanya menampilkan akun hasil pemetaan.**
`bank/page.tsx` menyusun daftar rekening hanya dari pemetaan `cash`/`bank`/`qris` — akun bank
tambahan yang dibuat di COA tidak tampil sebagai rekening di sini (dan kelayakan rekonsiliasi
pun bergantung pada pemetaan/metode pembayaran). Riwayat transfer dibatasi 60 baris terakhir
dengan filter tanggal tetapi tanpa paginasi. Mutasi per rekening harus lompat ke buku besar
(tautan "Buku" per rekening sudah ada — baik).

**AK5-12 · FUNGSI-UI-HILANG · Daftar kasbon/pinjaman/aset/klaim/payroll tanpa paginasi, pencarian, ekspor.**
Grep `Pagination` pada `kasbon/`, `pinjaman/`, `aset/`, `klaim/` = 0; tidak ada kolom
pencarian di keempatnya. Daftar karyawan di Payroll juga tanpa pencarian (mengelola 100+
karyawan = gulir), riwayat payroll dibatasi 24 periode tanpa paginasi, dan tidak ada ekspor
daftar karyawan/saldo kasbon/pinjaman/nilai buku aset dari halaman-halamannya.

**AK5-13 · KURANG-JELAS · Menu HR tersembunyi dari navigasi.**
Navigasi samping modul Akuntansi (`src/lib/modules.ts`) memuat 17 item — tetapi Departemen &
Jabatan, Absensi & Shift, Lembur & THR, dan Cuti **tidak ada di menu**; mereka hanya bisa
ditemukan dari empat chip tautan kecil di atas halaman Payroll. Halaman detail karyawan pun
hanya tertaut dari daftar karyawan. Fitur yang sudah dibangun penuh (S7B-1) praktis tidak
tertemukan oleh pengguna baru.

**AK5-14 · KURANG-JELAS · Dashboard: rentang terkunci & seksi "jatuh tempo" tanpa tempo.**
Beranda akuntansi selalu bulan berjalan — tidak ada pemilih periode untuk melihat bulan lalu
tanpa pergi ke Laporan. Seksi berjudul "Piutang jatuh tempo" menampilkan 5 baris pertama
dengan kolom Nota/Pelanggan/Sisa saja: **tidak ada tanggal jatuh tempo dan tidak ada hari
keterlambatan** — judul menjanjikan informasi jatuh tempo yang tidak diberikan tabelnya.
(Kartu status periode fiskal dan indikator neraca seimbang di beranda adalah contoh baik.)

**AK5-15 · FUNGSI-UI-HILANG · Jurnal manual tanpa draf & tanpa lampiran.**
Formulir jurnal manual langsung memposting; pekerjaan jurnal besar yang belum selesai tidak
bisa disimpan sebagai draf dari formulir ini (draf server hanya ada untuk Catat Transaksi).
Tidak ada lampiran bukti pendukung pada jurnal manual. Koreksi memang wajib lewat jurnal
pembalik (by design, dan dikomunikasikan dengan baik di UI) — tetapi itu membuat draf &
lampiran makin terasa absen untuk jurnal penyesuaian akhir bulan yang biasanya besar dan
berdokumen.

### P3 — konsistensi & polesan

**AK5-16 · TIDAK-KONSISTEN · Tiga pola label status untuk konsep yang sama.**
`StatusBadge` melabeli `posted` → "Posted", `void` → "Void", `draft` → "Draft" (Inggris);
halaman Bank menampilkan "Tercatat"/"Dibatalkan" (Indonesia); halaman Beban merakit badge
sendiri bertuliskan "Posted"; halaman Piutang & Utang merender nilai mentah ter-capitalize
("Unpaid"/"Partial"). Satu konsep, empat perlakuan, dua bahasa.

**AK5-17 · TIDAK-KONSISTEN · Kolom Sumber di daftar jurnal memakai kata mentah Inggris.**
Daftar jurnal merender `sourceType.replace(/_/g, " ")` + capitalize → "Sale", "Sale return",
"Bank transfer". Padahal `journalSourceLabel()` berbahasa Indonesia **sudah ada** dan sudah
dipakai di laporan arus kas serta footer detail jurnal. Satu baris kode yang tidak memakai
peta yang sudah tersedia.

**AK5-18 · KURANG-JELAS · Bagan akun: saldo tidak bisa per tanggal; kode bukan tautan.**
Saldo di COA selalu saldo berjalan terkini — akuntan tidak bisa melihat saldo per tanggal
tertentu dari halaman ini (harus ke neraca saldo laporan). Hanya nama akun yang tertaut ke
detail; kode tidak. Saldo negatif dicat merah seragam, termasuk akun yang memang normalnya
bertanda demikian, tanpa penjelasan. (Halaman detail akun sendiri baik: ada riwayat audit
dan tautan ke buku besar.)

**AK5-19 · TIDAK-KONSISTEN · Konfirmasi aksi berisiko tidak seragam.**
Tutup/kunci periode: tanpa konfirmasi (AK5-04). Void pembayaran: `window.prompt` alasan.
Void lain memakai modal/panel beralasan. `account-form` memakai `window.confirm`. Tiga pola
berbeda untuk kelas risiko yang sama membuat pengguna tidak bisa membangun kebiasaan aman.

**AK5-20 · KURANG-JELAS · Kepadatan teks sangat kecil untuk kerja berjam-jam.**
Label kartu 9–10px dan teks sekunder tabel 10–11px merata di seluruh modul. Ini konsisten
dengan gaya compact yang dimandatkan, dan status selalu dibedakan teks + warna (baik) —
tetapi untuk sesi kerja akuntan yang panjang, ukuran ini di bawah nyaman; dicatat sebagai
observasi desain, **bukan** klaim pelanggaran aksesibilitas (hasil axe 0 pelanggaran pada
rute utama dari program sebelumnya tidak diuji ulang di audit baca-saja ini).

**AK5-21 · FUNGSI-UI-HILANG · Laporan: pembanding terkunci & tanpa konteks drill.**
Kolom pembanding selalu tahun lalu periode yang sama (keputusan A-5/AGENTS.md — konsisten,
tetapi dari sisi pengguna tidak bisa dimatikan atau diganti pembanding bulan lalu); tab
Penjualan menampilkan agregat per kasir/kategori/produk tanpa satu pun tautan ke nota atau
produknya; tidak ada penanda visual baris laporan yang berubah tidak wajar antarperiode.

---

## Nilai per halaman (ringkas)

| Halaman | Nilai | Catatan inti |
|---|---|---|
| Beranda / Ringkasan | B− | Isi kaya (8 kartu, status periode, neraca seimbang, Input Cepat); rentang terkunci, seksi tempo tanpa tempo (AK5-14) |
| Jurnal — daftar | C | Ringkasan seimbang baik; tanpa ekspor daftar, filter akun/status, filter sumber tak lengkap (AK5-02, AK5-17) |
| Jurnal — baru | A− | Formulir terbaik di modul: combobox, pola cepat, "Samakan selisih", alasan tombol nonaktif selalu terlihat; minus status periode & draf (AK5-03, AK5-15) |
| Jurnal — detail | B+ | Banner arah pembatalan jujur, tautan jurnal pembalik, CSV & cetak terpisah; sumber hanya teks (AK5-01) |
| Buku besar | C+ | Saldo berjalan & paginasi benar; pemilih akun polos, baris tak tertaut (AK5-01, AK5-06) |
| Laporan keuangan | B− | 7 tab lengkap, preset periode, pembanding berlabel tahun, siap cetak; nol drill-down (AK5-01, AK5-21) |
| Bagan akun (COA) | B | Pencarian + filter tipe + ekspor + edit sebaris; saldo tak bertanggal (AK5-18) |
| Detail akun | A− | Riwayat audit per record + tautan buku besar — pola yang seharusnya ditiru halaman lain |
| Periode fiskal | C+ | Penjelasan alur baik, buka-kunci beralasan; tutup satu klik tanpa pemeriksaan (AK5-04) |
| Piutang & utang | C | Aging & form bayar per baris berfungsi; tanpa penanda overdue, ekspor, bayar massal (AK5-05) |
| Kas & bank | B− | Transfer + modal rapi, tautan "Buku" per rekening; daftar rekening terbatas pemetaan (AK5-11) |
| Rekonsiliasi bank | B+ | Workflow inti rekonsiliasi paling lengkap di modul; minus laporan per tanggal statement (AK5-10) |
| Beban | C+ | Form + riwayat berpaginasi; tanpa lampiran/penerima/pencarian (AK5-09) |
| Payroll | B | Kaya & tergate benar; daftar karyawan tanpa pencarian, riwayat 24 tanpa paginasi (AK5-12) |
| HR (dept/absensi/lembur/cuti) | C | Fungsinya ada & terhubung payroll — tetapi tak ada di menu (AK5-13) |
| Kasbon / Pinjaman | C+ | Panel & rencana potongan jelas; daftar tanpa paginasi/pencarian/ekspor (AK5-12) |
| Reimbursement | C+ | Persetujuan atasan ada; pola daftar sama seperti kasbon (AK5-12) |
| Aset tetap | B− | Runner penyusutan + laporan nilai buku di satu halaman; daftar tanpa paginasi (AK5-12) |
| Catat Transaksi | A− | Pratinjau jurnal = jurnal riil, draf server, idempoten — standar emas input cepat repo ini |
| Panel Input Cepat | B+ | 9 jalan pintas tergate izin di beranda; sebagian masih tautan halaman (jujur, tidak menduplikasi form) |
| Pengaturan akuntansi | B | Pemetaan akun, pajak bersaklar, penomoran, payroll Indonesia — lengkap; halaman sangat panjang satu gulir |

---

## 10 kekurangan workflow terberat

1. **Drill-through putus berantai** (AK5-01) — verifikasi angka, tugas verifikasi nomor satu
   akuntan, selalu menjadi navigasi manual 4 tahap dengan filter diisi ulang.
2. **Tidak ada tutup buku tahunan / jurnal penutup** (AK5-04) — satu-satunya momen akuntansi
   paling formal dalam setahun tidak punya alur sama sekali.
3. **Formulir tidak tahu periode tertutup** (AK5-03) — kesalahan baru ketahuan sesudah
   pekerjaan terbuang; pencegahan satu indikator tanggal sudah cukup.
4. **Daftar jurnal lemah untuk volume besar** (AK5-02) — tanpa ekspor daftar, filter akun,
   dan filter sumber yang lengkap, menelusur riwayat adalah pekerjaan menggulir.
5. **Piutang/utang tanpa penanda overdue & ekspor aging** (AK5-05) — halaman penagihan yang
   tidak menunjukkan mana yang terlambat gagal pada fungsi utamanya.
6. **Tutup periode satu klik tanpa checklist** (AK5-04) — risiko operasional: bulan tertutup
   sebelum rekonsiliasi tuntas, tanpa satu pun pertanyaan.
7. **Tidak ada pencarian global** (AK5-07) — setiap pertanyaan "ini transaksi apa?" mulai
   dari tebakan modul.
8. **Tidak ada jurnal berulang / duplikasi** (AK5-08) — biaya rutin yang identik diketik
   ulang selamanya; rawan salah ketik nominal.
9. **Buku besar dengan pemilih akun polos** (AK5-06) — gerbang masuk ke halaman verifikasi
   terpenting justru yang paling primitif.
10. **Beban tanpa lampiran & penerima** (AK5-09) — jejak bukti terputus; setiap audit
    internal/eksternal kembali ke map fisik.

## Halaman yang sudah baik (dengan alasan)

- **Formulir jurnal manual** — alasan tombol Posting nonaktif selalu tertulis di samping
  tombol (bukan tombol mati misterius), tombol "Samakan selisih" menyelesaikan masalah
  klasik jurnal tidak balance, pola cepat jujur (struktur saja, nominal tetap diisi user),
  panel keseimbangan berwarna dengan angka Decimal yang sama dengan server.
- **Catat Transaksi** — pratinjau jurnal yang ditampilkan adalah jurnal yang benar-benar
  akan diposting (satu logika bersama), draf tersimpan di server, idempotensi mencegah
  dobel-klik menjadi dobel-jurnal. Ini pola yang layak ditiru formulir lain.
- **Detail jurnal** — banner peringatan untuk jurnal sistem menjelaskan *mengapa* pembalikan
  harus dari modul asal beserta konsekuensinya ke stok/subledger; tautan dua arah ke jurnal
  pembalik/orisinal; tombol CSV dan Cetak terpisah dan berlabel jujur.
- **Rekonsiliasi bank** — satu-satunya workflow multi-langkah yang utuh dalam satu layar:
  impor → auto-match → taut manual → buat jurnal dari mutasi, dengan kartu ringkasan
  tertaut/belum tertaut yang selalu terlihat.
- **Detail akun** — riwayat perubahan dari audit log + fakta master + tautan buku besar;
  membuktikan pola "jejak audit terlihat dari record-nya" sebenarnya sudah bisa dilakukan
  repo ini — hanya belum diterapkan ke jurnal/dokumen.
- **Beranda akuntansi** — status periode bulan berjalan, indikator neraca seimbang, dan
  panel Input Cepat tergate izin membuat halaman ini benar-benar halaman kerja, bukan
  sekadar etalase grafik.

## Metodologi & batas

Inspeksi baca-saja atas seluruh halaman `src/app/app/akuntansi/**`, komponen
`src/components/akuntansi/**`, navigasi `src/lib/modules.ts`, dan komponen blok bersama.
Tidak ada kode diubah, tidak ada klaim hasil lari aplikasi/browser di audit ini; temuan
aksesibilitas dibatasi pada yang terlihat dari kode (AK5-20) dan tidak mengklaim ulang
hasil axe program sebelumnya.
