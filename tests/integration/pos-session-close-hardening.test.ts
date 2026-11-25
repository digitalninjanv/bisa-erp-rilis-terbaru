import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  branches,
  cashSessions,
  companySettings,
  idempotencyKeys,
  journalEntries,
  journalLines,
  sales,
  user,
  warehouses,
} from "@/db/schema";
import { closeCashSession, issueReceiptPrintToken, openCashSession } from "@/server/pos";
import { d } from "@/lib/money";
import { withCompany } from "@/db/tenant";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";
import { adminDb } from "@/db/admin";

// A-28 Tahap 1 — pengerasan tutup sesi & struk POS:
//  H-POS-02: toleransi selisih terkonfigurasi + alasan wajib di
//    server (bukan hanya UI): di luar toleransi tanpa alasan →
//    ditolak VALIDATION & sesi tetap terbuka; dengan alasan →
//    tercatat di sesi & jurnal selisih terbit seperti sebelumnya.
//    Di dalam toleransi (termasuk tepat di batas) alasan opsional.
//  H-POS-04/05: cetak ulang nota (salinan=1) memuat pita "SALINAN";
//    cetakan asli tidak; identitas sesi tercetak pada keduanya.
// Bagian tutup sesi memakai transaksi rollback di perusahaan uji
// tersendiri (aa52); bagian struk memakai fixture ter-commit di
// perusahaan uji lain (aa53) karena halaman nota membaca lewat
// withCompany sungguhan — dibersihkan di afterAll.

vi.mock("@/lib/session", () => ({
  requirePermissionPage: async () => ({
    user: { id: "kasir-uji-salinan", name: "Sari Kasir" },
    company: { id: "01900000-0000-7000-8000-00000000aa53", name: "Uji Salinan" },
    permissions: ["pos.sell", "pos.receipt.reprint"],
  }),
  requireUser: async () => ({
    user: { id: "kasir-uji-salinan", name: "Sari Kasir" },
    company: { id: "01900000-0000-7000-8000-00000000aa53", name: "Uji Salinan" },
  }),
}));

const ORG = "01900000-0000-7000-8000-00000000aa52";
const KASIR_1 = "kasir-uji-tutup-1";
const KASIR_2 = "kasir-uji-tutup-2";
const KASIR_3 = "kasir-uji-tutup-3";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

async function ensureCompany(tx: Tx) {
  const [settings] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, ORG))
    .limit(1);
  if (settings) return;

  await tx.insert(user).values([
    { id: KASIR_1, name: "Kasir Satu", email: "kasir.satu@uji.local" },
    { id: KASIR_2, name: "Kasir Dua", email: "kasir.dua@uji.local" },
    { id: KASIR_3, name: "Kasir Tiga", email: "kasir.tiga@uji.local" },
  ]);
  await tx.insert(companySettings).values({ companyId: ORG, legalName: "Uji Tutup Sesi" });

  const accountRows = await tx
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "8000", name: "Selisih Kas Kurang", type: "expense", normalBalance: "debit" },
      { companyId: ORG, code: "8001", name: "Selisih Kas Lebih", type: "income", normalBalance: "credit" },
    ])
    .returning();
  const acc = new Map(accountRows.map((row) => [row.code, row.id]));
  await tx.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc.get("1000")! },
    { companyId: ORG, key: "bank", accountId: acc.get("1100")! },
    { companyId: ORG, key: "cash_short", accountId: acc.get("8000")! },
    { companyId: ORG, key: "cash_over", accountId: acc.get("8001")! },
  ]);
}

async function accountIdByCode(tx: Tx, code: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  return row.id;
}

/** Jumlah debit/kredit satu akun pada jurnal tutup sesi. */
async function sessionJournalSums(tx: Tx, sessionId: string) {
  const entries = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.sourceType, "cash_session"),
        eq(journalEntries.sourceId, sessionId),
      ),
    );
  const sums = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    const lines = await tx
      .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .where(eq(journalLines.entryId, entry.id));
    for (const line of lines) {
      const cur = sums.get(line.accountId) ?? { debit: 0, credit: 0 };
      cur.debit += d(line.debit).toNumber();
      cur.credit += d(line.credit).toNumber();
      sums.set(line.accountId, cur);
    }
  }
  return { entryCount: entries.length, sums };
}

