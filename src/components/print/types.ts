/**
 * Print Engine (T4-4, D-13) — shared types & pure helpers.
 *
 * Print settings live on `company_settings` (migration 0015). Templates
 * change typography and accent emphasis only; they never change the
 * document data being printed.
 */

export type PrintTemplate = "modern" | "minimal" | "classic";
export type PrintFontChoice = "sans" | "serif" | "mono";
export type PrintReceiptPaper = "thermal58" | "thermal80" | "a5" | "a4";
export type PrintDocumentPaper = "a4" | "a5";
export type PrintPaper = PrintReceiptPaper | PrintDocumentPaper;

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

const TEMPLATES: PrintTemplate[] = ["modern", "minimal", "classic"];
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
  } | null
  | undefined,
): PrintSettings {
  if (!row) return { ...DEFAULT_PRINT_SETTINGS };
  return {
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
      // so the roll is declared at the standard 297mm roll length and
      // the driver/printer cuts the continuous paper. The PDF MediaBox
      // width is the roll width (164.4pt). widthMm is the PRINTABLE
      // content width: 58mm roll − 2×2mm page margin = 54mm, so the
      // on-screen preview and the printed slip share the same width.
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
