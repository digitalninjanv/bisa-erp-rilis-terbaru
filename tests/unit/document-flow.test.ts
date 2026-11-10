import { describe, expect, it } from "vitest";
import { documentFlowSteps, journalFlowSteps } from "@/lib/document-flow";
import { journalBalanceState, summarizeJournalLines } from "@/lib/journal-form";

// A-25 U2: penanda tahap DocumentPage (status bar Odoo) dihitung dari
// status NYATA dokumen — tahap lalu done, tahap kini current, sisanya
// todo; terminal negatif menutup alur sebagai void.
describe("document-flow: alur generik", () => {
  const stages = [
    { key: "draft", label: "Draf", statuses: ["draft"] },
    { key: "ordered", label: "Dipesan", statuses: ["ordered", "partial"] },
    { key: "done", label: "Selesai", statuses: ["received", "settled"] },
  ];
  it("status di tahap tengah: sebelumnya done, sesudahnya todo", () => {
    expect(documentFlowSteps("partial", stages).map((s) => s.state)).toEqual([
      "done",
      "current",
      "todo",
    ]);
  });
  it("status tahap pertama & terakhir", () => {
    expect(documentFlowSteps("draft", stages).map((s) => s.state)).toEqual([
      "current",
      "todo",
      "todo",
    ]);
    expect(documentFlowSteps("settled", stages).map((s) => s.state)).toEqual([
      "done",
      "done",
      "current",
    ]);
  });
  it("status di luar daftar menutup dengan tahap void berlabel penerusan", () => {
    const steps = documentFlowSteps("void", stages, "Batal");
    expect(steps.at(-1)).toEqual({ key: "terminal-void", label: "Batal", state: "void" });
    expect(steps.slice(0, -1).every((s) => s.state === "todo")).toBe(true);
  });
});

describe("document-flow: alur jurnal", () => {
  it("posted: Draf selesai, Terposting aktif", () => {
    expect(journalFlowSteps("posted")).toEqual([
      { key: "draft", label: "Draf", state: "done" },
      { key: "posted", label: "Terposting", state: "current" },
    ]);
  });
  it("posted yang sudah dibalik mendapat tahap penutup 'Sudah dibalik'", () => {
    const steps = journalFlowSteps("posted", true);
    expect(steps.at(-1)).toEqual({ key: "reversed", label: "Sudah dibalik", state: "void" });
  });
  it("void menutup sebagai Batal, bukan Terposting", () => {
    expect(journalFlowSteps("void")).toEqual([
      { key: "draft", label: "Draf", state: "done" },
      { key: "void", label: "Batal", state: "void" },
    ]);
  });
});

// A-25 U2 (§4.1.7): form jurnal kosong bukan alarm "belum seimbang".
describe("journal-form: journalBalanceState", () => {
  it("tanpa baris terisi = empty (netral), walau balanced=false", () => {
    const summary = summarizeJournalLines([
      { accountId: "", debit: "", credit: "" },
      { accountId: "", debit: "", credit: "" },
    ]);
    expect(summary.balanced).toBe(false);
    expect(journalBalanceState(summary)).toBe("empty");
  });
  it("baris terisi & selisih nol = balanced; selisih ≠ 0 = unbalanced", () => {
    const ok = summarizeJournalLines([
      { accountId: "a", debit: "100", credit: "" },
      { accountId: "b", debit: "", credit: "100" },
    ]);
    expect(journalBalanceState(ok)).toBe("balanced");
    const bad = summarizeJournalLines([
      { accountId: "a", debit: "100", credit: "" },
      { accountId: "b", debit: "", credit: "90" },
    ]);
    expect(journalBalanceState(bad)).toBe("unbalanced");
  });
  it("satu sisi terisi saja tetap unbalanced (bukan empty)", () => {
    const half = summarizeJournalLines([
      { accountId: "a", debit: "100", credit: "" },
      { accountId: "", debit: "", credit: "" },
    ]);
    expect(journalBalanceState(half)).toBe("unbalanced");
  });
});
