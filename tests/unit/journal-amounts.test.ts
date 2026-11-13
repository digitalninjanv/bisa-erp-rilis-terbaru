import { describe, expect, it } from "vitest";
import { canonicalJournalAmounts } from "@/lib/akuntansi/journal-amounts";
import { d, sum, toDb } from "@/lib/money";

describe("canonical journal amounts (F06/F07)", () => {
  it("balances fractional legs after storage rounding", () => {
    const result = canonicalJournalAmounts([{ debit: "0.00006" }, { debit: "0.00006" }, { credit: "0.00012" }]);
    expect(sum(result.map((l) => l.debitValue)).eq(sum(result.map((l) => l.creditValue)))).toBe(true);
    expect(result.every((l) => d(toDb(l.debitValue)).eq(l.debitValue))).toBe(true);
  });
  it("retains the same canonical amounts for detail and account aggregation", () => {
    const result = canonicalJournalAmounts([{ account: "a", debit: "0.00006" }, { account: "a", debit: "0.00006" }, { account: "b", credit: "0.00006" }, { account: "b", credit: "0.00006" }]);
    expect(sum(result.filter((l) => l.account === "a").map((l) => l.debitValue)).toFixed(4)).toBe("0.0001");
    expect(sum(result.filter((l) => l.account === "b").map((l) => l.creditValue)).toFixed(4)).toBe("0.0001");
  });
  it("does not create negative legs for many tiny rounded amounts", () => {
    const lines = Array.from({ length: 100 }, () => ({ debit: "0.00006" }));
    const result = canonicalJournalAmounts([...lines, { credit: "0.006" }]);
    expect(result.every((l) => l.debitValue.gte(0) && l.creditValue.gte(0))).toBe(true);
    expect(sum(result.map((l) => l.debitValue)).toString()).toBe("0.006");
  });
  it.each([
    [{ debit: "NaN" }, { credit: "NaN" }],
    [{ debit: "Infinity" }, { credit: "Infinity" }],
    [{ debit: -1 }, { credit: -1 }],
    [{ debit: 1, credit: 1 }],
    [{ debit: 1 }, { credit: 2 }],
  ])("rejects invalid or unbalanced journal %j", (...lines) => {
    expect(() => canonicalJournalAmounts<{ debit?: string | number; credit?: string | number }>(lines)).toThrow();
  });
});
