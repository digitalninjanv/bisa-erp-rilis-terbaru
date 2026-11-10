import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { accounts, paymentMethods } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { getAccountMap, listCashBankAccounts } from "@/server/accounting";
import { listReconciliationAccounts } from "@/server/bank-reconciliation/accounts";
import { createBankTransfer } from "@/server/bank-transfers";
import { saveAccountAction } from "@/server/actions/accounting/akun-pemetaan";
import {
  savePaymentMethodAction,
  updatePaymentMethodAction,
} from "@/server/actions/settings/pembayaran";
import { todayISO } from "@/lib/format";
import { rollbackTransaction } from "../helpers/rollback-transaction";

/**
 * A-27 B3 — uji asap "tambah bank satu langkah" (menutup F-02/F-09
 * sisi tulis):
 *
 * 1. Bank kedua (Mandiri) dibuat lewat saveAccountAction dengan
 *    kelas "bank" + rincian — tersimpan ke kolom B1, section menjadi
 *    current_asset.
 * 2. Tanpa menyentuh pemetaan `bank` (tetap Bank BCA), bank baru:
 *    anggota listCashBankAccounts, masuk daftar rekonsiliasi, lolos
 *    validator transfer antar bank (createBankTransfer BCA→Mandiri
 *    di transaksi rollback), dan dapat ditaut metode Transfer baru
 *    lewat savePaymentMethodAction.
 * 3. Validasi server bernama: kelas bank tanpa rincian ditolak;
 *    kelas pada tipe non-aset ditolak; metode bank→akun kas ditolak;
 *    metode qris→akun bank ditolak; metode→akun hantu ditolak;
 *    metode kredit→selain pemetaan piutang ditolak, →piutang lolos.
 *
 * Sesi dimock seperti payment-method-crud.test.ts (izin peran asli
 * dari @/lib/permissions). Fixture memakai akhiran unik per run dan
 * dibersihkan di afterAll; transfer berjalan di transaksi rollback
 * sehingga akun fixture tidak pernah memiliki baris jurnal.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const GHOST_ID = "01900000-0000-7000-8000-00000000dead";
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const BANK_CODE = `B3BNK${suffix}`;
const METHOD_CODE = `B3TRF${suffix}`;
const CREDIT_METHOD_CODE = `B3CRD${suffix}`;

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

let bcaId = "";
let kasId = "";
let qrisId = "";
let receivableId = "";
let mandiriId = "";
let methodId = "";

async function accountByCode(code: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
      .limit(1);
    return row ?? null;
  });
}

beforeAll(async () => {
  session.role = "owner";
  // A-27 B6: akun demo kini berkode templat 5 digit.
  bcaId = (await accountByCode("11010201"))!.id;
  kasId = (await accountByCode("110107"))!.id;
  qrisId = (await accountByCode("110108"))!.id;
  receivableId = (await accountByCode("110301"))!.id;

  // Jaring pengaman sisa run terputus.
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), like(paymentMethods.code, "B3%")));
    await tx
      .delete(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), like(accounts.code, "B3%")));
  });
});

afterAll(async () => {
  session.role = "owner";
  await withCompany(ORG_ID, async (tx) => {
    await tx
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), like(paymentMethods.code, "B3%")));
    await tx
      .delete(accounts)
      .where(and(eq(accounts.companyId, ORG_ID), like(accounts.code, "B3%")));
  });
});

describe("A-27 B3 — validasi formulir akun khusus kelas", () => {
  it("kelas bank tanpa nama bank/nomor rekening ditolak bernama", async () => {
    const result = await saveAccountAction({
      code: `B3BAD${suffix}`,
      name: "Bank Tanpa Rincian",
      type: "asset",
      normalBalance: "debit",
      cashBankKind: "bank",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toContain("nama bank dan nomor rekening");
    }
    expect(await accountByCode(`B3BAD${suffix}`)).toBeNull();
  });

  it("akun berkelas dengan tipe non-aset ditolak", async () => {
    const result = await saveAccountAction({
      code: `B3BAD${suffix}`,
      name: "Kas Bertipe Liabilitas",
      type: "liability",
      normalBalance: "credit",
      cashBankKind: "cash",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("bertipe Aset");
  });

  it("akun berkelas dengan section non-aset-lancar ditolak", async () => {
    const result = await saveAccountAction({
      code: `B3BAD${suffix}`,
      name: "Bank Di Aset Tetap",
      type: "asset",
      normalBalance: "debit",
      section: "non_current_asset",
      cashBankKind: "bank",
      bankName: "Mandiri",
      bankAccountNumber: "1370099999999",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Aset Lancar");
  });
});

describe("A-27 B3 — tambah bank satu langkah, ujung ke ujung", () => {
  it("buat akun Bank Mandiri berkelas bank lewat aksi resmi; rincian tersimpan", async () => {
    const result = await saveAccountAction({
      code: BANK_CODE,
      name: "Bank Mandiri Uji B3",
      type: "asset",
      normalBalance: "debit",
      cashBankKind: "bank",
      bankName: "Mandiri",
      bankAccountNumber: "1370012345678",
      bankBranch: "KCP Uji B3",
      bankAccountHolder: "Bisa Minimarket",
      currency: "IDR",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    mandiriId = result.data.id;

    const row = await accountByCode(BANK_CODE);
    expect(row).not.toBeNull();
    expect(row!.cashBankKind).toBe("bank");
    expect(row!.section).toBe("current_asset"); // kosong → koherensi kelas
    expect(row!.bankName).toBe("Mandiri");
    expect(row!.bankAccountNumber).toBe("1370012345678");
    expect(row!.bankBranch).toBe("KCP Uji B3");
    expect(row!.bankAccountHolder).toBe("Bisa Minimarket");
    expect(row!.currency).toBe("IDR");
  });

  it("bank baru anggota kas/bank & rekonsiliasi; BCA tetap anggota; pemetaan bank tetap BCA", async () => {
    await withCompanyReadOnly(ORG_ID, async (tx) => {
      const set = await listCashBankAccounts(tx, ORG_ID);
      const ids = set.map((row) => row.id);
      expect(ids).toContain(mandiriId);
      expect(ids).toContain(bcaId);
      expect(ids).toContain(kasId);
      expect(ids).toContain(qrisId);
      expect(set.find((row) => row.id === mandiriId)?.cashBankKind).toBe("bank");

      const reconciliation = await listReconciliationAccounts(tx, ORG_ID);
      expect(reconciliation.map((row) => row.id)).toContain(mandiriId);
      expect(reconciliation.map((row) => row.id)).toContain(bcaId);

      // Penunjuk BAWAAN tidak direbut: pemetaan bank tetap BCA.
      const map = await getAccountMap(tx, ORG_ID);
      expect(map.bank).toBe(bcaId);
      expect(map.cash).toBe(kasId);
    });
  });

  it("validator transfer antar bank menerima bank baru (transfer BCA→Mandiri, rollback)", async () => {
    const transfer = await rollbackTransaction(ORG_ID, async (tx) =>
      createBankTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: todayISO(),
        fromAccountId: bcaId,
        toAccountId: mandiriId,
        amount: "250000",
      }),
    );
    expect(transfer.id).toBeTruthy();
    expect(transfer.number).toBeTruthy();
  });

  it("metode Transfer baru dapat menaut bank baru tanpa merebut pemetaan", async () => {
    const result = await savePaymentMethodAction({
      code: METHOD_CODE,
      name: "Transfer Mandiri Uji B3",
      type: "bank",
      accountId: mandiriId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    methodId = result.data.id;

    const map = await withCompanyReadOnly(ORG_ID, async (tx) => getAccountMap(tx, ORG_ID));
    expect(map.bank).toBe(bcaId);
  });
});

describe("A-27 B3 — validasi akun metode pembayaran di server (F-09)", () => {
  it("metode bank → akun berkelas kas ditolak bernama", async () => {
    const result = await savePaymentMethodAction({
      code: `B3X1${suffix}`,
      name: "Transfer Ke Kas",
      type: "bank",
      accountId: kasId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toContain("berkelas Bank");
    }
  });

  it("metode qris → akun berkelas bank ditolak (wajib clearing)", async () => {
    const result = await savePaymentMethodAction({
      code: `B3X2${suffix}`,
      name: "QRIS Ke Bank",
      type: "qris",
      accountId: mandiriId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Kliring/Settlement");
  });

  it("metode → akun yang tidak ada ditolak", async () => {
    const result = await savePaymentMethodAction({
      code: `B3X3${suffix}`,
      name: "Metode Hantu",
      type: "bank",
      accountId: GHOST_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("tidak ditemukan");
  });

  it("metode kredit → selain akun pemetaan piutang ditolak; → piutang lolos", async () => {
    const wrong = await savePaymentMethodAction({
      code: `B3X4${suffix}`,
      name: "Kredit Ke Bank",
      type: "credit",
      accountId: mandiriId,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toContain("Piutang usaha");

    const ok = await savePaymentMethodAction({
      code: CREDIT_METHOD_CODE,
      name: "Kredit Uji B3",
      type: "credit",
      accountId: receivableId,
    });
    expect(ok.ok).toBe(true);
  });

  it("ubah metode: akun tak sekelas ditolak, akun bank lain sekelas lolos", async () => {
    const wrong = await updatePaymentMethodAction({
      id: methodId,
      name: "Transfer Mandiri Uji B3",
      type: "bank",
      accountId: qrisId,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toContain("berkelas Bank");

    const ok = await updatePaymentMethodAction({
      id: methodId,
      name: "Transfer Mandiri Uji B3",
      type: "bank",
      accountId: bcaId,
    });
    expect(ok.ok).toBe(true);

    // Kembalikan ke Mandiri agar keadaan akhir sesuai judul tahap.
    const back = await updatePaymentMethodAction({
      id: methodId,
      name: "Transfer Mandiri Uji B3",
      type: "bank",
      accountId: mandiriId,
    });
    expect(back.ok).toBe(true);
  });
});
