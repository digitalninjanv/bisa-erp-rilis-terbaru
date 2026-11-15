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
import { LedgerTable } from "@/components/akuntansi/ledger-table";
import { getCompanySettingsRow } from "@/server/settings";

export const metadata = { title: "Buku besar" };
export const dynamic = "force-dynamic";

/** Angka buku besar tanpa simbol mata uang berulang. */
function nominal(value: number, zeroDash = false) {
  return formatIDRReport(value, { symbol: false, zeroDash });
}

function isISODate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string; type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = isISODate(params.from) ? params.from : monthStartISO();
  const to = isISODate(params.to) ? params.to : todayISO();
  const rangeValid = from <= to;

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
      : rangeValid
        ? await resolveDefaultLedgerAccountId(tx, ctx.company.id, filtered, { from, to })
        : filtered[0]?.id ?? "";
    const ledger = accountId && rangeValid
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
        actions={account && rangeValid ? (
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
        ) : undefined}
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

        {!account ? (
          <div className="mt-3 rounded-lg border border-border bg-card p-4">
            <EmptyState
              title="Pilih akun"
              description="Pilih akun dan rentang tanggal untuk melihat mutasi."
              icon={<BookOpen className="size-5" />}
            />
          </div>
        ) : !rangeValid ? (
          <div role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-[13px] font-semibold text-destructive">Rentang tanggal tidak valid</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Tanggal mulai harus sama dengan atau sebelum tanggal akhir. Perbarui periode, lalu pilih Tampilkan.
            </p>
          </div>
        ) : !data.ledger ? (
          <div className="mt-3 rounded-lg border border-border bg-card p-4">
            <EmptyState
              title="Belum ada mutasi"
              description="Tidak ada jurnal terposting untuk akun ini pada periode yang dipilih."
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
                <p className="num text-[12px] font-medium">
                  Total {data.ledger.total.toLocaleString("id-ID")} mutasi
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(from)} — {formatDate(to)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-border border-y border-border bg-muted/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="flex items-center justify-between px-4 py-2.5 sm:block">
                <p className="text-[11px] font-medium text-muted-foreground">Saldo awal</p>
                <p className="num mt-0.5 text-[13px] font-semibold">{nominal(data.ledger.opening)}</p>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 sm:block">
                <p className="text-[11px] font-medium text-muted-foreground">Mutasi debit</p>
                <p className="num mt-0.5 text-[13px] font-semibold">{nominal(data.ledger.totalDebit)}</p>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 sm:block">
                <p className="text-[11px] font-medium text-muted-foreground">Mutasi kredit</p>
                <p className="num mt-0.5 text-[13px] font-semibold">{nominal(data.ledger.totalCredit)}</p>
              </div>
            </div>

            <LedgerTable
              rows={data.ledger.items}
              total={data.ledger.total}
              page={data.ledger.page}
              pageSize={data.ledger.pageSize}
              pageOpening={data.ledger.pageOpening}
            />

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
