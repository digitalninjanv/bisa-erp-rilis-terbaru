import { Decimal, d, type MoneyInput } from "@/lib/money";

/**
 * Margin kotor berbasis harga jual: (jual − pokok) / jual × 100.
 * Null bila harga jual ≤ 0 (tidak ada basis margin).
 */
export function marginPercent(cost: MoneyInput, sale: MoneyInput): number | null {
  const saleValue = d(sale);
  if (!saleValue.isFinite() || saleValue.lte(0)) return null;
  const costValue = d(cost);
  if (!costValue.isFinite()) return null;
  return saleValue.minus(costValue).div(saleValue).mul(100).toDecimalPlaces(2).toNumber();
}

/**
 * Harga jual yang menghasilkan target margin tertentu.
 * target 0–99.99 (persen). Null bila input tidak masuk akal.
 */
export function priceForMargin(cost: MoneyInput, targetPercent: MoneyInput): string | null {
  const costValue = d(cost);
  const target = d(targetPercent);
  if (!costValue.isFinite() || costValue.lt(0)) return null;
  if (!target.isFinite() || target.lt(0) || target.gte(100)) return null;
  const sale = costValue.div(d(1).minus(target.div(100)));
  if (!sale.isFinite() || sale.lte(0)) return null;
  return sale.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Nada tampilan margin: sehat ≥ 20%, tipis 5–20%, tidak sehat < 5%. */
export function marginTone(percent: number | null): "green" | "amber" | "red" | "muted" {
  if (percent === null) return "muted";
  if (percent >= 20) return "green";
  if (percent >= 5) return "amber";
  return "red";
}

export function marginToneClass(percent: number | null): string {
  switch (marginTone(percent)) {
    case "green":
      return "text-tone-green";
    case "amber":
      return "text-tone-amber";
    case "red":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export function marginToneDot(percent: number | null): string {
  switch (marginTone(percent)) {
    case "green":
      return "bg-tone-green";
    case "amber":
      return "bg-tone-amber";
    case "red":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

/** Format persen id-ID dengan satu desimal bila perlu. */
export function formatMargin(percent: number | null): string {
  if (percent === null) return "—";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(percent)}%`;
}
