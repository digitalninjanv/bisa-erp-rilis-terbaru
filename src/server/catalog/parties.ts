/**
 * Agregat baca PIHAK (A-26 Q5, K-04) — pecahan src/server/catalog.ts:
 * pemasok, pelanggan, dan kelompok pelanggan.
 * Badan kueri dipindah apa adanya.
 */
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { customerGroups, customers, partyOpeningBalances, sales, suppliers } from "@/db/schema";
import { d } from "@/lib/money";
import {
  LIST_PAGE_SIZE,
  normalizePageParams,
  pageOffset,
  pageResult,
  type PageResult,
} from "@/lib/pagination";

export async function listSuppliers(tx: Tx, companyId: string) {
  return tx
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), eq(suppliers.isActive, true)))
    .orderBy(asc(suppliers.name));
}

export async function listCustomers(tx: Tx, companyId: string) {
  return tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), eq(customers.isActive, true)))
    .orderBy(asc(customers.name));
}

/**
 * Filter daftar pihak (S3 §18F) — dipakai bersama oleh halaman daftar
 * pihak dan rute ekspor pihak, supaya ekspor selalu persis mengikuti
 * filter yang sedang tampil (kata kunci nama/kode/telepon + status).
 */
export type PartyListFilter = {
  q?: string;
  /** "aktif" | "nonaktif" | nilai lain/kosong = semua status. */
  status?: string;
};

function supplierConditions(companyId: string, filter: PartyListFilter) {
  const conditions = [eq(suppliers.companyId, companyId)];
  const q = filter.q?.trim();
  if (q) {
    conditions.push(
      or(ilike(suppliers.name, `%${q}%`), ilike(suppliers.code, `%${q}%`), ilike(suppliers.phone, `%${q}%`))!,
    );
  }
  if (filter.status === "aktif") conditions.push(eq(suppliers.isActive, true));
  if (filter.status === "nonaktif") conditions.push(eq(suppliers.isActive, false));
  return conditions;
}

function customerConditions(companyId: string, filter: PartyListFilter) {
  const conditions = [eq(customers.companyId, companyId)];
  const q = filter.q?.trim();
  if (q) {
    conditions.push(
      or(ilike(customers.name, `%${q}%`), ilike(customers.code, `%${q}%`), ilike(customers.phone, `%${q}%`))!,
    );
  }
  if (filter.status === "aktif") conditions.push(eq(customers.isActive, true));
  if (filter.status === "nonaktif") conditions.push(eq(customers.isActive, false));
  return conditions;
}

export async function listSuppliersFiltered(tx: Tx, companyId: string, filter: PartyListFilter) {
  return tx
    .select()
    .from(suppliers)
    .where(and(...supplierConditions(companyId, filter)))
    .orderBy(asc(suppliers.name));
}

export async function listCustomersFiltered(tx: Tx, companyId: string, filter: PartyListFilter) {
  return tx
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      address: customers.address,
      notes: customers.notes,
      groupId: customers.groupId,
      creditLimit: customers.creditLimit,
      taxId: customers.taxId,
      paymentTermDays: customers.paymentTermDays,
      attributes: customers.attributes,
      isActive: customers.isActive,
      groupName: customerGroups.name,
    })
    .from(customers)
    .leftJoin(customerGroups, eq(customers.groupId, customerGroups.id))
    .where(and(...customerConditions(companyId, filter)))
    .orderBy(asc(customers.name));
}

/**
 * G3 (TBL-01 + TBL-02): bacaan TERPAGINASI + TERURUT untuk halaman
 * daftar pihak. Kondisi filter identik dengan varian `Filtered` di
 * atas (satu pembangun kondisi dipakai bersama — ekspor tetap memakai
 * varian penuh tanpa paginasi). Sorting terjadi di SQL lewat kolom
 * yang dipilih pemanggil: "nama" (bawaan, sama seperti sebelumnya)
 * atau "kode", arah asc/desc; ikatan urutan sekunder selalu nama lalu
 * kode agar halaman stabil antar-permintaan.
 */
export type PartyPageInput = PartyListFilter & {
  sort?: "nama" | "kode";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export async function listSuppliersPage(
  tx: Tx,
  companyId: string,
  input: PartyPageInput,
): Promise<PageResult<Awaited<ReturnType<typeof listSuppliersFiltered>>[number]>> {
  const { page, pageSize } = normalizePageParams(input, LIST_PAGE_SIZE);
  const where = and(...supplierConditions(companyId, input));
  const sortColumn = input.sort === "kode" ? suppliers.code : suppliers.name;
  const order = input.dir === "desc" ? desc(sortColumn) : asc(sortColumn);
  const [totalRow] = await tx.select({ value: count() }).from(suppliers).where(where);
  const total = totalRow?.value ?? 0;
  const rows = await tx
    .select()
    .from(suppliers)
    .where(where)
    .orderBy(order, asc(suppliers.name), asc(suppliers.code))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));
  return pageResult(rows, total, page, pageSize);
}

