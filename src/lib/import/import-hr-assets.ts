/**
 * Definisi impor karyawan & aset tetap. Aset tetap memakai
 * `registerFixedAsset` saat commit sehingga jurnal perolehan tetap
 * dibuat oleh aturan bisnis yang sama dengan form manual.
 */
import { cellText, numericCell, type ImportFieldDef } from "./import-cells";

export const EMPLOYEE_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode karyawan", aliases: ["kode karyawan", "kode", "code", "employee code", "nip"] },
  { key: "name", label: "Nama karyawan", required: true, aliases: ["nama karyawan", "nama", "name", "employee name"] },
  { key: "position", label: "Jabatan", aliases: ["jabatan", "posisi", "position", "title"] },
  { key: "baseSalary", label: "Gaji pokok", aliases: ["gaji pokok", "gaji", "base salary", "salary"] },
  { key: "allowances", label: "Tunjangan", aliases: ["tunjangan", "allowance", "allowances"] },
  { key: "deductions", label: "Potongan", aliases: ["potongan", "deduction", "deductions"] },
  { key: "joinedAt", label: "Tanggal masuk", aliases: ["tanggal masuk", "tgl masuk", "joined", "join date", "tanggal bergabung"] },
  { key: "nik", label: "NIK", aliases: ["nik", "no ktp", "nomor ktp", "ktp"] },
  { key: "npwp", label: "NPWP", aliases: ["npwp", "nomor npwp"] },
  { key: "ptkpStatus", label: "Status PTKP", aliases: ["status ptkp", "ptkp"] },
  { key: "gender", label: "Jenis kelamin", aliases: ["jenis kelamin", "gender", "kelamin"] },
  { key: "contractType", label: "Tipe kontrak", aliases: ["tipe kontrak", "kontrak", "contract type"] },
  { key: "isActive", label: "Status", aliases: ["status", "aktif", "is active", "active"] },
];

export const FIXED_ASSET_FIELDS: ImportFieldDef[] = [
  { key: "name", label: "Nama aset", required: true, aliases: ["nama aset", "nama", "name", "asset name"] },
  { key: "category", label: "Kategori", aliases: ["kategori", "kategori aset", "category", "golongan"] },
  {
    key: "acquisitionDate",
    label: "Tanggal perolehan",
    required: true,
    aliases: ["tanggal perolehan", "tgl perolehan", "acquisition date", "tanggal beli"],
  },
  {
    key: "cost",
    label: "Harga perolehan",
    required: true,
    aliases: ["harga perolehan", "nilai perolehan", "harga beli", "cost", "acquisition cost"],
  },
  { key: "residualValue", label: "Nilai residu", aliases: ["nilai residu", "residu", "residual", "residual value"] },
  {
    key: "usefulLifeMonths",
    label: "Umur manfaat (bulan)",
    aliases: ["umur manfaat", "umur ekonomis", "useful life", "bulan", "umur manfaat bulan"],
  },
  {
    key: "sourceAccountCode",
    label: "Kode akun sumber",
    required: true,
    aliases: ["kode akun sumber", "akun sumber", "source account", "akun kas", "akun perolehan"],
  },
  { key: "notes", label: "Catatan", aliases: ["catatan", "keterangan", "notes", "memo"] },
];

export type MappedEmployee = {
  code: string | null;
  name: string;
  position: string | null;
  baseSalary: number;
  allowances: number;
  deductions: number;
  joinedAt: string | null;
  nik: string | null;
  npwp: string | null;
  ptkpStatus: string | null;
  gender: "male" | "female" | null;
  contractType: "pkwtt" | "pkwt" | "harian" | "magang" | null;
  isActive: boolean;
};

export type MappedFixedAsset = {
  name: string;
  category: string | null;
  acquisitionDate: string;
  cost: number;
  residualValue: number | null;
  usefulLifeMonths: number | null;
  sourceAccountCode: string;
  notes: string | null;
};

function parseActive(value: string): boolean {
  return !/^(nonaktif|tidak aktif|tidak|false|0|no|n)$/i.test(value.trim());
}

function normalizeGender(value: string): "male" | "female" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "male" || normalized === "l" || normalized === "laki-laki" || normalized === "pria") {
    return "male";
  }
  if (normalized === "female" || normalized === "p" || normalized === "perempuan" || normalized === "wanita") {
    return "female";
  }
  return null;
}

