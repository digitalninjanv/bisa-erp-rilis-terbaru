import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { withCompanyReadOnly } from "@/db/tenant";
import { products, stockMovements, stockOnHand, warehouses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * SIM-2 S7 REM-01 (sumber: RT-07 di S5 + §2 S0-B): relasi master pada
 * tabel stok & produk dulunya uuid polos tanpa FK database, sehingga
 * baris yatim hanya dicegah penjaga aplikasi. Test ini mengunci FK-nya:
 * sisipan yatim harus ditolak Postgres dengan 23503, dan perusahaan
 * fixture tidak boleh lagi menyimpan baris stok yatim.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const GHOST_ID = "01999999-9999-7999-8999-999999999999";



const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function hasPgCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === code) return true;
    current = candidate.cause;
  }
  return false;
}

async function expectFkRejection(fn: () => Promise<unknown>) {
  let error: unknown;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, "sisipan yatim seharusnya ditolak").toBeDefined();
  expect(hasPgCode(error, "23503")).toBe(true);
}

describe("REM-01 foreign keys on stock & product master relations", () => {
  it("rejects stock_on_hand rows for a product that does not exist", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_ID))
        .limit(1);
      await expectFkRejection(() =>
        tx.insert(stockOnHand).values({
          companyId: ORG_ID,
          warehouseId: warehouse!.id,
          productId: GHOST_ID,
          qty: "5",
        }),
      );
    });
  });

  it("rejects stock_movements rows for a product that does not exist", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_ID))
        .limit(1);
      await expectFkRejection(() =>
        tx.insert(stockMovements).values({
          companyId: ORG_ID,
          warehouseId: warehouse!.id,
          productId: GHOST_ID,
          movementType: "adjustment",
          qty: "1",
          unitCost: "0",
        }),
      );
    });
  });

  it("rejects products pointing at a missing category, unit, or supplier", async () => {
    // Satu transaksi per kolom: penolakan FK meng-abort transaksi
    // Postgres, jadi penolakan berikutnya butuh transaksi baru.
    const base = { companyId: ORG_ID, sku: "REM01-GHOST", name: "Produk Hantu" };
    for (const ghost of [{ categoryId: GHOST_ID }, { unitId: GHOST_ID }, { supplierId: GHOST_ID }]) {
      await rollbackTransaction(async (tx) => {
        await expectFkRejection(() => tx.insert(products).values({ ...base, ...ghost }));
      });
    }
  });

  it("keeps the shared fixture company free of orphan stock rows", async () => {
    const counts = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = (await tx.execute(sql`
        select
          (select count(*) from stock_on_hand s
            left join products p on p.id = s.product_id
            where s.company_id = ${ORG_ID} and p.id is null) as soh_orphans,
          (select count(*) from stock_movements m
            left join products p on p.id = m.product_id
            where m.company_id = ${ORG_ID} and p.id is null) as sm_orphans
      `)) as unknown as { soh_orphans: string; sm_orphans: string }[];
      return { soh: Number(rows[0]!.soh_orphans), sm: Number(rows[0]!.sm_orphans) };
    });
    expect(counts.soh).toBe(0);
    expect(counts.sm).toBe(0);
  });
});
