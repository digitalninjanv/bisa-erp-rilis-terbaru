/**
 * A-24 T4 (pola Accurate: pemetaan akun berbahasa transaksi) — katalog
 * kunci pemetaan akun: label tampilan, pengelompokan form, dan
 * penjelasan satu baris per kunci dalam bahasa transaksi. Satu sumber
 * untuk form Pengaturan dan pengujian sinkronisasi terhadap
 * ACCOUNT_MAPPING_KEYS di server (tests/unit/account-mappings-sync).
 * Ubah kunci HANYA bersamaan dengan server.
 */
export const MAPPING_LABELS: Record<string, string> = {
  cash: "Kas",
  bank: "Bank",
  qris: "QRIS",
  receivable: "Piutang usaha",
  inventory: "Persediaan",
  payable: "Utang usaha",
  revenue: "Pendapatan penjualan",
  sales_discount: "Diskon penjualan",
  sales_return: "Retur penjualan",
  cogs: "Harga pokok penjualan",
  inventory_shrink: "Selisih persediaan",
  damaged: "Barang rusak & kedaluwarsa",
  tax_output: "PPN keluaran",
  tax_input: "PPN masukan",
  rounding_gain: "Pembulatan laba",
  rounding_loss: "Pembulatan rugi",
  cash_short: "Selisih kas kurang",
  cash_over: "Selisih kas lebih",
  salary_expense: "Beban gaji",
  salary_payable: "Utang gaji",
  salary_deductions_payable: "Utang potongan gaji karyawan",
  bank_fee: "Biaya administrasi bank",
  equity: "Modal / ekuitas",
  other_income: "Pendapatan lain-lain (bonus barang)",
  customer_credit: "Kredit pelanggan (tukar barang / kredit toko)",
  // FIX-P1 Tahap 4 (AK1-03): kunci yang sebelumnya terkunci dibuka.
  supplier_credit: "Kredit Pemasok (klaim retur pembelian)",
  purchase_advance: "Uang muka pembelian (DP)",
  employee_receivable: "Piutang karyawan (kasbon)",
  employee_loan_receivable: "Piutang pinjaman karyawan",
  pph21_payable: "Utang PPh 21",
  bpjs_payable: "Utang BPJS",
  payroll_employer_expense: "Beban iuran BPJS perusahaan",
  fixed_asset: "Aset tetap",
  accumulated_depreciation: "Akumulasi penyusutan",
  depreciation_expense: "Beban penyusutan",
  // A-21 Tahap R3-A (R3-06/R3-07): akun potongan pembayaran.
  tax_withholding_payable: "Utang PPh dipotong (withholding)",
  receivable_writeoff: "Beban piutang tak tertagih (write-off)",
};

/**
 * Pengelompokan editor pemetaan (FIX-P1 Tahap 4, AK1-03). Setiap kunci
 * di MAPPING_LABELS muncul tepat satu kali di sini, dan daftar ini
 * selaras dengan daftar putih ACCOUNT_MAPPING_KEYS di server: kunci
 * yang bisa disimpan dari Pengaturan harus terlihat di Pengaturan.
 */
export const MAPPING_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Penjualan, kas & umum",
    keys: [
      "cash",
      "bank",
      "qris",
      "receivable",
      "revenue",
      "sales_discount",
      "sales_return",
      "cogs",
      "rounding_gain",
      "rounding_loss",
      "cash_short",
      "cash_over",
      "bank_fee",
      "equity",
      "other_income",
    ],
  },
  {
    title: "Pembelian & persediaan",
    keys: ["inventory", "payable", "purchase_advance", "inventory_shrink", "damaged"],
  },
  {
    title: "Pajak",
    keys: ["tax_output", "tax_input", "tax_withholding_payable"],
  },
  {
    title: "Penyelesaian piutang/utang",
    keys: ["receivable_writeoff"],
  },
  {
    title: "Retur & kredit",
    keys: ["supplier_credit", "customer_credit"],
  },
  {
    title: "Karyawan",
    keys: ["employee_receivable", "employee_loan_receivable"],
  },
  {
    title: "Payroll",
    keys: [
      "salary_expense",
      "salary_payable",
      "salary_deductions_payable",
      "pph21_payable",
      "bpjs_payable",
      "payroll_employer_expense",
    ],
  },
  {
    title: "Aset tetap",
    keys: ["fixed_asset", "accumulated_depreciation", "depreciation_expense"],
  },
];

/**
 * Penjelasan satu baris per kunci, dalam bahasa transaksi (bukan
 * bahasa akuntansi): kapan akun ini bergerak. Ditampilkan di bawah
 * label pada form pemetaan agar pemilik usaha paham tanpa latar
 * akuntansi.
 */
