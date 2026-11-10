import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  auditLog,
  cashMovements,
  cashSessions,
  companySettings,
  customers,
  fiscalPeriods,
  journalEntries,
  journalLines,
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
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { applyStockMovement } from "@/server/inventory";
import { closeCashSession, openCashSession } from "@/server/pos";
import { listOfflineReviewQueue, processOfflineSaleItem } from "@/server/pos-offline";
import {
  postOfflineReviewItemAction,
  resolveOfflineOutboxAction,
  syncOfflineSalesAction,
} from "@/server/actions/pos-offline";
import type { OfflineSalePayload } from "@/lib/pos-offline";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// FIX-POS TAHAP 2 — Offline & sinkronisasi (POS3-01..06, POS3-17,
// POS1-04). Perusahaan fixture khusus f201; demo tidak disentuh.
// Sesi kasir & penjualan di-commit (bukan rollback) karena alur
// sinkronisasi memang lintas-transaksi; fixture dibersihkan di
// afterAll. Urutan describe bersifat sekuensial (sesi dibuka/ditutup
// per blok) — jangan dijalankan paralel di dalam berkas ini.
// =====================================================================

const state = vi.hoisted(() => ({
  userId: "",
  permissions: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const build = (permission?: string) => async () => {
    if (permission && !state.permissions.includes(permission)) {
      throw new AppError("FORBIDDEN", `Izin ${permission} diperlukan untuk tindakan ini.`);
    }
    return {
      company: { id: "01900000-0000-7000-8000-00000000f201" },
      user: { id: state.userId },
      permissions: state.permissions,
      role: "manager",
    };
  };
  return {
    requirePermission: (permission: string) => build(permission)(),
    requirePermissionInModule: (permission: string) => build(permission)(),
    requireAuth: () => build()(),
  };
});

const ORG = "01900000-0000-7000-8000-00000000f201";
const OWNER = "01900000-0000-7000-8000-00000000f251";
const MANAGER = "01900000-0000-7000-8000-00000000f252";
const CASHIER = "01900000-0000-7000-8000-00000000f253";
const CASHIER2 = "01900000-0000-7000-8000-00000000f254";
const VIEWERU = "01900000-0000-7000-8000-00000000f255";
const GHOST = "01900000-0000-7000-8000-00000000f256";

const MANAGER_PERMS = ["pos.sell", "pos.discount", "pos.void", "pos.return", "pos.session"];
const CASHIER_PERMS = ["pos.sell", "pos.session"];

const USER_IDS = [OWNER, MANAGER, CASHIER, CASHIER2, VIEWERU, GHOST];

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, USER_IDS);
}

const acc: Record<string, string> = {};
let whId = "";
let cashMethodId = "";
let creditMethodId = "";

