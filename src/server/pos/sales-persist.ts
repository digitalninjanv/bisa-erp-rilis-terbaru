// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: penulisan checkout — dokumen penjualan, gerakan stok,
// mutasi laci, dan jurnal penjualan.

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, saleLines, salePayments, saleReturns, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { D, d, toDb, Decimal } from "@/lib/money";
import { getAccountMap, postJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { applyBatchDelta } from "@/server/batches";
import { applyStockMovement } from "@/server/inventory";
import { consumeSerials } from "@/server/serials";
import { nextDocumentNumber } from "@/server/sequences";
import type { QuoteResult } from "./quote";
import { getCompanySettingsRow } from "@/server/settings";;
import type { CreateSaleInput } from "./sales-types";
import type { AppliedPayment } from "./sales-payments";

type SaleSettings = Awaited<ReturnType<typeof getCompanySettingsRow>>;


/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * penulisan dokumen penjualan — nomor, header, baris, baris
 * pembayaran, dan pencatatan pemakaian kredit retur (D-12).
 */


export async function persistSaleDocument(
  tx: Tx,
  input: CreateSaleInput,
  quote: QuoteResult,
  session: { id: string },
  applied: AppliedPayment[],
  paid: Decimal,
  receivable: Decimal,
  change: Decimal,
) {
  const number = await nextDocumentNumber(tx, input.companyId, "SALE", input.date);
  // COGS only exists for stock-tracked lines: a service/non-stock line has no
  // inventory to relieve, so its costPrice never enters costTotal (and thus
  // never the Dr COGS / Cr Inventory journal legs).
  const costTotal = quote.lines
    .filter((l) => l.trackStock)
    .reduce((acc, l) => acc.plus(d(l.unitCost).mul(l.qty)), d(0));
  const paymentStatus = receivable.gt(0) ? (paid.gt(0) ? "partial" : "unpaid") : "paid";

  const [sale] = await tx
    .insert(sales)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      number,
      date: input.date,
      // Jatuh tempo hanya bermakna untuk penjualan berpiutang; penjualan
      // lunas selalu null agar daftar piutang tidak menampilkannya.
      dueDate: receivable.gt(0) ? (input.dueDate ?? null) : null,
      cashierId: input.userId,
      sessionId: session.id,
      customerId: input.customerId ?? null,
      customerGroupId: quote.customerGroupId ?? null,
      status: "completed",
      subtotal: toDb(quote.subtotal),
      discountTotal: toDb(quote.discountTotal),
      taxTotal: toDb(quote.taxTotal),
      roundingAdjustment: toDb(quote.roundingAdjustment),
      roundingMode: quote.roundingMode,
      total: toDb(quote.total),
      costTotal: toDb(costTotal),
      paidTotal: toDb(paid),
      changeTotal: toDb(change),
      paymentStatus,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: sales.id, number: sales.number });

  await tx.insert(saleLines).values(
    quote.lines.map((line, index) => ({
      companyId: input.companyId,
      saleId: sale.id,
      productId: line.productId,
      lineNo: index + 1,
      qty: toDb(line.qty),
      unitPrice: toDb(line.unitPrice),
      discountType: line.discountType,
      discountValue: toDb(line.discountValue),
      discountAmount: toDb(line.discountAmount),
      taxAmount: toDb(line.taxAmount),
      lineTotal: toDb(line.lineTotal),
      unitCost: toDb(line.unitCost),
      taxRate: toDb(line.taxRate),
      productName: line.name,
      productSku: line.sku,
      // S4: cuplikan kemasan dari quote (qty/unitPrice di atas tetap
      // satuan dasar; qtyInput/isiSnapshot membekukan bentuk masukan).
      packagingId: line.packagingId,
      qtyInput: toDb(line.qtyInput),
      isiSnapshot: line.isiSnapshot,
    })),
  );

  if (applied.length > 0) {
    await tx.insert(salePayments).values(
      applied.map((payment) => ({
        companyId: input.companyId,
        saleId: sale.id,
        methodId: payment.methodId,
        amount: toDb(payment.amount),
        feeAmount: toDb(payment.fee),
        tendered: toDb(payment.tendered),
        reference: payment.reference,
      })),
    );
  }

  // D-12: catat pemakaian kredit pada dokumen retur yang dirujuk. Baris
  // retur masih terkunci sejak pra-cek di atas, jadi kenaikan credit_used
  // ini atomik terhadap checkout lain yang memperebutkan retur yang sama.
  for (const payment of applied) {
    if (payment.type !== "customer_credit" || !payment.returnId) continue;
    await tx
      .update(saleReturns)
      .set({ creditUsed: sql`${saleReturns.creditUsed} + ${toDb(payment.amount)}` })
      .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.id, payment.returnId)));
    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "pos.credit.redeem",
      entityType: "sale_return",
      entityId: payment.returnId,
      after: {
        returnNumber: payment.returnNumber,
        saleNumber: sale.number,
        amount: toDb(payment.amount),
      },
    });
  }
  return { sale, costTotal, paymentStatus };
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * gerakan stok per baris — seri dikonsumsi, batch dialokasikan
 * FEFO, sisanya gerakan keluar biasa; baris non-stok dilewati.
 */


