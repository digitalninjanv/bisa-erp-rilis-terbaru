"use client";

import { formatIDR } from "@/lib/money";
import { formatMoneyText } from "@/lib/money-input";
import { IDR_CASH_DENOMINATIONS } from "@/lib/pos/denominations";

/**
 * Tombol nominal cepat ala numpad Odoo: setiap tombol MENAMBAH nominal
 * yang sudah diterima, bukan menggantinya. Uang Pas mengisi tepat total;
 * Hapus mengosongkan isian. Nominal kecil (100/500/1.000) ikut tampil
 * untuk toko dengan harga eceran rendah.
 */
const QUICK_DENOMINATIONS = [100, 500, 1_000, 5_000, 10_000, 20_000, 50_000, 100_000];

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
    "inline-flex h-11 items-center justify-center rounded-md border border-border/80 bg-background px-1 text-xs font-semibold transition-colors hover:border-border hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="grid grid-cols-5 gap-1.5 pt-1 pb-1">
      <button
        type="button"
        disabled={disabled || total <= 0}
        onClick={() => onChange(total)}
        className={`${chipClass} border-primary/50 bg-primary-soft/40 text-primary hover:bg-primary-soft`}
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
          +{formatMoneyText(String(value))}
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
      <span className="text-xs font-medium text-muted-foreground">Pecahan kembalian:</span>
      {parts.map((part) => (
        <span
          key={part.label}
          className="num rounded bg-muted px-2 py-1 text-xs text-foreground"
        >
          {part.label}
        </span>
      ))}
    </div>
  );
}
