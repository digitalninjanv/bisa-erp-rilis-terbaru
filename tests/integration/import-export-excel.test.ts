import { afterAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  accountMappings,
  accounts,
  branches,
  categories,
  customerGroups,
  employees,
  fixedAssets,
  importJobs,
  journalEntries,
  paymentMethods,
  importRows,
  units,
  warehouses,
} from "@/db/schema";
import { adminSql } from "@/db/admin";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import {
  ENTITY_FIELDS,
  IMPORT_SAMPLES,
  mapCategoryRow,
  mapUnitRow,
  suggestMappingFor,
  type ImportEntity,
} from "@/lib/import-parse";
import { GET as importTemplateRoute } from "@/app/api/import/template/[entity]/route";
import { GET as exportCategoriesRoute } from "@/app/api/export/categories/route";
import { GET as exportUnitsRoute } from "@/app/api/export/units/route";
import { GET as exportAccountsRoute } from "@/app/api/export/accounts/route";
import { GET as exportProductsRoute } from "@/app/api/export/products/route";
import { GET as exportSuppliersRoute } from "@/app/api/export/suppliers/route";
import { GET as exportCustomersRoute } from "@/app/api/export/customers/route";
import { GET as exportAccountMappingsRoute } from "@/app/api/export/account-mappings/route";
import { GET as exportInventoryRoute } from "@/app/api/export/inventory/route";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requirePermission: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
  requireAuth: async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
  }),
}));

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);

const createdJobIds: string[] = [];
const createdCategoryNames: string[] = [];
const createdUnitCodes: string[] = [];
const createdBranchCodes: string[] = [];
const createdWarehouseCodes: string[] = [];
const createdPaymentCodes: string[] = [];
const createdGroupNames: string[] = [];
const createdEmployeeCodes: string[] = [];
const createdAssetNames: string[] = [];

function sampleRows(entity: ImportEntity): {
  headers: string[];
  rows: Record<string, string>[];
  mapping: Partial<Record<string, string>>;
} {
  const lines = IMPORT_SAMPLES[entity].csv.split("\n").filter((line) => line.trim() !== "");
  const headers = lines[0].split(",").map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      object[header] = (cells[index] ?? "").trim();
    });
    return object;
  });
  return { headers, rows, mapping: suggestMappingFor(ENTITY_FIELDS[entity], headers) };
}

async function makeJob(
  entity: ImportEntity,
  rows: Record<string, string>[],
  mapping: Partial<Record<string, string>>,
): Promise<string> {
  const jobId = await withCompany(ORG_ID, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_ID,
        entity,
        fileName: `uji-${entity}-${suffix}.xlsx`,
        status: "preview",
        totalRows: rows.length,
        mapping,
        createdBy: USER_ID,
      })
      .returning({ id: importJobs.id });
    await tx.insert(importRows).values(
      rows.map((data, index) => ({
        companyId: ORG_ID,
        jobId: job.id,
        rowNumber: index + 1,
        data,
        status: "pending",
      })),
    );
    return job.id;
  });
  createdJobIds.push(jobId);
  return jobId;
}