function normalizeContract(value: string): "pkwtt" | "pkwt" | "harian" | "magang" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pkwtt" || normalized === "tetap") return "pkwtt";
  if (normalized === "pkwt" || normalized === "kontrak") return "pkwt";
  if (normalized === "harian" || normalized === "daily") return "harian";
  if (normalized === "magang" || normalized === "intern") return "magang";
  return null;
}

function parseISODate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

export function mapEmployeeRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedEmployee; error?: string } {
  const name = cellText(row, mapping, "name", 160);
  if (!name) return { error: "Nama karyawan wajib diisi" };
  const baseSalary = numericCell(
    mapping.baseSalary ? row[mapping.baseSalary] : undefined,
    "Gaji pokok",
  );
  if ("error" in baseSalary) return { error: baseSalary.error };
  const allowances = numericCell(
    mapping.allowances ? row[mapping.allowances] : undefined,
    "Tunjangan",
  );
  if ("error" in allowances) return { error: allowances.error };
  const deductions = numericCell(
    mapping.deductions ? row[mapping.deductions] : undefined,
    "Potongan",
  );
  if ("error" in deductions) return { error: deductions.error };
  if (baseSalary.value < 0 || allowances.value < 0 || deductions.value < 0) {
    return { error: "Gaji, tunjangan, dan potongan tidak boleh negatif" };
  }
  const joinedRaw = cellText(row, mapping, "joinedAt", 20);
  const joinedAt = joinedRaw ? parseISODate(joinedRaw) : null;
  if (joinedRaw && !joinedAt) return { error: "Tanggal masuk harus YYYY-MM-DD" };
  return {
    value: {
      code: cellText(row, mapping, "code", 40),
      name,
      position: cellText(row, mapping, "position", 80),
      baseSalary: baseSalary.value,
      allowances: allowances.value,
      deductions: deductions.value,
      joinedAt,
      nik: cellText(row, mapping, "nik", 20),
      npwp: cellText(row, mapping, "npwp", 30),
      ptkpStatus: cellText(row, mapping, "ptkpStatus", 6),
      gender: normalizeGender(cellText(row, mapping, "gender", 20) ?? ""),
      contractType: normalizeContract(cellText(row, mapping, "contractType", 20) ?? ""),
      isActive: parseActive(cellText(row, mapping, "isActive", 20) ?? ""),
    },
  };
}

export function mapFixedAssetRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedFixedAsset; error?: string } {
  const name = cellText(row, mapping, "name", 160);
  if (!name) return { error: "Nama aset wajib diisi" };
  const dateRaw = cellText(row, mapping, "acquisitionDate", 20);
  const acquisitionDate = dateRaw ? parseISODate(dateRaw) : null;
  if (!acquisitionDate) return { error: "Tanggal perolehan wajib YYYY-MM-DD" };
  const cost = numericCell(
    mapping.cost ? row[mapping.cost] : undefined,
    "Harga perolehan",
  );
  if ("error" in cost) return { error: cost.error };
  if (cost.value <= 0) return { error: "Harga perolehan harus lebih dari nol" };
  const residual = numericCell(
    mapping.residualValue ? row[mapping.residualValue] : undefined,
    "Nilai residu",
  );
  if ("error" in residual) return { error: residual.error };
  if (residual.value < 0) return { error: "Nilai residu tidak boleh negatif" };
  const life = numericCell(
    mapping.usefulLifeMonths ? row[mapping.usefulLifeMonths] : undefined,
    "Umur manfaat",
  );
  if ("error" in life) return { error: life.error };
  if (life.value !== 0 && (!Number.isInteger(life.value) || life.value < 1)) {
    return { error: "Umur manfaat harus bilangan bulat ≥ 1" };
  }
  const sourceAccountCode = cellText(row, mapping, "sourceAccountCode", 40);
  if (!sourceAccountCode) return { error: "Kode akun sumber wajib diisi" };
  return {
    value: {
      name,
      category: cellText(row, mapping, "category", 120),
      acquisitionDate,
      cost: cost.value,
      residualValue: residual.value > 0 ? residual.value : null,
      usefulLifeMonths: life.value > 0 ? life.value : null,
      sourceAccountCode,
      notes: cellText(row, mapping, "notes", 300),
    },
  };
}
