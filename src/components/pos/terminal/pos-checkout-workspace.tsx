"use client";

import type { ComponentProps } from "react";
import { formatIDR } from "@/lib/money";
import { CartPanel } from "@/components/pos/cart-panel";
import { MobileCartHeader } from "@/components/pos/terminal/mobile-pay-bar";

type CartPanelProps = ComponentProps<typeof CartPanel>;

/**
 * Panel keranjang yang dipakai ulang untuk desktop dan sheet mobile.
 * Pembayaran tidak lagi menetap di kolom ini: kasir menekan Bayar dan
 * panel pembayaran fokus muncul sebagai dialog (pola Accurate/POS).
 */
export function PosCheckoutWorkspace({
  cartProps,
  onOpenPayment,
  quoteReady,
  quoteBusy,
  quoteError,
  mobile = false,
  onClose,
}: {
  cartProps: CartPanelProps;
  onOpenPayment: () => void;
  quoteReady: boolean;
  quoteBusy: boolean;
  quoteError: string | null;
  mobile?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex min-h-full min-w-0 flex-col gap-3">
      {mobile ? (
        <MobileCartHeader
          count={cartProps.cart.length}
          total={cartProps.total}
          onClose={onClose ?? (() => {})}
        />
      ) : null}
      <CartPanel {...cartProps} scrollMode="contained" compactHeader={mobile} />
      <PaymentLaunchBar
        cartCount={cartProps.cart.length}
        total={cartProps.total}
        quoteReady={quoteReady}
        quoteBusy={quoteBusy}
        quoteError={quoteError}
        onOpen={onOpenPayment}
      />
    </div>
  );
}

function PaymentLaunchBar({
  cartCount,
  total,
  quoteReady,
  quoteBusy,
  quoteError,
  onOpen,
}: {
  cartCount: number;
  total: number;
  quoteReady: boolean;
  quoteBusy: boolean;
  quoteError: string | null;
  onOpen: () => void;
}) {
  if (cartCount === 0) return null;
  const blocked = quoteBusy || (!quoteReady && !quoteError);
  const label = quoteBusy
    ? "Menghitung…"
    : quoteError
      ? "Cek pembayaran"
      : `Bayar ${formatIDR(total)}`;
  return (
    <div className="sticky bottom-0 z-10 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] p-2.5 shadow-[0_-8px_24px_-18px_rgb(28_25_23/0.45)]">
      <button
        type="button"
        onClick={onOpen}
        disabled={blocked}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-[var(--pos-action)] text-base font-bold text-[var(--pos-action-fg)] transition-colors hover:bg-[var(--pos-action-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-stone-200 disabled:text-stone-600"
      >
        {label}
      </button>
    </div>
  );
}
