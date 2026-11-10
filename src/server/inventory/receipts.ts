// FIX-ARS Tahap 4: bagian dari pemecahan src/server/inventory.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  products,
  stockReceiptLines,
  stockReceipts,
  suppliers,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { Decimal, d, lineTax, receiptLineDiscount, toDb } from "@/lib/money";
import { costPerBaseUnit, toBaseQty } from "@/lib/packaging";
import { resolveLinePackagings } from "@/server/catalog";
import { assertPeriodOpen, listCashBankIds } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import {
  applyReceiptToPurchaseOrder,
  lockPurchaseOrderForReceipt,
} from "@/server/purchasing";
import { normalizeSerialNumbers } from "@/server/serials";
import { nextDocumentNumber } from "@/server/sequences";
import { claimIdempotencyKey } from "@/server/idempotency";
import { assertSupplierOwned, assertWarehouseOwned } from "./movements";

import { postReceiptJournal, type ReceiptSource } from "./receipt-journal";
import { applyReceiptSalePrices } from "./receipt-prices";
import { resolveReceiptTax, type ReceiptTaxContext } from "./receipt-tax";
import { insertPurchaseAdvanceAllocations } from "@/server/purchase-advances";
import { prepareReceiptAdvance } from "./receipt-advance";
import { applyReceiptStock } from "./receipt-stock";
import type { EffectiveReceiptLine } from "./receipt-types";

// S2: tipe & label sumber penerimaan kini tinggal di receipt-journal.ts
// (rumah fase jurnalnya); di-re-export agar jalur impor publik lewat
// barrel inventory tidak berubah.
export { RECEIPT_SOURCE_LABELS } from "./receipt-journal";
export type { ReceiptSource };


type CreateReceiptInput = {
  companyId: string;
  userId: string;
  warehouseId: string;
  supplierId?: string | null;
  source?: ReceiptSource;
  purchaseOrderId?: string | null;
  paymentAccountId?: string | null;
  supplierInvoiceNumber?: string | null;
  /** GDG3-06: kunci idempotensi dari klien (pola POS). */
  idempotencyKey?: string | null;
  /**
   * FIX-P1 Tahap 4 (AK1-06/AK4-04): harga baris adalah harga faktur
   * TERMASUK PPN. Hanya untuk sumber "purchase" dan hanya bila PPN
   * perusahaan aktif — PPN dipisah ke PPN Masukan, persediaan masuk
   * sebesar DPP. Penandaan per dokumen (satu faktur pemasok = satu
   * status kena pajak), mengikuti tarif PPN perusahaan yang sama
   * dengan PPN Keluaran di POS.
   */
  taxIncluded?: boolean;
  /**
   * PPN Masukan eksplisit (nominal absolut, harga baris = DPP/belum
   * termasuk PPN). Fleksibel: kosong/0 = non-PPN. Tidak boleh dipakai
   * bersamaan dengan `taxIncluded`.
   */
  taxAmount?: string | number;
  /** PPN dalam persen (0–100). Harga baris diperlakukan DPP. */
  taxPercent?: string | number;
  /** Porsi total yang dipotong dari uang muka pemasok (FIFO). */
  advanceAmount?: string | number;
  /** DATA-002: konfirmasi eksplisit untuk memperbarui harga jual katalog master */
  updateCatalogSalePrices?: boolean;
  date: string;
  notes?: string;
  lines: {
    productId: string;
    qty: string | number;
    unitCost: string | number;
    /**
     * Diskon baris. `nominal` adalah TOTAL potongan baris (bukan per
     * unit); `percent` dihitung dari qty × harga beli. Nilai diskon
     * mengurangi DPP dan nilai persediaan.
     */
    discountType?: "percent" | "nominal" | null;
    discountValue?: string | number;
    /** Harga jual master baru (per satuan masukan; opsional). */
    salePrice?: string | number;
    /**
     * Baris berkemasan (Satuan Kemasan S2): bila terisi, `qty` adalah
     * jumlah KEMASAN dan `unitCost` harga PER KEMASAN; konversi ke
     * satuan dasar terjadi sekali di buildReceiptLines — semua jalur
     * sesudahnya (stok, AVCO, jurnal, jembatan PO) hanya melihat qty
     * dasar & harga per pcs.
     */
    packagingId?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
    serialNumbers?: string[];
  }[];
};

