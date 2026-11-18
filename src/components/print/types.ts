/**
 * Print Engine (T4-4, D-13) — shared types & pure helpers.
 *
 * Print settings live on `company_settings` (migration 0015). Templates
 * change typography and accent emphasis only; they never change the
 * document data being printed.
 */

export type PrintTemplate = "modern" | "minimal" | "classic" | "corporate" | "compact" | "elegant";
export type PrintFontChoice = "sans" | "serif" | "mono";
export type PrintReceiptPaper = "thermal58" | "thermal80" | "a5" | "a4";
export type PrintDocumentPaper = "a4" | "a5";
export type PrintPaper = PrintReceiptPaper | PrintDocumentPaper;

/** Dokumen yang boleh punya override desain sendiri (Odoo paper format
 * per report; NetSuite template per report type). */
export type PrintDocumentType =
  | "nota"
  | "faktur"
  | "pembelian"
  | "penerimaan"
  | "retur_pembelian"
  | "transfer"
  | "opname"
  | "jurnal"
  | "buku_besar"
  | "laporan"
  | "pajak"
  | "aging"
  | "payroll"
  | "z_report"
  | "statement";

export type PrintDocumentOverride = {
  template?: PrintTemplate;
  font?: PrintFontChoice;
  accentColor?: string;
  receiptPaper?: PrintReceiptPaper;
  documentPaper?: PrintDocumentPaper;
  showQr?: boolean;
  showSignature?: boolean;
  showBranding?: boolean;
};

export type PrintDocumentOverrides = Partial<Record<PrintDocumentType, PrintDocumentOverride>>;

export const PRINT_DOCUMENT_TYPES: {
  key: PrintDocumentType;
  label: string;
  paper: "receipt" | "document";
}[] = [
  { key: "nota", label: "Nota kasir (thermal)", paper: "receipt" },
  { key: "faktur", label: "Faktur penjualan", paper: "document" },
  { key: "pembelian", label: "Pesanan pembelian (PO)", paper: "document" },
  { key: "penerimaan", label: "Bukti penerimaan barang (GRN)", paper: "document" },
  { key: "retur_pembelian", label: "Retur pembelian", paper: "document" },
  { key: "transfer", label: "Transfer gudang", paper: "document" },
  { key: "opname", label: "Lembar hitung opname", paper: "document" },
  { key: "jurnal", label: "Jurnal umum", paper: "document" },
  { key: "buku_besar", label: "Buku besar", paper: "document" },
  { key: "laporan", label: "Laporan keuangan", paper: "document" },
  { key: "pajak", label: "Buku PPN", paper: "document" },
  { key: "aging", label: "Aging piutang/utang", paper: "document" },
  { key: "payroll", label: "Slip gaji", paper: "document" },
  { key: "z_report", label: "Laporan tutup sesi (Z)", paper: "document" },
  { key: "statement", label: "Statement piutang pelanggan", paper: "document" },
];

export interface PrintSettings {
  template: PrintTemplate;
  logoUrl: string | null;
  accentColor: string;
  font: PrintFontChoice;
  headerText: string | null;
  footerText: string | null;
  showSignature: boolean;
  showQr: boolean;
  receiptPaper: PrintReceiptPaper;
  documentPaper: PrintDocumentPaper;
  /**
   * A-28 UI-2 (UX-D01/D03): saklar elemen nota hidup di SATU pintu —
   * mesin cetak. Tampil kasir & tampil PPN pindah dari tab warisan
   * "Nota & printer" (kolom receipt_show_* dimigrasikan ke sini);
   * tampil pelanggan, tampil sesi, dan baris merek "Dicetak dari
   * Bisa ERP" menyusul pola yang sama. Semua bawaan menyala =
   * perilaku cetak sebelum UI-2.
   */
  showCashier: boolean;
  showTax: boolean;
  showCustomer: boolean;
  showSession: boolean;
  showBranding: boolean;
  /** Label blok tanda tangan per jenis dokumen (UX-D05). */
  signatureLabels: PrintSignatureLabels;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  template: "modern",
  logoUrl: null,
  accentColor: "#111827",
  font: "sans",
  headerText: null,
  footerText: null,
  showSignature: true,
  showQr: true,
  receiptPaper: "thermal80",
  documentPaper: "a4",
  showCashier: true,
  showTax: true,
  showCustomer: true,
  showSession: true,
  showBranding: true,
  signatureLabels: {},
};

