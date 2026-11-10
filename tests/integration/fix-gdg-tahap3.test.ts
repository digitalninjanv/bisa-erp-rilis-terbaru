import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminDb } from "@/db/admin";
import {
  accountMappings,
  accounts,
  auditLog,
  companySettings,
  journalEntries,
  products,
  stockDocuments,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  applyStockMovement,
  approveStockAdjustment,
  createAdjustment,
} from "@/server/inventory";
import { saveProductAction } from "@/server/actions/inventory/produk";

// =====================================================================
// FIX-GDG TAHAP 3 — Izin & kebijakan (GDG3-10, GDG3-11).
// Perusahaan fixture KHUSUS berkas ini; demo tidak disentuh.
//  - GDG3-11 diuji di LAPISAN AKSI dengan sesi mock dinamis yang
//    izinnya diambil dari katalog peran bawaan SUNGGUHAN
//    (permissionsFor) — bukan daftar izin karangan berkas ini — agar
//    yang terbukti adalah seed peran proyek itu sendiri.
//  - GDG3-10 diuji di lapisan domain dalam transaksi rollback pada
//    perusahaan fixture yang baris pengaturannya dibuat di dalam
//    transaksi yang sama (insert tanpa ambang = perusahaan baru;
//    insert ambang null eksplisit = perusahaan warisan).
// =====================================================================

