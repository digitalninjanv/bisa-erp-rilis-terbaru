// Uang muka pada penerimaan barang: validasi porsi yang dipakai,
// pemetaan akun, dan alokasi FIFO. Dipisah dari receipts.ts agar
// berkas domain tetap di bawah ratchet ukuran.

import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { d, type Decimal, type MoneyInput } from "@/lib/money";
import { getAccountId } from "@/server/accounting";
import {
  applyPurchaseAdvancesFIFO,
  type PurchaseAdvanceAllocationPlan,
} from "@/server/purchase-advances";
import type { ReceiptSource } from "./receipt-journal";

export type ReceiptAdvancePlan = {
  applied: Decimal;
  allocations: PurchaseAdvanceAllocationPlan[];
  accountId: string | null;
};

/** Validasi + rencana potong uang muka; tidak menulis dokumen penerimaan. */
export async function prepareReceiptAdvance(
  tx: Tx,
  input: {
    companyId: string;
    source: ReceiptSource;
    supplierId: string | null;
    invoiceTotal: Decimal;
    requested: MoneyInput;
  },
): Promise<ReceiptAdvancePlan> {
  const requested = d(input.requested ?? 0);
  if (!requested.isFinite() || requested.lt(0)) {
    throw new AppError("VALIDATION", "Uang muka yang dipakai tidak boleh negatif.");
  }
  if (requested.gt(0) && input.source !== "purchase") {
    throw new AppError(
      "VALIDATION",
      "Uang muka hanya dapat dipakai pada penerimaan pembelian dari pemasok.",
    );
  }
  if (requested.gt(input.invoiceTotal)) {
    throw new AppError(
      "VALIDATION",
      "Uang muka yang dipakai melebihi total tagihan penerimaan.",
    );
  }
  if (requested.lte(0)) {
    return { applied: d(0), allocations: [], accountId: null };
  }
  if (!input.supplierId) {
    throw new AppError("VALIDATION", "Pemasok wajib dipilih untuk memakai uang muka.");
  }
  const accountId = await getAccountId(tx, input.companyId, "purchase_advance");
  const plan = await applyPurchaseAdvancesFIFO(tx, {
    companyId: input.companyId,
    supplierId: input.supplierId,
    amount: requested,
  });
  return { ...plan, accountId };
}
