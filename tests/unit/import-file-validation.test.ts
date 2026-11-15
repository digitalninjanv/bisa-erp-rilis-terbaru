import { describe, expect, it } from "vitest";
import {
  ImportFileTooLargeError,
  readFormDataWithLimit,
  validateImportFile,
} from "@/lib/import-file-validation";
import { buildXlsx } from "@/lib/xlsx";

function zipEnd(entries: number, cdSize = 0, cdOffset = 0): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return eocd;
}

describe("SEC-008 — validasi berkas impor", () => {
  it("CSV teks valid diterima; CSV berisi byte NUL ditolak", () => {
    expect(validateImportFile(Buffer.from("nama,qty\nAqua,2\n"), "produk.csv").kind).toBe("csv");
    expect(() =>
      validateImportFile(Buffer.from([0x61, 0x00, 0x62]), "produk.csv"),
    ).toThrow(/tidak dikenali|tidak cocok/i);
  });

  it("XLSX asli diterima; file teks berekstensi xlsx ditolak", async () => {
    const xlsx = await buildXlsx([{ name: "Data", headers: ["nama", "qty"], rows: [["Aqua", 2]] }]);
    expect(validateImportFile(xlsx, "produk.xlsx").kind).toBe("xlsx");
    expect(() => validateImportFile(Buffer.from("bukan zip"), "produk.xlsx")).toThrow(/tidak cocok/i);
  });

  it("ZIP dengan entri berlebihan ditolak sebelum dekompresi", () => {
    const buffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(26),
      zipEnd(5_000),
    ]);
    expect(() => validateImportFile(buffer, "bomb.xlsx")).toThrow(/terlalu banyak entri/i);
  });

  it("ZIP dengan rasio/ukuran dekompresi ekstrem ditolak", () => {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(1_000, 20);
    cd.writeUInt32LE(1_000_000_000, 24);
    const local = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const buffer = Buffer.concat([local, cd, zipEnd(1, cd.length, local.length)]);
    expect(() => validateImportFile(buffer, "bomb.xlsx")).toThrow(/terlalu besar|zip bomb/i);
  });

  it("streaming body dibatasi sebelum formData membaca seluruh isi", async () => {
    const form = new FormData();
    form.set("file", new File(["x".repeat(4096)], "besar.csv", { type: "text/csv" }));
    const request = new Request("http://localhost/api/import/parse", {
      method: "POST",
      body: form,
    });
    await expect(readFormDataWithLimit(request, 256)).rejects.toBeInstanceOf(
      ImportFileTooLargeError,
    );

    const okForm = new FormData();
    okForm.set("file", new File(["nama,qty\nAqua,2\n"], "kecil.csv", { type: "text/csv" }));
    const okRequest = new Request("http://localhost/api/import/parse", {
      method: "POST",
      body: okForm,
    });
    const parsed = await readFormDataWithLimit(okRequest);
    expect(parsed.get("file")).toBeInstanceOf(File);
  });
});
