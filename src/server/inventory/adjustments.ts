// FIX-ARS Tahap 4: bagian dari pemecahan src/server/inventory.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/inventory.ts.
// A-26 Q8b: posting & keputusan persetujuan dipisah ke adjustments-post.ts;
// berkas ini hanya memuat pembuatan dokumen penyesuaian.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockDocumentLines,
  stockDocuments,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { toBaseQty } from "@/lib/packaging";
import { writeAudit } from "@/server/audit";
import { resolveLinePackagings } from "@/server/catalog";
import { nextDocumentNumber } from "@/server/sequences";
import { claimIdempotencyKey } from "@/server/idempotency";
import { assertSupplierOwned, assertWarehouseOwned } from "./movements";
import { getCompanySettingsRow } from "@/server/settings";;
import { postStockAdjustment } from "./adjustments-post";

type CreateAdjustmentInput = {
  companyId: string;
  userId: string;
  warehouseId: string;
  date: string;
  type: "adjustment" | "damaged" | "expired" | "lost" | "quarantine" | "purchase_return";
  reason: string;
  supplierId?: string;
  refundMethod?: "cash" | "credit_note" | "replacement" | "deduction";
  notes?: string;
  /** GDG3-06: kunci idempotensi dari klien (pola POS). */
  idempotencyKey?: string | null;
  /**
   * Baris berkemasan (Satuan Kemasan S3): bila `packagingId` terisi,
   * `qty` adalah jumlah KEMASAN (tanda & aturan jenis dokumen dinilai
   * pada qty masukan itu; isi > 0 menjaga tanda) dan yang disimpan &
   * digerakkan selalu satuan dasar. `unitCost` tetap harga per
   * SATUAN DASAR — kemasan di sini hanya satuan penulisan qty.
   */
  lines: { productId: string; qty: string | number; unitCost?: string | number; packagingId?: string | null }[];
  // FIX-P1 (AK4-06c): pengubahan harga pokok penyesuaian. Baris tanpa
  // unitCost (atau sama dengan harga berjalan) memakai harga pokok
  // berjalan — perilaku bawaan. unitCost yang MENYIMPANG dari harga
  // berjalan adalah override: hanya boleh bila pemanggil berizin
  // (aksi meneruskan can(ctx, "inventory.cost_override") — pola
  // atestasi yang sama seperti acknowledgeMinWage payroll) DAN alasan
  // pengubahan diisi; override selalu tercatat di audit log dokumen
  // ini dengan nilai lama/baru + alasannya.
  costOverrideReason?: string;
  allowCostOverride?: boolean;
};


