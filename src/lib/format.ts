export const TZ = "Asia/Jakarta";

export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function monthStartISO(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

export function yearStartISO(): string {
  return `${todayISO().slice(0, 4)}-01-01`;
}

/**
 * Last calendar day of a `YYYY-MM` period as an ISO date (SIM-2 S7
 * REM-04 / H-1). Day 0 of the following month is the period's last day,
 * which also resolves February in leap years. Payroll journals are dated
 * with this instead of the historical fixed "-28".
 */
export function periodEndDate(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00+07:00`) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  }).format(date);
}

export function formatDateLong(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00+07:00`) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(date);
}

/**
 * Tanggal untuk kepala dokumen resmi: tanpa nama hari, bulan penuh,
 * tanpa nol di depan ("1 November 2026"). Dipakai laporan keuangan
 * layar & cetak agar rumusan periode konsisten dengan dokumen formal.
 */
export function formatDateReport(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00+07:00`) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(date);
}

export function formatMonth(period: string | null | undefined): string {
  if (!period) return "—";
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

/**
 * CT-14 — ONE shared Bahasa Indonesia label for every journal
 * `source_type`, used by the cash-flow report, the journal detail page,
 * and the journal print page. Raw snake_case system words ("Sale
 * Reversal", "Payroll Payment") must never reach a printed document.
 * Reversals are derived: `<base>_reversal` → "Pembalikan <base label>".
 */
export const JOURNAL_SOURCE_LABELS: Record<string, string> = {
  sale: "Penjualan",
  sale_return: "Retur penjualan",
  payment: "Penerimaan pembayaran",
  purchase: "Pembelian",
  purchase_advance: "Uang muka pembelian",
  receipt_opening: "Penerimaan stok awal",
  receipt_bonus: "Bonus penerimaan barang",
  receipt_customer_return: "Retur pelanggan",
  receipt_other: "Penerimaan lainnya",
  purchase_return: "Retur pembelian",
  adjustment: "Penyesuaian stok",
  opname: "Stok opname",
  // FIX-GDG Tahap 3: sumber jurnal selisih transfer dua tahap
  // (inventory.ts/serials.ts) — sebelumnya jatuh ke fallback
  // kata-per-kata "Transfer difference" di daftar jurnal.
  transfer_difference: "Selisih transfer",
  opening: "Saldo awal",
  opening_migration: "Saldo awal migrasi",
  opening_balance: "Saldo awal",
  expense: "Beban",
  bank_transfer: "Transfer bank",
  bank_statement: "Mutasi bank",
  capital: "Setoran modal",
  cash_session: "Sesi kas",
  cash_movement: "Pergerakan kas",
  payroll: "Beban gaji",
  payroll_payment: "Pembayaran gaji",
  manual: "Jurnal manual",
  quick_cash_sale: "Penjualan tunai (input cepat)",
  // FIX-P1 Tahap 5 (AK5-02d): tipe sumber nyata yang sebelumnya jatuh ke
  // fallback kata-per-kata — kini berlabel Indonesia yang disengaja.
  supplier_return: "Retur pemasok",
  supplier_return_refund: "Refund retur pemasok",
  supplier_return_credit_apply: "Pemakaian kredit pemasok",
  supplier_return_replacement: "Penggantian retur pemasok",
  employee_advance: "Kasbon karyawan",
  employee_advance_repayment: "Potongan kasbon",
  employee_loan: "Pinjaman karyawan",
  employee_loan_repayment: "Potongan pinjaman",
  fixed_asset_acquisition: "Perolehan aset tetap",
  fixed_asset_depreciation: "Penyusutan aset tetap",
  fixed_asset_disposal: "Pelepasan aset tetap",
  reimbursement: "Reimbursement",
  year_end_closing: "Tutup buku tahunan",
};

export function journalSourceLabel(sourceType: string): string {
  if (sourceType.endsWith("_reversal")) {
    const base = journalSourceLabel(sourceType.slice(0, -"_reversal".length));
    return `Pembalikan ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  }
  const known = JOURNAL_SOURCE_LABELS[sourceType];
  if (known) return known;
  // Unknown future source types still read as words, never raw snake_case.
  const words = sourceType.replace(/_/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Lainnya";
}

/**
 * FIX-R2 Tahap 1 (RD2-08): label Bahasa Indonesia untuk enum yang
 * tampil di dokumen/layar resmi — dokumen tidak pernah memuat kata
 * mentah Inggris seperti "asset · saldo normal credit".
 */
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Liabilitas",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "Harga pokok penjualan",
  expense: "Beban",
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] ?? type;
}

export function normalBalanceLabel(normalBalance: string): string {
  if (normalBalance === "debit") return "Debit";
  if (normalBalance === "credit") return "Kredit";
  return normalBalance;
}

const PAYMENT_METHOD_TYPE_LABELS: Record<string, string> = {
  cash: "Tunai",
  bank: "Bank",
  qris: "QRIS",
  credit: "Utang",
  customer_credit: "Kredit pelanggan",
};

export function paymentMethodTypeLabel(type: string): string {
  return PAYMENT_METHOD_TYPE_LABELS[type] ?? type;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/**
 * FIX-GDG Tahap 4 (GDG2-10) — label jenis gerakan stok BERSAMA.
 * Sebelumnya tiga layar (Pergerakan, Kartu Stok produk, Dashboard
 * gudang) merender `movementType.replace(/_/g, " ")` mentah — hasilnya
 * campuran Inggris ("transfer difference") dan ejaan tak konsisten
 * antar-layar. Satu peta ini dipakai ketiganya + filter jenis.
 */
export const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  purchase: "Pembelian",
  purchase_advance: "Uang muka pembelian",
  sale: "Penjualan",
  sale_return: "Retur penjualan",
  purchase_return: "Retur pembelian",
  adjustment: "Penyesuaian",
  transfer_in: "Transfer masuk",
  transfer_out: "Transfer keluar",
  transfer_difference: "Selisih perjalanan",
  opname: "Opname",
  damaged: "Rusak",
  expired: "Kedaluwarsa",
  lost: "Hilang",
  quarantine: "Karantina",
  opening: "Saldo awal",
};

export function stockMovementTypeLabel(type: string): string {
  return STOCK_MOVEMENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

export const STOCK_MOVEMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Semua jenis" },
  ...Object.entries(STOCK_MOVEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * FIX-GDG Tahap 4 (GDG2-10) — tautan dari referensi gerakan ke halaman
 * detail dokumennya (detail penerimaan/dokumen stok lahir di GDG2-02).
 * Jenis referensi tanpa halaman detail (penjualan, void) → null.
 */
export function movementReferenceHref(
  referenceType: string | null,
  referenceId: string | null,
): string | null {
  if (!referenceType || !referenceId) return null;
  if (referenceType === "stock_receipt") return `/app/gudang/penerimaan/${referenceId}`;
  if (referenceType === "supplier_return") return `/app/gudang/retur-pembelian/${referenceId}`;
  if (
    referenceType === "transfer" ||
    referenceType === "adjustment" ||
    referenceType === "opname" ||
    referenceType === "purchase_return"
  ) {
    // purchase_return di sini = dokumen stok keluarga penyesuaian
    // (gerakan retur pemasok memakai referenceType supplier_return).
    return `/app/gudang/dokumen/${referenceId}`;
  }
  return null;
}
