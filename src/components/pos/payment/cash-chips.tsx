"use client";

import { formatIDR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { IDR_CASH_DENOMINATIONS } from "@/lib/pos/denominations";

/**
 * Saran uang diterima dihitung dari total transaksi, bukan daftar
 * denominasi statis. Pola ini mengikuti quick-cash POS modern:
 * - Exact amount (Uang Pas)
 * - Pembulatan ke atas berikutnya (1k/5k/10k/20k/50k/100k)
 * Hanya nominal > total yang ditampilkan, sehingga kasir tidak melihat
 * saran yang tidak masuk akal. Untuk transaksi kecil, pembulatan 1k/5k
 * otomatis muncul; untuk transaksi besar, saran 20k/50k/100k.
 */
function cashSuggestions(total: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [1_000, 5_000, 10_000];
  const values: number[] = [];
  const add = (value: number) => {
    const rounded = Math.round(value);
    if (rounded > total && !values.includes(rounded)) values.push(rounded);
  };
  for (const step of [1_000, 5_000, 10_000, 20_000, 50_000, 100_000]) {
    add(Math.ceil(total / step) * step);
  }
  return values.slice(0, 3);
}

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
  const suggestions = cashSuggestions(total);
  const chipClass =
    "inline-flex h-11 items-center justify-center rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-1 text-xs font-bold text-[var(--pos-ink)] transition-colors hover:border-[var(--pos-command)] hover:bg-[var(--pos-tray)] active:scale-[0.98] disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-100 disabled:text-stone-500 disabled:opacity-100";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--pos-muted)]">
          Saran uang diterima
        </span>
        {tendered > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(0)}
            className="min-h-8 rounded px-2 text-xs font-semibold text-[var(--pos-muted)] underline-offset-2 hover:bg-[var(--pos-tray)] hover:text-[var(--pos-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] disabled:opacity-40"
          >
            Hapus
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          disabled={disabled || total <= 0}
          onClick={() => onChange(total)}
          className={cn(
            chipClass,
            "border-[var(--pos-action)] bg-[var(--pos-action-soft)] text-[var(--pos-action-text)] hover:border-[var(--pos-action)] hover:bg-[var(--pos-action-soft)]",
          )}
        >
          Uang Pas
        </button>
        {suggestions.map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled || total <= 0}
            onClick={() => onChange(value)}
            className={cn(
              chipClass,
              tendered === value &&
                "border-2 border-[var(--pos-action)] bg-[var(--pos-action-soft)] text-[var(--pos-action-text)]",
            )}
            aria-label={`Isi uang diterima ${formatIDR(value)}`}
          >
            {formatIDR(value)}
          </button>
        ))}
      </div>
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