async function commitAll(jobId: string, mapping: Partial<Record<string, string>>) {
  const result = await commitImportBatchAction({ jobId, mapping, limit: 200 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

async function workbookFrom(response: Response) {
  expect(response.status).toBe(200);
  const type = response.headers.get("content-type") ?? "";
  expect(type).toContain("spreadsheetml");
  return XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
}

afterAll(async () => {
  if (createdAssetNames.length) {
    // Jurnal terposting dilindungi trigger; pembersihan fixture DB uji
    // memakai koneksi admin + replication role agar tidak meninggalkan
    // aset/jurnal yatim.
    await adminSql.begin(async (tx) => {
      await tx.unsafe("set local session_replication_role = replica");
      const assets = await tx<{ id: string }[]>`
        select id from fixed_assets
        where company_id = ${ORG_ID} and name = any(${createdAssetNames}::text[])
      `;
      const ids = assets.map((row) => row.id);
      if (ids.length) {
        const affected = await tx<{ account_id: string; ym: string }[]>`
          select distinct jl.account_id, to_char(je.date, 'YYYY-MM') as ym
          from journal_lines jl
          join journal_entries je on je.id = jl.entry_id
          where je.company_id = ${ORG_ID}
            and je.source_type = 'fixed_asset_acquisition'
            and je.source_id = any(${ids}::uuid[])
        `;
        await tx`
          delete from journal_lines where entry_id in (
            select id from journal_entries
            where company_id = ${ORG_ID}
              and source_type = 'fixed_asset_acquisition'
              and source_id = any(${ids}::uuid[])
          )
        `;
        await tx`
          delete from journal_entries
          where company_id = ${ORG_ID}
            and source_type = 'fixed_asset_acquisition'
            and source_id = any(${ids}::uuid[])
        `;
        await tx`delete from fixed_assets where id = any(${ids}::uuid[])`;
        // Ringkasan saldo bulanan dipelihara trigger; karena trigger
        // dilewati saat pembersihan, hitung ulang pasangan akun+bulan
        // yang tersentuh agar rekonsiliasi tetap konsisten.
        for (const pair of affected) {
          const [sum] = await tx<{ debit: string; credit: string; n: string }[]>`
            select coalesce(sum(jl.debit), 0) as debit,
                   coalesce(sum(jl.credit), 0) as credit,
                   count(*) as n
            from journal_lines jl
            join journal_entries je on je.id = jl.entry_id
            where je.company_id = ${ORG_ID}
              and jl.account_id = ${pair.account_id}
              and to_char(je.date, 'YYYY-MM') = ${pair.ym}
          `;
          if (Number(sum?.n ?? 0) === 0) {
            await tx`
              delete from account_monthly_balances
              where company_id = ${ORG_ID} and account_id = ${pair.account_id} and year_month = ${pair.ym}
            `;
          } else {
            await tx`
              update account_monthly_balances
              set total_debit = ${sum.debit}, total_credit = ${sum.credit}, updated_at = now()
              where company_id = ${ORG_ID} and account_id = ${pair.account_id} and year_month = ${pair.ym}
            `;
          }
        }
      }
    });
  }
  await withCompany(ORG_ID, async (tx) => {
    if (createdJobIds.length) {
      await tx.delete(importRows).where(inArray(importRows.jobId, createdJobIds));
      await tx.delete(importJobs).where(inArray(importJobs.id, createdJobIds));
    }
    if (createdCategoryNames.length) {
      await tx
        .delete(categories)
        .where(and(eq(categories.companyId, ORG_ID), inArray(categories.name, createdCategoryNames)));
    }
    if (createdUnitCodes.length) {
      await tx
        .delete(units)
        .where(and(eq(units.companyId, ORG_ID), inArray(units.code, createdUnitCodes)));
    }
    if (createdEmployeeCodes.length) {
      await tx
        .delete(employees)
        .where(and(eq(employees.companyId, ORG_ID), inArray(employees.code, createdEmployeeCodes)));
    }
    if (createdPaymentCodes.length) {
      await tx
        .delete(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), inArray(paymentMethods.code, createdPaymentCodes)));
    }
    if (createdGroupNames.length) {
      await tx
        .delete(customerGroups)
        .where(and(eq(customerGroups.companyId, ORG_ID), inArray(customerGroups.name, createdGroupNames)));
    }
    if (createdWarehouseCodes.length) {
      await tx
        .delete(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), inArray(warehouses.code, createdWarehouseCodes)));
    }
    if (createdBranchCodes.length) {
      await tx
        .delete(branches)
        .where(and(eq(branches.companyId, ORG_ID), inArray(branches.code, createdBranchCodes)));
    }
  });
});

