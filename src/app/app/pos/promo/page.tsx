import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listProductOptions } from "@/server/catalog";
import { listPosPromotions } from "@/server/pos";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { PromotionsManager } from "@/components/pos/promotions-manager";

export const metadata = { title: "Promo penjualan" };
export const dynamic = "force-dynamic";

export default async function PosPromotionsPage() {
  const ctx = await requirePermissionPage("pos.discount");

  const { promotions, products } = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [promotions, products] = await Promise.all([
      listPosPromotions(tx, ctx.company.id),
      listProductOptions(tx, ctx.company.id),
    ]);
    return { promotions, products };
  });

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Promo penjualan"
        description="Atur promo diskon otomatis untuk kasir Web dan Desktop berdasarkan produk atau minimal total belanja."
        actions={
          <Link
            href="/app/pos"
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 lg:h-8"
          >
            <ShoppingCart className="size-3.5" /> Ke kasir
          </Link>
        }
      />

      <PromotionsManager rows={promotions} products={products} />
    </div>
  );
}
