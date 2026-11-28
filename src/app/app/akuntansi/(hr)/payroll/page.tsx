import Link from "next/link";
import { HandCoins, Users } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { d, formatIDR } from "@/lib/money";
import { formatMonth, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { DataList } from "@/components/blocks/data-list";
import { getPayrollPageData } from "@/server/hr";
import { EmployeeForm, PayrollVoidButton } from "@/components/akuntansi/payroll-panel";
import { PayrollWizard } from "@/components/akuntansi/payroll-wizard";

export const metadata = { title: "Payroll" };
export const dynamic = "force-dynamic";

/**
 * Satu halaman sederhana untuk direktori karyawan, komponen gaji,
 * pemrosesan payroll bulanan, dan riwayat run.
 */
export default async function PayrollPage() {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  // A-28 Tahap 5 (H-HR-01): angka gaji level field — hanya tampil
  // bagi pemegang payroll.salary; pemegang payroll.manage tetap
  // melihat angka yang ia proses (permukaan operasionalnya).
  // Pemegang payroll.view saja melihat struktur (nama, jabatan,
  // status, periode) tanpa satu pun nominal gaji.
  const canSeeSalary = can(ctx, "payroll.salary") || manageable;

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getPayrollPageData(tx, ctx.company.id),
  );

  const active = data.staff.filter((row) => row.isActive);
  const monthlyGross = active.reduce(
    (acc, row) => acc.plus(d(row.baseSalary)).plus(d(row.allowances)),
    d(0),
  );
  const monthlyNet = active.reduce(
    (acc, row) => acc.plus(d(row.baseSalary)).plus(d(row.allowances)).minus(d(row.deductions)),
    d(0),
  );

  return (
    <div>
      <PageHeader
        title="Karyawan"
        description="Data karyawan, gaji bulanan, dan riwayat pembayaran di satu tempat."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/akuntansi/kasbon"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <HandCoins className="size-3.5" /> Kasbon karyawan
            </Link>
            {manageable ? <EmployeeForm orgOptions={data.orgOptions} /> : null}
          </div>
        }
      />

      <SummaryStrip
        items={[
          {
            label: "Karyawan aktif",
            value: active.length,
            hint: `${data.staff.length} total karyawan`,
          },
          {
            label: "Gaji kotor / bulan",
            value: canSeeSalary ? formatIDR(monthlyGross) : "Dirahasiakan",
            hint: canSeeSalary ? "Pokok + tunjangan tetap" : "Butuh izin lihat angka gaji",
          },
          {
            label: "Perkiraan gaji / bulan",
            value: canSeeSalary ? formatIDR(monthlyNet) : "Dirahasiakan",
            hint: canSeeSalary ? "Setelah potongan tetap, sebelum cicilan kasbon" : "Butuh izin lihat angka gaji",
          },
          {
            label: "Payroll diproses",
            value: data.runs.length,
            hint:
              data.runs.length > 0
                ? `Terakhir ${formatMonth(data.runs[0].period)}`
                : "Belum ada periode diproses",
          },
        ]}
      />

      {manageable ? (
        <div className="mt-4 mb-4">
          <PayrollWizard
            defaultPeriod={todayISO().slice(0, 7)}
            processedRuns={data.runs
              .filter((run) => run.kind === "regular" && run.status !== "void")
              .map((run) => ({ id: run.id, number: run.number, period: run.period }))}
            advanceProposals={data.advanceProposals.map((row) => ({
              employeeId: row.employeeId,
              employeeName: row.employeeName,
              openTotal: row.openTotal,
              proposed: row.proposed,
            }))}
            staff={data.staff.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              position: row.position,
              baseSalary: row.baseSalary,
              allowances: row.allowances,
              deductions: row.deductions,
              isActive: row.isActive,
            }))}
          />
        </div>
      ) : null}

      <h2 className="mb-2 mt-5 text-[13px] font-semibold">Daftar karyawan</h2>
      <DataList density="compact"
        isEmpty={data.staff.length === 0}
        empty={
          <EmptyState
            title="Belum ada karyawan"
            description={manageable ? "Tambahkan karyawan untuk memulai proses payroll." : "Peran Anda dapat melihat; karyawan dikelola oleh peran dengan izin mengelola payroll."}
            icon={<Users className="size-5" />}
          />
        }
      >
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Tabel daftar karyawan payroll"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th className="hidden md:table-cell">Jabatan</th>
                {canSeeSalary ? (
                  <>
                    <th className="hidden text-right lg:table-cell">Pokok</th>
                    <th className="hidden text-right xl:table-cell">Tunjangan</th>
                    <th className="hidden text-right lg:table-cell">Potongan</th>
                    <th className="hidden text-right md:table-cell">Bersih</th>
                  </>
                ) : null}
                <th className="hidden md:table-cell">Status</th>
                {manageable ? <th className="text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.staff.map((row) => {
                const net = d(row.baseSalary).plus(d(row.allowances)).minus(d(row.deductions));
                return (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/app/akuntansi/karyawan/${row.id}`} className="text-[12px] font-medium transition-colors hover:underline">
                        {row.name}
                      </Link>
                      <span className="num ml-1.5 text-[11px] text-muted-foreground">{row.code}</span>
                      <span
                        className={`ml-1.5 text-[11px] font-medium md:hidden ${
                          row.isActive ? "text-tone-green" : "text-muted-foreground"
                        }`}
                      >
                        {row.isActive ? "Aktif" : "Nonaktif"}
                      </span>
                      {canSeeSalary ? (
                        <span className="num block text-[11px] text-muted-foreground md:hidden">
                          Bersih {formatIDR(net)}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden text-[11px] text-muted-foreground md:table-cell">{row.position ?? "—"}</td>
                    {canSeeSalary ? (
                      <>
                        <td className="num hidden text-right text-[11px] lg:table-cell">{formatIDR(row.baseSalary)}</td>
                        <td className="num hidden text-right text-[11px] xl:table-cell">{formatIDR(row.allowances)}</td>
                        <td className="num hidden text-right text-[11px] lg:table-cell">{formatIDR(row.deductions)}</td>
                        <td className="num hidden text-right font-medium md:table-cell">{formatIDR(net)}</td>
                      </>
                    ) : null}
                    <td className="hidden md:table-cell">
                      <StatusBadge status={row.isActive ? "active" : "inactive"} />
                    </td>
                    {manageable ? (
                      <td className="text-right">
                        <EmployeeForm
                          employee={{
                            id: row.id,
                            code: row.code,
                            name: row.name,
                            position: row.position,
                            baseSalary: row.baseSalary,
                            allowances: row.allowances,
                            deductions: row.deductions,
                            joinedAt: row.joinedAt,
                            isActive: row.isActive,
                            nik: row.nik,
                            npwp: row.npwp,
                            ptkpStatus: row.ptkpStatus,
                            contractType: row.contractType,
                            jkkRiskClass: row.jkkRiskClass,
                            workRegionCode: row.workRegionCode,
                            departmentId: row.departmentId,
                            positionId: row.positionId,
                            managerEmployeeId: row.managerEmployeeId,
                            branchId: row.branchId,
                            contractStart: row.contractStart,
                            contractEnd: row.contractEnd,
                            statutoryEnrollments: data.enrollmentsByEmployee.get(row.id) ?? {},
                          }}
                          orgOptions={data.orgOptions}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataList>

      <h2 className="mb-2 mt-5 text-[13px] font-semibold">Riwayat payroll</h2>
      <DataList density="compact"
        isEmpty={data.runs.length === 0}
        empty={
          <EmptyState
            size="compact"
            title="Belum ada payroll diproses"
            description={manageable ? "Jalankan payroll pertama lewat wizard di atas." : "Run payroll yang diproses akan tampil di sini."}
          />
        }
      >
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Tabel riwayat payroll"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Periode</th>
                <th>Nomor</th>
                {canSeeSalary ? (
                  <>
                    <th className="text-right">Bruto</th>
                    <th className="text-right">Potongan</th>
                    <th className="text-right">Bersih</th>
                  </>
                ) : null}
                <th>Status</th>
                {manageable ? <th className="text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  {/* A-28 UI-4 (UX-C02): tautan detail menempel pada
                      NOMOR run seperti semua daftar dokumen lain —
                      periode kembali menjadi teks polos. */}
                  <td className="text-[12px] font-medium">
                    {formatMonth(run.period)}
                    {run.kind === "final" ? (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">pembayaran akhir</span>
                    ) : null}
                  </td>
                  <td className="num text-[11px]">
                    <Link
                      href={`/app/akuntansi/payroll/${run.id}`}
                      className="font-medium text-primary transition-colors hover:underline"
                    >
                      {run.number}
                    </Link>
                  </td>
                  {canSeeSalary ? (
                    <>
                      <td className="num text-right text-[12px]">{formatIDR(run.totalGross)}</td>
                      <td className="num text-right text-[12px]">
                        {formatIDR(run.totalDeductions)}
                        {Number(run.totalPph21) !== 0 ? (
                          <span className="block text-[11px] font-normal text-muted-foreground">PPh 21 {formatIDR(run.totalPph21)}</span>
                        ) : null}
                        {Number(run.totalStatutoryEmployee) > 0 ? (
                          <span className="block text-[11px] font-normal text-muted-foreground">BPJS pekerja {formatIDR(run.totalStatutoryEmployee)}</span>
                        ) : null}
                      </td>
                      <td className="num text-right text-[12px] font-semibold">{formatIDR(run.totalNet)}</td>
                    </>
                  ) : null}
                  <td>
                    <StatusBadge
                      status={run.status}
                      label={run.status === "paid" ? "Dibayar" : run.status === "void" ? "Dibatalkan" : undefined}
                    />
                  </td>
                  {manageable ? (
                    <td className="text-right">
                      {run.status === "posted" ? <PayrollVoidButton asMenu id={run.id} number={run.number} /> : null}
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
