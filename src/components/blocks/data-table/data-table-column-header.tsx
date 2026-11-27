"use client";

import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

/**
 * Kepala kolom tabel standar: klik langsung mengurutkan (asc → desc).
 * Pilihan menyembunyikan kolom ada di toolbar “Kolom”, bukan ikon ⋯ di
 * setiap header — header tetap tenang dan mudah dipindai.
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <span className={cn("text-[12px] font-medium text-muted-foreground", className)}>
        {title}
      </span>
    );
  }

  const sorted = column.getIsSorted();
  const sortLabel =
    sorted === "asc" ? "urut menaik" : sorted === "desc" ? "urut menurun" : "belum diurutkan";

  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={cn(
        "-ml-2 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 lg:min-h-7",
        className,
      )}
      aria-label={`Urutkan ${title} — ${sortLabel}`}
    >
      <span>{title}</span>
      {sorted === "desc" ? (
        <ArrowDown className="size-3 text-primary" aria-hidden />
      ) : sorted === "asc" ? (
        <ArrowUp className="size-3 text-primary" aria-hidden />
      ) : (
        <ChevronsUpDown className="size-3 opacity-50" aria-hidden />
      )}
    </button>
  );
}
