/**
 * Definisi impor cabang & gudang. Dipisah dari fasad import-parse agar
 * berkas itu tetap di bawah plafon arsitektur; permukaan publiknya
 * tetap diekspor ulang lewat "@/lib/import-parse".
 */
import { cellText, normalizeHeader, type ImportFieldDef } from "./import-cells";

export const BRANCH_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode cabang", aliases: ["kode cabang", "kode", "code", "branch code"] },
  { key: "name", label: "Nama cabang", required: true, aliases: ["nama cabang", "nama", "name", "branch name"] },
  { key: "address", label: "Alamat", aliases: ["alamat", "address", "lokasi"] },
  { key: "phone", label: "Telepon", aliases: ["telepon", "telp", "phone", "hp"] },
  { key: "isActive", label: "Status", aliases: ["status", "aktif", "is active", "active"] },
];

export const WAREHOUSE_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode gudang", aliases: ["kode gudang", "kode", "code", "warehouse code"] },
  { key: "name", label: "Nama gudang", required: true, aliases: ["nama gudang", "nama", "name", "warehouse name"] },
  {
    key: "type",
    label: "Tipe gudang",
    aliases: ["tipe gudang", "tipe", "type", "jenis", "jenis gudang"],
  },
  {
    key: "branchCode",
    label: "Kode cabang",
    aliases: ["kode cabang", "cabang", "branch", "branch code"],
  },
  { key: "isActive", label: "Status", aliases: ["status", "aktif", "is active", "active"] },
];

export type MappedBranch = {
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
};

export type MappedWarehouse = {
  code: string | null;
  name: string;
  type: "store" | "warehouse" | "quarantine";
  branchCode: string | null;
  isActive: boolean;
};

function parseActive(value: string): boolean {
  return !/^(nonaktif|tidak aktif|tidak|false|0|no|n)$/i.test(value.trim());
}

function normalizeWarehouseType(value: string): "store" | "warehouse" | "quarantine" {
  const normalized = normalizeHeader(value);
  if (normalized === "toko" || normalized === "store" || normalized === "outlet") return "store";
  if (normalized === "karantina" || normalized === "quarantine") return "quarantine";
  return "warehouse";
}

export function mapBranchRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedBranch; error?: string } {
  const name = cellText(row, mapping, "name", 160);
  if (!name) return { error: "Nama cabang wajib diisi" };
  return {
    value: {
      code: cellText(row, mapping, "code", 40),
      name,
      address: cellText(row, mapping, "address", 300),
      phone: cellText(row, mapping, "phone", 40),
      isActive: parseActive(cellText(row, mapping, "isActive", 20) ?? ""),
    },
  };
}

export function mapWarehouseRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedWarehouse; error?: string } {
  const name = cellText(row, mapping, "name", 160);
  if (!name) return { error: "Nama gudang wajib diisi" };
  return {
    value: {
      code: cellText(row, mapping, "code", 40),
      name,
      type: normalizeWarehouseType(cellText(row, mapping, "type", 40) ?? ""),
      branchCode: cellText(row, mapping, "branchCode", 40),
      isActive: parseActive(cellText(row, mapping, "isActive", 20) ?? ""),
    },
  };
}
