/**
 * FIX-ARS Tahap 1 (ARS4-02): logger terstruktur tipis — satu baris JSON
 * per peristiwa ke console (stdout/stderr sesuai level), tanpa dependensi
 * baru. Sebelum ini seluruh `src` hanya punya dua `console.error`
 * telanjang tanpa konteks, sehingga error produksi tidak dapat dicari
 * atau dikorelasikan. Formatnya sengaja kompatibel dengan pengumpul log
 * platform apa pun (yang membaca stdout/stderr baris-per-baris).
 *
 * Konteks hanya meneruskan nilai skalar dan membuang kunci yang berbau
 * rahasia (secret/password/token/authorization/…) — log tidak boleh
 * menjadi jalur kebocoran kredensial. Error diringkas menjadi
 * name + message; stack tidak ditulis di sini (respons pengguna tetap
 * generik lewat guard(), dan stack penuh tersedia dari error boundary
 * Next bila diperlukan).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  companyId?: string;
  userId?: string;
  action?: string;
  requestId?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEY_PATTERN = /secret|password|passwd|token|authorization|cookie|api[-_]?key/i;

function sanitizeContext(context: LogContext | undefined): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (!context) return safe;
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function summarizeError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}

/** Pure formatter — exported for tests and for callers that ship their own transport. */
export function formatLogLine(
  level: LogLevel,
  event: string,
  context?: LogContext,
  error?: unknown,
): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizeContext(context),
  };
  if (error !== undefined) entry.error = summarizeError(error);
  return JSON.stringify(entry);
}

function write(level: LogLevel, event: string, context?: LogContext, error?: unknown): void {
  const line = formatLogLine(level, event, context, error);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug(event: string, context?: LogContext): void {
    write("debug", event, context);
  },
  info(event: string, context?: LogContext): void {
    write("info", event, context);
  },
  warn(event: string, context?: LogContext, error?: unknown): void {
    write("warn", event, context, error);
  },
  error(event: string, context?: LogContext, error?: unknown): void {
    write("error", event, context, error);
  },
};