export const MAPPING_DESCRIPTIONS: Record<string, string> = {
  cash: "Kas tunai di toko — bertambah saat penjualan & penerimaan tunai, berkurang saat pembayaran tunai.",
  bank: "Rekening bank utama — transfer antar rekening, pembayaran lewat bank, dan setoran.",
  qris: "Penerimaan QRIS di kasir — penjualan QRIS dicatat ke akun ini.",
  receivable: "Piutang usaha — tagihan ke pelanggan dari penjualan tempo dan saldo awal piutang.",
  inventory: "Persediaan barang dagang — bertambah saat penerimaan, berkurang sebesar harga pokok saat terjual.",
  payable: "Utang usaha — kewajiban ke pemasok dari pembelian tempo, beban terutang, dan saldo awal utang.",
  revenue: "Pendapatan penjualan — hasil penjualan sebelum potongan dan retur.",
  sales_discount: "Diskon penjualan — potongan harga yang diberikan ke pelanggan, mengurangi pendapatan.",
  sales_return: "Retur penjualan — nilai barang yang dikembalikan pelanggan, mengurangi pendapatan.",
  cogs: "Harga pokok penjualan — biaya persediaan yang keluar mengikuti penjualan.",
  inventory_shrink: "Selisih persediaan — kekurangan stok dari opname atau penyesuaian di luar rusak/kedaluwarsa.",
  damaged: "Barang rusak & kedaluwarsa — nilai persediaan yang dihapus karena rusak, kedaluwarsa, hilang, atau karantina.",
  tax_output: "PPN keluaran — pajak yang dipungut dari pelanggan atas penjualan kena pajak.",
  tax_input: "PPN masukan — pajak dari pembelian yang dapat dikreditkan.",
  rounding_gain: "Keuntungan pembulatan — selisih pembulatan kas yang menguntungkan toko.",
  rounding_loss: "Kerugian pembulatan — selisih pembulatan kas yang merugikan toko.",
  cash_short: "Selisih kas kurang — uang fisik sesi kasir lebih kecil dari catatan saat sesi ditutup.",
  cash_over: "Selisih kas lebih — uang fisik sesi kasir lebih besar dari catatan saat sesi ditutup.",
  salary_expense: "Beban gaji — biaya gaji dan tunjangan karyawan saat payroll diproses.",
  salary_payable: "Utang gaji — gaji bersih yang terutang ke karyawan sampai dibayarkan.",
  salary_deductions_payable: "Utang potongan gaji — potongan dari gaji karyawan yang masih harus dibayar/disetor.",
  bank_fee: "Biaya bank & pembayaran — fee transfer antar rekening dan potongan/MDR metode pembayaran.",
  equity: "Modal pemilik — setoran modal, saldo awal kas, dan laba ditahan hasil tutup buku.",
  other_income: "Pendapatan lain-lain — misalnya bonus barang dari pemasok yang diterima sebagai penerimaan.",
  customer_credit: "Kredit pelanggan — kewajiban toko atas kelebihan bayar atau uang muka pelanggan.",
  supplier_credit: "Kredit pemasok — klaim ke pemasok dari retur pembelian yang belum diselesaikan.",
  purchase_advance: "Uang muka pembelian — dana yang sudah dibayar ke pemasok sebelum barang diterima, dipotong saat penerimaan.",
  employee_receivable: "Piutang kasbon — uang muka gaji yang diberikan ke karyawan.",
  employee_loan_receivable: "Piutang pinjaman karyawan — pinjaman perusahaan ke karyawan di luar kasbon.",
  pph21_payable: "Utang PPh 21 — pajak penghasilan karyawan yang dipotong dari gaji dan menunggu disetor.",
  bpjs_payable: "Utang BPJS — iuran BPJS karyawan dan perusahaan yang menunggu disetor.",
  payroll_employer_expense: "Beban iuran BPJS perusahaan — porsi iuran yang menjadi beban perusahaan.",
  fixed_asset: "Aset tetap — nilai perolehan aset seperti kendaraan, etalase, dan peralatan.",
  accumulated_depreciation: "Akumulasi penyusutan — pengurang nilai aset tetap dari penyusutan berjalan.",
  depreciation_expense: "Beban penyusutan — biaya penyusutan aset tetap per periode.",
  tax_withholding_payable: "Utang PPh dipotong — PPh 23/4 ayat (2) yang dipotong dari pembayaran dan menunggu disetor.",
  receivable_writeoff: "Beban piutang tak tertagih — sisa piutang yang dihapus karena dinyatakan tidak dapat ditagih.",
};

/**
 * Daftar kunci resmi yang boleh disimpan lewat aksi pemetaan
 * (saveMappingAction). SATU daftar untuk server & UI: kunci yang bisa
 * disimpan harus bisa dilihat dan dijelaskan.
 */
export const ACCOUNT_MAPPING_KEYS = [
  "cash",
  "bank",
  "qris",
  "receivable",
  "inventory",
  "payable",
  "purchase_advance",
  "revenue",
  "sales_discount",
  "sales_return",
  "cogs",
  "inventory_shrink",
  "damaged",
  "tax_output",
  "tax_input",
  "rounding_gain",
  "rounding_loss",
  "cash_short",
  "cash_over",
  "salary_expense",
  "salary_payable",
  "salary_deductions_payable",
  "pph21_payable",
  "bpjs_payable",
  "payroll_employer_expense",
  "employee_receivable",
  "employee_loan_receivable",
  "supplier_credit",
  "fixed_asset",
  "accumulated_depreciation",
  "depreciation_expense",
  "bank_fee",
  "equity",
  "other_income",
  "customer_credit",
  // A-21 Tahap R3-A (R3-06/R3-07): akun potongan pembayaran —
  // tax_withholding_payable dibaca payment-deductions (withholding),
  // receivable_writeoff dibaca party-writeoffs (write-off piutang).
  "tax_withholding_payable",
  "receivable_writeoff",
] as const;
