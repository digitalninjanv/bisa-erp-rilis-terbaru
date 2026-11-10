import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarCheck,
  ClipboardCheck,
  FileWarning,
  Users,
} from "lucide-react";
import { withCompany } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate, formatMonth, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { ForbiddenBanner } from "@/components/blocks/forbidden-banner";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { WorkQueue } from "@/components/blocks/work-queue";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import {
  getAttendanceRecap,
  getPayrollPageData,
  listExpiringContracts,
  listLeaveRequests,
  listOvertimeRequests,
  listRecentAttendance,
} from "@/server/hr";
import { listEmployeeAdvances } from "@/server/employee-advances";
import { listEmployeeLoans } from "@/server/employee-loans";
import { countPendingReimbursementClaims } from "@/server/reimbursements";

export const metadata = { title: "Ringkasan HR" };
export const dynamic = "force-dynamic";

const CONTRACT_LABELS: Record<string, string> = {
  pkwtt: "Tetap",
  pkwt: "Kontrak",
  harian: "Harian",
  magang: "Magang",
};

const ATTENDANCE_LABELS: Record<string, string> = {
  present: "Hadir",
  permit: "Izin",
  sick: "Sakit",
  leave: "Cuti",
  absent: "Alpa",
};

const ATTENDANCE_TONE: Record<string, string> = {
  present: "bg-tone-green-soft text-tone-green",
  permit: "bg-tone-amber-soft text-tone-amber",
  sick: "bg-tone-amber-soft text-tone-amber",
  leave: "bg-tone-teal-soft text-tone-teal",
  absent: "bg-tone-red-soft text-tone-red",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  posted: "Terposting",
  paid: "Dibayar",
  void: "Dibatalkan",
};

