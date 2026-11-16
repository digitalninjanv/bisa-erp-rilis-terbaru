import { and, asc, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  customers,
  partyCredits,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal, type MoneyInput } from "@/lib/money";
import { getAccountId } from "@/server/accounting";
import { listJournalNumbersById } from "@/server/catalog";
import { writeAudit } from "@/server/audit";
import { nextDocumentNumber } from "@/server/sequences";

/**
 * A-21 (R3-02, sisa AK3-05): domain dokumen kredit pihak — kelebihan
 * bayar & uang muka/DP. Menggeneralisasi dua preseden repo yang sudah
 * hidup: klaim retur pemasok A-9 (dokumen asal memegang klaim +
 * counter terselesaikan; akun pemetaan `supplier_credit` 1210, aset)
 * dan kredit retur pelanggan POS (dokumen retur memegang kredit +
 * `creditUsed`; akun pemetaan `customer_credit` 2300, liabilitas).
 * Asal kredit di sini adalah pembayaran, bukan retur, jadi klaimnya
 * berdiri sebagai dokumen bernomor sendiri (seri PARTY_CREDIT).
 *
 * Aturan main yang dijaga modul ini:
 * - Saldo kredit satu pihak tidak pernah bisa dipakai pihak lain,
 *   perusahaan lain, atau melebihi sisanya (baris dikunci FOR UPDATE
 *   di setiap pemakaian, jadi balapan terserialisasi).
 * - Pemakaian selalu lewat jalur pembayaran yang ada sebagai baris
 *   party_payments ber-credit_id dengan akun kredit terpeta — tidak
 *   ada jurnal kas pada pemakaian.
 * - party_payments.amount hanya memuat porsi yang teralokasi ke
 *   dokumen; kelebihan hidup di dokumen kredit ini. Karena itu
 *   Σ pembayaran per dokumen selalu sama dengan terbayar dokumen —
 *   invariant yang dipakai hitung ulang ketiga jalur void pembayaran.
 */

export type PartyCreditRow = typeof partyCredits.$inferSelect;
export type PartyCreditPartyType = "customer" | "supplier";

/** Kunci pemetaan akun kredit per jenis pihak (keduanya sudah ada
 * sejak A-9/D-12 — tahap ini tidak menambah kunci pemetaan baru). */
export function partyCreditMappingKey(partyType: PartyCreditPartyType): string {
  return partyType === "customer" ? "customer_credit" : "supplier_credit";
}

export function partyCreditRemaining(credit: Pick<PartyCreditRow, "amount" | "usedAmount">): Decimal {
  return d(credit.amount).minus(d(credit.usedAmount));
}

/**
 * Terbitkan dokumen kredit pihak. Jurnalnya diposting pemanggil
 * (komposisi barisnya berbeda per permukaan pembayaran), kecuali
 * sisa FIFO yang jurnalnya diposting quick-entry sendiri; pemanggil
 * menautkan jurnal lewat setPartyCreditJournal sesudah posting.
 */
export async function createPartyCredit(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    partyType: PartyCreditPartyType;
    partyId: string;
    date: string;
    amount: MoneyInput;
    originPaymentId?: string | null;
    originLabel?: string | null;
    notes?: string | null;
  },
): Promise<PartyCreditRow> {
  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal kredit pihak harus lebih dari nol.");
  }
  const number = await nextDocumentNumber(tx, input.companyId, "PARTY_CREDIT", input.date);
  const [credit] = await tx
    .insert(partyCredits)
    .values({
      companyId: input.companyId,
      number,
      partyType: input.partyType,
      partyId: input.partyId,
      date: input.date,
      amount: toDb(amount),
      usedAmount: "0",
      status: "open",
      originPaymentId: input.originPaymentId ?? null,
      originLabel: input.originLabel ?? null,
      notes: input.notes ?? null,
      createdBy: input.userId,
    })
    .returning();
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "party_credit.create",
    entityType: "party_credit",
    entityId: credit.id,
    after: {
      number,
      partyType: input.partyType,
      partyId: input.partyId,
      amount: toDb(amount),
      originLabel: input.originLabel ?? null,
    },
  });
  return credit;
}

/** Tautkan jurnal yang mengakui saldo kredit ke dokumennya. */
export async function setPartyCreditJournal(
  tx: Tx,
  companyId: string,
  creditId: string,
  journalId: string,
): Promise<void> {
  await tx
    .update(partyCredits)
    .set({ journalId })
    .where(and(eq(partyCredits.companyId, companyId), eq(partyCredits.id, creditId)));
}

