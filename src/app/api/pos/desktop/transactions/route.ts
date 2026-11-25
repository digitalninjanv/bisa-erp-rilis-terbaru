import { createHash } from "node:crypto";
import { z } from "zod";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { todayISO } from "@/lib/format";
import { AppError, type AppErrorCode } from "@/lib/errors";
import { log } from "@/lib/log";
import { claimIdempotencyKey, readIdempotencyResultRef, writeIdempotencyResultRef } from "@/server/idempotency";
import { resolveMemberPermissions } from "@/server/member-permissions";
import { getSaleDetail, listSales } from "@/server/reports";
import { createSaleReturn, deleteHeldSale, getReturnedQtyBySaleLine, holdSale, listSaleReturnHistory, voidSale } from "@/server/pos";
import { POS_API_CORS_HEADERS, resolvePosDevice } from "@/server/pos-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ACTION_BODY_BYTES = 256 * 1024;
const DESKTOP_VOID_SCOPE = "pos.desktop_void.v1";

const APP_ERROR_STATUS: Partial<Record<AppErrorCode, number>> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
};

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= (daysInMonth[month - 1] ?? 0);
}, "Tanggal kalender tidak valid.");

const querySchema = z.object({
  saleId: z.string().uuid().optional(),
  q: z.string().trim().max(120).default(""),
  status: z.enum(["completed", "returned", "void", "held"]).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: "Tanggal awal tidak boleh sesudah tanggal akhir.",
  path: ["from"],
});

const returnQtySchema = z.union([
  z.string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  z.number().finite().positive(),
]);

const voidActionSchema = z.object({
  action: z.literal("void"),
  saleId: z.string().uuid(),
  // Optional while older installed desktop builds remain in circulation.
  idempotencyKey: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(300),
});

const returnActionSchema = z.object({
  action: z.literal("return"),
  saleId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  disposition: z.enum(["sellable", "write_off"]).default("sellable"),
  reason: z.string().trim().min(3).max(300),
  refundMethod: z.enum(["cash", "transfer", "store_credit", "exchange"]),
  type: z.enum(["return", "exchange"]),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    saleLineId: z.string().uuid().nullish(),
    qty: returnQtySchema,
    serialNumbers: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
  })).min(1).max(100),
}).refine(
  (input) => input.type === "exchange"
    ? input.refundMethod === "exchange"
    : input.refundMethod !== "exchange",
  {
    message: "Tipe retur dan metode pengembalian tidak cocok.",
    path: ["refundMethod"],
  },
);

const holdActionSchema = z.object({
  action: z.literal("hold"),
  idempotencyKey: z.string().min(10).max(120),
  warehouseId: z.string().uuid(),
  groupId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  label: z.string().trim().max(80).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.union([z.string(), z.number()]).transform(String),
    unitPrice: z.union([z.string(), z.number()]).optional(),
    discountType: z.enum(["percent", "nominal"]).nullish(),
    discountValue: z.union([z.string(), z.number()]).optional(),
    serialNumbers: z.array(z.string().min(1).max(80)).max(500).optional(),
    packagingId: z.string().uuid().nullish(),
  })).min(1).max(200),
});

const deleteHeldActionSchema = z.object({
  action: z.literal("deleteHeld"),
  saleId: z.string().uuid(),
});

const actionSchema = z.discriminatedUnion("action", [
  voidActionSchema,
  returnActionSchema,
  holdActionSchema,
  deleteHeldActionSchema,
]);

function jsonError(message: string, status: number, code = "ERROR") {
  return Response.json(
    { ok: false, code, message },
    { status, headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

async function readBoundedJson(request: Request): Promise<
  { kind: "ok"; value: unknown } | { kind: "invalid" } | { kind: "too_large" }
> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_ACTION_BODY_BYTES) return { kind: "too_large" };
  const reader = request.body?.getReader();
  if (!reader) return { kind: "invalid" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ACTION_BODY_BYTES) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { kind: "ok", value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: POS_API_CORS_HEADERS });
}

