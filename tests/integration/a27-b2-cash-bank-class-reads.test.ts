import { describe, expect, it } from "vitest";
import { accounts } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getAccountMap,
  listCashBankAccounts,
  listCashBankIds,
  listPaymentAccounts,
} from "@/server/accounting";
import { listReconciliationAccounts } from "@/server/bank-reconciliation/accounts";
import { assertCashLikeAccount } from "@/server/employee-advances";
import { getHomeSummary } from "@/server/reports/home";
import { listAccountBalances } from "@/server/reports";
import { todayISO } from "@/lib/format";
import { AppError } from "@/lib/errors";
import {
  makeRollbackTransaction,
  type Tx,
} from "../helpers/rollback-transaction";

/**
 * A-27 B2 — keanggotaan kas/bank dari KELAS akun (menutup F-01/F-03/
 * F-04 sisi baca):
 *
 * 1. Paritas demo: himpunan pemetaan lama (cash/bank/qris) =
 *    [11001, 11011, 11061]; himpunan kelas sesudah B1+B2 = 11 akun
 *    berkelas templat (kas, kas kecil, bank contoh, settlement &
 *    suspense) — Kas Kecil masuk adalah perbaikan F-03 yang
 *    disengaja. (Kode diperbarui di A-27 B6: demo beralih ke
 *    templat 5 digit; himpunan kelasnya kini berisi seluruh akun
 *    berkelas templat, bukan hanya empat akun bagan lama.)
 *    Penunjuk BAWAAN (pemetaan cash/bank/qris) tidak berubah.
 * 2. Daftar rekonsiliasi murni kelas: 1200 Piutang Usaha & 2300
 *    Kredit Pelanggan (yang dulu masuk lewat gabungan metode
 *    pembayaran, F-04) tidak lagi tercantum.
 * 3. Perusahaan fixture TANPA pemetaan sama sekali: bank kedua
 *    berkelas langsung menjadi anggota himpunan (baca, rekonsiliasi,
 *    validator) — inti perbaikan F-01; akun berkelas yang nonaktif/
 *    non-postable dan akun tanpa kelas tetap di luar.
 */

const DEMO_ID = "01900000-0000-7000-8000-000000000001";
const COMPANY_B2 = "01900000-0000-7000-8000-00000000b227";
const rollbackB2 = makeRollbackTransaction(COMPANY_B2);

const DEMO_CLASS_CODES = [
  "110101", "11010201", "11010202", "11010203", "110103", "110104",
  "110105", "110106", "110107", "110108", "110201",
];
const DEMO_CLASS_KINDS = [
  "cash", "bank", "bank", "bank", "bank", "cash",
  "bank", "clearing", "cash", "clearing", "bank",
];

describe("A-27 B2 — paritas himpunan demo", () => {
  it("sebelum (pemetaan) [11010201,110107,110108]; sesudah (kelas) 11 akun templat; bawaan tetap", async () => {
    await withCompanyReadOnly(DEMO_ID, async (tx) => {
      // Himpunan lama, dirakit seperti sebelum B2: tiga akun penunjuk
      // pemetaan cash/bank/qris.
      const map = await getAccountMap(tx, DEMO_ID);
      const codeById = new Map(
        (await tx.select({ id: accounts.id, code: accounts.code }).from(accounts)).map(
          (row) => [row.id, row.code] as const,
        ),
      );
      const beforeCodes = ["cash", "bank", "qris"]
        .map((key) => map[key])
        .filter(Boolean)
        .map((id) => codeById.get(id))
        .sort();
      expect(beforeCodes).toEqual(["11010201", "110107", "110108"]);
      // Penunjuk BAWAAN: kas sesi POS, bank bawaan, penampung QRIS.
      expect(codeById.get(map.cash)).toBe("110107");
      expect(codeById.get(map.bank)).toBe("11010201");
      expect(codeById.get(map.qris)).toBe("110108");

      const rows = await listCashBankAccounts(tx, DEMO_ID);
      expect(rows.map((row) => row.code)).toEqual(DEMO_CLASS_CODES);
      expect(rows.map((row) => row.cashBankKind)).toEqual(DEMO_CLASS_KINDS);

      const ids = await listCashBankIds(tx, DEMO_ID);
      expect(ids).toEqual(new Set(rows.map((row) => row.id)));

      const paymentAccounts = await listPaymentAccounts(tx, DEMO_ID);
      expect(new Set(paymentAccounts.map((row) => row.id))).toEqual(ids);
    });
  });

  it("daftar rekonsiliasi demo = himpunan kelas; piutang & kredit pelanggan tidak tercantum (F-04)", async () => {
    await withCompanyReadOnly(DEMO_ID, async (tx) => {
      const rows = await listReconciliationAccounts(tx, DEMO_ID);
      const codes = rows.map((row) => row.code);
      expect(codes).toEqual(DEMO_CLASS_CODES);
      expect(codes).not.toContain("110301"); // Piutang Usaha (metode CREDIT)
      expect(codes).not.toContain("210205"); // Kredit Pelanggan (metode CUSTCREDIT)
    });
  });

  it("total kas dashboard = agregat akun berkelas templat", async () => {
    await withCompanyReadOnly(DEMO_ID, async (tx) => {
      const summary = await getHomeSummary(tx, DEMO_ID, todayISO());
      const balances = await listAccountBalances(tx, DEMO_ID);
      const expected = balances
        .filter((row) => DEMO_CLASS_CODES.includes(row.code))
        .reduce((acc, row) => acc + row.balance, 0);
      expect(summary.cashBalance).toBeCloseTo(expected, 4);
    });
  });
});

