import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  auditLog,
  companySettings,
  customers,
  journalEntries,
  journalLines,
  member,
  organization,
  partyPayments,
  paymentMethods,
  products,
  sales,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { applyStockMovement } from "@/server/inventory";
import { openCashSession } from "@/server/pos";
import {
  checkoutAction,
  deleteHeldSaleAction,
  holdAction,
  payReceivableAction,
  quoteAction,
  resumeHeldSaleAction,
  searchProductsAction,
  voidReceivablePaymentAction,
} from "@/server/actions/pos";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// FIX-POS TAHAP 3 — Izin & kebocoran data (POS3-10, POS3-11, POS3-13).
// Perusahaan fixture khusus f301; demo tidak disentuh. Sesi dimock
// dinamis (state.permissions) agar gerbang izin SUNGGUHAN di lapisan
// aksi yang diuji — bukan mock lolos-semua.
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
      company: { id: "01900000-0000-7000-8000-00000000f301" },
      user: { id: state.userId },
      permissions: state.permissions,
      role: "custom",
    };
  };
  return {
    requirePermission: (permission: string) => build(permission)(),
    requirePermissionInModule: (permission: string) => build(permission)(),
    requireAuth: () => build()(),
  };
});

const ORG = "01900000-0000-7000-8000-00000000f301";
const OWNER = "01900000-0000-7000-8000-00000000f351";
const MANAGER = "01900000-0000-7000-8000-00000000f352";
const CASHIER = "01900000-0000-7000-8000-00000000f353";
const CASHIER2 = "01900000-0000-7000-8000-00000000f354";
const COSTVIEW = "01900000-0000-7000-8000-00000000f355";

const MANAGER_PERMS = ["pos.sell", "pos.discount", "pos.void", "pos.return", "pos.session"];
const CASHIER_PERMS = ["pos.sell", "pos.session"];
// Pemanggil berkedudukan lebih tinggi yang SAH melihat harga pokok,
// tetapi TIDAK memegang pos.void — memisahkan kedua gerbang.
const COSTVIEW_PERMS = ["pos.sell", "pos.session", "inventory.cost"];

const USER_IDS = [OWNER, MANAGER, CASHIER, CASHIER2, COSTVIEW];

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, USER_IDS);
}

const acc: Record<string, string> = {};
let whId = "";
let creditMethodId = "";
let productId = "";
let customerId = "";

async function bootstrap() {
  await wipeFixture();
  const people: Array<[string, string, string | null]> = [
    [OWNER, "Pemilik T3", "owner"],
    [MANAGER, "Manajer T3", "manager"],
    [CASHIER, "Kasir T3", "cashier"],
    [CASHIER2, "Kasir Dua T3", "cashier"],
    [COSTVIEW, "Pengawas Biaya T3", "manager"],
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
    id: ORG, name: "PT Uji Izin T3", slug: "uji-izin-t3", createdAt: new Date(),
  });
  for (const [id, , role] of people) {
    if (!role) continue;
    await adminDb.insert(member).values({
      id: crypto.randomUUID(), organizationId: ORG, userId: id, role, createdAt: new Date(),
    });
  }
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Izin T3", roundingMode: "none",
    taxRate: "0", taxEnabled: false, allowNegativeStock: false, posOfflineEnabled: false,
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
  await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: acc["1000"], sortOrder: 1 });
  const [credit] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CREDIT", name: "Utang", type: "credit", accountId: acc["1200"], sortOrder: 2 })
    .returning();
  creditMethodId = credit.id;
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-T3", name: "Gudang T3", type: "warehouse", isDefault: true })
    .returning();
  whId = wh.id;

  const [p] = await adminDb
    .insert(products)
    .values({
      companyId: ORG, sku: "T3-UTAMA", name: "Produk Uji Izin T3",
      salePrice: "10000", costPrice: "7000", trackStock: true,
    })
    .returning({ id: products.id });
  productId = p.id;
  await withCompany(ORG, (tx) =>
    applyStockMovement(tx, {
      companyId: ORG, warehouseId: whId, productId, delta: 50,
      unitCost: "7000", movementType: "purchase", referenceType: "opening", userId: OWNER,
    }),
  );

  const [customer] = await adminDb
    .insert(customers)
    .values({ companyId: ORG, code: "CST-T3", name: "Pelanggan Utang T3", creditLimit: "0" })
    .returning({ id: customers.id });
  customerId = customer.id;
}

