import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";

/**
 * Company-defined custom fields (T5-2, D-16) for products, suppliers,
 * and customers.
 *
 * Definitions live as jsonb on `company_settings.custom_fields`:
 * `{ product: [...], supplier: [...], customer: [...] }`, each entry
 * `{ key, label, type, options?, required? }`. Values live as jsonb on
 * the entity row's `attributes` column, keyed by the definition key and
 * always stored as normalized strings (numbers as canonical Decimal
 * strings, dates as ISO dates) so rendering never has to guess types.
 *
 * Reads sanitize leniently (a hand-edited definition can never break a
 * form); writes validate strictly and throw AppError VALIDATION naming
 * the field label, mirroring the AK-P3-01 shared-validation pattern.
 * Removing a definition never deletes stored values: orphan values are
 * preserved on the row and simply ignored at render time.
 */
export type CustomFieldEntity = "product" | "supplier" | "customer";

export type CustomFieldType = "text" | "number" | "date" | "select";

export type CustomFieldDefinition = {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  required?: boolean;
};

export type CustomFieldDefinitions = Partial<
  Record<CustomFieldEntity, CustomFieldDefinition[]>
>;

/** Stored attribute values: definition key → normalized string value. */
export type CustomFieldValues = Record<string, string>;

/** Result of validating submitted values: string = set, null = clear. */
export type CustomFieldPatch = Record<string, string | null>;

export const CUSTOM_FIELD_ENTITIES: ReadonlyArray<{
  key: CustomFieldEntity;
  label: string;
}> = [
  { key: "product", label: "Produk" },
  { key: "supplier", label: "Pemasok" },
  { key: "customer", label: "Pelanggan" },
];

export const CUSTOM_FIELD_TYPES: ReadonlyArray<{
  key: CustomFieldType;
  label: string;
}> = [
  { key: "text", label: "Teks" },
  { key: "number", label: "Angka" },
  { key: "date", label: "Tanggal" },
  { key: "select", label: "Pilihan (dropdown)" },
];

export const MAX_CUSTOM_FIELDS_PER_ENTITY = 10;
const MAX_LABEL_LENGTH = 80;
const MAX_TEXT_VALUE_LENGTH = 500;
const MAX_OPTIONS = 50;
const MAX_OPTION_LENGTH = 80;

const FIELD_TYPES: ReadonlySet<string> = new Set(["text", "number", "date", "select"]);
const ENTITY_KEYS: readonly CustomFieldEntity[] = ["product", "supplier", "customer"];

/**
 * Normalizes a raw key to a slug: lowercase, runs of non-alphanumerics
 * become a single dash. Returns null when nothing usable remains.
 */
export function normalizeCustomFieldKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : slug;
}

function sanitizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const option = item.trim().slice(0, MAX_OPTION_LENGTH);
    if (option === "" || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
    if (options.length >= MAX_OPTIONS) break;
  }
  return options;
}

function sanitizeEntry(raw: unknown): CustomFieldDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const key = normalizeCustomFieldKey(entry.key);
  if (!key) return null;
  if (typeof entry.label !== "string" || entry.label.trim() === "") return null;
  if (typeof entry.type !== "string" || !FIELD_TYPES.has(entry.type)) return null;
  const type = entry.type as CustomFieldType;
  const definition: CustomFieldDefinition = {
    key,
    label: entry.label.trim().slice(0, MAX_LABEL_LENGTH),
    type,
  };
  if (type === "select") {
    const options = sanitizeOptions(entry.options);
    if (options.length === 0) return null;
    definition.options = options;
  }
  if (entry.required === true) definition.required = true;
  return definition;
}

/**
 * Lenient read path: keeps only well-formed entries, first occurrence
 * of a key wins, capped per entity. Unknown entities are dropped.
 */
export function sanitizeCustomFieldDefinitions(value: unknown): CustomFieldDefinitions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: CustomFieldDefinitions = {};
  for (const entity of ENTITY_KEYS) {
    const rawList = source[entity];
    if (!Array.isArray(rawList)) continue;
    const seen = new Set<string>();
    const list: CustomFieldDefinition[] = [];
    for (const rawEntry of rawList) {
      const entry = sanitizeEntry(rawEntry);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      list.push(entry);
      if (list.length >= MAX_CUSTOM_FIELDS_PER_ENTITY) break;
    }
    if (list.length > 0) result[entity] = list;
  }
  return result;
}

function entityLabel(entity: CustomFieldEntity): string {
  return CUSTOM_FIELD_ENTITIES.find((row) => row.key === entity)?.label ?? entity;
}

/**
 * Strict write path for the settings editor: every problem is a
 * VALIDATION error with an Indonesian message naming the entity/key,
 * instead of silently dropping what the admin typed.
 */
