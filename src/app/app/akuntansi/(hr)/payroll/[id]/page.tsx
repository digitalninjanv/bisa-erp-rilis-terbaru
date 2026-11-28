import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Printer, Users } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listCashBankIds } from "@/server/accounting";
import { listLinkedJournals } from "@/server/catalog";
import { getPayrollRunDetail } from "@/server/hr";
import { listAccountBalances } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { d, formatIDR } from "@/lib/money";
import { formatMonth, todayISO } from "@/lib/format";
import { DocumentPage, DocumentMetaRows } from "@/components/blocks/document-page";
import { DocumentJournals } from "@/components/blocks/document-journals";
import { documentFlowSteps, PAYROLL_FLOW_STAGES } from "@/lib/document-flow";
import { statusLabel } from "@/components/blocks/status-badge";
import { PayrollPaymentForm } from "@/components/akuntansi/payroll-payment-form";

export const dynamic = "force-dynamic";

/**
 * A-25 U5 — detail run payroll memakai DocumentPage (POLA-15):
 * status menjadi penanda tahap di kepala (Terproses → Dibayar;
 * HR-07: bukan lagi kartu KPI kelima yang janggal), angka run
 * pindah ke rel meta, dan aksi Slip per karyawan menjadi tombol
 * yang jelas. Cetak slip dipertahankan apa adanya.
 */
