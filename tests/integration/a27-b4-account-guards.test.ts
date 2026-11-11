import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountMappings,
  accounts,
  auditLog,
  customerGroups,
  journalLines,
  paymentMethods,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { postJournal, reverseJournalEntry } from "@/server/accounting";
import { getAccountImpact } from "@/server/account-impact";
import { listAccountBalances } from "@/server/reports";
import {
  saveAccountAction,
  saveMappingAction,
} from "@/server/actions/accounting/akun-pemetaan";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

/**
 * A-27 B4 — penjaga tulis bagan akun (menutup F-05/F-06 sisi tulis,
 * F-07, F-08, F-10):
 *
 * 1. Penonaktifan setara penjaga hapus utk IKATAN: akun terpetakan /
 *    terikat metode / akun diskon kelompok / induk sub-akun ditolak
 *    CONFLICT yang menamai ikatannya (sebelum B4: lolos diam-diam,
 *    reproduksi audit langkah 6).
 * 2. Penonaktifan bersaldo ≠ 0 wajib konfirmasi eksplisit; tidak ada
 *    jurnal otomatis pemindah saldo.
 * 3. Hierarki ditegakkan saat tulis: induk wajib header, akun beranak
 *    tidak boleh menjadi postable, dan siklus A↔B (reproduksi audit
 *    langkah 7) kini DITOLAK.
 * 4. Kode akun bertransaksi BOLEH diganti (jurnal mereferensikan
 *    accountId) dan tercatat di audit_log sebagai account.code_change;
 *    kode bentrok ditolak dgn pesan ramah; kode sama = no-op tak
 *    teraudit.
 * 5. Koherensi type↔section ditolak berpesan; pasangan koheren dan
 *    section kosong lolos.
 * 6. Mata uang akun bertransaksi tidak dapat diubah (RENCANA §2).
 * 7. getAccountImpact & isSystem turunan ikatan di model baca.
 *
 * Sesi dimock seperti a27-b3 (izin peran asli dari @/lib/permissions).
 * Fixture berkode unik per run. Jurnal fixture diposting sungguhan;
 * karena baris jurnal posted append-only (trigger DB), afterAll
 * membaliknya lewat reverseJournalEntry dan menonaktifkan kedua akun
 * jurnalnya — fixture lain dihapus sungguhan.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

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

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const CODE = {
  mapped: `B4M${suffix}`,
  method: `B4T${suffix}`,
  group: `B4G${suffix}`,
  parent: `B4P${suffix}`,
  child: `B4C${suffix}`,
  cycA: `B4A${suffix}`,
  cycB: `B4B${suffix}`,
  postable: `B4D${suffix}`,
  txn: `B4X${suffix}`,
  txnNew: `B4N${suffix}`,
  equity: `B4E${suffix}`,
  free: `B4F${suffix}`,
  bank2: `B4K${suffix}`,
  cohOk: `B4H${suffix}`,
  cohAuto: `B4I${suffix}`,
};
const METHOD_CODE = `B4PM${suffix}`;
const GROUP_NAME = `Grup Uji B4 ${suffix}`;
const MAPPING_KEY = "other_income";

const ids: Record<string, string> = {};
const createdEntryIds: string[] = [];
/** Penunjuk other_income demo SEBELUM ditimpa fixture (A-27 B6:
 * templat menanamnya → 71001; sebelum B6 memang belum ada). */
let previousMappedAccountId: string | null = null;

type AccountRow = typeof accounts.$inferSelect;

async function accountByCode(code: string): Promise<AccountRow | undefined> {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
      .limit(1);
    return row;
  });
}

/** Payload persis bentuk yang dikirim formulir akun (semua field). */
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
    description: row.description,
    isPostable: row.isPostable,
    isActive: row.isActive,
    ...overrides,
  };
}

async function createAccount(input: Record<string, unknown>): Promise<string> {
  const result = await saveAccountAction({
    name: "Akun Uji B4",
    type: "asset",
    normalBalance: "debit",
    parentId: null,
    section: "current_asset",
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
    ...input,
  } as never);
  if (!result.ok) throw new Error(`Buat akun gagal: ${result.message}`);
  return result.data.id;
}

