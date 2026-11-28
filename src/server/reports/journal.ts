// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { journalSourceLabel } from "@/lib/format";
import { d } from "@/lib/money";
import {
  accounts,
  bankTransfers,
  customers,
  employeeAdvances,
  employeeLoans,
  expenses,
  journalEntries,
  journalLines,
  partyOpeningBalances,
  partyPayments,
  purchaseAdvances,
  payrollRuns,
  saleReturns,
  sales,
  stockDocuments,
  stockReceipts,
  suppliers,
  user,
} from "@/db/schema";
import type { Range } from "./shared";

export async function getJournalSummary(tx: Tx, companyId: string, range: Range) {
  const [entries] = await tx
    .select({
      value: count(),
      manual: sql<number>`count(*) filter (where ${journalEntries.sourceType} = 'manual')`,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        gte(journalEntries.date, range.from),
        lte(journalEntries.date, range.to),
      ),
    );
  const [amounts] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.date, range.from),
        lte(journalEntries.date, range.to),
      ),
    );
  return {
    entries: entries?.value ?? 0,
    manual: Number(entries?.manual ?? 0),
    debit: d(amounts?.debit ?? 0).toNumber(),
    credit: d(amounts?.credit ?? 0).toNumber(),
  };
}

export async function listJournalEntries(tx: Tx, input: {
  companyId: string;
  from?: string;
  to?: string;
  q?: string;
  sourceType?: string;
  accountId?: string;
  status?: string;
  /** Filter pembuat jurnal — kebutuhan audit "siapa memposting apa". */
  createdBy?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const conditions = [eq(journalEntries.companyId, input.companyId)];
  if (input.from) conditions.push(gte(journalEntries.date, input.from));
  if (input.to) conditions.push(lte(journalEntries.date, input.to));
  if (input.sourceType) conditions.push(eq(journalEntries.sourceType, input.sourceType));
  // FIX-P1 Tahap 5 (AK5-02): saringan status & akun — "semua jurnal yang
  // menyentuh akun X" dan "hanya yang posted/void" adalah pertanyaan
  // harian akuntan yang sebelumnya mustahil dijawab dari daftar ini.
  if (input.status) conditions.push(eq(journalEntries.status, input.status));
  if (input.createdBy) conditions.push(eq(journalEntries.createdBy, input.createdBy));
  if (input.accountId) {
    conditions.push(
      inArray(
        journalEntries.id,
        tx
          .select({ entryId: journalLines.entryId })
          .from(journalLines)
          .where(
            and(
              eq(journalLines.companyId, input.companyId),
              eq(journalLines.accountId, input.accountId),
            ),
          ),
      ),
    );
  }
  if (input.q?.trim()) {
    conditions.push(or(ilike(journalEntries.number, `%${input.q.trim()}%`), ilike(journalEntries.description, `%${input.q.trim()}%`))!);
  }
  const where = and(...conditions);

  const [totalRow] = await tx.select({ value: count() }).from(journalEntries).where(where);
  const rows = await tx
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      status: journalEntries.status,
    })
    .from(journalEntries)
    .where(where)
    .orderBy(desc(journalEntries.date), desc(journalEntries.number), desc(journalEntries.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // AK-P3-04: entry amounts come from ONE batched aggregate over the
  // page's ids — the old correlated subquery re-summed journal_lines once
  // per rendered row.
  const entryIds = rows.map((r) => r.id);
  const amountRows = entryIds.length
    ? await tx
        .select({
          entryId: journalLines.entryId,
          amount: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, input.companyId), inArray(journalLines.entryId, entryIds)))
        .groupBy(journalLines.entryId)
    : [];
  const amountByEntry = new Map(amountRows.map((r) => [r.entryId, d(r.amount)]));

  // A-28 UI-3 (AKT-05): rincian baris debit/kredit per jurnal untuk
  // daftar — akuntan membaca komposisi jurnal tanpa membuka detail.
  // Satu kueri batch atas id halaman ini (pola yang sama dengan
  // agregat amount di atas), terurut nomor baris, bergabung nama akun.
  const lineRows = entryIds.length
    ? await tx
        .select({
          entryId: journalLines.entryId,
          accountCode: accounts.code,
          accountName: accounts.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: journalLines.description,
        })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(and(eq(journalLines.companyId, input.companyId), inArray(journalLines.entryId, entryIds)))
        .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo))
    : [];
  const linesByEntry = new Map<string, { accountCode: string; accountName: string; debit: number; credit: number; description: string | null }[]>();
  for (const line of lineRows) {
    const list = linesByEntry.get(line.entryId) ?? [];
    list.push({
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: d(line.debit).toNumber(),
      credit: d(line.credit).toNumber(),
      description: line.description,
    });
    linesByEntry.set(line.entryId, list);
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      amount: (amountByEntry.get(r.id) ?? d(0)).toNumber(),
      lines: linesByEntry.get(r.id) ?? [],
    })),
    total: totalRow?.value ?? 0,
    page,
    pageSize,
  };
}

