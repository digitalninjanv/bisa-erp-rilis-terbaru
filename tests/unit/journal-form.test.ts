import { describe, expect, it } from "vitest";
import {
  appendJournalLines,
  autoBalanceAdjacent,
  computeBalancing,
  initialJournalLines,
  journalSubmitBlockReason,
  summarizeJournalLines,
  type JournalLineDraft,
} from "@/lib/journal-form";

/**
 * Logika murni formulir jurnal manual — ringkasan keseimbangan,
 * alasan tombol Posting nonaktif, baris awal, tambah dua baris, dan
 * isi otomatis baris penyeimbang. Harus Decimal persis (tanpa
 * aritmetika number).
 */

const line = (patch: Partial<JournalLineDraft> = {}): JournalLineDraft => ({
  accountId: "",
  debit: "",
  credit: "",
  ...patch,
});

describe("baris awal & tambah baris", () => {
  it("formulir mulai dengan tiga baris kosong", () => {
    const lines = initialJournalLines();
    expect(lines).toHaveLength(3);
    expect(lines.every((row) => row.accountId === "" && row.debit === "" && row.credit === "")).toBe(true);
  });

  it("tambah baris menambah dua baris sekaligus", () => {
    const lines = appendJournalLines(initialJournalLines());
    expect(lines).toHaveLength(5);
    expect(lines.slice(3).every((row) => row.accountId === "" && row.debit === "" && row.credit === "")).toBe(true);
  });
});

describe("summarizeJournalLines", () => {
  it("counts only lines with an account and a positive amount as filled", () => {
    const summary = summarizeJournalLines([
      line({ accountId: "a1", debit: "100000" }),
      line({ debit: "50000" }), // no account → not filled, but still totals
      line({ accountId: "a2" }),
      line(),
    ]);
    expect(summary.filledCount).toBe(1);
    expect(summary.totalDebit.toString()).toBe("150000");
    expect(summary.balanced).toBe(false);
  });

  it("is balanced only when debit equals credit and debit is positive", () => {
    const summary = summarizeJournalLines([
      line({ accountId: "a1", debit: "250000.50" }),
      line({ accountId: "a2", credit: "250000.50" }),
    ]);
    expect(summary.balanced).toBe(true);
    expect(summary.difference.toString()).toBe("0");
    expect(summarizeJournalLines([line(), line()]).balanced).toBe(false);
  });

  it("keeps the signed difference (debit − credit) in Decimal precision", () => {
    const summary = summarizeJournalLines([
      line({ accountId: "a1", debit: "0.1" }),
      line({ accountId: "a2", debit: "0.2" }),
      line({ accountId: "a3", credit: "0.3" }),
    ]);
    expect(summary.difference.toString()).toBe("0");
    expect(summary.balanced).toBe(true);
  });

  it("treats unparseable amounts as zero instead of throwing", () => {
    const summary = summarizeJournalLines([line({ accountId: "a1", debit: "abc" })]);
    expect(summary.totalDebit.toString()).toBe("0");
    expect(summary.filledCount).toBe(0);
  });
});

describe("computeBalancing", () => {
  it("returns null when already balanced or empty", () => {
    expect(computeBalancing([line({ debit: "10" }), line({ credit: "10" })])).toBeNull();
    expect(computeBalancing([line(), line()])).toBeNull();
  });

  it("proposes a credit for the short side when debit is bigger", () => {
    const fix = computeBalancing([
      line({ accountId: "a1", debit: "75000" }),
      line({ accountId: "a2", credit: "25000" }),
    ]);
    expect(fix).toEqual({ side: "credit", amount: "50000.0000" });
  });

  it("proposes a debit when credit is bigger", () => {
    const fix = computeBalancing([line({ accountId: "a1", credit: "125000.25" })]);
    expect(fix).toEqual({ side: "debit", amount: "125000.2500" });
  });
});

describe("journalSubmitBlockReason", () => {
  const ready = {
    filledCount: 2,
    balanced: true,
    hasInvalidAmounts: false,
    difference: "0",
  };

  it("returns null when the journal can be posted without a description", () => {
    expect(journalSubmitBlockReason(ready)).toBeNull();
  });

  it("prioritises unparseable amounts, then line count, then balance", () => {
    expect(journalSubmitBlockReason({ ...ready, hasInvalidAmounts: true })).toMatch(/tidak terbaca/);
    expect(journalSubmitBlockReason({ ...ready, filledCount: 1, balanced: false })).toMatch(/dua baris/);
    expect(
      journalSubmitBlockReason({ ...ready, balanced: false, difference: "5000" }),
    ).toMatch(/Selisih/);
  });
});

describe("autoBalanceAdjacent", () => {
  it("mengisi kredit baris berikutnya yang akunnya sudah dipilih", () => {
    const lines = [
      line({ accountId: "a1", debit: "100000" }),
      line({ accountId: "a2" }),
      line(),
    ];
    const next = autoBalanceAdjacent(lines, 0, "debit");
    expect(next[1].credit).toBe("100000.0000");
    expect(next[2].credit).toBe("");
  });

  it("mengisi debit baris sebelumnya saat kredit diisi", () => {
    const lines = [
      line({ accountId: "a1" }),
      line({ accountId: "a2", credit: "75000" }),
    ];
    const next = autoBalanceAdjacent(lines, 1, "credit");
    expect(next[0].debit).toBe("75000.0000");
  });

  it("tidak menimpa baris yang sudah bernominal atau belum punya akun", () => {
    const filled = [
      line({ accountId: "a1", debit: "100000" }),
      line({ accountId: "a2", credit: "50000" }),
    ];
    expect(autoBalanceAdjacent(filled, 0, "debit")).toBe(filled);
    const noAccount = [line({ accountId: "a1", debit: "100000" }), line()];
    expect(autoBalanceAdjacent(noAccount, 0, "debit")).toBe(noAccount);
  });

  it("tidak melakukan apa pun bila nominal baris kosong", () => {
    const lines = [line({ accountId: "a1" }), line({ accountId: "a2" })];
    expect(autoBalanceAdjacent(lines, 0, "debit")).toBe(lines);
  });
});
