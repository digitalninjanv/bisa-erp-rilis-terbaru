/**
 * A-26 Q7 (K-07): pecahan `payment-panel.tsx` per bagian panel
 * pembayaran. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya (pola ARS2-01).
 */
"use client";

import { formatIDR } from "@/lib/money";

const CASH_CHIPS = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000];

/** POS-1: chip uang diterima cepat untuk metode tunai (standar ergonomi kasir cepat). */
export function CashChips({
  pasValue,
  disabled,
  onPick,
}: {
  pasValue: number;
  disabled: boolean;
  onPick: (value: number) => void;
}) {
  // Ergonomi modern: tombol sentuh nyaman (h-7/28px), font-medium 11px/12px, border halus
  const chipClass =
    "inline-flex items-center justify-center rounded-md border border-border/80 bg-background px-2.5 py-1 text-[11px] font-medium transition-all hover:bg-muted hover:border-border active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs";
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      <button
        type="button"
        disabled={disabled || pasValue <= 0}
        onClick={() => onPick(pasValue)}
        className={`${chipClass} font-semibold text-primary border-primary/30 bg-primary-soft/40 hover:bg-primary-soft`}
      >
        Uang Pas
      </button>
      {CASH_CHIPS.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(value)}
          className={chipClass}
        >
          {formatIDR(value)}
        </button>
      ))}
    </div>
  );
}
