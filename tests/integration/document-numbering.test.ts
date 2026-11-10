import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companySettings } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { nextDocumentNumber } from "@/server/sequences";
import { saveDocumentNumberingAction } from "@/server/actions/settings/penomoran";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// AK-P3-07: per-company prefix/padding overrides for document numbers.
// Domain behaviour is exercised inside rollback transactions against a
// far-future fiscal year so real sequences are never touched; the
// settings action writes for real and is cleaned up afterwards.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  }),
}));

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const DATE_2099 = "2099-05-01";


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function setNumbering(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  numbering: Record<string, { prefix?: string; padding?: number }> | null,
) {
  await tx
    .update(companySettings)
    .set({ documentNumbering: numbering })
    .where(eq(companySettings.companyId, ORG_ID));
}

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .update(companySettings)
      .set({ documentNumbering: null })
      .where(eq(companySettings.companyId, ORG_ID));
  });
});

describe("nextDocumentNumber dengan override perusahaan (AK-P3-07)", () => {
  it("tanpa override formatnya persis seperti sebelumnya", async () => {
    const numbers = await rollbackTransaction(async (tx) => {
      await setNumbering(tx, null);
      return [
        await nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099),
        await nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099),
      ];
    });
    expect(numbers).toEqual(["INV-2099-00001", "INV-2099-00002"]);
  });

  it("override prefix+padding berlaku hanya untuk jenisnya; penghapusan mengembalikan bawaan", async () => {
    const numbers = await rollbackTransaction(async (tx) => {
      await setNumbering(tx, null);
      const first = await nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099);
      const second = await nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099);

      await setNumbering(tx, { SALE: { prefix: "FJ", padding: 3 } });
      const custom = await nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099);
      const otherType = await nextDocumentNumber(tx, ORG_ID, "JOURNAL", DATE_2099);

      await setNumbering(tx, null);
      const backToDefault = await nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099);
      return { first, second, custom, otherType, backToDefault };
    });

    expect(numbers.first).toBe("INV-2099-00001");
    expect(numbers.second).toBe("INV-2099-00002");
    expect(numbers.custom).toBe("FJ-2099-003");
    // JOURNAL's 2099 counter is shared with other suites that post real
    // journals in 2099, so only its format is asserted: default prefix
    // and default 5-digit padding, untouched by the SALE override.
    expect(numbers.otherType).toMatch(/^JE-2099-\d{5}$/);
    expect(numbers.backToDefault).toBe("INV-2099-00004");
  });

  it("override tersimpan yang kotor diabaikan dan bawaan yang dipakai", async () => {
    const number = await rollbackTransaction(async (tx) => {
      await setNumbering(tx, { SALE: { prefix: "A B!", padding: 99 } });
      return nextDocumentNumber(tx, ORG_ID, "SALE", DATE_2099);
    });
    expect(number).toBe("INV-2099-00001");
  });
});

describe("saveDocumentNumberingAction (AK-P3-07)", () => {
  it("menyimpan override yang terbaca kembali dan dipakai penerbitan nomor", async () => {
    const saved = await saveDocumentNumberingAction({
      entries: [{ docType: "RECEIPT", prefix: "gr", padding: 4 }],
    });
    expect(saved.ok).toBe(true);

    const stored = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ documentNumbering: companySettings.documentNumbering })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_ID))
        .limit(1);
      return row?.documentNumbering;
    });
    expect(stored).toEqual({ RECEIPT: { prefix: "GR", padding: 4 } });

    const number = await rollbackTransaction((tx) =>
      nextDocumentNumber(tx, ORG_ID, "RECEIPT", DATE_2099),
    );
    expect(number).toBe("GR-2099-0001");
  });

  it("menolak prefix kotor dan jenis dokumen tak dikenal", async () => {
    const dirty = await saveDocumentNumberingAction({
      entries: [{ docType: "SALE", prefix: "A B", padding: 5 }],
    });
    expect(dirty.ok).toBe(false);
    if (!dirty.ok) expect(dirty.code).toBe("VALIDATION");

    const unknown = await saveDocumentNumberingAction({
      entries: [{ docType: "TIPE_ASING", prefix: "XX", padding: 5 }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("VALIDATION");
  });

  it("entri kosong menghapus override (kembali ke bawaan)", async () => {
    const saved = await saveDocumentNumberingAction({ entries: [] });
    expect(saved.ok).toBe(true);

    const stored = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [row] = await tx
        .select({ documentNumbering: companySettings.documentNumbering })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_ID))
        .limit(1);
      return row?.documentNumbering;
    });
    expect(stored).toBeNull();
  });
});
