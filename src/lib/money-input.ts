import { d, toDb } from "./money";

/**
 * AK-P3-05(b) — parsing & formatting for id-ID money text inputs.
 *
 * Users type amounts the Indonesian way: thousand separator ".", decimal
 * separator "," ("1.500.000,50"). Plain digits and a plain decimal dot
 * ("1500.5") are also accepted so pasted values keep working. Anything
 * unreadable returns an Indonesian error message instead of NaN.
 *
 * The canonical value handed to forms is the repo's database string:
 * Decimal with exactly 4 fraction digits (see `toDb` in lib/money).
 */

export type MoneyParseResult = { ok: true; value: string } | { ok: false; error: string };

const ERROR_MESSAGE = "Nominal tidak terbaca. Gunakan format seperti 1.500.000 atau 1500,50.";

function fail(): MoneyParseResult {
  return { ok: false, error: ERROR_MESSAGE };
}

export function parseMoneyText(raw: string): MoneyParseResult {
  if (raw.trim() === "") return { ok: true, value: "" };
  const text = raw.trim().replace(/^Rp\.?\s*/i, "").replace(/\s+/g, "");
  if (text === "") {
    // Non-empty input without a single digit (e.g. just "Rp") is unreadable,
    // not "empty".
    return /\d/.test(raw) ? { ok: true, value: "" } : fail();
  }
  if (!/^[\d.,]+$/.test(text)) return fail();

  let intPart: string;
  let fracPart = "";

  if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length !== 2) return fail();
    [intPart, fracPart] = parts;
    if (fracPart.length < 1 || fracPart.length > 4 || !/^\d+$/.test(fracPart)) return fail();
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // Pure thousand grouping, e.g. "1.500.000" or "12.345".
    intPart = text;
  } else if (/^\d+\.\d{1,4}$/.test(text)) {
    // Plain decimal dot, e.g. "1500.5".
    [intPart, fracPart] = text.split(".");
  } else if (/^\d+$/.test(text)) {
    intPart = text;
  } else {
    return fail();
  }

  if (intPart.includes(".")) {
    const groups = intPart.split(".");
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return fail();
    intPart = groups.join("");
  }
  if (!/^\d+$/.test(intPart)) return fail();

  const decimal = d(fracPart ? `${intPart}.${fracPart}` : intPart);
  if (!decimal.isFinite()) return fail();
  return { ok: true, value: toDb(decimal) };
}

