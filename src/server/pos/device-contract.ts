import { z } from "zod";

// Kontrak sinkronisasi POS desktop dan terminal browser lama. Validasi
// ini tetap satu definisi agar kedua jalur menerima payload yang sama.
export type PosDeviceIdentity = {
  companyId: string;
  userId: string;
  label: string | null;
  /** Terminal registry pemilik token. */
  terminalId: string;
  terminalName: string;
  /** Gudang terminal dari registry; null = gudang bawaan perusahaan. */
  warehouseId: string | null;
};

export const posSyncItemSchema = z.object({
  clientKey: z.string().min(8).max(120),
  warehouseId: z.string().uuid(),
  heldSaleId: z.string().uuid().nullish(),
  groupId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  reservationId: z.string().uuid().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cashierId: z.string().min(1).max(128).nullish(),
  originSessionId: z.string().uuid().nullish(),
  deviceId: z.string().max(80).nullish(),
  expectedTotal: z.number().nonnegative().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().positive(),
        discountType: z.enum(["percent", "nominal"]).nullish(),
        discountValue: z.number().optional(),
        serialNumbers: z.array(z.string().min(1).max(80)).max(500).optional(),
        unitPrice: z.number().nonnegative().optional(),
        packagingId: z.string().uuid().nullish(),
        isiSnapshot: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(200),
  payments: z
    .array(
      z.object({
        methodId: z.string().uuid(),
        amount: z.number().nonnegative(),
        tendered: z.number().nonnegative(),
        reference: z.string().max(80).optional(),
        fee: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
  queuedAt: z.string().max(40),
});

const posSessionOpenIntentSchema = z.object({
  action: z.literal("open"),
  clientKey: z.string().min(8).max(120),
  warehouseId: z.string().uuid(),
  cashierId: z.string().min(1).max(128),
  localSessionId: z.string().uuid(),
  openedAt: z.string().datetime(),
  openingCash: z.number().finite().nonnegative(),
  terminalId: z.string().min(1).max(128).nullish(),
  terminalName: z.string().max(120).nullish(),
});

const posSessionCloseIntentSchema = z.object({
  action: z.literal("close").default("close"),
  clientKey: z.string().min(8).max(120),
  warehouseId: z.string().uuid(),
  cashierId: z.string().min(1).max(128).nullish(),
  localSessionId: z.string().min(1).max(120),
  openedAt: z.string().max(40).nullish(),
  closedAt: z.string().max(40),
  openingCash: z.number(),
  expectedCash: z.number(),
  countedCash: z.number(),
  difference: z.number(),
  denominations: z
    .array(
      z.object({
        denomination: z.string().max(24),
        count: z.number().int().nonnegative(),
      }),
    )
    .max(24)
    .nullish(),
  differenceReason: z.string().max(200).nullish(),
});

const posSessionMovementIntentSchema = z.object({
  action: z.literal("movement"),
  clientKey: z.string().uuid(),
  warehouseId: z.string().uuid(),
  cashierId: z.string().min(1).max(128),
  localSessionId: z.string().uuid(),
  movementType: z.enum(["deposit", "withdrawal"]),
  amount: z.number().finite().positive().max(999_999_999_999_999),
  notes: z.string().trim().min(3).max(200),
  createdAt: z.string().datetime(),
  terminalId: z.string().min(1).max(128).nullish(),
  terminalName: z.string().max(120).nullish(),
});

export const posSessionIntentSchema = z.union([
  posSessionOpenIntentSchema,
  posSessionCloseIntentSchema,
  posSessionMovementIntentSchema,
]);

export type PosSessionIntent = z.infer<typeof posSessionIntentSchema>;

export const posSyncRequestSchema = z
  .object({
    items: z.array(posSyncItemSchema).max(50).default([]),
    sessionIntents: z.array(posSessionIntentSchema).max(50).optional(),
  })
  .refine(
    (body) => body.items.length > 0 || (body.sessionIntents?.length ?? 0) > 0,
    { message: "Tidak ada item maupun intent untuk disinkronkan." },
  );
