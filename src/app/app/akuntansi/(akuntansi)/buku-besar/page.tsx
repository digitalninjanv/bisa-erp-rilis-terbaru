import Link from "next/link";
import { BookOpen, Download, Printer } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getLedger, listAccountBalances, resolveDefaultLedgerAccountId } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { formatIDRReport } from "@/lib/money";
import {
  accountTypeLabel,
  formatDate,
  normalBalanceLabel,
  todayISO,
  monthStartISO,
} from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { ReportPrintHeader } from "@/components/akuntansi/report-print-header";
import { LedgerFilters } from "@/components/akuntansi/ledger-filters";
import { getCompanySettingsRow } from "@/server/settings";

export const metadata = { title: "Buku besar" };
export const dynamic = "force-dynamic";

/** Angka buku besar tanpa simbol mata uang berulang. */
function nominal(value: number, zeroDash = false) {
  return formatIDRReport(value, { symbol: false, zeroDash });
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string; type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const allAccounts = await listAccountBalances(tx, ctx.company.id);
    // Buku besar hidup di akun postable; akun header tidak punya mutasi
    // sendiri dan hanya akan mengotori pemilih akun.
    const accountOptions = allAccounts.filter((row) => row.isPostable);
    const filtered = params.type
      ? accountOptions.filter((row) => row.type === params.type)
      : accountOptions;
    // Bawaan = akun beraktivitas pertama pada rentang, bukan akun
    // pertama menurut kode (yang sering kosong).
    const requested = params.account
      ? filtered.find((row) => row.id === params.account)
      : undefined;
    const accountId = requested
      ? requested.id
      : await resolveDefaultLedgerAccountId(tx, ctx.company.id, filtered, { from, to });
    const ledger = accountId
      ? await getLedger(tx, {
          companyId: ctx.company.id,
          accountId,
          from,
          to,
          page: Number(params.page ?? 1),
          pageSize: 50,
        })
      : null;
    const settings = await getCompanySettingsRow(tx, ctx.company.id);
    return {
      accounts: accountOptions,
      accountId,
      ledger,
      legalName: settings?.legalName ?? ctx.company.name,
    };
  });

  const account = data.accounts.find((row) => row.id === data.accountId);
  const filterKey = `${data.accountId}:${params.type ?? ""}:${from}:${to}`;

  return (
    <div>
      <PageHeader
        title="Buku besar"
        description="Mutasi per akun dengan saldo berjalan. Pilih akun dan periode untuk menelusuri jurnal terkait."
        actions={
          <>
            <div className="flex items-center overflow-hidden rounded-md border border-border bg-card">
              <Link
                href={`/api/export/ledger?account=${data.accountId}&from=${from}&to=${to}`}
                className="inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                <Download className="size-3.5" /> CSV
              </Link>
              <span aria-hidden className="h-4 w-px bg-border" />
              <Link
                href={`/api/export/ledger?account=${data.accountId}&from=${from}&to=${to}&format=xlsx`}
                className="inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                <Download className="size-3.5" /> Excel
              </Link>
            </div>
            <Link
              href={`/app/akuntansi/buku-besar/cetak?account=${data.accountId}&from=${from}&to=${to}&autoprint=1`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <Printer className="size-3.5" /> Cetak
            </Link>
          </>
        }
      />

      <div className="paged-print report-print">
        <div className="print-only px-4 pt-4">
          <ReportPrintHeader
            companyName={data.legalName}
            title="Buku Besar"
            periodLabel={
              account
                ? `${account.code} · ${account.name} — Periode ${formatDate(from)} — ${formatDate(to)}`
                : `Periode ${formatDate(from)} — ${formatDate(to)}`
            }
          />
        </div>

        <div className="no-print rounded-lg border border-border bg-card p-3">
          <LedgerFilters
            key={filterKey}
            accounts={data.accounts.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              type: row.type,
            }))}
            accountId={data.accountId}
            type={params.type ?? ""}
            from={from}
            to={to}
          />
        </div>

        {!account || !data.ledger ? (
          <div className="mt-3 rounded-lg border border-border bg-card p-4">
            <EmptyState
              title="Pilih akun"
              description="Pilih akun dan rentang tanggal untuk melihat mutasi."
              icon={<BookOpen className="size-5" />}
            />
          </div>
        ) : (
          <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="num mt-0.5 shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {account.code}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold leading-5">{account.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {accountTypeLabel(account.type)} · Saldo normal{" "}
                    {normalBalanceLabel(account.normalBalance)}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Periode
                </p>
                <p className="num mt-1 text-[12px]">
                  {formatDate(from)} — {formatDate(to)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-4">
              <div className="bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Saldo awal
                </p>
                <p className="num mt-1 text-[15px] font-semibold">{nominal(data.ledger.opening)}</p>
              </div>
              <div className="bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Total debit
                </p>
                <p className="num mt-1 text-[15px] font-semibold">{nominal(data.ledger.totalDebit)}</p>
              </div>
              <div className="bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Total kredit
                </p>
                <p className="num mt-1 text-[15px] font-semibold">{nominal(data.ledger.totalCredit)}</p>
              </div>
              <div className="bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Saldo akhir
                </p>
                <p className="num mt-1 text-[15px] font-semibold">{nominal(data.ledger.closing)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="data-table sticky-head">
                <thead>
                  <tr>
                    <th className="w-[90px]" aria-sort="ascending">Tanggal</th>
                    <th className="w-[116px]">No. jurnal</th>
                    <th>Keterangan</th>
                    <th className="w-[126px] text-right">Debit</th>
                    <th className="w-[126px] text-right">Kredit</th>
                    <th className="w-[138px] text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-muted/20">
                    <td colSpan={5} className="text-[11px] font-medium text-muted-foreground">
                      Saldo awal periode
                    </td>
                    <td className="num text-right text-[12px] font-medium">
                      {nominal(data.ledger.opening)}
                    </td>
                  </tr>
                  {data.ledger.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[12px] text-muted-foreground">
                        Tidak ada mutasi pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    data.ledger.items.map((row) => (
                      <tr key={row.id}>
                        <td className="num whitespace-nowrap text-[12px] text-muted-foreground">
                          {formatDate(row.date)}
                        </td>
                        <td className="num text-[12px]">
                          <Link
                            href={`/app/akuntansi/jurnal/${row.entryId}`}
                            className="text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                          >
                            {row.number}
                          </Link>
                        </td>
                        <td className="cell-wrap max-w-[520px] text-[12px] leading-5">
                          {row.description || "—"}
                        </td>
                        <td className="num text-right text-[12px]">
                          {row.debit > 0 ? (
                            nominal(row.debit)
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="num text-right text-[12px]">
                          {row.credit > 0 ? (
                            nominal(row.credit)
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="num text-right text-[12px] font-semibold">
                          {nominal(row.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-baseline justify-between border-t border-border bg-muted/30 px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Saldo akhir periode
              </span>
              <span className="num text-[14px] font-semibold">{nominal(data.ledger.closing)}</span>
            </div>

            <div className="no-print">
              <Pagination
                page={data.ledger.page}
                pageSize={data.ledger.pageSize}
                total={data.ledger.total}
                basePath="/app/akuntansi/buku-besar"
                params={{ account: data.accountId, from, to, type: params.type }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
