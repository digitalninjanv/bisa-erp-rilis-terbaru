import { listSupplierReturnReceiptOptions } from "@/server/catalog";
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
import { SupplierReturnForm } from "@/components/gudang/supplier-return-form";

export const metadata = { title: "Retur Pembelian Baru" };
export const dynamic = "force-dynamic";

export default async function NewSupplierReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ receiptId?: string; mode?: string }>;
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
      listSupplierReturnReceiptOptions(tx, ctx.company.id),
    ]);
    return {
      warehouseRows,
      supplierRows,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
      receipt,
      receiptOptions,
    };
  });

  const receiptReady = data.receipt?.receipt.status === "posted";
  const reasonOptions = Object.entries(SUPPLIER_RETURN_REASON_LABELS).map(([value, label]) => ({ value, label }));
  const resolutionOptions = Object.entries(SUPPLIER_RETURN_RESOLUTION_LABELS).map(([value, label]) => ({ value, label }));
  const prerequisitesMissing = data.warehouseRows.length === 0 || data.supplierRows.length === 0;

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
      ) : receiptReady ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Sumber: penerimaan <span className="num font-medium text-foreground">{data.receipt!.receipt.number}</span>
            </p>
            <Link
              href="/app/gudang/retur-pembelian/baru"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Ganti faktur penerimaan
            </Link>
          </div>
          <SupplierReturnForm
            suppliers={data.supplierRows}
            warehouses={data.warehouseRows}
            defaultWarehouseId={data.defaultWarehouseId}
            today={todayISO()}
            initialSupplierId={data.receipt!.receipt.supplierId ?? undefined}
            initialWarehouseId={data.receipt!.receipt.warehouseId ?? undefined}
            initialLines={data.receipt!.lines.map((line) => ({
              receiptLineId: line.id,
              productId: line.productId,
              name: line.productName,
              sku: line.sku ?? "",
              qty: line.qty,
              trackBatch: Boolean(line.batchNumber),
              unitCost: line.unitCost,
            }))}
            sourceReceiptNumber={data.receipt!.receipt.number}
            lockSource
            reasonOptions={reasonOptions}
            resolutionOptions={resolutionOptions}
          />
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
                <h2 className="text-[13px] font-semibold">Retur dari faktur penerimaan</h2>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                  Pilih penerimaan yang sudah posted. Pemasok, gudang, barang, dan qty terisi otomatis dari dokumen asal.
                </p>
              </div>
            </div>
            {params.receiptId && !receiptReady ? (
              <p className="mt-3 rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2 text-[11px] text-tone-amber">
                Faktur penerimaan tidak ditemukan atau belum posted. Pilih dokumen lain.
              </p>
            ) : null}
            {data.receiptOptions.length === 0 ? (
              <p className="mt-3 text-[11px] text-muted-foreground">Belum ada penerimaan posted.</p>
            ) : (
              <form action="/app/gudang/retur-pembelian/baru" className="mt-3 space-y-2">
                <select
                  name="receiptId"
                  defaultValue={params.receiptId ?? ""}
                  aria-label="Pilih faktur penerimaan"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
                >
                  <option value="">Pilih faktur penerimaan…</option>
                  {data.receiptOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.number} · {option.date} · {option.supplierName ?? "—"}
                      {option.poNumber ? ` · ${option.poNumber}` : ""}
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
          Disarankan memulai dari faktur penerimaan agar qty, batch, dan nilai mengikuti dokumen asal.
        </p>
      ) : null}
    </div>
  );
}
