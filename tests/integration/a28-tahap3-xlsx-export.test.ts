import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { accounts } from "@/db/schema";
import { ensureFiscalPeriods, postJournal } from "@/server/accounting";
import {
  getAccountingSummary,
  getBalanceSheet,
  getCashFlow,
  getHomeSummary,
  getIncomeStatement,
  getLedger,
  listAccounts,
  listReceivables,
} from "@/server/reports";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";
import { GET as reportRoute } from "@/app/api/export/report/route";
import { GET as ledgerRoute } from "@/app/api/export/ledger/route";
import { GET as agingRoute } from "@/app/api/export/aging/route";

// A-28 Tahap 3 — H-AKT-01 (ekspor XLSX berformat) & H-AKT-02 (satu
// definisi kas).
//
// H-AKT-01: route ekspor dengan format=xlsx harus menghasilkan
// workbook yang totalnya IDENTIK dengan fungsi domain di balik layar
// (satu sumber definisi) dan dengan CSV warisan untuk parameter yang
// sama; angka harus sel numerik berformat #,##0, bukan teks.
// H-AKT-02: akun bank berkelas "bank" yang TIDAK ditunjuk pemetaan
// mana pun (skenario "Bank Mandiri kedua" A-27) harus terhitung di
// laporan arus kas, kartu ringkasan akuntansi, dan dashboard —
// ketiganya kini membaca himpunan kelas kas/bank yang sama.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: ORG_ID, name: "Bisa Minimarket" },
    user: { id: USER_ID },
    role: "owner",
  });
  return {
    requirePermission: ctx,
    requirePermissionInModule: ctx,
    requireAuth: ctx,
    requireModuleAccess: ctx,
    can: () => true,
  };
});

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

const FROM = "2026-01-01";
const TO = "2026-12-31";
const RANGE = { from: `${FROM}T00:00:00`, to: `${TO}T23:59:59` };

type Aoa = unknown[][];

async function fetchXlsx(url: string): Promise<{ aoa: Aoa; sheet: XLSX.WorkSheet }> {
  const response = await reportOrLedger(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("spreadsheetml");
  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as Aoa;
  return { aoa, sheet };
}

async function reportOrLedger(url: string): Promise<Response> {
  if (url.includes("/ledger")) return ledgerRoute(new Request(url));
  if (url.includes("/aging")) return agingRoute(new Request(url));
  return reportRoute(new Request(url));
}

function findRow(aoa: Aoa, label: string): unknown[] {
  const row = aoa.find((candidate) =>
    candidate.some((cell) => typeof cell === "string" && cell.trim() === label),
  );
  if (!row) throw new Error(`Baris "${label}" tidak ditemukan di XLSX`);
  return row;
}

describe("A-28 Tahap 3 (H-AKT-01): ekspor XLSX berformat identik layar & CSV", () => {
  it("laba rugi: sel Laba bersih numerik #,##0 dan sama dengan domain & CSV", async () => {
    const domain = await withCompanyReadOnly(ORG_ID, async (tx) =>
      getIncomeStatement(tx, ORG_ID, RANGE),
    );
    const { aoa, sheet } = await fetchXlsx(
      `http://localhost/api/export/report?type=laba-rugi&from=${FROM}&to=${TO}&format=xlsx`,
    );
    // Kop laporan hadir: nama perusahaan, judul, periode.
    expect(String(aoa[1]?.[0])).toBe("Laporan Laba Rugi");
    expect(String(aoa[2]?.[0])).toContain(FROM);

    const rowIndex = aoa.findIndex((candidate) =>
      candidate.some((cell) => typeof cell === "string" && cell.trim() === "Laba bersih"),
    );
    const row = aoa[rowIndex];
    expect(typeof row[2]).toBe("number");
    expect(Number(row[2])).toBeCloseTo(domain.netProfit, 2);
    // Sel mentahnya benar-benar numerik; format #,##0 yang diterapkan
    // penulis tampak pada teks terformat `w` saat dibaca kembali
    // (SheetJS tidak mengekspos kode format `z` pada sel hasil baca —
    // keberadaan numFmt #,##0 di styles.xml terverifikasi terpisah).
    const rawCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 2 })];
    expect(rawCell.t).toBe("n");
    expect(String(rawCell.w).replace(/,/g, "")).toBe(
      String(Math.round(Number(row[2]))),
    );
    if (Math.abs(Number(row[2])) >= 1000) {
      expect(String(rawCell.w)).toContain(",");
    }
    // Satu periode: tidak ada kolom pembanding maupun selisih.
    expect(row[3]).toBeUndefined();

    const csvResponse = await reportRoute(
      new Request(`http://localhost/api/export/report?type=laba-rugi&from=${FROM}&to=${TO}`),
    );
    const csvText = await csvResponse.text();
    const csvLine = csvText
      .split("\r\n")
      .find((line) => line.includes("Laba bersih"));
    expect(csvLine).toBeDefined();
    expect(csvLine).toContain(domain.netProfit.toFixed(2));
  });

  it("neraca: Total aset XLSX == domain; neraca tetap seimbang", async () => {
    const domain = await withCompanyReadOnly(ORG_ID, async (tx) =>
      getBalanceSheet(tx, ORG_ID, TO),
    );
    const { aoa } = await fetchXlsx(
      `http://localhost/api/export/report?type=neraca&from=${FROM}&to=${TO}&format=xlsx`,
    );
    const assets = findRow(aoa, "Total aset");
    const liabEquity = findRow(aoa, "Total liabilitas + ekuitas");
    expect(Number(assets[2])).toBeCloseTo(domain.totalAssets, 2);
    expect(Number(liabEquity[2])).toBeCloseTo(
      domain.totalLiabilities + domain.totalEquity,
      2,
    );
    expect(domain.balanced).toBe(true);
  });

  it("arus kas: Saldo kas akhir XLSX == domain (definisi kelas)", async () => {
    const domain = await withCompanyReadOnly(ORG_ID, async (tx) =>
      getCashFlow(tx, ORG_ID, RANGE),
    );
    const { aoa } = await fetchXlsx(
      `http://localhost/api/export/report?type=arus-kas&from=${FROM}&to=${TO}&format=xlsx`,
    );
    const closing = findRow(aoa, "Saldo kas akhir");
    expect(typeof closing[4]).toBe("number");
    expect(Number(closing[4])).toBeCloseTo(domain.closing, 2);
    expect(domain.closing).toBeCloseTo(domain.opening + domain.net, 2);
  });

  it("buku besar: Saldo akhir XLSX == getLedger akun pertama", async () => {
    const domain = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const accountList = await listAccounts(tx, ORG_ID);
      const first = accountList[0];
      const ledger = await getLedger(tx, {
        companyId: ORG_ID,
        accountId: first.id,
        from: FROM,
        to: TO,
      });
      return { first, ledger };
    });
    const { aoa } = await fetchXlsx(
      `http://localhost/api/export/ledger?account=${domain.first.id}&from=${FROM}&to=${TO}&format=xlsx`,
    );
    const closing = findRow(aoa, "Saldo akhir");
    expect(Number(closing[5])).toBeCloseTo(domain.ledger.closing, 2);
  });

  it("aging piutang: jumlah kolom Sisa XLSX == total sisa domain", async () => {
    const domainTotal = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const rows = await listReceivables(tx, ORG_ID);
      return rows.reduce((acc, row) => acc + row.outstanding, 0);
    });
    const { aoa } = await fetchXlsx(
      "http://localhost/api/export/aging?kind=piutang&format=xlsx",
    );
    const headerIndex = aoa.findIndex((candidate) => candidate[0] === "Nomor");
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    let sum = 0;
    for (const row of aoa.slice(headerIndex + 1)) {
      if (typeof row[10] === "number") sum += row[10];
    }
    expect(sum).toBeCloseTo(domainTotal, 2);
  });
});

