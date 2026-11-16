import { getSupplierReturnableQtyByReceiptLine, listSupplierReturnReceiptOptions } from "@/server/catalog";
import Link from "next/link";
import { ArrowLeft, FileText, PencilLine } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getReceiptDetail,
  getSettings,
  listSuppliers,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import {
  SUPPLIER_RETURN_REASON_LABELS,
  SUPPLIER_RETURN_RESOLUTION_LABELS,
} from "@/server/supplier-returns";
import { requirePermissionPageInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { d, formatQty } from "@/lib/money";
import { parsePageParam } from "@/lib/pagination";
import { SupplierReturnForm } from "@/components/gudang/supplier-return-form";

export const metadata = { title: "Retur Pembelian Baru" };
export const dynamic = "force-dynamic";

export default async function NewSupplierReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ receiptId?: string; mode?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPageInModule("inventory.manage", "gudang");
  const manualMode = params.mode === "manual";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, supplierRows, settings, receipt, receiptOptions] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      params.receiptId
        ? getReceiptDetail(tx, ctx.company.id, params.receiptId)
        : Promise.resolve(null),
      listSupplierReturnReceiptOptions(tx, ctx.company.id, {
        page: parsePageParam(params.page),
        q: params.q,
      }),
    ]);
    const returnableQtyByLine = receipt
      ? await getSupplierReturnableQtyByReceiptLine(
          tx,
          ctx.company.id,
          receipt.lines.map((line) => line.id),
        )
      : new Map<string, string>();
    return {
      warehouseRows,
      supplierRows,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
      receipt,
      receiptOptions,
      returnableQtyByLine,
    };
  });

  const receiptReady =
    data.receipt?.receipt.status === "posted" &&
    data.receipt.receipt.source === "purchase" &&
    Boolean(data.receipt.receipt.supplierId);
  const reasonOptions = Object.entries(SUPPLIER_RETURN_REASON_LABELS).map(([value, label]) => ({ value, label }));
  const resolutionOptions = Object.entries(SUPPLIER_RETURN_RESOLUTION_LABELS).map(([value, label]) => ({ value, label }));
  const prerequisitesMissing = data.warehouseRows.length === 0 || data.supplierRows.length === 0;
  const unavailableBatchLines: {
    name: string;
    qty: string;
    batchNumber: string | null;
    expiryDate: string | null;
  }[] = [];
  const initialReturnLines = data.receipt?.lines.flatMap((line) => {
    const returnableQty = data.returnableQtyByLine.get(line.id) ?? "0";
    if (!d(returnableQty).gt(0)) return [];
    const sourceHasBatchIdentity = line.batchNumber !== null || line.expiryDate !== null;
    const sourceBatchQty = line.sourceBatchQty ?? "0";
    if (
      line.trackBatch &&
      sourceHasBatchIdentity &&
      (!line.sourceBatchId || !d(sourceBatchQty).gt(0))
    ) {
      unavailableBatchLines.push({
        name: line.productName,
        qty: returnableQty,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
      });
      return [];
    }
    const effectiveQty =
      line.trackBatch && line.sourceBatchId && d(sourceBatchQty).lt(d(returnableQty))
        ? sourceBatchQty
        : returnableQty;
    return [{
      receiptLineId: line.id,
      productId: line.productId,
      name: line.productName,
      sku: line.sku ?? "",
      qty: line.trackBatch && !line.sourceBatchId ? "0" : effectiveQty,
      returnableQty,
      trackBatch: line.trackBatch,
      sourceBatchId: line.sourceBatchId,
      sourceBatchNumber: line.batchNumber,
      sourceExpiryDate: line.expiryDate,
      sourceBatchQty: line.sourceBatchQty,
      unitCost: line.unitCost,
    }];
  }) ?? [];

  return (
    <div>
      <Link
        href="/app/gudang/retur-pembelian"
        className="mb-2 inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Kembali ke daftar Retur Pembelian
      </Link>
      <h1 className="mb-3 text-[18px] font-semibold leading-tight">Retur pembelian baru</h1>

      {prerequisitesMissing ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
          Retur membutuhkan minimal satu gudang dan satu pemasok. Tambahkan lewat menu Gudang (Pemasok) atau Pengaturan (gudang) terlebih dahulu.
        </div>
      ) : receiptReady && data.receipt?.returnStatus === "has_draft" && data.receipt.linkedReturns.find((r) => r.status === "draft") ? (
        <div className="rounded-lg border border-tone-amber/40 bg-tone-amber-soft p-4">
          <h2 className="text-[13px] font-semibold text-tone-amber">Draf Retur Sudah Ada untuk Penerimaan Ini</h2>
          <p className="mt-1 text-[12px] text-foreground/80">
            Penerimaan <span className="font-semibold">{data.receipt.receipt.number}</span> sudah memiliki draf retur aktif dengan nomor{" "}
            <span className="font-semibold">{data.receipt.linkedReturns.find((r) => r.status === "draft")!.number}</span>.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Untuk mencegah duplikasi dokumen retur, silakan lanjutkan pengeditan pada draf yang sudah dibuat atau hapus draf tersebut jika ingin membuat ulang.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Link
              href={`/app/gudang/retur-pembelian/${data.receipt.linkedReturns.find((r) => r.status === "draft")!.id}`}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Buka Draf {data.receipt.linkedReturns.find((r) => r.status === "draft")!.number} →
            </Link>
            <Link
              href="/app/gudang/retur-pembelian/baru"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              Pilih penerimaan lain
            </Link>
          </div>
        </div>
      ) : receiptReady && initialReturnLines.length > 0 ? (
        <div>
          {unavailableBatchLines.length > 0 ? (
            <div role="status" className="mb-3 rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2 text-[11px] text-tone-amber">
              Beberapa sisa faktur belum bisa diretur karena batch sumber tidak ditemukan atau stok batch sudah habis.
              <ul className="mt-1 list-disc pl-4">
                {unavailableBatchLines.map((line, index) => (
                  <li key={`${line.name}-${line.batchNumber ?? ""}-${index}`}>
                    {line.name} · sisa faktur {formatQty(line.qty)}
                    {line.batchNumber ? ` · batch ${line.batchNumber}` : ""}
                    {line.expiryDate ? ` · ED ${line.expiryDate}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Sumber: penerimaan <span className="num font-medium text-foreground">{data.receipt!.receipt.number}</span>
            </p>
            <Link
              href="/app/gudang/retur-pembelian/baru"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Ganti penerimaan pembelian
            </Link>
          </div>
          <SupplierReturnForm
            suppliers={data.supplierRows}
            warehouses={data.warehouseRows}
            defaultWarehouseId={data.defaultWarehouseId}
            today={todayISO()}
            initialSupplierId={data.receipt!.receipt.supplierId ?? undefined}
            initialWarehouseId={data.receipt!.receipt.warehouseId ?? undefined}
            initialLines={initialReturnLines}
            sourceReceiptNumber={data.receipt!.receipt.number}
            lockSource
            reasonOptions={reasonOptions}
            resolutionOptions={resolutionOptions}
          />
        </div>
      ) : receiptReady ? (
        <div className="rounded-lg border border-border bg-card px-4 py-4">
          <h2 className="text-[13px] font-semibold">
            {unavailableBatchLines.length > 0 ? "Stok batch sumber tidak tersedia" : "Penerimaan Sudah Selesai Diretur"}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {unavailableBatchLines.length > 0
              ? `Masih ada sisa pada faktur ${data.receipt!.receipt.number}, tetapi batch sumbernya tidak ditemukan atau tidak memiliki stok. Retur tidak dibuat agar lot lain tidak ikut terpotong.`
              : `Semua jumlah pada penerimaan ${data.receipt!.receipt.number} sudah selesai diretur lewat dokumen retur terposting.`}
          </p>
          {unavailableBatchLines.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-[11px] text-muted-foreground">
              {unavailableBatchLines.map((line, index) => (
                <li key={`${line.name}-${line.batchNumber ?? ""}-${index}`}>
                  {line.name} · sisa faktur {formatQty(line.qty)}
                  {line.batchNumber ? ` · batch ${line.batchNumber}` : ""}
                  {line.expiryDate ? ` · ED ${line.expiryDate}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            {data.receipt?.linkedReturns.find((r) => r.status !== "draft") ? (
              <Link
                href={`/app/gudang/retur-pembelian/${data.receipt.linkedReturns.find((r) => r.status !== "draft")!.id}`}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                Lihat Retur {data.receipt.linkedReturns.find((r) => r.status !== "draft")!.number} →
              </Link>
            ) : null}
            <Link
              href="/app/gudang/retur-pembelian/baru"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              Pilih penerimaan lain
            </Link>
          </div>
        </div>
      ) : manualMode ? (
        <SupplierReturnForm
          suppliers={data.supplierRows}
          warehouses={data.warehouseRows}
          defaultWarehouseId={data.defaultWarehouseId}
          today={todayISO()}
          reasonOptions={reasonOptions}
          resolutionOptions={resolutionOptions}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-4" />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold">Retur dari penerimaan pembelian</h2>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                  Cari nomor faktur, pemasok, atau nomor penerimaan. Pemasok, gudang, dan barang terisi dari dokumen asal.
                </p>
              </div>
            </div>
            {params.receiptId && !receiptReady ? (
              <p className="mt-3 rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2 text-[11px] text-tone-amber">
                Penerimaan pembelian tidak ditemukan atau belum terposting. Pilih dokumen lain.
              </p>
            ) : null}
            <form action="/app/gudang/retur-pembelian/baru" className="mt-3 flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Nomor faktur, pemasok, atau penerimaan"
                aria-label="Cari penerimaan pembelian"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px]"
              />
              <button
                type="submit"
                className="h-9 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
              >
                Cari
              </button>
            </form>
            {data.receiptOptions.rows.length === 0 ? (
              <p className="mt-3 text-[11px] text-muted-foreground">
                {params.q ? "Tidak ada penerimaan pembelian yang cocok." : "Belum ada penerimaan pembelian yang dapat diretur."}
              </p>
            ) : (
              <form action="/app/gudang/retur-pembelian/baru" className="mt-2 space-y-2">
                {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
                <select
                  name="receiptId"
                  defaultValue={params.receiptId ?? ""}
                  aria-label="Pilih penerimaan pembelian"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
                >
                  <option value="">Pilih faktur/penerimaan…</option>
                  {data.receiptOptions.rows.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.supplierInvoiceNumber || "No. faktur belum dicatat"} · {option.number} · {option.date} · {option.supplierName}
                      {option.poNumber ? ` · ${option.poNumber}` : ""} · sisa {formatQty(option.availableQty)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="h-9 w-full rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Muat baris penerimaan
                </button>
              </form>
            )}
            {data.receiptOptions.totalPages > 1 ? (
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{data.receiptOptions.total} dokumen · halaman {data.receiptOptions.page}/{data.receiptOptions.totalPages}</span>
                <div className="flex gap-3">
                  {data.receiptOptions.page > 1 ? (
                    <Link
                      href={`/app/gudang/retur-pembelian/baru?${params.q ? `q=${encodeURIComponent(params.q)}&` : ""}page=${data.receiptOptions.page - 1}`}
                      className="font-medium text-primary hover:underline"
                    >
                      Sebelumnya
                    </Link>
                  ) : null}
                  {data.receiptOptions.page < data.receiptOptions.totalPages ? (
                    <Link
                      href={`/app/gudang/retur-pembelian/baru?${params.q ? `q=${encodeURIComponent(params.q)}&` : ""}page=${data.receiptOptions.page + 1}`}
                      className="font-medium text-primary hover:underline"
                    >
                      Berikutnya
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <PencilLine className="size-4" />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold">Retur tanpa faktur</h2>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                  Pilih pemasok, gudang, dan barang secara manual. Gunakan bila dokumen penerimaan tidak tersedia atau barang berasal dari saldo awal.
                </p>
              </div>
            </div>
            <Link
              href="/app/gudang/retur-pembelian/baru?mode=manual"
              className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Mulai retur manual
            </Link>
          </section>
        </div>
      )}

      {!receiptReady && !manualMode ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Mulai dari penerimaan pembelian agar qty dan batch terisi dari dokumen asal; nilai retur dihitung saat posting.
        </p>
      ) : null}
    </div>
  );
}
