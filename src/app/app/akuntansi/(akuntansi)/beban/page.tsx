import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { listExpenses } from "@/server/reports";
import { formatIDR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { parsePageParam } from "@/lib/pagination";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { ExpenseVoidButton } from "@/components/akuntansi/expense-void-button";

export const metadata = { title: "Beban" };
export const dynamic = "force-dynamic";

export default async function ExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : todayISO().slice(0, 7);
  const page = parsePageParam(params.page);
  const ctx = await requirePermissionPage("accounting.view");
  const canVoid = can(ctx, "accounting.post");

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listExpenses(tx, ctx.company.id, { month, page, pageSize: 25 }),
  );

  return (
    <div>
      <PageHeader
        title="Beban"
        description="Riwayat beban tunai dan beban terutang beserta jurnal pembentuknya. Koreksi dilakukan dengan pembatalan berdokumen, bukan mengedit jurnal."
        actions={
          <Link
            href="/app/akuntansi/jurnal/baru"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Catat transaksi
          </Link>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Beban bulan ini</p>
          <p className="num mt-0.5 text-[15px] font-semibold">{formatIDR(data.monthAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total beban terfilter</p>
          <p className="num mt-0.5 text-[15px] font-semibold">{formatIDR(data.totalAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Dokumen</p>
          <p className="num mt-0.5 text-[15px] font-semibold">{data.total}</p>
        </div>
      </div>

      <form className="mb-3 flex flex-wrap items-end gap-2" action="/app/akuntansi/beban">
        <label className="space-y-1">
          <span className="block text-[11px] font-medium text-muted-foreground">Bulan</span>
          <input
            type="month"
            name="month"
            defaultValue={month}
            className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"
          />
        </label>
        <button type="submit" className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted">
          Tampilkan
        </button>
      </form>

      <DataList
        isEmpty={data.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada beban pada periode ini"
            description="Beban tunai dan beban terutang dicatat lewat Catat Transaksi agar jurnal dan dokumennya terbentuk bersama."
            icon={<ReceiptText className="size-5" />}
          />
        }
      >
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabel beban">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dokumen</th>
                <th>Tanggal</th>
                <th>Akun beban</th>
                <th>Pemasok</th>
                <th className="text-right">Nominal</th>
                <th>Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className={row.status === "void" ? "opacity-60" : undefined}>
                  <td>
                    <p className="num text-[11px] font-medium">{row.number}</p>
                    <p className="text-[10px] text-muted-foreground">{row.description}</p>
                  </td>
                  <td className="text-[11px]">{formatDate(row.date)}</td>
                  <td className="text-[11px]">{row.expenseAccount ?? "—"}</td>
                  <td className="text-[11px]">{row.supplierName ?? "—"}</td>
                  <td className={`num text-right text-[12px] ${row.status === "void" ? "line-through" : ""}`}>
                    {formatIDR(row.amount)}
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {row.journalId ? (
                        <Link
                          href={`/app/akuntansi/jurnal/${row.journalId}`}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          Jurnal
                        </Link>
                      ) : null}
                      {canVoid && row.status !== "void" ? (
                        <ExpenseVoidButton id={row.id} number={row.number} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-border/70 lg:hidden">
          {data.rows.map((row) => (
            <div key={row.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="num text-[12px] font-medium">{row.number}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(row.date)} · {row.expenseAccount ?? "—"}</p>
                </div>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-1 text-[12px]">{row.description}</p>
              <div className="mt-1 flex items-end justify-between gap-2">
                <p className="num text-[13px] font-semibold">{formatIDR(row.amount)}</p>
                {canVoid && row.status !== "void" ? (
                  <ExpenseVoidButton id={row.id} number={row.number} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </DataList>

      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/app/akuntansi/beban" params={{ month }} />
    </div>
  );
}
