import Decimal from "decimal.js";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export const D = Decimal;
export type D = Decimal;

export type MoneyInput = string | number | Decimal | null | undefined;

export function d(value: MoneyInput): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

/** Canonical database representation: 4 decimal places, string. */
export function toDb(value: MoneyInput): string {
  return d(value).toFixed(4);
}

/** User-facing integer rupiah, no decimals (ERP amounts are stored with 4 dp). */
export function formatIDR(value: MoneyInput, opts?: { withSymbol?: boolean }): string {
  const amount = d(value);
  const formatter = new Intl.NumberFormat("id-ID", {
    style: opts?.withSymbol === false ? "decimal" : "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return formatter.format(amount.toNumber());
}

/**
 * CT-15 — signed display variant for financial statements. Identical to
 * formatIDR except that a value which ROUNDS to zero is normalized to
 * "Rp 0": a credit-normal balance of exactly zero used to print as
 * "− Rp 0" all over the trial balance, which reads as an error on an
 * official document. Genuine negatives keep their minus sign.
 */
export function formatIDRSigned(value: MoneyInput): string {
  const rounded = d(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (rounded.isZero()) return formatIDR(0);
  return formatIDR(value);
}

/**
 * FIX-R2 Tahap 1 (RD2-04/RD2-11) — formatter khusus badan laporan
 * keuangan formal. Berbeda dari formatIDR (yang dipakai POS/nota dan
 * TIDAK diubah): negatif tampil dalam kurung akuntansi `(Rp 1.234)`,
 * bukan tanda minus, sesuai konvensi penyajian laporan Indonesia.
 * - `symbol: false` menekan "Rp" — konvensi cetak: simbol hanya pada
 *   baris pertama kelompok dan pada subtotal/totalnya.
 * - `zeroDash: true` mengganti nol dengan strip "—" (konvensi dokumen
 *   resmi untuk nihil). Layar memakai bawaan (nol eksplisit "Rp 0")
 *   agar angka nol tetap terbaca sebagai angka, bukan sel kosong.
 * Pembulatan sama dengan formatIDR: bulat penuh, setengah ke atas.
 */
export function formatIDRReport(
  value: MoneyInput,
  opts?: { symbol?: boolean; zeroDash?: boolean },
): string {
  const symbol = opts?.symbol !== false;
  const rounded = d(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (rounded.isZero()) {
    if (opts?.zeroDash) return "—";
    return symbol ? formatIDR(0) : "0";
  }
  // Positive-with-symbol output is byte-identical to formatIDR (same
  // Intl currency rendering, NBSP included) — only the negative
  // presentation differs.
  const body = symbol
    ? formatIDR(rounded.abs())
    : new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(rounded.abs().toNumber());
  return rounded.isNegative() ? `(${body})` : body;
}

export function formatNumber(value: MoneyInput, digits = 0): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(d(value).toNumber());
}

export function formatQty(value: MoneyInput): string {
  const n = d(value);
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(n.toNumber());
}

export type RoundingMode =
  | "none"
  | "nearest_100"
  | "nearest_500"
  | "nearest_1000"
  | "up_500"
  | "up_1000";

export type RoundDirection = "down" | "up" | "nearest";

/** Round a positive amount to an arbitrary step in a given direction. */
export function roundTo(
  value: MoneyInput,
  step: MoneyInput,
  direction: RoundDirection = "nearest",
): Decimal {
  const amount = d(value);
  const size = d(step);
  if (size.lte(0)) return amount;
  const units = amount.div(size);
  const roundedUnits =
    direction === "down"
      ? units.floor()
      : direction === "up"
        ? units.ceil()
        : units.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return roundedUnits.mul(size);
}

export function roundTotal(value: MoneyInput, mode: RoundingMode): {
  rounded: Decimal;
  adjustment: Decimal;
} {
  const total = d(value);
  const step =
    mode === "nearest_100"
      ? 100
      : mode === "nearest_500" || mode === "up_500"
        ? 500
        : mode === "nearest_1000" || mode === "up_1000"
          ? 1000
          : 0;

  if (step === 0) return { rounded: total, adjustment: new Decimal(0) };

  let rounded: Decimal;
  if (mode === "up_500" || mode === "up_1000") {
    rounded = total.div(step).ceil().mul(step);
  } else {
    rounded = total.div(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(step);
  }
  return { rounded, adjustment: rounded.minus(total) };
}

export type DiscountType = "percent" | "nominal";

export function lineDiscount(args: {
  qty: MoneyInput;
  unitPrice: MoneyInput;
  type?: DiscountType | null;
  value?: MoneyInput;
}): Decimal {
  const gross = d(args.qty).mul(d(args.unitPrice));
  const value = d(args.value);
  if (!args.type || value.lte(0)) return new Decimal(0);

  const amount =
    args.type === "percent"
      ? gross.mul(value).div(100)
      : value.mul(d(args.qty));

  return Decimal.min(Decimal.max(amount, 0), gross);
}

/**
 * Potongan baris dokumen pembelian: nominal `value` adalah TOTAL
 * potongan baris, bukan potongan per unit seperti `lineDiscount` POS.
 * Tidak dijepit — domain penerimaan menolak potongan melebihi bruto.
 */
export function receiptLineDiscount(
  gross: MoneyInput,
  type?: DiscountType | null,
  value?: MoneyInput,
): Decimal {
  const total = d(gross);
  const amount = d(value);
  if (!type || amount.lte(0) || total.lte(0)) return new Decimal(0);
  if (type === "percent") return total.mul(amount).div(100);
  return new Decimal(amount);
}

export function lineTax(args: {
  net: MoneyInput;
  rate: MoneyInput;
  inclusive?: boolean;
}): Decimal {
  const net = d(args.net);
  const rate = d(args.rate);
  if (rate.lte(0)) return new Decimal(0);
  if (args.inclusive === false) return net.mul(rate).div(100);
  return net.mul(rate).div(d(100).plus(rate));
}

export function sum(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Decimal(0));
}

/** Number of units available for sale, floored to a whole unit. */
export function floorQty(value: MoneyInput): number {
  return d(value).toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber();
}
