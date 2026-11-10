import { ACCOUNT_SECTIONS, defaultSection, type AccountSection } from "./accounting";

/**
 * A-27 B5 — Tagging PSAK 118 + penanda kontra (KESIAPAN DATA; penulis
 * laporan TIDAK membaca tag ini di A-27 — fase mapping & tagging
 * mendahului fase laporan, sesuai panduan implementasi PSAK 118).
 *
 * PSAK 118 (adopsi IFRS 18, berlaku 1 Jan 2027, retrospektif) mewajibkan
 * setiap pos laba rugi masuk SATU dari lima kategori presentasi:
 * operating | investing | financing | income_tax | discontinued.
 * Kategori TIDAK dapat diturunkan dari rentang kode akun (audit A-27
 * §5.7): bunga atas kas = investing, beban bunga pinjaman/sewa =
 * financing, gagal bayar piutang dagang = operating. Karena itu kategori
 * adalah TAG per akun di basis data, diisi bawaan deterministik dari
 * tipe/section di berkas ini, lalu disesuaikan akuntan lewat formulir
 * akun untuk akun yang sumbernya khusus (bunga, pajak penghasilan,
 * operasi dihentikan).
 *
 * Sifat (nature) & fungsi (function) beban adalah tag pendamping untuk
 * penyajian beban menurut sifat/fungsi. Daftar nilainya terkendali —
 * menambah nilai baru adalah perubahan kode (satu rumah di berkas ini),
 * bukan teks bebas.
 */

export const PSAK118_CATEGORIES = {
  operating: "Operasi (operating)",
  investing: "Investasi (investing)",
  financing: "Pendanaan (financing)",
  income_tax: "Pajak penghasilan (income tax)",
  discontinued: "Operasi dihentikan (discontinued)",
} as const;

export type Psak118Category = keyof typeof PSAK118_CATEGORIES;

export const EXPENSE_NATURES = {
  inventory_expensed: "Persediaan yang dibebankan (HPP)",
  employee_benefits: "Imbalan kerja",
  depreciation: "Penyusutan",
  amortisation: "Amortisasi",
  rent: "Sewa",
  utilities: "Utilitas (listrik, air, telepon, internet)",
  payment_fees: "Biaya pembayaran (MDR & fee)",
  impairment: "Penurunan nilai (impairment)",
  inventory_writedown: "Penurunan nilai persediaan",
  bank_charges: "Beban administrasi bank",
  interest: "Bunga",
  tax: "Pajak",
  other: "Lain-lain",
} as const;

export type ExpenseNature = keyof typeof EXPENSE_NATURES;

export const EXPENSE_FUNCTIONS = {
  cogs: "Harga pokok penjualan",
  selling: "Penjualan & distribusi",
  admin: "Administrasi & umum",
} as const;

export type ExpenseFunction = keyof typeof EXPENSE_FUNCTIONS;

export type Psak118Tags = {
  psak118Category: Psak118Category | null;
  expenseNature: ExpenseNature | null;
  expenseFunction: ExpenseFunction | null;
};

/** Tipe akun laba rugi — hanya akun ini yang membawa kategori PSAK 118. */
export const INCOME_STATEMENT_TYPES = ["revenue", "cogs", "expense"] as const;

/** Tipe akun beban — hanya akun ini yang membawa sifat/fungsi beban. */
export const EXPENSE_TYPES = ["cogs", "expense"] as const;

const INCOME_SECTIONS: AccountSection[] = [
  "revenue",
  "other_income",
  "cogs",
  "operating_expense",
  "other_expense",
];

/**
 * Bawaan tag deterministik dari (tipe, section) — SATU definisi yang
 * dipakai aksi simpan akun (akun-pemetaan.ts), seed demo, dan penanam
 * akun sistem berbasis spec (payroll-indonesia, fixed-assets,
 * payment-deductions). Backfill migrasi 0056 mengeksekusi aturan yang
 * sama dalam SQL atas data lama.
 *
 * Aturannya (konservatif — tidak menebak dari nama/kode):
 * - Akun neraca (aset/liabilitas/ekuitas): semua tag null. Kategori
 *   PSAK 118 adalah kategori LABA RUGI; akun neraca tidak punya.
 * - Akun laba rugi: kategori bawaan `operating`. Pemecahan khusus
 *   (bunga deposito → investing; bunga pinjaman/sewa → financing;
 *   beban pajak penghasilan → income_tax; operasi dihentikan →
 *   discontinued) TIDAK ditebak di sini — itu keputusan akuntan lewat
 *   formulir, dan templat B6 menanamnya eksplisit untuk akun barunya.
 * - Sifat/fungsi beban: cogs → persediaan dibebankan / fungsi cogs;
 *   expense → lain-lain / fungsi admin (bawaan yang dapat disesuaikan;
 *   penyempurnaan per kunci pemetaan ada di
 *   MAPPING_KEY_NATURE_REFINEMENTS).
 */
export function defaultPsak118Tags(
  type: string,
  section?: string | null,
): Psak118Tags {
  // Section eksplisit yang sah menang; section kosong/rusak jatuh ke
  // bawaan tipe (pola resolveSection). Matriks koherensi B4 menjamin
  // section akun laba rugi selalu kelompok laba rugi; cek section di
  // sini menjaga baris lama yang tidak koheren agar tidak tertag.
  const resolvedSection: AccountSection | null =
    section && section in ACCOUNT_SECTIONS
      ? (section as AccountSection)
      : defaultSection(type);
  const isIncomeStatement =
    (INCOME_STATEMENT_TYPES as readonly string[]).includes(type) &&
    resolvedSection !== null &&
    (INCOME_SECTIONS as string[]).includes(resolvedSection);
  if (!isIncomeStatement) {
    return { psak118Category: null, expenseNature: null, expenseFunction: null };
  }
  if (type === "cogs") {
    return {
      psak118Category: "operating",
      expenseNature: "inventory_expensed",
      expenseFunction: "cogs",
    };
  }
  if (type === "expense") {
    return {
      psak118Category: "operating",
      expenseNature: "other",
      expenseFunction: "admin",
    };
  }
  // revenue: kategori saja — sifat/fungsi adalah tag beban.
  return { psak118Category: "operating", expenseNature: null, expenseFunction: null };
}

/**
 * Penyempurnaan sifat beban dari kunci pemetaan (semantik resmi, bukan
 * nama akun): akun yang ditunjuk kunci-kunci ini punya sifat yang pasti
 * menurut definisi kuncinya. Dipakai backfill migrasi 0056 (SQL) dan
 * seed demo — dua eksekusi dari aturan yang sama di sini.
 */
export const MAPPING_KEY_NATURE_REFINEMENTS: Record<string, ExpenseNature> = {
  inventory_shrink: "inventory_writedown",
  damaged: "inventory_writedown",
  salary_expense: "employee_benefits",
  payroll_employer_expense: "employee_benefits",
  bank_fee: "bank_charges",
  receivable_writeoff: "impairment",
};

/**
 * Pasangan kontra dari kunci pemetaan: kunci → kunci akun induk yang
 * dikontranya. Status kontra dibaca dari DATA ini (flag + tautan),
 * bukan dari nama/akhiran kode (audit A-27 §5.8). CKPN (kontra piutang)
 * tidak punya kunci pemetaan — ditandai templat B6 dan formulir.
 */
export const MAPPING_KEY_CONTRA_OF: Record<string, string> = {
  sales_discount: "revenue",
  sales_return: "revenue",
  accumulated_depreciation: "fixed_asset",
};
