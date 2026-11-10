# STATUS TUTUP — Jalur UI/UX A-28 (U0 + UI-1 s.d. UI-5)

Draf status tutup jalur UI/UX program **A-28**, disusun pada penutup **UI-5 (2026-11-07)** dari `docs/hardening/AUDIT-UIUX-A28.md` (temuan UX-) dan sisa A-25 yang diverifikasi ulang di dalamnya. Status per temuan: **TERTUTUP** (perubahan terverifikasi test/screenshot), **SEHAT** (terverifikasi bukan masalah sejak audit), **SISA TERJADWAL** (belum dikerjakan — dinyatakan apa adanya, dengan alasannya). Aturan bisnis & angka tidak berubah di seluruh jalur ini.

## Gerbang tahap penutup (UI-5)

Dari reseed bersih (65 produk, nilai persediaan Rp28.349.600): **suite 1872/1872** (1860 baseline UI-4 + 12 test baru `tests/unit/a28-ui5-consistency.test.ts`), **typecheck exit 0**, **lint exit 0** (26 warning lama, nol di berkas berubah), **build exit 0**, **e2e 22/22**. Bukti visual permukaan yang diubah di `~/workspace/bukti-a28/ui5/` (12 berkas) + 16 pemeriksaan peramban terprogram (judul tak ganda, isi menu, keadaan nonaktif, fokus `activeElement`) semuanya lulus.

## Area A — Desain visual & hierarki

| Temuan | Status | Penutup & bukti |
|---|---|---|
| UX-A01 konsistensi A-25 | SEHAT | Terverifikasi utuh sejak U0 (26 permukaan), termasuk POS hasil U8. |
| UX-A02 judul ganda daftar Gudang | **TERTUTUP** (UI-5) | Pita formulir Penerimaan & PO dibuang judul + subjudulnya — pola SectionTitle bare A-25 (POLA-02): tersisa baris aksi (tombol "Penerimaan baru"/"PO baru", kontrak e2e utuh); penjelasan hidup di deskripsi PageHeader. Bukti: test render UI-5 + `ui5/penerimaan-sesudah.png`, `ui5/po-sesudah.png` (h2 ganda terukur 0). Penyesuaian diperiksa: judul pitanya ("Dokumen penyesuaian") TIDAK sama dengan judul halamannya, jadi bukan duplikat — tidak diubah. |
| UX-A03 beranda Akuntansi terpadat | **TERTUTUP** (UI-5) | Input Cepat kini **panel terlipat bawaan** (kepala = tombol `aria-expanded`, memuat hitungan "9 jalan pintas") dengan kartu yang dipadatkan (ikon lebih kecil, padding rapat, grid 3 kolom) — antrean kerja & KPI menjadi hierarki pertama; **tidak ada jalan pintas yang dihapus**. Bukti: test render (keadaan awal tanpa kartu) + `ui5/beranda-akuntansi-sesudah.png` & `...-input-cepat-terbuka.png`. |
| UX-A04 jargon & teks basi | **TERTUTUP** (UI-3 + UI-5) | UI-3: deskripsi Laporan menyebut CSV **dan Excel**; label tipe akun Kas & bank berbahasa Indonesia. UI-5: Status sistem — nama variabel env & path absolut pindah ke area **"Detail teknis" terlipat** per seksi; teks utama berbunyi ramah ("Ambang kesegaran: 26 jam", "Database uji: Database sementara"); paragraf keadaan-kosong ditulis ulang tanpa nama skrip/berkas mentah (rujukan persisnya di Detail teknis). Bukti: penjaga pola sumber di test UI-5 + `ui5/status-sistem-sesudah.png`, `ui5/status-detail-teknis.png`. Catatan: "SHA-256" & nama berkas backup tetap tampil sebagai **data berlabel** — bukan jargon lepas. |
| UX-A05 pola aksi baris belum satu | **TERTUTUP** (UI-5) | **Riwayat POS**: "Cetak nota" menjadi aksi utama terlihat **berlabel**; Cetak faktur A4, Retur penjualan, dan Void (destruktif, terpisah di dasar) masuk menu ⋯ — sebelumnya 3–4 ikon tanpa label. **Penerimaan**: "Cetak GRN" berlabel; "Batalkan penerimaan" masuk menu ⋯ (dialog & aturan domain persis tombol lama; menu tidak dirender bila batal tidak tersedia). **Bagan akun**: Hapus masuk menu ⋯; untuk akun terikat itemnya **nonaktif + berpenjelasan di dalam menu** (akun sistem: ikatan pemetaan/metode; akun berinduk: sub-akun) — aturan hapus & penjaga domain tidak berubah, konfirmasi kini ConfirmDialog bersama menggantikan `window.confirm`; komponen `AccountDeleteButton` lama dihapus. RowMenu diperluas satu field opsional `note` (penjelasan di bawah label item). Bukti: test render + helper murni `accountDeleteBlockReason` teruji unit; `ui5/riwayat-pos-menu.png`, `ui5/penerimaan-menu.png`, `ui5/bagan-akun-menu-sistem.png` (Hapus pudar + catatan ikatan terlihat). Catatan pola: item menu ⋯ kini menavigasi di tab yang sama seperti semua RowMenu lain; aksi utama Cetak nota tetap membuka tab baru seperti sebelumnya. |
| UX-A06 strip KPI di atas daftar | SISA TERJADWAL | Strip 4 kartu KPI (Riwayat POS, Nilai persediaan, Jurnal) adalah pola DataList bersama warisan A-25 U8 dan tidak mempunyai butir kerja eksplisit di RENCANA UI-5; tidak diubah tahap ini. Penilaian ulang hierarki daftar adalah pekerjaan desain tersendiri, bukan poles. |

