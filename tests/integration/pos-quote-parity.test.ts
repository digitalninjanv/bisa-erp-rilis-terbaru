import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import {
  companySettings,
  customerGroupPrices,
  customerGroups,
  products,
  warehouses,
} from "@/db/schema";
import { quoteCart, type QuoteResult } from "@/server/pos";
import {
  computeLocalOfflineQuote,
  type LocalOfflineQuote,
  type LocalQuoteCatalogEntry,
} from "@/lib/pos-offline";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * A-26 Q1b (P-05) — differential parity test quote POS.
 *
 * Quote server (server/pos/quote.ts::quoteCart) adalah otoritas;
 * quote lokal offline (lib/pos-offline.ts::computeLocalOfflineQuote)
 * adalah cerminan DISENGAJA di atas primitif uang yang sama
 * (kontrak D-23, temuan A-24 T6-01). Sebelum test ini, paritasnya
 * hanya dijaga test unit lokal dengan nilai harap tulisan tangan.
 * Test ini menjalankan KEDUA implementasi atas fixture keranjang
 * yang sama dan membuktikan total & rincian uang identik.
 *
 * Satu-satunya selisih yang diizinkan adalah yang terdokumentasi:
 * harga kelompok PER PRODUK tidak diketahui klien (katalog lokal
 * tidak memuat aturan customerGroupPrices), jadi pada keranjang
 * berkelompok-beraturan-harga, quote lokal menghitung pada harga
 * master dan selisihnya diselesaikan sebagai konflik harga di
 * peninjauan sinkronisasi. Kasus divergensi di bawah mengunci
 * selisih itu secara persis (== total diskon kelompok server),
 * bukan membiarkannya bebas.
 *
 * Yang TIDAK dibandingkan (beda sumber/bentuk by-design, bukan
 * angka uang): stok (server = stok hidup gudang; lokal = snapshot
 * katalog), unitCost (internal server), manualDiscountOverride
 * (lokal selalu null; gerbang ambang ditegakkan server & saat
 * sinkronisasi), discountAccountId & identitas kelompok (lokal
 * tidak mengenalnya).
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

type ProductDef = { key: string; sku: string; name: string; salePrice: string };
const DEFS: ProductDef[] = [
  { key: "PA", sku: "Q5-PA", name: "Produk Paritas A", salePrice: "4000" },
  { key: "PB", sku: "Q5-PB", name: "Produk Paritas B", salePrice: "3000" },
  { key: "PC", sku: "Q5-PC", name: "Produk Paritas C", salePrice: "7250" },
  { key: "PD", sku: "Q5-PD", name: "Produk Paritas D", salePrice: "11100" },
  { key: "PE", sku: "Q5-PE", name: "Produk Paritas E", salePrice: "3300" },
  { key: "PF", sku: "Q5-PF", name: "Produk Paritas F", salePrice: "10000" },
];

async function seedProducts(tx: Tx): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const def of DEFS) {
    const [row] = await tx
      .insert(products)
      .values({
        companyId: ORG_ID,
        sku: def.sku,
        name: def.name,
        costPrice: "1000",
        salePrice: def.salePrice,
        trackStock: true,
      })
      .returning({ id: products.id });
    ids.set(def.key, row.id);
  }
  return ids;
}

function localCatalog(ids: Map<string, string>): Record<string, LocalQuoteCatalogEntry> {
  const catalog: Record<string, LocalQuoteCatalogEntry> = {};
  for (const def of DEFS) {
    catalog[ids.get(def.key)!] = {
      name: def.name,
      sku: def.sku,
      salePrice: def.salePrice,
      stock: 999,
      trackStock: true,
      trackSerial: false,
    };
  }
  return catalog;
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

async function setSettings(
  tx: Tx,
  patch: Partial<{
    taxEnabled: boolean;
    taxRate: string;
    roundingMode: string;
    posDiscountThresholdPercent: string;
  }>,
) {
  await tx.update(companySettings).set(patch).where(eq(companySettings.companyId, ORG_ID));
}

/** Bentuk uang yang dibandingkan: rincian baris + total (lihat kepala berkas). */
function moneyShape(quote: QuoteResult | LocalOfflineQuote) {
  return {
    lines: quote.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      groupUnitPrice: line.groupUnitPrice,
      gross: line.gross,
      discountType: line.discountType,
      discountValue: line.discountValue,
      discountAmount: line.discountAmount,
      groupDiscountAmount: line.groupDiscountAmount,
      manualDiscountAmount: line.manualDiscountAmount,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      lineTotal: line.lineTotal,
    })),
    subtotal: quote.subtotal,
    discountTotal: quote.discountTotal,
    taxTotal: quote.taxTotal,
    netSales: quote.netSales,
    roundingAdjustment: quote.roundingAdjustment,
    total: quote.total,
    roundingMode: quote.roundingMode,
    cashRounding: quote.cashRounding,
  };
}

