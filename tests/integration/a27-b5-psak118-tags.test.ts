import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accountMappings, accounts } from "@/db/schema";
import { adminDb } from "@/db/admin";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { saveAccountAction } from "@/server/actions/accounting/akun-pemetaan";
import {
  makeRollbackTransaction,
  type Tx,
} from "../helpers/rollback-transaction";

/**
 * A-27 B5 — Tagging PSAK 118 + penanda kontra (data saja; laporan
 * tidak diubah):
 *
 * 1. Backfill migrasi 0056 dieksekusi dari artefak SQL-nya sendiri
 *    (pola test B1) atas perusahaan fixture: kategori dari tipe,
 *    sifat/fungsi dari tipe, penyempurnaan sifat dari kunci pemetaan,
 *    kontra diskon/retur → pendapatan & akumulasi → aset tetap;
 *    perusahaan tanpa pemetaan pendapatan: flag kontra terisi,
 *    tautan kosong (tidak ditebak).
 * 2. Aksi simpan akun: bawaan deterministik saat tag tak dikirim,
 *    koherensi ditolak bernama (kategori di akun neraca, sifat di
 *    akun pendapatan), tautan kontra wajib sekantor & bukan diri
 *    sendiri, ubah tanpa bidang tag mempertahankan tag lama.
 * 3. Seed demo tertag benar (termasuk 1510 → 1500 dari pasangan
 *    eksplisit seed-chart, karena kuncinya tidak ditanam seed).
 *
 * Sesi dimock seperti a27-b3/b4 (izin peran asli dari @/lib/permissions).
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const COMPANY_A = "01900000-0000-7000-8000-00000000b501";
const COMPANY_B = "01900000-0000-7000-8000-00000000b502";
const FOREIGN_COMPANY = "01900000-0000-7000-8000-00000000b503";

const session = vi.hoisted(() => ({ role: "owner" }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const { AppError } = await import("@/lib/errors");
  const { permissionsFor } = await import("@/lib/permissions");
  const requirePermission = async (permission: string) => {
    if (!permissionsFor(session.role).includes(permission as never)) {
      throw new AppError("FORBIDDEN", "Peran ini tidak memiliki izin.");
    }
    return {
      company: { id: ORG_ID },
      user: { id: USER_ID },
      role: session.role,
    };
  };
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

/** Pernyataan UPDATE backfill dari berkas migrasi B5 yang terkirim. */
function backfillStatements(): string[] {
  const dir = path.resolve(process.cwd(), "src/db/migrations");
  const statements: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const text = readFileSync(path.join(dir, file), "utf8");
    if (!text.includes("psak118_category")) continue;
    for (const part of text.split("--> statement-breakpoint")) {
      const stmt = part
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      if (stmt.startsWith('UPDATE "accounts"')) {
        statements.push(stmt.replace(/;$/, ""));
      }
    }
  }
  return statements;
}

type FixtureSpec = {
  code: string;
  type: string;
  normalBalance: "debit" | "credit";
  section: string;
  key?: string;
};

async function insertFixture(tx: Tx, companyId: string, spec: FixtureSpec) {
  const [row] = await tx
    .insert(accounts)
    .values({
      companyId,
      code: spec.code,
      name: `Uji B5 ${spec.code}`,
      type: spec.type,
      normalBalance: spec.normalBalance,
      section: spec.section,
    })
    .returning();
  expect(row).toBeDefined();
  expect(row.psak118Category).toBeNull();
  expect(row.isContra).toBe(false);
  if (spec.key) {
    await tx.insert(accountMappings).values({ companyId, key: spec.key, accountId: row.id });
  }
  return row;
}

