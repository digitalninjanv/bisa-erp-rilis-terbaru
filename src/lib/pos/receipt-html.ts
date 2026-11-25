import type { ReceiptData } from "@/lib/escpos/types";
import { formatDate } from "@/lib/format";
import { formatIDR, formatNumber } from "@/lib/money";

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Susun HTML nota thermal siap cetak (58mm/80mm) untuk cetak offline maupun
 * cetak instan Electron tanpa roundtrip SSR tambahan.
 */
export function renderReceiptHtml(data: ReceiptData): string {
  const is58 = data.paperWidth === "58mm";
  const paperKey = is58 ? "thermal58" : "thermal80";
  const pageWidthMm = is58 ? 58 : 80;
  const contentWidthMm = is58 ? 54 : 76;
  const fontSizePx = is58 ? 10.5 : 12;
  const smallSizePx = is58 ? 9.5 : 11;
  const headerSizePx = is58 ? 12.5 : 14;
  const showCashier = data.showCashier !== false;
  const showCustomer = data.showCustomer !== false;
  const showTax = data.showTax !== false;

  const linesHtml = data.lines
    .map((item) => {
      const unitPart = item.unit ? ` ${escapeHtml(item.unit)}` : "";
      const discountRow =
        item.discount && item.discount > 0
          ? `<div class="row" style="font-size: ${smallSizePx}px;"><span>  (Diskon)</span><span>-${escapeHtml(formatIDR(item.discount))}</span></div>`
          : "";
      return `
        <div class="item">
          <div class="bold">${escapeHtml(item.name)}</div>
          <div class="row">
            <span>  ${escapeHtml(formatNumber(item.qty))}${unitPart} x ${escapeHtml(formatIDR(item.price))}</span>
            <span>${escapeHtml(formatIDR(item.subtotal))}</span>
          </div>
          ${discountRow}
        </div>
      `;
    })
    .join("");

  const paymentsHtml = (data.payments ?? [])
    .map(
      (pay) => `
        <div class="row">
          <span>Bayar (${escapeHtml(pay.methodName)}):</span>
          <span>${escapeHtml(formatIDR(pay.tendered ?? pay.amount))}</span>
        </div>
        ${pay.reference ? `<div class="row" style="font-size: ${smallSizePx}px;"><span>  Ref:</span><span>${escapeHtml(pay.reference)}</span></div>` : ""}
      `,
    )
    .join("");

  const outstanding =
    data.outstanding ??
    (data.payments ?? [])
      .filter((payment) => payment.methodType === "credit")
      .reduce((sum, payment) => sum + payment.amount, 0);

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Nota ${escapeHtml(data.saleNumber)}</title>
  <style>
    @page { size: ${pageWidthMm}mm 297mm; margin: 2mm; }
    body { margin: 0; padding: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: ${fontSizePx}px; line-height: 1.32; color: #000; background: #fff; }
    .print-doc { width: ${contentWidthMm}mm; max-width: 100%; margin: 0 auto; box-sizing: border-box; padding: 2px; }
    .text-center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .item { margin-bottom: 2px; }
    .copy-banner { border-top: 2px double #000; border-bottom: 2px double #000; padding: 2px 0; margin: 4px 0; text-align: center; font-weight: bold; letter-spacing: 0.08em; }
  </style>
</head>
<body>
  <main class="print-doc" data-paper="${paperKey}">
    <div class="text-center bold" style="font-size: ${headerSizePx}px;">${escapeHtml(data.companyName)}</div>
    ${data.address ? `<div class="text-center">${escapeHtml(data.address)}</div>` : ""}
    ${data.phone ? `<div class="text-center">Telp: ${escapeHtml(data.phone)}</div>` : ""}
    ${data.taxId ? `<div class="text-center" style="font-size: ${smallSizePx}px;">NPWP: ${escapeHtml(data.taxId)}</div>` : ""}
    ${data.headerText ? `<div class="text-center">${escapeHtml(data.headerText)}</div>` : ""}
    <div class="divider"></div>
    ${(data.copyIndex ?? 0) > 0 ? `<div class="copy-banner">SALINAN — BUKAN NOTA ASLI</div>` : ""}
    <div class="row"><span>No. Nota:</span><span>${escapeHtml(data.saleNumber)}</span></div>
    <div class="row"><span>Tanggal:</span><span>${escapeHtml(data.date)}</span></div>
    ${showCashier && data.cashierName ? `<div class="row"><span>Kasir:</span><span>${escapeHtml(data.cashierName)}</span></div>` : ""}
    ${showCustomer && data.customerName ? `<div class="row"><span>Pelanggan:</span><span>${escapeHtml(data.customerName)}</span></div>` : ""}
    ${data.dueDate ? `<div class="row"><span>Jatuh tempo:</span><span>${escapeHtml(formatDate(data.dueDate))}</span></div>` : ""}
    <div class="divider"></div>
    ${linesHtml}
    <div class="divider"></div>
    ${(data.discountTotal ?? 0) > 0 ? `<div class="row"><span>Subtotal:</span><span>${escapeHtml(formatIDR(data.subtotal))}</span></div><div class="row"><span>Diskon:</span><span>-${escapeHtml(formatIDR(data.discountTotal ?? 0))}</span></div>` : ""}
    ${showTax && (data.taxTotal ?? 0) > 0 ? `<div class="row"><span>PPN:</span><span>${escapeHtml(formatIDR(data.taxTotal ?? 0))}</span></div>` : ""}
    ${(data.roundingAdjustment ?? 0) !== 0 ? `<div class="row"><span>Pembulatan:</span><span>${escapeHtml(formatIDR(data.roundingAdjustment ?? 0))}</span></div>` : ""}
    <div class="row bold" style="font-size: ${headerSizePx}px;"><span>TOTAL:</span><span>${escapeHtml(formatIDR(data.total))}</span></div>
    <div class="divider"></div>
    ${paymentsHtml}
    ${outstanding > 0 ? `<div class="row bold"><span>Sisa utang:</span><span>${escapeHtml(formatIDR(outstanding))}</span></div><div class="row"><span>Status:</span><span>BELUM LUNAS</span></div>` : ""}
    ${typeof data.change === "number" && data.change > 0 ? `<div class="row bold"><span>Kembalian:</span><span>${escapeHtml(formatIDR(data.change))}</span></div>` : outstanding <= 0 ? `<div class="row"><span>Status:</span><span>LUNAS</span></div>` : ""}
    ${data.footerText ? `<div class="divider"></div><div class="text-center" style="font-size: ${smallSizePx}px;">${escapeHtml(data.footerText)}</div>` : `<div class="divider"></div><div class="text-center" style="font-size: ${smallSizePx}px;">Terima kasih atas kunjungan Anda!</div>`}
  </main>
</body>
</html>`;
}
