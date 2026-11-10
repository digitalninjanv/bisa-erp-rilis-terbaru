# Audit Modul Akuntansi — Bisa ERP

- **Tanggal audit:** 2026-11-03
- **Jenis:** Audit kode baca-saja (static). Tidak ada kode sumber yang diubah. Tidak ada pengujian runtime/database dalam audit ini — status di bawah adalah vonis dari pembacaan kode; yang tidak bisa dibuktikan dari kode ditandai `NOT_VERIFIED`.
- **Acuan klaim:** `README.md` dan `AGENTS.md` proyek. Prinsip: *IMPLEMENTED ≠ WORKING*.
- **Cakupan:** `src/app/app/akuntansi/**`, `src/components/akuntansi/**`, `src/server/accounting.ts`, `src/server/actions/accounting.ts`, `src/server/reports.ts`, `src/lib/accounting.ts`, `src/lib/money.ts`, skema terkait di `src/db/schema.ts`, migrasi penjaga `src/db/migrations/0001_rls_and_guards.sql`, serta titik singgung `src/server/actions/settings.ts`, `src/components/pengaturan/settings-forms.tsx`, `src/app/api/export/report/route.ts`, dan `tests/integration/consistency.test.ts`.
- **Legenda status:** `WORKING` terbukti dari kode · `PARTIAL` jalan tapi ada lubang/keterbatasan nyata · `BROKEN` menghasilkan hasil salah · `MISSING` tidak ada · `UI_ONLY` tampilan ada, fungsi di baliknya tidak · `NOT_VERIFIED` tidak bisa dibuktikan dari kode.

## Ringkasan vonis

| Prioritas | Jumlah |
|---|---|
| P0 | 0 |
| P1 | 4 |
| P2 | 12 |
| P3 | 7 |
| **Total** | **23** |

Fondasi inti ternyata kuat: keseimbangan jurnal ditegakkan dua lapis (Decimal di aplikasi + trigger deferred di DB), jurnal posted append-only via trigger, dan **semua** jalur posting runtime (POS, gudang, impor, akuntansi) mengalir lewat satu pintu `postJournal` yang memanggil `assertPeriodOpen`. Masalah terbesar bukan di fondasi, melainkan di **laporan bertanggal** (neraca per tanggal lampau salah diam-diam), **validasi akun pada posting**, dan **payroll yang mencatat beban sebesar nilai bersih**.

---

## Tabel fitur

