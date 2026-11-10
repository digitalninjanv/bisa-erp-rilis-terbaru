import { describe, expect, it } from "vitest";


import { listEntityAuditTrail, writeAudit } from "@/server/audit";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * SIM-2 S7 REM-03 (sumber: SEC-09 S6 + sisa #3 S3): audit_log ditulis di
 * 100+ titik tetapi tidak punya penampil per record. Test ini mengunci
 * model bacanya: terfilter tepat per (entitas, id), urut terbaru dulu,
 * dan berpaginasi server dengan total yang jujur.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";



const rollbackTransaction = makeRollbackTransaction(ORG_ID);

describe("REM-03 listEntityAuditTrail", () => {
  it("filters per entity, orders newest first, and paginates with an honest total", async () => {
    await rollbackTransaction(async (tx) => {
      const entityId = "01900000-0000-7000-8000-00000000rem3";
      const otherId = "01900000-0000-7000-8000-00000000oth3";
      for (const action of ["product.create", "product.update", "product.update"]) {
        await writeAudit(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          action,
          entityType: "product",
          entityId,
          after: { name: "Produk REM03" },
        });
      }
      await writeAudit(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        action: "product.delete",
        entityType: "product",
        entityId: otherId,
      });
      await writeAudit(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        action: "account.update",
        entityType: "account",
        entityId,
      });

      const page1 = await listEntityAuditTrail(tx, ORG_ID, "product", entityId, { page: 1, pageSize: 2 });
      expect(page1.total).toBe(3);
      expect(page1.rows).toHaveLength(2);
      expect(page1.rows.every((row) => row.entityType === "product" && row.entityId === entityId)).toBe(true);
      // Terbaru dulu: dua penulisan terakhir adalah update.
      expect(page1.rows[0]!.action).toBe("product.update");

      const page2 = await listEntityAuditTrail(tx, ORG_ID, "product", entityId, { page: 2, pageSize: 2 });
      expect(page2.total).toBe(3);
      expect(page2.rows).toHaveLength(1);
      expect(page2.rows[0]!.action).toBe("product.create");

      const other = await listEntityAuditTrail(tx, ORG_ID, "product", otherId, {});
      expect(other.total).toBe(1);

      const empty = await listEntityAuditTrail(tx, ORG_ID, "product", "01900000-0000-7000-8000-00000000none", {});
      expect(empty.total).toBe(0);
      expect(empty.rows).toEqual([]);
    });
  });
});