export async function createAdjustment(tx: Tx, input: CreateAdjustmentInput) {
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Tambahkan minimal satu barang.");
  if (!input.reason.trim()) throw new AppError("VALIDATION", "Alasan wajib diisi.");

  // FIX-P1 (AK4-02): retur ke pemasok TIDAK lagi dibuat dari penyesuaian
  // stok. Jalur warisan ini menjurnal Dr Utang Usaha tanpa tag pemasok
  // dan tanpa alokasi penerimaan (subledger utang tidak berkurang —
  // risiko utang terbayar dua kali) dan Dr Piutang Usaha untuk klaim
  // penggantian barang ke pemasok (akun yang salah secara definisi).
  // Retur pemasok yang benar hanya lewat modul Retur Pembelian
  // (A-9/D-20, src/server/supplier-returns.ts): teralokasi per
  // penerimaan tertua, kelebihan klaim ke akun Kredit Pemasok, dan
  // penyelesaiannya tercatat. Dokumen purchase_return historis tetap
  // dapat di-void lewat voidStockDocument; yang ditutup hanya pembuatan
  // barunya dari jalur penyesuaian ini.
  if (input.type === "purchase_return") {
    throw new AppError(
      "VALIDATION",
      "Retur ke pemasok dibuat dari menu Gudang → Retur Pembelian, bukan dari penyesuaian stok. " +
        "Penyesuaian stok tidak lagi membuat jurnal utang/piutang untuk retur pemasok agar utang pemasok tidak terbayar dua kali.",
    );
  }

  const { existing: existingAdjustment, idemKey: adjIdemKey } = await claimAdjustmentIdempotency(tx, input);
  if (existingAdjustment) return existingAdjustment;

  // GDG3-07: gudang (dan pemasok, bila diisi) harus milik perusahaan ini.
  await assertWarehouseOwned(tx, input.companyId, input.warehouseId);
  if (input.supplierId) await assertSupplierOwned(tx, input.companyId, input.supplierId);

  const quarantineWarehouseId = await resolveQuarantineWarehouse(tx, input);

  const doc = await insertAdjustmentDocument(tx, input, quarantineWarehouseId, adjIdemKey);

  const { totalValue, costOverrides } = await storeAdjustmentLines(tx, input, doc);

  // T5-3 (D-17) approval gate, narrowed by T5R-5: with a threshold
  // configured, a WRITE-OFF family document whose impact value EXCEEDS
  // it waits as "pending" — no movements, no journal — until a
  // different user approves it. Only adjustment/damaged/expired/lost
  // are gated: quarantine is a pure location move and always posts
  // immediately, exactly like the settings label promises. (Retur
  // pembelian tidak lagi melewati jalur ini sama sekali — FIX-P1
  // AK4-02 di awal fungsi ini.) At or below the threshold (and whenever
  // no threshold is set) posting is immediate, exactly the historical
  // behavior.
  const settings = await getCompanySettingsRow(tx, input.companyId);
  const threshold = settings?.adjustmentApprovalThreshold != null ? d(settings.adjustmentApprovalThreshold) : null;
  if (threshold !== null && APPROVAL_GATED_TYPES.includes(input.type) && totalValue.gt(threshold)) {
    await tx
      .update(stockDocuments)
      .set({ status: "pending" })
      .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));
    await writeAudit(tx, {
      companyId: input.companyId,
      userId: input.userId,
      action: "inventory.adjust.request",
      entityType: "stock_document",
      entityId: doc.id,
      after: {
        number: doc.number,
        type: input.type,
        value: toDb(totalValue),
        status: "pending",
        ...(costOverrides.length > 0 ? { costOverrides } : {}),
      },
    });
    return { id: doc.id, number: doc.number, status: "pending" as const };
  }

  await postStockAdjustment(tx, {
    companyId: input.companyId,
    userId: input.userId,
    documentId: doc.id,
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.adjust",
    entityType: "stock_document",
    entityId: doc.id,
    after: {
      number: doc.number,
      type: input.type,
      value: toDb(totalValue),
      ...(costOverrides.length > 0 ? { costOverrides } : {}),
    },
  });

  return { id: doc.id, number: doc.number, status: "posted" as const };
}

/**
 * FIX-ARS Tahap 4: fase dari createAdjustment — badan dipindah apa adanya;
 * klaim kunci idempotensi keluarga dokumen stok (GDG3-06).
 * Mengembalikan ringkasan dokumen yang sudah ada bila replay.
 */


async function claimAdjustmentIdempotency(
  tx: Tx,
  input: CreateAdjustmentInput,
): Promise<{
  existing: { id: string; number: string; status: "pending" | "posted" } | null;
  idemKey: string | null;
}> {
  // GDG3-06: replay idempotensi untuk keluarga dokumen stok.
  const adjIdemKey = input.idempotencyKey?.trim() || null;
  const findDocumentByKey = async (type: string) => {
    if (!adjIdemKey) return undefined;
    const [row] = await tx
      .select()
      .from(stockDocuments)
      .where(
        and(
          eq(stockDocuments.companyId, input.companyId),
          eq(stockDocuments.idempotencyKey, adjIdemKey),
          eq(stockDocuments.type, type),
        ),
      )
      .limit(1);
    return row;
  };
  if (adjIdemKey) {
    const existing = await findDocumentByKey(input.type);
    if (existing) {
      return { existing: { id: existing.id, number: existing.number, status: existing.status as "pending" | "posted" }, idemKey: adjIdemKey };
    }
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: adjIdemKey,
      scope: "inventory.adjustment",
    });
    if (!claimed) {
      const winner = await findDocumentByKey(input.type);
      if (winner) {
        return { existing: { id: winner.id, number: winner.number, status: winner.status as "pending" | "posted" }, idemKey: adjIdemKey };
      }
      throw new AppError(
        "CONFLICT",
        "Dokumen dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }
  return { existing: null, idemKey: adjIdemKey };
}

/**
 * FIX-ARS Tahap 4: fase dari createAdjustment — badan dipindah apa adanya;
 * resolusi gudang karantina untuk dokumen bertipe quarantine —
 * gagal cepat bila perusahaan belum memilikinya.
 */


async function resolveQuarantineWarehouse(tx: Tx, input: CreateAdjustmentInput): Promise<string | null> {
  // Quarantine (GD-P2-3a) is a physical move, not a write-off: the goods
  // leave the source warehouse and land in the company's quarantine
  // warehouse, still as inventory. Resolve that warehouse up front so the
  // document fails fast when the company has none.
  let quarantineWarehouseId: string | null = null;
  if (input.type === "quarantine") {
    const [quarantine] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.companyId, input.companyId),
          eq(warehouses.type, "quarantine"),
          eq(warehouses.isActive, true),
        ),
      )
      .orderBy(asc(warehouses.createdAt))
      .limit(1);
    if (!quarantine) {
      throw new AppError(
        "VALIDATION",
        "Perusahaan belum memiliki gudang karantina. Buat gudang bertipe Karantina terlebih dahulu agar barang karantina terpisah secara fisik dari stok yang bisa dijual.",
      );
    }
    if (quarantine.id === input.warehouseId) {
      throw new AppError(
        "VALIDATION",
        "Barang sudah berada di gudang karantina, jadi dokumen karantina dari gudang ini tidak bermakna.",
      );
    }
    quarantineWarehouseId = quarantine.id;
  }
  return quarantineWarehouseId;
}

