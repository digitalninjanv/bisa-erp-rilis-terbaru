// A-26 Q8 (K-10): pecahan src/server/bank-reconciliation.ts per
// concern (akun / baris buku / mutasi / pencocokan / baca). Perilaku
// tidak berubah; jalur impor publik tetap lewat
// src/server/bank-reconciliation.ts (barrel).

import { and, asc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, bankStatementLines, journalEntries, journalLines } from "@/db/schema";
import { postJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { AppError } from "@/lib/errors";
import { Decimal, d, toDb, type MoneyInput } from "@/lib/money";
import { requireReconciliationAccount } from "./accounts";
import { claimedJournalLineIds, loadBookLines } from "./book-lines";

function amountsAlign(
  statement: { debit: string; credit: string },
  book: { debit: string; credit: string },
): boolean {
  const sDebit = d(statement.debit);
  const sCredit = d(statement.credit);
  const bDebit = d(book.debit);
  const bCredit = d(book.credit);
  if (sDebit.gt(0)) return bDebit.eq(sDebit) && bCredit.isZero();
  if (sCredit.gt(0)) return bCredit.eq(sCredit) && bDebit.isZero();
  return false;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */

/* ------------------------------------------------------------------ */

export async function autoMatch(
  tx: Tx,
  input: { companyId: string; accountId: string },
): Promise<{ matchedCount: number; ambiguousCount: number; unmatchedCount: number }> {
  await requireReconciliationAccount(tx, input.companyId, input.accountId);
  const statements = await tx
    .select()
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.companyId, input.companyId),
        eq(bankStatementLines.accountId, input.accountId),
        isNull(bankStatementLines.matchedJournalLineId),
      ),
    )
    .orderBy(asc(bankStatementLines.date), asc(bankStatementLines.id))
    // T4R-4: lock the candidate rows for the whole run so a concurrent
    // manual matchLine on any of them waits instead of double-claiming.
    .for("update");
  const bookLines = await loadBookLines(tx, input.companyId, input.accountId);
  const claimed = await claimedJournalLineIds(tx, input.companyId, input.accountId);

  const amountKey = (line: { debit: string; credit: string }) =>
    `${d(line.debit).toFixed(4)}|${d(line.credit).toFixed(4)}`;
  const bookByAmount = new Map<string, typeof bookLines>();
  for (const book of bookLines) {
    const key = amountKey(book);
    const bucket = bookByAmount.get(key) ?? [];
    bucket.push(book);
    bookByAmount.set(key, bucket);
  }

  let matchedCount = 0;
  let ambiguousCount = 0;
  let unmatchedCount = 0;

  for (const statement of statements) {
    const statementTime = Date.parse(statement.date);
    const candidates = (bookByAmount.get(amountKey(statement)) ?? []).filter((book) => {
      if (claimed.has(book.id)) return false;
      if (!amountsAlign(statement, book)) return false;
      const diffDays = Math.abs(Date.parse(book.date) - statementTime) / 86_400_000;
      return diffDays <= 3;
    });
    if (candidates.length === 1) {
      // T4R-4: claim with the still-unlinked predicate; a row that comes
      // back empty means the link changed under us — do not count it.
      const claimedRows = await tx
        .update(bankStatementLines)
        .set({ matchedJournalLineId: candidates[0].id })
        .where(
          and(eq(bankStatementLines.id, statement.id), isNull(bankStatementLines.matchedJournalLineId)),
        )
        .returning({ id: bankStatementLines.id });
      if (claimedRows.length === 0) {
        unmatchedCount += 1;
        continue;
      }
      claimed.add(candidates[0].id);
      matchedCount += 1;
    } else if (candidates.length > 1) {
      ambiguousCount += 1;
    } else {
      unmatchedCount += 1;
    }
  }

  return { matchedCount, ambiguousCount, unmatchedCount };
}

async function loadStatementLine(tx: Tx, companyId: string, statementLineId: string) {
  // T4R-4: every caller is a write path (match/unmatch/create journal).
  // Locking the statement row serializes concurrent link attempts on the
  // same row: the second caller re-reads the row after the first commits
  // and sees the link that was just written.
  const [row] = await tx
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.companyId, companyId), eq(bankStatementLines.id, statementLineId)))
    .limit(1)
    .for("update");
  if (!row) throw new AppError("NOT_FOUND", "Baris mutasi tidak ditemukan.");
  return row;
}