export async function listCustomersPage(
  tx: Tx,
  companyId: string,
  input: PartyPageInput,
): Promise<PageResult<Awaited<ReturnType<typeof listCustomersFiltered>>[number]>> {
  const { page, pageSize } = normalizePageParams(input, LIST_PAGE_SIZE);
  const where = and(...customerConditions(companyId, input));
  const sortColumn = input.sort === "kode" ? customers.code : customers.name;
  const order = input.dir === "desc" ? desc(sortColumn) : asc(sortColumn);
  const [totalRow] = await tx.select({ value: count() }).from(customers).where(where);
  const total = totalRow?.value ?? 0;
  const rows = await tx
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      address: customers.address,
      notes: customers.notes,
      groupId: customers.groupId,
      creditLimit: customers.creditLimit,
      taxId: customers.taxId,
      paymentTermDays: customers.paymentTermDays,
      attributes: customers.attributes,
      isActive: customers.isActive,
      groupName: customerGroups.name,
    })
    .from(customers)
    .leftJoin(customerGroups, eq(customers.groupId, customerGroups.id))
    .where(where)
    .orderBy(order, asc(customers.name), asc(customers.code))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));
  return pageResult(rows, total, page, pageSize);
}

export async function listCustomerGroups(
  tx: Tx,
  companyId: string,
  opts?: { activeOnly?: boolean },
) {
  // POS-GRP-01: the POS passes activeOnly so cashiers are never offered
  // a deactivated group (quoteCart would reject it on every keystroke);
  // master-data contexts keep seeing every group.
  const conditions = [eq(customerGroups.companyId, companyId)];
  if (opts?.activeOnly) conditions.push(eq(customerGroups.isActive, true));
  return tx
    .select()
    .from(customerGroups)
    .where(and(...conditions))
    .orderBy(asc(customerGroups.name));
}

export async function listCustomerGroupsWithCounts(tx: Tx, companyId: string) {
  return tx
    .select({
      id: customerGroups.id,
      name: customerGroups.name,
      roundingStep: customerGroups.roundingStep,
      roundingDirection: customerGroups.roundingDirection,
      roundCashTotal: customerGroups.roundCashTotal,
      discountAccountId: customerGroups.discountAccountId,
      isActive: customerGroups.isActive,
      productCount: sql<number>`(select count(*)::int from customer_group_discounts cgp where cgp.company_id = ${companyId} and cgp.group_id = ${customerGroups.id})`,
    })
    .from(customerGroups)
    .where(eq(customerGroups.companyId, companyId))
    .orderBy(asc(customerGroups.name));
}

export async function searchPosCustomersWithDebt(
  tx: Tx,
  companyId: string,
  term?: string,
) {
  const rows = await tx
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      creditLimit: customers.creditLimit,
      creditLimitUnlimited: customers.creditLimitUnlimited,
    })
    .from(customers)
    .where(
      and(
        eq(customers.companyId, companyId),
        eq(customers.isActive, true),
        term
          ? or(ilike(customers.name, `%${term}%`), ilike(customers.phone, `%${term}%`))
          : undefined,
      ),
    )
    .orderBy(customers.name)
    .limit(10);

  if (rows.length === 0) return [];

  const customerIds = rows.map((r) => r.id);
  const [outstandingRows, openingRows] = await Promise.all([
    tx
      .select({
        customerId: sales.customerId,
        outstanding: sql<string>`coalesce(sum(${sales.total} - ${sales.paidTotal}), 0)`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.companyId, companyId),
          inArray(sales.customerId, customerIds),
          inArray(sales.status, ["completed", "partial"]),
          inArray(sales.paymentStatus, ["unpaid", "partial"]),
        ),
      )
      .groupBy(sales.customerId),
    tx
      .select({
        customerId: partyOpeningBalances.partyId,
        outstanding: sql<string>`coalesce(sum(${partyOpeningBalances.amount} - ${partyOpeningBalances.paidAmount}), 0)`,
      })
      .from(partyOpeningBalances)
      .where(
        and(
          eq(partyOpeningBalances.companyId, companyId),
          eq(partyOpeningBalances.kind, "receivable"),
          eq(partyOpeningBalances.status, "open"),
          inArray(partyOpeningBalances.partyId, customerIds),
        ),
      )
      .groupBy(partyOpeningBalances.partyId),
  ]);

  const debtMap = new Map<string, number>();
  for (const item of [...outstandingRows, ...openingRows]) {
    if (item.customerId) {
      debtMap.set(
        item.customerId,
        (debtMap.get(item.customerId) ?? 0) + d(item.outstanding).toNumber(),
      );
    }
  }

  return rows.map((row) => {
    const creditLimit = d(row.creditLimit).toNumber();
    const currentDebt = debtMap.get(row.id) ?? 0;
    const remainingCredit =
      creditLimit > 0
        ? Math.max(0, creditLimit - currentDebt)
        : row.creditLimitUnlimited
          ? 0
          : 0;
    return {
      ...row,
      creditLimit,
      currentDebt,
      remainingCredit,
    };
  });
}
