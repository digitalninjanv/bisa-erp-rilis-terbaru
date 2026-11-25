"use client";

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { clearStoredCart } from "@/components/pos/use-cart-persistence";
import type { CartItem } from "@/components/pos/terminal-types";
import type { QuoteResultPublic } from "@/server/pos";

/**
 * Satu pintu mulai transaksi baru: keranjang, pelanggan, pembayaran,
 * kelompok harga, tautan tahanan, dan reservasi tidak boleh tertinggal.
 */
export function useNewSaleReset(params: {
  storageKey: string;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  resetNewSaleContext: () => void;
  setGroupId: Dispatch<SetStateAction<string>>;
  setHeldSaleId: Dispatch<SetStateAction<string | null>>;
  setHeldTotal: Dispatch<SetStateAction<number | null>>;
  setReservationId: Dispatch<SetStateAction<string | null>>;
  setQuoteResult: Dispatch<SetStateAction<{ signature: string; data: QuoteResultPublic } | null>>;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const {
    storageKey,
    setCart,
    resetNewSaleContext,
    setGroupId,
    setHeldSaleId,
    setHeldTotal,
    setReservationId,
    setQuoteResult,
    searchRef,
  } = params;

  return useCallback(() => {
    clearStoredCart(storageKey);
    setCart([]);
    resetNewSaleContext();
    setGroupId("");
    setHeldSaleId(null);
    setHeldTotal(null);
    setReservationId(null);
    setQuoteResult(null);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [
    storageKey,
    resetNewSaleContext,
    setCart,
    setGroupId,
    setHeldSaleId,
    setHeldTotal,
    setReservationId,
    setQuoteResult,
    searchRef,
  ]);
}
