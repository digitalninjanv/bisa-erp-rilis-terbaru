import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db/admin";
import { sales } from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { issueReceiptPrintToken, verifyReceiptPrintToken } from "@/server/pos";

const ORG = "01900000-0000-7000-8000-000000000001";
const USER = "01900000-0000-7000-8000-000000000010";

let saleId = "";
const issuedTokens: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({ company: { id: ORG }, user: { id: USER } }),
  requirePermissionInModule: async () => ({ company: { id: ORG }, user: { id: USER } }),
  requireAuth: async () => ({ company: { id: ORG }, user: { id: USER } }),
}));

beforeAll(async () => {
  const [sale] = await adminDb
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.companyId, ORG))
    .limit(1);
  if (!sale) throw new Error("Fixture demo tidak memiliki penjualan.");
  saleId = sale.id;
});

afterAll(async () => {
  if (issuedTokens.length === 0) return;
  const { idempotencyKeys } = await import("@/db/schema");
  const { inArray, and, eq: equals } = await import("drizzle-orm");
  await adminDb
    .delete(idempotencyKeys)
    .where(
      and(
        equals(idempotencyKeys.companyId, ORG),
        inArray(idempotencyKeys.key, issuedTokens),
      ),
    );
});

describe("token cetak pertama hanya sekali pakai", () => {
  it("pemakaian kedua ditolak dan tidak bisa mencetak sebagai cetakan pertama", async () => {
    const token = await withCompany(ORG, (tx) =>
      issueReceiptPrintToken(tx, { companyId: ORG, userId: USER, saleId }),
    );
    issuedTokens.push(token);

    const first = await withCompany(ORG, (tx) =>
      verifyReceiptPrintToken(tx, { companyId: ORG, userId: USER, saleId, token }),
    );
    expect(first).toBe(true);

    const second = await withCompany(ORG, (tx) =>
      verifyReceiptPrintToken(tx, { companyId: ORG, userId: USER, saleId, token }),
    );
    expect(second).toBe(false);
  });
});
