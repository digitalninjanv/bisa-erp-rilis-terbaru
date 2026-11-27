"use server";

import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { getSaleDetail } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { verifyReceiptPrintToken } from "@/server/pos";
import { toPrintSettings } from "@/components/print/types";
import { formatDate } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import type { ReceiptData } from "@/lib/escpos/types";
import { saleReceiptLine } from "@/lib/escpos/sale-receipt-line";
import { d } from "@/lib/money";

/**
 * Mengambil data terstruktur nota penjualan untuk dicetak langsung
 * ke printer thermal via ESC/POS tanpa dialog browser.
 */
export async function getSaleReceiptDataAction(
  saleId: string,
  copyIndex = 0,
  options?: { printToken?: string | null },
) {
  return guard(async () => {
    if (!z.string().uuid().safeParse(saleId).success) {
      throw new AppError("VALIDATION", "ID transaksi penjualan tidak valid.");
    }
    const ctx = await requirePermission("pos.sell");
    if (!Number.isSafeInteger(copyIndex) || copyIndex < 0) {
      throw new AppError("VALIDATION", "Nomor salinan tidak valid.");
    }
    // Tanpa token cetak-awal yang valid (atau untuk copyIndex > 0), pemanggil
    // wajib memiliki izin cetak ulang historis dan tercatat di log audit.
    const result = await withCompany(ctx.company.id, async (tx) => {
      const fresh =
        copyIndex === 0 && options?.printToken
          ? await verifyReceiptPrintToken(tx, {
              companyId: ctx.company.id,
              userId: ctx.user.id,
              saleId,
              token: options.printToken,
            })
          : false;
      const isReprint = copyIndex > 0 || !fresh;
      if (isReprint) {
        await requirePermission("pos.receipt.reprint");
      }

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
        taxId: settings?.taxId ?? null,
        address: detail.branch?.address ?? settings?.address,
        phone: detail.branch?.phone ?? settings?.phone,
        branchName: detail.branch?.name ?? null,
        headerText: printSettings.headerText,
        footerText: printSettings.footerText,
        saleNumber: detail.sale.number,
        date: formatDate(detail.sale.date),
        saleStatus: detail.sale.status,
        voidReason: detail.sale.voidReason ?? null,
        dueDate: detail.sale.dueDate ? formatDate(detail.sale.dueDate) : null,
        sessionId: detail.sale.sessionId ?? null,
        cashierName: detail.cashier?.name ?? null,
        customerName: detail.customer?.name ?? null,
        lines: detail.lines.map(saleReceiptLine),
        subtotal: Number(detail.sale.subtotal),
        taxTotal: Number(detail.sale.taxTotal || 0),
        discountTotal: Number(detail.sale.discountTotal || 0),
        roundingAdjustment: Number(detail.sale.roundingAdjustment || 0),
        total: Number(detail.sale.total),
        outstanding: d(detail.sale.total).minus(detail.sale.paidTotal).clamp(0, Infinity).toNumber(),
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
        showSession: printSettings.showSession,
        showQr: printSettings.showQr,
      };

      if (isReprint) {
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
