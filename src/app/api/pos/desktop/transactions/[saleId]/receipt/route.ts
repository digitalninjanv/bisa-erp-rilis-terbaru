import { z } from "zod";
import { withCompanyReadOnly } from "@/db/tenant";
import { toPrintSettings } from "@/components/print/types";
import { formatDate } from "@/lib/format";
import { formatReceiptToEscPos } from "@/lib/escpos/receipt-template";
import type { ReceiptData } from "@/lib/escpos/types";
import { saleReceiptLine } from "@/lib/escpos/sale-receipt-line";
import { d } from "@/lib/money";
import { getSettings } from "@/server/catalog";
import { getSaleDetail } from "@/server/reports";
import { POS_API_CORS_HEADERS, resolvePosDevice } from "@/server/pos-device";
import { resolveMemberPermissions } from "@/server/member-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return Response.json(
    { ok: false, message },
    { status, headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

/** Nota transaksi server dicetak sebagai salinan melalui printer terminal. */
export async function GET(
  request: Request,
  context: { params: Promise<{ saleId: string }> },
) {
  const device = await resolvePosDevice(request);
  if (!device) return errorResponse("Token perangkat tidak dikenal.", 401);

  const { saleId: rawSaleId } = await context.params;
  const saleId = z.string().uuid().safeParse(rawSaleId);
  const paperWidth = z.enum(["58", "80"]).safeParse(
    new URL(request.url).searchParams.get("paperWidth") ?? "58",
  );
  if (!saleId.success || !paperWidth.success) {
    return errorResponse("Permintaan cetak nota tidak valid.", 400);
  }

  const permissions = await resolveMemberPermissions(device.companyId, device.userId);
  if (!permissions?.includes("pos.sell")) {
    return errorResponse("Akun terminal tidak lagi memiliki akses POS.", 403);
  }

  const receipt = await withCompanyReadOnly(device.companyId, async (tx) => {
    const [detail, settings] = await Promise.all([
      getSaleDetail(tx, device.companyId, saleId.data),
      getSettings(tx, device.companyId),
    ]);
    if (!detail || !["completed", "returned"].includes(detail.sale.status)) return null;

    const printSettings = toPrintSettings(settings, "nota");
    const data: ReceiptData = {
      companyName: settings?.legalName || "Bisa Minimarket",
      legalName: settings?.legalName,
      address: settings?.address,
      phone: settings?.phone,
      headerText: printSettings.headerText,
      footerText: printSettings.footerText,
      saleNumber: detail.sale.number,
      date: formatDate(detail.sale.date),
      cashierName: detail.cashier?.name ?? null,
      customerName: detail.customer?.name ?? null,
      lines: detail.lines.map(saleReceiptLine),
      subtotal: Number(detail.sale.subtotal),
      taxTotal: Number(detail.sale.taxTotal || 0),
      discountTotal: Number(detail.sale.discountTotal || 0),
      total: Number(detail.sale.total),
      outstanding: d(detail.sale.total).minus(detail.sale.paidTotal).clamp(0, Infinity).toNumber(),
      payments: detail.payments.map((payment) => ({
        methodName: payment.methodName || "Pembayaran",
        methodType: payment.methodType || "other",
        amount: Number(payment.amount),
        tendered: payment.tendered ? Number(payment.tendered) : null,
        reference: payment.reference,
      })),
      change: Number(detail.sale.changeTotal || 0),
      paperWidth: paperWidth.data === "80" ? "80mm" : "58mm",
      copyIndex: 1,
      showTax: printSettings.showTax,
      showCashier: printSettings.showCashier,
      showCustomer: printSettings.showCustomer,
      showQr: printSettings.showQr,
      openCashDrawer: false,
      cutPaper: true,
    };
    return formatReceiptToEscPos(data);
  });

  if (!receipt) return errorResponse("Nota selesai tidak ditemukan.", 404);
  const body = Uint8Array.from(receipt).buffer;
  return new Response(body, {
    headers: {
      ...POS_API_CORS_HEADERS,
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.bisa-erp.escpos",
      "Content-Length": String(receipt.byteLength),
    },
  });
}
