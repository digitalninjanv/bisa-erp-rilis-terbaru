// Server-side pagination for the Accounts Receivable / Accounts Payable worklist.

import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { d } from "@/lib/money";
import { addDaysISO } from "@/lib/due-date";
import { listJournalNumbersById } from "@/server/catalog";
import {
  expenses,
  partyOpeningBalances,
  sales,
  stockReceipts,
} from "@/db/schema";
import { getCompanySettingsRow } from "@/server/settings";
import {
  listPayables,
  listReceivables,
  openPayableOpeningFilter,
  openPurchaseReceiptFilter,
} from "./arap";

/** Count the same open rows as listReceivables without transferring them to Node. */
export async function countOpenReceivables(tx: Tx, companyId: string): Promise<number> {
  const [saleRows, openingRows] = await Promise.all([
    tx
      .select({ value: count() })
      .from(sales)
      .where(
        and(
          eq(sales.companyId, companyId),
          eq(sales.status, "completed"),
          inArray(sales.paymentStatus, ["unpaid", "partial"]),
        ),
      ),
    tx
      .select({ value: count() })
      .from(partyOpeningBalances)
      .where(
        and(
          eq(partyOpeningBalances.companyId, companyId),
          eq(partyOpeningBalances.kind, "receivable"),
          eq(partyOpeningBalances.status, "open"),
        ),
      ),
  ]);
  return (saleRows[0]?.value ?? 0) + (openingRows[0]?.value ?? 0);
}

/** Count the same positive-outstanding documents as listPayables in SQL. */
export async function countOpenPayables(tx: Tx, companyId: string): Promise<number> {
  const receiptOutstanding = sql`
    ${stockReceipts.total} - ${stockReceipts.paidAmount} - coalesce((
      select sum(sra.amount)
      from supplier_return_allocations sra
      where sra.company_id = ${companyId}
        and sra.receipt_id = ${stockReceipts.id}
    ), 0) > 0
  `;
  const openingOutstanding = sql`
    ${partyOpeningBalances.amount} - ${partyOpeningBalances.paidAmount} - coalesce((
      select sum(sra.amount)
      from supplier_return_allocations sra
      where sra.company_id = ${companyId}
        and sra.opening_id = ${partyOpeningBalances.id}
    ), 0) > 0
  `;
  const [receiptRows, openingRows, expenseRows] = await Promise.all([
    tx
      .select({ value: count() })
      .from(stockReceipts)
      .where(and(openPurchaseReceiptFilter(companyId), receiptOutstanding)),
    tx
      .select({ value: count() })
      .from(partyOpeningBalances)
      .where(and(openPayableOpeningFilter(companyId), openingOutstanding)),
    tx
      .select({ value: count() })
      .from(expenses)
      .where(
        and(
          eq(expenses.companyId, companyId),
          eq(expenses.status, "posted"),
          inArray(expenses.paymentStatus, ["unpaid", "partial"]),
          isNotNull(expenses.supplierId),
          sql`${expenses.amount} - ${expenses.paidAmount} > 0`,
        ),
      ),
  ]);
  return (
    (receiptRows[0]?.value ?? 0) +
    (openingRows[0]?.value ?? 0) +
    (expenseRows[0]?.value ?? 0)
  );
}

export type ReceivablePayableDueFilter = "" | "terlambat" | "segera" | "jatuh-tempo";

export type ReceivablePayablePageInput = {
  page: number;
  pageSize: number;
  status: ReceivablePayableDueFilter;
  q: string;
  today: string;
};

export type ReceivablePayablePageRow = {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  total: string;
  paymentStatus: string;
  partyId: string | null;
  partyName: string | null;
  reference: string | null;
  source: "document" | "opening" | "expense";
  outstanding: number;
  journalId: string | null;
  journalNumber: string | null;
};

export type ReceivablePayablePageSummary = {
  openCount: number;
  totalOutstanding: number;
  overdueCount: number;
  overdueTotal: number;
  soonCount: number;
  soonTotal: number;
  paidCount: number;
};

export type ReceivablePayablePage = {
  rows: ReceivablePayablePageRow[];
  total: number;
  summary: ReceivablePayablePageSummary;
};

