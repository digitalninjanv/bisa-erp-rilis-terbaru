import { and, asc, eq, inArray, gte, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, expenses, journalEntries, journalLines, sales, stockReceipts } from "@/db/schema";
import { getAccountMap } from "@/server/accounting";

/**
 * Buku PPN dari jurnal terposting. Angka diambil dari akun pemetaan
 * `tax_output` (PPN Keluaran) dan `tax_input` (PPN Masukan), sehingga
 * laporan selalu sama dengan buku besar — bukan hitungan ulang tarif.
 *
 * PPN Keluaran = kredit − debit (akun liabilitas, normal kredit).
 * PPN Masukan  = debit − kredit (akun aset, normal debit).
 * PPN Neto     = Keluaran − Masukan; positif berarti kurang bayar.
 *
 * Dasar pengenaan (DPP) per dokumen tetap berada di modul sumber
 * (POS/penerimaan/beban); laporan ini adalah buku pajak tingkat GL.
 */
export type VatReportLine = {
  id: string;
  entryId: string;
  number: string;
  date: string;
  description: string;
  sourceType: string;
  accountId: string;
  direction: "input" | "output";
  debit: number;
  credit: number;
  amount: number;
  /** Nomor dokumen sumber (POS/penerimaan/beban) bila dapat dipetakan. */
  sourceNumber: string | null;
  /** Tautan ke dokumen sumber; null untuk sumber tanpa halaman. */
  sourceHref: string | null;
  /** Dasar pengenaan pajak dari dokumen sumber; null bila tidak tersedia. */
  dpp: number | null;
};

export type VatReport = {
  mapped: boolean;
  outputAccount: { id: string; code: string; name: string } | null;
  inputAccount: { id: string; code: string; name: string } | null;
  output: number;
  input: number;
  net: number;
  lines: VatReportLine[];
  entryCount: number;
};