async function tagOf(tx: Tx, companyId: string, accountId: string) {
  const [row] = await tx
    .select({
      psak118Category: accounts.psak118Category,
      expenseNature: accounts.expenseNature,
      expenseFunction: accounts.expenseFunction,
      isContra: accounts.isContra,
      contraOf: accounts.contraOf,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
  return row;
}

describe("A-27 B5 — backfill tagging dari SQL migrasi 0056", () => {
  it("pernyataan backfill ditemukan utuh di migrasi terkirim (9 UPDATE)", () => {
    expect(backfillStatements()).toHaveLength(9);
  });

  it("kategori/sifat/fungsi/kontra terisi deterministik dari tipe + kunci pemetaan", async () => {
    const rollbackA = makeRollbackTransaction(COMPANY_A);
    await rollbackA(async (tx) => {
      const rev = await insertFixture(tx, COMPANY_A, { code: "B5REV", type: "revenue", normalBalance: "credit", section: "revenue", key: "revenue" });
      const disc = await insertFixture(tx, COMPANY_A, { code: "B5DSC", type: "revenue", normalBalance: "debit", section: "revenue", key: "sales_discount" });
      const ret = await insertFixture(tx, COMPANY_A, { code: "B5RET", type: "revenue", normalBalance: "debit", section: "revenue", key: "sales_return" });
      const cogs = await insertFixture(tx, COMPANY_A, { code: "B5HPP", type: "cogs", normalBalance: "debit", section: "cogs", key: "cogs" });
      const shrink = await insertFixture(tx, COMPANY_A, { code: "B5SHR", type: "cogs", normalBalance: "debit", section: "cogs", key: "inventory_shrink" });
      const dmg = await insertFixture(tx, COMPANY_A, { code: "B5DMG", type: "cogs", normalBalance: "debit", section: "cogs", key: "damaged" });
      const sal = await insertFixture(tx, COMPANY_A, { code: "B5SAL", type: "expense", normalBalance: "debit", section: "operating_expense", key: "salary_expense" });
      const fee = await insertFixture(tx, COMPANY_A, { code: "B5FEE", type: "expense", normalBalance: "debit", section: "operating_expense", key: "bank_fee" });
      const wo = await insertFixture(tx, COMPANY_A, { code: "B5WO", type: "expense", normalBalance: "debit", section: "operating_expense", key: "receivable_writeoff" });
      const gen = await insertFixture(tx, COMPANY_A, { code: "B5GEN", type: "expense", normalBalance: "debit", section: "operating_expense" });
      const fa = await insertFixture(tx, COMPANY_A, { code: "B5FA", type: "asset", normalBalance: "debit", section: "non_current_asset", key: "fixed_asset" });
      const akm = await insertFixture(tx, COMPANY_A, { code: "B5AKM", type: "asset", normalBalance: "credit", section: "non_current_asset", key: "accumulated_depreciation" });
      const liab = await insertFixture(tx, COMPANY_A, { code: "B5LIA", type: "liability", normalBalance: "credit", section: "current_liability" });

      for (const stmt of backfillStatements()) await tx.execute(sql.raw(stmt));

      expect(await tagOf(tx, COMPANY_A, rev.id)).toEqual({
        psak118Category: "operating", expenseNature: null, expenseFunction: null, isContra: false, contraOf: null,
      });
      // Kontra pendapatan: flag + tautan ke akun pendapatan sekantor.
      expect(await tagOf(tx, COMPANY_A, disc.id)).toMatchObject({ psak118Category: "operating", isContra: true, contraOf: rev.id });
      expect(await tagOf(tx, COMPANY_A, ret.id)).toMatchObject({ isContra: true, contraOf: rev.id });
      expect(await tagOf(tx, COMPANY_A, cogs.id)).toEqual({
        psak118Category: "operating", expenseNature: "inventory_expensed", expenseFunction: "cogs", isContra: false, contraOf: null,
      });
      // Penyempurnaan sifat dari kunci: shrink/damaged = writedown persediaan.
      expect(await tagOf(tx, COMPANY_A, shrink.id)).toMatchObject({ expenseNature: "inventory_writedown", expenseFunction: "cogs" });
      expect(await tagOf(tx, COMPANY_A, dmg.id)).toMatchObject({ expenseNature: "inventory_writedown" });
      expect(await tagOf(tx, COMPANY_A, sal.id)).toMatchObject({ expenseNature: "employee_benefits", expenseFunction: "admin" });
      expect(await tagOf(tx, COMPANY_A, fee.id)).toMatchObject({ expenseNature: "bank_charges" });
      expect(await tagOf(tx, COMPANY_A, wo.id)).toMatchObject({ expenseNature: "impairment" });
      expect(await tagOf(tx, COMPANY_A, gen.id)).toMatchObject({ expenseNature: "other", expenseFunction: "admin", psak118Category: "operating" });
      // Kontra aset: akumulasi → aset tetap; akun neraca tanpa kategori.
      expect(await tagOf(tx, COMPANY_A, akm.id)).toEqual({
        psak118Category: null, expenseNature: null, expenseFunction: null, isContra: true, contraOf: fa.id,
      });
      expect(await tagOf(tx, COMPANY_A, liab.id)).toMatchObject({ psak118Category: null, isContra: false });
    });
  });

  it("tanpa pemetaan pendapatan: flag kontra terisi, tautan dibiarkan kosong", async () => {
    const rollbackB = makeRollbackTransaction(COMPANY_B);
    await rollbackB(async (tx) => {
      const disc = await insertFixture(tx, COMPANY_B, { code: "B5DSC", type: "revenue", normalBalance: "debit", section: "revenue", key: "sales_discount" });
      for (const stmt of backfillStatements()) await tx.execute(sql.raw(stmt));
      expect(await tagOf(tx, COMPANY_B, disc.id)).toMatchObject({ isContra: true, contraOf: null });
    });
  });
});

/* ------------------------------------------------------------------ */
/* Aksi simpan akun                                                    */
/* ------------------------------------------------------------------ */

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const CODE = {
  expense: `B5E${suffix}`,
  revenue: `B5R${suffix}`,
  asset: `B5A${suffix}`,
  contra: `B5C${suffix}`,
  keep: `B5K${suffix}`,
};
const createdIds: string[] = [];
let foreignAccountId = "";

type AccountRow = typeof accounts.$inferSelect;

async function accountById(id: string): Promise<AccountRow | undefined> {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.id, id)))
      .limit(1);
    return row;
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Akun Uji B5",
    type: "expense",
    normalBalance: "debit",
    parentId: null,
    section: "operating_expense",
    cashFlowGroup: null,
    cashBankKind: null,
    bankName: null,
    bankAccountNumber: null,
    bankBranch: null,
    bankAccountHolder: null,
    currency: null,
    description: null,
    isPostable: true,
    isActive: true,
    ...overrides,
  };
}

