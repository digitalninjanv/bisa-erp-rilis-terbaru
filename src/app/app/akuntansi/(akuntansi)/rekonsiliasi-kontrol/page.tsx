import { withCompanyReadOnly } from "@/db/tenant";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";
import { getControlReconciliation, type ControlReconciliationLeg } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { formatIDR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { DateField } from "@/components/date-field";
import { fieldWidths } from "@/components/blocks/field-classes";
import { cn } from "@/lib/utils";

export const metadata = { title: "Rekonsiliasi kontrol" };
export const dynamic = "force-dynamic";

/**
 * FIX-R2 Tahap 3 (AK2-07): panel rekonsiliasi akun kontrol vs subledger.
 * Berbeda dari "Rekonsiliasi bank" (pencocokan mutasi bank): halaman ini
 * membuktikan saldo buku besar piutang/utang/persediaan sama dengan
 * jumlah dokumen subledgernya per tanggal — selisih ≠ 0 selalu tampil
 * merah beserta jurnal manual & dokumen terbuka terbesar untuk
 * ditelusur, tidak pernah disembunyikan.
 */
export default async function ControlReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const params = await searchParams;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "") ? (params.asOf as string) : todayISO();
  const ctx = await requirePermissionPage("accounting.view");
  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getControlReconciliation(tx, ctx.company.id, asOf),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akuntansi"
        title="Rekonsiliasi kontrol"
        description={`Saldo buku besar akun kontrol dibandingkan dengan jumlah subledgernya per ${formatDate(asOf)}. Selisih harus Rp0 — bila tidak, jurnal manual ke akun kontrol dan dokumen terbuka terbesar ditampilkan untuk ditelusur.`}
      />

      {/* A-25 U4: tabel ringkasan memakai DataList bersama seperti
          daftar lain; filter "per tanggal" memakai DateField bersama
          (tampilan dd/mm/yyyy) di bilah alatnya — bukan lagi input
          tanggal native di kepala halaman. Warna vonis memakai token
          nada rumah (bukan emerald/red Tailwind mentah). */}
      <DataList
        toolbar={
          <AutoFilterForm action="/app/akuntansi/rekonsiliasi-kontrol" className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Per tanggal</span>
              <span className={`block ${fieldWidths.date}`}>
                <DateField name="asOf" defaultValue={asOf} aria-label="Per tanggal" />
              </span>
            </label>
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Tampilkan
            </button>
          </AutoFilterForm>
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Akun kontrol</th>
                <th className="text-right">Saldo buku besar</th>
                <th className="text-right">Jumlah subledger</th>
                <th className="text-right">Selisih</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.legs.map((leg) => (
                <tr key={leg.key}>
                  <td className="font-medium">{leg.label}</td>
                  <td className="num text-right">{formatIDR(leg.gl)}</td>
                  <td className="num text-right">{formatIDR(leg.subledger)}</td>
                  <td
                    className={cn(
                      "num text-right font-semibold",
                      leg.difference === 0 ? "text-tone-green" : "text-tone-red",
                    )}
                  >
                    {formatIDR(leg.difference)}
                  </td>
                  <td>
                    {leg.difference === 0 ? (
                      <span className="inline-flex rounded-full bg-tone-green-soft px-2 py-0.5 text-[11px] font-medium text-tone-green">
                        Selaras
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-tone-red-soft px-2 py-0.5 text-[11px] font-medium text-tone-red">
                        Berselisih — telusur di bawah
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>

      {data.legs.map((leg) => (
        <LegDetail key={leg.key} leg={leg} />
      ))}
    </div>
  );
}

function LegDetail({ leg }: { leg: ControlReconciliationLeg }) {
  const showContributors = leg.difference !== 0;
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-[12px] font-semibold">{leg.label}</h2>
        {leg.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{leg.note}</p> : null}
      </div>
      {showContributors ? (
        <div className="grid gap-0 md:grid-cols-2">
          <div className="border-b border-border/60 px-3 py-2 md:border-b-0 md:border-r">
            <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">
              Jurnal manual ke akun kontrol (tersangka utama selisih)
            </h3>
            {leg.manualJournals.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Tidak ada jurnal manual ke akun ini s.d. tanggal ini — selisih kemungkinan berasal dari
                jalur modul; bandingkan dokumen terbuka di samping.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {leg.manualJournals.map((row) => (
                  <li key={row.title} className="flex items-baseline justify-between gap-2 py-1">
                    <span className="min-w-0">
                      <span className="font-medium">{row.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{row.detail}</span>
                    </span>
                    <span className="num shrink-0 text-[11px]">{formatIDR(row.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-3 py-2">
            <h3 className="mb-1 text-[11px] font-semibold text-muted-foreground">
              Dokumen subledger terbuka terbesar
            </h3>
            {leg.openDocuments.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Tidak ada dokumen terbuka.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {leg.openDocuments.map((row) => (
                  <li key={row.title} className="flex items-baseline justify-between gap-2 py-1">
                    <span className="min-w-0">
                      <span className="font-medium">{row.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{row.detail}</span>
                    </span>
                    <span className="num shrink-0 text-[11px]">{formatIDR(row.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          Buku besar dan subledger selaras per tanggal ini.
          {leg.openDocuments.length > 0
            ? ` Dokumen terbuka terbesar: ${leg.openDocuments
                .slice(0, 3)
                .map((row) => `${row.title} (${formatIDR(row.amount)})`)
                .join(", ")}.`
            : ""}
        </p>
      )}
    </section>
  );
}
