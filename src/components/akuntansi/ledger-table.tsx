"use client";

import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { formatDate } from "@/lib/format";
import { formatIDRReport } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type LedgerTableRow = {
  id: string;
  entryId: string;
  date: string;
  number: string;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
};

function amount(value: number): string {
  return formatIDRReport(value, { symbol: false, zeroDash: true });
}

const columns: ColumnDef<LedgerTableRow>[] = [
  {
    accessorKey: "date",
    header: "Tanggal",
    cell: ({ getValue }) => (
      <span className="num whitespace-nowrap text-muted-foreground">
        {formatDate(getValue<string>())}
      </span>
    ),
  },
  {
    accessorKey: "number",
    header: "No. jurnal",
    cell: ({ row }) => (
      <Link
        href={`/app/akuntansi/jurnal/${row.original.entryId}`}
        className="num font-medium text-primary underline-offset-2 hover:underline"
      >
        {row.original.number}
      </Link>
    ),
  },
  {
    accessorKey: "description",
    header: "Keterangan",
    cell: ({ getValue }) => (
      <span className="block max-w-[560px] whitespace-normal break-words leading-5">
        {getValue<string | null>() || "—"}
      </span>
    ),
  },
  {
    accessorKey: "debit",
    header: () => <span className="block text-right">Debit</span>,
    cell: ({ getValue }) => (
      <span className="num block text-right">{amount(getValue<number>())}</span>
    ),
  },
  {
    accessorKey: "credit",
    header: () => <span className="block text-right">Kredit</span>,
    cell: ({ getValue }) => (
      <span className="num block text-right">{amount(getValue<number>())}</span>
    ),
  },
  {
    accessorKey: "balance",
    header: () => <span className="block text-right">Saldo berjalan</span>,
    cell: ({ getValue }) => (
      <span className="num block text-right font-semibold">{amount(getValue<number>())}</span>
    ),
  },
];

const columnClasses: Record<string, string> = {
  date: "w-[100px]",
  number: "w-[125px]",
  debit: "w-[140px]",
  credit: "w-[140px]",
  balance: "w-[160px]",
};

export function LedgerTable({
  rows,
  total,
  page,
  pageSize,
  pageOpening,
}: {
  rows: LedgerTableRow[];
  total: number;
  page: number;
  pageSize: number;
  pageOpening: number;
}) {
  // TanStack's table instance is consumed directly by this renderer; it is
  // intentionally not passed through React Compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    rowCount: total,
    state: { pagination: { pageIndex: page - 1, pageSize } },
  });
  const isFirstPage = page === 1;
  const openingLabel = isFirstPage
    ? "Saldo awal periode"
    : "Saldo dibawa dari transaksi sebelumnya";

  return (
    <>
      <div className="hidden xl:block">
        <Table className="data-table sticky-head min-w-[860px]">
          <caption className="sr-only">Mutasi dan saldo berjalan buku besar</caption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={columnClasses[header.column.id]}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {!isFirstPage ? (
              <TableRow className="bg-muted/30 font-medium hover:bg-muted/30">
                <TableCell colSpan={5} className="text-muted-foreground">
                  {openingLabel}
                </TableCell>
                <TableCell className="num text-right">{amount(pageOpening)}</TableCell>
              </TableRow>
            ) : null}
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                  Tidak ada mutasi pada periode ini.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={columnClasses[cell.column.id]}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y divide-border xl:hidden">
        {!isFirstPage ? (
          <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3 text-[12px]">
            <span className="text-muted-foreground">{openingLabel}</span>
            <span className="num font-semibold">{amount(pageOpening)}</span>
          </div>
        ) : null}
        {table.getRowModel().rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
            Tidak ada mutasi pada periode ini.
          </p>
        ) : (
          table.getRowModel().rows.map(({ original: row }) => (
            <article key={row.id} className="space-y-2.5 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</p>
                  <Link
                    href={`/app/akuntansi/jurnal/${row.entryId}`}
                    className="num mt-1 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Jurnal {row.number}
                  </Link>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-muted-foreground">Saldo berjalan</p>
                  <p className="num mt-0.5 text-[13px] font-semibold">{amount(row.balance)}</p>
                </div>
              </div>
              <p className="break-words text-[12px] leading-5">{row.description || "—"}</p>
              <dl className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-[11px]">
                <div>
                  <dt className="text-muted-foreground">Debit</dt>
                  <dd className="num mt-0.5">{amount(row.debit)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Kredit</dt>
                  <dd className="num mt-0.5">{amount(row.credit)}</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>
    </>
  );
}