type ArApPageQueryRow = {
  openCount: number;
  totalOutstanding: string;
  overdueCount: number;
  overdueTotal: string;
  soonCount: number;
  soonTotal: string;
  paidCount: number;
  filteredTotal: number;
  id: string | null;
  number: string | null;
  date: string | null;
  dueDate: string | null;
  total: string | null;
  paymentStatus: string | null;
  partyId: string | null;
  partyName: string | null;
  reference: string | null;
  source: ReceivablePayablePageRow["source"] | null;
  outstanding: string | null;
  journalId: string | null;
};

function arapPageQueryFooter(input: ReceivablePayablePageInput) {
  const query = input.q.trim().toLowerCase();
  const dueSoonLimit = addDaysISO(input.today, 7);
  const page = Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1;
  const pageSize =
    Number.isSafeInteger(input.pageSize) && input.pageSize > 0 && input.pageSize <= 200
      ? input.pageSize
      : 40;
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) throw new Error("Halaman piutang/utang di luar batas.");

  return sql`
    , filtered_documents AS (
      SELECT doc.*
      FROM open_documents AS doc
      WHERE (
        ${input.status} = ''
        OR (
          ${input.status} = 'terlambat'
          AND doc.due_date IS NOT NULL
          AND doc.due_date < ${input.today}::date
        )
        OR (
          ${input.status} = 'segera'
          AND doc.due_date >= ${input.today}::date
          AND doc.due_date <= ${dueSoonLimit}::date
        )
        OR (
          ${input.status} = 'jatuh-tempo'
          AND doc.due_date IS NOT NULL
          AND doc.due_date <= ${dueSoonLimit}::date
        )
      )
      AND (
        ${query} = ''
        OR position(${query} in lower(doc.number)) > 0
        OR position(${query} in lower(coalesce(doc.party_name, ''))) > 0
        OR position(${query} in lower(coalesce(doc.reference, ''))) > 0
      )
    ),
    page_summary AS (
      SELECT
        count(*)::int AS open_count,
        coalesce(sum(doc.outstanding), 0)::numeric AS total_outstanding,
        count(*) FILTER (WHERE doc.due_date < ${input.today}::date)::int AS overdue_count,
        coalesce(sum(doc.outstanding) FILTER (WHERE doc.due_date < ${input.today}::date), 0)::numeric AS overdue_total,
        count(*) FILTER (
          WHERE doc.due_date >= ${input.today}::date AND doc.due_date <= ${dueSoonLimit}::date
        )::int AS soon_count,
        coalesce(sum(doc.outstanding) FILTER (
          WHERE doc.due_date >= ${input.today}::date AND doc.due_date <= ${dueSoonLimit}::date
        ), 0)::numeric AS soon_total,
        count(*) FILTER (WHERE doc.payment_status = 'partial')::int AS paid_count
      FROM open_documents AS doc
    ),
    filtered_count AS (
      SELECT count(*)::int AS total
      FROM filtered_documents
    )
    SELECT
      summary.open_count AS "openCount",
      summary.total_outstanding AS "totalOutstanding",
      summary.overdue_count AS "overdueCount",
      summary.overdue_total AS "overdueTotal",
      summary.soon_count AS "soonCount",
      summary.soon_total AS "soonTotal",
      summary.paid_count AS "paidCount",
      filtered_count.total AS "filteredTotal",
      page.id,
      page.number,
      page.document_date::text AS date,
      page.due_date::text AS "dueDate",
      page.total,
      page.payment_status AS "paymentStatus",
      page.party_id AS "partyId",
      page.party_name AS "partyName",
      page.reference,
      page.source,
      page.outstanding,
      page.journal_id AS "journalId"
    FROM page_summary AS summary
    CROSS JOIN filtered_count
    LEFT JOIN LATERAL (
      SELECT doc.*
      FROM filtered_documents AS doc
      ORDER BY doc.document_date ASC, doc.source_order ASC, doc.id ASC
      LIMIT ${pageSize}
      OFFSET ${offset}
    ) AS page ON true
    ORDER BY page.document_date ASC NULLS LAST, page.source_order ASC NULLS LAST, page.id ASC NULLS LAST
  `;
}

