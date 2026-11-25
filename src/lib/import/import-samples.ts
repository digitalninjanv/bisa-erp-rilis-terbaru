/**
 * Contoh CSV per tipe impor. Header di baris pertama HARUS persis yang
 * dikenali parser (alias di ENTITY_FIELDS), karena berkas inilah yang
 * diunduh pengguna dari UI sebagai templat.
 */
import type { ImportEntity } from "./import-entities";

export const IMPORT_SAMPLES: Record<ImportEntity, { fileName: string; csv: string }> = {
  products: {
    fileName: "contoh-impor-produk.csv",
    csv: [
      "Kode Barang,Nama Barang,Barcode,Kategori,Satuan,Pemasok,Harga Beli,Harga Jual,Stok Minimum,Stok Awal,Keterangan,Kemasan,Isi Kemasan,Harga Beli Kemasan,Harga Jual Kemasan,Barcode Kemasan,Status Kemasan,Kemasan Bawaan",
      "UJI-001,Produk Uji Impor,899000000001,Umum,PCS,,5000,7500,2,10,Contoh baris produk,Dus,24,110000,132000,,Aktif,Beli+Jual",
    ].join("\n"),
  },
  suppliers: {
    fileName: "contoh-impor-pemasok.csv",
    csv: [
      "Kode,Nama,Telepon,Email,Alamat,Catatan",
      "SUP-UJI-01,PT Sumber Data Uji,0812000111,halo@sumberdata.id,Jl Merdeka No 1,Contoh pemasok pertama",
      ",Kedai Bahan Uji,0812000222,,Jl Melati No 2,Baris tanpa kode dibuatkan kode otomatis",
    ].join("\n"),
  },
  customers: {
    fileName: "contoh-impor-pelanggan.csv",
    csv: [
      "Kode,Nama,Telepon,Email,Alamat,Kelompok Harga,Batas Kredit,Catatan",
      "CUST-UJI-01,Toko Berkah Uji,0813000111,berkah@toko.id,Jl Sudirman No 3,,5000000,Contoh pelanggan",
      ",Tania Uji,0813000222,tania@uji.id,Jl Kenanga No 4,,0,",
    ].join("\n"),
  },
  branches: {
    fileName: "contoh-impor-cabang.csv",
    csv: [
      "Kode,Nama,Alamat,Telepon,Status",
      "CBG-UJI-01,Cabang Uji Pusat,Jl Merdeka No 1,021-5550001,Aktif",
      ",Cabang Uji Dua,Jl Melati No 2,,Aktif",
    ].join("\n"),
  },
  warehouses: {
    fileName: "contoh-impor-gudang.csv",
    csv: [
      "Kode,Nama,Tipe,Kode Cabang,Status",
      "GD-UJI-01,Gudang Uji Utama,Gudang,CBG-UJI-01,Aktif",
      ",Gudang Uji Toko,Toko,,Aktif",
    ].join("\n"),
  },
  payment_methods: {
    fileName: "contoh-impor-metode-pembayaran.csv",
    csv: [
      "Kode,Nama,Tipe,Kode Akun,Instruksi,Status",
      "CASH-UJI,Tunai Uji,cash,110101,Kembalian dihitung otomatis,Aktif",
      ",QRIS Uji,qris,,Scan QRIS lalu konfirmasi manual,Aktif",
    ].join("\n"),
  },
  customer_groups: {
    fileName: "contoh-impor-kelompok-harga.csv",
    csv: [
      "Nama Kelompok,Tipe Diskon,Nilai Diskon,Pembulatan,Arah Pembulatan,Bulatkan Total Tunai,Status",
      "Grosir Uji,percent,5,100,down,Tidak,Aktif",
      "Reseller Uji,amount,500,0,down,Tidak,Aktif",
    ].join("\n"),
  },
  employees: {
    fileName: "contoh-impor-karyawan.csv",
    csv: [
      "Kode,Nama,Jabatan,Gaji Pokok,Tunjangan,Potongan,Tanggal Masuk,NIK,Status PTKP,Status",
      "EMP-UJI-01,Budi Uji,Kasir,4500000,500000,0,2026-01-05,3171000000000001,TK/0,Aktif",
      ",Sari Uji,Pramuniaga,4000000,250000,0,2026-02-01,,TK/0,Aktif",
    ].join("\n"),
  },
  fixed_assets: {
    fileName: "contoh-impor-aset-tetap.csv",
    csv: [
      "Nama Aset,Kategori,Tanggal Perolehan,Harga Perolehan,Nilai Residu,Umur Manfaat (bulan),Kode Akun Sumber,Catatan",
      "Chiller Uji,peralatan,2026-01-10,12000000,600000,60,110101,Pendingin minuman",
      "Rak Uji,perabot,2026-02-01,3500000,0,48,110101,Rak display",
    ].join("\n"),
  },
  accounts: {
    fileName: "contoh-impor-akun.csv",
    csv: [
      "Kode,Nama,Tipe,Saldo Normal,Bagian,Keterangan",
      "6950,Beban Uji Impor,expense,debit,operating_expense,Contoh akun beban",
      "2950,Utang Uji Impor,liability,kredit,current_liability,Contoh akun liabilitas",
    ].join("\n"),
  },
  categories: {
    fileName: "contoh-impor-kategori.csv",
    csv: [
      "Nama Kategori,Induk Kategori,Status",
      "Minuman,,Aktif",
      "Kopi & Teh,Minuman,Aktif",
    ].join("\n"),
  },
  units: {
    fileName: "contoh-impor-satuan.csv",
    csv: ["Kode Satuan,Nama Satuan,Status", "PCS,Pieces,Aktif", "BOX,Box,Aktif"].join("\n"),
  },
  account_mappings: {
    fileName: "contoh-impor-pemetaan-akun.csv",
    csv: ["Kunci pemetaan,Kode akun", "cash,110101", "payable,210101"].join("\n"),
  },
  opening_stock: {
    fileName: "contoh-impor-stok-awal.csv",
    csv: [
      "SKU,Nama Produk,Gudang Saldo Awal,Kuantitas Saldo Awal,Nilai Satuan,Per Tanggal",
      "GANTI-SKU-ANDA,Contoh Produk Stok Awal,,10,2500,",
    ].join("\n"),
  },
  opening_payables: {
    fileName: "contoh-impor-saldo-awal-utang.csv",
    csv: [
      "Nama Pemasok,Tanggal,Jatuh Tempo,Jumlah,Referensi",
      "PT Sumber Data Uji,2026-10-01,2026-10-31,1500000,INV-LAMA-001",
    ].join("\n"),
  },
  opening_receivables: {
    fileName: "contoh-impor-saldo-awal-piutang.csv",
    csv: [
      "Nama Pelanggan,Tanggal,Jatuh Tempo,Jumlah,Referensi",
      "Toko Berkah Uji,2026-10-05,2026-11-04,2750000,INV-LAMA-101",
    ].join("\n"),
  },
};

