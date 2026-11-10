import { describe, expect, it } from "vitest";
import {
  applyCustomFieldValues,
  sanitizeCustomFieldDefinitions,
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
  type CustomFieldDefinitions,
} from "@/lib/custom-fields";
import { AppError } from "@/lib/errors";

// T5-2 (D-16): kolom kustom produk/pihak. Definisi tersimpan sebagai
// jsonb di company_settings (tak tepercaya saat dibaca), nilai tersimpan
// di kolom attributes entitas. Validasi tulis ketat (melempar
// AppError VALIDATION yang menyebut label), sanitasi baca lunak.
const DEFS: CustomFieldDefinitions = {
  product: [
    { key: "merek", label: "Merek", type: "text" },
    { key: "berat_gram", label: "Berat (gram)", type: "number" },
    { key: "tgl_masuk", label: "Tanggal masuk", type: "date" },
    { key: "asal", label: "Asal", type: "select", options: ["Lokal", "Impor"] },
    { key: "kode_rak", label: "Kode rak", type: "text", required: true },
  ],
};

describe("sanitizeCustomFieldDefinitions (baca, lunak)", () => {
  it("nilai bukan objek menghasilkan definisi kosong", () => {
    expect(sanitizeCustomFieldDefinitions(null)).toEqual({});
    expect(sanitizeCustomFieldDefinitions("x")).toEqual({});
    expect(sanitizeCustomFieldDefinitions([1, 2])).toEqual({});
  });

  it("mempertahankan definisi yang sah dan menormalkan key menjadi slug", () => {
    const result = sanitizeCustomFieldDefinitions({
      product: [{ key: "Merek Utama", label: "Merek", type: "text" }],
    });
    expect(result.product).toEqual([{ key: "merek-utama", label: "Merek", type: "text" }]);
  });

  it("membuang entri rusak: tipe asing, tanpa label, select tanpa pilihan, key ganda (pertama menang)", () => {
    const result = sanitizeCustomFieldDefinitions({
      product: [
        { key: "a", label: "A", type: "warna" },
        { key: "b", type: "text" },
        { key: "c", label: "C", type: "select", options: [] },
        { key: "d", label: "D", type: "select", options: [" X ", "X", "Y"] },
        { key: "d", label: "D ganda", type: "text" },
        { key: "e", label: "E", type: "select", options: "bukan array" },
      ],
      entitas_asing: [{ key: "z", label: "Z", type: "text" }],
    });
    expect(result.product).toEqual([
      { key: "d", label: "D", type: "select", options: ["X", "Y"] },
    ]);
    expect("entitas_asing" in result).toBe(false);
  });

  it("membatasi maksimal 10 kolom per entitas", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      key: `f${i}`,
      label: `F${i}`,
      type: "text",
    }));
    expect(sanitizeCustomFieldDefinitions({ customer: many }).customer).toHaveLength(10);
  });
});

describe("validateCustomFieldDefinitions (tulis, ketat)", () => {
  it("definisi sah lolos dan ternormalisasi", () => {
    const result = validateCustomFieldDefinitions({
      supplier: [{ key: "NPWP", label: "NPWP", type: "text", required: true }],
    });
    expect(result.supplier).toEqual([
      { key: "npwp", label: "NPWP", type: "text", required: true },
    ]);
  });

  it("key ganda dalam satu entitas ditolak menyebut key-nya", () => {
    expect(() =>
      validateCustomFieldDefinitions({
        product: [
          { key: "merek", label: "Merek", type: "text" },
          { key: "MEREK", label: "Merek lain", type: "text" },
        ],
      }),
    ).toThrowError(/merek/);
  });

  it("label kosong, select tanpa pilihan, dan lebih dari 10 kolom ditolak", () => {
    expect(() =>
      validateCustomFieldDefinitions({ product: [{ key: "a", label: " ", type: "text" }] }),
    ).toThrowError(AppError);
    expect(() =>
      validateCustomFieldDefinitions({
        product: [{ key: "a", label: "A", type: "select", options: [] }],
      }),
    ).toThrowError(/pilihan/);
    const many = Array.from({ length: 11 }, (_, i) => ({
      key: `f${i}`,
      label: `F${i}`,
      type: "text",
    }));
    expect(() => validateCustomFieldDefinitions({ product: many })).toThrowError(/10/);
  });

  it("key yang tidak bisa menjadi slug ditolak", () => {
    expect(() =>
      validateCustomFieldDefinitions({ product: [{ key: "!!!", label: "Aneh", type: "text" }] }),
    ).toThrowError(AppError);
  });
});

