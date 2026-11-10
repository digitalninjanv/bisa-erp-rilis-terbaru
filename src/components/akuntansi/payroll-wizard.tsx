"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { WizardSteps } from "@/components/blocks/wizard-steps";
import { d, formatIDR } from "@/lib/money";
import { formatMonth } from "@/lib/format";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import type { AdvanceProposalRow } from "@/components/akuntansi/payroll-panel";

/** Run reguler non-void yang sudah memproses periodenya — aturan
 * yang sama dengan penjaga domain di runPayrollAction (kind
 * "regular", status bukan void). Dipakai wizard untuk menandai
 * periode di langkah 1 sebelum pengguna berjalan lebih jauh
 * (A-28 UI-4, UX-C06). */
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
  nik?: string | null;
  npwp?: string | null;
  ptkpStatus?: string | null;
};

const STEPS = [
  { key: "periode", label: "Periode & pratinjau", description: "Pilih periode, lihat estimasi" },
  { key: "tinjau", label: "Tinjau karyawan", description: "Per karyawan & pengecualian" },
  { key: "posting", label: "Posting & bayar", description: "Posting, lalu bayar dari detail" },
];

/**
 * A-25 U5 — PayrollWizard: proses payroll menjadi wizard 3 langkah
 * (ARAH-DESAIN-A25 §3.9/§4.3: ±6 langkah → 3 langkah terpandu).
 * Langkah 1 memilih periode & menampilkan pratinjau hitung dari
 * data master yang sudah ada; langkah 2 meninjau per karyawan —
 * pengecualian (PTKP/NIK kosong, gaji pokok nol) ditampilkan lebih
 * dulu, potongan kasbon dapat diubah seperti sebelumnya; langkah 3
 * memposting lewat `runPayrollAction` yang PERSIS sama (payload
 * sama dengan form lama) lalu mengarahkan ke halaman detail run
 * untuk pembayaran. Angka posting tetap dihitung domain di server;
 * pratinjau di sini adalah estimasi dari komponen tetap master.
 */