beforeAll(async () => {
  ids.mapped = await createAccount({
    code: CODE.mapped,
    name: "Akun Terpetakan B4",
    type: "revenue",
    normalBalance: "credit",
    section: "other_income",
  });
  ids.method = await createAccount({ code: CODE.method, name: "Akun Metode B4" });
  ids.group = await createAccount({ code: CODE.group, name: "Akun Diskon Kelompok B4" });
  ids.parent = await createAccount({
    code: CODE.parent,
    name: "Header Uji B4",
    isPostable: false,
  });
  ids.child = await createAccount({
    code: CODE.child,
    name: "Anak Header B4",
    parentId: ids.parent,
  });
  ids.cycA = await createAccount({ code: CODE.cycA, name: "Siklus A B4", isPostable: false });
  ids.cycB = await createAccount({
    code: CODE.cycB,
    name: "Siklus B B4",
    isPostable: false,
    parentId: ids.cycA,
  });
  ids.postable = await createAccount({ code: CODE.postable, name: "Detail Postable B4" });
  ids.equity = await createAccount({
    code: CODE.equity,
    name: "Ekuitas Lawan B4",
    type: "equity",
    normalBalance: "credit",
    section: "equity",
  });
  ids.txn = await createAccount({
    code: CODE.txn,
    name: "Bank Uji B4",
    cashBankKind: "bank",
    bankName: "Bank Uji",
    bankAccountNumber: "9876543210",
    bankBranch: "Pusat",
    bankAccountHolder: "PT Uji B4",
    currency: "USD",
  });
  ids.free = await createAccount({ code: CODE.free, name: "Akun Bebas B4" });

  // Ikatan fixture: pemetaan (sejak A-27 B6 kunci other_income
  // SUDAH terpetakan di demo oleh templat — penunjuk aslinya
  // ditangkap di sini dan dipulihkan di afterAll), metode
  // pembayaran, dan akun diskon kelompok harga.
  previousMappedAccountId = await withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select({ accountId: accountMappings.accountId })
      .from(accountMappings)
      .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, MAPPING_KEY)))
      .limit(1);
    return row?.accountId ?? null;
  });
  const mapped = await saveMappingAction({ key: MAPPING_KEY, accountId: ids.mapped });
  if (!mapped.ok) throw new Error(`Pemetaan fixture gagal: ${mapped.message}`);
  await withCompany(ORG_ID, async (tx) => {
    await tx.insert(paymentMethods).values({
      companyId: ORG_ID,
      code: METHOD_CODE,
      name: "Metode Uji B4",
      type: "cash",
      accountId: ids.method,
    });
    await tx.insert(customerGroups).values({
      companyId: ORG_ID,
      name: GROUP_NAME,
      discountAccountId: ids.group,
    });
  });

  // Jurnal fixture: Bank Uji B4 (USD) bersaldo debit 500.000.
  await withCompany(ORG_ID, async (tx) => {
    const entry = await postJournal(tx, {
      companyId: ORG_ID,
      date: todayISO(),
      description: "Uji B4 — saldo awal akun bertransaksi",
      sourceType: "manual",
      createdBy: USER_ID,
      lines: [
        { accountId: ids.txn, debit: 500000 },
        { accountId: ids.equity, credit: 500000 },
      ],
    });
    createdEntryIds.push(entry.id);
  });
});

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    // Jurnal posted bersifat append-only (trigger DB melarang hapus):
    // jurnal fixture DIBALIK lewat jalur resmi reverseJournalEntry —
    // saldo kedua akun jurnal kembali nol — bukan dihapus. Akun yang
    // berbaris jurnal sesudah itu dinonaktifkan & dibiarkan sebagai
    // fixture inert (hilang pada reseed berikutnya); semua fixture
    // lain dihapus sungguhan.
    for (const entryId of createdEntryIds) {
      await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId,
        date: todayISO(),
        description: "Pembalikan jurnal fixture uji B4",
        createdBy: USER_ID,
      });
    }
    if (previousMappedAccountId) {
      // Pulihkan penunjuk templat yang ditimpa fixture (A-27 B6).
      await tx
        .insert(accountMappings)
        .values({ companyId: ORG_ID, key: MAPPING_KEY, accountId: previousMappedAccountId })
        .onConflictDoUpdate({
          target: [accountMappings.companyId, accountMappings.key],
          set: { accountId: previousMappedAccountId },
        });
    } else {
      await tx
        .delete(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, MAPPING_KEY)));
    }
    await tx
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.code, METHOD_CODE)));
    await tx
      .delete(customerGroups)
      .where(and(eq(customerGroups.companyId, ORG_ID), eq(customerGroups.name, GROUP_NAME)));
    const fixtureIds = Object.values(ids);
    if (fixtureIds.length > 0) {
      // Baris audit fixture TIDAK dihapus: audit_log append-only
      // (trigger DB) — sama seperti akun sungguhan yang terhapus pun
      // jejak auditnya tetap ada.
      const withLines = await tx
        .select({ accountId: journalLines.accountId })
        .from(journalLines)
        .where(
          and(eq(journalLines.companyId, ORG_ID), inArray(journalLines.accountId, fixtureIds)),
        );
      const journalAccountIds = new Set(withLines.map((row) => row.accountId));
      const deletable = fixtureIds.filter((id) => !journalAccountIds.has(id));
      if (deletable.length > 0) {
        await tx
          .delete(accounts)
          .where(and(eq(accounts.companyId, ORG_ID), inArray(accounts.id, deletable)));
      }
      const keepers = fixtureIds.filter((id) => journalAccountIds.has(id));
      if (keepers.length > 0) {
        await tx
          .update(accounts)
          .set({ isActive: false })
          .where(and(eq(accounts.companyId, ORG_ID), inArray(accounts.id, keepers)));
      }
    }
  });
});

