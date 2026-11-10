import { describe, expect, it } from "vitest";
import { CHART_TEMPLATE, CHART_TEMPLATE_MAPPINGS } from "@/lib/akuntansi/chart-template";
import { ACCOUNT_MAPPING_KEYS } from "@/lib/akuntansi/account-mappings";
import { LEGACY_CHART_CODE_MAP } from "@/lib/akuntansi/legacy-chart-mapping";

/**
 * Integritas templat bagan akun referensi (cutover 2026-11-09):
 * daftar di lib/akuntansi/chart-template.ts adalah SATU-SATUNYA
 * sumber bagan bawaan. Bentuknya dikunci sebagai data: 141 akun
 * (126 akun file referensi + 15 akun operasional), 20 header
 * non-postable + 121 detail, hierarki asiklik, 37 kunci pemetaan,
 * pasangan kontra, kelas kas/bank, dan tag PSAK 118 eksplisit.
 */

const byCode = new Map(CHART_TEMPLATE.map((entry) => [entry.code, entry]));
const headers = CHART_TEMPLATE.filter((entry) => entry.isHeader);
const details = CHART_TEMPLATE.filter((entry) => !entry.isHeader);

const ALLOWED_SECTIONS: Record<string, string[]> = {
  asset: ["current_asset", "non_current_asset"],
  liability: ["current_liability", "non_current_liability"],
  equity: ["equity"],
  revenue: ["revenue", "other_income"],
  cogs: ["cogs"],
  expense: ["operating_expense", "other_expense"],
};

const EXPECTED_HEADERS = [
  "120006", "1105", "1200", "110102", "7200", "6000", "4401", "1101", "2102", "7202",
  "7201", "3000", "7100", "4000", "1104", "1103", "710013", "1102", "2101", "5102",
];

describe("Templat COA referensi — bentuk & hierarki", () => {
  it("141 akun unik: 20 header non-postable + 121 detail", () => {
    expect(CHART_TEMPLATE).toHaveLength(141);
    expect(headers).toHaveLength(20);
    expect(details).toHaveLength(121);
    expect(byCode.size).toBe(141);
    for (const entry of CHART_TEMPLATE) {
      expect(entry.code).toMatch(/^\d{4,8}$/);
    }
  });

  it("20 header persis daftar referensi, semuanya non-postable; semua detail postable", () => {
    expect([...headers.map((entry) => entry.code)].sort()).toEqual([...EXPECTED_HEADERS].sort());
    for (const header of headers) expect(header.isPostable).toBe(false);
    expect(details.filter((entry) => !entry.isPostable)).toEqual([]);
  });

  it("setiap induk ada, non-postable, dan rantai berakhir di akar tanpa induk", () => {
    for (const entry of CHART_TEMPLATE) {
      if (entry.parentCode !== null) {
        const parent = byCode.get(entry.parentCode);
        expect(parent, `induk ${entry.parentCode} dari ${entry.code}`).toBeDefined();
        expect(parent!.isPostable).toBe(false);
      }
    }
    for (const entry of CHART_TEMPLATE) {
      const chain = new Set<string>([entry.code]);
      let cursor: (typeof CHART_TEMPLATE)[number] | undefined = entry;
      while (cursor?.parentCode) {
        cursor = byCode.get(cursor.parentCode);
        expect(cursor, `induk hilang di ${entry.code}`).toBeDefined();
        expect(chain.has(cursor!.code), `siklus induk di ${entry.code}`).toBe(false);
        chain.add(cursor!.code);
      }
      expect(cursor!.parentCode).toBeNull();
    }
  });

  it("koherensi tipe↔section untuk semua akun ber-section", () => {
    for (const entry of CHART_TEMPLATE) {
      if (entry.section === null) continue;
      expect(ALLOWED_SECTIONS[entry.type], `${entry.code} ${entry.type}/${entry.section}`).toContain(entry.section);
    }
  });

  it("saldo normal per tipe; akun kontra berbalik dari pasangannya", () => {
    for (const entry of CHART_TEMPLATE) {
      if (entry.isContra) continue;
      const expected = entry.type === "asset" || entry.type === "cogs" || entry.type === "expense" ? "debit" : "credit";
      expect(entry.normalBalance, `${entry.code}`).toBe(expected);
    }
    for (const entry of CHART_TEMPLATE.filter((e) => e.isContra && e.contraOfCode)) {
      const target = byCode.get(entry.contraOfCode!)!;
      expect(entry.normalBalance, `${entry.code} kontra ${target.code}`).not.toBe(target.normalBalance);
    }
  });

  it("fidelitas kode/nama/induk referensi (termasuk perbaikan BSI)", () => {
    expect(byCode.get("11010201")?.name).toBe("BMT IFI MART 7540");
    expect(byCode.get("11010201")?.parentCode).toBe("110102");
    expect(byCode.get("11010203")?.name).toBe("BSI");
    expect(byCode.get("11010203")?.parentCode).toBe("110102");
    expect(byCode.get("400001")?.name).toBe("Penjualan");
    expect(byCode.get("5101")?.name).toBe("Beban Pokok Penjualan");
    expect(byCode.get("12000603")?.parentCode).toBe("120006");
  });
});