describe("Excel master data — template & ekspor", () => {
  it("contoh kategori/satuan terpetakan dan lolos mapper", () => {
    for (const entity of ["categories", "units"] as const) {
      const sample = sampleRows(entity);
      for (const field of ENTITY_FIELDS[entity].filter((item) => item.required)) {
        expect(sample.mapping[field.key], `${entity}.${field.key}`).toBeTruthy();
      }
      expect(sample.rows.length).toBeGreaterThan(0);
    }
    for (const row of sampleRows("categories").rows) {
      expect(mapCategoryRow(row, sampleRows("categories").mapping).error).toBeUndefined();
    }
    for (const row of sampleRows("units").rows) {
      expect(mapUnitRow(row, sampleRows("units").mapping).error).toBeUndefined();
    }
  });

  it("template XLSX berisi sheet Data, Petunjuk, dan referensi", async () => {
    for (const entity of [
      "products",
      "suppliers",
      "customers",
      "accounts",
      "categories",
      "units",
      "account_mappings",
      "opening_stock",
      "opening_payables",
      "opening_receivables",
    ] as const) {
      const response = await importTemplateRoute(
        new Request(`http://localhost/api/import/template/${entity}?format=xlsx`),
        { params: Promise.resolve({ entity }) },
      );
      const workbook = await workbookFrom(response);
      expect(workbook.SheetNames, entity).toContain("Data");
      expect(workbook.SheetNames, entity).toContain("Petunjuk");
      const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Data, {
        header: 1,
        raw: true,
      });
      expect(data[0], entity).toEqual(IMPORT_SAMPLES[entity].csv.split("\n")[0].split(","));
      const guide = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Petunjuk, {
        header: 1,
        raw: true,
      });
      expect(JSON.stringify(guide), entity).toContain("Cara pakai");
      expect(JSON.stringify(guide), entity).toContain("Versi template");
    }
  });

  it("ekspor master XLSX tetap memakai header yang bisa diimpor ulang", async () => {
    const cases: [string, () => Promise<Response>, string][] = [
      ["categories", () => exportCategoriesRoute(new Request("http://localhost/api/export/categories?format=xlsx")), "Nama Kategori"],
      ["units", () => exportUnitsRoute(new Request("http://localhost/api/export/units?format=xlsx")), "Kode Satuan"],
      ["accounts", () => exportAccountsRoute(new Request("http://localhost/api/export/accounts?format=xlsx")), "Kode"],
      ["products", () => exportProductsRoute(new Request("http://localhost/api/export/products?format=xlsx")), "Kode Barang"],
      ["suppliers", () => exportSuppliersRoute(new Request("http://localhost/api/export/suppliers?format=xlsx")), "Kode"],
      ["customers", () => exportCustomersRoute(new Request("http://localhost/api/export/customers?format=xlsx")), "Kode"],
      ["account_mappings", () => exportAccountMappingsRoute(new Request("http://localhost/api/export/account-mappings?format=xlsx")), "Kunci"],
      ["inventory", () => exportInventoryRoute(new Request("http://localhost/api/export/inventory?format=xlsx")), "SKU"],
    ];
    for (const [name, get, firstHeader] of cases) {
      const workbook = await workbookFrom(await get());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
      expect(matrix[0]?.[0], name).toBe(firstHeader);
    }
  });
});

