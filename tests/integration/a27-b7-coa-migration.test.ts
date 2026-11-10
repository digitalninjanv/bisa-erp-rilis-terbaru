import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accountMappings,
  accounts,
  auditLog,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { getAccountMap, seedChartOfAccounts } from "@/server/accounting";
import { executeCoaMigration, previewCoaMigration } from "@/server/coa-migration";
import { CHART_TEMPLATE } from "@/lib/akuntansi/chart-template";
import { LEGACY_CHART_CODE_MAP } from "@/lib/akuntansi/legacy-chart-mapping";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * A-27 B7 — alat migrasi renumber perusahaan berjalan (OPT-IN):
 *
 * 1. Fixture perusahaan berkode 4 digit gaya lama (42 akun §5, datar
 *    tanpa induk, 33 pemetaan) + 1 akun kustom: dry-run melaporkan
 *    persis 42 renumber, 82 akun templat yang akan dibuat, 1 akun
 *    kustom tak terpetakan, 0 bentrok — dan tidak mengubah apa pun.
 * 2. Eksekusi: kode berubah mengikuti §5, saldo per accountId
 *    IDENTIK sebelum/sesudah, pemetaan tetap menunjuk id yang sama,
 *    3 kunci yang belum terpetakan ikut tertanam dari akun templat
 *    baru, akun kustom utuh, jejak audit tertulis, dry-run sesudah
 *    menyatakan tidak ada lagi yang perlu dimigrasi.
 * 3. Bentrok kode tujuan: dry-run melapor, eksekusi MENOLAK
 *    (CONFLICT) tanpa perubahan sebagian.
 * 4. Perusahaan yang sudah bertemplat 5 digit: tidak ada migrasi.
 * 5. Tabel mapping adalah parameter: kode lama kustom perusahaan
 *    dapat dimigrasi dengan tabel yang disesuaikan.
 */

const COMPANY_B7 = "01900000-0000-7000-8000-00000000b737";
const COMPANY_B7_DIGIT = "01900000-0000-7000-8000-00000000b738";
const COMPANY_B7_CUSTOM = "01900000-0000-7000-8000-00000000b739";
const rollbackB7 = makeRollbackTransaction(COMPANY_B7);
const rollbackDigit = makeRollbackTransaction(COMPANY_B7_DIGIT);
const rollbackCustom = makeRollbackTransaction(COMPANY_B7_CUSTOM);

const OLD_NAMES: Record<string, string> = {
  "1000": "Kas", "1010": "Kas Kecil", "1100": "Bank BCA", "1110": "QRIS Clearing",
  "1180": "PPN Masukan", "1200": "Piutang Usaha", "1210": "Kredit Pemasok",
  "1220": "Piutang Karyawan", "1300": "Persediaan Barang Dagang", "1400": "Perlengkapan",
  "1500": "Peralatan Toko", "1510": "Akumulasi Penyusutan Peralatan", "2000": "Utang Usaha",
  "2100": "Utang Gaji", "2110": "Utang PPh 21", "2120": "Utang BPJS",
  "2130": "Utang PPh Dipotong", "2200": "PPN Keluaran", "2300": "Kredit Pelanggan",
  "3000": "Modal Pemilik", "3100": "Laba Ditahan", "4000": "Penjualan",
  "4010": "Diskon Penjualan", "4020": "Retur Penjualan", "4030": "Pendapatan Lain-lain",
  "5000": "Harga Pokok Penjualan", "5010": "Selisih Persediaan",
  "5020": "Barang Rusak dan Kedaluwarsa", "6000": "Beban Gaji Karyawan", "6010": "Beban Sewa",
  "6020": "Beban Listrik dan Air", "6030": "Beban Telepon dan Internet",
  "6040": "Beban Transportasi", "6050": "Beban Perlengkapan", "6060": "Beban Administrasi Bank",
  "6070": "Beban Lain-lain", "6080": "Beban Iuran BPJS Perusahaan",
  "6100": "Beban Piutang Tak Tertagih", "8000": "Selisih Kas Kurang",
  "8001": "Selisih Kas Lebih", "9000": "Pembulatan Penjualan (Laba)",
  "9001": "Selisih Pembulatan (Rugi)",
};