function setActor(userId: string, permissions: string[]) {
  state.userId = userId;
  state.permissions = permissions;
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

beforeAll(bootstrap);
afterAll(wipeFixture);

// =====================================================================
// POS3-10 — Harga pokok tidak mencapai kasir
// =====================================================================
describe("POS3-10 harga pokok tidak bocor ke kasir", () => {
  it("searchProductsAction sebagai kasir: payload tanpa costPrice (cabang kata kunci & katalog awal)", async () => {
    setActor(CASHIER, CASHIER_PERMS);

    const searched = await searchProductsAction("Produk Uji", whId);
    expect(searched.ok).toBe(true);
    if (!searched.ok) return;
    expect(searched.data.length).toBeGreaterThan(0);
    for (const row of searched.data) {
      expect(row).not.toHaveProperty("costPrice");
    }

    const initial = await searchProductsAction("", whId);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.data.length).toBeGreaterThan(0);
    for (const row of initial.data) {
      expect(row).not.toHaveProperty("costPrice");
    }
  });

  it("searchProductsAction sebagai pemegang inventory.cost: costPrice tetap tersedia", async () => {
    setActor(COSTVIEW, COSTVIEW_PERMS);
    const result = await searchProductsAction("Produk Uji", whId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.data.find((r) => r.id === productId) as { costPrice?: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.costPrice).toBeDefined();
    expect(Number(row?.costPrice)).toBeCloseTo(7000, 2);
  });

  it("quoteAction sebagai kasir: baris tanpa unitCost, total tetap benar", async () => {
    setActor(CASHIER, CASHIER_PERMS);
    const result = await quoteAction({
      warehouseId: whId,
      lines: [{ productId, qty: "2" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lines).toHaveLength(1);
    expect(result.data.lines[0]).not.toHaveProperty("unitCost");
    expect(result.data.total).toBeCloseTo(20000, 2);
  });

  it("quoteAction sebagai pemegang inventory.cost: unitCost tetap tersedia", async () => {
    setActor(COSTVIEW, COSTVIEW_PERMS);
    const result = await quoteAction({
      warehouseId: whId,
      lines: [{ productId, qty: "2" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lines[0].unitCost).toBeCloseTo(7000, 2);
    expect(result.data.total).toBeCloseTo(20000, 2);
  });
});

// =====================================================================
// POS3-11 — Void penerimaan piutang mensyaratkan pos.void
// =====================================================================
describe("POS3-11 void penerimaan piutang berpagar pos.void", () => {
  let saleId = "";
  let paymentId = "";

  beforeAll(async () => {
    // Penjualan utang oleh kasir (sesi kas terbuka miliknya), lalu
    // penerimaan sebagian — keduanya sah dengan pos.sell saja.
    await withCompany(ORG, (tx) =>
      openCashSession(tx, { companyId: ORG, userId: CASHIER, openingCash: 0 }),
    );
    setActor(CASHIER, CASHIER_PERMS);
    const checkout = await checkoutAction({
      warehouseId: whId,
      idempotencyKey: "t3-void-ar-checkout-1",
      customerId,
      dueDate: todayISO(),
      lines: [{ productId, qty: "1" }],
      payments: [{ methodId: creditMethodId, amount: "10000" }],
    });
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    saleId = (checkout.data as { id: string }).id;

    const paid = await payReceivableAction({
      saleId,
      amount: "4000",
      accountId: acc["1000"],
    });
    expect(paid.ok).toBe(true);

    const [payment] = await adminDb
      .select({ id: partyPayments.id })
      .from(partyPayments)
      .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, saleId)));
    paymentId = payment.id;
    // Piutang bersih sesudah penerimaan: 10.000 − 4.000 = 6.000.
    expect(await glNet("1200")).toBeCloseTo(6000, 2);
  });

  it("kasir (pos.sell saja) DITOLAK membatalkan penerimaan", async () => {
    setActor(CASHIER, CASHIER_PERMS);
    const result = await voidReceivablePaymentAction({
      paymentId,
      reason: "Kasir mencoba membatalkan penerimaan",
    });
    expect(result.ok).toBe(false);

    const [payment] = await adminDb
      .select({ status: partyPayments.status })
      .from(partyPayments)
      .where(eq(partyPayments.id, paymentId));
    expect(payment.status).toBe("posted");
    expect(await glNet("1200")).toBeCloseTo(6000, 2);
  });

  it("pemegang inventory.cost tanpa pos.void tetap DITOLAK (gerbangnya pos.void, bukan izin ekstra apa pun)", async () => {
    setActor(COSTVIEW, COSTVIEW_PERMS);
    const result = await voidReceivablePaymentAction({
      paymentId,
      reason: "Pengawas biaya mencoba membatalkan",
    });
    expect(result.ok).toBe(false);
  });

  it("pemegang pos.void berhasil; jurnal pembalik benar dan piutang pulih penuh (regresi AK3-01)", async () => {
    setActor(MANAGER, MANAGER_PERMS);
    const result = await voidReceivablePaymentAction({
      paymentId,
      reason: "Penerimaan salah catat, dibatalkan supervisor",
    });
    expect(result.ok).toBe(true);

    const [payment] = await adminDb
      .select({ status: partyPayments.status, number: partyPayments.number })
      .from(partyPayments)
      .where(eq(partyPayments.id, paymentId));
    expect(payment.status).toBe("void");

    const [sale] = await adminDb
      .select({ paidTotal: sales.paidTotal, paymentStatus: sales.paymentStatus })
      .from(sales)
      .where(eq(sales.id, saleId));
    expect(Number(sale.paidTotal)).toBeCloseTo(0, 2);
    expect(sale.paymentStatus).toBe("unpaid");

    const [original] = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, ORG),
          eq(journalEntries.idempotencyKey, `ar:${saleId}:${payment.number}`),
        ),
      );
    expect(original).toBeDefined();
    const [reversal] = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, ORG),
          eq(journalEntries.reversalOfId, original.id),
          eq(journalEntries.status, "posted"),
        ),
      );
    expect(reversal).toBeDefined();
    // Piutang kembali utuh 10.000 — tidak ada penerimaan yang menggantung.
    expect(await glNet("1200")).toBeCloseTo(10000, 2);
  });

  it("akuntan dengan accounting.post dapat menerima piutang lewat jalur accounting", async () => {
    setActor(COSTVIEW, ["accounting.post"]);
    const result = await payReceivableAction({
      saleId,
      amount: "1000",
      accountId: acc["1000"],
      source: "accounting",
      idempotencyKey: "t3-ar-accounting-path-1",
    });
    expect(result.ok).toBe(true);
  });
});

