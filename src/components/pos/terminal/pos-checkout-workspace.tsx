"use client";

import type { ComponentProps } from "react";
import { PauseCircle } from "lucide-react";
import { formatIDR } from "@/lib/money";
import { CartPanel } from "@/components/pos/cart-panel";
import { MobileCartHeader } from "@/components/pos/terminal/mobile-pay-bar";

type CartPanelProps = ComponentProps<typeof CartPanel>;

/**
 * Panel keranjang native: header tetap, daftar mengisi ruang, dan
 * footer Total + Bayar menempel di dasar kartu (pola Odoo POS).
 * Pembayaran baru muncul sebagai dialog setelah Bayar ditekan.
 */
export function PosCheckoutWorkspace({
  cartProps,
  onOpenPayment,
  onHold,
  quoteReady,
  quoteBusy,
  quoteError,
  mobile = false,
  onClose,
}: {
  cartProps: CartPanelProps;
  onOpenPayment: () => void;
  onHold: () => void;
  quoteReady: boolean;
  quoteBusy: boolean;
  quoteError: string | null;
  mobile?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {mobile ? (
        <MobileCartHeader
          count={cartProps.cart.length}
          onClose={onClose ?? (() => {})}
        />
      ) : null}
      <CartPanel
        {...cartProps}
        className="min-h-0 flex-1"
        scrollMode="contained"
        compactHeader={mobile}
        footer={
          <PaymentFooter
            total={cartProps.total}
            cartCount={cartProps.cart.length}
            quoteReady={quoteReady}
            quoteBusy={quoteBusy}
            quoteError={quoteError}
            onOpen={onOpenPayment}
            onHold={onHold}
          />
        }
      />
    </div>
  );
}

function PaymentFooter({
  cartCount,
  total,
  quoteReady,
  quoteBusy,
  quoteError,
  onOpen,
  onHold,
}: {
  cartCount: number;
  total: number;
  quoteReady: boolean;
  quoteBusy: boolean;
  quoteError: string | null;
  onOpen: () => void;
  onHold: () => void;
}) {
  const blocked = cartCount === 0 || quoteBusy || (!quoteReady && !quoteError);
  const label =
    cartCount === 0
      ? "Bayar"
      : quoteBusy
        ? "Menghitung…"
        : quoteError
          ? "Cek pembayaran"
          : `Bayar ${formatIDR(total)}`;
  return (
    <div className="shrink-0 border-t border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-3 py-2.5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--pos-muted)]">
            Total
          </p>
          <p className="text-xs text-[var(--pos-muted)]">{cartCount} item</p>
        </div>
        <p className="num shrink-0 text-[26px] font-extrabold leading-none tracking-tight text-[var(--pos-ink)]">
          {formatIDR(total)}
        </p>
      </div>
      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={blocked}
          className="flex h-14 items-center justify-center gap-2 rounded-md bg-[var(--pos-action)] text-base font-bold text-[var(--pos-action-fg)] transition-colors hover:bg-[var(--pos-action-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-stone-200 disabled:text-stone-600"
        >
          {label}
        </button>
        <button
          type="button"
          onClick={onHold}
          disabled={cartCount === 0}
          className="flex h-14 items-center justify-center gap-1.5 rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-3 text-sm font-semibold text-[var(--pos-ink)] transition-colors hover:bg-[var(--pos-tray)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Tahan pesanan"
        >
          <PauseCircle className="size-4" aria-hidden="true" />
          Tahan
        </button>
      </div>
    </div>
  );
}
