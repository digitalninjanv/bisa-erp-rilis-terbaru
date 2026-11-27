# Standar Tabel, Form, dan Permukaan Cetak

**Status:** kontrak desain aktif sejak 27 November 2026  
**Berlaku:** seluruh modul Bisa ERP (POS, Gudang, Akuntansi/HR, Pengaturan)

Dokumen ini adalah pagar agar halaman baru tidak kembali menjadi “AI slop”: kumpulan kartu, ikon dekoratif, label ganda, dan tabel yang berperilaku berbeda-beda. Standar ini mengikuti pola enterprise yang lazim (Odoo/SAP Fiori/Shopify POS) dan tetap cocok untuk operator minimarket Indonesia.

---

## 1. Tabel

### 1.1 Kapan memakai TanStack `DataTable`

Gunakan `src/components/blocks/data-table` bila:

- data sudah dimuat di klien (≤ beberapa ratus baris), atau
- halaman perlu sortir/pilih kolom secara interaktif tanpa mengubah URL.

Untuk daftar besar yang berpaginasi server (riwayat POS, jurnal, produk, penerimaan), TanStack tetap dipakai untuk **presentasi** (sortir halaman aktif, pilihan kolom, kartu mobile), sedangkan **paginasi dan filter tetap server-side**. Jangan memuat seluruh dataset ke browser hanya untuk mengaktifkan sortir.

### 1.2 Anatomi wajib

1. **Toolbar** — pencarian/filter di kiri, kontrol kolom di kanan (`DataTableToolbar`).
2. **Kepala sticky** — tetap terlihat saat tabel panjang.
3. **Kolom numerik rata kanan** — uang, qty, tanggal angka.
4. **Baris 36–44px** — `density="compact"` untuk daftar operasional, `normal` untuk daftar yang dapat diedit.
5. **Aksi baris satu menu ⋯** — bukan deretan tombol permanen; aksi destruktif di dalam menu + konfirmasi.
6. **Empty state di dalam bingkai tabel** — bukan kartu terpisah di luar.
7. **Mobile card** — di bawah `lg`, setiap baris menjadi kartu ringkas; tabel lebar hanya untuk desktop.
8. **Region gulir fokusabel** — `tabIndex=0`, `role="region"`, `aria-label`; scrollbar tipis terlihat.

### 1.3 Yang dilarang

- Header kolom yang hanya bisa diurutkan lewat menu tanpa klik langsung.
- Tombol “Hapus” permanen di setiap baris.
- Angka uang tanpa format `id-ID` atau rata kiri.
- Tabel yang memaksa pengguna menebak ada kolom tersembunyi di luar layar tanpa isyarat gulir.
- Dua judul yang sama (page header + card header) pada satu layar.
- Sortir klien yang diam-diam berbeda dari sortir server pada halaman berpaginasi.

### 1.4 Implementasi rujukan

- `src/components/blocks/data-table/data-table.tsx`
- `src/components/blocks/data-table/data-table-toolbar.tsx`
- `src/components/blocks/data-table/data-table-column-header.tsx`
- `src/components/pos/sales-history-table.tsx`
- `src/components/akuntansi/journal-history-table.tsx`
- `src/components/pengaturan/user-access.tsx`

---

## 2. Form

### 2.1 Anatomi wajib

1. **Label terlihat di atas field** — placeholder bukan pengganti label.
2. **Field wajib** — tanda `*` visual + teks “wajib diisi” untuk pembaca layar.
3. **Hint/error di bawah field** — terhubung ke kontrol lewat `aria-describedby`; error memakai `role="alert"`.
4. **Satu aksi utama** — primer hanya untuk menyimpan/memposting; aksi sekunder outline/ghost.
5. **Error summary** di atas form untuk kesalahan yang tersebar; fokus otomatis ke ringkasan.
6. **Konfirmasi membuang draf** — navigasi/refresh dengan perubahan belum disimpan harus meminta konfirmasi.
7. **Tinggi kontrol** — 44px di ponsel, 36px di desktop (`h-11 lg:h-9`).
8. **Autofocus hanya untuk permukaan kerja berbasis pindai** (POS, opname, mode operasi) — bukan semua form.

### 2.2 Yang dilarang

- Label hanya berupa placeholder.
- Tombol “Batal” yang membuang isian tanpa dialog saat form kotor.
- Dua tombol primer yang bersaing dalam satu layar.
- Field angka tanpa `inputMode` yang tepat.
- Validasi yang hanya muncul setelah submit tanpa ringkasan dan tanpa fokus ke field bermasalah.
- Teks bantuan di bawah 11px pada permukaan aplikasi.

### 2.3 Implementasi rujukan

- `src/components/blocks/field.tsx`
- `src/components/blocks/field-classes.ts`
- `src/components/blocks/error-summary.tsx`
- `src/components/blocks/settings-layout.tsx`
- `src/components/akuntansi/journal-entry-form.tsx`
- `src/components/gudang/product-form.tsx`

---

## 3. Permukaan cetak

Urutan nota thermal yang dipertahankan:

1. Nama badan + outlet + alamat + telepon + NPWP.
2. Nomor, tanggal/waktu, kasir, sesi, pelanggan, jatuh tempo.
3. Item: nama, SKU, qty × harga, diskon, subtotal.
4. Jumlah item, subtotal, diskon, PPN termasuk, pembulatan, **TOTAL**.
5. Pembayaran, diterima, referensi, kembalian, **LUNAS/BELUM LUNAS**.
6. Banner SALINAN / VOID / NOTA RETUR.
7. Footer kebijakan retur + QR.

Aturan:

- Kuantitas pecahan wajib tampil apa adanya (0,25 / 0,5 / 1,5), bukan dibulatkan.
- Diskon per baris dan total tidak boleh disembunyikan.
- Nota retur/void tidak boleh tercetak seperti nota asli.
- Logo tidak boleh melebihi lebar kertas.
- Teks yang panjang harus membungkus, bukan meluber.

---

## 4. Anti “AI slop” checklist

Sebelum menganggap halaman selesai:

- [ ] Satu `h1`, tanpa judul ganda.
- [ ] Satu aksi primer.
- [ ] Tidak ada ikon dekoratif tanpa makna.
- [ ] Tidak ada kartu berisi angka tanpa konteks.
- [ ] Tabel/pilihan kolom/kartu mobile konsisten dengan standar ini.
- [ ] Form punya label, required, hint/error, dan guard draf.
- [ ] Target sentuh utama ≥44px di ponsel.
- [ ] axe 0 violations pada halaman dan dialog yang berubah.
- [ ] Tidak ada overflow horizontal pada 360/390px, kecuali region gulir berlabel.

---

## 5. Verifikasi minimum

- `pnpm test` untuk unit/arsitektur.
- `pnpm build` + `pnpm typecheck`.
- axe pada halaman yang berubah (desktop + mobile).
- Uji keyboard: Tab tidak keluar dari dialog, Escape menutup, fokus kembali.
- Uji 360/390px: tidak ada overflow dokumen; kartu mobile tampil.
- Uji form kotor: navigasi/refresh meminta konfirmasi.
