import Link from "next/link";
import { ArrowRight, Database, FileSpreadsheet, Package, Shapes, Users } from "lucide-react";
import { PageHeader } from "@/components/blocks/page-header";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";

export const metadata = { title: "Data master" };
export const dynamic = "force-dynamic";

const baseCardClass =
  "group flex min-h-36 flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function MasterDataPage() {
  const ctx = await requirePermissionPage("inventory.view");
  const canManageInventory = can(ctx, "inventory.manage");
  const canImport = can(ctx, "import.manage");

  const entries = [
    {
      title: "Produk",
      description: "SKU, barcode, harga, stok minimum, dan kategori produk.",
      href: "/app/gudang/produk",
      icon: Package,
      enabled: true,
    },
    {
      title: "Pemasok & pelanggan",
      description: "Kontak, termin pembayaran, limit kredit, dan data pihak.",
      href: "/app/gudang/pemasok",
      icon: Users,
      enabled: true,
    },
    {
      title: "Kategori & satuan",
      description: "Atur struktur kategori produk dan satuan stok yang digunakan.",
      href: "/app/gudang/kategori-satuan",
      icon: Shapes,
      enabled: canManageInventory,
    },
    {
      title: "Impor data",
      description: "Pratinjau, validasi, dan impor master data dari berkas.",
      href: "/app/gudang/impor",
      icon: FileSpreadsheet,
      enabled: canImport,
    },
  ].filter((entry) => entry.enabled);

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Data master"
        description="Kelola data acuan yang dipakai dalam penjualan, pembelian, dan persediaan."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link key={entry.href} href={entry.href} className={baseCardClass}>
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </div>
              <div className="mt-4">
                <h2 className="text-sm font-semibold text-foreground">{entry.title}</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        <Database aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>
          Pergerakan dan nilai stok tetap tersedia pada menu Persediaan. Kelompok harga dikelola dari modul POS agar pengaturan harga tetap dekat dengan proses penjualan.
        </p>
      </div>
    </div>
  );
}
