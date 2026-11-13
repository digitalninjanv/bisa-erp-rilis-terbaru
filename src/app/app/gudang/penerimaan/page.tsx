import Link from "next/link";
import { History } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getAccountMap, listPaymentAccounts } from "@/server/accounting";
import { getPurchaseOrderSupplier } from "@/server/purchasing";
import {
  getSettings,
  listSuppliers,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formGateState } from "@/lib/form-gate";
import { todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { ReceiptForm } from "@/components/gudang/receipt-form";

export const metadata = { title: "Penerimaan barang" };
export const dynamic = "force-dynamic";

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, supplierRows, settings, mappings, paymentAccounts] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      getAccountMap(tx, ctx.company.id),
      listPaymentAccounts(tx, ctx.company.id),
    ]);
    const initialPurchaseOrder = params.po
      ? await getPurchaseOrderSupplier(tx, ctx.company.id, params.po)
      : null;
    return {
      warehouseRows,
      supplierRows,
      paymentAccounts,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
      taxRate: settings?.taxEnabled ? (settings?.taxRate ?? "0") : "0",
      taxInputMapped: Boolean(mappings.tax_input),
      initialPurchaseOrder,
    };
  });

  const gate = formGateState({
    canManage: can(ctx, "inventory.manage"),
    available: data.warehouseRows.length,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Penerimaan barang"
        description="Catat barang masuk dari pembelian, stok awal, bonus, atau retur pelanggan. Stok dan jurnal diperbarui otomatis."
        actions={
          <Link
            href="/app/gudang/penerimaan/riwayat"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            <History className="size-3.5" /> Riwayat / Faktur pembelian
          </Link>
        }
      />

      {gate === "form" ? (
        <ReceiptForm
          warehouses={data.warehouseRows}
          suppliers={data.supplierRows}
          paymentAccounts={data.paymentAccounts}
          defaultWarehouseId={data.defaultWarehouseId}
          today={todayISO()}
          taxRate={data.taxRate}
          taxInputMapped={data.taxInputMapped}
          initialPurchaseOrder={data.initialPurchaseOrder}
          canPrice={can(ctx, "inventory.price")}
        />
      ) : gate === "missing" ? (
        <GateNotice>
          {can(ctx, "settings.manage")
            ? "Tambahkan gudang terlebih dahulu di menu Pengaturan."
            : "Belum ada gudang terdaftar. Gudang diatur oleh pemilik/admin di menu Pengaturan."}
        </GateNotice>
      ) : (
        <GateNotice>{viewModeText("penerimaan barang")}</GateNotice>
      )}
    </div>
  );
}