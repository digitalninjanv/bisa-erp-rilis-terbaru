import Link from "next/link";
import { ArrowRightLeft, Plus } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  countBankTransfers,
  listBankTransferActors,
  listBankTransfers,
} from "@/server/bank-transfers";
import { listAccountBalances } from "@/server/reports";
import { listCashBankIds } from "@/server/accounting";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { LIST_PAGE_SIZE, normalizePageParams, pageOffset, parsePageParam } from "@/lib/pagination";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DateRangeField } from "@/components/date-field";
import { BankTransferVoidButton } from "@/components/akuntansi/bank-transfer-form";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

export const metadata = { title: "Riwayat transfer" };
export const dynamic = "force-dynamic";

export default async function BankTransferHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    account?: string;
    status?: string;
    user?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  // Tanpa parameter tanggal = semua waktu; pengguna tetap bisa mempersempit
  // lewat DateRangeField. Sebelumnya bawaan bulan berjalan membuat transfer
  // lama seolah "tidak terdeteksi" di halaman ini.
  const from = params.from || "";
  const to = params.to || "";
  const { page, pageSize } = normalizePageParams(
    { page: parsePageParam(params.page), pageSize: LIST_PAGE_SIZE },
    LIST_PAGE_SIZE,
  );

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [balances, cashBankIds, actors] = await Promise.all([
      listAccountBalances(tx, ctx.company.id),
      listCashBankIds(tx, ctx.company.id),
      listBankTransferActors(tx, ctx.company.id),
    ]);
    const filters = {
      from,
      to,
      accountId: params.account,
      status: params.status,
      createdBy: params.user,
    };
    const [transfers, total] = await Promise.all([
      listBankTransfers(tx, ctx.company.id, {
        ...filters,
        limit: pageSize,
        offset: pageOffset(page, pageSize),
      }),
      countBankTransfers(tx, ctx.company.id, filters),
    ]);
    return {
      transfers,
      total,
      actors,
      cashAccounts: balances.filter((row) => cashBankIds.has(row.id)),
      balances,
    };
  });

  const accountName = (id: string) => data.balances.find((row) => row.id === id)?.name ?? "—";
  const canVoid = can(ctx, "accounting.post");
  const hasFilters = Boolean(
    params.account || params.status || params.user || params.from || params.to,
  );

  return (
    <div>
      <PageHeader
        title="Riwayat transfer"
        description="Semua perpindahan dana antar rekening kas dan bank, lengkap dengan biaya dan jurnalnya."
        actions={
          <Link
            href="/app/akuntansi/bank#transfer-bank"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> Transfer baru
          </Link>
        }
      />

      <DataList
        density="compact"
        toolbar={
          <AutoFilterForm action="/app/akuntansi/bank/transfer" className="flex flex-wrap items-center gap-1.5">
            <DateRangeField from={{ name: "from", defaultValue: from }} to={{ name: "to", defaultValue: to }} />
            <select
              name="account"
              defaultValue={params.account ?? ""}
              aria-label="Rekening"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua rekening</option>
              {data.cashAccounts.map((row) => (
                <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={params.status ?? ""}
              aria-label="Status"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua status</option>
              <option value="posted">Transfer</option>
              <option value="void">Dibatalkan</option>
            </select>
            <select
              name="user"
              defaultValue={params.user ?? ""}
              aria-label="User"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua user</option>
              {data.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.name}</option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Terapkan
            </button>
            {hasFilters ? (
              <Link
                href="/app/akuntansi/bank/transfer"
                className="inline-flex h-9 items-center px-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Atur ulang
              </Link>
            ) : null}
          </AutoFilterForm>
        }
        isEmpty={data.transfers.length === 0}
        empty={
          <EmptyState
            title="Belum ada transfer"
            description="Transfer kas ke bank atau antar bank akan tampil di sini."
            icon={<ArrowRightLeft className="size-5" />}
            action={
              <Link
                href="/app/akuntansi/bank#transfer-bank"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Buat transfer
              </Link>
            }
          />
        }
        pagination={
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            basePath="/app/akuntansi/bank/transfer"
            params={{ from, to, account: params.account, status: params.status, user: params.user }}
          />
        }
      >
        <div className="overflow-x-auto contain-paint">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Dari</th>
                <th>Ke</th>
                <th className="text-right">Nominal</th>
                <th className="text-right">Biaya</th>
                <th>Referensi</th>
                <th>Status</th>
                <th>Jurnal</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.transfers.map((row) => {
                const isVoid = row.status === "void";
                return (
                  <tr key={row.id} className={isVoid ? "opacity-60" : undefined}>
                    <td className="num font-medium">{row.number}</td>
                    <td className="num whitespace-nowrap text-[11px] text-muted-foreground">
                      {formatDate(row.date)}
                    </td>
                    <td className="text-[11px]">{accountName(row.fromAccountId)}</td>
                    <td className="text-[11px]">{accountName(row.toAccountId)}</td>
                    <td className={`num text-right font-medium ${isVoid ? "line-through" : ""}`}>
                      {formatIDR(row.amount)}
                    </td>
                    <td className="num text-right text-[11px] text-muted-foreground">
                      {formatIDR(row.fee)}
                    </td>
                    <td className="num max-w-[180px] truncate text-[11px] text-muted-foreground">
                      {row.reference ?? row.description ?? "—"}
                    </td>
                    <td><StatusBadge status={isVoid ? "void" : "posted"} /></td>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        {row.journalId ? (
                          <Link
                            href={`/app/akuntansi/jurnal/${row.journalId}`}
                            className="num text-[11px] font-medium text-primary transition-colors hover:underline"
                          >
                            {row.journalNumber ?? "Lihat jurnal"}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                        {row.reversalJournalId ? (
                          <Link
                            href={`/app/akuntansi/jurnal/${row.reversalJournalId}`}
                            className="num text-[10px] text-muted-foreground transition-colors hover:underline"
                          >
                            pembalik: {row.reversalJournalNumber ?? "lihat"}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-right">
                      {!isVoid && canVoid ? (
                        <BankTransferVoidButton asMenu id={row.id} number={row.number} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}
