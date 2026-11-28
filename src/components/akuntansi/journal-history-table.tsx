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
import { RowMenu } from "@/components/blocks/row-menu";
import { StatusBadge } from "@/components/blocks/status-badge";
import { formatDate, journalSourceLabel } from "@/lib/format";
import { formatIDR } from "@/lib/money";

export type JournalHistoryRow = {
  id: string;
  number: string;
  date: string | Date;
  description: string;
  sourceType: string;
  status: string;
  amount: number | string;
  lines: { accountCode: string; accountName: string; debit: number; credit: number }[];
};

function JournalLines({ lines }: { lines: JournalHistoryRow["lines"] }) {
  if (lines.length === 0) return null;
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-[11px] text-primary hover:underline">
        Rincian {lines.length} baris
      </summary>
      <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-2">
        {lines.map((line, index) => (
          <li key={index} className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="min-w-0 truncate">
              <span className="num mr-1.5 text-muted-foreground">{line.accountCode}</span>
              {line.accountName}
            </span>
            <span className="num shrink-0 whitespace-nowrap">
              {line.debit > 0 ? `Dr ${formatIDR(line.debit)}` : line.credit > 0 ? `Cr ${formatIDR(line.credit)}` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function JournalActions({ row }: { row: JournalHistoryRow }) {
  return (
    <div className="flex justify-end">
      <RowMenu
        label={`Aksi untuk jurnal ${row.number}`}
        items={[
          { key: "detail", label: "Lihat detail", href: `/app/akuntansi/jurnal/${row.id}` },
          { key: "copy", label: "Duplikat", href: `/app/akuntansi/jurnal/baru?from=${row.id}` },
          { key: "print", label: "Cetak", href: `/app/akuntansi/jurnal/${row.id}/cetak` },
        ]}
      />
    </div>
  );
}

/** Tabel riwayat jurnal standar (TanStack) dengan rincian baris dan kartu mobile. */
export function JournalHistoryTable({ rows }: { rows: JournalHistoryRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);

  const columns: ColumnDef<JournalHistoryRow>[] = [
    {
      id: "number",
      accessorKey: "number",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nomor" />,
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={`/app/akuntansi/jurnal/${row.original.id}`} className="num font-medium hover:underline">
          {row.original.number}
        </Link>
      ),
    },
    {
      id: "date",
      accessorKey: "date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tanggal" />,
      cell: ({ row }) => (
        <span className="num whitespace-nowrap text-[12px] text-muted-foreground">
          {formatDate(row.original.date)}
        </span>
      ),
    },
    {
      id: "description",
      accessorKey: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Keterangan" />,
      cell: ({ row }) => (
        <div className="max-w-[340px] text-[12px]">
          <span className="block truncate">{row.original.description}</span>
          <JournalLines lines={row.original.lines} />
        </div>
      ),
    },
    {
      id: "sourceType",
      accessorFn: (row) => journalSourceLabel(row.sourceType),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Sumber" />,
      cell: ({ row }) => <span className="text-[11px]">{journalSourceLabel(row.original.sourceType)}</span>,
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "amount",
      accessorFn: (row) => Number(row.amount),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nilai" className="w-full justify-end" />,
      cell: ({ row }) => (
        <span className="num block text-right font-medium">{formatIDR(row.original.amount)}</span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Aksi</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => <JournalActions row={row.original} />,
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
          date: "Tanggal",
          description: "Keterangan",
          sourceType: "Sumber",
          status: "Status",
          amount: "Nilai",
        }}
      />
      <DataTable
        table={table}
        density="compact"
        ariaLabel="Tabel riwayat jurnal"
        emptyState={<span>Belum ada jurnal pada periode ini.</span>}
        mobileCard={(row) => (
          <div className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={`/app/akuntansi/jurnal/${row.id}`}
                className="num text-[12px] font-medium text-primary hover:underline"
              >
                {row.number}
              </Link>
              <span className="num text-[12px] font-semibold">{formatIDR(row.amount)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[12px]">{row.description}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={row.status} />
              <span className="text-[11px] text-muted-foreground">
                {formatDate(row.date)} · {journalSourceLabel(row.sourceType)}
              </span>
            </div>
            <div className="mt-1">
              <JournalLines lines={row.lines} />
            </div>
          </div>
        )}
      />
    </>
  );
}