async function mapArapPageResult(
  tx: Tx,
  companyId: string,
  queryRows: ArApPageQueryRow[],
): Promise<ReceivablePayablePage> {
  const summaryRow = queryRows[0];
  if (!summaryRow) throw new Error("Ringkasan piutang/utang tidak dikembalikan query.");

  const journalIds = queryRows
    .filter((row) => row.id !== null && row.source === "opening" && row.journalId !== null)
    .map((row) => row.journalId as string);
  const journalNumbers = await listJournalNumbersById(tx, companyId, journalIds);
  const rows: ReceivablePayablePageRow[] = queryRows
    .filter((row): row is ArApPageQueryRow & { id: string } => row.id !== null)
    .map((row) => ({
      id: row.id,
      number: row.number ?? "",
      date: row.date ?? "",
      dueDate: row.dueDate,
      total: row.total ?? "0",
      paymentStatus: row.paymentStatus ?? "unpaid",
      partyId: row.partyId,
      partyName: row.partyName,
      reference: row.reference,
      source: row.source ?? "document",
      outstanding: Number(row.outstanding ?? 0),
      journalId: row.journalId,
      journalNumber: row.journalId ? (journalNumbers.get(row.journalId) ?? null) : null,
    }));

  return {
    rows,
    total: summaryRow.filteredTotal,
    summary: {
      openCount: summaryRow.openCount,
      totalOutstanding: Number(summaryRow.totalOutstanding),
      overdueCount: summaryRow.overdueCount,
      overdueTotal: Number(summaryRow.overdueTotal),
      soonCount: summaryRow.soonCount,
      soonTotal: Number(summaryRow.soonTotal),
      paidCount: summaryRow.paidCount,
    },
  };
}

/** Return one receivable page plus database-side totals; never materialize all open invoices in Node. */
export async function listReceivablesPage(
  tx: Tx,
  companyId: string,
  input: ReceivablePayablePageInput,
): Promise<ReceivablePayablePage> {
  const documents = sql`
    SELECT
      sale.id::text AS id,
      sale.number,
      sale.date AS document_date,
      sale.due_date,
      sale.total::numeric AS total,
      sale.paid_total::numeric AS paid_amount,
      sale.payment_status,
      sale.customer_id::text AS party_id,
      customer.name AS party_name,
      NULL::text AS reference,
      'document'::text AS source,
      NULL::uuid AS journal_id,
      (sale.total - sale.paid_total)::numeric AS outstanding,
      0::int AS source_order
    FROM sales AS sale
    LEFT JOIN customers AS customer
      ON customer.company_id = sale.company_id AND customer.id = sale.customer_id
    WHERE sale.company_id = ${companyId}
      AND sale.status = 'completed'
      AND sale.payment_status IN ('unpaid', 'partial')

    UNION ALL

    SELECT
      opening.id::text AS id,
      opening.number,
      opening.date AS document_date,
      opening.due_date,
      opening.amount::numeric AS total,
      opening.paid_amount::numeric AS paid_amount,
      CASE WHEN opening.paid_amount > 0 THEN 'partial' ELSE 'unpaid' END::text AS payment_status,
      opening.party_id::text AS party_id,
      customer.name AS party_name,
      opening.reference,
      'opening'::text AS source,
      opening.journal_id,
      (opening.amount - opening.paid_amount)::numeric AS outstanding,
      1::int AS source_order
    FROM party_opening_balances AS opening
    LEFT JOIN customers AS customer
      ON customer.company_id = opening.company_id AND customer.id = opening.party_id
    WHERE opening.company_id = ${companyId}
      AND opening.kind = 'receivable'
      AND opening.status = 'open'
  `;
  const result = Array.from(
    await tx.execute(sql<ArApPageQueryRow>`WITH open_documents AS (${documents}) ${arapPageQueryFooter(input)}`),
  ) as ArApPageQueryRow[];
  return mapArapPageResult(tx, companyId, result);
}

