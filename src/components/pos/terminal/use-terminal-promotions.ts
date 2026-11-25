import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  eligiblePromotions,
  promotionDiscountForLine,
  type PromotionRule,
} from "@/lib/pos/promotions";
import {
  cartLineBaseQty,
  cartLineKey,
  type CartItem,
  type ProductOption,
} from "@/components/pos/terminal-types";
import type { QuoteResultPublic } from "@/server/pos";

type QuoteLineFn = (
  productId: string,
  packagingId?: string | null,
) => QuoteResultPublic["lines"][number] | null;

export function useTerminalPromotions(params: {
  promotions: PromotionRule[];
  cart: CartItem[];
  cache: Record<string, ProductOption>;
  quoteLine: QuoteLineFn;
  setLineDiscount: (key: string, type: "percent" | "nominal" | null, value: number) => void;
}) {
  const { promotions, cart, cache, quoteLine, setLineDiscount } = params;

  const availablePromotions = useMemo(() => {
    if (promotions.length === 0 || cart.length === 0) return [];
    const promotionLines = cart.map((line) => {
      const cached = cache[line.productId];
      const qLine = quoteLine(line.productId, line.packagingId);
      return {
        productId: line.productId,
        qty: cartLineBaseQty(line, cached),
        unitPrice: qLine ? qLine.groupUnitPrice : Number(cached?.salePrice ?? 0),
        discountType: line.discountType ?? null,
        discountValue: line.discountValue ?? 0,
      };
    });
    return eligiblePromotions(promotionLines, promotions);
  }, [promotions, cart, cache, quoteLine]);

  const applyPromotion = useCallback(
    (promo: PromotionRule) => {
      let applied = 0;
      for (const item of cart) {
        const cached = cache[item.productId];
        const qLine = quoteLine(item.productId, item.packagingId);
        const disc = promotionDiscountForLine(
          {
            productId: item.productId,
            qty: cartLineBaseQty(item, cached),
            unitPrice: qLine ? qLine.groupUnitPrice : Number(cached?.salePrice ?? 0),
            discountType: item.discountType ?? null,
            discountValue: item.discountValue ?? 0,
          },
          promo,
        );
        if (!disc) continue;
        setLineDiscount(cartLineKey(item), disc.discountType, disc.discountValue);
        applied += 1;
      }
      if (applied > 0) {
        toast.success(`Promo "${promo.name}" diterapkan ke ${applied} baris.`);
      }
    },
    [cart, cache, quoteLine, setLineDiscount],
  );

  return { availablePromotions, applyPromotion };
}
