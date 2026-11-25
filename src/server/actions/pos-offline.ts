"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { can } from "@/lib/permissions";
import { requirePermission, requirePermissionInModule } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import {
  resolveOriginEntitlement,
  type OriginEntitlement,
} from "@/server/member-permissions";
import {
  assertOfflineEnabled,
  getOfflineReviewOriginCashierId,
  listOfflineReviewQueue,
  postOfflineReviewItem,
  processOfflineSaleItem,
  resolveOfflineOutboxItem,
} from "@/server/pos-offline";
import { posSyncRequestSchema } from "@/server/pos-device";
import type { OfflineSalePayload } from "@/lib/pos-offline";

/**
 * SIM-2 S7B-2 Batch 6 + FIX-POS Tahap 2 — Actions sinkronisasi
 * offline POS (§12). Setiap item diproses dalam transaksinya sendiri
 * agar satu item bermasalah tidak menggagalkan item lain.
 *
 * Plafon 50 item per panggilan adalah batas SATU request (POS3-16):
 * klien mengirim antrean berpotong 25 item sampai habis (POS3-01),
 * jadi antrean sebesar apa pun tersinkron — penolakan per panggilan
 * tidak lagi berarti antrean buntu selamanya.
 *
 * Identitas asal (POS3-02): hak kasir asal setiap item diresolusi di
 * sini dari keanggotaan perusahaan (`resolveOriginEntitlement`) dan
 * diteruskan ke domain; penyinkron sendiri hanya perlu `pos.sell`.
 * Tindakan peninjauan yang mengubah keadaan (posting penyelesaian,
 * tandai selesai, buang) mensyaratkan izin supervisor `pos.void`
 * (POS3-03/POS3-06) dan selalu teraudit.
 */

// POS Native Langkah 1: skema muatan kini SATU definisi bersama di
// server/pos-device (dipakai juga endpoint perangkat /api/pos/sync)
// agar kontrak idempoten kedua jalur tidak pernah menyimpang.
const syncSchema = posSyncRequestSchema;

/** Resolusi hak semua kasir asal berbeda dalam satu batch/panggilan. */
async function resolveEntitlements(
  companyId: string,
  cashierIds: Array<string | null | undefined>,
): Promise<Record<string, OriginEntitlement | null>> {
  const unique = [...new Set(cashierIds.filter((id): id is string => Boolean(id)))];
  const result: Record<string, OriginEntitlement | null> = {};
  for (const cashierId of unique) {
    result[cashierId] = await resolveOriginEntitlement(companyId, cashierId);
  }
  return result;
}

export async function syncOfflineSalesAction(input: z.input<typeof syncSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.sell", "pos");
    const data = parseInput(syncSchema, input);
    await withCompany(ctx.company.id, (tx) => assertOfflineEnabled(tx, ctx.company.id));
    const originEntitlements = await resolveEntitlements(
      ctx.company.id,
      data.items.map((item) => item.cashierId),
    );
    const results = [];
    for (const item of data.items) {
      const result = await withCompany(ctx.company.id, (tx) =>
        processOfflineSaleItem(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          canDiscount: can(ctx, "pos.discount"),
          allowCrossCashier: can(ctx, "pos.void"),
          originEntitlements,
          item: item as OfflineSalePayload,
          reconcileWebCheckout: true,
        }),
      );
      results.push(result);
    }
    revalidatePath("/app/pos");
    revalidatePath("/app/pos/offline");
    return results;
  });
}

export async function listOfflineReviewAction() {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    return withCompany(ctx.company.id, (tx) =>
      listOfflineReviewQueue(tx, ctx.company.id, {
        includePayload: can(ctx, "pos.void"),
      }),
    );
  });
}

const postReviewSchema = z.object({
  outboxId: z.string().uuid(),
  mode: z.enum(["retry", "settle"]),
});

/**
 * FIX-POS Tahap 2 (POS3-03/04): posting sah dari daftar peninjauan.
 * `retry` menjalankan ulang sinkronisasi normal; `settle` adalah
 * penyelesaian supervisor pada harga struk offline / ke sesi asal
 * yang sudah tertutup. Keduanya bergerbang `pos.void` dan teraudit.
 */
export async function postOfflineReviewItemAction(input: z.input<typeof postReviewSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(postReviewSchema, input);
    const outcome = await withCompany(ctx.company.id, async (tx) => {
      const originCashierId = await getOfflineReviewOriginCashierId(
        tx,
        ctx.company.id,
        data.outboxId,
      );
      const originEntitlements = await resolveEntitlements(ctx.company.id, [
        originCashierId ?? ctx.user.id,
      ]);
      const result = await postOfflineReviewItem(tx, {
        companyId: ctx.company.id,
        actorId: ctx.user.id,
        outboxId: data.outboxId,
        mode: data.mode,
        originEntitlements,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.mode === "settle" ? "pos_offline.settle" : "pos_offline.review_post",
        entityType: "outbox",
        entityId: data.outboxId,
        after: {
          mode: data.mode,
          status: result.status ?? null,
          saleId: result.saleId ?? null,
          saleNumber: result.saleNumber ?? null,
          overageAbsorbed: result.overageAbsorbed ?? null,
          originCashierId,
        },
      });
      return result;
    });
    revalidatePath("/app/pos");
    revalidatePath("/app/pos/offline");
    return outcome;
  });
}

const resolveSchema = z.object({
  outboxId: z.string().uuid(),
  resolution: z.enum(["done", "discarded"]),
  note: z.string().max(300).optional(),
});

export async function resolveOfflineOutboxAction(input: z.input<typeof resolveSchema>) {
  return guard(async () => {
    // POS3-06: menandai selesai / membuang item peninjauan menghapus
    // jejak server satu-satunya dari penjualan yang belum tercatat —
    // tindakan setara supervisor, bukan hak kasir biasa.
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(resolveSchema, input);
    const row = await withCompany(ctx.company.id, async (tx) => {
      const resolved = await resolveOfflineOutboxItem(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        outboxId: data.outboxId,
        resolution: data.resolution,
        note: data.note ?? null,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos_offline.resolve",
        entityType: "outbox",
        entityId: resolved.id,
        after: { resolution: data.resolution, note: data.note ?? null },
      });
      return resolved;
    });
    revalidatePath("/app/pos/offline");
    return row;
  });
}