/**
 * Goods receipt (D-5). One document type, five sources, and the source —
 * not a guess — decides the journal's credit side:
 * - purchase without a payment account: on credit, Dr Inventory / Cr
 *   Payable, and the document joins the payables list;
 * - purchase with a payment account: paid in cash at receipt time,
 *   Dr Inventory / Cr that cash/bank account, born fully paid, never a
 *   payable;
 * - opening / other: Dr Inventory / Cr equity mapping (opening balance);
 * - bonus: Dr Inventory / Cr optional `other_income` mapping, falling back
 *   to the revenue account until the company maps one (same optional-key
 *   pattern as payroll's `salary_deductions_payable`);
 * - customer_return: Dr Inventory / Cr `sales_return`.
 * A supplier is only required for purchases; non-purchase receipts owe
 * nothing, so they are stored as paymentStatus "paid" and stay out of the
 * payables list.
 */


export async function createReceipt(tx: Tx, input: CreateReceiptInput) {
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Tambahkan minimal satu barang.");

  const { existing, idemKey } = await claimReceiptIdempotency(tx, input);
  if (existing) return existing;

  const context = await resolveReceiptContext(tx, input);
  const { source, supplierId, paymentAccountId } = context;

  const { effectiveLines, productById, bridgeLines } = await buildReceiptLines(tx, input, context);

  // Optional PO link (G7/D-6): validate and lock the order before any
  // write, so an over-receipt or wrong-supplier rejection leaves nothing
  // behind. Only purchase receipts can fulfil a PO.
  const purchaseOrderId = input.purchaseOrderId ?? null;
  let purchaseOrderContext: Awaited<ReturnType<typeof lockPurchaseOrderForReceipt>> | null = null;
  if (purchaseOrderId) {
    if (source !== "purchase") {
      throw new AppError(
        "VALIDATION",
        "Penerimaan yang tertaut pesanan pembelian harus bersumber Pembelian dari pemasok.",
      );
    }
    purchaseOrderContext = await lockPurchaseOrderForReceipt(tx, {
      companyId: input.companyId,
      orderId: purchaseOrderId,
      supplierId: supplierId as string,
      // S2: jembatan PO membandingkan qty SATUAN DASAR (baris PO juga
      // menyimpan qty dasar) — baris berkemasan sudah dikonversi.
      lines: bridgeLines,
    });
  }

  const linesDpp = effectiveLines.reduce((acc, line) => acc.plus(line.lineNet), d(0));
  const percentTax = context.taxPercent.gt(0)
    ? linesDpp.mul(context.taxPercent).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : d(0);
  const explicitTaxForDocument = context.explicitTax.gt(0) ? context.explicitTax : percentTax;
  const invoiceTotal = linesDpp.plus(explicitTaxForDocument);
  const advancePlan = await prepareReceiptAdvance(tx, {
    companyId: input.companyId,
    source,
    supplierId,
    invoiceTotal,
    requested: input.advanceAmount,
  });

  const { receipt, total, totalTax, totalNet } = await insertReceiptDocument(tx, input, {
    source,
    supplierId,
    paymentAccountId,
    purchaseOrderId,
    idemKey,
    effectiveLines,
    taxRate: context.taxPercent.gt(0) ? context.taxPercent : context.taxRate,
    explicitTax: explicitTaxForDocument,
    advanceApplied: advancePlan.applied,
  });

  await insertPurchaseAdvanceAllocations(
    tx,
    input.companyId,
    receipt.id,
    advancePlan.allocations,
  );
  await applyReceiptStock(tx, input, receipt, effectiveLines, productById);
  await applyReceiptSalePrices(tx, {
    companyId: input.companyId,
    userId: input.userId,
    source,
    updateCatalogSalePrices: input.updateCatalogSalePrices,
    lines: effectiveLines,
  });

  if (purchaseOrderContext) {
    await applyReceiptToPurchaseOrder(tx, {
      companyId: input.companyId,
      order: purchaseOrderContext.order,
      orderLines: purchaseOrderContext.orderLines,
      lines: bridgeLines,
    });
  }

  await postReceiptJournal(
    tx,
    { companyId: input.companyId, userId: input.userId, date: input.date },
    receipt,
    {
      source,
      supplierId,
      paymentAccountId,
      total,
      totalNet,
      totalTax,
      taxInputAccountId: context.taxInputAccountId,
      advanceApplied: advancePlan.applied,
      advanceAccountId: advancePlan.accountId,
    },
  );

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "purchase.receive",
    entityType: "stock_receipt",
    entityId: receipt.id,
    after: {
      number: receipt.number,
      source,
      total: toDb(total),
      ...(totalTax.gt(0) ? { taxAmount: toDb(totalTax) } : {}),
      ...(purchaseOrderContext
        ? { purchaseOrderNumber: purchaseOrderContext.order.number }
        : {}),
    },
  });

  return receipt;
}

