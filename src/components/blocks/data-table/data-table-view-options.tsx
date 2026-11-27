"use client";

import type { Table } from "@tanstack/react-table";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
  /** Label khusus untuk kolom-kolom yang tidak memiliki nama ramah */
  columnLabels?: Record<string, string>;
}

export function DataTableViewOptions<TData>({
  table,
  columnLabels = {},
}: DataTableViewOptionsProps<TData>) {
  const columns = table
    .getAllColumns()
    .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide());

  if (columns.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5 px-2.5 text-[12px] font-medium lg:h-8"
            aria-label="Pilih kolom yang ditampilkan"
          >
            <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            <span>Kolom</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
          Tampilan Kolom
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => {
          const id = column.id;
          const label = columnLabels[id] ?? id;
          return (
            <DropdownMenuCheckboxItem
              key={id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
              className="capitalize text-[12px]"
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
