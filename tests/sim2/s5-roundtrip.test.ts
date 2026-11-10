import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  branches,
  categories,
  companySettings,
  customerGroups,
  customers,
  importJobs,
  importRows,
  journalLines,
  member,
  organization,
  paymentMethods,
  products,
  stockOnHand,
  suppliers,
  units,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { createReceipt } from "@/server/inventory";
import { createOpeningBalance } from "@/server/opening-balances";
import { openCashSession } from "@/server/pos";
import { checkoutAction } from "@/server/actions/pos";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  getInventoryValuation,
  listPayables,
  listReceivables,
} from "@/server/reports";
import { GET as exportProductsRoute } from "@/app/api/export/products/route";
import { GET as exportSuppliersRoute } from "@/app/api/export/suppliers/route";
import { GET as exportCustomersRoute } from "@/app/api/export/customers/route";
import { GET as exportAccountsRoute } from "@/app/api/export/accounts/route";
import { ENTITY_FIELDS, suggestMappingFor, type ImportEntity } from "@/lib/import-parse";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

/**
 * SIM-2 Fase S5 — Round-trip tingkat aplikasi (mandat §11).
 *
 * Perusahaan sumber fixture (…cc05) menjalankan bisnis nyata lewat domain
 * (penerimaan kredit, saldo awal AP/AR, penjualan POS tunai + utang), lalu
 * EKSPOR lewat rute ekspor aplikasi yang sesungguhnya, dan hasilnya
 * DIIMPOR ke perusahaan baru kosong (…cc06) lewat jalur impor aplikasi
 * yang sesungguhnya (job → analyze → commit). Angka sumber vs tujuan
 * dibandingkan per entitas, per saldo, per stok, dan per laporan.
 *
 * Yang secara desain TIDAK bisa ikut round-trip (riwayat jurnal transaksi
 * terposting) dibuktikan dengan angka, bukan disembunyikan: perusahaan
 * tujuan tidak memiliki pendapatan/HPP/kas dari transaksi sumber.
 */

