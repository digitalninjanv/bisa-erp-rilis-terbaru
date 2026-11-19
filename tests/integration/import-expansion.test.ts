import { afterAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  accounts,
  customerGroups,
  customers,
  importJobs,
  importRows,
  journalEntries,
  journalLines,
  products,
  stockMovements,
  stockOnHand,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import { listImportRowsAction } from "@/server/actions/import/rows";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { getAccountMap, postJournal } from "@/server/accounting";
import { voidReceipt } from "@/server/inventory";
import {
  ENTITY_FIELDS,
  IMPORT_SAMPLES,
  mapAccountRow,
  mapCustomerRow,
  mapOpeningStockRow,
  mapSupplierRow,
  suggestMappingFor,
  type ImportEntity,
} from "@/lib/import-parse";
import { GET as exportSuppliersRoute } from "@/app/api/export/suppliers/route";
import { GET as exportCustomersRoute } from "@/app/api/export/customers/route";
import { GET as exportAccountsRoute } from "@/app/api/export/accounts/route";
import { GET as importTemplateRoute } from "@/app/api/import/template/[entity]/route";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Pola yang sama dengan import-review.test.ts: sesi & cache Next diganti
// agar kode action/rute asli berjalan terhadap database dev asli.
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
const createdSupplierCodes: string[] = [];
const createdCustomerCodes: string[] = [];
const createdAccountCodes: string[] = [];
let createdGroupId = "";
let openingReceiptId = "";


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

/** Parse CSV contoh menjadi objek baris persis seperti yang disimpan rute parse. */
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
        fileName: `uji-${entity}-${suffix}.csv`,
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

async function commitAll(
  jobId: string,
  mapping: Partial<Record<string, string>>,
  extra?: { warehouseId?: string },
) {
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let last: { done: boolean; receiptNumber?: string | null } = { done: false };
  for (let guard = 0; guard < 20; guard += 1) {
    const result = await commitImportBatchAction({
      jobId,
      mapping,
      limit: 200,
      ...(extra?.warehouseId ? { warehouseId: extra.warehouseId } : {}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) break;
    imported += result.data.imported;
    skipped += result.data.skipped;
    failed += result.data.failed;
    last = result.data;
    if (result.data.done || result.data.processed === 0) break;
  }
  return { imported, skipped, failed, ...last };
}

async function storedRows(jobId: string) {
  return withCompanyReadOnly(ORG_ID, (tx) =>
    tx
      .select({
        rowNumber: importRows.rowNumber,
        status: importRows.status,
        error: importRows.error,
        entityId: importRows.entityId,
      })
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNumber)),
  );
}

afterAll(async () => {
  await withCompany(ORG_ID, async (tx) => {
    if (openingReceiptId) {
      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: openingReceiptId,
        reason: "Pembersihan uji impor stok awal",
        date: todayISO(),
      }).catch(() => undefined);
    }
    if (createdJobIds.length) {
      await tx.delete(importRows).where(inArray(importRows.jobId, createdJobIds));
      await tx.delete(importJobs).where(inArray(importJobs.id, createdJobIds));
    }
    if (createdCustomerCodes.length) {
      await tx
        .delete(customers)
        .where(and(eq(customers.companyId, ORG_ID), inArray(customers.code, createdCustomerCodes)));
    }
    if (createdSupplierCodes.length) {
      await tx
        .delete(suppliers)
        .where(and(eq(suppliers.companyId, ORG_ID), inArray(suppliers.code, createdSupplierCodes)));
    }
    if (createdAccountCodes.length) {
      await tx
        .delete(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), inArray(accounts.code, createdAccountCodes)));
    }
    if (createdGroupId) {
      await tx.delete(customerGroups).where(eq(customerGroups.id, createdGroupId));
    }
  });
});