/** True when the error chain carries the partial-unique-index violation
 *  on matched_journal_line_id (PostgreSQL 23505) — i.e. a concurrent
 *  transaction claimed the same journal line first (T4R-4). */
function isMatchedLineClaimViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (
      candidate.code === "23505" &&
      (typeof candidate.constraint !== "string" ||
        candidate.constraint.includes("matched_journal_line"))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function matchLine(
  tx: Tx,
  input: { companyId: string; statementLineId: string; journalLineId: string },
): Promise<void> {
  const statement = await loadStatementLine(tx, input.companyId, input.statementLineId);
  if (statement.matchedJournalLineId) {
    throw new AppError("CONFLICT", "Baris mutasi ini sudah tertaut ke baris jurnal lain. Lepas tautan dulu.");
  }
  const [book] = await tx
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      status: journalEntries.status,
      reversalOfId: journalEntries.reversalOfId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, input.companyId), eq(journalLines.id, input.journalLineId)))
    .limit(1);
  if (!book) throw new AppError("NOT_FOUND", "Baris jurnal tidak ditemukan.");
  if (book.accountId !== statement.accountId) {
    throw new AppError("VALIDATION", "Baris jurnal bukan berasal dari akun bank yang sama dengan baris mutasi.");
  }
  if (book.status !== "posted") {
    throw new AppError("VALIDATION", "Hanya baris jurnal yang sudah terposting yang dapat ditautkan.");
  }
  // T4M-01: same "live" predicate as auto-match/listBookLines — a reversal
  // line or an already-reversed entry must never be linked, otherwise the
  // reconciled balance would include journals whose net effect is zero.
  if (book.reversalOfId) {
    throw new AppError("VALIDATION", "Baris jurnal balik tidak dapat ditautkan ke mutasi.");
  }
  const [postedReversal] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.reversalOfId, book.entryId), eq(journalEntries.status, "posted")))
    .limit(1);
  if (postedReversal) {
    throw new AppError("VALIDATION", "Jurnal ini sudah dibalik sehingga tidak dapat ditautkan ke mutasi.");
  }
  const claimed = await claimedJournalLineIds(tx, input.companyId, statement.accountId);
  if (claimed.has(book.id)) {
    throw new AppError("CONFLICT", "Baris jurnal ini sudah tertaut ke baris mutasi lain.");
  }
  if (!amountsAlign(statement, book)) {
    throw new AppError(
      "VALIDATION",
      "Nominal baris mutasi dan baris jurnal tidak sama persis. Selisih harus diselesaikan lewat jurnal penyesuaian terpisah, bukan dengan memaksakan tautan.",
    );
  }
  // T4R-4: claim atomically — the UPDATE only lands while the row is
  // still unlinked, and the partial unique index on
  // matched_journal_line_id is the backstop when two different statement
  // rows race for the same journal line.
  let updated: { id: string }[] = [];
  try {
    updated = await tx
      .update(bankStatementLines)
      .set({ matchedJournalLineId: book.id })
      .where(and(eq(bankStatementLines.id, statement.id), isNull(bankStatementLines.matchedJournalLineId)))
      .returning({ id: bankStatementLines.id });
  } catch (error) {
    if (isMatchedLineClaimViolation(error)) {
      throw new AppError("CONFLICT", "Baris jurnal ini sudah tertaut ke baris mutasi lain.");
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("CONFLICT", "Baris mutasi ini sudah tertaut ke baris jurnal lain. Lepas tautan dulu.");
  }
}

export async function unmatchLine(
  tx: Tx,
  input: { companyId: string; statementLineId: string },
): Promise<void> {
  const statement = await loadStatementLine(tx, input.companyId, input.statementLineId);
  if (!statement.matchedJournalLineId) {
    throw new AppError("VALIDATION", "Baris mutasi ini belum tertaut.");
  }
  await tx
    .update(bankStatementLines)
    .set({ matchedJournalLineId: null })
    .where(eq(bankStatementLines.id, statement.id));
}

/* ------------------------------------------------------------------ */
/* Create journal from an unmatched statement line                     */

/* ------------------------------------------------------------------ */