export async function lockPartyCredit(
  tx: Tx,
  companyId: string,
  creditId: string,
): Promise<PartyCreditRow> {
  const [credit] = await tx
    .select()
    .from(partyCredits)
    .where(and(eq(partyCredits.companyId, companyId), eq(partyCredits.id, creditId)))
    .limit(1)
    .for("update");
  if (!credit) throw new AppError("NOT_FOUND", "Dokumen kredit pihak tidak ditemukan.");
  return credit;
}

/**
 * Kunci & validasi dokumen kredit yang akan dipakai sebagai sumber
 * dana pembayaran satu dokumen milik pihak tertentu. Mengembalikan
 * baris kredit terkunci + akun kredit terpeta yang menjadi akun
 * baris pembayaran. Semua penolakan berbentuk pesan yang menyebut
 * dokumennya agar UI dapat menampilkannya apa adanya.
 */
export async function resolvePartyCreditForUse(
  tx: Tx,
  input: {
    companyId: string;
    creditId: string;
    partyType: PartyCreditPartyType;
    partyId: string;
    amount: MoneyInput;
  },
): Promise<{ credit: PartyCreditRow; accountId: string }> {
  const credit = await lockPartyCredit(tx, input.companyId, input.creditId);
  if (credit.partyType !== input.partyType || credit.partyId !== input.partyId) {
    throw new AppError(
      "VALIDATION",
      `Dokumen kredit ${credit.number} bukan milik ${input.partyType === "customer" ? "pelanggan" : "pemasok"} ini.`,
    );
  }
  if (credit.status === "void") {
    throw new AppError("INVALID_STATE", `Dokumen kredit ${credit.number} sudah dibatalkan.`);
  }
  if (credit.status === "settled") {
    throw new AppError("INVALID_STATE", `Dokumen kredit ${credit.number} sudah lunas terpakai.`);
  }
  const amount = d(input.amount);
  const remaining = partyCreditRemaining(credit);
  if (amount.gt(remaining)) {
    throw new AppError(
      "VALIDATION",
      `Nominal melebihi sisa kredit ${credit.number} (${remaining.toFixed(0)}).`,
    );
  }
  const accountId = await getAccountId(tx, input.companyId, partyCreditMappingKey(input.partyType));
  return { credit, accountId };
}

/** Catat pemakaian kredit sesudah baris pembayaran & jurnalnya
 * terposting: used_amount naik, status settled bila habis. */
export async function consumePartyCredit(
  tx: Tx,
  input: { companyId: string; userId: string; credit: PartyCreditRow; amount: MoneyInput },
): Promise<void> {
  const used = d(input.credit.usedAmount).plus(d(input.amount));
  const settled = used.gte(d(input.credit.amount));
  await tx
    .update(partyCredits)
    .set({ usedAmount: toDb(used), status: settled ? "settled" : "open" })
    .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.id, input.credit.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "party_credit.use",
    entityType: "party_credit",
    entityId: input.credit.id,
    after: {
      number: input.credit.number,
      amount: toDb(d(input.amount)),
      usedAmount: toDb(used),
      remaining: toDb(d(input.credit.amount).minus(used)),
    },
  });
}

/**
 * Pulihkan pemakaian kredit ketika pembayaran pemakainya dibatalkan
 * (dipanggil ketiga jalur void pembayaran): used_amount turun
 * kembali dan dokumen kredit terbuka lagi. Jurnal pembalik pembayaran
 * sudah mengembalikan saldo akun kredit; fungsi ini menyelaraskan
 * subledger dokumennya.
 */
export async function restorePartyCreditUsage(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    payment: { creditId: string | null; amount: string; number: string };
  },
): Promise<void> {
  if (!input.payment.creditId) return;
  const credit = await lockPartyCredit(tx, input.companyId, input.payment.creditId);
  if (credit.status === "void") return;
  const used = d(credit.usedAmount).minus(d(input.payment.amount));
  const nextUsed = used.lt(0) ? d(0) : used;
  await tx
    .update(partyCredits)
    .set({
      usedAmount: toDb(nextUsed),
      status: nextUsed.gte(d(credit.amount)) ? "settled" : "open",
    })
    .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.id, credit.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "party_credit.restore",
    entityType: "party_credit",
    entityId: credit.id,
    after: {
      number: credit.number,
      paymentNumber: input.payment.number,
      usedAmount: toDb(nextUsed),
    },
  });
}