export default async function PayrollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermissionPage("payroll.view");
  // A-28 Tahap 5 (H-HR-01): angka gaji level field (pola
  // inventory.cost) — nominal per karyawan & total run hanya untuk
  // pemegang payroll.salary (atau payroll.manage yang memprosesnya);
  // dokumen yang keluar dari layar (slip & rekap CSV) lebih ketat:
  // hanya payroll.salary, sesuai gerbang server kedua permukaan itu.
  const canSeeSalary = can(ctx, "payroll.salary") || can(ctx, "payroll.manage");
  const canSalaryDoc = can(ctx, "payroll.salary");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const detail = await getPayrollRunDetail(tx, ctx.company.id, id);
    if (!detail) return null;
    const [cashIds, balances, journals] = await Promise.all([
      // A-27 B2: himpunan akun pembayaran gaji dari kelas kas/bank.
      listCashBankIds(tx, ctx.company.id),
      listAccountBalances(tx, ctx.company.id),
      // A-24 T4: jurnal beban gaji (saat run diproses) & jurnal
      // pembayaran gaji menunjuk run ini sebagai sumbernya.
      listLinkedJournals(tx, ctx.company.id, id),
    ]);
    return {
      ...detail,
      journals,
      cashAccounts: balances.filter((row) => cashIds.has(row.id)),
    };
  });

  if (!data) notFound();
  const { run, items, lines, cashAccounts } = data;
  const hasStatutory = lines.length > 0;
  const statutoryByItem = new Map<string, { pph21: string; employeeTotal: string; details: string }>();
  for (const item of items) {
    const itemLines = lines.filter((line) => line.itemId === item.id);
    if (itemLines.length === 0) continue;
    const pph = itemLines.find((line) => line.code === "pph21");
    const employeeLines = itemLines.filter((line) => line.category === "statutory_employee");
    statutoryByItem.set(item.id, {
      pph21: pph?.amount ?? "0",
      employeeTotal: employeeLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0)).toFixed(4),
      details: employeeLines.map((line) => `${line.label} ${formatIDR(line.amount)}`).join(" · "),
    });
  }

  const steps = documentFlowSteps(run.status, PAYROLL_FLOW_STAGES, statusLabel(run.status));

  return (
    <DocumentPage
      backHref="/app/akuntansi/payroll"
      backLabel="Kembali ke payroll"
      eyebrow={`Payroll · ${formatMonth(run.period)}`}
      number={run.number}
      title="Rincian gaji per karyawan dan pembayaran utang gaji."
      status={run.status}
      steps={steps}
      actions={
        <>
          {canSalaryDoc ? (
            <Link
              href={`/app/akuntansi/payroll/${run.id}/cetak`}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted"
            >
              <Printer className="size-3.5" /> Cetak slip gaji
            </Link>
          ) : null}
          {hasStatutory && canSalaryDoc ? (
            <a
              href={`/api/export/payroll?runId=${run.id}&format=xlsx`}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Rekap Excel (setoran)
            </a>
          ) : null}
          {can(ctx, "payroll.manage") && cashAccounts.length > 0 ? (
            <PayrollPaymentForm
              runId={run.id}
              number={run.number}
              totalNet={Number(run.totalNet)}
              accounts={cashAccounts.map((row) => ({ id: row.id, code: row.code, name: row.name }))}
              today={todayISO()}
              paid={run.status === "paid"}
              canVoid={can(ctx, "payroll.manage")}
            />
          ) : null}
        </>
      }
      meta={
        <DocumentMetaRows
          rows={[
            { label: "Periode", value: formatMonth(run.period) },
            { label: "Karyawan", value: `${items.length} orang` },
            ...(canSeeSalary
              ? [
                  { label: "Total bruto", value: formatIDR(run.totalGross) },
                  { label: "Potongan", value: formatIDR(run.totalDeductions) },
                  { label: "Potongan kasbon", value: formatIDR(run.totalAdvanceDeductions) },
                  ...(hasStatutory
                    ? [
                        { label: "PPh 21 dipotong", value: formatIDR(run.totalPph21) },
                        { label: "Iuran BPJS pekerja", value: formatIDR(run.totalStatutoryEmployee) },
                        { label: "Beban BPJS perusahaan", value: formatIDR(run.totalEmployerContributions) },
                      ]
                    : []),
                  { label: "Total bersih", value: formatIDR(run.totalNet) },
                ]
              : [{ label: "Angka gaji", value: "Tidak ditampilkan (butuh izin lihat angka gaji)" }]),
          ]}
        />
      }
      metaTitle="Ringkasan run"
      journals={
        // A-28 Tahap 5 (H-HR-01): baris jurnal run ini adalah agregat
        // angka gaji (beban gaji & utang gaji = total run) — bagi
        // pembaca tanpa izin angka gaji, seksi jurnal ikut tertutup
        // agar masking total di meta tidak bocor lewat jurnal.
        canSeeSalary ? (
          <DocumentJournals
            journals={data.journals}
            emptyNote="Run ini belum membentuk jurnal. Jurnal beban gaji terbentuk saat run diproses, dan jurnal pembayaran saat gaji dibayarkan."
          />
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Jurnal terkait run ini tidak ditampilkan untuk peran Anda (memuat angka gaji).
          </p>
        )
      }
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
          <Users className="size-3.5 text-muted-foreground" />
          <h2 className="text-[13px] font-semibold">{items.length} karyawan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Karyawan</th>
                {canSeeSalary ? (
                  <>
                    <th className="text-right">Gaji pokok</th>
                    <th className="text-right">Tunjangan</th>
                    <th className="text-right">Potongan</th>
                    {hasStatutory ? <th className="text-right">BPJS pekerja</th> : null}
                    {hasStatutory ? <th className="text-right">PPh 21</th> : null}
                    <th className="text-right">Potongan kasbon</th>
                    <th className="text-right">Bersih</th>
                  </>
                ) : null}
                {canSalaryDoc ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const statutory = statutoryByItem.get(row.id);
                return (
                  <tr key={row.id}>
                    <td>
                      <p className="text-[12px] font-medium">{row.employeeName ?? "—"}</p>
                      <p className="num text-[11px] text-muted-foreground">{row.employeeCode ?? "—"}</p>
                      {canSeeSalary && statutory?.details ? (
                        <p className="text-[11px] text-muted-foreground">{statutory.details}</p>
                      ) : null}
                    </td>
                    {canSeeSalary ? (
                      <>
                        <td className="num text-right text-[12px]">{formatIDR(row.baseSalary)}</td>
                        <td className="num text-right text-[12px]">{formatIDR(row.allowances)}</td>
                        <td className="num text-right text-[12px] text-destructive">{formatIDR(row.deductions)}</td>
                        {hasStatutory ? (
                          <td className="num text-right text-[12px] text-destructive">
                            {statutory ? formatIDR(statutory.employeeTotal) : "—"}
                          </td>
                        ) : null}
                        {hasStatutory ? (
                          <td className="num text-right text-[12px] text-destructive">
                            {statutory ? formatIDR(statutory.pph21) : "—"}
                          </td>
                        ) : null}
                        <td className="num text-right text-[12px] text-destructive">{formatIDR(row.advanceDeduction)}</td>
                        <td className="num text-right font-medium">{formatIDR(row.net)}</td>
                      </>
                    ) : null}
                    {canSalaryDoc ? (
                      <td className="text-right">
                        <Link
                          href={`/app/akuntansi/payroll/${run.id}/cetak?employeeId=${row.employeeId}`}
                          className="inline-flex h-7 items-center rounded border border-border px-2 text-[11px] font-medium transition-colors hover:bg-muted"
                        >
                          Slip
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </DocumentPage>
  );
}
