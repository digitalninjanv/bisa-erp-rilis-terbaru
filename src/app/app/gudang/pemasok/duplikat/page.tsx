import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import { findPartyDuplicates, type DuplicatePair } from "@/server/master-data";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { PartyMergePanel } from "@/components/gudang/party-merge-panel";

export const metadata = { title: "Kemungkinan duplikat pihak" };
export const dynamic = "force-dynamic";

/**
 * S3 (§18G): panel kemungkinan duplikat — pasangan pemasok/pelanggan
 * yang namanya sangat mirip (trigram), teleponnya sama, atau NPWP-nya
 * sama. Panel ini hanya menampilkan; penggabungan dilakukan pengguna
 * lewat panel merge dengan pratinjau saldo & konfirmasi.
 */
export default async function PartyDuplicatesPage() {
  const ctx = await requirePermissionPage("inventory.view");
  const canManage = can(ctx, "inventory.manage");
  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [suppliers, customers] = await Promise.all([
      findPartyDuplicates(tx, ctx.company.id, "supplier"),
      findPartyDuplicates(tx, ctx.company.id, "customer"),
    ]);
    return { suppliers, customers };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Kemungkinan duplikat pihak"
        description="Pasangan pemasok/pelanggan yang terdeteksi mirip berdasarkan nama, telepon, atau NPWP. Periksa dulu — tidak ada data yang diubah dari halaman ini kecuali Anda menjalankan penggabungan secara eksplisit."
        actions={
          <Link
            href="/app/gudang/pemasok"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
          >
            Kembali ke daftar pihak
          </Link>
        }
      />
      <DuplicateSection title="Pemasok" pairs={data.suppliers} canManage={canManage} />
      <DuplicateSection title="Pelanggan" pairs={data.customers} canManage={canManage} />
    </div>
  );
}

function DuplicateSection({
  title,
  pairs,
  canManage,
}: {
  title: string;
  pairs: DuplicatePair[];
  canManage: boolean;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-3 py-2.5 text-[13px] font-semibold">
        {title} ({pairs.length} pasangan)
      </h2>
      {pairs.length === 0 ? (
        <EmptyState title="Tidak ada kemungkinan duplikat" description="Nama, telepon, dan NPWP pihak tidak menunjukkan kemiripan yang mencurigakan." />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pihak A</th>
                <th>Pihak B</th>
                <th>Alasan</th>
                {canManage ? <th className="text-right">Gabung</th> : null}
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <tr key={`${pair.a.id}-${pair.b.id}`}>
                  <td>
                    <Link
                      href={`/app/gudang/${pair.kind === "supplier" ? "pemasok" : "pelanggan"}/${pair.a.id}`}
                      className="text-[12px] font-medium hover:underline"
                    >
                      {pair.a.name}
                    </Link>
                    <p className="num text-[10px] text-muted-foreground">
                      {pair.a.code}
                      {pair.a.phone ? ` · ${pair.a.phone}` : ""}
                      {pair.a.isActive ? "" : " · Nonaktif"}
                    </p>
                  </td>
                  <td>
                    <Link
                      href={`/app/gudang/${pair.kind === "supplier" ? "pemasok" : "pelanggan"}/${pair.b.id}`}
                      className="text-[12px] font-medium hover:underline"
                    >
                      {pair.b.name}
                    </Link>
                    <p className="num text-[10px] text-muted-foreground">
                      {pair.b.code}
                      {pair.b.phone ? ` · ${pair.b.phone}` : ""}
                      {pair.b.isActive ? "" : " · Nonaktif"}
                    </p>
                  </td>
                  <td className="text-[11px]">{pair.reasons.join(" · ")}</td>
                  {canManage ? (
                    <td className="text-right">
                      <PartyMergePanel kind={pair.kind} a={pair.a} b={pair.b} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
