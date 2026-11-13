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
  const printSettings = toPrintSettings(settings, "payroll");
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
            const earningLines = lines.filter((line) => line.category === "earning");
            // Baris "deduction" bernama (mis. cuti tidak berbayar) sudah
            // termasuk item.deductions; cicilan pinjaman disimpan terpisah
            // di item.loanDeduction, jadi hanya baris itu yang ditambahkan
            // sebagai potongan di luar item.deductions.
            const namedDeductionLines = lines.filter(
              (line) => line.category === "deduction" && line.code !== "loan_installment",
            );
            const loanLines = lines.filter((line) => line.code === "loan_installment");
            const pphLine = lines.find((line) => line.code === "pph21");
            const taxGrossLine = lines.find((line) => line.code === "tax_gross");
            const gross = d(item.baseSalary).plus(d(item.allowances));
            const namedEarningTotal = earningLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0));
            const fixedAllowance = d(item.allowances).minus(namedEarningTotal);
            const statutoryEmployeeTotal = employeeLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0));
            const namedDeductionTotal = namedDeductionLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0));
            const fixedDeductions = d(item.deductions).minus(namedDeductionTotal);
            const loanTotal = loanLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0));
            const totalDeductions = d(item.deductions)
              .plus(statutoryEmployeeTotal)
              .plus(d(pphLine?.amount ?? 0))
              .plus(d(item.advanceDeduction))
              .plus(loanTotal);
            const employerTotal = employerLines.reduce((acc, line) => acc.plus(d(line.amount)), d(0));
            const taxPremium = taxGrossLine ? d(taxGrossLine.amount).minus(gross) : d(0);
            const earningRows: SlipRow[] = [
              { label: "Gaji pokok", amount: item.baseSalary, alwaysShow: true },
              ...(fixedAllowance.gt(0)
                ? [{ label: "Tunjangan", amount: fixedAllowance.toFixed(4) }]
                : []),
              ...earningLines.map((line) => ({ label: line.label, amount: line.amount })),
            ];
            const deductionRows: SlipRow[] = [
              ...(fixedDeductions.gt(0)
                ? [{ label: "Potongan tetap", amount: fixedDeductions.toFixed(4) }]
                : []),
              ...namedDeductionLines.map((line) => ({ label: line.label, amount: line.amount })),
              ...employeeLines.map((line) => ({ label: line.label, amount: line.amount })),
              ...(pphLine ? [{ label: pphLine.label, amount: pphLine.amount }] : []),
              ...(d(item.advanceDeduction).gt(0)
                ? [{ label: "Potongan kasbon", amount: item.advanceDeduction }]
                : []),
              ...loanLines.map((line) => ({ label: line.label, amount: line.amount })),
            ];
            return (
              <section
                key={item.itemId}
                style={index < slips.length - 1 ? { breakAfter: "page", pageBreakAfter: "always" } : undefined}
                className={`py-2${index < slips.length - 1 ? " page-break-after-always" : ""}`}
              >
                <PrintHeader
                  settings={printSettings}
                  companyName={settings?.legalName ?? "Perusahaan"}
                  address={settings?.address}
                  phone={settings?.phone}
                  taxId={settings?.taxId}
                  variant="document"
                  title="Slip Gaji"
                  number={run.number}
                  dateLabel={formatMonth(run.period)}
                />
                <div className="mt-2 grid grid-cols-2 gap-x-6 text-[11px]">
                  <Row label="Nama karyawan" value={item.employeeName ?? "—"} />
                  <Row label="ID karyawan" value={item.employeeCode ?? "—"} />
                  <Row label="Jabatan" value={item.position ?? "—"} />
                  <Row label="Status PTKP" value={item.ptkpStatus ?? "—"} />
                  <div className="col-span-2 mt-1 border-t border-black/10 pt-1">
                    <Row label="Periode penggajian" value={formatMonth(run.period)} />
                  </div>
                </div>

                <SlipTable
                  title="A. Penghasilan"
                  rows={earningRows}
                  subtotalLabel="Subtotal penghasilan bruto"
                  subtotal={gross}
                />

                <SlipTable
                  title="B. Potongan"
                  rows={deductionRows}
                  subtotalLabel="Subtotal potongan"
                  subtotal={totalDeductions}
                  emptyLabel="Tidak ada potongan"
                />

                <div className="print-summary mt-4 break-inside-avoid border-y-2 border-black px-3 py-3">
                  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                        C. Gaji bersih diterima
                      </p>
                      <p className="mt-0.5 text-[9px] opacity-60">
                        Jumlah yang diterima setelah seluruh potongan.
                      </p>
                    </div>
                    <p className="num whitespace-nowrap text-[26px] font-bold leading-none">
                      {formatIDR(item.net)}
                    </p>
                  </div>
                </div>

                {employerLines.length > 0 && employerTotal.gt(0) ? (
                  <div className="mt-5 border-t border-dashed border-black/30 pt-2">
                    <SlipTable
                      title="Informasi iuran ditanggung perusahaan"
                      rows={employerLines.map((line) => ({ label: line.label, amount: line.amount, muted: true }))}
                      subtotalLabel="Total iuran perusahaan"
                      subtotal={employerTotal}
                      secondary
                    />
                    <p className="mt-1 text-[9px] opacity-60">
                      Iuran di atas bukan potongan gaji karyawan.
                      {taxPremium.gt(0)
                        ? ` Termasuk premi perusahaan senilai ${formatIDR(taxPremium)} yang menjadi objek pajak PPh 21.`
                        : ""}
                    </p>
                  </div>
                ) : null}

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

type SlipRow = {
  label: string;
  amount: string;
  muted?: boolean;
  alwaysShow?: boolean;
};

function SlipTable({
  title,
  rows,
  subtotalLabel,
  subtotal,
  secondary = false,
  emptyLabel,
}: {
  title: string;
  rows: SlipRow[];
  subtotalLabel: string;
  subtotal: ReturnType<typeof d>;
  /** Bagian informasi (mis. iuran perusahaan) tampil lebih kecil. */
  secondary?: boolean;
  /** Tetap tampilkan bagian dengan subtotal nol (mis. tanpa potongan). */
  emptyLabel?: string;
}) {
  const visible = rows.filter((row) => row.alwaysShow || !d(row.amount).isZero());
  if (visible.length === 0 && !emptyLabel) return null;
  return (
    <div className={secondary ? "mt-1" : "mt-5"}>
      <h3
        className={
          secondary
            ? "text-[9px] font-semibold uppercase tracking-wide opacity-60"
            : "text-[11px] font-semibold uppercase tracking-wide"
        }
      >
        {title}
      </h3>
      <table className={`mt-1 w-full border-collapse ${secondary ? "text-[10px] opacity-75" : "text-[11px]"}`}>
        <thead>
          <tr
            className={`border-b text-[9px] uppercase tracking-wide ${
              secondary ? "border-black/20 opacity-60" : "border-black/40 opacity-60"
            }`}
          >
            <th className="py-0.5 text-left font-medium">Komponen</th>
            <th className="py-0.5 text-right font-medium">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr className="opacity-70">
              <td className="py-0.5 pr-2">{emptyLabel}</td>
              <td className="num py-0.5 text-right">{formatIDR(0)}</td>
            </tr>
          ) : (
            visible.map((row, index) => (
              <tr key={`${row.label}-${index}`} className={row.muted ? "opacity-70" : undefined}>
                <td className="py-0.5 pr-2">{row.label}</td>
                <td className="num py-0.5 text-right">{formatIDR(row.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-black/40 font-semibold">
            <td className="py-1">{subtotalLabel}</td>
            <td className="num py-1 text-right">{formatIDR(subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
