"use client";

import type { Table } from "@tanstack/react-table";
import { DataTableViewOptions } from "./data-table-view-options";

/**
 * Toolbar tabel standar: pencarian/filter di kiri, kontrol kolom di
 * kanan. Satu pola untuk semua daftar TanStack agar halaman tidak
 * meracik toolbar sendiri-sendiri.
 */
export function DataTableToolbar<TData>({
  table,
  search,
  filters,
  columnLabels,
  children,
}: {
  table: Table<TData>;
  search?: React.ReactNode;
  filters?: React.ReactNode;
  columnLabels?: Record<string, string>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
      {search ? <div className="min-w-[210px] flex-1 sm:max-w-sm">{search}</div> : null}
      {filters ? <div className="flex flex-wrap items-center gap-1.5">{filters}</div> : null}
      <div className="ml-auto flex items-center gap-1.5">
        {children}
        <DataTableViewOptions table={table} columnLabels={columnLabels} />
      </div>
    </div>
  );
}
