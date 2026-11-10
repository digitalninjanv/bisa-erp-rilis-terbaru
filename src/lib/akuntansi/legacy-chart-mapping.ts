/**
 * Tabel mapping kode bagan akun LAMA (4 digit) → bagan REFERENSI
 * (cutover 2026-11-09). Tabel ini adalah DATA, bukan logika: alat
 * migrasi (src/server/coa-migration.ts) menerima tabel sebagai
 * parameter dengan bawaan tabel ini, sehingga perusahaan dengan kode
 * kustom dapat dimigrasi memakai tabel yang disesuaikan per
 * perusahaan tanpa mengubah kode program.
 *
 * Akun lama yang tidak punya padanan di bagan referensi dibiarkan
 * sebagai akun kustom (tidak dihapus, tidak digabung diam-diam).
 */
export type LegacyChartCodePair = {
  oldCode: string;
  newCode: string;
};

export const LEGACY_CHART_CODE_MAP: LegacyChartCodePair[] = [
  { oldCode: "1000", newCode: "110107" }, // Kas → Tunai
  { oldCode: "1010", newCode: "110101" }, // Kas Kecil
  { oldCode: "1100", newCode: "11010201" }, // Bank BCA → BMT IFI MART 7540
  { oldCode: "1110", newCode: "110108" }, // QRIS Clearing
  { oldCode: "1180", newCode: "110504" }, // PPN Masukan
  { oldCode: "1200", newCode: "110301" }, // Piutang Usaha
  { oldCode: "1210", newCode: "1113" }, // Kredit Pemasok → Piutang ke Supplier
  { oldCode: "1220", newCode: "110304" }, // Piutang Karyawan
  { oldCode: "1300", newCode: "110401" }, // Persediaan
  { oldCode: "1400", newCode: "110501" }, // Perlengkapan Kantor
  { oldCode: "1500", newCode: "120004" }, // Peralatan
  { oldCode: "1510", newCode: "12000603" }, // Akumulasi Penyusutan Peralatan
  { oldCode: "2000", newCode: "210101" }, // Utang Usaha
  { oldCode: "2100", newCode: "210208" }, // Utang Gaji
  { oldCode: "2110", newCode: "210206" }, // Utang PPh 21
  { oldCode: "2120", newCode: "210210" }, // Utang BPJS
  { oldCode: "2130", newCode: "210207" }, // Utang PPh Dipotong
  { oldCode: "2200", newCode: "210201" }, // PPN Keluaran
  { oldCode: "2300", newCode: "210205" }, // Kredit Pelanggan
  { oldCode: "3000", newCode: "300001" }, // Modal → Equitas Saldo Awal
  { oldCode: "3100", newCode: "300002" }, // Laba Ditahan
  { oldCode: "4000", newCode: "400001" }, // Penjualan
  { oldCode: "4010", newCode: "440101" }, // Diskon Penjualan
  { oldCode: "4020", newCode: "400003" }, // Retur Penjualan
  { oldCode: "4030", newCode: "710005" }, // Pendapatan Lain-lain
  { oldCode: "5000", newCode: "5101" }, // HPP
  { oldCode: "5010", newCode: "510201" }, // Selisih Persediaan
  { oldCode: "5020", newCode: "510202" }, // Barang Rusak dan Kedaluwarsa
  { oldCode: "6000", newCode: "600004" }, // Beban Gaji
  { oldCode: "6010", newCode: "600019" }, // Beban Sewa Gedung
  { oldCode: "6020", newCode: "600011" }, // Beban Listrik
  { oldCode: "6030", newCode: "600013" }, // Beban Telekomunikasi
  { oldCode: "6040", newCode: "600006" }, // Beban Transportasi Karyawan
  { oldCode: "6050", newCode: "600016" }, // Beban Perlengkapan Kantor
  { oldCode: "6060", newCode: "720002" }, // Beban Adm. Bank
  { oldCode: "6070", newCode: "600020" }, // Beban Operasional Lainnya
  { oldCode: "6080", newCode: "600009" }, // Beban Asuransi Karyawan (BPJS)
  { oldCode: "6100", newCode: "720018" }, // Beban Piutang Tak Tertagih
  { oldCode: "8000", newCode: "720017" }, // Beban Selisih Kas Kurang
  { oldCode: "8001", newCode: "710015" }, // Pendapatan Selisih Kas Lebih
  { oldCode: "9000", newCode: "710007" }, // Pembulatan Penjualan (Laba)
  { oldCode: "9001", newCode: "720015" }, // Beban Pembulatan Transaksi
];
