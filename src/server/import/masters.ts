import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { formatIDR, formatNumber } from "@/lib/money";
import {
  customFieldDefinitionsFor,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from "@/lib/custom-fields";
import {
  mapAccountMappingRow,
  mapAccountRow,
  mapCategoryRow,
  mapCustomerGroupRow,
  mapCustomerRow,
  mapEmployeeRow,
  mapFixedAssetRow,
  mapPaymentMethodRow,
  mapOpeningBalanceRow,
  mapOpeningStockRow,
  mapBranchRow,
  mapSupplierRow,
  mapUnitRow,
  mapWarehouseRow,
  type ImportEntity,
  type MappedAccount,
  type MappedAccountMapping,
  type MappedBranch,
  type MappedCategory,
  type MappedCustomer,
  type MappedCustomerGroup,
  type MappedEmployee,
  type MappedFixedAsset,
  type MappedOpeningBalance,
  type MappedOpeningStock,
  type MappedPaymentMethod,
  type MappedSupplier,
  type MappedUnit,
  type MappedWarehouse,
} from "@/lib/import-parse";
import { getCompanySettingsRow } from "@/server/settings";
import type { Mapping, RowData } from "./shared";

/**
 * A-26 Q6 (K-10): pemetaan baris & pratinjau entitas master impor
 * (pecahan src/server/import-masters.ts). Nama fungsi & perilaku
 * tidak berubah; analisis di analyze.ts, commit di commit.ts dan
 * opening.ts, permukaan publik modul di index.ts.
 */

/**
 * T4-5a — analisis & commit impor untuk entitas selain produk.
 * Kerangkanya meniru impor produk persis: analisis menyimpan isu per
 * baris ke `import_rows.error` (hanya baris "pending"), commit berjalan
 * per batch dari baris "pending" dan menandai setiap baris dengan hasil
 * akhirnya (imported/skipped/error + entityId). Produk tetap di jalur
 * lamanya di actions/import/.
 */

export type MasterEntity = Exclude<ImportEntity, "products">;

/** Custom field definitions for the requested party entity. */
export async function loadCustomFields(
  tx: Tx,
  companyId: string,
  entity: CustomFieldEntity,
): Promise<CustomFieldDefinition[]> {
  const settings = await getCompanySettingsRow(tx, companyId);
  return customFieldDefinitionsFor(settings?.customFields, entity);
}

/** Required definitions retained for product import's existing warning path. */
export async function loadRequiredCustomFields(
  tx: Tx,
  companyId: string,
  entity: CustomFieldEntity,
): Promise<CustomFieldDefinition[]> {
  return (await loadCustomFields(tx, companyId, entity)).filter((field) => field.required);
}

export function requiredCustomFieldsNote(labels: string[]): string {
  return `Terimpor tanpa kolom wajib kustom terisi: ${labels.join(", ")} — lengkapi lewat form edit.`;
}

export type MasterMapped =
  | { kind: "suppliers"; value: MappedSupplier }
  | { kind: "customers"; value: MappedCustomer }
  | { kind: "accounts"; value: MappedAccount }
  | { kind: "categories"; value: MappedCategory }
  | { kind: "units"; value: MappedUnit }
  | { kind: "account_mappings"; value: MappedAccountMapping }
  | { kind: "branches"; value: MappedBranch }
  | { kind: "warehouses"; value: MappedWarehouse }
  | { kind: "payment_methods"; value: MappedPaymentMethod }
  | { kind: "customer_groups"; value: MappedCustomerGroup }
  | { kind: "employees"; value: MappedEmployee }
  | { kind: "fixed_assets"; value: MappedFixedAsset }
  | { kind: "opening_stock"; value: MappedOpeningStock }
  | { kind: "opening_payables"; value: MappedOpeningBalance }
  | { kind: "opening_receivables"; value: MappedOpeningBalance };

export function mapMasterRow(
  entity: MasterEntity,
  row: RowData,
  mapping: Mapping,
): { value?: MasterMapped; error?: string } {
  switch (entity) {
    case "suppliers": {
      const mapped = mapSupplierRow(row, mapping);
      return mapped.value ? { value: { kind: "suppliers", value: mapped.value } } : { error: mapped.error };
    }
    case "customers": {
      const mapped = mapCustomerRow(row, mapping);
      return mapped.value ? { value: { kind: "customers", value: mapped.value } } : { error: mapped.error };
    }
    case "accounts": {
      const mapped = mapAccountRow(row, mapping);
      return mapped.value ? { value: { kind: "accounts", value: mapped.value } } : { error: mapped.error };
    }
    case "categories": {
      const mapped = mapCategoryRow(row, mapping);
      return mapped.value ? { value: { kind: "categories", value: mapped.value } } : { error: mapped.error };
    }
    case "units": {
      const mapped = mapUnitRow(row, mapping);
      return mapped.value ? { value: { kind: "units", value: mapped.value } } : { error: mapped.error };
    }
    case "account_mappings": {
      const mapped = mapAccountMappingRow(row, mapping);
      return mapped.value
        ? { value: { kind: "account_mappings", value: mapped.value } }
        : { error: mapped.error };
    }
    case "branches": {
      const mapped = mapBranchRow(row, mapping);
      return mapped.value ? { value: { kind: "branches", value: mapped.value } } : { error: mapped.error };
    }
    case "warehouses": {
      const mapped = mapWarehouseRow(row, mapping);
      return mapped.value ? { value: { kind: "warehouses", value: mapped.value } } : { error: mapped.error };
    }
    case "payment_methods": {
      const mapped = mapPaymentMethodRow(row, mapping);
      return mapped.value
        ? { value: { kind: "payment_methods", value: mapped.value } }
        : { error: mapped.error };
    }
    case "customer_groups": {
      const mapped = mapCustomerGroupRow(row, mapping);
      return mapped.value
        ? { value: { kind: "customer_groups", value: mapped.value } }
        : { error: mapped.error };
    }
    case "employees": {
      const mapped = mapEmployeeRow(row, mapping);
      return mapped.value ? { value: { kind: "employees", value: mapped.value } } : { error: mapped.error };
    }
    case "fixed_assets": {
      const mapped = mapFixedAssetRow(row, mapping);
      return mapped.value
        ? { value: { kind: "fixed_assets", value: mapped.value } }
        : { error: mapped.error };
    }
    case "opening_stock": {
      const mapped = mapOpeningStockRow(row, mapping);
      return mapped.value
        ? { value: { kind: "opening_stock", value: mapped.value } }
        : { error: mapped.error };
    }
    case "opening_payables": {
      const mapped = mapOpeningBalanceRow(row, mapping, "Nama pemasok");
      return mapped.value
        ? { value: { kind: "opening_payables", value: mapped.value } }
        : { error: mapped.error };
    }
    case "opening_receivables": {
      const mapped = mapOpeningBalanceRow(row, mapping, "Nama pelanggan");
      return mapped.value
        ? { value: { kind: "opening_receivables", value: mapped.value } }
        : { error: mapped.error };
    }
  }
}


export type MasterRowPreview = {
  label: string;
  detail: string;
  // Kolom pratinjau khusus produk — opsional, lihat catatan di PreviewItem.
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: number;
  stock?: number;
};

/** Label & detail ringkas untuk tabel pratinjau wizard master. */
export function masterPreview(value: MasterMapped): MasterRowPreview {
  switch (value.kind) {
    case "suppliers":
      return { label: value.value.name, detail: value.value.code ?? "Kode otomatis" };
    case "customers":
      return {
        label: value.value.name,
        detail: value.value.group ? `Kelompok: ${value.value.group}` : (value.value.code ?? "Kode otomatis"),
      };
    case "accounts":
      return { label: `${value.value.code} — ${value.value.name}`, detail: value.value.type };
    case "categories":
      return {
        label: value.value.name,
        detail: [
          value.value.parent ? `Induk: ${value.value.parent}` : "Kategori utama",
          value.value.isActive ? "Aktif" : "Nonaktif",
        ].join(" · "),
      };
    case "units":
      return {
        label: `${value.value.code} — ${value.value.name}`,
        detail: value.value.isActive ? "Aktif" : "Nonaktif",
      };
    case "account_mappings":
      return {
        label: value.value.key,
        detail: `Akun ${value.value.accountCode}`,
      };
    case "branches":
      return {
        label: value.value.name,
        detail: [value.value.code ?? "Kode otomatis", value.value.isActive ? "Aktif" : "Nonaktif"].join(" · "),
      };
    case "warehouses":
      return {
        label: value.value.name,
        detail: [
          value.value.code ?? "Kode otomatis",
          value.value.type,
          value.value.branchCode ? `Cabang: ${value.value.branchCode}` : "Tanpa cabang",
          value.value.isActive ? "Aktif" : "Nonaktif",
        ].join(" · "),
      };
    case "payment_methods":
      return {
        label: value.value.name,
        detail: [
          value.value.code ?? "Kode otomatis",
          value.value.type,
          value.value.accountCode ? `Akun ${value.value.accountCode}` : null,
          value.value.isActive ? "Aktif" : "Nonaktif",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "customer_groups":
      return {
        label: value.value.name,
        detail: [
          value.value.discountType === "percent"
            ? `Diskon ${value.value.discountValue}%`
            : `Diskon ${formatIDR(value.value.discountValue)}`,
          value.value.roundingStep > 0 ? `Bulat ${value.value.roundingStep}` : null,
          value.value.isActive ? "Aktif" : "Nonaktif",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "employees":
      return {
        label: value.value.name,
        detail: [
          value.value.code ?? "Kode otomatis",
          value.value.position ?? "Tanpa jabatan",
          `${formatIDR(value.value.baseSalary)}/bulan`,
          value.value.isActive ? "Aktif" : "Nonaktif",
        ].join(" · "),
      };
    case "fixed_assets":
      return {
        label: value.value.name,
        detail: `${formatIDR(value.value.cost)} · ${value.value.acquisitionDate}${
          value.value.usefulLifeMonths ? ` · ${value.value.usefulLifeMonths} bulan` : ""
        }`,
      };
    case "opening_stock":
      return {
        label: value.value.sku ?? value.value.name ?? "—",
        detail: `Qty ${formatNumber(value.value.qty)} × ${formatIDR(value.value.unitCost)}${
          value.value.unitCost === 0 ? " — biaya 0, nilai persediaan akan 0" : ""
        }`,
      };
    case "opening_payables":
    case "opening_receivables":
      return {
        label: value.value.party,
        detail: `Saldo awal ${formatIDR(value.value.amount)}${value.value.dueDate ? ` · jatuh tempo ${value.value.dueDate}` : ""}`,
      };
  }
}


export function assertMasterEntity(entity: string): MasterEntity {
  if (
    entity === "suppliers" ||
    entity === "customers" ||
    entity === "accounts" ||
    entity === "categories" ||
    entity === "units" ||
    entity === "account_mappings" ||
    entity === "branches" ||
    entity === "warehouses" ||
    entity === "payment_methods" ||
    entity === "customer_groups" ||
    entity === "employees" ||
    entity === "fixed_assets" ||
    entity === "opening_stock" ||
    entity === "opening_payables" ||
    entity === "opening_receivables"
  ) {
    return entity;
  }
  throw new AppError("VALIDATION", "Jenis impor belum didukung.");
}