describe("A-28 Tahap 3 (H-AKT-02): bank tak terpetakan masuk semua permukaan kas", () => {
  it("arus kas, ringkasan & dashboard menaik sebesar mutasi bank kedua", async () => {
    await rollbackTransaction(async (tx) => {
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const byCode = new Map(accountRows.map((row) => [row.code, row.id]));
      const equityId = byCode.get("300001");
      if (!equityId) throw new Error("Akun modal demo tidak ditemukan");

      const [newBank] = await tx
        .insert(accounts)
        .values({
          companyId: ORG_ID,
          code: "11999",
          name: "Bank Uji A28 Tahap 3",
          type: "asset",
          normalBalance: "debit",
          section: "current_asset",
          cashBankKind: "bank",
        })
        .returning({ id: accounts.id });

      await ensureFiscalPeriods(tx, ORG_ID, 2026);
      const range = { from: "2026-11-01", to: "2026-11-30" };
      const wide = { from: "2000-01-01", to: "2100-12-31" };

      const flowBefore = await getCashFlow(tx, ORG_ID, range);
      const summaryBefore = await getAccountingSummary(tx, ORG_ID, wide);
      const homeBefore = await getHomeSummary(tx, ORG_ID, todayISO());

      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2026-11-05",
        description: "Setoran modal ke bank kedua (uji A-28 Tahap 3)",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: newBank.id, debit: "7000000" },
          { accountId: equityId, credit: "7000000" },
        ],
      });

      const flowAfter = await getCashFlow(tx, ORG_ID, range);
      const summaryAfter = await getAccountingSummary(tx, ORG_ID, wide);
      const homeAfter = await getHomeSummary(tx, ORG_ID, todayISO());

      expect(flowAfter.net - flowBefore.net).toBeCloseTo(7000000, 2);
      expect(flowAfter.closing - flowBefore.closing).toBeCloseTo(7000000, 2);
      expect(summaryAfter.bank - summaryBefore.bank).toBeCloseTo(7000000, 2);
      expect(homeAfter.cashBalance - homeBefore.cashBalance).toBeCloseTo(7000000, 2);
    });
  });
});
