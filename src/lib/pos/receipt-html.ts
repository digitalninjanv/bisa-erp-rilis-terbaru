import type { ReceiptData } from "@/lib/escpos/types";
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

export function renderReceiptHtml(data: ReceiptData): string {
  const linesHtml = data.lines
    .map((item) => {
      const unitPart = item.unit ? ` ${escapeHtml(item.unit)}` : "";
      const discountRow =
        item.discount && item.discount > 0
          ? `<div class="row" style="font-size: 11px;"><span>  (Diskon)</span><span>-${escapeHtml(formatIDR(item.discount))}</span></div>`
          : "";
      return `
        <div>
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
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Nota ${escapeHtml(data.saleNumber)}</title>
  <style>
    @page { margin: 2mm; }
    body { margin: 0; padding: 0; font-family: monospace; font-size: 12px; color: #000; background: #fff; }
    .print-doc { width: 100%; box-sizing: border-box; padding: 2px; }
    .text-center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
  </style>
</head>
<body>
  <main class="print-doc" data-paper="thermal80">
    <div class="text-center bold" style="font-size: 14px;">${escapeHtml(data.companyName)}</div>
    ${data.address ? `<div class="text-center">${escapeHtml(data.address)}</div>` : ""}
    ${data.phone ? `<div class="text-center">Telp: ${escapeHtml(data.phone)}</div>` : ""}
    ${data.headerText ? `<div class="text-center">${escapeHtml(data.headerText)}</div>` : ""}
    <div class="divider"></div>
    <div class="row"><span>No. Nota:</span><span>${escapeHtml(data.saleNumber)}</span></div>
    <div class="row"><span>Tanggal:</span><span>${escapeHtml(data.date)}</span></div>
    ${data.cashierName ? `<div class="row"><span>Kasir:</span><span>${escapeHtml(data.cashierName)}</span></div>` : ""}
    ${data.customerName ? `<div class="row"><span>Pelanggan:</span><span>${escapeHtml(data.customerName)}</span></div>` : ""}
    <div class="divider"></div>
    ${linesHtml}
    <div class="divider"></div>
    ${(data.discountTotal ?? 0) > 0 ? `<div class="row"><span>Subtotal:</span><span>${escapeHtml(formatIDR(data.subtotal))}</span></div><div class="row"><span>Diskon:</span><span>-${escapeHtml(formatIDR(data.discountTotal ?? 0))}</span></div>` : ""}
    ${(data.taxTotal ?? 0) > 0 ? `<div class="row"><span>PPN:</span><span>${escapeHtml(formatIDR(data.taxTotal ?? 0))}</span></div>` : ""}
    <div class="row bold" style="font-size: 13px;"><span>TOTAL:</span><span>${escapeHtml(formatIDR(data.total))}</span></div>
    <div class="divider"></div>
    ${paymentsHtml}
    ${typeof data.change === "number" && data.change > 0 ? `<div class="row"><span>Kembalian:</span><span>${escapeHtml(formatIDR(data.change))}</span></div>` : ""}
    ${data.footerText ? `<div class="divider"></div><div class="text-center" style="font-size: 11px;">${escapeHtml(data.footerText)}</div>` : ""}
  </main>
</body>
</html>`;
}
