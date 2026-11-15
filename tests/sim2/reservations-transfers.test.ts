import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  member,
  organization,
  paymentMethods,
  products,
  stockDocuments,
  stockMovements,
  stockOnHand,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  applyStockMovement,
  createTransfer,
  receiveTransfer,
  voidStockDocument,
} from "@/server/inventory";
import { createSale, openCashSession, quoteCart } from "@/server/pos";
import {
  createReservation,
  getInTransitSummary,
  getReservedQuantities,
  releaseReservation,
  getConsumableReservation,
  consumeReservationForSale,
  listReservationsPage,
  countReservationsSummary,
} from "@/server/reservations";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-2 Batch 4 — Reservasi stok & transfer dua tahap.
 *
 * Reservasi mengurangi stok TERSEDIA (on hand − reserved) pada quote &
 * checkout POS tanpa menyentuh ledger. Transfer dua tahap (saklar per
 * perusahaan): kirim → in_transit → terima; mode satu tahap bawaan
 * tidak berubah.
 */

const state = vi.hoisted(() => ({ org: "", user: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: state.org },
    user: { id: state.user },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e804";
const OWNER = "01900000-0000-7000-8000-00000000e856";


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

const acc: Record<string, string> = {};
let whA = "";
let whB = "";
let productId = "";
let methodId = "";

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(user).values({ id: OWNER, name: "Pemilik Uji", email: "owner-e804@bisa.id", emailVerified: true, role: "owner" });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji Reservasi", slug: "uji-reservasi", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Reservasi", roundingMode: "none", taxRate: "0", taxEnabled: false, allowNegativeStock: false,
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1300", name: "Persediaan Barang", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "4020", name: "Retur Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
      { companyId: ORG, code: "6000", name: "Beban Susut Persediaan", type: "expense", normalBalance: "debit" },
      { companyId: ORG, code: "9000", name: "Pembulatan Penjualan (Laba)", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "9001", name: "Selisih Pembulatan (Rugi)", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  for (const row of rows) acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "inventory", accountId: acc["1300"] },
    { companyId: ORG, key: "payable", accountId: acc["2000"] },
    { companyId: ORG, key: "equity", accountId: acc["3000"] },
    { companyId: ORG, key: "revenue", accountId: acc["4000"] },
    { companyId: ORG, key: "sales_discount", accountId: acc["4010"] },
    { companyId: ORG, key: "sales_return", accountId: acc["4020"] },
    { companyId: ORG, key: "cogs", accountId: acc["5000"] },
    { companyId: ORG, key: "inventory_shrink", accountId: acc["6000"] },
    { companyId: ORG, key: "rounding_gain", accountId: acc["9000"] },
    { companyId: ORG, key: "rounding_loss", accountId: acc["9001"] },
  ]);
  const [cash] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: acc["1000"], sortOrder: 1 })
    .returning();
  methodId = cash.id;
  const [a] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-A", name: "Gudang A", type: "warehouse", isDefault: true })
    .returning();
  const [b] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-B", name: "Gudang B", type: "warehouse" })
    .returning();
  whA = a.id;
  whB = b.id;
  const [product] = await adminDb
    .insert(products)
    .values({ companyId: ORG, sku: "RSV-1", name: "Produk Reservasi", salePrice: "15000", costPrice: "10000", trackStock: true })
    .returning();
  productId = product.id;
  state.org = ORG;
  state.user = OWNER;

  await withCompany(ORG, async (tx) => {
    await openCashSession(tx, { companyId: ORG, userId: OWNER, openingCash: 0 });
    await applyStockMovement(tx, {
      companyId: ORG,
      warehouseId: whA,
      productId,
      delta: 10,
      unitCost: "10000",
      movementType: "purchase",
      referenceType: "opening",
      userId: OWNER,
    });
  });
}

async function onHand(warehouseId: string): Promise<number> {
  const [row] = await adminDb
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return row ? Number(row.qty) : 0;
}