/**
 * Panel langkah selesai sesudah posting (A-28 UI-4, UX-C02):
 * jalan ke detail run dinyatakan lewat NOMOR run-nya — tautan
 * "Buka run PRL-…" — agar pengguna yang mencari nomor run
 * menemukan pintu masuk ke slip & pembayaran tanpa menebak.
 */
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
            {posted.employees} karyawan · total bersih {formatIDR(posted.totalNet)}. Jurnal beban gaji dan utang
            gaji sudah dibuat otomatis. Langkah berikutnya: bayarkan gaji dari halaman detail run.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/app/akuntansi/payroll/${posted.id}`}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Buka run {posted.number}
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
  advanceProposals?: AdvanceProposalRow[];
  processedRuns?: PayrollProcessedRun[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [period, setPeriod] = useState(defaultPeriod);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<{ id: string; number: string; totalNet: number; employees: number } | null>(null);
  const [deductions, setDeductions] = useState<Record<string, string>>(() =>
    Object.fromEntries(advanceProposals.map((row) => [row.employeeId, row.proposed])),
  );

  const active = useMemo(() => staff.filter((row) => row.isActive), [staff]);
  const proposalByEmployee = useMemo(
    () => new Map(advanceProposals.map((row) => [row.employeeId, row])),
    [advanceProposals],
  );

  const rows = useMemo(
    () =>
      active.map((person) => {
        const gross = d(person.baseSalary).plus(d(person.allowances));
        const fixed = d(person.deductions);
        const advance = d(deductions[person.id] ?? proposalByEmployee.get(person.id)?.proposed ?? "0");
        return { person, gross, fixed, advance, net: gross.minus(fixed).minus(advance) };
      }),
    [active, deductions, proposalByEmployee],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          gross: acc.gross.plus(row.gross),
          fixed: acc.fixed.plus(row.fixed),
          advance: acc.advance.plus(row.advance),
          net: acc.net.plus(row.net),
        }),
        { gross: d(0), fixed: d(0), advance: d(0), net: d(0) },
      ),
    [rows],
  );

  // A-28 UI-4 (UX-C06): periode terpilih yang sudah diproses run
  // reguler non-void ditandai di langkah 1 — cermin aturan penjaga
  // domain (satu periode satu run), bukan gerbang baru.
  const processedRun = processedRuns.find((run) => run.period === period) ?? null;

  const exceptions = useMemo(
    () =>
      active.flatMap((person) => {
        const issues: string[] = [];
        if (!person.ptkpStatus) issues.push("Status PTKP belum diisi (dihitung TK/0)");
        if (!person.nik) issues.push("NIK belum diisi");
        if (d(person.baseSalary).isZero()) issues.push("Gaji pokok Rp0");
        return issues.length > 0 ? [{ person, issues }] : [];
      }),
    [active],
  );

  async function submit() {
    setBusy(true);
    const result = await runPayrollAction({
      period,
      advanceDeductions: advanceProposals.map((row) => ({
        employeeId: row.employeeId,
        amount: deductions[row.employeeId] ?? row.proposed,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Payroll ${result.data.number} diposting untuk ${result.data.employees} karyawan.`);
    setPosted(result.data);
    router.refresh();
  }

  if (posted) {
    return <PayrollPostedPanel posted={posted} onReset={() => setPosted(null)} />;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-[13px] font-semibold">Proses payroll</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Satu periode hanya bisa diproses sekali. Jurnal beban gaji dan utang gaji dibuat otomatis saat posting.
        </p>
      </div>

      <WizardSteps
        steps={STEPS}
        current={step}
        onNavigate={setStep}
        onBack={step > 0 ? () => setStep(step - 1) : undefined}
        onNext={step < 2 ? () => setStep(step + 1) : () => void submit()}
        finishLabel="Posting payroll"
        busy={busy}
        nextDisabled={step === 0 && (!/^\d{4}-\d{2}$/.test(period) || active.length === 0)}
      >
        {step === 0 ? (
          <div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className={labelClass}>Periode</span>
                <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className={fieldClass} />
              </label>
              <p className="pb-1 text-[12px] text-muted-foreground">
                {active.length} karyawan aktif akan diproses
                {staff.length > active.length ? ` · ${staff.length - active.length} nonaktif dilewati` : ""}.
              </p>
            </div>
            {processedRun ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-[12px] dark:bg-amber-950/30">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">Sudah diproses — {processedRun.number}.</span>{" "}
                  Periode {formatMonth(period)} sudah memiliki run terposting; memproses ulang akan ditolak
                  server.
                </span>
                <Link
                  href={`/app/akuntansi/payroll/${processedRun.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  Buka run {processedRun.number}
                </Link>
              </div>
            ) : null}
            <dl className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <PreviewStat label="Estimasi bruto" value={formatIDR(totals.gross.toFixed(4))} />
              <PreviewStat label="Potongan tetap" value={formatIDR(totals.fixed.toFixed(4))} />
              <PreviewStat label="Potongan kasbon" value={formatIDR(totals.advance.toFixed(4))} />
              <PreviewStat label="Estimasi bersih" value={formatIDR(totals.net.toFixed(4))} strong />
            </dl>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Pratinjau dari komponen tetap master (pokok + tunjangan − potongan). PPh 21, BPJS, lembur, dan THR
              dihitung mesin payroll saat posting — angka final ada di detail run.
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            {exceptions.length > 0 ? (
              <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
                <h3 className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <AlertTriangle className="size-3.5" /> Pengecualian — periksa sebelum posting
                </h3>
                <ul className="mt-1.5 space-y-0.5">
                  {exceptions.map(({ person, issues }) => (
                    <li key={person.id} className="text-[12px]">
                      <span className="font-medium">{person.name}</span>
                      <span className="text-muted-foreground"> — {issues.join("; ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mb-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-[12px] text-muted-foreground">
                Tidak ada pengecualian — data inti semua karyawan aktif lengkap.
              </p>
            )}
            <div className="max-h-96 overflow-auto rounded-lg border border-border">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Karyawan</th>
                    <th className="text-right">Pokok</th>
                    <th className="text-right">Tunjangan</th>
                    <th className="text-right">Potongan tetap</th>
                    <th className="text-right">Potongan kasbon</th>
                    <th className="text-right">Estimasi bersih</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ person, fixed, advance, net }) => (
                    <tr key={person.id}>
                      <td className="text-[12px] font-medium">
                        {person.name}
                        <span className="num ml-1.5 text-[11px] font-normal text-muted-foreground">{person.code}</span>
                      </td>
                      <td className="num text-right text-[12px]">{formatIDR(person.baseSalary)}</td>
                      <td className="num text-right text-[12px]">{formatIDR(person.allowances)}</td>
                      <td className="num text-right text-[12px]">{formatIDR(fixed.toFixed(4))}</td>
                      <td className="num text-right text-[12px]">
                        {proposalByEmployee.has(person.id) ? (
                          <span className="inline-block w-32">
                            <MoneyInput
                              value={deductions[person.id] ?? proposalByEmployee.get(person.id)?.proposed ?? "0"}
                              onChange={(value) =>
                                setDeductions((current) => ({ ...current, [person.id]: value }))
                              }
                              aria-label={`Potongan kasbon ${person.name}`}
                              className="h-9 px-2 text-[12px]"
                            />
                          </span>
                        ) : (
                          formatIDR(advance.toFixed(4))
                        )}
                      </td>
                      <td className="num text-right text-[12px] font-medium">{formatIDR(net.toFixed(4))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-[12px] font-semibold">Total</td>
                    <td className="num text-right text-[12px] font-semibold" colSpan={3}>
                      Bruto {formatIDR(totals.gross.toFixed(4))}
                    </td>
                    <td className="num text-right text-[12px] font-semibold">{formatIDR(totals.advance.toFixed(4))}</td>
                    <td className="num text-right text-[12px] font-semibold">{formatIDR(totals.net.toFixed(4))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {advanceProposals.length > 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Potongan kasbon terisi dari rencana tiap kasbon dan dibatasi gaji bersih oleh server; ubah nilainya
                pada kolom Potongan kasbon bila perlu.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <dl className="grid max-w-xl grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[12px]">
              <dt className="text-muted-foreground">Periode</dt>
              <dd className="font-medium">{formatMonth(period)}</dd>
              <dt className="text-muted-foreground">Karyawan diproses</dt>
              <dd className="font-medium">{active.length} karyawan aktif</dd>
              <dt className="text-muted-foreground">Estimasi bruto</dt>
              <dd className="num font-medium">{formatIDR(totals.gross.toFixed(4))}</dd>
              <dt className="text-muted-foreground">Estimasi potongan</dt>
              <dd className="num font-medium">{formatIDR(totals.fixed.plus(totals.advance).toFixed(4))} (tetap + kasbon)</dd>
              <dt className="text-muted-foreground">Estimasi bersih</dt>
              <dd className="num font-medium">{formatIDR(totals.net.toFixed(4))}</dd>
              <dt className="text-muted-foreground">Pengecualian</dt>
              <dd className="font-medium">{exceptions.length === 0 ? "Tidak ada" : `${exceptions.length} karyawan — lihat langkah 2`}</dd>
            </dl>
            <p className="mt-3 max-w-xl text-[11px] text-muted-foreground">
              Menekan “Posting payroll” menjalankan proses yang sama seperti sebelumnya: run dibuat, jurnal beban
              gaji & utang gaji diposting, potongan kasbon diterapkan. Sesudah terposting, pembayaran gaji dilakukan
              dari halaman detail run (tombol Bayar gaji).
            </p>
          </div>
        ) : null}
      </WizardSteps>
    </div>
  );
}

function PreviewStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`num mt-0.5 text-[15px] ${strong ? "font-semibold" : "font-medium"}`}>{value}</p>
    </div>
  );
}
