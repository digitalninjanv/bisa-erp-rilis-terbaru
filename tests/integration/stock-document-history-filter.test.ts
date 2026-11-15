import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { stockDocuments, warehouses } from "@/db/schema";
import { listDocumentHistory } from "@/server/catalog";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG = "01900000-0000-7000-8000-000000000001";
const rollback = makeRollbackTransaction(ORG);

describe("riwayat dokumen gudang — filter kerja", () => {
  it("menyaring status, gudang, dan rentang tanggal tanpa mengubah total pencarian", async () => {
    await rollback(async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      const suffix = crypto.randomUUID().slice(0, 8);
      const rows = [
        { number: `TRF-F-${suffix}-A`, status: "in_transit", date: "2026-06-01" },
        { number: `TRF-F-${suffix}-B`, status: "posted", date: "2026-06-02" },
        { number: `TRF-F-${suffix}-C`, status: "void", date: "2026-07-01" },
      ];
      await tx.insert(stockDocuments).values(
        rows.map((row) => ({
          companyId: ORG,
          type: "transfer",
          number: row.number,
          date: row.date,
          warehouseId: warehouse.id,
          toWarehouseId: warehouse.id,
          status: row.status,
        })),
      );

      const all = await listDocumentHistory(tx, {
        companyId: ORG,
        types: ["transfer"],
        q: `TRF-F-${suffix}`,
      });
      expect(all.total).toBe(3);

      const inTransit = await listDocumentHistory(tx, {
        companyId: ORG,
        types: ["transfer"],
        q: `TRF-F-${suffix}`,
        status: "in_transit",
      });
      expect(inTransit.total).toBe(1);
      expect(inTransit.rows[0]?.status).toBe("in_transit");

      const byWarehouse = await listDocumentHistory(tx, {
        companyId: ORG,
        types: ["transfer"],
        q: `TRF-F-${suffix}`,
        warehouseId: warehouse.id,
      });
      expect(byWarehouse.total).toBe(3);

      const byDate = await listDocumentHistory(tx, {
        companyId: ORG,
        types: ["transfer"],
        q: `TRF-F-${suffix}`,
        from: "2026-06-01",
        to: "2026-06-30",
      });
      expect(byDate.total).toBe(2);

      const missingStatus = await listDocumentHistory(tx, {
        companyId: ORG,
        types: ["transfer"],
        q: `TRF-F-${suffix}`,
        status: "rejected",
      });
      expect(missingStatus.total).toBe(0);
    });
  });
});
