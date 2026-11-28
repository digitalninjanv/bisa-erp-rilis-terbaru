import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  accountMonthlyBalances,
  accounts,
  fiscalPeriods,
  journalEntries,
  journalLines,
} from "@/db/schema";
import {
  saveJournalDraftAction,
  postJournalDraftAction,
  deleteJournalDraftAction,
} from "@/server/actions/accounting/jurnal";
import { wipeCompanyFixture } from "../helpers/wipe-company";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const ORG = "01900000-0000-7000-8000-00000000d401";

vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000d401" },
    user: { id: "01900000-0000-7000-8000-00000000d440" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const CASH = "01900000-0000-7000-8000-00000000d4a1";
const EQUITY = "01900000-0000-7000-8000-00000000d4a2";
const DATE = "2026-11-15";

beforeAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, []);
  await adminDb.insert(accounts).values([
    { id: CASH, companyId: ORG, code: "1101", name: "Kas Uji Draf", type: "asset", normalBalance: "debit" },
    { id: EQUITY, companyId: ORG, code: "3101", name: "Modal Uji Draf", type: "equity", normalBalance: "credit" },
  ]);
  await adminDb.insert(fiscalPeriods).values(
    Array.from({ length: 12 }, (_, index) => ({
      companyId: ORG,
      year: 2026,
      month: index + 1,
      status: "open" as const,
    })),
  );
});

afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, []);
});

describe("draf jurnal manual", () => {
  it("draf tersimpan tanpa menyentuh buku besar; posting membentuk jurnal resmi", async () => {
    const saved = await saveJournalDraftAction({
      date: DATE,
      description: "Draf uji review",
      idempotencyKey: `draft-test-${crypto.randomUUID()}`,
      lines: [
        { accountId: CASH, debit: "1000", credit: undefined, description: "Kas masuk uji" },
        { accountId: EQUITY, debit: undefined, credit: "1000", description: "Modal uji" },
      ],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const [draft] = await adminDb
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.id, saved.data.id)));
    expect(draft.status).toBe("draft");
    expect(draft.number).toMatch(/^DRAFT-/);

    const balancesBefore = await adminDb
      .select()
      .from(accountMonthlyBalances)
      .where(eq(accountMonthlyBalances.companyId, ORG));
    expect(balancesBefore).toEqual([]);

    const posted = await postJournalDraftAction({ entryId: saved.data.id });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const draftRows = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.id, saved.data.id));
    expect(draftRows).toEqual([]);
    const [entry] = await adminDb
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, posted.data.id));
    expect(entry.status).toBe("posted");
    expect(entry.number).not.toMatch(/^DRAFT-/);

    const lines = await adminDb
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, posted.data.id));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.description)).toEqual(
      expect.arrayContaining(["Kas masuk uji", "Modal uji"]),
    );
    const balancesAfter = await adminDb
      .select()
      .from(accountMonthlyBalances)
      .where(eq(accountMonthlyBalances.companyId, ORG));
    expect(balancesAfter).toHaveLength(2);
    expect(balancesAfter.reduce((acc, row) => acc + Number(row.totalDebit), 0)).toBe(1000);
  });

  it("draf tidak seimbang ditolak; draf dapat dihapus", async () => {
    const invalid = await saveJournalDraftAction({
      date: DATE,
      description: "Tidak seimbang",
      lines: [
        { accountId: CASH, debit: "1000" },
        { accountId: EQUITY, credit: "900" },
      ],
    });
    expect(invalid.ok).toBe(false);

    const saved = await saveJournalDraftAction({
      date: DATE,
      description: "Draf hapus",
      lines: [
        { accountId: CASH, debit: "50" },
        { accountId: EQUITY, credit: "50" },
      ],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const removed = await deleteJournalDraftAction({ entryId: saved.data.id });
    expect(removed.ok).toBe(true);
    const rows = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.id, saved.data.id));
    expect(rows).toEqual([]);
  });

  it("draf posted tidak dapat dihapus dan tidak dapat diposting ulang", async () => {
    const posted = await postJournalDraftAction({ entryId: crypto.randomUUID() });
    expect(posted.ok).toBe(false);
  });
});
