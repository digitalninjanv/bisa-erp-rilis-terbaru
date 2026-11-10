"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { QtyInput } from "@/components/qty-input";
import { formatQty } from "@/lib/money";
import {
  effectiveCountedQty,
  formatOpnameCountBreakdown,
  type OpnameCountRow,
} from "@/lib/gudang/opname-count";

/**
 * Editor hitungan per kemasan untuk satu baris opname. Disembunyikan
 * di balik tombol "Kemasan" agar baris tetap satu tingkat dan simetris;
 * hasil campuran (dus + slop + lepas) tetap dijumlahkan otomatis ke
 * satuan dasar oleh effectiveCountedQty.
 */
export function OpnamePackagingPopover({
  row,
  onChange,
  onClear,
}: {
  row: OpnameCountRow;
  onChange: (packagingId: string, value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const packagings = row.packagings ?? [];
  if (packagings.length === 0) return null;

  const total = effectiveCountedQty(row);
  const breakdown = formatOpnameCountBreakdown(row);
  const hasComponents = Object.values(row.components ?? {}).some(
    (value) => value.trim() !== "",
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Hitung kemasan ${row.name}`}
            title={breakdown ?? "Hitung per kemasan"}
            className={`grid size-7 shrink-0 place-items-center rounded-md border transition-colors ${
              hasComponents
                ? "border-primary/35 bg-primary/5 text-primary hover:bg-primary/10"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          />
        }
      >
        <Package className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3">
        <div>
          <p className="text-[11px] font-semibold">Hitung per kemasan</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{row.name}</p>
        </div>

        <div className="space-y-2 border-y border-border py-2.5">
          {packagings.map((pack) => (
            <label key={pack.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium">{pack.name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  isi {formatQty(pack.isi)} {row.unitName ?? "satuan dasar"}
                </span>
              </span>
              <QtyInput
                value={row.components?.[pack.id] ?? ""}
                onChange={(value) => onChange(pack.id, value)}
                min="0"
                placeholder="—"
                aria-label={`Hitungan ${pack.name} ${row.name}`}
                wrapperClassName="w-20 shrink-0"
                className="h-8 w-full rounded px-1.5 text-[12px]"
              />
            </label>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">Total fisik</span>
          <span className="num font-semibold">
            {total === null ? "—" : formatQty(total)}{" "}
            <span className="font-normal text-muted-foreground">
              {row.unitName ?? "satuan dasar"}
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasComponents}
            className="h-8 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
          >
            Kosongkan
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-8 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Selesai
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