async function bootstrap() {
  await wipeFixture();
  const people: Array<[string, string, string | null]> = [
    [OWNER, "Pemilik T2", "owner"],
    [MANAGER, "Manajer T2", "manager"],
    [CASHIER, "Kasir T2", "cashier"],
    [CASHIER2, "Kasir Dua T2", "cashier"],
    [VIEWERU, "Penonton T2", "viewer"],
    [GHOST, "Hantu T2", null],
  ];
  for (const [id, name] of people) {
    await adminDb.insert(user).values({
      id, name, email: `${id.slice(-4)}@bisa.id`, emailVerified: true, role: "user",
    });
    await adminDb.insert(account).values({
      id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id,
    });
  }
  await adminDb.insert(organization).values({
    id: ORG, name: "PT Uji Offline T2", slug: "uji-offline-t2", createdAt: new Date(),
  });
  for (const [id, , role] of people) {
    if (!role) continue;
    await adminDb.insert(member).values({
      id: crypto.randomUUID(), organizationId: ORG, userId: id, role, createdAt: new Date(),
    });
  }
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Offline T2", roundingMode: "none",
    taxRate: "0", taxEnabled: false, allowNegativeStock: false, posOfflineEnabled: true,
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1300", name: "Persediaan Barang", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "4020", name: "Retur Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
      { companyId: ORG, code: "8000", name: "Selisih Kas Kurang", type: "expense", normalBalance: "debit" },
      { companyId: ORG, code: "8001", name: "Selisih Kas Lebih", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "9000", name: "Pembulatan Penjualan (Laba)", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "9001", name: "Selisih Pembulatan (Rugi)", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  for (const row of rows) acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "receivable", accountId: acc["1200"] },
    { companyId: ORG, key: "inventory", accountId: acc["1300"] },
    { companyId: ORG, key: "equity", accountId: acc["3000"] },
    { companyId: ORG, key: "revenue", accountId: acc["4000"] },
    { companyId: ORG, key: "sales_discount", accountId: acc["4010"] },
    { companyId: ORG, key: "sales_return", accountId: acc["4020"] },
    { companyId: ORG, key: "cogs", accountId: acc["5000"] },
    { companyId: ORG, key: "cash_short", accountId: acc["8000"] },
    { companyId: ORG, key: "cash_over", accountId: acc["8001"] },
    { companyId: ORG, key: "rounding_gain", accountId: acc["9000"] },
    { companyId: ORG, key: "rounding_loss", accountId: acc["9001"] },
  ]);
  const [cash] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: acc["1000"], sortOrder: 1 })
    .returning();
  cashMethodId = cash.id;
  const [credit] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CREDIT", name: "Utang", type: "credit", accountId: acc["1200"], sortOrder: 2 })
    .returning();
  creditMethodId = credit.id;
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-T2", name: "Gudang T2", type: "warehouse", isDefault: true })
    .returning();
  whId = wh.id;
}

let skuCounter = 0;
async function makeProduct(price: string, cost: string, stock: number): Promise<string> {
  skuCounter += 1;
  const [p] = await adminDb
    .insert(products)
    .values({
      companyId: ORG, sku: `T2-${Date.now()}-${skuCounter}`, name: `Produk T2 ${skuCounter}`,
      salePrice: price, costPrice: cost, trackStock: true,
    })
    .returning({ id: products.id });
  if (stock > 0) {
    await withCompany(ORG, (tx) =>
      applyStockMovement(tx, {
        companyId: ORG, warehouseId: whId, productId: p.id, delta: stock,
        unitCost: cost, movementType: "purchase", referenceType: "opening", userId: OWNER,
      }),
    );
  }
  return p.id;
}

async function openSession(userId: string): Promise<string> {
  const session = await withCompany(ORG, (tx) =>
    openCashSession(tx, { companyId: ORG, userId, openingCash: 0 }),
  );
  return session.id;
}

async function closeSession(userId: string, sessionId: string, countedCash: number, differenceReason?: string) {
  return withCompany(ORG, (tx) =>
    closeCashSession(tx, { companyId: ORG, userId, sessionId, countedCash, differenceReason }),
  );
}

async function glNet(code: string): Promise<number> {
  const rows = await adminDb
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.status, "posted"),
        eq(journalLines.accountId, acc[code]),
      ),
    );
  return rows.reduce((sum, r) => sum.plus(d(r.debit)).minus(d(r.credit)), d(0)).toNumber();
}

async function saleByKey(clientKey: string) {
  const [row] = await adminDb
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, ORG), eq(sales.idempotencyKey, clientKey)));
  return row ?? null;
}

async function pendingRowsFor(clientKey: string) {
  const rows = await adminDb
    .select()
    .from(outbox)
    .where(and(eq(outbox.companyId, ORG), isNull(outbox.processedAt)));
  return rows.filter(
    (row) => (row.payload as { clientKey?: string }).clientKey === clientKey,
  );
}

async function sessionMovements(sessionId: string) {
  return adminDb
    .select({ type: cashMovements.type, amount: cashMovements.amount, createdBy: cashMovements.createdBy })
    .from(cashMovements)
    .where(and(eq(cashMovements.companyId, ORG), eq(cashMovements.sessionId, sessionId)));
}

function setActor(userId: string, permissions: string[]) {
  state.userId = userId;
  state.permissions = permissions;
}

const TODAY = todayISO();

beforeAll(bootstrap);
afterAll(wipeFixture);