/**
 * FIX-P1 Tahap 5 (AK5-02d): tipe sumber yang BENAR-BENAR ada di data
 * perusahaan ini. Dropdown filter daftar jurnal dibangun dari daftar ini
 * (digabung label yang dikenal kode), bukan dari 9 nilai hardcoded yang
 * membuat ±sebelas tipe sumber nyata tidak pernah bisa disaring.
 */
/**
 * Pembuat jurnal yang benar-benar punya jejak di perusahaan ini —
 * dipakai filter "User" pada histori jurnal. Hanya nama & id; bukan
 * daftar seluruh pengguna.
 */
export async function listJournalActors(
  tx: Tx,
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await tx
    .selectDistinct({ id: journalEntries.createdBy, name: user.name })
    .from(journalEntries)
    .innerJoin(user, eq(user.id, journalEntries.createdBy))
    .where(eq(journalEntries.companyId, companyId))
    .orderBy(asc(user.name));
  return rows.filter((row): row is { id: string; name: string } => Boolean(row.id));
}

export async function listJournalSourceTypes(tx: Tx, companyId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ sourceType: journalEntries.sourceType })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, companyId))
    .orderBy(asc(journalEntries.sourceType));
  return rows.map((row) => row.sourceType);
}

type NumberedDocTable =
  | typeof sales
  | typeof saleReturns
  | typeof stockReceipts
  | typeof stockDocuments
  | typeof expenses
  | typeof bankTransfers
  | typeof payrollRuns
  | typeof purchaseAdvances
  | typeof partyOpeningBalances
  | typeof partyPayments;

async function sourceNumberOf(
  tx: Tx,
  table: NumberedDocTable,
  companyId: string,
  id: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ number: table.number })
    .from(table)
    .where(and(eq(table.companyId, companyId), eq(table.id, id)))
    .limit(1);
  return row?.number ?? null;
}

/**
 * CT-08/CT-22 — resolve a journal's source to the NUMBER of the document
 * that created it, so printed vouchers and the detail footer can say
 * "Penjualan · INV-2026-00002" instead of leaking the raw source UUID.
 * The table follows from the base source type (reversals keep the
 * original document). `payment` is the one ambiguous type: POS receivable
 * payments point at the sale, AP payments at the goods receipt, opening
 * payments at the opening-balance document — ids are globally unique, so
 * the candidates are probed in order and the first hit wins. Sources
 * without a numbered document (manual, capital, cash session, bank
 * statement) resolve to null and are shown by label only.
 */
export async function resolveJournalSourceNumber(
  tx: Tx,
  companyId: string,
  sourceType: string,
  sourceId: string | null,
): Promise<string | null> {
  if (!sourceId) return null;
  const base = sourceType.replace(/_reversal$/, "");
  switch (base) {
    case "sale":
      return sourceNumberOf(tx, sales, companyId, sourceId);
    case "sale_return":
      return sourceNumberOf(tx, saleReturns, companyId, sourceId);
    case "purchase":
    case "receipt_opening":
    case "receipt_bonus":
    case "receipt_customer_return":
    case "receipt_other":
      return sourceNumberOf(tx, stockReceipts, companyId, sourceId);
    case "purchase_return":
    case "adjustment":
    case "opname":
      return sourceNumberOf(tx, stockDocuments, companyId, sourceId);
    case "expense":
      return sourceNumberOf(tx, expenses, companyId, sourceId);
    case "bank_transfer":
      return sourceNumberOf(tx, bankTransfers, companyId, sourceId);
    case "purchase_advance":
      return sourceNumberOf(tx, purchaseAdvances, companyId, sourceId);
    case "payroll":
    case "payroll_payment":
      return sourceNumberOf(tx, payrollRuns, companyId, sourceId);
    case "opening_balance":
      return sourceNumberOf(tx, partyOpeningBalances, companyId, sourceId);
    case "payment": {
      for (const table of [sales, stockReceipts, partyOpeningBalances, partyPayments] as const) {
        const number = await sourceNumberOf(tx, table, companyId, sourceId);
        if (number) return number;
      }
      return null;
    }
    default:
      return null;
  }
}

async function rowExists(
  tx: Tx,
  table: typeof sales | typeof stockReceipts | typeof partyOpeningBalances | typeof partyPayments,
  companyId: string,
  id: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.companyId, companyId), eq(table.id, id)))
    .limit(1);
  return Boolean(row);
}

/**
 * FIX-P1 Tahap 5 (AK5-01c): tautan drill-through dari detail jurnal ke
 * halaman dokumen asalnya. Hanya tipe sumber yang benar-benar memiliki
 * rute dokumen yang dipetakan; sisanya null (halaman menampilkan teks).
 * Pembalikan menaut ke dokumen asal yang sama seperti jurnal aslinya.
 * `payment` ambigu seperti pada resolver nomor — kandidat diperiksa
 * berurutan; pembayaran yang tak terpetakan jatuh ke daftar piutang/utang
 * tempat dokumen pembayaran itu dikelola.
 */
