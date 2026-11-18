import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, cashSessions, warehouses } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import {
  resolveMemberPermissions,
  resolveOriginEntitlement,
} from "@/server/member-permissions";
import {
  claimIdempotencyKey,
  readIdempotencyResultRef,
  writeIdempotencyResultRef,
} from "@/server/idempotency";
import { cashDrawerMovement, closeCashSession, openCashSession } from "./sessions";
import { recordTerminalSessionClose } from "./terminals";
import type { PosDeviceIdentity, PosSessionIntent } from "./device-contract";

export type PosSessionIntentResult = {
  clientKey: string;
  status: "recorded" | "duplicate" | "needsReview";
  message?: string;
};

const POS_DEVICE_CASH_MOVEMENT_SCOPE = "pos.desktop_cash_movement.v1";
const POS_DEVICE_CASH_MOVEMENT_RESULT = "pos-desktop-cash-movement-result";

/** Saldo kas server untuk pratinjau tutup sesi terminal. Nilai dibaca
 * dari buku mutasi kas resmi, termasuk refund/retur yang diproses di server. */
export async function getPosDeviceCashSessionSummary(
  device: PosDeviceIdentity,
  sessionId: string,
) {
  const entitlement = await resolveOriginEntitlement(device.companyId, device.userId);
  if (!entitlement?.canSell) {
    throw new AppError("FORBIDDEN", "Akun ini tidak lagi memiliki izin POS.");
  }
  const permissions = await resolveMemberPermissions(device.companyId, device.userId);
  if (!permissions?.includes("pos.session")) {
    throw new AppError("FORBIDDEN", "Akun ini tidak memiliki izin untuk mengelola sesi kas POS.");
  }

  return withCompanyReadOnly(device.companyId, async (tx) => {
    const [session] = await tx
      .select({ id: cashSessions.id, status: cashSessions.status })
      .from(cashSessions)
      .where(and(
        eq(cashSessions.companyId, device.companyId),
        eq(cashSessions.userId, device.userId),
        eq(cashSessions.id, sessionId),
      ))
      .limit(1);
    if (!session) return null;

    const [movement] = await tx
      .select({ expectedCash: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
      .from(cashMovements)
      .where(and(
        eq(cashMovements.companyId, device.companyId),
        eq(cashMovements.sessionId, session.id),
      ));

    return {
      sessionId: session.id,
      status: session.status,
      expectedCash: movement?.expectedCash ?? "0",
    };
  });
}

async function recordPosDeviceCashMovement(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    clientKey: string;
    warehouseId: string;
    sessionId: string;
    type: "deposit" | "withdrawal";
    amount: number;
    notes: string;
    run: () => Promise<void>;
  },
): Promise<"recorded" | "duplicate"> {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([
      input.userId,
      input.warehouseId,
      input.sessionId,
      input.type,
      input.amount,
      input.notes.trim(),
    ]))
    .digest("hex");
  const claimed = await claimIdempotencyKey(tx, {
    companyId: input.companyId,
    key: input.clientKey,
    scope: POS_DEVICE_CASH_MOVEMENT_SCOPE,
  });
  if (!claimed) {
    const resultRef = await readIdempotencyResultRef(tx, {
      companyId: input.companyId,
      scope: POS_DEVICE_CASH_MOVEMENT_SCOPE,
      key: input.clientKey,
    });
    let stored: unknown;
    try {
      stored = JSON.parse(resultRef ?? "");
    } catch {
      throw new AppError("CONFLICT", "Hasil mutasi kas belum tersimpan. Muat ulang sebelum mencoba lagi.");
    }
    if (
      !stored || typeof stored !== "object" ||
      !("type" in stored) || stored.type !== POS_DEVICE_CASH_MOVEMENT_RESULT ||
      !("fingerprint" in stored) || stored.fingerprint !== fingerprint ||
      !("result" in stored) || stored.result !== "recorded"
    ) {
      throw new AppError("CONFLICT", "Kunci mutasi kas sudah digunakan untuk data yang berbeda.");
    }
    return "duplicate";
  }

  await input.run();
  await writeIdempotencyResultRef(tx, {
    companyId: input.companyId,
    scope: POS_DEVICE_CASH_MOVEMENT_SCOPE,
    key: input.clientKey,
    resultRef: JSON.stringify({
      type: POS_DEVICE_CASH_MOVEMENT_RESULT,
      fingerprint,
      result: "recorded",
    }),
  });
  return "recorded";
}

/** Sinkronkan siklus sesi lokal sebagai sesi kas server nyata. ID sesi
 * lokal dipertahankan, sehingga penjualan offline tetap tertaut pada
 * pemilik sesi dan jurnal penutup hanya dibuat satu kali. */
