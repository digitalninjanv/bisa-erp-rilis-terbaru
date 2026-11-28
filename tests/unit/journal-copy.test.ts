import { describe, expect, it } from "vitest";
import { copyJournalLines } from "@/lib/akuntansi/journal-form";

describe("salin jurnal", () => {
  it("mempertahankan akun, sisi nominal, memo baris, dan tag pihak", () => {
    const lines = copyJournalLines([
      {
        accountId: "acc-1",
        debit: "1000.0000",
        credit: "0.0000",
        description: "Kas masuk",
        partyType: "customer",
        partyId: "cust-1",
      },
      {
        accountId: "acc-2",
        debit: "0.0000",
        credit: "1000.0000",
        description: null,
        partyType: null,
        partyId: null,
      },
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      accountId: "acc-1",
      debit: "1000.0000",
      credit: "",
      description: "Kas masuk",
      partyType: "customer",
      partyId: "cust-1",
    });
    expect(lines[1]).toMatchObject({
      accountId: "acc-2",
      debit: "",
      credit: "1000.0000",
      description: "",
    });
    expect(lines[2]).toMatchObject({ accountId: "", debit: "", credit: "" });
  });

  it("membatasi salinan ke 50 baris agar sama dengan batas form", () => {
    const source = Array.from({ length: 60 }, (_, index) => ({
      accountId: `acc-${index}`,
      debit: "1",
      credit: "0",
    }));
    expect(copyJournalLines(source)).toHaveLength(50);
  });
});
