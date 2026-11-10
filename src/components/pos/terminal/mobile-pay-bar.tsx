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
}) {
  const { cart, total, payDisabled, payLabel, checkout } = props;
  return (
      <div className="no-print fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card px-3 py-2 shadow-lg lg:hidden">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {cart.length} item
          </p>
          <p className="num truncate text-[15px] font-semibold">{formatIDR(total)}</p>
        </div>
        <button
          type="button"
          onClick={checkout}
          disabled={payDisabled}
          className="flex h-11 shrink-0 items-center justify-center rounded-md bg-tone-teal px-5 text-sm font-semibold text-white transition-colors hover:bg-tone-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {payLabel}
        </button>
      </div>
  );
}