/* ------------------------------------------------------------------ */
/* Label tanda tangan per jenis dokumen (A-28 UI-2, UX-D05)            */
/* ------------------------------------------------------------------ */

/**
 * Jenis dokumen berblok tanda tangan. Label bawaan = label yang
 * selama ini tertanam di halaman cetak masing-masing; pengaturan
 * per perusahaan hanya MENGGANTI TEKS label pada posisi yang sama
 * (nama penanda tangan tetap dari dokumen/pengguna).
 */
export type PrintSignatureDocType =
  | "penerimaan"
  | "pembelian"
  | "retur_pembelian"
  | "transfer"
  | "opname"
  | "payroll"
  | "jurnal"
  | "faktur";

export type PrintSignatureLabels = Partial<Record<PrintSignatureDocType, string[]>>;

/** Sanitasi override desain per dokumen dari jsonb / input pengguna. */
export function sanitizePrintDocumentOverrides(value: unknown): PrintDocumentOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PrintDocumentOverrides = {};
  for (const doc of PRINT_DOCUMENT_TYPES) {
    const raw = (value as Record<string, unknown>)[doc.key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const override: PrintDocumentOverride = {};
    if (
      row.template === "modern" ||
      row.template === "minimal" ||
      row.template === "classic" ||
      row.template === "corporate" ||
      row.template === "compact" ||
      row.template === "elegant"
    ) {
      override.template = row.template;
    }
    if (row.font === "sans" || row.font === "serif" || row.font === "mono") {
      override.font = row.font;
    }
    if (typeof row.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(row.accentColor)) {
      override.accentColor = row.accentColor;
    }
    if (
      row.receiptPaper === "thermal58" ||
      row.receiptPaper === "thermal80" ||
      row.receiptPaper === "a5" ||
      row.receiptPaper === "a4"
    ) {
      override.receiptPaper = row.receiptPaper;
    }
    if (row.documentPaper === "a4" || row.documentPaper === "a5") {
      override.documentPaper = row.documentPaper;
    }
    if (typeof row.showQr === "boolean") override.showQr = row.showQr;
    if (typeof row.showSignature === "boolean") override.showSignature = row.showSignature;
    if (typeof row.showBranding === "boolean") override.showBranding = row.showBranding;
    if (Object.keys(override).length > 0) out[doc.key] = override;
  }
  return out;
}

/** Terapkan override per dokumen di atas pengaturan global. */
export function applyPrintDocumentOverride(
  base: PrintSettings,
  overrides: PrintDocumentOverrides,
  docType: PrintDocumentType,
): PrintSettings {
  const override = overrides[docType];
  return override ? { ...base, ...override } : base;
}

export const PRINT_SIGNATURE_DOCS: {
  key: PrintSignatureDocType;
  label: string;
  defaults: string[];
}[] = [
  { key: "penerimaan", label: "Bukti penerimaan barang", defaults: ["Diserahkan oleh", "Diterima oleh", "Mengetahui"] },
  { key: "pembelian", label: "Pesanan pembelian", defaults: ["Dibuat oleh", "Disetujui oleh", "Diterima pemasok"] },
  { key: "retur_pembelian", label: "Retur pembelian", defaults: ["Diserahkan oleh", "Diterima oleh", "Mengetahui"] },
  { key: "transfer", label: "Transfer gudang", defaults: ["Pengirim (gudang asal)", "Penerima (gudang tujuan)"] },
  { key: "opname", label: "Lembar hitung opname", defaults: ["Dihitung oleh", "Diperiksa oleh"] },
  { key: "payroll", label: "Slip gaji", defaults: ["Dibuat oleh", "Diterima oleh"] },
  { key: "jurnal", label: "Jurnal", defaults: ["Dibuat oleh"] },
  { key: "faktur", label: "Faktur penjualan", defaults: ["Dibuat oleh", "Diterima oleh"] },
];