## Area B — Usability & kemudahan input

| Temuan | Status | Penutup & bukti |
|---|---|---|
| UX-B01 F2 palsu + terminal tak autofocus | **TERTUTUP** (UI-1) | Handler F2 nyata + autofocus terminal; placeholder utuh di 1440px. |
| UX-B02 hasil cari POS tanpa navigasi panah | **TERTUTUP** (UI-1) | Panah atas/bawah + Enter memilih yang tersorot. |
| UX-B03 tanpa shortcut langkah akhir | **TERTUTUP** (UI-1) | F9 Bayar, F8 Tahan, F10 Uang Pas, F4 Diterima, Alt+M mode; daftar lewat tombol "?". |
| UX-B04 nominal tender mentah | **TERTUTUP** (UI-1) | Tender POS memakai MoneyInput bersama (format saat ketik). |
| UX-B05 fokus awal tak konsisten | **TERTUTUP** (UI-1 + UI-5) | POS: UI-1. **Opname: UI-5** — `ProductPicker` mendapat prop opt-in `autoFocus` (pola ref+effect Mode Operasi) dan form opname mengaktifkannya; terbukti empiris `document.activeElement` = kotak "Pindai / cari produk yang dihitung…" + cincin fokus terlihat di `ui5/opname-fokus.png`. Jurnal baru & Mode Operasi sudah autofocus sejak sebelum U0. Konsistensi yang dinyatakan: autofocus HANYA untuk permukaan kerja yang digerakkan pindai (POS, Mode Operasi, Opname) — permukaan daftar/formulir lain yang disentuh UI-5 (Penerimaan, PO, Riwayat POS, Bagan akun, Status sistem, Beranda Akuntansi) sengaja tidak, karena mencuri fokus pada formulir umum adalah gesekan. |
| UX-B06 umpan balik sukses/gagal | SEHAT | Terverifikasi jelas sejak U0. |
| UX-B07 Bayar campuran aktif saat sisa penuh | **TERTUTUP** (UI-1) | Tombol nonaktif sampai Sisa = 0, label menyatakan sisa. |

## Area C — Workflow efficiency

| Temuan | Status | Penutup & bukti |
|---|---|---|
| UX-C01 PO Draf tanpa jalan terima | **TERTUTUP** (UI-4) | Aksi "Kirim & terima" berkonfirmasi + banner langkah berikutnya per status. |
| UX-C02 tautan run payroll di teks periode | **TERTUTUP** (UI-4) | Nomor run menjadi tautan; panel selesai wizard ber-tautan run. |
| UX-C03 referensi pergerakan beranda Gudang polos | **TERTUTUP** (UI-4) | Terkelompok per dokumen + referensi tertaut ke dokumen asal. |
| UX-C04 duplikasi permukaan baca stok | SISA TERJADWAL | Produk & Nilai persediaan tetap dua permukaan (Nilai persediaan murni laporan tanpa aksi baris). Penggabungan/peniadaan permukaan adalah keputusan desain modul, di luar butir kerja UI-5; tidak ada perubahan perilaku baca di jalur ini. |
| UX-C05 antrean Mode Operasi kosong tanpa jalan pintas | SEHAT | Tertutup sejak sebelum U0 (sisa GDG-10). |
| UX-C06 wizard payroll menawarkan periode terproses | **TERTUTUP** (UI-4) | Periode terproses ditandai "Sudah diproses — PRL-…" di langkah 1. |

