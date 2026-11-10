import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Landmark, Wallet } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { listCashBankAccounts } from "@/server/accounting";
import {
  LOAN_ENTRY_KIND_LABELS,
  LOAN_PLAN_LABELS,
  LOAN_STATUS_LABELS,
  getEmployeeLoanHistory,
} from "@/server/employee-loans";
import { listPayrollRunsByIds } from "@/server/hr";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { LoanVoidButton, RepayLoanForm } from "@/components/akuntansi/loan-panel";

export const metadata = { title: "Riwayat Pinjaman Karyawan" };
export const dynamic = "force-dynamic";

export default async function PinjamanEmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  const ctx = await requirePermissionPage("payroll.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const history = await getEmployeeLoanHistory(tx, ctx.company.id, employeeId);
    if (!history) return null;
    const cashAccounts = await listCashBankAccounts(tx, ctx.company.id);
    const runs = await listPayrollRunsByIds(tx, ctx.company.id, history.runIds);
    return { ...history, cashAccounts, runs };
  });

  if (!data) notFound();
  const { employee, loans, entries } = data;
  const canManage = can(ctx, "payroll.manage");
  const openLoans = loans.filter((row) => row.status === "open");
  const openTotal = openLoans.reduce((acc, row) => acc + Number(row.remainingAmount), 0);
  const totalGiven = loans
    .filter((row) => row.status !== "void")
    .reduce((acc, row) => acc + Number(row.amount), 0);
  const runById = new Map(data.runs.map((run) => [run.id, run]));
  const movedLoanIds = new Set(entries.map((entry) => entry.loanId));

  const timeline: Array<{
    key: string;
    date: string;
    kind: string;
    label: string;
    amount: string;
    journalId: string | null;
    note: string | null;
  }> = [
    ...loans
      .filter((row) => row.status !== "void")
      .map((row) => ({
        key: `loan-${row.id}`,
        date: row.date,
        kind: "disbursement",
        label: `Pinjaman ${row.number} diberikan`,
        amount: row.amount,
        journalId: row.journalId,
        note: row.note,
      })),
    ...entries.map((entry) => ({
      key: `entry-${entry.id}`,
      date: entry.date,
      kind: entry.kind,
      label:
        entry.kind === "payroll_deduction" && entry.payrollRunId && runById.get(entry.payrollRunId)
          ? `Cicilan payroll ${runById.get(entry.payrollRunId)!.number} (pinjaman ${entry.loanNumber})`
          : `${LOAN_ENTRY_KIND_LABELS[entry.kind] ?? entry.kind} (pinjaman ${entry.loanNumber})`,
      amount: entry.amount,
      journalId: entry.journalId,
      note: entry.note,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  return (
    <div>
      <Link href="/app/akuntansi/pinjaman" className="mb-2 inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3" /> Semua pinjaman
      </Link>
      <PageHeader
        eyebrow="HR · Pinjaman"
        title={employee.name}
        description={`${employee.code}${employee.position ? ` · ${employee.position}` : ""} — riwayat pinjaman, cicilan payroll, dan setoran manual.`}
      />

      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Sisa pinjaman" value={formatIDR(openTotal)} hint={`${openLoans.length} pinjaman berjalan`} icon={Landmark} tone="amber" />
        <StatCard label="Total pernah diberikan" value={formatIDR(totalGiven)} hint="Di luar yang dibatalkan" tone="plum" />
        {/* A-28 Tahap 5 (H-HR-01): gaji pokok adalah angka gaji —
            hanya tampil bagi payroll.salary / payroll.manage. */}
        <StatCard label="Gaji pokok" value={can(ctx, "payroll.salary") || canManage ? formatIDR(employee.baseSalary) : "•••"} hint={can(ctx, "payroll.salary") || canManage ? "Acuan kemampuan cicilan" : "Butuh izin lihat angka gaji"} tone="teal" />
        <StatCard label="Status karyawan" value={employee.isActive ? "Aktif" : "Nonaktif"} hint={employee.isActive ? "Bisa menerima pinjaman" : "Tidak bisa menerima pinjaman baru"} tone="green" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-3">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Dokumen pinjaman</h2>
            </div>
            {loans.length === 0 ? (
              <EmptyState title="Belum ada pinjaman" description="Karyawan ini belum pernah menerima pinjaman." icon={<Wallet className="size-5" />} />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nomor</th>
                      <th>Tanggal</th>
                      <th>Rencana cicilan</th>
                      <th className="text-right">Jumlah</th>
                      <th className="text-right">Sisa</th>
                      <th>Status</th>
                      {canManage ? <th className="text-right">Aksi</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((row) => (
                      <tr key={row.id}>
                        <td className="num text-[11px] text-muted-foreground">
                          {row.journalId ? (
                            <Link href={`/app/akuntansi/jurnal/${row.journalId}`} className="transition-colors hover:underline">
                              {row.number}
                            </Link>
                          ) : (
                            row.number
                          )}
                        </td>
                        <td className="text-[12px]">{formatDate(row.date)}</td>
                        <td className="text-[11px] text-muted-foreground">
                          {LOAN_PLAN_LABELS[row.planMode] ?? row.planMode}
                          {row.planMode === "tenor" && row.planValue ? ` · ${Number(row.planValue)} bulan` : ""}
                          {row.planMode === "fixed" && row.planValue ? ` · ${formatIDR(row.planValue)}/periode` : ""}
                        </td>
                        <td className="num text-right text-[12px]">{formatIDR(row.amount)}</td>
                        <td className="num text-right text-[12px] font-medium">{formatIDR(row.remainingAmount)}</td>
                        <td>
                          <StatusBadge status={row.status} label={LOAN_STATUS_LABELS[row.status]} />
                        </td>
                        {canManage ? (
                          <td className="text-right">
                            {row.status === "open" ? (
                              <LoanVoidButton asMenu id={row.id} number={row.number} disabled={movedLoanIds.has(row.id)} />
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Riwayat pergerakan</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Setiap baris tertelusur ke jurnalnya — klik nomor jurnal untuk membuka.</p>
            </div>
            {timeline.length === 0 ? (
              <div className="p-3">
                {/* G3 (UX4-07): teks polos dalam kartu → EmptyState compact. */}
                <EmptyState size="compact" title="Belum ada pergerakan pinjaman." />
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {timeline.map((row) => (
                  <li key={row.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div>
                      <p className="text-[12px] font-medium">{row.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDate(row.date)}
                        {row.note ? ` · ${row.note}` : ""}
                        {row.journalId ? (
                          <>
                            {" · "}
                            <Link href={`/app/akuntansi/jurnal/${row.journalId}`} className="transition-colors hover:underline">
                              Lihat jurnal
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className={`num text-[12px] font-semibold ${row.kind === "disbursement" || row.kind === "payroll_reversal" ? "text-foreground" : "text-tone-green"}`}>
                      {row.kind === "disbursement" || row.kind === "payroll_reversal" ? "+" : "−"}{formatIDR(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {canManage && openTotal > 0 ? (
          <RepayLoanForm
            employeeId={employee.id}
            openTotal={String(openTotal)}
            accounts={data.cashAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
          />
        ) : null}
      </div>
    </div>
  );
}
