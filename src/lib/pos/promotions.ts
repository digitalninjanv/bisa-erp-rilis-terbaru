/** Engine promosi POS desktop — murni, tanpa React/Tauri/DB.
 *
 * Aturan diskon diwujudkan sebagai diskon BARIS sehingga server POS
 * tetap menghitung ulang (otoritatif) saat sinkronisasi. Promo tidak
 * pernah menimpa diskon manual kasir.
 */

export type PromotionRule = {
  id: string;
  name: string;
  type: "percent" | "nominal";
  value: number;
  minSubtotal: number;
  productId: string | null;
};

export type PromotionLine = {
  productId: string;
  qty: number;
  unitPrice: number;
  discountType: "percent" | "nominal" | null;
  discountValue: number;
};

export function lineGross(line: PromotionLine): number {
  return line.qty * line.unitPrice;
}

export function eligiblePromotions(lines: PromotionLine[], rules: PromotionRule[]): PromotionRule[] {
  const subtotal = lines.reduce((sum, line) => sum + lineGross(line), 0);
  return rules.filter((rule) => {
    if (subtotal < rule.minSubtotal) return false;
    if (rule.productId && !lines.some((line) => line.productId === rule.productId)) return false;
    return lines.some((line) => promotionDiscountForLine(line, rule) !== null);
  });
}

/** Diskon baris yang dihasilkan promo, atau null bila tidak boleh diterapkan. */
export function promotionDiscountForLine(
  line: PromotionLine,
  rule: PromotionRule,
): { discountType: "percent" | "nominal"; discountValue: number } | null {
  if (line.discountType) return null;
  if (rule.productId && rule.productId !== line.productId) return null;
  const gross = lineGross(line);
  if (gross <= 0 || rule.value <= 0) return null;
  if (rule.type === "percent") {
    const value = Math.min(100, rule.value);
    return value > 0 ? { discountType: "percent", discountValue: value } : null;
  }
  // Diskon nominal POS adalah potongan PER UNIT (lihat money.lineDiscount).
  return { discountType: "nominal", discountValue: Math.min(rule.value, line.unitPrice) };
}
