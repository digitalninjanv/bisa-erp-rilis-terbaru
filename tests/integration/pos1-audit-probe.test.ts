import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  cashMovements,
  cashSessions,
  companySettings,
  customerGroupPrices,
  customerGroups,
  customers,
  journalEntries,
  journalLines,
  partyPayments,
  paymentMethods,
  products,
  saleReturns,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  cashDrawerMovement,
  closeCashSession,
  createSale,
  createSaleReturn,
  openCashSession,
  payReceivable,
  quoteCart,
  voidSale,
} from "@/server/pos";
import { processOfflineSaleItem } from "@/server/pos-offline";
import { applyStockMovement } from "@/server/inventory";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

// =====================================================================
// PROBE AUDIT POS-1 (domain & angka) — berkas ini BUKAN test regresi
// biasa: setiap assert menyatakan perilaku yang BENAR menurut aturan
// akuntansi/integritas. Test yang GAGAL = temuan TERBUKTI-SALAH (angka
// aktual tercetak pada pesan kegagalan vitest); test yang LULUS =
// TERBUKTI-BENAR. Sesudah temuan diperbaiki, test terkait berubah hijau
// dan berkas ini menjadi test regresinya.
//
// Perusahaan fixture khusus audit: 01900000-…-d501 (utama) dan
// 01900000-…-d601 (tenant kedua untuk probe lintas-tenant). Perusahaan
// demo 01900000-…-0001 TIDAK disentuh.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000d501";
const ORG2 = "01900000-0000-7000-8000-00000000d601";
const USER_A = "user-probe-pos1-a";

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function rb<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG}, true)`);
      value = await fn(tx);
      throw new Rollback("rollback probe");
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return value as T;
}

async function commitTx<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${org}, true)`);
    return fn(tx);
  });
}

// ---------- fixture ----------

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["2100", "Utang Gaji", "liability", "credit"],
  ["2200", "PPN Keluaran", "liability", "credit"],
  ["2300", "Kredit Pelanggan", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["5010", "Selisih Persediaan", "cogs", "debit"],
  ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
  ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
  ["8000", "Selisih Kas Kurang", "expense", "debit"],
  ["8001", "Selisih Kas Lebih", "revenue", "credit"],
  ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
  ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
];

async function ensureCompany(org: string, legalName: string) {
  await commitTx(org, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, org))
      .limit(1);
    if (existing) {
      // Fixture menyembuhkan diri: probe commit POS1-13 mematikan pajak
      // secara permanen di baris pengaturan; kembalikan ke bawaan
      // fixture agar larian ulang deterministik.
      await tx
        .update(companySettings)
        .set({ taxEnabled: true, taxRate: "11", roundingMode: "none", posOfflineEnabled: true })
        .where(eq(companySettings.companyId, org));
      return;
    }
    await tx.insert(companySettings).values({
      companyId: org,
      legalName,
      taxRate: "11",
      taxEnabled: true,
      roundingMode: "none",
      posOfflineEnabled: true,
    });
    const accountRows = await tx
      .insert(accounts)
      .values(
        ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
          companyId: org,
          code,
          name,
          type,
          normalBalance,
        })),
      )
      .returning();
    const acc = new Map(accountRows.map((a) => [a.code, a.id]));
    const mapping: Record<string, string> = {
      cash: acc.get("1000")!,
      bank: acc.get("1100")!,
      qris: acc.get("1110")!,
      receivable: acc.get("1200")!,
      inventory: acc.get("1300")!,
      payable: acc.get("2000")!,
      revenue: acc.get("4000")!,
      sales_discount: acc.get("4010")!,
      sales_return: acc.get("4020")!,
      cogs: acc.get("5000")!,
      inventory_shrink: acc.get("5010")!,
      damaged: acc.get("5020")!,
      tax_output: acc.get("2200")!,
      rounding_gain: acc.get("9000")!,
      rounding_loss: acc.get("9001")!,
      cash_short: acc.get("8000")!,
      cash_over: acc.get("8001")!,
      salary_expense: acc.get("6000")!,
      salary_payable: acc.get("2100")!,
      bank_fee: acc.get("6060")!,
      equity: acc.get("3000")!,
      customer_credit: acc.get("2300")!,
    };
    await tx.insert(accountMappings).values(
      Object.entries(mapping).map(([key, accountId]) => ({ companyId: org, key, accountId })),
    );
    await tx.insert(warehouses).values({
      companyId: org,
      code: "GD-P1",
      name: "Gudang Probe",
      type: "warehouse",
      isDefault: true,
    });
    await tx.insert(paymentMethods).values([
      { companyId: org, code: "CASH", name: "Tunai", type: "cash", accountId: acc.get("1000")!, sortOrder: 1 },
      { companyId: org, code: "QRIS", name: "QRIS", type: "qris", accountId: acc.get("1110")!, sortOrder: 2 },
      { companyId: org, code: "CREDIT", name: "Utang", type: "credit", accountId: acc.get("1200")!, sortOrder: 3 },
      { companyId: org, code: "CCUST", name: "Kredit Pelanggan", type: "customer_credit", accountId: acc.get("2300")!, sortOrder: 4 },
    ]);
    await tx.insert(cashSessions).values({
      companyId: org,
      userId: USER_A,
      openingCash: "0",
      status: "open",
    });
  });
}

