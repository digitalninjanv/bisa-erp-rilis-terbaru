/** POS catalog is only a lookup cache; the server remains the source of truth. */
export const POS_PRODUCT_CACHE_LIMIT = 1_200;

/**
 * Merge product lookups into an insertion-ordered LRU cache. Products in
 * the active cart and the just-returned page are pinned so quote, serial,
 * and offline receipt flows do not lose their product snapshots.
 */
export function mergeProductCache<T extends { id: string }>(
  current: Record<string, T>,
  updates: readonly T[],
  pinnedIds: readonly string[] = [],
  limit = POS_PRODUCT_CACHE_LIMIT,
): Record<string, T> {
  const next = new Map(Object.entries(current));
  const protectedIds = new Set(pinnedIds);

  for (const item of updates) {
    protectedIds.add(item.id);
    next.delete(item.id);
    next.set(item.id, item);
  }

  for (const id of pinnedIds) {
    const item = next.get(id);
    if (!item) continue;
    next.delete(id);
    next.set(id, item);
  }

  for (const id of next.keys()) {
    if (next.size <= limit) break;
    if (protectedIds.has(id)) continue;
    next.delete(id);
  }

  return Object.fromEntries(next);
}

/**
 * Pencocokan cepat barcode/kemasan/SKU terhadap katalog lokal di memori terminal.
 */
export function findLocalProductMatch<
  T extends {
    barcode: string | null;
    sku: string;
    packagings?: { id: string; barcode: string | null }[];
    matchedPackagingId?: string | null;
  },
>(pool: readonly T[], code: string): T | null {
  for (const p of pool) {
    if (p.barcode === code) return p;
    const matchedPkg = p.packagings?.find((pkg) => pkg.barcode === code);
    if (matchedPkg) {
      return { ...p, matchedPackagingId: matchedPkg.id };
    }
    if (p.sku === code) return p;
  }
  return null;
}
