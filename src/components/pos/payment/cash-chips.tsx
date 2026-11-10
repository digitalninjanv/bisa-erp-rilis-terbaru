/**
 * A-26 Q7 (K-07): pecahan `payment-panel.tsx` per bagian panel
 * pembayaran. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya (pola ARS2-01).
 */
"use client";

import { formatIDR } from "@/lib/money";

const CASH_CHIPS = [10_000, 20_000, 50_000, 100_000];

/** POS-1: chip uang diterima cepat untuk metode tunai. */
export function CashChips({
  pasValue,
  disabled,
  onPick,
}: {
  pasValue: number;
  disabled: boolean;
  onPick: (value: number) => void;
}) {
  // POS2-13/22: chip uang adalah kontrol berulang kasir — teks 11px
  // dan area sentuh lebih tinggi dari chip lama (±21px).
  const chipClass =
    "rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        disabled={disabled || pasValue <= 0}
        onClick={() => onPick(pasValue)}
        className={chipClass}
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
