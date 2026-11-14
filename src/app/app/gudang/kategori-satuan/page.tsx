import { PageHeader } from "@/components/blocks/page-header";
import { TaxonomyManager } from "@/components/gudang/taxonomy-manager";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { listAllCategories, listAllUnits } from "@/server/catalog";

export const metadata = { title: "Kategori & satuan" };
export const dynamic = "force-dynamic";

export default async function TaxonomyPage() {
  const ctx = await requirePermissionPage("inventory.manage");
  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [categories, units] = await Promise.all([
      listAllCategories(tx, ctx.company.id),
      listAllUnits(tx, ctx.company.id),
    ]);
    return { categories, units };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Data master"
        title="Kategori & satuan"
        description="Kelola kategori bertingkat dan satuan dasar yang dipakai pada produk dan perhitungan stok."
      />
      <TaxonomyManager categories={data.categories} units={data.units} />
    </div>
  );
}
