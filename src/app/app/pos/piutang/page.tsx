import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { listPaymentAccounts } from "@/server/accounting";
import { getSettings } from "@/server/catalog";
import { listPartyCredits } from "@/server/party-credits";
import { listReceivables } from "@/server/reports";
import { formatIDR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/due-date";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { Pagination } from "@/components/blocks/pagination";
import { FilterChips } from "@/components/blocks/search-form";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PaymentForm } from "@/components/akuntansi/payment-form";

export const metadata = { title: "Piutang pelanggan" };
export const dynamic = "force-dynamic";

function ageDays(today: string, date: string | null): number | null {
  if (!date) return null;
  return Math.max(
    0,
    Math.round(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );
}

function DuePill({ dueDate, today }: { dueDate: string | null; today: string }) {
  if (!dueDate) return <span className="text-[11px] text-muted-foreground">—</span>;
  const days = ageDays(today, dueDate);
  const overdue = days !== null && dueDate < today;
  const soon = days !== null && !overdue && dueDate <= addDaysISO(today, 7);
  return (
    <span
      className={
        overdue
          ? "num rounded-full bg-tone-red-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-red"
          : soon
            ? "num rounded-full bg-tone-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-amber"
            : "num text-[11px] text-muted-foreground"
      }
    >
      {formatDate(dueDate)}
      {overdue ? ` · ${days} hari lewat` : soon ? " · segera" : ""}
    </span>
  );
}

export default async function PosReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = params.status === "terlambat" || params.status === "segera" ? params.status : "";
  const q = params.q?.trim().toLowerCase() ?? "";
  const today = todayISO();
  const ctx = await requirePermissionPage("pos.sell");
  const canWriteOff = can(ctx, "accounting.manage");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [receivables, accounts, credits, settings] = await Promise.all([
      listReceivables(tx, ctx.company.id),
      listPaymentAccounts(tx, ctx.company.id),
      listPartyCredits(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
    ]);
    return { receivables, accounts, credits, settings };
  });

  const allRows = data.receivables.map((row) => ({
    ...row,
    partyId: row.customerId,
    partyName: row.customerName,
  }));

  const openCredits = data.credits.filter(
    (row) => row.status === "open" && Number(row.remaining) > 0.004,
  );
  const creditsForTab = openCredits.filter((row) => row.partyType === "customer");
  const creditByParty = new Map<string, { id: string; number: string; remaining: number }[]>();
  for (const row of creditsForTab) {
    const key = `customer:${row.partyId}`;
    const list = creditByParty.get(key) ?? [];
    list.push({ id: row.id, number: row.number, remaining: Number(row.remaining) });
    creditByParty.set(key, list);
  }

  const dueState = (dueDate: string | null): string => {
    if (!dueDate) return "";
    if (dueDate < today) return "terlambat";
    if (dueDate <= addDaysISO(today, 7)) return "segera";
    return "";
  };
  const totalOutstanding = allRows.reduce((acc, row) => acc + row.outstanding, 0);
  const overdue = allRows.filter((row) => dueState(row.dueDate) === "terlambat");
  const soon = allRows.filter((row) => dueState(row.dueDate) === "segera");
  const overdueTotal = overdue.reduce((acc, row) => acc + row.outstanding, 0);
  const soonTotal = soon.reduce((acc, row) => acc + row.outstanding, 0);

  const rows = allRows.filter((row) => {
    if (status && dueState(row.dueDate) !== status) return false;
    if (!q) return true;
    return (
      row.number.toLowerCase().includes(q) ||
      (row.partyName ?? "").toLowerCase().includes(q)
    );
  });

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 30;
  const total = rows.length;
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Piutang pelanggan"
        description="Tagihan terbuka dari penjualan tempo. Terima pembayaran langsung dari sini; klik nomor dokumen untuk melihat rincian penjualan."
      />

      <SummaryStrip
        items={[
          {
            label: "Piutang terbuka",
            value: formatIDR(totalOutstanding),
            hint: `${allRows.length} dokumen`,
          },
          {
            label: "Lewat jatuh tempo",
            value: formatIDR(overdueTotal),
            hint: `${overdue.length} dokumen`,
            tone: overdue.length > 0 ? "red" : "green",
          },
          {
            label: "Jatuh tempo ≤ 7 hari",
            value: formatIDR(soonTotal),
            hint: `${soon.length} dokumen`,
            tone: soon.length > 0 ? "amber" : "green",
          },
        ]}
      />

      <div className="mt-4">
        <DataList
          density="compact"
          toolbar={
            <DataListToolbar
              action="/app/pos/piutang"
              q={params.q}
              placeholder="Cari nomor atau pelanggan…"
              hidden={{ status: status || undefined }}
              resetHref="/app/pos/piutang"
            >
              <FilterChips
                options={[
                  { label: "Semua", value: "" },
                  { label: "Lewat jatuh tempo", value: "terlambat" },
                  { label: "Jatuh tempo ≤ 7 hari", value: "segera" },
                ]}
                value={status}
                basePath="/app/pos/piutang"
                param="status"
                q={params.q}
              />
            </DataListToolbar>
          }
          isEmpty={rows.length === 0}
          empty={
            <EmptyState
              size="compact"
              title={q || status ? "Tidak ada piutang yang cocok." : "Belum ada piutang terbuka."}
              description={
                q || status
                  ? "Ubah kata kunci atau filter."
                  : "Piutang muncul otomatis dari penjualan tempo di POS."
              }
            />
          }
          pagination={
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              basePath="/app/pos/piutang"
              params={{ status: status || undefined, q: q || undefined }}
            />
          }
        >
          <div className="overflow-x-auto">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Dokumen</th>
                  <th>Pelanggan</th>
                  <th>Jatuh tempo</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Sisa</th>
                  <th>Status</th>
                  <th className="text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const partyId = row.customerId;
                  const partyKey = `customer:${partyId ?? ""}`;
                  const credits = creditByParty.get(partyKey) ?? [];
                  const paymentKind =
                    row.source === "opening" ? "opening-receivable" : "receivable";
                  const detailHref =
                    row.source === "document" ? `/app/pos/nota/${row.id}` : null;
                  return (
                    <tr key={`${row.source}-${row.id}`}>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {detailHref ? (
                            <Link
                              href={detailHref}
                              className="num text-[11px] font-medium text-foreground hover:underline"
                            >
                              {row.number}
                            </Link>
                          ) : (
                            <span className="num text-[11px] font-medium">{row.number}</span>
                          )}
                          {row.source !== "document" ? (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                              saldo awal
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{formatDate(row.date)}</p>
                      </td>
                      <td className="text-[12px]">
                        <span className="block">{row.partyName ?? "—"}</span>
                        {row.customerId ? (
                          <Link
                            href={`/app/pos/piutang/cetak?customerId=${row.customerId}`}
                            className="text-[10px] font-medium text-primary hover:underline"
                          >
                            Cetak statement
                          </Link>
                        ) : null}
                      </td>
                      <td>
                        <DuePill dueDate={row.dueDate} today={today} />
                      </td>
                      <td className="num text-right text-[12px]">{formatIDR(row.total)}</td>
                      <td className="num text-right text-[12px] font-semibold">
                        {formatIDR(row.outstanding)}
                      </td>
                      <td>
                        <StatusBadge status={row.paymentStatus} />
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {data.accounts.length > 0 ? (
                            <PaymentForm
                              kind={paymentKind}
                              id={row.id}
                              number={row.number}
                              outstanding={row.outstanding}
                              accounts={data.accounts}
                              credits={credits}
                              withholdingEnabled={Boolean(data.settings?.withholdingEnabled)}
                              canWriteOff={canWriteOff}
                              writeOffMaxAmount={data.settings?.writeoffMaxAmount ?? "0"}
                            />
                          ) : (
                            <Link
                              href="/app/akuntansi/bank"
                              className="text-[11px] font-medium text-tone-amber hover:underline"
                            >
                              Atur akun kas
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataList>
      </div>
    </div>
  );
}