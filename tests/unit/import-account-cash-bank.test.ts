import { describe, expect, it } from "vitest";
import { mapAccountRow } from "@/lib/import/import-parse";

const mapping = { code: "code", name: "name", type: "type", section: "section" };

describe("impor COA mengisi kelas kas/bank", () => {
  it("Bank BCA menjadi kelas bank", () => {
    const result = mapAccountRow(
      { code: "110201", name: "Bank BCA", type: "asset", section: "current_asset" },
      mapping,
    );
    expect(result.value?.cashBankKind).toBe("bank");
  });

  it("Kas Kecil menjadi kelas cash", () => {
    const result = mapAccountRow(
      { code: "110101", name: "Kas Kecil", type: "asset", section: "current_asset" },
      mapping,
    );
    expect(result.value?.cashBankKind).toBe("cash");
  });

  it("akun non-aset atau aset tidak lancar tidak diberi kelas kas/bank", () => {
    expect(
      mapAccountRow(
        { code: "1201", name: "Bank Jangka Panjang", type: "liability" },
        mapping,
      ).value?.cashBankKind,
    ).toBeNull();
    expect(
      mapAccountRow(
        { code: "1501", name: "Bank Tanah", type: "asset", section: "non_current_asset" },
        mapping,
      ).value?.cashBankKind,
    ).toBeNull();
  });
});
