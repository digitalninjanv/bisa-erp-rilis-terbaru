import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  departments,
  employees,
  products,
  purchaseRequestLines,
  purchaseRequests,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  LIST_PAGE_SIZE,
  normalizePageParams,
  pageOffset,
  pageResult,
  type PageResult,
} from "@/lib/pagination";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { nextDocumentNumber } from "@/server/sequences";
import { createPurchaseOrder } from "./purchasing";
import { getCompanySettingsRow } from "@/server/settings";

/**
 * SIM-2 S7B-2 Batch 3 — Purchase Request (PR) formal.
 *
 * Alur: submitted → approved/rejected → converted (satu kali, menjadi
 * satu PO lewat jalur createPurchaseOrder yang sama). Persetujuan
 * maker-checker (penyetuju ≠ pembuat). Ambang persetujuan dari
 * konfigurasi perusahaan (`pr_approval_threshold`): bila total
 * perkiraan MELEBIHI ambang, penyetuju wajib peran senior
 * (owner/admin/manager). Di bawah/di luar ambang, pemegang izin
 * purchasing yang bukan pembuat boleh mengesahkan.
 */

export const PR_STATUS_LABELS: Record<string, string> = {
  submitted: "Diajukan",
  approved: "Disahkan",
  rejected: "Ditolak",
  converted: "Terkonversi ke PO",
};

const SENIOR_ROLES = new Set(["owner", "admin", "manager"]);

export type PurchaseRequestLineInput = {
  productId: string;
  qty: MoneyInput;
  estimatedPrice: MoneyInput;
  reason?: string | null;
};

export async function createPurchaseRequest(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    requesterEmployeeId?: string | null;
    departmentId?: string | null;
    date: string;
    notes?: string | null;
    lines: PurchaseRequestLineInput[];
  },
) {
  if (input.lines.length === 0) {
    throw new AppError("VALIDATION", "PR wajib memiliki minimal satu baris.");
  }
  if (input.requesterEmployeeId) {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.companyId, input.companyId), eq(employees.id, input.requesterEmployeeId)))
      .limit(1);
    if (!employee) throw new AppError("VALIDATION", "Karyawan peminta tidak ditemukan.");
  }
  if (input.departmentId) {
    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.companyId, input.companyId), eq(departments.id, input.departmentId)))
      .limit(1);
    if (!department) throw new AppError("VALIDATION", "Departemen tidak ditemukan.");
  }
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  if (productIds.length !== input.lines.length) {
    throw new AppError("VALIDATION", "Produk yang sama muncul lebih dari sekali dalam satu PR.");
  }
  const found = await tx
    .select({ id: products.id, name: products.name, sku: products.sku })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  if (found.length !== productIds.length) {
    throw new AppError("VALIDATION", "Ada produk yang tidak ditemukan.");
  }
  const productById = new Map(found.map((row) => [row.id, row]));

  let total = d(0);
  const lineValues = input.lines.map((line) => {
    const qty = d(line.qty);
    const price = d(line.estimatedPrice);
    if (qty.lte(0)) throw new AppError("VALIDATION", "Qty baris PR harus lebih dari nol.");
    if (price.lt(0)) throw new AppError("VALIDATION", "Perkiraan harga tidak boleh negatif.");
    const lineTotal = qty.mul(price);
    total = total.plus(lineTotal);
    const product = productById.get(line.productId)!;
    return {
      companyId: input.companyId,
      requestId: "",
      productId: line.productId,
      productName: product.name,
      productSku: product.sku,
      qty: toDb(qty),
      estimatedPrice: toDb(price),
      lineTotal: toDb(lineTotal),
      reason: line.reason ?? null,
    };
  });

  const number = await nextDocumentNumber(tx, input.companyId, "PURCHASE_REQUEST", input.date);
  const [request] = await tx
    .insert(purchaseRequests)
    .values({
      companyId: input.companyId,
      number,
      requesterEmployeeId: input.requesterEmployeeId ?? null,
      departmentId: input.departmentId ?? null,
      date: input.date,
      totalEstimate: toDb(total),
      notes: input.notes ?? null,
      createdBy: input.userId,
    })
    .returning();
  await tx.insert(purchaseRequestLines).values(
    lineValues.map((line) => ({ ...line, requestId: request.id })),
  );
  return request;
}

export async function decidePurchaseRequest(
  tx: Tx,
  input: {
    companyId: string;
    actor: { userId: string; role: string };
    requestId: string;
    approve: boolean;
    note?: string | null;
  },
) {
  const [request] = await tx
    .select()
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.companyId, input.companyId), eq(purchaseRequests.id, input.requestId)))
    .limit(1)
    .for("update");
  if (!request) throw new AppError("NOT_FOUND", "Purchase Request tidak ditemukan.");
  if (request.status !== "submitted") {
    throw new AppError("CONFLICT", "PR ini sudah diputuskan dan tidak bisa diputuskan ulang.");
  }
  if (request.createdBy && request.createdBy === input.actor.userId) {
    throw new AppError("FORBIDDEN", "Pembuat PR tidak boleh mengesahkan PR-nya sendiri (maker-checker).");
  }
  if (!input.approve && (!input.note || input.note.trim().length < 3)) {
    throw new AppError("VALIDATION", "Penolakan PR wajib disertai alasan.");
  }
  if (input.approve) {
    const settings = await getCompanySettingsRow(tx, input.companyId);
    const threshold = settings?.prApprovalThreshold ? d(settings.prApprovalThreshold) : null;
    if (threshold && d(request.totalEstimate).gt(threshold) && !SENIOR_ROLES.has(input.actor.role)) {
      throw new AppError(
        "FORBIDDEN",
        "Total PR melebihi ambang persetujuan perusahaan — pengesahan wajib peran owner/admin/manager.",
      );
    }
  }
  const [updated] = await tx
    .update(purchaseRequests)
    .set({
      status: input.approve ? "approved" : "rejected",
      decidedBy: input.actor.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    })
    .where(and(eq(purchaseRequests.companyId, input.companyId), eq(purchaseRequests.id, input.requestId)))
    .returning();
  return updated;
}

