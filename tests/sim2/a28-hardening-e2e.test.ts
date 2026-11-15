import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  cashSessions,
  companySettings,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  stockBatches,
  stockOnHand,
  user,
  warehouses,
} from "@/db/schema";
import { createReceipt } from "@/server/inventory";
import { closeCashSession, createSale, openCashSession } from "@/server/pos";
import { getIncomeStatement } from "@/server/reports";
import { buildReportExportTable } from "@/server/reports/export-builders";
import { reportTableToXlsx } from "@/server/reports/export-table";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * A-28 Tahap 6 — simulasi DIPERLUAS: rantai ujung-ke-ujung satu hari
 * minimarket yang menggabungkan perbaikan Tahap 1–3 dalam SATU alur
 * (penerimaan batch → sesi kas → penjualan → tutup buta → jurnal →
 * ekspor XLSX bulan berjalan terparse).
 *
 * Pemetaan cakupan (agar tidak menggandakan test yang sudah ada):
 * - (a) Penjualan atas batch kedaluwarsa tertolak & FEFO melompat ke
 *   lot segar SUDAH tercakup tuntas di
 *   tests/integration/a28-gdg-fefo-expired.test.ts (Tahap 2, 8 test).
 *   Di sini lot kedaluwarsa hanya hadir sebagai prasyarat rantai:
 *   yang dibuktikan adalah lot itu tetap utuh sesudah hari berjalan.
 * - (b) Penegakan server toleransi/alasan tutup sesi SUDAH tercakup
 *   di tests/integration/pos-session-close-hardening.test.ts
 *   (Tahap 1). Yang BARU di sini: penjualan nyata di dalam sesi
 *   mengubah kas harapan, lalu tutup buta melewati toleransi
 *   terjurnal benar sebagai bagian dari rantai hari yang sama.
 * - (c) Paritas rute ekspor XLSX vs layar/CSV SUDAH tercakup di
 *   tests/integration/a28-tahap3-xlsx-export.test.ts (Tahap 3).
 *   Yang BARU di sini: XLSX dibangun dari model ekspor yang sama
 *   (buildReportExportTable → reportTableToXlsx — jalur persis yang
 *   dipakai rute) untuk bulan yang memuat rantai penjualan di atas,
 *   di-parse kembali, dan totalnya sama dengan domain pada data yang
 *   sama.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function cashMethod(tx: Tx) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function batchQty(tx: Tx, productId: string, batchNumber: string) {
  const rows = await tx
    .select()
    .from(stockBatches)
    .where(and(eq(stockBatches.companyId, ORG_ID), eq(stockBatches.productId, productId)));
  const row = rows.find((candidate) => candidate.batchNumber === batchNumber);
  return row ? d(row.qty) : null;
}

