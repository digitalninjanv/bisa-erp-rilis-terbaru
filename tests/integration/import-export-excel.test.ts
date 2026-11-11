import { afterAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  accountMappings,
  accounts,
  categories,
  importJobs,
  importRows,
  units,
} from "@/db/schema";
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