| Fitur | Status | Bukti (file:baris) | Dampak |
|---|---|---|---|
| Jurnal seimbang (debit = kredit, > 0) | WORKING | `src/server/accounting.ts:89-112` (filter baris nol, cek seimbang Decimal); backstop DB `src/db/migrations/0001_rls_and_guards.sql` trigger `journal_entries_balanced` (deferred, AFTER INSERT) | Jurnal tidak seimbang tidak bisa ter-commit dari jalur mana pun |
| Jurnal posted append-only; koreksi hanya pembalik | WORKING | Trigger `journal_entries_immutable` + `journal_lines_immutable` di `0001_rls_and_guards.sql`; `reverseJournalEntry` `src/server/accounting.ts:207-265`; `reverseSourceJournal` `src/server/accounting.ts:150-205` | Sesuai aturan proyek; catatan: pembalik level-jurnal juga terbuka untuk jurnal sistem — lihat AK-P1-04 |
| COA: buat & edit akun | PARTIAL | `saveAccountAction` `src/server/actions/accounting.ts:594-649`; form `src/components/akuntansi/account-form.tsx:56-85` | Edit mengabaikan `code`, update id tak ditemukan sukses semu, ganti `type` akun bertransaksi tanpa penjaga — AK-P2-10 |
| COA: hapus akun berpenjaga | PARTIAL | `deleteAccountAction` `src/server/actions/accounting.ts:651-700` (penjaga jurnal, anak, pemetaan) | Penjaga tidak mencakup `payment_methods.account_id` dan `customer_groups.discount_account_id` — AK-P2-12 |
| COA: nonaktifkan akun | WORKING | `isActive` di `accountSchema` `src/server/actions/accounting.ts:573-592`; daftar postable menyaring aktif+postable `src/server/accounting.ts:280-292` | Akun nonaktif hilang dari form jurnal; tapi posting server-side tidak memeriksa ini — AK-P1-02 |
| Hierarki akun (induk/anak) | PARTIAL | `saveAccountAction` `src/server/actions/accounting.ts:597-606` (hanya cek induk = diri sendiri dan induk ada) | Siklus A→B→A tidak dicegah; `parentId` tanpa FK di `src/db/schema.ts:269` |
| Jurnal manual (form halaman penuh) | PARTIAL | `src/app/app/akuntansi/jurnal/baru/page.tsx:19-33`; `src/components/akuntansi/journal-entry-form.tsx:44-49,72-104`; `postManualJournalAction` `src/server/actions/accounting.ts:76-102` | Form bagus (indikator seimbang, memo per baris), tapi tanpa idempotency key — AK-P3-02; akun tujuan tidak divalidasi server — AK-P1-02 |
| Buku besar per akun | PARTIAL | `getLedger` `src/server/reports.ts:986-1041`; `src/app/app/akuntansi/buku-besar/page.tsx:95-122` | Saldo berjalan debit−kredit mentah untuk semua akun → akun kredit-normal tampil negatif — AK-P2-09; tanpa pagination — AK-P3-04 |
| Periode fiskal: posting ditolak saat tutup/kunci di semua jalur | PARTIAL | `assertPeriodOpen` `src/server/accounting.ts:37-58`, dipanggil `postJournal` `src/server/accounting.ts:112`; semua pemanggil `postJournal` terverifikasi lewat grep di `src/server/pos.ts`, `src/server/inventory.ts`, `src/server/actions/import.ts`, `src/server/actions/accounting.ts` | Penegakan terpusat itu benar; lubangnya: bulan tanpa baris periode dianggap terbuka — AK-P2-01 |
| Periode: buka kembali yang `locked` | PARTIAL | `setPeriodStatusAction` `src/server/actions/accounting.ts:720-755` (transisi bebas, izin sama `accounting.manage`); tombol "Buka" untuk locked di `src/components/akuntansi/period-manager.tsx:127-146` | `locked` tidak berbeda makna dari `closed`: sekali klik, tanpa alasan/konfirmasi — AK-P2-01 |
| Beban: catat + jurnal otomatis | WORKING | `createExpenseAction` `src/server/actions/accounting.ts:115-167` | Debit beban / kredit pembayaran dalam satu transaksi; pilihan akun di UI tidak menyaring aktif/postable (lihat AK-P1-02) |
| Beban: void via jurnal pembalik | PARTIAL | `voidExpenseAction` `src/server/actions/accounting.ts:169-219` | Hasil `reverseSourceJournal` yang `null` diabaikan → dokumen bisa void tanpa jurnal pembalik — AK-P2-05 |
| Transfer bank + biaya admin | PARTIAL | `createBankTransferAction` `src/server/actions/accounting.ts:221-283` (jurnal: tujuan debit nominal, fee debit, asal kredit nominal+fee) | Aritmetika benar; `map.bank_fee` tak diperiksa keberadaannya — AK-P2-06; tidak bisa di-void — AK-P2-04 |
| Transfer bank: void/koreksi dokumen | MISSING | `bankTransfers` tanpa kolom status `src/db/schema.ts:816-834`; tidak ada action void transfer di `src/server/actions/accounting.ts` | Satu-satunya koreksi adalah pembalik jurnal manual, dokumen transfer tetap tampil sebagai transaksi sah |
| Setoran modal | WORKING | `createCapitalAction` `src/server/actions/accounting.ts:817-857` | Debit kas/bank, kredit ekuitas (dari pilihan atau pemetaan `equity`) |
| Payroll: CRUD karyawan | PARTIAL | `saveEmployeeAction` `src/server/actions/accounting.ts:386-418`; `employeeSchema` `src/server/actions/accounting.ts:371-382` | Gaji/potongan negatif diterima (tanpa batas bawah); update id tak ditemukan mengembalikan `undefined` tapi UI menampilkan "tersimpan" — AK-P2-10 |
| Payroll: proses + jurnal | BROKEN | `runPayrollAction` `src/server/actions/accounting.ts:420-537`; jurnal di `src/server/actions/accounting.ts:481-492` memakai `totalNet` untuk beban dan utang | Beban gaji dicatat sebesar nilai **bersih**; potongan hilang dari buku besar — AK-P1-03 |
| Payroll: pembayaran gaji | WORKING | `payPayrollAction` `src/server/actions/accounting.ts:539-592` (cek status, idempotency key `payroll_payment:<runId>`) | Membayar penuh sebesar `totalNet`; tidak ada pembayaran sebagian |
| Payroll: void run | MISSING | Status run hanya `posted`/`paid` `src/db/schema.ts:858`; tidak ada action void payroll | Run salah hanya bisa dilawan jurnal manual; status run tetap `posted`/`paid` |
| Pembayaran utang (AP) | PARTIAL | `payPayableAction` `src/server/actions/accounting.ts:285-384` (kunci baris `for("update")` :313, cek sisa utang :321-324) | Anti-lebih-bayar dan anti-race bagus; tanggal selalu hari ini — AK-P2-03 |
| Penerimaan piutang (AR) | PARTIAL | Form bersama `src/components/akuntansi/payment-form.tsx:41-62` (tanpa field tanggal); action di `src/server/actions/pos.ts:247` (di luar cakupan inti, terhubung dari halaman piutang-utang) | Sama seperti AP: tidak ada pilihan tanggal pembayaran, tidak ada void pembayaran — AK-P2-03 |
| Pembayaran AR/AP: void/koreksi | MISSING | `partyPayments` tanpa status `src/db/schema.ts:889-908`; tidak ada action void pembayaran | Pembayaran salah catat tidak bisa dibatalkan dari UI; jurnalnya hanya bisa dibalik manual tanpa mengubah `paidAmount`/`paymentStatus` dokumen |
| Aging piutang/utang dari tanggal dokumen | WORKING | `agingBuckets` `src/app/app/akuntansi/piutang-utang/page.tsx:235-254` memakai `row.date` dokumen, bucket 0–30/31–60/61–90/>90 | Sesuai klaim README/AGENTS; catatan kecil: zona waktu dikeraskan `+07:00` di `page.tsx:243-245`, bukan dari `companySettings.timezone` |
| Laba rugi + pembanding tahun sebelumnya | PARTIAL | `getIncomeStatement` `src/server/reports.ts:177-245` (filter tanggal di WHERE, benar); UI `src/app/app/akuntansi/laporan/page.tsx:56-62,167-187` | Angka per akun benar; kolom pembanding menghilangkan akun yang hanya punya mutasi tahun lalu — AK-P2-07 |
| Neraca + pembanding tahun sebelumnya | BROKEN | `getBalanceSheet` `src/server/reports.ts:247-318`; kondisi tanggal ditaruh di LEFT JOIN `:263` sementara yang dijumlah kolom baris jurnal `:255-256` | Filter tanggal **tidak bekerja**: neraca per tanggal lampau memuat semua mutasi s.d. hari ini — AK-P1-01 |
| Perubahan ekuitas | BROKEN | `getEquityStatement` `src/server/reports.ts:375-433`; pola sama: kondisi `< range.from` di LEFT JOIN `:388`, saldo awal menjumlah semua baris `:382` | Saldo awal ekuitas = saldo sepanjang masa → saldo akhir terhitung ganda — AK-P1-01 |
| Arus kas | PARTIAL | `getCashFlow` `src/server/reports.ts:320-367`; klasifikasi `classify()` `:349-353` berdasarkan string `sourceType` | Mengabaikan `accounts.cash_flow_group` yang bisa dikustomisasi — AK-P2-08 |
| Neraca saldo | WORKING | `getTrialBalance` `src/server/reports.ts:142-175` (pola CASE WHEN tanggal di SELECT — benar) | Bukti pola yang benar ada di file yang sama; tanda kolom `closing` memakai asumsi tipe sedangkan `opening` memakai `normalBalance` (`:167-173`) — inkonsisten untuk akun kontra |
| Laporan hanya dari jurnal posted | PARTIAL | Hanya `listAccountBalances` menyaring `journalEntries.status = "posted"` (`src/server/reports.ts:1166`); fungsi laporan lain tidak; skema mengenal `draft \| posted \| void` `src/db/schema.ts:317` | Saat ini laten (semua jalur menulis `posted`, `src/server/accounting.ts:130`), tapi satu fitur draft di masa depan langsung mengotori semua laporan — AK-P2-02 |
| Pemetaan akun otomatis | PARTIAL | Editor 21 kunci `src/components/pengaturan/settings-forms.tsx:453-475,478-545`; `saveMappingAction` `src/server/actions/accounting.ts:702-718` | UI lengkap, tapi server menerima `key` bebas apa pun dan akun apa pun tanpa validasi — AK-P2-06 |
| Section & cash_flow_group per akun | PARTIAL | `src/lib/accounting.ts:52-65` (`resolveSection`/`resolveCashFlowGroup` + fallback dari tipe/kode); dipakai laba rugi & neraca | Section dihormati laporan; `cash_flow_group` **tidak dibaca fungsi laporan mana pun** (grep: hanya diteruskan di `src/server/reports.ts:1183`) — AK-P2-08 |
| Tarif pajak | PARTIAL | Satu tarif inklusif per perusahaan `src/db/schema.ts:234`; disimpan `src/server/actions/settings.ts:27,53` tanpa validasi rentang | Keterbatasan diakui README ("belum ada multi-tarif per produk"); tarif negatif atau >100% diterima diam-diam — AK-P3-06 |
| Penomoran dokumen otomatis | WORKING | `nextDocumentNumber` `src/server/sequences.ts:27-51` (upsert atomik per perusahaan/jenis/tahun, format `JE-2026-00001`) | Aman dari race; nomor terkonsumsi hanya dalam transaksi yang sama |
| Penomoran: kustomisasi format/prefix | MISSING | Prefix dikeraskan di `src/server/sequences.ts:5-19`; tidak ada kolom pengaturan format nomor | Perusahaan tidak bisa menyesuaikan format nomor dokumen |
| Ekspor CSV laporan | PARTIAL | `src/app/api/export/report/route.ts:25-93,159` menangani neraca/arus-kas/ekuitas/neraca-saldo/penjualan/laba-rugi | Tab `catatan` di UI laporan tetap menawarkan tombol CSV (`src/app/app/akuntansi/laporan/page.tsx:81-88`) tapi rutenya jatuh ke CSV laba rugi — AK-P3-05 |
| Dashboard ringkasan akuntansi | PARTIAL | `getAccountingSummary` `src/server/reports.ts:1122-1155`; nilai persediaan dari `stock_on_hand.qty * products.costPrice` `:1130-1134` | Nilai persediaan dashboard bisa berbeda dari saldo akun persediaan di neraca (harga pokok produk terkini vs jurnal persediaan) — AK-P2-11 |
| Cetak laporan | NOT_VERIFIED | Tombol cetak ada `src/app/app/akuntansi/laporan/page.tsx:89` (`PrintButton`) | Kebenaran hasil cetak/PDF tidak bisa dibuktikan dari pembacaan kode |
| Cakupan tes akuntansi | PARTIAL | `tests/integration/consistency.test.ts:26,81-107,145-188` (ledger seimbang, neraca seimbang **per hari ini**, semua statement dari rentang ISO) | Tidak ada tes neraca per tanggal lampau, payroll, beban, transfer, atau periode tertutup — persis di titik temuan P1 |

