import type { AccountSection, CashFlowGroup } from "./accounting";
import type { ExpenseFunction, ExpenseNature, Psak118Category } from "./psak118";

/**
 * Templat bagan akun bawaan — SATU-SATUNYA sumber bagan bawaan.
 * Perusahaan baru ditanam dari daftar ini lewat `seedChartOfAccounts`
 * (src/server/accounting.ts), dan seed demo memakai fungsi yang sama.
 *
 * Sejak cutover 2026-11-09 daftar ini mengikuti file referensi
 * pemilik `/home/najib/Documents/ref/akun-perkiraan (3).xlsx`
 * (ekspor Accurate IFI MART): 126 kode/nama/induk dipertahankan apa
 * adanya (satu perbaikan hierarki: BSI 11010203 ditempatkan di bawah
 * 110102), ditambah 15 akun operasional yang tidak ada di file tetapi
 * wajib untuk mesin POS/payroll (QRIS clearing, piutang karyawan,
 * kredit pelanggan, PPh 21, utang gaji/BPJS, selisih kas, selisih
 * persediaan, piutang tak tertagih). Total 141 akun.
 *
 * Aturan yang dijaga data ini:
 *  - kode, nama, dan induk mengikuti file referensi; akun baru memakai
 *    kode turunan yang tidak bentrok dengan kode referensi;
 *  - tipe Accurate dipetakan ke tipe aplikasi: BANK/INTR/AREC/OCAS/
 *    OASS/FASS/DEPR → aset, APAY/OCLY/LTLY → liabilitas, EQTY →
 *    ekuitas, REVE/OINC → pendapatan, COGS → HPP, EXPS/OEXP → beban;
 *  - akun yang punya anak SELALU header/non-postable — postabilitas
 *    dibaca dari data, tidak pernah ditebak dari pola kode;
 *  - seluruh 37 kunci pemetaan resmi tertanam (`mappingKey`).
 */

export type ChartAccountType = "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";
export type CashBankKind = "cash" | "bank" | "clearing";

export type ChartTemplateEntry = {
  code: string;
  name: string;
  type: ChartAccountType;
  section: AccountSection | null;
  parentCode: string | null;
  normalBalance: "debit" | "credit";
  cashFlowGroup: CashFlowGroup | null;
  cashBankKind: CashBankKind | null;
  /** Header grup/kelas (20 akun): selalu non-postable. */
  isHeader: boolean;
  isPostable: boolean;
  /** Akun sistem (dipakai mesin tutup buku; tidak dipilih pengguna). */
  isSystem: boolean;
  psak118Category: Psak118Category | null;
  expenseNature: ExpenseNature | null;
  expenseFunction: ExpenseFunction | null;
  isContra: boolean;
  contraOfCode: string | null;
  mappingKey: string | null;
  description: string | null;
};

/** Bentuk ringkas penulisan tabel: kolom yang kosong diisi bawaan deterministik di `resolveEntry`. */
type RawEntry = {
  code: string;
  name: string;
  type: ChartAccountType;
  section: AccountSection | null;
  parent: string | null;
  balance?: "debit" | "credit";
  flow?: CashFlowGroup | null;
  kind?: CashBankKind;
  header?: boolean;
  postable?: boolean;
  system?: boolean;
  key?: string;
  contraOf?: string;
  contra?: boolean;
  psak?: Psak118Category;
  nature?: ExpenseNature;
  fn?: ExpenseFunction;
  desc?: string;
};

function defaultFlow(entry: RawEntry): CashFlowGroup | null {
  if (entry.kind) return null; // akun kas/bank adalah subyek laporan arus kas, bukan akun lawan
  switch (entry.section) {
    case "non_current_asset":
      return "investing";
    case "non_current_liability":
    case "equity":
      return "financing";
    case "current_asset":
    case "current_liability":
    case "revenue":
    case "other_income":
    case "cogs":
    case "operating_expense":
    case "other_expense":
      return "operating";
    default:
      return null;
  }
}