describe("T4-5a perluasan impor — contoh CSV & template", () => {
  it("setiap tipe punya contoh CSV yang ter-parse bersih dan headernya terpetakan", async () => {
    for (const entity of ["products", "suppliers", "customers", "accounts", "opening_stock"] as const) {
      const { headers, rows, mapping } = sampleRows(entity);
      const required = ENTITY_FIELDS[entity].filter((field) => field.required);
      for (const field of required) {
        expect(mapping[field.key], `${entity}: kolom wajib ${field.key} harus terpetakan`).toBeTruthy();
      }
      expect(rows.length).toBeGreaterThan(0);
      expect(headers.length).toBeGreaterThan(1);
    }

    // Mapper murni: contoh pemasok/pelanggan/akun lolos validasi baris.
    const supplierSample = sampleRows("suppliers");
    for (const row of supplierSample.rows) {
      expect(mapSupplierRow(row, supplierSample.mapping).error).toBeUndefined();
    }
    const customerSample = sampleRows("customers");
    for (const row of customerSample.rows) {
      expect(mapCustomerRow(row, customerSample.mapping).error).toBeUndefined();
    }
    const accountSample = sampleRows("accounts");
    for (const row of accountSample.rows) {
      const mapped = mapAccountRow(row, accountSample.mapping);
      expect(mapped.error).toBeUndefined();
      expect(mapped.value?.type).toBeTruthy();
    }
    const stockSample = sampleRows("opening_stock");
    for (const row of stockSample.rows) {
      expect(mapOpeningStockRow(row, stockSample.mapping).error).toBeUndefined();
    }
  });

  it("rute template mengembalikan CSV contoh dengan header persis yang diterima parser", async () => {
    for (const entity of ["products", "suppliers", "customers", "accounts", "opening_stock"] as const) {
      const response = await importTemplateRoute(new Request(`http://localhost/api/import/template/${entity}`), {
        params: Promise.resolve({ entity }),
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
      expect(firstLine).toBe(IMPORT_SAMPLES[entity].csv.split("\n")[0]);
    }
    const bad = await importTemplateRoute(new Request("http://localhost/api/import/template/aneh"), {
      params: Promise.resolve({ entity: "aneh" }),
    });
    expect(bad.status).toBe(404);
  });
});

describe("T4-5a impor pemasok", () => {
  it("contoh CSV pemasok lolos analisis tanpa isu baris", async () => {
    const { rows, mapping } = sampleRows("suppliers");
    const jobId = await makeJob("suppliers", rows, mapping);
    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.data.summary.totalRows).toBe(rows.length);
    expect(analysis.data.summary.invalidRows ?? 0).toBe(0);
    const stored = await storedRows(jobId);
    expect(stored.every((row) => row.error === null)).toBe(true);
  });

  it("commit membuat pemasok yang bisa dipakai; duplikat & baris rusak tertangani per baris", async () => {
    const existingName = `Pemasok Lama Uji ${suffix}`;
    await withCompany(ORG_ID, async (tx) => {
      const [created] = await tx
        .insert(suppliers)
        .values({ companyId: ORG_ID, code: `SUP-LAMA-${suffix}`, name: existingName })
        .returning({ code: suppliers.code });
      createdSupplierCodes.push(created.code);
    });

    const nameA = `Pemasok Baru Uji ${suffix}`;
    const mapping = suggestMappingFor(ENTITY_FIELDS.suppliers, ["Kode", "Nama", "Telepon", "Email", "Alamat", "Catatan"]);
    const jobId = await makeJob(
      "suppliers",
      [
        { Kode: `SUP-BARU-${suffix}`, Nama: nameA, Telepon: "0812", Email: "", Alamat: "", Catatan: "" },
        { Kode: "", Nama: "", Telepon: "", Email: "", Alamat: "", Catatan: "" },
        { Kode: "", Nama: existingName, Telepon: "", Email: "", Alamat: "", Catatan: "" },
        { Kode: "", Nama: nameA, Telepon: "", Email: "", Alamat: "", Catatan: "" },
        { Kode: "", Nama: `Pemasok Otomatis ${suffix}`, Telepon: "", Email: "", Alamat: "", Catatan: "" },
      ],
      mapping,
    );

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    const stored = await storedRows(jobId);
    expect(stored[1].error).toContain("Nama");
    expect(stored[3].error).toContain("duplikat");

    const result = await commitAll(jobId, mapping);
    expect(result.done).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(2);

    const created = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ code: suppliers.code, name: suppliers.name })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.companyId, ORG_ID),
            inArray(suppliers.name, [nameA, `Pemasok Otomatis ${suffix}`]),
          ),
        ),
    );
    expect(created).toHaveLength(2);
    // Baris tanpa kode menerima kode otomatis; baris berkode memakai kodenya.
    const auto = created.find((row) => row.name === `Pemasok Otomatis ${suffix}`);
    expect(auto?.code).toMatch(/^SUP-\d+$/);
    createdSupplierCodes.push(...created.map((row) => row.code));

    const after = await storedRows(jobId);
    expect(after.map((row) => row.status)).toEqual(["imported", "error", "skipped", "error", "imported"]);

    // Ekspor memuat pemasok yang baru dibuat.
    const response = await exportSuppliersRoute();
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("Kode,Nama,Telepon,Email,Alamat,Catatan,NPWP,Bank,No. Rekening,Atas Nama,Termin (hari),Status");
    expect(csv).toContain(nameA);
  });
});