---

## Temuan prioritas

### P1 — dampak keuangan langsung / angka salah diam-diam

**AK-P1-01 — Filter tanggal neraca & saldo awal ekuitas tidak bekerja (LEFT JOIN menelan kondisi tanggal).**
Di `getBalanceSheet` (`src/server/reports.ts:247-318`), join ke `journalEntries` membawa syarat `lte(journalEntries.date, asOf)` di klausa JOIN (`:263`), tetapi agregatnya menjumlah kolom `journalLines.debit/credit` (`:255-256`). Pada LEFT JOIN, baris jurnal yang jurnalnya di luar tanggal tetap lolos (kolom jurnal menjadi NULL, kolom baris tidak), jadi **semua** baris ikut terhitung apa pun nilai `asOf`. Pola identik di saldo awal `getEquityStatement` (`src/server/reports.ts:375-411`, join `:388`, agregat `:382`): saldo awal = saldo sepanjang masa, lalu mutasi periode ditambahkan lagi → terhitung ganda. Akibat nyatanya: tab Neraca dengan tanggal lampau dan kolom "pembanding tahun sebelumnya" (`src/app/app/akuntansi/laporan/page.tsx:64-70`) menampilkan angka yang salah tanpa pesan error apa pun (hanya bendera `balanced` yang kadang menyala palsu). Tes integrasi tidak menangkapnya karena memanggil neraca dengan `asOf = todayISO()` (`tests/integration/consistency.test.ts:83`). Pola yang benar sudah ada di file yang sama: `getTrialBalance` memakai `CASE WHEN` tanggal di dalam SELECT (`src/server/reports.ts:150-153`).
*Rekomendasi:* pindahkan syarat tanggal ke `CASE WHEN` di agregat (ikuti `getTrialBalance`) atau saring lewat subquery; tambah tes integrasi neraca & ekuitas dengan `asOf` di tengah riwayat transaksi (transaksi sebelum dan sesudah `asOf`).

