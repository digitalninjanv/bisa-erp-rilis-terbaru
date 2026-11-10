import { AppError } from "@/lib/errors";
import { Decimal } from "@/lib/money";

/**
 * Parser CSV mutasi bank — logika murni, dipindah dari
 * `src/server/bank-reconciliation.ts` (A-22 K3) supaya kontraknya bisa
 * diuji unit tanpa basis data dan supaya contoh yang ditampilkan UI
 * berasal dari sumber yang sama dengan yang diterima parser.
 *
 * Dua bentuk diterima:
 *  1. Berheader — baris pertama menyebut kolom (alias bahasa
 *     Indonesia/Inggris bank umum): Tanggal, Keterangan, dan
 *     Debit/Kredit terpisah ATAU satu kolom Nominal bertanda.
 *  2. Tanpa header (A-22 K3, UX-05) — baris pertama SUDAH baris data
 *     dengan urutan baku Tanggal;Keterangan;Debit;Kredit (atau
 *     Tanggal;Keterangan;Nominal). Deteksinya ketat: sel pertama
 *     wajib tanggal yang terbaca, keterangan tidak kosong, dan tepat
 *     satu sisi nominal terisi & terbaca — selain itu berkas ditolak
 *     sebagai format asing, sama seperti sebelumnya.
 */

export type StatementRowError = { row: number; message: string };

export type ParsedStatementRow = {
  date: string;
  description: string;
  debit: Decimal;
  credit: Decimal;
};

/**
 * Contoh kanonis yang ditampilkan panel impor (placeholder, tombol
 * "Pakai contoh", dan unduhan contoh). Test unit mengumpankan string
 * ini persis ke parser — contoh tidak boleh bisa ditolak parsernya
 * sendiri (UX-05).
 */
export const STATEMENT_CSV_EXAMPLE = [
  "Tanggal;Keterangan;Debit;Kredit",
  "03/11/2026;Setoran tunai;1.500.000;",
  "03/11/2026;Biaya admin;;6.500",
].join("\n");

export const STATEMENT_CSV_EXAMPLE_FILENAME = "contoh-mutasi.csv";

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<"date" | "description" | "debit" | "credit" | "amount", string[]> = {
  date: ["tanggal", "tgl", "date", "tanggaltransaksi", "tgltransaksi", "tanggalposting"],
  description: ["keterangan", "deskripsi", "uraian", "description", "memo", "berita", "transaksi"],
  debit: ["debit", "debet", "dr", "mutasidebit", "mutasidebet", "masuk"],
  credit: ["kredit", "credit", "cr", "mutasikredit", "keluar"],
  amount: ["nominal", "amount", "jumlah", "nilai", "mutasi", "nilaitransaksi"],
};

/**
 * Decimal-safe amount parser. Understands Indonesian formatting
 * ("1.250.000,00", "1.500") and international formatting ("1,250,000.00",
 * "1250000.50"). Mirrors the conventions of lib/import-parse.parseNumber
 * but never goes through a float.
 */
export function parseStatementAmount(raw: string | null | undefined): Decimal | null {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim();
  if (!text) return null;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/rp/gi, "").replace(/[^0-9.,-]/g, "");
  if (!text) return null;
  if (text.startsWith("-")) negative = !negative;
  text = text.replace(/-/g, "");
  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = text.split(",");
    text =
      parts.length === 2 && parts[1].length <= 2
        ? `${parts[0]}.${parts[1]}`
        : text.replace(/,/g, "");
  } else if (hasDot) {
    const parts = text.split(".");
    if (parts.length > 2) text = text.replace(/\./g, "");
    else if (parts[1]?.length === 3) text = parts.join("");
  }

  try {
    const value = new Decimal(text);
    if (!value.isFinite()) return null;
    return negative ? value.neg() : value;
  } catch {
    return null;
  }
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY (single digits allowed). */
export function parseStatementDate(raw: string): string | null {
  const text = raw.trim().split(/\s+/)[0] ?? "";
  let year: number;
  let month: number;
  let day: number;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!dmy) return null;
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type ColumnLayout = {
  dateCol: number;
  descCol: number;
  debitCol: number;
  creditCol: number;
  amountCol: number;
};

