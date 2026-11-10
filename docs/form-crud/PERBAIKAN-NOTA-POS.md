# Perbaikan Nota POS — POS-NOTA-01: Nota Tertimpa Toast Saat Cetak Otomatis

Mandat pemilik (2026-11-08): "perbaikan bagian nota di POS — klik Bayar kan
otomatis print, tapi ada nota tersebut tertimpa elemen; coba analisa terus
perbaiki." Dokumen ini mencatat analisa berbukti (reproduksi nyata) lalu
perbaikannya. Status: **SELESAI & TERVERIFIKASI** (belum di-commit —
menunggu pemeriksaan & commit Pemimpin).

## 1. Reproduksi (sebelum perbaikan)

Alur nyata dijalankan di build produksi lokal dari reseed bersih: login
demo → POS → jual 1× "Aqua Air Mineral 600ml" (Rp4.000) → klik **Bayar** →
checkout sukses mengantar ke `/app/pos/nota/<id>?autoprint=1` →
`ReceiptPrint` memicu `window.print()` 400ms kemudian.

Hasil tangkapan & cetak ke PDF (kertas thermal 80mm sesuai pengaturan
cetak demo; berkas di `~/workspace/bukti-nota-pos/`):

- `sebelum-layar.png` — di layar desktop 1440px nota tampil utuh; toast
  hijau "Transaksi INV-2026-00001 tersimpan." melayang di kanan atas
  (di atas topbar, belum menimpa kartu nota pada lebar ini).
- `sebelum-cetak.png` / `sebelum-cetak.pdf` — **pada hasil cetak, kotak
  toast hijau tercetak melintang menutupi kop nota**: nama perusahaan
  "BISA MINIMARKET", alamat, dan telepon tertutup badan toast.
  Ekstraksi teks PDF membuktikan teks toast menyusup ke badan nota:
  `…Jl. Melati No. / 21, Jakarta Selatan / si INV-2026-00001 /
  tersimpan. / Telp. 021-555-0123…`.
- Pemindaian DOM media cetak: satu-satunya elemen terlihat di luar
  `.print-area` adalah toast itu.

## 2. Akar masalah (terukur)

Rantai sebab yang terbukti, bukan dugaan:

1. `use-terminal-checkout.ts` memanggil `toast.success("Transaksi …
   tersimpan.")` lalu segera `router.push()` ke halaman nota.
2. `ReceiptPrint` (`src/components/pos/receipt-print.tsx`) memicu
   autoprint hanya **400ms** sesudah render — toast Sonner berumur
   bawaan ±4 detik, jadi toast **selalu** masih tampil saat dialog
   cetak mengambil gambar halaman.
3. `<Toaster>` Sonner v2.0.8 (`src/app/layout.tsx`, `position="top-right"`)
   merender elemen `position: fixed` berlapis tertinggi
   (`[data-sonner-toaster]` / `[data-sonner-toast]`) **tanpa** kelas
   `no-print`, dan blok `@media print` di `globals.css` hanya
   menyembunyikan `.no-print`, `.module-sidebar`, `.module-topbar` —
   toast tidak tersembunyi di media cetak.
4. Elemen fixed dirender Chromium ke keluaran cetak pada posisi
   relatif-halamannya; pada halaman thermal sempit (227pt) kotak toast
   membentang hampir selebar kertas → menimpa kop nota. Di layar lebar
   nota lolos hanya karena posisinya tidak bersinggungan — cacatnya
   laten di layar, nyata di cetak (dan nyata juga di layar sempit).

Elemen penimpa, persisnya: **toast sukses Sonner dari checkout itu
sendiri** — bukan dialog/modal POS (lapisan dialog G1 z-[70]/[80]/[90]
tidak terlibat; pemindaian titik-sampel & irisan elemen fixed/sticky
terhadap persegi nota di layar = nol penimpa).

## 3. Perbaikan (dua lapis, di akar)

1. **`src/app/globals.css` — `@media print`**: aturan baru
   `[data-sonner-toaster], [data-sonner-toast] { display: none !important; }`
   — toast tidak pernah menjadi isi dokumen, untuk **semua** permukaan
   cetak (nota, jurnal, dokumen gudang, slip), termasuk jalur Ctrl+P.
2. **`src/components/pos/receipt-print.tsx` — pemicu cetak bersama**:
   `printClean()` memanggil `toast.dismiss()` sebelum `window.print()`
   pada jalur otomatis maupun tombol Cetak manual — toast dibuang dari
   DOM sebelum potret cetak diambil; jeda render 400ms dipertahankan,
   jalur cetak ulang manual tidak berubah selain kini juga bersih.
   Komponen ini adalah satu-satunya pintu cetak repo (dipakai nota &
   semua halaman cetak), jadi perbaikan berada di jalur yang ada,
   bukan jalur baru.

Tidak ada perubahan aturan bisnis POS (harga, stok, jurnal,
idempotensi, pengaturan kertas 58/80mm tidak disentuh) dan tidak ada
perubahan peta z-index — cacatnya adalah visibilitas media cetak,
bukan susunan lapisan; penjaga dialog G1 tidak perlu diubah.

Penjaga permanen baru:

- `tests/unit/architecture-print-patterns.test.ts` (2 test): mengunci
  aturan print Sonner di `globals.css` dan urutan dismiss→print di
  `ReceiptPrint`.
- `e2e/simulasi-minimarket.spec.ts` langkah 6b: sesudah tiba di nota,
  emulasi media cetak menegaskan toast tidak terlihat dan
  `.print-area` tetap terlihat.

## 4. Bukti sesudah

Reproduksi yang sama persis dijalankan ulang sesudah build baru
(penjualan INV-2026-00002; berkas `sesudah-*` di folder bukti yang sama):

- PDF cetak: kop nota tampil penuh ("BISA MINIMARKET / Jl. Melati
  No. 21, Jakarta Selatan / Telp. 021-555-0123"), nol fragmen toast;
  ekstraksi teks bersih dari baris pertama.
- Pemindaian media cetak: elemen terlihat di luar `.print-area` = **[]**
  (sebelumnya: toast).
- Layar: pada tangkapan 1,5 detik sesudah tiba di nota, toast sudah
  tidak ada (dibuang pemicu autoprint) — halaman nota tampil penuh
  tanpa timpaan apa pun.

## 5. Gerbang (tanpa pipa penutup, dari reseed bersih)

| Gerbang | Hasil |
|---|---|
| typecheck | exit 0 |
| lint | exit 0 (0 error, 29 warning warisan) |
| build | exit 0 |
| suite penuh | **2137/2137** (224 berkas = baseline 2135 + 2 penjaga baru) |
| e2e (`BISA_E2E_RESEED=1`) | **28/28 passed** (termasuk simulasi minimarket dgn asersi cetak baru) |
