import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  accounts,
  companySettings,
  fiscalPeriods,
  journalEntries,
  journalLines,
} from "@/db/schema";
import {
  approveJournalDraftAction,
  postManualJournalAction,
  rejectJournalDraftAction,
  saveJournalDraftAction,
} from "@/server/actions/accounting/jurnal";
import { todayISO } from "@/lib/format";
import { wipeCompanyFixture } from "../helpers/wipe-company";

const ORG = "01900000-0000-7000-8000-00000000d501";
const MAKER = "01900000-0000-7000-8000-00000000d511";
const CHECKER = "01900000-0000-7000-8000-00000000d512";
const CASH = "01900000-0000-7000-8000-00000000d521";
const EQUITY = "01900000-0000-7000-8000-00000000d522";
const DATE = todayISO();
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6);

const session = vi.hoisted(() => ({
  userId: "",
  role: "owner",
  permissions: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const { AppError } = await import("@/lib/errors");
  const requirePermission = async (permission: string) => {
    if (!session.permissions.includes(permission)) {
      throw new AppError("FORBIDDEN", `Izin ${permission} tidak dimiliki.`);
    }
    return {
      company: { id: ORG },
      user: { id: session.userId },
      role: session.role,
      permissions: session.permissions,
    };
  };
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

beforeAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [MAKER, CHECKER]);
  await adminDb.insert(accounts).values([
    { id: CASH, companyId: ORG, code: "1101", name: "Kas Approval", type: "asset", normalBalance: "debit" },
    { id: EQUITY, companyId: ORG, code: "3101", name: "Modal Approval", type: "equity", normalBalance: "credit" },
  ]);
  await adminDb.insert(companySettings).values({
    companyId: ORG,
    legalName: "PT Approval Uji",
    journalApprovalThreshold: "1000",
  });
  await adminDb.insert(fiscalPeriods).values(
    Array.from({ length: 12 }, (_, index) => ({
      companyId: ORG,
      year: Number(DATE.slice(0, 4)),
      month: index + 1,
      status: "open" as const,
    })),
  );
});

afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [MAKER, CHECKER]);
});

function lines() {
  return [
    { accountId: CASH, debit: "5000", description: "Kas masuk approval" },
    { accountId: EQUITY, credit: "5000", description: "Modal approval" },
  ];
}

describe("approval jurnal manual", () => {
  it("di atas ambang: membuat draf pending, bukan jurnal posted", async () => {
    session.userId = MAKER;
    session.role = "accountant";
    session.permissions = ["accounting.post"];

    const result = await postManualJournalAction({
      date: DATE,
      description: `Jurnal approval ${suffix}`,
      idempotencyKey: `approval-${suffix}`,
      lines: lines(),
    });
    if (!result.ok) console.log("APPROVE_ERROR", result);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("pendingApproval" in result.data && result.data.pendingApproval).toBe(true);

    const [draft] = await adminDb
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, result.data.id));
    expect(draft.status).toBe("draft");
    expect(draft.approvalStatus).toBe("pending");
    expect(draft.approvalRequestedAt).not.toBeNull();
    expect(draft.createdBy).toBe(MAKER);

    const edited = await saveJournalDraftAction({
      draftId: result.data.id,
      date: DATE,
      description: "Mencoba mengubah draf pending",
      lines: lines(),
    });
    expect(edited.ok).toBe(false);
    if (!edited.ok) expect(edited.code).toBe("INVALID_STATE");
  });

  it("pembuat tidak dapat menyetujui jurnalnya sendiri", async () => {
    session.userId = MAKER;
    session.role = "owner";
    session.permissions = ["accounting.post", "accounting.manage"];
    session.userId = MAKER;

    const posted = await postManualJournalAction({
      date: DATE,
      description: `Jurnal self approval ${suffix}`,
      idempotencyKey: `self-${suffix}`,
      lines: lines(),
    });
    if (!posted.ok || !("pendingApproval" in posted.data)) throw new Error("pending expected");
    const result = await approveJournalDraftAction({ entryId: posted.data.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FORBIDDEN");
  });

  it("pengguna lain dengan accounting.manage dapat menyetujui dan memposting", async () => {
    session.userId = CHECKER;
    session.role = "owner";
    session.permissions = ["accounting.manage"];

    const pending = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, ORG),
          eq(journalEntries.status, "draft"),
          eq(journalEntries.approvalStatus, "pending"),
        ),
      )
      .limit(1);
    expect(pending[0]).toBeDefined();

    const result = await approveJournalDraftAction({
      entryId: pending[0].id,
      note: "Disetujui uji",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [posted] = await adminDb
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, result.data.id));
    expect(posted.status).toBe("posted");
    expect(posted.approvalStatus).toBe("approved");
    expect(posted.approvedBy).toBe(CHECKER);
    expect(posted.approvalNote).toBe("Disetujui uji");

    const postedLines = await adminDb
      .select({ description: journalLines.description })
      .from(journalLines)
      .where(eq(journalLines.entryId, posted.id));
    expect(postedLines.map((line) => line.description)).toEqual(
      expect.arrayContaining(["Kas masuk approval", "Modal approval"]),
    );
  });

  it("penolakan menyimpan alasan dan tidak memposting", async () => {
    session.userId = MAKER;
    session.role = "accountant";
    session.permissions = ["accounting.post"];
    const created = await postManualJournalAction({
      date: DATE,
      description: `Jurnal reject ${suffix}`,
      idempotencyKey: `reject-${suffix}`,
      lines: lines(),
    });
    if (!created.ok || !("pendingApproval" in created.data)) throw new Error("pending expected");

    session.userId = CHECKER;
    session.role = "owner";
    session.permissions = ["accounting.manage"];
    const rejected = await rejectJournalDraftAction({
      entryId: created.data.id,
      note: "Bukti belum lengkap",
    });
    expect(rejected.ok).toBe(true);

    const [draft] = await adminDb
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, created.data.id));
    expect(draft.status).toBe("draft");
    expect(draft.approvalStatus).toBe("rejected");
    expect(draft.approvalNote).toBe("Bukti belum lengkap");
  });
});
