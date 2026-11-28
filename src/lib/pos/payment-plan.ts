/**
 * Rencana pembayaran POS murni — dipakai hook terminal dan dapat diuji tanpa
 * React. Cermin alokasi server: pembayaran diterapkan berurutan ke sisa
 * tagihan, dan kembalian hanya berasal dari kelebihan tunai.
 */
export type PaymentPlanMethod = {
  id: string;
  name: string;
  /** Opsional untuk debtMethod yang hanya membawa id/nama. */
  type?: string;
};

export type PaymentPlanEntry = {
  amount: string;
  tendered: string;
  reference?: string;
  fee?: string;
};

export type PaymentPlanInput = {
  mode: "single" | "mixed";
  entries: Record<string, PaymentPlanEntry>;
  methodById: ReadonlyMap<string, PaymentPlanMethod>;
  total: number;
  singleMethod: string;
  single: PaymentPlanMethod | undefined;
  isCreditSingle: boolean;
  cashTendered: number;
  debtMethod?: PaymentPlanMethod | null;
};

export type PaymentPlan = {
  mixedPlan: { appliedTotal: number; changeTotal: number; overpaid: string[] };
  paidAmount: number;
  change: number;
  outstanding: number;
  mixedShortfall: boolean;
  cashShortfall: number;
  hasCashUnderpay: boolean;
  debtEntryAmount: number;
  debtActive: boolean;
  debtAmount: number;
  nonCashNeedsConfirm: boolean;
};

export function computePaymentPlan(input: PaymentPlanInput): PaymentPlan {
  const {
    mode,
    entries,
    methodById,
    total,
    singleMethod,
    single,
    isCreditSingle,
    cashTendered,
    debtMethod = null,
  } = input;

  let remaining = total;
  let appliedTotal = 0;
  let changeTotal = 0;
  let mixedCashShortfall = 0;
  const overpaid: string[] = [];

  if (mode === "mixed") {
    for (const [methodId, entry] of Object.entries(entries)) {
      const amount = Number(entry.amount || 0);
      if (!(amount > 0)) continue;
      const method = methodById.get(methodId);
      if (!method) continue;
      const applied = Math.min(amount, remaining);
      appliedTotal += applied;
      if (method.type === "cash") {
        const rawTendered = Number(entry.tendered || amount);
        const tendered = Number.isFinite(rawTendered) ? rawTendered : amount;
        if (tendered < applied) {
          mixedCashShortfall += applied - tendered;
        }
        changeTotal += Math.max(0, tendered - applied);
      } else if (method.type !== "credit" && amount > remaining) {
        overpaid.push(method.name);
      }
      remaining -= applied;
    }
  }

  const paidAmount =
    mode === "single"
      ? isCreditSingle
        ? total
        : Math.min(Number(entries[singleMethod]?.amount || total), total)
      : appliedTotal;

  const change =
    mode === "single"
      ? single?.type === "cash" && Number.isFinite(cashTendered)
        ? Math.max(0, cashTendered - total)
        : 0
      : changeTotal;

  const outstanding = Math.max(0, total - paidAmount);

  const mixedShortfall =
    mode === "mixed" &&
    outstanding > 0 &&
    !Object.entries(entries).some(
      ([methodId, entry]) =>
        Number(entry.amount) > 0 && methodById.get(methodId)?.type === "credit",
    );

  const singleCashShortfall =
    mode === "single" &&
    single?.type === "cash" &&
    Number.isFinite(cashTendered) &&
    cashTendered > 0 &&
    cashTendered < total
      ? total - cashTendered
      : 0;
  const cashShortfall = Math.max(singleCashShortfall, mixedCashShortfall);

  const debtEntryAmount = debtMethod ? Number(entries[debtMethod.id]?.amount ?? 0) : 0;
  const debtActive = Boolean(
    debtMethod &&
      ((mode === "single" && isCreditSingle) || (mode === "mixed" && debtEntryAmount > 0)),
  );
  const debtAmount = !debtActive
    ? 0
    : mode === "single"
      ? total
      : Math.min(debtEntryAmount, total) + outstanding;

  const nonCashNeedsConfirm = Boolean(
    mode === "single" && single && single.type !== "cash" && single.type !== "credit",
  );

  return {
    mixedPlan: { appliedTotal, changeTotal, overpaid },
    paidAmount,
    change,
    outstanding,
    mixedShortfall,
    cashShortfall,
    hasCashUnderpay: cashShortfall > 0.004,
    debtEntryAmount,
    debtActive,
    debtAmount,
    nonCashNeedsConfirm,
  };
}

/**
 * Validasi nominal tunai yang eksplisit. Kolom kosong tidak boleh
 * diam-diam diperlakukan sebagai uang pas: kasir harus mengetik nominal
 * atau menekan chip "Uang Pas" yang mengisi total.
 */
export function cashTenderError(input: {
  total: number;
  tendered: number;
  isCash: boolean;
}): string | null {
  if (!input.isCash || input.total <= 0) return null;
  if (!Number.isFinite(input.tendered) || input.tendered <= 0) {
    return "Isi uang diterima atau tekan Uang Pas sebelum memproses pembayaran.";
  }
  if (input.tendered < input.total) {
    return `Uang diterima kurang ${Math.round(input.total - input.tendered)}.`;
  }
  return null;
}
