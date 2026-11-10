# Status Tutup A-25 — per temuan audit & pengukuran workflow ulang

**Tahap U7, 6 November 2026.** Dokumen penutup program A-25: status akhir
54 temuan `AUDIT-UI-A25.md`, angka gerbang final, dan pengukuran ulang
workflow alur tersering per modul. Status ditetapkan dari laporan tahap
U0–U6 **dan** verifikasi visual U7 atas screenshot sesudah semua menu
(`~/workspace/bukti-a25-final/`, 77 berkas — himpunan 76 lama + halaman
Persetujuan baru). Temuan yang tidak terverifikasi berubah dinyatakan
apa adanya.

## Gerbang final (dari reseed bersih, tanpa pipa)

| Gerbang | Hasil |
|---|---|
| `pnpm db:seed -- --force` | 65 produk, nilai persediaan Rp28.349.600 (baseline konsisten) |
| `pnpm test` | **exit 0 — 1600/1600** (164 berkas) |
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **exit 0** (0 error; 23 warning pra-ada di berkas POS/test) |
| `pnpm build` | **exit 0** |
| `pnpm test:e2e` | **exit 0 — 19/19** |
| POS beku | Screenshot terminal pada baseline bersih **identik byte-per-byte** dengan referensi U0/U1 — md5 `dfe3ffaa2374fb1a5f74016cd96e1d71` |

## Ringkasan status

**Tertutup 34 · Tertutup sebagian 16 · Sisa terjadwal 4** (dari 54).

## Pengukuran workflow ulang (dulu → kini)

### Gudang
1. **Terima barang dari PO** — dulu: form penerimaan manual, baris disusun
   ulang dari ingatan. Kini: Mode Operasi memindai nomor dokumen ke
   antrean penerimaan tertaut PO, atau form penerimaan dengan tautan PO
   yang mengisi baris otomatis (terbukti di U7: PO-2026-00001 → penerimaan
   terposting dari tautannya).
2. **Buat retur pembelian** — dulu: satu form panjang dengan urutan
   terbalik (picker barang paling bawah) dan nilai retur tak terlihat
   sampai posting. Kini: alur berurutan pemasok/gudang → cari barang →
   alasan & penyelesaian → posting, dengan perkiraan nilai (AVCO, berlabel
   jujur sebagai perkiraan) tampil selama pengisian.
3. **Stok opname** — dulu: tugas + hitung + riwayat bertumpuk terbuka
   dalam satu halaman. Kini: satu halaman bertab Hitung/Tugas/Riwayat —
   satu pekerjaan per tampilan.
4. **Bayar utang dari konteks pemasok** — dulu: mustahil dari detail
   pemasok (nol aksi); mulai ulang dari menu Piutang & Utang. Kini: aksi
   Bayar utang di detail pihak, tertaut daftar Piutang-Utang tersaring.

### Akuntansi
1. **Bayar utang / terima piutang** — **5 langkah → 3 langkah** (dari
   antrean WorkQueue beranda atau baris daftar, dialog pembayaran yang
   sama).
2. **Rekonsiliasi bank** — dulu: formulir impor CSV mendominasi paruh
   atas, dua daftar ditumpuk vertikal (gulir naik-turun). Kini: mutasi
   bank dan buku berdampingan (`xl:grid-cols-2`); impor menjadi dialog
   "Impor mutasi" yang dibuka saat dibutuhkan.
3. **Jurnal manual** — dulu: panel menyatakan "Belum seimbang — selisih
   Rp 0" sejak halaman dibuka. Kini: panel netral saat kosong ("Belum
   ada baris terisi"), peringatan hanya bila terisi dan tak seimbang,
   alasan tombol posting nonaktif tertulis di tempatnya, panduan
   terlipat.
4. **Transisi periode fiskal** — dulu: 24 tombol permanen (termasuk
   "Kunci" untuk bulan yang sudah ditutup). Kini: satu menu ⋯ per bulan
   berisi hanya transisi yang sah; daftar periksa kini menulis tanggal
   acuannya ("Masih berselisih per 2026-10-31").

### HR
1. **Jalankan payroll** — dulu: form satu halaman dengan panel riwayat
   menyempitkan tabel karyawan. Kini: wizard 3 langkah (pratinjau
   berlabel estimasi → tinjau per karyawan + panel pengecualian →
   posting) dengan payload aksi yang sama persis — terverifikasi
   menghasilkan run & jurnal yang konsisten (U5: PRL-2026-00001 +
   JE-2026-00054; U7 menjalankan ulang wizard sampai terposting).