const state = vi.hoisted(() => ({
  role: "owner" as string,
  userId: "01900000-0000-7000-8000-00000000f851",
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const perms = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  const { AppError: MockAppError } = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  const build = (permission?: string) => async () => {
    const permissions = perms.permissionsFor(state.role);
    if (permission && !permissions.includes(permission as never)) {
      throw new MockAppError("FORBIDDEN", `Izin ${permission} diperlukan untuk tindakan ini.`);
    }
    return {
      company: { id: ORG_ACT },
      user: { id: state.userId },
      role: state.role,
      permissions,
      modules: perms.modulesFor(state.role),
    };
  };
  return {
    requirePermission: (permission: string) => build(permission)(),
    requirePermissionInModule: (permission: string) => build(permission)(),
    requireAuth: () => build()(),
  };
});

const ORG_ACT = "01900000-0000-7000-8000-00000000f801";
const ORG_DOM = "01900000-0000-7000-8000-00000000f802";
const MAKER = "01900000-0000-7000-8000-00000000f861";
const CHECKER = "01900000-0000-7000-8000-00000000f862";
const suffix = crypto.randomUUID().slice(0, 8);
const today = todayISO();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class Rollback extends Error {}

async function rollbackOrgTx<T>(org: string, fn: (tx: Tx) => Promise<T>) {
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${org}, true)`);
      value = await fn(tx);
      throw new Rollback("rollback test transaction");
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return value as T;
}

/* ------------------------------------------------------------------ */
/* GDG3-11 — gerbang harga di lapisan aksi                             */
/* ------------------------------------------------------------------ */

let priceProductId = "";

beforeAll(async () => {
  const [product] = await adminDb
    .insert(products)
    .values({
      companyId: ORG_ACT,
      sku: `T3-HARGA-${suffix}`,
      name: `Produk Uji Harga ${suffix}`,
      costPrice: "8000",
      salePrice: "10000",
      minStock: "5",
      trackStock: true,
    })
    .returning({ id: products.id });
  priceProductId = product.id;
});

async function readPriceProduct() {
  return withCompanyReadOnly(ORG_ACT, async (tx) => {
    const [row] = await tx
      .select({
        name: products.name,
        costPrice: products.costPrice,
        salePrice: products.salePrice,
        minStock: products.minStock,
      })
      .from(products)
      .where(and(eq(products.companyId, ORG_ACT), eq(products.id, priceProductId)))
      .limit(1);
    return row;
  });
}

describe("GDG3-11 — harga produk bukan hak gudang generik (lapisan aksi)", () => {
  it("warehouse mengubah nama & stok minimum (bukan harga): berhasil", async () => {
    state.role = "warehouse";
    const before = await readPriceProduct();
    const result = await saveProductAction({
      id: priceProductId,
      name: `${before.name} (revisi gudang)`,
      sku: `T3-HARGA-${suffix}`,
      costPrice: before.costPrice,
      salePrice: before.salePrice,
      minStock: "9",
    });
    expect(result.ok).toBe(true);
    const after = await readPriceProduct();
    expect(after.minStock).toBe("9.0000");
    expect(after.salePrice).toBe(before.salePrice);
    expect(after.costPrice).toBe(before.costPrice);
  });

  it("warehouse mengubah harga jual: ditolak FORBIDDEN dan harga tidak bergerak", async () => {
    state.role = "warehouse";
    const before = await readPriceProduct();
    const result = await saveProductAction({
      id: priceProductId,
      name: before.name,
      sku: `T3-HARGA-${suffix}`,
      costPrice: before.costPrice,
      salePrice: "777000",
      minStock: before.minStock,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    const after = await readPriceProduct();
    expect(after.salePrice).toBe(before.salePrice);
  });

  it("warehouse mengubah harga pokok master: ditolak FORBIDDEN dan harga tidak bergerak", async () => {
    state.role = "warehouse";
    const before = await readPriceProduct();
    const result = await saveProductAction({
      id: priceProductId,
      name: before.name,
      sku: `T3-HARGA-${suffix}`,
      costPrice: "1",
      salePrice: before.salePrice,
      minStock: before.minStock,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    const after = await readPriceProduct();
    expect(after.costPrice).toBe(before.costPrice);
  });

  it("manager mengubah harga jual: berhasil dan audit mencatat harga lama → baru", async () => {
    state.role = "manager";
    const before = await readPriceProduct();
    const result = await saveProductAction({
      id: priceProductId,
      name: before.name,
      sku: `T3-HARGA-${suffix}`,
      costPrice: before.costPrice,
      salePrice: "12500",
      minStock: before.minStock,
    });
    expect(result.ok).toBe(true);
    const after = await readPriceProduct();
    expect(after.salePrice).toBe("12500.0000");

    const audits = await withCompanyReadOnly(ORG_ACT, async (tx) =>
      tx
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ACT),
            eq(auditLog.action, "product.update"),
            eq(auditLog.entityId, priceProductId),
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1),
    );
    expect(audits).toHaveLength(1);
    const beforeJson = audits[0].before as { salePrice?: string } | null;
    const afterJson = audits[0].after as { salePrice?: string } | null;
    expect(beforeJson?.salePrice).toBe(before.salePrice);
    expect(afterJson?.salePrice).toBe("12500.0000");
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-10 — bawaan ambang persetujuan penyesuaian                     */
/* ------------------------------------------------------------------ */

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1200", "Persediaan", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["3000", "Modal", "equity", "credit"],
  ["6020", "Selisih Stok", "expense", "debit"],
  ["6030", "Barang Rusak", "expense", "debit"],
  ["9000", "Laba Pembulatan", "revenue", "credit"],
  ["9001", "Rugi Pembulatan", "expense", "debit"],
];

const MAPPING_SEEDS: Record<string, string> = {
  cash: "1000",
  inventory: "1200",
  payable: "2000",
  equity: "3000",
  inventory_shrink: "6020",
  damaged: "6030",
  rounding_gain: "9000",
  rounding_loss: "9001",
};

/**
 * Bangun perusahaan fixture minimum di dalam transaksi berjalan.
 * `threshold`: "omit" = kolom tidak dikirim (perusahaan baru — bawaan
 * DB berlaku); null = dikirim null secara eksplisit (perusahaan
 * warisan yang barisnya sudah ada sebelum bawaan diperkenalkan).
 */
async function seedDomainCompany(
  tx: Tx,
  threshold: "omit" | null | string,
): Promise<{ warehouseId: string }> {
  await tx.insert(companySettings).values({
    companyId: ORG_DOM,
    legalName: "Perusahaan Uji Tahap 3 GDG",
    allowNegativeStock: false,
    taxRate: "0",
    ...(threshold === "omit" ? {} : { adjustmentApprovalThreshold: threshold }),
  });
  const accountRows = await tx
    .insert(accounts)
    .values(
      ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
        companyId: ORG_DOM,
        code,
        name,
        type,
        normalBalance,
      })),
    )
    .returning({ id: accounts.id, code: accounts.code });
  const byCode = new Map(accountRows.map((row) => [row.code, row.id]));
  await tx.insert(accountMappings).values(
    Object.entries(MAPPING_SEEDS).map(([key, code]) => ({
      companyId: ORG_DOM,
      key,
      accountId: byCode.get(code)!,
    })),
  );
  const [warehouse] = await tx
    .insert(warehouses)
    .values({ companyId: ORG_DOM, code: "GD-T3", name: "Gudang Tahap 3", isDefault: true })
    .returning({ id: warehouses.id });
  return { warehouseId: warehouse.id };
}

async function stockedProduct(tx: Tx, warehouseId: string, cost: string, qty: number, sku: string) {
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_DOM,
      sku,
      name: `Produk Uji Ambang ${sku}`,
      costPrice: cost,
      salePrice: cost,
      trackStock: true,
    })
    .returning({ id: products.id });
  await applyStockMovement(tx, {
    companyId: ORG_DOM,
    warehouseId,
    productId: product.id,
    delta: qty,
    unitCost: cost,
    movementType: "opening",
    userId: MAKER,
  });
  return product;
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG_DOM),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    )
    .limit(1);
  return d(row?.qty ?? 0);
}

async function journalCountFor(tx: Tx, docId: string) {
  const rows = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_DOM),
        eq(journalEntries.sourceType, "adjustment"),
        eq(journalEntries.sourceId, docId),
      ),
    );
  return rows.length;
}

describe("GDG3-10 — perusahaan baru berambang aktif; perusahaan warisan tidak diubah diam-diam", () => {
  it("baris pengaturan baru (tanpa ambang dikirim) menerima bawaan Rp1.000.000 dari basis data", async () => {
    const threshold = await rollbackOrgTx(ORG_DOM, async (tx) => {
      await seedDomainCompany(tx, "omit");
      const [settings] = await tx
        .select({ threshold: companySettings.adjustmentApprovalThreshold })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_DOM))
        .limit(1);
      return settings?.threshold ?? null;
    });
    expect(threshold).not.toBeNull();
    expect(d(threshold!).toFixed(4)).toBe("1000000.0000");
  });

  it("perusahaan baru: penghapusan Rp2 jt menunggu checker; di bawah ambang langsung posted; self-approve ditolak", async () => {
    await rollbackOrgTx(ORG_DOM, async (tx) => {
      const { warehouseId } = await seedDomainCompany(tx, "omit");
      const product = await stockedProduct(tx, warehouseId, "1000000", 10, `T3-AMB-A-${suffix}`);

      // Dampak 2 × Rp1.000.000 = Rp2.000.000 > bawaan Rp1.000.000.
      const big = await createAdjustment(tx, {
        companyId: ORG_DOM,
        userId: MAKER,
        warehouseId,
        date: today,
        type: "damaged",
        reason: "Barang rusak uji ambang bawaan",
        lines: [{ productId: product.id, qty: 2 }],
      });
      expect(big.status).toBe("pending");
      expect((await stockQty(tx, warehouseId, product.id)).toFixed(4)).toBe("10.0000");
      expect(await journalCountFor(tx, big.id)).toBe(0);

      await expect(
        approveStockAdjustment(tx, { companyId: ORG_DOM, userId: MAKER, documentId: big.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const approved = await approveStockAdjustment(tx, {
        companyId: ORG_DOM,
        userId: CHECKER,
        documentId: big.id,
      });
      expect(approved.status).toBe("posted");
      expect((await stockQty(tx, warehouseId, product.id)).toFixed(4)).toBe("8.0000");
      expect(await journalCountFor(tx, big.id)).toBe(1);

      // Di bawah ambang: 0 baris dampak besar — koreksi kecil 0 unit
      // tidak relevan; pakai produk kedua berharga Rp500.000, rusak 1.
      const cheap = await stockedProduct(tx, warehouseId, "500000", 4, `T3-AMB-B-${suffix}`);
      const small = await createAdjustment(tx, {
        companyId: ORG_DOM,
        userId: MAKER,
        warehouseId,
        date: today,
        type: "damaged",
        reason: "Pecah satu kemasan",
        lines: [{ productId: cheap.id, qty: 1 }],
      });
      expect(small.status).toBe("posted");
      expect((await stockQty(tx, warehouseId, cheap.id)).toFixed(4)).toBe("3.0000");
    });
  });

  it("perusahaan warisan (ambang null eksplisit): penghapusan Rp50 jt tetap langsung posted — perilaku lama tidak diubah migrasi", async () => {
    await rollbackOrgTx(ORG_DOM, async (tx) => {
      const { warehouseId } = await seedDomainCompany(tx, null);
      const [settings] = await tx
        .select({ threshold: companySettings.adjustmentApprovalThreshold })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_DOM))
        .limit(1);
      expect(settings?.threshold ?? null).toBeNull();

      const product = await stockedProduct(tx, warehouseId, "1000000", 60, `T3-AMB-C-${suffix}`);
      const doc = await createAdjustment(tx, {
        companyId: ORG_DOM,
        userId: MAKER,
        warehouseId,
        date: today,
        type: "damaged",
        reason: "Rusak massal uji warisan",
        lines: [{ productId: product.id, qty: 50 }],
      });
      expect(doc.status).toBe("posted");
      expect((await stockQty(tx, warehouseId, product.id)).toFixed(4)).toBe("10.0000");
      expect(await journalCountFor(tx, doc.id)).toBe(1);
      const [stored] = await tx
        .select({ status: stockDocuments.status })
        .from(stockDocuments)
        .where(and(eq(stockDocuments.companyId, ORG_DOM), eq(stockDocuments.id, doc.id)))
        .limit(1);
      expect(stored.status).toBe("posted");
    });
  });
});
