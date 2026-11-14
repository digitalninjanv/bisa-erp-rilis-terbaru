// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: orkestrasi checkout createSale + fase pra-tulisnya
// (idempotensi, validasi pelanggan, kuotasi, kunci sesi).

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashSessions, customers, idempotencyKeys, paymentMethods, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, Decimal } from "@/lib/money";
import { assertPeriodOpen, getAccountMap } from "@/server/accounting";
import { paymentRequestFingerprint } from "@/server/idempotency";
import { writeAudit } from "@/server/audit";
import { consumeReservationForSale, getReservedQuantities } from "@/server/reservations";
import { quoteCart } from "./quote";
import { getCompanySettingsRow } from "@/server/settings";
import type { CreateSaleInput } from "./sales-types";
import { allocateSalePayments, lockCreditReturns, validateReceivableTerms } from "./sales-payments";
import { applySaleStockMovements, persistSaleDocument, postSaleJournal, recordSaleCashMovements } from "./sales-persist";

export async function createSale(
  tx: Tx,
  input: CreateSaleInput,
): Promise<{ id: string; number: string; total: number; change: number; overageAbsorbed?: number }> {
  const replayedSale = await claimSaleIdempotency(tx, {
    ...input,
    idempotencyFingerprint: input.idempotencyFingerprint ?? saleRequestFingerprint(input),
  });
  if (replayedSale) return replayedSale;

  await assertPeriodOpen(tx, input.companyId, input.date);
  await validateSaleCustomer(tx, input);

  const { quote, settings } = await prepareSaleQuote(tx, input);

  const { session, settlementClosedSession } = await lockSaleSession(tx, input);

  const methodIds = [...new Set(input.payments.map((p) => p.methodId))];
  const methodRows = await tx
    .select({
      id: paymentMethods.id,
      name: paymentMethods.name,
      type: paymentMethods.type,
      accountId: paymentMethods.accountId,
      isActive: paymentMethods.isActive,
      feeEnabled: paymentMethods.feeEnabled,
      feeType: paymentMethods.feeType,
      feeValue: paymentMethods.feeValue,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, input.companyId), inArray(paymentMethods.id, methodIds)));
  const methodMap = new Map(methodRows.map((m) => [m.id, m]));

  const map = await getAccountMap(tx, input.companyId);

  const creditReturns = await lockCreditReturns(tx, input, methodMap, map);

  const { applied, paid, receivable, change } = allocateSalePayments(input, quote, methodMap, creditReturns);

  await validateReceivableTerms(tx, input, receivable);

  const { sale, costTotal, paymentStatus } = await persistSaleDocument(
    tx, input, quote, session, applied, paid, receivable, change,
  );

  await applySaleStockMovements(tx, input, quote, sale, settings);

  await recordSaleCashMovements(tx, input, session, sale, applied, settlementClosedSession);

  const { overageAbsorbed } = await postSaleJournal(
    tx, input, sale, quote, applied, receivable, costTotal, settlementClosedSession, map,
  );

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.sale",
    entityType: "sale",
    entityId: sale.id,
    after: { number: sale.number, total: toDb(quote.total), paymentStatus },
  });

  // FIX-GDG Tahap 2 (GDG1-09): konsumsi alokasi reservasi yang disebut
  // checkout ini — atomik dalam transaksi penjualan yang sama, sebesar
  // qty terjual produk reservasi (sebagian → sisa tetap aktif; habis →
  // status fulfilled). Tanpa langkah ini janji stok menggantung sampai
  // dilepas manual dan memblokir penjualan berikutnya.
  if (input.reservationId) {
    const soldQtyByProduct = new Map<string, Decimal>();
    for (const line of quote.lines) {
      soldQtyByProduct.set(
        line.productId,
        (soldQtyByProduct.get(line.productId) ?? d(0)).plus(line.qty),
      );
    }
    const consumed = await consumeReservationForSale(tx, {
      companyId: input.companyId,
      userId: input.userId,
      reservationId: input.reservationId,
      soldQtyByProduct,
    });
    if (consumed.consumedQty.gt(0)) {
      await writeAudit(tx, {
        companyId: input.companyId,
        userId: input.userId,
        action: "stock_reservation.consume",
        entityType: "stock_reservation",
        entityId: input.reservationId,
        after: {
          saleNumber: sale.number,
          consumedQty: toDb(consumed.consumedQty),
          fulfilled: consumed.fulfilled,
        },
      });
    }
  }

  // POS-DISC-01: diskon manual di atas ambang yang diizinkan tercatat
  // tersendiri beserta pelaku & besarnya, agar dapat diaudit.
  if (quote.manualDiscountOverride) {
    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "pos.discount.override",
      entityType: "sale",
      entityId: sale.id,
      after: {
        number: sale.number,
        thresholdPercent: quote.manualDiscountOverride.thresholdPercent,
        maxPercent: quote.manualDiscountOverride.maxPercent,
        // POS1-10: basis bruto dipertahankan sebagai informasi audit.
        maxGrossPercent: quote.manualDiscountOverride.maxGrossPercent,
        lines: quote.manualDiscountOverride.lines,
      },
    });
  }

  return {
    id: sale.id,
    number: sale.number,
    total: quote.total,
    change: change.toNumber(),
    ...(settlementClosedSession ? { overageAbsorbed: overageAbsorbed.toNumber() } : {}),
  };
}

