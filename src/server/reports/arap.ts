// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { addDaysISO } from "@/lib/due-date";
import {
  d,
  Decimal,
} from "@/lib/money";
import { listJournalNumbersById } from "@/server/catalog";
import {
  customers,
  expenses,
  partyOpeningBalances,
  sales,
  stockReceipts,
  supplierReturnAllocations,
  suppliers,
} from "@/db/schema";

import { getCompanySettingsRow } from "@/server/settings";
export async function listReceivables(tx: Tx, companyId: string) {
  const rows = await tx
    .select({
      id: sales.id,
      number: sales.number,
      date: sales.date,
      // POS-1 (D-19): jatuh tempo penjualan utang kini tersimpan di
      // penjualan dan tampil di daftar piutang seperti saldo awal.
      dueDate: sales.dueDate,
      total: sales.total,
      paidTotal: sales.paidTotal,
      paymentStatus: sales.paymentStatus,
      customerId: sales.customerId,
      customerName: customers.name,
      phone: customers.phone,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.status, "completed"),
        inArray(sales.paymentStatus, ["unpaid", "partial"]),
      ),
    )
    .orderBy(asc(sales.date));
  // T4-5b (D-14): dokumen saldo awal piutang yang masih terbuka ikut
  // tampil dengan penanda sumber "opening" agar halaman & aging
  // memperlakukannya sebagai tagihan nyata, bukan angka tempelan.
  const openingRows = await tx
    .select({
      id: partyOpeningBalances.id,
      number: partyOpeningBalances.number,
      date: partyOpeningBalances.date,
      dueDate: partyOpeningBalances.dueDate,
      reference: partyOpeningBalances.reference,
      total: partyOpeningBalances.amount,
      paidTotal: partyOpeningBalances.paidAmount,
      customerId: partyOpeningBalances.partyId,
      customerName: customers.name,
      phone: customers.phone,
      journalId: partyOpeningBalances.journalId,
    })
    .from(partyOpeningBalances)
    .leftJoin(customers, eq(partyOpeningBalances.partyId, customers.id))
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.kind, "receivable"),
        eq(partyOpeningBalances.status, "open"),
      ),
    )
    .orderBy(asc(partyOpeningBalances.date));
  // A-24 T4: dokumen saldo awal tidak punya halaman sendiri — jurnal
  // pembentuknya ditautkan langsung dari baris daftar ini.
  const openingJournalNumbers = await listJournalNumbersById(
    tx,
    companyId,
    openingRows.map((r) => r.journalId).filter((id): id is string => Boolean(id)),
  );
  const merged = [
    ...rows.map((r) => ({
      ...r,
      reference: null as string | null,
      source: "document" as const,
      outstanding: d(r.total).minus(r.paidTotal).toNumber(),
      journalId: null as string | null,
      journalNumber: null as string | null,
    })),
    ...openingRows.map((r) => ({
      ...r,
      paymentStatus: d(r.paidTotal).gt(0) ? "partial" : "unpaid",
      source: "opening" as const,
      outstanding: d(r.total).minus(r.paidTotal).toNumber(),
      journalNumber: r.journalId ? (openingJournalNumbers.get(r.journalId) ?? null) : null,
    })),
  ];
  return merged.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function openPurchaseReceiptFilter(companyId: string) {
  return and(
    eq(stockReceipts.companyId, companyId),
    eq(stockReceipts.status, "posted"),
    // D-5: only credit purchases are payables. Cash purchases are born
    // paid and non-purchase receipts owe nothing — neither may ever
    // surface here as a phantom payable.
    eq(stockReceipts.source, "purchase"),
    isNull(stockReceipts.paymentAccountId),
    inArray(stockReceipts.paymentStatus, ["unpaid", "partial"]),
  );
}

export function openPayableOpeningFilter(companyId: string) {
  return and(
    eq(partyOpeningBalances.companyId, companyId),
    eq(partyOpeningBalances.kind, "payable"),
    eq(partyOpeningBalances.status, "open"),
  );
}

