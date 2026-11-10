"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Cetak" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
    >
      <Printer className="size-3.5" /> {label}
    </button>
  );
}
