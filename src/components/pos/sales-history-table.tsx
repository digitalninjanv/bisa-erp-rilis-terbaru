"use client";

import Link from "next/link";
import { useState } from "react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader, DataTableToolbar } from "@/components/blocks/data-table";
import { StatusBadge } from "@/components/blocks/status-badge";
import { SaleRowActions } from "@/components/pos/sale-row-actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatIDR, formatNumber } from "@/lib/money";

export type SalesHistoryRow = {
  id: string;
  number: string;
  date: string | Date;
  createdAt: string | Date;
  cashierName: string | null;
  customerName: string | null;
  itemCount: number | string;
  total: number | string;
  status: string;
  paymentStatus: string;
};

/**
 * Tabel riwayat POS standar (TanStack): sortir kolom, pilihan kolom,
 * kepala sticky, dan kartu responsif di ponsel. Paginasi & pencarian
 * tetap server-side agar dataset besar tidak dimuat seluruhnya.
 */
export function SalesHistoryTable({
  rows,
  canVoid,
  canReturn,
  canReprint,
}: {
  rows: SalesHistoryRow[];
  canVoid: boolean;
  canReturn: boolean;
  canReprint: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns: ColumnDef<SalesHistoryRow>[] = [
    {
      id: "number",
      accessorKey: "number",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nomor" />,
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <Link
            href={`/app/pos/nota/${row.original.id}?salinan=1`}
            prefetch={false}
            className="num font-medium hover:underline"
          >
            {row.original.number}
          </Link>
          <p className="text-[11px] text-muted-foreground">{formatDate(row.original.date)}</p>
        </div>
      ),
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Waktu" />,
      cell: ({ row }) => (
        <span className="num whitespace-nowrap text-[12px] text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: "cashierName",
      accessorFn: (row) => row.cashierName ?? "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kasir" />,
      cell: ({ row }) => <span className="text-[12px]">{row.original.cashierName ?? "—"}</span>,
    },
    {
      id: "customerName",
      accessorFn: (row) => row.customerName ?? "Umum",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Pelanggan" />,
      cell: ({ row }) => <span className="text-[12px]">{row.original.customerName ?? "Umum"}</span>,
    },
    {
      id: "itemCount",
      accessorFn: (row) => Number(row.itemCount),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" className="w-full justify-end" />,
      cell: ({ row }) => (
        <span className="num block text-right text-[12px]">{formatNumber(row.original.itemCount)}</span>
      ),
    },
    {
      id: "total",
      accessorFn: (row) => Number(row.total),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" className="w-full justify-end" />,
      cell: ({ row }) => (
        <span className="num block text-right font-medium">{formatIDR(row.original.total)}</span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.original.status} />
          {row.original.paymentStatus !== "paid" && row.original.status === "completed" ? (
            <StatusBadge status={row.original.paymentStatus} />
          ) : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="block text-right text-[12px] font-medium text-muted-foreground">Aksi</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <SaleRowActions
            saleId={row.original.id}
            number={row.original.number}
            status={row.original.status}
            canVoid={canVoid}
            canReturn={canReturn}
            canReprint={canReprint}
          />
        </div>
      ),
    },
  ];

  // TanStack Table intentionally exposes non-memoizable functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <DataTableToolbar
        table={table}
        columnLabels={{
          number: "Nomor",
          createdAt: "Waktu",
          cashierName: "Kasir",
          customerName: "Pelanggan",
          itemCount: "Item",
          total: "Total",
          status: "Status",
        }}
      />
      <DataTable
        table={table}
        density="normal"
        ariaLabel="Tabel riwayat transaksi"
        emptyState={<span>Belum ada transaksi pada periode ini.</span>}
        mobileCard={(sale) => (
          <div className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={`/app/pos/nota/${sale.id}?salinan=1`}
                prefetch={false}
                className="num inline-flex min-h-11 items-center text-[12px] font-medium text-primary hover:underline"
              >
                {sale.number}
              </Link>
              <span className="num text-[12px] font-semibold">{formatIDR(sale.total)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatDateTime(sale.createdAt)} · {sale.customerName ?? "Umum"} · {sale.itemCount} item
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={sale.status} />
              {sale.paymentStatus !== "paid" && sale.status === "completed" ? (
                <StatusBadge status={sale.paymentStatus} />
              ) : null}
              <span className="ml-auto">
                <SaleRowActions
                  saleId={sale.id}
                  number={sale.number}
                  status={sale.status}
                  canVoid={canVoid}
                  canReturn={canReturn}
                  canReprint={canReprint}
                />
              </span>
            </div>
          </div>
        )}
      />
    </>
  );
}
