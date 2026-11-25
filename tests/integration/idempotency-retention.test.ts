import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { idempotencyKeys } from "@/db/schema";
import { pruneExpiredIdempotencyKeys } from "@/server/idempotency";
import { adminSql } from "@/db/admin";
import { wipeCompanyFixture } from "../helpers/wipe-company";

const COMPANY_ID = `audit-retention-${crypto.randomUUID()}`;

afterAll(async () => {
  await wipeCompanyFixture(adminSql, COMPANY_ID);
});

describe("idempotency retention", () => {
  it("prunes old non-journal keys but retains the journal fingerprint", async () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await withCompany(COMPANY_ID, async (tx) => {
      await tx.insert(idempotencyKeys).values([
        {
          companyId: COMPANY_ID,
          key: `journal-${crypto.randomUUID()}`,
          scope: "accounting.journal",
          resultRef: "journal-fingerprint",
          createdAt: old,
        },
        {
          companyId: COMPANY_ID,
          key: `payment-${crypto.randomUUID()}`,
          scope: "accounting.payment",
          resultRef: "payment-fingerprint",
          createdAt: old,
        },
      ]);
    });

    const removed = await withCompany(COMPANY_ID, (tx) =>
      pruneExpiredIdempotencyKeys(tx, { companyId: COMPANY_ID, retentionDays: 30 }),
    );
    expect(removed).toBe(1);

    const rows = await withCompanyReadOnly(COMPANY_ID, (tx) =>
      tx.select({ scope: idempotencyKeys.scope }).from(idempotencyKeys).where(
        eq(idempotencyKeys.companyId, COMPANY_ID),
      ),
    );
    expect(rows.map((row) => row.scope)).toEqual(["accounting.journal"]);
  });
});