beforeAll(async () => {
  await ensureCompany(ORG, "Probe POS1 Utama");
  // Tenant kedua: cukup pengaturan + satu pelanggan (probe lintas-tenant).
  await commitTx(ORG2, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG2))
      .limit(1);
    if (existing) return;
    await tx.insert(companySettings).values({ companyId: ORG2, legalName: "Probe POS1 Tenant Lain" });
    await tx.insert(customers).values({
      companyId: ORG2,
      code: "CUST-ASING",
      name: "Pelanggan Tenant Lain",
    });
  });
});

// ---------- helpers ----------

async function warehouseId(tx: Tx) {
  const [w] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  return w.id;
}

async function methodId(tx: Tx, code: string) {
  const [m] = await tx
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.code, code)))
    .limit(1);
  return m.id;
}

async function accountId(tx: Tx, code: string) {
  const [a] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  return a.id;
}

let skuCounter = 0;
async function makeProduct(
  tx: Tx,
  input: { price: string; cost: string; stock?: number; trackStock?: boolean },
) {
  skuCounter += 1;
  const [p] = await tx
    .insert(products)
    .values({
      companyId: ORG,
      sku: `PRB1-${Date.now()}-${skuCounter}`,
      name: `Produk Probe ${skuCounter}`,
      salePrice: input.price,
      costPrice: input.cost,
      trackStock: input.trackStock ?? true,
    })
    .returning({ id: products.id });
  if ((input.stock ?? 0) > 0) {
    await applyStockMovement(tx, {
      companyId: ORG,
      warehouseId: await warehouseId(tx),
      productId: p.id,
      delta: input.stock!,
      unitCost: input.cost,
      movementType: "adjustment",
      referenceType: "probe",
      userId: USER_A,
    });
  }
  return p.id;
}