async function sell(qty: number) {
  return withCompany(ORG, async (tx) => {
    const quote = await quoteCart(tx, {
      companyId: ORG,
      warehouseId: whA,
      customerId: null,
      lines: [{ productId, qty }],
    });
    return createSale(tx, {
      companyId: ORG,
      userId: OWNER,
      warehouseId: whA,
      date: "2026-03-10",
      lines: [{ productId, qty }],
      payments: [{ methodId, amount: quote.total, tendered: quote.total }],
      idempotencyKey: crypto.randomUUID(),
    });
  });
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("Reservasi stok", () => {
  let reservationId = "";

  it("reservasi 7 dari stok 10: quote tersedia 3, jual 4 ditolak, jual 3 lolos", async () => {
    const reservation = await withCompany(ORG, (tx) =>
      createReservation(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        qty: 7,
        date: "2026-03-10",
        reason: "Pesanan pelanggan besar",
      }),
    );
    reservationId = reservation.id;
    expect(reservation.number).toMatch(/^RSV-/);

    const quote = await withCompany(ORG, (tx) =>
      quoteCart(tx, { companyId: ORG, warehouseId: whA, customerId: null, lines: [{ productId, qty: 1 }] }),
    );
    expect(quote.lines[0].stock).toBe(3);

    await expect(sell(4)).rejects.toThrow();
    const sale = await sell(3);
    expect(sale.total).toBe(45000);
    expect(await onHand(whA)).toBe(7);
  });

  it("ledger tidak berubah oleh reservasi; rilis membebaskan stok tersedia", async () => {
    const movements = await adminDb
      .select({ qty: stockMovements.qty })
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, ORG), eq(stockMovements.productId, productId)));
    const total = movements.reduce((sum, row) => sum + Number(row.qty), 0);
    expect(total).toBe(7); // +10 awal − 3 penjualan; reservasi tidak menulis movement

    await withCompany(ORG, (tx) =>
      releaseReservation(tx, { companyId: ORG, userId: OWNER, reservationId }),
    );
    const quote = await withCompany(ORG, (tx) =>
      quoteCart(tx, { companyId: ORG, warehouseId: whA, customerId: null, lines: [{ productId, qty: 1 }] }),
    );
    expect(quote.lines[0].stock).toBe(7);
    await sell(4);
    expect(await onHand(whA)).toBe(3);
  });

  it("reservasi kedaluwarsa tidak lagi mengurangi ketersediaan saat dibaca", async () => {
    await withCompany(ORG, (tx) =>
      createReservation(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        qty: 2,
        date: "2026-03-10",
        expiresAt: new Date(Date.now() - 60_000),
        reason: "Sudah lewat",
      }),
    );
    const reserved = await withCompany(ORG, (tx) =>
      getReservedQuantities(tx, ORG, whA, [productId]),
    );
    expect(d(reserved.get(productId) ?? 0).toNumber()).toBe(0);
    const quote = await withCompany(ORG, (tx) =>
      quoteCart(tx, { companyId: ORG, warehouseId: whA, customerId: null, lines: [{ productId, qty: 1 }] }),
    );
    expect(quote.lines[0].stock).toBe(3);
  });
});

