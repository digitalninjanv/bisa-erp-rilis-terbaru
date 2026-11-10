import { describe, expect, it } from "vitest";
import {
  defaultPsak118Tags,
  MAPPING_KEY_CONTRA_OF,
  MAPPING_KEY_NATURE_REFINEMENTS,
} from "@/lib/akuntansi/psak118";

/**
 * A-27 B5 — bawaan deterministik tagging PSAK 118 (defaultPsak118Tags):
 * satu definisi yang dipakai aksi simpan akun, seed demo, dan penanam
 * akun sistem. Aturan konservatif: kategori hanya untuk laba rugi dan
 * selalu diawali operating; pemecahan investing/financing/income_tax
 * TIDAK ditebak dari nama/kode (keputusan akuntan lewat formulir).
 */
describe("defaultPsak118Tags", () => {
  it("akun neraca tidak membawa tag apa pun", () => {
    for (const [type, section] of [
      ["asset", "current_asset"],
      ["asset", "non_current_asset"],
      ["liability", "current_liability"],
      ["liability", "non_current_liability"],
      ["equity", "equity"],
    ] as const) {
      expect(defaultPsak118Tags(type, section)).toEqual({
        psak118Category: null,
        expenseNature: null,
        expenseFunction: null,
      });
    }
  });

  it("pendapatan: kategori operating, tanpa sifat/fungsi beban", () => {
    expect(defaultPsak118Tags("revenue", "revenue")).toEqual({
      psak118Category: "operating",
      expenseNature: null,
      expenseFunction: null,
    });
    expect(defaultPsak118Tags("revenue", "other_income").psak118Category).toBe("operating");
    // section kosong jatuh ke bawaan tipe.
    expect(defaultPsak118Tags("revenue", null).psak118Category).toBe("operating");
  });

  it("cogs: operating + persediaan dibebankan + fungsi cogs", () => {
    expect(defaultPsak118Tags("cogs", "cogs")).toEqual({
      psak118Category: "operating",
      expenseNature: "inventory_expensed",
      expenseFunction: "cogs",
    });
    expect(defaultPsak118Tags("cogs", null).expenseNature).toBe("inventory_expensed");
  });

  it("beban: operating + sifat lain-lain + fungsi admin (dapat disesuaikan)", () => {
    expect(defaultPsak118Tags("expense", "operating_expense")).toEqual({
      psak118Category: "operating",
      expenseNature: "other",
      expenseFunction: "admin",
    });
    expect(defaultPsak118Tags("expense", "other_expense").psak118Category).toBe("operating");
    expect(defaultPsak118Tags("expense", null).expenseFunction).toBe("admin");
  });

  it("baris lama yang tidak koheren (beban di kelompok aset) tidak tertag", () => {
    expect(defaultPsak118Tags("expense", "current_asset")).toEqual({
      psak118Category: null,
      expenseNature: null,
      expenseFunction: null,
    });
  });

  it("tipe tak dikenal tidak tertag", () => {
    expect(defaultPsak118Tags("mystery", null).psak118Category).toBeNull();
  });

  it("peta penyempurnaan sifat & pasangan kontra dari kunci pemetaan utuh", () => {
    expect(MAPPING_KEY_NATURE_REFINEMENTS).toEqual({
      inventory_shrink: "inventory_writedown",
      damaged: "inventory_writedown",
      salary_expense: "employee_benefits",
      payroll_employer_expense: "employee_benefits",
      bank_fee: "bank_charges",
      receivable_writeoff: "impairment",
    });
    expect(MAPPING_KEY_CONTRA_OF).toEqual({
      sales_discount: "revenue",
      sales_return: "revenue",
      accumulated_depreciation: "fixed_asset",
    });
  });
});