export function validateCustomFieldDefinitions(input: unknown): CustomFieldDefinitions {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("VALIDATION", "Definisi kolom kustom harus berupa objek per entitas.");
  }
  const source = input as Record<string, unknown>;
  const result: CustomFieldDefinitions = {};
  for (const entity of ENTITY_KEYS) {
    const rawList = source[entity];
    if (rawList === undefined || rawList === null) continue;
    if (!Array.isArray(rawList)) {
      throw new AppError(
        "VALIDATION",
        `Daftar kolom kustom untuk ${entityLabel(entity)} harus berupa daftar.`,
      );
    }
    if (rawList.length > MAX_CUSTOM_FIELDS_PER_ENTITY) {
      throw new AppError(
        "VALIDATION",
        `${entityLabel(entity)} boleh memiliki maksimal ${MAX_CUSTOM_FIELDS_PER_ENTITY} kolom kustom.`,
      );
    }
    const seen = new Set<string>();
    const list: CustomFieldDefinition[] = [];
    for (const rawEntry of rawList) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        throw new AppError(
          "VALIDATION",
          `Ada definisi kolom kustom ${entityLabel(entity)} yang tidak berbentuk objek.`,
        );
      }
      const entry = rawEntry as Record<string, unknown>;
      const key = normalizeCustomFieldKey(entry.key);
      if (!key) {
        throw new AppError(
          "VALIDATION",
          `Kunci kolom kustom untuk ${entityLabel(entity)} tidak valid — gunakan huruf, angka, atau tanda strip.`,
        );
      }
      if (seen.has(key)) {
        throw new AppError(
          "VALIDATION",
          `Kunci kolom kustom "${key}" dipakai lebih dari sekali untuk ${entityLabel(entity)}. Kunci harus unik.`,
        );
      }
      seen.add(key);
      if (typeof entry.label !== "string" || entry.label.trim() === "") {
        throw new AppError(
          "VALIDATION",
          `Label kolom kustom "${key}" untuk ${entityLabel(entity)} wajib diisi.`,
        );
      }
      if (typeof entry.type !== "string" || !FIELD_TYPES.has(entry.type)) {
        throw new AppError(
          "VALIDATION",
          `Tipe kolom kustom "${key}" untuk ${entityLabel(entity)} tidak dikenal.`,
        );
      }
      const type = entry.type as CustomFieldType;
      const definition: CustomFieldDefinition = {
        key,
        label: entry.label.trim().slice(0, MAX_LABEL_LENGTH),
        type,
      };
      if (type === "select") {
        const options = sanitizeOptions(entry.options);
        if (options.length === 0) {
          throw new AppError(
            "VALIDATION",
            `Kolom pilihan "${definition.label}" wajib memiliki minimal satu pilihan.`,
          );
        }
        definition.options = options;
      }
      if (entry.required === true) definition.required = true;
      list.push(definition);
    }
    if (list.length > 0) result[entity] = list;
  }
  return result;
}

/** Sanitized definitions for one entity (empty list when none). */
export function customFieldDefinitionsFor(
  definitions: unknown,
  entity: CustomFieldEntity,
): CustomFieldDefinition[] {
  return sanitizeCustomFieldDefinitions(definitions)[entity] ?? [];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealISODate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validates submitted values for one entity against its definitions
 * and returns a patch: a normalized string per filled field, null per
 * cleared optional field. Unknown submitted keys are ignored (they may
 * be orphans of deleted definitions, which storage must preserve).
 * Invalid values throw VALIDATION naming the field label.
 */
export function validateCustomFieldValues(
  definitions: unknown,
  entity: CustomFieldEntity,
  values: unknown,
): CustomFieldPatch {
  const fields = customFieldDefinitionsFor(definitions, entity);
  if (fields.length === 0) return {};
  const source =
    values && typeof values === "object" && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};
  const patch: CustomFieldPatch = {};
  for (const field of fields) {
    const raw = source[field.key];
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (text === "") {
      if (field.required) {
        throw new AppError("VALIDATION", `Kolom "${field.label}" wajib diisi.`);
      }
      patch[field.key] = null;
      continue;
    }
    if (field.type === "number") {
      let parsed;
      try {
        parsed = d(text);
      } catch {
        throw new AppError(
          "VALIDATION",
          `Kolom "${field.label}" harus berupa angka yang terbaca.`,
        );
      }
      if (!parsed.isFinite()) {
        throw new AppError(
          "VALIDATION",
          `Kolom "${field.label}" harus berupa angka yang terbaca.`,
        );
      }
      patch[field.key] = toDb(parsed);
    } else if (field.type === "date") {
      if (!isRealISODate(text)) {
        throw new AppError(
          "VALIDATION",
          `Kolom "${field.label}" harus berupa tanggal nyata dalam format YYYY-MM-DD.`,
        );
      }
      patch[field.key] = text;
    } else if (field.type === "select") {
      if (!field.options?.includes(text)) {
        throw new AppError(
          "VALIDATION",
          `Kolom "${field.label}" harus salah satu dari: ${field.options?.join(", ")}.`,
        );
      }
      patch[field.key] = text;
    } else {
      patch[field.key] = text.slice(0, MAX_TEXT_VALUE_LENGTH);
    }
  }
  return patch;
}

/**
 * Applies a validated patch over stored attributes: patched keys are
 * set or removed (null), every other stored key — including orphans of
 * deleted definitions — is preserved. Returns null when nothing
 * remains, so the jsonb column stays clean.
 */
export function applyCustomFieldValues(
  existing: CustomFieldValues | null | undefined,
  patch: CustomFieldPatch,
): CustomFieldValues | null {
  const merged: CustomFieldValues = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
