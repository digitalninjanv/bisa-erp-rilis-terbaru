"use server";

import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { getSaleDetail } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { toPrintSettings } from "@/components/print/types";
import { formatDate } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import type { ReceiptData } from "@/lib/escpos/types";

/**
 * Mengambil data terstruktur nota penjualan untuk dicetak langsung
 * ke printer thermal via ESC/POS tanpa dialog browser.
 */
export async function getSaleReceiptDataAction(saleId: string, copyIndex = 0) {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    if (!Number.isSafeInteger(copyIndex) || copyIndex < 0) {
      throw new AppError("VALIDATION", "Nomor salinan tidak valid.");
    }
    if (copyIndex > 0) await requirePermission("pos.receipt.reprint");
    const withTenant = copyIndex > 0 ? withCompany : withCompanyReadOnly;

    const result = await withTenant(ctx.company.id, async (tx) => {
      const [detail, settings] = await Promise.all([
        getSaleDetail(tx, ctx.company.id, saleId),
        getSettings(tx, ctx.company.id),
      ]);

      if (!detail) {
        throw new Error("Data transaksi tidak ditemukan.");
      }

      const printSettings = toPrintSettings(settings, "nota");

      const receiptData: ReceiptData = {
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
        lines: detail.lines.map((l) => ({
          name: l.packagingName ? `${l.productName} (${l.packagingName})` : l.productName,
          qty: Number(l.qty),
          unit: l.packagingName || null,
          price: Number(l.unitPrice),
          subtotal: Number(l.lineTotal),
          discount: Number(l.discountAmount || 0),
        })),
        subtotal: Number(detail.sale.subtotal),
        taxTotal: Number(detail.sale.taxTotal || 0),
        discountTotal: Number(detail.sale.discountTotal || 0),
        total: Number(detail.sale.total),
        payments: detail.payments.map((p) => ({
          methodName: p.methodName || "Pembayaran",
          methodType: p.methodType || "other",
          amount: Number(p.amount),
          tendered: p.tendered ? Number(p.tendered) : null,
          reference: p.reference,
        })),
        change: Number(detail.sale.changeTotal || 0),
        showTax: printSettings.showTax,
        showCashier: printSettings.showCashier,
        showCustomer: printSettings.showCustomer,
        showQr: printSettings.showQr,
      };

      if (copyIndex > 0) {
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "pos.receipt.reprint",
          entityType: "sale",
          entityId: saleId,
          after: { number: detail.sale.number, copyIndex, transport: "thermal" },
        });
      }
      return receiptData;
    });

    return result;
  });
}
