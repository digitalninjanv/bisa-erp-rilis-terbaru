import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { auditLog, user } from "@/db/schema";

/**
 * SIM-2 S7 (REM-03, menutup SEC-09 untuk permukaan per-record): riwayat
 * perubahan SATU record master dari audit_log — terfilter tepat per
 * (entityType, entityId), terbaru dulu, berpaginasi server. Dipakai
 * seksi "Riwayat perubahan" di detail produk & akun (penampil pihak
 * punya jalurnya sendiri di master-data.ts).
 */
export async function listEntityAuditTrail(
  tx: Tx,
  companyId: string,
  entityType: string,
  entityId: string,
  opts: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const where = and(
    eq(auditLog.companyId, companyId),
    eq(auditLog.entityType, entityType),
    eq(auditLog.entityId, entityId),
  );
  const [totalRow] = await tx.select({ value: count() }).from(auditLog).where(where);
  const rows = await tx
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      userId: auditLog.userId,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total: totalRow?.value ?? 0, page, pageSize };
}

export async function writeAudit(
  tx: Tx,
  input: {
    companyId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    requestId?: string;
    ip?: string;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    companyId: input.companyId,
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    requestId: input.requestId,
    ip: input.ip,
  });
}

export type CompanyAuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: Date;
};

/**
 * Audit trail tingkat perusahaan (bukan per record). Sumbernya audit_log
 * yang sama dengan seksi riwayat per master — menampilkan aktor, aksi,
 * entitas, perubahan before/after, dan alamat IP. Filter tanggal
 * memakai waktu lokal perusahaan (WIB) agar konsisten dengan layar.
 */
export async function listCompanyAuditTrail(
  tx: Tx,
  companyId: string,
  opts: {
    from?: string;
    to?: string;
    action?: string;
    entityType?: string;
    userId?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const conditions = [eq(auditLog.companyId, companyId)];
  if (opts.from) {
    conditions.push(gte(auditLog.createdAt, new Date(`${opts.from}T00:00:00+07:00`)));
  }
  if (opts.to) {
    conditions.push(lte(auditLog.createdAt, new Date(`${opts.to}T23:59:59.999+07:00`)));
  }
  if (opts.action) conditions.push(eq(auditLog.action, opts.action));
  if (opts.entityType) conditions.push(eq(auditLog.entityType, opts.entityType));
  if (opts.userId) conditions.push(eq(auditLog.userId, opts.userId));
  const where = and(...conditions);

  const [totalRow] = await tx.select({ value: count() }).from(auditLog).where(where);
  const rows = await tx
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      userId: auditLog.userId,
      userName: user.name,
      before: auditLog.before,
      after: auditLog.after,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [actions, entityTypes, actors] = await Promise.all([
    tx
      .selectDistinct({ value: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.companyId, companyId))
      .orderBy(auditLog.action),
    tx
      .selectDistinct({ value: auditLog.entityType })
      .from(auditLog)
      .where(eq(auditLog.companyId, companyId))
      .orderBy(auditLog.entityType),
    tx
      .selectDistinct({ id: auditLog.userId, name: user.name })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.userId, user.id))
      .where(eq(auditLog.companyId, companyId))
      .orderBy(user.name),
  ]);

  return {
    rows: rows as CompanyAuditRow[],
    total: totalRow?.value ?? 0,
    page,
    pageSize,
    actions: actions.map((row) => row.value),
    entityTypes: entityTypes.map((row) => row.value),
    actors: actors.filter((row): row is { id: string; name: string } => Boolean(row.id && row.name)),
  };
}
