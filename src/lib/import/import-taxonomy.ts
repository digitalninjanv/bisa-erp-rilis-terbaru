import { activeCell, cellText, type ImportFieldDef } from "./import-cells";

/**
 * Pemetaan baris master data pendukung produk & akuntansi:
 * kategori, satuan, dan pemetaan akun. Dipisah dari import-parse.ts
 * agar ratchet ukuran berkas tetap patuh.
 */

export const CATEGORY_FIELDS: ImportFieldDef[] = [
  {
    key: "name",
    label: "Nama kategori",
    required: true,
    aliases: ["nama kategori", "kategori", "category", "category name", "nama"],
  },
  {
    key: "parent",
    label: "Induk kategori",
    aliases: ["induk kategori", "kategori induk", "parent", "parent category", "induk"],
  },
  {
    key: "isActive",
    label: "Status",
    aliases: ["status", "status aktif", "aktif", "active", "is active"],
  },
];

export const UNIT_FIELDS: ImportFieldDef[] = [
  {
    key: "code",
    label: "Kode satuan",
    required: true,
    aliases: ["kode satuan", "kode", "code", "unit code", "singkatan"],
  },
  {
    key: "name",
    label: "Nama satuan",
    required: true,
    aliases: ["nama satuan", "satuan", "unit", "unit name", "nama"],
  },
  {
    key: "isActive",
    label: "Status",
    aliases: ["status", "status aktif", "aktif", "active", "is active"],
  },
];

export const ACCOUNT_MAPPING_FIELDS: ImportFieldDef[] = [
  {
    key: "key",
    label: "Kunci pemetaan",
    required: true,
    aliases: ["kunci pemetaan", "kunci", "key", "mapping key", "kode pemetaan"],
  },
  {
    key: "accountCode",
    label: "Kode akun",
    required: true,
    aliases: ["kode akun", "kode", "account code", "akun", "nomor akun"],
  },
];

export type MappedCategory = {
  name: string;
  parent: string | null;
  isActive: boolean;
};

export function mapCategoryRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedCategory; error?: string } {
  const name = cellText(row, mapping, "name", 80);
  if (!name) return { error: "Nama kategori kosong" };
  const active = activeCell(row, mapping);
  if ("error" in active) return { error: active.error };
  return {
    value: {
      name,
      parent: cellText(row, mapping, "parent", 80),
      isActive: active.value,
    },
  };
}

export type MappedUnit = {
  code: string;
  name: string;
  isActive: boolean;
};

export function mapUnitRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedUnit; error?: string } {
  const code = cellText(row, mapping, "code", 20)?.toUpperCase() ?? null;
  if (!code) return { error: "Kode satuan kosong" };
  const name = cellText(row, mapping, "name", 80);
  if (!name) return { error: "Nama satuan kosong" };
  const active = activeCell(row, mapping);
  if ("error" in active) return { error: active.error };
  return { value: { code, name, isActive: active.value } };
}

export type MappedAccountMapping = {
  key: string;
  accountCode: string;
};

export function mapAccountMappingRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedAccountMapping; error?: string } {
  const key = cellText(row, mapping, "key", 40)?.toLowerCase() ?? null;
  if (!key) return { error: "Kunci pemetaan kosong" };
  const accountCode = cellText(row, mapping, "accountCode", 20);
  if (!accountCode) return { error: "Kode akun kosong" };
  return { value: { key, accountCode } };
}
