import { describe, expect, it } from "vitest";
import { buildTerminalReceiptData } from "@/lib/pos/build-receipt-data";
import { DEFAULT_PRINTER_PREFERENCES, SERIAL_BAUD_RATES } from "@/lib/escpos/types";
import { findLocalProductMatch } from "@/lib/pos/product-cache";
import type { Method, ProductOption, ReceiptProfile } from "@/components/pos/terminal-types";

describe("POS modern cashier ergonomics & receipt assembly", () => {
  it("provides sensible auto-print and baud rate defaults", () => {
    expect(DEFAULT_PRINTER_PREFERENCES.autoPrint).toBe(true);
    expect(DEFAULT_PRINTER_PREFERENCES.serialBaudRate).toBe(9600);
    expect(SERIAL_BAUD_RATES).toContain(115200);
  });

  it("matches product barcode, packaging barcode, and SKU locally in cache", () => {
    const pool: ProductOption[] = [
      {
        id: "prod-1",
        name: "Air Mineral 600ml",
        sku: "AIR-600",
        barcode: "8991001001001",
        salePrice: "3500",
        stock: 24,
        trackStock: true,
        unitCode: "PCS",
        packagings: [
          {
            id: "pack-dus",
            name: "Dus",
            isi: "24",
            salePrice: "78000",
            barcode: "8991001001024",
            isDefaultSale: false,
          },
        ],
      },
    ];

    expect(findLocalProductMatch(pool, "8991001001001")?.id).toBe("prod-1");
    const packHit = findLocalProductMatch(pool, "8991001001024");
    expect(packHit?.id).toBe("prod-1");
    expect(packHit?.matchedPackagingId).toBe("pack-dus");
    expect(findLocalProductMatch(pool, "AIR-600")?.id).toBe("prod-1");
    expect(findLocalProductMatch(pool, "UNKNOWN")).toBeNull();
  });

  it("builds instant ReceiptData for checkout without redundant DB query", () => {
    const profile: ReceiptProfile = {
      companyName: "Minimarket Maju",
      taxId: "02.111.222.3-444.000",
      address: "Jl. Sudirman No. 1",
      phone: "081111222333",
      headerText: "Buka 07.00 - 22.00",
      footerText: "Terima kasih!",
      paperWidth: "58mm",
      showTax: true,
      showCashier: true,
      showCustomer: true,
      showQr: true,
      cashierName: "Ayu",
      openCashDrawer: true,
      cutPaper: true,
    };
    const cashMethod: Method = { id: "m-cash", code: "CASH", name: "Tunai", type: "cash", instructions: null };
    const cache: Record<string, ProductOption> = {
      p1: {
        id: "p1",
        name: "Susu UHT 1L",
        sku: "SUSU-1L",
        barcode: "8992001",
        salePrice: "18000",
        stock: 10,
        trackStock: true,
        unitCode: "PCS",
      },
    };

    const receipt = buildTerminalReceiptData({
      saleNumber: "POS-2026-0123",
      cart: [{ productId: "p1", qty: 2 }],
      quote: null,
      cache,
      payments: [{ methodId: "m-cash", amount: 36000, tendered: 50000 }],
      methodById: new Map([[cashMethod.id, cashMethod]]),
      receiptProfile: profile,
      customerName: null,
      dueDate: null,
      total: 36000,
      change: 14000,
      outstanding: 0,
      date: "25 Nov 2026",
    });

    expect(receipt.companyName).toBe("Minimarket Maju");
    expect(receipt.taxId).toBe("02.111.222.3-444.000");
    expect(receipt.lines).toEqual([
      { name: "Susu UHT 1L", qty: 2, qtyBase: 2, unit: null, price: 18000, subtotal: 36000, discount: 0 },
    ]);
    expect(receipt.change).toBe(14000);
    expect(receipt.payments[0]).toMatchObject({ methodName: "Tunai", tendered: 50000 });
  });
});

describe("POS receipt group-price arithmetic", () => {
  it("prints the normal unit price and the group discount so the row reconciles", () => {
    const profile: ReceiptProfile = {
      companyName: "Minimarket Maju",
      address: null,
      phone: null,
      headerText: null,
      footerText: null,
      paperWidth: "80mm",
      showTax: true,
      showCashier: true,
      showCustomer: true,
      showQr: false,
      cashierName: "Ayu",
      openCashDrawer: true,
      cutPaper: true,
    };
    const method: Method = { id: "m-cash", code: "CASH", name: "Tunai", type: "cash", instructions: null };
    const quote = {
      subtotal: 2000,
      discountTotal: 200,
      taxTotal: 0,
      roundingAdjustment: 0,
      total: 1800,
      lines: [{
        productId: "p1",
        packagingId: null,
        unitPrice: 1000,
        groupUnitPrice: 900,
        lineTotal: 1800,
        discountAmount: 200,
        isiSnapshot: 1,
      }],
    };
    const receipt = buildTerminalReceiptData({
      saleNumber: "POS-2026-0124",
      cart: [{ productId: "p1", qty: 2 }],
      quote: quote as never,
      cache: {
        p1: { id: "p1", name: "Teh Botol", sku: "TEH-1", barcode: null, salePrice: "1000", stock: 10, trackStock: true, unitCode: "PCS" },
      },
      payments: [{ methodId: "m-cash", amount: 1800, tendered: 2000 }],
      methodById: new Map([[method.id, method]]),
      receiptProfile: profile,
      customerName: null,
      dueDate: null,
      total: 1800,
      change: 200,
      outstanding: 0,
    });
    expect(receipt.lines[0]).toMatchObject({ price: 1000, discount: 200, subtotal: 1800 });
  });
});
