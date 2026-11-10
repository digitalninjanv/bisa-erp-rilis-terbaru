import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToString } from "react-dom/server";
import { eq } from "drizzle-orm";
import { companySettings } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { getSettings } from "@/server/catalog";
import { savePrintSettingsAction, uploadPrintLogoAction } from "@/server/actions/settings/cetak";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  applySignatureLabels,
  toPrintSettings,
  type PrintSettings,
} from "@/components/print/types";

// Actions need an authenticated company context and Next cache
// revalidation; both are replaced so the real action code runs against
// the real database (same pattern as accounting-actions-p2.test.ts).
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
}));

const ORG_ID = "01900000-0000-7000-8000-000000000001";

type PrintRow = Pick<
  typeof companySettings.$inferSelect,
  | "printTemplate"
  | "printLogoUrl"
  | "printAccentColor"
  | "printFont"
  | "printHeaderText"
  | "printFooterText"
  | "printShowSignature"
  | "printShowQr"
  | "printReceiptPaper"
  | "printDocumentPaper"
  // A-28 UI-2: kolom baru ikut disimpan/dipulihkan oleh berkas ini.
  | "printShowCashier"
  | "printShowTax"
  | "printShowCustomer"
  | "printShowSession"
  | "printShowBranding"
  | "printSignatureLabels"
>;

async function readPrintRow(): Promise<PrintRow> {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select({
        printTemplate: companySettings.printTemplate,
        printLogoUrl: companySettings.printLogoUrl,
        printAccentColor: companySettings.printAccentColor,
        printFont: companySettings.printFont,
        printHeaderText: companySettings.printHeaderText,
        printFooterText: companySettings.printFooterText,
        printShowSignature: companySettings.printShowSignature,
        printShowQr: companySettings.printShowQr,
        printReceiptPaper: companySettings.printReceiptPaper,
        printDocumentPaper: companySettings.printDocumentPaper,
        printShowCashier: companySettings.printShowCashier,
        printShowTax: companySettings.printShowTax,
        printShowCustomer: companySettings.printShowCustomer,
        printShowSession: companySettings.printShowSession,
        printShowBranding: companySettings.printShowBranding,
        printSignatureLabels: companySettings.printSignatureLabels,
      })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG_ID))
      .limit(1);
    return row;
  });
}

let original: PrintRow;

beforeAll(async () => {
  original = await readPrintRow();
});

afterAll(async () => {
  // The demo company is shared across integration files; restore the
  // exact print settings this file found.
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .update(companySettings)
      .set({ ...original, updatedAt: new Date() })
      .where(eq(companySettings.companyId, ORG_ID));
  });
});

describe("Print Engine settings (T4-4, D-13)", () => {
  it("saves print settings through the action and reads them back", async () => {
    const result = await savePrintSettingsAction({
      printTemplate: "classic",
      printLogoUrl: "https://example.com/logo.png",
      printAccentColor: "#1D4ED8",
      printFont: "serif",
      printHeaderText: "Teks kop uji T4-4",
      printFooterText: "Teks kaki uji T4-4",
      printShowSignature: false,
      printShowQr: true,
      printReceiptPaper: "thermal58",
      printDocumentPaper: "a5",
    });
    expect(result.ok).toBe(true);

    const row = await readPrintRow();
    expect(row).toEqual({
      printTemplate: "classic",
      printLogoUrl: "https://example.com/logo.png",
      printAccentColor: "#1D4ED8",
      printFont: "serif",
      printHeaderText: "Teks kop uji T4-4",
      printFooterText: "Teks kaki uji T4-4",
      printShowSignature: false,
      printShowQr: true,
      printReceiptPaper: "thermal58",
      printDocumentPaper: "a5",
      // A-28 UI-2: kolom elemen nota tidak disentuh aksi tanpa
      // field-nya — tetap pada nilai yang ditemukan berkas ini.
      printShowCashier: original.printShowCashier,
      printShowTax: original.printShowTax,
      printShowCustomer: original.printShowCustomer,
      printShowSession: original.printShowSession,
      printShowBranding: original.printShowBranding,
      printSignatureLabels: original.printSignatureLabels,
    });

    // The same values surface through getSettings + toPrintSettings,
    // which is exactly what the three print pages consume.
    const mapped = await withCompanyReadOnly(ORG_ID, async (tx) =>
      toPrintSettings(await getSettings(tx, ORG_ID)),
    );
    expect(mapped.template).toBe("classic");
    expect(mapped.receiptPaper).toBe("thermal58");
    expect(mapped.documentPaper).toBe("a5");
    expect(mapped.showSignature).toBe(false);
  });

  it("rejects an invalid accent color and an unknown template", async () => {
    const base = {
      printTemplate: "modern" as const,
      printLogoUrl: null,
      printAccentColor: "#111827",
      printFont: "sans" as const,
      printHeaderText: null,
      printFooterText: null,
      printShowSignature: true,
      printShowQr: true,
      printReceiptPaper: "thermal80" as const,
      printDocumentPaper: "a4" as const,
    };

    const badColor = await savePrintSettingsAction({ ...base, printAccentColor: "merah" });
    expect(badColor.ok).toBe(false);

    const badTemplate = await savePrintSettingsAction({
      ...base,
      // @ts-expect-error deliberately invalid enum value
      printTemplate: "fancy",
    });
    expect(badTemplate.ok).toBe(false);

    const badLogo = await savePrintSettingsAction({ ...base, printLogoUrl: "ftp://example.com/x.png" });
    expect(badLogo.ok).toBe(false);
  });
});

