import Link from "next/link";
import { Printer } from "lucide-react";
import { withCompanyReadOnlySnapshot } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { listPaymentAccounts } from "@/server/accounting";
import { getSettings } from "@/server/catalog";
import { listPartyCredits } from "@/server/party-credits";
import {
  countOpenPayables,
  countOpenReceivables,
  listPayablesPage,
  listReceivablesPage,
  listRecentPartyPayments,
} from "@/server/reports";
import type { ReceivablePayablePageRow } from "@/server/reports";
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
import { PartyPaymentVoidButton, PaymentForm } from "@/components/akuntansi/payment-form";
import { PartyRowSecondaryActions } from "@/components/akuntansi/party-row-actions";

export const metadata = { title: "Piutang & utang" };
export const dynamic = "force-dynamic";

type Tab = "piutang" | "utang";
type DueFilter = "" | "terlambat" | "segera" | "jatuh-tempo";
type PageRow = ReceivablePayablePageRow;

const SOURCE_LABELS: Record<string, string> = {
  document: "Dokumen",
  opening: "Saldo awal",
  expense: "Beban",
};

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

export default async function ReceivablePayablePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === "utang" ? "utang" : "piutang";
  const status: DueFilter =
    params.status === "terlambat" || params.status === "segera" || params.status === "jatuh-tempo"
      ? params.status
      : "";
  const q = params.q?.trim().toLowerCase() ?? "";
  const today = todayISO();
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 40;

  const ctx = await requirePermissionPage("accounting.view");
  const canWriteOff = can(ctx, "accounting.manage");
  const canPay = can(ctx, "accounting.post") || can(ctx, "pos.sell");

  const data = await withCompanyReadOnlySnapshot(ctx.company.id, async (tx) => {
    const [receivablesPage, payablesPage, accounts, credits, settings, recentPayments, inactiveTabCount] = await Promise.all([
      tab === "piutang"
        ? listReceivablesPage(tx, ctx.company.id, { page, pageSize, status, q, today })
        : Promise.resolve(null),
      tab === "utang"
        ? listPayablesPage(tx, ctx.company.id, { page, pageSize, status, q, today })
        : Promise.resolve(null),
      canPay ? listPaymentAccounts(tx, ctx.company.id) : Promise.resolve([]),
      listPartyCredits(tx, ctx.company.id, {
        partyType: tab === "piutang" ? "customer" : "supplier",
        status: "open",
      }),
      getSettings(tx, ctx.company.id),
      listRecentPartyPayments(tx, ctx.company.id, 20),
      tab === "piutang"
        ? countOpenPayables(tx, ctx.company.id)
        : countOpenReceivables(tx, ctx.company.id),
    ]);
    return {
      receivablesPage,
      payablesPage,
      accounts,
      credits,
      settings,
      recentPayments,
      receivableCount: tab === "piutang" ? receivablesPage!.summary.openCount : inactiveTabCount,
      payableCount: tab === "utang" ? payablesPage!.summary.openCount : inactiveTabCount,
    };
  });

  const activePage = tab === "piutang" ? data.receivablesPage! : data.payablesPage!;
  const pagedRows: PageRow[] = activePage.rows;
  const { openCount, totalOutstanding, overdueCount, overdueTotal, soonCount, soonTotal, paidCount } =
    activePage.summary;
  const creditsForTab = data.credits.filter((row) => Number(row.remaining) > 0.004);
  let creditTotal = 0;
  for (const row of creditsForTab) {
    creditTotal += Number(row.remaining);
  }

  const total = activePage.total;

  const pagePartyKeys = new Set(
    pagedRows.map((row) => `${tab === "piutang" ? "customer" : "supplier"}:${row.partyId ?? ""}`),
  );
  const creditByParty = new Map<string, { id: string; number: string; remaining: number; originLabel?: string | null }[]>();
  for (const row of creditsForTab) {
    const key = `${row.partyType}:${row.partyId}`;
    if (!pagePartyKeys.has(key)) continue;
    const list = creditByParty.get(key) ?? [];
    list.push({ id: row.id, number: row.number, remaining: Number(row.remaining), originLabel: row.originLabel });
    creditByParty.set(key, list);
  }

  const baseHref = `/app/akuntansi/piutang-utang?tab=${tab}`;

  return (
    <div>
      <PageHeader
        title="Piutang & utang"
        description="Dokumen terbuka dari penjualan, penerimaan, beban terutang, dan saldo awal. Terima pembayaran atau bayar tagihan langsung dari daftar ini."
        actions={
          <Link
            href={`/app/akuntansi/piutang-utang/cetak?kind=${tab}&autoprint=1`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            <Printer className="size-3.5" /> Cetak umur {tab}
          </Link>
        }
      />

      <div className="mb-3 flex items-center gap-1 border-b border-border">
        {(
          [
            ["piutang", "Piutang", data.receivableCount],
            ["utang", "Utang", data.payableCount],
          ] as [Tab, string, number][]
        ).map(([key, label, count]) => (
          <Link
            key={key}
            href={`/app/akuntansi/piutang-utang?tab=${key}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={
              tab === key
                ? "inline-flex items-center gap-1.5 border-b-2 border-foreground px-3 py-2.5 text-[12px] font-semibold text-foreground"
                : "inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {label}
            <span className="num rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {count}
            </span>
          </Link>
        ))}
      </div>

      <SummaryStrip
        items={[
          {
            label: tab === "piutang" ? "Piutang terbuka" : "Utang terbuka",
            value: formatIDR(totalOutstanding),
            hint: `${openCount} dokumen · ${paidCount} dibayar sebagian`,
          },
          {
            label: "Lewat jatuh tempo",
            value: formatIDR(overdueTotal),
            hint: `${overdueCount} dokumen perlu ditindaklanjuti`,
            tone: overdueCount > 0 ? "red" : "green",
          },
          {
            label: "Jatuh tempo ≤ 7 hari",
            value: formatIDR(soonTotal),
            hint: `${soonCount} dokumen mendekati jatuh tempo`,
            tone: soonCount > 0 ? "amber" : "green",
          },
          {
            label: "Kredit pihak tersedia",
            value: formatIDR(creditTotal),
            hint: `${creditsForTab.length} kredit dapat dipakai sebagai sumber dana`,
            tone: creditTotal > 0 ? "green" : "muted",
          },
        ]}
      />

      <div className="mt-4">
        <DataList
          density="compact"
          toolbar={
            <DataListToolbar
              action="/app/akuntansi/piutang-utang"
              q={params.q}
              placeholder="Cari nomor, pihak, atau referensi…"
              hidden={{ tab, status: status || undefined }}
              resetHref={baseHref}
            >
              <FilterChips
                options={[
                  { label: "Semua", value: "" },
                  { label: "Lewat jatuh tempo", value: "terlambat" },
                  { label: "Jatuh tempo ≤ 7 hari", value: "segera" },
                  { label: "Semua jatuh tempo", value: "jatuh-tempo" },
                ]}
                value={status}
                basePath="/app/akuntansi/piutang-utang"
                param="status"
                q={params.q}
                params={{ tab }}
              />
            </DataListToolbar>
          }
          isEmpty={total === 0}
          empty={
            <EmptyState
              size="compact"
              title={q || status ? "Tidak ada dokumen yang cocok." : `Belum ada ${tab} terbuka.`}
              description={
                q || status
                  ? "Ubah kata kunci atau filter jatuh tempo."
                  : tab === "piutang"
                    ? "Piutang muncul otomatis dari penjualan tempo di POS."
                    : "Utang muncul otomatis dari penerimaan pembelian kredit dan beban terutang."
              }
            />
          }
          pagination={
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              basePath="/app/akuntansi/piutang-utang"
              params={{ tab, status, q: q || undefined }}
            />
          }
          footerNote={
            canPay
              ? "Pembayaran membuat jurnal otomatis dan mengurangi sisa dokumen. Kredit pihak dapat dipakai sebagai sumber dana. Write-off sisa hanya untuk pengguna dengan izin kelola akuntansi."
              : "Peran Anda dapat melihat daftar ini. Pembayaran dilakukan oleh peran dengan izin transaksi."
          }
        >
          <div className="overflow-x-auto">
            <table className="data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Dokumen</th>
                  <th>{tab === "piutang" ? "Pelanggan" : "Pemasok"}</th>
                  <th>Jatuh tempo</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Sisa</th>
                  <th>Status</th>
                  <th className="text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const isReceivable = tab === "piutang";
                  const partyId = row.partyId;
                  const partyKey = `${isReceivable ? "customer" : "supplier"}:${partyId ?? ""}`;
                  const credits = creditByParty.get(partyKey) ?? [];
                  const paymentKind = isReceivable
                    ? row.source === "opening"
                      ? "opening-receivable"
                      : "receivable"
                    : row.source === "opening"
                      ? "opening-payable"
                      : row.source === "expense"
                        ? "expense-payable"
                        : "payable";
                  const journalHref =
                    row.source === "opening" && row.journalId
                      ? `/app/akuntansi/jurnal/${row.journalId}`
                      : null;
                  const partyName = row.partyName;
                  const writeOffKind = isReceivable
                    ? row.source === "opening"
                      ? "opening"
                      : "receivable"
                    : row.source === "opening"
                      ? "opening"
                      : row.source === "expense"
                        ? "expense-payable"
                        : "payable";

                  return (
                    <tr key={`${row.source}-${row.id}`}>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="num text-[11px] font-medium">{row.number}</span>
                          {row.source !== "document" ? (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {SOURCE_LABELS[row.source] ?? row.source}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDate(row.date)}
                          {journalHref ? (
                            <>
                              {" · "}
                              <Link href={journalHref} className="hover:underline">
                                jurnal
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </td>
                      <td className="text-[12px]">{partyName ?? "—"}</td>
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
                          {canPay ? (
                            data.accounts.length > 0 ? (
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
                            )
                          ) : (
                            <span className="text-[11px] text-muted-foreground">Lihat saja</span>
                          )}
                          <PartyRowSecondaryActions
                            number={row.number}
                            writeOff={
                              canWriteOff
                                ? {
                                    kind: writeOffKind,
                                    id: row.id,
                                    outstanding: row.outstanding,
                                  }
                                : null
                            }
                            voidOpeningId={row.source === "opening" ? row.id : null}
                          />
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

      {creditsForTab.length > 0 ? (
        <details className="mt-3 rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div>
              <h2 className="text-[13px] font-semibold">Kredit pihak tersedia</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {creditsForTab.length} kredit · {formatIDR(creditTotal)} dapat dipakai saat menerima atau membayar.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">Lihat rincian</span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>{tab === "piutang" ? "Pelanggan" : "Pemasok"}</th>
                  <th className="text-right">Sisa kredit</th>
                  <th>Jurnal</th>
                </tr>
              </thead>
              <tbody>
                {creditsForTab.map((credit) => (
                  <tr key={credit.id}>
                    <td className="num text-[11px]">{credit.number}</td>
                    <td className="text-[12px]">{credit.partyName ?? "—"}</td>
                    <td className="num text-right text-[12px] font-medium">
                      {formatIDR(credit.remaining)}
                    </td>
                    <td className="text-[11px]">
                      {credit.journalNumber ? (
                        <span className="num">{credit.journalNumber}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <section className="mt-5 rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Pembayaran terakhir</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            20 pembayaran terbaru. Pembatalan membuat jurnal pembalik dan mengembalikan status dokumen.
          </p>
        </div>
        {data.recentPayments.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted-foreground">Belum ada pembayaran.</p>
        ) : (
          <div className="divide-y divide-border/70">
            {data.recentPayments.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="num text-[11px] font-medium">{row.number}</span>
                <span className="text-[11px] text-muted-foreground">
                  {row.type === "receivable" ? "Penerimaan piutang" : "Pembayaran utang"} · {formatDate(row.date)}
                </span>
                <span className="num ml-auto text-[12px] font-semibold">{formatIDR(row.amount)}</span>
                <StatusBadge status={row.status} />
                {canWriteOff && row.status !== "void" ? (
                  <PartyPaymentVoidButton
                    paymentId={row.id}
                    number={row.number}
                    kind={row.type === "receivable" ? "receivable" : "payable"}
                    opening={Boolean(row.openingId)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