function detectDelimiter(line: string): string {
  return (line.match(/;/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? ";" : ",";
}

/**
 * Deteksi tempelan TANPA header (UX-05): baris pertama diperlakukan
 * sebagai data hanya bila bentuknya tidak ambigu — sel pertama
 * tanggal terbaca, keterangan terisi, dan tepat satu sisi nominal
 * (atau satu nominal bertanda pada susunan 3 kolom) terisi & terbaca.
 * Header asing, urutan kolom lain, dan baris debit+kredit ganda
 * mengembalikan null sehingga penolakan lama tetap berlaku.
 */
function detectHeaderlessLayout(firstLine: string): { delimiter: string; layout: ColumnLayout } | null {
  const delimiter = detectDelimiter(firstLine);
  const cells = splitCsvLine(firstLine, delimiter);
  if (cells.length < 3) return null;
  if (parseStatementDate(cells[0] ?? "") === null) return null;
  if (!(cells[1] ?? "").trim()) return null;

  if (cells.length >= 4) {
    const debitCell = (cells[2] ?? "").trim();
    const creditCell = (cells[3] ?? "").trim();
    const debitOk = debitCell !== "" && parseStatementAmount(debitCell) !== null;
    const creditOk = creditCell !== "" && parseStatementAmount(creditCell) !== null;
    if (debitOk === creditOk) return null;
    return {
      delimiter,
      layout: { dateCol: 0, descCol: 1, debitCol: 2, creditCol: 3, amountCol: -1 },
    };
  }

  const amount = parseStatementAmount(cells[2]);
  if (amount === null || amount.isZero()) return null;
  return {
    delimiter,
    layout: { dateCol: 0, descCol: 1, debitCol: -1, creditCol: -1, amountCol: 2 },
  };
}

export function parseStatementCsv(csvText: string): {
  rows: ParsedStatementRow[];
  errors: StatementRowError[];
  totalRows: number;
} {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) {
    throw new AppError("VALIDATION", "Berkas mutasi kosong — tidak ada baris yang dapat dibaca.");
  }
  const headerLine = lines[headerIndex];
  let delimiter = detectDelimiter(headerLine);
  const headers = splitCsvLine(headerLine, delimiter).map(normalizeHeader);

  const column = (kind: keyof typeof HEADER_ALIASES) =>
    headers.findIndex((header) => HEADER_ALIASES[kind].includes(header));
  let dateCol = column("date");
  let descCol = column("description");
  let debitCol = column("debit");
  let creditCol = column("credit");
  let amountCol = column("amount");
  let dataStart = headerIndex + 1;

  if (dateCol === -1 || descCol === -1 || (debitCol === -1 && creditCol === -1 && amountCol === -1)) {
    // Header tidak dikenali — beri satu kesempatan sebagai tempelan
    // tanpa header sebelum menolak (UX-05).
    const headerless = detectHeaderlessLayout(headerLine);
    if (!headerless) {
      throw new AppError(
        "VALIDATION",
        "Header CSV tidak dikenali. Format yang didukung: kolom Tanggal, Keterangan, dan Debit/Kredit (atau satu kolom Nominal). Contoh: \"Tanggal;Keterangan;Debit;Kredit\". Tempelan tanpa header juga diterima bila urutan kolomnya persis Tanggal;Keterangan;Debit;Kredit.",
      );
    }
    delimiter = headerless.delimiter;
    dateCol = headerless.layout.dateCol;
    descCol = headerless.layout.descCol;
    debitCol = headerless.layout.debitCol;
    creditCol = headerless.layout.creditCol;
    amountCol = headerless.layout.amountCol;
    dataStart = headerIndex;
  }

  const rows: ParsedStatementRow[] = [];
  const errors: StatementRowError[] = [];
  let totalRows = 0;

  for (let i = dataStart; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    const cells = splitCsvLine(rawLine, delimiter);
    if (cells.every((cell) => cell === "")) continue;
    totalRows += 1;
    const rowNo = i + 1;
    const fail = (message: string) => errors.push({ row: rowNo, message });

    const date = parseStatementDate(cells[dateCol] ?? "");
    if (!date) {
      fail(`Tanggal "${cells[dateCol] ?? ""}" tidak dapat dibaca. Gunakan format DD/MM/YYYY atau YYYY-MM-DD.`);
      continue;
    }
    const description = (cells[descCol] ?? "").trim();
    if (!description) {
      fail("Keterangan kosong.");
      continue;
    }

    let debit = new Decimal(0);
    let credit = new Decimal(0);
    if (amountCol !== -1 && debitCol === -1 && creditCol === -1) {
      const amount = parseStatementAmount(cells[amountCol]);
      if (amount === null) {
        fail(`Nominal "${cells[amountCol] ?? ""}" tidak dapat dibaca.`);
        continue;
      }
      if (amount.gt(0)) debit = amount;
      else if (amount.lt(0)) credit = amount.abs();
    } else {
      const debitValue = debitCol === -1 ? null : parseStatementAmount(cells[debitCol]);
      const creditValue = creditCol === -1 ? null : parseStatementAmount(cells[creditCol]);
      if (
        (debitCol !== -1 && (cells[debitCol] ?? "") !== "" && debitValue === null) ||
        (creditCol !== -1 && (cells[creditCol] ?? "") !== "" && creditValue === null)
      ) {
        fail("Nominal debit/kredit tidak dapat dibaca.");
        continue;
      }
      if (debitValue) {
        if (debitValue.lt(0)) credit = credit.plus(debitValue.abs());
        else debit = debitValue;
      }
      if (creditValue) {
        if (creditValue.lt(0)) debit = debit.plus(creditValue.abs());
        else credit = creditValue;
      }
    }

    if (debit.gt(0) && credit.gt(0)) {
      fail("Debit dan kredit terisi bersamaan dalam satu baris.");
      continue;
    }
    if (debit.isZero() && credit.isZero()) {
      fail("Nominal baris kosong atau nol.");
      continue;
    }
    rows.push({ date, description, debit, credit });
  }

  return { rows, errors, totalRows };
}
