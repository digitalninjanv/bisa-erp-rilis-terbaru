// A-28 Tahap 3 (H-AKT-01): model tabel laporan SATU-SATUNYA untuk
// ekspor. Builder di export-builders.ts merakit ReportTable dari fungsi
// domain laporan yang sama dengan layar & cetak (getBalanceSheet,
// getIncomeStatement, getCashFlow, getLedger, aging) — tidak ada jalur
// hitung kedua. Dua serializer membaca model yang sama:
//   - reportTableToCsv  → byte-identik dengan CSV warisan (kolom
//     dibatasi csvWidth; sel uang ditulis moneyCsv seperti sebelumnya);
//   - reportTableToXlsx → workbook SheetJS (pustaka `xlsx` 0.20.3
//     ter-pin proyek, keputusan A-24) berisi kop perusahaan/judul/
//     periode, baris kepala kolom, indentasi hierarki, dan angka
//     sebagai SEL NUMERIK berformat #,##0 (bukan teks).
// Kolom terakhir model pada laporan berkala adalah "Selisih"
// (tahun berjalan − tahun sebelumnya): hanya tampil di XLSX karena
// csvWidth memotongnya dari CSV warisan.
//
// Batas jujur pustaka: SheetJS Community Edition tidak menulis gaya
// sel (font tebal/fill/border) maupun freeze panes ke berkas .xlsx —
// yang terbawa adalah format angka, lebar kolom, dan struktur baris.
// Penanda visual grup/total di XLSX karenanya memakai label &
// indentasi, bukan tipografi.

import * as XLSX from "xlsx";
import { moneyCsv, toCsv } from "@/lib/csv";

export type ReportCell =
  | { type: "text"; value: string }
  | { type: "money"; value: number }
  | { type: "num"; value: number }
  | { type: "empty" };

export const text = (value: string): ReportCell => ({ type: "text", value });
export const money = (value: number): ReportCell => ({ type: "money", value });
export const num = (value: number): ReportCell => ({ type: "num", value });
export const empty = (): ReportCell => ({ type: "empty" });

export type ReportRowKind = "section" | "data" | "total" | "grand" | "blank";

export type ReportRow = {
  kind: ReportRowKind;
  cells: ReportCell[];
  /** Tingkat indentasi label di XLSX (diabaikan CSV). */
  indent?: number;
  /** Kolom teks yang diindentasi di XLSX; bawaan 0. */
  indentCol?: number;
};

export type ReportTable = {
  sheetName: string;
  company: string;
  title: string;
  subtitle: string;
  /** Baris pertama persis seperti CSV warisan (argumen headers toCsv lama). */
  csvFirstRow: ReportCell[];
  /** Baris judul CSV warisan sesudah baris pertama; null bila tidak ada. */
  titleRow: ReportCell[] | null;
  /** Baris kepala kolom CSV warisan; null bila CSV lama tidak punya. */
  headerRow: ReportCell[] | null;
  /** Label kolom untuk kepala XLSX; [] = tanpa baris kepala. */
  xlsxHeaders: string[];
  /** Lebar kolom kanonis model (termasuk kolom Selisih bila ada). */
  widths: number[];
  /** Jumlah kolom yang ditulis serializer CSV (memotong Selisih). */
  csvWidth: number;
  rows: ReportRow[];
};

function cellToCsvValue(cell: ReportCell): string | number {
  switch (cell.type) {
    case "money":
      return moneyCsv(cell.value);
    case "num":
      return cell.value;
    case "text":
      return cell.value;
    case "empty":
      return "";
  }
}

/** Serialisasi CSV — harus tetap byte-identik dengan ekspor warisan. */
export function reportTableToCsv(table: ReportTable): string {
  const firstRow = table.csvFirstRow.map((cell) => {
    const value = cellToCsvValue(cell);
    return typeof value === "number" ? String(value) : value;
  });
  const body: (string | number)[][] = [];
  if (table.titleRow) body.push(table.titleRow.map(cellToCsvValue));
  if (table.headerRow) body.push(table.headerRow.map(cellToCsvValue));
  for (const row of table.rows) {
    body.push(row.cells.slice(0, table.csvWidth).map(cellToCsvValue));
  }
  return toCsv(firstRow, body);
}

const MONEY_FORMAT = "#,##0";
const NUM_FORMAT = "#,##0.##";

/** Serialisasi XLSX berformat laporan dari model yang sama dengan CSV. */
export function reportTableToXlsx(table: ReportTable): Buffer {
  const aoa: (string | number | null)[][] = [
    [table.company],
    [table.title],
    [table.subtitle],
    [],
  ];
  if (table.xlsxHeaders.length > 0) aoa.push([...table.xlsxHeaders]);

  const numericCells: Array<{ row: number; col: number; format: string }> = [];
  for (const row of table.rows) {
    const rowIndex = aoa.length;
    const indentCol = row.indentCol ?? 0;
    const values = row.cells.map((cell, col) => {
      if (cell.type === "money") {
        numericCells.push({ row: rowIndex, col, format: MONEY_FORMAT });
        return cell.value;
      }
      if (cell.type === "num") {
        numericCells.push({ row: rowIndex, col, format: NUM_FORMAT });
        return cell.value;
      }
      if (cell.type === "text") {
        return row.indent && col === indentCol
          ? `${"  ".repeat(row.indent)}${cell.value}`
          : cell.value;
      }
      return null;
    });
    aoa.push(values);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  for (const { row, col, format } of numericCells) {
    const address = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = sheet[address];
    if (cell) cell.z = format;
  }
  sheet["!cols"] = table.widths.map((wch) => ({ wch }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, table.sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

export function xlsxResponse(filename: string, table: ReportTable): Response {
  return new Response(new Uint8Array(reportTableToXlsx(table)), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