**AK-P1-02 — `postJournal` tidak memvalidasi akun tujuan; `journal_lines.account_id` tanpa foreign key.**
`postJournal` (`src/server/accounting.ts:60-148`) hanya memeriksa jumlah baris, keseimbangan, dan periode. Ia tidak memeriksa bahwa setiap `accountId`: ada, milik perusahaan yang sama, `isActive`, dan `isPostable`. Ia juga menerima baris yang debit **dan** kreditnya sama-sama > 0, dan nilai negatif yang lolos filter `gt(0)` bila sisi lain positif (`:89-95`). Di basis data, `journalLines.accountId` hanyalah `uuid` tanpa `.references()` (`src/db/schema.ts:343`) — bandingkan `entryId` yang punya FK (`:338-340`). Kombinasinya: jurnal manual (atau bug di modul mana pun) bisa memposting ke akun induk/non-postable, akun nonaktif, akun yang tidak ada, bahkan akun perusahaan lain; baris yatim itu lalu hilang dari laporan yang men-JOIN `accounts` (mis. `getIncomeStatement` `src/server/reports.ts:190-196`) tetapi tetap dihitung pemeriksaan keseimbangan yang tidak men-JOIN akun (`trialBalanceCheckAction` `src/server/actions/accounting.ts:792-810`) — buku besar bisa "seimbang" sambil laporan kehilangan uang. UI memang menyaring akun postable+aktif untuk form jurnal (`listPostableAccounts` `src/server/accounting.ts:280-292`), tapi itu pertahanan sisi tampilan saja; form beban (`src/app/app/akuntansi/beban/page.tsx:36-38`) bahkan menawarkan semua akun bertipe expense/cogs termasuk yang nonaktif/tidak postable.
*Rekomendasi:* di `postJournal`, muat semua akun baris dalam satu query dan validasi company/aktif/postable + tolak baris dua sisi dan nilai negatif dengan pesan Bahasa Indonesia; tambahkan FK `journal_lines.account_id → accounts.id` lewat migrasi baru; saring daftar akun form beban dengan kriteria yang sama seperti form jurnal.

**AK-P1-03 — Payroll mencatat beban gaji sebesar nilai bersih; potongan hilang dari buku besar.**
`runPayrollAction` menghitung `totalGross` (pokok + tunjangan) dan `totalDeductions` dengan benar untuk disimpan di run (`src/server/actions/accounting.ts:445-466`), tetapi jurnalnya mendebit `salary_expense` dan mengkredit `salary_payable` masing-masing sebesar `totalNet` (`src/server/actions/accounting.ts:481-492`). Akibatnya beban gaji di laba rugi selalu lebih kecil dari bruto sebesar total potongan, dan potongan (mis. BPJS/PPh) tidak pernah menjadi kewajiban maupun beban — tidak ada akun yang menampungnya dan tidak ada jalur penyetorannya. Selain itu karyawan yang potongannya melebihi bruto menghasilkan item bersih negatif tanpa penolakan per karyawan (hanya total agregat yang diperiksa > 0 di `:458`).
*Rekomendasi:* jurnalkan bruto: debit beban gaji sebesar bruto, kredit utang gaji sebesar bersih, kredit akun utang potongan (pemetaan baru, mis. `salary_deductions_payable`) sebesar total potongan; tolak item karyawan dengan bersih negatif.

**AK-P1-04 — Jurnal pembalik level-jurnal terbuka untuk jurnal sistem (POS, beban, gudang, payroll).**
Halaman detail jurnal menampilkan tombol "Balik jurnal" untuk **semua** jurnal posted tanpa memeriksa `sourceType` (`src/app/app/akuntansi/jurnal/[id]/page.tsx:31-40`), dan `reverseJournalEntry` (`src/server/accounting.ts:207-265`) hanya memeriksa status dan keberadaan pembalik. Membalik jurnal penjualan dari sini membalik buku besarnya saja: dokumen penjualan, stok, sesi kas, dan status dokumen sumber tidak berubah — subledger dan GL berpisah diam-diam, dan laporan penjualan (dari tabel `sales`, `src/server/reports.ts:435-468`) tetap menghitung penjualan yang jurnalnya sudah dibalik. Jalur yang benar untuk dokumen modul adalah `reverseSourceJournal` dari modul pemiliknya (yang juga mengubah status dokumen, mis. `voidExpenseAction`).
*Rekomendasi:* batasi `reverseJournalAction` untuk `sourceType = "manual"` (dan jurnal pembuka/penyesuaian yang memang berdiri sendiri); untuk jurnal sistem, arahkan pengguna ke void dari modul asalnya.