/** Hash only transaction data; the client key and fingerprint are excluded. */
export function saleRequestFingerprint(input: CreateSaleInput): string {
  const request = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "idempotencyKey" && key !== "idempotencyFingerprint"),
  );
  return paymentRequestFingerprint(request);
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * klaim kunci idempotensi (POS-IDEM-01) — replay mengembalikan
 * penjualan yang sudah terposting; klaim yang kalah membaca ulang
 * pemenangnya, bukan mati di indeks unik.
 */


async function claimSaleIdempotency(tx: Tx, input: CreateSaleInput) {
  if (!input.idempotencyKey) throw new AppError("VALIDATION", "Kunci transaksi tidak ada.");
  const fingerprint = input.idempotencyFingerprint;
  if (!fingerprint) throw new AppError("VALIDATION", "Fingerprint transaksi tidak tersedia.");

  const findExisting = async () => {
    const [row] = await tx
      .select({ id: sales.id, number: sales.number, total: sales.total, changeTotal: sales.changeTotal })
      .from(sales)
      .where(and(eq(sales.companyId, input.companyId), eq(sales.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    return row;
  };
  const assertSameRequest = async () => {
    const [claim] = await tx
      .select({ resultRef: idempotencyKeys.resultRef })
      .from(idempotencyKeys)
      .where(and(
        eq(idempotencyKeys.companyId, input.companyId),
        eq(idempotencyKeys.scope, "pos.sale"),
        eq(idempotencyKeys.key, input.idempotencyKey),
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
  };
  const existing = await findExisting();
  if (existing) {
    await assertSameRequest();
    return {
      id: existing.id,
      number: existing.number,
      total: d(existing.total).toNumber(),
      change: d(existing.changeTotal).toNumber(),
    };
  }

  // POS-IDEM-01: the check above races — two concurrent checkouts with
  // the same key both pass it, and the loser used to die on the unique
  // index with a generic server error. Claim the key first instead: the
  // claim insert blocks until a concurrent winner commits (then yields
  // no row and the committed sale is re-read and returned) or rolls back
  // (then the claim succeeds and this call proceeds). The claim lives in
  // the same transaction as the sale, so a failed checkout releases it.
  const [claim] = await tx
    .insert(idempotencyKeys)
    .values({ companyId: input.companyId, key: input.idempotencyKey, scope: "pos.sale", resultRef: fingerprint })
    .onConflictDoNothing({ target: [idempotencyKeys.companyId, idempotencyKeys.scope, idempotencyKeys.key] })
    .returning({ id: idempotencyKeys.id });
  if (!claim) {
    await assertSameRequest();
    const winner = await findExisting();
    if (winner) {
      return {
        id: winner.id,
        number: winner.number,
        total: d(winner.total).toNumber(),
        change: d(winner.changeTotal).toNumber(),
      };
    }
    throw new AppError("CONFLICT", "Transaksi dengan kunci yang sama sedang diproses. Coba lagi sebentar.");
  }
  return null;
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * validasi pelanggan (POS1-07) untuk semua jalur checkout —
 * setenant & masih aktif.
 */


async function validateSaleCustomer(tx: Tx, input: CreateSaleInput) {
  // POS1-07: customerId yang terisi divalidasi untuk SEMUA jalur
  // checkout — bukan hanya penjualan utang. FK basis data hanya
  // membuktikan baris pelanggan itu ada di SUATU perusahaan; tanpa
  // pemeriksaan setenant ini, penjualan lunas dapat menanam referensi
  // pelanggan perusahaan lain (referensi yatim lintas-tenant).
  if (input.customerId) {
    const [customer] = await tx
      .select({ id: customers.id, name: customers.name, isActive: customers.isActive })
      .from(customers)
      .where(and(eq(customers.companyId, input.companyId), eq(customers.id, input.customerId)))
      .limit(1);
    if (!customer) {
      throw new AppError("VALIDATION", "Pelanggan tidak ditemukan di perusahaan ini.");
    }
    if (!customer.isActive) {
      throw new AppError("VALIDATION", `Pelanggan ${customer.name} sudah nonaktif dan tidak dapat dipakai untuk penjualan.`);
    }
  }
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * kuotasi keranjang + pra-cek stok terhadap reservasi aktif
 * (baris batch dinilai FEFO di fase gerakan, bukan di sini).
 */


async function prepareSaleQuote(tx: Tx, input: CreateSaleInput) {
  const quote = await quoteCart(tx, {
    companyId: input.companyId,
    warehouseId: input.warehouseId,
    customerId: input.customerId,
    groupId: input.groupId,
    lines: input.lines,
    asOfDate: input.date,
    canDiscount: input.canDiscount,
    lockCosts: true,
    frozenPrices: input.frozenPrices,
    reservationId: input.reservationId ?? null,
    allowInactiveProducts: input.allowInactiveProducts,
  });

  const settings = await getCompanySettingsRow(tx, input.companyId);

  const reservedForCheck = await getReservedQuantities(
    tx,
    input.companyId,
    input.warehouseId,
    quote.lines.map((line) => line.productId),
    new Date(),
    // GDG1-09: reservasi yang sedang dipenuhi tidak ikut memblokir.
    { excludeReservationId: input.reservationId ?? null },
  );
  // S4: kebutuhan dinilai per PRODUK, bukan per baris — satu produk
  // kini dapat muncul dua kali (baris Dus + baris Pcs); menilai
  // sendiri-sendiri akan meloloskan gabungan yang melebihi stok.
  const demandByProduct = new Map<
    string,
    { qty: Decimal; stock: number; name: string; trackBatch: boolean }
  >();
  for (const line of quote.lines) {
    const demand = demandByProduct.get(line.productId) ?? {
      qty: d(0),
      stock: line.stock,
      name: line.name,
      trackBatch: line.trackBatch,
    };
    demand.qty = demand.qty.plus(line.qty);
    demandByProduct.set(line.productId, demand);
  }
  for (const [productId, demand] of demandByProduct) {
    // Batch-tracked lines are enforced by FEFO allocation in the movement
    // loop below, which reports expiry-aware shortages; the plain on-hand
    // pre-check would mask that message with a generic one.
    if (demand.trackBatch) {
      // SIM-2 S7B-2 Batch 4: FEFO tidak mengenal reservasi, jadi baris
      // batch yang produknya sedang direservasi tetap diperiksa terhadap
      // stok tersedia (line.stock dari quoteCart sudah bersih reservasi).
      const reservedQty = reservedForCheck.get(productId);
      if (reservedQty && reservedQty.gt(0) && d(demand.stock).lt(demand.qty) && !settings?.allowNegativeStock) {
        throw new AppError("INSUFFICIENT_STOCK", `Stok ${demand.name} tidak cukup. Tersedia ${demand.stock}.`);
      }
      continue;
    }
    if (d(demand.stock).lt(demand.qty) && !settings?.allowNegativeStock) {
      throw new AppError("INSUFFICIENT_STOCK", `Stok ${demand.name} tidak cukup. Tersedia ${demand.stock}.`);
    }
  }
  return { quote, settings };
}



/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * kunci sesi kas (POS1-13) — sesi asal eksplisit untuk jalur
 * offline, atau sesi terbuka milik kasir; sesi tertutup hanya
 * sah dalam mode penyelesaian offline.
 */


async function lockSaleSession(tx: Tx, input: CreateSaleInput) {
  // POS1-13: baris sesi dikunci FOR UPDATE. closeCashSession mengunci
  // baris yang sama, jadi checkout dan penutupan terserialisasi: tanpa
  // kunci ini checkout dapat membaca status "open" lalu menulis mutasi
  // penjualan ke sesi yang baru saja ditutup transaksi lain.
  // FIX-POS Tahap 2 (POS3-02): jalur offline dapat menunjuk sesi ASAL
  // secara eksplisit — penjualan ditempelkan ke sesi itu (terbuka:
  // jalur normal; tertutup: hanya dalam mode penyelesaian offline).
  let session: { id: string };
  let settlementClosedSession = false;
  if (input.sessionId) {
    const [explicit] = await tx
      .select({ id: cashSessions.id, userId: cashSessions.userId, status: cashSessions.status })
      .from(cashSessions)
      .where(
        and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.id, input.sessionId)),
      )
      .limit(1)
      .for("update");
    if (!explicit) throw new AppError("NOT_FOUND", "Sesi kas asal tidak ditemukan.");
    if (explicit.userId !== input.userId) {
      throw new AppError("VALIDATION", "Sesi kas asal bukan milik kasir asal penjualan ini.");
    }
    if (explicit.status !== "open") {
      if (!input.offlineSettlement) {
        throw new AppError(
          "VALIDATION",
          "Sesi kas asal sudah ditutup. Penjualan offline ini hanya dapat diposting lewat penyelesaian dari daftar peninjauan.",
        );
      }
      settlementClosedSession = true;
    }
    session = { id: explicit.id };
  } else {
    const [open] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.companyId, input.companyId),
          eq(cashSessions.userId, input.userId),
          eq(cashSessions.status, "open"),
        ),
      )
      .orderBy(sql`${cashSessions.openedAt} DESC`)
      .limit(1)
      .for("update");
    if (!open) throw new AppError("VALIDATION", "Buka sesi kas terlebih dahulu sebelum menjual.");
    session = open;
  }
  return { session, settlementClosedSession };
}
