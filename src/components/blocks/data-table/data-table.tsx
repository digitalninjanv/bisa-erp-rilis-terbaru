"use client";

import type { CSSProperties } from "react";
import { flexRender, type Column, type Table as TanstackTable } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DataTableProps<TData> {
  table: TanstackTable<TData>;
  /** Kepadatan baris tabel */
  density?: "compact" | "normal" | "comfortable";
  /** Pesan atau elemen kosong */
  emptyState?: React.ReactNode;
  /** Kelas tambahan untuk wrapper */
  className?: string;
  /** Tinggi maksimal dengan scroll vertikal jika diinginkan */
  maxHeight?: string | number;
  /** Nama region gulir untuk pembaca layar. */
  ariaLabel?: string;
  /**
   * Tampilan kartu di bawah `lg`. Bila diisi, tabel desktop
   * disembunyikan dan setiap baris dirender sebagai kartu — pola
   * responsif standar untuk daftar operasional di ponsel.
   */
  mobileCard?: (row: TData) => React.ReactNode;
}

/**
 * Helper style untuk CSS sticky column pinning (freeze column)
 */
function getCommonPinningStyles<TData>(column: Column<TData>): CSSProperties {
  const isPinned = column.getIsPinned();
  const isLastLeftPinnedColumn =
    isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinnedColumn =
    isPinned === "right" && column.getIsFirstColumn("right");

  return {
    left: isPinned === "left" ? `${column.getStart("left")}px` : undefined,
    right: isPinned === "right" ? `${column.getAfter("right")}px` : undefined,
    position: isPinned ? "sticky" : undefined,
    zIndex: isPinned ? 1 : 0,
    boxShadow: isLastLeftPinnedColumn
      ? "1px 0 0 0 var(--border)"
      : isFirstRightPinnedColumn
        ? "-1px 0 0 0 var(--border)"
        : undefined,
  };
}

export function DataTable<TData>({
  table,
  density = "compact",
  emptyState,
  className,
  maxHeight,
  ariaLabel = "Tabel data",
  mobileCard,
}: DataTableProps<TData>) {
  const densityRowClass =
    density === "compact"
      ? "h-8 py-1 px-2.5 text-[12px]"
      : density === "comfortable"
        ? "h-11 py-3 px-3 text-[13px]"
        : "h-9 py-2 px-3 text-[13px]";

  const densityHeadClass =
    density === "compact"
      ? "h-8 py-1.5 px-2.5 text-[11px]"
      : density === "comfortable"
        ? "h-10 py-2.5 px-3 text-[12px]"
        : "h-9 py-2 px-3 text-[12px]";

  const tableBody = (
    <div
      className={cn(
        "data-table-scroll relative w-full overflow-x-auto contain-paint",
        className,
      )}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <Table className="data-table w-full">
        <TableHeader className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const isPinned = header.column.getIsPinned();
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : header.column.getCanSort()
                            ? "none"
                            : undefined
                    }
                    style={{
                      ...getCommonPinningStyles(header.column),
                      width: header.getSize() !== 150 ? header.getSize() : undefined,
                    }}
                    className={cn(
                      densityHeadClass,
                      isPinned && "bg-background/95 backdrop-blur",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="transition-colors"
              >
                {row.getVisibleCells().map((cell) => {
                  const isPinned = cell.column.getIsPinned();
                  return (
                    <TableCell
                      key={cell.id}
                      style={getCommonPinningStyles(cell.column)}
                      className={cn(
                        densityRowClass,
                        isPinned && "bg-background/95 backdrop-blur",
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={table.getAllColumns().length}
                className="h-32 text-center text-[12px] text-muted-foreground"
              >
                {emptyState ?? "Tidak ada data yang ditemukan."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  if (!mobileCard) return tableBody;

  const rows = table.getRowModel().rows;
  return (
    <>
      <div className="divide-y divide-border/70 lg:hidden">
        {rows.length > 0 ? (
          rows.map((row) => <div key={row.id}>{mobileCard(row.original)}</div>)
        ) : (
          <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
            {emptyState ?? "Tidak ada data yang ditemukan."}
          </div>
        )}
      </div>
      <div className="hidden lg:block">{tableBody}</div>
    </>
  );
}