async function createOk(overrides: Record<string, unknown>): Promise<string> {
  const result = await saveAccountAction(basePayload(overrides) as never);
  if (!result.ok) throw new Error(`Buat akun gagal: ${result.message}`);
  createdIds.push(result.data.id);
  return result.data.id;
}

/** Payload ubah persis bentuk formulir, dari baris tersimpan. */
function payloadFor(row: AccountRow, overrides: Record<string, unknown> = {}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as "asset" | "liability" | "equity" | "revenue" | "expense" | "cogs",
    normalBalance: row.normalBalance as "debit" | "credit",
    parentId: row.parentId,
    section: row.section as never,
    cashFlowGroup: row.cashFlowGroup as never,
    cashBankKind: row.cashBankKind as "cash" | "bank" | "clearing" | null,
    bankName: row.bankName,
    bankAccountNumber: row.bankAccountNumber,
    bankBranch: row.bankBranch,
    bankAccountHolder: row.bankAccountHolder,
    currency: row.currency,
    psak118Category: row.psak118Category as never,
    expenseNature: row.expenseNature as never,
    expenseFunction: row.expenseFunction as never,
    isContra: row.isContra,
    contraOf: row.contraOf,
    description: row.description,
    isPostable: row.isPostable,
    isActive: row.isActive,
    ...overrides,
  };
}

afterAll(async () => {
  if (createdIds.length > 0) {
    await withCompany(ORG_ID, async (tx) => {
      await tx.delete(accounts).where(and(eq(accounts.companyId, ORG_ID), inArray(accounts.id, createdIds)));
    });
  }
  if (foreignAccountId) {
    await adminDb.delete(accounts).where(eq(accounts.id, foreignAccountId));
  }
});