/** Return one payable page plus database-side totals; preserve return allocations and supplier terms. */
export async function listPayablesPage(
  tx: Tx,
  companyId: string,
  input: ReceivablePayablePageInput,
): Promise<ReceivablePayablePage> {
  const settings = await getCompanySettingsRow(tx, companyId);
  const defaultTermDays = settings?.payableDefaultTermDays ?? 30;
  const documents = sql`
    SELECT
      receipt.id::text AS id,
      receipt.number,
      receipt.date AS document_date,
      coalesce(receipt.due_date, (receipt.date + coalesce(supplier.payment_term_days, ${defaultTermDays}))::date) AS due_date,
      receipt.total::numeric AS total,
      receipt.paid_amount::numeric AS paid_amount,
      CASE WHEN receipt.paid_amount + coalesce(allocation.amount, 0) > 0
        THEN 'partial' ELSE receipt.payment_status END::text AS payment_status,
      receipt.supplier_id::text AS party_id,
      supplier.name AS party_name,
      NULL::text AS reference,
      'document'::text AS source,
      NULL::uuid AS journal_id,
      (receipt.total - receipt.paid_amount - coalesce(allocation.amount, 0))::numeric AS outstanding,
      0::int AS source_order
    FROM stock_receipts AS receipt
    LEFT JOIN suppliers AS supplier
      ON supplier.company_id = receipt.company_id AND supplier.id = receipt.supplier_id
    LEFT JOIN (
      SELECT receipt_id, sum(amount)::numeric AS amount
      FROM supplier_return_allocations
      WHERE company_id = ${companyId} AND receipt_id IS NOT NULL
      GROUP BY receipt_id
    ) AS allocation ON allocation.receipt_id = receipt.id
    WHERE receipt.company_id = ${companyId}
      AND receipt.status = 'posted'
      AND receipt.source = 'purchase'
      AND receipt.payment_account_id IS NULL
      AND receipt.payment_status IN ('unpaid', 'partial')
      AND receipt.total - receipt.paid_amount - coalesce(allocation.amount, 0) > 0

    UNION ALL

    SELECT
      opening.id::text AS id,
      opening.number,
      opening.date AS document_date,
      opening.due_date,
      opening.amount::numeric AS total,
      opening.paid_amount::numeric AS paid_amount,
      CASE WHEN opening.paid_amount + coalesce(allocation.amount, 0) > 0
        THEN 'partial' ELSE 'unpaid' END::text AS payment_status,
      opening.party_id::text AS party_id,
      supplier.name AS party_name,
      opening.reference,
      'opening'::text AS source,
      opening.journal_id,
      (opening.amount - opening.paid_amount - coalesce(allocation.amount, 0))::numeric AS outstanding,
      1::int AS source_order
    FROM party_opening_balances AS opening
    LEFT JOIN suppliers AS supplier
      ON supplier.company_id = opening.company_id AND supplier.id = opening.party_id
    LEFT JOIN (
      SELECT opening_id, sum(amount)::numeric AS amount
      FROM supplier_return_allocations
      WHERE company_id = ${companyId} AND opening_id IS NOT NULL
      GROUP BY opening_id
    ) AS allocation ON allocation.opening_id = opening.id
    WHERE opening.company_id = ${companyId}
      AND opening.kind = 'payable'
      AND opening.status = 'open'
      AND opening.amount - opening.paid_amount - coalesce(allocation.amount, 0) > 0

    UNION ALL

    SELECT
      expense.id::text AS id,
      expense.number,
      expense.date AS document_date,
      (expense.date + coalesce(supplier.payment_term_days, ${defaultTermDays}))::date AS due_date,
      expense.amount::numeric AS total,
      expense.paid_amount::numeric AS paid_amount,
      expense.payment_status,
      expense.supplier_id::text AS party_id,
      supplier.name AS party_name,
      NULL::text AS reference,
      'expense'::text AS source,
      NULL::uuid AS journal_id,
      (expense.amount - expense.paid_amount)::numeric AS outstanding,
      2::int AS source_order
    FROM expenses AS expense
    LEFT JOIN suppliers AS supplier
      ON supplier.company_id = expense.company_id AND supplier.id = expense.supplier_id
    WHERE expense.company_id = ${companyId}
      AND expense.status = 'posted'
      AND expense.payment_status IN ('unpaid', 'partial')
      AND expense.supplier_id IS NOT NULL
      AND expense.amount - expense.paid_amount > 0
  `;
  const result = Array.from(
    await tx.execute(sql<ArApPageQueryRow>`
      WITH open_documents AS (${documents})
      ${arapPageQueryFooter(input)}
    `),
  ) as ArApPageQueryRow[];
  return mapArapPageResult(tx, companyId, result);
}



