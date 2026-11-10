import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import { withCompanyReadOnly } from "@/db/tenant";
import { account, companySettings, member, organization, user } from "@/db/schema";
import { saveSettingsAction } from "@/server/actions/settings/identitas-pajak";
import { uploadQrisAction } from "@/server/actions/settings/pembayaran";

/**
 * SIM-2 Fase S6 (SEC-06): validasi gambar QRIS disatukan. Kedua jalur
 * tulis — aksi unggah khusus dan simpan pengaturan umum — memakai
 * `qrisImageSchema` yang sama: data URL raster PNG/JPEG/WebP saja.
 * Sebelumnya jalur pengaturan umum menerima string apa pun ≤900KB
 * dan jalur unggah menerima subtipe apa pun termasuk SVG.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000cc10" },
    user: { id: "01900000-0000-7000-8000-00000000cc20" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000cc10";
const OWNER = "01900000-0000-7000-8000-00000000cc20";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==";
const SVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=";
const TEXT = "bukan gambar sama sekali";

async function wipeFixture() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    await tx.unsafe(`DELETE FROM company_settings WHERE company_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [OWNER]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [OWNER]);
  });
}

async function storedQris(): Promise<string | null | undefined> {
  return withCompanyReadOnly(ORG, async (tx) => {
    const [row] = await tx
      .select({ qrisImage: companySettings.qrisImage })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    return row?.qrisImage;
  });
}

function settingsInput(qrisImage: string | null) {
  return {
    legalName: "QRIS Mart",
    roundingMode: "none" as const,
    // A-28 UI-2: saklar nota warisan dipindah ke mesin cetak.
    qrisImage,
    allowNegativeStock: false,
    taxRate: "0",
    posDiscountThresholdPercent: "100",
  };
}

beforeAll(async () => {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: OWNER, name: "Uji QRIS", email: "owner@qris.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER, password: "x",
  });
  await adminDb.insert(organization).values({
    id: ORG, name: "QRIS Mart", slug: "qris-mart", createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "QRIS Mart", roundingMode: "none", taxRate: "0", allowNegativeStock: false,
  });
});
afterAll(wipeFixture);

describe("SEC-06 — satu validator QRIS untuk kedua jalur tulis", () => {
  it("jalur unggah khusus: PNG & JPEG diterima dan tersimpan", async () => {
    expect((await uploadQrisAction({ dataUrl: PNG })).ok).toBe(true);
    expect(await storedQris()).toBe(PNG);
    expect((await uploadQrisAction({ dataUrl: JPEG })).ok).toBe(true);
    expect(await storedQris()).toBe(JPEG);
  });

  it("jalur unggah khusus: SVG dan teks bebas ditolak sebagai VALIDATION, nilai lama utuh", async () => {
    for (const bad of [SVG, TEXT, "data:image/gif;base64,R0lGODlhAQABAAAAACw="]) {
      const result = await uploadQrisAction({ dataUrl: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("VALIDATION");
    }
    expect(await storedQris()).toBe(JPEG);
  });

  it("jalur pengaturan umum: SVG kini ditolak juga (sebelumnya lolos hanya dengan batas panjang)", async () => {
    const result = await saveSettingsAction(settingsInput(SVG));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
    expect(await storedQris()).toBe(JPEG);
  });

  it("jalur pengaturan umum: PNG diterima; null membersihkan gambar", async () => {
    expect((await saveSettingsAction(settingsInput(PNG))).ok).toBe(true);
    expect(await storedQris()).toBe(PNG);
    expect((await saveSettingsAction(settingsInput(null))).ok).toBe(true);
    expect(await storedQris()).toBeNull();
  });

  it("kedua jalur menolak data URL melebihi batas 900.000 karakter", async () => {
    const huge = `data:image/png;base64,${"A".repeat(900_001)}`;
    expect((await uploadQrisAction({ dataUrl: huge })).ok).toBe(false);
    expect((await saveSettingsAction(settingsInput(huge))).ok).toBe(false);
  });
});
