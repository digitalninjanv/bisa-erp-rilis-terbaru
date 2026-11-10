# Audit Adversarial Akuntansi — Bagian 1: Buku Besar Inti

**Lingkup:** mesin jurnal (`postJournal`), COA, periode fiskal, pemetaan akun, jurnal manual, saldo awal.
**Metode:** inspeksi kode (berkas:baris) + kueri SELECT atas DB dev (5.312 jurnal posted, 12 perusahaan fixture/demo). Tidak ada kode/data diubah.
**Sikap:** semua dianggap salah sampai terbukti benar. Hasilnya: fondasi mesin jurnal ternyata kuat (lihat Bab BENAR), tetapi ada 15 temuan: **P0: 0 · P1: 1 · P2: 5 · P3: 9**.

---

## TEMUAN

### AK1-01 — Periode tanpa baris = terbuka selamanya; posting backdated tanpa batas [P1 · JALUR-BOCOR]
`assertPeriodOpen` hanya menolak bila baris `fiscal_periods` ADA dan statusnya bukan `open` (`src/server/accounting.ts:44-67`). Bulan/tahun tanpa baris dianggap terbuka — diakui sendiri di komentar AK-P2-01 (`src/server/actions/accounting.ts` ±baris 1890). Bukti angka: DB dev hanya punya 12 baris periode (10 closed, 2 open) untuk seluruh perusahaan; semua bulan lain di semua tahun "terbuka".
**Dampak:** siapa pun berizin posting dapat memposting jurnal manual bertanggal 2020 hari ini, mengubah laporan historis tanpa satu pun jejak penutupan. Ini vektor fraud klasik akuntansi (backdating) dan membuat "tutup periode" bersifat sukarela total. Terkait: jurnal bertanggal masa depan juga tidak dibatasi/diberi peringatan sama sekali.

### AK1-02 — `postJournal` tidak menolak baris negatif dan baris dua-sisi [P2 · JALUR-BOCOR]
Filter baris hanya membuang baris nol (`src/server/accounting.ts:109-115`); tidak ada validasi bahwa debit/kredit ≥ 0 atau bahwa satu baris hanya boleh satu sisi. Skema aksi jurnal manual pun memakai `moneyStringOptional` tanpa aturan tanda (`src/lib/action-validation.ts:71-92`). Baris `debit=-5.000, credit=10.000` lolos Zod, lolos `postJournal`, dan tersimpan — trigger DB hanya memeriksa Σdebit = Σkredit, yang tetap terpenuhi secara aritmetika.
**Dampak:** integritas buku besar bergantung pada kedisiplinan pemanggil, bukan mesin. DB saat ini bersih (SELECT: 0 baris negatif, 0 baris dua-sisi dari seluruh `journal_lines`), tetapi penjaga domainnya tidak ada — satu pemanggil baru yang ceroboh cukup untuk meracuni ledger.

### AK1-03 — Sembilan kunci pemetaan yang dipakai kode TIDAK bisa diubah dari Pengaturan [P2 · KURANG-LENGKAP]
Kode mengonsumsi 33 kunci pemetaan berbeda. Editor Pengaturan hanya menampilkan 23 baris (`MAPPING_LABELS`, `src/components/pengaturan/settings-forms.tsx:770-794`, dirender di `:832`), dan `saveMappingAction` menolak kunci di luar daftar putih 24 kunci (`src/server/actions/accounting.ts` ±baris 1771-1796). Kunci yang terpakai kode tetapi tidak bisa diubah dari UI maupun action:
`supplier_credit` (Kredit Pemasok — `src/server/supplier-returns.ts`), `employee_receivable` (Piutang Karyawan — `src/server/employee-advances.ts`, `src/server/hr.ts`), `employee_loan_receivable` (`src/server/employee-loans.ts:57-64`), `pph21_payable`, `bpjs_payable`, `payroll_employer_expense` (`src/server/hr.ts:1931-1972`, `src/server/actions/accounting.ts`), `fixed_asset`, `accumulated_depreciation`, `depreciation_expense` (`src/server/fixed-assets.ts:49-51, 214-215`). Kunci `salary_deductions_payable` masuk daftar putih tetapi tidak punya baris UI (dipakai sebagai fallback di `src/server/hr.ts:1932`).
**Dampak:** klaim "pemetaan akun configurable dari Pengaturan" tidak terpenuhi untuk retur pemasok, kasbon/pinjaman, seluruh payroll Indonesia, dan aset tetap. Perusahaan yang struktur COA-nya menyimpang dari seed (mis. Utang PPh 21 digabung ke akun pajak lain) tidak punya jalan resmi mengubahnya.