describe("validateCustomFieldValues", () => {
  it("nilai sah dinormalisasi: angka menjadi string Decimal kanonis", () => {
    const patch = validateCustomFieldValues(DEFS, "product", {
      merek: "  Indomilk ",
      berat_gram: "250.5",
      tgl_masuk: "2026-11-04",
      asal: "Lokal",
      kode_rak: "A1",
    });
    expect(patch).toEqual({
      merek: "Indomilk",
      berat_gram: "250.5000",
      tgl_masuk: "2026-11-04",
      asal: "Lokal",
      kode_rak: "A1",
    });
  });

  it("kolom opsional yang dikosongkan menghasilkan patch null (kunci dihapus)", () => {
    const patch = validateCustomFieldValues(DEFS, "product", { kode_rak: "B2", merek: "" });
    expect(patch.merek).toBeNull();
    expect(patch.asal).toBeNull();
  });

  it("kolom wajib yang kosong ditolak menyebut labelnya", () => {
    expect(() => validateCustomFieldValues(DEFS, "product", {})).toThrowError(/Kode rak/);
    expect(() => validateCustomFieldValues(DEFS, "product", {})).toThrowError(AppError);
  });

  it("angka tak terbaca, tanggal tak nyata, dan pilihan di luar daftar ditolak menyebut label", () => {
    expect(() =>
      validateCustomFieldValues(DEFS, "product", { kode_rak: "A1", berat_gram: "abc" }),
    ).toThrowError(/Berat \(gram\)/);
    expect(() =>
      validateCustomFieldValues(DEFS, "product", { kode_rak: "A1", tgl_masuk: "2026-02-30" }),
    ).toThrowError(/Tanggal masuk/);
    expect(() =>
      validateCustomFieldValues(DEFS, "product", { kode_rak: "A1", asal: "Antah" }),
    ).toThrowError(/Asal/);
  });

  it("kunci tak dikenal pada nilai masukan diabaikan dari patch", () => {
    const patch = validateCustomFieldValues(DEFS, "product", {
      kode_rak: "A1",
      hantu: "boo",
    });
    expect("hantu" in patch).toBe(false);
  });

  it("entitas tanpa definisi menghasilkan patch kosong", () => {
    expect(validateCustomFieldValues(DEFS, "supplier", { apa: "saja" })).toEqual({});
    expect(validateCustomFieldValues(null, "product", { a: "b" })).toEqual({});
  });
});

describe("applyCustomFieldValues", () => {
  it("menimpa kunci pada patch, menghapus kunci bernilai null, mempertahankan kunci yatim", () => {
    const existing = { merek: "Lama", yatim: "tetap", asal: "Impor" };
    const merged = applyCustomFieldValues(existing, { merek: "Baru", asal: null });
    expect(merged).toEqual({ merek: "Baru", yatim: "tetap" });
  });

  it("hasil kosong dikembalikan sebagai null (kolom jsonb bersih)", () => {
    expect(applyCustomFieldValues({ a: "1" }, { a: null })).toBeNull();
    expect(applyCustomFieldValues(null, {})).toBeNull();
    expect(applyCustomFieldValues(undefined, { a: "x" })).toEqual({ a: "x" });
  });
});