// =====================================================================
// POS3-13 — Hapus pesanan ditahan: pemilik atau pos.void + audit
// =====================================================================
describe("POS3-13 hapus pesanan ditahan berpemilik & teraudit", () => {
  async function makeHeld(userId: string, perms: string[], label: string): Promise<string> {
    setActor(userId, perms);
    const result = await holdAction({
      warehouseId: whId,
      idempotencyKey: `t3-held-${label}`,
      label,
      lines: [{ productId, qty: "1" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("holdAction gagal");
    return (result.data as { id: string }).id;
  }

  it("kasir lain tidak dapat menghapus tahanan kasir pertama; resume tetap terbuka", async () => {
    const heldId = await makeHeld(CASHIER, CASHIER_PERMS, "Tahanan Kasir Satu");

    setActor(CASHIER2, CASHIER_PERMS);
    const removed = await deleteHeldSaleAction(heldId);
    expect(removed.ok).toBe(false);

    const [stillThere] = await adminDb
      .select({ id: sales.id, status: sales.status })
      .from(sales)
      .where(eq(sales.id, heldId));
    expect(stillThere?.status).toBe("held");

    // Resume bersifat baca-saja dan tetap boleh untuk kasir lain.
    const resumed = await resumeHeldSaleAction(heldId);
    expect(resumed.ok).toBe(true);

    // Supervisor (pos.void) dapat menghapus tahanan orang lain, teraudit.
    setActor(MANAGER, MANAGER_PERMS);
    const byManager = await deleteHeldSaleAction(heldId);
    expect(byManager.ok).toBe(true);
    const [gone] = await adminDb
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.id, heldId));
    expect(gone).toBeUndefined();
    const audits = await adminDb
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, ORG),
          eq(auditLog.action, "pos.held.delete"),
          eq(auditLog.entityId, heldId),
          eq(auditLog.userId, MANAGER),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it("pemilik tahanan dapat menghapus tahanannya sendiri, teraudit", async () => {
    const heldId = await makeHeld(CASHIER, CASHIER_PERMS, "Tahanan Milik Sendiri");
    setActor(CASHIER, CASHIER_PERMS);
    const removed = await deleteHeldSaleAction(heldId);
    expect(removed.ok).toBe(true);
    const audits = await adminDb
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, ORG),
          eq(auditLog.action, "pos.held.delete"),
          eq(auditLog.entityId, heldId),
          eq(auditLog.userId, CASHIER),
        ),
      );
    expect(audits).toHaveLength(1);
  });
});
