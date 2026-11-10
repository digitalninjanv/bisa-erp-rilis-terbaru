import { withCompany } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatDate, todayISO } from "@/lib/format";
import { formatQty } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { DataList } from "@/components/blocks/data-list";
import { StatusBadge } from "@/components/blocks/status-badge";
import {
  LeaveDecisionButtons,
  LeaveRequestForm,
  LeaveTypeManager,
} from "@/components/akuntansi/hr-panel";
import {
  ensureDefaultLeaveTypes,
  listEmployeeOptions,
  listLeaveBalances,
  listLeaveRequests,
  listLeaveTypes,
} from "@/server/hr";

export const metadata = { title: "Cuti" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disahkan",
  rejected: "Ditolak",
};

export default async function LeavePage() {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  const year = Number(todayISO().slice(0, 4));

  // withCompany (bukan read-only): kunjungan pertama menanam jenis cuti bawaan.
  const data = await withCompany(ctx.company.id, async (tx) => {
    await ensureDefaultLeaveTypes(tx, ctx.company.id);
    const [types, staff, requests] = await Promise.all([
      listLeaveTypes(tx, ctx.company.id),
      listEmployeeOptions(tx, ctx.company.id, { activeOnly: true }),
      listLeaveRequests(tx, ctx.company.id),
    ]);
    const balances = await listLeaveBalances(tx, ctx.company.id, year, staff, types);
    return { types, staff, requests, balances };
  });

  return (
    <div>
      <PageHeader
        title="Cuti"
        description="Jenis cuti terkonfigurasi, saldo per karyawan, dan pengajuan dengan persetujuan atasan. Cuti tidak berbayar memotong payroll hanya bila saklarnya aktif."
      />

      <div className="grid gap-3 xl:grid-cols-2">
        {manageable ? (
          <LeaveTypeManager
            rows={data.types.map((row) => ({
              id: row.id, code: row.code, name: row.name,
              daysPerYear: row.daysPerYear, isPaid: row.isPaid, isActive: row.isActive,
            }))}
          />
        ) : null}
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Saldo cuti berjatah — tahun {year}</h2>
          </div>
          {data.balances.length === 0 ? (
            <EmptyState title="Tidak ada saldo berjatah" description="Belum ada jenis cuti berjatah atau karyawan aktif." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Karyawan</th>
                    <th>Jenis</th>
                    <th className="text-right">Jatah</th>
                    <th className="text-right">Terbawa</th>
                    <th className="text-right">Terpakai</th>
                    <th className="text-right">Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map((row) => (
                    <tr key={`${row.employeeId}-${row.typeName}`}>
                      <td className="text-[12px] font-medium">{row.employeeName}</td>
                      <td className="text-[12px]">{row.typeName}</td>
                      <td className="num text-right">{row.quota == null ? "—" : formatQty(row.quota)}</td>
                      <td className="num text-right">{formatQty(row.carryOver)}</td>
                      <td className="num text-right">{formatQty(row.used)}</td>
                      <td className="num text-right font-medium">{row.available == null ? "—" : formatQty(row.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {manageable ? (
        <div className="mt-3">
          <LeaveRequestForm
            employees={data.staff}
            leaveTypes={data.types.filter((row) => row.isActive).map((row) => ({ id: row.id, name: row.name }))}
          />
        </div>
      ) : null}

      <h2 className="mb-2 mt-5 text-[13px] font-semibold">Pengajuan cuti</h2>
      <DataList
        isEmpty={data.requests.length === 0}
        empty={<EmptyState title="Belum ada pengajuan" description="Belum ada pengajuan cuti tercatat." />}
        footerNote={
          manageable
            ? "Pengajuan yang menunggu juga terkumpul di halaman Persetujuan bersama lembur & klaim."
            : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Jenis</th>
                <th>Rentang</th>
                <th className="text-right">Hari</th>
                <th>Alasan</th>
                <th>Status</th>
                {manageable ? <th className="text-right">Keputusan</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.requests.map((row) => (
                <tr key={row.id}>
                  <td className="text-[12px] font-medium">{row.employeeName}</td>
                  <td className="text-[12px]">{row.typeName}</td>
                  <td className="num text-[11px]">{formatDate(row.startDate)} s.d. {formatDate(row.endDate)}</td>
                  <td className="num text-right">{row.days}</td>
                  <td className="text-[11px] text-muted-foreground">{row.reason ?? "—"}</td>
                  <td>
                    <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />
                    {row.decisionNote ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.decisionNote}</span> : null}
                  </td>
                  {manageable ? (
                    <td className="text-right">{row.status === "pending" ? <LeaveDecisionButtons id={row.id} /> : null}</td>
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