function resolveEntry(entry: RawEntry): ChartTemplateEntry {
  const isIncomeType = entry.type === "revenue" || entry.type === "cogs" || entry.type === "expense";
  const tagsApply = isIncomeType && !entry.header;
  return {
    code: entry.code,
    name: entry.name,
    type: entry.type,
    section: entry.section,
    parentCode: entry.parent,
    normalBalance:
      entry.balance ??
      (entry.type === "asset" || entry.type === "cogs" || entry.type === "expense" ? "debit" : "credit"),
    cashFlowGroup: entry.flow !== undefined ? entry.flow : defaultFlow(entry),
    cashBankKind: entry.kind ?? null,
    isHeader: entry.header ?? false,
    isPostable: entry.header ? false : (entry.postable ?? true),
    isSystem: entry.system ?? false,
    psak118Category: tagsApply ? (entry.psak ?? "operating") : null,
    expenseNature: tagsApply
      ? (entry.nature ?? (entry.type === "cogs" ? "inventory_expensed" : entry.type === "expense" ? "other" : null))
      : null,
    expenseFunction: tagsApply
      ? (entry.fn ?? (entry.type === "cogs" ? "cogs" : entry.type === "expense" ? "admin" : null))
      : null,
    isContra: entry.contraOf !== undefined || entry.contra === true,
    contraOfCode: entry.contraOf ?? null,
    mappingKey: entry.key ?? null,
    description: entry.desc ?? null,
  };
}

