"use client";

import { formatIDR } from "@/lib/money";
import { IDR_CASH_DENOMINATIONS } from "@/lib/pos/denominations";

/**
 * Tombol nominal cepat ala numpad Odoo: setiap tombol MENAMBAH nominal
 * yang sudah diterima, bukan menggantinya. Uang Pas mengisi tepat total;
 * Hapus mengosongkan isian.
 */
const QUICK_DENOMINATIONS = [5_000, 10_000, 20_000, 50_000, 100_000];

export function CashChips({
  total,
  tendered,
  disabled,
  onChange,
}: {
  total: number;
  tendered: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const chipClass =
    "inline-flex h-8 items-center justify-center rounded-md border border-border/80 bg-background px-2.5 text-[11px] font-medium transition-all hover:border-border hover:bg-muted active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      <button
        type="button"
        disabled={disabled || total <= 0}
        onClick={() => onChange(total)}
        className={`${chipClass} border-primary/30 bg-primary-soft/40 font-semibold text-primary hover:bg-primary-soft`}
      >
        Uang Pas
      </button>
      {QUICK_DENOMINATIONS.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(tendered + value)}
          className={chipClass}
          aria-label={`Tambah ${formatIDR(value)} ke uang diterima`}
        >
          +{formatIDR(value)}
        </button>
      ))}
      {tendered > 0 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(0)}
          className={`${chipClass} text-muted-foreground`}
        >
          Hapus
        </button>
      ) : null}
    </div>
  );
}

/**
 * Pecahan kembalian lengkap — tanpa ellipsis. Ditampilkan sebagai chip
 * kecil agar kasir bisa menyiapkan uang kembali persis.
 */
export function ChangeBreakdown({ amount }: { amount: number }) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  let remaining = Math.round(amount);
  const parts: { label: string }[] = [];
  for (const denom of IDR_CASH_DENOMINATIONS) {
    const count = Math.floor(remaining / denom);
    if (count <= 0) continue;
    parts.push({ label: `${count}× ${formatIDR(denom)}` });
    remaining -= count * denom;
  }
  if (parts.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium text-muted-foreground">Pecahan kembalian:</span>
      {parts.map((part) => (
        <span
          key={part.label}
          className="num rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {part.label}
        </span>
      ))}
    </div>
  );
}
