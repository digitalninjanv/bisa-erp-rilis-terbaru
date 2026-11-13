import type { PrintTemplate } from "./types";

/**
 * Registry desain template cetak. Satu sumber kebenaran untuk perilaku
 * visual yang dipakai PrintShell/PrintHeader/PrintFooter; halaman cetak
 * tidak perlu bercabang per template.
 */
export type PrintDividerStyle = "accent" | "hairline" | "double" | "dashed" | "bar" | "none";

export type PrintTemplateStyle = {
  label: string;
  divider: PrintDividerStyle;
  /** Heading memakai serif meski font body sans/mono. */
  serifHeading: boolean;
  /** Nama perusahaan/judul memakai warna aksen. */
  accentHeading: boolean;
  /** Header dokumen rata tengah (classic/elegant). */
  centeredHeader: boolean;
  /** Kerapatan tabel/teks untuk template compact. */
  dense: boolean;
  /** Kelas tambahan untuk shell. */
  shellClass: string;
};

export const PRINT_TEMPLATE_STYLES: Record<PrintTemplate, PrintTemplateStyle> = {
  modern: {
    label: "Modern",
    divider: "accent",
    serifHeading: false,
    accentHeading: true,
    centeredHeader: false,
    dense: false,
    shellClass: "print-template--modern",
  },
  minimal: {
    label: "Minimal",
    divider: "hairline",
    serifHeading: false,
    accentHeading: false,
    centeredHeader: false,
    dense: false,
    shellClass: "print-template--minimal",
  },
  classic: {
    label: "Klasik",
    divider: "double",
    serifHeading: true,
    accentHeading: false,
    centeredHeader: true,
    dense: false,
    shellClass: "print-template--classic",
  },
  corporate: {
    label: "Corporate",
    divider: "bar",
    serifHeading: false,
    accentHeading: true,
    centeredHeader: false,
    dense: false,
    shellClass: "print-template--corporate",
  },
  compact: {
    label: "Compact",
    divider: "dashed",
    serifHeading: false,
    accentHeading: false,
    centeredHeader: false,
    dense: true,
    shellClass: "print-template--compact",
  },
  elegant: {
    label: "Elegan",
    divider: "hairline",
    serifHeading: true,
    accentHeading: false,
    centeredHeader: true,
    dense: false,
    shellClass: "print-template--elegant",
  },
};
