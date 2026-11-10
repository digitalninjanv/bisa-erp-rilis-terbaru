// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: alokasi pembayaran checkout — kunci kredit retur,
// alokasi per metode, dan syarat piutang (D-12/D-19).

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { customers, saleReturns, sales } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { D, d, Decimal } from "@/lib/money";
import { getAccountMap } from "@/server/accounting";
import { computeConfiguredFee } from "@/server/payment-fees";
import type { QuoteResult } from "./quote";
import type { CreateSaleInput } from "./sales-types";

export type PaymentMethodRow = {
  id: string;
  name: string;
  type: string;
  accountId: string | null;
  isActive: boolean;
  // A-21 Tahap R3-A (R3-01): konfigurasi fee metode (payment-fees.ts).
  feeEnabled: boolean;
  feeType: string;
  feeValue: string;
};


export type LockedReturn = { id: string; number: string; available: D };

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * kunci dokumen retur yang kreditnya ditebus pembayaran ini
 * (D-12) — terurut per id, dibaca di bawah kunci FOR UPDATE.
 */


export async function lockCreditReturns(
  tx: Tx,
  input: CreateSaleInput,
  methodMap: Map<string, PaymentMethodRow>,
  map: Awaited<ReturnType<typeof getAccountMap>>,
) {
  // D-12: pembayaran dengan metode customer_credit menebus kredit dari
  // dokumen retur exchange/store_credit, dirujuk lewat nomor retur di
  // kolom reference. Semua baris retur yang dirujuk dikunci FOR UPDATE —
  // terurut per id agar dua checkout tidak saling mengunci mati — sebelum
  // penjualan ditulis, dan sisa kredit dibaca dari baris yang terkunci
  // itu: dua checkout bersamaan tidak bisa menebus kredit yang sama dua
  // kali. Metode kredit wajib memakai akun pemetaan customer_credit,
  // supaya kaki jurnalnya selalu mendarat di liabilitas Kredit pelanggan.
  const creditReturns = new Map<string, LockedReturn>(); // keyed by return number
  const creditEntries = input.payments.filter((payment) => {
    const method = methodMap.get(payment.methodId);
    return method?.type === "customer_credit" && d(payment.amount).gt(0);
  });
  if (creditEntries.length > 0) {
    const creditAccountId = map.customer_credit;
    if (!creditAccountId) {
      throw new AppError(
        "VALIDATION",
        'Akun untuk "customer_credit" belum dipetakan di Pengaturan. Atur pemetaan Kredit pelanggan terlebih dahulu.',
      );
    }
    const numbers: string[] = [];
    for (const entry of creditEntries) {
      const method = methodMap.get(entry.methodId)!;
      if (method.accountId !== creditAccountId) {
        throw new AppError(
          "VALIDATION",
          `Metode ${method.name} tidak memakai akun Kredit pelanggan yang dipetakan. Perbaiki metode pembayaran atau pemetaan akun di Pengaturan.`,
        );
      }
      const number = entry.reference?.trim();
      if (!number) {
        throw new AppError(
          "VALIDATION",
          "Pembayaran Kredit Pelanggan wajib mencantumkan nomor dokumen retur asal.",
        );
      }
      if (numbers.includes(number)) {
        throw new AppError(
          "VALIDATION",
          `Dokumen retur ${number} dipakai lebih dari sekali dalam satu penjualan — gabungkan nominalnya.`,
        );
      }
      numbers.push(number);
    }
    const candidates = await tx
      .select({ id: saleReturns.id, number: saleReturns.number })
      .from(saleReturns)
      .where(and(eq(saleReturns.companyId, input.companyId), inArray(saleReturns.number, numbers)));
    const foundNumbers = new Set(candidates.map((row) => row.number));
    for (const number of numbers) {
      if (!foundNumbers.has(number)) {
        throw new AppError("VALIDATION", `Dokumen retur ${number} tidak ditemukan.`);
      }
    }
    const sortedIds = [...new Set(candidates.map((row) => row.id))].sort();
    for (const id of sortedIds) {
      const [locked] = await tx
        .select({
          id: saleReturns.id,
          number: saleReturns.number,
          status: saleReturns.status,
          refundMethod: saleReturns.refundMethod,
          total: saleReturns.total,
          creditUsed: saleReturns.creditUsed,
        })
        .from(saleReturns)
        .where(and(eq(saleReturns.companyId, input.companyId), eq(saleReturns.id, id)))
        .limit(1)
        .for("update");
      if (!locked) throw new AppError("VALIDATION", "Dokumen retur tidak ditemukan.");
      if (
        locked.status !== "posted" ||
        (locked.refundMethod !== "exchange" && locked.refundMethod !== "store_credit")
      ) {
        throw new AppError(
          "VALIDATION",
          `Retur ${locked.number} tidak memiliki kredit yang dapat ditebus — hanya retur tukar barang atau kredit toko yang melahirkan kredit.`,
        );
      }
      creditReturns.set(locked.number, {
        id: locked.id,
        number: locked.number,
        available: d(locked.total).minus(d(locked.creditUsed)),
      });
    }
  }
  return creditReturns;
}


