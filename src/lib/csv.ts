/**
 * SIM-2 S6 (SEC-07): netralisasi injeksi formula spreadsheet. Sel teks
 * yang diawali `=`, `+`, `-`, atau `@` (sesudah spasi/tab di awal —
 * spreadsheet mengabaikannya) dapat dieksekusi sebagai formula saat
 * berkas hasil ekspor dibuka. Awali dengan tanda kutip tunggal agar
 * dibaca sebagai teks. Angka murni (termasuk negatif, mis. saldo
 * kredit dari moneyCsv) BUKAN formula dan dibiarkan apa adanya agar
 * tetap terparse sebagai angka oleh pembaca CSV.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function neutralizeFormula(text: string): string {
  const stripped = text.replace(/^[\s\t]+/, "");
  if (/^[=+@-]/.test(stripped) && !PLAIN_NUMBER.test(stripped)) {
    return `'${text}`;
  }
  return text;
}

/** Serialisasi satu baris CSV dengan aturan escaping yang sama dengan toCsv. */
export function csvRow(row: (string | number | null | undefined)[]): string {
  const escape = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "";
    const text = neutralizeFormula(String(value));
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return row.map(escape).join(",");
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map(csvRow).join("\r\n");
}

const CSV_RESPONSE_HEADERS = {
  "Content-Type": "text/csv; charset=utf-8",
  "Cache-Control": "no-store",
};

export function csvResponse(filename: string, content: string): Response {
  return new Response(`\uFEFF${content}`, {
    status: 200,
    headers: {
      ...CSV_RESPONSE_HEADERS,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function csvStreamResponse(filename: string, body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...CSV_RESPONSE_HEADERS,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function moneyCsv(value: unknown): string {
  const number = Number(value ?? 0);
  return number.toFixed(2);
}
