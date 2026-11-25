"use client";

import { formatIDR } from "@/lib/money";

/** Status tombol Bayar terminal — satu sumber label/gerbang yang konsisten. */
export function terminalPayState(input: {
  cartLoaded: boolean;
  pendingCheckout: unknown;
  recoveryError: unknown;
  submitting: boolean;
  cartCount: number;
  sessionOpen: boolean;
  quote: unknown;
  quoting: boolean;
  quoteError: string | null;
  quoteBusy: boolean;
  nonCashNeedsConfirm: boolean;
  nonCashConfirmed: boolean;
  hasCashUnderpay: boolean;
  cashShortfall: number;
  mixedShortfall: boolean;
  outstanding: number;
  total: number;
  serialIncomplete: boolean;
}) {
  const payDisabled =
    !input.cartLoaded ||
    Boolean(input.pendingCheckout) ||
    Boolean(input.recoveryError) ||
    input.submitting ||
    input.cartCount === 0 ||
    !input.sessionOpen ||
    input.quote === null ||
    input.quoting ||
    input.quoteError !== null ||
    (input.nonCashNeedsConfirm && !input.nonCashConfirmed) ||
    input.hasCashUnderpay ||
    input.mixedShortfall;

  const payLabel = input.submitting
    ? "Menyimpan…"
    : input.cartCount === 0
      ? "Bayar"
      : input.serialIncomplete
        ? "Lengkapi nomor seri"
        : input.quoteError
          ? "Perhitungan gagal"
          : input.quoteBusy
            ? "Menghitung…"
            : input.hasCashUnderpay
              ? `Uang diterima kurang ${formatIDR(input.cashShortfall)}`
              : input.mixedShortfall
                ? `Bayar — sisa ${formatIDR(input.outstanding)}`
                : `Bayar ${formatIDR(input.total)}`;

  return { payDisabled, payLabel };
}
