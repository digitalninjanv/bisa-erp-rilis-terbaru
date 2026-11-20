import { describe, expect, it, vi } from "vitest";
import { paymentRequestFingerprint, pruneExpiredIdempotencyKeys } from "@/server/idempotency";
import type { Tx } from "@/db";

describe("idempotency helpers", () => {
  it("paymentRequestFingerprint generates stable canonical hash regardless of key order", () => {
    const reqA = { b: 2, a: 1, c: { y: "bar", x: "foo" } };
    const reqB = { a: 1, c: { x: "foo", y: "bar" }, b: 2 };
    const hashA = paymentRequestFingerprint(reqA);
    const hashB = paymentRequestFingerprint(reqB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("paymentRequestFingerprint generates distinct hash for different payloads", () => {
    const reqA = { amount: 10000, accountId: "acc-1" };
    const reqB = { amount: 10000, accountId: "acc-2" };
    expect(paymentRequestFingerprint(reqA)).not.toBe(paymentRequestFingerprint(reqB));
  });

  it("pruneExpiredIdempotencyKeys executes scoped delete query on old records", async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: "uuid-1" }, { id: "uuid-2" }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const deleteMock = vi.fn().mockReturnValue({ where: whereMock });

    const mockTx = {
      delete: deleteMock,
    } as unknown as Tx;

    const count = await pruneExpiredIdempotencyKeys(mockTx, {
      companyId: "org-test-1",
      retentionDays: 14,
    });

    expect(count).toBe(2);
    expect(deleteMock).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalled();
  });
});
