import { and, asc, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import { importCustomFieldValues } from "@/lib/import/import-custom-fields";
import {
  accountMappings,
  accounts,
  categories,
  customerGroups,
  customers,
  importJobs,
  importRows,
  partyOpeningBalances,
  products,
  suppliers,
  units,
} from "@/db/schema";
import { ACCOUNT_MAPPING_KEYS, mappingAllowsAccountType, MAPPING_LABELS } from "@/lib/account-mappings";
import {
  mapMasterRow,
  masterPreview,
  requiredCustomFieldsNote,
  type MasterEntity,
} from "./masters";
import { loadImportedOpeningStockProductIds, openingBalanceKey } from "./opening";
import { persistPendingImportRowIssues } from "@/server/import-row-issues";
import type { JobRow, Mapping, RowData } from "./shared";

/**
 * A-26 Q6 (K-10): analisis impor entitas master (pecahan
 * src/server/import-masters.ts) — kerangka isu-per-baris yang sama
 * dengan jalur produk: isu baris bermasalah disimpan ke
 * `import_rows.error` hanya untuk baris "pending".
 */

export type MasterSummary = {
  totalRows: number;
  valid: number;
  existingCount: number;
  duplicateInFile: number;
  invalidRows: number;
  unknownGroups: string[];
  unknownProducts: number;
  // Penghitung khusus produk selalu 0/[] di sini — bentuk ringkasan
  // disatukan dengan jalur produk agar tipe hasil analyzeImportAction
  // tetap satu dan konsumen lama (wizard/test produk) tidak berubah.
  missingName: number;
  missingSku: number;
  barcodeConflict: number;
  invalidPrice: number;
  invalidValue: number;
  newCategories: string[];
  newUnits: string[];
  newSuppliers: string[];
};

type PreviewItem = {
  rowNumber: number;
  label: string | null;
  detail: string | null;
  issue: string | null;
  action: "insert" | "update" | "skip" | "error";
  // Kolom pratinjau khusus produk — opsional agar bentuk pratinjau
  // analyze tetap satu tipe gabungan yang aman diakses konsumen lama.
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: number;
  stock?: number;
};


export async function analyzeMasterImport(
  tx: Tx,
  input: {
    companyId: string;
    job: JobRow;
    mapping: Mapping;
    customFields?: CustomFieldDefinition[];
  },
): Promise<{ summary: MasterSummary; preview: PreviewItem[] }> {
  const { companyId, job, mapping } = input;
  const entity = job.entity as MasterEntity;
  const customFields = input.customFields ?? [];

  const rows = await tx
    .select({ id: importRows.id, rowNumber: importRows.rowNumber, data: importRows.data, status: importRows.status })
    .from(importRows)
    .where(and(eq(importRows.companyId, companyId), eq(importRows.jobId, job.id)))
    .orderBy(asc(importRows.rowNumber));

  // Konteks keberadaan (existing) per entitas — dimuat sekali, bukan per baris.
  const existingSupplierNames = new Set<string>();
  const existingSupplierCodes = new Set<string>();
  const existingCustomerNames = new Set<string>();
  const existingCustomerCodes = new Set<string>();
  const existingAccountCodes = new Set<string>();
  const accountMetaByCode = new Map<
    string,
    { id: string; type: string; isPostable: boolean; isActive: boolean }
  >();
  const existingMappingKeys = new Set<string>();
  const existingCategoryNames = new Set<string>();
  const existingUnitCodes = new Set<string>();
  const existingUnitNames = new Set<string>();
  const categoryByName = new Map<string, string>();
  const groupByName = new Map<string, string>();
  const productBySku = new Map<string, { id: string }>();
  const productByName = new Map<string, { id: string }>();
  // T4-5b: konteks pihak untuk saldo awal — nama ATAU kode master.
  const partyNames = new Set<string>();
  const partyCodes = new Set<string>();
  // T4R-5: konteks duplikat antar-job — id pihak per nama/kode, kunci
  // dokumen saldo awal yang sudah ada, dan produk yang sudah menerima
  // stok awal dari impor job lain.
  const partyIdByKey = new Map<string, string>();
  const existingOpeningKeys = new Set<string>();
  let importedStockProductIds = new Set<string>();

  if (entity === "suppliers") {
    const found = await tx
      .select({ name: suppliers.name, code: suppliers.code })
      .from(suppliers)
      .where(eq(suppliers.companyId, companyId));
    for (const row of found) {
      existingSupplierNames.add(row.name.toLowerCase());
      existingSupplierCodes.add(row.code.toLowerCase());
    }
  } else if (entity === "customers") {
    const [found, groups] = await Promise.all([
      tx
        .select({ name: customers.name, code: customers.code })
        .from(customers)
        .where(eq(customers.companyId, companyId)),
      tx
        .select({ id: customerGroups.id, name: customerGroups.name })
        .from(customerGroups)
        .where(eq(customerGroups.companyId, companyId)),
    ]);
    for (const row of found) {
      existingCustomerNames.add(row.name.toLowerCase());
      existingCustomerCodes.add(row.code.toLowerCase());
    }
    for (const group of groups) groupByName.set(group.name.toLowerCase(), group.id);
  } else if (entity === "accounts") {
    const found = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, companyId));
    for (const row of found) {
      existingAccountCodes.add(row.code.toLowerCase());
    }
  } else if (entity === "account_mappings") {
    const [found, mappings] = await Promise.all([
      tx
        .select({
          id: accounts.id,
          code: accounts.code,
          type: accounts.type,
          isPostable: accounts.isPostable,
          isActive: accounts.isActive,
        })
        .from(accounts)
        .where(eq(accounts.companyId, companyId)),
      tx
        .select({ key: accountMappings.key })
        .from(accountMappings)
        .where(eq(accountMappings.companyId, companyId)),
    ]);
    for (const row of found) {
      existingAccountCodes.add(row.code.toLowerCase());
      accountMetaByCode.set(row.code.toLowerCase(), {
        id: row.id,
        type: row.type,
        isPostable: row.isPostable,
        isActive: row.isActive,
      });
    }
    for (const row of mappings) existingMappingKeys.add(row.key);
  } else if (entity === "categories") {
    const found = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.companyId, companyId));
    for (const row of found) {
      existingCategoryNames.add(row.name.toLowerCase());
      categoryByName.set(row.name.toLowerCase(), row.id);
    }
  } else if (entity === "units") {
    const found = await tx
      .select({ code: units.code, name: units.name })
      .from(units)
      .where(eq(units.companyId, companyId));
    for (const row of found) {
      existingUnitCodes.add(row.code.toLowerCase());
      existingUnitNames.add(row.name.toLowerCase());
    }
  } else if (entity === "opening_stock") {
    const found = await tx
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(eq(products.companyId, companyId));
    for (const row of found) {
      productBySku.set(row.sku.toLowerCase(), { id: row.id });
      if (!productByName.has(row.name.toLowerCase())) productByName.set(row.name.toLowerCase(), { id: row.id });
    }
    importedStockProductIds = await loadImportedOpeningStockProductIds(tx, companyId, job.id);
  } else if (entity === "opening_payables" || entity === "opening_receivables") {
    const isPayable = entity === "opening_payables";
    const table = isPayable ? suppliers : customers;
    const found = await tx
      .select({ id: table.id, name: table.name, code: table.code })
      .from(table)
      .where(eq(table.companyId, companyId));
    for (const row of found) {
      partyNames.add(row.name.toLowerCase());
      partyCodes.add(row.code.toLowerCase());
      if (!partyIdByKey.has(row.name.toLowerCase())) partyIdByKey.set(row.name.toLowerCase(), row.id);
      if (!partyIdByKey.has(row.code.toLowerCase())) partyIdByKey.set(row.code.toLowerCase(), row.id);
    }
    const docs = await tx
      .select({
        partyId: partyOpeningBalances.partyId,
        reference: partyOpeningBalances.reference,
        amount: partyOpeningBalances.amount,
        date: partyOpeningBalances.date,
      })
      .from(partyOpeningBalances)
      .where(
        and(
          eq(partyOpeningBalances.companyId, companyId),
          eq(partyOpeningBalances.kind, isPayable ? "payable" : "receivable"),
          ne(partyOpeningBalances.status, "void"),
        ),
      );
    for (const doc of docs) {
      existingOpeningKeys.add(openingBalanceKey(doc.partyId, doc.reference, doc.amount, doc.date));
    }
  }

  const summary: MasterSummary = {
    totalRows: rows.length,
    valid: 0,
    existingCount: 0,
    duplicateInFile: 0,
    invalidRows: 0,
    unknownGroups: [],
    unknownProducts: 0,
    missingName: 0,
    missingSku: 0,
    barcodeConflict: 0,
    invalidPrice: 0,
    invalidValue: 0,
    newCategories: [],
    newUnits: [],
    newSuppliers: [],
  };
  const preview: PreviewItem[] = [];
  const rowIssues: { id: string; status: string; issue: string | null }[] = [];
  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();
  const seenMappingKeys = new Set<string>();
  const seenOpeningKeys = new Set<string>();

  for (const row of rows) {
    const source = (row.data ?? {}) as RowData;
    const mapped = mapMasterRow(entity, source, mapping);
    let issue: string | null = null;
    let storedIssue: string | null = null;
    let validWithWarning = false;
    let action: PreviewItem["action"] = "insert";
    let label: string | null = null;
    let detail: string | null = null;

    if (!mapped.value) {
      summary.invalidRows += 1;
      issue = mapped.error ?? "Baris tidak valid";
      storedIssue = issue;
      action = "error";
    } else {
      const view = masterPreview(mapped.value);
      label = view.label;
      detail = view.detail;
      const value = mapped.value;

      if (value.kind === "suppliers" || value.kind === "customers") {
        const nameKey = value.value.name.toLowerCase();
        const codeKey = value.value.code?.toLowerCase() ?? null;
        const existingNames = value.kind === "suppliers" ? existingSupplierNames : existingCustomerNames;
        const existingCodes = value.kind === "suppliers" ? existingSupplierCodes : existingCustomerCodes;
        if (seenNames.has(nameKey) || (codeKey && seenCodes.has(codeKey))) {
          summary.duplicateInFile += 1;
          issue =
            value.kind === "suppliers"
              ? "Nama/kode duplikat di file (baris pertama dipakai)"
              : "Nama/kode duplikat di file (baris pertama dipakai)";
          storedIssue = issue;
          action = "error";
        } else {
          seenNames.add(nameKey);
          if (codeKey) seenCodes.add(codeKey);
          if (existingNames.has(nameKey) || (codeKey && existingCodes.has(codeKey))) {
            summary.existingCount += 1;
            issue = "Sudah ada — akan dilewati";
            action = "skip";
          } else if (
            value.kind === "customers" &&
            value.value.group &&
            !groupByName.has(value.value.group.toLowerCase())
          ) {
            summary.invalidRows += 1;
            if (!summary.unknownGroups.includes(value.value.group)) {
              summary.unknownGroups.push(value.value.group);
            }
            issue = `Kelompok harga "${value.value.group}" tidak ditemukan`;
            storedIssue = issue;
            action = "error";
          }
        }
      } else if (value.kind === "accounts") {
        const codeKey = value.value.code.toLowerCase();
        if (seenCodes.has(codeKey)) {
          summary.duplicateInFile += 1;
          issue = "Kode akun duplikat di file (baris pertama dipakai)";
          storedIssue = issue;
          action = "error";
        } else {
          seenCodes.add(codeKey);
          if (existingAccountCodes.has(codeKey)) {
            summary.existingCount += 1;
            issue = "Kode sudah ada — akan dilewati";
            action = "skip";
          }
        }
      } else if (value.kind === "categories") {
        const nameKey = value.value.name.toLowerCase();
        if (seenNames.has(nameKey)) {
          summary.duplicateInFile += 1;
          issue = "Nama kategori duplikat di file (baris pertama dipakai)";
          storedIssue = issue;
          action = "error";
        } else {
          seenNames.add(nameKey);
          if (existingCategoryNames.has(nameKey)) {
            summary.existingCount += 1;
            issue = "Kategori sudah ada — akan dilewati";
            action = "skip";
          } else if (
            value.value.parent &&
            !categoryByName.has(value.value.parent.toLowerCase())
          ) {
            summary.invalidRows += 1;
            issue = `Induk kategori "${value.value.parent}" tidak ditemukan — buat induknya dulu`;
            storedIssue = issue;
            action = "error";
          }
        }
      } else if (value.kind === "units") {
        const codeKey = value.value.code.toLowerCase();
        const nameKey = value.value.name.toLowerCase();
        if (seenCodes.has(codeKey) || seenNames.has(nameKey)) {
          summary.duplicateInFile += 1;
          issue = "Kode/nama satuan duplikat di file (baris pertama dipakai)";
          storedIssue = issue;
          action = "error";
        } else {
          seenCodes.add(codeKey);
          seenNames.add(nameKey);
          if (existingUnitCodes.has(codeKey) || existingUnitNames.has(nameKey)) {
            summary.existingCount += 1;
            issue = "Satuan sudah ada — akan dilewati";
            action = "skip";
          }
        }
      } else if (value.kind === "account_mappings") {
        const key = value.value.key;
        if (!(ACCOUNT_MAPPING_KEYS as readonly string[]).includes(key)) {
          summary.invalidRows += 1;
          issue = `Kunci pemetaan "${key}" tidak dikenal`;
          storedIssue = issue;
          action = "error";
        } else if (seenMappingKeys.has(key)) {
          summary.duplicateInFile += 1;
          issue = "Kunci pemetaan duplikat di file (baris pertama dipakai)";
          storedIssue = issue;
          action = "error";
        } else {
          seenMappingKeys.add(key);
          const meta = accountMetaByCode.get(value.value.accountCode.toLowerCase());
          if (!meta) {
            summary.invalidRows += 1;
            issue = `Kode akun "${value.value.accountCode}" tidak ditemukan`;
            storedIssue = issue;
            action = "error";
          } else if (!mappingAllowsAccountType(key, meta.type)) {
            summary.invalidRows += 1;
            issue = `Akun ${value.value.accountCode} bertipe ${meta.type}, tidak sesuai untuk pemetaan "${MAPPING_LABELS[key] ?? key}"`;
            storedIssue = issue;
            action = "error";
          } else if (!meta.isPostable || !meta.isActive) {
            summary.invalidRows += 1;
            issue = `Akun ${value.value.accountCode} harus aktif dan dapat diposting`;
            storedIssue = issue;
            action = "error";
          } else if (existingMappingKeys.has(key)) {
            action = "update";
            detail = `${detail ?? ""} · perbarui`.trim();
          }
        }
      } else if (value.kind === "opening_stock") {
        const found =
          (value.value.sku ? productBySku.get(value.value.sku.toLowerCase()) : undefined) ??
          (value.value.name ? productByName.get(value.value.name.toLowerCase()) : undefined);
        if (!found) {
          summary.invalidRows += 1;
          summary.unknownProducts += 1;
          issue = `Produk tidak ditemukan (SKU/nama "${value.value.sku ?? value.value.name ?? ""}") — buat produknya dulu`;
          storedIssue = issue;
          action = "error";
        } else if (importedStockProductIds.has(found.id)) {
          // T4R-5: stok awal produk ini sudah pernah diimpor job lain —
          // mengimpornya lagi akan menggandakan stok & jurnal pembuka.
          summary.existingCount += 1;
          issue = "Duplikat — produk ini sudah memiliki stok awal dari impor sebelumnya, baris akan dilewati";
          storedIssue = issue;
          action = "skip";
        }
      } else if (value.kind === "opening_payables" || value.kind === "opening_receivables") {
        // T4-5b: pihak saldo awal harus master yang SUDAH ada — impor
        // tidak membuat pemasok/pelanggan diam-diam dari baris utang.
        const key = value.value.party.toLowerCase();
        if (!partyNames.has(key) && !partyCodes.has(key)) {
          summary.invalidRows += 1;
          const label = value.kind === "opening_payables" ? "Pemasok" : "Pelanggan";
          issue = `${label} "${value.value.party}" tidak ditemukan — buat dulu lewat menu ${label} atau impor ${label}`;
          storedIssue = issue;
          action = "error";
        } else {
          // T4R-5: dokumen saldo awal yang sama (pihak + referensi, atau
          // pihak + nominal + tanggal tanpa referensi) tidak boleh lahir
          // dua kali — baik dari job/form sebelumnya maupun di berkas ini.
          const partyId = partyIdByKey.get(key);
          const docKey = partyId
            ? openingBalanceKey(partyId, value.value.reference, value.value.amount, value.value.date)
            : null;
          if (docKey && existingOpeningKeys.has(docKey)) {
            summary.existingCount += 1;
            issue = "Duplikat — dokumen saldo awal untuk pihak ini sudah ada, baris akan dilewati";
            storedIssue = issue;
            action = "skip";
          } else if (docKey && seenOpeningKeys.has(docKey)) {
            summary.duplicateInFile += 1;
            issue = "Duplikat di file — dokumen saldo awal yang sama sudah tercantum di baris sebelumnya (baris pertama dipakai)";
            storedIssue = issue;
            action = "error";
          } else if (docKey) {
            seenOpeningKeys.add(docKey);
          }
        }
      }

      if (
        action === "insert" &&
        (value.kind === "suppliers" || value.kind === "customers")
      ) {
        const custom = importCustomFieldValues({
          entity: value.kind === "suppliers" ? "supplier" : "customer",
          definitions: customFields,
          row: source,
          mapping,
        });
        if (custom.error) {
          summary.invalidRows += 1;
          issue = custom.error;
          storedIssue = issue;
          action = "error";
        } else if (custom.missingRequiredLabels.length > 0) {
          issue = requiredCustomFieldsNote(custom.missingRequiredLabels);
          storedIssue = issue;
          validWithWarning = true;
        }
      }

      if (!issue || validWithWarning) summary.valid += 1;
    }

    rowIssues.push({ id: row.id, status: row.status, issue: storedIssue });
    if (preview.length < 30) {
      preview.push({ rowNumber: row.rowNumber, label, detail, issue, action });
    }
  }

  // Sama seperti produk (GD-P2-7): isu baris bermasalah disimpan agar
  // tabel wizard membaca masalah nyata dari data baris di semua halaman.
  await persistPendingImportRowIssues(tx, companyId, job.id, rowIssues);

  await tx
    .update(importJobs)
    .set({ mapping, summary, totalRows: rows.length })
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, job.id)));

  return { summary, preview };
}

