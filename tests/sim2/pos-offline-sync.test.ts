import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  member,
  organization,
  outbox,
  paymentMethods,
  products,
  sales,
  stockOnHand,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { applyStockMovement } from "@/server/inventory";
import { openCashSession } from "@/server/pos";
import {
  assertOfflineEnabled,
  listOfflineReviewQueue,
  processOfflineSaleItem,
  resolveOfflineOutboxItem,
} from "@/server/pos-offline";
import type { OfflineSalePayload } from "@/lib/pos-offline";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-2 Batch 6 — Sinkronisasi offline POS (§12).
 *
 * Batch berisi transaksi valid + duplikat + konflik stok + gagal:
 * hasil per item tepat, penjualan tidak dobel, konflik masuk daftar
 * peninjauan (outbox processed_at NULL) dan dapat diselesaikan.
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

const ORG = "01900000-0000-7000-8000-00000000e806";
const OWNER = "01900000-0000-7000-8000-00000000e858";


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

const acc: Record<string, string> = {};
let whId = "";
let productId = "";
let methodId = "";

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(user).values({ id: OWNER, name: "Pemilik Uji", email: "owner-e806@bisa.id", emailVerified: true, role: "owner" });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji Offline", slug: "uji-offline", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Offline", roundingMode: "none", taxRate: "0", taxEnabled: false,
    allowNegativeStock: false, posOfflineEnabled: true,
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
    { companyId: ORG, key: "rounding_gain", accountId: acc["9000"] },
    { companyId: ORG, key: "rounding_loss", accountId: acc["9001"] },
  ]);
  const [cash] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: acc["1000"], sortOrder: 1 })
    .returning();
  methodId = cash.id;
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-A", name: "Gudang A", type: "warehouse", isDefault: true })
    .returning();
  whId = wh.id;
  const [product] = await adminDb
    .insert(products)
    .values({ companyId: ORG, sku: "OFF-1", name: "Produk Offline", salePrice: "15000", costPrice: "10000", trackStock: true })
    .returning();
  productId = product.id;
  state.org = ORG;
  state.user = OWNER;
  await withCompany(ORG, async (tx) => {
    await openCashSession(tx, { companyId: ORG, userId: OWNER, openingCash: 0 });
    await applyStockMovement(tx, {
      companyId: ORG, warehouseId: whId, productId, delta: 5, unitCost: "10000",
      movementType: "purchase", referenceType: "opening", userId: OWNER,
    });
  });
}

function item(clientKey: string, qty: number, paymentMethodId = methodId): OfflineSalePayload {
  return {
    clientKey,
    warehouseId: whId,
    date: "2026-05-02",
    lines: [{ productId, qty }],
    payments: [{ methodId: paymentMethodId, amount: qty * 15000, tendered: qty * 15000 }],
    queuedAt: "2026-05-02T03:00:00.000Z",
  };
}

async function process(payload: OfflineSalePayload) {
  return withCompany(ORG, (tx) =>
    processOfflineSaleItem(tx, { companyId: ORG, userId: OWNER, item: payload }),
  );
}

async function onHand(): Promise<number> {
  const [row] = await adminDb
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(and(eq(stockOnHand.companyId, ORG), eq(stockOnHand.productId, productId)));
  return row ? Number(row.qty) : 0;
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("Sinkronisasi offline POS", () => {
  it("batch valid + duplikat + konflik + gagal menghasilkan status per item yang tepat", async () => {
    const valid = await process(item("client-key-1", 2));
    expect(valid.status).toBe("synced");
    expect(valid.saleNumber).toBeTruthy();

    const duplicate = await process(item("client-key-1", 2));
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.saleId).toBe(valid.saleId);

    const conflict = await process(item("client-key-2", 99));
    expect(conflict.status).toBe("conflict");
    expect(conflict.message).toBeTruthy();

    const failed = await process(item("client-key-3", 1, "01900000-0000-7000-8000-00000000ffff"));
    expect(failed.status).toBe("failed");

    // Hanya penjualan valid yang tercatat; stok berkurang tepat 2.
    const allSales = await adminDb.select().from(sales).where(eq(sales.companyId, ORG));
    expect(allSales).toHaveLength(1);
    expect(await onHand()).toBe(3);
  });

  it("konflik & gagal masuk daftar peninjauan; selesai menandainya tuntas", async () => {
    const queue = await withCompany(ORG, (tx) => listOfflineReviewQueue(tx, ORG));
    expect(queue).toHaveLength(2);
    expect(queue.map((row) => row.payload.status).sort()).toEqual(["conflict", "failed"]);

    const pendingRows = await adminDb
      .select()
      .from(outbox)
      .where(and(eq(outbox.companyId, ORG), isNull(outbox.processedAt)));
    expect(pendingRows).toHaveLength(2);
    const doneRows = await adminDb
      .select()
      .from(outbox)
      .where(eq(outbox.companyId, ORG));
    expect(doneRows).toHaveLength(4);

    const conflictRow = queue.find((row) => row.payload.status === "conflict")!;
    const resolved = await withCompany(ORG, (tx) =>
      resolveOfflineOutboxItem(tx, {
        companyId: ORG,
        userId: OWNER,
        outboxId: conflictRow.id,
        resolution: "discarded",
        note: "Stok memang habis; penjualan dibatalkan dengan persetujuan pelanggan.",
      }),
    );
    expect(resolved.processedAt).toBeTruthy();
    const after = await withCompany(ORG, (tx) => listOfflineReviewQueue(tx, ORG));
    expect(after).toHaveLength(1);
  });

  it("saklar mati: sinkronisasi ditolak di gerbang domain", async () => {
    await adminDb
      .update(companySettings)
      .set({ posOfflineEnabled: false })
      .where(eq(companySettings.companyId, ORG));
    await expect(withCompany(ORG, (tx) => assertOfflineEnabled(tx, ORG))).rejects.toThrow();
    await adminDb
      .update(companySettings)
      .set({ posOfflineEnabled: true })
      .where(eq(companySettings.companyId, ORG));
    await expect(withCompany(ORG, (tx) => assertOfflineEnabled(tx, ORG))).resolves.toBeUndefined();
  });
});