describe("Print Engine components", () => {
  const settings: PrintSettings = {
    template: "classic",
    logoUrl: null,
    accentColor: "#1D4ED8",
    font: "serif",
    headerText: "Kop perusahaan uji",
    footerText: "Kaki dokumen uji",
    showSignature: true,
    showQr: true,
    receiptPaper: "thermal80",
    documentPaper: "a4",
    showCashier: true,
    showTax: true,
    showCustomer: true,
    showSession: true,
    showBranding: true,
    signatureLabels: {},
  };

  it("renders the header before the body, with the template class and QR image", () => {
    const html = renderToString(
      jsxs(PrintShell, {
        settings,
        paper: "a4",
        children: [
          jsx(PrintHeader, {
            settings,
            companyName: "PT Uji Cetak",
            address: "Jl. Uji No. 1",
            phone: "0800-000",
            variant: "document",
            title: "Bukti Penerimaan Barang",
            number: "GRN-TST-001",
            dateLabel: "4 November 2026",
          }),
          jsx("p", { children: "ISI-DOKUMEN-UJI" }),
          jsx(PrintFooter, {
            settings,
            documentNumber: "GRN-TST-001",
            variant: "document",
            qrDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          }),
        ],
      }),
    );

    expect(html).toContain("print-doc--classic");
    expect(html).toContain('data-template="classic"');
    // SET-RCPT-01: the head (company identity) precedes the body.
    expect(html.indexOf("PT Uji Cetak")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("PT Uji Cetak")).toBeLessThan(html.indexOf("ISI-DOKUMEN-UJI"));
    // QR of the document number is embedded as an image.
    expect(html).toContain("data:image/png;base64,iVBORw0KGgo=");
    // Signature block is present while showSignature is on.
    expect(html).toContain("Dibuat oleh");
    expect(html).toContain("Diterima oleh");
    // @page rule carries the A4 size.
    expect(html).toContain("size: A4 portrait");
  });

  it("hides signatures when showSignature is false and QR when showQr is false", () => {
    const off: PrintSettings = { ...settings, template: "minimal", showSignature: false, showQr: false };
    const html = renderToString(
      jsxs(PrintShell, {
        settings: off,
        paper: "a5",
        children: [
          jsx(PrintHeader, {
            settings: off,
            companyName: "PT Uji Cetak",
            variant: "document",
            title: "Pesanan Pembelian",
            number: "PO-TST-001",
          }),
          jsx(PrintFooter, {
            settings: off,
            documentNumber: "PO-TST-001",
            variant: "document",
            qrDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          }),
        ],
      }),
    );
    expect(html).toContain("print-doc--minimal");
    expect(html).not.toContain("Dibuat oleh");
    expect(html).not.toContain("data:image/png");
    expect(html).toContain("size: A5 portrait");
  });

  it("renders a real QR data URL for a document number", async () => {
    const url = await documentQrDataUrl("INV-TST-001");
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("A-28 UI-2 — cetak satu pintu", () => {
  const base = {
    printTemplate: "modern" as const,
    printLogoUrl: null,
    printAccentColor: "#111827",
    printFont: "sans" as const,
    printHeaderText: null,
    printFooterText: null,
    printShowSignature: true,
    printShowQr: true,
    printReceiptPaper: "thermal80" as const,
    printDocumentPaper: "a4" as const,
  };

  it("menyimpan saklar elemen nota & label tanda tangan; kunci tak dikenal dibuang sanitasi", async () => {
    const result = await savePrintSettingsAction({
      ...base,
      printShowCashier: false,
      printShowTax: true,
      printShowCustomer: false,
      printShowSession: true,
      printShowBranding: false,
      printSignatureLabels: {
        faktur: ["Hormat kami", "Penerima"],
        dokumen_ngawur: ["Tidak boleh tersimpan"],
      },
    });
    expect(result.ok).toBe(true);

    const mapped = await withCompanyReadOnly(ORG_ID, async (tx) =>
      toPrintSettings(await getSettings(tx, ORG_ID)),
    );
    expect(mapped.showCashier).toBe(false);
    expect(mapped.showTax).toBe(true);
    expect(mapped.showCustomer).toBe(false);
    expect(mapped.showSession).toBe(true);
    expect(mapped.showBranding).toBe(false);
    expect(mapped.signatureLabels).toEqual({ faktur: ["Hormat kami", "Penerima"] });
  });

  it("unggah logo: data URL raster tersimpan; SVG & bukan-gambar ditolak", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const uploaded = await uploadPrintLogoAction({ dataUrl: png });
    expect(uploaded.ok).toBe(true);
    const row = await readPrintRow();
    expect(row.printLogoUrl).toBe(png);

    const svg = await uploadPrintLogoAction({
      dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    });
    expect(svg.ok).toBe(false);

    const text = await uploadPrintLogoAction({ dataUrl: "data:text/plain;base64,aGVsbG8=" });
    expect(text.ok).toBe(false);

    // Jalur simpan pengaturan dengan logo SVG juga tertolak.
    const savedSvg = await savePrintSettingsAction({
      ...base,
      printLogoUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    });
    expect(savedSvg.ok).toBe(false);
  });

  it("baris merek 'Dicetak dari Bisa ERP' hilang saat showBranding mati", () => {
    const branded: PrintSettings = {
      template: "modern",
      logoUrl: null,
      accentColor: "#111827",
      font: "sans",
      headerText: null,
      footerText: null,
      showSignature: true,
      showQr: false,
      receiptPaper: "thermal80",
      documentPaper: "a4",
      showCashier: true,
      showTax: true,
      showCustomer: true,
      showSession: true,
      showBranding: true,
      signatureLabels: {},
    };
    const render = (settings: PrintSettings) =>
      renderToString(
        jsx(PrintFooter, {
          settings,
          documentNumber: "DOC-UJI-001",
          variant: "document",
        }),
      );
    expect(render(branded)).toContain("Dicetak dari Bisa ERP");
    expect(render({ ...branded, showBranding: false })).not.toContain("Dicetak dari Bisa ERP");
  });

  it("applySignatureLabels mengganti label per posisi, nama tetap dari entri", () => {
    const settings: PrintSettings = {
      template: "modern",
      logoUrl: null,
      accentColor: "#111827",
      font: "sans",
      headerText: null,
      footerText: null,
      showSignature: true,
      showQr: true,
      receiptPaper: "thermal80",
      documentPaper: "a4",
      showCashier: true,
      showTax: true,
      showCustomer: true,
      showSession: true,
      showBranding: true,
      signatureLabels: { penerimaan: ["Penyerah", "", "Pemeriksa"] },
    };
    const entries = applySignatureLabels(settings, "penerimaan", [
      { label: "Diserahkan oleh", name: "Pemasok A" },
      { label: "Diterima oleh", name: "Petugas gudang" },
      { label: "Mengetahui", name: "Kepala gudang" },
    ]);
    expect(entries).toEqual([
      { label: "Penyerah", name: "Pemasok A" },
      // Posisi kosong di pengaturan jatuh ke label bawaan.
      { label: "Diterima oleh", name: "Petugas gudang" },
      { label: "Pemeriksa", name: "Kepala gudang" },
    ]);
  });
});