describe("H-POS-02 — toleransi & alasan selisih tutup sesi (server)", () => {
  it("di luar toleransi bawaan Rp0 tanpa alasan: ditolak VALIDATION, sesi tetap terbuka; dengan alasan: tertutup, alasan & jurnal tercatat", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const session = await openCashSession(tx, {
        companyId: ORG,
        userId: KASIR_1,
        openingCash: 100_000,
      });

      let rejection: unknown;
      try {
        await closeCashSession(tx, {
          companyId: ORG,
          userId: KASIR_1,
          sessionId: session.id,
          countedCash: 95_000,
        });
      } catch (caught) {
        rejection = caught;
      }
      const [afterReject] = await tx
        .select({ status: cashSessions.status })
        .from(cashSessions)
        .where(eq(cashSessions.id, session.id));

      const closed = await closeCashSession(tx, {
        companyId: ORG,
        userId: KASIR_1,
        sessionId: session.id,
        countedCash: 95_000,
        differenceReason: "Kembalian kurang saat jam ramai",
      });
      const [stored] = await tx
        .select({ status: cashSessions.status, differenceReason: cashSessions.differenceReason })
        .from(cashSessions)
        .where(eq(cashSessions.id, session.id));
      const journal = await sessionJournalSums(tx, session.id);
      const shortId = await accountIdByCode(tx, "8000");
      const cashId = await accountIdByCode(tx, "1000");
      return { rejection, afterReject, closed, stored, journal, shortId, cashId };
    });

    expect(outcome.rejection).toMatchObject({ code: "VALIDATION" });
    expect((outcome.rejection as Error).message).toMatch(/Alasan selisih wajib diisi/);
    expect(outcome.afterReject.status).toBe("open");
    expect(outcome.closed.difference).toBe(-5_000);
    expect(outcome.stored.status).toBe("closed");
    expect(outcome.stored.differenceReason).toBe("Kembalian kurang saat jam ramai");
    // Perilaku posting selisih TIDAK berubah: Dr Selisih Kurang / Cr Kas.
    expect(outcome.journal.entryCount).toBe(1);
    expect(outcome.journal.sums.get(outcome.shortId)?.debit).toBe(5_000);
    expect(outcome.journal.sums.get(outcome.cashId)?.credit).toBe(5_000);
  });

  it("toleransi terkonfigurasi Rp5.000: selisih 3.000 & tepat 5.000 lolos tanpa alasan; 6.000 ditolak", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      await tx
        .update(companySettings)
        .set({ posSessionDifferenceTolerance: "5000" })
        .where(eq(companySettings.companyId, ORG));

      const s1 = await openCashSession(tx, { companyId: ORG, userId: KASIR_1, openingCash: 100_000 });
      const within = await closeCashSession(tx, {
        companyId: ORG,
        userId: KASIR_1,
        sessionId: s1.id,
        countedCash: 97_000,
      });
      const [storedWithin] = await tx
        .select({ differenceReason: cashSessions.differenceReason })
        .from(cashSessions)
        .where(eq(cashSessions.id, s1.id));

      const s2 = await openCashSession(tx, { companyId: ORG, userId: KASIR_2, openingCash: 100_000 });
      const atBoundary = await closeCashSession(tx, {
        companyId: ORG,
        userId: KASIR_2,
        sessionId: s2.id,
        countedCash: 95_000,
      });

      const s3 = await openCashSession(tx, { companyId: ORG, userId: KASIR_3, openingCash: 100_000 });
      let rejection: unknown;
      try {
        await closeCashSession(tx, {
          companyId: ORG,
          userId: KASIR_3,
          sessionId: s3.id,
          countedCash: 94_000,
        });
      } catch (caught) {
        rejection = caught;
      }
      return { within, storedWithin, atBoundary, rejection };
    });

    expect(outcome.within.difference).toBe(-3_000);
    expect(outcome.storedWithin.differenceReason).toBeNull();
    expect(outcome.atBoundary.difference).toBe(-5_000);
    expect(outcome.rejection).toMatchObject({ code: "VALIDATION" });
  });

  it("selisih nol tanpa alasan selalu lolos dan tanpa jurnal selisih", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await ensureCompany(tx);
      const session = await openCashSession(tx, {
        companyId: ORG,
        userId: KASIR_1,
        openingCash: 50_000,
      });
      const closed = await closeCashSession(tx, {
        companyId: ORG,
        userId: KASIR_1,
        sessionId: session.id,
        countedCash: 50_000,
      });
      const journal = await sessionJournalSums(tx, session.id);
      return { closed, journal };
    });
    expect(outcome.closed.difference).toBe(0);
    expect(outcome.journal.entryCount).toBe(0);
  });
});

