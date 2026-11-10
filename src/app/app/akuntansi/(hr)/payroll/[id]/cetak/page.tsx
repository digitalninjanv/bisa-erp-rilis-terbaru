import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getSettings } from "@/server/catalog";
import { getPayrollSlipData } from "@/server/hr";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR } from "@/lib/money";
import { formatMonth } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Slip Gaji" };
export const dynamic = "force-dynamic";

/**
 * SIM-2 S2 — Slip gaji per karyawan (Print Engine, kertas dokumen
 * perusahaan). Angka slip dibaca dari snapshot payroll_items +
 * payroll_item_lines run — bukan dihitung ulang — sehingga slip
 * periode lama tidak berubah saat konfigurasi regulasi berubah.
 * Tanpa `employeeId`, semua slip run dicetak berurutan (satu karyawan
 * per halaman).
 */
export default async function PayrollSlipsPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string; employeeId?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("payroll.view");
  // A-28 Tahap 5 (H-HR-01): slip adalah dokumen angka gaji per
  // karyawan — selain payroll.view, halaman ini menuntut izin lihat
  // angka gaji payroll.salary (pola inventory.cost untuk harga pokok).
  await requirePermissionPage("payroll.salary");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const detail = await getPayrollSlipData(tx, ctx.company.id, id);
    if (!detail) return null;
    const settings = await getSettings(tx, ctx.company.id);
    return { ...detail, settings };
  });

  if (!data) notFound();
  const { run, settings } = data;
  const printSettings = toPrintSettings(settings);
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(run.number) : null;

  const linesByItem = new Map<string, typeof data.lines>();
  for (const line of data.lines) {
    const list = linesByItem.get(line.itemId) ?? [];
    list.push(line);
    linesByItem.set(line.itemId, list);
  }
  const slips = data.items.filter(
    (item) => !query.employeeId || item.employeeId === query.employeeId,
  );
  if (slips.length === 0) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Slip Gaji · {formatMonth(run.period)}
          </p>
          <h1 className="num mt-1 text-lg font-semibold">
            {run.number} — {slips.length} karyawan
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/app/akuntansi/payroll/${run.id}`}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            <ArrowLeft className="size-3.5" /> Detail payroll
          </Link>
          <ReceiptPrint auto={query.autoprint === "1"} />
        </div>
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          {slips.map((item, index) => {
            const lines = linesByItem.get(item.itemId) ?? [];
            const employeeLines = lines.filter((line) => line.category === "statutory_employee");
            const employerLines = lines.filter((line) => line.category === "statutory_employer");
            const pphLine = lines.find((line) => line.code === "pph21");
            const taxGrossLine = lines.find((line) => line.code === "tax_gross");
            const gross = d(item.baseSalary).plus(d(item.allowances));
            const statutoryEmployeeTotal = employeeLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0));
            const totalDeductions = d(item.deductions)
              .plus(statutoryEmployeeTotal)
              .plus(d(pphLine?.amount ?? 0))
              .plus(d(item.advanceDeduction));
            const taxPremium = taxGrossLine ? d(taxGrossLine.amount).minus(gross) : d(0);
            return (
              <section
                key={item.itemId}
                style={index < slips.length - 1 ? { pageBreakAfter: "always" } : undefined}
                className="py-2"
              >
                <PrintHeader
                  settings={printSettings}
                  companyName={settings?.legalName ?? "Perusahaan"}
                  address={settings?.address}
                  phone={settings?.phone}
                  variant="document"
                  title="Slip Gaji"
                  number={run.number}
                  dateLabel={formatMonth(run.period)}
                />
                <div className="mt-2 grid grid-cols-2 gap-x-6 text-[11px]">
                  <Row label="Nama karyawan" value={item.employeeName ?? "—"} />
                  <Row label="Kode" value={item.employeeCode ?? "—"} />
                  <Row label="Jabatan" value={item.position ?? "—"} />
                  <Row label="Status PTKP" value={item.ptkpStatus ?? "—"} />
                </div>

                <SlipTable
                  title="Penghasilan"
                  rows={[
                    { label: "Gaji pokok", amount: item.baseSalary },
                    { label: "Tunjangan", amount: item.allowances },
                    ...(taxPremium.gt(0)
                      ? [{ label: "Premi BPJS dari perusahaan (objek pajak)", amount: taxPremium.toFixed(4), muted: true }]
                      : []),
                  ]}
                  totalLabel="Penghasilan bruto"
                  total={gross}
                />

                {employerLines.length > 0 ? (
                  <SlipTable
                    title="Iuran ditanggung perusahaan (informasi)"
                    rows={employerLines.map((line) => ({ label: line.label, amount: line.amount, muted: true }))}
                    totalLabel="Total beban perusahaan di luar gaji"
                    total={employerLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0))}
                  />
                ) : null}

                <SlipTable
                  title="Potongan"
                  rows={[
                    { label: "Potongan tetap", amount: item.deductions },
                    ...employeeLines.map((line) => ({ label: line.label, amount: line.amount })),
                    ...(pphLine
                      ? [{ label: pphLine.label, amount: pphLine.amount }]
                      : []),
                    { label: "Potongan kasbon", amount: item.advanceDeduction },
                  ]}
                  totalLabel="Total potongan"
                  total={totalDeductions}
                />

                <div className="mt-3 flex items-center justify-between border-t-2 border-black/70 pt-2 text-[13px] font-semibold">
                  <span>Gaji bersih diterima</span>
                  <span className="num">{formatIDR(item.net)}</span>
                </div>

                <PrintFooter
                  settings={printSettings}
                  documentNumber={`${run.number}/${item.employeeCode ?? item.employeeId}`}
                  variant="document"
                  signatures={applySignatureLabels(printSettings, "payroll", [
                    { label: "Dibuat oleh", name: "Bagian Payroll" },
                    { label: "Diterima oleh", name: item.employeeName ?? undefined },
                  ])}
                  qrDataUrl={qrDataUrl}
                />
              </section>
            );
          })}
        </PrintShell>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-3 py-0.5">
      <span className="opacity-60">{label}</span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

function SlipTable({
  title,
  rows,
  totalLabel,
  total,
}: {
  title: string;
  rows: Array<{ label: string; amount: string; muted?: boolean }>;
  totalLabel: string;
  total: ReturnType<typeof d>;
}) {
  const visible = rows.filter((row) => !d(row.amount).isZero() || row.label === "Gaji pokok");
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide">{title}</h3>
      <table className="mt-1 w-full text-[11px]">
        <tbody>
          {visible.map((row) => (
            <tr key={row.label} className={row.muted ? "opacity-70" : undefined}>
              <td className="py-0.5">{row.label}</td>
              <td className="num py-0.5 text-right">{formatIDR(row.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-black/40 font-semibold">
            <td className="py-1">{totalLabel}</td>
            <td className="num py-1 text-right">{formatIDR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