// =====================================================================
// POS3-01 — Antrean > 50 tersinkron lewat pengiriman ber-chunk
// =====================================================================
describe("POS3-01 antrean besar ber-chunk", () => {
  it("60 item dalam 3 potong (25/25/10) terproses semua; 1 item rusak tidak menggugurkan batch", async () => {
    const productId = await makeProduct("1000", "600", 100);
    await openSession(OWNER);
    setActor(OWNER, MANAGER_PERMS);
    const items: OfflineSalePayload[] = Array.from({ length: 60 }, (_, i) => ({
      clientKey: `t2-chunk-${i + 1}`,
      warehouseId: whId,
      date: TODAY,
      lines: [{ productId, qty: 1 }],
      payments: [
        {
          methodId: i === 29 ? "01900000-0000-7000-8000-00000000ffff" : cashMethodId,
          amount: 1000,
          tendered: 1000,
        },
      ],
      queuedAt: new Date().toISOString(),
    }));
    const all: Array<{ status: string }> = [];
    for (let i = 0; i < items.length; i += 25) {
      const res = await syncOfflineSalesAction({ items: items.slice(i, i + 25) });
      expect(res.ok).toBe(true);
      if (res.ok) all.push(...res.data);
    }
    expect(all).toHaveLength(60);
    expect(all.filter((r) => r.status === "synced")).toHaveLength(59);
    expect(all.filter((r) => r.status === "failed")).toHaveLength(1);
    const sold = await adminDb
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.companyId, ORG));
    expect(sold.length).toBeGreaterThanOrEqual(59);
    const [stock] = await adminDb
      .select({ qty: stockOnHand.qty })
      .from(stockOnHand)
      .where(and(eq(stockOnHand.companyId, ORG), eq(stockOnHand.productId, productId)));
    expect(d(stock.qty).toNumber()).toBe(41);
  });

  it("satu panggilan berisi 51 item ditolak skema (plafon per panggilan tetap 50)", async () => {
    setActor(OWNER, MANAGER_PERMS);
    const productId = await makeProduct("1000", "600", 5);
    const items: OfflineSalePayload[] = Array.from({ length: 51 }, (_, i) => ({
      clientKey: `t2-cap-${i + 1}`,
      warehouseId: whId,
      date: TODAY,
      lines: [{ productId, qty: 1 }],
      payments: [{ methodId: cashMethodId, amount: 1000, tendered: 1000 }],
      queuedAt: new Date().toISOString(),
    }));
    const res = await syncOfflineSalesAction({ items });
    expect(res.ok).toBe(false);
  });
});

