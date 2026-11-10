"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatIDR } from "@/lib/money";
import { formatMargin, marginPercent, priceForMargin } from "@/lib/margin";

/**
 * Editor harga jual opsional dari target margin. Disembunyikan di
 * balik ikon persen agar baris penerimaan tetap satu baris dan tidak
 * dipenuhi input.
 */
export function MarginPopover({
  cost,
  salePrice,
  unitLabel,
  onApply,
}: {
  cost: string;
  salePrice: string;
  unitLabel: string;
  onApply: (salePrice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const preview = priceForMargin(cost, target);
  const previewMargin = preview ? marginPercent(cost, preview) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Hitung harga jual dari target margin"
            title="Hitung dari target margin"
            className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        }
      >
        <Pencil className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div>
          <p className="text-[11px] font-semibold">Hitung dari target margin</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            HPP {formatIDR(cost)} / {unitLabel} · harga jual sekarang{" "}
            {formatIDR(salePrice || 0)}
          </p>
        </div>
        <label className="flex items-center justify-between gap-2 text-[11px]">
          Target margin
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && preview) {
                  event.preventDefault();
                  onApply(preview);
                  setOpen(false);
                }
              }}
              inputMode="decimal"
              placeholder="20"
              aria-label="Target margin (%)"
              className="num h-8 w-16 rounded-md border border-input bg-background px-2 text-right text-[11px] outline-none focus:border-ring"
            />
            <span className="text-[10px] text-muted-foreground">%</span>
          </span>
        </label>
        <div className="flex items-center justify-between border-t border-border pt-2 text-[11px]">
          <span className="text-muted-foreground">Harga jual</span>
          <span className="num font-semibold">
            {preview ? formatIDR(preview) : "—"}
            {previewMargin !== null ? (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                ({formatMargin(previewMargin)})
              </span>
            ) : null}
          </span>
        </div>
        <button
          type="button"
          disabled={!preview}
          onClick={() => {
            if (!preview) return;
            onApply(preview);
            setOpen(false);
          }}
          className="h-8 rounded-md bg-primary text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          Pakai harga ini
        </button>
      </PopoverContent>
    </Popover>
  );
}
