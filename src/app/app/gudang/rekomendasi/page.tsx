import { withCompanyReadOnly } from "@/db/tenant";
import { listPurchaseRecommendations } from "@/server/purchasing";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { PurchaseRecommendations } from "@/components/gudang/purchase-recommendations";

export const metadata = { title: "Rekomendasi pembelian" };
export const dynamic = "force-dynamic";

export default async function PurchaseRecommendationsPage() {
  const ctx = await requirePermissionPage("inventory.view");

  const rows = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listPurchaseRecommendations(tx, ctx.company.id),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Rekomendasi pembelian"
        description="Produk aktif pelacak stok yang total stoknya (semua gudang) sudah mencapai atau di bawah stok minimum. Centang produk lalu buat PO draft — satu PO per pemasok utama."
      />
      <PurchaseRecommendations rows={rows} />
    </div>
  );
}