const OLD_KEYS: Record<string, string> = {
  "1000": "cash", "1100": "bank", "1110": "qris", "1180": "tax_input",
  "1200": "receivable", "1210": "supplier_credit", "1220": "employee_receivable",
  "1300": "inventory", "1500": "fixed_asset", "1510": "accumulated_depreciation",
  "2000": "payable", "2100": "salary_payable", "2110": "pph21_payable",
  "2120": "bpjs_payable", "2130": "tax_withholding_payable", "2200": "tax_output",
  "2300": "customer_credit", "3000": "equity", "4000": "revenue",
  "4010": "sales_discount", "4020": "sales_return", "4030": "other_income",
  "5000": "cogs", "5010": "inventory_shrink", "5020": "damaged",
  "6000": "salary_expense", "6060": "bank_fee", "6080": "payroll_employer_expense",
  "6100": "receivable_writeoff", "8000": "cash_short", "8001": "cash_over",
  "9000": "rounding_gain", "9001": "rounding_loss",
};

const TEMPLATE_BY_CODE = new Map(CHART_TEMPLATE.map((entry) => [entry.code, entry]));

/** Menanam bagan 4 digit gaya lama: datar, semua postable, tanpa induk (keadaan pra-A-27). */
async function seedLegacyChart(tx: Tx, companyId: string) {
  const idByOldCode = new Map<string, string>();
  for (const pair of LEGACY_CHART_CODE_MAP) {
    const target = TEMPLATE_BY_CODE.get(pair.newCode)!;
    const [row] = await tx
      .insert(accounts)
      .values({
        companyId,
        code: pair.oldCode,
        name: OLD_NAMES[pair.oldCode],
        type: target.type,
        normalBalance: target.normalBalance,
        parentId: null,
        section: target.section,
        cashFlowGroup: target.cashFlowGroup,
        cashBankKind:
          pair.oldCode === "1000" ? "cash" : pair.oldCode === "1100" ? "bank" : pair.oldCode === "1110" ? "clearing" : null,
        isPostable: true,
      })
      .returning({ id: accounts.id });
    idByOldCode.set(pair.oldCode, row.id);
  }
  const mappingRows = Object.entries(OLD_KEYS).map(([oldCode, key]) => ({
    companyId,
    key,
    accountId: idByOldCode.get(oldCode)!,
  }));
  await tx.insert(accountMappings).values(mappingRows);
  return idByOldCode;
}

async function postFixtureJournal(
  tx: Tx,
  companyId: string,
  number: string,
  lines: Array<{ accountId: string; debit: string; credit: string }>,
) {
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId,
      number,
      date: "2026-01-15",
      description: `Jurnal fixture B7 ${number}`,
      sourceType: "opening",
      status: "posted",
      postedAt: new Date(),
    })
    .returning({ id: journalEntries.id });
  await tx.insert(journalLines).values(
    lines.map((line, index) => ({
      companyId,
      entryId: entry.id,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      lineNo: index + 1,
    })),
  );
}

async function balancesByAccountId(tx: Tx, companyId: string) {
  const rows = await tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalEntries.status, "posted")));
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const current = totals.get(row.accountId) ?? { debit: 0, credit: 0 };
    current.debit += Number(row.debit);
    current.credit += Number(row.credit);
    totals.set(row.accountId, current);
  }
  return totals;
}