describe("T4-5a impor pelanggan", () => {
  it("kelompok dikenal terhubung, kelompok asing menjadi error baris, batas kredit terbaca id-ID", async () => {
    const groupName = `Grup Uji ${suffix}`;
    await withCompany(ORG_ID, async (tx) => {
      const [group] = await tx
        .insert(customerGroups)
        .values({ companyId: ORG_ID, name: groupName })
        .returning({ id: customerGroups.id });
      createdGroupId = group.id;
    });

    const mapping = suggestMappingFor(ENTITY_FIELDS.customers, [
      "Kode",
      "Nama",
      "Telepon",
      "Email",
      "Alamat",
      "Kelompok Harga",
      "Batas Kredit",
      "Catatan",
    ]);
    const nameGrouped = `Pelanggan Grup ${suffix}`;
    const namePlain = `Pelanggan Polos ${suffix}`;
    const jobId = await makeJob(
      "customers",
      [
        { Kode: `CUST-G-${suffix}`, Nama: nameGrouped, Telepon: "", Email: "", Alamat: "", "Kelompok Harga": groupName, "Batas Kredit": "2.500.000", Catatan: "" },
        { Kode: "", Nama: `Pelanggan Hantu ${suffix}`, Telepon: "", Email: "", Alamat: "", "Kelompok Harga": `Grup Tidak Ada ${suffix}`, "Batas Kredit": "", Catatan: "" },
        { Kode: "", Nama: namePlain, Telepon: "", Email: "", Alamat: "", "Kelompok Harga": "", "Batas Kredit": "", Catatan: "" },
      ],
      mapping,
    );

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    const stored = await storedRows(jobId);
    expect(stored[1].error).toContain("Kelompok");

    const result = await commitAll(jobId, mapping);
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);

    const created = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ code: customers.code, name: customers.name, groupId: customers.groupId, creditLimit: customers.creditLimit })
        .from(customers)
        .where(and(eq(customers.companyId, ORG_ID), inArray(customers.name, [nameGrouped, namePlain]))),
    );
    expect(created).toHaveLength(2);
    const grouped = created.find((row) => row.name === nameGrouped);
    expect(grouped?.groupId).toBe(createdGroupId);
    expect(d(grouped!.creditLimit).toFixed(2)).toBe("2500000.00");
    createdCustomerCodes.push(...created.map((row) => row.code));

    const response = await exportCustomersRoute();
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain(nameGrouped);
    expect(csv).toContain(groupName);
  });
});

describe("T4-5a impor akun", () => {
  it("tipe tak dikenal error, kode yang sudah ada dilewati, akun baru bisa diposting jurnal", async () => {
    const [existing] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID))
        .orderBy(asc(accounts.code))
        .limit(1),
    );
    expect(existing).toBeTruthy();

    const newCode = `89${suffix.slice(0, 2)}`;
    const mapping = suggestMappingFor(ENTITY_FIELDS.accounts, ["Kode", "Nama", "Tipe", "Saldo Normal", "Bagian", "Keterangan"]);
    const jobId = await makeJob(
      "accounts",
      [
        { Kode: newCode, Nama: `Beban Uji Impor ${suffix}`, Tipe: "expense", "Saldo Normal": "", Bagian: "", Keterangan: "" },
        { Kode: `88${suffix.slice(0, 2)}`, Nama: "Akun Ajaib", Tipe: "ajaib", "Saldo Normal": "", Bagian: "", Keterangan: "" },
        { Kode: existing!.code, Nama: "Akun Lama", Tipe: "asset", "Saldo Normal": "", Bagian: "", Keterangan: "" },
      ],
      mapping,
    );

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    const stored = await storedRows(jobId);
    expect(stored[1].error).toContain("Tipe akun tidak dikenal");

    const result = await commitAll(jobId, mapping);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);

    const [created] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, newCode))),
    );
    expect(created).toBeTruthy();
    expect(created!.type).toBe("expense");
    expect(created!.normalBalance).toBe("debit");
    expect(created!.isPostable).toBe(true);
    createdAccountCodes.push(newCode);

    // Akun hasil impor benar-benar bisa dipakai memposting jurnal seimbang.
    const journalId = await rollbackTransaction(async (tx) => {
      const map = await getAccountMap(tx, ORG_ID);
      const entry = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: "Uji akun hasil impor",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: created!.id, debit: 1000, description: "Beban uji" },
          { accountId: map.equity, credit: 1000, description: "Lawan uji" },
        ],
      });
      const lines = await tx
        .select({ debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id));
      const debit = lines.reduce((acc, row) => acc.plus(d(row.debit)), d(0));
      const credit = lines.reduce((acc, row) => acc.plus(d(row.credit)), d(0));
      expect(debit.toFixed(2)).toBe(credit.toFixed(2));
      return entry.id;
    });
    expect(journalId).toMatch(/^[0-9a-f-]{36}$/);

    const response = await exportAccountsRoute();
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain(newCode);
  });
});

