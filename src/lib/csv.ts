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

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "";
    const text = neutralizeFormula(String(value));
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

export function csvResponse(filename: string, content: string): Response {
  return new Response(`\uFEFF${content}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function moneyCsv(value: unknown): string {
  const number = Number(value ?? 0);
  return number.toFixed(2);
}
