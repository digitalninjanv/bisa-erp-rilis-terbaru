import { describe, expect, it } from "vitest";
import {
  customFieldImportField,
  customFieldImportHeader,
  customFieldImportMappingKey,
  importCustomFieldValues,
} from "@/lib/import/import-custom-fields";

describe("impor kolom kustom supplier/pelanggan", () => {
  it("membuat header dan kunci mapping yang stabil serta terpisah dari field standar", () => {
    const field = { key: "npwp", label: "NPWP", type: "text" as const, required: true };
    const importField = customFieldImportField(field);

    expect(customFieldImportHeader(field)).toBe("Kolom kustom — NPWP");
    expect(importField.key).toBe("customField:npwp");
    expect(importField.key).not.toBe("taxId");
    expect(importField.aliases).toContain("kolom kustom npwp");
    expect(importField.label).toContain("wajib pada data");
  });

  it("mencatat kolom required yang kosong tanpa menolak baris", () => {
    const result = importCustomFieldValues({
      entity: "supplier",
      definitions: [{ key: "npwp", label: "NPWP", type: "text", required: true }],
      row: { "Nama pemasok": "PT Contoh" },
      mapping: {},
    });

    expect(result).toEqual({ attributes: null, missingRequiredLabels: ["NPWP"], error: null });
  });

  it("memvalidasi dan menormalisasi nilai kustom yang dipetakan", () => {
    const result = importCustomFieldValues({
      entity: "customer",
      definitions: [
        { key: "segmen", label: "Segmen", type: "select", options: ["Toko", "Grosir"], required: true },
        { key: "catatan", label: "Catatan", type: "text" },
      ],
      row: { Segmen: "Grosir", Catatan: "  Prioritas  " },
      mapping: { "customField:segmen": "Segmen", "customField:catatan": "Catatan" },
    });

    expect(result.error).toBeNull();
    expect(result.missingRequiredLabels).toEqual([]);
    expect(result.attributes).toEqual({ segmen: "Grosir", catatan: "Prioritas" });
  });

  it("mengembalikan error validasi untuk nilai select di luar pilihan", () => {
    const result = importCustomFieldValues({
      entity: "customer",
      definitions: [{ key: "segmen", label: "Segmen", type: "select", options: ["Toko"], required: true }],
      row: { Segmen: "Grosir" },
      mapping: { [customFieldImportMappingKey("segmen")]: "Segmen" },
    });

    expect(result.error).toContain("Segmen");
    expect(result.attributes).toBeNull();
  });
});
