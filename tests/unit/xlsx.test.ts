import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildImportTemplate, buildXlsx } from "@/lib/xlsx";

describe("serializer XLSX master data", () => {
  it("menjaga kode berawalan nol sebagai teks dan angka sebagai number", async () => {
    const buffer = await buildXlsx([
      {
        name: "Data",
        headers: ["SKU", "Nama", "Harga"],
        rows: [["00123", "Produk Nol", 5000]],
      },
    ]);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets.Data;
    expect(sheet.A2.t).toBe("s");
    expect(sheet.A2.v).toBe("00123");
    expect(sheet.C2.t).toBe("n");
    expect(sheet.C2.v).toBe(5000);
  });

  it("tidak mengeksekusi teks yang dimulai dengan tanda sama dengan", async () => {
    const buffer = await buildXlsx([
      {
        name: "Data",
        headers: ["Nama"],
        rows: [["=1+1"]],
      },
    ]);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const cell = workbook.Sheets.Data.A2;
    expect(cell.t).toBe("s");
    expect(cell.v).toBe("=1+1");
    expect(cell.f).toBeUndefined();
  });

  it("membangun template impor dan sheet referensi melalui serializer async", async () => {
    const buffer = await buildImportTemplate({
      entityLabel: "Produk",
      headers: ["SKU"],
      exampleRows: [["00123"]],
      fields: [{ label: "SKU", required: true }],
      instructions: ["Jangan mengubah header."],
      references: [{ name: "Satuan", headers: ["Kode"], rows: [["PCS"]] }],
    });
    const workbook = XLSX.read(buffer, { type: "buffer" });

    expect(workbook.SheetNames).toEqual(["Data", "Petunjuk", "Satuan"]);
    expect(workbook.Sheets.Data.A2.v).toBe("00123");
    expect(workbook.Sheets.Satuan.A2.v).toBe("PCS");
  });
});
