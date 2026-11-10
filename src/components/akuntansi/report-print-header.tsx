import { formatDateTime } from "@/lib/format";

/**
 * CT-12/CT-25 — the formal print head shared by the financial reports
 * and the general ledger. Print-only: the screen already carries the
 * page title and filters, but a sheet handed to a bank or an auditor
 * must state the company, the report title, the period AS RENDERED, and
 * when it was printed — plus "Halaman x dari y" in the @page bottom
 * margin box (the `paged-print` convention the PrintShell documents
 * use). The injected @page rule lives here so every surface that
 * renders this head gets identical pagination.
 */
const REPORT_PAGE_RULE = `@page { size: A4; margin: 12mm; @bottom-center { content: "Halaman " counter(page) " dari " counter(pages); font-size: 9px; color: rgba(0,0,0,0.55); } }`;

export function ReportPrintHeader({
  companyName,
  title,
  periodLabel,
}: {
  companyName: string;
  title: string;
  periodLabel: string;
}) {
  return (
    <header className="print-only paged-print mb-4">
      <style>{REPORT_PAGE_RULE}</style>
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <p className="text-[15px] font-bold uppercase tracking-wide">{companyName}</p>
          <h2 className="mt-0.5 text-[13px] font-semibold">{title}</h2>
          <p className="text-[11px]">{periodLabel}</p>
        </div>
        <p className="whitespace-nowrap text-[11px]">Dicetak {formatDateTime(new Date())}</p>
      </div>
    </header>
  );
}
