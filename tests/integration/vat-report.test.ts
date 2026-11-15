import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accountMappings, sales, warehouses } from "@/db/schema";
import { getAccountMap, postJournal } from "@/server/accounting";
import { getVatReport } from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";
const rollbackTransaction = makeRollbackTransaction(ORG);

describe("laporan PPN — buku pajak dari jurnal", () => {
  it("menghitung PPN keluaran, masukan, neto, dan baris per jurnal", async () => {
    const report = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG);
      expect(map.tax_output).toBeTruthy();
      expect(map.tax_input).toBeTruthy();

      await postJournal(tx, {
        companyId: ORG,
        createdBy: USER,
        date: "2026-11-10",
        description: "Penjualan uji PPN",
        sourceType: "manual",
        lines: [
          { accountId: map.cash, debit: 111 },
          { accountId: map.revenue, credit: 100 },
          { accountId: map.tax_output, credit: 11 },
        ],
      });
      await postJournal(tx, {
        companyId: ORG,
        createdBy: USER,
        date: "2026-11-11",
        description: "Pembelian uji PPN",
        sourceType: "manual",
        lines: [
          { accountId: map.inventory, debit: 100 },
          { accountId: map.tax_input, debit: 11 },
          { accountId: map.payable, credit: 111 },
        ],
      });

      return getVatReport(tx, ORG, { from: "2026-11-01", to: "2026-11-30" });
    });

    expect(report.mapped).toBe(true);
    expect(report.outputAccount?.id).toBeTruthy();
    expect(report.inputAccount?.id).toBeTruthy();
    expect(report.output).toBe(11);
    expect(report.input).toBe(11);
    expect(report.net).toBe(0);
    expect(report.entryCount).toBe(2);
    expect(report.lines).toHaveLength(2);
    expect(report.lines.map((line) => line.direction).sort()).toEqual(["input", "output"]);
  });

  it("mengembalikan mapped=false bila pemetaan PPN belum ada", async () => {
    const report = await rollbackTransaction(async (tx) => {
      await tx
        .delete(accountMappings)
        .where(
          inArray(accountMappings.key, ["tax_output", "tax_input"]),
        );
      return getVatReport(tx, ORG, { from: "2026-11-01", to: "2026-11-30" });
    });
    expect(report.mapped).toBe(false);
    expect(report.output).toBe(0);
    expect(report.input).toBe(0);
    expect(report.lines).toEqual([]);
  });
});

describe("laporan PPN — DPP dan dokumen sumber", () => {
  it("mengambil DPP dan nomor dokumen dari penjualan sumber", async () => {
    const result = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG);
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [sale] = await tx
        .insert(sales)
        .values({
          companyId: ORG,
          warehouseId: warehouse.id,
          number: `VAT-SALE-${suffix}`,
          date: "2026-11-12",
          cashierId: USER,
          status: "completed",
          subtotal: "110",
          discountTotal: "10",
          taxTotal: "10",
          total: "110",
        })
        .returning({ id: sales.id });
      await postJournal(tx, {
        companyId: ORG,
        createdBy: USER,
        date: "2026-11-12",
        description: "Penjualan uji DPP",
        sourceType: "sale",
        sourceId: sale.id,
        lines: [
          { accountId: map.cash, debit: 110 },
          { accountId: map.revenue, credit: 100 },
          { accountId: map.tax_output, credit: 10 },
        ],
      });
      return getVatReport(tx, ORG, { from: "2026-11-01", to: "2026-11-30" });
    });
    const line = result.lines.find((row) => row.sourceType === "sale" && row.direction === "output");
    expect(line?.dpp).toBe(100);
    expect(line?.sourceNumber).toContain("VAT-SALE-");
    expect(line?.sourceHref).toContain("/app/pos/nota/");
  });
});
