export const ACCOUNT_SECTIONS = {
  current_asset: "Aset lancar",
  non_current_asset: "Aset tidak lancar",
  current_liability: "Liabilitas jangka pendek",
  non_current_liability: "Liabilitas jangka panjang",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  other_income: "Pendapatan lain-lain",
  cogs: "Harga pokok penjualan",
  operating_expense: "Beban operasional",
  other_expense: "Beban lain-lain",
} as const;

export type AccountSection = keyof typeof ACCOUNT_SECTIONS;

export const CASH_FLOW_GROUPS = {
  operating: "Operasi",
  investing: "Investasi",
  financing: "Pendanaan",
} as const;

export type CashFlowGroup = keyof typeof CASH_FLOW_GROUPS;

export const BALANCE_SECTIONS: AccountSection[] = [
  "current_asset",
  "non_current_asset",
  "current_liability",
  "non_current_liability",
  "equity",
];

export const INCOME_SECTIONS: AccountSection[] = [
  "revenue",
  "other_income",
  "cogs",
  "operating_expense",
  "other_expense",
];

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";

/**
 * Matriks tunggal tipe akun → kelompok laporan. Dipakai form akun, impor
 * bagan akun, dan validasi pemetaan agar akun beban tidak bisa masuk
 * kelompok pendapatan (sumber “beban tampil sebagai pendapatan”).
 */
export const ACCOUNT_TYPE_SECTIONS: Record<AccountType, readonly AccountSection[]> = {
  asset: ["current_asset", "non_current_asset"],
  liability: ["current_liability", "non_current_liability"],
  equity: ["equity"],
  revenue: ["revenue", "other_income"],
  cogs: ["cogs"],
  expense: ["operating_expense", "other_expense"],
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "Aset",
  liability: "Liabilitas",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "Harga Pokok Penjualan",
  expense: "Beban",
};

export function isAccountSectionAllowed(
  type: string,
  section: string | null | undefined,
): boolean {
  if (!section) return true;
  const allowed = ACCOUNT_TYPE_SECTIONS[type as AccountType];
  return Boolean(allowed?.includes(section as AccountSection));
}

/**
 * FIX-R2 Tahap 3 (AK2-04): resolusi kelompok laporan TIDAK lagi menebak
 * dari rentang kode akun. Perbandingan string kode itu rapuh dan salah
 * saji secara diam-diam: aset berkode "999" terklasifikasi tidak lancar
 * ("999" > "1500" secara leksikografis), dan utang bank jangka panjang
 * "2400" tampil sebagai liabilitas jangka pendek + arus operasi.
 *
 * Urutan resolusi yang kini berlaku di mana-mana (resolveSection &
 * resolveCashFlowGroup):
 *   1. nilai eksplisit pada akun (`section` / `cash_flow_group`) —
 *      inilah satu-satunya cara menandai pengecualian, misalnya utang
 *      jangka panjang atau pendapatan lain-lain;
 *   2. bawaan tipe akun yang terdokumentasi di bawah ini.
 * Kode akun tidak pernah lagi dibaca untuk menebak kelompok.
 */

/**
 * Bawaan section per tipe akun (dipakai hanya bila `accounts.section`
 * kosong):
 *   asset → current_asset, liability → current_liability,
 *   equity → equity, revenue → revenue, cogs → cogs,
 *   expense → operating_expense.
 * Konsekuensinya eksplisit: aset tetap & liabilitas jangka panjang
 * WAJIB ditandai lewat section akunnya (bagan akun bawaan sudah
 * menandainya); tanpa penanda, akun tampil mengikuti bawaannya —
 * perilaku ini teruji, bukan keajaiban rentang kode.
 */
export function defaultSection(type: string): AccountSection | null {
  if (type === "asset") return "current_asset";
  if (type === "liability") return "current_liability";
  if (type === "equity") return "equity";
  if (type === "revenue") return "revenue";
  if (type === "cogs") return "cogs";
  if (type === "expense") return "operating_expense";
  return null;
}

export function resolveSection(account: { type: string; code: string; section?: string | null }): AccountSection | null {
  if (account.section && account.section in ACCOUNT_SECTIONS) return account.section as AccountSection;
  return defaultSection(account.type);
}

/**
 * Bawaan kelompok arus kas per tipe akun (dipakai hanya bila
 * `accounts.cash_flow_group` kosong):
 *   revenue/cogs/expense → operating (aktivitas usaha harian);
 *   equity → financing (transaksi dengan pemilik);
 *   liability → operating (modal kerja — utang usaha & kewajiban
 *     operasional; pinjaman pendanaan ditandai eksplisit `financing`
 *     pada akunnya oleh admin);
 *   asset → null (BELUM TERKLASIFIKASI): tipe aset saja tidak dapat
 *     membedakan persediaan/piutang (operasi) dari aset tetap
 *     (investasi), jadi laporan arus kas menampilkannya di kelompok
 *     tersendiri "Belum terklasifikasi" agar terlihat — bukan ditebak
 *     dan bukan dibuang diam-diam ke operasi (FIX-R2 AK2-03).
 */
export function resolveCashFlowGroup(account: {
  type: string;
  code: string;
  cashFlowGroup?: string | null;
}): CashFlowGroup | null {
  if (account.cashFlowGroup && account.cashFlowGroup in CASH_FLOW_GROUPS) {
    return account.cashFlowGroup as CashFlowGroup;
  }
  if (["revenue", "cogs", "expense"].includes(account.type)) return "operating";
  if (account.type === "equity") return "financing";
  if (account.type === "liability") return "operating";
  return null;
}

export function isBalanceSection(section: AccountSection | null): boolean {
  return section !== null && (BALANCE_SECTIONS as string[]).includes(section);
}

/**
 * A-27 B3: nomor rekening bank disimpan penuh di basis data tetapi
 * DITAMPILKAN termasker di daftar/detail (praktik ERPNext/Xero) —
 * hanya 4 digit terakhir yang terlihat: "8210456789" → "••••••6789".
 * Nilai ≤ 4 digit ditampilkan apa adanya (tidak ada yang disamarkan).
 */
export function maskBankAccountNumber(value: string | null | undefined): string {
  const digits = (value ?? "").trim();
  if (digits.length <= 4) return digits;
  return `${"•".repeat(Math.min(digits.length - 4, 10))}${digits.slice(-4)}`;
}
