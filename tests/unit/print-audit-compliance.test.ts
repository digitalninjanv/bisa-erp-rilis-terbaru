import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintFooter } from "@/components/print/print-shell";
import { DEFAULT_PRINT_SETTINGS } from "@/components/print/types";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const globalsCss = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function readFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("PRINT-AUDIT: CSS Paged Media & Layout Invariants", () => {
  it("globals.css mengamankan footer, total bar, dan summary dari page break splitting", () => {
    expect(globalsCss).toContain(".print-doc footer");
    expect(globalsCss).toContain(".print-total-bar");
    expect(globalsCss).toMatch(/\.print-doc footer[\s\S]*?break-inside:\s*avoid/);
  });

  it("globals.css mencegah orphan headings di dasar halaman", () => {
    expect(globalsCss).toContain(".print-doc h1");
    expect(globalsCss).toMatch(/\.print-doc h1[\s\S]*?break-after:\s*avoid/);
  });

  it("globals.css membersihkan dekorasi link navigasi saat dicetak", () => {
    const printBlock = globalsCss.slice(globalsCss.indexOf("@media print"));
    expect(printBlock).toMatch(/a\s*\{[\s\S]*?text-decoration:\s*none\s*!important/);
  });

  it("PrintFooter merender tag footer dengan break-inside-avoid", () => {
    const html = renderToStaticMarkup(
      createElement(PrintFooter, {
        settings: DEFAULT_PRINT_SETTINGS,
        documentNumber: "PO-2026-001",
        variant: "document",
      }),
    );
    expect(html).toMatch(/<footer[^>]*class="[^"]*break-inside-avoid[^"]*"/);
  });
});

describe("PRINT-AUDIT: Dokumen Formal Mewariskan taxId ke PrintHeader", () => {
  const formalPages = [
    "src/app/app/gudang/pembelian/[id]/cetak/page.tsx",
    "src/app/app/gudang/penerimaan/[id]/cetak/page.tsx",
    "src/app/app/gudang/retur-pembelian/[id]/cetak/page.tsx",
    "src/app/app/gudang/transfer/[id]/cetak/page.tsx",
    "src/app/app/gudang/opname/lembar-hitung/page.tsx",
    "src/app/app/akuntansi/(hr)/payroll/[id]/cetak/page.tsx",
    "src/app/app/akuntansi/(cetak)/jurnal/[id]/cetak/page.tsx",
    "src/app/app/pos/nota/[id]/faktur/page.tsx",
  ];

  for (const pagePath of formalPages) {
    it(`${pagePath} meneruskan taxId ke PrintHeader`, () => {
      const content = readFile(pagePath);
      expect(content).toMatch(/<PrintHeader[\s\S]*?taxId=\{settings\?\.taxId\}/);
    });
  }
});

describe("PRINT-AUDIT: Penanda Void / Pembatalan Tegas di Seluruh Dokumen", () => {
  const voidPages = [
    "src/app/app/gudang/pembelian/[id]/cetak/page.tsx",
    "src/app/app/gudang/penerimaan/[id]/cetak/page.tsx",
    "src/app/app/gudang/retur-pembelian/[id]/cetak/page.tsx",
    "src/app/app/gudang/transfer/[id]/cetak/page.tsx",
    "src/app/app/pos/nota/[id]/faktur/page.tsx",
  ];

  for (const pagePath of voidPages) {
    it(`${pagePath} memuat banner pembatalan bergaris ganda tegas`, () => {
      const content = readFile(pagePath);
      expect(content).toMatch(/Dokumen dibatalkan/);
      expect(content).toMatch(/border-double/);
    });
  }
});