2. **Setujui pengajuan** — dulu: cuti, lembur, dan klaim diperiksa di
   tiga halaman terpisah. Kini: satu halaman **Persetujuan**
   (ApprovalInbox gabungan) dengan lencana menu berisi hitungan
   gabungan. Kasbon & pinjaman jujur di luar antrean — domainnya memang
   tanpa status menunggu (tertulis di halaman).
3. **Absensi** — dulu: lima form terbuka, rekap (yang paling dicari) di
   paling bawah. Kini: rekap sebagai isi utama; empat form kelola
   bertab di bawahnya.

### Pengaturan
1. **Ubah konfigurasi Payroll Indonesia** — dulu: ±25 tombol Simpan (satu
   per baris), tanpa indikator perubahan. Kini: ubah semua nilai → satu
   klik Simpan pada bilah terpaku per seksi, dengan indikator "Ada
   perubahan belum disimpan"; uji asap U6 membuktikan nilai (nama legal,
   tarif JKK 1,74→1,75) tersimpan di server dan tampil benar sesudah
   muat ulang.
2. **Ubah pengaturan umum** — dulu: satu form raksasa ±20 field lintas
   modul, tombol simpan hanya di dasar. Kini: empat seksi bertopik
   (identitas / pajak / termin-ambang / alur kerja) + bilah simpan yang
   selalu terlihat.
3. **Ganti peran pengguna** — dulu: select inline di sel tabel tersimpan
   seketika per klik. Kini: draf peran banyak baris diterapkan sekali
   oleh satu saver halaman.

## Status per temuan

### Pola bersama (16)

| ID | Status | Catatan penutup |
|---|---|---|
| POLA-01 | Tertutup | Halaman bertumpuk dipecah per pola: opname bertab, absensi bertab, taksonomi produk jadi drawer, bank & rekonsiliasi dipecah, Pengaturan per seksi (U2–U6). |
| POLA-02 | Tertutup | PageHeader v2 (U1): judul ganda hilang; deskripsi menjadi "Penjelasan halaman" terlipat — terlihat di semua screenshot final. |
| POLA-03 | Tertutup sebagian | Format tampilan tanggal seragam (dd Mon yyyy) di semua render dan DateField dd/mm/yyyy terpasang di form utama (jurnal, HR, payroll, filter daftar). Sisa jujur: input tanggal native masih dipakai sejumlah form dialog — terlihat di halaman Laporan (input native berformat AS) dan form pinjaman; grep U7 menemukan ±20 berkas ber-`type="date"`. |
| POLA-04 | Tertutup | Qty PR lewat `formatQty` (U0); uang statutori MoneyInput (U0); persen statutori PercentInput — "4.0000" tampil "4 %", nilai kanonis tak berubah, 38 test (U6). |
| POLA-05 | Tertutup | SettingsLayout massal: saver per seksi/halaman + indikator kotor; uji asap saver 6/6 (U6). |
| POLA-06 | Tertutup sebagian | Toolbar DataList tunggal di daftar yang dirombak; Nilai persediaan kini punya pencarian + paginasi (terverifikasi visual U7, mengoreksi catatan U3). Sisa: filter tanggal/status daftar PO/penerimaan tidak ditambah (fungsi baca hanya q+page) dan pencarian daftar retur belum didukung fungsi bacanya. |
| POLA-07 | Tertutup sebagian | RowMenu (destruktif terpisah di dasar menu) terpasang luas di U3/U4. Sisa: baris berdialog-trigger-sendiri (batasan komponen) dan 3 daftar dengan komponen bersama (`partner-forms`/`void-buttons`/`approval-buttons`) belum bermenu ⋯. |
| POLA-08 | Tertutup | EmptyState v2 ringkas; WorkQueue bernilai nol tidak dirender; detail pihak dirombak (U2–U3). |
| POLA-09 | Tertutup | KPI nol tak lagi mendahului daftar: beranda akuntansi = antrean hidup + 4 StatCard kunci; DataList tanpa KPI bawaan. |
| POLA-10 | Tertutup | Rute cetak pindah ke grup `(cetak)` tanpa ModuleShell, URL utuh; label status dokumen diterjemahkan lewat StatusBadge (U4). |
| POLA-11 | Tertutup | `not-found` terawat berbahasa Indonesia (U0). |
| POLA-12 | Tertutup sebagian | Label status & judul utama kini Indonesia; jargon pengembang (D-25, nomor migrasi) tinggal di komentar kode, bukan UI (grep U7). Sisa: beberapa label Inggris bertahan (mis. menu "Reimbursement"). |
| POLA-13 | Tertutup sebagian | Deskripsi halaman terlipat di mana-mana dan "Panduan singkat" jurnal kini terlipat bawaan (terverifikasi visual U7). Sisa: blok "Alur yang disarankan" di dasar halaman Periode masih terbuka permanen. |
| POLA-14 | Tertutup | Tema `.theme-erp`: sidebar terang, palet netral baru di sekitar plum merek, hierarki tipografi ditegakkan (U0–U1). |
| POLA-15 | Tertutup | DocumentPage + rel Rincian Jurnal seragam di semua detail dokumen (U2–U5). |
| POLA-16 | Tertutup | Breadcrumb statis yang menyesatkan dibuang; topbar menampilkan konteks modul, posisi halaman dari judul halaman & sorotan sidebar (keputusan desain U1, tercatat di `module-shell.tsx`). |