/** Riwayat dan detail transaksi POS untuk terminal desktop bertoken. */
export async function GET(request: Request) {
  const device = await resolvePosDevice(request);
  if (!device) return jsonError("Token perangkat tidak dikenal.", 401, "UNAUTHORIZED");

  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return jsonError("Filter riwayat transaksi tidak valid.", 400, "VALIDATION");

  try {
    const permissions = await resolveMemberPermissions(device.companyId, device.userId);
    if (!permissions?.includes("pos.sell")) {
      return jsonError("Akun terminal tidak lagi memiliki akses POS.", 403, "FORBIDDEN");
    }

    if (query.data.saleId) {
      const result = await withCompanyReadOnly(device.companyId, async (tx) => {
        const detail = await getSaleDetail(tx, device.companyId, query.data.saleId!);
        if (!detail) return null;
        const returned = await getReturnedQtyBySaleLine(tx, device.companyId, query.data.saleId!);
        const returns = await listSaleReturnHistory(tx, device.companyId, query.data.saleId!);
        const hasReturns = [...returned.values()].some((qty) => qty > 0);
        return {
          sale: {
            id: detail.sale.id,
            number: detail.sale.number,
            date: detail.sale.date,
            createdAt: detail.sale.createdAt,
            status: detail.sale.status,
            paymentStatus: detail.sale.paymentStatus,
            total: detail.sale.total,
            paidTotal: detail.sale.paidTotal,
            heldLabel: detail.sale.heldLabel,
          },
          lines: detail.lines.map((line) => {
            const isi = Number(line.isiSnapshot) || 1;
            const remainingBase = Math.max(0, Number(line.qty) - (returned.get(line.id) ?? 0));
            return {
              id: line.id,
              productId: line.productId,
              productName: line.productName,
              productSku: line.productSku,
              qty: line.qty,
              qtyInput: line.qtyInput,
              isiSnapshot: line.isiSnapshot,
              packagingId: line.packagingId,
              discountType: line.discountType,
              discountValue: line.discountValue,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              packagingName: line.packagingName,
              remainingQtyInput: remainingBase / isi,
            };
          }),
          payments: detail.payments.map((payment) => ({
            id: payment.id,
            amount: payment.amount,
            tendered: payment.tendered,
            reference: payment.reference,
            methodName: payment.methodName,
            methodType: payment.methodType,
          })),
          returns: returns.map((returnDocument) => ({
            ...returnDocument,
            createdAt: returnDocument.createdAt.toISOString(),
          })),
          customer: detail.customer ? { name: detail.customer.name, phone: detail.customer.phone } : null,
          cashier: detail.cashier,
          held: detail.sale.status === "held" ? {
            warehouseId: detail.sale.warehouseId,
            customerId: detail.sale.customerId,
            dueDate: detail.sale.dueDate,
            groupId: detail.sale.customerGroupId,
          } : null,
          canVoid: permissions.includes("pos.void") && detail.sale.status === "completed" && !hasReturns,
          canReturn: permissions.includes("pos.return")
            && detail.sale.status === "completed"
            && detail.lines.some((line) => {
              const alreadyReturned = returned.get(line.id) ?? 0;
              return Number(line.qty) - alreadyReturned > 0;
            }),
        };
      });
      if (!result) return jsonError("Transaksi tidak ditemukan.", 404, "NOT_FOUND");
      return Response.json({
        ok: true,
        data: {
          detail: result,
          permissions: { canVoid: result.canVoid, canReturn: result.canReturn },
        },
      }, { headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" } });
    }

    const result = await withCompanyReadOnly(device.companyId, (tx) => listSales(tx, {
      companyId: device.companyId,
      q: query.data.q,
      status: query.data.status,
      warehouseId: query.data.status === "held" ? device.warehouseId ?? undefined : undefined,
      from: query.data.from,
      to: query.data.to,
      page: query.data.page,
      pageSize: 50,
    }));
    return Response.json({
      ok: true,
      data: {
        ...result,
        canVoid: permissions.includes("pos.void"),
        canReturn: permissions.includes("pos.return"),
        canDeleteHeld: permissions.includes("pos.void"),
      },
    }, { headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonError(error.message, APP_ERROR_STATUS[error.code] ?? 400, error.code);
    }
    log.error("pos_device.transactions_read_failed", {
      companyId: device.companyId,
      terminalId: device.terminalId,
    }, error);
    return jsonError("Riwayat transaksi tidak dapat dimuat saat ini.", 500, "INTERNAL");
  }
}

/** Void dan retur tetap melewati domain server yang sama dengan POS web. */
export async function POST(request: Request) {
  const device = await resolvePosDevice(request);
  if (!device) return jsonError("Token perangkat tidak dikenal.", 401, "UNAUTHORIZED");

  const bodyResult = await readBoundedJson(request);
  if (bodyResult.kind === "too_large") {
    return jsonError("Ukuran permintaan transaksi melebihi 256 KB.", 413, "VALIDATION");
  }
  if (bodyResult.kind === "invalid") {
    return jsonError("Permintaan transaksi bukan JSON yang valid.", 400, "VALIDATION");
  }
  const parsed = actionSchema.safeParse(bodyResult.value);
  if (!parsed.success) return jsonError("Permintaan transaksi POS tidak valid.", 400, "VALIDATION");
  const action = parsed.data;

  try {
    const permissions = await resolveMemberPermissions(device.companyId, device.userId);
    if (!permissions) {
      return jsonError("Akun terminal tidak memiliki izin POS.", 403, "FORBIDDEN");
    }
    const permission = action.action === "void" ? "pos.void" : action.action === "return" ? "pos.return" : null;
    if (permission && !permissions.includes(permission)) {
      return jsonError(`Akun terminal tidak memiliki izin ${permission}.`, 403, "FORBIDDEN");
    }
    if (action.action !== "void" && action.action !== "return" && action.action !== "deleteHeld" && !permissions.includes("pos.sell")) {
      return jsonError("Akun terminal tidak memiliki izin pos.sell.", 403, "FORBIDDEN");
    }
    if (action.action === "deleteHeld" && !permissions.some((permission) => permission === "pos.sell" || permission === "pos.void")) {
      return jsonError("Akun terminal tidak memiliki izin untuk mengelola pesanan ditahan.", 403, "FORBIDDEN");
    }

    if (action.action === "void") {
      if (!action.idempotencyKey) {
        // Compatibility for already-installed desktop binaries. Current
        // clients always send a key and use the replay-safe path below.
        await withCompany(device.companyId, (tx) => voidSale(tx, {
          companyId: device.companyId,
          userId: device.userId,
          saleId: action.saleId,
          reason: action.reason,
        }));
        return Response.json({ ok: true, data: { saleId: action.saleId, status: "void" } }, {
          headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" },
        });
      }
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ saleId: action.saleId, reason: action.reason }))
        .digest("hex");
      const key = { companyId: device.companyId, key: action.idempotencyKey, scope: DESKTOP_VOID_SCOPE };
      const result = await withCompany(device.companyId, async (tx) => {
        const claimed = await claimIdempotencyKey(tx, key);
        if (!claimed) {
          const storedFingerprint = await readIdempotencyResultRef(tx, key);
          if (storedFingerprint === fingerprint) {
            return { saleId: action.saleId, status: "void" as const };
          }
          throw new AppError(
            "CONFLICT",
            "Permintaan void belum memiliki hasil yang dapat dipastikan atau kunci dipakai untuk rincian berbeda. Muat ulang nota sebelum mencoba lagi.",
          );
        }

        await voidSale(tx, {
          companyId: device.companyId,
          userId: device.userId,
          saleId: action.saleId,
          reason: action.reason,
        });
        await writeIdempotencyResultRef(tx, { ...key, resultRef: fingerprint });
        return { saleId: action.saleId, status: "void" as const };
      });
      return Response.json({ ok: true, data: result }, {
        headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" },
      });
    }

    if (action.action === "hold") {
      if (device.warehouseId && device.warehouseId !== action.warehouseId) {
        return jsonError("Pesanan harus memakai gudang yang ditetapkan untuk terminal ini.", 403, "FORBIDDEN");
      }
      const result = await withCompany(device.companyId, (tx) => holdSale(tx, {
        companyId: device.companyId,
        userId: device.userId,
        warehouseId: action.warehouseId,
        customerId: action.customerId ?? null,
        dueDate: action.dueDate ?? null,
        groupId: action.groupId ?? null,
        date: todayISO(),
        label: action.label,
        notes: action.notes,
        lines: action.lines,
        canDiscount: permissions.includes("pos.discount"),
        idempotencyKey: action.idempotencyKey,
      }));
      return Response.json({ ok: true, data: result }, {
        headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" },
      });
    }

    if (action.action === "deleteHeld") {
      await withCompany(device.companyId, (tx) =>
        deleteHeldSale(tx, {
          companyId: device.companyId,
          userId: device.userId,
          saleId: action.saleId,
          canDeleteAny: permissions.includes("pos.void"),
        }),
      );
      return Response.json({ ok: true, data: { saleId: action.saleId } }, {
        headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" },
      });
    }

    const result = await withCompany(device.companyId, (tx) => createSaleReturn(tx, {
      companyId: device.companyId,
      userId: device.userId,
      saleId: action.saleId,
      idempotencyKey: action.idempotencyKey,
      disposition: action.disposition,
      date: todayISO(),
      reason: action.reason,
      refundMethod: action.refundMethod,
      type: action.type,
      lines: action.lines,
    }));
    return Response.json({ ok: true, data: result }, {
      headers: { ...POS_API_CORS_HEADERS, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonError(error.message, APP_ERROR_STATUS[error.code] ?? 400, error.code);
    }
    log.error("pos_device.transaction_action_failed", {
      companyId: device.companyId,
      terminalId: device.terminalId,
      action: action.action,
    }, error);
    return jsonError("Transaksi tidak dapat diproses saat ini.", 500, "INTERNAL");
  }
}
