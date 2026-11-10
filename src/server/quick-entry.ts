import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  customers,
  partyOpeningBalances,
  quickEntryDrafts,
  sales,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb, type Decimal, type MoneyInput } from "@/lib/money";
import { allocateFifo, splitCashSaleWithDiscount } from "@/lib/quick-entry";
import { getAccountId, listCashBankIds, postJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { payOpeningBalance } from "@/server/opening-balances";
import { createPartyCredit, setPartyCreditJournal } from "@/server/party-credits";
import { listOpenExpensePayables, payExpensePayable, payPayableDocument } from "@/server/payables";
import {
  resolveWithholding,
  type WithholdingInput,
} from "@/server/payment-deductions";
import { payReceivable } from "@/server/pos";
import { listSupplierOpenPayableDocs } from "@/server/supplier-returns";

/**
 * A-12 (D-23): domain modal Catat Transaksi. Semua fungsi di sini
 * MEMBUNGKUS domain yang sudah ada — tidak ada semantik akuntansi baru:
 * penjualan tunai adalah satu-satunya jurnal langsung (pendapatan
 * non-stok), sedangkan terima piutang / bayar utang berjalan FIFO di
 * atas mekanisme party_payments per dokumen yang sudah teruji.
 */

/* ------------------------------------------------------------------ */
/* Penjualan tunai (pendapatan non-stok)                               */
/* ------------------------------------------------------------------ */

export async function postQuickCashSale(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    date: string;
    amount: MoneyInput;
    /** Akun kas/bank/QRIS tujuan penerimaan. */
    accountId: string;
    /** Akun pendapatan yang dikredit. */
    revenueAccountId: string;
    taxIncluded: boolean;
    /** Tarif pajak perusahaan (persen), dari company_settings. */
    taxRate: MoneyInput;
    /** Diskon penjualan opsional (R3-05): didebit ke contra-revenue
     * `sales_discount`, pendapatan tetap dikredit bruto — pola POS. */
    discount?: MoneyInput;
    /** Pelanggan opsional (R3-05): ditulis sebagai tag pihak pada
     * baris pendapatan, pola penandaan pihak jalur pembayaran. */
    customerId?: string;
    notes?: string;
    idempotencyKey?: string | null;
  },
): Promise<{ journalId: string; journalNumber: string }> {
  const gross = d(input.amount);
  if (!gross.isFinite() || gross.lte(0)) {
    throw new AppError("VALIDATION", "Jumlah penjualan tunai harus lebih dari nol.");
  }
  const discount = d(input.discount ?? 0);
  if (!discount.isFinite() || discount.lt(0)) {
    throw new AppError("VALIDATION", "Diskon penjualan tidak boleh negatif.");
  }
  if (discount.gt(gross)) {
    throw new AppError("VALIDATION", "Diskon penjualan tidak boleh melebihi jumlah penjualan.");
  }
  if (input.customerId) {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.companyId, input.companyId), eq(customers.id, input.customerId)))
      .limit(1);
    if (!customer) throw new AppError("NOT_FOUND", "Pelanggan tidak ditemukan.");
  }

  // Akun penerimaan divalidasi pola R-1/POS-PAY-01: milik perusahaan,
  // postable, aktif, dan benar-benar akun berkelas kas/bank/kliring
  // (A-27 B2: keanggotaan dari kelas akun, bukan slot pemetaan) —
  // akun lain tidak boleh menerima uang atas nama kas.
  const [cashAccount] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, input.accountId)))
    .limit(1);
  if (!cashAccount) throw new AppError("VALIDATION", "Akun kas/bank tidak ditemukan di perusahaan ini.");
  if (!cashAccount.isPostable || !cashAccount.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun ${cashAccount.code} — ${cashAccount.name} tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
    );
  }
  const cashBankIds = await listCashBankIds(tx, input.companyId);
  if (!cashBankIds.has(input.accountId)) {
    throw new AppError(
      "VALIDATION",
      `Akun ${cashAccount.code} — ${cashAccount.name} bukan akun berkelas kas, bank, atau kliring untuk perusahaan ini.`,
    );
  }

  const [revenueAccount] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, input.revenueAccountId)))
    .limit(1);
  if (!revenueAccount) throw new AppError("VALIDATION", "Akun pendapatan tidak ditemukan di perusahaan ini.");
  if (revenueAccount.type !== "revenue") {
    throw new AppError(
      "VALIDATION",
      `Akun ${revenueAccount.code} — ${revenueAccount.name} bukan akun pendapatan.`,
    );
  }
  if (!revenueAccount.isPostable || !revenueAccount.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun pendapatan ${revenueAccount.code} — ${revenueAccount.name} tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
    );
  }

  const rate = d(input.taxRate);
  // R3-05: belah bersama pratinjau (splitCashSaleWithDiscount) —
  // pajak atas dasar sesudah diskon, pendapatan dikredit bruto,
  // kas diterima sebesar bruto − diskon. Tanpa diskon hasilnya
  // identik dengan belah lama atas bruto penuh.
  const { tax, revenue, cash } = splitCashSaleWithDiscount(gross, rate, input.taxIncluded, discount);
  // getAccountId melempar VALIDATION yang menyebut pemetaannya bila
  // perusahaan belum memetakan PPN keluaran — akun tidak pernah ditebak.
  const taxAccountId = tax.gt(0) ? await getAccountId(tx, input.companyId, "tax_output") : null;
  const discountAccountId = discount.gt(0)
    ? await getAccountId(tx, input.companyId, "sales_discount")
    : null;

  const notes = input.notes?.trim();
  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: notes ? `Penjualan tunai — ${notes}` : "Penjualan tunai (input cepat)",
    sourceType: "quick_cash_sale",
    createdBy: input.userId,
    idempotencyKey: input.idempotencyKey ?? null,
    lines: [
      { accountId: input.accountId, debit: cash, description: "Penerimaan penjualan tunai" },
      ...(discountAccountId
        ? [{ accountId: discountAccountId, debit: discount, description: "Diskon penjualan" }]
        : []),
      {
        accountId: input.revenueAccountId,
        credit: revenue,
        description: "Pendapatan penjualan tunai",
        ...(input.customerId
          ? { partyType: "customer", partyId: input.customerId }
          : {}),
      },
      ...(taxAccountId
        ? [{ accountId: taxAccountId, credit: tax, description: "PPN keluaran" }]
        : []),
    ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "quick_entry.cash_sale",
    entityType: "journal_entry",
    entityId: entry.id,
    after: {
      number: entry.number,
      amount: toDb(gross),
      tax: toDb(tax),
      discount: toDb(discount),
      customerId: input.customerId ?? null,
    },
  });
  return { journalId: entry.id, journalNumber: entry.number };
}

