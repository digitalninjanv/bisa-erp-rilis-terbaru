import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/db/admin";
import {
  accountMappings,
  accounts,
  branches,
  companySettings,
  member,
  organization,
  paymentMethods,
  user,
  warehouses,
} from "@/db/schema";
import { assertDatabaseEmpty, bootstrapCompany } from "@/server/bootstrap";
import { bootstrapSetupAction } from "@/server/actions/setup";

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6);

class RollbackFixture extends Error {}

describe("bootstrap perusahaan produksi", () => {
  it("menolak database yang sudah berisi organisasi", async () => {
    await expect(
      adminDb.transaction((tx) => assertDatabaseEmpty(tx)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("setup web menolak token salah sebelum menyentuh database", async () => {
    process.env.BISA_SETUP_TOKEN = "token-uji-yang-panjang";
    const result = await bootstrapSetupAction({
      token: "token-salah",
      companyName: "Toko Setup",
      ownerName: "Owner Setup",
      ownerEmail: "owner@setup.test",
      ownerPassword: "SandiSetup123!",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("setup web menolak database yang sudah berisi organisasi", async () => {
    process.env.BISA_SETUP_TOKEN = "token-uji-yang-panjang";
    const result = await bootstrapSetupAction({
      token: "token-uji-yang-panjang",
      companyName: "Toko Setup",
      ownerName: "Owner Setup",
      ownerEmail: "owner@setup.test",
      ownerPassword: "SandiSetup123!",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("membuat owner, organisasi, gudang, pengaturan, akun, dan metode pembayaran", async () => {
    await expect(
      adminDb.transaction(async (tx) => {
        const result = await bootstrapCompany(tx, {
          companyName: "Toko Bootstrap Uji",
          ownerName: "Owner Bootstrap",
          ownerEmail: `owner.${suffix}@bootstrap.test`,
          ownerPassword: "SandiBootstrap123!",
          branchName: "Cabang Bootstrap",
          warehouseName: "Gudang Bootstrap",
        });

        const [org] = await tx
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(eq(organization.id, result.companyId));
        expect(org.name).toBe("Toko Bootstrap Uji");

        const [owner] = await tx
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, result.ownerUserId));
        expect(owner.email).toBe(`owner.${suffix}@bootstrap.test`);

        const [membership] = await tx
          .select({ role: member.role })
          .from(member)
          .where(
            and(
              eq(member.organizationId, result.companyId),
              eq(member.userId, result.ownerUserId),
            ),
          );
        expect(membership.role).toBe("owner");

        const [settings] = await tx
          .select({ defaultWarehouseId: companySettings.defaultWarehouseId })
          .from(companySettings)
          .where(eq(companySettings.companyId, result.companyId));
        expect(settings.defaultWarehouseId).toBe(result.warehouseId);

        const [warehouse] = await tx
          .select({ name: warehouses.name })
          .from(warehouses)
          .where(eq(warehouses.id, result.warehouseId));
        expect(warehouse.name).toBe("Gudang Bootstrap");

        const [branch] = await tx
          .select({ name: branches.name })
          .from(branches)
          .where(eq(branches.id, result.branchId));
        expect(branch.name).toBe("Cabang Bootstrap");

        const mappings = await tx
          .select({ key: accountMappings.key })
          .from(accountMappings)
          .where(eq(accountMappings.companyId, result.companyId));
        expect(mappings.length).toBeGreaterThan(10);

        const chart = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.companyId, result.companyId));
        expect(chart.length).toBeGreaterThan(10);

        const methods = await tx
          .select({ code: paymentMethods.code })
          .from(paymentMethods)
          .where(eq(paymentMethods.companyId, result.companyId));
        expect(methods.map((row) => row.code)).toEqual(
          expect.arrayContaining(["CASH", "QRIS", "TRANSFER", "CREDIT"]),
        );

        throw new RollbackFixture("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
  });
});
