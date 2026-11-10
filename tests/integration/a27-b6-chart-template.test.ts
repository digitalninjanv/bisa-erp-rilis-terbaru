import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { getAccountMap, listCashBankAccounts, seedChartOfAccounts } from "@/server/accounting";
import { ACCOUNT_MAPPING_KEYS } from "@/lib/akuntansi/account-mappings";
import { CHART_TEMPLATE } from "@/lib/akuntansi/chart-template";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * Kontrak bagan akun referensi (cutover 2026-11-09):
 *
 * 1. Perusahaan fixture BARU: seedChartOfAccounts menanam 141 akun
 *    (126 akun file referensi + 15 akun operasional) + 37 pemetaan;
 *    penanaman kedua ditolak CONFLICT.
 * 2. Paritas neraca saldo: jurnal yang sama dengan seed demo
 *    (kas/persediaan/ekuitas + saldo awal pihak) menghasilkan angka
 *    per tipe yang sama — yang berubah hanya kode/nama akun.
 * 3. Perusahaan DEMO: seluruh akun templat ada, dan penunjuk
 *    cash/bank/qris/fixed asset menunjuk kode referensi yang benar.
 */

const DEMO_ID = "01900000-0000-7000-8000-000000000001";
const COMPANY_B6 = "01900000-0000-7000-8000-00000000b627";
const rollbackB6 = makeRollbackTransaction(COMPANY_B6);

const EXPECTED_CASH_BANK_CODES = [
  "110101",
  "11010201",
  "11010202",
  "11010203",
  "110103",
  "110104",
  "110105",
  "110106",
  "110107",
  "110108",
  "110201",
];

