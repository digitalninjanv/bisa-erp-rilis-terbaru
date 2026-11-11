"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface DataTableFloatingBarProps {
  selectedCount: number;
  totalCount?: number;
  onClearSelection: () => void;
  children?: React.ReactNode;
}

export function DataTableFloatingBar({
  selectedCount,
  totalCount,
  onClearSelection,
  children,
}: DataTableFloatingBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <div
      role="region"
      aria-label="Aksi massal untuk data terpilih"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border/80 bg-background/95 p-1.5 shadow-[var(--shadow-pop)] backdrop-blur transition-all duration-150 animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <div className="flex items-center gap-1.5 pl-2 pr-1 text-[12px] font-medium text-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {selectedCount}
        </span>
        <span>
          terpilih{totalCount ? ` dari ${totalCount}` : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClearSelection}
          className="ml-1 size-5 text-muted-foreground hover:text-foreground"
          aria-label="Batalkan semua pilihan"
        >
          <X className="size-3" />
        </Button>
      </div>

      {children ? (
        <>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-1.5 pr-1">{children}</div>
        </>
      ) : null}
    </div>
  );
}
