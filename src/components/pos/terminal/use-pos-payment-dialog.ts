"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/** State dialog pembayaran fokus + penutupan otomatis setelah keranjang kosong. */
export function usePosPaymentDialog({
  cartCount,
  setMobileCartOpen,
}: {
  cartCount: number;
  setMobileCartOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const [paymentOpen, setPaymentOpen] = useState(false);

  const openPayment = useCallback(() => {
    if (cartCount === 0) return;
    setMobileCartOpen(false);
    setPaymentOpen(true);
  }, [cartCount, setMobileCartOpen]);

  return { paymentOpen, setPaymentOpen, openPayment };
}