/** Batalkan dokumen kredit yang lahir dari retur saat retur dibatalkan. */
export async function voidPartyCreditForReturn(
  tx: Tx,
  input: { companyId: string; returnNumber: string },
): Promise<void> {
  const [partyCredit] = await tx
    .select()
    .from(partyCredits)
    .where(
      and(
        eq(partyCredits.companyId, input.companyId),
        eq(partyCredits.partyType, "supplier"),
        eq(partyCredits.originLabel, `Retur ${input.returnNumber}`),
        ne(partyCredits.status, "void"),
      ),
    )
    .limit(1)
    .for("update");
  if (!partyCredit) return;
  if (d(partyCredit.usedAmount).gt(0)) {
    throw new AppError(
      "INVALID_STATE",
      `Kredit retur ${input.returnNumber} (${partyCredit.number}) sudah terpakai sebesar ${d(partyCredit.usedAmount).toFixed(0)}. Batalkan pembayaran pemakainya terlebih dahulu.`,
    );
  }
  await tx
    .update(partyCredits)
    .set({ status: "void" })
    .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.id, partyCredit.id)));
}

/** Sinkronkan pemakaian/pelunasan kredit retur saat diselesaikan dari detail retur. */
export async function syncPartyCreditFromReturnResolution(
  tx: Tx,
  input: {
    companyId: string;
    supplierId: string;
    returnNumber: string;
    amount: Decimal;
    mode: "consume" | "settle_all";
  },
): Promise<void> {
  const [existingCredit] = await tx
    .select()
    .from(partyCredits)
    .where(
      and(
        eq(partyCredits.companyId, input.companyId),
        eq(partyCredits.partyType, "supplier"),
        eq(partyCredits.partyId, input.supplierId),
        eq(partyCredits.originLabel, `Retur ${input.returnNumber}`),
        ne(partyCredits.status, "void"),
      ),
    )
    .limit(1)
    .for("update");
  if (!existingCredit) return;
  if (input.mode === "settle_all") {
    await tx
      .update(partyCredits)
      .set({ usedAmount: toDb(existingCredit.amount), status: "settled" })
      .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.id, existingCredit.id)));
  } else {
    const used = d(existingCredit.usedAmount).plus(input.amount);
    const settled = used.gte(d(existingCredit.amount));
    await tx
      .update(partyCredits)
      .set({ usedAmount: toDb(used), status: settled ? "settled" : "open" })
      .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.id, existingCredit.id)));
  }
}

/**
 * Penjaga rantai void pembayaran ASAL: pembayaran yang melahirkan
 * kredit hanya boleh dibatalkan bila kreditnya belum terpakai sama
 * sekali — jurnal pembalik pembayaran akan membalik seluruh jurnal
 * asal termasuk baris kreditnya, jadi kredit yang sudah (sebagian)
 * terpakai harus dibebaskan dulu dengan membatalkan pembayaran
 * pemakainya (pola void dokumen berantai yang sama seperti retur).
 * Mengembalikan baris kredit asal (atau null bila pembayaran ini
 * tidak melahirkan kredit).
 */
export async function assertOriginCreditVoidable(
  tx: Tx,
  companyId: string,
  paymentId: string,
): Promise<PartyCreditRow | null> {
  const [credit] = await tx
    .select()
    .from(partyCredits)
    .where(and(eq(partyCredits.companyId, companyId), eq(partyCredits.originPaymentId, paymentId)))
    .limit(1)
    .for("update");
  if (!credit) return null;
  if (credit.status !== "void" && d(credit.usedAmount).gt(0)) {
    throw new AppError(
      "INVALID_STATE",
      `Pembayaran ini melahirkan kredit pihak ${credit.number} yang sudah terpakai ${d(credit.usedAmount).toFixed(0)} dari ${d(credit.amount).toFixed(0)}. Batalkan dulu pembayaran yang memakai kredit tersebut, lalu batalkan pembayaran asal ini.`,
    );
  }
  return credit;
}

/** Tandai kredit asal sebagai void sesudah jurnal pembayaran
 * asal berhasil dibalik (saldo akun kreditnya sudah kembali nol
 * oleh jurnal pembalik itu). */
export async function voidOriginPartyCredit(
  tx: Tx,
  input: { companyId: string; userId: string; paymentId: string },
): Promise<void> {
  const [credit] = await tx
    .select({ id: partyCredits.id, number: partyCredits.number, status: partyCredits.status })
    .from(partyCredits)
    .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.originPaymentId, input.paymentId)))
    .limit(1);
  if (!credit || credit.status === "void") return;
  await tx
    .update(partyCredits)
    .set({ status: "void" })
    .where(and(eq(partyCredits.companyId, input.companyId), eq(partyCredits.id, credit.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "party_credit.void",
    entityType: "party_credit",
    entityId: credit.id,
    after: { number: credit.number, reason: "Pembayaran asal dibatalkan" },
  });
}