export async function convertPurchaseRequestToPo(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    requestId: string;
    supplierId: string;
    date: string;
    expectedDate?: string | null;
  },
) {
  const [request] = await tx
    .select()
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.companyId, input.companyId), eq(purchaseRequests.id, input.requestId)))
    .limit(1)
    .for("update");
  if (!request) throw new AppError("NOT_FOUND", "Purchase Request tidak ditemukan.");
  if (request.status === "converted") {
    throw new AppError("CONFLICT", "PR ini sudah dikonversi menjadi PO dan tidak bisa dikonversi lagi.");
  }
  if (request.status !== "approved") {
    throw new AppError("CONFLICT", "Hanya PR berstatus Disahkan yang dapat dikonversi menjadi PO.");
  }
  const lines = await tx
    .select()
    .from(purchaseRequestLines)
    .where(and(eq(purchaseRequestLines.companyId, input.companyId), eq(purchaseRequestLines.requestId, input.requestId)))
    .orderBy(asc(purchaseRequestLines.id));
  if (lines.length === 0) throw new AppError("VALIDATION", "PR tidak memiliki baris untuk dikonversi.");

  const po = await createPurchaseOrder(tx, {
    companyId: input.companyId,
    userId: input.userId,
    supplierId: input.supplierId,
    date: input.date,
    expectedDate: input.expectedDate ?? null,
    notes: `Dari PR ${request.number}`,
    lines: lines.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      unitCost: line.estimatedPrice,
    })),
  });
  await tx
    .update(purchaseRequests)
    .set({ status: "converted", convertedPoId: po.id })
    .where(and(eq(purchaseRequests.companyId, input.companyId), eq(purchaseRequests.id, input.requestId)));
  return po;
}

export async function listPurchaseRequests(tx: Tx, companyId: string) {
  const rows = await tx
    .select({
      request: purchaseRequests,
      requesterName: employees.name,
      departmentName: departments.name,
    })
    .from(purchaseRequests)
    .leftJoin(employees, eq(purchaseRequests.requesterEmployeeId, employees.id))
    .leftJoin(departments, eq(purchaseRequests.departmentId, departments.id))
    .where(eq(purchaseRequests.companyId, companyId))
    .orderBy(asc(purchaseRequests.date));
  return rows.map((row) => ({
    ...row.request,
    requesterName: row.requesterName,
    departmentName: row.departmentName,
  }));
}

/**
 * G3 (TBL-01): bacaan TERPAGINASI untuk halaman daftar PR — urutan
 * tampil terbaru dulu (tanggal desc, nomor desc sebagai ikatan
 * deterministik), menggantikan pola lama "baca semua lalu balik di
 * memori". KPI halaman tidak lagi dihitung dari daftar penuh:
 * pasangannya `countPurchaseRequestsByStatus` di bawah.
 */
export async function listPurchaseRequestsPage(
  tx: Tx,
  companyId: string,
  opts?: { page?: number; pageSize?: number },
): Promise<PageResult<Awaited<ReturnType<typeof listPurchaseRequests>>[number]>> {
  const { page, pageSize } = normalizePageParams(opts ?? {}, LIST_PAGE_SIZE);
  const where = eq(purchaseRequests.companyId, companyId);
  const [totalRow] = await tx.select({ value: count() }).from(purchaseRequests).where(where);
  const rows = await tx
    .select({
      request: purchaseRequests,
      requesterName: employees.name,
      departmentName: departments.name,
    })
    .from(purchaseRequests)
    .leftJoin(employees, eq(purchaseRequests.requesterEmployeeId, employees.id))
    .leftJoin(departments, eq(purchaseRequests.departmentId, departments.id))
    .where(where)
    .orderBy(desc(purchaseRequests.date), desc(purchaseRequests.number))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));
  return pageResult(
    rows.map((row) => ({
      ...row.request,
      requesterName: row.requesterName,
      departmentName: row.departmentName,
    })),
    totalRow?.value ?? 0,
    page,
    pageSize,
  );
}

/** G3 (TBL-01): hitungan KPI daftar PR per status (agregasi server). */
export async function countPurchaseRequestsByStatus(
  tx: Tx,
  companyId: string,
): Promise<Record<string, number>> {
  const rows = await tx
    .select({ status: purchaseRequests.status, value: count() })
    .from(purchaseRequests)
    .where(eq(purchaseRequests.companyId, companyId))
    .groupBy(purchaseRequests.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.value]));
}

export async function getPurchaseRequest(tx: Tx, companyId: string, requestId: string) {
  const [request] = await tx
    .select()
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.companyId, companyId), eq(purchaseRequests.id, requestId)))
    .limit(1);
  if (!request) return null;
  const lines = await tx
    .select()
    .from(purchaseRequestLines)
    .where(and(eq(purchaseRequestLines.companyId, companyId), eq(purchaseRequestLines.requestId, requestId)))
    .orderBy(asc(purchaseRequestLines.id));
  return { ...request, lines };
}

// FIX-ARS Tahap 6 (ARS1-01): opsi produk untuk formulir PR — dulu kueri
// inline di halaman daftar purchase request.
export async function listPurchaseRequestProductOptions(tx: Tx, companyId: string) {
  return tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
    })
    .from(products)
    .where(eq(products.companyId, companyId))
    .orderBy(asc(products.name));
}