describe("Excel master data — impor kategori & satuan", () => {
  it("kategori induk lalu anak masuk ke database", async () => {
    const root = `Kategori Uji ${suffix}`;
    const child = `Sub Kategori Uji ${suffix}`;
    createdCategoryNames.push(root, child);

    const rootMapping = suggestMappingFor(ENTITY_FIELDS.categories, ["Nama Kategori", "Induk Kategori", "Status"]);
    const rootJob = await makeJob("categories", [{ "Nama Kategori": root, "Induk Kategori": "", Status: "Aktif" }], rootMapping);
    const rootAnalysis = await analyzeImportAction({ jobId: rootJob, mapping: rootMapping });
    expect(rootAnalysis.ok).toBe(true);
    if (!rootAnalysis.ok) return;
    expect(rootAnalysis.data.summary.invalidRows).toBe(0);
    const rootCommit = await commitAll(rootJob, rootMapping);
    expect(rootCommit.imported).toBe(1);

    const childMapping = suggestMappingFor(ENTITY_FIELDS.categories, ["Nama Kategori", "Induk Kategori", "Status"]);
    const childJob = await makeJob("categories", [{ "Nama Kategori": child, "Induk Kategori": root, Status: "Aktif" }], childMapping);
    const childAnalysis = await analyzeImportAction({ jobId: childJob, mapping: childMapping });
    expect(childAnalysis.ok).toBe(true);
    if (!childAnalysis.ok) return;
    expect(childAnalysis.data.summary.invalidRows).toBe(0);
    const childCommit = await commitAll(childJob, childMapping);
    expect(childCommit.imported).toBe(1);

    const rows = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
        .from(categories)
        .where(and(eq(categories.companyId, ORG_ID), inArray(categories.name, [root, child])))
        .orderBy(asc(categories.name)),
    );
    expect(rows).toHaveLength(2);
    const parent = rows.find((row) => row.name === root);
    const nested = rows.find((row) => row.name === child);
    expect(nested?.parentId).toBe(parent?.id ?? null);
  });

  it("satuan masuk ke database dan duplikat dilewati", async () => {
    const code = `T${suffix.slice(0, 5)}`.toUpperCase();
    const name = `Satuan Uji ${suffix}`;
    createdUnitCodes.push(code);
    const mapping = suggestMappingFor(ENTITY_FIELDS.units, ["Kode Satuan", "Nama Satuan", "Status"]);
    const jobId = await makeJob(
      "units",
      [
        { "Kode Satuan": code, "Nama Satuan": name, Status: "Aktif" },
        { "Kode Satuan": code, "Nama Satuan": `${name} 2`, Status: "Aktif" },
      ],
      mapping,
    );
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.duplicateInFile).toBe(1);
    const commit = await commitAll(jobId, mapping);
    expect(commit.imported).toBe(1);
    expect(commit.failed).toBe(1);

    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: units.id, code: units.code, name: units.name })
        .from(units)
        .where(and(eq(units.companyId, ORG_ID), eq(units.code, code)))
        .limit(1),
    );
    expect(row?.name).toBe(name);
  });

  it("pemetaan akun bisa diperbarui lewat Excel dan kunci tak dikenal ditolak", async () => {
    const current = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ key: accountMappings.key, code: accounts.code })
        .from(accountMappings)
        .innerJoin(accounts, eq(accountMappings.accountId, accounts.id))
        .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, "cash")))
        .limit(1),
    );
    expect(current[0]?.code).toBeTruthy();
    const code = current[0]!.code;

    const mapping = suggestMappingFor(ENTITY_FIELDS.account_mappings, ["Kunci pemetaan", "Kode akun"]);
    const jobId = await makeJob(
      "account_mappings",
      [
        { "Kunci pemetaan": "cash", "Kode akun": code },
        { "Kunci pemetaan": "kunci-tidak-ada", "Kode akun": code },
        { "Kunci pemetaan": "bank", "Kode akun": "999999" },
      ],
      mapping,
    );
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.invalidRows).toBe(2);
    expect(analysis.data.summary.valid).toBe(1);

    const commit = await commitAll(jobId, mapping);
    expect(commit.imported).toBe(1);
    expect(commit.failed).toBe(2);

    const [after] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ key: accountMappings.key, code: accounts.code })
        .from(accountMappings)
        .innerJoin(accounts, eq(accountMappings.accountId, accounts.id))
        .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, "cash")))
        .limit(1),
    );
    expect(after?.code).toBe(code);
  });
});

describe("Excel master data — impor cabang & gudang", () => {
  it("cabang lalu gudang terhubung, duplikat dilewati, cabang tak dikenal ditolak", async () => {
    const branchCode = `CB-${suffix.slice(0, 6)}`.toUpperCase();
    const branchName = `Cabang Uji ${suffix}`;
    const warehouseCode = `GD-${suffix.slice(0, 6)}`.toUpperCase();
    createdBranchCodes.push(branchCode);
    createdWarehouseCodes.push(warehouseCode);

    const branchMapping = suggestMappingFor(ENTITY_FIELDS.branches, ["Kode", "Nama", "Status"]);
    const branchJob = await makeJob(
      "branches",
      [
        { Kode: branchCode, Nama: branchName, Status: "Aktif" },
        { Kode: branchCode, Nama: `${branchName} Duplikat`, Status: "Aktif" },
      ],
      branchMapping,
    );
    const branchAnalysis = await analyzeImportAction({ jobId: branchJob, mapping: branchMapping });
    expect(branchAnalysis.ok).toBe(true);
    if (!branchAnalysis.ok) return;
    expect(branchAnalysis.data.summary.duplicateInFile).toBe(1);
    const branchCommit = await commitAll(branchJob, branchMapping);
    expect(branchCommit.imported).toBe(1);
    expect(branchCommit.failed).toBe(1);

    const warehouseMapping = suggestMappingFor(ENTITY_FIELDS.warehouses, ["Kode", "Nama", "Tipe", "Kode Cabang", "Status"]);
    const warehouseJob = await makeJob(
      "warehouses",
      [
        { Kode: warehouseCode, Nama: `Gudang Uji ${suffix}`, Tipe: "Gudang", "Kode Cabang": branchCode, Status: "Aktif" },
        { Kode: `${warehouseCode}-X`, Nama: `Gudang Tanpa Cabang ${suffix}`, Tipe: "Toko", "Kode Cabang": "TIDAK-ADA", Status: "Aktif" },
      ],
      warehouseMapping,
    );
    const warehouseAnalysis = await analyzeImportAction({ jobId: warehouseJob, mapping: warehouseMapping });
    expect(warehouseAnalysis.ok).toBe(true);
    if (!warehouseAnalysis.ok) return;
    expect(warehouseAnalysis.data.summary.invalidRows).toBe(1);
    const warehouseCommit = await commitAll(warehouseJob, warehouseMapping);
    expect(warehouseCommit.imported).toBe(1);
    expect(warehouseCommit.failed).toBe(1);

    const rows = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({
          code: warehouses.code,
          name: warehouses.name,
          type: warehouses.type,
          branchCode: branches.code,
        })
        .from(warehouses)
        .innerJoin(branches, eq(warehouses.branchId, branches.id))
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.code, warehouseCode)))
        .limit(1),
    );
    expect(rows[0]).toMatchObject({
      code: warehouseCode,
      name: `Gudang Uji ${suffix}`,
      type: "warehouse",
      branchCode,
    });
  });
});

