import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  companySettings,
  member,
  organization,
  products,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  suppliers,
  user,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  convertPurchaseRequestToPo,
  createPurchaseRequest,
  decidePurchaseRequest,
} from "@/server/purchase-requests";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-2 Batch 3 — Purchase Request formal.
 *
 * PR → disahkan (maker-checker; di atas ambang konfigurasi wajib peran
 * senior) → dikonversi SEKALI menjadi PO berisi baris yang sama.
 * Konversi ulang ditolak; PR ditolak tidak bisa dikonversi.
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

const ORG = "01900000-0000-7000-8000-00000000e803";
const OWNER = "01900000-0000-7000-8000-00000000e853";
const MANAGER = "01900000-0000-7000-8000-00000000e854";
const ACCOUNTANT = "01900000-0000-7000-8000-00000000e855";


function expectMoney(actual: unknown, expected: number) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER, MANAGER, ACCOUNTANT]);
}

let supplierId = "";
const product: Record<string, string> = {};

async function makeUser(id: string, email: string, role: string) {
  await adminDb.insert(user).values({ id, name: email, email, emailVerified: true, role });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id,
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: id, role, createdAt: new Date(),
  });
}

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji PR", slug: "uji-pr", createdAt: new Date() });
  await makeUser(OWNER, "owner-e803@bisa.id", "owner");
  await makeUser(MANAGER, "manager-e803@bisa.id", "manager");
  await makeUser(ACCOUNTANT, "akuntan-e803@bisa.id", "accountant");
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji PR", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
  const [supplier] = await adminDb
    .insert(suppliers)
    .values({ companyId: ORG, code: "SUP-PR", name: "PT Pemasok PR" })
    .returning();
  supplierId = supplier.id;
  const rows = await adminDb
    .insert(products)
    .values([
      { companyId: ORG, sku: "PR-A", name: "Produk PR A", salePrice: "15000", costPrice: "10000", trackStock: true },
      { companyId: ORG, sku: "PR-B", name: "Jasa PR B", salePrice: "500000", costPrice: "400000", trackStock: false },
    ])
    .returning();
  for (const row of rows) product[row.sku] = row.id;
  state.org = ORG;
  state.user = OWNER;
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("Purchase Request — ajukan, sahkan, konversi", () => {
  let prId = "";

  it("PR dibuat dengan total perkiraan & snapshot nama produk", async () => {
    const pr = await withCompany(ORG, (tx) =>
      createPurchaseRequest(tx, {
        companyId: ORG,
        userId: OWNER,
        date: "2026-02-01",
        lines: [
          { productId: product["PR-A"], qty: "10", estimatedPrice: "10000", reason: "Stok menipis" },
          { productId: product["PR-B"], qty: "1", estimatedPrice: "400000", reason: "Kontrak tahunan" },
        ],
      }),
    );
    prId = pr.id;
    expect(pr.number).toMatch(/^PRQ-/);
    expect(pr.status).toBe("submitted");
    expectMoney(pr.totalEstimate, 500000);
  });

  it("pembuat tidak bisa mengesahkan PR-nya sendiri (maker-checker)", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        decidePurchaseRequest(tx, {
          companyId: ORG,
          actor: { userId: OWNER, role: "owner" },
          requestId: prId,
          approve: true,
        }),
      ),
    ).rejects.toThrow();
  });

  it("disahkan manajer lalu dikonversi menjadi PO berisi baris yang sama", async () => {
    const decided = await withCompany(ORG, (tx) =>
      decidePurchaseRequest(tx, {
        companyId: ORG,
        actor: { userId: MANAGER, role: "manager" },
        requestId: prId,
        approve: true,
      }),
    );
    expect(decided.status).toBe("approved");

    const po = await withCompany(ORG, (tx) =>
      convertPurchaseRequestToPo(tx, {
        companyId: ORG,
        userId: MANAGER,
        requestId: prId,
        supplierId,
        date: "2026-02-02",
      }),
    );
    const lines = await adminDb
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, po.id));
    expect(lines).toHaveLength(2);
    const lineA = lines.find((line) => line.productId === product["PR-A"]);
    const lineB = lines.find((line) => line.productId === product["PR-B"]);
    expectMoney(lineA!.qty, 10);
    expectMoney(lineA!.unitCost, 10000);
    expectMoney(lineB!.qty, 1);
    expectMoney(lineB!.unitCost, 400000);

    const [pr] = await adminDb.select().from(purchaseRequests).where(eq(purchaseRequests.id, prId));
    expect(pr.status).toBe("converted");
    expect(pr.convertedPoId).toBe(po.id);
  });

  it("konversi ulang ditolak", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        convertPurchaseRequestToPo(tx, {
          companyId: ORG,
          userId: MANAGER,
          requestId: prId,
          supplierId,
          date: "2026-02-03",
        }),
      ),
    ).rejects.toThrow();
    const orders = await adminDb.select().from(purchaseOrders).where(eq(purchaseOrders.companyId, ORG));
    expect(orders).toHaveLength(1);
  });

  it("PR yang ditolak tidak bisa dikonversi; penolakan wajib beralasan", async () => {
    const pr = await withCompany(ORG, (tx) =>
      createPurchaseRequest(tx, {
        companyId: ORG,
        userId: OWNER,
        date: "2026-02-05",
        lines: [{ productId: product["PR-A"], qty: "5", estimatedPrice: "10000", reason: "Tambahan" }],
      }),
    );
    await expect(
      withCompany(ORG, (tx) =>
        decidePurchaseRequest(tx, {
          companyId: ORG,
          actor: { userId: MANAGER, role: "manager" },
          requestId: pr.id,
          approve: false,
        }),
      ),
    ).rejects.toThrow();
    const rejected = await withCompany(ORG, (tx) =>
      decidePurchaseRequest(tx, {
        companyId: ORG,
        actor: { userId: MANAGER, role: "manager" },
        requestId: pr.id,
        approve: false,
        note: "Anggaran bulan ini habis",
      }),
    );
    expect(rejected.status).toBe("rejected");
    await expect(
      withCompany(ORG, (tx) =>
        convertPurchaseRequestToPo(tx, {
          companyId: ORG,
          userId: MANAGER,
          requestId: pr.id,
          supplierId,
          date: "2026-02-06",
        }),
      ),
    ).rejects.toThrow();
  });

  it("di atas ambang konfigurasi, pengesahan wajib peran senior", async () => {
    await adminDb
      .update(companySettings)
      .set({ prApprovalThreshold: "1000000" })
      .where(eq(companySettings.companyId, ORG));
    const pr = await withCompany(ORG, (tx) =>
      createPurchaseRequest(tx, {
        companyId: ORG,
        userId: OWNER,
        date: "2026-02-10",
        lines: [{ productId: product["PR-B"], qty: "10", estimatedPrice: "400000", reason: "Ekspansi" }],
      }),
    );
    expectMoney(pr.totalEstimate, 4000000);
    await expect(
      withCompany(ORG, (tx) =>
        decidePurchaseRequest(tx, {
          companyId: ORG,
          actor: { userId: ACCOUNTANT, role: "accountant" },
          requestId: pr.id,
          approve: true,
        }),
      ),
    ).rejects.toThrow();
    const approved = await withCompany(ORG, (tx) =>
      decidePurchaseRequest(tx, {
        companyId: ORG,
        actor: { userId: MANAGER, role: "manager" },
        requestId: pr.id,
        approve: true,
      }),
    );
    expect(approved.status).toBe("approved");
  });
});
