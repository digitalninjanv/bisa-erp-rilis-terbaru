import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { documentSequences } from "@/db/schema";
import {
  DEFAULT_NUMBER_PADDING,
  defaultDocumentPrefix,
  sanitizeDocumentNumbering,
  type DocumentNumberingEntry,
} from "@/lib/document-numbering";

import { getCompanySettingsRow } from "@/server/settings";
// Per-type series (each type has its own counter per fiscal year):
// HOLD has its own series so deleting a held order never leaves a gap
// in the SALE invoice series (POS-HOLD-02); OPENING_PAYABLE /
// OPENING_RECEIVABLE are the opening-balance documents of T4-5b (D-14).
// The default prefixes themselves live in src/lib/document-numbering.ts
// so the settings UI and this domain share one source of truth.
export function documentPrefix(docType: string): string {
  return defaultDocumentPrefix(docType);
}

/**
 * The company's numbering override for one document type (AK-P3-07),
 * read from company_settings in the same transaction as the number
 * issuance. Stored jsonb is sanitized, so malformed values degrade to
 * the defaults instead of corrupting issued numbers. A company without
 * a settings row simply gets the defaults.
 */
async function numberingOverride(
  tx: Tx,
  companyId: string,
  docType: string,
): Promise<DocumentNumberingEntry> {
  const row = await getCompanySettingsRow(tx, companyId);
  if (!row?.documentNumbering) return {};
  return sanitizeDocumentNumbering(row.documentNumbering)[docType] ?? {};
}

export async function nextDocumentNumber(
  tx: Tx,
  companyId: string,
  docType: string,
  date: string | Date,
): Promise<string> {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  const year = d.getUTCFullYear();

  // AK-P3-07: effective prefix/padding = company override when set,
  // otherwise exactly the historical defaults. The effective prefix is
  // written back to the sequence row on every issuance, so removing an
  // override restores the default prefix for subsequent numbers while
  // the counter itself keeps counting (numbers are never reused).
  const override = await numberingOverride(tx, companyId, docType);
  const prefix = override.prefix ?? documentPrefix(docType);
  const padding = override.padding ?? DEFAULT_NUMBER_PADDING;

  const [row] = await tx
    .insert(documentSequences)
    .values({
      companyId,
      docType,
      fiscalYear: year,
      prefix,
      nextNumber: 2,
    })
    .onConflictDoUpdate({
      target: [documentSequences.companyId, documentSequences.docType, documentSequences.fiscalYear],
      set: { nextNumber: sql`${documentSequences.nextNumber} + 1`, prefix },
    })
    .returning({ nextNumber: documentSequences.nextNumber });

  const seq = row.nextNumber - 1;
  return `${prefix}-${year}-${String(seq).padStart(padding, "0")}`;
}

export async function peekSequence(
  tx: Tx,
  companyId: string,
  docType: string,
  year: number,
): Promise<number> {
  const [row] = await tx
    .select({ nextNumber: documentSequences.nextNumber })
    .from(documentSequences)
    .where(
      and(
        eq(documentSequences.companyId, companyId),
        eq(documentSequences.docType, docType),
        eq(documentSequences.fiscalYear, year),
      ),
    )
    .limit(1);
  return row?.nextNumber ?? 1;
}