/**
 * FIX-ARS Tahap 4: fase dari createAdjustment — badan dipindah apa adanya;
 * penulisan header dokumen (status transient "draft" di dalam
 * transaksi; posting/pending diputuskan fase berikutnya).
 */


async function insertAdjustmentDocument(
  tx: Tx,
  input: CreateAdjustmentInput,
  quarantineWarehouseId: string | null,
  adjIdemKey: string | null,
) {
  const number = await nextDocumentNumber(tx, input.companyId, "ADJUSTMENT", input.date);
  const [doc] = await tx
    .insert(stockDocuments)
    .values({
      companyId: input.companyId,
      // GD-P2-2: keep the original document type (damaged, expired, lost,
      // quarantine, ...) instead of normalizing everything to "adjustment",
      // so document history can label each kind correctly.
      type: input.type,
      number,
      date: input.date,
      warehouseId: input.warehouseId,
      toWarehouseId: quarantineWarehouseId ?? undefined,
      supplierId: input.supplierId,
      idempotencyKey: adjIdemKey,
      reason: input.reason,
      refundMethod: input.refundMethod,
      // Transient within this transaction: postStockAdjustment flips the
      // document to "posted" below, or the approval gate (T5-3 / D-17)
      // parks it as "pending". "draft" is never visible outside the tx.
      status: "draft",
      notes: input.notes,
      createdBy: input.userId,
    })
    .returning({ id: stockDocuments.id, number: stockDocuments.number });
  return doc;
}

/**
 * FIX-ARS Tahap 4: fase dari createAdjustment — badan dipindah apa adanya;
 * penulisan baris dokumen TANPA menggerakkan stok — baris
 * tersimpan adalah basis persis yang disetujui checker; override
 * harga pokok dideteksi & dicatat di sini. Mengembalikan nilai
 * dampak total dan daftar override.
 */