describe("A-27 B5 — aksi simpan akun: bawaan, koherensi, kontra", () => {
  it("buat tanpa bidang tag → bawaan deterministik per tipe", async () => {
    const expenseId = await createOk({ code: CODE.expense, name: "Beban Uji B5" });
    expect(await accountById(expenseId)).toMatchObject({
      psak118Category: "operating", expenseNature: "other", expenseFunction: "admin", isContra: false, contraOf: null,
    });
    const revenueId = await createOk({
      code: CODE.revenue, name: "Pendapatan Uji B5", type: "revenue", normalBalance: "credit", section: "revenue",
    });
    expect(await accountById(revenueId)).toMatchObject({
      psak118Category: "operating", expenseNature: null, expenseFunction: null,
    });
  });

  it("kategori di akun neraca & sifat di akun pendapatan ditolak bernama", async () => {
    const badCategory = await saveAccountAction(basePayload({
      code: `B5X1${suffix}`, name: "Aset Uji B5", type: "asset", section: "current_asset",
      psak118Category: "operating",
    }) as never);
    expect(badCategory.ok).toBe(false);
    if (!badCategory.ok) expect(badCategory.message).toContain("PSAK 118");

    const badNature = await saveAccountAction(basePayload({
      code: `B5X2${suffix}`, name: "Pendapatan Uji B5", type: "revenue", normalBalance: "credit", section: "revenue",
      expenseNature: "rent",
    }) as never);
    expect(badNature.ok).toBe(false);
    if (!badNature.ok) expect(badNature.message).toContain("Sifat");
  });

  it("tautan kontra: sekantor diterima; perusahaan lain & tak dikenal ditolak; diri sendiri ditolak", async () => {
    const assetId = await createOk({
      code: CODE.asset, name: "Aset Uji B5", type: "asset", section: "current_asset",
    });
    const contraId = await createOk({
      code: CODE.contra, name: "Kontra Uji B5", type: "asset", normalBalance: "credit",
      section: "current_asset", isContra: true, contraOf: assetId,
    });
    expect(await accountById(contraId)).toMatchObject({ isContra: true, contraOf: assetId });

    // Akun perusahaan lain (ditanam langsung, dibersihkan di afterAll).
    const [foreign] = await adminDb
      .insert(accounts)
      .values({
        companyId: FOREIGN_COMPANY, code: "B5FRN", name: "Akun Asing B5",
        type: "asset", normalBalance: "debit",
      })
      .returning();
    foreignAccountId = foreign.id;

    const crossCompany = await saveAccountAction(basePayload({
      code: `B5X3${suffix}`, name: "Kontra Asing B5", type: "asset", section: "current_asset",
      isContra: true, contraOf: foreignAccountId,
    }) as never);
    expect(crossCompany.ok).toBe(false);

    const unknown = await saveAccountAction(basePayload({
      code: `B5X4${suffix}`, name: "Kontra Yatim B5", type: "asset", section: "current_asset",
      isContra: true, contraOf: "01900000-0000-7000-8000-00000000ffff",
    }) as never);
    expect(unknown.ok).toBe(false);

    const row = await accountById(contraId);
    const self = await saveAccountAction(payloadFor(row!, { contraOf: contraId }) as never);
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.message).toContain("dirinya sendiri");
  });

  it("ubah: tag eksplisit menang, bidang tak terkirim mempertahankan tag lama, null mengosongkan", async () => {
    const id = await createOk({ code: CODE.keep, name: "Beban Simpan Tag B5" });
    let row = await accountById(id);
    const setFinancing = await saveAccountAction(payloadFor(row!, { psak118Category: "financing" }) as never);
    expect(setFinancing.ok).toBe(true);
    row = await accountById(id);
    expect(row?.psak118Category).toBe("financing");

    // Ubah nama saja — payload TANPA bidang tag (undefined) tidak
    // menimpa penyesuaian akuntan.
    const tanpaTag: Record<string, unknown> = { ...payloadFor(row!) };
    delete tanpaTag.psak118Category;
    delete tanpaTag.expenseNature;
    delete tanpaTag.expenseFunction;
    const rename = await saveAccountAction({ ...tanpaTag, name: "Beban Simpan Tag B5 Baru" } as never);
    expect(rename.ok).toBe(true);
    row = await accountById(id);
    expect(row?.psak118Category).toBe("financing");

    const cleared = await saveAccountAction(payloadFor(row!, { psak118Category: null }) as never);
    expect(cleared.ok).toBe(true);
    row = await accountById(id);
    expect(row?.psak118Category).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Seed demo                                                           */
/* ------------------------------------------------------------------ */

describe("A-27 B5 — seed demo tertag benar", () => {
  it("kategori, sifat, dan kontra bagan demo sesuai aturan", async () => {
    const rows = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.companyId, ORG_ID),
            inArray(accounts.code, ["110107", "400001", "440101", "400003", "5101", "510201", "510202", "600004", "600019", "720002", "600009", "720018", "120004", "12000603", "710005", "720017", "710015"]),
          ),
        ),
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const rev = byCode.get("400001");
    expect(rev?.psak118Category).toBe("operating");
    for (const code of ["440101", "400003"]) {
      expect(byCode.get(code)?.isContra).toBe(true);
      expect(byCode.get(code)?.contraOf).toBe(rev?.id);
      expect(byCode.get(code)?.psak118Category).toBe("operating");
    }
    expect(byCode.get("5101")).toMatchObject({ expenseNature: "inventory_expensed", expenseFunction: "cogs" });
    expect(byCode.get("510201")?.expenseNature).toBe("inventory_writedown");
    expect(byCode.get("510202")?.expenseNature).toBe("inventory_writedown");
    expect(byCode.get("600004")?.expenseNature).toBe("employee_benefits");
    expect(byCode.get("600009")?.expenseNature).toBe("employee_benefits");
    expect(byCode.get("720002")?.expenseNature).toBe("bank_charges");
    expect(byCode.get("720018")?.expenseNature).toBe("impairment");
    expect(byCode.get("600019")).toMatchObject({ expenseNature: "rent", expenseFunction: "admin" });
    expect(byCode.get("720017")?.psak118Category).toBe("operating");
    expect(byCode.get("710015")?.psak118Category).toBe("operating");
    expect(byCode.get("710005")?.psak118Category).toBe("operating");
    expect(byCode.get("12000603")?.isContra).toBe(true);
    expect(byCode.get("12000603")?.contraOf).toBe(byCode.get("120004")?.id);
    expect(byCode.get("110107")?.psak118Category).toBeNull();
    expect(byCode.get("120004")?.psak118Category).toBeNull();
  });
});