describe("A-27 B4 — penonaktifan setara penjaga hapus (F-05)", () => {
  it("akun terpetakan ditolak CONFLICT yang menyebut pemetaannya", async () => {
    const row = await accountByCode(CODE.mapped);
    const result = await saveAccountAction(payloadFor(row!, { isActive: false }) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("belum dapat dinonaktifkan");
      expect(result.message).toContain("pemetaan akun");
      expect(result.message).toContain("Tunjuk ulang");
    }
    expect((await accountByCode(CODE.mapped))!.isActive).toBe(true);
  });

  it("akun terikat metode pembayaran ditolak dan menyebut metodenya", async () => {
    const row = await accountByCode(CODE.method);
    const result = await saveAccountAction(payloadFor(row!, { isActive: false }) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("metode pembayaran");
      expect(result.message).toContain(METHOD_CODE);
    }
  });

  it("akun diskon kelompok harga ditolak dan menyebut kelompoknya", async () => {
    const row = await accountByCode(CODE.group);
    const result = await saveAccountAction(payloadFor(row!, { isActive: false }) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("akun diskon kelompok harga");
      expect(result.message).toContain(GROUP_NAME);
    }
  });

  it("akun induk sub-akun ditolak dinonaktifkan", async () => {
    const row = await accountByCode(CODE.parent);
    const result = await saveAccountAction(payloadFor(row!, { isActive: false }) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("induk dari 1 sub-akun");
  });

  it("akun bersaldo tanpa konfirmasi ditolak; dengan konfirmasi lolos; tidak ada jurnal otomatis", async () => {
    const row = await accountByCode(CODE.txn);
    const before = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG_ID), eq(journalLines.accountId, ids.txn)));
      return rows.length;
    });

    const refused = await saveAccountAction(payloadFor(row!, { isActive: false }) as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.message).toContain("masih memiliki saldo");
      expect(refused.message).toContain("tidak memindahkan saldonya");
    }
    expect((await accountByCode(CODE.txn))!.isActive).toBe(true);

    const confirmed = await saveAccountAction(
      payloadFor(row!, { isActive: false, confirmDeactivateWithBalance: true }) as never,
    );
    expect(confirmed.ok).toBe(true);
    const after = await accountByCode(CODE.txn);
    expect(after!.isActive).toBe(false);
    // Saldo TIDAK berpindah: baris jurnal akun tetap persis seperti semula.
    const afterLines = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG_ID), eq(journalLines.accountId, ids.txn)));
      return rows.length;
    });
    expect(afterLines).toBe(before);

    // Aktifkan kembali untuk test berikutnya.
    const reactivated = await saveAccountAction(
      payloadFor(after!, { isActive: true }) as never,
    );
    expect(reactivated.ok).toBe(true);
  });

  it("akun bebas ikatan & tanpa saldo boleh dinonaktifkan tanpa konfirmasi", async () => {
    const row = await accountByCode(CODE.free);
    const result = await saveAccountAction(payloadFor(row!, { isActive: false }) as never);
    expect(result.ok).toBe(true);
    expect((await accountByCode(CODE.free))!.isActive).toBe(false);
  });
});