describe("Excel master data — impor metode pembayaran & kelompok harga", () => {
  it("metode pembayaran terhubung ke akun, duplikat dilewati, akun tak dikenal ditolak", async () => {
    const cashCode = `PM-${suffix.slice(0, 6)}`.toUpperCase();
    const bankCode = `${cashCode}-B`;
    createdPaymentCodes.push(cashCode, bankCode);

    const mapping = suggestMappingFor(ENTITY_FIELDS.payment_methods, [
      "Kode",
      "Nama",
      "Tipe",
      "Kode Akun",
      "Status",
    ]);
    const jobId = await makeJob(
      "payment_methods",
      [
        { Kode: cashCode, Nama: `Tunai Uji ${suffix}`, Tipe: "Tunai", "Kode Akun": "110101", Status: "Aktif" },
        { Kode: cashCode, Nama: `Tunai Duplikat ${suffix}`, Tipe: "Tunai", Status: "Aktif" },
        { Kode: bankCode, Nama: `Bank Uji ${suffix}`, Tipe: "Bank", "Kode Akun": "TIDAK-ADA", Status: "Aktif" },
      ],
      mapping,
    );
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.duplicateInFile).toBe(1);
    expect(analysis.data.summary.invalidRows).toBe(1);

    const commit = await commitAll(jobId, mapping);
    expect(commit.imported).toBe(1);
    expect(commit.failed).toBe(2);

    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ code: paymentMethods.code, type: paymentMethods.type, accountCode: accounts.code })
        .from(paymentMethods)
        .innerJoin(accounts, eq(paymentMethods.accountId, accounts.id))
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.code, cashCode)))
        .limit(1),
    );
    expect(row).toMatchObject({ code: cashCode, type: "cash", accountCode: "110101" });
  });

  it("kelompok harga tersimpan dengan diskon, pembulatan, dan status", async () => {
    const groupName = `Grosir Uji ${suffix}`;
    createdGroupNames.push(groupName);
    const mapping = suggestMappingFor(ENTITY_FIELDS.customer_groups, [
      "Nama Kelompok",
      "Tipe Diskon",
      "Nilai Diskon",
      "Pembulatan",
      "Arah Pembulatan",
      "Bulatkan Total Tunai",
      "Status",
    ]);
    const jobId = await makeJob(
      "customer_groups",
      [
        {
          "Nama Kelompok": groupName,
          "Tipe Diskon": "Percent",
          "Nilai Diskon": "5",
          Pembulatan: "100",
          "Arah Pembulatan": "down",
          "Bulatkan Total Tunai": "Tidak",
          Status: "Aktif",
        },
        {
          "Nama Kelompok": groupName,
          "Tipe Diskon": "Percent",
          "Nilai Diskon": "10",
          Status: "Aktif",
        },
      ],
      mapping,
    );
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.duplicateInFile).toBe(1);

    const commit = await commitAll(jobId, mapping);
    expect(commit.imported).toBe(1);
    expect(commit.failed).toBe(1);

    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({
          name: customerGroups.name,
          discountType: customerGroups.discountType,
          discountValue: customerGroups.discountValue,
          roundingStep: customerGroups.roundingStep,
          roundingDirection: customerGroups.roundingDirection,
          roundCashTotal: customerGroups.roundCashTotal,
        })
        .from(customerGroups)
        .where(and(eq(customerGroups.companyId, ORG_ID), eq(customerGroups.name, groupName)))
        .limit(1),
    );
    expect(row).toMatchObject({
      name: groupName,
      discountType: "percent",
      discountValue: "5.0000",
      roundingStep: 100,
      roundingDirection: "down",
      roundCashTotal: false,
    });
  });
});

