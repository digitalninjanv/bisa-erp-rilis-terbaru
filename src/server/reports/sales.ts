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
import { d } from "@/lib/money";
import {
  categories,
  customers,
  paymentMethods,
  productPackagings,
  products,
  saleLines,
  salePayments,
  sales,
  user,
} from "@/db/schema";
import type { Range } from "./shared";

export async function getSalesSummary(tx: Tx, companyId: string, range: Range) {
  const [row] = await tx
    .select({
      transactions: count(),
      gross: sql<string>`coalesce(sum(${sales.subtotal}), 0)`,
      discount: sql<string>`coalesce(sum(${sales.discountTotal}), 0)`,
      tax: sql<string>`coalesce(sum(${sales.taxTotal}), 0)`,
      total: sql<string>`coalesce(sum(${sales.total}), 0)`,
      cost: sql<string>`coalesce(sum(${sales.costTotal}), 0)`,
      returned: sql<string>`coalesce(sum(case when ${sales.status} = 'returned' then ${sales.total} else 0 end), 0)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        gte(sales.date, range.from),
        lte(sales.date, range.to),
        inArray(sales.status, ["completed", "returned"]),
      ),
    );

  const total = d(row?.total ?? 0);
  const cost = d(row?.cost ?? 0);
  return {
    transactions: row?.transactions ?? 0,
    gross: d(row?.gross ?? 0).toNumber(),
    discount: d(row?.discount ?? 0).toNumber(),
    tax: d(row?.tax ?? 0).toNumber(),
    total: total.toNumber(),
    cost: cost.toNumber(),
    profit: total.minus(row?.tax ?? 0).minus(cost).toNumber(),
    average: (row?.transactions ?? 0) > 0 ? total.toNumber() / (row?.transactions ?? 1) : 0,
  };
}

export async function getSalesByDay(tx: Tx, companyId: string, range: Range) {
  const rows = await tx
    .select({
      date: sales.date,
      total: sql<string>`coalesce(sum(${sales.total}), 0)`,
      transactions: count(),
    })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        gte(sales.date, range.from),
        lte(sales.date, range.to),
        inArray(sales.status, ["completed", "returned"]),
      ),
    )
    .groupBy(sales.date)
    .orderBy(asc(sales.date));
  return rows.map((r) => ({ date: r.date, total: d(r.total).toNumber(), transactions: r.transactions }));
}

export async function getSalesByCashier(tx: Tx, companyId: string, range: Range) {
  const rows = await tx
    .select({
      id: sales.cashierId,
      name: user.name,
      total: sql<string>`coalesce(sum(${sales.total}), 0)`,
      transactions: count(),
    })
    .from(sales)
    .leftJoin(user, eq(sales.cashierId, user.id))
    .where(
      and(
        eq(sales.companyId, companyId),
        gte(sales.date, range.from),
        lte(sales.date, range.to),
        inArray(sales.status, ["completed", "returned"]),
      ),
    )
    .groupBy(sales.cashierId, user.name)
    .orderBy(desc(sql`sum(${sales.total})`));
  return rows.map((r) => ({ id: r.id, name: r.name ?? "—", total: d(r.total).toNumber(), transactions: r.transactions }));
}

export async function getSalesByCategory(tx: Tx, companyId: string, range: Range, cashierId?: string) {
  const rows = await tx
    .select({
      name: categories.name,
      qty: sql<string>`coalesce(sum(${saleLines.qty}), 0)`,
      total: sql<string>`coalesce(sum(${saleLines.lineTotal} + ${saleLines.taxAmount}), 0)`,
      profit: sql<string>`coalesce(sum(${saleLines.lineTotal} - (${saleLines.unitCost} * ${saleLines.qty})), 0)`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(saleLines.saleId, sales.id))
    .leftJoin(products, eq(saleLines.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(saleLines.companyId, companyId),
        gte(sales.date, range.from),
        lte(sales.date, range.to),
        inArray(sales.status, ["completed", "returned"]),
        ...(cashierId ? [eq(sales.cashierId, cashierId)] : []),
      ),
    )
    .groupBy(categories.name)
    .orderBy(desc(sql`sum(${saleLines.lineTotal})`));
  return rows.map((r) => ({
    name: r.name ?? "Tanpa kategori",
    qty: d(r.qty).toNumber(),
    total: d(r.total).toNumber(),
    profit: d(r.profit).toNumber(),
  }));
}

export async function getTopProducts(tx: Tx, companyId: string, range: Range, limit = 10) {
  const rows = await tx
    .select({
      productId: saleLines.productId,
      name: saleLines.productName,
      sku: saleLines.productSku,
      qty: sql<string>`coalesce(sum(${saleLines.qty}), 0)`,
      total: sql<string>`coalesce(sum(${saleLines.lineTotal} + ${saleLines.taxAmount}), 0)`,
      profit: sql<string>`coalesce(sum(${saleLines.lineTotal} - (${saleLines.unitCost} * ${saleLines.qty})), 0)`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(saleLines.saleId, sales.id))
    .where(
      and(
        eq(saleLines.companyId, companyId),
        gte(sales.date, range.from),
        lte(sales.date, range.to),
        inArray(sales.status, ["completed", "returned"]),
      ),
    )
    .groupBy(saleLines.productId, saleLines.productName, saleLines.productSku)
    .orderBy(desc(sql`sum(${saleLines.lineTotal})`))
    .limit(limit);
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    qty: d(r.qty).toNumber(),
    total: d(r.total).toNumber(),
    profit: d(r.profit).toNumber(),
  }));
}

export async function getPaymentBreakdown(tx: Tx, companyId: string, range: Range) {
  const rows = await tx
    .select({
      methodId: salePayments.methodId,
      name: paymentMethods.name,
      type: paymentMethods.type,
      amount: sql<string>`coalesce(sum(${salePayments.amount}), 0)`,
      // A-21 Tahap R3-A (R3-01): fee yang dipotong kanal & neto yang
      // benar-benar masuk akun metode — rekonsiliasi terhadap mutasi
      // bank/QRIS memakai neto, bukan bruto.
      fee: sql<string>`coalesce(sum(${salePayments.feeAmount}), 0)`,
    })
    .from(salePayments)
    .innerJoin(sales, eq(salePayments.saleId, sales.id))
    .leftJoin(paymentMethods, eq(salePayments.methodId, paymentMethods.id))
    .where(
      and(
        eq(salePayments.companyId, companyId),
        gte(sales.date, range.from),
        lte(sales.date, range.to),
        inArray(sales.status, ["completed", "returned"]),
      ),
    )
    .groupBy(salePayments.methodId, paymentMethods.name, paymentMethods.type)
    .orderBy(desc(sql`sum(${salePayments.amount})`));
  return rows.map((r) => ({
    methodId: r.methodId,
    name: r.name ?? "—",
    type: r.type ?? "cash",
    amount: d(r.amount).toNumber(),
    fee: d(r.fee).toNumber(),
    net: d(r.amount).minus(d(r.fee)).toNumber(),
  }));
}

export async function listSales(tx: Tx, input: {
  companyId: string;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const conditions = [eq(sales.companyId, input.companyId)];
  if (input.status) conditions.push(eq(sales.status, input.status));
  if (input.from) conditions.push(gte(sales.date, input.from));
  if (input.to) conditions.push(lte(sales.date, input.to));
  if (input.q?.trim()) {
    const q = input.q.trim();
    conditions.push(or(ilike(sales.number, `%${q}%`), ilike(customers.name, `%${q}%`))!);
  }
  const where = and(...conditions);

  const [totalRow] = await tx
    .select({ value: count() })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(where);

  const rows = await tx
    .select({
      id: sales.id,
      number: sales.number,
      date: sales.date,
      createdAt: sales.createdAt,
      status: sales.status,
      paymentStatus: sales.paymentStatus,
      total: sales.total,
      paidTotal: sales.paidTotal,
      cashierName: user.name,
      customerName: customers.name,
      itemCount: sql<string>`(
        select coalesce(sum(sl.qty), 0) from sale_lines sl where sl.sale_id = ${sales.id}
      )`,
    })
    .from(sales)
    .leftJoin(user, eq(sales.cashierId, user.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(where)
    .orderBy(desc(sales.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows: rows.map((r) => ({ ...r, itemCount: Number(r.itemCount) })),
    total: totalRow?.value ?? 0,
    page,
    pageSize,
  };
}

export async function getSaleDetail(tx: Tx, companyId: string, saleId: string) {
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.companyId, companyId), eq(sales.id, saleId)))
    .limit(1);
  if (!sale) return null;

  const [rawLines, payments, customer, cashier] = await Promise.all([
    tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(asc(saleLines.lineNo)),
    tx
      .select({
        id: salePayments.id,
        amount: salePayments.amount,
        tendered: salePayments.tendered,
        reference: salePayments.reference,
        methodName: paymentMethods.name,
        methodType: paymentMethods.type,
      })
      .from(salePayments)
      .leftJoin(paymentMethods, eq(salePayments.methodId, paymentMethods.id))
      .where(eq(salePayments.saleId, saleId)),
    sale.customerId
      ? tx.select({ name: customers.name, phone: customers.phone, address: customers.address }).from(customers).where(eq(customers.id, sale.customerId)).limit(1)
      : Promise.resolve([]),
    tx.select({ name: user.name }).from(user).where(eq(user.id, sale.cashierId)).limit(1),
  ]);

  // S4: nama kemasan baris untuk tampilan bentuk masukan ("1 Dus") di
  // struk/faktur/retur — nama dibaca dari master kemasan (baris hanya
  // menyimpan id + faktor cuplikan; mengganti nama kemasan memang
  // berlaku untuk permukaan baca, sesuai aturan edit program).
  const packagingIds = [...new Set(rawLines.map((line) => line.packagingId).filter((id): id is string => Boolean(id)))];
  const packagingNames = new Map<string, string>();
  if (packagingIds.length > 0) {
    const packRows = await tx
      .select({ id: productPackagings.id, name: productPackagings.name })
      .from(productPackagings)
      .where(inArray(productPackagings.id, packagingIds));
    for (const row of packRows) packagingNames.set(row.id, row.name);
  }
  const lines = rawLines.map((line) => ({
    ...line,
    packagingName: line.packagingId ? (packagingNames.get(line.packagingId) ?? "Kemasan") : null,
  }));

  return { sale, lines, payments, customer: customer[0] ?? null, cashier: cashier[0] ?? null };
}

export async function listHeldSales(tx: Tx, companyId: string) {
  return tx
    .select({
      id: sales.id,
      number: sales.number,
      heldLabel: sales.heldLabel,
      // POS3-13: halaman ditahan menilai kepemilikan per baris untuk
      // menampilkan tombol hapus hanya kepada yang berhak.
      cashierId: sales.cashierId,
      createdAt: sales.createdAt,
      total: sales.total,
      customerName: customers.name,
      itemCount: sql<string>`(select coalesce(sum(sl.qty), 0) from sale_lines sl where sl.sale_id = ${sales.id})`,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(and(eq(sales.companyId, companyId), eq(sales.status, "held")))
    .orderBy(desc(sales.createdAt));
}