/* ------------------------------------------------------------------ */
/* Terima piutang — FIFO ke dokumen terbuka pelanggan                  */
/* ------------------------------------------------------------------ */

export type OpenReceivableDoc = {
  kind: "sale" | "opening";
  id: string;
  number: string;
  date: string;
  outstanding: Decimal;
};

/**
 * Dokumen piutang terbuka satu pelanggan, tertua dulu — definisi yang
 * sama seperti listReceivables (penjualan completed belum lunas +
 * saldo awal piutang berstatus open), diurutkan tanggal lalu waktu
 * buat agar urutan FIFO deterministik.
 */
type OpenReceivableSaleRow = {
  id: string;
  number: string;
  date: string;
  createdAt: Date;
  total: string;
  paidTotal: string;
};

type OpenReceivableOpeningRow = {
  id: string;
  number: string;
  date: string;
  createdAt: Date;
  amount: string;
  paidAmount: string;
};

/**
 * Perakitan murni dokumen piutang terbuka dari baris penjualan &
 * saldo awal: sisa > 0 saja, digabung lalu diurutkan (tanggal, waktu
 * buat). Dipakai bersama oleh varian satu pelanggan dan varian batch
 * di bawah agar semantiknya tidak bisa menyimpang.
 */
function assembleOpenReceivableDocs(
  saleRows: OpenReceivableSaleRow[],
  openingRows: OpenReceivableOpeningRow[],
): OpenReceivableDoc[] {
  const docs: (OpenReceivableDoc & { createdAt: Date })[] = [];
  for (const row of saleRows) {
    const outstanding = d(row.total).minus(d(row.paidTotal));
    if (outstanding.gt(0)) {
      docs.push({ kind: "sale", id: row.id, number: row.number, date: row.date, createdAt: row.createdAt, outstanding });
    }
  }
  for (const row of openingRows) {
    const outstanding = d(row.amount).minus(d(row.paidAmount));
    if (outstanding.gt(0)) {
      docs.push({ kind: "opening", id: row.id, number: row.number, date: row.date, createdAt: row.createdAt, outstanding });
    }
  }
  docs.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime());
  return docs.map((doc) => ({
    kind: doc.kind,
    id: doc.id,
    number: doc.number,
    date: doc.date,
    outstanding: doc.outstanding,
  }));
}

