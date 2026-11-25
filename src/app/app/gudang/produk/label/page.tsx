import Link from "next/link";
import { ArrowLeft, Tag } from "lucide-react";
import { z } from "zod";
import { withCompanyReadOnly } from "@/db/tenant";
import { getSettings, listProductsForPriceLabels } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { PriceLabelSheet } from "@/components/gudang/price-label-sheet";

export const metadata = { title: "Cetak label harga rak" };
export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

export default async function ProductPriceLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const requestedIds = (query.ids ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => uuidSchema.safeParse(part).success)
    .slice(0, 100);

  const { companyName, items } = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [settings, items] = await Promise.all([
      getSettings(tx, ctx.company.id),
      listProductsForPriceLabels(tx, ctx.company.id, requestedIds),
    ]);
    return { companyName: settings?.legalName || ctx.company.name, items };
  });

  return (
    <div>
      <div className="no-print mb-3">
        <Link
          href="/app/gudang/produk"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Kembali ke daftar produk
        </Link>
      </div>

      <div className="no-print">
        <PageHeader
          eyebrow="Gudang · Produk"
          title="Cetak label harga rak"
          description={
            requestedIds.length > 0
              ? `Menyiapkan label harga & barcode untuk ${items.length} produk terpilih.`
              : "Menampilkan hingga 24 produk aktif pertama. Centang produk di daftar Produk untuk mencetak pilihan tertentu."
          }
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Tidak ada produk untuk dicetak"
          description="Pilih produk aktif dari daftar produk terlebih dahulu untuk mencetak label harga rak."
          icon={<Tag className="size-5" />}
        />
      ) : (
        <PriceLabelSheet companyName={companyName} products={items} />
      )}
    </div>
  );
}
