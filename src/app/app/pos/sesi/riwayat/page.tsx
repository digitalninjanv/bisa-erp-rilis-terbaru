import Link from "next/link";
import { eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { branches } from "@/db/schema";
import { listCashSessionCashiers, listCashSessionHistory } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, dataListFilterClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { SessionHistoryTable } from "@/components/pos/session-history-list";
import { DateRangeField } from "@/components/date-field";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

export const metadata = { title: "Riwayat sesi kasir" };
export const dynamic = "force-dynamic";

export default async function SessionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    kasir?: string;
    cabang?: string;
    dari?: string;
    sampai?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("pos.session");
  const status = params.status === "open" || params.status === "closed" ? params.status : undefined;
  const userId = params.kasir || undefined;
  const branchId = params.cabang || undefined;
  const from = params.dari || undefined;
  const to = params.sampai || undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const pageSize = 20;

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [history, cashiers, branchRows] = await Promise.all([
      listCashSessionHistory(tx, ctx.company.id, { status, userId, branchId, from, to, page, pageSize }),
      listCashSessionCashiers(tx, ctx.company.id),
      tx.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.companyId, ctx.company.id)),
    ]);
    return { history, cashiers, branches: branchRows };
  });

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Riwayat sesi kasir"
        description="Semua sesi buka–tutup laci kas: modal awal, uang masuk dan keluar, saldo seharusnya, uang yang dihitung saat tutup, dan selisihnya. Klik nama kasir untuk melihat rincian mutasi sesi."
      />

      {/* A-25 U8: daftar memakai DataList bersama; saringan status &
          kasir menjadi toolbar daftar (nama parameter & semantik
          pengiriman form tidak berubah). */}
      <DataList
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/app/pos/sesi" className="text-[12px] font-medium text-foreground hover:underline">
              Buka / tutup sesi
            </Link>
            <a
              href={`/api/export/cash-sessions?format=csv${status ? `&status=${status}` : ""}${userId ? `&kasir=${userId}` : ""}${branchId ? `&cabang=${branchId}` : ""}${from ? `&dari=${from}` : ""}${to ? `&sampai=${to}` : ""}`}
              className="text-[12px] font-medium text-foreground hover:underline"
            >
              Ekspor CSV
            </a>
            <a
              href={`/api/export/cash-sessions?format=xlsx${status ? `&status=${status}` : ""}${userId ? `&kasir=${userId}` : ""}${branchId ? `&cabang=${branchId}` : ""}${from ? `&dari=${from}` : ""}${to ? `&sampai=${to}` : ""}`}
              className="text-[12px] font-medium text-foreground hover:underline"
            >
              Ekspor XLSX
            </a>
          </div>
        }
        toolbar={
          <AutoFilterForm className="flex flex-wrap items-center gap-2" action="/app/pos/sesi/riwayat">
            <select
              name="status"
              defaultValue={status ?? ""}
              className={dataListFilterClass}
              aria-label="Saring status sesi"
            >
              <option value="">Semua status</option>
              <option value="open">Masih terbuka</option>
              <option value="closed">Ditutup</option>
            </select>
            <select
              name="kasir"
              defaultValue={userId ?? ""}
              className={dataListFilterClass}
              aria-label="Saring kasir"
            >
              <option value="">Semua kasir</option>
              {data.cashiers.map((cashier) => (
                <option key={cashier.userId} value={cashier.userId}>
                  {cashier.userName ?? cashier.userId}
                </option>
              ))}
            </select>
            <select
              name="cabang"
              defaultValue={branchId ?? ""}
              className={dataListFilterClass}
              aria-label="Saring cabang"
            >
              <option value="">Semua cabang</option>
              {data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <DateRangeField
              from={{ name: "dari", defaultValue: from ?? "" }}
              to={{ name: "sampai", defaultValue: to ?? "" }}
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Terapkan
            </button>
          </AutoFilterForm>
        }
        isEmpty={data.history.total === 0}
        empty={
          <EmptyState
            title="Belum ada sesi"
            description="Sesi kas yang dibuka akan tampil di sini beserta ringkasan buka–tutupnya."
          />
        }
        pagination={
          <Pagination
            page={data.history.page}
            pageSize={data.history.pageSize}
            total={data.history.total}
            basePath="/app/pos/sesi/riwayat"
            params={{ status, kasir: userId, cabang: branchId, dari: from, sampai: to }}
          />
        }
        footerNote={`Terbaru dulu · ${pageSize} sesi per halaman.`}
      >
        <SessionHistoryTable rows={data.history.rows} />
      </DataList>
    </div>
  );
}