describe("A-27 B7 — dry-run perusahaan berkode 4 digit", () => {
  it("melaporkan 42 renumber, 82 akun templat baru, 1 akun kustom, 0 bentrok — tanpa mengubah data", async () => {
    await rollbackB7(async (tx) => {
      const idByOldCode = await seedLegacyChart(tx, COMPANY_B7);
      const [custom] = await tx
        .insert(accounts)
        .values({
          companyId: COMPANY_B7,
          code: "7777",
          name: "Akun Kustom Cadangan",
          type: "expense",
          normalBalance: "debit",
          section: "operating_expense",
          isPostable: true,
        })
        .returning({ id: accounts.id });

      const preview = await previewCoaMigration(tx, COMPANY_B7);
      expect(preview.renames).toHaveLength(42);
      expect(preview.renames).toContainEqual({
        accountId: idByOldCode.get("1100"),
        oldCode: "1100",
        oldName: "Bank BCA",
        newCode: "11010201",
        newName: "BMT IFI MART 7540",
      });
      expect(preview.missingTemplate).toHaveLength(99);
      expect(preview.missingTemplate.map((item) => item.code)).toContain("110305"); // Piutang Pinjaman Karyawan dibuat BARU
      expect(preview.missingTemplate.map((item) => item.code)).toContain("1101"); // header kelas
      expect(preview.unmapped).toEqual([{ id: custom.id, code: "7777", name: "Akun Kustom Cadangan" }]);
      expect(preview.conflicts).toEqual([]);
      expect(preview.alreadyMigratedCount).toBe(0);
      expect(preview.needsMigration).toBe(true);
      expect(preview.canExecute).toBe(true);

      // Dry-run murni membaca: jumlah akun tidak berubah.
      const rows = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.companyId, COMPANY_B7));
      expect(rows).toHaveLength(43);
    });
  });
});