describe("Excel master data — impor karyawan & aset tetap", () => {
  it("karyawan tersimpan dengan gaji/statutory dan duplikat kode ditolak", async () => {
    const code = `EMP-${suffix.slice(0, 6)}`.toUpperCase();
    createdEmployeeCodes.push(code);
    const mapping = suggestMappingFor(ENTITY_FIELDS.employees, [
      "Kode",
      "Nama",
      "Jabatan",
      "Gaji Pokok",
      "Tunjangan",
      "Tanggal Masuk",
      "NIK",
      "Status PTKP",
      "Status",
    ]);
    const jobId = await makeJob(
      "employees",
      [
        {
          Kode: code,
          Nama: `Budi Uji ${suffix}`,
          Jabatan: "Kasir",
          "Gaji Pokok": "4500000",
          Tunjangan: "500000",
          "Tanggal Masuk": "2026-01-05",
          NIK: `3171${suffix.slice(0, 12).padEnd(12, "0")}`,
          "Status PTKP": "TK/0",
          Status: "Aktif",
        },
        {
          Kode: code,
          Nama: `Duplikat ${suffix}`,
          "Gaji Pokok": "4000000",
          Status: "Aktif",
        },
      ],
      mapping,
    );
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.duplicateInFile).toBe(1);

    const commit = await commitAll(jobId, mapping);
    expect(commit.imported).toBe(1);
    expect(commit.failed).toBe(1);

    const [row] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({
          code: employees.code,
          name: employees.name,
          position: employees.position,
          baseSalary: employees.baseSalary,
          allowances: employees.allowances,
          ptkpStatus: employees.ptkpStatus,
        })
        .from(employees)
        .where(and(eq(employees.companyId, ORG_ID), eq(employees.code, code)))
        .limit(1),
    );
    expect(row).toMatchObject({
      code,
      name: `Budi Uji ${suffix}`,
      position: "Kasir",
      baseSalary: "4500000.0000",
      allowances: "500000.0000",
      ptkpStatus: "TK/0",
    });
  });

  it("aset tetap membuat jurnal perolehan dan baris duplikat dilewati", async () => {
    const assetName = `Chiller Uji ${suffix}`;
    createdAssetNames.push(assetName);
    const mapping = suggestMappingFor(ENTITY_FIELDS.fixed_assets, [
      "Nama Aset",
      "Tanggal Perolehan",
      "Harga Perolehan",
      "Umur Manfaat (bulan)",
      "Kode Akun Sumber",
    ]);
    const jobId = await makeJob(
      "fixed_assets",
      [
        {
          "Nama Aset": assetName,
          "Tanggal Perolehan": "2026-11-10",
          "Harga Perolehan": "12000000",
          "Umur Manfaat (bulan)": "60",
          "Kode Akun Sumber": "110101",
        },
        {
          "Nama Aset": assetName,
          "Tanggal Perolehan": "2026-11-10",
          "Harga Perolehan": "12000000",
          "Umur Manfaat (bulan)": "60",
          "Kode Akun Sumber": "110101",
        },
      ],
      mapping,
    );
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.duplicateInFile).toBe(1);

    const commit = await commitAll(jobId, mapping);
    expect(commit.imported).toBe(1);
    expect(commit.failed).toBe(1);

    const [asset] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({
          id: fixedAssets.id,
          number: fixedAssets.number,
          name: fixedAssets.name,
          cost: fixedAssets.cost,
          journalId: fixedAssets.journalId,
        })
        .from(fixedAssets)
        .where(and(eq(fixedAssets.companyId, ORG_ID), eq(fixedAssets.name, assetName)))
        .limit(1),
    );
    expect(asset).toMatchObject({ name: assetName, cost: "12000000.0000" });
    expect(asset?.journalId).toBeTruthy();

    const [journal] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId })
        .from(journalEntries)
        .where(eq(journalEntries.id, asset!.journalId!))
        .limit(1),
    );
    expect(journal).toMatchObject({ sourceType: "fixed_asset_acquisition", sourceId: asset!.id });
  });
});