describe("A-26 Q1b (P-05) — paritas quote server vs quote lokal offline", () => {
  it("keranjang polos + diskon manual persen & nominal terpotong: identik", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const ids = await seedProducts(tx);
      await setSettings(tx, {
        taxEnabled: false, taxRate: "0", roundingMode: "none", posDiscountThresholdPercent: "100",
      });
      const lines = [
        { productId: ids.get("PA")!, qty: 2, discountType: "percent" as const, discountValue: 10 },
        { productId: ids.get("PB")!, qty: 1, discountType: "nominal" as const, discountValue: 5000 },
        { productId: ids.get("PC")!, qty: 3 },
      ];
      const server = await quoteCart(tx, {
        companyId: ORG_ID, warehouseId: warehouse.id, lines, canDiscount: true,
      });
      const local = computeLocalOfflineQuote({
        lines, catalog: localCatalog(ids), taxRate: 0, companyRoundingMode: "none",
      });
      expect(local).not.toBeNull();
      expect(moneyShape(local!)).toEqual(moneyShape(server));
      // Jangkar angka tangan: 8000+3000+21750 bruto; diskon 800+3000.
      expect(server.subtotal).toBe(32750);
      expect(server.discountTotal).toBe(3800);
      expect(server.total).toBe(28950);
    });
  });

  it("pajak inklusif 11%: komponen pajak & total identik", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const ids = await seedProducts(tx);
      await setSettings(tx, {
        taxEnabled: true, taxRate: "11", roundingMode: "none", posDiscountThresholdPercent: "100",
      });
      const lines = [
        { productId: ids.get("PD")!, qty: 1 },
        { productId: ids.get("PA")!, qty: 2, discountType: "percent" as const, discountValue: 10 },
      ];
      const server = await quoteCart(tx, {
        companyId: ORG_ID, warehouseId: warehouse.id, lines, canDiscount: true,
      });
      const local = computeLocalOfflineQuote({
        lines, catalog: localCatalog(ids), taxRate: 11, companyRoundingMode: "none",
      });
      expect(local).not.toBeNull();
      expect(moneyShape(local!)).toEqual(moneyShape(server));
      // 11100 inklusif 11% → pajak 1100, DPP 10000.
      expect(server.lines[0].taxAmount).toBe(1100);
      expect(server.total).toBe(18300);
    });
  });

  it("pembulatan tunai perusahaan nearest_500 lalu up_1000: identik", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const ids = await seedProducts(tx);
      const lines = [
        { productId: ids.get("PA")!, qty: 1 },
        { productId: ids.get("PE")!, qty: 1 },
      ];
      const catalog = localCatalog(ids);

      await setSettings(tx, {
        taxEnabled: false, taxRate: "0", roundingMode: "nearest_500", posDiscountThresholdPercent: "100",
      });
      const server500 = await quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines });
      const local500 = computeLocalOfflineQuote({
        lines, catalog, taxRate: 0, companyRoundingMode: "nearest_500",
      });
      expect(moneyShape(local500!)).toEqual(moneyShape(server500));
      expect(server500.total).toBe(7500); // 7300 → terdekat 500

      await setSettings(tx, { roundingMode: "up_1000" });
      const serverUp = await quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines });
      const localUp = computeLocalOfflineQuote({
        lines, catalog, taxRate: 0, companyRoundingMode: "up_1000",
      });
      expect(moneyShape(localUp!)).toEqual(moneyShape(serverUp));
      expect(serverUp.total).toBe(8000);
      expect(serverUp.roundingAdjustment).toBe(700);
    });
  });

  it("kelompok hanya pembulatan kas (tanpa aturan harga per produk): identik", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const ids = await seedProducts(tx);
      await setSettings(tx, {
        taxEnabled: false, taxRate: "0", roundingMode: "nearest_500", posDiscountThresholdPercent: "100",
      });
      const [group] = await tx
        .insert(customerGroups)
        .values({
          companyId: ORG_ID,
          name: "Kelompok Paritas Bulat",
          roundingStep: 100,
          roundingDirection: "up",
          roundCashTotal: true,
        })
        .returning({ id: customerGroups.id });
      const lines = [{ productId: ids.get("PC")!, qty: 1 }];
      const server = await quoteCart(tx, {
        companyId: ORG_ID, warehouseId: warehouse.id, groupId: group.id, lines,
      });
      const local = computeLocalOfflineQuote({
        lines,
        catalog: localCatalog(ids),
        group: { roundingStep: 100, roundingDirection: "up", roundCashTotal: true },
        taxRate: 0,
        companyRoundingMode: "nearest_500",
      });
      expect(local).not.toBeNull();
      expect(moneyShape(local!)).toEqual(moneyShape(server));
      // Pembulatan kelompok (100 ke atas) mengalahkan mode perusahaan.
      expect(server.total).toBe(7300);
      expect(server.roundingMode).toBe("up_100");
    });
  });

  it("campuran: qty desimal + diskon persen + pajak + pembulatan: identik", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const ids = await seedProducts(tx);
      await setSettings(tx, {
        taxEnabled: true, taxRate: "11", roundingMode: "nearest_100", posDiscountThresholdPercent: "100",
      });
      const lines = [
        { productId: ids.get("PF")!, qty: 1.5, discountType: "percent" as const, discountValue: 10 },
        { productId: ids.get("PC")!, qty: 1 },
      ];
      const server = await quoteCart(tx, {
        companyId: ORG_ID, warehouseId: warehouse.id, lines, canDiscount: true,
      });
      const local = computeLocalOfflineQuote({
        lines, catalog: localCatalog(ids), taxRate: 11, companyRoundingMode: "nearest_100",
      });
      expect(local).not.toBeNull();
      expect(moneyShape(local!)).toEqual(moneyShape(server));
      // (15000 − 1500) + 7250 = 20750 → terdekat 100 = 20800.
      expect(server.total).toBe(20800);
      expect(server.roundingAdjustment).toBe(50);
    });
  });

  it("divergensi terdokumentasi: aturan harga kelompok per produk — selisih PERSIS diskon kelompok server", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const ids = await seedProducts(tx);
      await setSettings(tx, {
        taxEnabled: false, taxRate: "0", roundingMode: "none", posDiscountThresholdPercent: "100",
      });
      const [group] = await tx
        .insert(customerGroups)
        .values({
          companyId: ORG_ID,
          name: "Kelompok Paritas Harga",
          roundingStep: 1,
          roundingDirection: "nearest",
          roundCashTotal: false,
        })
        .returning({ id: customerGroups.id });
      await tx.insert(customerGroupPrices).values([
        { companyId: ORG_ID, groupId: group.id, productId: ids.get("PA")!, ruleType: "percent", value: "10" },
        { companyId: ORG_ID, groupId: group.id, productId: ids.get("PB")!, ruleType: "fixed", value: "2500" },
      ]);
      const lines = [
        { productId: ids.get("PA")!, qty: 2 },
        { productId: ids.get("PB")!, qty: 1 },
      ];
      const catalog = localCatalog(ids);
      const serverGroup = await quoteCart(tx, {
        companyId: ORG_ID, warehouseId: warehouse.id, groupId: group.id, lines,
      });
      const serverPlain = await quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines });
      const local = computeLocalOfflineQuote({
        lines, catalog, taxRate: 0, companyRoundingMode: "none",
      });
      expect(local).not.toBeNull();

      // Quote lokal ≡ server TANPA harga kelompok (seluruh rincian).
      expect(moneyShape(local!)).toEqual(moneyShape(serverPlain));

      // Dan selisihnya terhadap server berkelompok terkunci persis:
      // PA (4000→3600)×2 = 800; PB (3000→2500)×1 = 500; total 1300.
      expect(serverGroup.lines.map((line) => line.groupDiscountAmount)).toEqual([800, 500]);
      expect(local!.lines.map((line) => line.groupDiscountAmount)).toEqual([0, 0]);
      expect(serverGroup.discountTotal - local!.discountTotal).toBe(1300);
      expect(local!.total - serverGroup.total).toBe(1300);
    });
  });
});
