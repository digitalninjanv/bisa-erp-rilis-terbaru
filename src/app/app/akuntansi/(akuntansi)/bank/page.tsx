import Link from "next/link";
import { ArrowRightLeft, Landmark } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listBankTransfers } from "@/server/bank-transfers";
import { listAccountBalances } from "@/server/reports";
import { listCashBankIds } from "@/server/accounting";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { accountTypeLabel, todayISO, monthStartISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { EmptyState } from "@/components/blocks/empty-state";
import { DataList } from "@/components/blocks/data-list";
import { BankTransferForm } from "@/components/akuntansi/bank-transfer-form";
import { CapitalForm } from "@/components/akuntansi/capital-form";

export const metadata = { title: "Kas & bank" };
export const dynamic = "force-dynamic";

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    account?: string;
    status?: string;
    user?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [balances, transfers, cashBankIds] = await Promise.all([
      listAccountBalances(tx, ctx.company.id),
      // A-24 T4: fungsi baca bernama (ARS1-01) — tiap transfer kini
      // membawa jurnal pembentuknya untuk kolom Jurnal di bawah.
      listBankTransfers(tx, ctx.company.id, {
        from,
        to,
        limit: 60,
        accountId: params.account,
        status: params.status,
        createdBy: params.user,
      }),
      // A-27 B2: keanggotaan kas/bank dari kelas akun (listCashBankIds),
      // bukan lagi tiga akun pemetaan cash/bank/qris.
      listCashBankIds(tx, ctx.company.id),
    ]);
    return { balances, transfers, cashBankIds };
  });

  const cashAccounts = data.balances.filter((row) => data.cashBankIds.has(row.id));
  const equityAccounts = data.balances.filter((row) => row.type === "equity" && row.isPostable);
  const totalCash = cashAccounts.reduce((acc, row) => acc + row.balance, 0);
  const activeTransfers = data.transfers.filter((row) => row.status !== "void");
  const totalFees = activeTransfers.reduce((acc, row) => acc + Number(row.fee), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Kas & bank"
        description="Saldo kas, rekening bank, dan QRIS. Transfer antar rekening otomatis membentuk jurnal dengan biaya administrasi."
        actions={
          <Link
            href="/app/akuntansi/bank/transfer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            <ArrowRightLeft className="size-3.5" /> Riwayat transfer
          </Link>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard size="compact" label="Total kas & bank" value={formatIDR(totalCash)} hint={`${cashAccounts.length} rekening`} />
        <StatCard size="compact" label="Transfer tercatat" value={String(activeTransfers.length)} hint="60 dokumen terakhir, tanpa yang dibatalkan" />
        <StatCard size="compact" label="Biaya transfer" value={formatIDR(totalFees)} hint="Akumulasi dokumen" />
        <StatCard size="compact" label="Rekening aktif" value={String(cashAccounts.filter((row) => row.isActive).length)} hint="Akun postable" />
      </div>

      {can(ctx, "accounting.post") ? (
        <div className="space-y-3">
          <div id="transfer-bank" className="scroll-mt-20">
            <BankTransferForm
              accounts={cashAccounts.map((row) => ({ id: row.id, code: row.code, name: row.name, balance: row.balance }))}
              today={todayISO()}
            />
          </div>
          {equityAccounts.length > 0 ? (
            <CapitalForm
              cashAccounts={cashAccounts.map((row) => ({ id: row.id, code: row.code, name: row.name }))}
              equityAccounts={equityAccounts.map((row) => ({ id: row.id, code: row.code, name: row.name }))}
              today={todayISO()}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <h2 className="mb-2 px-0.5 text-[13px] font-semibold">Saldo rekening</h2>
        <DataList
          isEmpty={cashAccounts.length === 0}
          empty={
            <EmptyState
              title="Belum ada akun kas atau bank"
              description="Tandai akun sebagai kas, bank, atau kliring/settlement pada bagan akun agar rekening tampil di sini."
              icon={<Landmark className="size-5" />}
              action={
                <Link
                  href="/app/akuntansi/akun"
                  className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
                >
                  Lihat bagan akun
                </Link>
              }
            />
          }
        >
          <ul className="divide-y divide-border/70">
            {cashAccounts.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{row.name}</p>
                  <p className="num text-[11px] text-muted-foreground">
                    {row.code} · {accountTypeLabel(row.type)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num shrink-0 text-[12px] font-semibold ${row.balance < 0 ? "text-destructive" : ""}`}>
                    {formatIDR(row.balance)}
                  </span>
                  <Link
                    href={`/app/akuntansi/buku-besar?account=${row.id}&from=${from}&to=${to}`}
                    className="inline-flex h-8 items-center px-1 text-[11px] text-primary transition-colors hover:underline"
                  >
                    Buku
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </DataList>
      </div>
    </div>
  );
}
