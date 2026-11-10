import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminSql } from "@/db/admin";
import { withCompany } from "@/db/tenant";
import { accountMappings, accounts } from "@/db/schema";
import { defaultPsak118Tags } from "@/lib/akuntansi/psak118";
import { ensurePaymentDeductionAccounts } from "@/server/payment-deductions";
import { ensurePayrollIndonesiaAccounts } from "@/server/payroll-indonesia";
import { ensureFixedAssetAccounts } from "@/server/fixed-assets";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// Program Rekayasa — R3 K-2: test KARAKTERISASI paritas ensure akun
// sistem. Ditulis & dibuktikan pada implementasi LAMA (tiga salinan
// algoritma), lalu refactor ke src/server/system-accounts.ts wajib
// lulus TANPA test ini diubah.
//
// Skenario invarian (a, b, d, e, f) berperilaku identik pada mekanik
// lama payment/payroll (nama+tipe dulu) maupun fixed-assets (kode
// dulu). Skenario (c) TABRAKAN adalah satu-satunya titik di mana
// kedua mekanik lama BERBEDA hasil (akun pembawa nama-standar dan
// akun pembawa kode-standar hidup bersamaan): penyatuan memilih
// urutan fixed-assets (kode -> nama) — perubahan perilaku DISENGAJA
// yang dicatat di HASIL-R3; assertnya mengenkode hasil gabungan,
// sehingga pada kode lama payment/payroll assert (c) itu gagal
// (itulah bukti deltanya) dan lulus sesudah penyatuan.
// =====================================================================

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type Spec = {
  key: string;
  code: string;
  fallbackCode: string;
  name: string;
  type: string;
  normalBalance: string;
  section: string;
  cashFlowGroup: string;
};