export type AppliedPayment = {
  methodId: string;
  accountId: string | null;
  amount: D;
  /** A-21 Tahap R3-A (R3-01): fee final pembayaran ini (0 = tanpa fee). */
  fee: D;
  tendered: D;
  reference?: string;
  type: string;
  returnId?: string;
  returnNumber?: string;
};

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * alokasi pembayaran ke total kuotasi — validasi metode, batas
 * non-tunai, penebusan kredit retur, kembalian tunai, dan porsi
 * piutang dari sisa yang tak terbayar.
 */


export function allocateSalePayments(
  input: CreateSaleInput,
  quote: QuoteResult,
  methodMap: Map<string, PaymentMethodRow>,
  creditReturns: Map<string, LockedReturn>,
) {
  const total = d(quote.total);
  let remaining = total;
  let paid = d(0);
  let receivable = d(0);
  let change = d(0);
  let hasCredit = false;
  const applied: AppliedPayment[] = [];

  for (const payment of input.payments) {
    const method = methodMap.get(payment.methodId);
    if (!method) throw new AppError("VALIDATION", "Metode pembayaran tidak valid.");
    // POS-REF-01: metode nonaktif tidak boleh menyelesaikan transaksi.
    if (!method.isActive) {
      throw new AppError("VALIDATION", `Metode pembayaran ${method.name} sudah nonaktif.`);
    }
    // POS1-08: metode (selain utang, yang kakinya memakai pemetaan
    // piutang) tanpa akun penampung dulu dibiarkan masuk dan checkout
    // gugur di ujung dengan "Jurnal tidak seimbang" — pesan akuntansi
    // yang tidak dapat ditindaklanjuti kasir. Tolak di sini dengan
    // pesan konfigurasi yang jelas. (Metode kredit pelanggan berakun
    // kosong sudah tertangkap pemeriksaan pemetaan di atas.)
    if (method.type !== "credit" && !method.accountId && d(payment.amount).gt(0)) {
      throw new AppError(
        "VALIDATION",
        `Metode pembayaran ${method.name} belum memiliki akun penampung. Atur akun untuk metode ini di Pengaturan pembayaran sebelum memakainya.`,
      );
    }
    const raw = d(payment.amount);
    if (raw.lte(0)) continue;
    // POS-PAY-02: pembayaran non-tunai tidak dapat memberi kembalian, jadi
    // nominal di atas sisa tagihan ditolak — bukan dipotong diam-diam.
    // (Tunai boleh lebih: kelebihannya menjadi kembalian dari tendered;
    // kredit memang dialokasikan sebesar sisa.)
    if (method.type !== "cash" && method.type !== "credit" && raw.gt(remaining)) {
      throw new AppError(
        "VALIDATION",
        `Pembayaran ${method.name} melebihi sisa tagihan ${remaining.toFixed(0)}. Pembayaran non-tunai tidak dapat memberi kembalian; kurangi nominalnya.`,
      );
    }
    const amount = D.min(raw, remaining);

    // D-12: nominal kredit tidak boleh melebihi sisa kredit dokumen
    // retur yang dirujuk (dibaca di bawah kunci pada pra-cek di atas).
    let lockedReturn: LockedReturn | undefined;
    if (method.type === "customer_credit") {
      lockedReturn = creditReturns.get(payment.reference?.trim() ?? "");
      if (!lockedReturn) {
        throw new AppError("VALIDATION", "Dokumen retur untuk pembayaran kredit tidak ditemukan.");
      }
      if (amount.gt(lockedReturn.available)) {
        throw new AppError(
          "VALIDATION",
          `Kredit retur ${lockedReturn.number} tidak cukup. Sisa kredit ${lockedReturn.available.toFixed(0)}.`,
        );
      }
      lockedReturn.available = lockedReturn.available.minus(amount);
    }

    // A-21 Tahap R3-A (R3-01): fee/MDR per pembayaran. Hanya metode
    // non-tunai berkaki akun yang bisa berfee — tunai masuk laci utuh
    // (rekonsiliasi laci memakai nominal bruto), utang & kredit retur
    // bukan mutasi bank. Fee eksplisit dari kasir adalah keputusan
    // final; kosong = bawaan konfigurasi metode. Fee pada metode yang
    // fee-nya nonaktif ditolak (D-25: komponen nonaktif tidak
    // dijurnal), bukan dibuang diam-diam.
    let fee = d(0);
    const feeEligible =
      method.type !== "cash" && method.type !== "credit" && method.type !== "customer_credit";
    if (payment.fee !== undefined && payment.fee !== null && payment.fee !== "") {
      fee = d(payment.fee);
      if (!fee.isFinite() || fee.lt(0)) {
        throw new AppError("VALIDATION", "Biaya (fee) pembayaran tidak boleh negatif.");
      }
      if (fee.gt(0) && !feeEligible) {
        throw new AppError(
          "VALIDATION",
          `Fee hanya berlaku untuk pembayaran non-tunai; metode ${method.name} tidak dapat dikenai fee.`,
        );
      }
      if (fee.gt(0) && !(method.feeEnabled && method.feeType !== "none")) {
        throw new AppError(
          "VALIDATION",
          `Fee tidak aktif untuk metode ${method.name}. Aktifkan tarif fee metode ini di Pengaturan bila pembayaran memang dipotong fee.`,
        );
      }
    } else if (feeEligible) {
      fee = computeConfiguredFee(method, amount);
    }
    if (fee.gte(amount) && amount.gt(0)) {
      throw new AppError(
        "VALIDATION",
        `Fee ${method.name} (${fee.toFixed(0)}) tidak boleh melebihi nominal pembayarannya (${amount.toFixed(0)}).`,
      );
    }

    if (method.type === "credit") {
      hasCredit = true;
      receivable = receivable.plus(amount);
    } else {
      paid = paid.plus(amount);
      if (method.type === "cash") {
        const tendered = d(payment.tendered ?? amount);
        if (tendered.lt(amount)) throw new AppError("VALIDATION", "Uang tunai kurang dari nilai pembayaran.");
        change = change.plus(tendered.minus(amount));
      }
    }
    if (amount.gt(0)) {
      applied.push({
        methodId: method.id,
        accountId: method.accountId,
        amount,
        fee,
        tendered: d(payment.tendered ?? amount),
        reference: payment.reference,
        type: method.type,
        ...(lockedReturn ? { returnId: lockedReturn.id, returnNumber: lockedReturn.number } : {}),
      });
    }
    remaining = remaining.minus(amount);
  }

  if (remaining.gt(0)) {
    if (!hasCredit) {
      throw new AppError(
        "VALIDATION",
        `Pembayaran kurang ${remaining.toFixed(0)}. Tambahkan pembayaran atau pilih metode utang.`,
      );
    }
    receivable = receivable.plus(remaining);
    remaining = d(0);
  }
  return { applied, paid, receivable, change, hasCredit };
}