describe("A-27 B7 — eksekusi migrasi", () => {
  it("renumber mengikuti §5, saldo per accountId identik, pemetaan utuh, akun kustom utuh, audit tertulis", async () => {
    await rollbackB7(async (tx) => {
      const idByOldCode = await seedLegacyChart(tx, COMPANY_B7);
      const [custom] = await tx
        .insert(accounts)
        .values({
          companyId: COMPANY_B7,
          code: "7777",
          name: "Akun Kustom Cadangan",
          type: "expense",
          normalBalance: "debit",
          section: "operating_expense",
          isPostable: true,
        })
        .returning({ id: accounts.id });

      await postFixtureJournal(tx, COMPANY_B7, "JE-B7-00001", [
        { accountId: idByOldCode.get("1000")!, debit: "50000000", credit: "0" },
        { accountId: idByOldCode.get("1300")!, debit: "28349600", credit: "0" },
        { accountId: idByOldCode.get("3000")!, debit: "0", credit: "78349600" },
      ]);
      await postFixtureJournal(tx, COMPANY_B7, "JE-B7-00002", [
        { accountId: idByOldCode.get("1200")!, debit: "2000000", credit: "0" },
        { accountId: idByOldCode.get("3000")!, debit: "0", credit: "2000000" },
      ]);
      await postFixtureJournal(tx, COMPANY_B7, "JE-B7-00003", [
        { accountId: idByOldCode.get("3000")!, debit: "4000000", credit: "0" },
        { accountId: idByOldCode.get("2000")!, debit: "0", credit: "4000000" },
      ]);
      await postFixtureJournal(tx, COMPANY_B7, "JE-B7-00004", [
        { accountId: custom.id, debit: "125000", credit: "0" },
        { accountId: idByOldCode.get("1000")!, debit: "0", credit: "125000" },
      ]);

      const before = await balancesByAccountId(tx, COMPANY_B7);
      const mapBefore = await getAccountMap(tx, COMPANY_B7);

      const result = await executeCoaMigration(tx, COMPANY_B7, { userId: null });
      expect(result.renamedCount).toBe(42);
      expect(result.createdCount).toBe(99);
      expect(result.createdCodes).toContain("110305");
      expect(result.unmappedCount).toBe(1);
      expect(result.alreadyUpToDate).toBe(false);
      expect(result.balancesVerified).toBe(true);

      // Verifikasi independen test: saldo per accountId tidak berubah se-sen pun.
      const after = await balancesByAccountId(tx, COMPANY_B7);
      expect(after).toEqual(before);

      const rows = await tx.select().from(accounts).where(eq(accounts.companyId, COMPANY_B7));
      expect(rows).toHaveLength(142);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const byCode = new Map(rows.map((row) => [row.code, row]));

      // Akun lama yang sama (id sama), kode & atribut templat baru.
      const kas = byId.get(idByOldCode.get("1000")!)!;
      expect(kas.code).toBe("110107");
      expect(kas.cashBankKind).toBe("cash");
      expect(kas.parentId).toBe(byCode.get("1101")!.id);
      const kasKecil = byId.get(idByOldCode.get("1010")!)!;
      expect(kasKecil.code).toBe("110101");
      expect(kasKecil.cashBankKind).toBe("cash");
      const qris = byId.get(idByOldCode.get("1110")!)!;
      expect(qris.code).toBe("110108");
      expect(qris.name).toBe("QRIS Clearing");
      expect(qris.cashBankKind).toBe("clearing");
      const diskon = byId.get(idByOldCode.get("4010")!)!;
      expect(diskon.code).toBe("440101");
      expect(diskon.isContra).toBe(true);
      expect(diskon.contraOf).toBe(byCode.get("400001")!.id);
      expect(diskon.psak118Category).toBe("operating");

      // Akun templat yang hilang kini ada sebagai akun BARU (id baru).
      const pinjaman = byCode.get("110305")!;
      expect(pinjaman).toBeDefined();
      expect(pinjaman.isPostable).toBe(true);
      expect([...idByOldCode.values()]).not.toContain(pinjaman.id);
      expect(byCode.get("1101")!.isPostable).toBe(false);

      // Akun kustom tidak tersentuh sama sekali.
      const customAfter = byId.get(custom.id)!;
      expect(customAfter.code).toBe("7777");
      expect(customAfter.name).toBe("Akun Kustom Cadangan");
      expect(customAfter.parentId).toBeNull();

      // Pemetaan: 37/37 kunci; yang lama menunjuk id yang sama,
      // yang baru (dari akun templat ciptaan) ikut tertanam.
      const mapAfter = await getAccountMap(tx, COMPANY_B7);
      expect(Object.keys(mapAfter)).toHaveLength(37);
      for (const [key, accountId] of Object.entries(mapBefore)) {
        expect(mapAfter[key], `pemetaan ${key}`).toBe(accountId);
      }
      expect(mapAfter.depreciation_expense).toBe(byCode.get("600023")!.id);
      expect(mapAfter.salary_deductions_payable).toBe(byCode.get("210209")!.id);
      expect(mapAfter.employee_loan_receivable).toBe(byCode.get("110305")!.id);

      // Jejak audit: 42 perubahan kode per akun + 1 ringkasan migrasi.
      const codeChanges = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.companyId, COMPANY_B7), eq(auditLog.action, "account.code_change")));
      expect(codeChanges).toHaveLength(42);
      const summaries = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.companyId, COMPANY_B7), eq(auditLog.action, "coa.migration")));
      expect(summaries).toHaveLength(1);

      // Dry-run sesudah eksekusi: tidak ada lagi yang perlu dimigrasi.
      const previewAfter = await previewCoaMigration(tx, COMPANY_B7);
      expect(previewAfter.needsMigration).toBe(false);
      expect(previewAfter.renames).toEqual([]);
      expect(previewAfter.missingTemplate).toEqual([]);
      expect(previewAfter.alreadyMigratedCount).toBe(142);
    });
  });

  it("bentrok kode tujuan: dry-run melapor dan eksekusi menolak tanpa perubahan sebagian", async () => {
    await rollbackB7(async (tx) => {
      const idByOldCode = await seedLegacyChart(tx, COMPANY_B7);
      await tx.insert(accounts).values({
        companyId: COMPANY_B7,
        code: "110107",
        name: "Kas Versi Penghalang",
        type: "asset",
        normalBalance: "debit",
        section: "current_asset",
        isPostable: true,
      });

      const preview = await previewCoaMigration(tx, COMPANY_B7);
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0]).toMatchObject({ oldCode: "1000", newCode: "110107" });
      expect(preview.canExecute).toBe(false);

      await expect(executeCoaMigration(tx, COMPANY_B7)).rejects.toMatchObject({ code: "CONFLICT" });

      // Tidak ada perubahan sebagian: kode lama & jumlah akun utuh.
      const rows = await tx.select().from(accounts).where(eq(accounts.companyId, COMPANY_B7));
      expect(rows).toHaveLength(43);
      const kas = rows.find((row) => row.id === idByOldCode.get("1000"))!;
      expect(kas.code).toBe("1000");
    });
  });
});