describe("A-28 Tahap 6 — rantai satu hari minimarket (simulasi diperluas)", () => {
  it("terima batch → buka sesi → jual → tutup buta lewat toleransi → jurnal selisih & pendapatan benar", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      // Toleransi bawaan Rp0 ditegaskan di dalam transaksi uji ini.
      await tx
        .update(companySettings)
        .set({ posSessionDifferenceTolerance: "0" })
        .where(eq(companySettings.companyId, ORG_ID));

      const warehouse = await defaultWarehouse(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `A28-E2E-${suffix}`,
          name: "Susu Rantai A28",
          costPrice: "1000",
          salePrice: "2000",
          trackBatch: true,
        })
        .returning({ id: products.id });

      // Pagi: terima lot kedaluwarsa (kemarin) & lot segar.
      for (const [batchNumber, expiryDate, qty] of [
        ["LOT-MATI", addDays(today, -1), 5],
        ["LOT-SEGAR", addDays(today, 90), 10],
      ] as const) {
        await createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          date: today,
          lines: [{ productId: product.id, qty, unitCost: 1000, batchNumber, expiryDate }],
        });
      }

      const before = await getIncomeStatement(tx, ORG_ID, {
        from: `${today.slice(0, 7)}-01T00:00:00`,
        to: `${today}T23:59:59`,
      });

      // Sesi dibuka dengan modal Rp200.000 oleh kasir khusus uji ini
      // (pengguna demo bisa sedang memiliki sesi terbuka di DB dev).
      const cashierId = `kasir-rantai-a28-${suffix}`;
      await tx.insert(user).values({
        id: cashierId,
        name: "Kasir Rantai A28",
        email: `kasir.rantai.a28.${suffix}@uji.local`,
      });
      const session = await openCashSession(tx, {
        companyId: ORG_ID,
        userId: cashierId,
        openingCash: 200_000,
      });

      // Penjualan tunai 4 pcs di dalam sesi: lot segar yang keluar,
      // lot kedaluwarsa utuh (prasyarat rantai dari Tahap 2).
      const method = await cashMethod(tx);
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: cashierId,
        warehouseId: warehouse.id,
        sessionId: session.id,
        date: today,
        lines: [{ productId: product.id, qty: 4 }],
        payments: [{ methodId: method.id, amount: 8000, tendered: 8000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      expect(sale.total).toBe(8000);
      expect((await batchQty(tx, product.id, "LOT-SEGAR"))!.toFixed(4)).toBe("6.0000");
      expect((await batchQty(tx, product.id, "LOT-MATI"))!.toFixed(4)).toBe("5.0000");
      const [onHand] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            eq(stockOnHand.productId, product.id),
          ),
        );
      expect(d(onHand.qty).toFixed(4)).toBe("11.0000");

      // Tutup buta: kas harapan = 200.000 + 8.000 = 208.000. Kasir
      // menghitung 200.000 → selisih −8.000 melewati toleransi Rp0:
      // tanpa alasan DITOLAK dan sesi tetap terbuka…
      let rejection: unknown;
      try {
        await closeCashSession(tx, {
          companyId: ORG_ID,
          userId: cashierId,
          sessionId: session.id,
          countedCash: 200_000,
        });
      } catch (caught) {
        rejection = caught;
      }
      expect(rejection).toMatchObject({ code: "VALIDATION" });
      const [stillOpen] = await tx
        .select({ status: cashSessions.status })
        .from(cashSessions)
        .where(eq(cashSessions.id, session.id));
      expect(stillOpen.status).toBe("open");

      // …dengan alasan tertulis: tertutup dan terjurnal.
      const closed = await closeCashSession(tx, {
        companyId: ORG_ID,
        userId: cashierId,
        sessionId: session.id,
        countedCash: 200_000,
        differenceReason: "Kembalian berlebih saat antrean ramai",
      });
      expect(closed.difference).toBe(-8000);

      const mappings = await tx
        .select()
        .from(accountMappings)
        .where(eq(accountMappings.companyId, ORG_ID));
      const accountByKey = new Map(mappings.map((row) => [row.key, row.accountId]));
      const sessionEntries = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "cash_session"),
            eq(journalEntries.sourceId, session.id),
          ),
        );
      expect(sessionEntries).toHaveLength(1);
      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, sessionEntries[0].id));
      const shortLine = lines.find((line) => line.accountId === accountByKey.get("cash_short"));
      const cashLine = lines.find((line) => line.accountId === accountByKey.get("cash"));
      expect(d(shortLine!.debit).toNumber()).toBe(8000);
      expect(d(cashLine!.credit).toNumber()).toBe(8000);

      // Pendapatan bulan berjalan naik tepat sebesar penjualan rantai.
      const after = await getIncomeStatement(tx, ORG_ID, {
        from: `${today.slice(0, 7)}-01T00:00:00`,
        to: `${today}T23:59:59`,
      });
      expect(after.totalRevenue - before.totalRevenue).toBe(8000);
    });
  });

  it("ekspor XLSX bulan berjalan (jalur rute) ter-parse & totalnya sama dengan domain sesudah penjualan rantai", async () => {
    await rollbackTransaction(async (tx) => {
      const today = todayISO();
      const from = `${today.slice(0, 7)}-01`;
      const range = { from: `${from}T00:00:00`, to: `${today}T23:59:59` };

      const warehouse = await defaultWarehouse(tx);
      const suffix = crypto.randomUUID().slice(0, 8);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `A28-XLSX-${suffix}`,
          name: "Kopi Rantai A28",
          costPrice: "1000",
          salePrice: "2500",
        })
        .returning({ id: products.id });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "opening",
        date: today,
        lines: [{ productId: product.id, qty: 10, unitCost: 1000 }],
      });

      const before = await getIncomeStatement(tx, ORG_ID, range);
      const method = await cashMethod(tx);
      await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: today,
        lines: [{ productId: product.id, qty: 2 }],
        payments: [{ methodId: method.id, amount: 5000, tendered: 5000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      const domain = await getIncomeStatement(tx, ORG_ID, range);
      // Laba naik tepat margin rantai: pendapatan 5.000 − HPP 2.000.
      expect(domain.totalRevenue - before.totalRevenue).toBe(5000);
      expect(domain.netProfit - before.netProfit).toBe(3000);

      // Bangun XLSX lewat model & serializer yang persis dipakai rute
      // /api/export/report?format=xlsx, lalu parse kembali.
      const table = await buildReportExportTable(
        tx,
        { id: ORG_ID, name: "Bisa Minimarket" },
        "laba-rugi",
        from,
        today,
      );
      const buffer = await reportTableToXlsx(table);
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
      expect(String(aoa[1]?.[0])).toBe("Laporan Laba Rugi");

      const netRow = aoa.find((row) =>
        row.some((cell) => typeof cell === "string" && cell.trim() === "Laba bersih"),
      );
      expect(netRow).toBeDefined();
      expect(typeof netRow![2]).toBe("number");
      expect(Number(netRow![2])).toBeCloseTo(domain.netProfit, 2);
    });
  });
});
