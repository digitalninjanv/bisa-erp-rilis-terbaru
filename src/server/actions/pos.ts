"use server";

import { and, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { cashMovements, customers, idempotencyKeys, journalEntries, partyPayments, sales, warehouses } from "@/db/schema";
import { reverseJournalEntry } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import {
  assertOriginCreditVoidable,
  restorePartyCreditUsage,
  voidOriginPartyCredit,
} from "@/server/party-credits";
import type { QuoteResultPublic } from "@/server/pos";
import {
  cashDrawerMovement,
  closeCashSession,
  createSale,
  createSaleReturn,
  deleteHeldSale,
  getOpenCashSession,
  getReturnCredit,
  holdSale,
  openCashSession,
  payReceivable,
  quoteCart,
  voidSale,
} from "@/server/pos";
import { searchProducts } from "@/server/catalog";
import { requirePermission, requirePermissionInModule, requireAuth } from "@/lib/session";
import { can } from "@/lib/permissions";
import { AppError, guard, type ActionResult } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { d, toDb } from "@/lib/money";
import { paymentRequestFingerprint } from "@/server/idempotency";
import { todayISO } from "@/lib/format";
import { log } from "@/lib/log";

const cartLine = z.object({
  productId: z.string().uuid(),
  qty: z.union([z.string(), z.number()]).transform(String),
  unitPrice: z.union([z.string(), z.number()]).optional(),
  discountType: z.enum(["percent", "nominal"]).nullish(),
  discountValue: z.union([z.string(), z.number()]).optional(),
  // SIM-2 S7B-2 Batch 5: seri terpilih per unit untuk produk serial.
  serialNumbers: z.array(z.string().min(1).max(80)).max(500).optional(),
  // Program Satuan Kemasan S4: baris berkemasan (qty = qty input
  // kemasan). isiSnapshot TIDAK diterima dari klien — faktor selalu
  // diselesaikan dari master oleh domain (cuplikan hanya sah dari
  // jalur sinkronisasi offline server).
  packagingId: z.string().uuid().nullish(),
});

const cartSchema = z.object({
  warehouseId: z.string().uuid(),
  groupId: z.string().uuid().nullish(),
  lines: z.array(cartLine).min(1).max(200),
  // FIX-GDG Tahap 2 (GDG1-09): reservasi yang dipenuhi keranjang ini —
  // quote menghargai stoknya sebagai tersedia untuk keranjang ini dan
  // checkout mengonsumsi alokasinya (domain memvalidasi).
  reservationId: z.string().uuid().nullish(),
});

// T5R-2: every WRITE action in this file goes through
// requirePermissionInModule(..., "pos") so switching the POS module
// off stops writes immediately, even from an already-loaded terminal.
// Read/compute-only actions (searchProductsAction, quoteAction,
// resumeHeldSaleAction, getReturnCreditAction, currentSessionAction)
// stay on plain requirePermission: they cannot change data, and the
// layout gate already hides the module's pages.
export async function searchProductsAction(
  q: string,
  warehouseId?: string,
  // POS-1: halaman kisi produk terminal (24 per halaman, 1-based dari
  // klien sebagai offset baris). categoryId = chip kategori aktif.
  offset?: number,
  categoryId?: string,
): Promise<ActionResult<Awaited<ReturnType<typeof searchProducts>>>> {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    // POS-SRCH-01: search judges stock by the warehouse the cashier
    // actually selected (quote/checkout already did), not always the
    // default warehouse. A supplied id must belong to this company.
    const resolvedWarehouseId = warehouseId
      ? await assertWarehouseUsable(ctx.company.id, warehouseId)
      : await defaultWarehouseId(ctx.company.id);
    const safeOffset = Math.max(0, Math.floor(Number(offset ?? 0)) || 0);
    return withCompany(ctx.company.id, (tx) =>
      searchProducts(tx, {
        companyId: ctx.company.id,
        warehouseId: resolvedWarehouseId,
        q,
        limit: 24,
        offset: safeOffset,
        categoryId: categoryId || undefined,
        // POS3-10: harga pokok hanya ikut bila pemanggil memegang
        // inventory.cost; kasir tidak pernah menerimanya di payload.
        includeCost: can(ctx, "inventory.cost"),
      }),
    );
  });
}

