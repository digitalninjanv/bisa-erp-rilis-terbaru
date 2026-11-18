/** Program loyalitas sederhana: 1 poin per Rp10.000 penjualan lunas. */

export const DEFAULT_POINTS_PER_RUPIAH = 10_000;

export type LoyaltySale = { customerId: string | null; total: number | string };

export function loyaltyPointsForTotal(
  total: number | string,
  pointsPerRupiah = DEFAULT_POINTS_PER_RUPIAH,
): number {
  const amount = Number(total);
  if (!Number.isFinite(amount) || amount <= 0 || pointsPerRupiah <= 0) return 0;
  return Math.floor(amount / pointsPerRupiah);
}

/** Agregat poin per pelanggan dari penjualan (tanpa customer diabaikan). */
export function buildLoyaltyBalances(
  sales: LoyaltySale[],
  pointsPerRupiah = DEFAULT_POINTS_PER_RUPIAH,
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const sale of sales) {
    if (!sale.customerId) continue;
    const points = loyaltyPointsForTotal(sale.total, pointsPerRupiah);
    if (points > 0) balances.set(sale.customerId, (balances.get(sale.customerId) ?? 0) + points);
  }
  return balances;
}