export async function listOpenReceivableDocs(
  tx: Tx,
  companyId: string,
  customerId: string,
): Promise<OpenReceivableDoc[]> {
  const saleRows = await tx
    .select({
      id: sales.id,
      number: sales.number,
      date: sales.date,
      createdAt: sales.createdAt,
      total: sales.total,
      paidTotal: sales.paidTotal,
    })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.customerId, customerId),
        eq(sales.status, "completed"),
        inArray(sales.paymentStatus, ["unpaid", "partial"]),
      ),
    )
    .orderBy(asc(sales.date), asc(sales.createdAt));
  const openingRows = await tx
    .select({
      id: partyOpeningBalances.id,
      number: partyOpeningBalances.number,
      date: partyOpeningBalances.date,
      createdAt: partyOpeningBalances.createdAt,
      amount: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.kind, "receivable"),
        eq(partyOpeningBalances.partyId, customerId),
        eq(partyOpeningBalances.status, "open"),
      ),
    )
    .orderBy(asc(partyOpeningBalances.date), asc(partyOpeningBalances.createdAt));

  return assembleOpenReceivableDocs(saleRows, openingRows);
}

/**
 * A-26 Q1b (I-01): varian batch listOpenReceivableDocs untuk banyak
 * pelanggan sekaligus — 2 kueri total (penjualan + saldo awal dengan
 * IN), bukan 2 kueri per pelanggan. Hasil per pelanggan IDENTIK
 * dengan memanggil listOpenReceivableDocs satu per satu: kueri batch
 * memakai urutan (tanggal, waktu buat) yang sama sehingga sub-urutan
 * tiap pelanggan sama, dan perakitannya fungsi murni yang sama.
 * Pelanggan tanpa dokumen terbuka memetakan ke array kosong.
 */
export async function listOpenReceivableDocsForCustomers(
  tx: Tx,
  companyId: string,
  customerIds: string[],
): Promise<Map<string, OpenReceivableDoc[]>> {
  const result = new Map<string, OpenReceivableDoc[]>();
  if (customerIds.length === 0) return result;
  const saleRows = await tx
    .select({
      customerId: sales.customerId,
      id: sales.id,
      number: sales.number,
      date: sales.date,
      createdAt: sales.createdAt,
      total: sales.total,
      paidTotal: sales.paidTotal,
    })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        inArray(sales.customerId, customerIds),
        eq(sales.status, "completed"),
        inArray(sales.paymentStatus, ["unpaid", "partial"]),
      ),
    )
    .orderBy(asc(sales.date), asc(sales.createdAt));
  const openingRows = await tx
    .select({
      partyId: partyOpeningBalances.partyId,
      id: partyOpeningBalances.id,
      number: partyOpeningBalances.number,
      date: partyOpeningBalances.date,
      createdAt: partyOpeningBalances.createdAt,
      amount: partyOpeningBalances.amount,
      paidAmount: partyOpeningBalances.paidAmount,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        eq(partyOpeningBalances.kind, "receivable"),
        inArray(partyOpeningBalances.partyId, customerIds),
        eq(partyOpeningBalances.status, "open"),
      ),
    )
    .orderBy(asc(partyOpeningBalances.date), asc(partyOpeningBalances.createdAt));

  const salesByCustomer = new Map<string, OpenReceivableSaleRow[]>();
  for (const row of saleRows) {
    if (!row.customerId) continue;
    const { customerId, ...rest } = row;
    const list = salesByCustomer.get(customerId) ?? [];
    list.push(rest);
    salesByCustomer.set(customerId, list);
  }
  const openingsByCustomer = new Map<string, OpenReceivableOpeningRow[]>();
  for (const row of openingRows) {
    const { partyId, ...rest } = row;
    const list = openingsByCustomer.get(partyId) ?? [];
    list.push(rest);
    openingsByCustomer.set(partyId, list);
  }
  for (const customerId of customerIds) {
    result.set(
      customerId,
      assembleOpenReceivableDocs(
        salesByCustomer.get(customerId) ?? [],
        openingsByCustomer.get(customerId) ?? [],
      ),
    );
  }
  return result;
}

