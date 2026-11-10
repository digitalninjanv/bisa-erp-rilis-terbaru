// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  d,
  Decimal,
} from "@/lib/money";
import {
  accountMappings,
  customers,
  journalEntries,
  journalLines,
  partyOpeningBalances,
  partyPayments,
  products,
  saleReturns,
  sales,
  stockMovements,
  stockReceipts,
  supplierReturnAllocations,
  suppliers,
} from "@/db/schema";
import { mappedBalance } from "./shared";

export type ControlContributor = { title: string; detail: string | null; amount: number };

export type ControlReconciliationLeg = {
  key: "receivable" | "payable" | "inventory";
  label: string;
  /** Saldo buku besar (akun kontrol hasil pemetaan) per tanggal. */
  gl: number;
  /** Σ subledger (dokumen/ledger stok) per tanggal yang sama. */
  subledger: number;
  /** gl − subledger; 0 = selaras. */
  difference: number;
  /** Dokumen terbuka penyumbang terbesar (konteks penelusuran). */
  openDocuments: ControlContributor[];
  /** Jurnal manual yang menyentuh akun kontrol — tersangka pertama
   * bila selisih ≠ 0, karena jalur modul tidak pernah memposting ke
   * akun kontrol di luar subledgernya. */
  manualJournals: ControlContributor[];
  note: string | null;
};

/**
 * Membandingkan per tanggal (asOf) saldo GL akun kontrol dengan jumlah
 * subledgernya untuk piutang, utang, dan persediaan.
 *
 * Subledger direkonstruksi dari catatan BERTANGGAL agar tanggal asOf
 * historis pun bermakna (bukan dari kolom paidAmount berjalan):
 *   piutang  = utang awal penjualan dari baris piutang jurnal penjualannya
 *              − pembayaran party_payments (bukan void) − potongan retur
 *              (baris kredit piutang pada jurnal sale_return), ditambah
 *              dokumen saldo awal piutang − pembayarannya.
 *   utang    = penerimaan kredit posted (paymentAccountId null) −
 *              pembayaran − alokasi retur pemasok, ditambah dokumen
 *              saldo awal utang − pembayaran − alokasinya.
 *   persediaan = Σ qty mutasi stok s.d. tanggal × costPrice berjalan
 *              (label metode ditampilkan apa adanya: AVCO berjalan
 *              dihargai dengan harga pokok saat ini, dan mutasi stok
 *              ditanggal menurut waktu pencatatannya, WIB).
 *
 * Batasan yang disadari: dokumen yang sudah di-void dikeluarkan
 * seluruhnya (tanggal void tidak tersimpan sebagai tanggal bisnis),
 * jadi rekonsiliasi untuk tanggal SEBELUM sebuah void dapat menyimpang
 * sebesar dokumen itu; tanggal berjalan (kasus normal) tidak terkena.
 */
