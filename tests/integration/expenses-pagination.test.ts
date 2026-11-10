import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { accounts, expenses } from "@/db/schema";
import { listExpenses } from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";



const rollbackTransaction = makeRollbackTransaction(ORG_ID);

/**
 * AK-P3-05(c): daftar beban berpaginasi server dan kartu total berasal dari
 * agregat server atas SELURUH filter — bukan dari baris yang termuat.
 * Agregat nominal mengecualikan beban void; jumlah baris (untuk pagination)
 * mencakup semua baris termasuk void karena void tetap ditampilkan.
 */
describe("listExpenses pagination & aggregates (T4-6b)", () => {
  it("paginates and aggregates over the full filtered set", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const [expenseAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.type, "expense")))
        .limit(1);
      const [paymentAccount] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.type, "asset")))
        .limit(1);
      expect(expenseAccount).toBeDefined();
      expect(paymentAccount).toBeDefined();

      const fixtures = [
        { number: "EXP-T46B-1", date: "2020-03-01", amount: "100000", status: "posted" },
        { number: "EXP-T46B-2", date: "2020-03-02", amount: "200000", status: "posted" },
        { number: "EXP-T46B-3", date: "2020-03-03", amount: "300000", status: "posted" },
        { number: "EXP-T46B-4", date: "2020-03-04", amount: "400000", status: "posted" },
        { number: "EXP-T46B-5", date: "2020-03-05", amount: "999999", status: "void" },
      ];
      for (const fixture of fixtures) {
        await tx.insert(expenses).values({
          companyId: ORG_ID,
          number: fixture.number,
          date: fixture.date,
          expenseAccountId: expenseAccount.id,
          paymentAccountId: paymentAccount.id,
          amount: fixture.amount,
          description: `Beban uji T4-6b ${fixture.number}`,
          status: fixture.status,
        });
      }

      const page1 = await listExpenses(tx, ORG_ID, {
        from: "2020-03-01",
        to: "2020-03-31",
        page: 1,
        pageSize: 2,
        month: "2020-03",
      });
      const page3 = await listExpenses(tx, ORG_ID, {
        from: "2020-03-01",
        to: "2020-03-31",
        page: 3,
        pageSize: 2,
        month: "2020-04",
      });
      return { page1, page3 };
    });

    // Pagination covers every row in range (void rows are still displayed).
    expect(result.page1.total).toBe(5);
    expect(result.page1.rows).toHaveLength(2);
    expect(result.page1.rows[0].number).toBe("EXP-T46B-5");
    expect(result.page3.rows).toHaveLength(1);
    expect(result.page3.rows[0].number).toBe("EXP-T46B-1");

    // Aggregates span the whole filter and exclude void amounts.
    expect(result.page1.totalAmount).toBe("1000000.0000");
    expect(result.page1.monthAmount).toBe("1000000.0000");
    expect(result.page3.monthAmount).toBe("0.0000");
    expect(result.page3.totalAmount).toBe("1000000.0000");
  });
});