### Gudang (13)

| ID | Status | Catatan penutup |
|---|---|---|
| GDG-01 | Tertutup | Form retur berurutan kerja dengan perkiraan nilai AVCO di rel selama pengisian (U3). Nilai final tetap ditentukan saat posting — label perkiraan jujur. |
| GDG-02 | Tertutup | Detail pemasok/pelanggan beraksi: bayar utang/terima pembayaran tertaut, ubah profil, buat PO (U3). |
| GDG-03 | Tertutup sebagian | Produk ke DataList + drawer taksonomi (U2). Keadaan toolbar massal *saat baris terpilih* tidak terverifikasi khusus di U7. |
| GDG-04 | Tertutup sebagian | Dokumen transfer memakai DocumentPage + StatusSteps sehingga tahap & sisa penerimaan berkonteks. Sisa: `transfer-receive-form` tidak dikulit ulang (catatan U3). |
| GDG-05 | Tertutup sebagian | Kotak pencarian, filter gudang, dan paginasi kini ada dan bekerja (terverifikasi visual U7: "1–50 dari 67"). Sisa konseptual: data stok & nilai tetap tampil di dua tempat (Produk & Nilai persediaan). |
| GDG-06 | Tertutup sebagian | Teks keadaan kini menjelaskan ("Semua stok berada di atas stok minimumnya…", terverifikasi U7). Daftar "mendekati minimum" tetap tak bisa ditampilkan — fungsi baca hanya mengembalikan produk ≤ minimum. |
| GDG-07 | Tertutup | Teks empty state Penyesuaian kini benar: "Dokumen penyesuaian stok — barang rusak, kedaluwarsa, hilang, dan karantina — akan tampil di sini" (terverifikasi visual U7). |
| GDG-08 | Tertutup sebagian | Pergerakan stok ke DataList (U3). Pengelompokan per dokumen/hari dan tautan referensi ke dokumen asal tidak terverifikasi dibangun. |
| GDG-09 | Tertutup | Wizard impor kini berindikator langkah (1 Unggah berkas → 2 Petakan kolom → 3 Validasi & pilih baris → 4 Impor) dan kontrol pilih berkas ter-styling ("Pilih berkas", bukan input native Inggris) — terverifikasi visual U7. |
| GDG-10 | Tertutup sebagian | Mode Operasi menjadi "Antrean operasi": antrean hidup bermakna (kartu penerimaan PO beserta sisa qty, terverifikasi U7). Sisa: saat antrean kosong tetap tidak ada jalan pintas manual di halaman ini. |
| GDG-11 | Tertutup sebagian | Beranda gudang kini WorkQueue hidup (stok menipis tampil sebagai kartu antrean bertautan, terverifikasi U7). Info kedaluwarsa tidak terverifikasi tampil sebagai antrean tersendiri. |
| GDG-12 | Tertutup | Angka 0 pada panel "Stok per gudang" di detail produk kini netral, tidak merah (terverifikasi visual U7). |
| GDG-13 | Sisa terjadwal | Tidak dikerjakan (catatan U3): utilitas duplikat pihak tetap halaman menu tersendiri, belum menjadi panel/dialog di halaman Pemasok. |

### Akuntansi (12)

