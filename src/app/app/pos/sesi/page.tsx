import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { cashSessions } from "@/db/schema";
import { listBranchOptions } from "@/server/catalog";
import { getCashSessionSummary } from "@/server/reports";
import { countHeldSales } from "@/server/pos";
import { getCompanySettingsRow } from "@/server/settings";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { d } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { SessionManager } from "@/components/pos/session-manager";

export const metadata = { title: "Sesi kas" };
export const dynamic = "force-dynamic";

export default async function SessionPage() {
  const ctx = await requirePermissionPage("pos.session");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [open, heldCount, branchRows] = await Promise.all([
      tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.companyId, ctx.company.id),
            eq(cashSessions.userId, ctx.user.id),
            eq(cashSessions.status, "open"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      countHeldSales(tx, ctx.company.id),
      listBranchOptions(tx, ctx.company.id),
    ]);
    const summary = open ? await getCashSessionSummary(tx, ctx.company.id, open.id) : null;
    // A-28 Tahap 1 (H-POS-02): toleransi selisih untuk petunjuk
    // kewajiban alasan di formulir tutup sesi (penegakan di server).
    const settingsRow = await getCompanySettingsRow(tx, ctx.company.id);
    const differenceTolerance = d(settingsRow?.posSessionDifferenceTolerance ?? "0").toNumber();
    return {
      summary,
      differenceTolerance,
      heldCount,
      branches: branchRows,
      posOfflineEnabled: settingsRow?.posOfflineEnabled ?? false,
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Sesi kas"
        description="Buka dan tutup laci kas, catat setoran/penarikan, dan rekonsiliasi uang fisik."
      />

      {data.summary ? (
        <SessionManager
          heldCount={data.heldCount}
          differenceTolerance={data.differenceTolerance}
          branches={data.branches}
          canViewXReport={can(ctx, "pos.void")}
          companyId={ctx.company.id}
          userId={ctx.user.id}
          posOfflineEnabled={data.posOfflineEnabled}
          session={{
            id: data.summary.session.id,
            openedAt: data.summary.session.openedAt.toISOString(),
            openingCash: Number(data.summary.session.openingCash),
            sales: data.summary.sales,
            receivableIn: data.summary.receivables,
            nonCashSales: data.summary.nonCashSales,
            refunds: data.summary.refunds,
            deposits: data.summary.deposits,
            withdrawals: data.summary.withdrawals,
            transactionCount: data.summary.transactionCount,
            movements: data.summary.movements.map((row) => ({
              id: row.id,
              type: row.type,
              amount: Number(row.amount),
              notes: row.notes,
              createdAt: row.createdAt.toISOString(),
            })),
          }}
        />
      ) : (
        <SessionManager session={null} branches={data.branches} />
      )}

      <div className="mt-4">
        <Link
          href="/app/pos/sesi/riwayat"
          className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted lg:h-9"
        >
          Lihat riwayat sesi →
        </Link>
      </div>
    </div>
  );
}