async function makeCustomer(tx: Tx, input: { name: string; creditLimit?: string }) {
  const [c] = await tx
    .insert(customers)
    .values({
      companyId: ORG,
      code: `C-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: input.name,
      creditLimit: input.creditLimit ?? "0",
    })
    .returning({ id: customers.id });
  return c.id;
}

async function stockQty(tx: Tx, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG),
        eq(stockOnHand.warehouseId, await warehouseId(tx)),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? "0").toNumber();
}

/** Saldo GL (debit − kredit) satu akun dari jurnal posted perusahaan ini. */
async function glNet(tx: Tx, code: string) {
  const accId = await accountId(tx, code);
  const rows = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.status, "posted"),
        eq(journalLines.accountId, accId),
      ),
    );
  return rows
    .reduce((acc, r) => acc.plus(d(r.debit)).minus(d(r.credit)), d(0))
    .toNumber();
}

async function setTax(tx: Tx, enabled: boolean) {
  await tx
    .update(companySettings)
    .set({ taxEnabled: enabled })
    .where(eq(companySettings.companyId, ORG));
}

const TODAY = todayISO();
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

// =====================================================================
// POS1-01 — Retur: baris produk duplikat dalam SATU permintaan retur
// =====================================================================
describe("POS1-01 retur baris duplikat dalam satu permintaan", () => {
  it("jual 5 @10.000; retur [{4},{4}] untuk produk yang sama harus ditolak / tidak melebihi 5", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 5 });
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 5 }],
        payments: [{ methodId: cash, amount: 50000, tendered: 50000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      expect(await stockQty(tx, productId)).toBe(0);

      let outcome: { total: number } | null = null;
      let rejected = false;
      try {
        const ret = await createSaleReturn(tx, {
          companyId: ORG,
          userId: USER_A,
          saleId: sale.id,
          date: TODAY,
          reason: "probe duplikat",
          refundMethod: "cash",
          type: "return",
          lines: [
            { productId, qty: 4 },
            { productId, qty: 4 },
          ],
        });
        outcome = { total: ret.total };
      } catch {
        rejected = true;
      }
      // Perilaku benar: permintaan ditolak, ATAU total retur ≤ nilai terjual.
      if (!rejected) {
        expect(outcome!.total).toBeLessThanOrEqual(50000);
      }
      // Stok tidak boleh kembali melebihi yang pernah keluar (5).
      expect(await stockQty(tx, productId)).toBeLessThanOrEqual(5);
    });
  });
});

// =====================================================================
// POS1-02 — Sinkronisasi offline: harga berubah di antara antre & sinkron
// =====================================================================
describe("POS1-02 sinkronisasi offline vs perubahan harga", () => {
  it("harga TURUN sesudah antre: sinkron TIDAK boleh memposting total berbeda dari struk offline secara senyap", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 10 });
      const clientKey = crypto.randomUUID();
      // Harga berubah di server selagi perangkat offline.
      await tx
        .update(products)
        .set({ salePrice: "7500" })
        .where(eq(products.id, productId));
      const result = await processOfflineSaleItem(tx, {
        companyId: ORG,
        userId: USER_A,
        item: {
          clientKey,
          warehouseId: wh,
          date: TODAY,
          queuedAt: new Date().toISOString(),
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: cash, amount: 10000, tendered: 10000 }],
        },
      });
      // Perilaku benar: item menjadi conflict/failed untuk ditinjau, ATAU
      // terposting persis sebesar yang dibayar pelanggan offline (10.000).
      let postedTotal: number | null = null;
      if (result.saleId) {
        const [s] = await tx
          .select({ total: sales.total })
          .from(sales)
          .where(eq(sales.id, result.saleId));
        postedTotal = d(s.total).toNumber();
      }
      if (result.status === "synced") {
        expect(postedTotal).toBe(10000);
      } else {
        expect(["conflict", "failed"]).toContain(result.status);
      }
    });
  });

  it("harga NAIK sesudah antre: item gagal (pembayaran kurang) dan masuk peninjauan — tidak dipaksakan", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 10 });
      await tx
        .update(products)
        .set({ salePrice: "12000" })
        .where(eq(products.id, productId));
      const result = await processOfflineSaleItem(tx, {
        companyId: ORG,
        userId: USER_A,
        item: {
          clientKey: crypto.randomUUID(),
          warehouseId: wh,
          date: TODAY,
          queuedAt: new Date().toISOString(),
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: cash, amount: 10000, tendered: 10000 }],
        },
      });
      expect(result.status).toBe("failed");
      expect(result.saleId ?? null).toBeNull();
    });
  });
});

// =====================================================================
// POS1-03 — Pembayaran piutang: pengiriman ganda (klik ganda / retry)
// =====================================================================
describe("POS1-03 pembayaran piutang terkirim dua kali", () => {
  it("dua panggilan identik 40.000 atas utang 100.000 tidak boleh tercatat dua kali", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const credit = await methodId(tx, "CREDIT");
      const kas = await accountId(tx, "1000");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 3 });
      const customerId = await makeCustomer(tx, { name: "Probe Utang" });
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        customerId,
        dueDate: TODAY,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: credit, amount: 100000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
      });
      // Retry / klik ganda: permintaan yang PERSIS sama dikirim ulang.
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
      });
      const payments = await tx
        .select({ id: partyPayments.id })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      const [saleRow] = await tx
        .select({ paidTotal: sales.paidTotal })
        .from(sales)
        .where(eq(sales.id, sale.id));
      // Perilaku benar: satu penerimaan fisik tercatat satu kali.
      expect(payments).toHaveLength(1);
      expect(d(saleRow.paidTotal).toNumber()).toBe(40000);
    });
  });
});

// =====================================================================
// POS1-04 — Penjualan Rp0: produk berharga jual 0
// =====================================================================
describe("POS1-04 penjualan produk berharga 0", () => {
  it("checkout produk salePrice=0 tidak boleh gugur karena jurnal internal", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const productId = await makeProduct(tx, { price: "0", cost: "0", stock: 3 });
      let error: unknown = null;
      let sale: { id: string } | null = null;
      try {
        sale = await createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: wh,
          date: TODAY,
          lines: [{ productId, qty: 1 }],
          payments: [],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeNull();
      expect(sale).not.toBeNull();
    });
  });
});

// =====================================================================
// POS1-05 — Metode pembayaran tanpa akun penampung
// =====================================================================
describe("POS1-05 metode pembayaran tanpa akun", () => {
  it("checkout dengan metode ber-accountId null ditolak dengan pesan soal akun, bukan jurnal tak seimbang", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const [orphan] = await tx
        .insert(paymentMethods)
        .values({ companyId: ORG, code: "NOACC", name: "Metode Tanpa Akun", type: "cash", accountId: null })
        .returning({ id: paymentMethods.id });
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 2 });
      let message = "";
      try {
        await createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: wh,
          date: TODAY,
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: orphan.id, amount: 10000, tendered: 10000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).not.toBe("");
      expect(message.toLowerCase()).toContain("akun");
      expect(message).not.toContain("tidak seimbang");
    });
  });
});

// =====================================================================
// POS1-06 — Ambang diskon dinilai dari bruto harga normal
// =====================================================================
describe("POS1-06 ambang diskon vs harga kelompok ekstrem", () => {
  it("diskon manual 100% di atas harga kelompok Rp500 (produk Rp100.000) memicu penjaga supervisor", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 2 });
      const [group] = await tx
        .insert(customerGroups)
        .values({ companyId: ORG, name: `Grup Probe ${Date.now()}`, roundingStep: 1, roundingDirection: "nearest", roundCashTotal: false })
        .returning({ id: customerGroups.id });
      await tx.insert(customerGroupPrices).values({
        companyId: ORG,
        groupId: group.id,
        productId,
        ruleType: "fixed",
        value: "500",
      });
      // FIX-POS Tahap 1 (POS1-10): assert diselaraskan dengan maksud
      // komentar aslinya — "tercatat sebagai override di atas ambang
      // (ATAU ditolak tanpa izin)". Bentuk lama tidak menangkap
      // penolakan sehingga test tidak pernah bisa hijau pada perilaku
      // yang benar: quoteCart memang menolak diskon di atas ambang
      // tanpa izin (kontrak POS-DISC-01). Kini: tanpa izin → ditolak
      // dengan pesan ambang; dengan izin → override tercatat.
      let rejected = false;
      try {
        await quoteCart(tx, {
          companyId: ORG,
          warehouseId: wh,
          groupId: group.id,
          lines: [{ productId, qty: 1, discountType: "percent", discountValue: 100 }],
          canDiscount: false,
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      const quote = await quoteCart(tx, {
        companyId: ORG,
        warehouseId: wh,
        groupId: group.id,
        lines: [{ productId, qty: 1, discountType: "percent", discountValue: 100 }],
        canDiscount: true,
      });
      // Perilaku benar: tindakan manual meng-nol-kan baris tercatat
      // sebagai override di atas ambang (atau ditolak tanpa izin).
      expect(quote.manualDiscountOverride).not.toBeNull();
      expect(quote.manualDiscountOverride!.maxPercent).toBe(100);
    });
  });
});

// =====================================================================
// POS1-07 — Tanggal jatuh tempo lampau & tanggal bayar mendahului penjualan
// =====================================================================
describe("POS1-07 validasi tanggal dokumen", () => {
  it("penjualan utang dengan jatuh tempo KEMARIN ditolak", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const credit = await methodId(tx, "CREDIT");
      const productId = await makeProduct(tx, { price: "50000", cost: "30000", stock: 2 });
      const customerId = await makeCustomer(tx, { name: "Probe Tempo Lampau" });
      let rejected = false;
      try {
        await createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: wh,
          customerId,
          dueDate: YESTERDAY,
          date: TODAY,
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: credit, amount: 50000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });
  });

  it("pembayaran piutang bertanggal SEBELUM tanggal penjualan ditolak", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const credit = await methodId(tx, "CREDIT");
      const kas = await accountId(tx, "1000");
      const productId = await makeProduct(tx, { price: "50000", cost: "30000", stock: 2 });
      const customerId = await makeCustomer(tx, { name: "Probe Bayar Mendahului" });
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        customerId,
        dueDate: TODAY,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: credit, amount: 50000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      const earlyDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      let rejected = false;
      try {
        await payReceivable(tx, {
          companyId: ORG,
          userId: USER_A,
          saleId: sale.id,
          date: earlyDate,
          amount: 10000,
          accountId: kas,
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });
  });
});

// =====================================================================
// POS1-08 — Pelanggan tenant lain pada penjualan lunas
// =====================================================================
describe("POS1-08 customerId lintas tenant", () => {
  it("penjualan lunas dengan customerId milik perusahaan lain ditolak", async () => {
    const [foreign] = await commitTx(ORG2, async (tx) =>
      tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.companyId, ORG2))
        .limit(1),
    );
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 2 });
      let rejected = false;
      try {
        await createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: wh,
          customerId: foreign.id,
          date: TODAY,
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: cash, amount: 10000, tendered: 10000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });
  });
});

// =====================================================================
// POS1-09 — Setoran melebihi isi laci sesi
// =====================================================================
describe("POS1-09 setoran kas melebihi isi laci", () => {
  it("sesi berisi 50.000 tidak dapat menyetor 200.000 ke bank; tutup sesi tidak menciptakan kas lebih fiktif", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const user = `user-probe-pos1-${Date.now()}`;
      const session = await openCashSession(tx, {
        companyId: ORG,
        userId: user,
        openingCash: 50000,
      });
      let depositRejected = false;
      try {
        await cashDrawerMovement(tx, {
          companyId: ORG,
          userId: user,
          sessionId: session.id,
          type: "deposit",
          amount: 200000,
        });
      } catch {
        depositRejected = true;
      }
      expect(depositRejected).toBe(true);
    });
  });

  it("rantai dampak: bila setoran fiktif lolos, tutup sesi mengarang selisih kas lebih +150.000", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const user = `user-probe-pos1-rantai-${Date.now()}`;
      const session = await openCashSession(tx, {
        companyId: ORG,
        userId: user,
        openingCash: 50000,
      });
      let depositRejected = false;
      try {
        await cashDrawerMovement(tx, {
          companyId: ORG,
          userId: user,
          sessionId: session.id,
          type: "deposit",
          amount: 200000,
        });
      } catch {
        depositRejected = true;
      }
      if (depositRejected) return; // rantai tidak terbentuk — perilaku benar
      const closed = await closeCashSession(tx, {
        companyId: ORG,
        userId: user,
        sessionId: session.id,
        countedCash: 0,
        // A-28 Tahap 1 (H-POS-02): selisih +150.000 wajib alasan —
        // probe tetap membuktikan jurnal selisih fiktifnya.
        differenceReason: "Probe rantai setoran fiktif",
      });
      // Expected sesi menjadi −150.000 (mustahil secara fisik); hitungan
      // fisik 0 lalu terbaca sebagai kas LEBIH 150.000 dan dijurnal
      // Dr Kas / Cr Pendapatan selisih — uang & pendapatan fiktif.
      expect(closed.difference).toBe(0);
    });
  });
});

// =====================================================================
// POS1-10 — Retur atas penjualan yang dibayar dengan Kredit Pelanggan
// =====================================================================
describe("POS1-10 retur tunai atas pembayaran kredit pelanggan", () => {
  it("penjualan yang dibayar penuh dengan kredit retur tidak menghasilkan refund TUNAI saat diretur", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const ccust = await methodId(tx, "CCUST");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 5 });

      // Penjualan A tunai → diretur menjadi kredit toko 100.000.
      const saleA = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: cash, amount: 100000, tendered: 100000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      const retA = await createSaleReturn(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: saleA.id,
        date: TODAY,
        reason: "probe kredit",
        refundMethod: "store_credit",
        type: "return",
        lines: [{ productId, qty: 1 }],
      });
      const [retRow] = await tx
        .select({ number: saleReturns.number })
        .from(saleReturns)
        .where(eq(saleReturns.id, retA.id));

      // Penjualan B dibayar PENUH dengan kredit retur A (tanpa kas masuk).
      const saleB = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: ccust, amount: 100000, reference: retRow.number }],
        idempotencyKey: crypto.randomUUID(),
      });

      // Retur B dengan metode TUNAI.
      let rejected = false;
      let retB: { id: string } | null = null;
      try {
        retB = await createSaleReturn(tx, {
          companyId: ORG,
          userId: USER_A,
          saleId: saleB.id,
          date: TODAY,
          reason: "probe refund tunai dari kredit",
          refundMethod: "cash",
          type: "return",
          lines: [{ productId, qty: 1 }],
        });
      } catch {
        rejected = true;
      }
      // Mutasi refund retur dirujuk oleh id DOKUMEN RETUR (beda dari
      // void yang merujuk id penjualan).
      const refundMoves = retB
        ? await tx
            .select({ amount: cashMovements.amount })
            .from(cashMovements)
            .where(
              and(
                eq(cashMovements.companyId, ORG),
                eq(cashMovements.type, "refund"),
                eq(cashMovements.referenceId, retB.id),
              ),
            )
        : [];
      // Perilaku benar: tidak ada kas keluar untuk penjualan yang tidak
      // pernah membawa kas masuk — penyelesaian kembali ke kredit.
      if (!rejected) {
        expect(refundMoves.map((m) => d(m.amount).toNumber())).toEqual([]);
      }
    });
  });
});

// =====================================================================
// POS1-11 — Rekonsiliasi emas: diskon grup + PPN 11% + pembulatan
// perusahaan + split tunai/QRIS/utang (verifikasi klaim sehat)
// =====================================================================
describe("POS1-11 rekonsiliasi emas penjualan campuran", () => {
  it("struk = jurnal = stok = sesi: semua kaki cocok persis", async () => {
    await rb(async (tx) => {
      // Pajak 11% inklusif (ditegaskan eksplisit — jangan bergantung
      // pada keadaan fixture), pembulatan perusahaan up_500.
      await tx
        .update(companySettings)
        .set({ roundingMode: "up_500", taxEnabled: true, taxRate: "11" })
        .where(eq(companySettings.companyId, ORG));
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const qris = await methodId(tx, "QRIS");
      const credit = await methodId(tx, "CREDIT");
      const productId = await makeProduct(tx, { price: "111000", cost: "60000", stock: 10 });
      const [group] = await tx
        .insert(customerGroups)
        .values({ companyId: ORG, name: `Grup Emas ${Date.now()}`, roundingStep: 100, roundingDirection: "down", roundCashTotal: false })
        .returning({ id: customerGroups.id });
      await tx.insert(customerGroupPrices).values({
        companyId: ORG,
        groupId: group.id,
        productId,
        ruleType: "percent",
        value: "10",
      });
      const customerId = await makeCustomer(tx, { name: "Probe Emas" });

      const before = {
        kas: await glNet(tx, "1000"),
        qris: await glNet(tx, "1110"),
        piutang: await glNet(tx, "1200"),
        persediaan: await glNet(tx, "1300"),
      };
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        customerId,
        groupId: group.id,
        dueDate: TODAY,
        date: TODAY,
        lines: [{ productId, qty: 2 }],
        payments: [
          { methodId: cash, amount: 100000, tendered: 100000 },
          { methodId: qris, amount: 50000 },
          { methodId: credit, amount: 50000 },
        ],
        idempotencyKey: crypto.randomUUID(),
      });

      // Angka dokumen: bruto 222.000; diskon grup 22.200; neto 199.800;
      // PPN 19.800; pembulatan +200 → total 200.000.
      const [saleRow] = await tx.select().from(sales).where(eq(sales.id, sale.id));
      expect(d(saleRow.subtotal).toNumber()).toBe(222000);
      expect(d(saleRow.discountTotal).toNumber()).toBe(22200);
      expect(d(saleRow.taxTotal).toNumber()).toBe(19800);
      expect(d(saleRow.roundingAdjustment).toNumber()).toBe(200);
      expect(d(saleRow.total).toNumber()).toBe(200000);
      expect(d(saleRow.paidTotal).toNumber()).toBe(150000);
      expect(saleRow.paymentStatus).toBe("partial");

      // Kaki jurnal penjualan ini persis.
      const entries = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "sale"),
            eq(journalEntries.sourceId, sale.id),
          ),
        );
      expect(entries).toHaveLength(1);
      const lines = await tx
        .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .where(eq(journalLines.entryId, entries[0].id));
      const byAccount = new Map<string, { debit: number; credit: number }>();
      for (const line of lines) {
        const cur = byAccount.get(line.accountId) ?? { debit: 0, credit: 0 };
        cur.debit += d(line.debit).toNumber();
        cur.credit += d(line.credit).toNumber();
        byAccount.set(line.accountId, cur);
      }
      const leg = async (code: string) =>
        byAccount.get(await accountId(tx, code)) ?? { debit: 0, credit: 0 };
      expect((await leg("1000")).debit).toBe(100000);
      expect((await leg("1110")).debit).toBe(50000);
      expect((await leg("1200")).debit).toBe(50000);
      expect((await leg("4010")).debit).toBe(22200);
      expect((await leg("4000")).credit).toBe(202200);
      expect((await leg("2200")).credit).toBe(19800);
      expect((await leg("9000")).credit).toBe(200);
      expect((await leg("5000")).debit).toBe(120000);
      expect((await leg("1300")).credit).toBe(120000);
      const sumD = lines.reduce((a, l) => a + d(l.debit).toNumber(), 0);
      const sumC = lines.reduce((a, l) => a + d(l.credit).toNumber(), 0);
      expect(sumD).toBe(sumC);

      // Sesi kas: hanya porsi tunai yang masuk laci.
      const moves = await tx
        .select({ amount: cashMovements.amount })
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG),
            eq(cashMovements.type, "sale"),
            eq(cashMovements.referenceId, sale.id),
          ),
        );
      expect(moves.map((m) => d(m.amount).toNumber())).toEqual([100000]);

      // Stok & saldo GL bergerak sebesar yang diharapkan.
      expect(await stockQty(tx, productId)).toBe(8);
      expect((await glNet(tx, "1000")) - before.kas).toBe(100000);
      expect((await glNet(tx, "1110")) - before.qris).toBe(50000);
      expect((await glNet(tx, "1200")) - before.piutang).toBe(50000);
      expect((await glNet(tx, "1300")) - before.persediaan).toBe(-120000);
    });
  });
});

// =====================================================================
// POS1-12 — Void penjualan berpiutang yang sudah dibayar sebagian
// (verifikasi FIX-P1 AK3-01 dengan angka baru)
// =====================================================================
describe("POS1-12 void membalik penerimaan piutang", () => {
  it("GL piutang & kas kembali bersih; pembayaran berstatus void; paidTotal nol", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const credit = await methodId(tx, "CREDIT");
      const kas = await accountId(tx, "1000");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 4 });
      const customerId = await makeCustomer(tx, { name: "Probe Void AR" });
      const before = { piutang: await glNet(tx, "1200"), kas: await glNet(tx, "1000") };
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        customerId,
        dueDate: TODAY,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: credit, amount: 100000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
      });
      expect((await glNet(tx, "1200")) - before.piutang).toBe(60000);

      await voidSale(tx, { companyId: ORG, userId: USER_A, saleId: sale.id, reason: "probe void" });

      expect((await glNet(tx, "1200")) - before.piutang).toBe(0);
      expect((await glNet(tx, "1000")) - before.kas).toBe(0);
      const [saleRow] = await tx.select().from(sales).where(eq(sales.id, sale.id));
      expect(saleRow.status).toBe("void");
      expect(d(saleRow.paidTotal).toNumber()).toBe(0);
      const payments = await tx
        .select({ status: partyPayments.status })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe("void");
      expect(await stockQty(tx, productId)).toBe(4);
    });
  });
});

// =====================================================================
// Probe konkurensi — transaksi COMMIT di perusahaan fixture sendiri.
// =====================================================================
describe("POS1-13 konkurensi checkout (commit)", () => {
  it("dua checkout bersamaan dengan kunci idempotensi sama: tepat satu penjualan, keduanya menerima hasil yang sama", async () => {
    const setup = await commitTx(ORG, async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "25000", cost: "15000", stock: 10 });
      return { wh, cash, productId };
    });
    const key = crypto.randomUUID();
    const attempt = () =>
      commitTx(ORG, (tx) =>
        createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: setup.wh,
          date: TODAY,
          lines: [{ productId: setup.productId, qty: 2 }],
          payments: [{ methodId: setup.cash, amount: 50000, tendered: 50000 }],
          idempotencyKey: key,
        }),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
    }>[];
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
    const rows = await commitTx(ORG, async (tx) =>
      tx
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.companyId, ORG), eq(sales.idempotencyKey, key))),
    );
    expect(rows).toHaveLength(1);
    const qty = await commitTx(ORG, (tx) => stockQty(tx, setup.productId));
    expect(qty).toBe(8);
  });

  it("dua checkout bersamaan memperebutkan stok terakhir 5: tepat satu yang lolos, stok berakhir 0", async () => {
    const setup = await commitTx(ORG, async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "25000", cost: "15000", stock: 5 });
      return { wh, cash, productId };
    });
    const attempt = () =>
      commitTx(ORG, (tx) =>
        createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: setup.wh,
          date: TODAY,
          lines: [{ productId: setup.productId, qty: 5 }],
          payments: [{ methodId: setup.cash, amount: 125000, tendered: 125000 }],
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const qty = await commitTx(ORG, (tx) => stockQty(tx, setup.productId));
    expect(qty).toBe(0);
  });

  it("dua penjualan utang bersamaan 100.000 untuk pelanggan berlimit 150.000: total piutang baru tidak boleh melewati limit", async () => {
    const setup = await commitTx(ORG, async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const credit = await methodId(tx, "CREDIT");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 10 });
      const customerId = await makeCustomer(tx, { name: "Probe Balapan Limit", creditLimit: "150000" });
      return { wh, credit, productId, customerId };
    });
    const attempt = () =>
      commitTx(ORG, (tx) =>
        createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: setup.wh,
          customerId: setup.customerId,
          dueDate: TODAY,
          date: TODAY,
          lines: [{ productId: setup.productId, qty: 1 }],
          payments: [{ methodId: setup.credit, amount: 100000 }],
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    await Promise.allSettled([attempt(), attempt()]);
    const outstanding = await commitTx(ORG, async (tx) => {
      const rows = await tx
        .select({ total: sales.total, paidTotal: sales.paidTotal })
        .from(sales)
        .where(
          and(
            eq(sales.companyId, ORG),
            eq(sales.customerId, setup.customerId),
            eq(sales.status, "completed"),
          ),
        );
      return rows.reduce((a, r) => a + d(r.total).toNumber() - d(r.paidTotal).toNumber(), 0);
    });
    // Perilaku benar: limit adalah plafon keras — total ≤ 150.000.
    expect(outstanding).toBeLessThanOrEqual(150000);
  });
});