describe("A-27 B4 — hierarki ditegakkan saat tulis (F-06)", () => {
  it("induk yang masih postable ditolak saat akun anak dibuat", async () => {
    const result = await saveAccountAction({
      code: `B4Z${suffix}`,
      name: "Anak Dari Postable",
      type: "asset",
      normalBalance: "debit",
      parentId: ids.postable,
      section: "current_asset",
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
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("masih bisa dipakai posting");
    expect(await accountByCode(`B4Z${suffix}`)).toBeUndefined();
  });

  it("akun yang memiliki anak tidak boleh dijadikan postable", async () => {
    const row = await accountByCode(CODE.parent);
    const result = await saveAccountAction(payloadFor(row!, { isPostable: true }) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("tidak dapat dijadikan akun posting");
    expect((await accountByCode(CODE.parent))!.isPostable).toBe(false);
  });

  it("siklus induk A↔B (reproduksi audit langkah 7) kini ditolak", async () => {
    const rowA = await accountByCode(CODE.cycA);
    const result = await saveAccountAction(
      payloadFor(rowA!, { parentId: ids.cycB }) as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("lingkaran");
    expect((await accountByCode(CODE.cycA))!.parentId).toBeNull();
  });
});

describe("A-27 B4 — kode dapat diedit + mata uang terkunci oleh transaksi (F-05/F-08, §2)", () => {
  it("ganti kode akun bertransaksi lolos, jurnal tetap merujuk accountId, audit tercatat", async () => {
    const row = await accountByCode(CODE.txn);
    const result = await saveAccountAction(
      payloadFor(row!, { code: CODE.txnNew }) as never,
    );
    expect(result.ok).toBe(true);

    const renamed = await accountByCode(CODE.txnNew);
    expect(renamed!.id).toBe(ids.txn);
    expect(await accountByCode(CODE.txn)).toBeUndefined();

    const lines = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, ORG_ID), eq(journalLines.accountId, ids.txn))),
    );
    expect(lines.length).toBe(1);

    const audits = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.action, "account.code_change"),
            eq(auditLog.entityId, ids.txn),
          ),
        ),
    );
    expect(audits.length).toBe(1);
    expect((audits[0].before as { code: string }).code).toBe(CODE.txn);
    expect((audits[0].after as { code: string }).code).toBe(CODE.txnNew);
  });

  it("simpan tanpa perubahan kode = no-op: tidak ada audit code_change baru", async () => {
    const row = await accountByCode(CODE.txnNew);
    const result = await saveAccountAction(
      payloadFor(row!, { name: "Bank Uji B4 (nama baru)" }) as never,
    );
    expect(result.ok).toBe(true);
    const audits = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.action, "account.code_change"),
            eq(auditLog.entityId, ids.txn),
          ),
        ),
    );
    expect(audits.length).toBe(1);
  });

  it("ganti kode ke kode yang sudah dipakai ditolak dgn pesan ramah", async () => {
    const row = await accountByCode(CODE.txnNew);
    // A-27 B6: kode yang sudah dipakai di demo kini 11001 (Kas templat).
    const result = await saveAccountAction(payloadFor(row!, { code: "110107" }) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Kode akun tersebut sudah digunakan");
    }
    expect((await accountByCode(CODE.txnNew))!.code).toBe(CODE.txnNew);
  });

  it("mata uang akun bertransaksi tidak dapat diubah; akun bank baru tanpa jurnal boleh", async () => {
    const row = await accountByCode(CODE.txnNew);
    const refused = await saveAccountAction(payloadFor(row!, { currency: "EUR" }) as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("Mata uang akun");
    expect((await accountByCode(CODE.txnNew))!.currency).toBe("USD");

    ids.bank2 = await createAccount({
      code: CODE.bank2,
      name: "Bank Kedua B4",
      cashBankKind: "bank",
      bankName: "Bank Uji",
      bankAccountNumber: "111222333",
      currency: "USD",
    });
    const fresh = await accountByCode(CODE.bank2);
    const changed = await saveAccountAction(payloadFor(fresh!, { currency: "SGD" }) as never);
    expect(changed.ok).toBe(true);
    expect((await accountByCode(CODE.bank2))!.currency).toBe("SGD");
  });
});

