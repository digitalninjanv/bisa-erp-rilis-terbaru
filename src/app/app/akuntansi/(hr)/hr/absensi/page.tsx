import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { periodRange } from "@/lib/hr";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { AttendanceTools } from "@/components/akuntansi/attendance-tools";
import {
  AttendanceEntryForm,
  AttendanceImportForm,
  ShiftAssignmentForm,
  WorkShiftManager,
} from "@/components/akuntansi/hr-panel";
import {
  getAttendanceRecap,
  listEmployeeOptions,
  listRecentAttendance,
  listWorkShifts,
} from "@/server/hr";

export const metadata = { title: "Absensi" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  present: "Hadir",
  permit: "Izin",
  sick: "Sakit",
  leave: "Cuti",
  absent: "Alpa",
};

const STATUS_TONE: Record<string, string> = {
  present: "bg-tone-green-soft text-tone-green",
  permit: "bg-tone-amber-soft text-tone-amber",
  sick: "bg-tone-amber-soft text-tone-amber",
  leave: "bg-tone-teal-soft text-tone-teal",
  absent: "bg-tone-red-soft text-tone-red",
};

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}%`;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  const { period = todayISO().slice(0, 7) } = await searchParams;
  const activePeriod = /^\d{4}-\d{2}$/.test(period) ? period : todayISO().slice(0, 7);
  const { start, end } = periodRange(activePeriod);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [shifts, staff, recap, recent] = await Promise.all([
      listWorkShifts(tx, ctx.company.id),
      listEmployeeOptions(tx, ctx.company.id, { activeOnly: true }),
      getAttendanceRecap(tx, ctx.company.id, activePeriod),
      listRecentAttendance(tx, ctx.company.id, { start, end }),
    ]);
    return { shifts, staff, recap, recent };
  });

  const totals = data.recap.reduce(
    (acc, row) => {
      acc.present += row.counts.present;
      acc.permit += row.counts.permit;
      acc.sick += row.counts.sick;
      acc.leave += row.counts.leave;
      acc.absent += row.counts.absent;
      acc.late += row.totalLateMinutes;
      return acc;
    },
    { present: 0, permit: 0, sick: 0, leave: 0, absent: 0, late: 0 },
  );
  const recordedDays = totals.present + totals.permit + totals.sick + totals.leave + totals.absent;
  const attendanceRate = recordedDays > 0 ? (totals.present / recordedDays) * 100 : null;

  return (
    <div>
      <PageHeader
        title="Absensi"
        description="Catat kehadiran harian dan pantau rekap periode. Absensi tidak mengubah payroll kecuali fitur terkait diaktifkan."
        actions={
          <form className="flex items-center gap-1.5" action="/app/akuntansi/hr/absensi">
            <label className="text-[12px] text-muted-foreground" htmlFor="period">
              Periode
            </label>
            <input
              id="period"
              type="month"
              name="period"
              defaultValue={activePeriod}
              className="h-9 rounded-md border border-input bg-background px-2 text-[12px]"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Tampilkan
            </button>
          </form>
        }
      />

      <SummaryStrip
        items={[
          {
            label: "Tingkat kehadiran",
            value: percent(attendanceRate),
            hint:
              recordedDays > 0
                ? `${totals.present} hadir dari ${recordedDays} catatan`
                : "Belum ada catatan pada periode ini",
            tone:
              attendanceRate === null
                ? "muted"
                : attendanceRate >= 90
                  ? "green"
                  : attendanceRate >= 75
                    ? "amber"
                    : "red",
          },
          {
            label: "Terlambat",
            value: `${totals.late} mnt`,
            hint: "Total menit keterlambatan periode ini",
            tone: totals.late > 0 ? "amber" : "green",
          },
          {
            label: "Izin & sakit",
            value: `${totals.permit + totals.sick} hari`,
            hint: `Izin ${totals.permit} · Sakit ${totals.sick}`,
          },
          {
            label: "Alpa & cuti",
            value: `${totals.absent + totals.leave} hari`,
            hint: `Alpa ${totals.absent} · Cuti ${totals.leave}`,
            tone: totals.absent > 0 ? "red" : "default",
          },
        ]}
      />

      {manageable ? (
        <div id="catat" className="mt-3 scroll-mt-4">
          <AttendanceEntryForm employees={data.staff} />
        </div>
      ) : null}

      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Rekap {formatMonth(activePeriod)}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {data.recap.length} karyawan punya catatan pada periode ini.
            </p>
          </div>
          <span className="num text-[11px] text-muted-foreground">
            {data.staff.length} karyawan aktif
          </span>
        </div>
        {data.recap.length === 0 ? (
          <div className="p-3">
            <EmptyState
              size="compact"
              title="Belum ada catatan"
              description={
                manageable
                  ? "Catat absensi pertama lewat formulir di atas."
                  : "Belum ada absensi tercatat pada periode ini."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th className="text-right">Hadir</th>
                  <th className="hidden text-right sm:table-cell">Izin</th>
                  <th className="hidden text-right sm:table-cell">Sakit</th>
                  <th className="hidden text-right sm:table-cell">Cuti</th>
                  <th className="text-right">Alpa</th>
                  <th className="text-right">Terlambat</th>
                </tr>
              </thead>
              <tbody>
                {data.recap.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <Link
                        href={`/app/akuntansi/karyawan/${row.employeeId}`}
                        className="text-[12px] font-medium transition-colors hover:underline"
                      >
                        {row.employeeName}
                      </Link>
                      <span className="num ml-1.5 text-[10px] text-muted-foreground">
                        {row.employeeCode}
                      </span>
                    </td>
                    <td className="num text-right text-[12px]">{row.counts.present}</td>
                    <td className="num hidden text-right text-[12px] sm:table-cell">{row.counts.permit}</td>
                    <td className="num hidden text-right text-[12px] sm:table-cell">{row.counts.sick}</td>
                    <td className="num hidden text-right text-[12px] sm:table-cell">{row.counts.leave}</td>
                    <td className="num text-right text-[12px]">{row.counts.absent}</td>
                    <td className="num text-right text-[12px]">
                      {row.totalLateMinutes > 0 ? `${row.totalLateMinutes} mnt` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.recent.length > 0 ? (
        <details className="mt-3 rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] font-semibold">Catatan harian</span>
            <span className="num rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {data.recent.length}
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">Lihat rincian</span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Karyawan</th>
                  <th>Status</th>
                  <th>Masuk</th>
                  <th>Pulang</th>
                  <th className="text-right">Terlambat</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[11px]">{formatDate(row.date)}</td>
                    <td className="text-[12px]">{row.employeeName}</td>
                    <td>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          STATUS_TONE[row.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="num text-[11px]">{row.checkIn?.slice(0, 5) ?? "—"}</td>
                    <td className="num text-[11px]">{row.checkOut?.slice(0, 5) ?? "—"}</td>
                    <td className="num text-right text-[11px]">
                      {row.lateMinutes > 0 ? `${row.lateMinutes} mnt` : "—"}
                    </td>
                    <td className="text-[11px] text-muted-foreground">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {manageable ? (
        <details className="mt-3 rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] font-semibold">Alat shift & impor</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              Penugasan, master shift, impor CSV
            </span>
          </summary>
          <div className="border-t border-border px-4 pb-4">
            <AttendanceTools
              tabs={[
                {
                  key: "penugasan",
                  label: "Penugasan shift",
                  content: (
                    <ShiftAssignmentForm
                      employees={data.staff}
                      shifts={data.shifts
                        .filter((row) => row.isActive)
                        .map((row) => ({ id: row.id, name: row.name }))}
                    />
                  ),
                },
                {
                  key: "shift",
                  label: "Master shift",
                  content: (
                    <WorkShiftManager
                      rows={data.shifts.map((row) => ({
                        id: row.id,
                        code: row.code,
                        name: row.name,
                        startTime: row.startTime,
                        endTime: row.endTime,
                        workDays: row.workDays,
                        isActive: row.isActive,
                      }))}
                    />
                  ),
                },
                {
                  key: "impor",
                  label: "Impor CSV",
                  content: <AttendanceImportForm />,
                },
              ]}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