## Area D — Template cetak & kustomisasi

| Temuan | Status | Penutup & bukti |
|---|---|---|
| UX-D01 pengaturan nota bercabang, field mati | **TERTUTUP** (UI-2) | Tab dilebur ke Cetak; field mati dihapus; footer lama termigrasi satu kali (migrasi 0059). |
| UX-D02 logo hanya URL | **TERTUTUP** (UI-2) | Unggah berkas tervalidasi server; URL tetap didukung. |
| UX-D03 tak ada faktur format dokumen | **TERTUTUP** (UI-2) | Faktur penjualan A4/A5 dari nota & riwayat; saklar elemen diperluas; baris merek dapat dimatikan. |
| UX-D04 identitas kop per cabang | SISA TERJADWAL | Keputusan pemilik soal model cabang/multi-outlet — di luar cakupan jalur per RENCANA-UIUX. |
| UX-D05 label tanda tangan tertanam | **TERTUTUP** (UI-2) | Label per jenis dokumen dapat diatur (8 jenis). |

## Sisa A-25 yang diverifikasi ulang di U0 (§7 audit)

| Sisa | Status akhir jalur UI/UX |
|---|---|
| POLA-03 tanggal native | **TERTUTUP** (UI-3) — 31 input native di 20 berkas → 0, semua DateField; penjaga permanen `date-input-pattern.test.ts`. |
| POLA-07 RowMenu tak merata | **TERTUTUP** — A-25 U2 sebagian besar; sisa terakhir (Riwayat POS, Penerimaan, Bagan akun) ditutup UI-5 (UX-A05). |
| POLA-12 label Inggris/jargon | **TERTUTUP** — gabungan UI-3 + UI-5 (UX-A04). |
| GDG-05 stok di dua tempat | SISA TERJADWAL (= UX-C04). |
| GDG-06 daftar "mendekati minimum" | Tidak dinilai ulang di jalur UI/UX (fungsi baca tidak berubah; bukan temuan UI). |
| GDG-08 pergerakan tak terkelompok | **TERTUTUP** (UI-4, = UX-C03). |
| GDG-10 jalan pintas antrean kosong | **TERTUTUP** (sebelum U0, = UX-C05). |
| GDG-13 duplikat pihak halaman tersendiri | SISA TERJADWAL — butirnya ada di RENCANA UI-5 (panel/dialog di halaman Pemasok), tetapi mandat tahap UI-5 yang dijalankan membatasi cakupan pada UX-A02/A03/A04/A05/B05; tidak dikerjakan tahap ini dan tidak diimprovisasi. |
| AKT-02/03 beranda akuntansi padat | **TERTUTUP** (UI-5, = UX-A03). |
| AKT-05 daftar jurnal tanpa rincian baris | **TERTUTUP** (UI-3) — rincian debit/kredit dapat dilipat. |
| AKT-08 buku besar membuka di header Rp0 | **TERTUTUP** (UI-3) — membuka di akun postable beraktivitas pertama. |
| AKT-09 saklar akun bersaldo nol | **TERTUTUP** (UI-3) — satu definisi bersama layar/cetak/ekspor. |
| PNG-05 kolom pertama BPJS sempit | SISA TERJADWAL — sama seperti GDG-13: tercantum di RENCANA UI-5, di luar daftar butir mandat tahap ini. |

## Ringkasan hitungan

- Temuan UX- (A/B/C/D): 23 butir — **18 tertutup, 2 sehat-terverifikasi, 3 sisa terjadwal** (UX-A06, UX-C04, UX-D04; D04 menunggu keputusan pemilik).
- Sisa A-25 (12 butir): **8 tertutup, 3 sisa terjadwal** (GDG-05, GDG-13, PNG-05), 1 tidak dinilai ulang (GDG-06, non-UI).
- Gerbang khusus RENCANA UI-5 meminta sapuan screenshot ulang 26 permukaan U0 dengan perbandingan berdampingan: tahap ini menyediakan screenshot sesudah untuk **7 permukaan yang diubah + menu-menu barunya** (12 berkas di `~/workspace/bukti-a28/ui5/`); sapuan penuh 26 permukaan adalah pekerjaan gerbang penutup program A-28, bukan tahap ini — dinyatakan apa adanya.
