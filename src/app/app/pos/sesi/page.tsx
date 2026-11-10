import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { cashSessions } from "@/db/schema";
import { getCashSessionSummary, listCashSessionHistory } from "@/server/reports";
import { getCompanySettingsRow } from "@/server/settings";
import { requirePermissionPage } from "@/lib/session";
import { d } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { SessionManager } from "@/components/pos/session-manager";
import { SessionHistoryTable } from "@/components/pos/session-history-list";

export const metadata = { title: "Sesi kas" };
export const dynamic = "force-dynamic";

export default async function SessionPage() {
  const ctx = await requirePermissionPage("pos.session");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [open] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.companyId, ctx.company.id),
          eq(cashSessions.userId, ctx.user.id),
          eq(cashSessions.status, "open"),
        ),
      )
      .limit(1);
    const summary = open ? await getCashSessionSummary(tx, ctx.company.id, open.id) : null;
    // A-28 Tahap 1 (H-POS-02): toleransi selisih untuk petunjuk
    // kewajiban alasan di formulir tutup sesi (penegakan di server).
    const settingsRow = await getCompanySettingsRow(tx, ctx.company.id);
    const differenceTolerance = d(settingsRow?.posSessionDifferenceTolerance ?? "0").toNumber();
    // A-8.3: pratinjau 5 sesi terakhir memakai agregasi & komponen yang
    // sama dengan halaman riwayat penuh di /app/pos/sesi/riwayat.
    const history = await listCashSessionHistory(tx, ctx.company.id, { page: 1, pageSize: 5 });
    return { summary, history, differenceTolerance };
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
          differenceTolerance={data.differenceTolerance}
          session={{
            id: data.summary.session.id,
            openedAt: data.summary.session.openedAt.toISOString(),
            openingCash: Number(data.summary.session.openingCash),
            expected: data.summary.expected,
            sales: data.summary.sales,
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
        <SessionManager session={null} />
      )}

      {/* A-25 U8: pratinjau riwayat memakai DataList bersama — judul
          seksi tidak lagi digambar (judul halaman sudah "Sesi kas";
          konteks lima-terbaru pindah ke catatan kaki daftar). */}
      <div className="mt-4">
        <DataList
          headerActions={
            <Link
              href="/app/pos/sesi/riwayat"
              className="text-[12px] font-medium text-foreground hover:underline"
            >
              Lihat semua riwayat →
            </Link>
          }
          isEmpty={data.history.total === 0}
          empty={
            <EmptyState title="Belum ada sesi" description="Sesi kas yang dibuka akan tampil di sini." />
          }
          footerNote="Lima sesi terbaru semua kasir — modal, masuk, keluar, seharusnya, dihitung, dan selisih."
        >
          <SessionHistoryTable rows={data.history.rows} />
        </DataList>
      </div>
    </div>
  );
}