export async function getVatReport(
  tx: Tx,
  companyId: string,
  range: { from: string; to: string },
): Promise<VatReport> {
  const map = await getAccountMap(tx, companyId);
  const outputId = map.tax_output ?? null;
  const inputId = map.tax_input ?? null;
  const ids = [outputId, inputId].filter((id): id is string => Boolean(id));
  const accountRows =
    ids.length === 0
      ? []
      : await tx
          .select({ id: accounts.id, code: accounts.code, name: accounts.name })
          .from(accounts)
          .where(and(eq(accounts.companyId, companyId), inArray(accounts.id, ids)));
  const outputAccount = accountRows.find((row) => row.id === outputId) ?? null;
  const inputAccount = accountRows.find((row) => row.id === inputId) ?? null;

  if (ids.length === 0) {
    return {
      mapped: false,
      outputAccount,
      inputAccount,
      output: 0,
      input: 0,
      net: 0,
      lines: [],
      entryCount: 0,
    };
  }

  const rows = await tx
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      description: journalLines.description,
      entryDescription: journalEntries.description,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalEntries.status, "posted"),
        inArray(journalLines.accountId, ids),
        gte(journalEntries.date, range.from),
        lte(journalEntries.date, range.to),
      ),
    )
    .orderBy(asc(journalEntries.date), asc(journalEntries.createdAt));

  const baseSource = (sourceType: string) => sourceType.replace(/_reversal$/, "");
  const saleIds = [...new Set(rows.filter((row) => baseSource(row.sourceType) === "sale" && row.sourceId).map((row) => row.sourceId!))];
  const receiptIds = [...new Set(rows.filter((row) => ["purchase", "receipt_opening", "receipt_bonus", "receipt_customer_return", "receipt_other"].includes(baseSource(row.sourceType)) && row.sourceId).map((row) => row.sourceId!))];
  const expenseIds = [...new Set(rows.filter((row) => baseSource(row.sourceType) === "expense" && row.sourceId).map((row) => row.sourceId!))];
  const sourceById = new Map<string, { number: string; dpp: number; href: string }>();
  if (saleIds.length > 0) {
    const saleRows = await tx
      .select({
        id: sales.id,
        number: sales.number,
        subtotal: sales.subtotal,
        discountTotal: sales.discountTotal,
      })
      .from(sales)
      .where(and(eq(sales.companyId, companyId), inArray(sales.id, saleIds)));
    for (const row of saleRows) {
      sourceById.set(`sale:${row.id}`, {
        number: row.number,
        dpp: Number(row.subtotal) - Number(row.discountTotal),
        href: `/app/pos/nota/${row.id}`,
      });
    }
  }
  if (receiptIds.length > 0) {
    const receiptRows = await tx
      .select({
        id: stockReceipts.id,
        number: stockReceipts.number,
        total: stockReceipts.total,
        taxAmount: stockReceipts.taxAmount,
      })
      .from(stockReceipts)
      .where(and(eq(stockReceipts.companyId, companyId), inArray(stockReceipts.id, receiptIds)));
    for (const row of receiptRows) {
      sourceById.set(`receipt:${row.id}`, {
        number: row.number,
        dpp: Number(row.total) - Number(row.taxAmount),
        href: `/app/gudang/penerimaan/${row.id}/cetak`,
      });
    }
  }
  if (expenseIds.length > 0) {
    const expenseRows = await tx
      .select({
        id: expenses.id,
        number: expenses.number,
        amount: expenses.amount,
        taxAmount: expenses.taxAmount,
      })
      .from(expenses)
      .where(and(eq(expenses.companyId, companyId), inArray(expenses.id, expenseIds)));
    for (const row of expenseRows) {
      sourceById.set(`expense:${row.id}`, {
        number: row.number,
        dpp: Number(row.amount) - Number(row.taxAmount),
        href: "",
      });
    }
  }

  let output = 0;
  let input = 0;
  const entryIds = new Set<string>();
  const lines = rows.map((row): VatReportLine => {
    const debit = Number(row.debit);
    const credit = Number(row.credit);
    const direction = row.accountId === outputId ? "output" : "input";
    const amount = direction === "output" ? credit - debit : debit - credit;
    if (direction === "output") output += amount;
    else input += amount;
    entryIds.add(row.entryId);
    return {
      id: row.id,
      entryId: row.entryId,
      number: row.number,
      date: row.date,
      description: row.description ?? row.entryDescription,
      sourceType: row.sourceType,
      accountId: row.accountId,
      direction,
      debit,
      credit,
      amount,
      sourceNumber:
        row.sourceId && baseSource(row.sourceType) === "sale"
          ? (sourceById.get(`sale:${row.sourceId}`)?.number ?? null)
          : row.sourceId && ["purchase", "receipt_opening", "receipt_bonus", "receipt_customer_return", "receipt_other"].includes(baseSource(row.sourceType))
            ? (sourceById.get(`receipt:${row.sourceId}`)?.number ?? null)
            : row.sourceId && baseSource(row.sourceType) === "expense"
              ? (sourceById.get(`expense:${row.sourceId}`)?.number ?? null)
              : null,
      sourceHref:
        row.sourceId && baseSource(row.sourceType) === "sale"
          ? (sourceById.get(`sale:${row.sourceId}`)?.href ?? null)
          : row.sourceId && ["purchase", "receipt_opening", "receipt_bonus", "receipt_customer_return", "receipt_other"].includes(baseSource(row.sourceType))
            ? (sourceById.get(`receipt:${row.sourceId}`)?.href ?? null)
            : null,
      dpp:
        row.sourceId && baseSource(row.sourceType) === "sale"
          ? (sourceById.get(`sale:${row.sourceId}`)?.dpp ?? null)
          : row.sourceId && ["purchase", "receipt_opening", "receipt_bonus", "receipt_customer_return", "receipt_other"].includes(baseSource(row.sourceType))
            ? (sourceById.get(`receipt:${row.sourceId}`)?.dpp ?? null)
            : row.sourceId && baseSource(row.sourceType) === "expense"
              ? (sourceById.get(`expense:${row.sourceId}`)?.dpp ?? null)
              : null,
    };
  });

  return {
    mapped: true,
    outputAccount,
    inputAccount,
    output,
    input,
    net: output - input,
    lines,
    entryCount: entryIds.size,
  };
}