export async function getControlReconciliation(
  tx: Tx,
  companyId: string,
  asOf: string,
): Promise<{ asOf: string; legs: ControlReconciliationLeg[] }> {
  const mappingRows = await tx
    .select({ key: accountMappings.key, accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(
      and(
        eq(accountMappings.companyId, companyId),
        inArray(accountMappings.key, ["receivable", "payable", "inventory"]),
      ),
    );
  const controlAccountId = new Map(mappingRows.map((row) => [row.key, row.accountId]));

  const sumBy = (rows: Array<{ key: string | null; total: string }>) => {
    const map = new Map<string, Decimal>();
    for (const row of rows) if (row.key) map.set(row.key, d(row.total));
    return map;
  };

  /* ---------------- Piutang ---------------- */
  const receivableAccountId = controlAccountId.get("receivable");
  const saleDebt = sumBy(
    receivableAccountId
      ? await tx
          .select({
            key: journalEntries.sourceId,
            total: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .where(
            and(
              eq(journalLines.companyId, companyId),
              eq(journalLines.accountId, receivableAccountId),
              eq(journalEntries.status, "posted"),
              eq(journalEntries.sourceType, "sale"),
              lte(journalEntries.date, asOf),
            ),
          )
          .groupBy(journalEntries.sourceId)
      : [],
  );
  const salePaymentsByDoc = sumBy(
    await tx
      .select({
        key: partyPayments.saleId,
        total: sql<string>`coalesce(sum(${partyPayments.amount}), 0)`,
      })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, companyId),
          eq(partyPayments.type, "receivable"),
          sql`${partyPayments.status} <> 'void'`,
          lte(partyPayments.date, asOf),
        ),
      )
      .groupBy(partyPayments.saleId),
  );
  const returnOffsetsBySale = sumBy(
    receivableAccountId
      ? await tx
          .select({
            key: saleReturns.saleId,
            total: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .innerJoin(saleReturns, eq(journalEntries.sourceId, saleReturns.id))
          .where(
            and(
              eq(journalLines.companyId, companyId),
              eq(journalLines.accountId, receivableAccountId),
              eq(journalEntries.status, "posted"),
              inArray(journalEntries.sourceType, ["sale_return", "sale_return_reversal"]),
              lte(journalEntries.date, asOf),
            ),
          )
          .groupBy(saleReturns.saleId)
      : [],
  );

  /* ---------------- Utang ---------------- */
  const receiptPaymentsByDoc = sumBy(
    await tx
      .select({
        key: partyPayments.receiptId,
        total: sql<string>`coalesce(sum(${partyPayments.amount}), 0)`,
      })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, companyId),
          eq(partyPayments.type, "payable"),
          sql`${partyPayments.status} <> 'void'`,
          lte(partyPayments.date, asOf),
        ),
      )
      .groupBy(partyPayments.receiptId),
  );
  const openingPaymentsByDoc = sumBy(
    await tx
      .select({
        key: partyPayments.openingId,
        total: sql<string>`coalesce(sum(${partyPayments.amount}), 0)`,
      })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, companyId),
          sql`${partyPayments.status} <> 'void'`,
          lte(partyPayments.date, asOf),
        ),
      )
      .groupBy(partyPayments.openingId),
  );
  // Alokasi retur pemasok tidak punya tanggal bisnis sendiri; tanggal
  // pencatatannya (createdAt, WIB) adalah saat resolusi diposting.
  const allocationDate = sql`(${supplierReturnAllocations.createdAt} AT TIME ZONE 'Asia/Jakarta')::date`;
  const receiptAllocations = sumBy(
    await tx
      .select({
        key: supplierReturnAllocations.receiptId,
        total: sql<string>`coalesce(sum(${supplierReturnAllocations.amount}), 0)`,
      })
      .from(supplierReturnAllocations)
      .where(
        and(
          eq(supplierReturnAllocations.companyId, companyId),
          sql`${allocationDate} <= ${asOf}::date`,
        ),
      )
      .groupBy(supplierReturnAllocations.receiptId),
  );
  const openingAllocations = sumBy(
    await tx
      .select({
        key: supplierReturnAllocations.openingId,
        total: sql<string>`coalesce(sum(${supplierReturnAllocations.amount}), 0)`,
      })
      .from(supplierReturnAllocations)
      .where(
        and(
          eq(supplierReturnAllocations.companyId, companyId),
          sql`${allocationDate} <= ${asOf}::date`,
        ),
      )
      .groupBy(supplierReturnAllocations.openingId),
  );

  /* ---------------- Dokumen terbuka ---------------- */
  const saleRows = await tx
    .select({
      id: sales.id,
      number: sales.number,
      date: sales.date,
      customerName: customers.name,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(
      and(eq(sales.companyId, companyId), eq(sales.status, "completed"), lte(sales.date, asOf)),
    );
  const receiptRows = await tx
    .select({
      id: stockReceipts.id,
      number: stockReceipts.number,
      date: stockReceipts.date,
      total: stockReceipts.total,
      supplierName: suppliers.name,
    })
    .from(stockReceipts)
    .leftJoin(suppliers, eq(stockReceipts.supplierId, suppliers.id))
    .where(
      and(
        eq(stockReceipts.companyId, companyId),
        eq(stockReceipts.status, "posted"),
        eq(stockReceipts.source, "purchase"),
        isNull(stockReceipts.paymentAccountId),
        lte(stockReceipts.date, asOf),
      ),
    );
  const openingRows = await tx
    .select({
      id: partyOpeningBalances.id,
      number: partyOpeningBalances.number,
      date: partyOpeningBalances.date,
      kind: partyOpeningBalances.kind,
      partyId: partyOpeningBalances.partyId,
      amount: partyOpeningBalances.amount,
    })
    .from(partyOpeningBalances)
    .where(
      and(
        eq(partyOpeningBalances.companyId, companyId),
        sql`${partyOpeningBalances.status} <> 'void'`,
        lte(partyOpeningBalances.date, asOf),
      ),
    );
  const customerNames = new Map(
    (await tx.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.companyId, companyId))).map((r) => [r.id, r.name]),
  );
  const supplierNames = new Map(
    (await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.companyId, companyId))).map((r) => [r.id, r.name]),
  );

  type OpenDoc = ControlContributor & { outstandingDec: Decimal };
  const receivableDocs: OpenDoc[] = [];
  let receivableSub = d(0);
  for (const sale of saleRows) {
    const outstanding = (saleDebt.get(sale.id) ?? d(0))
      .minus(salePaymentsByDoc.get(sale.id) ?? d(0))
      .minus(returnOffsetsBySale.get(sale.id) ?? d(0));
    if (outstanding.isZero()) continue;
    receivableSub = receivableSub.plus(outstanding);
    receivableDocs.push({
      title: sale.number,
      detail: `${sale.customerName ?? "Pelanggan"} · ${sale.date}`,
      amount: outstanding.toNumber(),
      outstandingDec: outstanding,
    });
  }
  const payableDocs: OpenDoc[] = [];
  let payableSub = d(0);
  for (const receipt of receiptRows) {
    const outstanding = d(receipt.total)
      .minus(receiptPaymentsByDoc.get(receipt.id) ?? d(0))
      .minus(receiptAllocations.get(receipt.id) ?? d(0));
    if (outstanding.isZero()) continue;
    payableSub = payableSub.plus(outstanding);
    payableDocs.push({
      title: receipt.number,
      detail: `${receipt.supplierName ?? "Pemasok"} · ${receipt.date}`,
      amount: outstanding.toNumber(),
      outstandingDec: outstanding,
    });
  }
  for (const opening of openingRows) {
    const outstanding = d(opening.amount)
      .minus(openingPaymentsByDoc.get(opening.id) ?? d(0))
      .minus(opening.kind === "payable" ? (openingAllocations.get(opening.id) ?? d(0)) : d(0));
    if (outstanding.isZero()) continue;
    const doc: OpenDoc = {
      title: opening.number,
      detail: `${
        opening.kind === "payable"
          ? (supplierNames.get(opening.partyId) ?? "Pemasok")
          : (customerNames.get(opening.partyId) ?? "Pelanggan")
      } · saldo awal · ${opening.date}`,
      amount: outstanding.toNumber(),
      outstandingDec: outstanding,
    };
    if (opening.kind === "payable") {
      payableSub = payableSub.plus(outstanding);
      payableDocs.push(doc);
    } else {
      receivableSub = receivableSub.plus(outstanding);
      receivableDocs.push(doc);
    }
  }

  /* ---------------- Persediaan ---------------- */
  // FIX-GDG Tahap 2 (GDG3-03): subledger as-of kini dihitung dari
  // LEDGER MUTASI itu sendiri — Σ (qty × unitCost gerakan) untuk
  // gerakan bertanggal DOKUMEN (stock_movements.date) ≤ asOf, per
  // produk. Metode lama (qty ber-createdAt ≤ asOf × costPrice BERJALAN)
  // salah dua arah untuk tanggal lampau: dokumen backdated yang
  // diposting hari ini hilang dari as-of tanggal dokumennya, dan
  // seluruh riwayat dihargai ulang pada biaya hari ini — padahal kaki
  // GL memakai jurnal bertanggal dokumen pada nilai transaksinya.
  // Dengan kedua kaki membaca tanggal dokumen & nilai gerakan, selisih
  // as-of lampau pada data yang konsisten adalah 0; selisih yang
  // tersisa adalah selisih nyata (jurnal manual ke akun kontrol, dsb).
  // Batas jujur: gerakan yang tercatat SEBELUM migrasi 0044 membawa
  // tanggal posting (backfill createdAt WIB) sebagai pendekatan
  // tanggal dokumennya — dokumen backdated pra-0044 dinilai pada
  // tanggal postingnya di rekonsiliasi lampau.
  const qtyRows = await tx
    .select({
      productId: stockMovements.productId,
      totalQty: sql<string>`coalesce(sum(${stockMovements.qty}), 0)`,
      totalValue: sql<string>`coalesce(sum(${stockMovements.qty} * ${stockMovements.unitCost}), 0)`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, companyId), lte(stockMovements.date, asOf)))
    .groupBy(stockMovements.productId);
  const productRows = await tx
    .select({ id: products.id, sku: products.sku, name: products.name, costPrice: products.costPrice })
    .from(products)
    .where(eq(products.companyId, companyId));
  const productById = new Map(productRows.map((row) => [row.id, row]));
  let inventorySub = d(0);
  const inventoryDocs: OpenDoc[] = [];
  for (const row of qtyRows) {
    const qty = d(row.totalQty);
    const value = d(row.totalValue);
    if (qty.isZero() && value.isZero()) continue;
    const product = productById.get(row.productId);
    if (!product) continue;
    inventorySub = inventorySub.plus(value);
    inventoryDocs.push({
      title: `${product.sku} — ${product.name}`,
      detail: `Qty ${qty.toFixed(2)} · nilai ledger mutasi s.d. tanggal ini`,
      amount: value.toNumber(),
      outstandingDec: value,
    });
  }

  /* ---------------- Jurnal manual ke akun kontrol ---------------- */
  const manualJournalsFor = async (
    accountId: string | undefined,
    creditNormal: boolean,
  ): Promise<ControlContributor[]> => {
    if (!accountId) return [];
    const rows = await tx
      .select({
        number: journalEntries.number,
        date: journalEntries.date,
        description: journalEntries.description,
        total: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.companyId, companyId),
          eq(journalLines.accountId, accountId),
          eq(journalEntries.status, "posted"),
          eq(journalEntries.sourceType, "manual"),
          lte(journalEntries.date, asOf),
        ),
      )
      .groupBy(journalEntries.id, journalEntries.number, journalEntries.date, journalEntries.description);
    return rows
      .map((row) => ({
        title: row.number,
        detail: `${row.description} · ${row.date}`,
        amount: (creditNormal ? d(row.total).neg() : d(row.total)).toNumber(),
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);
  };

  const topDocs = (docs: OpenDoc[]): ControlContributor[] =>
    [...docs]
      .sort((a, b) => b.outstandingDec.abs().comparedTo(a.outstandingDec.abs()))
      .slice(0, 5)
      .map(({ title, detail, amount }) => ({ title, detail, amount }));

  const [receivableGl, payableGl, inventoryGl] = await Promise.all([
    mappedBalance(tx, companyId, ["receivable"], { to: asOf }),
    mappedBalance(tx, companyId, ["payable"], { to: asOf }),
    mappedBalance(tx, companyId, ["inventory"], { to: asOf }),
  ]);

  const legs: ControlReconciliationLeg[] = [
    {
      key: "receivable",
      label: "Piutang usaha",
      gl: receivableGl,
      subledger: receivableSub.toNumber(),
      difference: d(receivableGl).minus(receivableSub).toNumber(),
      openDocuments: topDocs(receivableDocs),
      manualJournals: await manualJournalsFor(receivableAccountId, false),
      note: null,
    },
    {
      key: "payable",
      label: "Utang usaha",
      gl: payableGl,
      subledger: payableSub.toNumber(),
      difference: d(payableGl).minus(payableSub).toNumber(),
      openDocuments: topDocs(payableDocs),
      manualJournals: await manualJournalsFor(controlAccountId.get("payable"), true),
      note: null,
    },
    {
      key: "inventory",
      label: "Persediaan",
      gl: inventoryGl,
      subledger: inventorySub.toNumber(),
      difference: d(inventoryGl).minus(inventorySub).toNumber(),
      openDocuments: topDocs(inventoryDocs),
      manualJournals: await manualJournalsFor(controlAccountId.get("inventory"), false),
      note: "Subledger dihitung dari ledger mutasi stok bertanggal dokumen pada biaya per gerakannya (Σ qty × unitCost), selaras sisi GL yang bertanggal jurnal — selisih yang tampil adalah selisih nyata, bukan perbedaan metode penilaian. Gerakan sebelum migrasi 0044 membawa tanggal posting sebagai pendekatan tanggal dokumennya.",
    },
  ];
  return { asOf, legs };
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01): kueri baca akuntansi yang
// dulu inline di halaman kini tinggal di modul baca ini; badan kueri
// dipindah apa adanya — urutan, batas, dan bentuk baris tidak berubah.
// ---------------------------------------------------------------------------
