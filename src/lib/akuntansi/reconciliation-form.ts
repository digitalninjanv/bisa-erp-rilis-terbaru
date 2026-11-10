/**
 * A-22 Tahap K3: pengelompokan akun lawan untuk form jurnal-dari-
 * mutasi. Daftar akun mentah (semua akun postable, urut kode) menyulitkan
 * pilihan; akun dikelompokkan menurut kegunaan rekonsiliasi — kas/bank
 * dulu, lalu beban & pendapatan (lawan paling umum), sisanya tetap
 * terjangkau di kelompoknya sendiri. Tidak ada akun yang disembunyikan.
 */

export type ContraAccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  isCashBank: boolean;
};

export type ContraAccountGroup = {
  key: string;
  label: string;
  accounts: ContraAccountOption[];
};

/** Akun hasil resolusi server untuk satu tombol model lawan cepat. */
export type ModelAccount = { id: string; code: string; name: string };

/**
 * Model lawan cepat (A-22 K3 butir 4): akun yang akan diisikan tombol
 * model ke form jurnal-dari-mutasi. null berarti server tidak dapat
 * memutuskan akunnya dari pemetaan/data perusahaan — UI menonaktifkan
 * atau memberi catatan, tidak menebak.
 */
export type ContraModels = {
  bankFee: ModelAccount | null;
  otherIncome: ModelAccount | null;
  taxDeduction: ModelAccount | null;
};

const GROUP_DEFS: { key: string; label: string; match: (account: ContraAccountOption) => boolean }[] = [
  { key: "cashbank", label: "Kas & bank", match: (account) => account.isCashBank },
  { key: "expense", label: "Beban", match: (account) => account.type === "expense" },
  { key: "revenue", label: "Pendapatan", match: (account) => account.type === "revenue" },
  { key: "liability", label: "Kewajiban & pajak", match: (account) => account.type === "liability" },
  { key: "asset", label: "Aset lain", match: (account) => account.type === "asset" },
  { key: "cogs", label: "Harga pokok", match: (account) => account.type === "cogs" },
  { key: "equity", label: "Ekuitas", match: (account) => account.type === "equity" },
];

export function groupContraAccounts(accounts: ContraAccountOption[]): ContraAccountGroup[] {
  const remaining = [...accounts];
  const groups: ContraAccountGroup[] = [];
  for (const def of GROUP_DEFS) {
    const matched = remaining.filter(def.match);
    if (matched.length === 0) continue;
    groups.push({ key: def.key, label: def.label, accounts: matched });
    for (const account of matched) {
      remaining.splice(remaining.indexOf(account), 1);
    }
  }
  if (remaining.length > 0) {
    groups.push({ key: "other", label: "Lainnya", accounts: remaining });
  }
  return groups;
}
