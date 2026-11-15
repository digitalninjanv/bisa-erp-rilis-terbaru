import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { productXlsxStreamResponse } from "@/server/catalog";

describe("productXlsxStreamResponse", () => {
  it("streams keyset pages and preserves text, numeric cells, and the filter range", async () => {
    const loadPage = vi.fn(async (cursor: string) => {
      expect(cursor).toBe("next");
      return {
        rows: [["000002", "Product two", 20_000, 3]],
        nextCursor: null,
      };
    });

    const response = productXlsxStreamResponse({
      filename: "produk-test.xlsx",
      headers: ["Kode Barang", "Nama Barang", "Harga Jual", "Stok"],
      widths: [14, 36, 14, 12],
      firstPage: {
        rows: [["000001", "=1+1", 12_500.5, 2]],
        nextCursor: "next",
      },
      loadPage,
    });

    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("produk-test.xlsx");

    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), {
      type: "buffer",
      cellFormula: true,
    });
    const sheet = workbook.Sheets.Produk;

    expect(sheet.A2).toMatchObject({ t: "s", v: "000001" });
    expect(sheet.B2).toMatchObject({ t: "s", v: "=1+1" });
    expect(sheet.B2).not.toHaveProperty("f");
    expect(sheet.C2).toMatchObject({ t: "n", v: 12_500.5 });
    expect(sheet.A3).toMatchObject({ t: "s", v: "000002" });
    expect(sheet.C3).toMatchObject({ t: "n", v: 20_000 });
    expect(sheet["!autofilter"]).toMatchObject({ ref: "A1:D3" });
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("supports a domain-specific worksheet name", async () => {
    const response = productXlsxStreamResponse({
      filename: "nilai-persediaan-test.xlsx",
      worksheetName: "Nilai Persediaan",
      headers: ["SKU", "Stok"],
      widths: [14, 12],
      firstPage: { rows: [["000001", 3]], nextCursor: null },
      loadPage: async () => ({ rows: [], nextCursor: null }),
    });

    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Nilai Persediaan"]);
    expect(workbook.Sheets["Nilai Persediaan"].B2).toMatchObject({ t: "n", v: 3 });
  });

  it("does not load another page after the response is cancelled", async () => {
    const loadPage = vi.fn(async () => ({
      rows: [["000002", "Should not be loaded", 20_000, 3]],
      nextCursor: null,
    }));
    const response = productXlsxStreamResponse({
      filename: "produk-test.xlsx",
      headers: ["Kode Barang", "Nama Barang", "Harga Jual", "Stok"],
      widths: [14, 36, 14, 12],
      firstPage: {
        rows: [["000001", "Product one", 12_500, 2]],
        nextCursor: "next",
      },
      loadPage,
    });

    await response.body?.cancel();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(loadPage).not.toHaveBeenCalled();
  });
});
