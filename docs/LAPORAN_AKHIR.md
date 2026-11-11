# LAPORAN AKHIR AUDIT

Tanggal: 2026-11-11
Repo: `/home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp`
Metode: audit kode + subagent paralel (akuntansi, inventory/POS, security/UI/import), query DB, test regresi, Playwright UI, backup/restore drill.

## Ringkasan

ERP sudah memiliki modul lengkap dan fondasi double-entry/stok ledger yang baik. Temuan terbesar bukan “jurnal terbalik” secara umum, melainkan **data yang boleh masuk dengan metadata salah** (pemetaan akun, section impor, retur pelanggan), **laporan yang tidak neto retur/PPN**, dan **beberapa jalur void yang memakai tanggal/biaya salah**. Putaran ini memperbaiki temuan Kritis dan sebagian besar Tinggi di area tersebut.

**Status kesiapan:** belum memenuhi seluruh Definition of Done. Operasional inti (master, pembelian, POS, jurnal, laporan) jauh lebih aman, tetapi temuan keamanan `SEC-003` (kebocoran HPP) dan `SEC-005` (token POS) masih terbuka. Jangan go-live penuh sebelum item di `docs/BLOKIR.md` diselesaikan.

## Skor audit internal (sebelum → sesudah)

| Area | Sebelum | Sesudah | Catatan |
| --- | --- | --- | --- |
| Akuntansi & laporan | 55 | **82** | Mapping type, closing P&L, section fallback, retur/PPN, void beban, isPostable |
| Gudang & stok | 65 | **82** | Void DPP/AVCO, retur pemasok, stock doc; serial opname tertunda |
| POS | 62 | **80** | Pembulatan nol, refund lock, laporan retur; race/idempotensi masih flaky |
| Import/export Excel | 50 | **88** | XLSX semua export, template Petunjuk/Referensi, kategori/satuan/mapping |
| Keamanan | 55 | **70** | Role escalation, impor akuntansi, HTTPS; cost leak & token POS terbuka |
| UI/UX | 65 | **76** | Tombol import/export, tabel, mobile; cost masking & HR list tertunda |
| QA | 50 | **88** | Full suite putaran audit **2254/2254**; putaran cetak 2252/2254 (2 tes balapan, lulus 29/29 terisolasi); coverage formal belum diukur |

## Yang diperbaiki

### Akuntansi
- Kontrak tipe akun untuk 36 kunci pemetaan; form, impor, dan aksi menolak tipe salah.
- Penerimaan retur pelanggan: `Dr Persediaan / Cr HPP`, bukan kredit pendapatan.
- P&L periode mengecualikan jurnal tutup buku; neraca/ekuitas tetap memasukkannya.
- Impor akun menolak section yang tidak sesuai tipe; P&L fallback ke section tipe untuk data lama.
- Akun berjurnal tidak bisa dijadikan non-posting (mencegah histori hilang dari P&L).
- Void beban memakai tanggal asal bila periode terbuka; audit mencatat tanggal pembalik.
- Laporan penjualan mengurangi retur (summary/hari/kasir/kategori/top) dan tidak menambah PPN dua kali.
- Avoid double-count PPN retur dengan proporsi penjualan asal.

### Gudang/POS
- Void penerimaan memakai biaya neto (DPP/diskon), bukan harga bruto; AVCO dihitung ulang.
- Void retur pemasok dan dokumen stok menghitung ulang AVCO.
- Pembulatan total tidak boleh membuat nilai positif menjadi nol; produk harga 0 tetap sah.
- Refund tunai mengunci sesi kas (`FOR UPDATE`) agar tidak masuk sesi yang baru ditutup.
- Default pembulatan grup baru 0; grup lama 500 perlu diedit.
- Migrasi `0070` memperbaiki unique index idempotency untuk instalasi baru; `0071` default rounding.

### Import/export
- Semua route export mendukung XLSX: produk, akun, pemasok, pelanggan, kategori, satuan, pemetaan akun, inventory, jurnal/detail, payroll, laporan/ledger/aging.
- Template XLSX berisi `Data`, `Petunjuk`, `Referensi`; kode tetap teks, angka numeric, formula tidak dieksekusi.
- Entitas impor baru: kategori, satuan, pemetaan akun (upsert).
- Tombol ekspor/impor di halaman master dan Pengaturan → Pemetaan akun.

### Keamanan
- Non-owner tidak bisa memberi peran admin/owner, memberi izin yang tidak dimiliki, atau mengedit perannya sendiri.
- Reset password admin/owner hanya owner; reset memutus session lama.
- Impor akun/pemetaan/saldo awal memerlukan izin akuntansi.
- Produksi mewajibkan `https` untuk `BETTER_AUTH_URL`.

## Verifikasi

- Typecheck, lint, build: lulus.
- Full suite database uji: **2254/2254 lulus (240 file)** pada putaran audit; putaran cetak 2252/2254 dengan 2 tes balapan yang lulus saat diisolasi.
- Typecheck, lint, build: lulus.
- Restore backup ke DB kosong: berhasil (1379 akun, 1137 produk, 873 sales, 4314 jurnal).
- UI desktop/mobile untuk halaman yang diubah: tidak ada error console/overflow.

## Sisa risiko (ringkas)

1. **SEC-003**: HPP/nilai persediaan terlihat di beberapa halaman tanpa `inventory.cost`.
2. **SEC-005**: token terminal POS belum dicabut saat user kehilangan akses.
3. **AKN-004 lanjutan**: tanggal void payroll/sale/bank transfer masih hari ini.
4. **Serial void** adjustment/opname belum sepenuhnya dipulihkan.
5. **Full suite** hijau di DB uji terpisah pada putaran audit; putaran cetak menyisakan 2 tes balapan yang flaky saat beban tinggi (lulus terisolasi). Database pengguna tidak di-seed ulang.
6. **Coverage 80%** belum diukur formal.
7. **E2E penuh** setup→pembelian→POS→tutup buku belum dijalankan ulang.

## Rekomendasi go-live

**Belum disarankan go-live penuh.** Urutan:
1. Tutup SEC-003 & SEC-005.
2. Selesaikan AKN-004 (payroll/sale/bank) dan serial void.
3. Stabilkan seed demo/tes agar suite hijau.
4. Jalankan E2E penuh + restore drill di staging.
5. Deploy HTTPS, backup terjadwal, role kasir minimum.