const RAW_TEMPLATE: RawEntry[] = [
  { code: "120006", name: "Akumulasi Depresiasi Aset Tetap", type: "asset", section: "non_current_asset", parent: null, header: true, balance: "credit", contra: true },
  { code: "12000601", name: "Akumulasi Penyusutan Gedung", type: "asset", section: "non_current_asset", parent: "120006", balance: "credit", contraOf: "120002" },
  { code: "12000604", name: "Akumulasi Penyusutan Inventaris Kantor", type: "asset", section: "non_current_asset", parent: "120006", balance: "credit", contraOf: "120005" },
  { code: "12000602", name: "Akumulasi Penyusutan Kendaraan", type: "asset", section: "non_current_asset", parent: "120006", balance: "credit", contraOf: "120003" },
  { code: "12000603", name: "Akumulasi Penyusutan Peralatan", type: "asset", section: "non_current_asset", parent: "120006", balance: "credit", contraOf: "120004", key: "accumulated_depreciation" },
  { code: "1105", name: "Aset Lancar Lainnya", type: "asset", section: "current_asset", parent: null, header: true },
  { code: "1200", name: "Aset Tetap", type: "asset", section: "non_current_asset", parent: null, header: true },
  { code: "110503", name: "Asuransi Dibayar Dimuka", type: "asset", section: "current_asset", parent: "1105" },
  { code: "11010202", name: "BMT EKONOMI 7306", type: "asset", section: "current_asset", parent: "110102", kind: "bank" },
  { code: "11010201", name: "BMT IFI MART 7540", type: "asset", section: "current_asset", parent: "110102", kind: "bank", key: "bank" },
  { code: "11010203", name: "BSI", type: "asset", section: "current_asset", parent: "110102", kind: "bank" },
  { code: "110102", name: "Bank", type: "asset", section: "current_asset", parent: "1101", header: true },
  { code: "720002", name: "Beban Adm. Bank & Buku Cek/Giro", type: "expense", section: "other_expense", parent: "7200", key: "bank_fee", psak: "operating", nature: "bank_charges" },
  { code: "600009", name: "Beban Asuransi Karyawan", type: "expense", section: "operating_expense", parent: "6000", key: "payroll_employer_expense", nature: "employee_benefits" },
  { code: "720013", name: "Beban Bagi Hasil ke Yayasan", type: "expense", section: "other_expense", parent: "7200" },
  { code: "600003", name: "Beban Bensin, Parkir, Tol Kendaraan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600005", name: "Beban Bonus, Pesangon & Kompensasi", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "720001", name: "Beban Bunga Pinjaman", type: "expense", section: "other_expense", parent: "7200", psak: "financing", nature: "interest", flow: "financing" },
  { code: "7200", name: "Beban Diluar Usaha", type: "expense", section: "other_expense", parent: null, header: true },
  { code: "720007", name: "Beban Diluar Usaha Lainnya", type: "expense", section: "other_expense", parent: "7200" },
  { code: "600014", name: "Beban Ekspedisi, Pos & Materai", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600004", name: "Beban Gaji, Upah & Honorer", type: "expense", section: "operating_expense", parent: "6000", key: "salary_expense", nature: "employee_benefits" },
  { code: "600001", name: "Beban Iklan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "720012", name: "Beban Kantin SD", type: "expense", section: "other_expense", parent: "7200" },
  { code: "720011", name: "Beban Kantin SMP Putra", type: "expense", section: "other_expense", parent: "7200" },
  { code: "720010", name: "Beban Kantin SMP Putri", type: "expense", section: "other_expense", parent: "7200" },
  { code: "600007", name: "Beban Katering & Makan Karyawan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600002", name: "Beban Komisi", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600011", name: "Beban Listrik", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "6000", name: "Beban Operasional", type: "expense", section: "operating_expense", parent: null, header: true },
  { code: "600020", name: "Beban Operasional Lainnya", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "720009", name: "Beban Orderan Baznas, YIF, Umum", type: "expense", section: "other_expense", parent: "7200" },
  { code: "600012", name: "Beban PAM", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600017", name: "Beban Pajak Penghasilan", type: "expense", section: "operating_expense", parent: "6000", psak: "income_tax", nature: "tax" },
  { code: "720015", name: "Beban Pembulatan Transaksi", type: "expense", section: "other_expense", parent: "7200", key: "rounding_loss" },
  { code: "600021", name: "Beban Penyusutan Gedung", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600024", name: "Beban Penyusutan Inventaris Kantor", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600022", name: "Beban Penyusutan Kendaraan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600023", name: "Beban Penyusutan Peralatan", type: "expense", section: "operating_expense", parent: "6000", key: "depreciation_expense", nature: "depreciation" },
  { code: "600015", name: "Beban Perjalanan Dinas", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600016", name: "Beban Perlengkapan Kantor", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "5101", name: "Beban Pokok Penjualan", type: "cogs", section: "cogs", parent: null, key: "cogs" },
  { code: "720014", name: "Beban Project Street Food", type: "expense", section: "other_expense", parent: "7200" },
  { code: "600018", name: "Beban Retribusi & Sumbangan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600019", name: "Beban Sewa Gedung", type: "expense", section: "operating_expense", parent: "6000", nature: "rent" },
  { code: "600010", name: "Beban THR", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600013", name: "Beban Telekomunikasi", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600006", name: "Beban Transportasi Karyawan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600008", name: "Beban Tunjangan Kesehatan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "600025", name: "Beban renovasi dan pemeliharaan", type: "expense", section: "operating_expense", parent: "6000" },
  { code: "110201", name: "Deposito Bank", type: "asset", section: "current_asset", parent: "1102", kind: "bank" },
  { code: "400004", name: "Diskon Penjualan", type: "revenue", section: "revenue", parent: "4000", balance: "debit", contraOf: "400001" },
  { code: "4401", name: "Diskon Penjualan", type: "revenue", section: "revenue", parent: null, header: true },
  { code: "440101", name: "Diskon Penjualan IDR", type: "revenue", section: "revenue", parent: "4401", balance: "debit", contraOf: "400001", key: "sales_discount" },
  { code: "300001", name: "Equitas Saldo Awal", type: "equity", section: "equity", parent: "3000", key: "equity" },
  { code: "110105", name: "FLIP", type: "asset", section: "current_asset", parent: "1101", kind: "bank" },
  { code: "120002", name: "Gedung", type: "asset", section: "non_current_asset", parent: "1200" },
  { code: "2201", name: "Hutang Jangka Panjang", type: "liability", section: "non_current_liability", parent: null },
  { code: "210203", name: "Hutang Pembelian Belum Ditagih", type: "liability", section: "current_liability", parent: "2102" },
  { code: "120005", name: "Inventaris Kantor", type: "asset", section: "non_current_asset", parent: "1200" },
  { code: "110506", name: "Investasi Kentang", type: "asset", section: "current_asset", parent: "1105" },
  { code: "1101", name: "Kas & Bank", type: "asset", section: "current_asset", parent: null, header: true },
  { code: "110104", name: "Kas Kasir", type: "asset", section: "current_asset", parent: "1101", kind: "cash" },
  { code: "110101", name: "Kas Kecil", type: "asset", section: "current_asset", parent: "1101", kind: "cash" },
  { code: "110103", name: "Kas Mengendap", type: "asset", section: "current_asset", parent: "1101", kind: "bank" },
  { code: "71001301", name: "Kelebihan transfer", type: "revenue", section: "other_income", parent: "710013" },
  { code: "120003", name: "Kendaraan", type: "asset", section: "non_current_asset", parent: "1200" },
  { code: "2102", name: "Kewajiban Jangka Pendek Lainnya", type: "liability", section: "current_liability", parent: null, header: true },
  { code: "720016", name: "Koreksi Utang", type: "expense", section: "other_expense", parent: "7200" },
  { code: "300002", name: "Laba Ditahan", type: "equity", section: "equity", parent: "3000" },
  { code: "720005", name: "Laba/Rugi Belum Terealisasi", type: "expense", section: "other_expense", parent: "7200" },
  { code: "7202", name: "Laba/Rugi Belum Terealisasi", type: "expense", section: "other_expense", parent: null, header: true },
  { code: "720201", name: "Laba/Rugi Belum Terealisasi IDR", type: "expense", section: "other_expense", parent: "7202" },
  { code: "720006", name: "Laba/Rugi Disposisi Aset", type: "expense", section: "other_expense", parent: "7200", psak: "investing", flow: "investing" },
  { code: "710004", name: "Laba/Rugi Revaluasi Aset", type: "revenue", section: "other_income", parent: "7100", psak: "investing", flow: "investing" },
  { code: "720004", name: "Laba/Rugi Terealisasi", type: "expense", section: "other_expense", parent: "7200" },
  { code: "7201", name: "Laba/Rugi Terealisasi", type: "expense", section: "other_expense", parent: null, header: true },
  { code: "720101", name: "Laba/Rugi Terealisasi IDR", type: "expense", section: "other_expense", parent: "7201" },
  { code: "3000", name: "Modal", type: "equity", section: "equity", parent: null, header: true },
  { code: "300003", name: "Modal Saham", type: "equity", section: "equity", parent: "3000" },
  { code: "210201", name: "PPN Keluaran", type: "liability", section: "current_liability", parent: "2102", key: "tax_output" },
  { code: "110504", name: "PPN Masukan", type: "asset", section: "current_asset", parent: "1105", key: "tax_input" },
  { code: "210202", name: "PPh 23 Pembelian", type: "liability", section: "current_liability", parent: "2102" },
  { code: "110505", name: "PPh 23 Penjualan", type: "asset", section: "current_asset", parent: "1105" },
  { code: "720003", name: "Pajak Jasa Giro", type: "expense", section: "other_expense", parent: "7200" },
  { code: "710002", name: "Pendapatan Bunga Deposito", type: "revenue", section: "other_income", parent: "7100", psak: "investing", flow: "investing" },
  { code: "7100", name: "Pendapatan Diluar Usaha", type: "revenue", section: "other_income", parent: null, header: true },
  { code: "710005", name: "Pendapatan Diluar Usaha Lainnya", type: "revenue", section: "other_income", parent: "7100", key: "other_income" },
  { code: "710006", name: "Pendapatan Diterima Dimuka", type: "revenue", section: "other_income", parent: "7100" },
  { code: "400002", name: "Pendapatan Jasa", type: "revenue", section: "revenue", parent: "4000" },
  { code: "710001", name: "Pendapatan Jasa Giro", type: "revenue", section: "other_income", parent: "7100", psak: "investing", flow: "investing" },
  { code: "710014", name: "Pendapatan Kantin", type: "revenue", section: "other_income", parent: "7100" },
  { code: "710010", name: "Pendapatan Kantin SD", type: "revenue", section: "other_income", parent: "7100" },
  { code: "710008", name: "Pendapatan Kantin SMP Putra", type: "revenue", section: "other_income", parent: "7100" },
  { code: "710009", name: "Pendapatan Kantin SMP Putri", type: "revenue", section: "other_income", parent: "7100" },
  { code: "4000", name: "Pendapatan Operasional", type: "revenue", section: "revenue", parent: null, header: true },
  { code: "710011", name: "Pendapatan Project Baznas, YIF, Umum", type: "revenue", section: "other_income", parent: "7100" },
  { code: "710012", name: "Pendapatan Street Food", type: "revenue", section: "other_income", parent: "7100" },
  { code: "400001", name: "Penjualan", type: "revenue", section: "revenue", parent: "4000", key: "revenue" },
  { code: "710003", name: "Penjualan Persediaan / Perlengkapan", type: "revenue", section: "other_income", parent: "7100", psak: "investing", flow: "investing" },
  { code: "120004", name: "Peralatan", type: "asset", section: "non_current_asset", parent: "1200", key: "fixed_asset" },
  { code: "110501", name: "Perlengkapan Kantor", type: "asset", section: "current_asset", parent: "1105" },
  { code: "1104", name: "Persediaan", type: "asset", section: "current_asset", parent: null, header: true },
  { code: "110401", name: "Persediaan", type: "asset", section: "current_asset", parent: "1104", key: "inventory" },
  { code: "110403", name: "Persediaan Khusus", type: "asset", section: "current_asset", parent: "1104" },
  { code: "110404", name: "Persediaan Parcel Ramadhan", type: "asset", section: "current_asset", parent: "1104" },
  { code: "110402", name: "Persediaan Terkirim", type: "asset", section: "current_asset", parent: "1104" },
  { code: "110303", name: "Piutang Lain-lain", type: "asset", section: "current_asset", parent: null },
  { code: "1300", name: "Piutang Mb Hana", type: "asset", section: "current_asset", parent: null },
  { code: "1103", name: "Piutang Usaha", type: "asset", section: "current_asset", parent: null, header: true },
  { code: "110301", name: "Piutang Usaha IDR", type: "asset", section: "current_asset", parent: "1103", key: "receivable" },
  { code: "1113", name: "Piutang ke Supplier", type: "asset", section: "current_asset", parent: null, key: "supplier_credit" },
  { code: "400003", name: "Retur Penjualan", type: "revenue", section: "revenue", parent: "4000", balance: "debit", contraOf: "400001", key: "sales_return" },
  { code: "710007", name: "Selisih Pencatatan Penjualan", type: "revenue", section: "other_income", parent: "7100", key: "rounding_gain" },
  { code: "710013", name: "Selisih Pengembalian Retur", type: "revenue", section: "other_income", parent: "7100", header: true },
  { code: "1102", name: "Setara Kas", type: "asset", section: "current_asset", parent: null, header: true },
  { code: "110502", name: "Sewa Gedung Dibayar Dimuka", type: "asset", section: "current_asset", parent: "1105" },
  { code: "110106", name: "ShopeePay", type: "asset", section: "current_asset", parent: "1101", kind: "clearing" },
  { code: "120001", name: "Tanah", type: "asset", section: "non_current_asset", parent: "1200" },
  { code: "110107", name: "Tunai", type: "asset", section: "current_asset", parent: "1101", kind: "cash", key: "cash" },
  { code: "110302", name: "Uang Muka Pembelian IDR", type: "asset", section: "current_asset", parent: "1103", key: "purchase_advance" },
  { code: "210102", name: "Uang Muka Penjualan IDR", type: "liability", section: "current_liability", parent: "2101" },
  { code: "210204", name: "Utang Mas Zaki", type: "liability", section: "current_liability", parent: "2102" },
  { code: "2101", name: "Utang Usaha", type: "liability", section: "current_liability", parent: null, header: true },
  { code: "210101", name: "Utang Usaha IDR", type: "liability", section: "current_liability", parent: "2101", key: "payable" },
  { code: "210103", name: "Utang Yayasan", type: "liability", section: "current_liability", parent: "2101" },
  { code: "110108", name: "QRIS Clearing", type: "asset", section: "current_asset", parent: "1101", kind: "clearing", key: "qris" },
  { code: "110304", name: "Piutang Karyawan", type: "asset", section: "current_asset", parent: "1103", key: "employee_receivable" },
  { code: "110305", name: "Piutang Pinjaman Karyawan", type: "asset", section: "current_asset", parent: "1103", key: "employee_loan_receivable" },
  { code: "210205", name: "Kredit Pelanggan", type: "liability", section: "current_liability", parent: "2102", key: "customer_credit" },
  { code: "210206", name: "Utang PPh 21", type: "liability", section: "current_liability", parent: "2102", key: "pph21_payable" },
  { code: "210207", name: "Utang PPh Dipotong", type: "liability", section: "current_liability", parent: "2102", key: "tax_withholding_payable" },
  { code: "210208", name: "Utang Gaji", type: "liability", section: "current_liability", parent: "2102", key: "salary_payable" },
  { code: "210209", name: "Utang Potongan Gaji Karyawan", type: "liability", section: "current_liability", parent: "2102", key: "salary_deductions_payable" },
  { code: "210210", name: "Utang BPJS", type: "liability", section: "current_liability", parent: "2102", key: "bpjs_payable" },
  { code: "5102", name: "Selisih Persediaan", type: "cogs", section: "cogs", parent: null, header: true },
  { code: "510201", name: "Selisih Persediaan", type: "cogs", section: "cogs", parent: "5102", key: "inventory_shrink", nature: "inventory_writedown" },
  { code: "510202", name: "Barang Rusak dan Kedaluwarsa", type: "cogs", section: "cogs", parent: "5102", key: "damaged", nature: "inventory_writedown" },
  { code: "710015", name: "Pendapatan Selisih Kas Lebih", type: "revenue", section: "other_income", parent: "7100", key: "cash_over" },
  { code: "720017", name: "Beban Selisih Kas Kurang", type: "expense", section: "other_expense", parent: "7200", key: "cash_short" },
  { code: "720018", name: "Beban Piutang Tak Tertagih", type: "expense", section: "other_expense", parent: "7200", key: "receivable_writeoff", nature: "impairment" },
];

const RESOLVED_TEMPLATE = RAW_TEMPLATE.map(resolveEntry);
const TEMPLATE_BY_CODE = new Map(RESOLVED_TEMPLATE.map((entry) => [entry.code, entry]));

/** Kedalaman hierarki — dipakai agar induk selalu ditanam sebelum anak. */
function depthOf(entry: ChartTemplateEntry): number {
  let depth = 0;
  let cursor = entry;
  while (cursor.parentCode) {
    depth += 1;
    cursor = TEMPLATE_BY_CODE.get(cursor.parentCode) ?? cursor;
    if (cursor.code === entry.code) break;
  }
  return depth;
}

/**
 * Bagan templat referensi yang sudah teresolusi penuh — diurutkan
 * induk-dulu (stabil: urutan file dipertahankan dalam kedalaman sama).
 */
export const CHART_TEMPLATE: ChartTemplateEntry[] = [...RESOLVED_TEMPLATE].sort(
  (a, b) => depthOf(a) - depthOf(b),
);

/** Pasangan kunci pemetaan → kode akun templat, diturunkan dari daftar yang sama (37 kunci). */
export const CHART_TEMPLATE_MAPPINGS: Array<{ key: string; code: string }> = CHART_TEMPLATE.filter(
  (entry) => entry.mappingKey !== null,
).map((entry) => ({ key: entry.mappingKey!, code: entry.code }));
