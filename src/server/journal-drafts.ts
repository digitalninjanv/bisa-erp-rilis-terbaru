import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { customers, journalEntries, journalLines, suppliers } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getAccountMap, postJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";

/**
 * Validasi bersama jalur jurnal manual: tag pihak harus nyata di
 * perusahaan, akun Persediaan tidak boleh dimutasi manual, dan akun
 * kontrol Piutang/Utang wajib bertag pihak. Dipakai saat posting,
 * penyimpanan draf, dan approval.
 */
export async function assertManualJournalLines(
  tx: Tx,
  companyId: string,
  lines: Array<{
    accountId: string;
    debit?: string | null;
    credit?: string | null;
    description?: string | null;
    partyType?: string | null;
    partyId?: string | null;
  }>,
) {
  const tagged = lines.filter((line) => line.partyId && line.partyType);
  if (tagged.length > 0) {
    const customerIds = [...new Set(tagged.filter((l) => l.partyType === "customer").map((l) => l.partyId!))];
    const supplierIds = [...new Set(tagged.filter((l) => l.partyType === "supplier").map((l) => l.partyId!))];
    const found = new Set<string>();
    if (customerIds.length > 0) {
      const rows = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), inArray(customers.id, customerIds)));
      for (const row of rows) found.add(`customer:${row.id}`);
    }
    if (supplierIds.length > 0) {
      const rows = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.companyId, companyId), inArray(suppliers.id, supplierIds)));
      for (const row of rows) found.add(`supplier:${row.id}`);
    }
    for (const line of tagged) {
      if (!found.has(`${line.partyType}:${line.partyId}`)) {
        throw new AppError(
          "VALIDATION",
          `Pihak bertag pada baris jurnal (${line.partyType === "customer" ? "pelanggan" : "pemasok"}) tidak ditemukan di perusahaan ini.`,
        );
      }
    }
  }

  const map = await getAccountMap(tx, companyId);
  const invalidLine = lines.find((l) => {
    if (l.accountId === map.inventory) return true;
    if (l.accountId === map.receivable && (!l.partyType || !l.partyId)) return true;
    if (l.accountId === map.payable && (!l.partyType || !l.partyId)) return true;
    return false;
  });
  if (invalidLine) {
    throw new AppError(
      "VALIDATION",
      invalidLine.accountId === map.inventory
        ? "Akun kontrol Persediaan Barang tidak boleh dimutasi lewat jurnal umum manual. Gunakan dokumen transaksi terkait (Penerimaan Barang atau Penyesuaian Stok)."
        : "Akun kontrol Piutang Usaha dan Hutang Usaha wajib menyertakan tag pihak (pelanggan/pemasok) bila disesuaikan lewat jurnal manual agar sinkron dengan buku pembantu.",
    );
  }
}

/** Posting isi draf menjadi jurnal posted. Dipakai aksi draf dan approval. */
export async function postDraftEntry(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    entryId: string;
    approval?: {
      status: "approved";
      by: string;
      at: Date;
      note?: string | null;
    };
  },
) {
  const [draft] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, input.companyId),
        eq(journalEntries.id, input.entryId),
      ),
    )
    .limit(1)
    .for("update");
  if (!draft) throw new AppError("NOT_FOUND", "Draf jurnal tidak ditemukan.");
  if (draft.status !== "draft") {
    throw new AppError("INVALID_STATE", "Jurnal ini sudah diposting atau dibatalkan.");
  }
  const lines = await tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .where(eq(journalLines.entryId, draft.id))
    .orderBy(asc(journalLines.lineNo));
  if (lines.length < 2) {
    throw new AppError("VALIDATION", "Draf jurnal minimal memiliki dua baris.");
  }
  await assertManualJournalLines(tx, input.companyId, lines);

  const posted = await postJournal(tx, {
    companyId: input.companyId,
    date: draft.date,
    description: draft.description,
    sourceType: "manual",
    createdBy: input.userId,
    idempotencyKey: `journal-draft-post:${draft.id}`,
    approval: input.approval,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      description: line.description ?? undefined,
      partyType: (line.partyType as "customer" | "supplier" | null) ?? undefined,
      partyId: line.partyId ?? undefined,
    })),
  });

  await tx.delete(journalLines).where(eq(journalLines.entryId, draft.id));
  await tx.delete(journalEntries).where(eq(journalEntries.id, draft.id));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "journal.draft.post",
    entityType: "journal_entry",
    entityId: posted.id,
    after: { number: posted.number, fromDraft: draft.number },
  });
  return { posted, draft };
}
