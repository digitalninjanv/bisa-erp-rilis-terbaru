import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
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

export default async function NewSupplierReturnPage() {
  const ctx = await requirePermissionPageInModule("inventory.manage", "gudang");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, supplierRows, settings] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
    ]);
    return {
      warehouseRows,
      supplierRows,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
    };
  });

  // A-25 U3 (GDG-01): judul ganda ditutup — halaman hanya membawa
  // tautan kembali + satu judul; penjelasan cara kerja (draf/posting,
  // penilaian AVCO) hidup di panduan terlipat form, bukan header
  // halaman yang menduplikasi kepala form.
  return (
    <div>
      <Link
        href="/app/gudang/retur-pembelian"
        className="mb-2 inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Kembali ke daftar Retur Pembelian
      </Link>
      <h1 className="mb-3 text-[18px] font-semibold leading-tight">Retur pembelian baru</h1>
      {data.warehouseRows.length === 0 || data.supplierRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
          Retur membutuhkan minimal satu gudang dan satu pemasok. Tambahkan lewat menu Gudang (Pemasok) atau Pengaturan (gudang) terlebih dahulu.
        </div>
      ) : (
        <SupplierReturnForm
          suppliers={data.supplierRows}
          warehouses={data.warehouseRows}
          defaultWarehouseId={data.defaultWarehouseId}
          today={todayISO()}
          reasonOptions={Object.entries(SUPPLIER_RETURN_REASON_LABELS).map(([value, label]) => ({ value, label }))}
          resolutionOptions={Object.entries(SUPPLIER_RETURN_RESOLUTION_LABELS).map(([value, label]) => ({ value, label }))}
        />
      )}
    </div>
  );
}