async function storeAdjustmentLines(tx: Tx, input: CreateAdjustmentInput, doc: { id: string }) {
  // Outbound document types (everything except the generic signed correction):
  // the qty the user types is a POSITIVE magnitude of goods leaving, and the
  // server owns the sign. Without this, a natural "damaged: 5" entry would
  // ADD 5 to stock and reverse the journal.
  const isOutbound = input.type !== "adjustment";
  let inValue = d(0);
  let outValue = d(0);

  // Lines are stored first WITHOUT moving stock: when the approval gate
  // parks the document as pending, the stored lines are the exact basis
  // the checker approves, and postStockAdjustment replays them later.
  const costOverrides: Array<{
    productId: string;
    productName: string;
    runningCost: string;
    overrideCost: string;
    reason: string;
  }> = [];
  // S3: selesaikan kemasan semua baris lebih dulu (satu gerbang
  // validasi, pola S2) — nama produk untuk pesan diambil dari peta
  // nama yang dimuat sekali di sini.
  const nameRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.companyId, input.companyId),
        inArray(products.id, [...new Set(input.lines.map((line) => line.productId))]),
      ),
    );
  const productNames = new Map(nameRows.map((row) => [row.id, row.name]));
  const resolved = await resolveLinePackagings(tx, input.companyId, input.lines, (productId) =>
    productNames.get(productId) ?? "Produk",
  );
  for (const [lineIndex, line] of input.lines.entries()) {
    const [product] = await tx
      .select({ name: products.name, sku: products.sku, costPrice: products.costPrice })
      .from(products)
      .where(and(eq(products.companyId, input.companyId), eq(products.id, line.productId)))
      .limit(1);
    if (!product) throw new AppError("VALIDATION", "Produk tidak ditemukan.");
    const snap = resolved[lineIndex];
    const enteredQty = d(line.qty);
    if (enteredQty.eq(0)) throw new AppError("VALIDATION", `Jumlah untuk ${product.name} tidak boleh nol.`);
    if (isOutbound && enteredQty.lt(0)) {
      throw new AppError(
        "VALIDATION",
        `Jumlah keluar untuk ${product.name} harus diisi positif (besaran barang yang keluar); arah keluar sudah ditentukan oleh jenis dokumen ini.`,
      );
    }
    // Qty satuan dasar: konversi SATU titik di sini; tanda & nilai
    // dampak sesudah ini hanya mengenal satuan dasar.
    const qty = snap.packaging ? d(toBaseQty(line.qty, snap.isiSnapshot)) : enteredQty;
    // FIX-P1 (AK4-06c): deteksi override harga pokok terhadap harga
    // berjalan SAAT pembuatan (otoritatif — bukan saat formulir
    // dirender). Nilai jurnal selisih tetap memakai unitCost baris
    // tersimpan secara sadar (postStockAdjustment memutar ulang baris
    // tersimpan), tetapi tidak lagi diam-diam: override tanpa izin
    // peran atau tanpa alasan ditolak di sini, dan yang lolos tercatat
    // di audit log dokumen (costOverrides pada entri audit di bawah).
    if (line.unitCost !== undefined && line.unitCost !== null && !d(line.unitCost).eq(d(product.costPrice))) {
      if (!input.allowCostOverride) {
        throw new AppError(
          "FORBIDDEN",
          `Mengubah harga pokok ${product.name} dari harga berjalan Rp${d(product.costPrice).toFixed(0)} menjadi Rp${d(line.unitCost).toFixed(0)} memerlukan izin ubah harga pokok penyesuaian (peran manajer ke atas). Kembalikan harga ke harga berjalan atau minta pengguna berizin yang membuat dokumen ini.`,
        );
      }
      const overrideReason = input.costOverrideReason?.trim() ?? "";
      if (overrideReason.length < 3) {
        throw new AppError(
          "VALIDATION",
          `Mengubah harga pokok ${product.name} dari harga berjalan Rp${d(product.costPrice).toFixed(0)} menjadi Rp${d(line.unitCost).toFixed(0)} wajib disertai alasan pengubahan harga pokok.`,
        );
      }
      costOverrides.push({
        productId: line.productId,
        productName: product.name,
        runningCost: toDb(product.costPrice),
        overrideCost: toDb(line.unitCost),
        reason: overrideReason,
      });
    }
    const delta = isOutbound ? qty.negated() : qty;
    const unitCost = d(line.unitCost ?? product.costPrice);
    const value = delta.abs().mul(unitCost);
    if (delta.gt(0)) {
      inValue = inValue.plus(value);
    } else {
      outValue = outValue.plus(value);
    }

    await tx.insert(stockDocumentLines).values({
      companyId: input.companyId,
      documentId: doc.id,
      productId: line.productId,
      productName: product.name,
      productSku: product.sku,
      qty: toDb(delta),
      // S3: bentuk masukan sebagaimana diketik (dalam kemasan
      // terpilih) + faktor cuplikannya; qty di atas tetap dasar.
      packagingId: snap.packaging?.id ?? null,
      qtyInput: toDb(enteredQty),
      isiSnapshot: snap.isiSnapshot,
      unitCost: toDb(unitCost),
      lineTotal: toDb(value),
      reason: input.reason,
    });
  }

  // GD-P2-1: the document total is the absolute movement value of the
  // whole document. For the approval gate this total IS the impact value
  // (Σ |qty delta| × running cost) the threshold is compared against.
  const totalValue = inValue.plus(outValue);
  await tx
    .update(stockDocuments)
    .set({ total: toDb(totalValue) })
    .where(and(eq(stockDocuments.companyId, input.companyId), eq(stockDocuments.id, doc.id)));
  return { totalValue, costOverrides };
}


const APPROVAL_GATED_TYPES = ["adjustment", "damaged", "expired", "lost"];