### P2 — fungsi cacat / lubang integritas & kustomisasi

**AK-P2-01 — Periode tanpa baris = terbuka; periode `locked` bisa dibuka lagi sekali klik.**
`assertPeriodOpen` hanya melempar error bila baris periode **ada** dan statusnya bukan `open` (`src/server/accounting.ts:50-58`). Perusahaan/tahun yang baris periodenya belum dibuat (tombol "Lengkapi 12 bulan" di `src/components/akuntansi/period-manager.tsx:76-86` bersifat manual) dapat dipostingi bebas meski admin mengira periode terkunci. Sebaliknya `setPeriodStatusAction` mengizinkan transisi apa pun termasuk `locked → open` dengan izin biasa `accounting.manage`, tanpa alasan dan tanpa jejak selain audit umum (`src/server/actions/accounting.ts:720-755`); UI menampilkan tombol "Buka" yang sama untuk `closed` dan `locked` (`period-manager.tsx:119`).
*Rekomendasi:* perlakukan periode tanpa baris sebagai tertutup untuk posting (atau buat baris 12 bulan otomatis saat perusahaan dibuat dan saat tahun berganti); membuka `locked` wajib izin owner + alasan wajib yang tercatat di audit.

**AK-P2-02 — Fungsi laporan tidak menyaring status jurnal `posted`.**
Seluruh fungsi laporan berbasis jurnal menjumlahkan baris tanpa syarat status — `mappedBalance` (`src/server/reports.ts:31-62`), `getTrialBalance` (`:142`), `getIncomeStatement` (`:177`), `getBalanceSheet` (`:247`), `getCashFlow` (`:320`), `getEquityStatement` (`:375`), `getLedger` (`:986`), `getJournalSummary` (`:865`) — satu-satunya pengecualian adalah `listAccountBalances` (`:1166`). Skema secara eksplisit mengenal status `draft | posted | void` (`src/db/schema.ts:317`). Hari ini aman hanya karena satu-satunya penulis adalah `postJournal` yang selalu menulis `posted` (`src/server/accounting.ts:130`); begitu ada draft jurnal atau void ala dokumen lain, semua laporan langsung salah tanpa ada yang berubah di kode laporan.
*Rekomendasi:* tambahkan `eq(journalEntries.status, "posted")` di semua query laporan sekarang, selagi murah, plus tes regresi dengan satu jurnal non-posted.

**AK-P2-03 — Pembayaran piutang/utang selalu bertanggal hari ini dan tidak bisa dibatalkan.**
`payPayableAction` mengeraskan tanggal pembayaran ke `todayISO()` di nomor dokumen, baris pembayaran, dan jurnalnya (`src/server/actions/accounting.ts:318,326,336`), dan form bersama tidak menyediakan field tanggal sama sekali (`src/components/akuntansi/payment-form.tsx:64-99`). Pembayaran yang sebenarnya terjadi kemarin hanya bisa dicatat sebagai hari ini — menggeser arus kas dan buku besar antarperiode (dan bisa meledak menjadi error `PERIOD_CLOSED` di awal bulan). Setelah tercatat, pembayaran tidak punya jalur koreksi: `partyPayments` tidak punya status (`src/db/schema.ts:889-908`) dan tidak ada action void; membalik jurnalnya manual pun tidak mengembalikan `paidAmount`/`paymentStatus` dokumen.
*Rekomendasi:* terima `date` dari form (default hari ini, divalidasi format tanggal), dan tambahkan void pembayaran yang membalik jurnal + mengembalikan status dokumen dalam satu transaksi (pola `voidExpenseAction`).

**AK-P2-04 — Transfer bank dan payroll run tidak punya jalur void dokumen.**
`bankTransfers` tidak memiliki kolom status sama sekali (`src/db/schema.ts:816-834`) dan tidak ada `voidBankTransferAction`; `payrollRuns` hanya bergerak `posted → paid` (`payPayrollAction` `src/server/actions/accounting.ts:539-592`). Kesalahan input transfer/payroll hanya bisa dilawan dengan jurnal manual, sementara dokumen aslinya tetap tampil sah di riwayat (`src/app/app/akuntansi/bank/page.tsx:149-186`) dan untuk payroll tetap bisa "dibayar".
*Rekomendasi:* tambahkan kolom status + action void berbasis `reverseSourceJournal` untuk keduanya, mengikuti pola beban yang sudah ada.

**AK-P2-05 — Void beban menelan kegagalan pembuatan jurnal pembalik.**
`voidExpenseAction` mengabaikan nilai kembali `reverseSourceJournal` (`src/server/actions/accounting.ts:183-191`) lalu tetap menandai beban `void` (`:192-195`). Jika jurnal asal tidak ditemukan (data lama, jurnal terlanjur dibalik lewat jalur lain), hasilnya: beban hilang dari daftar aktif dan total halaman beban (`src/app/app/akuntansi/beban/page.tsx:43-44`) tetapi beban tetap tercatat di buku besar — selisih diam-diam antara daftar beban dan laba rugi.
*Rekomendasi:* periksa hasil: bila `null`, batalkan void dengan `AppError` Bahasa Indonesia; samakan perlakuan di semua pemanggil `reverseSourceJournal`.

