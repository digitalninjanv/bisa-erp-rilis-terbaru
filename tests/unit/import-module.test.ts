import { describe, expect, it } from "vitest";
import { importEntityModule } from "@/lib/import/import-module";

describe("import entity module gate", () => {
  it("maps accounting masters and opening balances to akuntansi", () => {
    for (const entity of [
      "accounts",
      "account_mappings",
      "fixed_assets",
      "opening_payables",
      "opening_receivables",
    ]) {
      expect(importEntityModule(entity)).toBe("akuntansi");
    }
  });

  it("maps employees to hr and inventory masters to gudang", () => {
    expect(importEntityModule("employees")).toBe("hr");
    for (const entity of ["products", "suppliers", "customers", "opening_stock", "branches"]) {
      expect(importEntityModule(entity)).toBe("gudang");
    }
  });

  it("defaults unknown entities to gudang (safe import surface)", () => {
    expect(importEntityModule("unknown")).toBe("gudang");
  });
});
