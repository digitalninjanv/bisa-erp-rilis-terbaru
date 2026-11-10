// A-26 Q4 (K-03): helper bersama antar berkas aksi gudang (bukan berkas "use server").



import { getSettings } from "@/server/catalog";
import {
  applyCustomFieldValues,
  validateCustomFieldValues,
  type CustomFieldEntity,
  type CustomFieldValues,
} from "@/lib/custom-fields";

import type { Tx } from "@/db";

/**
 * T5-2 (D-16): computes the stored `attributes` for a product/party
 * save. An absent submission leaves the stored values untouched; a
 * present one is validated against the company's custom-field
 * definitions (VALIDATION naming the field label) and applied as a
 * patch over the current values, so values whose definitions were
 * removed survive as orphans instead of being deleted.
 */
export async function resolveCustomAttributes(
  tx: Tx,
  companyId: string,
  entity: CustomFieldEntity,
  current: CustomFieldValues | null | undefined,
  submitted: Record<string, string> | undefined,
): Promise<CustomFieldValues | null> {
  if (submitted === undefined) return current ?? null;
  const settings = await getSettings(tx, companyId);
  const patch = validateCustomFieldValues(settings?.customFields, entity, submitted);
  return applyCustomFieldValues(current, patch);
}

/**
 * S3: penggabungan snapshot audit — Drizzle mengabaikan nilai undefined
 * pada .set(), jadi snapshot "sesudah" hanya boleh menimpa field yang
 * benar-benar dikirim pemanggil.
 */
export function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