describe("A-27 B4 — koherensi type↔section (F-10)", () => {
  it("pasangan tidak koheren ditolak berpesan (beban di kelompok aset)", async () => {
    const result = await saveAccountAction({
      code: `B4W${suffix}`,
      name: "Beban Nyasar",
      type: "expense",
      normalBalance: "debit",
      parentId: null,
      section: "current_asset",
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
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("tidak dapat masuk kelompok laporan");
    expect(await accountByCode(`B4W${suffix}`)).toBeUndefined();
  });

  it("pasangan koheren dan section kosong (otomatis) lolos", async () => {
    ids.cohOk = await createAccount({
      code: CODE.cohOk,
      name: "Beban Lain B4",
      type: "expense",
      section: "other_expense",
    });
    ids.cohAuto = await createAccount({
      code: CODE.cohAuto,
      name: "Aset Otomatis B4",
      section: null,
    });
    expect(await accountByCode(CODE.cohOk)).toBeDefined();
    expect((await accountByCode(CODE.cohAuto))!.section).toBeNull();
  });
});

describe("A-27 B4 — pratinjau dampak & akun sistem turunan (F-07)", () => {
  it("getAccountImpact melaporkan ikatan, baris jurnal, dan saldo dgn benar", async () => {
    const impact = await withCompanyReadOnly(ORG_ID, (tx) =>
      getAccountImpact(tx, ORG_ID, ids.mapped),
    );
    expect(impact).not.toBeNull();
    expect(impact!.isSystem).toBe(true);
    expect(impact!.mappingKeys.map((row) => row.key)).toContain(MAPPING_KEY);
    expect(impact!.journalLineCount).toBe(0);
    expect(d(impact!.balance).isZero()).toBe(true);

    const txnImpact = await withCompanyReadOnly(ORG_ID, (tx) =>
      getAccountImpact(tx, ORG_ID, ids.txn),
    );
    expect(txnImpact!.isSystem).toBe(false);
    expect(txnImpact!.journalLineCount).toBe(1);
    expect(d(txnImpact!.balance).eq(500000)).toBe(true);

    const parentImpact = await withCompanyReadOnly(ORG_ID, (tx) =>
      getAccountImpact(tx, ORG_ID, ids.parent),
    );
    expect(parentImpact!.children.map((row) => row.id)).toEqual([ids.child]);
  });

  it("listAccountBalances menandai isSystem hanya utk akun terikat", async () => {
    const rows = await withCompanyReadOnly(ORG_ID, (tx) => listAccountBalances(tx, ORG_ID));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.mapped)!.isSystem).toBe(true);
    expect(byId.get(ids.method)!.isSystem).toBe(true);
    expect(byId.get(ids.free)!.isSystem).toBe(false);
    // Kelompok harga BUKAN penanda sistem (hanya pemetaan ∪ metode).
    expect(byId.get(ids.group)!.isSystem).toBe(false);
  });
});