export type FifoPaymentResult = {
  /** Nomor pembayaran yang terbentuk, satu per dokumen yang tersentuh. */
  numbers: string[];
  allocations: { number: string | null; amount: string }[];
  /** FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank yang
   * diagregasi dari pembayaran per dokumen (mode warn). */
  warnings: string[];
  /** A-21 (R3-02): sisa pembayaran sesudah semua dokumen terbuka
   * lunas menjadi dokumen kredit pihak — nomor & nominalnya. */
  creditNumber?: string;
  creditAmount?: string;
};

export async function receiveReceivableFifo(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    customerId: string;
    date: string;
    amount: MoneyInput;
    accountId: string;
    notes?: string;
    /** Nomor referensi/bukti (R3-08): satu pembayaran FIFO, satu
     * bukti — diteruskan apa adanya ke setiap pembayaran per dokumen. */
    reference?: string;
    // POS1-05: kunci idempotensi pengiriman induk; kunci per dokumen
    // diturunkan darinya agar pembayaran per penjualan ikut idempoten.
    idempotencyKey?: string;
  },
): Promise<FifoPaymentResult> {
  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Jumlah penerimaan harus lebih dari nol.");
  }
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.companyId, input.companyId), eq(customers.id, input.customerId)))
    .limit(1);
  if (!customer) throw new AppError("NOT_FOUND", "Pelanggan tidak ditemukan.");

  const docs = await listOpenReceivableDocs(tx, input.companyId, input.customerId);
  // A-21 (R3-02): penerimaan boleh melebihi total piutang terbuka —
  // sisanya menjadi kredit pelanggan (termasuk DP murni ketika belum
  // ada dokumen terbuka sama sekali), bukan lagi penolakan.
  const numbers: string[] = [];
  const allocations: { number: string | null; amount: string }[] = [];
  const warnings: string[] = [];
  let allocatedTotal = d(0);
  for (const portion of allocateFifo(docs, amount)) {
    allocatedTotal = allocatedTotal.plus(portion.amount);
    if (portion.doc.kind === "sale") {
      const paid = await payReceivable(tx, {
        companyId: input.companyId,
        userId: input.userId,
        saleId: portion.doc.id,
        date: input.date,
        amount: toDb(portion.amount),
        accountId: input.accountId,
        notes: input.notes,
        reference: input.reference,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:sale:${portion.doc.id}` : undefined,
      });
      numbers.push(paid.number);
    } else {
      const paid = await payOpeningBalance(tx, {
        companyId: input.companyId,
        userId: input.userId,
        openingId: portion.doc.id,
        date: input.date,
        amount: toDb(portion.amount),
        accountId: input.accountId,
        notes: input.notes,
        reference: input.reference,
      });
      numbers.push(paid.number);
      warnings.push(...paid.warnings);
    }
    allocations.push({ number: portion.doc.number, amount: toDb(portion.amount) });
  }

  const leftover = amount.minus(allocatedTotal);
  if (leftover.gt(0)) {
    const credit = await createPartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      partyType: "customer",
      partyId: input.customerId,
      date: input.date,
      amount: leftover,
      originPaymentId: null,
      originLabel:
        numbers.length > 0
          ? "Sisa penerimaan FIFO sesudah semua piutang lunas"
          : "Uang muka (DP) — belum ada dokumen piutang terbuka",
      notes: input.notes ?? null,
    });
    const creditAccountId = await getAccountId(tx, input.companyId, "customer_credit");
    const journal = await postJournal(tx, {
      companyId: input.companyId,
      date: input.date,
      description: `Kredit pelanggan ${credit.number} dari kelebihan penerimaan piutang`,
      sourceType: "party_credit",
      sourceId: credit.id,
      createdBy: input.userId,
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:party-credit`
        : `party-credit:${credit.id}`,
      lines: [
        { accountId: input.accountId, debit: leftover, description: "Penerimaan kelebihan / uang muka" },
        {
          accountId: creditAccountId,
          credit: leftover,
          description: "Kredit pelanggan (uang muka)",
          partyType: "customer",
          partyId: input.customerId,
        },
      ],
    });
    await setPartyCreditJournal(tx, input.companyId, credit.id, journal.id);
    warnings.push(...journal.warnings);
    return { numbers, allocations, warnings, creditNumber: credit.number, creditAmount: toDb(leftover) };
  }
  return { numbers, allocations, warnings };
}