describe("Transfer antar-gudang", () => {
  it("mode satu tahap (bawaan): stok tujuan langsung bertambah", async () => {
    await withCompany(ORG, (tx) =>
      applyStockMovement(tx, {
        companyId: ORG, warehouseId: whA, productId, delta: 10, unitCost: "10000",
        movementType: "purchase", referenceType: "opening", userId: OWNER,
      }),
    );
    const doc = await withCompany(ORG, (tx) =>
      createTransfer(tx, {
        companyId: ORG, userId: OWNER, fromWarehouseId: whA, toWarehouseId: whB,
        date: "2026-03-11", lines: [{ productId, qty: 2 }],
      }),
    );
    const [stored] = await adminDb.select().from(stockDocuments).where(eq(stockDocuments.id, doc.id));
    expect(stored.status).toBe("posted");
    expect(await onHand(whA)).toBe(11);
    expect(await onHand(whB)).toBe(2);
  });

  it("mode dua tahap: kirim → in-transit tercatat → terima → konservasi total", async () => {
    await adminDb
      .update(companySettings)
      .set({ transferTwoStepEnabled: true })
      .where(eq(companySettings.companyId, ORG));
    const before = (await onHand(whA)) + (await onHand(whB));
    const doc = await withCompany(ORG, (tx) =>
      createTransfer(tx, {
        companyId: ORG, userId: OWNER, fromWarehouseId: whA, toWarehouseId: whB,
        date: "2026-03-12", lines: [{ productId, qty: 3 }],
      }),
    );
    const [stored] = await adminDb.select().from(stockDocuments).where(eq(stockDocuments.id, doc.id));
    expect(stored.status).toBe("in_transit");
    expect(await onHand(whA)).toBe(8);
    expect(await onHand(whB)).toBe(2);

    const summary = await withCompany(ORG, (tx) => getInTransitSummary(tx, ORG));
    expect(summary.documents).toBe(1);
    expect(d(summary.totalQty).toNumber()).toBe(3);
    expect(d(summary.totalValue).toNumber()).toBe(30000);
    // Konservasi: on-hand semua gudang + in-transit = total sebelum kirim.
    expect((await onHand(whA)) + (await onHand(whB)) + d(summary.totalQty).toNumber()).toBe(before);

    const received = await withCompany(ORG, (tx) =>
      receiveTransfer(tx, { companyId: ORG, userId: OWNER, documentId: doc.id, date: "2026-03-13" }),
    );
    expect(received.status).toBe("posted");
    expect(received.receivedBy).toBe(OWNER);
    expect(await onHand(whB)).toBe(5);
    expect((await onHand(whA)) + (await onHand(whB))).toBe(before);
    const afterSummary = await withCompany(ORG, (tx) => getInTransitSummary(tx, ORG));
    expect(afterSummary.documents).toBe(0);
  });

  it("transfer in-transit dapat dibatalkan: leg keluar dibalik, asal pulih", async () => {
    const doc = await withCompany(ORG, (tx) =>
      createTransfer(tx, {
        companyId: ORG, userId: OWNER, fromWarehouseId: whA, toWarehouseId: whB,
        date: "2026-03-14", lines: [{ productId, qty: 1 }],
      }),
    );
    expect(await onHand(whA)).toBe(7);
    await withCompany(ORG, (tx) =>
      voidStockDocument(tx, {
        companyId: ORG, userId: OWNER, documentId: doc.id,
        reason: "Salah gudang tujuan", date: "2026-03-14",
      }),
    );
    expect(await onHand(whA)).toBe(8);
    const [stored] = await adminDb.select().from(stockDocuments).where(eq(stockDocuments.id, doc.id));
    expect(stored.status).toBe("void");
  });
});

