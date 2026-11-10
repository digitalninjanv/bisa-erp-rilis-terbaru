import Link from "next/link";
import { Wallet } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { listCashBankAccounts } from "@/server/accounting";
import {
  LOAN_PLAN_LABELS,
  LOAN_STATUS_LABELS,
  listEmployeeLoans,
  listMovedLoanIds,
} from "@/server/employee-loans";
import { listEmployees } from "@/server/hr";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DataList } from "@/components/blocks/data-list";
import { LoanForm, LoanVoidButton } from "@/components/akuntansi/loan-panel";

export const metadata = { title: "Pinjaman Karyawan" };
export const dynamic = "force-dynamic";

export default async function PinjamanPage() {
  const ctx = await requirePermissionPage("payroll.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const loans = await listEmployeeLoans(tx, ctx.company.id);
    const staff = await listEmployees(tx, ctx.company.id);
    const cashAccounts = await listCashBankAccounts(tx, ctx.company.id);
    const movedLoanIds = await listMovedLoanIds(
      tx,
      ctx.company.id,
      loans.map((row) => row.id),
    );
    return { loans, staff, cashAccounts, movedLoanIds };
  });

  const canManage = can(ctx, "payroll.manage");
  const canViewJournal = can(ctx, "accounting.view");
  const openLoans = data.loans.filter((row) => row.status === "open");
  const totalOutstanding = openLoans.reduce((acc, row) => acc + Number(row.remainingAmount), 0);
  const employeesWithDebt = new Set(openLoans.map((row) => row.employeeId)).size;

  const summaryByEmployee = new Map<string, { name: string; code: string; count: number; remaining: number }>();
  for (const row of openLoans) {
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
        title="Pinjaman Karyawan"
        description="Fasilitas kredit karyawan bertenor yang menjadi piutang dan dipotong dari gaji sebagai cicilan pinjaman — tercatat terpisah dari kasbon (uang muka operasional jangka pendek)."
        actions={
          canManage ? (
            <LoanForm
              employees={data.staff.filter((person) => person.isActive)}
              accounts={data.cashAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
            />
          ) : null
        }
      />

      <SummaryStrip
        items={[
          {
            label: "Sisa pinjaman",
            value: formatIDR(totalOutstanding),
            hint: `${openLoans.length} pinjaman berjalan`,
            tone: totalOutstanding > 0 ? "amber" : "green",
          },
          {
            label: "Karyawan berutang",
            value: employeesWithDebt,
            hint: "Memiliki pinjaman berjalan",
          },
          {
            label: "Sudah lunas",
            value: data.loans.filter((row) => row.status === "settled").length,
            hint: "Pinjaman selesai",
            tone: "green",
          },
          {
            label: "Total dokumen",
            value: data.loans.length,
            hint: "Semua status",
          },
        ]}
      />

      {summaryByEmployee.size > 0 ? (
        <section className="mb-3 mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Sisa pinjaman per karyawan</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Klik nama karyawan untuk riwayat lengkap dan setoran manual.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th className="text-right">Pinjaman berjalan</th>
                  <th className="text-right">Total sisa</th>
                </tr>
              </thead>
              <tbody>
                {[...summaryByEmployee.entries()].map(([employeeId, summary]) => (
                  <tr key={employeeId}>
                    <td>
                      <Link href={`/app/akuntansi/pinjaman/${employeeId}`} className="text-[12px] font-medium transition-colors hover:underline">
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

      {/* Pinjaman bukan pendapatan/beban: pokoknya aset, cicilan
          mengurangi aset & utang gaji. Bunga/biaya (bila ada) yang
          masuk Laba Rugi. Penjelasan dilipat agar daftar dokumen
          tetap jadi isi utama halaman. */}
      <details className="mb-3 mt-3 rounded-lg border border-border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-semibold [&::-webkit-details-marker]:hidden">
          Dampak ke laporan keuangan
        </summary>
        <div className="border-t border-border px-4 py-3">
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Pokok pinjaman</strong> masuk <strong className="text-foreground">Neraca</strong> sebagai
              Piutang Pinjaman Karyawan (aset lancar) — bukan pendapatan, bukan beban.
            </li>
            <li>
              Pencairan dan setoran masuk <strong className="text-foreground">Arus Kas</strong> operasi
              (kas keluar saat pencairan, kas masuk saat setoran/cicilan).
            </li>
            <li>
              Cicilan payroll mengurangi piutang dan utang gaji — tanpa efek ke Laba Rugi.
            </li>
            <li>
              Bunga/biaya pinjaman (bila ada) masuk <strong className="text-foreground">Laba Rugi</strong> sebagai
              Beban Lain-lain (akun 720001 Beban Bunga Pinjaman).
            </li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/app/akuntansi/laporan?tab=neraca" className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-[11px] font-medium transition-colors hover:bg-muted">
              Lihat Neraca
            </Link>
            <Link href="/app/akuntansi/laporan?tab=arus-kas" className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-[11px] font-medium transition-colors hover:bg-muted">
              Lihat Arus Kas
            </Link>
            <Link href="/app/akuntansi/laporan?tab=laba-rugi" className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-[11px] font-medium transition-colors hover:bg-muted">
              Lihat Laba Rugi
            </Link>
          </div>
        </div>
      </details>

      <h2 className="mb-2 mt-4 text-[13px] font-semibold">Semua dokumen pinjaman</h2>
      <DataList
        isEmpty={data.loans.length === 0}
        empty={
          <EmptyState title="Belum ada pinjaman" description={canManage ? "Berikan pinjaman pertama lewat tombol Pinjaman Baru — jurnal piutang karyawan dibuat otomatis." : "Peran Anda dapat melihat; pinjaman dibuat oleh peran dengan izin mengelola payroll."} icon={<Wallet className="size-5" />} />
        }
        footerNote="Cicilan berjalan otomatis saat payroll diproses sebagai baris “Cicilan pinjaman karyawan”, terpisah dari potongan kasbon."
      >
        <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Karyawan</th>
                  <th className="hidden lg:table-cell">Rencana cicilan</th>
                  <th className="text-right">Jumlah</th>
                  <th className="text-right">Sisa</th>
                  <th>Status</th>
                  <th>Jurnal</th>
                  {canManage ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.loans.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[11px] text-muted-foreground">{row.number}</td>
                    <td className="text-[12px]">{formatDate(row.date)}</td>
                    <td>
                      <Link href={`/app/akuntansi/pinjaman/${row.employeeId}`} className="text-[12px] font-medium transition-colors hover:underline">
                        {row.employeeName}
                      </Link>
                      <span className="num ml-1.5 text-[11px] text-muted-foreground">{row.employeeCode}</span>
                    </td>
                    <td className="hidden text-[11px] text-muted-foreground lg:table-cell">
                      {LOAN_PLAN_LABELS[row.planMode] ?? row.planMode}
                      {row.planMode === "tenor" && row.planValue ? ` · ${Number(row.planValue)} bulan` : ""}
                      {row.planMode === "fixed" && row.planValue ? ` · ${formatIDR(row.planValue)}/periode` : ""}
                    </td>
                    <td className="num text-right text-[12px]">{formatIDR(row.amount)}</td>
                    <td className="num text-right text-[12px] font-medium">{formatIDR(row.remainingAmount)}</td>
                    <td>
                      <StatusBadge status={row.status} label={LOAN_STATUS_LABELS[row.status]} />
                    </td>
                    <td>
                      {row.journalId && canViewJournal ? (
                        <Link
                          href={`/app/akuntansi/jurnal/${row.journalId}`}
                          className="text-[11px] font-medium text-primary transition-colors hover:underline"
                        >
                          Lihat jurnal
                        </Link>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        {row.status === "open" ? (
                          <LoanVoidButton asMenu id={row.id} number={row.number} disabled={data.movedLoanIds.has(row.id)} />
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