const SIGNATURE_DOC_KEYS = new Set<string>(PRINT_SIGNATURE_DOCS.map((doc) => doc.key));

/**
 * Sanitasi nilai jsonb label tanda tangan dari basis data / input:
 * hanya kunci dokumen yang dikenal, larik teks ter-trim (maks 60
 * karakter per label, jumlah tidak melebihi bawaan dokumennya);
 * entri kosong dibuang agar posisi itu jatuh ke label bawaan.
 */
export function sanitizePrintSignatureLabels(value: unknown): PrintSignatureLabels {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PrintSignatureLabels = {};
  for (const doc of PRINT_SIGNATURE_DOCS) {
    const raw = (value as Record<string, unknown>)[doc.key];
    if (!Array.isArray(raw)) continue;
    const labels = raw
      .slice(0, doc.defaults.length)
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 60) : ""));
    if (labels.some((label) => label !== "")) out[doc.key] = labels;
  }
  return out;
}

export function isPrintSignatureDocType(value: string): value is PrintSignatureDocType {
  return SIGNATURE_DOC_KEYS.has(value);
}

/**
 * Label efektif untuk satu dokumen: label pengaturan pada posisi
 * yang sama bila terisi, selain itu label bawaan dokumen (yang sama
 * dengan label tertanam sebelum UI-2).
 */
export function resolveSignatureLabels(
  settings: PrintSettings,
  doc: PrintSignatureDocType,
  defaults: string[],
): string[] {
  const custom = settings.signatureLabels[doc];
  return defaults.map((fallback, index) => {
    const label = custom?.[index]?.trim();
    return label ? label : fallback;
  });
}

/**
 * Terapkan label pengaturan pada daftar penanda tangan sebuah
 * halaman cetak: entri (label tertanam + nama dari dokumen) tidak
 * berubah selain teks labelnya diganti label pengaturan per posisi.
 */
export function applySignatureLabels<T extends { label: string }>(
  settings: PrintSettings,
  doc: PrintSignatureDocType,
  entries: T[],
): T[] {
  const labels = resolveSignatureLabels(
    settings,
    doc,
    entries.map((entry) => entry.label),
  );
  return entries.map((entry, index) => ({ ...entry, label: labels[index] ?? entry.label }));
}

export const PRINT_TEMPLATE_LABELS: Record<PrintTemplate, string> = {
  modern: "Modern",
  minimal: "Minimal",
  classic: "Klasik",
  corporate: "Corporate",
  compact: "Compact",
  elegant: "Elegan",
};

export const PRINT_FONT_LABELS: Record<PrintFontChoice, string> = {
  sans: "Sans (standar)",
  serif: "Serif",
  mono: "Monospace",
};

export const PRINT_RECEIPT_PAPER_LABELS: Record<PrintReceiptPaper, string> = {
  thermal58: "Thermal 58mm",
  thermal80: "Thermal 80mm",
  a5: "A5",
  a4: "A4",
};

export const PRINT_DOCUMENT_PAPER_LABELS: Record<PrintDocumentPaper, string> = {
  a4: "A4",
  a5: "A5",
};

const TEMPLATES: PrintTemplate[] = ["modern", "minimal", "classic", "corporate", "compact", "elegant"];
const FONTS: PrintFontChoice[] = ["sans", "serif", "mono"];
const RECEIPT_PAPERS: PrintReceiptPaper[] = ["thermal58", "thermal80", "a5", "a4"];
const DOCUMENT_PAPERS: PrintDocumentPaper[] = ["a4", "a5"];