### AK1-04 — Trigger DB tidak melarang INSERT baris baru ke jurnal yang sudah posted [P2 · JALUR-BOCOR]
Trigger ketidakubahan hanya menembak pada UPDATE/DELETE (`src/db/migrations/0001_rls_and_guards.sql:71-102`), dan trigger keseimbangan `journal_entries_balanced` hanya menembak pada INSERT `journal_entries` (deferred, `:42-69`). Menambah baris ke entri yang sudah ter-commit tidak memicu pemeriksaan apa pun, sementara peran aplikasi memegang hak INSERT atas `journal_lines` (`:128`).
**Dampak:** di lapis aplikasi bersih (satu-satunya insert baris ada di `postJournal`, `src/server/accounting.ts:196-209`, satu transaksi dengan entrinya), tetapi pertahanan berlapis bocor: skrip/akses DB langsung dapat membuat jurnal posted menjadi tidak seimbang tanpa satu pun alarm. Trigger 0001 tidak pernah diubah oleh migrasi 0002-0038 (grep: nol referensi).

### AK1-05 — Tidak ada jurnal penutup akhir tahun [P2 · FUNGSI-HILANG]
Tidak ada proses jurnal penutup (pendapatan/beban → Laba Ditahan) di seluruh `src/server` maupun UI akuntansi (grep "jurnal penutup/closing/tutup buku": nol hasil). Akun 3100 Laba Ditahan ada di COA tetapi tidak pernah menerima jurnal penutup terposting.
**Dampak:** penutupan tahun buku — praktik standar akuntansi Indonesia — hanya bisa dilakukan manual baris per baris oleh pengguna. (Apakah laporan menyajikan laba tahun berjalan secara virtual adalah pertanyaan Bagian 3; di lapis buku besar, jurnal penutup memang tidak ada.)

### AK1-06 — Tidak ada PPN Masukan: akun dan kunci pemetaan `tax_input` tidak eksis [P2 · KURANG-LENGKAP]
COA bawaan hanya punya 2200 PPN Keluaran (`src/db/seed.ts:302`); tidak ada akun PPN Masukan, dan grep `tax_input` di seluruh kode: nol. Konsekuensi yang sudah tercatat sejak A-12: domain beban tidak memposting pajak masukan.
**Dampak:** perusahaan PKP tidak dapat mencatat PPN masukan atas pembelian dan tidak dapat mengkompensasikannya terhadap PPN keluaran — fungsi pajak dasar untuk bisnis kena pajak tidak lengkap di buku besar.

### AK1-07 — Akun lazim lain yang hilang dari COA bawaan [P3 · KURANG-LENGKAP]
Dari 41 akun seed (`src/db/seed.ts:277-325`), yang lazim untuk bisnis umum Indonesia tetapi tidak ada: Uang Muka Pembelian, Biaya Dibayar di Muka (1400 hanya "Perlengkapan"), Utang Pajak umum (PPh 23/25/29, PPN kurang bayar — hanya ada Utang PPh 21 & BPJS), Biaya Akrual / yang masih harus dibayar, Prive pemilik, Persediaan Dalam Perjalanan (transfer in-transit S7B-2 tidak punya akun GL khusus). Pengguna bisa menambah manual, tetapi bawaan "siap pakai" belum selengkap klaimnya. Catatan terkait: tidak ada jalur template COA untuk perusahaan baru di aplikasi — akun bawaan hanya lahir dari `src/db/seed.ts` (demo), impor master, dan ensure payroll/aset tetap; tidak ada `insert(accounts)` templat di jalur pembuatan perusahaan.

### AK1-08 — Keseimbangan divalidasi sebelum pembulatan penyimpanan (4 desimal) [P3 · SALAH-HITUNG]
`postJournal` membandingkan Σ Decimal mentah (`src/server/accounting.ts:119-130`) tetapi menyimpan `toDb(...)` = dibulatkan 4 desimal per baris (`:196-209`; `src/lib/money.ts:21-23`). **Bukti angka:** SELECT menemukan **10 baris jurnal** di DB dev yang menyimpan residu di bawah 2 desimal (pecahan sub-sen dari pembagian AVCO/pajak). Kasus asimetris (1 baris debit vs 2 baris kredit) dapat menghasilkan selisih tersimpan 0,0001 — yang kemudian ditolak trigger DB saat commit sebagai error mentah, atau menetap sebagai residu.
**Dampak:** kecil secara nominal, nyata secara prinsip: yang divalidasi bukan yang disimpan. Perbaikan wajar: bulatkan baris ke 4 desimal SEBELUM uji keseimbangan di dalam `postJournal`.