export async function resolveJournalSourceHref(
  tx: Tx,
  companyId: string,
  sourceType: string,
  sourceId: string | null,
): Promise<string | null> {
  if (!sourceId) {
    return sourceType.replace(/_reversal$/, "") === "opening_balance"
      ? "/app/akuntansi/piutang-utang"
      : null;
  }
  const base = sourceType.replace(/_reversal$/, "");
  switch (base) {
    case "sale":
      return `/app/pos/nota/${sourceId}`;
    case "purchase":
    case "receipt_opening":
    case "receipt_bonus":
    case "receipt_customer_return":
    case "receipt_other":
      return `/app/gudang/penerimaan/${sourceId}/cetak`;
    case "supplier_return":
    case "supplier_return_refund":
    case "supplier_return_credit_apply":
    case "supplier_return_replacement":
      return `/app/gudang/retur-pembelian/${sourceId}`;
    case "payroll":
    case "payroll_payment":
      return `/app/akuntansi/payroll/${sourceId}`;
    case "cash_session":
      return `/app/pos/sesi/riwayat/${sourceId}`;
    case "purchase_advance":
      return "/app/gudang/uang-muka";
    case "opening_balance":
      return "/app/akuntansi/piutang-utang";
    case "employee_advance":
    case "employee_advance_repayment": {
      const [row] = await tx
        .select({ employeeId: employeeAdvances.employeeId })
        .from(employeeAdvances)
        .where(and(eq(employeeAdvances.companyId, companyId), eq(employeeAdvances.id, sourceId)))
        .limit(1);
      return row ? `/app/akuntansi/kasbon/${row.employeeId}` : null;
    }
    case "employee_loan":
    case "employee_loan_repayment": {
      const [row] = await tx
        .select({ employeeId: employeeLoans.employeeId })
        .from(employeeLoans)
        .where(and(eq(employeeLoans.companyId, companyId), eq(employeeLoans.id, sourceId)))
        .limit(1);
      return row ? `/app/akuntansi/pinjaman/${row.employeeId}` : null;
    }
    case "payment": {
      if (await rowExists(tx, sales, companyId, sourceId)) return `/app/pos/nota/${sourceId}`;
      if (await rowExists(tx, stockReceipts, companyId, sourceId)) {
        return `/app/gudang/penerimaan/${sourceId}/cetak`;
      }
      return "/app/akuntansi/piutang-utang";
    }
    default:
      return null;
  }
}

export async function getJournalDetail(tx: Tx, companyId: string, entryId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.id, entryId)))
    .limit(1);
  if (!entry) return null;
  const rawLines = await tx
    .select({
      id: journalLines.id,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
      accountCode: accounts.code,
      accountName: accounts.name,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entryId))
    .orderBy(asc(journalLines.lineNo));
  // A-21 (R3-09): nama pihak diselesaikan dari tag baris agar
  // penyesuaian akun kontrol terbaca teratribusi di halaman detail —
  // tag tanpa nama hanya berupa UUID yang tidak berarti bagi pembaca.
  const partyNameByKey = new Map<string, string>();
  const customerIds = [...new Set(rawLines.filter((l) => l.partyType === "customer" && l.partyId).map((l) => l.partyId!))];
  const supplierIds = [...new Set(rawLines.filter((l) => l.partyType === "supplier" && l.partyId).map((l) => l.partyId!))];
  if (customerIds.length > 0) {
    const rows = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.companyId, companyId), inArray(customers.id, customerIds)));
    for (const row of rows) partyNameByKey.set(`customer:${row.id}`, row.name);
  }
  if (supplierIds.length > 0) {
    const rows = await tx
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.companyId, companyId), inArray(suppliers.id, supplierIds)));
    for (const row of rows) partyNameByKey.set(`supplier:${row.id}`, row.name);
  }
  const lines = rawLines.map((line) => ({
    ...line,
    partyName:
      line.partyType && line.partyId
        ? (partyNameByKey.get(`${line.partyType}:${line.partyId}`) ?? null)
        : null,
  }));
  const [reversal] = await tx
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      description: journalEntries.description,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.reversalOfId, entry.id)))
    .limit(1);

  let original: { id: string; number: string; date: string } | null = null;
  if (entry.reversalOfId) {
    const [row] = await tx
      .select({ id: journalEntries.id, number: journalEntries.number, date: journalEntries.date })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.id, entry.reversalOfId)))
      .limit(1);
    original = row ?? null;
  }

  // CT-08/CT-22: source shown as document number + Indonesian label.
  // FIX-P1 Tahap 5 (AK5-01c): plus the drill-through href when the
  // source document has a page of its own.
  const source = {
    label: journalSourceLabel(entry.sourceType),
    number: await resolveJournalSourceNumber(tx, companyId, entry.sourceType, entry.sourceId),
    href: await resolveJournalSourceHref(tx, companyId, entry.sourceType, entry.sourceId),
  };

  return { entry, lines, reversal: reversal ?? null, original, source };
}
