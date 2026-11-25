import Link from "next/link";
import { Search, Tags, Users } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listCustomerGroupsWithCounts } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";

export const metadata = { title: "Kelompok harga" };
export const dynamic = "force-dynamic";

export default async function PosGroupsPage() {
  const ctx = await requirePermissionPage("pos.sell");

  const groups = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listCustomerGroupsWithCounts(tx, ctx.company.id),
  );

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Kelompok harga"
        description="Harga khusus hanya aktif saat kelompok dipilih di kasir. Tanpa kelompok, semua produk memakai harga normal."
        actions={
          <Link
            href="/app/pos"
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 lg:h-8"
          >
            <Search className="size-3.5" /> Ke kasir
          </Link>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          title="Belum ada kelompok harga"
          description="Buat kelompok dan atur harga produknya di Pengaturan → Grup pelanggan."
          icon={<Users className="size-5" />}
          action={
            <Link href="/app/pengaturan?tab=grup" className="inline-flex min-h-11 items-center text-[12px] font-medium text-primary hover:underline">
              Buka pengaturan kelompok
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((group) => (
            <section key={group.id} className="rounded-lg border border-border bg-card">
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-tone-teal-soft text-tone-teal">
                    <Users className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-[13px] font-semibold">
                      {group.name}
                      {!group.isActive ? (
                        <span className="ml-1.5 inline-flex align-middle">
                          <StatusBadge status="inactive" />
                        </span>
                      ) : null}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {group.productCount} produk beraturan harga
                    </p>
                  </div>
                </div>
                <Link
                  href={`/app/pengaturan?tab=grup&group=${group.id}`}
                  className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium hover:bg-muted"
                >
                  <Tags className="size-3" /> Atur harga
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-2 px-4 py-3 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Kelipatan harga</p>
                  <p className="num mt-0.5 font-medium">
                    {group.roundingStep === 0 ? "Tanpa pembulatan" : `Rp ${group.roundingStep.toLocaleString("id-ID")}`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Arah pembulatan</p>
                  <p className="mt-0.5 font-medium">
                    {group.roundingDirection === "down"
                      ? "Ke bawah"
                      : group.roundingDirection === "up"
                        ? "Ke atas"
                        : "Terdekat"}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Total tunai</p>
                  <p className="mt-0.5 font-medium">
                    {group.roundCashTotal ? "Dibulatkan agar mudah dibayar" : "Tidak dibulatkan"}
                  </p>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <h2 className="text-[13px] font-semibold">Cara kerja</h2>
        <ol className="mt-2 space-y-1.5 text-[11px] leading-5 text-muted-foreground">
          <li>1. Pilih kelompok di layar kasir. Tanpa pilihan, harga normal yang dipakai.</li>
          <li>2. Setiap produk bisa memakai harga normal, diskon persen, atau harga tetap.</li>
          <li>3. Harga kelompok dibulatkan sesuai kelipatan dan arah kelompok, misalnya Rp 500 ke bawah.</li>
          <li>4. Selisih harga normal dan harga kelompok dicatat sebagai diskon penjualan di jurnal.</li>
        </ol>
      </section>
    </div>
  );
}
