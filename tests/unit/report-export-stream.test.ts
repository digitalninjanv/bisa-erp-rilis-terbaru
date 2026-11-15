import { describe, expect, it } from "vitest";
import {
  empty,
  money,
  num,
  reportTableToCsv,
  reportTableToCsvStream,
  text,
  type ReportTable,
  xlsxResponse,
} from "@/server/reports/export-table";

const table: ReportTable = {
  sheetName: "Fixture",
  company: "PT Contoh",
  title: "Laporan",
  subtitle: "Periode",
  csvFirstRow: [text("=Judul"), num(12), empty()],
  titleRow: [text('Toko "Pusat", Jakarta'), empty()],
  headerRow: [text("A"), text("B")],
  xlsxHeaders: [],
  widths: [],
  csvWidth: 4,
  rows: [
    {
      kind: "data",
      cells: [text('Baris, "satu"\nlanjut'), money(1234.5), text("=HYPERLINK(\"x\")"), num(-2), text("diabaikan")],
    },
    { kind: "blank", cells: [empty(), text("baris akhir")] },
  ],
};

describe("reportTableToCsvStream", () => {
  it("matches the legacy CSV bytes, including BOM, escaping and column width", async () => {
    const response = new Response(reportTableToCsvStream(table));
    const actual = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await response.arrayBuffer(),
    );

    expect(actual).toBe(`\uFEFF${reportTableToCsv(table)}`);
  });

  it("emits bounded multi-row chunks and no trailing newline", async () => {
    const largeTable = {
      ...table,
      rows: Array.from({ length: 257 }, (_, index) => table.rows[index % table.rows.length]),
    };
    const reader = reportTableToCsvStream(largeTable).getReader();
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const chunks: string[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    expect(chunks[0]).toMatch(/^\uFEFF/);
    expect(chunks.slice(1).every((chunk) => chunk.startsWith("\r\n"))).toBe(true);
    expect(chunks.length).toBeLessThan(largeTable.rows.length);
    expect(chunks.join("")).toBe(`\uFEFF${reportTableToCsv(largeTable)}`);
    expect(chunks.at(-1)).not.toMatch(/\r\n$/);
  });

  it("builds a valid XLSX response when the XLSX path is requested", async () => {
    const response = await xlsxResponse("fixture.xlsx", table);
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const cells = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]).flat();

    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(cells).toContain("PT Contoh");
    expect(cells).toContain(1234.5);
  });
});