**AK-P2-06 — Pemetaan akun: kunci bebas, akun tidak divalidasi, dan konsumen tidak memeriksa kunci yang hilang.**
`saveMappingAction` menerima `key: z.string().min(1)` — kunci apa pun di luar 21 kunci resmi editor (`src/components/pengaturan/settings-forms.tsx:453-475`) diterima, dan `accountId` tidak diperiksa kepemilikan/perusahaan/postable/tipe yang masuk akal (`src/server/actions/accounting.ts:702-718`). Di sisi konsumen, `getAccountMap` mengembalikan record mentah (`src/server/accounting.ts:29-35`) dan action mengambil `map.bank_fee`, `map.payable`, `map.salary_expense`, `map.salary_payable` tanpa cek (`src/server/actions/accounting.ts:259,345,485-486`): pemetaan yang belum diisi menghasilkan baris jurnal ber-`accountId undefined` yang gagal sebagai error server generik — berbeda dengan `getAccountId` (`src/server/accounting.ts:17-27`) yang melempar pesan jelas "belum dipetakan di Pengaturan".
*Rekomendasi:* whitelist kunci di skema Zod (union dari daftar resmi), validasi akun milik perusahaan & postable saat menyimpan pemetaan, dan pakai `getAccountId`-style check untuk kunci wajib di setiap action.

**AK-P2-07 — Kolom pembanding tahun lalu menghilangkan akun yang hanya aktif di tahun lalu.**
`ComparisonGroup` merender baris hanya dari daftar akun periode berjalan dan mencocokkan nilai tahun lalu per `accountId` (`src/app/app/akuntansi/laporan/page.tsx:473-505`). Akun yang punya mutasi tahun lalu tetapi tidak tahun ini tidak muncul sebagai baris, padahal nilainya **termasuk** di total tahun lalu (`totalPrior` dari statement penuh) — rincian kolom pembanding tidak akan pernah menjumlah ke totalnya, tanpa penjelasan.
*Rekomendasi:* gabungkan (union) akun dari kedua periode di komponen pembanding, tampilkan 0 untuk sisi yang kosong.

**AK-P2-08 — Arus kas mengabaikan `cash_flow_group`; pengelompokan menebak dari string sumber.**
README menjanjikan kelompok arus kas dapat diatur per akun, dan kolomnya ada (`src/db/schema.ts:273`, dapat diedit di form akun), tetapi `getCashFlow` mengklasifikasikan mutasi kas dengan heuristik `sourceType`: `opening`/`capital` → pendanaan, mengandung `"asset"`/`"equipment"` → investasi, sisanya operasi (`src/server/reports.ts:349-353`). Pembelian aset yang dibukukan lewat beban/jurnal manual terklasifikasi operasi, dan mengubah `cash_flow_group` akun tidak mengubah laporan sama sekali — kustomisasi yang tampil di UI tetapi tidak berpengaruh (`UI_ONLY` untuk kolom ini).
*Rekomendasi:* klasifikasikan berdasarkan akun lawan (counter-account) dari setiap jurnal kas dengan `resolveCashFlowGroup` (`src/lib/accounting.ts:58-65`), bukan dari string sumber.

**AK-P2-09 — Buku besar menampilkan saldo bertanda mentah untuk akun kredit-normal.**
`getLedger` mengakumulasi `balance += debit − credit` untuk semua akun (`src/server/reports.ts:1024-1040`), dan halaman menampilkannya apa adanya (`src/app/app/akuntansi/buku-besar/page.tsx:95-122`). Untuk akun liabilitas/pendapatan/ekuitas, "Saldo awal/akhir" tampil sebagai angka negatif yang membesar — bertentangan dengan kolom "saldo normal" yang ditampilkan di halaman yang sama dan dengan konvensi tanda di `getTrialBalance`/`listAccountBalances`.
*Rekomendasi:* terapkan tanda saldo normal akun (seperti `signedBalance`, `src/server/accounting.ts:267-278`) pada saldo awal, berjalan, dan akhir buku besar.

**AK-P2-10 — Update akun/karyawan bisa no-op diam-diam dan mengubah klasifikasi akun bertransaksi.**
Pada jalur update, `saveAccountAction` dan `saveEmployeeAction` mengembalikan hasil `.returning()` tanpa memeriksa keberadaan baris (`src/server/actions/accounting.ts:610-628` dan `:402-410`): id yang tidak ditemukan menghasilkan `ok: true` dengan data `undefined`, dan form menampilkan toast sukses ("Akun disimpan." `src/components/akuntansi/account-form.tsx:82`; "Data karyawan disimpan." `src/components/akuntansi/payroll-panel.tsx:52`). Di jalur yang sama, `code` akun diam-diam tidak ikut diperbarui (tidak ada di objek `set`, `:611-622`) — untungnya form menonaktifkan field kode saat edit (`account-form.tsx:117`), tetapi pemanggil API lain tidak diberi tahu. Lebih berisiko: `type`, `section`, dan `normalBalance` akun yang **sudah punya jurnal** dapat diganti bebas; karena laporan mengelompokkan dari atribut akun saat ini (`resolveSection` `src/lib/accounting.ts:52-55`), seluruh riwayat laporan berubah retroaktif tanpa peringatan. Form juga menawarkan semua `section` untuk semua tipe, dan server tidak memvalidasi kompatibilitas section↔tipe.
*Rekomendasi:* lempar `NOT_FOUND` bila update mengenai 0 baris; kunci `type`/`normalBalance` untuk akun yang sudah dipakai jurnal (atau wajibkan alasan + audit khusus); validasi section terhadap tipe di Zod/server.

