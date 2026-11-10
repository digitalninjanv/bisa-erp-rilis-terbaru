/**
 * Customisable document numbering (AK-P3-07).
 *
 * Each company may override the prefix and the zero-padding width per
 * document type; overrides live in `company_settings.document_numbering`
 * (jsonb, null = all defaults). The number structure itself never
 * changes: `{PREFIX}-{YEAR}-{SEQ}`. This module is the single source of
 * truth for the known document types, their Indonesian labels, and the
 * default prefixes that `src/server/sequences.ts` issues with.
 *
 * Stored overrides are untrusted input for the domain layer:
 * `sanitizeDocumentNumbering` keeps only well-formed entries so a
 * hand-edited jsonb value can never corrupt issued document numbers.
 */
export type DocumentNumberingEntry = {
  prefix?: string;
  padding?: number;
};

export type DocumentNumbering = Record<string, DocumentNumberingEntry>;

export const DOCUMENT_NUMBER_TYPES: ReadonlyArray<{
  key: string;
  label: string;
  defaultPrefix: string;
}> = [
  { key: "SALE", label: "Penjualan (POS & faktur)", defaultPrefix: "INV" },
  { key: "HOLD", label: "Pesanan ditahan POS", defaultPrefix: "HLD" },
  { key: "SALE_RETURN", label: "Retur penjualan", defaultPrefix: "RTN" },
  { key: "RECEIPT", label: "Penerimaan barang", defaultPrefix: "RCV" },
  { key: "PURCHASE_ADVANCE", label: "Uang muka pembelian (DP)", defaultPrefix: "DP" },
  { key: "SUPPLIER_RETURN", label: "Retur pembelian ke pemasok", defaultPrefix: "RTB" },
  { key: "PURCHASE_ORDER", label: "Pesanan pembelian (PO)", defaultPrefix: "PO" },
  { key: "ADJUSTMENT", label: "Penyesuaian stok", defaultPrefix: "ADJ" },
  { key: "TRANSFER", label: "Transfer stok", defaultPrefix: "TRF" },
  { key: "OPNAME", label: "Stok opname", defaultPrefix: "OPN" },
  { key: "JOURNAL", label: "Jurnal umum", defaultPrefix: "JE" },
  { key: "EXPENSE", label: "Pengeluaran / beban", defaultPrefix: "EXP" },
  { key: "BANK_TRANSFER", label: "Transfer bank", defaultPrefix: "BTF" },
  { key: "PAYMENT", label: "Pembayaran utang/piutang", defaultPrefix: "PAY" },
  { key: "PAYROLL", label: "Penggajian", defaultPrefix: "PRL" },
  { key: "EMPLOYEE_ADVANCE", label: "Kasbon karyawan", defaultPrefix: "KSB" },
  { key: "EMPLOYEE_LOAN", label: "Pinjaman karyawan", defaultPrefix: "PJM" },
  { key: "REIMBURSEMENT", label: "Reimbursement karyawan", defaultPrefix: "RBS" },
  { key: "FIXED_ASSET", label: "Aset tetap", defaultPrefix: "AST" },
  { key: "PURCHASE_REQUEST", label: "Permintaan pembelian (PR)", defaultPrefix: "PRQ" },
  { key: "RESERVATION", label: "Reservasi stok", defaultPrefix: "RSV" },
  { key: "OPENING_PAYABLE", label: "Saldo awal utang", defaultPrefix: "OPB" },
  { key: "OPENING_RECEIVABLE", label: "Saldo awal piutang", defaultPrefix: "OPR" },
  { key: "PARTY_CREDIT", label: "Kredit pihak (kelebihan bayar / uang muka)", defaultPrefix: "KRD" },
];

export const DOCUMENT_NUMBER_TYPE_KEYS: ReadonlySet<string> = new Set(
  DOCUMENT_NUMBER_TYPES.map((row) => row.key),
);

export function defaultDocumentPrefix(docType: string): string {
  return (
    DOCUMENT_NUMBER_TYPES.find((row) => row.key === docType)?.defaultPrefix ??
    docType.slice(0, 3).toUpperCase()
  );
}

export const DEFAULT_NUMBER_PADDING = 5;
export const MIN_NUMBER_PADDING = 3;
export const MAX_NUMBER_PADDING = 8;

/** Uppercase letters, digits and dashes, 1–10 characters. */
export const NUMBERING_PREFIX_PATTERN = /^[A-Z0-9-]{1,10}$/;

export function isValidNumberingPrefix(prefix: string): boolean {
  return NUMBERING_PREFIX_PATTERN.test(prefix);
}

/**
 * Normalizes user input for a prefix override: trims and uppercases.
 * Returns null when the input is empty (meaning "no override").
 * Callers validate the result with `isValidNumberingPrefix`.
 */
export function normalizeNumberingPrefix(raw: string): string | null {
  const normalized = raw.trim().toUpperCase();
  return normalized === "" ? null : normalized;
}

function isValidPadding(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_NUMBER_PADDING &&
    value <= MAX_NUMBER_PADDING
  );
}

/**
 * Keeps only well-formed overrides from an arbitrary stored value:
 * known document types only, valid prefixes (normalized), paddings in
 * range. Entries left with neither a prefix nor a padding are dropped.
 */
export function sanitizeDocumentNumbering(value: unknown): DocumentNumbering {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: DocumentNumbering = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!DOCUMENT_NUMBER_TYPE_KEYS.has(key)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const clean: DocumentNumberingEntry = {};
    if (typeof raw.prefix === "string") {
      const prefix = normalizeNumberingPrefix(raw.prefix);
      if (prefix && isValidNumberingPrefix(prefix)) clean.prefix = prefix;
    }
    if (isValidPadding(raw.padding)) clean.padding = raw.padding;
    if (clean.prefix !== undefined || clean.padding !== undefined) {
      result[key] = clean;
    }
  }
  return result;
}
