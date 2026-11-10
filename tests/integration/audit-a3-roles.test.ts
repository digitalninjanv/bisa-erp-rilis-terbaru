import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { adminSql } from "@/db/admin";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  accounts,
  accountMappings,
  companySettings,
  member,
  organization,
  paymentMethods,
  products,
  sales,
  user,
  warehouses,
} from "@/db/schema";
import { todayISO } from "@/lib/format";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { ensureFiscalPeriods } from "@/server/accounting";
import { createSale, openCashSession, quoteCart } from "@/server/pos";
import { applyStockMovement as applyInvMovement } from "@/server/inventory";
import { postManualJournalAction } from "@/server/actions/accounting/jurnal";
import { saveSettingsAction } from "@/server/actions/settings/identitas-pajak";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import {
  searchCustomersAction,
  searchProductsAction,
  voidSaleAction,
} from "@/server/actions/pos";
import { saveProductAction } from "@/server/actions/inventory/produk";
import { saveCustomerAction } from "@/server/actions/inventory/pihak";
import { GET as productsExportGET } from "@/app/api/export/products/route";
import { GET as inventoryExportGET } from "@/app/api/export/inventory/route";
import { GET as accountsExportGET } from "@/app/api/export/accounts/route";
import { GET as journalsExportGET } from "@/app/api/export/journals/route";
import { GET as ledgerExportGET } from "@/app/api/export/ledger/route";
import { GET as reportExportGET } from "@/app/api/export/report/route";
import { GET as agingExportGET } from "@/app/api/export/aging/route";
import { GET as customersExportGET } from "@/app/api/export/customers/route";
import { GET as suppliersExportGET } from "@/app/api/export/suppliers/route";
import { GET as payrollExportGET } from "@/app/api/export/payroll/route";
import ProductsPage from "@/app/app/gudang/produk/page";
import CustomerDetailPage from "@/app/app/gudang/pelanggan/[id]/page";

// =====================================================================
// Program Audit Produksi — Tahap A3: matriks peran LANGSUNG + injeksi.
//
// Berbeda dari mock sesi statis suite lain: yang dipalsukan HANYA
// lapisan autentikasi Better Auth (`@/lib/auth`) dan cookie Next —
// resolusi sesi ASLI (`@/lib/session`: member → permissionsFor →
// assertCan) berjalan terhadap baris `member` sungguhan di perusahaan
// fixture buangan (…a301). Peran diganti dengan memperbarui baris
// member, persis cara produksi menyelesaikan peran. Aksi dan route
// ASLI dipanggil langsung (bukan UI). Perusahaan fixture dihapus
// total di afterAll (pola A2); demo tidak pernah ditulis.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000a301";
const USER_ID = "01900000-0000-7000-8000-00000000a311";
const TODAY = todayISO();
const suffix = crypto.randomUUID().slice(0, 8);

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: USER_ID, name: "Pengguna Uji A3", email: "a3@uji.local" },
        session: { id: "sesi-uji-a3" },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.values.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.values.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => "/app/gudang/produk",
  useSearchParams: () => new URLSearchParams(),
}));

type Tx = Parameters<Parameters<typeof withCompany>[1]>[0];

const acc: Record<string, string> = {};
let whMain = "";
let methodCash = "";
let productId = "";
let productSku = "";
let saleId = "";

async function setRole(role: string) {
  await db.update(member).set({ role }).where(eq(member.organizationId, ORG));
}

async function accountId(tx: Tx, code: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  expect(row, `akun ${code}`).toBeDefined();
  return row.id;
}