const PAYMENT_SPECS: Spec[] = [
  { key: "tax_withholding_payable", code: "2130", fallbackCode: "2130-PPH", name: "Utang PPh Dipotong", type: "liability", normalBalance: "credit", section: "current_liability", cashFlowGroup: "operating" },
  { key: "receivable_writeoff", code: "6100", fallbackCode: "6100-WOF", name: "Beban Piutang Tak Tertagih", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
];

const PAYROLL_SPECS: Spec[] = [
  { key: "pph21_payable", code: "2110", fallbackCode: "2110-PPH", name: "Utang PPh 21", type: "liability", normalBalance: "credit", section: "current_liability", cashFlowGroup: "operating" },
  { key: "bpjs_payable", code: "2120", fallbackCode: "2120-BPJS", name: "Utang BPJS", type: "liability", normalBalance: "credit", section: "current_liability", cashFlowGroup: "operating" },
  { key: "payroll_employer_expense", code: "6080", fallbackCode: "6080-BPJS", name: "Beban Iuran BPJS Perusahaan", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
];

const FIXED_SPECS: Spec[] = [
  { key: "fixed_asset", code: "1500", fallbackCode: "1500-AST", name: "Aset Tetap", type: "asset", normalBalance: "debit", section: "non_current_asset", cashFlowGroup: "investing" },
  { key: "accumulated_depreciation", code: "1510", fallbackCode: "1510-AKM", name: "Akumulasi Penyusutan", type: "asset", normalBalance: "credit", section: "non_current_asset", cashFlowGroup: "investing" },
  { key: "depreciation_expense", code: "6090", fallbackCode: "6090-SST", name: "Beban Penyusutan", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
  { key: "asset_disposal_gain", code: "4030", fallbackCode: "4030-LPS", name: "Pendapatan Lain-lain", type: "revenue", normalBalance: "credit", section: "other_income", cashFlowGroup: "operating" },
  { key: "asset_disposal_loss", code: "6070", fallbackCode: "6070-RPS", name: "Beban Lain-lain", type: "expense", normalBalance: "debit", section: "other_expense", cashFlowGroup: "operating" },
];

type Domain = "payment" | "payroll" | "fixed";
const DOMAIN_SPECS: Record<Domain, Spec[]> = {
  payment: PAYMENT_SPECS,
  payroll: PAYROLL_SPECS,
  fixed: FIXED_SPECS,
};

const ORG_A = "01900000-0000-7000-8000-00000000e321";
const ORG_B = "01900000-0000-7000-8000-00000000e323";
const ORG_C = "01900000-0000-7000-8000-00000000e325";
const ORG_D = "01900000-0000-7000-8000-00000000e327";
const ORG_E = "01900000-0000-7000-8000-00000000e329";
const ORG_F = "01900000-0000-7000-8000-00000000e32b";
const ALL_ORGS = [ORG_A, ORG_B, ORG_C, ORG_D, ORG_E, ORG_F];

async function seedOrg(orgId: string, slug: string) {
  await adminSql`insert into organization (id, name, slug) values (${orgId}, ${"Uji Paritas " + slug}, ${slug}) on conflict do nothing`;
}

async function insertAccount(
  orgId: string,
  row: { code: string; name: string; type: string; normalBalance?: string },
): Promise<string> {
  return withCompany(orgId, async (tx) => {
    const [created] = await tx
      .insert(accounts)
      .values({
        companyId: orgId,
        code: row.code,
        name: row.name,
        type: row.type,
        normalBalance: row.normalBalance ?? (row.type === "asset" || row.type === "expense" ? "debit" : "credit"),
      })
      .returning({ id: accounts.id });
    return created.id;
  });
}

async function readAccounts(orgId: string) {
  return withCompany(orgId, (tx) =>
    tx.select().from(accounts).where(eq(accounts.companyId, orgId)),
  );
}

async function readMappings(orgId: string): Promise<Record<string, string>> {
  const rows = await withCompany(orgId, (tx) =>
    tx
      .select({ key: accountMappings.key, accountId: accountMappings.accountId })
      .from(accountMappings)
      .where(eq(accountMappings.companyId, orgId)),
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.accountId]));
}

/** Jalankan ensure satu domain; kembalikan peta pemetaan hasilnya
 * (untuk payroll yang void: peta dibaca ulang dari DB). */
async function runEnsure(domain: Domain, orgId: string): Promise<Record<string, string>> {
  return withCompany(orgId, async (tx) => {
    if (domain === "payment") return ensurePaymentDeductionAccounts(tx, orgId);
    if (domain === "fixed") return ensureFixedAssetAccounts(tx, orgId);
    await ensurePayrollIndonesiaAccounts(tx, orgId);
    const rows = await tx
      .select({ key: accountMappings.key, accountId: accountMappings.accountId })
      .from(accountMappings)
      .where(eq(accountMappings.companyId, orgId));
    return Object.fromEntries(rows.map((r) => [r.key, r.accountId]));
  });
}

beforeAll(async () => {
  await seedOrg(ORG_A, "paritas-a");
  await seedOrg(ORG_B, "paritas-b");
  await seedOrg(ORG_C, "paritas-c");
  await seedOrg(ORG_D, "paritas-d");
  await seedOrg(ORG_E, "paritas-e");
  await seedOrg(ORG_F, "paritas-f");
}, 120_000);

afterAll(async () => {
  for (const org of ALL_ORGS) await wipeCompanyFixture(adminSql, org, []);
});

describe("(a) bagan kosong — akun terbuat persis spec + pemetaan lengkap", () => {
  it.each(["payment", "payroll", "fixed"] as Domain[])("%s", async (domain) => {
    const map = await runEnsure(domain, ORG_A);
    const rows = await readAccounts(ORG_A);
    for (const spec of DOMAIN_SPECS[domain]) {
      const accountId = map[spec.key];
      expect(accountId, `pemetaan ${spec.key}`).toBeTruthy();
      const account = rows.find((r) => r.id === accountId);
      expect(account).toBeTruthy();
      expect(account?.code).toBe(spec.code);
      expect(account?.name).toBe(spec.name);
      expect(account?.type).toBe(spec.type);
      expect(account?.normalBalance).toBe(spec.normalBalance);
      expect(account?.section).toBe(spec.section);
      expect(account?.cashFlowGroup).toBe(spec.cashFlowGroup);
      const tags = defaultPsak118Tags(spec.type, spec.section);
      expect(account?.psak118Category).toBe(tags.psak118Category);
      expect(account?.expenseNature).toBe(tags.expenseNature);
      expect(account?.expenseFunction).toBe(tags.expenseFunction);
    }
  });

  it("fixed: akumulasi penyusutan tertandai kontra dari aset tetap", async () => {
    const rows = await readAccounts(ORG_A);
    const map = await readMappings(ORG_A);
    const accumulated = rows.find((r) => r.id === map.accumulated_depreciation);
    expect(accumulated?.isContra).toBe(true);
    expect(accumulated?.contraOf).toBe(map.fixed_asset);
  });
});

describe("(b) akun nama+tipe sudah ada — dipakai ulang, nol duplikat", () => {
  it("payment: 'Utang PPh Dipotong' berkode lain dipakai ulang", async () => {
    const existingId = await insertAccount(ORG_B, { code: "9999", name: "Utang PPh Dipotong", type: "liability" });
    const map = await runEnsure("payment", ORG_B);
    expect(map.tax_withholding_payable).toBe(existingId);
    const rows = await readAccounts(ORG_B);
    expect(rows.filter((r) => r.name === "Utang PPh Dipotong")).toHaveLength(1);
    expect(rows.some((r) => r.code === "2130")).toBe(false);
  });

  it("payroll: 'Utang BPJS' berkode lain dipakai ulang", async () => {
    const existingId = await insertAccount(ORG_B, { code: "9997", name: "Utang BPJS", type: "liability" });
    const map = await runEnsure("payroll", ORG_B);
    expect(map.bpjs_payable).toBe(existingId);
    const rows = await readAccounts(ORG_B);
    expect(rows.filter((r) => r.name === "Utang BPJS")).toHaveLength(1);
  });

  it("fixed: 'Aset Tetap' berkode lain dipakai ulang", async () => {
    const existingId = await insertAccount(ORG_B, { code: "1599", name: "Aset Tetap", type: "asset" });
    const map = await runEnsure("fixed", ORG_B);
    expect(map.fixed_asset).toBe(existingId);
    const rows = await readAccounts(ORG_B);
    expect(rows.filter((r) => r.name === "Aset Tetap")).toHaveLength(1);
  });
});

describe("(d) kode spec terpakai akun tak terkait — fallbackCode dipakai", () => {
  it("payment: kode 2130 terpakai akun aset -> akun baru 2130-PPH", async () => {
    await insertAccount(ORG_D, { code: "2130", name: "Kas Kecil", type: "asset" });
    const map = await runEnsure("payment", ORG_D);
    const rows = await readAccounts(ORG_D);
    const created = rows.find((r) => r.id === map.tax_withholding_payable);
    expect(created?.code).toBe("2130-PPH");
    expect(created?.name).toBe("Utang PPh Dipotong");
  });

  it("payroll: kode 2110 terpakai akun aset -> akun baru 2110-PPH", async () => {
    await insertAccount(ORG_D, { code: "2110", name: "Kas Besar", type: "asset" });
    const map = await runEnsure("payroll", ORG_D);
    const rows = await readAccounts(ORG_D);
    const created = rows.find((r) => r.id === map.pph21_payable);
    expect(created?.code).toBe("2110-PPH");
  });

  it("fixed: kode 1500 terpakai akun liabilitas -> akun baru 1500-AST", async () => {
    await insertAccount(ORG_D, { code: "1500", name: "Utang Jangka Panjang", type: "liability" });
    const map = await runEnsure("fixed", ORG_D);
    const rows = await readAccounts(ORG_D);
    const created = rows.find((r) => r.id === map.fixed_asset);
    expect(created?.code).toBe("1500-AST");
    expect(created?.type).toBe("asset");
  });
});

describe("(e) pemetaan sudah ada — nol perubahan pada kunci itu", () => {
  it("payment: pemetaan tax_withholding_payable yang ada tidak ditimpa", async () => {
    const existingId = await insertAccount(ORG_E, { code: "7777", name: "Akun Bebas", type: "liability" });
    await withCompany(ORG_E, async (tx) => {
      await tx.insert(accountMappings).values({
        companyId: ORG_E,
        key: "tax_withholding_payable",
        accountId: existingId,
      });
    });
    const map = await runEnsure("payment", ORG_E);
    expect(map.tax_withholding_payable).toBe(existingId);
    const rows = await readAccounts(ORG_E);
    expect(rows.some((r) => r.name === "Utang PPh Dipotong")).toBe(false);
  });
});

describe("(f) panggil dua kali — idempoten", () => {
  it.each(["payment", "payroll", "fixed"] as Domain[])("%s", async (domain) => {
    const first = await runEnsure(domain, ORG_F);
    const countAfterFirst = (await readAccounts(ORG_F)).length;
    const second = await runEnsure(domain, ORG_F);
    const rowsAfterSecond = await readAccounts(ORG_F);
    expect(rowsAfterSecond).toHaveLength(countAfterFirst);
    for (const spec of DOMAIN_SPECS[domain]) {
      expect(second[spec.key]).toBe(first[spec.key]);
    }
  });
});

// (c) TABRAKAN — perubahan perilaku DISENGAJA penyatuan K-2 (lihat
// kepala berkas): akun pembawa NAMA standar dan akun pembawa KODE
// standar (nama lain, tipe sama) hidup bersamaan. Mekanik gabungan
// (kode -> nama, warisan fixed-assets) mengikat ke pembawa KODE.
describe("(c) tabrakan nama vs kode — gabungan mengikat ke kode", () => {
  it("payment: 2130 bernama lain menang atas 'Utang PPh Dipotong' berkode 9998", async () => {
    await insertAccount(ORG_C, { code: "9998", name: "Utang PPh Dipotong", type: "liability" });
    const codeId = await insertAccount(ORG_C, { code: "2130", name: "Utang Lain Ternyata", type: "liability" });
    const map = await runEnsure("payment", ORG_C);
    expect(map.tax_withholding_payable).toBe(codeId);
  });

  it("payroll: 2110 bernama lain menang atas 'Utang PPh 21' berkode 9996", async () => {
    await insertAccount(ORG_C, { code: "9996", name: "Utang PPh 21", type: "liability" });
    const codeId = await insertAccount(ORG_C, { code: "2110", name: "Utang Pajak Lain", type: "liability" });
    const map = await runEnsure("payroll", ORG_C);
    expect(map.pph21_payable).toBe(codeId);
  });

  it("fixed: 1500 bernama lain menang atas 'Aset Tetap' berkode 1598", async () => {
    await insertAccount(ORG_C, { code: "1598", name: "Aset Tetap", type: "asset" });
    const codeId = await insertAccount(ORG_C, { code: "1500", name: "Tanah & Bangunan", type: "asset" });
    const map = await runEnsure("fixed", ORG_C);
    expect(map.fixed_asset).toBe(codeId);
  });
});