// =====================================================================
// POS3-02 — Identitas asal: kasir & sesi asal, hak dinilai dari asal
// =====================================================================
describe("POS3-02 identitas asal terbawa", () => {
  let sessionCashier = "";
  let productId = "";

  beforeAll(async () => {
    productId = await makeProduct("20000", "12000", 20);
    sessionCashier = await openSession(CASHIER);
  });

  it("penjualan kasir yang disinkron manajer tercatat atas nama kasir & sesi kasir", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    const res = await syncOfflineSalesAction({
      items: [
        {
          clientKey: "t2-attr-1",
          warehouseId: whId,
          cashierId: CASHIER,
          originSessionId: sessionCashier,
          date: TODAY,
          lines: [{ productId, qty: 1, unitPrice: 20000 }],
          payments: [{ methodId: cashMethodId, amount: 20000, tendered: 20000 }],
          expectedTotal: 20000,
          queuedAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data[0].status).toBe("synced");
    const sale = await saleByKey("t2-attr-1");
    expect(sale).not.toBeNull();
    expect(sale!.cashierId).toBe(CASHIER);
    expect(sale!.sessionId).toBe(sessionCashier);
    const moves = (await sessionMovements(sessionCashier)).filter((m) => m.type === "sale");
    expect(moves).toHaveLength(1);
    expect(d(moves[0].amount).toNumber()).toBe(20000);
    expect(moves[0].createdBy).toBe(CASHIER);
  });

  it("diskon manual 50% dari kasir tanpa hak diskon ditolak walau penyinkron manajer", async () => {
    const pricey = await makeProduct("100000", "60000", 5);
    setActor(MANAGER, MANAGER_PERMS);
    const res = await syncOfflineSalesAction({
      items: [
        {
          clientKey: "t2-disc-cashier",
          warehouseId: whId,
          cashierId: CASHIER,
          originSessionId: sessionCashier,
          date: TODAY,
          lines: [{ productId: pricey, qty: 1, unitPrice: 100000, discountType: "percent", discountValue: 50 }],
          payments: [{ methodId: cashMethodId, amount: 50000, tendered: 50000 }],
          expectedTotal: 50000,
          queuedAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].status).toBe("failed");
      expect(res.data[0].message ?? "").toContain("ambang");
    }
    expect(await saleByKey("t2-disc-cashier")).toBeNull();
  });

  it("diskon manual 50% dari manajer (berhak) lolos dan tercatat sebagai penjualan manajer", async () => {
    const pricey = await makeProduct("100000", "60000", 5);
    const sessionManager = await openSession(MANAGER);
    setActor(CASHIER, CASHIER_PERMS); // kasir yang menyinkronkan antrean manajer
    const res = await syncOfflineSalesAction({
      items: [
        {
          clientKey: "t2-disc-manager",
          warehouseId: whId,
          cashierId: MANAGER,
          originSessionId: sessionManager,
          date: TODAY,
          lines: [{ productId: pricey, qty: 1, unitPrice: 100000, discountType: "percent", discountValue: 50 }],
          payments: [{ methodId: cashMethodId, amount: 50000, tendered: 50000 }],
          expectedTotal: 50000,
          queuedAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data[0].status).toBe("synced");
    const sale = await saleByKey("t2-disc-manager");
    expect(sale).not.toBeNull();
    expect(sale!.cashierId).toBe(MANAGER);
    expect(d(sale!.total).toNumber()).toBe(50000);
    const closed = await closeSession(MANAGER, sessionManager, 50000);
    expect(closed.difference).toBe(0);
  });

  it("kasir asal bukan anggota perusahaan → peninjauan beralasan, tidak dialihkan ke penyinkron", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    const res = await syncOfflineSalesAction({
      items: [
        {
          clientKey: "t2-ghost-1",
          warehouseId: whId,
          cashierId: GHOST,
          date: TODAY,
          lines: [{ productId, qty: 1, unitPrice: 20000 }],
          payments: [{ methodId: cashMethodId, amount: 20000, tendered: 20000 }],
          expectedTotal: 20000,
          queuedAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].status).toBe("failed");
      expect(res.data[0].kind).toBe("origin_ineligible");
    }
    expect(await saleByKey("t2-ghost-1")).toBeNull();
    const pending = await pendingRowsFor("t2-ghost-1");
    expect(pending).toHaveLength(1);
  });

  it("kasir asal berperan viewer (tanpa pos.sell) → peninjauan beralasan yang sama", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    const res = await syncOfflineSalesAction({
      items: [
        {
          clientKey: "t2-viewer-1",
          warehouseId: whId,
          cashierId: VIEWERU,
          date: TODAY,
          lines: [{ productId, qty: 1, unitPrice: 20000 }],
          payments: [{ methodId: cashMethodId, amount: 20000, tendered: 20000 }],
          expectedTotal: 20000,
          queuedAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].status).toBe("failed");
      expect(res.data[0].kind).toBe("origin_ineligible");
    }
    expect(await saleByKey("t2-viewer-1")).toBeNull();
  });
});

// =====================================================================
// POS3-03 — Sesi asal tertutup: jalur penyelesaian eksplisit dari
// peninjauan, tanpa kas ganda (expectedCash & GL cocok fisik)
// =====================================================================
describe("POS3-03 penyelesaian sesi tertutup", () => {
  it("kas terhitung saat tutup sesi: penyelesaian menyerap selisih kas lebih, GL kas tidak dobel", async () => {
    const productId = await makeProduct("100000", "60000", 5);
    const sessionId = await openSession(CASHIER2);
    const item: OfflineSalePayload = {
      clientKey: "t2-settle-counted",
      warehouseId: whId,
      cashierId: CASHIER2,
      originSessionId: sessionId,
      date: TODAY,
      lines: [{ productId, qty: 1, unitPrice: 100000 }],
      payments: [{ methodId: cashMethodId, amount: 100000, tendered: 100000 }],
      expectedTotal: 100000,
      queuedAt: new Date().toISOString(),
    };
    // Baseline GL sebelum sesi ditutup (blok test sebelumnya sudah
    // memposting jurnal kas lain di perusahaan fixture yang sama).
    const kasBase = await glNet("1000");
    const overBase = await glNet("8001");
    const revenueBase = await glNet("4000");
    // Kasir menutup sesi dan menghitung fisik termasuk uang offline.
    // A-28 Tahap 1 (H-POS-02): selisih +100.000 kini wajib alasan.
    const closed = await closeSession(CASHIER2, sessionId, 100000, "Uang penjualan offline termasuk di laci");
    expect(closed.expected).toBe(0);
    expect(closed.difference).toBe(100000);
    expect((await glNet("1000")) - kasBase).toBe(100000);
    expect((await glNet("8001")) - overBase).toBe(-100000);

    // Sinkronisasi biasa TIDAK boleh memposting ke sesi lain.
    setActor(MANAGER, MANAGER_PERMS);
    const syncRes = await syncOfflineSalesAction({ items: [item] });
    expect(syncRes.ok).toBe(true);
    if (syncRes.ok) {
      expect(syncRes.data[0].status).toBe("failed");
      expect(syncRes.data[0].kind).toBe("session_closed");
    }
    expect(await saleByKey("t2-settle-counted")).toBeNull();

    // Penyelesaian eksplisit dari peninjauan oleh supervisor.
    const queue = await withCompany(ORG, (tx) => listOfflineReviewQueue(tx, ORG));
    const row = queue.find((r) => r.payload.clientKey === "t2-settle-counted");
    expect(row).toBeTruthy();
    const settleRes = await postOfflineReviewItemAction({ outboxId: row!.id, mode: "settle" });
    expect(settleRes.ok).toBe(true);

    const sale = await saleByKey("t2-settle-counted");
    expect(sale).not.toBeNull();
    expect(sale!.cashierId).toBe(CASHIER2);
    expect(sale!.sessionId).toBe(sessionId);
    expect(d(sale!.total).toNumber()).toBe(100000);

    // Angka fisik: GL kas tetap 100.000 di atas baseline (uang yang
    // sama, bukan dobel); selisih kas lebih kembali ke baseline;
    // pendapatan tercatat tepat sekali sebesar penjualan.
    expect((await glNet("1000")) - kasBase).toBe(100000);
    expect((await glNet("8001")) - overBase).toBe(0);
    expect((await glNet("4000")) - revenueBase).toBe(-100000);

    // Sesi tertutup tidak berubah: tanpa mutasi baru, expected tersimpan tetap.
    const moves = await sessionMovements(sessionId);
    expect(moves).toHaveLength(1); // hanya mutasi modal awal
    const [sessionRow] = await adminDb
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, sessionId));
    expect(d(sessionRow.expectedCash ?? "0").toNumber()).toBe(0);
    expect(d(sessionRow.countedCash ?? "0").toNumber()).toBe(100000);
    expect(await pendingRowsFor("t2-settle-counted")).toHaveLength(0);
  });

  it("kas TIDAK terhitung saat tutup sesi: penyelesaian mendebit kas penuh", async () => {
    const productId = await makeProduct("50000", "30000", 5);
    const sessionId = await openSession(CASHIER2);
    const item: OfflineSalePayload = {
      clientKey: "t2-settle-envelope",
      warehouseId: whId,
      cashierId: CASHIER2,
      originSessionId: sessionId,
      date: TODAY,
      lines: [{ productId, qty: 1, unitPrice: 50000 }],
      payments: [{ methodId: cashMethodId, amount: 50000, tendered: 50000 }],
      expectedTotal: 50000,
      queuedAt: new Date().toISOString(),
    };
    const closed = await closeSession(CASHIER2, sessionId, 0);
    expect(closed.difference).toBe(0);
    const kasBefore = await glNet("1000");
    const overBefore = await glNet("8001");

    setActor(MANAGER, MANAGER_PERMS);
    const syncRes = await syncOfflineSalesAction({ items: [item] });
    expect(syncRes.ok).toBe(true);
    if (syncRes.ok) expect(syncRes.data[0].kind).toBe("session_closed");

    const queue = await withCompany(ORG, (tx) => listOfflineReviewQueue(tx, ORG));
    const row = queue.find((r) => r.payload.clientKey === "t2-settle-envelope");
    expect(row).toBeTruthy();
    const settleRes = await postOfflineReviewItemAction({ outboxId: row!.id, mode: "settle" });
    expect(settleRes.ok).toBe(true);

    const sale = await saleByKey("t2-settle-envelope");
    expect(sale).not.toBeNull();
    expect(sale!.sessionId).toBe(sessionId);
    expect((await glNet("1000")) - kasBefore).toBe(50000);
    expect((await glNet("8001")) - overBefore).toBe(0);
    const moves = await sessionMovements(sessionId);
    expect(moves).toHaveLength(1);
  });
});

// =====================================================================
// Alur peninjauan: POS1-04/POS3-04 harga berubah + POS3-05 supersede
// =====================================================================
describe("Peninjauan: konflik harga & kebersihan daftar (POS3-04/05)", () => {
  let sessionId = "";
  let productId = "";

  beforeAll(async () => {
    // Tutup sesi kasir yang mungkin masih terbuka dari blok sebelumnya.
    const [open] = await adminDb
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.companyId, ORG),
          eq(cashSessions.userId, CASHIER),
          eq(cashSessions.status, "open"),
        ),
      );
    if (open) {
      const moves = await sessionMovements(open.id);
      const sum = moves.reduce((s, m) => s + d(m.amount).toNumber(), 0);
      await closeSession(CASHIER, open.id, sum);
    }
    productId = await makeProduct("10000", "6000", 30);
    sessionId = await openSession(CASHIER);
  });

  function priceItem(clientKey: string): OfflineSalePayload {
    return {
      clientKey,
      warehouseId: whId,
      cashierId: CASHIER,
      originSessionId: sessionId,
      date: TODAY,
      lines: [{ productId, qty: 1, unitPrice: 10000 }],
      payments: [{ methodId: cashMethodId, amount: 10000, tendered: 10000 }],
      expectedTotal: 10000,
      queuedAt: new Date().toISOString(),
    };
  }

  async function setPrice(price: string) {
    await adminDb.update(products).set({ salePrice: price }).where(eq(products.id, productId));
  }

  it("harga TURUN: conflict dengan selisih tertera; penyelesaian memposting pada harga struk", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    await setPrice("7500");
    const res = await syncOfflineSalesAction({ items: [priceItem("t2-price-down")] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].status).toBe("conflict");
      expect(res.data[0].kind).toBe("price");
    }
    expect(await saleByKey("t2-price-down")).toBeNull();
    const pending = await pendingRowsFor("t2-price-down");
    expect(pending).toHaveLength(1);
    const payload = pending[0].payload as {
      priceConflict?: { expectedTotal: number; currentTotal: number; difference: number };
    };
    expect(payload.priceConflict).toEqual({
      expectedTotal: 10000,
      currentTotal: 7500,
      difference: -2500,
    });

    const settleRes = await postOfflineReviewItemAction({
      outboxId: pending[0].id,
      mode: "settle",
    });
    expect(settleRes.ok).toBe(true);
    const sale = await saleByKey("t2-price-down");
    expect(sale).not.toBeNull();
    // Harga struk offline adalah kebenaran transaksi: total 10.000,
    // kembalian dihitung dari snapshot (0 — bukan 2.500 semu).
    expect(d(sale!.total).toNumber()).toBe(10000);
    expect(d(sale!.changeTotal).toNumber()).toBe(0);
    expect(sale!.sessionId).toBe(sessionId);
    expect(await pendingRowsFor("t2-price-down")).toHaveLength(0);
  });

  it("harga NAIK: failed dengan selisih tertera; penyelesaian tetap memposting pada harga struk", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    await setPrice("12000");
    const res = await syncOfflineSalesAction({ items: [priceItem("t2-price-up")] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].status).toBe("failed");
      expect(res.data[0].kind).toBe("price");
    }
    const pending = await pendingRowsFor("t2-price-up");
    expect(pending).toHaveLength(1);
    const settleRes = await postOfflineReviewItemAction({
      outboxId: pending[0].id,
      mode: "settle",
    });
    expect(settleRes.ok).toBe(true);
    const sale = await saleByKey("t2-price-up");
    expect(sale).not.toBeNull();
    expect(d(sale!.total).toNumber()).toBe(10000);
    expect(sale!.paymentStatus).toBe("paid");
  });

  it("payload warisan tanpa snapshot eksplisit: snapshot tersirat dari pembayaran tetap mendeteksi perubahan harga", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    await setPrice("12000");
    const legacy: OfflineSalePayload = {
      clientKey: "t2-price-legacy",
      warehouseId: whId,
      date: TODAY,
      lines: [{ productId, qty: 1 }],
      payments: [{ methodId: cashMethodId, amount: 10000, tendered: 10000 }],
      queuedAt: new Date().toISOString(),
    };
    const result = await withCompany(ORG, (tx) =>
      processOfflineSaleItem(tx, { companyId: ORG, userId: OWNER, item: legacy }),
    );
    expect(result.status).toBe("failed");
    expect(result.kind).toBe("price");
    expect(await saleByKey("t2-price-legacy")).toBeNull();
    await setPrice("10000");
  });

  it("POS3-05: percobaan berulang tidak menggandakan baris peninjauan; sukses membersihkannya", async () => {
    const scarce = await makeProduct("5000", "3000", 1);
    const item: OfflineSalePayload = {
      clientKey: "t2-supersede",
      warehouseId: whId,
      cashierId: CASHIER,
      originSessionId: sessionId,
      date: TODAY,
      lines: [{ productId: scarce, qty: 5, unitPrice: 5000 }],
      payments: [{ methodId: cashMethodId, amount: 25000, tendered: 25000 }],
      expectedTotal: 25000,
      queuedAt: new Date().toISOString(),
    };
    for (let i = 0; i < 3; i++) {
      const result = await withCompany(ORG, (tx) =>
        processOfflineSaleItem(tx, {
          companyId: ORG,
          userId: MANAGER,
          item,
          originEntitlements: { [CASHIER]: { canSell: true, canDiscount: false } },
        }),
      );
      expect(result.status).toBe("conflict");
    }
    expect(await pendingRowsFor("t2-supersede")).toHaveLength(1);

    // Stok ditambah; posting ulang DARI PENINJAUAN menuntaskan item.
    await withCompany(ORG, (tx) =>
      applyStockMovement(tx, {
        companyId: ORG, warehouseId: whId, productId: scarce, delta: 10,
        unitCost: "3000", movementType: "purchase", referenceType: "opening", userId: OWNER,
      }),
    );
    const pending = await pendingRowsFor("t2-supersede");
    setActor(MANAGER, MANAGER_PERMS);
    const retryRes = await postOfflineReviewItemAction({
      outboxId: pending[0].id,
      mode: "retry",
    });
    expect(retryRes.ok).toBe(true);
    expect(await saleByKey("t2-supersede")).not.toBeNull();
    expect(await pendingRowsFor("t2-supersede")).toHaveLength(0);
    const queue = await withCompany(ORG, (tx) => listOfflineReviewQueue(tx, ORG));
    expect(queue.map((r) => r.payload.clientKey)).not.toContain("t2-supersede");
  });
});