/* ------------------------------------------------------------------ */
/* Bayar utang — FIFO ke dokumen terbuka pemasok                       */
/* ------------------------------------------------------------------ */

export async function payPayableFifo(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    supplierId: string;
    date: string;
    amount: MoneyInput;
    accountId: string;
    notes?: string;
    /** Nomor referensi/bukti (R3-08) — diteruskan ke setiap
     * pembayaran per dokumen, sama seperti sisi terima piutang. */
    reference?: string;
    /**
     * A-21 Tahap R3-A (R3-06): potongan pajak TOTAL untuk pembayaran
     * FIFO ini — didistribusikan mengikuti urutan dokumen (tertua
     * lebih dulu) ke pembayaran per dokumen, masing-masing dibekukan
     * di baris party_payments-nya. Potongan tidak pernah melebihi
     * total yang teralokasi ke dokumen (kelebihan bayar/DP tidak
     * dipotong — belum ada utang yang dilunasi di porsi itu).
     */
    withholding?: WithholdingInput;
  },
): Promise<FifoPaymentResult> {
  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Jumlah pembayaran harus lebih dari nol.");
  }
  const [supplier] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, input.supplierId)))
    .limit(1);
  if (!supplier) throw new AppError("NOT_FOUND", "Pemasok tidak ditemukan.");

  // listSupplierOpenPayableDocs adalah definisi utang terbuka yang sama
  // dengan yang dipakai posting retur: alokasi retur pemasok sudah
  // dikurangkan, jadi FIFO tidak pernah membayar bagian yang sudah
  // diselesaikan retur.
  const goodsDocs = await listSupplierOpenPayableDocs(tx, input.companyId, input.supplierId);
  // A-21 (R3-11): beban terutang pemasok yang sama ikut dilunasi FIFO
  // sebagai dokumen utang — digabung dan diurutkan per tanggal
  // dokumen bersama penerimaan & saldo awal (urut stabil: pada
  // tanggal yang sama, dokumen barang/saldo awal didahulukan).
  // Daftar retur pemasok SENGAJA tidak diperluas ke beban: retur
  // hanya menyelesaikan utang barang.
  const expenseDocs = await listOpenExpensePayables(tx, input.companyId, input.supplierId);
  const docs = [
    ...goodsDocs.map((doc) => ({ ...doc, kind: doc.kind as "receipt" | "opening" })),
    ...expenseDocs.map((doc) => ({
      kind: "expense" as const,
      id: doc.id,
      number: doc.number as string | null,
      date: doc.date,
      outstanding: toDb(doc.outstanding),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // A-21 (R3-02): pembayaran boleh melebihi total utang terbuka —
  // sisanya menjadi kredit pemasok, bukan lagi penolakan.
  const numbers: string[] = [];
  const allocations: { number: string | null; amount: string }[] = [];
  const warnings: string[] = [];
  let allocatedTotal = d(0);
  const portions = allocateFifo(docs, amount);
  const portionsTotal = portions.reduce((sum, portion) => sum.plus(portion.amount), d(0));
  // A-21 Tahap R3-A (R3-06): validasi potongan SEKALI di depan
  // (saklar, jenis, plafon total teralokasi) sebelum dokumen apa pun
  // dibayar — kegagalan di tengah loop akan menggugurkan seluruh
  // transaksi pemanggil, tetapi pesan yang jelas sejak awal lebih
  // baik daripada jurnal separuh terbentuk.
  let withholdingRemaining = d(0);
  if (input.withholding && d(input.withholding.amount).gt(0)) {
    await resolveWithholding(tx, input.companyId, input.withholding, portionsTotal);
    withholdingRemaining = d(input.withholding.amount);
  }
  for (const portion of portions) {
    allocatedTotal = allocatedTotal.plus(portion.amount);
    // Distribusi FIFO: potongan mengisi alokasi tertua lebih dulu;
    // setiap irisan dibekukan di pembayaran dokumennya sendiri.
    const slice = withholdingRemaining.gt(portion.amount)
      ? portion.amount
      : withholdingRemaining;
    withholdingRemaining = withholdingRemaining.minus(slice);
    const portionWithholding: WithholdingInput | undefined =
      slice.gt(0) && input.withholding
        ? { type: input.withholding.type, rate: input.withholding.rate, amount: toDb(slice) }
        : undefined;
    if (portion.doc.kind === "receipt") {
      const paid = await payPayableDocument(tx, {
        companyId: input.companyId,
        userId: input.userId,
        receiptId: portion.doc.id,
        date: input.date,
        amount: toDb(portion.amount),
        accountId: input.accountId,
        notes: input.notes,
        reference: input.reference,
        withholding: portionWithholding,
      });
      numbers.push(paid.number);
      warnings.push(...paid.warnings);
    } else if (portion.doc.kind === "expense") {
      const paid = await payExpensePayable(tx, {
        companyId: input.companyId,
        userId: input.userId,
        expenseId: portion.doc.id,
        date: input.date,
        amount: toDb(portion.amount),
        accountId: input.accountId,
        notes: input.notes,
        reference: input.reference,
        withholding: portionWithholding,
      });
      numbers.push(paid.number);
      warnings.push(...paid.warnings);
    } else {
      const paid = await payOpeningBalance(tx, {
        companyId: input.companyId,
        userId: input.userId,
        openingId: portion.doc.id,
        date: input.date,
        amount: toDb(portion.amount),
        accountId: input.accountId,
        notes: input.notes,
        reference: input.reference,
        withholding: portionWithholding,
      });
      numbers.push(paid.number);
      warnings.push(...paid.warnings);
    }
    allocations.push({ number: portion.doc.number, amount: toDb(portion.amount) });
  }

  const leftover = amount.minus(allocatedTotal);
  if (leftover.gt(0)) {
    const credit = await createPartyCredit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      partyType: "supplier",
      partyId: input.supplierId,
      date: input.date,
      amount: leftover,
      originPaymentId: null,
      originLabel:
        numbers.length > 0
          ? "Sisa pembayaran FIFO sesudah semua utang lunas"
          : "Uang muka (DP) — belum ada dokumen utang terbuka",
      notes: input.notes ?? null,
    });
    const creditAccountId = await getAccountId(tx, input.companyId, "supplier_credit");
    const journal = await postJournal(tx, {
      companyId: input.companyId,
      date: input.date,
      description: `Kredit pemasok ${credit.number} dari kelebihan pembayaran utang`,
      sourceType: "party_credit",
      sourceId: credit.id,
      createdBy: input.userId,
      idempotencyKey: `party-credit:${credit.id}`,
      lines: [
        {
          accountId: creditAccountId,
          debit: leftover,
          description: "Kredit pemasok (uang muka)",
          partyType: "supplier",
          partyId: input.supplierId,
        },
        { accountId: input.accountId, credit: leftover, description: "Pembayaran kelebihan / uang muka" },
      ],
    });
    await setPartyCreditJournal(tx, input.companyId, credit.id, journal.id);
    warnings.push(...journal.warnings);
    return { numbers, allocations, warnings, creditNumber: credit.number, creditAmount: toDb(leftover) };
  }
  return { numbers, allocations, warnings };
}

// A-12 (D-23): draf Catat Transaksi milik pengguna — dulu kueri inline di
// dasbor akuntansi (FIX-ARS Tahap 6, ARS1-01).
export async function listQuickEntryDrafts(tx: Tx, companyId: string, userId: string) {
  return tx
    .select()
    .from(quickEntryDrafts)
    .where(and(eq(quickEntryDrafts.companyId, companyId), eq(quickEntryDrafts.userId, userId)))
    .orderBy(desc(quickEntryDrafts.updatedAt));
}