**AK-P2-11 — Nilai persediaan di dashboard tidak sama dengan buku besar.**
`getAccountingSummary` dan `getHomeSummary` menghitung nilai persediaan sebagai `sum(stock_on_hand.qty * products.costPrice)` (`src/server/reports.ts:1132` dan `:91`) — harga pokok produk **terkini**, bukan saldo akun persediaan hasil jurnal (rata-rata bergerak). Mengubah harga pokok produk hari ini mengubah "nilai persediaan" dashboard untuk seluruh riwayat, dan angkanya bisa berbeda dari akun persediaan di neraca pada layar yang sama. Tes konsistensi justru mengunci perilaku ini dengan membandingkan ke SQL yang sama (`tests/integration/consistency.test.ts:67-79`).
*Rekomendasi:* tampilkan saldo akun persediaan dari `mappedBalance(["inventory"])` sebagai angka utama dashboard; pertahankan valuasi qty×cost sebagai laporan gudang dengan label metode yang eksplisit.

**AK-P2-12 — Penjaga hapus akun tidak mencakup metode pembayaran dan grup harga.**
`deleteAccountAction` memeriksa pemakaian di jurnal, akun anak, dan pemetaan (`src/server/actions/accounting.ts:663-684`), tetapi akun juga direferensikan oleh `paymentMethods.accountId` (`src/db/schema.ts:243`) dan `customerGroups.discountAccountId` (`src/db/schema.ts:365`) — keduanya uuid polos tanpa FK. Menghapus akun yang masih dipakai metode pembayaran lolos semua penjaga; penjualan berikutnya memposting baris jurnal ke akun yang sudah tidak ada (mungkin karena AK-P1-02) dan baris itu hilang dari laporan yang men-JOIN akun.
*Rekomendasi:* tambahkan kedua tabel itu ke daftar penjaga hapus (atau set-null terkontrol), dan FK bila memungkinkan.

### P3 — kualitas, performa, UX

**AK-P3-01 — Validasi tanggal & nominal longgar; error penting jatuh ke pesan generik.**
Hampir semua action memvalidasi tanggal hanya dengan `z.string().min(10)` (mis. `src/server/actions/accounting.ts:30-35,82,108`) dan nominal dengan `z.union([z.string(), z.number()])` tanpa pola numerik: string seperti `"abc"` atau tanggal `"2026-02-30"` lolos Zod lalu meledak di `Decimal`/Postgres dan diterjemahkan `guard` menjadi "Terjadi kesalahan pada server. Coba lagi." (`src/lib/errors.ts:36-49`) — Bahasa Indonesia, tapi tidak memberi tahu kolom mana yang salah. Pelanggaran unik DB (kode akun/karyawan ganda, `src/db/schema.ts:277,852`) bernasib sama.
*Rekomendasi:* pakai `z.string().date()`/regex ISO + refine `Decimal.isFinite` untuk nominal di skema bersama; petakan error unik Postgres (23505) ke pesan spesifik per entitas.

**AK-P3-02 — Jurnal manual tanpa kunci idempotensi.**
`postManualJournalAction` tidak mengoper `idempotencyKey` (`src/server/actions/accounting.ts:85-102`), padahal `postJournal` mendukungnya (`src/server/accounting.ts:70-83`) dan dokumen lain memakainya. Proteksi satu-satunya adalah tombol form yang nonaktif selama `busy` (`src/components/akuntansi/journal-entry-form.tsx:203-211`) — retry jaringan/klik ganda antar-render tetap bisa menggandakan jurnal.
*Rekomendasi:* bangkitkan kunci idempotensi per sesi form di klien dan teruskan ke action.

**AK-P3-03 — Race proses payroll satu periode.**
Larangan payroll ganda per periode hanya berupa cek-ada-lalu-insert di aplikasi (`src/server/actions/accounting.ts:425-432`); skema hanya mengunci keunikan `number`, bukan `(company_id, period)` (`src/db/schema.ts:854-871`). Dua permintaan bersamaan dapat sama-sama lolos dan memposting dua jurnal gaji untuk satu periode (kunci idempotensi jurnal per `run.id` yang berbeda tidak menolong).
*Rekomendasi:* unique index `(company_id, period)` pada `payroll_runs` lewat migrasi baru + tangani konfliknya sebagai `CONFLICT` berbahasa Indonesia.

**AK-P3-04 — Performa laporan & halaman: query tanpa batas dan agregasi `Number()`.**
(a) `getLedger` memuat seluruh baris akun dalam rentang tanpa limit dan menghitung saldo berjalan di JS (`src/server/reports.ts:986-1041`); `listReceivables`/`listPayables` tanpa limit/pagination (`:1047-1096`) lalu disaring lagi di JS oleh halaman (`src/app/app/akuntansi/piutang-utang/page.tsx:52-56`). (b) `listJournalEntries` memakai subquery korelasi per baris untuk nilai jurnal (`src/server/reports.ts:930`). (c) Halaman payroll memuat **semua** `payrollItems` sepanjang masa lalu tidak pernah memakainya di render (`src/app/app/akuntansi/payroll/page.tsx:34-44`) — query murni terbuang yang tumbuh tanpa batas. (d) Seluruh laporan mengonversi `numeric(19,4)` ke `Number()` JS (59 lokasi `Number(` di `src/server/reports.ts`; juga `formatIDR` `src/lib/money.ts:25-35`): presisi hilang untuk nilai di atas ±9.007.199.254.740.991 sen-sen-an — kecil risikonya untuk minimarket, tetapi bertentangan dengan aturan proyek "jangan pakai number untuk uang" di jalur tampilan/agregasi.
*Rekomendasi:* pagination atau batas + agregasi SQL untuk ledger/AR/AP; hapus query `payrollItems` yang tak terpakai; pertahankan agregasi sebagai string Decimal sampai lapisan format.