async function bootstrap() {
  await db
    .insert(organization)
    .values({ id: ORG, name: "Perusahaan Uji A3", slug: `uji-a3-${suffix}` })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({ id: USER_ID, name: "Pengguna Uji A3", email: "a3@uji.local" })
    .onConflictDoNothing();
  await db
    .insert(member)
    .values({ id: crypto.randomUUID(), organizationId: ORG, userId: USER_ID, role: "owner" })
    .onConflictDoNothing();
  cookieJar.values.set(COMPANY_COOKIE_NAME, ORG);

  await withCompany(ORG, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (existing) return;

    await tx.insert(companySettings).values({
      companyId: ORG,
      legalName: "Uji Audit A3",
      roundingMode: "none",
      taxRate: "11",
      taxEnabled: false,
      enabledModules: { pos: true, gudang: true, akuntansi: true, hr: true },
    });

    const seeds: Array<[string, string, string, "debit" | "credit"]> = [
      ["110107", "Kas", "asset", "debit"],
      ["110101", "Bank", "asset", "debit"],
      ["12001", "Piutang Usaha", "asset", "debit"],
      ["13001", "Persediaan", "asset", "debit"],
      ["210101", "Utang Usaha", "liability", "credit"],
      ["21002", "Utang Gaji", "liability", "credit"],
      ["22001", "PPN Keluaran", "liability", "credit"],
      ["23001", "Kredit Pihak", "liability", "credit"],
      ["300001", "Modal Pemilik", "equity", "credit"],
      ["400001", "Penjualan", "revenue", "credit"],
      ["440101", "Diskon Penjualan", "revenue", "debit"],
      ["400003", "Retur Penjualan", "revenue", "debit"],
      ["5101", "HPP", "cogs", "debit"],
      ["51002", "Selisih Persediaan", "cogs", "debit"],
      ["51003", "Barang Rusak", "cogs", "debit"],
      ["600004", "Beban Gaji", "expense", "debit"],
      ["720015", "Selisih Kas Kurang", "expense", "debit"],
      ["81002", "Selisih Kas Lebih", "revenue", "credit"],
      ["91001", "Pembulatan Laba", "revenue", "credit"],
      ["91002", "Pembulatan Rugi", "expense", "debit"],
    ];
    const cashKind: Record<string, string> = { "110107": "cash", "110101": "bank" };
    const rows = await tx
      .insert(accounts)
      .values(
        seeds.map(([code, name, type, normalBalance]) => ({
          companyId: ORG,
          code,
          name,
          type,
          normalBalance,
          cashBankKind: cashKind[code] ?? null,
        })),
      )
      .returning();
    const byCode = new Map(rows.map((row) => [row.code, row.id]));
    const mapping: Record<string, string> = {
      cash: "110107", bank: "110101", receivable: "12001", inventory: "13001",
      payable: "210101", revenue: "400001", sales_discount: "440101",
      sales_return: "400003", cogs: "5101", inventory_shrink: "51002",
      damaged: "51003", tax_output: "22001", tax_input: "22001",
      rounding_gain: "91001", rounding_loss: "91002", cash_short: "720015",
      cash_over: "81002", salary_expense: "600004", salary_payable: "21002",
      salary_deductions_payable: "21002", pph21_payable: "21002",
      bpjs_payable: "21002", equity: "300001", customer_credit: "23001",
      supplier_credit: "23001",
    };
    await tx.insert(accountMappings).values(
      Object.entries(mapping).map(([key, code]) => ({
        companyId: ORG,
        key,
        accountId: byCode.get(code)!,
      })),
    );

    const [w] = await tx
      .insert(warehouses)
      .values({ companyId: ORG, code: "GD-A3", name: "Gudang Utama A3", type: "warehouse", isDefault: true })
      .returning();
    whMain = w.id;

    const [pm] = await tx
      .insert(paymentMethods)
      .values({
        companyId: ORG, code: "CASH", name: "Tunai", type: "cash",
        accountId: byCode.get("110107")!, sortOrder: 1,
      })
      .returning();
    methodCash = pm.id;

    await ensureFiscalPeriods(tx, ORG, Number(TODAY.slice(0, 4)));

    const [p] = await tx
      .insert(products)
      .values({
        companyId: ORG,
        sku: `A3-001-${suffix}`,
        name: "Produk Uji A3",
        costPrice: "3000",
        salePrice: "5000",
        minStock: "0",
        trackStock: true,
        trackBatch: false,
        isActive: true,
      })
      .returning();
    productId = p.id;
    productSku = p.sku;
    await applyInvMovement(tx, {
      companyId: ORG,
      warehouseId: whMain,
      productId,
      delta: "50",
      unitCost: "3000",
      movementType: "opening",
      userId: USER_ID,
    });

    for (const code of ["110107", "400001", "600004"]) acc[code] = await accountId(tx, code);

    // Sesi kas terbuka + satu penjualan domain (bahan uji void).
    await openCashSession(tx, { companyId: ORG, userId: USER_ID, openingCash: 100000 });
    const lines = [{ productId, qty: 2 }];
    const quote = await quoteCart(tx, { companyId: ORG, warehouseId: whMain, lines });
    const sale = await createSale(tx, {
      companyId: ORG,
      userId: USER_ID,
      warehouseId: whMain,
      date: TODAY,
      dueDate: TODAY,
      lines,
      payments: [{ methodId: methodCash, amount: quote.total, tendered: quote.total }],
      idempotencyKey: crypto.randomUUID(),
    });
    saleId = sale.id;
  });
}

