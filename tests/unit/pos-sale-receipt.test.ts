import { expect, it } from "vitest";
import { saleReceiptLine } from "@/lib/escpos/sale-receipt-line";
import { formatReceiptToEscPos } from "@/lib/escpos/receipt-template";
import { renderReceiptHtml } from "@/lib/pos/receipt-html";
import type { ReceiptData } from "@/lib/escpos/types";

it("shows packaging quantity and price using the sale snapshot", () => {
  const line = { productName: "Air", packagingId: "pack", packagingName: "Dus", qty: "60", qtyInput: "1.5",
    isiSnapshot: "40", unitPrice: "3625", lineTotal: "217500", discountAmount: "0" };
  expect(saleReceiptLine(line)).toEqual({ name: "Air (Dus)", qty: 1.5, qtyBase: 60, unit: "Dus", price: 145000, subtotal: 217500, discount: 0 });
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

it("mencetak identitas outlet, NPWP, sesi, jatuh tempo, jumlah item dan status lunas", () => {
  const receipt: ReceiptData = {
    companyName: "Bisa Minimarket",
    taxId: "01.234.567.8-901.000",
    branchName: "Cabang Melati",
    address: "Jl. Melati No. 21",
    phone: "021-555-0123",
    saleNumber: "INV-2026-00016",
    date: "27 Nov 2026",
    dueDate: "4 Des 2026",
    sessionId: "01a208bc-1234-5678-9abc-def012345678",
    cashierName: "Nadia Putri",
    lines: [
      { name: "Air Mineral 1.5L", qty: 2, price: 7500, subtotal: 15000 },
    ],
    subtotal: 15000,
    taxTotal: 1500,
    discountTotal: 0,
    total: 15000,
    payments: [{ methodName: "Tunai", methodType: "cash", amount: 15000, tendered: 20000 }],
    change: 5000,
    paperWidth: "80mm",
    showQr: false,
    cutPaper: false,
  };
  const text = Buffer.from(formatReceiptToEscPos(receipt)).toString("latin1");
  expect(text).toContain("CABANG MELATI");
  expect(text).toContain("NPWP: 01.234.567.8-901.000");
  expect(text).toContain("Sesi");
  expect(text).toContain("01a208bc");
  expect(text).toContain("Jatuh tempo");
  expect(text).toContain("4 Des 2026");
  expect(text).toContain("Jumlah item:");
  expect(text).toContain("Diterima:");
  expect(text).toContain("Status:");
  expect(text).toContain("LUNAS");
});

it("HTML nota offline memuat outlet, jumlah item, status, dan kebijakan retur bawaan", () => {
  const html = renderReceiptHtml({
    companyName: "Bisa Minimarket",
    taxId: "01.234.567.8-901.000",
    branchName: "Cabang Melati",
    address: "Jl. Melati No. 21",
    phone: "021-555-0123",
    saleNumber: "INV-2026-00016",
    date: "27 Nov 2026",
    cashierName: "Nadia Putri",
    lines: [{ name: "Air Mineral 1.5L", qty: 2, price: 7500, subtotal: 15000 }],
    subtotal: 15000,
    taxTotal: 0,
    discountTotal: 0,
    total: 15000,
    payments: [{ methodName: "Tunai", methodType: "cash", amount: 15000, tendered: 20000 }],
    change: 5000,
    paperWidth: "80mm",
    showQr: false,
    cutPaper: false,
  });
  expect(html).toContain("Cabang Melati");
  expect(html).toContain("Jumlah item:");
  expect(html).toContain("LUNAS");
  expect(html).toContain("Barang yang sudah dibeli tidak dapat ditukar tanpa nota.");
});

it("mempertahankan kuantitas pecahan dan total satuan dasar pada HTML/ESC/POS", () => {
  const receipt: ReceiptData = {
    companyName: "Toko",
    saleNumber: "POS-2",
    date: "2026-11-27",
    lines: [
      { name: "Daging", qty: 1.5, qtyBase: 60, unit: "Dus", price: 10000, subtotal: 15000 },
    ],
    subtotal: 15000,
    total: 15000,
    payments: [{ methodName: "Tunai", amount: 15000 }],
    change: 0,
    paperWidth: "58mm",
    showQr: false,
    cutPaper: false,
  };
  const html = renderReceiptHtml(receipt);
  const escpos = Buffer.from(formatReceiptToEscPos(receipt)).toString("latin1");
  expect(html).toContain("1,5 Dus");
  expect(escpos).toContain("1,5 Dus");
  expect(html).toContain("60 (1 jenis)");
  expect(escpos).toContain("60 (1 jenis)");
});

it("menandai nota retur dan void pada HTML/ESC/POS", () => {
  const base: ReceiptData = {
    companyName: "Toko",
    saleNumber: "POS-3",
    date: "2026-11-27",
    lines: [],
    subtotal: 0,
    total: 0,
    payments: [],
    change: 0,
    paperWidth: "58mm",
    showQr: false,
    cutPaper: false,
  };
  expect(renderReceiptHtml({ ...base, saleStatus: "returned" })).toContain("NOTA RETUR");
  expect(Buffer.from(formatReceiptToEscPos({ ...base, saleStatus: "returned" })).toString("latin1")).toContain("NOTA RETUR");
  expect(renderReceiptHtml({ ...base, saleStatus: "voided", voidReason: "Salah input" })).toContain("VOID");
  expect(Buffer.from(formatReceiptToEscPos({ ...base, saleStatus: "voided", voidReason: "Salah input" })).toString("latin1")).toContain("VOID");
});
