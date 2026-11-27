"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { d, formatIDR } from "@/lib/money";
import { formatMonth } from "@/lib/format";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import type { AdvanceProposalRow } from "@/components/akuntansi/payroll-panel";

export type PayrollProcessedRun = {
  id: string;
  number: string;
  period: string;
};

export type PayrollWizardStaff = {
  id: string;
  code: string;
  name: string;
  position: string | null;
  baseSalary: string;
  allowances: string;
  deductions: string;
  isActive: boolean;
  /** Legacy fields accepted for old callers; the simplified payroll does not use them. */
  nik?: string | null;
  npwp?: string | null;
  ptkpStatus?: string | null;
};

export function PayrollPostedPanel({
  posted,
  onReset,
}: {
  posted: { id: string; number: string; totalNet: number; employees: number };
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 text-tone-green" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Payroll {posted.number} terposting</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {posted.employees} karyawan · total gaji bersih {formatIDR(posted.totalNet)}. Jurnal beban dan utang gaji
            sudah dibuat otomatis.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/app/akuntansi/payroll/${posted.id}`}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Lihat payroll {posted.number}
            </Link>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[13px] transition-colors hover:bg-muted"
            >
              Proses periode lain
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PayrollWizard({
  defaultPeriod,
  staff,
  advanceProposals = [],
  processedRuns = [],
}: {
  defaultPeriod: string;
  staff: PayrollWizardStaff[];
  /** Planned installments from employee advances. */
  advanceProposals?: AdvanceProposalRow[];
  processedRuns?: PayrollProcessedRun[];
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(defaultPeriod);
  const [busy, setBusy] = useState(false);
  const [confirmPosting, setConfirmPosting] = useState(false);
  const [posted, setPosted] = useState<{ id: string; number: string; totalNet: number; employees: number } | null>(null);
  const active = staff.filter((person) => person.isActive);
  const proposalByEmployee = new Map(advanceProposals?.map((row) => [row.employeeId, row]) ?? []);
  const totals = active.reduce(
    (sum, person) => {
      const gross = d(person.baseSalary).plus(d(person.allowances));
      const deductions = d(person.deductions);
      const advance = d(proposalByEmployee.get(person.id)?.proposed ?? 0);
      return {
        gross: sum.gross.plus(gross),
        deductions: sum.deductions.plus(deductions),
        advance: sum.advance.plus(advance),
        net: sum.net.plus(gross).minus(deductions).minus(advance),
      };
    },
    { gross: d(0), deductions: d(0), advance: d(0), net: d(0) },
  );
  const processedRun = processedRuns.find((run) => run.period === period) ?? null;

  async function submit() {
    setBusy(true);
    const result = await runPayrollAction({ period });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Payroll ${result.data.number} diposting untuk ${result.data.employees} karyawan.`);
    setPosted(result.data);
    router.refresh();
  }

  if (posted) return <PayrollPostedPanel posted={posted} onReset={() => setPosted(null)} />;

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold">Proses gaji bulanan</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Gaji bersih dihitung dari gaji pokok + tunjangan − potongan tetap.
          </p>
        </div>
        <label className="space-y-1">
          <span className={labelClass}>Periode gaji</span>
          <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className={fieldClass} />
        </label>
      </div>

      {processedRun ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-[12px] dark:bg-amber-950/30">
          <AlertTriangle className="size-4 shrink-0" />
          <p className="flex-1">
            Payroll {formatMonth(period)} sudah diproses dengan nomor {processedRun.number}.
          </p>
          <Link href={`/app/akuntansi/payroll/${processedRun.id}`} className="font-medium text-primary hover:underline">
            Lihat payroll
          </Link>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Summary label="Karyawan aktif" value={String(active.length)} />
            <Summary label="Total gaji kotor" value={formatIDR(totals.gross.toFixed(0))} />
            <Summary label="Cicilan kasbon" value={formatIDR(totals.advance.toFixed(0))} />
            <Summary label="Total gaji bersih" value={formatIDR(totals.net.toFixed(0))} />
          </dl>
          <div
            className="mt-4 overflow-x-auto rounded-lg border border-border"
            tabIndex={0}
            role="region"
            aria-label="Tabel pratinjau payroll"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th className="text-right">Gaji pokok</th>
                  <th className="text-right">Tunjangan</th>
                  <th className="text-right">Potongan</th>
                  <th className="text-right">Cicilan kasbon</th>
                  <th className="text-right">Gaji bersih</th>
                </tr>
              </thead>
              <tbody>
                {active.map((person) => {
                  const gross = d(person.baseSalary).plus(d(person.allowances));
                  const advance = d(proposalByEmployee.get(person.id)?.proposed ?? 0);
                  const net = gross.minus(d(person.deductions)).minus(advance);
                  return (
                    <tr key={person.id}>
                      <td className="text-[12px] font-medium">
                        {person.name}<span className="num ml-1.5 text-[11px] font-normal text-muted-foreground">{person.code}</span>
                      </td>
                      <td className="num text-right text-[12px]">{formatIDR(person.baseSalary)}</td>
                      <td className="num text-right text-[12px]">{formatIDR(person.allowances)}</td>
                      <td className="num text-right text-[12px]">{formatIDR(person.deductions)}</td>
                      <td className="num text-right text-[12px]">{formatIDR(advance.toFixed(0))}</td>
                      <td className="num text-right text-[12px] font-medium">{formatIDR(net.toFixed(0))}</td>
                    </tr>
                  );
                })}
                {active.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-[12px] text-muted-foreground">Belum ada karyawan aktif.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Cicilan kasbon mengikuti rencana pada menu Kasbon dan dibatasi agar gaji bersih tidak negatif.
            </p>
            <button
              type="button"
              disabled={active.length === 0 || !/^\d{4}-\d{2}$/.test(period) || busy}
              onClick={() => setConfirmPosting(true)}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Memproses…" : "Proses gaji"}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmPosting}
        title={`Proses gaji ${formatMonth(period)}?`}
        description={
          <p>
            Sistem akan membuat payroll untuk {active.length} karyawan aktif dengan estimasi bersih{" "}
            <strong>{formatIDR(totals.net.toFixed(0))}</strong>, termasuk cicilan kasbon{" "}
            <strong>{formatIDR(totals.advance.toFixed(0))}</strong>, beserta jurnal otomatis.
          </p>
        }
        confirmLabel="Ya, proses gaji"
        cancelLabel="Batal"
        busy={busy}
        onConfirm={() => {
          setConfirmPosting(false);
          void submit();
        }}
        onCancel={() => setConfirmPosting(false)}
      />
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-semibold">{value}</dd>
    </div>
  );
}