// POS-1 (D-19): pencarian pelanggan untuk panel utang terminal. Baca
// saja — tetap requirePermission biasa seperti action baca lain (T5R-2).
export async function searchCustomersAction(q: string) {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    const term = parseInput(z.string().trim().max(80), q);
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const rows = await tx
        .select({
          id: customers.id,
          code: customers.code,
          name: customers.name,
          phone: customers.phone,
          creditLimit: customers.creditLimit,
        })
        .from(customers)
        .where(
          and(
            eq(customers.companyId, ctx.company.id),
            eq(customers.isActive, true),
            term
              ? or(ilike(customers.name, `%${term}%`), ilike(customers.phone, `%${term}%`))
              : undefined,
          ),
        )
        .orderBy(customers.name)
        .limit(10);
      return rows.map((row) => ({ ...row, creditLimit: d(row.creditLimit).toNumber() }));
    });
  });
}

// POS-1 (D-19): tambah cepat pelanggan dari terminal utang — membuat
// data pelanggan beneran (kode digenerate; dapat dirapikan kemudian di
// master pelanggan). Nama wajib, telepon opsional, tanpa batas kredit.
export async function quickAddCustomerAction(input: { name: string; phone?: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.sell", "pos");
    const data = parseInput(
      z.object({
        name: z.string().trim().min(2, "Nama pelanggan minimal 2 karakter.").max(160),
        phone: z.string().trim().max(40).optional(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, async (tx) => {
      // MD-023: Quick add pelanggan kasir tetap harus diaudit
      if (data.phone) {
        const [existing] = await tx.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.companyId, ctx.company.id), eq(customers.phone, data.phone))).limit(1);
        if (existing) throw new AppError("CONFLICT", `Nomor telepon ${data.phone} sudah terdaftar atas nama pelanggan "${existing.name}".`);
      }
      const code = `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const [created] = await tx.insert(customers).values({ companyId: ctx.company.id, code, name: data.name, phone: data.phone || null, creditLimit: "0" }).returning({ id: customers.id, code: customers.code, name: customers.name, phone: customers.phone, creditLimit: customers.creditLimit });
      await writeAudit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "customer.quick_add", entityType: "customer", entityId: created.id, after: { code: created.code, name: created.name, phone: created.phone, creditLimit: created.creditLimit } });
      return { ...created, creditLimit: d(created.creditLimit).toNumber() };
    });
    revalidatePath("/app/gudang/pelanggan");
    return result;
  });
}

async function assertWarehouseUsable(companyId: string, warehouseId: string): Promise<string> {
  const parsed = z.string().uuid().safeParse(warehouseId);
  if (!parsed.success) throw new AppError("VALIDATION", "Gudang tidak valid.");
  return withCompanyReadOnly(companyId, async (tx) => {
    const [row] = await tx
      .select({ id: warehouses.id, name: warehouses.name, isActive: warehouses.isActive })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, companyId), eq(warehouses.id, parsed.data)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Gudang tidak ditemukan di perusahaan ini.");
    if (!row.isActive) throw new AppError("VALIDATION", `Gudang ${row.name} sudah nonaktif.`);
    return row.id;
  });
}

async function defaultWarehouseId(companyId: string): Promise<string> {
  return withCompanyReadOnly(companyId, async (tx) => {
    const rows = await tx.execute(sql`
      select id from warehouses where company_id = ${companyId} and is_active = true
      order by is_default desc, name asc limit 1
    `);
    const row = (rows as unknown as { id: string }[])[0];
    if (!row) throw new Error("Belum ada gudang aktif.");
    return row.id;
  });
}

export async function quoteAction(
  input: z.input<typeof cartSchema>,
): Promise<ActionResult<QuoteResultPublic>> {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    const data = parseInput(cartSchema, input);
    const quote = await withCompany(ctx.company.id, (tx) =>
      quoteCart(tx, {
        companyId: ctx.company.id,
        warehouseId: data.warehouseId,
        groupId: data.groupId,
        lines: data.lines,
        canDiscount: can(ctx, "pos.discount"),
        reservationId: data.reservationId ?? null,
      }),
    );
    // POS3-10: unitCost per baris adalah data pokok — hanya pemegang
    // inventory.cost yang menerimanya. Domain tetap menghitung HPP
    // dari QuoteResult utuh secara internal; yang disanitasi hanyalah
    // salinan yang menyeberang ke klien.
    if (can(ctx, "inventory.cost")) return quote;
    return {
      ...quote,
      lines: quote.lines.map((line) => {
        const { unitCost: _unitCost, ...rest } = line;
        void _unitCost;
        return rest;
      }),
    };
  });
}

const checkoutSchema = cartSchema.extend({
  idempotencyKey: z.string().min(10),
  notes: z.string().max(500).optional(),
  // POS-1 (D-19): penjualan utang meneruskan pelanggan + jatuh tempo;
  // domain menolak piutang tanpa keduanya.
  customerId: z.string().uuid().nullish(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal jatuh tempo harus YYYY-MM-DD.")
    .nullish(),
  // POS-HOLD-02: bila keranjang berasal dari resume, checkout yang
  // berhasil menghapus dokumen tahanannya (di transaksi yang sama).
  heldSaleId: z.string().uuid().nullish(),
  payments: z
    .array(
      z.object({
        methodId: z.string().uuid(),
        amount: z.union([z.string(), z.number()]),
        tendered: z.union([z.string(), z.number()]).optional(),
        reference: z.string().max(120).optional(),
        // A-21 Tahap R3-A (R3-01): fee final per pembayaran; kosong =
        // bawaan konfigurasi metode (domain yang memutuskan).
        fee: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .min(1),
});

export async function checkoutAction(input: z.input<typeof checkoutSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.sell", "pos");
    const data = parseInput(checkoutSchema, input);
    const startedAt = performance.now();
    const result = await withCompany(ctx.company.id, async (tx) => {
      const saleInput = {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        customerId: data.customerId,
        dueDate: data.dueDate,
        groupId: data.groupId,
        date: todayISO(),
        lines: data.lines,
        payments: data.payments,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
        canDiscount: can(ctx, "pos.discount"),
        reservationId: data.reservationId ?? null,
      };
      // `date` is server-generated for checkout and may change at midnight;
      // heldSaleId affects the workflow and must remain part of the request.
      const fingerprint = paymentRequestFingerprint({
        ...saleInput,
        date: undefined,
        heldSaleId: data.heldSaleId ?? null,
      });
      const findReplay = async () => {
        const [row] = await tx.select({ id: sales.id, number: sales.number, total: sales.total, changeTotal: sales.changeTotal })
          .from(sales).where(and(eq(sales.companyId, ctx.company.id), eq(sales.idempotencyKey, data.idempotencyKey))).limit(1);
        if (row) {
          const [claim] = await tx
            .select({ resultRef: idempotencyKeys.resultRef })
            .from(idempotencyKeys)
            .where(and(
              eq(idempotencyKeys.companyId, ctx.company.id),
              eq(idempotencyKeys.scope, "pos.sale"),
              eq(idempotencyKeys.key, data.idempotencyKey),
            ))
            .limit(1);
          if (claim?.resultRef !== fingerprint) {
            throw new AppError(
              "CONFLICT",
              claim?.resultRef
                ? "Kunci transaksi sudah digunakan untuk data checkout yang berbeda. Periksa riwayat sebelum mencoba lagi."
                : "Transaksi sebelumnya belum memiliki fingerprint retry. Periksa riwayat sebelum mencoba lagi.",
            );
          }
        }
        return row ? { id: row.id, number: row.number, total: Number(row.total), change: Number(row.changeTotal) } : null;
      };
      const replayed = await findReplay();
      if (replayed) return replayed;
      if (data.heldSaleId) {
        // T3R-3: klaim tahanan secara atomik SEBELUM checkout, di
        // transaksi yang sama. Baris tahanan dikunci FOR UPDATE:
        // checkout kedua yang bersamaan atas tahanan yang sama (resume
        // kini baca-saja — D-9 — sehingga dua terminal dapat me-resume
        // tahanan yang sama) menunggu kunci ini, lalu mendapati baris
        // sudah terhapus dan ditolak, bukan menghasilkan penjualan
        // kedua dari satu pesanan tahanan.
        const [held] = await tx
          .select({ status: sales.status })
          .from(sales)
          .where(and(eq(sales.companyId, ctx.company.id), eq(sales.id, data.heldSaleId)))
          .limit(1)
          .for("update");
        if (!held || held.status !== "held") {
          const winner = await findReplay();
          if (winner) return winner;
          throw new AppError(
            "VALIDATION",
            "Pesanan tahanan sudah diselesaikan atau tidak tersedia.",
          );
        }
      }
      const sale = await createSale(tx, {
        ...saleInput,
        idempotencyFingerprint: fingerprint,
      });
      if (data.heldSaleId) {
        // Baris tahanan masih terkunci oleh klaim di atas dan statusnya
        // sudah dipastikan held — hapus bersama penjualan finalnya.
        await tx.execute(sql`delete from sale_lines where sale_id = ${data.heldSaleId}`);
        await tx.execute(sql`delete from sales where id = ${data.heldSaleId}`);
      }
      return sale;
    });
    log.info("pos.checkout.completed", {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      saleNumber: result.number,
      durationMs: Math.round(performance.now() - startedAt),
    });
    revalidatePath("/app/pos");
    revalidatePath("/app/pos/riwayat");
    revalidatePath("/app/pos/sesi");
    revalidatePath("/app/pos/ditahan");
    return result;
  });
}

const holdSchema = cartSchema.extend({
  idempotencyKey: z.string().min(10),
  notes: z.string().max(500).optional(),
  customerId: z.string().uuid().nullish(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal jatuh tempo harus YYYY-MM-DD.")
    .nullish(),
  label: z.string().trim().max(80).optional(),
});

export async function holdAction(input: z.input<typeof holdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.sell", "pos");
    const data = parseInput(holdSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      holdSale(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        warehouseId: data.warehouseId,
        customerId: data.customerId ?? null,
        dueDate: data.dueDate ?? null,
        groupId: data.groupId,
        date: todayISO(),
        label: data.label,
        notes: data.notes,
        lines: data.lines,
        canDiscount: can(ctx, "pos.discount"),
        idempotencyKey: data.idempotencyKey,
      }),
    );
    revalidatePath("/app/pos/ditahan");
    return result;
  });
}

export async function resumeHeldSaleAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    // POS-HOLD-02: resume bersifat baca-saja. Dokumen tahanan dihapus
    // hanya oleh checkout yang berhasil dan merujuknya (heldSaleId),
    // atau oleh penghapusan manual — membatalkan kelanjutan tidak lagi
    // menghilangkan pesanan.
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const [sale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ctx.company.id), eq(sales.id, id)))
        .limit(1);
      if (!sale || sale.status !== "held") throw new Error("Pesanan ditahan tidak ditemukan.");
      const lines = await tx.execute(sql`
        select product_id, qty, qty_input, packaging_id, unit_price, discount_type, discount_value
          from sale_lines where sale_id = ${id} order by line_no
      `);
      const [customer] = sale.customerId
        ? await tx
            .select({
              id: customers.id,
              code: customers.code,
              name: customers.name,
              phone: customers.phone,
              creditLimit: customers.creditLimit,
            })
            .from(customers)
            .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, sale.customerId)))
            .limit(1)
        : [];
      return {
        warehouseId: sale.warehouseId,
        customerId: sale.customerId,
        customer: customer ? { ...customer, creditLimit: d(customer.creditLimit).toNumber() } : null,
        dueDate: sale.dueDate,
        // POS-HOLD-01: kelompok harga dipulihkan ke keranjang.
        customerGroupId: sale.customerGroupId,
        // Snapshot total saat ditahan; terminal membandingkannya dengan
        // hitung-ulang terkini dan memperingatkan bila berubah (D-9).
        heldTotal: d(sale.total).toNumber(),
        lines: (lines as unknown as {
          product_id: string;
          qty: string;
          qty_input: string;
          packaging_id: string | null;
          unit_price: string;
          discount_type: string | null;
          discount_value: string;
        }[]).map((line) => ({
          productId: line.product_id,
          // S4: keranjang dipulihkan dalam BENTUK MASUKAN baris
          // (qty_input + kemasan), bukan qty dasar tersimpan.
          qty: line.qty_input,
          packagingId: line.packaging_id,
          discountType: line.discount_type,
          discountValue: line.discount_value,
        })),
      };
    });
  });
}

export async function deleteHeldSaleAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.sell", "pos");
    await withCompany(ctx.company.id, (tx) =>
      deleteHeldSale(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        saleId: id,
        canDeleteAny: can(ctx, "pos.void"),
      }),
    );
    revalidatePath("/app/pos/ditahan");
    return { id };
  });
}

export async function voidSaleAction(input: { saleId: string; reason: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    // POS-VOID-01: the old `pin` parameter was dead — accepted by the
    // schema but never verified (D-10: no PIN store exists, so the
    // parameter is removed rather than pretending to check it).
    const data = parseInput(z.object({ saleId: z.string().uuid(), reason: z.string().min(3).max(300) }), input);
    await withCompany(ctx.company.id, (tx) =>
      voidSale(tx, { companyId: ctx.company.id, userId: ctx.user.id, saleId: data.saleId, reason: data.reason }),
    );
    revalidatePath("/app/pos/riwayat");
    revalidatePath("/app/pos/sesi");
    return { id: data.saleId };
  });
}

export async function createReturnAction(input: {
  saleId: string;
  idempotencyKey: string;
  disposition?: "sellable" | "write_off";
  reason: string;
  refundMethod: "cash" | "transfer" | "store_credit" | "exchange";
  type: "return" | "exchange";
  lines: { productId: string; qty: string | number; saleLineId?: string | null }[];
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.return", "pos");
    const data = parseInput(
      z.object({
        saleId: z.string().uuid(),
        idempotencyKey: z.string().uuid(),
        disposition: z.enum(["sellable", "write_off"]).default("sellable"),
        reason: z.string().min(3).max(300),
        refundMethod: z.enum(["cash", "transfer", "store_credit", "exchange"]),
        type: z.enum(["return", "exchange"]),
        lines: z
          .array(
            z.object({
              productId: z.string().uuid(),
              qty: z.union([z.string(), z.number()]),
              // S4: baris penjualan asal yang dituju (qty dalam
              // bentuk masukan baris itu); kosong = jalur per produk.
              saleLineId: z.string().uuid().nullish(),
            }),
          )
          .min(1),
      }).refine(
        (val) => (val.type === "exchange" ? val.refundMethod === "exchange" : val.refundMethod !== "exchange"),
        {
          message: "Tipe retur dan metode pengembalian harus konsisten: tukar barang wajib menggunakan metode exchange.",
          path: ["refundMethod"],
        },
      ),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      createSaleReturn(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        saleId: data.saleId,
        idempotencyKey: data.idempotencyKey,
        disposition: data.disposition,
        date: todayISO(),
        reason: data.reason,
        refundMethod: data.refundMethod,
        type: data.type,
        lines: data.lines,
      }),
    );
    revalidatePath("/app/pos/riwayat");
    revalidatePath("/app/pos/retur");
    return result;
  });
}

export async function getReturnCreditAction(number: string) {
  return guard(async () => {
    const ctx = await requirePermission("pos.sell");
    // D-12: kasir memeriksa sisa kredit sebuah dokumen retur sebelum
    // menebusnya; hasil null berarti nomor tidak ditemukan di perusahaan
    // ini atau retur itu tidak melahirkan kredit (tunai/transfer).
    const data = parseInput(z.object({ number: z.string().trim().min(1).max(40) }), { number });
    return withCompanyReadOnly(ctx.company.id, (tx) =>
      getReturnCredit(tx, ctx.company.id, data.number),
    );
  });
}

export async function payReceivableAction(input: {
  saleId: string;
  amount: string | number;
  accountId?: string;
  /** A-21 (R3-02): sumber dana kredit pelanggan (pengganti akun). */
  creditId?: string;
  /** A-21 Tahap R3-A (R3-01): fee final; kosong = bawaan konfigurasi metode. */
  fee?: string | number;
  notes?: string;
  reference?: string;
  date?: string;
  idempotencyKey?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.sell", "pos");
    const data = parseInput(
      z.object({
        saleId: z.string().uuid(),
        amount: z.union([z.string(), z.number()]),
        accountId: z.string().uuid().optional(),
        creditId: z.string().uuid().optional(),
        fee: z.union([z.string(), z.number()]).optional(),
        notes: z.string().max(300).optional(),
        // A-21 (R3-08): nomor referensi/bukti penerimaan.
        reference: z.string().trim().max(100).optional(),
        // AK-P2-03: tanggal penerimaan bisa dipilih; default hari ini.
        // Periode tertutup tetap menolak lewat postJournal/assertPeriodOpen.
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD.").optional(),
        // POS1-05: kunci idempotensi per upaya pembayaran dari klien;
        // pengiriman ulang kunci yang sama mengembalikan hasil pertama.
        idempotencyKey: z.string().trim().min(8).max(120).optional(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      payReceivable(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        saleId: data.saleId,
        date: data.date ?? todayISO(),
        amount: data.amount,
        accountId: data.accountId,
        creditId: data.creditId,
        fee: data.fee,
        notes: data.notes,
        reference: data.reference,
        idempotencyKey: data.idempotencyKey,
      }),
    );
    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/pos/riwayat");
    return result;
  });
}

export async function voidReceivablePaymentAction(input: { paymentId: string; reason: string }) {
  return guard(async () => {
    // POS3-11: membatalkan penerimaan piutang membalik dokumen uang
    // terposting — kelas tindakan yang sama dengan void penjualan,
    // jadi gerbangnya sama: pos.void (supervisor), bukan pos.sell.
    // Kasir tetap boleh MENERIMA piutang lewat payReceivableAction.
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(
      z.object({ paymentId: z.string().uuid(), reason: z.string().trim().min(3).max(200) }),
      input,
    );

    await withCompany(ctx.company.id, async (tx) => {
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ctx.company.id), eq(partyPayments.id, data.paymentId)))
        .limit(1)
        .for("update");
      if (!payment) throw new AppError("NOT_FOUND", "Penerimaan pembayaran tidak ditemukan.");
      if (payment.type !== "receivable" || !payment.saleId) {
        throw new AppError("VALIDATION", "Pembayaran ini bukan penerimaan piutang penjualan.");
      }
      if (payment.status === "void") throw new AppError("INVALID_STATE", "Penerimaan sudah dibatalkan.");

      // A-21 (R3-02): rantai kredit pihak — penerimaan asal yang
      // kreditnya sudah terpakai tidak dapat dibatalkan sebelum
      // pembayaran pemakai kredit dibatalkan lebih dulu.
      await assertOriginCreditVoidable(tx, ctx.company.id, payment.id);

      const [sale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ctx.company.id), eq(sales.id, payment.saleId)))
        .limit(1)
        .for("update");
      if (!sale) throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.");

      // AK-P2-03: sama seperti pembayaran utang — jurnal penerimaan ini
      // ditargetkan lewat idempotency key-nya (`ar:<saleId>:<nomor>`) dan
      // dibalik per entri, bukan per dokumen induk, agar pembayaran
      // sebagian lain tidak ikut terbalik.
      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ctx.company.id),
            eq(journalEntries.idempotencyKey, `ar:${sale.id}:${payment.number}`),
            eq(journalEntries.status, "posted"),
          ),
        )
        .limit(1);
      if (!entry) {
        throw new AppError(
          "VALIDATION",
          `Jurnal penerimaan ${payment.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan penerimaan dibatalkan agar daftar pembayaran dan buku besar tetap selaras; periksa jurnal penerimaan ini terlebih dahulu.`,
        );
      }
      const { reversal } = await reverseJournalEntry(tx, {
        companyId: ctx.company.id,
        entryId: entry.id,
        date: todayISO(),
        description: `Pembatalan penerimaan piutang ${payment.number} — ${data.reason}`,
        createdBy: ctx.user.id,
      });

      await tx
        .update(partyPayments)
        .set({ status: "void" })
        .where(and(eq(partyPayments.companyId, ctx.company.id), eq(partyPayments.id, payment.id)));

      // A-21 (R3-02): selaraskan subledger kredit — pemakaian kredit
      // oleh penerimaan ini dipulihkan; kredit yang lahir dari
      // penerimaan ini ikut batal (belum terpakai, per penjaga di atas).
      await restorePartyCreditUsage(tx, { companyId: ctx.company.id, userId: ctx.user.id, payment });
      await voidOriginPartyCredit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        paymentId: payment.id,
      });

      // POS-001: Kurangi porsi pembayaran piutang yang dibatalkan dari paidTotal penjualan
      // (mempertahankan porsi pembayaran awal/tunai saat checkout).
      const diff = d(sale.paidTotal).minus(d(payment.amount));
      const paid = diff.gt(0) ? diff : d(0);
      await tx
        .update(sales)
        .set({
          paidTotal: toDb(paid),
          paymentStatus: paid.gte(d(sale.total)) ? "paid" : paid.gt(0) ? "partial" : "unpaid",
        })
        .where(and(eq(sales.companyId, ctx.company.id), eq(sales.id, sale.id)));

      // POS-002: Jika penerimaan piutang memiliki mutasi kas ke laci sesi, catat pengembalian dana
      const [existingCashMovement] = await tx.select().from(cashMovements).where(and(eq(cashMovements.companyId, ctx.company.id), eq(cashMovements.referenceType, "payment"), eq(cashMovements.referenceId, payment.id))).limit(1);
      if (existingCashMovement) {
        const processorSession = await getOpenCashSession(tx, ctx.company.id, ctx.user.id);
        if (processorSession) {
          await tx.insert(cashMovements).values({ companyId: ctx.company.id, sessionId: processorSession.id, type: "refund", amount: toDb(d(existingCashMovement.amount).neg()), referenceType: "payment_void", referenceId: payment.id, notes: `Pembatalan penerimaan piutang ${payment.number} — ${data.reason}`, createdBy: ctx.user.id });
        }
      }

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "ar.payment.void",
        entityType: "party_payment",
        entityId: payment.id,
        after: {
          number: payment.number,
          saleNumber: sale.number,
          amount: payment.amount,
          reason: data.reason,
          reversalNumber: reversal.number,
        },
      });
    });

    revalidatePath("/app/akuntansi/piutang-utang");
    revalidatePath("/app/pos/riwayat");
    return { id: data.paymentId };
  });
}

export async function openSessionAction(input: { openingCash: string | number; branchId?: string | null }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(z.object({ openingCash: z.union([z.string(), z.number()]), branchId: z.string().uuid().nullish() }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      openCashSession(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        branchId: data.branchId ?? null,
        openingCash: data.openingCash,
      }),
    );
    revalidatePath("/app/pos/sesi");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function closeSessionAction(input: {
  sessionId: string;
  countedCash: string | number;
  notes?: string;
  differenceReason?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(
      z.object({
        sessionId: z.string().uuid(),
        countedCash: z.union([z.string(), z.number()]),
        notes: z.string().max(300).optional(),
        // A-28 Tahap 1 (H-POS-02): alasan selisih — kewajiban isinya
        // diputuskan domain dari toleransi perusahaan, bukan di sini.
        differenceReason: z.string().max(300).optional(),
      }),
      input,
    );
    const result = await withCompany(ctx.company.id, (tx) =>
      closeCashSession(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        countedCash: data.countedCash,
        notes: data.notes,
        differenceReason: data.differenceReason,
      }),
    );
    revalidatePath("/app/pos/sesi");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function cashMovementAction(input: {
  sessionId: string;
  type: "deposit" | "withdrawal";
  amount: string | number;
  notes?: string;
  idempotencyKey?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.session", "pos");
    const data = parseInput(
      z.object({
        sessionId: z.string().uuid(),
        type: z.enum(["deposit", "withdrawal"]),
        amount: z.union([z.string(), z.number()]),
        notes: z.string().max(300).optional(),
        idempotencyKey: z.string().min(8).max(128).optional(),
      }),
      input,
    );
    await withCompany(ctx.company.id, (tx) =>
      cashDrawerMovement(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        sessionId: data.sessionId,
        type: data.type,
        amount: data.amount,
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
      }),
    );
    revalidatePath("/app/pos/sesi");
    return { ok: true };
  });
}

export async function currentSessionAction() {
  return guard(async () => {
    const ctx = await requireAuth();
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const rows = await tx.execute(sql`
        select id, opening_cash, opened_at from cash_sessions
        where company_id = ${ctx.company.id} and user_id = ${ctx.user.id} and status = 'open'
        order by opened_at desc limit 1
      `);
      return (rows as unknown as { id: string; opening_cash: string; opened_at: string }[])[0] ?? null;
    });
  });
}