// Sesi dapat dipindah antar perusahaan fixture (sumber ↔ tujuan).
const sessionState = vi.hoisted(() => ({ companyId: "", userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: sessionState.companyId },
    user: { id: sessionState.userId },
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

const SRC = "01900000-0000-7000-8000-00000000cc05";
const DST = "01900000-0000-7000-8000-00000000cc06";
const SRC_OWNER = "01900000-0000-7000-8000-00000000cc15";
const DST_OWNER = "01900000-0000-7000-8000-00000000cc16";
const TODAY = todayISO();

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const DUE = addDays(TODAY, 14);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const F: Record<string, string> = {}; // id per perusahaan: `${org}:${key}`
const key = (org: string, name: string) => `${org}:${name}`;

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1010", "Kas Kecil", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1210", "Kredit Pemasok", "asset", "debit"],
  ["1220", "Piutang Karyawan", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["1400", "Perlengkapan", "asset", "debit"],
  ["1500", "Peralatan Toko", "asset", "debit"],
  ["1510", "Akumulasi Penyusutan Peralatan", "asset", "credit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["2100", "Utang Gaji", "liability", "credit"],
  ["2200", "PPN Keluaran", "liability", "credit"],
  ["2300", "Kredit Pelanggan", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["3100", "Laba Ditahan", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["5010", "Selisih Persediaan", "cogs", "debit"],
  ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
  ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ["6010", "Beban Sewa", "expense", "debit"],
  ["6020", "Beban Listrik dan Air", "expense", "debit"],
  ["6030", "Beban Telepon dan Internet", "expense", "debit"],
  ["6040", "Beban Transportasi", "expense", "debit"],
  ["6050", "Beban Perlengkapan", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
  ["6070", "Beban Lain-lain", "expense", "debit"],
  ["8000", "Selisih Kas Kurang", "expense", "debit"],
  ["8001", "Selisih Kas Lebih", "revenue", "credit"],
  ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
  ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
];

async function wipeCompany(orgId: string, ownerId: string) {
  const tables = await adminSql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'company_id'
    group by table_name order by table_name`;
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    for (const { table_name } of tables) {
      await tx.unsafe(`DELETE FROM "${table_name}" WHERE company_id = $1`, [orgId]);
    }
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [orgId]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [orgId]);
    await tx.unsafe(`DELETE FROM session WHERE user_id = $1`, [ownerId]);
    await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [ownerId]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [ownerId]);
  });
}

async function bootstrapCompany(orgId: string, ownerId: string, name: string, slug: string) {
  await wipeCompany(orgId, ownerId);
  await adminDb.insert(user).values({
    id: ownerId, name: `Pemilik ${name}`, email: `owner@${slug}.id`,
    emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: ownerId, providerId: "credential",
    userId: ownerId, password: "fixture-tidak-dipakai",
  });
  await adminDb.insert(organization).values({ id: orgId, name, slug, createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: orgId, userId: ownerId,
    role: "owner", createdAt: new Date(),
  });
  const [branch] = await adminDb.insert(branches)
    .values({ companyId: orgId, code: "BR-RT", name: `${name} Pusat`, isDefault: true })
    .returning();
  const [wh] = await adminDb.insert(warehouses)
    .values({ companyId: orgId, branchId: branch.id, code: "WH-RT", name: "Gudang RT", type: "warehouse", isDefault: true })
    .returning();
  F[key(orgId, "wh")] = wh.id;
  await adminDb.insert(companySettings).values({
    companyId: orgId, legalName: name, defaultWarehouseId: wh.id,
    roundingMode: "none", taxRate: "0", taxEnabled: false, allowNegativeStock: false,
  });
  const accountRows = await adminDb.insert(accounts)
    .values(ACCOUNT_SEEDS.map(([code, accName, type, normalBalance]) => ({
      companyId: orgId, code, name: accName, type, normalBalance,
    })))
    .returning();
  const acc: Record<string, string> = {};
  for (const row of accountRows) acc[row.code] = row.id;
  F[key(orgId, "acc")] = JSON.stringify(acc);
  const mapping: Record<string, string> = {
    cash: acc["1000"], bank: acc["1100"], qris: acc["1110"],
    receivable: acc["1200"], supplier_credit: acc["1210"],
    employee_receivable: acc["1220"], inventory: acc["1300"],
    payable: acc["2000"], revenue: acc["4000"],
    sales_discount: acc["4010"], sales_return: acc["4020"],
    cogs: acc["5000"], inventory_shrink: acc["5010"], damaged: acc["5020"],
    tax_output: acc["2200"], rounding_gain: acc["9000"],
    rounding_loss: acc["9001"], cash_short: acc["8000"],
    cash_over: acc["8001"], salary_expense: acc["6000"],
    salary_payable: acc["2100"], bank_fee: acc["6060"],
    equity: acc["3000"], customer_credit: acc["2300"],
  };
  await adminDb.insert(accountMappings).values(
    Object.entries(mapping).map(([k, accountId]) => ({ companyId: orgId, key: k, accountId })),
  );
  const methodRows = await adminDb.insert(paymentMethods)
    .values([
      { companyId: orgId, code: "CASH", name: "Tunai", type: "cash", accountId: mapping.cash, sortOrder: 1 },
      { companyId: orgId, code: "QRIS", name: "QRIS", type: "qris", accountId: mapping.qris, sortOrder: 2 },
      { companyId: orgId, code: "CREDIT", name: "Utang / Tempo", type: "credit", accountId: mapping.receivable, sortOrder: 3 },
    ])
    .returning();
  for (const row of methodRows) F[key(orgId, `method:${row.code}`)] = row.id;
  await adminDb.insert(customerGroups)
    .values({ companyId: orgId, name: "Umum", roundingStep: 0, roundingDirection: "down" });
  const [category] = await adminDb.insert(categories)
    .values({ companyId: orgId, name: "Umum" }).returning();
  F[key(orgId, "category")] = category.id;
  const [unit] = await adminDb.insert(units)
    .values({ companyId: orgId, code: "PCS", name: "Pieces" }).returning();
  F[key(orgId, "unit")] = unit.id;
}

function accOf(orgId: string): Record<string, string> {
  return JSON.parse(F[key(orgId, "acc")]) as Record<string, string>;
}

async function glBalance(orgId: string, code: string): Promise<number> {
  return withCompanyReadOnly(orgId, async (tx) => {
    const [row] = await tx
      .select({ bal: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .where(and(eq(journalLines.companyId, orgId), eq(journalLines.accountId, accOf(orgId)[code])));
    return d(row.bal).toNumber();
  });
}

async function countRows(orgId: string, table: "products" | "suppliers" | "customers" | "accounts"): Promise<number> {
  return withCompanyReadOnly(orgId, async (tx) => {
    const t = { products, suppliers, customers, accounts }[table];
    const rows = await tx.select({ id: t.id }).from(t).where(eq(t.companyId, orgId));
    return rows.length;
  });
}

// --- CSV sederhana (fixture tanpa koma dalam nilai; tetap menangani kutip) ---
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); cell = ""; lines.push(row); row = []; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); lines.push(row); }
  const nonEmpty = lines.filter((l) => l.some((c) => c.trim() !== ""));
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? "").trim(); });
    return obj;
  });
  return { headers, rows };
}

const exportsCsv: Record<string, { headers: string[]; rows: Record<string, string>[] }> = {};
const commitLog: Record<string, unknown> = {};

async function runImport(
  entity: ImportEntity,
  rows: Record<string, string>[],
  mapping: Partial<Record<string, string>>,
  extra?: { warehouseId?: string },
) {
  sessionState.companyId = DST;
  sessionState.userId = DST_OWNER;
  const jobId = await withCompany(DST, async (tx) => {
    const [job] = await tx.insert(importJobs)
      .values({
        companyId: DST, entity, fileName: `s5-roundtrip-${entity}.csv`,
        status: "preview", totalRows: rows.length, mapping, createdBy: DST_OWNER,
      })
      .returning({ id: importJobs.id });
    if (rows.length > 0) {
      await tx.insert(importRows).values(rows.map((data, index) => ({
        companyId: DST, jobId: job.id, rowNumber: index + 1, data, status: "pending",
      })));
    }
    return job.id;
  });
  const analyzed = await analyzeImportAction({ jobId, mapping });
  expect(analyzed.ok).toBe(true);
  const totals = { imported: 0, updated: 0, skipped: 0, failed: 0, processed: 0, done: false, receiptNumber: null as string | null };
  for (let guard = 0; guard < 20; guard += 1) {
    const result = await commitImportBatchAction({
      jobId, mapping, limit: 200,
      ...(extra?.warehouseId ? { warehouseId: extra.warehouseId } : {}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) break;
    const data = result.data as unknown as Record<string, number | boolean | string | null>;
    totals.imported += Number(data.imported ?? 0);
    totals.updated += Number(data.updated ?? 0);
    totals.skipped += Number(data.skipped ?? 0);
    totals.failed += Number(data.failed ?? 0);
    totals.processed += Number(data.processed ?? 0);
    totals.done = Boolean(data.done);
    if (typeof data.receiptNumber === "string") totals.receiptNumber = data.receiptNumber;
    if (totals.done || Number(data.processed ?? 0) === 0) break;
  }
  commitLog[entity] = totals;
  return totals;
}

beforeAll(async () => {
  await bootstrapCompany(SRC, SRC_OWNER, "Sumber RT", "sumber-rt");
  await bootstrapCompany(DST, DST_OWNER, "Tujuan RT", "tujuan-rt");
});

afterAll(async () => {
  await wipeCompany(SRC, SRC_OWNER);
  await wipeCompany(DST, DST_OWNER);
});

describe("S5.1 data bisnis perusahaan sumber (domain asli)", () => {
  it("master sumber: 2 pemasok (1 berfield §18D lengkap), 2 pelanggan, 2 produk, 1 akun kustom", async () => {
    const [s1, s2] = await adminDb.insert(suppliers).values([
      {
        companyId: SRC, code: "RT-S1", name: "PT Sumber Roundtrip", phone: "021-7000-111",
        email: "halo@sumber-rt.id", address: "Jl Melati No 1", taxId: "01.111.222.3-444.000",
        bankName: "BCA", bankAccountNumber: "1234567890", bankAccountName: "PT Sumber Roundtrip",
        paymentTermDays: 30,
      },
      { companyId: SRC, code: "RT-S2", name: "CV Kedua Roundtrip", phone: "021-7000-222" },
    ]).returning();
    F[key(SRC, "s1")] = s1.id;
    F[key(SRC, "s2")] = s2.id;

    const [group] = await withCompanyReadOnly(SRC, (tx) =>
      tx.select().from(customerGroups).where(eq(customerGroups.companyId, SRC)));
    const [c1, c2] = await adminDb.insert(customers).values([
      {
        companyId: SRC, code: "RT-C1", name: "Toko Berkah RT", phone: "0813-000-111",
        groupId: group.id, creditLimit: "5000000", taxId: "02.222.333.4-555.000", paymentTermDays: 14,
      },
      { companyId: SRC, code: "RT-C2", name: "Ibu Ani RT", groupId: group.id, creditLimit: "0" },
    ]).returning();
    F[key(SRC, "c1")] = c1.id;
    F[key(SRC, "c2")] = c2.id;

    const [p1, p2] = await adminDb.insert(products).values([
      {
        companyId: SRC, sku: "RT-001", name: "Kopi Roundtrip 250g", barcode: "8999001001",
        categoryId: F[key(SRC, "category")], unitId: F[key(SRC, "unit")], supplierId: s1.id,
        costPrice: "2500", salePrice: "3000", minStock: "5",
      },
      {
        companyId: SRC, sku: "RT-002", name: "Susu Roundtrip 1L", barcode: "8999001002",
        categoryId: F[key(SRC, "category")], unitId: F[key(SRC, "unit")], supplierId: s1.id,
        costPrice: "10000", salePrice: "12500", minStock: "2",
      },
    ]).returning();
    F[key(SRC, "p1")] = p1.id;
    F[key(SRC, "p2")] = p2.id;

    // Akun kustom yang hanya ada di sumber — harus ikut round-trip.
    await adminDb.insert(accounts).values({
      companyId: SRC, code: "6950", name: "Beban Konsultasi RT", type: "expense", normalBalance: "debit",
    });
    expect(await countRows(SRC, "accounts")).toBe(37); // 36 bagan standar + 1 kustom
  });

  it("penerimaan kredit Rp450.000 + saldo awal utang Rp75.000 + saldo awal piutang Rp120.000", async () => {
    await withCompany(SRC, (tx) =>
      createReceipt(tx, {
        companyId: SRC, userId: SRC_OWNER, warehouseId: F[key(SRC, "wh")],
        supplierId: F[key(SRC, "s1")], source: "purchase",
        supplierInvoiceNumber: "INV-RT-001", date: TODAY,
        lines: [
          { productId: F[key(SRC, "p1")], qty: "100", unitCost: "2500" },
          { productId: F[key(SRC, "p2")], qty: "20", unitCost: "10000" },
        ],
      }));
    await withCompany(SRC, (tx) =>
      createOpeningBalance(tx, {
        companyId: SRC, userId: SRC_OWNER, kind: "payable", partyId: F[key(SRC, "s2")],
        date: TODAY, dueDate: addDays(TODAY, 30), amount: 75_000, reference: "INV-LAMA-RT-01",
      }));
    await withCompany(SRC, (tx) =>
      createOpeningBalance(tx, {
        companyId: SRC, userId: SRC_OWNER, kind: "receivable", partyId: F[key(SRC, "c1")],
        date: TODAY, dueDate: DUE, amount: 120_000, reference: "INV-LAMA-RT-101",
      }));
    expect(await glBalance(SRC, "2000")).toBe(-525_000);
    expect(await glBalance(SRC, "1200")).toBe(120_000);
  });

  it("POS: jual tunai 5×RT-001 (Rp15.000) + jual utang 10×RT-002 ke RT-C1 (Rp125.000)", async () => {
    await withCompany(SRC, (tx) =>
      openCashSession(tx, { companyId: SRC, userId: SRC_OWNER, openingCash: 0 }));
    sessionState.companyId = SRC;
    sessionState.userId = SRC_OWNER;
    const cash = await checkoutAction({
      warehouseId: F[key(SRC, "wh")],
      lines: [{ productId: F[key(SRC, "p1")], qty: 5 }],
      payments: [{ methodId: F[key(SRC, "method:CASH")], amount: 15_000, tendered: 15_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(cash.ok).toBe(true);
    const debt = await checkoutAction({
      warehouseId: F[key(SRC, "wh")],
      customerId: F[key(SRC, "c1")],
      dueDate: DUE,
      lines: [{ productId: F[key(SRC, "p2")], qty: 10 }],
      payments: [{ methodId: F[key(SRC, "method:CREDIT")], amount: 125_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(debt.ok).toBe(true);

    // Ekspektasi sumber (dihitung tangan): stok P1 95, P2 10;
    // nilai persediaan 95×2.500 + 10×10.000 = Rp337.500;
    // utang terbuka 525.000; piutang terbuka 120.000 + 125.000 = 245.000.
    const valuation = await withCompanyReadOnly(SRC, (tx) => getInventoryValuation(tx, SRC));
    expect(d(valuation.totalValue).toNumber()).toBe(337_500);
    const payables = await withCompanyReadOnly(SRC, (tx) => listPayables(tx, SRC));
    expect(payables.reduce((sum, r) => sum + r.outstanding, 0)).toBe(525_000);
    expect(payables).toHaveLength(2);
    const receivables = await withCompanyReadOnly(SRC, (tx) => listReceivables(tx, SRC));
    expect(receivables.reduce((sum, r) => sum + r.outstanding, 0)).toBe(245_000);
    expect(receivables).toHaveLength(2);
    F.payableDocs = JSON.stringify(payables.map((r) => ({
      supplierId: r.supplierId, date: r.date, dueDate: r.dueDate,
      outstanding: r.outstanding, number: r.number, reference: r.reference ?? null,
    })));
    F.receivableDocs = JSON.stringify(receivables.map((r) => ({
      customerId: r.customerId, date: r.date, dueDate: r.dueDate,
      outstanding: r.outstanding, number: r.number, reference: r.reference ?? null,
    })));
  });
});

describe("S5.2 ekspor perusahaan sumber lewat rute aplikasi asli", () => {
  it("ekspor produk/pemasok/pelanggan/akun menghasilkan CSV yang dapat diurai", async () => {
    sessionState.companyId = SRC;
    sessionState.userId = SRC_OWNER;
    const grab = async (fn: (req?: Request) => Promise<Response>, url: string) => {
      const res = await fn(new Request(url));
      expect(res.status).toBe(200);
      return parseCsv(await res.text());
    };
    exportsCsv.products = await grab(exportProductsRoute, "http://localhost/api/export/products");
    exportsCsv.suppliers = await grab(exportSuppliersRoute, "http://localhost/api/export/suppliers");
    exportsCsv.customers = await grab(exportCustomersRoute, "http://localhost/api/export/customers");
    exportsCsv.accounts = await grab(exportAccountsRoute, "http://localhost/api/export/accounts");
    expect(exportsCsv.products.rows).toHaveLength(2);
    expect(exportsCsv.suppliers.rows).toHaveLength(2);
    expect(exportsCsv.customers.rows).toHaveLength(2);
    expect(exportsCsv.accounts.rows).toHaveLength(37);
  });
});

describe("S5.3 impor ke perusahaan tujuan lewat jalur impor asli", () => {
  it("akun: 36 kode standar sudah ada (tidak diduplikat), akun kustom 6950 masuk", async () => {
    const rows = exportsCsv.accounts.rows;
    const mapping = { code: "Kode", name: "Nama", type: "Tipe", normalBalance: "Saldo Normal", section: "Bagian" };
    await runImport("accounts", rows, mapping);
    expect(await countRows(DST, "accounts")).toBe(37);
    const codes = await withCompanyReadOnly(DST, (tx) =>
      tx.select({ code: accounts.code }).from(accounts).where(eq(accounts.companyId, DST)));
    expect(new Set(codes.map((c) => c.code)).size).toBe(37);
    expect(codes.some((c) => c.code === "6950")).toBe(true);
  });

  it("pemasok & pelanggan: jumlah sama dan field §18D (NPWP/bank/termin/batas kredit) utuh", async () => {
    await runImport("suppliers", exportsCsv.suppliers.rows,
      suggestMappingFor(ENTITY_FIELDS.suppliers, exportsCsv.suppliers.headers));
    await runImport("customers", exportsCsv.customers.rows,
      suggestMappingFor(ENTITY_FIELDS.customers, exportsCsv.customers.headers));
    expect(await countRows(DST, "suppliers")).toBe(2);
    expect(await countRows(DST, "customers")).toBe(2);
    const [s1] = await withCompanyReadOnly(DST, (tx) =>
      tx.select().from(suppliers).where(and(eq(suppliers.companyId, DST), eq(suppliers.code, "RT-S1"))));
    expect(s1.taxId).toBe("01.111.222.3-444.000");
    expect(s1.bankName).toBe("BCA");
    expect(s1.bankAccountNumber).toBe("1234567890");
    expect(s1.paymentTermDays).toBe(30);
    F[key(DST, "s1")] = s1.id;
    const [s2] = await withCompanyReadOnly(DST, (tx) =>
      tx.select().from(suppliers).where(and(eq(suppliers.companyId, DST), eq(suppliers.code, "RT-S2"))));
    F[key(DST, "s2")] = s2.id;
    const [c1] = await withCompanyReadOnly(DST, (tx) =>
      tx.select().from(customers).where(and(eq(customers.companyId, DST), eq(customers.code, "RT-C1"))));
    expect(d(c1.creditLimit).toNumber()).toBe(5_000_000);
    expect(c1.taxId).toBe("02.222.333.4-555.000");
    expect(c1.paymentTermDays).toBe(14);
    F[key(DST, "c1")] = c1.id;
  });

  it("produk: 2 produk masuk dengan harga/kategori/satuan/pemasok yang sama", async () => {
    const mapping = {
      sku: "Kode Barang", name: "Nama Barang", barcode: "Barcode", category: "Kategori",
      unit: "Satuan", supplier: "Pemasok", costPrice: "Harga Beli", salePrice: "Harga Jual",
      minStock: "Stok Minimum", notes: "Keterangan",
    };
    await runImport("products", exportsCsv.products.rows, mapping);
    expect(await countRows(DST, "products")).toBe(2);
    const rows = await withCompanyReadOnly(DST, (tx) =>
      tx.select().from(products).where(eq(products.companyId, DST)));
    const p1 = rows.find((r) => r.sku === "RT-001");
    const p2 = rows.find((r) => r.sku === "RT-002");
    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(d(p1!.costPrice).toNumber()).toBe(2_500);
    expect(d(p1!.salePrice).toNumber()).toBe(3_000);
    expect(d(p2!.costPrice).toNumber()).toBe(10_000);
    expect(p1!.supplierId).toBe(F[key(DST, "s1")]);
    F[key(DST, "p1")] = p1!.id;
    F[key(DST, "p2")] = p2!.id;
  });

  it("stok awal: qty & nilai persediaan tujuan = sumber (95/10, Rp337.500)", async () => {
    const rows = [
      { SKU: "RT-001", "Nama Produk": "Kopi Roundtrip 250g", Qty: "95", "Biaya Satuan": "2500" },
      { SKU: "RT-002", "Nama Produk": "Susu Roundtrip 1L", Qty: "10", "Biaya Satuan": "10000" },
    ];
    await runImport("opening_stock", rows,
      suggestMappingFor(ENTITY_FIELDS.opening_stock, Object.keys(rows[0])),
      { warehouseId: F[key(DST, "wh")] });
    const onHand = await withCompanyReadOnly(DST, (tx) =>
      tx.select().from(stockOnHand).where(eq(stockOnHand.companyId, DST)));
    const byProduct = new Map(onHand.map((r) => [r.productId, d(r.qty).toNumber()]));
    expect(byProduct.get(F[key(DST, "p1")])).toBe(95);
    expect(byProduct.get(F[key(DST, "p2")])).toBe(10);
    const valuation = await withCompanyReadOnly(DST, (tx) => getInventoryValuation(tx, DST));
    expect(d(valuation.totalValue).toNumber()).toBe(337_500);
  });

  it("saldo awal utang/piutang per dokumen: total & per pihak tujuan = sumber", async () => {
    const supplierCode = new Map([
      [F[key(SRC, "s1")], "RT-S1"],
      [F[key(SRC, "s2")], "RT-S2"],
    ]);
    const payableDocs = JSON.parse(F.payableDocs) as Array<{
      supplierId: string; date: string; dueDate: string | null;
      outstanding: number; number: string; reference: string | null;
    }>;
    const apRows = payableDocs.map((doc) => ({
      "Nama Pemasok": supplierCode.get(doc.supplierId) ?? "",
      Tanggal: doc.date,
      "Jatuh Tempo": doc.dueDate ?? "",
      Jumlah: String(doc.outstanding),
      Referensi: doc.reference ?? doc.number,
    }));
    await runImport("opening_payables", apRows,
      suggestMappingFor(ENTITY_FIELDS.opening_payables, Object.keys(apRows[0])));

    const arDocs = JSON.parse(F.receivableDocs) as Array<{
      customerId: string; date: string; dueDate: string | null;
      outstanding: number; number: string; reference: string | null;
    }>;
    const arRows = arDocs.map((doc) => ({
      "Nama Pelanggan": "RT-C1",
      Tanggal: doc.date,
      "Jatuh Tempo": doc.dueDate ?? "",
      Jumlah: String(doc.outstanding),
      Referensi: doc.reference ?? doc.number,
    }));
    await runImport("opening_receivables", arRows,
      suggestMappingFor(ENTITY_FIELDS.opening_receivables, Object.keys(arRows[0])));

    const payables = await withCompanyReadOnly(DST, (tx) => listPayables(tx, DST));
    expect(payables.reduce((sum, r) => sum + r.outstanding, 0)).toBe(525_000);
    expect(payables).toHaveLength(2);
    const receivables = await withCompanyReadOnly(DST, (tx) => listReceivables(tx, DST));
    expect(receivables.reduce((sum, r) => sum + r.outstanding, 0)).toBe(245_000);
    expect(receivables).toHaveLength(2);
  });
});

describe("S5.4 perbandingan laporan & batas round-trip", () => {
  it("neraca tujuan dari saldo awal: Persediaan 337.500 Dr, Piutang 245.000 Dr, Utang 525.000 Cr, Modal 57.500 Cr, jurnal seimbang", async () => {
    expect(await glBalance(DST, "1300")).toBe(337_500);
    expect(await glBalance(DST, "1200")).toBe(245_000);
    expect(await glBalance(DST, "2000")).toBe(-525_000);
    expect(await glBalance(DST, "3000")).toBe(-57_500);
    const [tb] = await withCompanyReadOnly(DST, async (tx) => {
      const rows = await tx
        .select({
          dr: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
          cr: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .where(eq(journalLines.companyId, DST));
      return rows;
    });
    expect(d(tb.dr).toNumber()).toBe(d(tb.cr).toNumber());
  });

  it("riwayat transaksi sumber TIDAK ikut round-trip: pendapatan & kas sumber ada, tujuan nol (batas §11 tingkat aplikasi)", async () => {
    // Sumber: penjualan 125.000 + 15.000 = 140.000; kas tunai 15.000.
    expect(await glBalance(SRC, "4000")).toBe(-140_000);
    expect(await glBalance(SRC, "1000")).toBe(15_000);
    expect(await glBalance(SRC, "5000")).toBe(112_500);
    // Tujuan: tidak ada satu pun jurnal penjualan/HPP/kas dari transaksi.
    expect(await glBalance(DST, "4000")).toBe(0);
    expect(await glBalance(DST, "1000")).toBe(0);
    expect(await glBalance(DST, "5000")).toBe(0);
  });

  it("impor produk ulang tidak menggandakan produk (SKU diperbarui, bukan dibuat baru)", async () => {
    const mapping = {
      sku: "Kode Barang", name: "Nama Barang", barcode: "Barcode", category: "Kategori",
      unit: "Satuan", supplier: "Pemasok", costPrice: "Harga Beli", salePrice: "Harga Jual",
      minStock: "Stok Minimum", notes: "Keterangan",
    };
    await runImport("products", exportsCsv.products.rows, mapping);
    expect(await countRows(DST, "products")).toBe(2);
    // Bukti angka commit untuk laporan S5.
    console.log("S5 commit log:", JSON.stringify(commitLog));
  });
});
