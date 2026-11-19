import { expect, it } from "vitest";
import { saleReceiptLine } from "@/lib/escpos/sale-receipt-line";
import { formatReceiptToEscPos } from "@/lib/escpos/receipt-template";
import type { ReceiptData } from "@/lib/escpos/types";

it("shows packaging quantity and price using the sale snapshot", () => {
  const line = { productName: "Air", packagingId: "pack", packagingName: "Dus", qty: "60", qtyInput: "1.5",
    isiSnapshot: "40", unitPrice: "3625", lineTotal: "217500", discountAmount: "0" };
  expect(saleReceiptLine(line)).toEqual({ name: "Air (Dus)", qty: 1.5, unit: "Dus", price: 145000, subtotal: 217500, discount: 0 });
  expect(saleReceiptLine({ ...line, packagingId: null, packagingName: null, qty: "2", qtyInput: null, isiSnapshot: null }).qty).toBe(2);
});

it("supports old offline debt receipts and explicit paid balances after collection", () => {
  const receipt: ReceiptData = { companyName: "Toko", saleNumber: "POS-1", date: "2026-11-19", lines: [], subtotal: 4000,
    taxTotal: 0, discountTotal: 0, total: 4000, payments: [{ methodName: "Utang", methodType: "credit", amount: 4000 }],
    change: 0, paperWidth: "58mm", showQr: false, cutPaper: false };
  const render = (data: ReceiptData) => new TextDecoder().decode(formatReceiptToEscPos(data));
  expect(render(receipt)).toContain("BELUM LUNAS");
  expect(render({ ...receipt, outstanding: 1000 })).toContain("1.000");
  expect(render({ ...receipt, outstanding: 0 })).not.toContain("BELUM LUNAS");
  expect(render({ ...receipt, outstanding: 0 })).toContain("LUNAS");
});
