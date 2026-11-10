import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PrintGroupSection,
  PrintSummaryLine,
  ReportDocument,
} from "@/components/akuntansi/report-document";
import { DEFAULT_PRINT_SETTINGS } from "@/components/print/types";

// FIX-R2 Tahap 1: bukti render kerangka dokumen laporan resmi —
// kop lengkap + NPWP + pernyataan satuan + tanda tangan dari
// PrintShell (RD2-01/02), konvensi simbol & kurung pada kelompok
// (RD2-04/11), dan garis ganda total akhir (RD2-04).
const settings = { ...DEFAULT_PRINT_SETTINGS };
const company = {
  legalName: "PT SimMart Sejahtera",
  address: "Jl. Merdeka No. 1, Jakarta",
  phone: "021-555-010",
  taxId: "01.234.567.8-901.000",
};

describe("ReportDocument — kerangka dokumen resmi", () => {
  const html = renderToStaticMarkup(
    createElement(
      ReportDocument,
      {
        settings,
        company,
        title: "Laporan Posisi Keuangan",
        periodStatement: "Per 31 Desember 2026",
        reference: "LPK-2026-12-31",
        printedByName: "Nadia Putri",
        qrDataUrl: null,
      },
      createElement("p", null, "ISI"),
    ),
  );

  it("memuat kop lengkap: nama legal, alamat, telepon, NPWP", () => {
    expect(html).toContain("PT SimMart Sejahtera");
    expect(html).toContain("Jl. Merdeka No. 1, Jakarta");
    expect(html).toContain("NPWP 01.234.567.8-901.000");
  });

  it("memuat judul resmi, rumusan periode posisi, dan pernyataan satuan", () => {
    expect(html).toContain("Laporan Posisi Keuangan");
    expect(html).toContain("Per 31 Desember 2026");
    expect(html).toContain("(Dalam Rupiah penuh)");
  });

  it("memuat blok tanda tangan Disusun oleh / Diperiksa oleh / Disetujui oleh", () => {
    expect(html).toContain("Disusun oleh");
    expect(html).toContain("Diperiksa oleh");
    expect(html).toContain("Disetujui oleh");
    expect(html).toContain("Nadia Putri");
  });

  it("tidak membawa footer nota penjualan pada dokumen laporan", () => {
    const receiptSettings = {
      ...settings,
      footerText: "Terima kasih telah berbelanja. Barang yang sudah dibeli tidak dapat ditukar tanpa nota.",
    };
    const report = renderToStaticMarkup(
      createElement(
        ReportDocument,
        {
          settings: receiptSettings,
          company,
          title: "Laporan Laba Rugi",
          periodStatement: "Untuk periode yang berakhir pada 31 Desember 2026",
          reference: "LLR-2026-12-31",
          qrDataUrl: null,
        },
        createElement("p", null, "ISI"),
      ),
    );
    expect(report).not.toContain("Terima kasih");
    expect(report).toContain("jurnal double-entry");
  });

  it("Tanpa NPWP di data perusahaan, baris NPWP tidak dirender", () => {
    const noTax = renderToStaticMarkup(
      createElement(
        ReportDocument,
        {
          settings,
          company: { ...company, taxId: null },
          title: "Laporan Laba Rugi",
          periodStatement: "Untuk periode yang berakhir pada 31 Desember 2026",
          reference: "LLR-2026-12-31",
          qrDataUrl: null,
        },
        createElement("p", null, "ISI"),
      ),
    );
    expect(noTax).not.toContain("NPWP");
    expect(noTax).toContain("Untuk periode yang berakhir pada 31 Desember 2026");
  });
});

describe("PrintGroupSection — konvensi kelompok cetak", () => {
  const html = renderToStaticMarkup(
    createElement(PrintGroupSection, {
      title: "Pendapatan",
      rows: [
        { key: "a", code: "4000", name: "Penjualan", amount: 1500000, prior: 1200000 },
        { key: "b", code: "4020", name: "Retur penjualan", amount: -50000, prior: 0 },
      ],
      totalLabel: "Total pendapatan",
      total: 1450000,
      totalPrior: 1200000,
    }),
  );

  it("Rp hanya pada baris pertama kelompok; rincian tanpa simbol", () => {
    // Baris pertama membawa Rp; baris kedua angka polos berkurung.
    expect(html).toContain("1.500.000");
    expect(html).toContain("(50.000)");
    expect(html).not.toContain("(Rp");
  });

  it("nol pada baris rincian menjadi strip", () => {
    expect(html).toContain("—");
  });

  it("subtotal bergaris tunggal (rule-total) dan membawa Rp", () => {
    expect(html).toContain("rule-total");
    expect(html).toContain("Total pendapatan");
  });

  it("kelompok kosong tidak dirender sama sekali", () => {
    const empty = renderToStaticMarkup(
      createElement(PrintGroupSection, {
        title: "Beban lain-lain",
        rows: [],
        totalLabel: "Total beban lain-lain",
        total: 0,
      }),
    );
    expect(empty).toBe("");
  });
});

describe("PrintSummaryLine — bahasa garis total", () => {
  it("total akhir memakai garis ganda (rule-final)", () => {
    const html = renderToStaticMarkup(
      createElement(PrintSummaryLine, { label: "Laba bersih", amount: 250000, prior: 100000, final: true }),
    );
    expect(html).toContain("rule-final");
    expect(html).toContain("Laba bersih");
  });

  it("subtotal memakai garis tunggal (rule-total)", () => {
    const html = renderToStaticMarkup(
      createElement(PrintSummaryLine, { label: "Laba kotor", amount: 250000, strong: true }),
    );
    expect(html).toContain("rule-total");
    expect(html).not.toContain("rule-final");
  });
});