/** Total kredit yang masih tersedia untuk satu pihak. */
export async function getPartyCreditAvailable(
  tx: Tx,
  companyId: string,
  partyType: PartyCreditPartyType,
  partyId: string,
): Promise<Decimal> {
  const rows = await tx
    .select({ amount: partyCredits.amount, usedAmount: partyCredits.usedAmount })
    .from(partyCredits)
    .where(
      and(
        eq(partyCredits.companyId, companyId),
        eq(partyCredits.partyType, partyType),
        eq(partyCredits.partyId, partyId),
        eq(partyCredits.status, "open"),
      ),
    );
  return rows.reduce((acc, row) => acc.plus(d(row.amount).minus(d(row.usedAmount))), d(0));
}

export type PartyCreditQueueSummary = {
  count: number;
  totalRemaining: string;
  customer: { count: number; totalRemaining: string };
  supplier: { count: number; totalRemaining: string };
};

/**
 * A-22 Tahap K5: ringkasan antrean kredit pihak untuk kartu dashboard
 * — hanya dokumen berstatus open yang masih bersisa (dokumen lunas /
 * sisa nol / void tidak menunggu tindakan apa pun). Diturunkan dari
 * listPartyCredits agar konsisten dengan daftar di halaman
 * piutang-utang.
 */
export async function getPartyCreditQueueSummary(
  tx: Tx,
  companyId: string,
): Promise<PartyCreditQueueSummary> {
  const rows = await listPartyCredits(tx, companyId);
  const open = rows.filter((row) => row.status === "open" && d(row.remaining).gt(0));
  const part = (partyType: PartyCreditPartyType) => {
    const subset = open.filter((row) => row.partyType === partyType);
    return {
      count: subset.length,
      totalRemaining: toDb(subset.reduce((acc, row) => acc.plus(d(row.remaining)), d(0))),
    };
  };
  return {
    count: open.length,
    totalRemaining: toDb(open.reduce((acc, row) => acc.plus(d(row.remaining)), d(0))),
    customer: part("customer"),
    supplier: part("supplier"),
  };
}

export type PartyCreditListRow = PartyCreditRow & {
  remaining: string;
  partyName: string | null;
  /** A-24 T4: nomor jurnal penerbitan kredit ini (journalId tersimpan
   * di baris kredit; nomor diselesaikan di listPartyCredits). */
  journalNumber: string | null;
};

/**
 * Daftar dokumen kredit pihak untuk halaman piutang-utang: dokumen
 * non-void beserta nama pihak & sisa. Kredit pihak SENGAJA tampil
 * sebagai daftar tersendiri — ia tidak pernah dikurangkan dari sisa
 * tagihan dokumen mana pun, jadi aging piutang/utang tidak pernah
 * mengandung angka neto yang mengaburkan umur tagihan.
 */
export async function listPartyCredits(
  tx: Tx,
  companyId: string,
  filter?: { partyType?: PartyCreditPartyType; partyId?: string; status?: "open" | "settled" },
): Promise<PartyCreditListRow[]> {
  const rows = await tx
    .select({
      credit: partyCredits,
      customerName: customers.name,
      supplierName: suppliers.name,
    })
    .from(partyCredits)
    .leftJoin(
      customers,
      and(eq(partyCredits.partyType, "customer"), eq(partyCredits.partyId, customers.id)),
    )
    .leftJoin(
      suppliers,
      and(eq(partyCredits.partyType, "supplier"), eq(partyCredits.partyId, suppliers.id)),
    )
    .where(
      and(
        eq(partyCredits.companyId, companyId),
        ne(partyCredits.status, "void"),
        ...(filter?.partyType ? [eq(partyCredits.partyType, filter.partyType)] : []),
        ...(filter?.partyId ? [eq(partyCredits.partyId, filter.partyId)] : []),
        ...(filter?.status ? [eq(partyCredits.status, filter.status)] : []),
      ),
    )
    .orderBy(asc(partyCredits.date), asc(partyCredits.createdAt));
  const journalNumbers = await listJournalNumbersById(
    tx,
    companyId,
    rows.map((row) => row.credit.journalId).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) => ({
    ...row.credit,
    remaining: toDb(partyCreditRemaining(row.credit)),
    partyName: row.credit.partyType === "customer" ? row.customerName : row.supplierName,
    journalNumber: row.credit.journalId ? (journalNumbers.get(row.credit.journalId) ?? null) : null,
  }));
}
