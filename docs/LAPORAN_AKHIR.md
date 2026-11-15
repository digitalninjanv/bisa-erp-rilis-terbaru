# LAPORAN AKHIR AUDIT

Tanggal: 2026-11-11
Repo: `/home/najib/Downloads/bisa-erp-rilis-terbaru/bisa-erp`
Metode: audit kode + subagent paralel (akuntansi, inventory/POS, security/UI/import), query DB, test regresi, Playwright UI, backup/restore drill.

## Ringkasan

ERP sudah memiliki modul lengkap dan fondasi double-entry/stok ledger yang baik. Temuan terbesar bukan “jurnal terbalik” secara umum, melainkan **data yang boleh masuk dengan metadata salah** (pemetaan akun, section impor, retur pelanggan), **laporan yang tidak neto retur/PPN**, dan **beberapa jalur void yang memakai tanggal/biaya salah**. Putaran ini memperbaiki temuan Kritis dan sebagian besar Tinggi di area tersebut.

**Status kesiapan:** belum memenuhi seluruh Definition of Done. Operasional inti (master, pembelian, POS, jurnal, laporan) sudah terverifikasi end-to-end dan suite penuh hijau. `SEC-003`, `SEC-005`, `SEC-006`, `SEC-008`, `SEC-012`, dan `SEC-013` sudah ditutup; impor massal master tersedia; restore drill dan installer HTTPS tervalidasi. Sisa blocker ada di `docs/BLOKIR.md` (branch coverage, E2E role lanjutan, uji installer di staging).

## Skor audit internal (sebelum → sesudah)

| Area | Sebelum | Sesudah | Catatan |
| --- | --- | --- | --- |
| Akuntansi & laporan | 55 | **82** | Mapping type, closing P&L, section fallback, retur/PPN, void beban, isPostable |
| Gudang & stok | 65 | **82** | Void DPP/AVCO, retur pemasok, stock doc; serial opname tertunda |
| POS | 62 | **80** | Pembulatan nol, refund lock, laporan retur; race/idempotensi masih flaky |
| Import/export Excel | 50 | **88** | XLSX semua export, template Petunjuk/Referensi, kategori/satuan/mapping |
| Keamanan | 55 | **70** | Role escalation, impor akuntansi, HTTPS; cost leak & token POS terbuka |
| UI/UX | 65 | **76** | Tombol import/export, tabel, mobile; cost masking & HR list tertunda |
| QA | 50 | **97** | Full suite **2444/2444**, E2E **57/57**, typecheck/lint/build lulus; coverage lines 92,37% (branch 79,35%) |

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
- Full suite database uji: **2444/2444 lulus (276 file)**; E2E production build **57/57 lulus**.
- Typecheck, lint, build: lulus.
- Restore backup ke DB kosong: berhasil (1379 akun, 1137 produk, 873 sales, 4314 jurnal).
- UI desktop/mobile untuk halaman yang diubah: tidak ada error console/overflow.

## Sisa risiko (ringkas)

1. **Coverage branch 80%** belum tercapai (lines 92.37%, branches 79.35% — 26 cabang lagi).
2. **E2E role/modul** sudah 44 skenario; perluas role kustom lain.
3. **Branch coverage 80%** belum tercapai; installer root/systemd belum diuji di mesin staging.
4. **Kebocoran memori dev Turbopack per-render** (#97555); gunakan production build.

## Rekomendasi go-live

**Belum disarankan go-live penuh.** Urutan:
1. Tutup branch coverage dan perluas E2E role kustom.
2. Jalankan installer HTTPS penuh di staging (root/systemd) dengan sertifikat resmi.
3. Deploy HTTPS, backup terjadwal, role kasir minimum.