// =====================================================================
// POS3-17 — Tanggal offline di periode tertutup: posting bertanggal
// sinkron, tanggal asli tersimpan & tertera
// =====================================================================
describe("POS3-17 tanggal offline vs periode tertutup", () => {
  it("item 15 Jan 2026 (periode ditutup) terposting hari ini dengan tanggal asli tercatat", async () => {
    // Baris Januari mungkin sudah termaterialisasi "open" oleh posting
    // tahun berjalan sebelumnya — paksa statusnya menjadi closed.
    await adminDb
      .insert(fiscalPeriods)
      .values({ companyId: ORG, year: 2026, month: 1, status: "closed" })
      .onConflictDoUpdate({
        target: [fiscalPeriods.companyId, fiscalPeriods.year, fiscalPeriods.month],
        set: { status: "closed" },
      });
    const productId = await makeProduct("30000", "18000", 5);
    const sessionId = await openSession(CASHIER2);
    const [customer] = await adminDb
      .insert(customers)
      .values({ companyId: ORG, code: "C-T2-17", name: "Pelanggan T2-17", creditLimit: "0" })
      .returning({ id: customers.id });
    const item: OfflineSalePayload = {
      clientKey: "t2-period-1",
      warehouseId: whId,
      cashierId: CASHIER2,
      originSessionId: sessionId,
      customerId: customer.id,
      dueDate: "2026-01-20",
      date: "2026-01-15",
      lines: [{ productId, qty: 1, unitPrice: 30000 }],
      payments: [{ methodId: creditMethodId, amount: 30000, tendered: 30000 }],
      expectedTotal: 30000,
      queuedAt: "2026-01-15T10:00:00.000Z",
    };
    setActor(MANAGER, MANAGER_PERMS);
    const res = await syncOfflineSalesAction({ items: [item] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data[0].status).toBe("synced");

    const sale = await saleByKey("t2-period-1");
    expect(sale).not.toBeNull();
    expect(sale!.date).toBe(TODAY);
    // Jatuh tempo bergeser sebesar delta tanggal yang sama (+5 hari).
    const expectedDue = new Date(`${TODAY}T00:00:00Z`);
    expectedDue.setUTCDate(expectedDue.getUTCDate() + 5);
    expect(sale!.dueDate).toBe(expectedDue.toISOString().slice(0, 10));
    // Tanggal asli tertera di dokumen.
    expect(sale!.notes ?? "").toContain("2026-01-15");
    const [entry] = await adminDb
      .select({ date: journalEntries.date })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, ORG),
          eq(journalEntries.sourceType, "sale"),
          eq(journalEntries.sourceId, sale!.id),
        ),
      );
    expect(entry.date).toBe(TODAY);
    const closed = await closeSession(CASHIER2, sessionId, 0);
    expect(closed.difference).toBe(0);
  });
});

