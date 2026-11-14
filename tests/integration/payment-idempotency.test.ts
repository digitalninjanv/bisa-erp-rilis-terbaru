import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db";
import { withCompany } from "@/db/tenant";
import { idempotencyKeys } from "@/db/schema";
import { runIdempotentPayment } from "@/server/idempotency";

const companyId = "01900000-0000-7000-8000-00000000fa01";
const keys: string[] = [];

function newKey() {
  const key = randomUUID();
  keys.push(key);
  return key;
}

async function withPaymentKey<T>(key: string, run: (tx: Tx) => Promise<T>) {
  return withCompany(companyId, run);
}

afterAll(async () => {
  if (keys.length === 0) return;
  await withCompany(companyId, (tx) =>
    tx
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.companyId, companyId),
          eq(idempotencyKeys.scope, "accounting.payment"),
          eq(idempotencyKeys.key, keys[0]),
        ),
      ),
  );
  for (const key of keys.slice(1)) {
    await withCompany(companyId, (tx) =>
      tx
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.companyId, companyId),
            eq(idempotencyKeys.scope, "accounting.payment"),
            eq(idempotencyKeys.key, key),
          ),
        ),
    );
  }
});

describe("accounting payment idempotency", () => {
  it("returns the first result for identical retries and rejects a changed payload", async () => {
    const key = newKey();
    const request = { kind: "payable", receiptId: "receipt-a", amount: "125000", accountId: "cash-a" };
    let operations = 0;
    const first = await withPaymentKey(key, (tx) =>
      runIdempotentPayment(tx, { companyId, key, request }, async () => {
        operations += 1;
        return { paymentId: "payment-a", number: "PAY-TEST-001" };
      }),
    );
    const replay = await withPaymentKey(key, (tx) =>
      runIdempotentPayment(tx, { companyId, key, request: { accountId: "cash-a", amount: "125000", receiptId: "receipt-a", kind: "payable" } }, async () => {
        operations += 1;
        return { paymentId: "unexpected", number: "PAY-TEST-002" };
      }),
    );

    expect(replay).toEqual(first);
    expect(operations).toBe(1);
    await expect(
      withPaymentKey(key, (tx) =>
        runIdempotentPayment(tx, { companyId, key, request: { ...request, amount: "130000" } }, async () => {
          operations += 1;
          return { paymentId: "unexpected", number: "PAY-TEST-003" };
        }),
      ),
    ).rejects.toThrow("Kunci pembayaran sudah digunakan untuk data yang berbeda.");
    expect(operations).toBe(1);
  });

  it("releases the idempotency claim when the payment transaction rolls back", async () => {
    const key = newKey();
    let operations = 0;
    await expect(
      withPaymentKey(key, async (tx) => {
        await runIdempotentPayment(tx, { companyId, key, request: { kind: "opening", amount: "30000" } }, async () => {
          operations += 1;
          return { paymentId: "rolled-back" };
        });
        throw new Error("simulated transaction failure");
      }),
    ).rejects.toThrow("simulated transaction failure");

    const result = await withPaymentKey(key, (tx) =>
      runIdempotentPayment(tx, { companyId, key, request: { kind: "opening", amount: "30000" } }, async () => {
        operations += 1;
        return { paymentId: "payment-after-rollback" };
      }),
    );
    expect(result).toEqual({ paymentId: "payment-after-rollback" });
    expect(operations).toBe(2);
  });

  it("serializes concurrent requests with the same key and returns one committed result", async () => {
    const key = newKey();
    let operations = 0;
    let announceClaim!: () => void;
    let releaseFirst!: () => void;
    const claimed = new Promise<void>((resolve) => { announceClaim = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const request = { kind: "expense-payable", expenseId: "expense-a", amount: "45000" };

    const first = withPaymentKey(key, (tx) =>
      runIdempotentPayment(tx, { companyId, key, request }, async () => {
        operations += 1;
        announceClaim();
        await gate;
        return { paymentId: "payment-concurrent", number: "PAY-TEST-004" };
      }),
    );
    await claimed;
    const second = withPaymentKey(key, (tx) =>
      runIdempotentPayment(tx, { companyId, key, request }, async () => {
        operations += 1;
        return { paymentId: "duplicate", number: "PAY-TEST-005" };
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(operations).toBe(1);
  });
});