describe("Templat COA referensi — pemetaan, kelas, kontra, tag", () => {
  it("37 kunci pemetaan tertanam persis = ACCOUNT_MAPPING_KEYS", () => {
    expect(CHART_TEMPLATE_MAPPINGS).toHaveLength(37);
    expect(new Set(CHART_TEMPLATE_MAPPINGS.map((m) => m.key))).toEqual(new Set(ACCOUNT_MAPPING_KEYS));
    const keyByCode = new Map(CHART_TEMPLATE.map((entry) => [entry.code, entry.mappingKey]));
    for (const { key, code } of CHART_TEMPLATE_MAPPINGS) {
      expect(keyByCode.get(code)).toBe(key);
    }
  });

  it("enam kunci operasional tertanam ke akun referensi", () => {
    const codeByKey = new Map(CHART_TEMPLATE_MAPPINGS.map((m) => [m.key, m.code]));
    expect(codeByKey.get("fixed_asset")).toBe("120004");
    expect(codeByKey.get("accumulated_depreciation")).toBe("12000603");
    expect(codeByKey.get("depreciation_expense")).toBe("600023");
    expect(codeByKey.get("salary_deductions_payable")).toBe("210209");
    expect(codeByKey.get("employee_loan_receivable")).toBe("110305");
    expect(codeByKey.get("other_income")).toBe("710005");
  });

  it("kelas kas/bank 11 akun, semuanya postable", () => {
    const classed = CHART_TEMPLATE.filter((entry) => entry.cashBankKind !== null);
    expect(classed.map((entry) => entry.code).sort()).toEqual([
      "110101", "11010201", "11010202", "11010203", "110103",
      "110104", "110105", "110106", "110107", "110108", "110201",
    ]);
    const kindByCode = new Map(classed.map((entry) => [entry.code, entry.cashBankKind]));
    expect(kindByCode.get("110101")).toBe("cash");
    expect(kindByCode.get("11010201")).toBe("bank");
    expect(kindByCode.get("110103")).toBe("bank");
    expect(kindByCode.get("110104")).toBe("cash");
    expect(kindByCode.get("110105")).toBe("bank");
    expect(kindByCode.get("110106")).toBe("clearing");
    expect(kindByCode.get("110107")).toBe("cash");
    expect(kindByCode.get("110108")).toBe("clearing");
    expect(kindByCode.get("110201")).toBe("bank");
    for (const entry of classed) expect(entry.isPostable).toBe(true);
  });

  it("tujuh pasangan kontra menunjuk akun yang ada", () => {
    const pairs = CHART_TEMPLATE.filter((entry) => entry.contraOfCode !== null).map(
      (entry) => [entry.code, entry.contraOfCode] as const,
    );
    expect(pairs).toEqual([
      ["12000601", "120002"],
      ["12000604", "120005"],
      ["12000602", "120003"],
      ["12000603", "120004"],
      ["400004", "400001"],
      ["440101", "400001"],
      ["400003", "400001"],
    ]);
    for (const [, target] of pairs) expect(byCode.has(target!)).toBe(true);
  });

  it("tag PSAK 118 eksplisit & sifat beban khas", () => {
    const tag = (code: string) => byCode.get(code)!;
    expect(tag("710002").psak118Category).toBe("investing");
    expect(tag("720001").psak118Category).toBe("financing");
    expect(tag("720001").expenseNature).toBe("interest");
    expect(tag("600017").psak118Category).toBe("income_tax");
    expect(tag("600017").expenseNature).toBe("tax");
    expect(tag("5101").expenseNature).toBe("inventory_expensed");
    expect(tag("5101").expenseFunction).toBe("cogs");
    expect(tag("510201").expenseNature).toBe("inventory_writedown");
    expect(tag("510202").expenseNature).toBe("inventory_writedown");
    expect(tag("600004").expenseNature).toBe("employee_benefits");
    expect(tag("600009").expenseNature).toBe("employee_benefits");
    expect(tag("600019").expenseNature).toBe("rent");
    expect(tag("720002").expenseNature).toBe("bank_charges");
    expect(tag("600023").expenseNature).toBe("depreciation");
    expect(tag("720018").expenseNature).toBe("impairment");
    expect(tag("110107").psak118Category).toBeNull();
    expect(tag("210101").psak118Category).toBeNull();
    expect(tag("400001").psak118Category).toBe("operating");
    expect(tag("600020").psak118Category).toBe("operating");
  });

  it("seluruh 42 pasangan tabel migrasi lama menunjuk kode yang ada di templat", () => {
    expect(LEGACY_CHART_CODE_MAP).toHaveLength(42);
    for (const pair of LEGACY_CHART_CODE_MAP) {
      expect(byCode.has(pair.newCode), `kode ${pair.newCode} (dari ${pair.oldCode}) tidak ada`).toBe(true);
    }
  });
});
