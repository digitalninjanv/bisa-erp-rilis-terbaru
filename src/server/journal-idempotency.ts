import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { journalEntries } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toDb, type MoneyInput } from "@/lib/money";
import {
  claimIdempotencyKey,
  paymentRequestFingerprint,
  readIdempotencyResultRef,
  writeIdempotencyResultRef,
} from "@/server/idempotency";

const SCOPE = "accounting.journal";
const RESULT_TYPE = "accounting.journal.result";

export type JournalIdempotencyInput = {
  companyId: string;
  date: string;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  reversalOfId?: string | null;
  lines: readonly {
    accountId: string;
    debit?: MoneyInput;
    credit?: MoneyInput;
    description?: string;
    partyType?: string;
    partyId?: string;
  }[];
};

export function journalRequestFingerprint(input: JournalIdempotencyInput): string {
  return paymentRequestFingerprint({
    companyId: input.companyId,
    date: input.date,
    description: input.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    reversalOfId: input.reversalOfId ?? null,
    lines: input.lines.map((line) => ({
      accountId: line.accountId,
      debit: toDb(line.debit),
      credit: toDb(line.credit),
      description: line.description ?? null,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null,
    })),
  });
}

async function findExisting(tx: Tx, companyId: string, key: string) {
  const [row] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.idempotencyKey, key),
      ),
    )
    .limit(1);
  return row;
}

async function replay(
  tx: Tx,
  companyId: string,
  key: string,
  fingerprint: string,
  existing: { id: string; number: string },
) {
  const stored = await readIdempotencyResultRef(tx, { companyId, key, scope: SCOPE });
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { type?: string; fingerprint?: string };
      if (parsed?.type === RESULT_TYPE && parsed.fingerprint !== fingerprint) {
        throw new AppError(
          "CONFLICT",
          "Kunci jurnal sudah dipakai untuk data yang berbeda. Periksa jurnal yang sudah ada sebelum mencoba lagi.",
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Hasil lama tanpa fingerprint (kompatibilitas) — replay.
    }
  }
  return existing;
}

/**
 * Replay/claim idempotensi jurnal. Mengembalikan jurnal yang sudah ada
 * bila key sama; null bila caller berhak memposting jurnal baru.
 */
export async function replayJournalIdempotency(
  tx: Tx,
  input: JournalIdempotencyInput,
  key: string,
  fingerprint: string,
): Promise<{ id: string; number: string } | null> {
  const existing = await findExisting(tx, input.companyId, key);
  if (existing) return replay(tx, input.companyId, key, fingerprint, existing);

  const claimed = await claimIdempotencyKey(tx, {
    companyId: input.companyId,
    key,
    scope: SCOPE,
  });
  if (!claimed) {
    const winner = await findExisting(tx, input.companyId, key);
    if (winner) return replay(tx, input.companyId, key, fingerprint, winner);
    throw new AppError(
      "CONFLICT",
      "Jurnal dengan kunci ini sedang diproses. Coba lagi sebentar.",
    );
  }
  return null;
}

export async function recordJournalIdempotency(
  tx: Tx,
  input: { companyId: string; key: string },
  fingerprint: string,
  entry: { id: string; number: string },
): Promise<void> {
  await writeIdempotencyResultRef(tx, {
    companyId: input.companyId,
    key: input.key,
    scope: SCOPE,
    resultRef: JSON.stringify({
      type: RESULT_TYPE,
      fingerprint,
      entryId: entry.id,
      number: entry.number,
    }),
  });
}
