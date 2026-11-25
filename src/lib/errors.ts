import { log } from "@/lib/log";

export type AppErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "PERIOD_CLOSED"
  | "INSUFFICIENT_STOCK"
  | "INVALID_STATE"
  | "ALREADY_POSTED"
  | "IDEMPOTENT_REPLAY"
  | "INTERNAL";

export class AppError extends Error {
  code: AppErrorCode;
  details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: AppErrorCode; message: string };

export function fail(code: AppErrorCode, message: string): ActionResult<never> {
  return { ok: false, code, message };
}

/**
 * AK-P3-01: a raw Postgres unique violation (23505) reaching guard() used
 * to surface as the generic "Terjadi kesalahan pada server" even though
 * the user-facing cause is mundane — the code/number is already taken.
 * Walk the error chain (drizzle wraps driver errors as `cause`) looking
 * for the SQLSTATE, recover the constraint name when available, and map
 * known constraints to the entity they protect.
 */
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  accounts_company_code_uq: "Kode akun tersebut sudah digunakan. Gunakan kode akun yang lain.",
  employees_company_code_uq: "Kode karyawan tersebut sudah digunakan. Gunakan kode karyawan yang lain.",
  products_company_sku_uq: "SKU produk tersebut sudah digunakan. Gunakan SKU yang lain.",
  products_company_barcode_uq: "Barcode produk tersebut sudah digunakan. Gunakan barcode yang lain.",
  suppliers_company_code_uq: "Kode pemasok tersebut sudah digunakan. Gunakan kode pemasok yang lain.",
  customers_company_code_uq: "Kode pelanggan tersebut sudah digunakan. Gunakan kode pelanggan yang lain.",
  warehouses_company_code_uq: "Kode gudang tersebut sudah digunakan. Gunakan kode gudang yang lain.",
  branches_company_code_uq: "Kode cabang tersebut sudah digunakan. Gunakan kode cabang yang lain.",
  units_company_code_uq: "Kode satuan tersebut sudah digunakan. Gunakan kode satuan yang lain.",
  payment_methods_company_code_uq:
    "Kode metode pembayaran tersebut sudah digunakan. Gunakan kode yang lain.",
  categories_company_name_uq: "Nama kategori tersebut sudah digunakan. Gunakan nama yang lain.",
  customer_groups_company_name_uq:
    "Nama kelompok harga tersebut sudah digunakan. Gunakan nama yang lain.",
  payroll_runs_company_period_uq: "Payroll periode tersebut sudah pernah diproses.",
  // T5R-4: a double-submit race that slips past postJournal's replay
  // pre-check in two concurrent transactions lands here. The first
  // journal DID post — this is not a taken code/number, so the message
  // must point at reloading the journal list instead.
  journal_entries_company_idem_uq:
    "Pengiriman ganda terdeteksi untuk jurnal ini. Muat ulang daftar jurnal untuk melihat hasilnya.",
  member_org_user_uq: "Pengguna tersebut sudah terdaftar sebagai anggota perusahaan ini.",
};

const UNIQUE_CONSTRAINT_PATTERN = /violates unique constraint "([^"]+)"/;

function findUniqueViolation(error: unknown): { constraint: string | null } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== null && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "23505") {
      if (typeof candidate.constraint === "string" && candidate.constraint) {
        return { constraint: candidate.constraint };
      }
      if (typeof candidate.message === "string") {
        const match = UNIQUE_CONSTRAINT_PATTERN.exec(candidate.message);
        if (match) return { constraint: match[1] };
      }
      return { constraint: null };
    }
    current = candidate.cause;
  }
  return null;
}

/** True when the error chain carries a 23505, optionally for one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const violation = findUniqueViolation(error);
  if (!violation) return false;
  return constraint === undefined || violation.constraint === constraint;
}

/** Indonesian duplicate-data message for a 23505 error, or null when the error is not one. */
export function uniqueViolationMessage(error: unknown): string | null {
  const violation = findUniqueViolation(error);
  if (!violation) return null;
  if (violation.constraint && UNIQUE_CONSTRAINT_MESSAGES[violation.constraint]) {
    return UNIQUE_CONSTRAINT_MESSAGES[violation.constraint];
  }
  return "Kode/nomor tersebut sudah digunakan. Periksa kembali data yang dimasukkan.";
}

/**
 * FIX-ARS Tahap 1 (ARS1-03): a raw `ZodError` reaching guard() used to
 * fall through to the generic INTERNAL message, even though ~62 action
 * call sites still validate with `.parse()` directly instead of
 * `parseInput` — plain user input mistakes looked like server failures
 * (the A-13 bug class). Detection is structural (name + `issues` array)
 * rather than `instanceof` so this module stays free of a zod import:
 * errors.ts is the bottom of the error-handling stack and is imported
 * by action-validation.ts, not the other way around.
 */
export interface ZodIssueLike {
  path: readonly PropertyKey[];
  message: string;
}

interface ZodErrorLike {
  name: "ZodError";
  issues: readonly ZodIssueLike[];
}

function asZodErrorLike(error: unknown): ZodErrorLike | null {
  if (error === null || typeof error !== "object") return null;
  const candidate = error as { name?: unknown; issues?: unknown };
  if (candidate.name !== "ZodError" || !Array.isArray(candidate.issues)) return null;
  const issues = candidate.issues as ZodIssueLike[];
  if (!issues.every((issue) => typeof issue?.message === "string" && Array.isArray(issue?.path))) {
    return null;
  }
  return { name: "ZodError", issues };
}

/**
 * The one shared formatter for Zod issues -> a single Indonesian
 * sentence (line items get their row number). Used by `parseInput`
 * (action-validation.ts) for schemas it parses itself and by `guard()`
 * below for ZodErrors thrown by raw `.parse()` call sites, so both
 * validation idioms produce identical messages.
 */
export function formatZodIssues(issues: readonly ZodIssueLike[]): string {
  const messages = issues.map((issue) => {
    const [head, index] = issue.path;
    return head === "lines" && typeof index === "number"
      ? `Baris ${index + 1}: ${issue.message}`
      : issue.message;
  });
  return [...new Set(messages)].join(" ");
}

/** Indonesian validation message for a thrown ZodError, or null when the error is not one. */
export function zodValidationMessage(error: unknown): string | null {
  const zodError = asZodErrorLike(error);
  if (!zodError) return null;
  return formatZodIssues(zodError.issues);
}

export function isNextControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))
  );
}

export function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => {
      // redirect()/notFound() are control flow, not application errors.
      // Without this, an expired session action returns INTERNAL instead
      // of navigating the user to /login.
      if (isNextControlFlowError(error)) throw error;
      if (error instanceof AppError) {
        return { ok: false as const, code: error.code, message: error.message };
      }
      const uniqueMessage = uniqueViolationMessage(error);
      if (uniqueMessage) {
        return { ok: false as const, code: "CONFLICT" as const, message: uniqueMessage };
      }
      const validationMessage = zodValidationMessage(error);
      if (validationMessage) {
        return { ok: false as const, code: "VALIDATION" as const, message: validationMessage };
      }
      // ARS4-02: unexpected errors go through the structured logger
      // (one JSON line) instead of a bare console.error; the user still
      // only ever sees the generic INTERNAL message.
      log.error("server_action.unhandled_error", undefined, error);
      return {
        ok: false as const,
        code: "INTERNAL" as const,
        message: "Terjadi kesalahan pada server. Coba lagi.",
      };
    });
}