/**
 * FIX-ARS Tahap 4: fase dari createSale — badan dipindah apa adanya;
 * syarat penjualan berpiutang (D-19 + POS1-02/POS1-11) —
 * pelanggan & jatuh tempo wajib; sisa batas kredit dinilai di
 * bawah kunci baris pelanggan.
 */


export async function validateReceivableTerms(tx: Tx, input: CreateSaleInput, receivable: Decimal) {
  if (receivable.gt(0)) {
    // D-19: penjualan utang wajib menangkap pelanggan DAN tanggal jatuh
    // tempo — tanpa keduanya piutang tidak dapat ditagih dengan benar.
    if (!input.customerId) {
      throw new AppError("VALIDATION", "Penjualan utang wajib memilih pelanggan — piutang tidak dapat dicatat tanpa pelanggan.");
    }
    if (!input.dueDate) {
      throw new AppError("VALIDATION", "Penjualan utang wajib memiliki tanggal jatuh tempo.");
    }
    // POS1-11: jatuh tempo sebelum tanggal penjualan membuat piutang
    // lahir sudah lewat tempo — aging & penanda keterlambatan langsung
    // menyala untuk utang yang baru dibuat, dan salah ketik tanggal
    // tidak dapat dibedakan dari utang lama.
    if (input.dueDate < input.date) {
      throw new AppError("VALIDATION", "Tanggal jatuh tempo tidak boleh lebih awal dari tanggal penjualan.");
    }
    // POS1-02: baris pelanggan dikunci FOR UPDATE sebelum sisa limit
    // dinilai. Di bawah READ COMMITTED dua checkout utang bersamaan
    // untuk pelanggan yang sama sebelumnya saling tidak melihat
    // penjualan satu sama lain dan sama-sama lolos — limit terlampaui.
    // Kunci ini menserialisasi penilaian limit per pelanggan; kueri
    // sisa piutang di bawah berjalan sesudah kunci diperoleh sehingga
    // membaca keadaan terakhir yang sudah commit.
    const [customer] = await tx
      .select({ creditLimit: customers.creditLimit, name: customers.name })
      .from(customers)
      .where(and(eq(customers.companyId, input.companyId), eq(customers.id, input.customerId)))
      .limit(1)
      .for("update");
    if (!customer) throw new AppError("VALIDATION", "Pelanggan tidak ditemukan.");
    const limit = d(customer.creditLimit);
    if (limit.gt(0)) {
      const [outstanding] = await tx
        .select({ value: sql<string>`coalesce(sum(${sales.total} - ${sales.paidTotal}), 0)` })
        .from(sales)
        .where(
          and(
            eq(sales.companyId, input.companyId),
            eq(sales.customerId, input.customerId),
            inArray(sales.status, ["completed", "partial"]),
            inArray(sales.paymentStatus, ["unpaid", "partial"]),
          ),
        );
      if (d(outstanding?.value).plus(receivable).gt(limit)) {
        throw new AppError(
          "VALIDATION",
          `Batas kredit ${customer.name} terlampaui. Sisa limit ${limit.minus(d(outstanding?.value)).toFixed(0)}.`,
        );
      }
    }
  }
}