/**
 * FIX-ARS Tahap 4: fase dari createReceipt — badan dipindah apa adanya;
 * klaim kunci idempotensi (GDG3-06). Mengembalikan penerimaan yang
 * sudah ada bila ini replay; null-klaim berarti panggilan ini yang
 * berhak melanjutkan pembuatan dokumen.
 */


async function claimReceiptIdempotency(
  tx: Tx,
  input: CreateReceiptInput,
): Promise<{ existing: { id: string; number: string } | undefined; idemKey: string | null }> {
  // GDG3-06: replay idempotensi — submit ulang berkunci sama (klik
  // ganda, dua tab, retry sesudah timeout) mengembalikan penerimaan
  // pertama, bukan membuat dokumen kedua.
  const idemKey = input.idempotencyKey?.trim() || null;
  const findReceiptByKey = async () => {
    if (!idemKey) return undefined;
    const [row] = await tx
      .select({ id: stockReceipts.id, number: stockReceipts.number })
      .from(stockReceipts)
      .where(and(eq(stockReceipts.companyId, input.companyId), eq(stockReceipts.idempotencyKey, idemKey)))
      .limit(1);
    return row;
  };
  if (idemKey) {
    const existing = await findReceiptByKey();
    if (existing) return { existing, idemKey };
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: idemKey,
      scope: "inventory.receipt",
    });
    if (!claimed) {
      const winner = await findReceiptByKey();
      if (winner) return { existing: winner, idemKey };
      throw new AppError(
        "CONFLICT",
        "Penerimaan dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }
  return { existing: undefined, idemKey };
}


type ReceiptContext = {
  source: ReceiptSource;
  supplierId: string | null;
  paymentAccountId: string | null;
} & ReceiptTaxContext;

/**
 * FIX-ARS Tahap 4: fase dari createReceipt — badan dipindah apa adanya;
 * validasi konteks dokumen — periode, kepemilikan gudang/pemasok,
 * faktur ganda, aturan sumber, akun pembayaran, resolusi PPN
 * Masukan. Semua penolakan terjadi sebelum apa pun ditulis.
 */


async function resolveReceiptContext(tx: Tx, input: CreateReceiptInput): Promise<ReceiptContext> {
  // FIX-GDG Tahap 2 (GDG3-02): periode dinilai dari TANGGAL DOKUMEN di
  // muka — bukan hanya secara tidak langsung lewat jurnal. Penerimaan
  // bernilai nol melewati postJournal (total 0), jadi tanpa pemeriksaan
  // ini stok bertambah di periode yang sudah ditutup. Replay
  // idempotensi di atas tetap bebas: ia tidak menulis apa pun.
  await assertPeriodOpen(tx, input.companyId, input.date);

  const source: ReceiptSource = input.source ?? "purchase";
  const supplierId = input.supplierId ?? null;
  const paymentAccountId = input.paymentAccountId ?? null;

  // GDG3-07: gudang & pemasok harus milik perusahaan ini.
  await assertWarehouseOwned(tx, input.companyId, input.warehouseId);
  if (supplierId) await assertSupplierOwned(tx, input.companyId, supplierId);

  // GDG3-04: nomor faktur pemasok yang sama untuk pemasok yang sama
  // hampir selalu berarti faktur yang sama diterima dua kali — vektor
  // klasik utang ganda. Baris pemasok dikunci selama pemeriksaan agar
  // dua penerimaan bersamaan tidak sama-sama lolos; penerimaan yang
  // sudah di-void tidak menghalangi (faktur bebas dicatat ulang).
  const invoiceNumber = input.supplierInvoiceNumber?.trim() || null;
  if (supplierId && invoiceNumber) {
    await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, supplierId)))
      .limit(1)
      .for("update");
    const [duplicate] = await tx
      .select({ number: stockReceipts.number })
      .from(stockReceipts)
      .where(
        and(
          eq(stockReceipts.companyId, input.companyId),
          eq(stockReceipts.supplierId, supplierId),
          ne(stockReceipts.status, "void"),
          sql`lower(trim(${stockReceipts.supplierInvoiceNumber})) = ${invoiceNumber.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new AppError(
        "VALIDATION",
        `Nomor faktur pemasok "${invoiceNumber}" sudah dipakai pada penerimaan ${duplicate.number} untuk pemasok ini. Periksa kembali agar utang tidak tercatat dua kali.`,
      );
    }
  }

  if (source === "purchase" && !supplierId) {
    throw new AppError("VALIDATION", "Pemasok wajib dipilih untuk penerimaan pembelian.");
  }
  if (paymentAccountId && source !== "purchase") {
    throw new AppError(
      "VALIDATION",
      "Akun pembayaran hanya berlaku untuk pembelian tunai. Untuk sumber selain pembelian, akun lawan ditentukan oleh sumber penerimaan.",
    );
  }
  if (source === "other" && !input.notes?.trim()) {
    throw new AppError(
      "VALIDATION",
      "Alasan wajib ditulis di catatan untuk penerimaan dengan sumber Lainnya.",
    );
  }
  if (paymentAccountId) {
    // Same account validation as postJournal (AK-P1-02), done up front so
    // the error names the field instead of surfacing mid-journal.
    const [account] = await tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        isPostable: accounts.isPostable,
        isActive: accounts.isActive,
      })
      .from(accounts)
      .where(and(eq(accounts.companyId, input.companyId), eq(accounts.id, paymentAccountId)))
      .limit(1);
    if (!account) {
      throw new AppError("VALIDATION", "Akun pembayaran tidak ditemukan di perusahaan ini.");
    }
    if (!account.isPostable || !account.isActive) {
      throw new AppError(
        "VALIDATION",
        `Akun pembayaran ${account.code} — ${account.name} tidak dapat dipakai: akun harus aktif dan dapat diposting.`,
      );
    }
    // R-1: a cash purchase may only settle into one of the company's
    // cash/bank accounts — exactly the shortlist the receipt page
    // offers. Without this, any postable account (inventory,
    // revenue, ...) could be credited as if it were money.
    // A-27 B2: keanggotaan dari kelas akun (listCashBankIds), bukan
    // lagi slot pemetaan cash/bank/qris.
    const allowedPaymentAccounts = await listCashBankIds(tx, input.companyId);
    if (!allowedPaymentAccounts.has(paymentAccountId)) {
      throw new AppError(
        "VALIDATION",
        `Akun pembayaran ${account.code} — ${account.name} bukan akun berkelas kas, bank, atau kliring untuk perusahaan ini. Pilih akun pembayaran dari daftar akun kas/bank.`,
      );
    }
  }

  // FIX-P1 Tahap 4 (AK1-06/AK4-04): resolusi PPN Masukan di muka, agar
  // penolakan (PPN nonaktif / tarif 0 / pemetaan hilang) terjadi sebelum
  // apa pun ditulis — pola yang sama seperti validasi akun pembayaran.
  const tax = await resolveReceiptTax(tx, {
    companyId: input.companyId,
    source,
    taxIncluded: input.taxIncluded,
    taxAmount: input.taxAmount,
    taxPercent: input.taxPercent,
  });
  return {
    source,
    supplierId,
    paymentAccountId,
    ...tax,
  };
}


/**
 * FIX-ARS Tahap 4: fase dari createReceipt — badan dipindah apa adanya;
 * resolusi produk & validasi per baris (qty/biaya, batch, seri,
 * identitas duplikat, belah PPN) menjadi baris efektif yang siap
 * ditulis — tetap sebelum tulisan apa pun.
 */


async function buildReceiptLines(
  tx: Tx,
  input: CreateReceiptInput,
  { source, taxIncluded, taxRate }: ReceiptContext,
) {
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const found = await tx
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
      costPrice: products.costPrice,
    })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), inArray(products.id, productIds)));
  if (found.length !== productIds.length) throw new AppError("VALIDATION", "Ada produk yang tidak ditemukan.");
  const productById = new Map(found.map((row) => [row.id, row]));

  // S2: pilihan kemasan divalidasi & dibekukan faktornya di sini —
  // konversi qty/harga ke satuan dasar terjadi di pemetaan baris di
  // bawah, sebelum validasi batch/seri, belah PPN, dan penulisan apa
  // pun, sehingga seluruh jalur lanjutan tidak berubah bentuk.
  const resolvedPackagings = await resolveLinePackagings(
    tx,
    input.companyId,
    input.lines,
    (productId) => productById.get(productId)?.name ?? "Produk",
  );

  // Per-line domain validation, run before anything is written:
  // - R-9: qty must be > 0 and unit cost >= 0, named per product (the
  //   domain-level twin of the action schemas' GD-P1-7 rules, so direct
  //   domain callers cannot sneak a zero/negative line past either).
  // - G8/D-7: a batch-tracked product can only be received under a batch
  //   number (expiry stays optional — dateless batches sort last in FEFO).
  // - R-4: duplicates are judged per line identity — one line per product
  //   for untracked products, one line per (product, batch, expiry) for
  //   batch-tracked ones, so a delivery split across batches is legal.
  // - R-6: a customer return is valued at the product's running moving
  //   average, never at a typed-in cost (the POS return path restores at
  //   the original sale cost; the running average is its equivalent here).
  const seenIdentities = new Set<string>();
  const effectiveLines = input.lines.map((line, index) => {
    const product = productById.get(line.productId)!;
    let enteredQty: Decimal;
    let enteredUnitCost: Decimal;
    try {
      enteredQty = d(line.qty);
      enteredUnitCost = d(line.unitCost);
    } catch {
      throw new AppError(
        "VALIDATION",
        `Jumlah dan harga beli untuk ${product.name} harus berupa angka yang valid.`,
      );
    }
    if (!enteredQty.isFinite() || !enteredUnitCost.isFinite()) {
      throw new AppError(
        "VALIDATION",
        `Jumlah dan harga beli untuk ${product.name} harus berupa angka yang valid.`,
      );
    }
    if (!enteredQty.gt(0)) {
      throw new AppError(
        "VALIDATION",
        `Jumlah penerimaan ${product.name} harus lebih dari 0.`,
      );
    }
    if (enteredUnitCost.lt(0)) {
      throw new AppError(
        "VALIDATION",
        `Harga beli ${product.name} tidak boleh negatif.`,
      );
    }
    // S2: SATU titik konversi kemasan — qty & harga baris menjadi
    // satuan dasar di sini; semua validasi & hitungan di bawah
    // (batch, seri, belah PPN, total) bekerja pada nilai dasar.
    const snap = resolvedPackagings[index];
    const qty = snap.packaging
      ? d(toBaseQty(toDb(enteredQty), snap.isiSnapshot))
      : enteredQty;
    const unitCost = snap.packaging
      ? d(costPerBaseUnit(toDb(enteredUnitCost), snap.isiSnapshot))
      : enteredUnitCost;
    const enteredSalePrice =
      line.salePrice !== undefined && line.salePrice !== null && line.salePrice !== ""
        ? d(line.salePrice)
        : null;
    if (enteredSalePrice && (!enteredSalePrice.isFinite() || enteredSalePrice.lt(0))) {
      throw new AppError("VALIDATION", `Harga jual ${product.name} tidak boleh negatif.`);
    }
    const salePriceBase = enteredSalePrice
      ? snap.packaging
        ? enteredSalePrice.div(d(snap.isiSnapshot))
        : enteredSalePrice
      : null;
    const batchNumber = line.batchNumber?.trim() || null;
    const expiryDate = line.expiryDate || null;
    if (product.trackBatch && !batchNumber) {
      throw new AppError(
        "VALIDATION",
        `Nomor batch wajib diisi untuk ${product.name} karena produk ini dilacak per batch.`,
      );
    }
    // SIM-2 S7B-2 Batch 5: produk serial wajib daftar nomor seri per
    // unit — jumlah seri harus persis qty (bilangan bulat) dan unik.
    let serialNumbers: string[] = [];
    if (product.trackSerial) {
      serialNumbers = normalizeSerialNumbers(line.serialNumbers ?? []);
      if (!qty.isInteger() || serialNumbers.length !== qty.toNumber()) {
        throw new AppError(
          "VALIDATION",
          `Nomor seri wajib diisi per unit untuk ${product.name}: dibutuhkan ${qty.toString()} nomor seri.`,
        );
      }
      if (new Set(serialNumbers).size !== serialNumbers.length) {
        throw new AppError("VALIDATION", `Nomor seri ${product.name} duplikat dalam satu penerimaan.`);
      }
    }
    const identity = product.trackBatch
      ? `${line.productId}|${batchNumber ?? ""}|${expiryDate ?? ""}`
      : line.productId;
    if (seenIdentities.has(identity)) {
      throw new AppError(
        "VALIDATION",
        product.trackBatch
          ? `Batch ${batchNumber} untuk ${product.name} muncul lebih dari sekali dalam satu penerimaan. Gabungkan jumlahnya ke satu baris batch yang sama.`
          : `Produk ${product.name} muncul lebih dari sekali. Gabungkan jumlahnya ke satu baris.`,
      );
    }
    seenIdentities.add(identity);
    const effectiveUnitCost = source === "customer_return" ? d(product.costPrice) : unitCost;
    const enteredDiscount = d(line.discountValue ?? 0);
    if (!enteredDiscount.isFinite() || enteredDiscount.lt(0)) {
      throw new AppError(
        "VALIDATION",
        `Diskon ${product.name} tidak boleh negatif.`,
      );
    }
    const discountType: "percent" | "nominal" | null = enteredDiscount.gt(0)
      ? (line.discountType ?? "nominal")
      : null;
    if (discountType === "percent" && enteredDiscount.gt(100)) {
      throw new AppError(
        "VALIDATION",
        `Diskon ${product.name} tidak boleh lebih dari 100%.`,
      );
    }
    // Diskon mengurangi DPP. Nominal diperlakukan sebagai TOTAL potongan
    // baris (bukan per unit) agar cocok dengan faktur pemasok.
    const lineGross = qty.mul(effectiveUnitCost);
    const discountAmount = receiptLineDiscount(
      lineGross,
      discountType,
      enteredDiscount,
    ).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (discountAmount.gt(lineGross)) {
      throw new AppError(
        "VALIDATION",
        `Diskon ${product.name} melebihi nilai baris. Periksa kembali potongan yang dimasukkan.`,
      );
    }
    const lineNet = lineGross.minus(discountAmount);
    // FIX-P1 Tahap 4 (AK4-04): belah PPN per baris dengan rumus inklusif
    // yang sama seperti POS (pajak = bruto × tarif/(100+tarif)); bersih
    // adalah sisanya, jadi bersih + pajak selalu tepat sama dengan
    // bruto baris. `unitCost` baris tetap harga faktur yang diketik;
    // yang masuk stok (AVCO) adalah `stockUnitCost` sebesar DPP —
    // PPN yang dapat dikreditkan bukan biaya persediaan.
    const lineTaxAmount = taxIncluded
      ? lineTax({ net: lineNet, rate: taxRate, inclusive: true })
      : d(0);
    const stockUnitCost = lineNet.minus(lineTaxAmount).div(qty);
    return {
      productId: line.productId,
      // REM-02: freeze the master's name/SKU on the line (snapshot).
      productName: product.name,
      productSku: product.sku,
      qty,
      unitCost: effectiveUnitCost,
      discountType,
      discountValue: enteredDiscount,
      discountAmount,
      lineNet,
      stockUnitCost,
      salePriceBase,
      taxAmount: lineTaxAmount,
      packagingId: snap.packaging?.id ?? null,
      qtyInput: toDb(enteredQty),
      isiSnapshot: snap.isiSnapshot,
      batchNumber,
      expiryDate,
      serialNumbers,
    };
  });
  // Baris jembatan PO: pasangan produk + qty SATUAN DASAR per baris
  // masukan (lock & apply di purchasing.ts mengagregasi per produk).
  const bridgeLines = effectiveLines.map((line) => ({
    productId: line.productId,
    qty: toDb(line.qty),
  }));
  return { effectiveLines, productById, bridgeLines };
}

/**
 * FIX-ARS Tahap 4: fase dari createReceipt — badan dipindah apa adanya;
 * penulisan dokumen — nomor, total bruto/pajak/bersih, baris
 * penerimaan dan baris-baris rincinya.
 */


async function insertReceiptDocument(
  tx: Tx,
  input: CreateReceiptInput,
  args: {
    source: ReceiptSource;
    supplierId: string | null;
    paymentAccountId: string | null;
    purchaseOrderId: string | null;
    idemKey: string | null;
    effectiveLines: EffectiveReceiptLine[];
    taxRate: Decimal;
    explicitTax: Decimal;
    advanceApplied: Decimal;
  },
) {
  const {
    source,
    supplierId,
    paymentAccountId,
    purchaseOrderId,
    idemKey,
    effectiveLines,
    taxRate,
    explicitTax,
    advanceApplied,
  } = args;
  const number = await nextDocumentNumber(tx, input.companyId, "RECEIPT", input.date);
  const linesTotal = effectiveLines.reduce((acc, l) => acc.plus(l.lineNet), d(0));
  // Total faktur = DPP + PPN. PPN eksplisit ditambahkan di atas harga
  // baris (yang sudah DPP); jalur inklusif memisahkan dari harga bruto.
  const totalTax = explicitTax.gt(0)
    ? explicitTax
    : effectiveLines.reduce((acc, l) => acc.plus(l.taxAmount), d(0));
  const total = explicitTax.gt(0) ? linesTotal.plus(explicitTax) : linesTotal;
  // Yang masuk persediaan hanya DPP.
  const totalNet = total.minus(totalTax);
  const isCreditPurchase = source === "purchase" && !paymentAccountId;
  const paidAmount =
    source === "purchase" ? (paymentAccountId ? total : advanceApplied) : d(0);
  const paymentStatus = isCreditPurchase
    ? advanceApplied.gte(total)
      ? "paid"
      : advanceApplied.gt(0)
        ? "partial"
        : "unpaid"
    : "paid";

  const [receipt] = await tx
    .insert(stockReceipts)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      supplierId,
      purchaseOrderId,
      source,
      paymentAccountId,
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
      idempotencyKey: idemKey,
      number,
      date: input.date,
      status: "posted",
      total: toDb(total),
      taxRate: toDb(taxRate),
      taxAmount: toDb(totalTax),
      // Cash purchases are paid the moment they are received; non-purchase
      // receipts owe nothing. Only credit purchases start unpaid.
      paidAmount: toDb(paidAmount),
      paymentStatus,
      notes: input.notes,
      createdBy: input.userId,
      postedAt: new Date(),
    })
    .returning({ id: stockReceipts.id, number: stockReceipts.number });

  await tx.insert(stockReceiptLines).values(
    effectiveLines.map((line) => ({
      companyId: input.companyId,
      receiptId: receipt.id,
      productId: line.productId,
      productName: line.productName,
      productSku: line.productSku,
      qty: toDb(line.qty),
      unitCost: toDb(line.unitCost),
      lineTotal: toDb(line.lineNet),
      discountType: line.discountType,
      discountValue: toDb(line.discountValue),
      discountAmount: toDb(line.discountAmount),
      // S2: bentuk masukan berkemasan + faktor cuplikannya.
      packagingId: line.packagingId,
      qtyInput: line.qtyInput,
      isiSnapshot: line.isiSnapshot,
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
    })),
  );
  return { receipt, total, totalTax, totalNet };
}

/**
 * Fase jurnal createReceipt (FIX-ARS Tahap 4) kini tinggal di
 * receipt-journal.ts — diekstrak pada S2 mengikuti pola receipt-void
 * karena berkas ini menembus ratchet ukuran (A-26 Q1).
 */


/** Movement reference types owned by stock_documents (receipts excluded). */