describe("Cabang validasi reservasi", () => {
  it("menolak qty tidak valid, gudang/produk hilang, produk non-stok, dan stok kurang", async () => {
    await withCompany(ORG, async (tx) => {
      const base = {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        date: "2026-04-01",
      };
      await expect(createReservation(tx, { ...base, qty: 0 })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(createReservation(tx, { ...base, qty: -1 })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(
        createReservation(tx, { ...base, qty: 1, warehouseId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        createReservation(tx, { ...base, qty: 1, productId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const [nonTrack] = await tx
        .insert(products)
        .values({
          companyId: ORG,
          sku: `NONTRACK-${crypto.randomUUID().slice(0, 6)}`,
          name: "Jasa Tanpa Stok",
          salePrice: "1000",
          costPrice: "0",
          trackStock: false,
        })
        .returning({ id: products.id });
      await expect(
        createReservation(tx, { ...base, qty: 1, productId: nonTrack.id }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(createReservation(tx, { ...base, qty: 999_999 })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    });
  });

  it("rilis: tidak ditemukan, sudah nonaktif, dan excludeReservationId", async () => {
    const created = await withCompany(ORG, (tx) =>
      createReservation(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        qty: 2,
        date: "2026-04-02",
      }),
    );
    await withCompany(ORG, async (tx) => {
      const reserved = await getReservedQuantities(tx, ORG, whA, [productId], new Date(), {
        excludeReservationId: created.id,
      });
      expect(d(reserved.get(productId) ?? 0).toNumber()).toBe(0);
      const other = await getReservedQuantities(tx, ORG, whA, [productId], new Date(), {
        excludeReservationId: crypto.randomUUID(),
      });
      expect(d(other.get(productId) ?? 0).toNumber()).toBeGreaterThanOrEqual(2);
      const none = await getReservedQuantities(tx, ORG, whA, []);
      expect(none.size).toBe(0);

      await releaseReservation(tx, { companyId: ORG, userId: OWNER, reservationId: created.id });
      await expect(
        releaseReservation(tx, { companyId: ORG, userId: OWNER, reservationId: created.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        releaseReservation(tx, {
          companyId: ORG,
          userId: OWNER,
          reservationId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("getConsumable dan consume: gudang salah, nonaktif, kedaluwarsa, dan partial", async () => {
    const active = await withCompany(ORG, (tx) =>
      createReservation(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        qty: 3,
        date: "2026-04-03",
      }),
    );
    const expired = await withCompany(ORG, (tx) =>
      createReservation(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        qty: 1,
        date: "2026-04-03",
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    const released = await withCompany(ORG, (tx) =>
      createReservation(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: whA,
        productId,
        qty: 1,
        date: "2026-04-03",
      }),
    );
    await withCompany(ORG, async (tx) => {
      await expect(
        getConsumableReservation(tx, {
          companyId: ORG,
          reservationId: crypto.randomUUID(),
          warehouseId: whA,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        getConsumableReservation(tx, {
          companyId: ORG,
          reservationId: active.id,
          warehouseId: whB,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        getConsumableReservation(tx, {
          companyId: ORG,
          reservationId: expired.id,
          warehouseId: whA,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await releaseReservation(tx, { companyId: ORG, userId: OWNER, reservationId: released.id });
      await expect(
        getConsumableReservation(tx, {
          companyId: ORG,
          reservationId: released.id,
          warehouseId: whA,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const consumed = await consumeReservationForSale(tx, {
        companyId: ORG,
        userId: OWNER,
        reservationId: active.id,
        soldQtyByProduct: new Map([[productId, d(2)]]),
      });
      expect(consumed.consumedQty.toNumber()).toBe(2);
      expect(consumed.fulfilled).toBe(false);
      const none = await consumeReservationForSale(tx, {
        companyId: ORG,
        userId: OWNER,
        reservationId: crypto.randomUUID(),
        soldQtyByProduct: new Map([[productId, d(1)]]),
      });
      expect(none.consumedQty.toNumber()).toBe(0);
      const zero = await consumeReservationForSale(tx, {
        companyId: ORG,
        userId: OWNER,
        reservationId: active.id,
        soldQtyByProduct: new Map(),
      });
      expect(zero.consumedQty.toNumber()).toBe(0);
      const final = await consumeReservationForSale(tx, {
        companyId: ORG,
        userId: OWNER,
        reservationId: active.id,
        soldQtyByProduct: new Map([[productId, d(5)]]),
      });
      expect(final.consumedQty.toNumber()).toBe(1);
      expect(final.fulfilled).toBe(true);
      await releaseReservation(tx, { companyId: ORG, userId: OWNER, reservationId: expired.id });
    });
  });

  it("daftar reservasi: filter, pagination, dan ringkasan", async () => {
    await withCompany(ORG, async (tx) => {
      const empty = await listReservationsPage(tx, ORG, {});
      expect(empty.total).toBeGreaterThanOrEqual(0);
      const filtered = await listReservationsPage(tx, ORG, {
        q: "tidak-ada",
        page: 0,
        pageSize: 5000,
      });
      expect(filtered.page).toBe(1);
      expect(filtered.pageSize).toBe(200);
      expect(filtered.rows).toEqual([]);
      const summary = await countReservationsSummary(tx, ORG);
      expect(summary.total).toBeGreaterThanOrEqual(0);
      const future = await countReservationsSummary(tx, ORG, new Date("2099-01-01"));
      expect(future.active).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Cabang validasi penerimaan transfer", () => {
  it("menolak dokumen hilang, bukan transfer, status salah, dan tanpa gudang tujuan", async () => {
    await withCompany(ORG, async (tx) => {
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: crypto.randomUUID(),
          date: "2026-04-10",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const [nonTransfer] = await tx
        .insert(stockDocuments)
        .values({
          companyId: ORG,
          type: "adjustment",
          number: `ADJ-${crypto.randomUUID().slice(0, 8)}`,
          date: "2026-04-10",
          warehouseId: whA,
          status: "in_transit",
        })
        .returning({ id: stockDocuments.id });
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: nonTransfer.id,
          date: "2026-04-10",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const [posted] = await tx
        .insert(stockDocuments)
        .values({
          companyId: ORG,
          type: "transfer",
          number: `TRF-${crypto.randomUUID().slice(0, 8)}`,
          date: "2026-04-10",
          warehouseId: whA,
          toWarehouseId: whB,
          status: "posted",
        })
        .returning({ id: stockDocuments.id });
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: posted.id,
          date: "2026-04-10",
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      const [noDestination] = await tx
        .insert(stockDocuments)
        .values({
          companyId: ORG,
          type: "transfer",
          number: `TRF-${crypto.randomUUID().slice(0, 8)}`,
          date: "2026-04-10",
          warehouseId: whA,
          status: "in_transit",
        })
        .returning({ id: stockDocuments.id });
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: noDestination.id,
          date: "2026-04-10",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  it("penerimaan sebagian, qty tidak valid, dan penutupan selisih", async () => {
    await withCompany(ORG, (tx) =>
      applyStockMovement(tx, {
        companyId: ORG,
        warehouseId: whA,
        productId,
        delta: 50,
        unitCost: "10000",
        movementType: "purchase",
        referenceType: "opening",
        userId: OWNER,
      }),
    );
    const doc = await withCompany(ORG, (tx) =>
      createTransfer(tx, {
        companyId: ORG,
        userId: OWNER,
        fromWarehouseId: whA,
        toWarehouseId: whB,
        date: "2026-04-11",
        lines: [{ productId, qty: 5 }],
      }),
    );
    await withCompany(ORG, async (tx) => {
      const dup = await receiveTransfer(tx, {
        companyId: ORG,
        userId: OWNER,
        documentId: doc.id,
        date: "2026-04-12",
        lines: [
          { productId, receivedQty: 1 },
          { productId, receivedQty: 1 },
        ],
      }).catch((error) => error);
      expect(dup).toMatchObject({ code: "VALIDATION" });

      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: doc.id,
          date: "2026-04-12",
          lines: [{ productId, receivedQty: -1 }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: doc.id,
          date: "2026-04-12",
          lines: [{ productId, receivedQty: 99 }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: doc.id,
          date: "2026-04-12",
          lines: [{ productId: crypto.randomUUID(), receivedQty: 1 }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: doc.id,
          date: "2026-04-12",
          lines: [{ productId, receivedQty: 0 }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          userRole: "warehouse",
          documentId: doc.id,
          date: "2026-04-12",
          lines: [{ productId, receivedQty: 2 }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const partial = await receiveTransfer(tx, {
        companyId: ORG,
        userId: OWNER,
        userRole: "owner",
        documentId: doc.id,
        date: "2026-04-12",
        lines: [{ productId, receivedQty: 2 }],
      });
      expect(partial.status).toBe("in_transit");

      await expect(
        receiveTransfer(tx, {
          companyId: ORG,
          userId: OWNER,
          documentId: doc.id,
          date: "2026-04-13",
          lines: [{ productId, receivedQty: 1 }],
          closeRemainder: true,
          differenceReason: "   ",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const closed = await receiveTransfer(tx, {
        companyId: ORG,
        userId: OWNER,
        userRole: "owner",
        documentId: doc.id,
        date: "2026-04-13",
        lines: [{ productId, receivedQty: 1 }],
        closeRemainder: true,
        differenceReason: "Hilang di jalan",
      });
      expect(closed.status).toBe("posted");
    });
  });
});
