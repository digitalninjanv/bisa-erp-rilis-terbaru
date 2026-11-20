import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettings, parseOrigin, saveSettings, isPrivateOrLoopbackHost } from "../../pos-electron/settings.cjs";
import { normalizeBarcode } from "@/lib/import/import-cells";
import { renderReceiptHtml } from "@/lib/pos/receipt-html";

describe("pos-electron settings & origin parsing", () => {
  it("allows loopback HTTP origins", () => {
    expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(parseOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(parseOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("allows private LAN IPv4 and .local domains over HTTP", () => {
    expect(isPrivateOrLoopbackHost("192.168.1.50")).toBe(true);
    expect(isPrivateOrLoopbackHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.20.10.5")).toBe(true);
    expect(isPrivateOrLoopbackHost("kasir.local")).toBe(true);

    expect(parseOrigin("http://192.168.1.100:3000")).toBe("http://192.168.1.100:3000");
    expect(parseOrigin("http://10.0.0.5:8000")).toBe("http://10.0.0.5:8000");
    expect(parseOrigin("http://172.16.2.1:3000")).toBe("http://172.16.2.1:3000");
    expect(parseOrigin("http://pos-server.local:3000")).toBe("http://pos-server.local:3000");
  });

  it("allows public HTTPS origins", () => {
    expect(parseOrigin("https://app.bisaerp.com")).toBe("https://app.bisaerp.com");
    expect(parseOrigin("https://pos.mycompany.co.id")).toBe("https://pos.mycompany.co.id");
  });

  it("rejects public HTTP and origins with path or credentials", () => {
    expect(() => parseOrigin("http://erp.example.com")).toThrow();
    expect(() => parseOrigin("http://localhost:3000/app")).toThrow();
    expect(() => parseOrigin("http://user:pass@localhost:3000")).toThrow();
    expect(() => parseOrigin("http://localhost:3000?search=1")).toThrow();
  });

  it("loads default settings when pos-settings.json does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pos-test-"));
    try {
      const settings = loadSettings(dir);
      expect(settings.origin).toBe("http://localhost:3000");
      expect(settings.printer).toBe("");
      expect(settings.width).toBe(80);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves and loads settings atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "pos-test-"));
    try {
      saveSettings(dir, {
        origin: "http://192.168.1.200:3000",
        printer: "EPSON_TM_T82",
        width: 58,
      });
      const settings = loadSettings(dir);
      expect(settings.origin).toBe("http://192.168.1.200:3000");
      expect(settings.printer).toBe("EPSON_TM_T82");
      expect(settings.width).toBe(58);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("normalizeBarcode string precision", () => {
  it("preserves exact digits for large scientific notation barcodes", () => {
    // 17-digit barcode in Excel scientific notation: 8.991234567890123e+16
    const input = "8.991234567890123e+16";
    const result = normalizeBarcode(input);
    expect(result).toBe("89912345678901230");
  });

  it("expands standard scientific notation correctly", () => {
    expect(normalizeBarcode("8.99123456789e+12")).toBe("8991234567890");
    expect(normalizeBarcode("1.23e+4")).toBe("12300");
    expect(normalizeBarcode("1e+6")).toBe("1000000");
  });

  it("cleans standard barcodes without scientific notation", () => {
    expect(normalizeBarcode(" 899-1234 5678 ")).toBe("89912345678");
    expect(normalizeBarcode("BARCODE001")).toBe("BARCODE001");
    expect(normalizeBarcode(null)).toBeNull();
  });
});

describe("renderReceiptHtml offline receipt builder", () => {
  it("renders a valid HTML print document with .print-doc", () => {
    const html = renderReceiptHtml({
      companyName: "Toko Berkah",
      saleNumber: "POS-2026-0001",
      date: "2026-11-20 10:00",
      cashierName: "Kasir 1",
      customerName: "Pelanggan Umum",
      lines: [
        { name: "Kopi Arabika", qty: 2, price: 15000, subtotal: 30000 },
        { name: "Croissant", qty: 1, price: 20000, subtotal: 20000, discount: 2000 },
      ],
      subtotal: 50000,
      discountTotal: 2000,
      total: 48000,
      payments: [{ methodName: "Tunai", amount: 48000, tendered: 50000 }],
      change: 2000,
    });

    expect(html).toContain("Toko Berkah");
    expect(html).toContain("POS-2026-0001");
    expect(html).toContain("print-doc");
    expect(html).toContain("Kopi Arabika");
    expect(html).toContain("Croissant");
    expect(html).toContain("TOTAL:");
    expect(html).toContain("Kembalian:");
  });
});
