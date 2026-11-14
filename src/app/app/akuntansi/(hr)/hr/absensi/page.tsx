import Link from "next/link";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";
import { DateField } from "@/components/date-field";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { AttendanceTools } from "@/components/akuntansi/attendance-tools";
import {
  AttendanceBatchForm,
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
  searchParams: Promise<{ date?: string; period?: string }>;
}) {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  const params = await searchParams;
  const fallbackDate = params.period && /^\d{4}-\d{2}$/.test(params.period) ? `${params.period}-01` : todayISO();
  const requestedDate = params.date ?? fallbackDate;
  const activeDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayISO();
  const activePeriod = activeDate.slice(0, 7);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [shifts, staff, recap, recent] = await Promise.all([
      listWorkShifts(tx, ctx.company.id),
      listEmployeeOptions(tx, ctx.company.id, { activeOnly: true }),
      getAttendanceRecap(tx, ctx.company.id, activePeriod),
      listRecentAttendance(tx, ctx.company.id, { start: activeDate, end: activeDate }),
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
        description="Isi status dan jam hadir dari satu daftar harian; rekap bulanan tersedia di bawah."
        actions={
          <AutoFilterForm className="flex items-center gap-1.5" action="/app/akuntansi/hr/absensi">
            <label className="text-[12px] text-muted-foreground" htmlFor="date">
              Tanggal
            </label>
            <DateField
              id="date"
              name="date"
              defaultValue={activeDate}
              aria-label="Tanggal absensi"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Tampilkan
            </button>
          </AutoFilterForm>
        }
      />

      {manageable ? (
        <div className="mt-3">
          <AttendanceBatchForm
            key={activeDate}
            date={activeDate}
            employees={data.staff}
            records={data.recent.map((row) => ({
              employeeId: row.employeeId,
              status: row.status as "present" | "permit" | "sick" | "leave" | "absent",
              checkIn: row.checkIn,
              checkOut: row.checkOut,
              note: row.note,
            }))}
          />
        </div>
      ) : null}

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
          <>
            <div className="hidden overflow-x-auto sm:block">
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
            <div className="divide-y divide-border/70 sm:hidden">
              {data.recap.map((row) => (
                <div key={row.employeeId} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/app/akuntansi/karyawan/${row.employeeId}`}
                      className="text-[13px] font-medium text-foreground hover:underline"
                    >
                      {row.employeeName}
                    </Link>
                    <span className="num text-[11px] text-muted-foreground">{row.employeeCode}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 rounded border border-border/60 bg-muted/20 p-2 text-[11px]">
                    <div>
                      <span className="block text-[10px] text-muted-foreground">Hadir</span>
                      <span className="num font-semibold text-tone-green">{row.counts.present} hari</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted-foreground">Izin / Sakit</span>
                      <span className="num font-medium text-tone-amber">{row.counts.permit + row.counts.sick} hari</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted-foreground">Cuti / Alpa</span>
                      <span className="num font-medium">{row.counts.leave} / {row.counts.absent}</span>
                    </div>
                  </div>
                  {row.totalLateMinutes > 0 ? (
                    <p className="mt-1.5 text-[11px] font-medium text-tone-amber">
                      Terlambat: {row.totalLateMinutes} menit
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="text-[13px] font-semibold">Catatan tanggal {formatDate(activeDate)}</h2>
          <span className="num rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {data.recent.length}
          </span>
        </div>
        {data.recent.length > 0 ? (
          <div className="overflow-x-auto border-t border-border">
            <table className="data-table">
              <thead>
                <tr>
                  <th aria-sort="descending">Tanggal</th>
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
        ) : (
          <p className="border-t border-border px-4 py-4 text-[12px] text-muted-foreground">Belum ada catatan pada tanggal ini.</p>
        )}
      </section>

      {manageable ? (
        <details className="mt-3 rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] font-semibold">Koreksi satu catatan</span>
            <span className="ml-auto text-[11px] text-muted-foreground">Termasuk catatan tambahan</span>
          </summary>
          <div className="border-t border-border p-3">
            <AttendanceEntryForm employees={data.staff} defaultDate={activeDate} />
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