**AK-P3-05 — UI/UX akuntansi: pencarian akun, format nominal, dan label yang menyesatkan.**
(a) Pemilih akun di form jurnal manual adalah `<select>` polos tanpa pencarian (`src/components/akuntansi/journal-entry-form.tsx:124-146`) — lambat dipakai saat COA besar, padahal modul gudang sudah punya pola pemilih produk yang bisa dicari. (b) Semua input nominal adalah teks bebas yang dihitung klien dengan `Number()` float dan tanpa pemisah ribuan id-ID (`journal-entry-form.tsx:44-49`; pola sama di form beban/transfer/modal) — pengguna Indonesia yang mengetik `1.500.000` mendapat `NaN`/total kosong tanpa pesan. (c) Halaman beban membatasi 100 dokumen tanpa pagination dan kartu "Total tercatat" sebenarnya hanya menjumlah baris yang kebetulan termuat (`src/app/app/akuntansi/beban/page.tsx:29,43-44`). (d) Tombol CSV pada tab laporan `catatan` mengunduh CSV laba rugi (AK pada tabel fitur).
*Rekomendasi:* combobox akun yang bisa dicari (pola product-picker gudang); input nominal terformat id-ID yang mengurai ke string Decimal; pagination beban; nonaktifkan/tautkan CSV yang benar per tab.

**AK-P3-06 — Tarif pajak tanpa validasi rentang.**
`taxRate` diterima sebagai string/angka bebas lalu disimpan (`src/server/actions/settings.ts:27,53`); tidak ada pemeriksaan 0–100. Tarif negatif atau 150% akan mengalir ke perhitungan pajak POS (`lineTax` `src/lib/money.ts:125-137` mengasumsikan tarif persen yang wajar) dan salah diam-diam di setiap nota.
*Rekomendasi:* refine Zod `0 ≤ rate ≤ 100` dengan pesan Bahasa Indonesia.

**AK-P3-07 — Kustomisasi penomoran dokumen tidak ada.**
Prefix dan format nomor dikeraskan di kode (`src/server/sequences.ts:5-19`) dan tahun seri selalu diambil dari tanggal dokumen — backdate lintas tahun otomatis memakai seri tahun dokumen itu. Untuk sebagian usaha ini benar, tetapi tidak ada cara bagi perusahaan menyesuaikan format (mis. memasukkan kode cabang) tanpa mengubah kode.
*Rekomendasi:* jadikan prefix per jenis dokumen sebagai pengaturan perusahaan (default nilai sekarang), sesuai prinsip proyek "konfigurasi, bukan konstanta di kode".

---

## Yang sudah benar (terverifikasi, jangan diutak-atik tanpa tes)

1. Keseimbangan jurnal dua lapis: aplikasi (Decimal, `src/server/accounting.ts:100-110`) + trigger deferred di DB (`0001_rls_and_guards.sql`).
2. Jurnal posted tidak bisa diubah/dihapus (trigger `journal_entries_immutable`/`journal_lines_immutable`); koreksi lewat pembalik yang tertaut `reversalOfId` dan berkunci idempotensi `reversal:<id>` (`src/server/accounting.ts:150-265`).
3. Penolakan periode tertutup terpusat di `postJournal` sehingga POS/gudang/impor ikut terlindungi (terverifikasi grep semua pemanggil).
4. Pembayaran utang memakai kunci baris `for("update")` + cek sisa sebelum membayar (`src/server/actions/accounting.ts:306-324`) — pola anti-race yang benar.
5. Aging dihitung dari tanggal dokumen, bukan tanggal bayar/buat (`piutang-utang/page.tsx:235-254`).
6. Penomoran dokumen atomik via upsert sequence per tahun (`src/server/sequences.ts:27-51`).
7. Uang disimpan `numeric(19,4)` string dan dihitung Decimal di jalur posting (`src/lib/money.ts:1-19`); pembulatan terpusat `roundTo`/`roundTotal` dengan `ROUND_HALF_UP` (`src/lib/money.ts:57-104`).
8. Pesan error domain berbahasa Indonesia dan spesifik di jalur utama (periode tertutup, jurnal tidak seimbang, akun belum dipetakan — `src/server/accounting.ts:17-27,50-57,105-109`).

## Batasan audit ini

- Audit statis: tidak menjalankan aplikasi, migrasi, atau tes. Klaim yang bergantung pada perilaku runtime (hasil cetak, PDF, perilaku RLS aktual, kinerja terukur) ditandai `NOT_VERIFIED` atau tidak dinilai.
- `src/server/pos.ts` dan `src/server/inventory.ts` hanya diperiksa sebatas interaksinya dengan akuntansi (pemanggilan `postJournal`/`reverseSourceJournal`); audit fungsional kedua modul itu di luar cakupan dokumen ini.