// =====================================================================
// POS3-06 — Membuang/menyelesaikan peninjauan mensyaratkan izin
// supervisor (pos.void) dan teraudit
// =====================================================================
describe("POS3-06 gerbang supervisor untuk penyelesaian peninjauan", () => {
  it("kasir biasa tidak dapat membuang item; manajer dapat dan tercatat di audit", async () => {
    const scarce = await makeProduct("7000", "4000", 0);
    const result = await withCompany(ORG, (tx) =>
      processOfflineSaleItem(tx, {
        companyId: ORG,
        userId: OWNER,
        item: {
          clientKey: "t2-resolve-gate",
          warehouseId: whId,
          date: TODAY,
          lines: [{ productId: scarce, qty: 3 }],
          payments: [{ methodId: cashMethodId, amount: 21000, tendered: 21000 }],
          queuedAt: new Date().toISOString(),
        },
      }),
    );
    expect(result.status).toBe("conflict");
    const pending = await pendingRowsFor("t2-resolve-gate");
    expect(pending).toHaveLength(1);
    const outboxId = pending[0].id;

    setActor(CASHIER, CASHIER_PERMS);
    const denied = await resolveOfflineOutboxAction({
      outboxId,
      resolution: "discarded",
      note: "coba buang oleh kasir",
    });
    expect(denied.ok).toBe(false);
    expect(await pendingRowsFor("t2-resolve-gate")).toHaveLength(1);

    setActor(MANAGER, MANAGER_PERMS);
    const allowed = await resolveOfflineOutboxAction({
      outboxId,
      resolution: "discarded",
      note: "Stok memang habis; penjualan dibatalkan.",
    });
    expect(allowed.ok).toBe(true);
    expect(await pendingRowsFor("t2-resolve-gate")).toHaveLength(0);
    const audits = await adminDb
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, ORG),
          eq(auditLog.action, "pos_offline.resolve"),
          eq(auditLog.entityId, outboxId),
        ),
      );
    expect(audits).toHaveLength(1);
  });
});