export async function applySaleStockMovements(
  tx: Tx,
  input: CreateSaleInput,
  quote: QuoteResult,
  sale: { id: string; number: string },
  settings: SaleSettings,
) {
  for (const line of quote.lines) {
    // Non-stock products (services) are sold without touching the stock
    // ledger; moving them would pile up negative on-hand balances for goods
    // that do not exist (and fail checkout outright when negative stock is
    // disallowed).
    if (!line.trackStock) continue;
    if (line.trackSerial) {
      // SIM-2 S7B-2 Batch 5: seri yang dipilih kasir dikunci & ditandai
      // keluar — seri yang sama tidak bisa dijual dua kali.
      await consumeSerials(tx, {
        companyId: input.companyId,
        userId: input.userId,
        productId: line.productId,
        productName: line.name,
        warehouseId: input.warehouseId,
        serialNumbers: line.serialNumbers,
        referenceType: "sale",
        referenceId: sale.id,
        referenceNumber: sale.number,
      });
    }
    if (line.trackBatch) {
      // G8/D-7: allocate FEFO (expired batches are never sold) and write
      // one movement per batch slice; the sale line itself stays single.
      const slices = await applyBatchDelta(tx, {
        companyId: input.companyId,
        productId: line.productId,
        warehouseId: input.warehouseId,
        delta: -line.qty,
        asOfDate: input.date,
        purpose: "sale",
        allowNegative: settings?.allowNegativeStock ?? false,
      });
      for (const slice of slices) {
        await applyStockMovement(tx, {
          companyId: input.companyId,
          warehouseId: input.warehouseId,
          productId: line.productId,
          delta: slice.qty.negated(),
          unitCost: line.unitCost,
          movementType: "sale",
          referenceType: "sale",
          referenceId: sale.id,
          referenceNumber: sale.number,
          userId: input.userId,
          allowNegative: settings?.allowNegativeStock ?? false,
          batchId: slice.batchId,
          date: input.date,
        });
      }
      continue;
    }
    await applyStockMovement(tx, {
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      productId: line.productId,
      delta: -line.qty,
      unitCost: line.unitCost,
      movementType: "sale",
      referenceType: "sale",
      referenceId: sale.id,
      referenceNumber: sale.number,
      userId: input.userId,
      allowNegative: settings?.allowNegativeStock ?? false,
      date: input.date,
    });
  }
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * mutasi laci untuk pembayaran tunai — dilewati seluruhnya pada
 * penyelesaian sesi tertutup (POS3-03).
 */


export async function recordSaleCashMovements(
  tx: Tx,
  input: CreateSaleInput,
  session: { id: string },
  sale: { id: string },
  applied: AppliedPayment[],
  settlementClosedSession: boolean,
) {
  // FIX-POS Tahap 2 (POS3-03): pada penyelesaian sesi tertutup TIDAK
  // ada mutasi kas baru — sesi tertutup bersifat final (expectedCash,
  // countedCash, dan selisihnya sudah terjurnal saat penutupan).
  if (!settlementClosedSession) {
    for (const payment of applied) {
      if (payment.type === "cash") {
        await tx.insert(cashMovements).values({
          companyId: input.companyId,
          sessionId: session.id,
          type: "sale",
          amount: toDb(payment.amount),
          referenceType: "sale",
          referenceId: sale.id,
          createdBy: input.userId,
        });
      }
    }
  }
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * jurnal penjualan — debit per akun pembayaran, penyerapan kas
 * lebih pada penyelesaian offline (POS3-03), piutang, diskon,
 * pembulatan, pendapatan, PPN, dan HPP; jurnal nol bersih tidak
 * diterbitkan (POS1-09).
 */


export async function postSaleJournal(
  tx: Tx,
  input: CreateSaleInput,
  sale: { id: string; number: string },
  quote: QuoteResult,
  applied: AppliedPayment[],
  receivable: Decimal,
  costTotal: Decimal,
  settlementClosedSession: boolean,
  map: Awaited<ReturnType<typeof getAccountMap>>,
) {
  const debitByAccount = new Map<string, D>();
  // A-21 Tahap R3-A (R3-01): akun metode terdebit NETO sesudah fee —
  // itulah yang benar-benar masuk mutasi bank/QRIS (dan ekspektasi
  // rekonsiliasi sesi); fee-nya sendiri mendebit beban fee terpetakan.
  let totalFees = d(0);
  for (const payment of applied) {
    if (payment.type === "credit" || !payment.accountId) continue;
    totalFees = totalFees.plus(payment.fee);
    debitByAccount.set(
      payment.accountId,
      (debitByAccount.get(payment.accountId) ?? d(0)).plus(payment.amount.minus(payment.fee)),
    );
  }
  if (totalFees.gt(0) && !map.bank_fee) {
    throw new AppError(
      "VALIDATION",
      'Akun untuk "bank_fee" belum dipetakan di Pengaturan, jadi fee metode pembayaran tidak dapat dijurnal.',
    );
  }

  // FIX-POS Tahap 2 (POS3-03): penyelesaian sesi tertutup — kaki kas
  // tunai dialihkan ke akun selisih kas lebih sesi asal sampai batas
  // kas lebih yang belum terjelaskan. Saat sesi ditutup, uang fisik
  // penjualan offline ini (bila terhitung) sudah masuk jurnal sebagai
  // Dr Kas / Cr Selisih kas lebih; penyelesaian mengganti penjelasan
  // sementara itu dengan penjualan sesungguhnya, bukan menambah kas
  // kedua kalinya. Sisa di atas batas (uang tidak terhitung saat
  // tutup sesi) tetap mendebit Kas seperti biasa.
  let overageAbsorbed = d(0);
  if (settlementClosedSession && input.offlineSettlement?.overageLimit != null && map.cash_over) {
    const limit = d(input.offlineSettlement.overageLimit);
    const cashLeg = debitByAccount.get(map.cash);
    if (limit.gt(0) && cashLeg && cashLeg.gt(0)) {
      overageAbsorbed = D.min(cashLeg, limit);
      const rest = cashLeg.minus(overageAbsorbed);
      if (rest.gt(0)) debitByAccount.set(map.cash, rest);
      else debitByAccount.delete(map.cash);
    }
  }

  const revenueGross = d(quote.subtotal).minus(d(quote.taxTotal));
  const rounding = d(quote.roundingAdjustment);

  const journalLines = [
    ...[...debitByAccount.entries()].map(([accountId, amount]) => ({
      accountId,
      debit: amount,
      description: "Penerimaan pembayaran",
    })),
    ...(totalFees.gt(0)
      ? [{ accountId: map.bank_fee, debit: totalFees, description: "Biaya (fee/MDR) metode pembayaran" }]
      : []),
    ...(overageAbsorbed.gt(0)
      ? [{ accountId: map.cash_over, debit: overageAbsorbed, description: "Penyelesaian offline: menyerap selisih kas lebih sesi asal" }]
      : []),
    ...(receivable.gt(0)
      ? [{ accountId: map.receivable, debit: receivable, description: "Piutang penjualan", partyType: "customer", partyId: input.customerId ?? undefined }]
      : []),
    ...(d(quote.discountTotal).gt(0)
      ? [{ accountId: quote.discountAccountId ?? map.sales_discount, debit: d(quote.discountTotal), description: "Diskon penjualan" }]
      : []),
    ...(rounding.lt(0)
      ? [{ accountId: map.rounding_loss, debit: rounding.abs(), description: "Selisih pembulatan" }]
      : []),
    { accountId: map.revenue, credit: revenueGross, description: "Penjualan" },
    ...(d(quote.taxTotal).gt(0)
      ? [{ accountId: map.tax_output, credit: d(quote.taxTotal), description: "PPN keluaran" }]
      : []),
    ...(rounding.gt(0)
      ? [{ accountId: map.rounding_gain, credit: rounding, description: "Pembulatan penjualan" }]
      : []),
    { accountId: map.cogs, debit: costTotal, description: "Harga pokok penjualan" },
    { accountId: map.inventory, credit: costTotal, description: "Persediaan berkurang" },
  ];

  // POS1-09: penjualan yang seluruh kakinya bernilai nol (produk
  // berharga jual 0 tanpa biaya, tanpa pajak/diskon/pembulatan) tidak
  // memiliki efek akuntansi — jurnal memang tidak perlu terbit.
  // Sebelumnya penjualan seperti itu gugur total karena postJournal
  // menolak jurnal yang baris nolnya tersaring habis ("minimal dua
  // baris"), padahal dokumen penjualannya sah dan stoknya harus
  // bergerak. Penjualan dengan kaki nonzero berapa pun (termasuk HPP
  // dari produk berharga 0 berbiaya > 0) tetap dijurnal seperti biasa.
  const hasNonZeroLine = journalLines.some((line) => {
    const parts = line as { debit?: Decimal; credit?: Decimal };
    return d(parts.debit ?? 0).gt(0) || d(parts.credit ?? 0).gt(0);
  });
  if (hasNonZeroLine) {
    await postJournal(tx, {
      companyId: input.companyId,
      date: input.date,
      description: `Penjualan ${sale.number}`,
      sourceType: "sale",
      sourceId: sale.id,
      createdBy: input.userId,
      idempotencyKey: `sale:${sale.id}`,
      lines: journalLines,
    });
  }
  return { overageAbsorbed };
}