| ID | Status | Catatan penutup |
|---|---|---|
| AKT-01 | Tertutup | Rekonsiliasi berdampingan; impor menjadi dialog (U4). |
| AKT-02 | Tertutup sebagian | Judul seksi ganda hilang, antrean hidup saja, KPI dipadatkan ke 4 kartu. Halaman tetap memuat Input Cepat + tren/komposisi + 2 tabel jatuh tempo (terverifikasi visual U7). |
| AKT-03 | Tertutup sebagian | Kartu Input Cepat tetap mencampur modal & halaman; pembedanya kini label "HALAMAN ↗" yang konsisten plus sub-teks perilaku ("Membuka halaman…" / "langsung dari modal"). |
| AKT-04 | Tertutup | Label kartu antrean selaras dengan tabel: "1 nota terlambat" dibedakan dari "2 nota belum lunas" dan tabel memuat keduanya (terverifikasi visual U7). |
| AKT-05 | Sisa terjadwal | Tidak dibangun (catatan U4): daftar jurnal tetap tanpa rincian debit/kredit per baris. |
| AKT-06 | Tertutup | `journalBalanceState` (U2): peringatan hanya bila form terisi dan tak seimbang; keadaan kosong netral (terverifikasi visual U7). |
| AKT-07 | Tertutup | Detail jurnal ke DocumentPage (U2) — tombol hantu hilang, peringatan menjadi rel dokumen. |
| AKT-08 | Sisa terjadwal | Tidak dibangun penuh (catatan U4): buku besar tetap mulai dari pilih akun, tanpa daftar akun bersaldo untuk diklik masuk. |
| AKT-09 | Sisa terjadwal | Saklar "sembunyikan akun nol" tidak ada — semua akun Rp 0 tetap tampil di laporan (terverifikasi visual U7). |
| AKT-10 | Tertutup | Piutang & utang ke DataList/RowMenu/DateRangeField; header raksasa (4 KPI + 8 kartu aging) diringkas (U4). |
| AKT-11 | Tertutup | Transisi periode lewat RowMenu berisi hanya aksi sah; daftar periksa kini menulis tanggal acuannya di tempat ("Masih berselisih per 2026-10-31") — keduanya terverifikasi visual U7. |
| AKT-12 | Tertutup | Detail akun kini memuat tabel "Mutasi bulan ini", tombol Ubah, dan "Lihat di buku besar" (terverifikasi visual U7). |

### HR (7)

| ID | Status | Catatan penutup |
|---|---|---|
| HR-01 | Tertutup | Zona berhenti & pembayaran akhir terlipat bawaan di detail karyawan (U5). |
| HR-02 | Tertutup | Chip navigasi ganda dibuang; navigasi tunggal dari sidebar (U5, terlihat di screenshot final). |
| HR-03 | Tertutup | Daftar jenis cuti menjadi DataList bertabel (U5). |
| HR-04 | Tertutup | Satu pemilih periode di header; seksi Pengajuan & Draf THR sama-sama mengikuti periode itu (terverifikasi visual U7). |
| HR-05 | Tertutup | Banner kelengkapan data di detail karyawan menandai field wajib yang kosong (U5). |
| HR-06 | Tertutup | Payroll menjadi wizard; panel riwayat tak lagi menyempitkan tabel utama (U5). |
| HR-07 | Tertutup | Detail run ke DocumentPage: grid KPI 4+1 hilang (diganti rel Ringkasan run) dan aksi Slip menjadi tombol jelas per baris (terverifikasi visual U7). |

### Pengaturan (6)

| ID | Status | Catatan penutup |
|---|---|---|
| PNG-01 | Tertutup | Navigasi tunggal SettingsLayout; deretan chip ganda dibuang (U6). |
| PNG-02 | Tertutup | Tab Umum dipecah 4 seksi bertopik (U6). |
| PNG-03 | Tertutup | Bilah simpan terpaku + indikator perubahan belum disimpan; uji asap saver 6/6 (U6). |
| PNG-04 | Tertutup | Panel QRIS menyatu ke grid tata letak, tidak lagi mengambang (U6). |
| PNG-05 | Tertutup sebagian | Angka & persen terbaca (PercentInput), saver per seksi, TER terlipat per kategori. Sisa poles (catatan U6): kolom pertama tabel Program BPJS sempit sehingga nama + catatan pendanaan membungkus tinggi; seksi Parameter tidak dilipat. |
| PNG-06 | Tertutup sebagian | Ganti peran tidak lagi tersimpan seketika: draf banyak baris diterapkan satu saver halaman (U6). Konfirmasi khusus untuk perubahan peran tidak ditambahkan. |

## Sisa terjadwal (4) — untuk program berikutnya

1. **GDG-13** — duplikat pihak menjadi panel/dialog di halaman Pemasok.
2. **AKT-05** — rincian debit/kredit per baris di daftar jurnal.
3. **AKT-08** — buku besar dibuka dari daftar akun bersaldo.
4. **AKT-09** — saklar sembunyikan akun bersaldo nol di laporan.

Ditambah sisa-sisa "sebagian" di atas — terutama input tanggal native di
form dialog (POLA-03), RowMenu pada baris berdialog-trigger-sendiri
(POLA-07), pencarian daftar retur & filter tanggal/status PO/penerimaan
yang menunggu perubahan fungsi baca (POLA-06), dan daftar "mendekati
minimum" (GDG-06). Semuanya pekerjaan terpisah di luar mandat penyajian
A-25 atau poles lanjutan; tidak ada yang disembunyikan.