// ---------------------------------------------------------------------
// H-POS-04/05 — struk: pita SALINAN hanya pada cetak ulang.
// ---------------------------------------------------------------------

const COPY_ORG = "01900000-0000-7000-8000-00000000aa53";
const COPY_KASIR = "kasir-uji-salinan";
const COPY_SESSION_ID = "01900000-0000-7000-8000-000000000551";
const COPY_SALE_ID = "01900000-0000-7000-8000-000000000552";

describe("H-POS-04/05 — struk salinan & identitas sesi", () => {
  async function cleanupCopyFixture() {
    await adminDb.delete(sales).where(eq(sales.companyId, COPY_ORG));
    await adminDb.delete(warehouses).where(eq(warehouses.companyId, COPY_ORG));
    await adminDb.delete(branches).where(eq(branches.companyId, COPY_ORG));
    await adminDb.delete(companySettings).where(eq(companySettings.companyId, COPY_ORG));
    await adminDb.delete(idempotencyKeys).where(eq(idempotencyKeys.companyId, COPY_ORG));
    await adminDb.delete(user).where(eq(user.id, COPY_KASIR));
  }

  beforeAll(async () => {
    // Fixture ter-commit ditulis lewat adminDb (koneksi owner
    // @/db/admin, memotong RLS); halaman nota sendiri tetap membaca
    // lewat withCompany (app_user) seperti produksi.
    await cleanupCopyFixture();
    await adminDb.insert(user).values({ id: COPY_KASIR, name: "Sari Kasir", email: "sari.kasir@uji.local" });
    await adminDb.insert(companySettings).values({ companyId: COPY_ORG, legalName: "Uji Salinan" });
    await adminDb.insert(branches).values({ companyId: COPY_ORG, code: "SLN", name: "Cabang Salinan", isDefault: true });
    const [warehouse] = await adminDb
      .insert(warehouses)
      .values({ companyId: COPY_ORG, code: "GD-SLN", name: "Gudang Salinan", type: "warehouse", isDefault: true })
      .returning();
    await adminDb.insert(sales).values({
      id: COPY_SALE_ID,
      companyId: COPY_ORG,
      warehouseId: warehouse.id,
      number: "INV-UJI-SALINAN-001",
      date: "2026-11-07",
      cashierId: COPY_KASIR,
      sessionId: COPY_SESSION_ID,
      status: "completed",
      subtotal: "150000",
      total: "150000",
      paidTotal: "150000",
    });
  });

  afterAll(cleanupCopyFixture);

  async function renderNota(searchParams: Record<string, string>) {
    const { default: ReceiptPage } = await import("@/app/app/pos/nota/[id]/page");
    const element = await ReceiptPage({
      params: Promise.resolve({ id: COPY_SALE_ID }),
      searchParams: Promise.resolve(searchParams),
    });
    return renderToStaticMarkup(element as ReactElement);
  }

  it("cetak ulang (salinan=1) memuat pita SALINAN dan identitas sesi", async () => {
    const html = await renderNota({ salinan: "1" });
    expect(html).toContain("Salinan — bukan nota asli");
    expect(html).toContain("Sesi");
    expect(html).toContain("01900000");
  });

  it("cetakan asli tanpa parameter salinan TIDAK bertanda, identitas sesi tetap tercetak", async () => {
    const html = await renderNota({});
    expect(html).not.toContain("Salinan — bukan nota asli");
    expect(html).toContain("01900000");
  });

  it("token cetak pertama dari checkout diterima sebagai nota asli", async () => {
    const token = await withCompany(COPY_ORG, (tx) =>
      issueReceiptPrintToken(tx, {
        companyId: COPY_ORG,
        userId: COPY_KASIR,
        saleId: COPY_SALE_ID,
      }),
    );
    const html = await renderNota({ printToken: token });
    expect(html).not.toContain("Salinan — bukan nota asli");
    expect(html).toContain("INV-UJI-SALINAN-001");
    expect(html).toContain("01900000");
  });
});
