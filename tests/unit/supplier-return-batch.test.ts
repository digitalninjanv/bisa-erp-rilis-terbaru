import { describe, expect, it } from "vitest";
import { matchesReceiptBatchIdentity } from "@/lib/supplier-return-batch";

describe("matchesReceiptBatchIdentity", () => {
  it("requires the same batch number and expiry for a receipt-linked return", () => {
    const source = { batchNumber: "LOT-2026-01", expiryDate: "2027-01-31" };

    expect(matchesReceiptBatchIdentity(source, source)).toBe(true);
    expect(matchesReceiptBatchIdentity(source, { ...source, batchNumber: "LOT-2026-02" })).toBe(false);
    expect(matchesReceiptBatchIdentity(source, { ...source, expiryDate: "2027-02-28" })).toBe(false);
  });

  it("allows an explicit current batch when legacy source data has no lot identity", () => {
    expect(
      matchesReceiptBatchIdentity(
        { batchNumber: null, expiryDate: null },
        { batchNumber: "CURRENT-LOT", expiryDate: "2027-06-30" },
      ),
    ).toBe(true);
  });
});
