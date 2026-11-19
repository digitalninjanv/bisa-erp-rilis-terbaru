// Satuan Kemasan S2: fase jurnal penerimaan diekstrak dari receipts.ts
// mengikuti pola receipt-void.ts (A-26 Q8) karena receipts.ts menembus
// ratchet 800 baris. Badan dipindah apa adanya dari fase
// postReceiptJournal milik createReceipt; RECEIPT_SOURCE_LABELS &
// ReceiptSource ikut berpindah ke sini sebagai rumah netralnya dan
// di-re-export receipts.ts agar jalur impor publik tidak berubah.

import type { Tx } from "@/db";
import type { Decimal } from "@/lib/money";
import { getAccountMap, postJournal } from "@/server/accounting";

export type ReceiptSource = "purchase" | "opening" | "bonus" | "customer_return" | "other";

export const RECEIPT_SOURCE_LABELS: Record<ReceiptSource, string> = {
  purchase: "Pembelian dari pemasok",
  opening: "Stok awal",
  bonus: "Bonus barang",
  customer_return: "Retur pelanggan",
  other: "Penerimaan lainnya",
};

/**
 * Jurnal penerimaan — sisi kredit ditentukan sumber dokumen
 * (utang pemasok / akun pembayaran / pendapatan bonus / retur
 * penjualan / modal), PPN Masukan sebagai kaki debit tersendiri.
 */
export async function postReceiptJournal(
  tx: Tx,
  ctx: { companyId: string; userId: string; date: string },
  receipt: { id: string; number: string },
  args: {
    source: ReceiptSource;
    supplierId: string | null;
    paymentAccountId: string | null;
    total: Decimal;
    totalNet: Decimal;
    totalTax: Decimal;
    taxInputAccountId: string | null;
    /** Porsi total yang dipotong dari uang muka pembelian. */
    advanceApplied: Decimal;
    advanceAccountId: string | null;
  },
) {
  const {
    source,
    supplierId,
    paymentAccountId,
    total,
    totalNet,
    totalTax,
    taxInputAccountId,
    advanceApplied,
    advanceAccountId,
  } = args;
  if (source === "opening" && total.lt(0)) {
    const map = await getAccountMap(tx, ctx.companyId);
    await postJournal(tx, {
      companyId: ctx.companyId,
      date: ctx.date,
      description: `Saldo awal migrasi ${receipt.number}`,
      sourceType: "receipt_opening",
      sourceId: receipt.id,
      createdBy: ctx.userId,
      lines: [
        { accountId: map.equity, debit: total.abs(), description: "Koreksi saldo awal persediaan" },
        { accountId: map.inventory, credit: total.abs(), description: "Persediaan awal berkurang" },
      ],
    });
    return;
  }
  if (total.gt(0)) {
    const map = await getAccountMap(tx, ctx.companyId);
    const supplierParty = supplierId
      ? { partyType: "supplier", partyId: supplierId }
      : {};
    let creditLine:
      | { accountId: string; description: string; partyType?: string; partyId?: string }
      | null = null;
    let journalSourceType = "purchase";
    if (source === "purchase" && paymentAccountId) {
      creditLine = { accountId: paymentAccountId, description: "Dibayar tunai saat penerimaan" };
    } else if (source === "purchase") {
      creditLine = { accountId: map.payable, description: "Utang pemasok", ...supplierParty };
    } else if (source === "bonus") {
      journalSourceType = "receipt_bonus";
      creditLine = {
        accountId: map.other_income ?? map.revenue,
        description: "Bonus barang dari pemasok",
        ...supplierParty,
      };
    } else if (source === "customer_return") {
      journalSourceType = "receipt_customer_return";
      // Barang kembali menambah persediaan dan mengembalikan HPP —
      // bukan pendapatan. Kaki pendapatan/refund milik dokumen retur
      // penjualan, bukan penerimaan stok ini.
      creditLine = { accountId: map.cogs, description: "Pengembalian HPP barang retur" };
    } else {
      journalSourceType = source === "opening" ? "receipt_opening" : "receipt_other";
      creditLine = {
        accountId: map.equity,
        description: source === "opening" ? "Modal persediaan awal" : "Penerimaan lainnya",
      };
    }
    const creditLines: {
      accountId: string;
      credit: Decimal;
      description: string;
      partyType?: string;
      partyId?: string;
    }[] = [];
    if (advanceApplied.gt(0) && advanceAccountId) {
      creditLines.push({
        accountId: advanceAccountId,
        credit: advanceApplied,
        description: "Dipotong dari uang muka pembelian",
        ...supplierParty,
      });
    }
    const remainingCredit = total.minus(advanceApplied);
    if (creditLine && remainingCredit.gt(0)) {
      creditLines.push({ ...creditLine, credit: remainingCredit });
    }
    await postJournal(tx, {
      companyId: ctx.companyId,
      date: ctx.date,
      description: `Penerimaan barang ${receipt.number} — ${RECEIPT_SOURCE_LABELS[source]}${source === "purchase" && paymentAccountId ? " (tunai)" : ""}${source === "customer_return" ? " (biaya mengikuti HPP berjalan)" : ""}${advanceApplied.gt(0) ? " · uang muka" : ""}`,
      sourceType: journalSourceType,
      sourceId: receipt.id,
      createdBy: ctx.userId,
      lines: [
        {
          accountId: map.inventory,
          debit: totalNet,
          description: totalTax.gt(0) ? "Persediaan bertambah (DPP)" : "Persediaan bertambah",
          ...supplierParty,
        },
        ...(totalTax.gt(0) && taxInputAccountId
          ? [
              {
                accountId: taxInputAccountId,
                debit: totalTax,
                description: "PPN masukan atas pembelian",
                ...supplierParty,
              },
            ]
          : []),
        ...creditLines,
      ],
    });
  }
}
