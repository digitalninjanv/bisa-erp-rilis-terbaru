/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — bar total + Bayar tetap
 * di bawah layar kecil. JSX dipindah apa adanya dari terminal.
 */
"use client";

import { PauseCircle } from "lucide-react";
import { formatIDR } from "@/lib/money";
import type { CartItem } from "@/components/pos/terminal-types";

      /* POS2-04: di bawah lg panel bertumpuk — bar total + Bayar
          tetap menempel di bawah layar. Bayar kini membuka dialog
          pembayaran fokus, bukan langsung menyelesaikan transaksi. */
export function MobilePayBar(props: {
  cart: CartItem[];
  total: number;
  onOpenPayment: () => void;
  onHold: () => void;
  onOpenCart: () => void;
  lastItemName?: string | null;
}) {
  const { cart, total, onOpenPayment, onHold, onOpenCart, lastItemName = null } = props;
  return (
      <div className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t-2 border-black/20 bg-[var(--pos-command)] px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-[var(--pos-command-fg)] shadow-[0_-8px_24px_-16px_rgba(9,9,11,0.45)] lg:hidden">
        <button
          type="button"
          onClick={onOpenCart}
          title="Buka keranjang"
          className="min-h-11 min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/10"
        >
          <p className="truncate text-xs font-semibold text-[var(--pos-command-muted)]">
            {cart.length > 0
              ? `${lastItemName ?? "Keranjang"} · ${cart.length} baris`
              : "Keranjang · 0 baris"}
          </p>
          <p className="num truncate text-lg font-extrabold text-[var(--pos-gold-soft)]">{formatIDR(total)}</p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onHold}
            disabled={cart.length === 0}
            aria-label="Tahan pesanan"
            title="Tahan pesanan"
            className="grid size-14 place-items-center rounded-md border border-white/25 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PauseCircle className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpenPayment}
            disabled={cart.length === 0}
            className="flex h-14 min-w-28 shrink-0 items-center justify-center rounded-md bg-[var(--pos-gold)] px-5 text-[15px] font-bold text-[var(--pos-gold-ink)] shadow-sm transition-colors hover:bg-[var(--pos-gold-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pos-command)] disabled:cursor-not-allowed disabled:border disabled:border-white/20 disabled:bg-white/15 disabled:text-white/60 disabled:shadow-none disabled:opacity-100"
          >
            {cart.length > 0 ? `Bayar ${formatIDR(total)}` : "Bayar"}
          </button>
        </div>
      </div>
  );
}

/** Header sheet keranjang mobile — dipisah agar pos-terminal tetap ≤800 baris. */
export function MobileCartHeader({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-3 flex items-center justify-between gap-2 border-b border-black/20 bg-[var(--pos-command)] px-4 py-3 text-[var(--pos-command-fg)] lg:hidden">
      <div>
      <h2 className="text-base font-bold">Keranjang</h2>
      <p className="num text-sm text-[var(--pos-gold-soft)]">
          {count} baris
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-11 items-center rounded-md border border-white/30 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
        aria-label="Tutup keranjang"
      >
        Tutup
      </button>
    </div>
  );
}
