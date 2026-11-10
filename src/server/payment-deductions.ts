import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { d, type D, type MoneyInput } from "@/lib/money";
import { ensureSystemAccounts } from "@/server/system-accounts";

import { getCompanySettingsRow } from "@/server/settings";
/**
 * A-21 Tahap R3-A (R3-06 + R3-07): akun & penjaga potongan pembayaran.
 *
 * Dua akun sistem baru mengikuti pola ensure S2/aset tetap (akun +
 * pemetaan dibuat malas per perusahaan, pemetaan yang sudah ada tidak
 * pernah ditimpa):
 * - `tax_withholding_payable` → 2130 "Utang PPh Dipotong": kewajiban
 *   pajak yang dipotong perusahaan dari pembayaran keluar (PPh 23 /
 *   PPh 4(2)) sebelum disetor — terpisah dari 2110 Utang PPh 21 gaji.
 * - `receivable_writeoff` → 6100 "Beban Piutang Tak Tertagih": beban
 *   penutup sisa piutang lewat write-off berizin (R3-07).
 */
const ACCOUNT_SPECS: Array<{
  key: string;
  code: string;
  fallbackCode: string;
  name: string;
  type: string;
  normalBalance: string;
  section: string;
  cashFlowGroup: string;
}> = [
  { key: "tax_withholding_payable", code: "2130", fallbackCode: "2130-PPH", name: "Utang PPh Dipotong", type: "liability", normalBalance: "credit", section: "current_liability", cashFlowGroup: "operating" },
  { key: "receivable_writeoff", code: "6100", fallbackCode: "6100-WOF", name: "Beban Piutang Tak Tertagih", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
];

export async function ensurePaymentDeductionAccounts(
  tx: Tx,
  companyId: string,
): Promise<Record<string, string>> {
  // R3 K-2: algoritma ensure kini hidup SATU di server/system-accounts;
  // berkas ini hanya menyimpan daftar spec domainnya.
  return ensureSystemAccounts(tx, companyId, ACCOUNT_SPECS);
}

/** Jenis potongan yang dikenal — data sederhana di baris pembayaran,
 * BUKAN engine tarif: tarif/nominal selalu keputusan pengguna. */
export const WITHHOLDING_TYPES = [
  { code: "pph23", label: "PPh 23" },
  { code: "pph42", label: "PPh 4(2)" },
] as const;

export type WithholdingInput = {
  type: string;
  /** Tarif persen yang dipakai pengguna (referensi bukti potong). */
  rate?: MoneyInput;
  /** Nominal final yang dipotong — inilah yang dijurnal. */
  amount: MoneyInput;
};

export type ResolvedWithholding = {
  type: string;
  /** Label tampil jenis potongan ("PPh 23" / "PPh 4(2)"). */
  label: string;
  rate: D | null;
  amount: D;
  /** Akun Utang PPh Dipotong terpetakan (dipastikan ada). */
  accountId: string;
};

/**
 * Validasi & resolusi potongan pajak satu pembayaran keluar.
 * Mengembalikan null bila tidak ada potongan. Penjaga D-25: fitur ini
 * ber-saklar per perusahaan (company_settings.withholding_enabled,
 * bawaan NONAKTIF) — potongan yang dipaksakan saat saklar mati
 * ditolak, bukan dibuang diam-diam.
 */
export async function resolveWithholding(
  tx: Tx,
  companyId: string,
  input: WithholdingInput | undefined,
  grossAmount: D,
): Promise<ResolvedWithholding | null> {
  if (!input) return null;
  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lt(0)) {
    throw new AppError("VALIDATION", "Nominal potongan pajak tidak boleh negatif.");
  }
  if (amount.eq(0)) return null;
  const settings = await getCompanySettingsRow(tx, companyId);
  if (!settings?.withholdingEnabled) {
    throw new AppError(
      "VALIDATION",
      "Potongan pajak (withholding) belum aktif untuk perusahaan ini. Aktifkan saklar potongan pajak di Pengaturan terlebih dahulu.",
    );
  }
  const known = WITHHOLDING_TYPES.find((row) => row.code === input.type);
  if (!known) {
    throw new AppError(
      "VALIDATION",
      `Jenis potongan "${input.type}" tidak dikenal. Pilihan: ${WITHHOLDING_TYPES.map((row) => row.label).join(", ")}.`,
    );
  }
  if (amount.gt(grossAmount)) {
    throw new AppError(
      "VALIDATION",
      `Potongan pajak ${amount.toFixed(0)} melebihi nominal pembayaran ${grossAmount.toFixed(0)}.`,
    );
  }
  const rate =
    input.rate !== undefined && input.rate !== null && input.rate !== "" ? d(input.rate) : null;
  if (rate !== null && (!rate.isFinite() || rate.lt(0) || rate.gt(100))) {
    throw new AppError("VALIDATION", "Tarif potongan pajak harus antara 0–100%.");
  }
  const map = await ensurePaymentDeductionAccounts(tx, companyId);
  return { type: known.code, label: known.label, rate, amount, accountId: map.tax_withholding_payable };
}

/**
 * Kebijakan penyelesaian pembayaran per perusahaan untuk permukaan
 * baca (ARS1-01): saklar withholding (R3-06) dan — ditambah R3-07 —
 * ambang write-off. Halaman memakai ini untuk memutuskan field/tombol
 * mana yang tampil; domain tetap penjaga terakhir.
 */
export async function getPaymentSettlementPolicy(tx: Tx, companyId: string) {
  const row = await getCompanySettingsRow(tx, companyId);
  return {
    withholdingEnabled: row?.withholdingEnabled ?? false,
    /** A-21 Tahap R3-A (R3-07): ambang write-off; "0" = fitur mati. */
    writeoffMaxAmount: row?.writeoffMaxAmount ?? "0",
  };
}