describe("A-27 B2 — bank kedua berkelas tanpa pemetaan (inti F-01)", () => {
  async function insertAccount(
    tx: Tx,
    input: {
      code: string;
      name: string;
      cashBankKind?: string | null;
      isPostable?: boolean;
      isActive?: boolean;
    },
  ) {
    const [row] = await tx
      .insert(accounts)
      .values({
        companyId: COMPANY_B2,
        code: input.code,
        name: input.name,
        type: "asset",
        normalBalance: "debit",
        cashBankKind: input.cashBankKind ?? null,
        isPostable: input.isPostable ?? true,
        isActive: input.isActive ?? true,
      })
      .returning();
    expect(row).toBeDefined();
    return row;
  }

  it("akun berkelas bank/cash menjadi anggota; nonaktif, non-postable, dan tanpa kelas tidak", async () => {
    await rollbackB2(async (tx) => {
      const bank2 = await insertAccount(tx, {
        code: "B2BNK",
        name: "Bank Kedua Uji B2",
        cashBankKind: "bank",
      });
      const kas = await insertAccount(tx, {
        code: "B2KAS",
        name: "Kas Uji B2",
        cashBankKind: "cash",
      });
      const nonaktif = await insertAccount(tx, {
        code: "B2OFF",
        name: "Bank Nonaktif Uji B2",
        cashBankKind: "bank",
        isActive: false,
      });
      const induk = await insertAccount(tx, {
        code: "B2HDR",
        name: "Induk Kas Uji B2",
        cashBankKind: "cash",
        isPostable: false,
      });
      const polos = await insertAccount(tx, { code: "B2PLN", name: "Akun Polos Uji B2" });

      // Perusahaan ini TANPA satu pun baris pemetaan — keanggotaan
      // murni dari kelas.
      const rows = await listCashBankAccounts(tx, COMPANY_B2);
      expect(rows.map((row) => row.code)).toEqual(["B2BNK", "B2KAS"]);

      const ids = await listCashBankIds(tx, COMPANY_B2);
      expect(ids.has(bank2.id)).toBe(true);
      expect(ids.has(kas.id)).toBe(true);
      expect(ids.has(nonaktif.id)).toBe(false);
      expect(ids.has(induk.id)).toBe(false);
      expect(ids.has(polos.id)).toBe(false);

      const reconciliation = await listReconciliationAccounts(tx, COMPANY_B2);
      expect(reconciliation.map((row) => row.code)).toEqual(["B2BNK", "B2KAS"]);

      // Validator bersama (kasbon/pinjaman/klaim/beban/transfer/
      // pembayaran utang) menerima bank kedua, menolak akun polos.
      await expect(assertCashLikeAccount(tx, COMPANY_B2, bank2.id)).resolves.toBeUndefined();
      await expect(assertCashLikeAccount(tx, COMPANY_B2, polos.id)).rejects.toBeInstanceOf(
        AppError,
      );
    });
  });
});