function pick<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value != null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Map a `company_settings` row (or null) to safe print settings. */
export function toPrintSettings(
  row: {
    printTemplate?: string | null;
    printLogoUrl?: string | null;
    printAccentColor?: string | null;
    printFont?: string | null;
    printHeaderText?: string | null;
    printFooterText?: string | null;
    printShowSignature?: boolean | null;
    printShowQr?: boolean | null;
    printReceiptPaper?: string | null;
    printDocumentPaper?: string | null;
    printShowCashier?: boolean | null;
    printShowTax?: boolean | null;
    printShowCustomer?: boolean | null;
    printShowSession?: boolean | null;
    printShowBranding?: boolean | null;
    printSignatureLabels?: unknown;
    printDocumentSettings?: unknown;
  } | null
  | undefined,
  docType?: PrintDocumentType,
): PrintSettings {
  if (!row) return { ...DEFAULT_PRINT_SETTINGS };
  const base: PrintSettings = {
    template: pick(row.printTemplate, TEMPLATES, DEFAULT_PRINT_SETTINGS.template),
    logoUrl: row.printLogoUrl || null,
    accentColor:
      row.printAccentColor && /^#[0-9a-fA-F]{6}$/.test(row.printAccentColor)
        ? row.printAccentColor
        : DEFAULT_PRINT_SETTINGS.accentColor,
    font: pick(row.printFont, FONTS, DEFAULT_PRINT_SETTINGS.font),
    headerText: row.printHeaderText || null,
    footerText: row.printFooterText || null,
    showSignature: row.printShowSignature ?? DEFAULT_PRINT_SETTINGS.showSignature,
    showQr: row.printShowQr ?? DEFAULT_PRINT_SETTINGS.showQr,
    receiptPaper: pick(row.printReceiptPaper, RECEIPT_PAPERS, DEFAULT_PRINT_SETTINGS.receiptPaper),
    documentPaper: pick(row.printDocumentPaper, DOCUMENT_PAPERS, DEFAULT_PRINT_SETTINGS.documentPaper),
    showCashier: row.printShowCashier ?? DEFAULT_PRINT_SETTINGS.showCashier,
    showTax: row.printShowTax ?? DEFAULT_PRINT_SETTINGS.showTax,
    showCustomer: row.printShowCustomer ?? DEFAULT_PRINT_SETTINGS.showCustomer,
    showSession: row.printShowSession ?? DEFAULT_PRINT_SETTINGS.showSession,
    showBranding: row.printShowBranding ?? DEFAULT_PRINT_SETTINGS.showBranding,
    signatureLabels: sanitizePrintSignatureLabels(row.printSignatureLabels),
  };
  if (!docType) return base;
  return applyPrintDocumentOverride(
    base,
    sanitizePrintDocumentOverrides(row.printDocumentSettings),
    docType,
  );
}

export function printFontFamily(font: PrintFontChoice): string {
  switch (font) {
    case "serif":
      return "Georgia, 'Times New Roman', Times, serif";
    case "mono":
      return "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    default:
      return "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  }
}

export interface PaperSpec {
  /** CSS `@page` size value. */
  pageSize: string;
  /** CSS `@page` margin value. */
  pageMargin: string;
  /** On-screen/printable content width in mm enforced on the shell. */
  widthMm: number;
  /** QR block size in mm, proportional to the paper width (CT-19). */
  qrMm: number;
  /** Sheet papers get "Halaman x dari y" margin-box page numbers (CT-25). */
  paged: boolean;
}

export function paperSpec(paper: PrintPaper): PaperSpec {
  switch (paper) {
    case "thermal58":
      // Thermal rolls (CT-02, D-18): Chromium rejects `size: 58mm auto`,
      // so the static fallback is the standard 297mm roll length.
      // ReceiptPrint menimpa tinggi ini dengan tinggi hasil ukur isi
      // nota sebelum dialog cetak dibuka.
      return { pageSize: "58mm 297mm", pageMargin: "2mm", widthMm: 54, qrMm: 14, paged: false };
    case "thermal80":
      // Same as thermal58; MediaBox width 226.8pt. 80mm roll − 2×2mm
      // page margin leaves 76mm of printable content.
      return { pageSize: "80mm 297mm", pageMargin: "2mm", widthMm: 76, qrMm: 20, paged: false };
    case "a5":
      // A5 = 148 × 210mm; 10mm margins leave 128mm of content width.
      return { pageSize: "A5 portrait", pageMargin: "10mm", widthMm: 128, qrMm: 20, paged: true };
    case "a4":
    default:
      // A4 = 210 × 297mm; 12mm margins leave 186mm of content width.
      return { pageSize: "A4 portrait", pageMargin: "12mm", widthMm: 186, qrMm: 20, paged: true };
  }
}
