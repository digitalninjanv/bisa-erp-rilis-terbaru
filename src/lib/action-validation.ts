import { z } from "zod";
import { AppError, formatZodIssues } from "@/lib/errors";
import { d, toDb, type Decimal } from "@/lib/money";

/**
 * Shared numeric validation for server actions (GD-P1-7), extracted from
 * the warehouse action files (R-8) so every action validates amounts the
 * same way. Every amount or qty field accepts string|number input but
 * must parse as a finite Decimal; the range rule decides the sign
 * constraint. The output is the canonical DB string, so domain code keeps
 * receiving plain strings/numbers as before. Messages are Indonesian and
 * name the field, instead of letting a raw Decimal/Postgres error fall
 * through to the generic server message.
 */
function parseDecimalValue(value: string | number): Decimal | null {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;
  try {
    const dec = d(raw);
    return dec.isFinite() ? dec : null;
  } catch {
    return null;
  }
}

type AmountRule = "positive" | "nonNegative" | "nonZero" | "any";

function decimalField(label: string, rule: AmountRule) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    const dec = parseDecimalValue(value);
    if (!dec) {
      ctx.addIssue({
        code: "custom",
        message: `${label} harus berupa angka yang valid.`,
      });
      return z.NEVER;
    }
    if (rule === "positive" && !dec.gt(0)) {
      ctx.addIssue({ code: "custom", message: `${label} harus lebih dari 0.` });
      return z.NEVER;
    }
    if (rule === "nonNegative" && dec.lt(0)) {
      ctx.addIssue({ code: "custom", message: `${label} tidak boleh negatif.` });
      return z.NEVER;
    }
    if (rule === "nonZero" && dec.eq(0)) {
      ctx.addIssue({ code: "custom", message: `${label} tidak boleh nol.` });
      return z.NEVER;
    }
    return toDb(dec);
  });
}

export function amountField(label: string, rule: AmountRule = "any") {
  return decimalField(label, rule);
}

/**
 * Base money variant (AK-P3-01): only checks that the value parses as a
 * finite Decimal and normalizes it to the canonical DB string. Sign/range
 * rules belong to the caller (existing action checks, or amountField's
 * rule parameter when the schema should own them).
 */
export function moneyString(label: string) {
  return decimalField(label, "any");
}

/** Optional money field: "" / undefined means "not provided" (journal lines). */
export function moneyStringOptional(label: string) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || (typeof value === "string" && value.trim() === "")) {
        return undefined;
      }
      const dec = parseDecimalValue(value);
      if (!dec) {
        ctx.addIssue({
          code: "custom",
          message: `${label} harus berupa angka yang valid.`,
        });
        return z.NEVER;
      }
      return toDb(dec);
    });
}

/**
 * Optional money field that also rejects negative values (FIX-P1 Tahap 3,
 * AK6-01): journal line amounts. The domain (postJournal) enforces the
 * same rule; this keeps the rejection at the form boundary with a
 * per-field message instead of a whole-journal failure.
 */
export function moneyStringOptionalNonNegative(label: string) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || (typeof value === "string" && value.trim() === "")) {
        return undefined;
      }
      const dec = parseDecimalValue(value);
      if (!dec) {
        ctx.addIssue({
          code: "custom",
          message: `${label} harus berupa angka yang valid.`,
        });
        return z.NEVER;
      }
      if (dec.lt(0)) {
        ctx.addIssue({
          code: "custom",
          message: `${label} tidak boleh bernilai negatif.`,
        });
        return z.NEVER;
      }
      return toDb(dec);
    });
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict calendar date (AK-P3-01): the string must be YYYY-MM-DD AND a
 * real calendar date — "2026-02-30" passes a format regex but is not a
 * date. The round-trip through Date.UTC rejects overflowed day/month
 * values. The message names the field so users know what to fix.
 */
export function isoDate(label = "Tanggal") {
  return z.string().superRefine((value, ctx) => {
    const fail = () =>
      ctx.addIssue({
        code: "custom",
        message: `${label} tidak valid. Gunakan tanggal kalender yang nyata dalam format YYYY-MM-DD.`,
      });
    if (!ISO_DATE_PATTERN.test(value)) return fail();
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return fail();
    }
    return undefined;
  });
}

export const isoDateField = isoDate("Tanggal");

/**
 * Parse with Zod but surface the first issues as an AppError VALIDATION
 * with per-field Indonesian messages (line items are prefixed with their
 * row number), instead of guard()'s generic INTERNAL for a raw ZodError.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Shared with guard()'s raw-ZodError mapping (FIX-ARS Tahap 1,
    // ARS1-03): one formatter in errors.ts so both idioms agree.
    throw new AppError("VALIDATION", formatZodIssues(result.error.issues));
  }
  return result.data;
}