### AK1-09 — Jurnal berulang, draf jurnal, dan lampiran jurnal tidak ada [P3 · FUNGSI-HILANG]
Status `draft` dideklarasikan di skema (`src/db/schema.ts:385`) tetapi tidak pernah ditulis kode mana pun — jurnal manual selalu langsung posted. Grep jurnal berulang/recurring: nol. Kolom lampiran hanya ada di reimbursement (`src/db/schema.ts:2106-2109`), bukan di `journal_entries`. Yang ada hanya 6 pola cepat statis (`src/lib/journal-form.ts:88-151`).
**Dampak:** beban rutin bulanan (sewa, langganan) harus diketik ulang; tidak ada alur draf→periksa→posting untuk jurnal manual — kontrol internal umum yang hilang.

### AK1-10 — Tahun fiskal non-Januari tidak didukung [P3 · KURANG-LENGKAP]
Periode dan seri nomor selalu memakai tahun kalender dari tanggal jurnal (`src/server/accounting.ts:45-47`; `src/server/sequences.ts:49-50`). Tidak ada konfigurasi awal tahun fiskal di mana pun (grep: nol). Perusahaan dengan tahun buku April–Maret atau Juli–Juni tidak dapat dimodelkan; penomoran dan penutupan periode akan selalu berbasis Januari.

### AK1-11 — Buka kembali periode `closed` terlalu mudah; penutupan tak berurutan dibiarkan [P3 · JALUR-BOCOR]
Kewajiban owner + alasan hanya berlaku untuk membuka periode `locked`; transisi `closed → open` boleh dilakukan siapa pun berizin `accounting.manage` tanpa alasan wajib (`src/server/actions/accounting.ts` ±baris 1885-1901; alasan hanya dicatat audit untuk unlocking). Juga tidak ada kendala urutan: Desember dapat ditutup selagi Januari masih terbuka.
**Dampak:** perbedaan perlakuan closed vs locked mudah disalahpahami pengguna; "ditutup" praktis hanya label bila dapat dibuka kembali tanpa alasan.

### AK1-12 — Saldo awal memakai akun Modal Pemilik sebagai lawan; tak ada saldo awal GL umum [P3 · KURANG-LENGKAP]
Saldo awal utang/piutang dijurnal melawan pemetaan `equity` = 3000 Modal Pemilik (`src/server/opening-balances.ts:201-225`). Tidak ada akun khusus "Saldo Awal/Pembuka", sehingga riwayat setoran modal tercampur dengan saldo migrasi. Di luar AR/AP dan stok awal, tidak ada fitur saldo awal per akun GL (kas/bank awal harus lewat jurnal manual biasa). Keduanya dapat diterima sebagai penyederhanaan, tetapi harus disadari sebagai keputusan, bukan kelengkapan.

### AK1-13 — `reverseSourceJournal` mengambil jurnal asal dengan `limit(1)` tanpa urutan [P3 · JALUR-BOCOR]
Jurnal asal dicari dengan `limit(1)` tanpa `orderBy` (`src/server/accounting.ts:250-262`). Hari ini aman karena semua domain pemanggil (expense, transfer, receipt, sale, kasbon, pinjaman, aset) memang menerbitkan tepat satu jurnal per (sourceType, sourceId) — terbukti dari pola pemanggilnya. Tetapi fungsi generik ini akan membalik jurnal yang salah secara diam-diam bila kelak ada sumber multi-jurnal.

### AK1-14 — Menonaktifkan akun yang sedang dipetakan tidak dicegah [P3 · JALUR-BOCOR]
Penjaga referensi lengkap hanya ada di jalur hapus (`src/server/actions/accounting.ts:1695-1796`). Jalur ubah (`:1615-1672`) tidak memeriksa pemetaan/metode bayar saat `isActive` dimatikan — akun pemetaan yang dinonaktifkan membuat transaksi berikutnya gagal di tengah operasional (pesan errornya jelas dari `postJournal`, tetapi gangguannya nyata). Terkait: `normalBalance` akun yang sudah ber-jurnal boleh diubah bebas; hanya `type` yang dijaga (`:1645-1660`).

### AK1-15 — `assertPeriodOpen` lolos untuk tanggal tidak valid di lapis domain [P3 · SALAH-HITUNG]
`new Date("...")` yang tidak valid menghasilkan tahun/bulan NaN; kueri periode tidak menemukan baris → dianggap terbuka (`src/server/accounting.ts:45-47`). Teredam di praktik karena semua action memvalidasi tanggal secara ketat (`isoDate`, `src/lib/action-validation.ts:104-125`), tetapi fungsi domain se
...[truncated 2670 chars]