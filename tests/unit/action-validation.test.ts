import { describe, expect, it } from "vitest";
import { isoDate, moneyString, moneyStringOptional } from "@/lib/action-validation";
import { uniqueViolationMessage } from "@/lib/errors";

// AK-P3-01: helper skema bersama harus menolak tanggal kalender yang tidak
// nyata dan nominal yang tidak terbaca dengan pesan yang menyebut bidangnya,
// dan pelanggaran unik Postgres (23505) harus diterjemahkan menjadi pesan
// duplikat berbahasa Indonesia — bukan "Terjadi kesalahan pada server".

describe("isoDate (AK-P3-01)", () => {
  it("menerima tanggal ISO yang nyata, termasuk kabisat", () => {
    expect(isoDate().safeParse("2026-11-03").success).toBe(true);
    expect(isoDate().safeParse("2024-02-29").success).toBe(true);
  });

  it("menolak tanggal kalender yang tidak ada", () => {
    for (const value of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"]) {
      const result = isoDate().safeParse(value);
      expect(result.success, value).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/tanggal/i);
      }
    }
  });

  it("menolak format selain YYYY-MM-DD", () => {
    for (const value of ["03/11/2026", "2026-1-3", "20261103", "abc", ""]) {
      expect(isoDate().safeParse(value).success, value).toBe(false);
    }
  });

  it("pesan menyebut label bidang yang diberikan", () => {
    const result = isoDate("Tanggal pembayaran").safeParse("2026-02-30");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Tanggal pembayaran");
    }
  });
});

describe("moneyString (AK-P3-01)", () => {
  it("menerima string/angka yang terbaca Decimal dan mengembalikan string kanonis", () => {
    expect(moneyString("Nominal").parse("1500000")).toBe("1500000.0000");
    expect(moneyString("Nominal").parse("1500000.5")).toBe("1500000.5000");
    expect(moneyString("Nominal").parse(2500)).toBe("2500.0000");
    // Varian dasar hanya memeriksa keterbacaan: nol & negatif lolos di sini,
    // aturan rentang adalah urusan pemanggil (atau amountField).
    expect(moneyString("Nominal").parse("0")).toBe("0.0000");
    expect(moneyString("Nominal").parse("-100")).toBe("-100.0000");
  });

  it("menolak nominal yang tidak terbaca dengan pesan menyebut bidangnya", () => {
    for (const value of ["abc", "", "1.500.000", "12rb", "Infinity"]) {
      const result = moneyString("Nominal beban").safeParse(value);
      expect(result.success, String(value)).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Nominal beban");
      }
    }
  });
});

describe("moneyStringOptional (AK-P3-01)", () => {
  it("string kosong/undefined berarti tidak diisi", () => {
    expect(moneyStringOptional("Debit").parse("")).toBeUndefined();
    expect(moneyStringOptional("Debit").parse(undefined)).toBeUndefined();
  });

  it("nilai terisi divalidasi seperti moneyString", () => {
    expect(moneyStringOptional("Debit").parse("100")).toBe("100.0000");
    expect(moneyStringOptional("Debit").safeParse("abc").success).toBe(false);
  });
});

describe("uniqueViolationMessage (AK-P3-01)", () => {
  it("memetakan constraint yang dikenal ke pesan entitasnya", () => {
    expect(uniqueViolationMessage({ code: "23505", constraint: "accounts_company_code_uq" })).toMatch(
      /Kode akun.*sudah digunakan/,
    );
    expect(uniqueViolationMessage({ code: "23505", constraint: "employees_company_code_uq" })).toMatch(
      /Kode karyawan.*sudah digunakan/,
    );
    expect(uniqueViolationMessage({ code: "23505", constraint: "payroll_runs_company_period_uq" })).toMatch(
      /sudah pernah diproses/,
    );
  });

  it("melihat menembus rantai cause (error terbungkus drizzle)", () => {
    const wrapped = new Error("Failed query", {
      cause: { code: "23505", constraint: "products_company_sku_uq" },
    });
    expect(uniqueViolationMessage(wrapped)).toMatch(/SKU.*sudah digunakan/);
  });

  it("mengekstrak nama constraint dari pesan pg bila properti tidak ada", () => {
    const pgLike = new Error(
      'duplicate key value violates unique constraint "suppliers_company_code_uq"',
    ) as Error & { code?: string };
    pgLike.code = "23505";
    expect(uniqueViolationMessage(pgLike)).toMatch(/Kode pemasok.*sudah digunakan/);
  });

  it("constraint tak dikenal jatuh ke pesan duplikat umum yang jujur", () => {
    expect(uniqueViolationMessage({ code: "23505", constraint: "sesuatu_yang_lain_uq" })).toMatch(
      /sudah digunakan/,
    );
    expect(uniqueViolationMessage({ code: "23505" })).toMatch(/sudah digunakan/);
  });

  it("error non-23505 menghasilkan null", () => {
    expect(uniqueViolationMessage(new Error("boom"))).toBeNull();
    expect(uniqueViolationMessage({ code: "23503", constraint: "fk" })).toBeNull();
    expect(uniqueViolationMessage(null)).toBeNull();
    expect(uniqueViolationMessage("23505")).toBeNull();
  });
});
