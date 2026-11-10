import { describe, expect, it } from "vitest";
import {
  isValidNumberingPrefix,
  normalizeNumberingPrefix,
  sanitizeDocumentNumbering,
} from "@/lib/document-numbering";

// AK-P3-07: stored overrides are untrusted input for the domain layer —
// sanitizeDocumentNumbering must keep only well-formed entries so a
// hand-edited jsonb value can never corrupt issued document numbers.
describe("document numbering helpers (AK-P3-07)", () => {
  it("prefix dinormalisasi ke huruf kapital dan divalidasi", () => {
    expect(normalizeNumberingPrefix(" fj ")).toBe("FJ");
    expect(normalizeNumberingPrefix("")).toBeNull();
    expect(normalizeNumberingPrefix("   ")).toBeNull();
    expect(isValidNumberingPrefix("FJ-01")).toBe(true);
    expect(isValidNumberingPrefix("A B")).toBe(false);
    expect(isValidNumberingPrefix("AB!")).toBe(false);
    expect(isValidNumberingPrefix("ABCDEFGHIJK")).toBe(false); // 11 chars > 10
    expect(isValidNumberingPrefix("")).toBe(false);
  });

  it("sanitize mempertahankan entri yang sah", () => {
    expect(
      sanitizeDocumentNumbering({
        SALE: { prefix: "fj", padding: 3 },
        JOURNAL: { padding: 8 },
        RECEIPT: { prefix: "GR" },
      }),
    ).toEqual({
      SALE: { prefix: "FJ", padding: 3 },
      JOURNAL: { padding: 8 },
      RECEIPT: { prefix: "GR" },
    });
  });

  it("sanitize membuang prefix kotor, padding di luar rentang, dan jenis tak dikenal", () => {
    expect(
      sanitizeDocumentNumbering({
        SALE: { prefix: "A B!", padding: 4 },
        JOURNAL: { prefix: "JE", padding: 2 },
        EXPENSE: { prefix: "EX", padding: 9 },
        TIPE_ASING: { prefix: "XX", padding: 4 },
        PAYROLL: { prefix: "", padding: 4.5 },
        PAYMENT: "bukan-objek",
      }),
    ).toEqual({
      SALE: { padding: 4 },
      JOURNAL: { prefix: "JE" },
      EXPENSE: { prefix: "EX" },
    });
  });

  it("sanitize menerima nilai non-objek sebagai kosong", () => {
    expect(sanitizeDocumentNumbering(null)).toEqual({});
    expect(sanitizeDocumentNumbering(undefined)).toEqual({});
    expect(sanitizeDocumentNumbering("INV")).toEqual({});
    expect(sanitizeDocumentNumbering(42)).toEqual({});
  });
});
