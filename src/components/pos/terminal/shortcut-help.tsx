/**
 * A-28 UI-1 (UX-B03): tombol bantuan "?" terminal POS — membuka daftar
 * pintasan keyboard agar kasir dapat menemukannya tanpa menghafal.
 * Isi daftar berasal dari lib/pos/terminal-shortcuts (sumber yang sama
 * dengan handler globalnya, jadi janji di daftar selalu nyata).
 * Pola popover mengikuti PosDisplayControls (klik-luar & Esc menutup).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TERMINAL_SHORTCUT_HELP } from "@/lib/pos/terminal-shortcuts";

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Bantuan pintasan keyboard"
        aria-label="Bantuan pintasan keyboard"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md border text-[13px] font-semibold transition-colors",
          open
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Pintasan keyboard terminal"
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-card p-3 shadow-lg"
        >
          <p className="mb-2 text-[12px] font-semibold">Pintasan keyboard</p>
          <dl className="space-y-1.5">
            {TERMINAL_SHORTCUT_HELP.map((row) => (
              <div key={row.keys} className="flex items-center justify-between gap-3 text-[11px]">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="shrink-0">
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                    {row.keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