export async function createJournalFromLine(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    statementLineId: string;
    contraAccountId: string;
    /** A-21 (R3-12): baris lawan kedua opsional — potongan yang
     * dipotong bank dari mutasi neto (kasus bulanan paling umum:
     * bunga bruto dikurangi PPh final). Baris potongan duduk di sisi
     * yang SAMA dengan baris bank sebesar nominalnya, dan akun lawan
     * utama dicatat BRUTO (neto mutasi + potongan), sehingga baris
     * bank tetap persis sebesar mutasi dan tautan rekonsiliasi sah,
     * sementara sisi lawan neto tetap sama dengan mutasi. */
    secondContra?: { accountId: string; amount: MoneyInput };
    date?: string;
    description?: string;
  },
): Promise<{ id: string; number: string }> {
  const statement = await loadStatementLine(tx, input.companyId, input.statementLineId);
  if (statement.matchedJournalLineId) {
    throw new AppError("CONFLICT", "Baris mutasi ini sudah tertaut. Lepas tautan dulu sebelum membuat jurnal baru.");
  }
  await requireReconciliationAccount(tx, input.companyId, statement.accountId);

  const loadContra = async (accountId: string, label: string) => {
    const [contra] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, accountId)))
      .limit(1);
    if (!contra) throw new AppError("NOT_FOUND", `${label} tidak ditemukan di perusahaan ini.`);
    if (contra.id === statement.accountId) {
      throw new AppError("VALIDATION", `${label} harus berbeda dari akun bank itu sendiri.`);
    }
    if (!contra.isPostable || !contra.isActive) {
      throw new AppError("VALIDATION", `Akun ${contra.code} ${contra.name} tidak dapat dipakai untuk posting.`);
    }
    return contra;
  };
  const contra = await loadContra(input.contraAccountId, "Akun lawan");

  let second: { id: string; amount: Decimal } | null = null;
  if (input.secondContra) {
    const secondAmount = d(input.secondContra.amount);
    if (!secondAmount.isFinite() || secondAmount.lte(0)) {
      throw new AppError("VALIDATION", "Nominal baris lawan kedua (potongan) harus lebih dari nol.");
    }
    if (input.secondContra.accountId === input.contraAccountId) {
      throw new AppError("VALIDATION", "Akun lawan kedua harus berbeda dari akun lawan utama.");
    }
    const secondAccount = await loadContra(input.secondContra.accountId, "Akun lawan kedua");
    second = { id: secondAccount.id, amount: secondAmount };
  }

  const isDebit = d(statement.debit).gt(0);
  const amount = isDebit ? d(statement.debit) : d(statement.credit);
  // Tanpa baris kedua, grossAmount == amount dan bentuk jurnal
  // persis seperti sebelum R3-12 (2 baris).
  const grossAmount = second ? amount.plus(second.amount) : amount;
  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date ?? statement.date,
    description: input.description?.trim() || statement.description,
    sourceType: "bank_statement",
    sourceId: statement.id,
    createdBy: input.userId,
    lines: isDebit
      ? [
          { accountId: statement.accountId, debit: amount, description: statement.description },
          ...(second
            ? [{ accountId: second.id, debit: second.amount, description: statement.description }]
            : []),
          { accountId: contra.id, credit: grossAmount, description: statement.description },
        ]
      : [
          { accountId: contra.id, debit: grossAmount, description: statement.description },
          ...(second
            ? [{ accountId: second.id, credit: second.amount, description: statement.description }]
            : []),
          { accountId: statement.accountId, credit: amount, description: statement.description },
        ],
  });

  const [bankLeg] = await tx
    .select({ id: journalLines.id })
    .from(journalLines)
    .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.accountId, statement.accountId)))
    .limit(1);
  if (!bankLeg) throw new AppError("INTERNAL", "Baris jurnal akun bank tidak ditemukan setelah posting.");

  await tx
    .update(bankStatementLines)
    .set({ matchedJournalLineId: bankLeg.id })
    .where(eq(bankStatementLines.id, statement.id));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "bank_reconciliation.journal_created",
    entityType: "bank_statement_line",
    entityId: statement.id,
    after: {
      journalId: entry.id,
      journalNumber: entry.number,
      contraAccountId: contra.id,
      ...(second
        ? { secondContraAccountId: second.id, secondContraAmount: toDb(second.amount) }
        : {}),
    },
  });

  return entry;
}

/* ------------------------------------------------------------------ */
/* Summary & lists                                                     */
