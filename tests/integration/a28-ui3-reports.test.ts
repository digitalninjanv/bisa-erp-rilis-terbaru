import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts } from "@/db/schema";
import {
  getIncomeStatement,
  getTrialBalance,
  listAccounts,
  listJournalEntries,
  resolveDefaultLedgerAccountId,
} from "@/server/reports";
import { buildReportExportTable } from "@/server/reports/export-builders";
import { accountTotalsInRange, totalsOf } from "@/server/reports/shared";
import { monthStartISO, todayISO } from "@/lib/format";
import { rollbackTransaction } from "../helpers/rollback-transaction";

// A-28 UI-3: (1) bawaan buku besar = akun postable beraktivitas
// pertama, bukan header 10000; (2) paritas total laporan antara mode
// sembunyikan-nol dan tampilkan-nol pada model ekspor bersama;
// (3) daftar jurnal membawa rincian baris debit/kredit (AKT-05).
const ORG_ID = "01900000-0000-7000-8000-000000000001";
const WIDE = { from: "2000-01-01", to: "2100-12-31" };

describe("A-28 UI-3: bawaan buku besar", () => {
  it("memilih akun postable pertama yang beraktivitas pada rentang", async () => {
    await rollbackTransaction(ORG_ID, async (tx) => {
      const all = await listAccounts(tx, ORG_ID);
      expect(all[0]?.code).toBe("1101");
      expect(all[0]?.isPostable).toBe(false);

      const pickedId = await resolveDefaultLedgerAccountId(tx, ORG_ID, all, WIDE);
      const picked = all.find((row) => row.id === pickedId);
      expect(picked).toBeDefined();
      expect(picked!.isPostable).toBe(true);
      expect(picked!.code).not.toBe("1101");

      // Akun terpilih benar-benar beraktivitas pada rentang, dan tidak
      // ada akun postable berkode lebih kecil yang beraktivitas.
      const totals = await accountTotalsInRange(tx, ORG_ID, WIDE.from, WIDE.to);
      const pickedTotals = totalsOf(totals, pickedId);
      expect(!pickedTotals.debit.isZero() || !pickedTotals.credit.isZero()).toBe(true);
      for (const row of all) {
        if (!row.isPostable || row.code >= picked!.code) continue;
        const t = totalsOf(totals, row.id);
        expect(
          t.debit.isZero() && t.credit.isZero(),
          `akun ${row.code} beraktivitas tetapi tidak dipilih`,
        ).toBe(true);
      }
    });
  });

  it("rentang hampa jatuh ke akun postable bersaldo, bukan header", async () => {
    await rollbackTransaction(ORG_ID, async (tx) => {
      const all = await listAccounts(tx, ORG_ID);
      // Rentang lampau sebelum data demo ada: tak satu pun akun
      // beraktivitas dan tak ada saldo kumulatif → postable pertama.
      const pickedId = await resolveDefaultLedgerAccountId(tx, ORG_ID, all, {
        from: "1990-01-01",
        to: "1990-12-31",
      });
      const picked = all.find((row) => row.id === pickedId);
      const firstPostable = all.find((row) => row.isPostable);
      expect(picked?.id).toBe(firstPostable?.id);
    });
  });
});

describe("A-28 UI-3: paritas total sembunyikan-nol (model ekspor)", () => {
  it("total laba rugi & neraca identik antara hideZero true/false; baris hampa tersaring", async () => {
    await rollbackTransaction(ORG_ID, async (tx) => {
      const company = { id: ORG_ID, name: "Bisa Minimarket" };
      const from = monthStartISO();
      const to = todayISO();
      const domain = await getIncomeStatement(tx, ORG_ID, {
        from: `${from}T00:00:00`,
        to: `${to}T23:59:59`,
      });

      const shown = await buildReportExportTable(tx, company, "laba-rugi", from, to, { hideZero: false });
      const hidden = await buildReportExportTable(tx, company, "laba-rugi", from, to, { hideZero: true });

      const grandOf = (table: typeof shown) =>
        table.rows.find((row) => row.kind === "grand")?.cells[2];
      expect(grandOf(shown)).toEqual(grandOf(hidden));
      const grandCell = grandOf(hidden);
      expect(grandCell?.type).toBe("money");
      expect(domain.netProfit).toBeCloseTo(
        grandCell?.type === "money" ? grandCell.value : NaN,
        2,
      );

      const dataCount = (table: typeof shown) => table.rows.filter((row) => row.kind === "data").length;
      expect(dataCount(hidden)).toBeLessThanOrEqual(dataCount(shown));

      // Setiap baris yang hilang pada mode sembunyi memang nol pada
      // periode ini (kolom pembanding diperiksa di test unit helper).
      const codeOf = (cells: typeof shown.rows[number]["cells"]) =>
        cells[0]?.type === "text" ? cells[0].value : "";
      const hiddenCodes = new Set(
        hidden.rows.filter((row) => row.kind === "data").map((row) => codeOf(row.cells)),
      );
      for (const row of shown.rows) {
        if (row.kind !== "data") continue;
        if (!hiddenCodes.has(codeOf(row.cells))) {
          const amount = row.cells[2];
          expect(amount?.type === "money" ? amount.value : 0).toBe(0);
        }
      }
    });
  });

  it("total neraca saldo identik antara kedua mode", async () => {
    await rollbackTransaction(ORG_ID, async (tx) => {
      const company = { id: ORG_ID, name: "Bisa Minimarket" };
      const from = monthStartISO();
      const to = todayISO();
      const domain = await getTrialBalance(tx, ORG_ID, {
        from: `${from}T00:00:00`,
        to: `${to}T23:59:59`,
      });
      const domainDebit = domain.reduce((acc, row) => acc + row.debit, 0);

      const shown = await buildReportExportTable(tx, company, "neraca-saldo", from, to, { hideZero: false });
      const hidden = await buildReportExportTable(tx, company, "neraca-saldo", from, to, { hideZero: true });
      const sumDebit = (table: typeof shown) =>
        table.rows
          .filter((row) => row.kind === "data")
          .reduce((acc, row) => {
            const cell = row.cells[3];
            return acc + (cell?.type === "money" ? cell.value : 0);
          }, 0);
      // Baris hampa berdebit 0, jadi jumlah debit baris tampil sama
      // persis dengan total domain di kedua mode.
      expect(sumDebit(shown)).toBeCloseTo(domainDebit, 2);
      expect(sumDebit(hidden)).toBeCloseTo(domainDebit, 2);
      expect(hidden.rows.length).toBeLessThanOrEqual(shown.rows.length);
    });
  });
});

describe("A-28 UI-3: rincian baris pada daftar jurnal (AKT-05)", () => {
  it("setiap jurnal membawa baris akun dengan debit/kredit yang menjumlah ke nilai jurnal", async () => {
    await rollbackTransaction(ORG_ID, async (tx) => {
      const list = await listJournalEntries(tx, {
        companyId: ORG_ID,
        from: WIDE.from,
        to: WIDE.to,
        page: 1,
        pageSize: 10,
      });
      expect(list.rows.length).toBeGreaterThan(0);
      const accountRows = await tx
        .select({ code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const codes = new Set(accountRows.map((row) => row.code));
      for (const row of list.rows) {
        expect(row.lines.length).toBeGreaterThan(0);
        const debitSum = row.lines.reduce((acc, line) => acc + line.debit, 0);
        expect(debitSum).toBeCloseTo(row.amount, 2);
        for (const line of row.lines) {
          expect(codes.has(line.accountCode)).toBe(true);
          expect(line.debit === 0 || line.credit === 0).toBe(true);
        }
      }
    });
  });
});
