/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — hook rencana pembayaran
 * (simulasi campuran, dibayar/kembalian/sisa, gerbang utang &
 * konfirmasi non-tunai). Rumus kini tinggal di lib/pos/payment-plan agar
 * dapat diuji tanpa React; hook hanya mengikatnya ke useMemo.
 */
"use client";

import { useMemo } from "react";
import type { Method, PaymentEntry } from "@/components/pos/terminal-types";
import { computePaymentPlan } from "@/lib/pos/payment-plan";

export function usePaymentPlan(params: {
  mode: "single" | "mixed";
  entries: Record<string, PaymentEntry>;
  methodById: Map<string, Method>;
  total: number;
  singleMethod: string;
  single: Method | undefined;
  isCreditSingle: boolean;
  cashTendered: number;
  debtMethod: { id: string; name: string } | null;
}) {
  const {
    mode,
    entries,
    methodById,
    total,
    singleMethod,
    single,
    isCreditSingle,
    cashTendered,
    debtMethod,
  } = params;

  return useMemo(
    () =>
      computePaymentPlan({
        mode,
        entries,
        methodById,
        total,
        singleMethod,
        single,
        isCreditSingle,
        cashTendered,
        debtMethod,
      }),
    [
      mode,
      entries,
      methodById,
      total,
      singleMethod,
      single,
      isCreditSingle,
      cashTendered,
      debtMethod,
    ],
  );
}
