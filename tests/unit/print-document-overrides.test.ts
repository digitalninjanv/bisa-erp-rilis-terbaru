import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINT_SETTINGS,
  applyPrintDocumentOverride,
  sanitizePrintDocumentOverrides,
  toPrintSettings,
} from "@/components/print/types";

describe("print document overrides", () => {
  it("sanitizes unknown documents and invalid values", () => {
    const result = sanitizePrintDocumentOverrides({
      nota: {
        template: "classic",
        font: "serif",
        receiptPaper: "thermal58",
        showQr: false,
        accentColor: "#123456",
      },
      faktur: { template: "unknown", documentPaper: "letter" },
      unknown: { template: "modern" },
    });
    expect(result.nota).toEqual({
      template: "classic",
      font: "serif",
      receiptPaper: "thermal58",
      showQr: false,
      accentColor: "#123456",
    });
    expect(result.faktur).toBeUndefined();
    expect(result).not.toHaveProperty("unknown");
  });

  it("merges per-document overrides above the global settings", () => {
    const merged = applyPrintDocumentOverride(
      DEFAULT_PRINT_SETTINGS,
      { nota: { template: "minimal", showQr: false } },
      "nota",
    );
    expect(merged.template).toBe("minimal");
    expect(merged.showQr).toBe(false);
    expect(merged.font).toBe(DEFAULT_PRINT_SETTINGS.font);
  });

  it("applies the override only for the requested document", () => {
    const row = {
      printTemplate: "modern",
      printFont: "sans",
      printReceiptPaper: "thermal80",
      printDocumentPaper: "a4",
      printDocumentSettings: {
        nota: { template: "classic", receiptPaper: "thermal58" },
        faktur: { template: "minimal" },
      },
    };
    expect(toPrintSettings(row, "nota").template).toBe("classic");
    expect(toPrintSettings(row, "nota").receiptPaper).toBe("thermal58");
    expect(toPrintSettings(row, "faktur").template).toBe("minimal");
    expect(toPrintSettings(row, "pembelian").template).toBe("modern");
  });
});