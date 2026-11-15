import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/blocks/status-badge";
import { SUPPLIER_RETURN_REASON_LABELS } from "@/server/supplier-returns";
import { formatDate } from "@/lib/format";
import { d, formatIDR } from "@/lib/money";

export type SupplierReturnListRow = {
  id: string;
  number: string;
  date: string;
  status: string;
  reasonCategory: string;
  totalValue: string;
  creditAmount: string;
  resolvedAmount: string;
  supplierId: string;
  supplierName: string | null;
  warehouseId: string;
  warehouseName: string | null;
};

function OpenReturnLink({ id }: { id: string }) {
  return (
    <Link
      href={`/app/gudang/retur-pembelian/${id}`}
      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
    >
      Buka <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

function ClaimAmount({ row }: { row: SupplierReturnListRow }) {
  if (row.status !== "posted" && row.status !== "partially_resolved") {
    return <span className="text-muted-foreground">—</span>;
  }
  const remaining = d(row.creditAmount).minus(d(row.resolvedAmount));
  return (
    <span className={remaining.gt(0) ? "font-semibold text-tone-amber" : "text-muted-foreground"}>
      {formatIDR(remaining)}
    </span>
  );
}

export function SupplierReturnList({
  rows,
  compact = false,
  canSeeCost = false,
}: {
  rows: SupplierReturnListRow[];
  compact?: boolean;
  canSeeCost?: boolean;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Nomor</th>
              <th scope="col">Tanggal</th>
              <th scope="col">Pemasok</th>
              {compact ? null : <th scope="col">Gudang</th>}
              <th scope="col">Alasan</th>
              {compact || !canSeeCost ? null : <th scope="col" className="text-right">Nilai retur</th>}
              <th scope="col" className="text-right">Sisa klaim</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="num font-medium">{row.number}</td>
                <td className="num whitespace-nowrap text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                <td className="text-[12px]">{row.supplierName ?? "—"}</td>
                {compact ? null : <td className="text-[11px]">{row.warehouseName ?? "—"}</td>}
                <td className="text-[12px]">{SUPPLIER_RETURN_REASON_LABELS[row.reasonCategory] ?? row.reasonCategory}</td>
                {compact || !canSeeCost ? null : (
                  <td className="num text-right font-medium">
                    {row.status === "draft" ? (
                      <span className="text-muted-foreground" title="Nilai ditentukan saat posting">Belum dinilai</span>
                    ) : formatIDR(row.totalValue)}
                  </td>
                )}
                <td className="num text-right"><ClaimAmount row={row} /></td>
                <td><StatusBadge status={row.status} /></td>
                <td className="text-right"><OpenReturnLink id={row.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border lg:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2.5 px-3 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="num text-[13px] font-semibold">{row.number}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(row.date)}</p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Pemasok</dt>
                <dd className="truncate font-medium">{row.supplierName ?? "—"}</dd>
              </div>
              {!compact ? (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Gudang</dt>
                  <dd className="truncate font-medium">{row.warehouseName ?? "—"}</dd>
                </div>
              ) : null}
              <div className="min-w-0">
                <dt className="text-muted-foreground">Alasan</dt>
                <dd className="truncate font-medium">{SUPPLIER_RETURN_REASON_LABELS[row.reasonCategory] ?? row.reasonCategory}</dd>
              </div>
              {!compact && canSeeCost ? (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Nilai retur</dt>
                  <dd className="num font-medium">{row.status === "draft" ? "Belum dinilai" : formatIDR(row.totalValue)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Sisa klaim</dt>
                <dd className="num font-medium"><ClaimAmount row={row} /></dd>
              </div>
            </dl>
            <div className="flex justify-end"><OpenReturnLink id={row.id} /></div>
          </li>
        ))}
      </ul>
    </>
  );
}