export default async function HrOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  const canSeeSalary = can(ctx, "payroll.salary") || manageable;
  const today = todayISO();
  const period = today.slice(0, 7);

  const data = await withCompany(ctx.company.id, async (tx) => {
    const [payroll, recap, todayRecords, advances, loans, leaves, overtimes, claims, expiring] =
      await Promise.all([
        getPayrollPageData(tx, ctx.company.id),
        getAttendanceRecap(tx, ctx.company.id, period),
        listRecentAttendance(tx, ctx.company.id, { start: today, end: today }),
        listEmployeeAdvances(tx, ctx.company.id),
        listEmployeeLoans(tx, ctx.company.id),
        listLeaveRequests(tx, ctx.company.id),
        listOvertimeRequests(tx, ctx.company.id, { start: "2000-01-01", end: "2100-12-31" }),
        countPendingReimbursementClaims(tx, ctx.company.id),
        listExpiringContracts(tx, ctx.company.id),
      ]);
    return { payroll, recap, todayRecords, advances, loans, leaves, overtimes, claims, expiring };
  });

  const activeStaff = data.payroll.staff.filter((row) => row.isActive);
  const currentRun = data.payroll.runs.find(
    (run) => run.period === period && run.kind === "regular" && run.status !== "void",
  );
  const openAdvances = data.advances.filter((row) => row.status === "open");
  const openLoans = data.loans.filter((row) => row.status === "open");
  const debtTotal = [...openAdvances, ...openLoans].reduce(
    (acc, row) => acc + Number(row.remainingAmount),
    0,
  );
  const pendingLeaves = data.leaves.filter((row) => row.status === "pending");
  const pendingOvertimes = data.overtimes.filter((row) => row.status === "pending");
  const pendingTotal = pendingLeaves.length + pendingOvertimes.length + data.claims.count;
  const pendingDetail = [
    pendingLeaves.length > 0 ? `${pendingLeaves.length} cuti` : null,
    pendingOvertimes.length > 0 ? `${pendingOvertimes.length} lembur` : null,
    data.claims.count > 0 ? `${data.claims.count} klaim` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const recordedToday = new Set(data.todayRecords.map((row) => row.employeeId));
  const presentToday = data.todayRecords.filter((row) => row.status === "present").length;
  const notRecorded = Math.max(0, activeStaff.length - recordedToday.size);
  const recapById = new Map(data.recap.map((row) => [row.employeeId, row]));
  const nextContract = data.expiring[0];

  const payrollNeedsAction = !currentRun || currentRun.status === "posted";

  return (
    <div>
      <PageHeader
        title="Ringkasan HR"
        description="Karyawan, kehadiran, kasbon, dan payroll bulan ini dalam satu tampilan."
        actions={
          <>
            <Link
              href={manageable ? "/app/akuntansi/hr/absensi#catat" : "/app/akuntansi/hr/absensi"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <CalendarCheck className="size-3.5" />
              {manageable ? "Catat absensi" : "Buka absensi"}
            </Link>
            <Link
              href="/app/akuntansi/payroll"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <BadgeDollarSign className="size-3.5" />
              Buka payroll
            </Link>
          </>
        }
      />

      {params.forbidden ? (
        <div className="mb-4">
          <ForbiddenBanner permission={params.forbidden} />
        </div>
      ) : null}

      <SummaryStrip
        items={[
          {
            label: "Karyawan aktif",
            value: activeStaff.length,
            hint:
              data.expiring.length > 0
                ? `${data.payroll.staff.length} total · ${data.expiring.length} kontrak berakhir`
                : `${data.payroll.staff.length} total karyawan`,
          },
          {
            label: `Payroll ${formatMonth(period)}`,
            value: canSeeSalary
              ? currentRun
                ? formatIDR(currentRun.totalNet)
                : "Belum diproses"
              : currentRun
                ? "Sudah diproses"
                : "Belum diproses",
            hint: canSeeSalary
              ? currentRun
                ? `Bruto ${formatIDR(currentRun.totalGross)} · ${RUN_STATUS_LABELS[currentRun.status] ?? currentRun.status}`
                : "Buka payroll untuk memproses gaji bulan ini"
              : "Nominal gaji hanya untuk pemegang izin lihat gaji",
            tone: payrollNeedsAction ? "amber" : "green",
            href: "/app/akuntansi/payroll",
          },
          {
            label: "Kasbon & pinjaman",
            value: formatIDR(debtTotal),
            hint: `${openAdvances.length} kasbon · ${openLoans.length} pinjaman berjalan`,
            tone: debtTotal > 0 ? "amber" : "green",
            href: "/app/akuntansi/kasbon",
          },
          {
            label: "Hadir hari ini",
            value: `${presentToday}/${activeStaff.length}`,
            hint:
              notRecorded > 0
                ? `${notRecorded} karyawan belum dicatat`
                : "Semua karyawan aktif sudah tercatat",
            tone: notRecorded > 0 ? "amber" : "green",
            href: "/app/akuntansi/hr/absensi",
          },
        ]}
      />

      <WorkQueue
        className="mt-5"
        title="Perlu tindakan"
        items={[
          {
            key: "persetujuan",
            label: "Persetujuan HR",
            count: pendingTotal,
            headline: `${pendingTotal} pengajuan menunggu`,
            detail: pendingDetail || "Cuti, lembur, dan klaim yang menunggu keputusan.",
            href: "/app/akuntansi/hr/persetujuan",
            actionLabel: "Tinjau pengajuan",
            tone: "amber",
            icon: <ClipboardCheck className="size-4" />,
          },
          {
            key: "kontrak",
            label: "Kontrak berakhir",
            count: data.expiring.length,
            headline: `${data.expiring.length} kontrak mendekati akhir`,
            detail: nextContract
              ? `${nextContract.employeeName} · ${nextContract.daysLeft} hari lagi`
              : undefined,
            href: "/app/akuntansi/hr/pengaturan",
            actionLabel: "Tinjau kontrak",
            tone: "red",
            icon: <FileWarning className="size-4" />,
          },
          {
            key: "payroll",
            label: "Payroll bulan ini",
            count: payrollNeedsAction ? 1 : 0,
            headline: currentRun
              ? `Payroll ${formatMonth(period)} belum dibayar`
              : `Payroll ${formatMonth(period)} belum diproses`,
            detail: currentRun
              ? `Run ${currentRun.number} berstatus ${RUN_STATUS_LABELS[currentRun.status] ?? currentRun.status}.`
              : "Hitung gaji, potongan, dan kasbon lewat wizard payroll.",
            href: currentRun ? `/app/akuntansi/payroll/${currentRun.id}` : "/app/akuntansi/payroll",
            actionLabel: currentRun ? "Buka run payroll" : "Proses payroll",
            tone: "teal",
            icon: <BadgeDollarSign className="size-4" />,
          },
          {
            key: "absensi",
            label: "Absensi hari ini",
            count: notRecorded,
            headline: `${notRecorded} karyawan belum dicatat`,
            detail: `${recordedToday.size} dari ${activeStaff.length} karyawan sudah punya catatan hari ini.`,
            href: manageable ? "/app/akuntansi/hr/absensi#catat" : "/app/akuntansi/hr/absensi",
            actionLabel: manageable ? "Catat absensi" : "Lihat absensi",
            tone: "amber",
            icon: <CalendarCheck className="size-4" />,
          },
        ]}
      />

      <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="self-start overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Karyawan</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Kehadiran dihitung dari catatan periode {formatMonth(period)}.
              </p>
            </div>
            <Link
              href="/app/akuntansi/payroll"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline"
            >
              Lihat karyawan <ArrowRight className="size-3" />            </Link>
          </div>

          {activeStaff.length === 0 ? (
            <div className="p-3">
              <EmptyState
                size="compact"
                title="Belum ada karyawan aktif"
                description={
                  manageable
                    ? "Tambahkan karyawan lewat halaman Payroll & Karyawan."
                    : "Karyawan aktif akan tampil di sini setelah ditambahkan."
                }
                icon={<Users className="size-5" />}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Karyawan</th>
                    <th className="hidden md:table-cell">Jabatan</th>
                    <th className="hidden md:table-cell">Kontrak</th>
                    <th className="text-right">Hadir</th>
                    {canSeeSalary ? <th className="hidden text-right sm:table-cell">Gaji bersih</th> : null}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStaff.slice(0, 8).map((person) => {
                    const attendance = recapById.get(person.id);
                    const net =
                      Number(person.baseSalary) + Number(person.allowances) - Number(person.deductions);
                    return (
                      <tr key={person.id}>
                        <td>
                          <Link
                            href={`/app/akuntansi/karyawan/${person.id}`}
                            className="text-[12px] font-medium transition-colors hover:underline"
                          >
                            {person.name}
                          </Link>
                          <span className="num ml-1.5 text-[10px] text-muted-foreground">
                            {person.code}
                          </span>
                        </td>
                        <td className="hidden text-[11px] text-muted-foreground md:table-cell">{person.position ?? "—"}</td>
                        <td className="hidden text-[11px] md:table-cell">
                          {person.contractType
                            ? CONTRACT_LABELS[person.contractType] ?? person.contractType
                            : "—"}
                          {person.contractType === "pkwt" && person.contractEnd ? (
                            <span className="block text-[10px] text-muted-foreground">
                              s.d. {formatDate(person.contractEnd)}
                            </span>
                          ) : null}
                        </td>
                        <td className="num text-right text-[12px]">
                          {attendance ? `${attendance.counts.present} hari` : "—"}
                        </td>
                        {canSeeSalary ? (
                          <td className="num hidden text-right text-[12px] sm:table-cell">{formatIDR(net)}</td>
                        ) : null}
                        <td>
                          <StatusBadge status={person.isActive ? "active" : "inactive"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {activeStaff.length > 8 ? (
            <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              Menampilkan 8 dari {activeStaff.length} karyawan aktif.{" "}
              <Link href="/app/akuntansi/payroll" className="font-medium text-primary hover:underline">
                Lihat semua
              </Link>
            </p>
          ) : null}
        </section>

        <aside className="space-y-3">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">Absensi hari ini</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(today)}</p>
              </div>
              <Link
                href="/app/akuntansi/hr/absensi"
                className="text-[11px] font-medium text-primary transition-colors hover:underline"
              >
                Buka
              </Link>
            </div>
            {data.todayRecords.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  size="compact"
                  title="Belum ada catatan"
                  description="Catat kehadiran karyawan untuk hari ini."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {data.todayRecords.slice(0, 6).map((row) => (
                  <li key={row.id} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium">{row.employeeName}</p>
                      <p className="num text-[10px] text-muted-foreground">
                        {row.checkIn?.slice(0, 5) ?? "—"}–{row.checkOut?.slice(0, 5) ?? "—"}
                        {row.lateMinutes > 0 ? ` · telat ${row.lateMinutes} mnt` : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        ATTENDANCE_TONE[row.status] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ATTENDANCE_LABELS[row.status] ?? row.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.todayRecords.length > 6 ? (
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                +{data.todayRecords.length - 6} catatan lainnya
              </p>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Kontrak berakhir</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                PKWT dalam masa peringatan.
              </p>
            </div>
            {data.expiring.length === 0 ? (
              <p className="px-4 py-3 text-[11px] text-muted-foreground">
                Tidak ada kontrak yang berakhir dalam waktu dekat.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {data.expiring.slice(0, 5).map((row) => (
                  <li key={row.employeeId} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/akuntansi/karyawan/${row.employeeId}`}
                        className="block truncate text-[12px] font-medium transition-colors hover:underline"
                      >
                        {row.employeeName}
                      </Link>
                      <p className="num text-[10px] text-muted-foreground">
                        {formatDate(row.contractEnd)}
                      </p>
                    </div>
                    <span
                      className={`num rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        row.daysLeft <= 7
                          ? "bg-tone-red-soft text-tone-red"
                          : "bg-tone-amber-soft text-tone-amber"
                      }`}
                    >
                      {row.daysLeft} hari
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border px-4 py-2.5">
              <Link
                href="/app/akuntansi/hr/pengaturan"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline"
              >
                Pengaturan kontrak <ArrowRight className="size-3" />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