describe("A-27 B7 — perusahaan yang sudah 5 digit & tabel mapping kustom", () => {
  it("perusahaan bertemplat 5 digit: dry-run menyatakan tidak ada yang perlu dimigrasi", async () => {
    await rollbackDigit(async (tx) => {
      await seedChartOfAccounts(tx, COMPANY_B7_DIGIT);
      const preview = await previewCoaMigration(tx, COMPANY_B7_DIGIT);
      expect(preview.renames).toEqual([]);
      expect(preview.missingTemplate).toEqual([]);
      expect(preview.conflicts).toEqual([]);
      expect(preview.needsMigration).toBe(false);
      expect(preview.canExecute).toBe(false);

      const result = await executeCoaMigration(tx, COMPANY_B7_DIGIT);
      expect(result.alreadyUpToDate).toBe(true);
      expect(result.renamedCount).toBe(0);
      expect(result.createdCount).toBe(0);
    });
  });

  it("tabel mapping yang disesuaikan per perusahaan diterima sebagai parameter", async () => {
    await rollbackCustom(async (tx) => {
      const [kas] = await tx
        .insert(accounts)
        .values({
          companyId: COMPANY_B7_CUSTOM,
          code: "1005",
          name: "Kas Operasional",
          type: "asset",
          normalBalance: "debit",
          section: "current_asset",
          cashBankKind: "cash",
          isPostable: true,
        })
        .returning({ id: accounts.id });
      const [modal] = await tx
        .insert(accounts)
        .values({
          companyId: COMPANY_B7_CUSTOM,
          code: "3999",
          name: "Modal Pemilik",
          type: "equity",
          normalBalance: "credit",
          section: "equity",
          isPostable: true,
        })
        .returning({ id: accounts.id });
      await tx.insert(accountMappings).values({ companyId: COMPANY_B7_CUSTOM, key: "equity", accountId: modal.id });

      const customMapping = [{ oldCode: "1005", newCode: "110107" }];
      const preview = await previewCoaMigration(tx, COMPANY_B7_CUSTOM, customMapping);
      expect(preview.renames).toEqual([
        { accountId: kas.id, oldCode: "1005", oldName: "Kas Operasional", newCode: "110107", newName: "Tunai" },
      ]);
      expect(preview.unmapped.map((item) => item.code)).toEqual(["3999"]);

      const result = await executeCoaMigration(tx, COMPANY_B7_CUSTOM, { mapping: customMapping });
      expect(result.renamedCount).toBe(1);
      const [kasAfter] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, COMPANY_B7_CUSTOM), eq(accounts.id, kas.id)));
      expect(kasAfter.code).toBe("110107");
      expect(kasAfter.name).toBe("Tunai");
      // Pemetaan equity yang sudah ada TIDAK dialihkan ke akun templat 31001.
      const map = await getAccountMap(tx, COMPANY_B7_CUSTOM);
      expect(map.equity).toBe(modal.id);
    });
  });
});