describe("Kontrak bagan akun referensi — penanaman di perusahaan baru", () => {
  it("141 akun + 37 pemetaan tertanam; hierarki & kontra terhubung; penanaman ulang ditolak", async () => {
    await rollbackB6(async (tx) => {
      const mapping = await seedChartOfAccounts(tx, COMPANY_B6);
      expect(Object.keys(mapping)).toHaveLength(37);
      expect(new Set(Object.keys(mapping))).toEqual(new Set(ACCOUNT_MAPPING_KEYS));

      const rows = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, COMPANY_B6));
      expect(rows).toHaveLength(141);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const byCode = new Map(rows.map((row) => [row.code, row]));

      // Semua non-postable adalah header (punya anak).
      expect(rows.filter((row) => !row.isPostable)).toHaveLength(20);
      for (const row of rows) {
        if (row.parentId) {
          const parent = byId.get(row.parentId);
          expect(parent, `induk ${row.code}`).toBeDefined();
          expect(parent!.isPostable).toBe(false);
          expect(parent!.companyId).toBe(COMPANY_B6);
        }
      }

      // Kontra terhubung ke akun pasangannya (id, bukan kode).
      expect(byCode.get("12000603")!.isContra).toBe(true);
      expect(byCode.get("12000603")!.contraOf).toBe(byCode.get("120004")!.id);
      expect(byCode.get("440101")!.contraOf).toBe(byCode.get("400001")!.id);
      expect(byCode.get("400003")!.contraOf).toBe(byCode.get("400001")!.id);

      // Tag eksplisit yang tidak bisa ditebak dari tipe/section.
      expect(byCode.get("710002")!.psak118Category).toBe("investing");
      expect(byCode.get("720001")!.psak118Category).toBe("financing");
      expect(byCode.get("600017")!.psak118Category).toBe("income_tax");
      expect(byCode.get("600019")!.psak118Category).toBe("operating");
      expect(byCode.get("110107")!.psak118Category).toBeNull();

      // Kunci pemetaan yang dulu ditanam malas kini ikut templat.
      expect(mapping.fixed_asset).toBe(byCode.get("120004")!.id);
      expect(mapping.accumulated_depreciation).toBe(byCode.get("12000603")!.id);
      expect(mapping.depreciation_expense).toBe(byCode.get("600023")!.id);
      expect(mapping.salary_deductions_payable).toBe(byCode.get("210209")!.id);
      expect(mapping.employee_loan_receivable).toBe(byCode.get("110305")!.id);
      expect(mapping.other_income).toBe(byCode.get("710005")!.id);

      const cashBank = await listCashBankAccounts(tx, COMPANY_B6);
      expect(cashBank.map((row) => row.code)).toEqual(EXPECTED_CASH_BANK_CODES);

      await expect(seedChartOfAccounts(tx, COMPANY_B6)).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("neraca saldo per tipe dari jurnal seed identik dengan baseline", async () => {
    await rollbackB6(async (tx) => {
      const mapping = await seedChartOfAccounts(tx, COMPANY_B6);
      const journals: Array<Array<{ accountId: string; debit: string; credit: string }>> = [
        [
          { accountId: mapping.cash, debit: "50000000", credit: "0" },
          { accountId: mapping.inventory, debit: "28349600", credit: "0" },
          { accountId: mapping.equity, debit: "0", credit: "78349600" },
        ],
        [
          { accountId: mapping.receivable, debit: "750000", credit: "0" },
          { accountId: mapping.equity, debit: "0", credit: "750000" },
        ],
        [
          { accountId: mapping.receivable, debit: "1250000", credit: "0" },
          { accountId: mapping.equity, debit: "0", credit: "1250000" },
        ],
        [
          { accountId: mapping.equity, debit: "2400000", credit: "0" },
          { accountId: mapping.payable, debit: "0", credit: "2400000" },
        ],
        [
          { accountId: mapping.equity, debit: "1600000", credit: "0" },
          { accountId: mapping.payable, debit: "0", credit: "1600000" },
        ],
      ];
      let seq = 0;
      for (const lines of journals) {
        seq += 1;
        const [entry] = await tx
          .insert(journalEntries)
          .values({
            companyId: COMPANY_B6,
            number: `JE-B6-${String(seq).padStart(5, "0")}`,
            date: "2026-01-01",
            description: "Jurnal paritas B6 (meniru seed demo)",
            sourceType: "opening",
            status: "posted",
            postedAt: new Date(),
          })
          .returning({ id: journalEntries.id });
        await tx.insert(journalLines).values(
          lines.map((line, index) => ({
            companyId: COMPANY_B6,
            entryId: entry.id,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            lineNo: index + 1,
          })),
        );
      }

      const lines = await tx
        .select({
          code: accounts.code,
          type: accounts.type,
          debit: journalLines.debit,
          credit: journalLines.credit,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(and(eq(journalLines.companyId, COMPANY_B6), eq(journalEntries.status, "posted")));

      const perType = new Map<string, { debit: number; credit: number }>();
      const perAccount = new Map<string, { debit: number; credit: number }>();
      for (const line of lines) {
        const t = perType.get(line.type) ?? { debit: 0, credit: 0 };
        t.debit += Number(line.debit);
        t.credit += Number(line.credit);
        perType.set(line.type, t);
        const a = perAccount.get(line.code) ?? { debit: 0, credit: 0 };
        a.debit += Number(line.debit);
        a.credit += Number(line.credit);
        perAccount.set(line.code, a);
      }

      expect(perType.get("asset")).toEqual({ debit: 80349600, credit: 0 });
      expect(perType.get("liability")).toEqual({ debit: 0, credit: 4000000 });
      expect(perType.get("equity")).toEqual({ debit: 4000000, credit: 80349600 });
      expect(perType.has("revenue")).toBe(false);
      expect(perType.has("cogs")).toBe(false);
      expect(perType.has("expense")).toBe(false);

      expect(perAccount.get("110107")).toEqual({ debit: 50000000, credit: 0 });
      expect(perAccount.get("110301")).toEqual({ debit: 2000000, credit: 0 });
      expect(perAccount.get("110401")).toEqual({ debit: 28349600, credit: 0 });
      expect(perAccount.get("210101")).toEqual({ debit: 0, credit: 4000000 });
      expect(perAccount.get("300001")).toEqual({ debit: 4000000, credit: 80349600 });
      expect(perAccount.size).toBe(5);
    });
  });
});

describe("Kontrak bagan akun referensi — perusahaan demo", () => {
  it("seluruh akun templat ada di demo; penunjuk bawaan & himpunan kelas benar", async () => {
    await withCompanyReadOnly(DEMO_ID, async (tx) => {
      const rows = await tx.select().from(accounts).where(eq(accounts.companyId, DEMO_ID));
      const codes = new Set(rows.map((row) => row.code));
      for (const entry of CHART_TEMPLATE) {
        expect(codes.has(entry.code), `akun templat ${entry.code} hilang dari demo`).toBe(true);
      }
      const codeById = new Map(rows.map((row) => [row.id, row.code]));
      const map = await getAccountMap(tx, DEMO_ID);
      expect(codeById.get(map.cash)).toBe("110107");
      expect(codeById.get(map.bank)).toBe("11010201");
      expect(codeById.get(map.qris)).toBe("110108");
      expect(codeById.get(map.fixed_asset)).toBe("120004");

      const cashBankCodes = new Set((await listCashBankAccounts(tx, DEMO_ID)).map((row) => row.code));
      for (const code of EXPECTED_CASH_BANK_CODES) {
        expect(cashBankCodes.has(code), `akun kas/bank ${code} hilang dari himpunan demo`).toBe(true);
      }
    });
  });
});
