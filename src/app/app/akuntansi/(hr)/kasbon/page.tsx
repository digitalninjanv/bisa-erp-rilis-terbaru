import Link from "next/link";
import { HandCoins } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { listCashBankAccounts } from "@/server/accounting";
import {
  ADVANCE_PLAN_LABELS,
  ADVANCE_STATUS_LABELS,
  listEmployeeAdvances,
  listMovedAdvanceIds,
} from "@/server/employee-advances";
import { listEmployees } from "@/server/hr";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DataList } from "@/components/blocks/data-list";
import { AdvanceForm, AdvanceVoidButton } from "@/components/akuntansi/advance-panel";

export const metadata = { title: "Kasbon Karyawan" };
export const dynamic = "force-dynamic";

export default async function KasbonPage() {
  const ctx = await requirePermissionPage("payroll.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const advances = await listEmployeeAdvances(tx, ctx.company.id);
    const staff = await listEmployees(tx, ctx.company.id);
    const cashAccounts = await listCashBankAccounts(tx, ctx.company.id);
    const movedAdvanceIds = await listMovedAdvanceIds(
      tx,
      ctx.company.id,
      advances.map((row) => row.id),
    );
    return { advances, staff, cashAccounts, movedAdvanceIds };
  });

  const canManage = can(ctx, "payroll.manage");
  const openAdvances = data.advances.filter((row) => row.status === "open");
  const totalOutstanding = openAdvances.reduce((acc, row) => acc + Number(row.remainingAmount), 0);
  const employeesWithDebt = new Set(openAdvances.map((row) => row.employeeId)).size;

  const summaryByEmployee = new Map<string, { name: string; code: string; count: number; remaining: number }>();
  for (const row of openAdvances) {
    const current = summaryByEmployee.get(row.employeeId) ?? {
      name: row.employeeName,
      code: row.employeeCode,
      count: 0,
      remaining: 0,
    };
    current.count += 1;
    current.remaining += Number(row.remainingAmount);
    summaryByEmployee.set(row.employeeId, current);
  }

  return (
    <div>
      <PageHeader
        eyebrow="HR"
        title="Kasbon Karyawan"
        description="Uang muka karyawan yang menjadi piutang dan dipotong dari gaji mengikuti rencana potongan tiap kasbon."
        actions={
          canManage ? (
            <AdvanceForm
              employees={data.staff.filter((person) => person.isActive)}
              accounts={data.cashAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
            />
          ) : null
        }
      />

      <SummaryStrip
        items={[
          {
            label: "Sisa kasbon",
            value: formatIDR(totalOutstanding),
            hint: `${openAdvances.length} kasbon berjalan`,
            tone: totalOutstanding > 0 ? "amber" : "green",
          },
          {
            label: "Karyawan berutang",
            value: employeesWithDebt,
            hint: "Memiliki kasbon berjalan",
          },
          {
            label: "Sudah lunas",
            value: data.advances.filter((row) => row.status === "settled").length,
            hint: "Kasbon selesai",
            tone: "green",
          },
          {
            label: "Total dokumen",
            value: data.advances.length,
            hint: "Semua status",
          },
        ]}
      />

      {summaryByEmployee.size > 0 ? (
        <section className="mb-3 mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Sisa kasbon per karyawan</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Klik nama karyawan untuk riwayat lengkap dan setoran manual.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th className="text-right">Kasbon berjalan</th>
                  <th className="text-right">Total sisa</th>
                </tr>
              </thead>
              <tbody>
                {[...summaryByEmployee.entries()].map(([employeeId, summary]) => (
                  <tr key={employeeId}>
                    <td>
                      <Link href={`/app/akuntansi/kasbon/${employeeId}`} className="text-[12px] font-medium transition-colors hover:underline">
                        {summary.name}
                      </Link>
                      <span className="num ml-1.5 text-[11px] text-muted-foreground">{summary.code}</span>
                    </td>
                    <td className="num text-right text-[12px]">{summary.count}</td>
                    <td className="num text-right text-[12px] font-semibold">{formatIDR(summary.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <h2 className="mb-2 mt-4 text-[13px] font-semibold">Semua dokumen kasbon</h2>
      <DataList
        isEmpty={data.advances.length === 0}
        empty={
          <EmptyState title="Belum ada kasbon" description={canManage ? "Berikan kasbon pertama lewat tombol Kasbon Baru — jurnal piutang karyawan dibuat otomatis." : "Peran Anda dapat melihat; kasbon dibuat oleh peran dengan izin mengelola payroll."} icon={<HandCoins className="size-5" />} />
        }
        footerNote="Potongan berjalan otomatis saat payroll diproses; rencana tidak berubah walau potongan suatu periode dibatasi gaji bersih."
      >
        <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th aria-sort="descending">Tanggal</th>
                  <th>Karyawan</th>
                  <th className="hidden lg:table-cell">Rencana potongan</th>
                  <th className="text-right">Jumlah</th>
                  <th className="text-right">Sisa</th>
                  <th>Status</th>
                  {canManage ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.advances.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[11px] text-muted-foreground">{row.number}</td>
                    <td className="text-[12px]">{formatDate(row.date)}</td>
                    <td>
                      <Link href={`/app/akuntansi/kasbon/${row.employeeId}`} className="text-[12px] font-medium transition-colors hover:underline">
                        {row.employeeName}
                      </Link>
                      <span className="num ml-1.5 text-[11px] text-muted-foreground">{row.employeeCode}</span>
                    </td>
                    <td className="hidden text-[11px] text-muted-foreground lg:table-cell">
                      {ADVANCE_PLAN_LABELS[row.planMode] ?? row.planMode}
                      {row.planMode === "fixed" && row.planValue ? ` · ${formatIDR(row.planValue)}/periode` : ""}
                      {row.planMode === "percent" && row.planValue ? ` · ${Number(row.planValue)}%` : ""}
                    </td>
                    <td className="num text-right text-[12px]">{formatIDR(row.amount)}</td>
                    <td className="num text-right text-[12px] font-medium">{formatIDR(row.remainingAmount)}</td>
                    <td>
                      <StatusBadge status={row.status} label={ADVANCE_STATUS_LABELS[row.status]} />
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        {row.status === "open" ? (
                          <AdvanceVoidButton asMenu id={row.id} number={row.number} disabled={data.movedAdvanceIds.has(row.id)} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </DataList>
    </div>
  );
}
