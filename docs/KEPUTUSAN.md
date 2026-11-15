# KEPUTUSAN & ASUMSI

Dibuat karena beberapa keputusan bisnis/teknis tidak dinyatakan eksplisit oleh pemilik. Semua bersifat dapat ditinjau.

## Data & lingkungan

1. **Reset kedua menghapus seluruh data bisnis** dan mempertahankan bagan akun + konfigurasi minimum. Setelah reset, pengguna mengimpor 497 produk dan membuat penjualan lewat aplikasi; data itu milik pengguna dan tidak dihapus lagi.
2. **Seed demo tidak dijalankan ke database pengguna.** Verifikasi suite memakai database terpisah `bisa_erp_test` (migrasi + `db:seed --force`).
3. **Database uji bukan produksi.** Tidak ada data pelanggan asli di sana.
4. **Backup sebelum migrasi** disimpan di `backups/bisa-pre-migration-*.dump`; backup tidak di-commit.

## Akuntansi

5. **Pendapatan/refund retur penjualan** dicatat oleh dokumen retur penjualan (`sale_returns`), bukan oleh penerimaan stok. Penerimaan “customer_return” hanya mengembalikan persediaan dan HPP (`Dr Persediaan / Cr HPP`).
6. **Kontrak tipe akun pemetaan** mengikuti sifat akun: kas/bank/piutang/persediaan/DP/PPN masukan/aset tetap = aset; utang/PPN keluaran/kredit pelanggan/utang gaji = liabilitas; penjualan/diskon/retur/pembulatan laba = pendapatan; HPP/selisih/beban = HPP/beban. `cogs` boleh akun HPP atau beban; `damaged`/`inventory_shrink` boleh HPP atau beban.
7. **Jurnal tutup buku** dikecualikan dari P&L periode dan perbandingan tahun lalu; neraca dan laporan perubahan ekuitas tetap memasukkannya agar laba ditahan tidak dihitung dua kali.
8. **Void beban** memakai tanggal dokumen asal bila periodenya terbuka; bila tertutup, pembalik memakai tanggal hari ini dan tanggal pembalik dicatat di audit. Kebijakan yang sama disarankan untuk payroll/sale/bank transfer.
9. **Pembulatan penjualan tidak boleh menghasilkan nol** untuk nilai positif; produk harga 0 tetap boleh dijual (barang gratis/promosi).
10. **Pembulatan harga grup default 0** untuk grup baru. Grup lama dengan 500/down harus diedit manual agar harga tidak terpotong 50%.
11. **PPN default 11%** dan dapat diubah di pengaturan; PPN penjualan inklusif di total, PPN pembelian dipisah ke PPN Masukan bila `taxIncluded`/`taxPercent` diisi.

## Operasional

12. **Dokumen posted tidak diedit/dihapus**; koreksi lewat void/pembalik. Barang yang sudah bertransaksi hanya dinonaktifkan, tidak dihapus.
13. **Stok awal** harus punya gerakan ledger `opening`; `stock_on_hand` bukan sumber kebenaran.
14. **Harga pokok** memakai AVCO dari ledger; void/retur harus menghitung ulang AVCO.
15. **Import Excel** memakai template resmi; kode ditulis sebagai teks, tanggal ISO, angka tanpa format mata uang. Baris dengan kunci yang sudah ada dilewati, kecuali pemetaan akun yang diperbarui.
16. **Batasan pustaka**: SheetJS Community tidak menulis dropdown validation/gaya sel; template menyediakan sheet `Petunjuk` dan `Referensi` sebagai gantinya.
17. **Gudang/cabang, metode pembayaran, kelompok harga, karyawan, aset tetap** belum punya impor massal pada putaran ini; form tunggal tetap tersedia.
18. **HTTPS wajib di produksi**; HTTP hanya untuk harness lokal dengan flag eksplisit `BISA_ALLOW_INSECURE_AUTH_URL=1`.
19. **Cetak otomatis POS** memakai `window.print()` setelah font siap dan kembali ke `/app/pos` setelah `afterprint`. Browser biasa selalu menampilkan dialog; cetak tanpa dialog hanya dengan Chrome/Edge `--kiosk-printing` dan printer thermal sebagai printer default OS.
20. **Optimasi memori dev Turbopack**: `experimental.turbopackGc: true`, `turbopackMemoryEviction: "full"`, `turbopackServerFastRefresh: false`, dan `turbopack.root = process.cwd()` di `next.config.ts`. Cache dev dibersihkan (`.next/dev` ~3.7GB). Fallback: `pnpm dev:webpack` atau `pnpm dev:clean`.

## Prioritas berikutnya

21. Temuan `SEC-003` (kebocoran HPP) dan sisa `AKN-004` (tanggal void payroll/sale) adalah prioritas berikutnya karena menyentuh kerahasiaan biaya dan konsistensi periode. `SEC-005` sudah ditutup.
22. Suite penuh harus dijalankan pada database uji yang baru di-seed; kegagalan yang tersisa didokumentasikan di `docs/BLOKIR.md`, bukan disembunyikan.