export async function syncPosDeviceSessionIntents(
  device: PosDeviceIdentity,
  intents: PosSessionIntent[],
): Promise<PosSessionIntentResult[]> {
  const results: PosSessionIntentResult[] = [];
  for (const intent of intents) {
    try {
      const status = await withCompany(device.companyId, async (tx) => {
        if (intent.action === "open" && intent.cashierId !== device.userId) {
          throw new AppError(
            "FORBIDDEN",
            "Sesi terminal harus dimiliki oleh kasir yang terdaftar pada perangkat ini.",
          );
        }
        if (intent.action === "close" && intent.cashierId && intent.cashierId !== device.userId) {
          throw new AppError(
            "FORBIDDEN",
            "Sesi terminal harus dimiliki oleh kasir yang terdaftar pada perangkat ini.",
          );
        }
        if (intent.action === "movement" && intent.cashierId !== device.userId) {
          throw new AppError(
            "FORBIDDEN",
            "Mutasi kas terminal harus dilakukan oleh kasir yang terdaftar pada perangkat ini.",
          );
        }
        const entitlement = await resolveOriginEntitlement(device.companyId, device.userId);
        if (!entitlement?.canSell) {
          throw new AppError("FORBIDDEN", "Akun ini tidak lagi memiliki izin penjualan POS.");
        }
        const permissions = await resolveMemberPermissions(device.companyId, device.userId);
        if (!permissions?.includes("pos.session")) {
          throw new AppError("FORBIDDEN", "Akun ini tidak memiliki izin untuk mengelola sesi kas POS.");
        }

        if (intent.action === "open") {
          const [warehouse] = await tx
            .select({ id: warehouses.id })
            .from(warehouses)
            .where(and(eq(warehouses.companyId, device.companyId), eq(warehouses.id, intent.warehouseId)))
            .limit(1);
          if (!warehouse || (device.warehouseId && intent.warehouseId !== device.warehouseId)) {
            throw new AppError("VALIDATION", "Gudang sesi tidak sesuai dengan gudang terminal.");
          }
          const [existing] = await tx
            .select({ id: cashSessions.id, userId: cashSessions.userId })
            .from(cashSessions)
            .where(
              and(
                eq(cashSessions.companyId, device.companyId),
                eq(cashSessions.id, intent.localSessionId),
              ),
            )
            .limit(1);
          if (existing) {
            if (existing.userId !== device.userId) {
              throw new AppError("CONFLICT", "ID sesi lokal sudah dipakai oleh kasir lain.");
            }
            return "duplicate" as const;
          }
          await openCashSession(tx, {
            companyId: device.companyId,
            userId: device.userId,
            openingCash: intent.openingCash,
            sessionId: intent.localSessionId,
            openedAt: intent.openedAt,
          });
          return "recorded" as const;
        }

        if (intent.action === "movement") {
          const [warehouse] = await tx
            .select({ id: warehouses.id })
            .from(warehouses)
            .where(and(eq(warehouses.companyId, device.companyId), eq(warehouses.id, intent.warehouseId)))
            .limit(1);
          if (!warehouse || (device.warehouseId && intent.warehouseId !== device.warehouseId)) {
            throw new AppError("VALIDATION", "Gudang mutasi tidak sesuai dengan gudang terminal.");
          }
          const status = await recordPosDeviceCashMovement(tx, {
            companyId: device.companyId,
            userId: device.userId,
            clientKey: intent.clientKey,
            warehouseId: intent.warehouseId,
            sessionId: intent.localSessionId,
            type: intent.movementType,
            amount: intent.amount,
            notes: intent.notes,
            run: async () => {
              const [session] = await tx
                .select({ id: cashSessions.id, userId: cashSessions.userId, status: cashSessions.status })
                .from(cashSessions)
                .where(and(
                  eq(cashSessions.companyId, device.companyId),
                  eq(cashSessions.id, intent.localSessionId),
                ))
                .limit(1)
                .for("update");
              if (!session || session.userId !== device.userId) {
                throw new AppError("NOT_FOUND", "Sesi kas terminal untuk mutasi tidak ditemukan.");
              }
              if (session.status !== "open") {
                throw new AppError("INVALID_STATE", "Sesi kas terminal sudah ditutup; mutasi tidak dapat dicatat.");
              }
              await cashDrawerMovement(tx, {
                companyId: device.companyId,
                userId: device.userId,
                sessionId: session.id,
                type: intent.movementType,
                amount: intent.amount,
                notes: intent.notes,
              });
            },
          });
          return status;
        }

        const [serverSession] = await tx
          .select({ id: cashSessions.id, userId: cashSessions.userId, status: cashSessions.status })
          .from(cashSessions)
          .where(
            and(
              eq(cashSessions.companyId, device.companyId),
              eq(cashSessions.id, intent.localSessionId),
            ),
          )
          .limit(1)
          .for("update");
        if (!serverSession || serverSession.userId !== device.userId) {
          throw new AppError("NOT_FOUND", "Sesi kas server untuk penutupan terminal tidak ditemukan.");
        }
        if (serverSession.status === "open") {
          await closeCashSession(tx, {
            companyId: device.companyId,
            userId: device.userId,
            sessionId: serverSession.id,
            countedCash: intent.countedCash,
            notes: "Ditutup dari terminal POS desktop.",
            differenceReason: intent.differenceReason ?? undefined,
          });
        }
        return recordTerminalSessionClose(tx, {
          companyId: device.companyId,
          terminalId: device.terminalId,
          intent,
        });
      });
      results.push({ clientKey: intent.clientKey, status });
    } catch (error) {
      if (error instanceof AppError) {
        results.push({
          clientKey: intent.clientKey,
          status: "needsReview",
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }
  return results;
}