async function wipeFixture() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    const tables = await tx.unsafe<{ tablename: string }[]>(
      `SELECT c.table_name AS tablename FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`,
    );
    for (const { tablename } of tables) {
      await tx.unsafe(`DELETE FROM "${tablename}" WHERE company_id = $1`, [ORG]);
    }
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [USER_ID]);
  });
}

beforeAll(bootstrap, 120_000);
afterAll(wipeFixture);

function journalInput(tag: string) {
  return {
    date: TODAY,
    description: `Jurnal uji A3 ${tag} ${suffix}`,
    idempotencyKey: `a3-journal-${tag}-${suffix}`,
    lines: [
      { accountId: acc["110107"], debit: "25000" },
      { accountId: acc["400001"], credit: "25000" },
    ],
  };
}

async function expectRouteForbidden(run: () => Promise<Response>) {
  let rejection: unknown;
  let response: Response | undefined;
  try {
    response = await run();
  } catch (error) {
    rejection = error;
  }
  if (response) {
    expect(response.status, "route menjawab sukses untuk peran tanpa izin").not.toBe(200);
  } else {
    expect(rejection).toMatchObject({ code: "FORBIDDEN" });
  }
}

describe("A3 — jurnal manual per peran (accounting.post)", () => {
  it("owner LOLOS", async () => {
    await setRole("owner");
    const result = await postManualJournalAction(journalInput("owner"));
    expect(result.ok).toBe(true);
  });

  it("akuntan LOLOS", async () => {
    await setRole("accountant");
    const result = await postManualJournalAction(journalInput("akuntan"));
    expect(result.ok).toBe(true);
  });

  it("kasir DITOLAK", async () => {
    await setRole("cashier");
    const result = await postManualJournalAction(journalInput("kasir"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("petugas gudang DITOLAK", async () => {
    await setRole("warehouse");
    const result = await postManualJournalAction(journalInput("gudang"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("viewer DITOLAK", async () => {
    await setRole("viewer");
    const result = await postManualJournalAction(journalInput("viewer"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

describe("A3 — pengaturan (settings.manage) & ekspor akuntansi dari kasir", () => {
  it("kasir DITOLAK mengubah pengaturan perusahaan", async () => {
    await setRole("cashier");
    const result = await saveSettingsAction({
      legalName: "Uji Audit A3",
      roundingMode: "none",
      allowNegativeStock: false,
      taxRate: "11",
      taxEnabled: false,
      posDiscountThresholdPercent: 50,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("owner LOLOS mengubah pengaturan (kontrol positif)", async () => {
    await setRole("owner");
    const result = await saveSettingsAction({
      legalName: "Uji Audit A3",
      roundingMode: "none",
      allowNegativeStock: false,
      taxRate: "11",
      taxEnabled: false,
      posDiscountThresholdPercent: 50,
    });
    expect(result.ok).toBe(true);
  });

  it("kasir DITOLAK ekspor jurnal & laporan akuntansi", async () => {
    await setRole("cashier");
    await expectRouteForbidden(() =>
      journalsExportGET(new NextRequest("http://localhost/api/export/journals")),
    );
    await expectRouteForbidden(() =>
      reportExportGET(new NextRequest("http://localhost/api/export/report?type=laba-rugi")),
    );
  });
});

describe("A3 — petugas gudang ke akuntansi & payroll", () => {
  it("gudang DITOLAK ekspor rekap payroll (payroll.salary)", async () => {
    await setRole("warehouse");
    await expectRouteForbidden(() =>
      payrollExportGET(new NextRequest("http://localhost/api/export/payroll?runId=01900000-0000-7000-8000-000000000000")),
    );
  });

  it("gudang DITOLAK menjalankan payroll (payroll.manage)", async () => {
    await setRole("warehouse");
    const result = await runPayrollAction({ period: TODAY.slice(0, 7), acknowledgeMinWage: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("owner LOLOS gerbang ekspor payroll (kontrol positif: 404 run tak dikenal, bukan FORBIDDEN)", async () => {
    await setRole("owner");
    const response = await payrollExportGET(
      new NextRequest("http://localhost/api/export/payroll?runId=01900000-0000-7000-8000-000000000000"),
    );
    expect(response.status).toBe(404);
  });
});

describe("A3 — void POS & harga master (pos.void / inventory.price)", () => {
  it("akuntan DITOLAK mem-void penjualan; penjualan tetap berlaku", async () => {
    await setRole("accountant");
    const result = await voidSaleAction({ saleId, reason: "Uji A3 akuntan" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
    const [row] = await withCompanyReadOnly(ORG, (tx) =>
      tx.select({ status: sales.status }).from(sales).where(eq(sales.id, saleId)).limit(1),
    );
    expect(row.status).not.toBe("void");
  });

  it("kasir DITOLAK mem-void penjualan (pos.void bukan milik kasir)", async () => {
    await setRole("cashier");
    const result = await voidSaleAction({ saleId, reason: "Uji A3 kasir" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("akuntan DITOLAK mengubah harga produk (tak memegang inventory.manage)", async () => {
    await setRole("accountant");
    const result = await saveProductAction({
      id: productId,
      name: "Produk Uji A3",
      sku: productSku,
      costPrice: "3000",
      salePrice: "9999",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("gudang LOLOS mengubah field non-harga tetapi DITOLAK mengubah harga (gerbang inventory.price)", async () => {
    await setRole("warehouse");
    const rename = await saveProductAction({
      id: productId,
      name: "Produk Uji A3 Renamed",
      sku: productSku,
      costPrice: "3000",
      salePrice: "5000",
    });
    expect(rename.ok).toBe(true);

    const reprice = await saveProductAction({
      id: productId,
      name: "Produk Uji A3 Renamed",
      sku: productSku,
      costPrice: "3000",
      salePrice: "9999",
    });
    expect(reprice.ok).toBe(false);
    if (!reprice.ok) {
      expect(reprice.code).toBe("FORBIDDEN");
      expect(reprice.message).toContain("Mengubah harga jual atau harga pokok");
    }
    const [row] = await withCompanyReadOnly(ORG, (tx) =>
      tx.select({ salePrice: products.salePrice }).from(products).where(eq(products.id, productId)).limit(1),
    );
    expect(Number(row.salePrice)).toBe(5000);
  });

  it("owner LOLOS mem-void penjualan (kontrol positif, terakhir)", async () => {
    await setRole("owner");
    const result = await voidSaleAction({ saleId, reason: "Uji A3 owner void" });
    expect(result.ok).toBe(true);
    const [row] = await withCompanyReadOnly(ORG, (tx) =>
      tx.select({ status: sales.status }).from(sales).where(eq(sales.id, saleId)).limit(1),
    );
    expect(row.status).toBe("void");
  });
});

describe("A3 — viewer terhadap SEMUA ekspor", () => {
  const bare = (path: string) => new NextRequest(`http://localhost${path}`);

  it("viewer LOLOS ekspor berbasis izin lihat (by design) — kecuali payroll", async () => {
    await setRole("viewer");
    const allowed: Array<[string, () => Promise<Response>]> = [
      ["products", () => productsExportGET(bare("/api/export/products"))],
      ["inventory", () => inventoryExportGET(bare("/api/export/inventory"))],
      ["accounts", () => accountsExportGET(bare("/api/export/accounts"))],
      ["journals", () => journalsExportGET(bare("/api/export/journals"))],
      ["ledger", () => ledgerExportGET(bare("/api/export/ledger"))],
      ["report", () => reportExportGET(bare("/api/export/report?type=laba-rugi"))],
      ["aging", () => agingExportGET(bare("/api/export/aging?kind=piutang"))],
      ["customers", () => customersExportGET(bare("/api/export/customers"))],
      ["suppliers", () => suppliersExportGET(bare("/api/export/suppliers"))],
    ];
    for (const [name, run] of allowed) {
      const response = await run();
      expect(response.status, `ekspor ${name} untuk viewer`).toBe(200);
    }
  });

  it("viewer DITOLAK ekspor payroll (payroll.salary)", async () => {
    await setRole("viewer");
    await expectRouteForbidden(() =>
      payrollExportGET(bare("/api/export/payroll?runId=01900000-0000-7000-8000-000000000000")),
    );
  });

  it("AUD-013 (DIPERBAIKI di A4): ekspor produk viewer TANPA kolom biaya", async () => {
    await setRole("viewer");
    const response = await productsExportGET(bare("/api/export/products"));
    expect(response.status).toBe(200);
    const text = await response.text();
    // Dulu test ini berkarakterisasi kebocoran (memuat "Harga Beli").
    // Sesudah perbaikan AUD-013: ekspor tetap 200 & berguna untuk
    // viewer, tetapi kolom & nilai biaya hilang tanpa inventory.cost.
    expect(text).not.toContain("Harga Beli");
    expect(text).not.toContain("3000");
    expect(text).toContain("Harga Jual");
  });
});

describe("A3 — injeksi dasar (SQLi & XSS tersimpan)", () => {
  it("SQLi pada pencarian produk tidak membocorkan baris & tidak merusak tabel", async () => {
    await setRole("cashier");
    const before = await withCompanyReadOnly(ORG, async (tx) => {
      const rows = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG));
      return rows.length;
    });

    const injected = await searchProductsAction("' OR '1'='1", whMain, 0);
    expect(injected.ok).toBe(true);
    if (injected.ok) expect(injected.data.length).toBe(0);

    const dropped = await searchProductsAction("'; DROP TABLE products; --", whMain, 0);
    expect(dropped.ok).toBe(true);

    const after = await withCompanyReadOnly(ORG, async (tx) => {
      const rows = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG));
      return rows.length;
    });
    expect(after).toBe(before);

    // Kontrol positif: kata wajar menemukan produk fixture.
    const normal = await searchProductsAction("Produk Uji A3", whMain, 0);
    expect(normal.ok).toBe(true);
    if (normal.ok) expect(normal.data.length).toBeGreaterThan(0);
  });

  it("SQLi pada pencarian pelanggan tidak membocorkan baris", async () => {
    await setRole("cashier");
    const injected = await searchCustomersAction("' OR '1'='1");
    expect(injected.ok).toBe(true);
    if (injected.ok) expect(injected.data.length).toBe(0);
  });

  it("XSS tersimpan di nama produk ter-escape saat halaman daftar dirender", async () => {
    await setRole("owner");
    const created = await saveProductAction({
      name: "<script>alert('xss-a3')</script>",
      sku: `A3-XSS-${suffix}`,
      costPrice: "1000",
      salePrice: "2000",
    });
    expect(created.ok).toBe(true);

    await setRole("warehouse");
    const element = await ProductsPage({
      searchParams: Promise.resolve({ q: "xss-a3" }),
    });
    const html = renderToStaticMarkup(element as never);
    expect(html).not.toContain("<script>alert('xss-a3')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("XSS tersimpan di nama pelanggan ter-escape saat halaman detail dirender", async () => {
    await setRole("owner");
    const created = await saveCustomerAction({
      code: `A3C-${suffix}`,
      name: "<img src=x onerror=alert('xss-a3')>",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const customerId = (created.data as { id: string }).id;

    await setRole("warehouse");
    const element = await CustomerDetailPage({
      params: Promise.resolve({ id: customerId }),
    });
    const html = renderToStaticMarkup(element as never);
    expect(html).not.toContain("<img src=x onerror=alert('xss-a3')>");
    expect(html).toContain("&lt;img");
  });
});