export type ReceivablePayableQueues = {
  receivables: { openCount: number; openTotal: number; overdueCount: number; overdueTotal: number };
  payables: {
    openCount: number;
    openTotal: number;
    overdueCount: number;
    overdueTotal: number;
    dueSoonCount: number;
    dueSoonTotal: number;
  };
};

function queueSummaryFromPages(
  receivables: ReceivablePayablePage,
  payables: ReceivablePayablePage,
): ReceivablePayableQueues {
  return {
    receivables: {
      openCount: receivables.summary.openCount,
      openTotal: receivables.summary.totalOutstanding,
      overdueCount: receivables.summary.overdueCount,
      overdueTotal: receivables.summary.overdueTotal,
    },
    payables: {
      openCount: payables.summary.openCount,
      openTotal: payables.summary.totalOutstanding,
      overdueCount: payables.summary.overdueCount,
      overdueTotal: payables.summary.overdueTotal,
      dueSoonCount: payables.summary.soonCount,
      dueSoonTotal: payables.summary.soonTotal,
    },
  };
}

/**
 * Queue summary uses the same SQL read model as the receivable/payable
 * worklist. Dashboard previews can pass their already-loaded pages so the
 * full document lists never need to be materialized in application memory.
 */
export async function getReceivablePayableQueues(
  tx: Tx,
  companyId: string,
  today: string,
  existingRows?: {
    receivables: Awaited<ReturnType<typeof listReceivables>>;
    payables: Awaited<ReturnType<typeof listPayables>>;
  },
  existingPages?: {
    receivables: ReceivablePayablePage;
    payables: ReceivablePayablePage;
  },
): Promise<ReceivablePayableQueues> {
  if (existingPages) {
    return queueSummaryFromPages(existingPages.receivables, existingPages.payables);
  }

  if (!existingRows) {
    const [receivables, payables] = await Promise.all([
      listReceivablesPage(tx, companyId, {
        page: 1,
        pageSize: 1,
        status: "",
        q: "",
        today,
      }),
      listPayablesPage(tx, companyId, {
        page: 1,
        pageSize: 1,
        status: "",
        q: "",
        today,
      }),
    ]);
    return queueSummaryFromPages(receivables, payables);
  }

  const dueSoonLimit = addDaysISO(today, 7);
  const ar = { openCount: 0, openTotal: d(0), overdueCount: 0, overdueTotal: d(0) };
  for (const row of existingRows.receivables) {
    ar.openCount += 1;
    ar.openTotal = ar.openTotal.plus(d(row.outstanding));
    if (row.dueDate && String(row.dueDate) < today) {
      ar.overdueCount += 1;
      ar.overdueTotal = ar.overdueTotal.plus(d(row.outstanding));
    }
  }
  const ap = {
    openCount: 0,
    openTotal: d(0),
    overdueCount: 0,
    overdueTotal: d(0),
    dueSoonCount: 0,
    dueSoonTotal: d(0),
  };
  for (const row of existingRows.payables) {
    ap.openCount += 1;
    ap.openTotal = ap.openTotal.plus(d(row.outstanding));
    const due = String(row.dueDate);
    if (due < today) {
      ap.overdueCount += 1;
      ap.overdueTotal = ap.overdueTotal.plus(d(row.outstanding));
    } else if (due <= dueSoonLimit) {
      ap.dueSoonCount += 1;
      ap.dueSoonTotal = ap.dueSoonTotal.plus(d(row.outstanding));
    }
  }
  return {
    receivables: {
      openCount: ar.openCount,
      openTotal: ar.openTotal.toNumber(),
      overdueCount: ar.overdueCount,
      overdueTotal: ar.overdueTotal.toNumber(),
    },
    payables: {
      openCount: ap.openCount,
      openTotal: ap.openTotal.toNumber(),
      overdueCount: ap.overdueCount,
      overdueTotal: ap.overdueTotal.toNumber(),
      dueSoonCount: ap.dueSoonCount,
      dueSoonTotal: ap.dueSoonTotal.toNumber(),
    },
  };
}
