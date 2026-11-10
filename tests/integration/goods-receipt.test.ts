import { describe, expect, it } from "vitest";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  stockOnHand,
  stockReceiptLines,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { getReceiptDetail } from "@/server/catalog";
import { createReceipt, voidReceipt } from "@/server/inventory";
import { getIncomeStatement, listPayables } from "@/server/reports";
import { createSale, quoteCart } from "@/server/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function anySupplier(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  expect(supplier).toBeDefined();
  return supplier;
}

async function newProduct(
  tx: Tx,
  input: { name: string; costPrice: string; salePrice: string },
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-GR-${suffix}`,
      name: input.name,
      costPrice: input.costPrice,
      salePrice: input.salePrice,
    })
    .returning({ id: products.id });
  return product;
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? 0);
}

/** The receipt's own posted journal (never a payment journal or a reversal). */
async function receiptJournal(tx: Tx, receiptId: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceId, receiptId),
        eq(journalEntries.status, "posted"),
        isNull(journalEntries.reversalOfId),
        ne(journalEntries.sourceType, "payment"),
      ),
    )
    .limit(1);
  if (!entry) return null;
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));
  return { entry, lines };
}

function lineTotals(
  lines: { accountId: string; debit: string; credit: string }[],
  accountId: string,
) {
  const mine = lines.filter((line) => line.accountId === accountId);
  return {
    debit: mine.reduce((acc, line) => acc.plus(d(line.debit)), d(0)),
    credit: mine.reduce((acc, line) => acc.plus(d(line.credit)), d(0)),
  };
}

async function expectReceiptRejected(
  fn: () => Promise<unknown>,
  code = "VALIDATION",
) {
  let error: unknown;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code });
}

describe("Terima barang 3 skenario (G6 / D-5)", () => {
  it("(a) pembelian kredit: stok bertambah, jurnal Dr Persediaan / Cr Utang, tampil di daftar utang", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Kredit Uji",
        costPrice: "4000",
        salePrice: "6000",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        supplierInvoiceNumber: "INV-UJI-001",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 10, unitCost: 4000 }],
      });

      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("10.0000");

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(stored.source).toBe("purchase");
      expect(stored.supplierInvoiceNumber).toBe("INV-UJI-001");
      expect(stored.paymentAccountId).toBeNull();
      expect(stored.paymentStatus).toBe("unpaid");

      const journal = await receiptJournal(tx, receipt.id);
      expect(journal).not.toBeNull();
      expect(lineTotals(journal!.lines, map.inventory).debit.toFixed(2)).toBe("40000.00");
      expect(lineTotals(journal!.lines, map.payable).credit.toFixed(2)).toBe("40000.00");

      const payables = await listPayables(tx, ORG_ID);
      const mine = payables.find((row) => row.id === receipt.id);
      expect(mine).toBeDefined();
      expect(mine!.outstanding).toBe(40000);
    });
  });

  it("(b) pembelian tunai: jurnal Dr Persediaan / Cr akun kas pilihan, tanpa utang, dokumen lahir lunas", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Tunai Uji",
        costPrice: "2500",
        salePrice: "3000",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        paymentAccountId: map.cash,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 8, unitCost: 2500 }],
      });

      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("8.0000");

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(stored.paymentAccountId).toBe(map.cash);
      expect(stored.paidAmount).toBe("20000.0000");
      expect(stored.paymentStatus).toBe("paid");

      const journal = await receiptJournal(tx, receipt.id);
      expect(journal).not.toBeNull();
      expect(lineTotals(journal!.lines, map.inventory).debit.toFixed(2)).toBe("20000.00");
      expect(lineTotals(journal!.lines, map.cash).credit.toFixed(2)).toBe("20000.00");
      expect(lineTotals(journal!.lines, map.payable).credit.toFixed(2)).toBe("0.00");

      const payables = await listPayables(tx, ORG_ID);
      expect(payables.find((row) => row.id === receipt.id)).toBeUndefined();
    });
  });

  it("(b1) diskon persen: DPP, jurnal, dan AVCO memakai nilai setelah potongan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Diskon Persen Uji",
        costPrice: "4000",
        salePrice: "6000",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [
          {
            productId: product.id,
            qty: 10,
            unitCost: 4000,
            discountType: "percent",
            discountValue: 10,
          },
        ],
      });

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(d(stored.total).toFixed(2)).toBe("36000.00");

      const [line] = await tx
        .select()
        .from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, receipt.id));
      expect(line.discountType).toBe("percent");
      expect(d(line.discountValue).toFixed(2)).toBe("10.00");
      expect(d(line.discountAmount).toFixed(2)).toBe("4000.00");
      expect(d(line.lineTotal).toFixed(2)).toBe("36000.00");

      const journal = await receiptJournal(tx, receipt.id);
      expect(journal).not.toBeNull();
      expect(lineTotals(journal!.lines, map.inventory).debit.toFixed(2)).toBe("36000.00");
      expect(lineTotals(journal!.lines, map.payable).credit.toFixed(2)).toBe("36000.00");

      // AVCO menyerap harga setelah diskon: 36.000 / 10 = 3.600.
      const [productRow] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));
      expect(d(productRow.costPrice).toFixed(2)).toBe("3600.00");
    });
  });

  it("(b2) diskon nominal + PPN persen: potongan mengurangi DPP dan PPN", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Diskon Nominal Uji",
        costPrice: "100000",
        salePrice: "150000",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        taxPercent: "11",
        lines: [
          {
            productId: product.id,
            qty: 10,
            unitCost: 100000,
            discountType: "nominal",
            discountValue: 50000,
          },
        ],
      });

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(d(stored.total).toFixed(2)).toBe("1054500.00");
      expect(d(stored.taxAmount).toFixed(2)).toBe("104500.00");

      const [line] = await tx
        .select()
        .from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, receipt.id));
      expect(line.discountType).toBe("nominal");
      expect(d(line.discountValue).toFixed(2)).toBe("50000.00");
      expect(d(line.discountAmount).toFixed(2)).toBe("50000.00");
      expect(d(line.lineTotal).toFixed(2)).toBe("950000.00");

      const journal = await receiptJournal(tx, receipt.id);
      expect(journal).not.toBeNull();
      expect(lineTotals(journal!.lines, map.inventory).debit.toFixed(2)).toBe("950000.00");
      expect(lineTotals(journal!.lines, map.tax_input).debit.toFixed(2)).toBe("104500.00");
      expect(lineTotals(journal!.lines, map.payable).credit.toFixed(2)).toBe("1054500.00");

      const [productRow] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, product.id));
      expect(d(productRow.costPrice).toFixed(2)).toBe("95000.00");

      // Jalur baca detail/GRN ikut membawa diskon baris.
      const detail = await getReceiptDetail(tx, ORG_ID, receipt.id);
      expect(d(detail?.lines[0]?.discountAmount ?? 0).toFixed(2)).toBe("50000.00");
      expect(d(detail?.lines[0]?.lineTotal ?? 0).toFixed(2)).toBe("950000.00");
    });
  });

  it("(b3) diskon melebihi nilai baris atau di atas 100% ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Diskon Tidak Valid",
        costPrice: "1000",
        salePrice: "1500",
      });

      await expectReceiptRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          date: todayISO(),
          lines: [
            {
              productId: product.id,
              qty: 1,
              unitCost: 1000,
              discountType: "nominal",
              discountValue: 1001,
            },
          ],
        }),
      );

      await expectReceiptRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          date: todayISO(),
          lines: [
            {
              productId: product.id,
              qty: 1,
              unitCost: 1000,
              discountType: "percent",
              discountValue: 101,
            },
          ],
        }),
      );
    });
  });

  it("(c) stok awal & sumber lain tanpa supplier: kredit ke ekuitas, bukan utang", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await newProduct(tx, {
        name: "Awal Uji",
        costPrice: "1000",
        salePrice: "1500",
      });
      const map = await getAccountMap(tx, ORG_ID);

      for (const source of ["opening", "other"] as const) {
        const receipt = await createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source,
          date: todayISO(),
          notes: source === "other" ? "Hibah rak display" : undefined,
          lines: [{ productId: product.id, qty: 5, unitCost: 1000 }],
        });
        const [stored] = await tx
          .select()
          .from(stockReceipts)
          .where(eq(stockReceipts.id, receipt.id));
        expect(stored.supplierId).toBeNull();
        expect(stored.source).toBe(source);

        const journal = await receiptJournal(tx, receipt.id);
        expect(journal).not.toBeNull();
        expect(lineTotals(journal!.lines, map.inventory).debit.toFixed(2)).toBe("5000.00");
        expect(lineTotals(journal!.lines, map.equity).credit.toFixed(2)).toBe("5000.00");

        const payables = await listPayables(tx, ORG_ID);
        expect(payables.find((row) => row.id === receipt.id)).toBeUndefined();
      }
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("10.0000");
    });
  });

  it("(c2) bonus barang: kredit ke other_income bila dipetakan, fallback ke pendapatan penjualan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Bonus Uji",
        costPrice: "2000",
        salePrice: "2500",
      });
      const map = await getAccountMap(tx, ORG_ID);
      // A-27 B6: templat kini MENANAM pemetaan other_income (71001) —
      // sebelum B6 demo tidak memilikinya. Urutan uji dibalik:
      // terpetakan dulu, lalu pemetaan dihapus di dalam rollback
      // untuk membuktikan fallback-nya.
      expect(map.other_income).toBeDefined();

      const mappedFirstReceipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "bonus",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 3, unitCost: 2000 }],
      });
      const mappedFirstJournal = await receiptJournal(tx, mappedFirstReceipt.id);
      expect(mappedFirstJournal).not.toBeNull();
      expect(lineTotals(mappedFirstJournal!.lines, map.other_income!).credit.toFixed(2)).toBe("6000.00");
      expect(lineTotals(mappedFirstJournal!.lines, map.revenue).credit.toFixed(2)).toBe("0.00");

      // Hapus pemetaannya → bonus jatuh ke pendapatan penjualan.
      await tx
        .delete(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG_ID), eq(accountMappings.key, "other_income")));
      const fallbackReceipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "bonus",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 2, unitCost: 2000 }],
      });
      const fallbackJournal = await receiptJournal(tx, fallbackReceipt.id);
      expect(fallbackJournal).not.toBeNull();
      expect(lineTotals(fallbackJournal!.lines, map.revenue).credit.toFixed(2)).toBe("4000.00");

      // Map other_income to a distinct account (71003 rounding gain) — the
      // optional key must win over the revenue fallback once it exists.
      const [gainAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "710007")))
        .limit(1);
      await tx.insert(accountMappings).values({
        companyId: ORG_ID,
        key: "other_income",
        accountId: gainAccount.id,
      });

      const mappedReceipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "bonus",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 2, unitCost: 2000 }],
      });
      const mappedJournal = await receiptJournal(tx, mappedReceipt.id);
      expect(mappedJournal).not.toBeNull();
      expect(lineTotals(mappedJournal!.lines, gainAccount.id).credit.toFixed(2)).toBe("4000.00");
      expect(lineTotals(mappedJournal!.lines, map.revenue).credit.toFixed(2)).toBe("0.00");
    });
  });

  it("(c3) retur pelanggan: kredit ke akun retur penjualan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await newProduct(tx, {
        name: "Retur Pelanggan Uji",
        costPrice: "3000",
        salePrice: "4500",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        source: "customer_return",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 4, unitCost: 3000 }],
      });

      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("4.0000");
      const journal = await receiptJournal(tx, receipt.id);
      expect(journal).not.toBeNull();
      expect(lineTotals(journal!.lines, map.inventory).debit.toFixed(2)).toBe("12000.00");
      expect(lineTotals(journal!.lines, map.sales_return).credit.toFixed(2)).toBe("12000.00");
    });
  });

  it("(d) validasi: purchase tanpa supplier ditolak, akun bayar hantu ditolak, akun bayar di luar pembelian ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await newProduct(tx, {
        name: "Validasi Uji",
        costPrice: "1000",
        salePrice: "1500",
      });
      const map = await getAccountMap(tx, ORG_ID);
      const supplier = await anySupplier(tx);
      const lines = [{ productId: product.id, qty: 1, unitCost: 1000 }];

      await expectReceiptRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "purchase",
          date: todayISO(),
          lines,
        }),
      );

      await expectReceiptRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          paymentAccountId: crypto.randomUUID(),
          date: todayISO(),
          lines,
        }),
      );

      await expectReceiptRejected(() =>
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          source: "opening",
          paymentAccountId: map.cash,
          date: todayISO(),
          lines,
        }),
      );

      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");
    });
  });

  it("(e) void penerimaan tunai membalik jurnalnya; void kredit yang sudah dibayar ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Void Uji",
        costPrice: "5000",
        salePrice: "7000",
      });
      const map = await getAccountMap(tx, ORG_ID);

      const cashReceipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        paymentAccountId: map.cash,
        date: todayISO(),
        lines: [{ productId: product.id, qty: 6, unitCost: 5000 }],
      });
      const original = await receiptJournal(tx, cashReceipt.id);
      expect(original).not.toBeNull();

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: cashReceipt.id,
        reason: "Salah catat penerimaan tunai",
        date: todayISO(),
      });

      const [voided] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, cashReceipt.id));
      expect(voided.status).toBe("void");
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("0.0000");

      const [reversal] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.reversalOfId, original!.entry.id),
          ),
        );
      expect(reversal).toBeDefined();
      const reversalLines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, reversal.id));
      expect(lineTotals(reversalLines, map.cash).debit.toFixed(2)).toBe("30000.00");
      expect(lineTotals(reversalLines, map.inventory).credit.toFixed(2)).toBe("30000.00");

      // Credit receipt whose payable is already (partly) paid: the paid
      // guard must still reject the void — same state payPayableAction
      // leaves behind (paidAmount / paymentStatus on the document).
      const creditReceipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        lines: [{ productId: product.id, qty: 6, unitCost: 5000 }],
      });
      await tx
        .update(stockReceipts)
        .set({ paidAmount: "10000.0000", paymentStatus: "partial" })
        .where(eq(stockReceipts.id, creditReceipt.id));

      await expectReceiptRejected(
        () =>
          voidReceipt(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            receiptId: creditReceipt.id,
            reason: "Coba batalkan",
            date: todayISO(),
          }),
        "INVALID_STATE",
      );
    });
  });

  it("(f) SIMULASI PENGGUNA: terima tunai 100 @2.500, jual 1 @3.000, stok 99, laba kotor 500", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const supplier = await anySupplier(tx);
      const product = await newProduct(tx, {
        name: "Air Mineral 600 ml",
        costPrice: "2500",
        salePrice: "3000",
      });
      const map = await getAccountMap(tx, ORG_ID);
      const today = todayISO();
      const range = { from: today, to: today };
      const profitBefore = (await getIncomeStatement(tx, ORG_ID, range)).grossProfit;

      // Gudang — terima barang tunai dari Kas Utama.
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        paymentAccountId: map.cash,
        date: today,
        lines: [{ productId: product.id, qty: 100, unitCost: 2500 }],
      });
      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("100.0000");
      const receiptJ = await receiptJournal(tx, receipt.id);
      expect(receiptJ).not.toBeNull();
      expect(lineTotals(receiptJ!.lines, map.inventory).debit.toFixed(2)).toBe("250000.00");
      expect(lineTotals(receiptJ!.lines, map.cash).credit.toFixed(2)).toBe("250000.00");
      expect(lineTotals(receiptJ!.lines, map.payable).credit.toFixed(2)).toBe("0.00");

      // POS — jual 1 botol tunai (sesi kas seed terbuka untuk USER_ID).
      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
        .limit(1);
      expect(method).toBeDefined();
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        customerId: null,
        lines: [{ productId: product.id, qty: 1 }],
      });
      expect(quote.total).toBe(3000);
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: today,
        lines: [{ productId: product.id, qty: 1 }],
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      expect((await stockQty(tx, warehouse.id, product.id)).toFixed(4)).toBe("99.0000");

      const [saleEntry] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "sale"),
            eq(journalEntries.sourceId, sale.id),
          ),
        );
      expect(saleEntry).toBeDefined();
      const saleLines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, saleEntry.id));
      expect(lineTotals(saleLines, map.cash).debit.toFixed(2)).toBe("3000.00");
      expect(lineTotals(saleLines, map.revenue).credit.toFixed(2)).toBe("3000.00");
      expect(lineTotals(saleLines, map.cogs).debit.toFixed(2)).toBe("2500.00");
      expect(lineTotals(saleLines, map.inventory).credit.toFixed(2)).toBe("2500.00");

      // Akuntansi — laporan laba rugi: laba kotor bertambah tepat 500.
      const profitAfter = (await getIncomeStatement(tx, ORG_ID, range)).grossProfit;
      expect(profitAfter - profitBefore).toBe(500);
    });
  });
});
