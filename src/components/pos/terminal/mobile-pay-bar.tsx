/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — bar total + Bayar tetap
 * di bawah layar kecil. JSX dipindah apa adanya dari terminal.
 */
"use client";

import { formatIDR } from "@/lib/money";
import type { CartItem } from "@/components/pos/terminal-types";

      /* POS2-04: di bawah lg panel bertumpuk — bar total + Bayar
          tetap menempel di bawah layar agar kasir tidak kehilangan
          konteks pembayaran saat memilih produk. Keadaan tombolnya
          sama persis dengan tombol Bayar panel (payDisabled/payLabel). */
export function MobilePayBar(props: {
  cart: CartItem[];
  total: number;
  payDisabled: boolean;
  payLabel: string;
  checkout: () => Promise<void>;
  onOpenCart: () => void;
  lastItemName?: string | null;
}) {
  const { cart, total, payDisabled, payLabel, checkout, onOpenCart, lastItemName = null } = props;
  return (
      <div className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t-2 border-border bg-[var(--pos-panel)] px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-[0_-8px_24px_-16px_rgba(9,9,11,0.25)] lg:hidden">
        <button
          type="button"
          onClick={onOpenCart}
          className="min-h-11 min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted"
          aria-label={`Buka keranjang, ${cart.length} baris`}
        >
          <p className="truncate text-xs font-semibold text-muted-foreground">
            {cart.length > 0
              ? `${lastItemName ?? "Keranjang"} · ${cart.length} baris`
              : "Keranjang · 0 baris"}
          </p>
          <p className="num truncate text-base font-bold text-foreground">{formatIDR(total)}</p>
        </button>
        <button
          type="button"
          onClick={checkout}
          disabled={payDisabled}
          className="flex h-12 min-w-28 shrink-0 items-center justify-center rounded-md bg-[var(--pos-action)] px-5 text-[15px] font-bold text-[var(--pos-action-fg)] shadow-sm transition-colors hover:bg-[var(--pos-action-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border disabled:border-zinc-400 disabled:bg-zinc-200 disabled:text-zinc-600 disabled:shadow-none disabled:opacity-100"
        >
          {payLabel}
        </button>
      </div>
  );
}

/** Header sheet keranjang mobile — dipisah agar pos-terminal tetap ≤800 baris. */
export function MobileCartHeader({
  count,
  total,
  onClose,
}: {
  count: number;
  total: number;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-3 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 backdrop-blur lg:hidden">
      <div>
      <h2 className="text-base font-semibold">Keranjang &amp; pembayaran</h2>
      <p className="text-sm text-muted-foreground">
          {count} baris · {formatIDR(total)}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-11 items-center rounded-md border border-border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Tutup keranjang"
      >
        Tutup
      </button>
    </div>
  );
}
