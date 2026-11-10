# Laporan Perbaikan Fungsi Cetak

Mandat pengguna 4 November 2026 · Audit: `docs/audit/CETAK.md` (26 temuan: 8 P1 · 10 P2 · 8 P3, bukti render sebelum perbaikan) · Status: **SELESAI — 26/26 temuan ditangani**, suite **476/476** + typecheck/lint/build bersih. Bukti render sesudah perbaikan tersimpan di luar repo (`~/workspace/bukti-cetak/fix-a` & `fix-b`) dan diverifikasi visual oleh Pemimpin.

## Yang diperbaiki

**Fondasi (berlaku untuk semua cetakan)**
- Kerangka aplikasi (sidebar, bilah atas, chip pengguna, navigasi mobile) tidak tercetak lagi pada lebar apa pun termasuk landscape (CT-01).
- Ukuran kertas benar: nota thermal 58/80mm kini benar-benar selebar rol (MediaBox PDF terukur 163,9pt & 227,0pt; sebelumnya selalu Letter 612pt karena `size: … auto` ditolak Chromium — CT-02); halaman aplikasi mencetak A4 (CT-03); padding area cetak direset sehingga lebar dokumen persis spesifikasi kertas (CT-09).
- Nomor halaman "Halaman X dari Y" di semua dokumen A4/A5 dan laporan (CT-25).

**Nota POS**
- Kop perusahaan tunggal (fallback teks warisan yang menggandakan identitas dibuang — CT-04).
- Di kertas A4/A5 nota tampil sebagai blok 80mm di tengah halaman, tidak diregangkan (CT-17).
- QR proporsional per kertas (14mm di 58mm — CT-19); rincian 58mm lebih rapat dan frasa harga tidak patah di tengah (CT-26).
- Template dipertegas: modern = bar total beraksen; classic = serif + garis ganda; minimal = kop satu baris tanpa aksen (CT-20).

**Dokumen gudang (GRN & PO)**
- TOTAL tidak lagi tercetak prematur di halaman pertama dokumen A5 multipel-halaman — blok ringkasan kini elemen sesudah tabel, muncul tepat satu kali sesudah baris terakhir; baris tabel tidak terbelah antar-halaman (CT-05, CT-10).
- Grid info berpola label-di-atas-nilai: nomor invoice pemasok utuh satu baris, status pembayaran sejajar terbaca di A4 & A5 (CT-11).

**Laporan & dokumen akuntansi**
- Kop formal bersama: nama perusahaan, judul laporan, periode persis, waktu cetak; kolom pembanding berjudul tahun eksplisit (2026 | 2025) (CT-12). Judul halaman aplikasi & tombol tidak tercetak (CT-06).
- Stylesheet cetak laporan: teks hitam pekat, garis dipertegas, angka kunci ditebalkan bukan diwarnai (CT-18); kolom angka diperlebar + tidak membungkus di tengah nilai (CT-13); "− Rp 0" dinormalkan menjadi "Rp 0" (CT-15); label sumber arus kas Bahasa Indonesia dan struktur kelompok → rincian → subtotal (CT-14); tanggal laporan penjualan format id-ID (CT-21); keadaan kosong catatan mencetak baris netral, bukan petunjuk UI (CT-23).
- Buku besar kini punya jalur cetak resmi: tombol Cetak, formulir tersembunyi saat mencetak, kop + nomor halaman; baris "Saldo akhir" tidak lagi berulang di setiap halaman (CT-07 + perbaikan sekelas CT-05 yang ditemukan dalam pengerjaan).
- Detail jurnal: tombol "Cetak / CSV" yang menyesatkan dipisah menjadi **Unduh CSV** dan **Cetak** yang membuka voucher jurnal A4 baru (kop, nomor, tabel debit/kredit, total seimbang, sumber sebagai nomor dokumen + label Indonesia — bukan UUID, tanda tangan, QR) (CT-08, CT-22).
- Pratinjau Pengaturan Cetak berskala pas kolom — dokumen contoh terlihat utuh (CT-16).

**Kebersihan**
- Kolom yatim `receipt_width_mm` dihapus (migrasi 0022 — catatan deploy: DROP COLUMN, nilai lama hilang; lebar kini dari pengaturan kertas Print Engine) (CT-24).

## Verifikasi

Setiap temuan diverifikasi dua kali: render ulang oleh agen pelaksana (Playwright emulasi print → PDF/PNG) dan pemeriksaan visual oleh Pemimpin atas hasil akhir (nota 58mm, GRN A5, laba rugi, voucher jurnal). MediaBox PDF diukur langsung. Suite penuh 476/476 (34 test baru untuk label sumber jurnal, formatter bertanda, dan resolver nomor dokumen sumber), lint repo bersih sesudah folder bukti dipindah keluar repo.