/** Canonical Decimal string → id-ID display text ("1500000.5000" → "1.500.000,5"). */
export function formatMoneyText(canonical: string): string {
  if (!canonical) return "";
  const value = d(canonical);
  if (!value.isFinite()) return "";
  const [intRaw, fracRaw = ""] = value.toFixed(4).split(".");
  const negative = intRaw.startsWith("-");
  const intDigits = negative ? intRaw.slice(1) : intRaw;
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = fracRaw.replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Display text while the user is typing (A-23 SIS-01): thousand
 * separators appear live, a trailing comma or fraction digits are
 * preserved as typed. While typing, "." is ONLY a thousand separator
 * being formed — it is never reinterpreted as a decimal point. The old
 * decimal-dot branch turned the in-progress text "1.5000" (group
 * "1.500" + one more typed "0") into "1,5000", which parseMoneyText
 * then read as 1.5: typing 1500000 digit by digit corrupted the value
 * in every MoneyInput form. The comma is the only decimal path while
 * typing; a plain decimal dot keeps its meaning only for pasted text,
 * which is parsed by parseMoneyText (see applyMoneyEdit).
 */
export function regroupMoneyText(raw: string): string {
  const text = raw.trim().replace(/^Rp\.?\s*/i, "");
  const [intRaw, fracRaw] = text.split(",");
  const intDigits = (intRaw ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (fracRaw !== undefined) {
    return `${groupThousands(intDigits)},${fracRaw.replace(/\D/g, "").slice(0, 4)}`;
  }
  return groupThousands(intDigits);
}

/**
 * Parse under the TYPING contract (A-23 SIS-01): dots in the integer
 * part are thousand separators being formed and are simply dropped, so
 * the value of every intermediate state equals the digit prefix typed
 * so far ("1.5000" → 15000, never 1.5). The comma is the only decimal
 * separator. Deliberately separate from parseMoneyText, whose
 * paste/commit contract (plain decimal dot "1500.5" = 1500.5) must not
 * change.
 */
export function parseTypedMoneyText(raw: string): MoneyParseResult {
  if (raw.trim() === "") return { ok: true, value: "" };
  const text = raw.trim().replace(/^Rp\.?\s*/i, "").replace(/\s+/g, "");
  if (text === "") {
    return /\d/.test(raw) ? { ok: true, value: "" } : fail();
  }
  if (!/^[\d.,]+$/.test(text)) return fail();

  const parts = text.split(",");
  if (parts.length > 2) return fail();
  const intDigits = parts[0].replace(/\./g, "");
  const fracPart = parts[1];
  if (fracPart !== undefined && (fracPart.length < 1 || fracPart.length > 4 || !/^\d+$/.test(fracPart))) {
    return fail();
  }
  if (!/^\d+$/.test(intDigits)) return fail();

  const decimal = d(fracPart ? `${intDigits}.${fracPart}` : intDigits);
  if (!decimal.isFinite()) return fail();
  return { ok: true, value: toDb(decimal) };
}

/**
 * True when `nextText` can be reached from `prevText` by typing:
 * inserting, deleting, or replacing at most one character — including
 * replacing a whole selection with a single typed character. Anything
 * longer arriving in one change event is a paste/autofill, which keeps
 * the parseMoneyText contract instead of the typing contract.
 */
export function isIncrementalMoneyEdit(prevText: string, nextText: string): boolean {
  if (prevText === nextText) return true;
  if (nextText === "") return true;
  const diff = nextText.length - prevText.length;
  if (diff === 0) {
    let changed = 0;
    for (let i = 0; i < prevText.length; i++) {
      if (prevText[i] !== nextText[i]) changed++;
    }
    return changed <= 1;
  }
  if (Math.abs(diff) === 1) {
    const [longer, shorter] = diff > 0 ? [nextText, prevText] : [prevText, nextText];
    let i = 0;
    while (i < shorter.length && longer[i] === shorter[i]) i++;
    return longer.slice(i + 1) === shorter.slice(i);
  }
  return nextText.length <= 1;
}

export type MoneyEditOutcome =
  | { kind: "value"; text: string; value: string }
  | { kind: "pending"; text: string }
  | { kind: "error"; text: string; error: string };

function isPlausibleMoneyPrefix(raw: string): boolean {
  const commaCount = (raw.match(/,/g) ?? []).length;
  return /^[\d.,\s]*$/.test(raw) && commaCount <= 1;
}

/**
 * One change event of a MoneyInput, decided in exactly one place so the
 * component and the keystroke-simulation tests share the same logic.
 *
 * Typing path (default): parseTypedMoneyText + regroupMoneyText — the
 * canonical value of every intermediate state is the digit prefix
 * typed. Paste path (`pasted: true`): parseMoneyText decides, so a
 * pasted "1500.5" still means 1500.5, and the display is formatted
 * straight from the accepted canonical value. A plausible but
 * incomplete prefix ("1.500,") stays "pending": no emit, no error —
 * blur settles it.
 */
export function applyMoneyEdit(
  prevText: string,
  raw: string,
  opts?: { pasted?: boolean },
): MoneyEditOutcome {
  if (opts?.pasted) {
    const parsed = parseMoneyText(raw);
    if (parsed.ok) {
      return { kind: "value", text: formatMoneyText(parsed.value), value: parsed.value };
    }
    if (isPlausibleMoneyPrefix(raw)) return { kind: "pending", text: raw };
    return { kind: "error", text: raw, error: parsed.error };
  }
  const parsed = parseTypedMoneyText(raw);
  if (parsed.ok) {
    return { kind: "value", text: regroupMoneyText(raw), value: parsed.value };
  }
  if (isPlausibleMoneyPrefix(raw)) return { kind: "pending", text: regroupMoneyText(raw) };
  return { kind: "error", text: raw, error: parsed.error };
}
