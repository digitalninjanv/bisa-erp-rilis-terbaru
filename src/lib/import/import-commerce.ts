/**
 * Definisi impor metode pembayaran & kelompok harga. Keduanya master
 * referensi POS; kode/nama dipakai sebagai kunci idempoten.
 */
import { cellText, numericCell, type ImportFieldDef } from "./import-cells";

export const PAYMENT_METHOD_FIELDS: ImportFieldDef[] = [
  { key: "code", label: "Kode metode", aliases: ["kode metode", "kode", "code", "method code"] },
  { key: "name", label: "Nama metode", required: true, aliases: ["nama metode", "nama", "name", "metode pembayaran", "payment method"] },
  {
    key: "type",
    label: "Tipe",
    aliases: ["tipe", "type", "jenis", "kategori", "tipe pembayaran"],
  },
  {
    key: "accountCode",
    label: "Kode akun",
    aliases: ["kode akun", "akun", "account", "account code", "no akun"],
  },
  {
    key: "instructions",
    label: "Instruksi",
    aliases: ["instruksi", "keterangan", "instructions", "catatan"],
  },
  { key: "isActive", label: "Status", aliases: ["status", "aktif", "is active", "active"] },
];

export const CUSTOMER_GROUP_FIELDS: ImportFieldDef[] = [
  { key: "name", label: "Nama kelompok", required: true, aliases: ["nama kelompok", "kelompok harga", "nama", "name", "group"] },
  {
    key: "discountType",
    label: "Tipe diskon",
    aliases: ["tipe diskon", "jenis diskon", "discount type", "tipe"],
  },
  {
    key: "discountValue",
    label: "Nilai diskon",
    aliases: ["nilai diskon", "diskon", "discount", "discount value", "potongan"],
  },
  {
    key: "roundingStep",
    label: "Pembulatan",
    aliases: ["pembulatan", "kelipatan pembulatan", "rounding", "rounding step"],
  },
  {
    key: "roundingDirection",
    label: "Arah pembulatan",
    aliases: ["arah pembulatan", "rounding direction", "arah"],
  },
  {
    key: "roundCashTotal",
    label: "Bulatkan total tunai",
    aliases: ["bulatkan total tunai", "pembulatan total tunai", "round cash total", "total tunai"],
  },
  { key: "isActive", label: "Status", aliases: ["status", "aktif", "is active", "active"] },
];

export type PaymentMethodType = "cash" | "bank" | "qris" | "credit" | "customer_credit";

export type MappedPaymentMethod = {
  code: string | null;
  name: string;
  type: PaymentMethodType;
  accountCode: string | null;
  instructions: string | null;
  isActive: boolean;
};

export type MappedCustomerGroup = {
  name: string;
  discountType: "percent" | "amount";
  discountValue: number;
  roundingStep: number;
  roundingDirection: "down" | "up" | "nearest";
  roundCashTotal: boolean;
  isActive: boolean;
};

function parseActive(value: string): boolean {
  return !/^(nonaktif|tidak aktif|tidak|false|0|no|n)$/i.test(value.trim());
}

function parseYes(value: string): boolean {
  return /^(ya|yes|true|1|aktif|y)$/i.test(value.trim());
}

function normalizePaymentType(value: string): PaymentMethodType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "tunai" || normalized === "cash") return "cash";
  if (normalized === "bank" || normalized === "transfer" || normalized === "transfer bank") return "bank";
  if (normalized === "qris" || normalized === "qr") return "qris";
  if (normalized === "kredit" || normalized === "credit") return "credit";
  if (normalized === "piutang" || normalized === "customer credit" || normalized === "customer_credit") {
    return "customer_credit";
  }
  return "cash";
}

function normalizeDiscountType(value: string): "percent" | "amount" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "amount" || normalized === "nominal" || normalized === "rp" || normalized === "rupiah") {
    return "amount";
  }
  return "percent";
}

function normalizeRoundingDirection(value: string): "down" | "up" | "nearest" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "up" || normalized === "atas" || normalized === "ke atas") return "up";
  if (normalized === "nearest" || normalized === "terdekat") return "nearest";
  return "down";
}

export function mapPaymentMethodRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedPaymentMethod; error?: string } {
  const name = cellText(row, mapping, "name", 120);
  if (!name) return { error: "Nama metode pembayaran wajib diisi" };
  return {
    value: {
      code: cellText(row, mapping, "code", 40),
      name,
      type: normalizePaymentType(cellText(row, mapping, "type", 40) ?? ""),
      accountCode: cellText(row, mapping, "accountCode", 40),
      instructions: cellText(row, mapping, "instructions", 500),
      isActive: parseActive(cellText(row, mapping, "isActive", 20) ?? ""),
    },
  };
}

export function mapCustomerGroupRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<string, string>>,
): { value?: MappedCustomerGroup; error?: string } {
  const name = cellText(row, mapping, "name", 120);
  if (!name) return { error: "Nama kelompok harga wajib diisi" };
  const discount = numericCell(
    mapping.discountValue ? row[mapping.discountValue] : undefined,
    "Nilai diskon",
  );
  if ("error" in discount) return { error: discount.error };
  if (discount.value < 0) return { error: "Nilai diskon tidak boleh negatif" };
  const rounding = numericCell(
    mapping.roundingStep ? row[mapping.roundingStep] : undefined,
    "Pembulatan",
  );
  if ("error" in rounding) return { error: rounding.error };
  if (rounding.value < 0 || !Number.isInteger(rounding.value)) {
    return { error: "Pembulatan harus bilangan bulat ≥ 0" };
  }
  const discountType = normalizeDiscountType(cellText(row, mapping, "discountType", 40) ?? "");
  if (discountType === "percent" && discount.value > 100) {
    return { error: "Diskon persen maksimum 100" };
  }
  return {
    value: {
      name,
      discountType,
      discountValue: discount.value,
      roundingStep: rounding.value,
      roundingDirection: normalizeRoundingDirection(
        cellText(row, mapping, "roundingDirection", 40) ?? "",
      ),
      roundCashTotal: parseYes(cellText(row, mapping, "roundCashTotal", 20) ?? ""),
      isActive: parseActive(cellText(row, mapping, "isActive", 20) ?? ""),
    },
  };
}