describe("T4-5a impor stok awal", () => {
  it("commit menghasilkan SATU penerimaan opening dengan stok & jurnal ekuitas yang benar", async () => {
    const skuA = `TST-OPEN-${suffix}-A`;
    const skuB = `TST-OPEN-${suffix}-B`;
    const productIds = await withCompany(ORG_ID, async (tx) => {
      const rows = await tx
        .insert(products)
        .values([
          { companyId: ORG_ID, sku: skuA, name: `Produk Stok Awal A ${suffix}`, costPrice: "0", salePrice: "5000" },
          { companyId: ORG_ID, sku: skuB, name: `Produk Stok Awal B ${suffix}`, costPrice: "0", salePrice: "9000" },
        ])
        .returning({ id: products.id, sku: products.sku });
      return rows;
    });
    const idBySku = new Map(productIds.map((row) => [row.sku, row.id]));

    const [warehouse] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1),
    );
    expect(warehouse).toBeTruthy();

    const mapping = suggestMappingFor(ENTITY_FIELDS.opening_stock, ["SKU", "Nama Produk", "Qty", "Biaya Satuan"]);
    const jobId = await makeJob(
      "opening_stock",
      [
        { SKU: skuA, "Nama Produk": "", Qty: "10", "Biaya Satuan": "2.500" },
        { SKU: skuB, "Nama Produk": "", Qty: "4", "Biaya Satuan": "10000" },
        { SKU: `TIDAK-ADA-${suffix}`, "Nama Produk": "", Qty: "5", "Biaya Satuan": "1000" },
        { SKU: skuA, "Nama Produk": "", Qty: "2", "Biaya Satuan": "3.500" },
      ],
      mapping,
    );

    const analysis = await analyzeImportAction({ jobId, mapping });
    expect(analysis.ok).toBe(true);
    const analyzed = await storedRows(jobId);
    expect(analyzed[2].error).toContain("tidak ditemukan");

    const result = await commitAll(jobId, mapping, { warehouseId: warehouse!.id });
    expect(result.done).toBe(true);
    expect(result.imported).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.receiptNumber).toBeTruthy();

    const stored = await storedRows(jobId);
    const receiptIds = new Set(stored.filter((row) => row.status === "imported").map((row) => row.entityId));
    expect(receiptIds.size).toBe(1);
    openingReceiptId = [...receiptIds][0] as string;

    const [receipt] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(stockReceipts).where(eq(stockReceipts.id, openingReceiptId)),
    );
    expect(receipt.source).toBe("opening");
    expect(receipt.number).toBe(result.receiptNumber);
    // 10×2.500 + 2×3.500 + 4×10.000 = 72.000
    expect(d(receipt.total).toFixed(2)).toBe("72000.00");
    const moves = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select({ type: stockMovements.movementType }).from(stockMovements)
        .where(eq(stockMovements.referenceId, openingReceiptId)),
    );
    expect(moves.map(({ type }) => type)).toEqual(["purchase", "purchase"]);

    const onHand = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ productId: stockOnHand.productId, qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse!.id),
            inArray(stockOnHand.productId, [idBySku.get(skuA)!, idBySku.get(skuB)!]),
          ),
        ),
    );
    const qtyByProduct = new Map(onHand.map((row) => [row.productId, d(row.qty).toNumber()]));
    expect(qtyByProduct.get(idBySku.get(skuA)!)).toBe(12);
    expect(qtyByProduct.get(idBySku.get(skuB)!)).toBe(4);

    // Jurnal penerimaan opening: Dr Persediaan / Cr Ekuitas sebesar total.
    const [entry] = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: journalEntries.id, sourceType: journalEntries.sourceType })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "receipt_opening"),
            eq(journalEntries.sourceId, openingReceiptId),
          ),
        ),
    );
    expect(entry).toBeTruthy();
    const map = await withCompanyReadOnly(ORG_ID, (tx) => getAccountMap(tx, ORG_ID));
    const lines = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx.select().from(journalLines).where(eq(journalLines.entryId, entry!.id)),
    );
    const inventoryLine = lines.find((line) => line.accountId === map.inventory);
    const equityLine = lines.find((line) => line.accountId === map.equity);
    expect(d(inventoryLine!.debit).toFixed(2)).toBe("72000.00");
    expect(d(equityLine!.credit).toFixed(2)).toBe("72000.00");

    // Pratinjau baris untuk stok awal tetap tersedia lewat action daftar baris.
    const listed = await listImportRowsAction({ jobId, filter: "all", page: 1, pageSize: 10 });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data.total).toBe(4);
      expect(listed.data.rows[0].preview).toBeTruthy();
    }
  });
});
