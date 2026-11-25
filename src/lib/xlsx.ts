import { safeDownloadFilename } from "@/lib/csv";

/**
 * Serializer XLSX bersama untuk master data dan template impor.
 *
 * Prinsip yang dijaga:
 * - kode/SKU/barcode ditulis sebagai SEL TEKS (bukan angka) agar nol di
 *   depan tidak hilang;
 * - angka uang/qty dikirim sebagai number agar bisa langsung dijumlahkan
 *   di Excel;
 * - formula dari isi sel tidak pernah dieksekusi (`cellFormula: false`);
 * - lebar kolom dihitung dari header/isi supaya berkas langsung terbaca.
 */
export type XlsxCell = string | number | null | undefined;

export type XlsxSheet = {
  name: string;
  headers: string[];
  rows: XlsxCell[][];
  /** Lebar kolom manual (character width). Bila kosong, dihitung otomatis. */
  widths?: number[];
  /** Baris tambahan di atas header (judul, periode, catatan). */
  titleRows?: XlsxCell[][];
  /** Autofilter pada baris header. Bawaan menyala bila ada data. */
  autoFilter?: boolean;
};

function displayWidth(value: XlsxCell): number {
  if (value === null || value === undefined) return 0;
  return String(value).length;
}

function sheetWidths(sheet: XlsxSheet): { wch: number }[] {
  if (sheet.widths?.length) return sheet.widths.map((wch) => ({ wch }));
  return sheet.headers.map((header, index) => {
    const content = sheet.rows.reduce(
      (max, row) => Math.max(max, displayWidth(row[index])),
      displayWidth(header),
    );
    return { wch: Math.min(60, Math.max(10, content + 2)) };
  });
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa: XlsxCell[][] = [
      ...(sheet.titleRows ?? []),
      sheet.headers,
      ...sheet.rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(
      aoa,
      // SheetJS mendukung opsi ini saat runtime meski belum ada di tipe;
      // mematikannya mencegah teks sel diperlakukan sebagai formula.
      { cellFormula: false } as import("xlsx").AOA2SheetOpts,
    );
    ws["!cols"] = sheetWidths(sheet);
    if (sheet.autoFilter !== false && sheet.rows.length > 0) {
      const headerRow = (sheet.titleRows?.length ?? 0) + 1;
      const endCol = Math.max(0, sheet.headers.length - 1);
      const endRow = headerRow + sheet.rows.length;
      ws["!autofilter"] = {
        ref: `${XLSX.utils.encode_cell({ r: headerRow - 1, c: 0 })}:${XLSX.utils.encode_cell({ r: endRow - 1, c: endCol })}`,
      };
    }
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
  }
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

export async function xlsxResponse(filename: string, sheets: XlsxSheet[]): Promise<Response> {
  const workbook = await buildXlsx(sheets);
  const safeName = safeDownloadFilename(filename, "export.xlsx");
  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Template impor: sheet "Data" (header + contoh) dan "Petunjuk"
 * (kolom wajib, arti kolom, aturan). Referensi master opsional
 * ditambahkan sebagai sheet terpisah agar pengguna menyalin nilai yang
 * memang dikenal sistem, bukan menebak ejaan.
 */
export async function buildImportTemplate(input: {
  entityLabel: string;
  headers: string[];
  exampleRows: XlsxCell[][];
  fields: { label: string; required?: boolean; aliases?: string[] }[];
  instructions: string[];
  references?: { name: string; headers: string[]; rows: XlsxCell[][] }[];
}): Promise<Buffer> {
  const dataSheet: XlsxSheet = {
    name: "Data",
    headers: input.headers,
    rows: input.exampleRows,
    autoFilter: false,
  };
  const guideSheet: XlsxSheet = {
    name: "Petunjuk",
    headers: ["Bagian", "Wajib", "Keterangan"],
    rows: [
      ["Template", "", `Impor ${input.entityLabel}`],
      ["Cara pakai", "", "Isi sheet Data mulai baris 2. Jangan mengubah nama/urutan header."],
      ["Versi template", "", "1"],
      [],
      ...input.fields.map((field) => [
        field.label,
        field.required ? "Ya" : "Tidak",
        (field.aliases ?? []).slice(0, 6).join(", "),
      ]),
      [],
      ...input.instructions.map((instruction) => ["Aturan", "", instruction]),
    ],
    widths: [28, 10, 76],
    autoFilter: false,
  };
  const referenceSheets: XlsxSheet[] = (input.references ?? []).map((reference) => ({
    name: reference.name,
    headers: reference.headers,
    rows: reference.rows,
    autoFilter: false,
  }));
  return buildXlsx([dataSheet, guideSheet, ...referenceSheets]);
}