export async function listPayables(tx: Tx, companyId: string) {
  // FIX-P1 Tahap 5 (AK3-07): bawaan termin perusahaan untuk pemasok
  // tanpa termin sendiri (satu baca per panggilan daftar).
  const settings = await getCompanySettingsRow(tx, companyId);
  const defaultTermDays = settings?.payableDefaultTermDays ?? 30;
  const receiptFilter = openPurchaseReceiptFilter(companyId);
  const openingFilter = openPayableOpeningFilter(companyId);
  const rows = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      date: stockReceipts.date,
      supplierInvoiceDate: stockReceipts.supplierInvoiceDate,
      dueDate: stockReceipts.dueDate,
      total: stockReceipts.total,
      paidAmount: stockReceipts.paidAmount,
      paymentStatus: stockReceipts.paymentStatus,
      supplierId: stockReceipts.supplierId,
      supplierName: suppliers.name,
      supplierTermDays: suppliers.paymentTermDays,
    })
    .from(stockReceipts)
    .leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .where(receiptFilter)
    .orderBy(asc(stockReceipts.date));
  // T4-5b (D-14): dokumen saldo awal utang yang masih terbuka ikut
  // tampil dengan penanda sumber "opening" (lihat listReceivables).
  const openingRows = await tx
    .select({
      id: partyOpeningBalances.id,
      number: partyOpeningBalances.number,
      date: partyOpeningBalances.date,
      dueDate: partyOpeningBalances.dueDate,
      reference: partyOpeningBalances.reference,
      total: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
      supplierId: partyOpeningBalances.partyId,
      supplierName: suppliers.name,
      journalId: partyOpeningBalances.journalId,
    })
    .from(partyOpeningBalances)
    .leftJoin(suppliers, eq(partyOpeningBalances.partyId, suppliers.id))
    .where(openingFilter)
    .orderBy(asc(partyOpeningBalances.date));
  // A-21 (R3-11): beban terutang adalah dokumen utang ketiga —
  // definisi terbukanya memakai helper yang sama dengan FIFO
  // (listOpenExpensePayables di payables.ts) agar daftar dan
  // pelunasan tidak pernah berbeda pendapat. Jatuh tempo mengikuti
  // pola penerimaan: tanggal dokumen + termin pemasok (bawaan
  // perusahaan bila pemasok tanpa termin).
  const expenseRows = await tx
    .select({
      id: expenses.id,
      number: expenses.number,
      date: expenses.date,
      total: expenses.amount,
      paidAmount: expenses.paidAmount,
      paymentStatus: expenses.paymentStatus,
      supplierId: expenses.supplierId,
      supplierName: suppliers.name,
      supplierTermDays: suppliers.paymentTermDays,
    })
    .from(expenses)
    .leftJoin(suppliers, eq(expenses.supplierId, suppliers.id))
    .where(
      and(
        eq(expenses.companyId, companyId),
        eq(expenses.status, "posted"),
        inArray(expenses.paymentStatus, ["unpaid", "partial"]),
      ),
    )
    .orderBy(asc(expenses.date));
  // A-9 (D-20): posted supplier returns settle payables without cash —
  // their allocations against each document reduce the outstanding here
  // exactly like payments do, so a returned debt can never be paid a
  // second time. With no allocations (the historical case) every number
  // below is identical to the pre-return formula.
  const receiptAllocations = new Map<string, Decimal>();
  const openingAllocations = new Map<string, Decimal>();
  const openReceiptIds = tx
    .select({ id: stockReceipts.id })
    .from(stockReceipts)
    .where(receiptFilter);
  const openOpeningIds = tx
    .select({ id: partyOpeningBalances.id })
    .from(partyOpeningBalances)
    .where(openingFilter);
  const allocationRows = await tx
    .select({
      receiptId: supplierReturnAllocations.receiptId,
      openingId: supplierReturnAllocations.openingId,
      total: sql<string>`coalesce(sum(${supplierReturnAllocations.amount}), 0)`,
    })
    .from(supplierReturnAllocations)
    .where(
      and(
        eq(supplierReturnAllocations.companyId, companyId),
        or(
          inArray(supplierReturnAllocations.receiptId, openReceiptIds),
          inArray(supplierReturnAllocations.openingId, openOpeningIds),
        ),
      ),
    )
    .groupBy(supplierReturnAllocations.receiptId, supplierReturnAllocations.openingId);
  for (const allocation of allocationRows) {
    if (allocation.receiptId) {
      receiptAllocations.set(allocation.receiptId, d(allocation.total));
    }
    if (allocation.openingId) {
      openingAllocations.set(allocation.openingId, d(allocation.total));
    }
  }
  // A-24 T4: jurnal pembentuk dokumen saldo awal (lihat listReceivables).
  const openingJournalNumbers = await listJournalNumbersById(
    tx,
    companyId,
    openingRows.map((r) => r.journalId).filter((id): id is string => Boolean(id)),
  );
  const merged = [
    ...rows
      .map((r) => {
        const allocated = receiptAllocations.get(r.id) ?? d(0);
        const outstanding = d(r.total).minus(r.paidAmount).minus(allocated);
        const settled = d(r.paidAmount).plus(allocated);
        return {
          ...r,
          paymentStatus: outstanding.gt(0) && settled.gt(0) ? "partial" : r.paymentStatus,
          // FIX-P1 Tahap 5 (AK3-07): jatuh tempo nyata = tanggal
          // penerimaan + termin pemasok; termin kosong memakai bawaan
          // perusahaan (company_settings.payable_default_term_days).
          dueDate: r.dueDate ?? addDaysISO(String(r.date), r.supplierTermDays ?? defaultTermDays),
          reference: null as string | null,
          source: "document" as const,
          outstanding: outstanding.toNumber(),
          journalId: null as string | null,
          journalNumber: null as string | null,
        };
      })
      .filter((r) => r.outstanding > 0),
    ...openingRows
      .map((r) => {
        const allocated = openingAllocations.get(r.id) ?? d(0);
        const outstanding = d(r.total).minus(r.paidAmount).minus(allocated);
        const settled = d(r.paidAmount).plus(allocated);
        return {
          ...r,
          paymentStatus: settled.gt(0) ? "partial" : "unpaid",
          source: "opening" as const,
          supplierInvoiceDate: null as string | null,
          outstanding: outstanding.toNumber(),
          journalNumber: r.journalId ? (openingJournalNumbers.get(r.journalId) ?? null) : null,
        };
      })
      .filter((r) => r.outstanding > 0),
    ...expenseRows
      .filter((r) => r.supplierId)
      .map((r) => ({
        ...r,
        dueDate: addDaysISO(String(r.date), r.supplierTermDays ?? defaultTermDays),
        reference: null as string | null,
        source: "expense" as const,
        supplierInvoiceDate: null as string | null,
        outstanding: d(r.total).minus(r.paidAmount).toNumber(),
        journalId: null as string | null,
        journalNumber: null as string | null,
      }))
      .filter((r) => r.outstanding > 0),
  ];
  return merged.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
