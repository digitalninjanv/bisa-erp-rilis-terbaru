"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { defaultDueDate } from "@/components/pos/terminal/use-terminal-checkout";
import type { CustomerOption, PaymentEntry } from "@/components/pos/terminal-types";

/**
 * Reset konteks transaksi POS: pembayaran, pelanggan, dan jatuh tempo.
 * Dipisah dari PosTerminal agar komposisi terminal tetap di bawah
 * ratchet 800 baris dan alur reset dipakai ulang oleh hold/resume.
 */
export function useTerminalReset(params: {
  setEntries: Dispatch<SetStateAction<Record<string, PaymentEntry>>>;
  setNonCashConfirmedFor: Dispatch<SetStateAction<{ methodId: string; total: number } | null>>;
  setCustomer: Dispatch<SetStateAction<CustomerOption | null>>;
  setCustomerQuery: Dispatch<SetStateAction<string>>;
  setCustomerResults: Dispatch<SetStateAction<CustomerOption[]>>;
  setDueDate: Dispatch<SetStateAction<string>>;
  receivableDefaultTermDays: number;
}) {
  const {
    setEntries,
    setNonCashConfirmedFor,
    setCustomer,
    setCustomerQuery,
    setCustomerResults,
    setDueDate,
    receivableDefaultTermDays,
  } = params;

  const resetPaymentInputs = useCallback(() => {
    setEntries({});
    setNonCashConfirmedFor(null);
  }, [setEntries, setNonCashConfirmedFor]);

  const resetNewSaleContext = useCallback(() => {
    setCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setDueDate(defaultDueDate(receivableDefaultTermDays));
    resetPaymentInputs();
  }, [
    receivableDefaultTermDays,
    resetPaymentInputs,
    setCustomer,
    setCustomerQuery,
    setCustomerResults,
    setDueDate,
  ]);

  return { resetPaymentInputs, resetNewSaleContext };
}
