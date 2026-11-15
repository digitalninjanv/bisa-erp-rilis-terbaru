import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { reverseSourceJournal } from "@/server/accounting";

/**
 * AKN-004: balik jurnal pada tanggal dokumen asal bila periodenya masih
 * terbuka. Membalik di bulan berjalan membuat pendapatan/beban bulan itu
 * negatif dan P&L bulanan tidak rekonsiliasi. Bila periode asal sudah
 * ditutup, pembalik jatuh ke hari ini (satu-satunya periode yang pasti
 * dapat menerima jurnal) dan deskripsinya menandai alasan itu.
 *
 * Dipisah dari server/accounting.ts agar helper lintas modul ini tidak
 * menembus plafon ratchet ukuran berkas.
 */
export async function reverseSourceJournalPreferringDate(
  tx: Tx,
  input: {
    companyId: string;
    sourceType: string;
    sourceId: string;
    originalDate: string;
    description: string;
    createdBy?: string | null;
  },
): Promise<{ id: string; number: string } | null> {
  try {
    return await reverseSourceJournal(tx, {
      companyId: input.companyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      date: input.originalDate,
      description: input.description,
      createdBy: input.createdBy,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "PERIOD_CLOSED") {
      return reverseSourceJournal(tx, {
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        date: todayISO(),
        description: `${input.description} (periode asal tertutup)`,
        createdBy: input.createdBy,
      });
    }
    throw error;
  }
}
