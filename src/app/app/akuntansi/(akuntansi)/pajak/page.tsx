import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { getVatReport } from "@/server/reports";
import { formatIDR } from "@/lib/money";
import { formatDate, journalSourceLabel, monthStartISO, todayISO } from "@/lib/format";
import { addDaysISO } from "@/lib/due-date";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Pajak (PPN)" };
export const dynamic = "force-dynamic";

function amountTone(value: number) {
  return value > 0 ? "text-destructive" : value < 0 ? "text-tone-green" : undefined;
}

export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const today = todayISO();
  const isoDate = (value: string | undefined) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  let from = isoDate(params.from) ?? monthStartISO();
  let to = isoDate(params.to) ?? today;
  if (from > to) [from, to] = [to, from];

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getVatReport(tx, ctx.company.id, { from, to }),
  );

  const presets = [
    { label: "Bulan ini", from: monthStartISO(), to: today },
    {
      label: "Bulan lalu",
      from: `${addDaysISO(monthStartISO(), -1).slice(0, 7)}-01`,
      to: addDaysISO(monthStartISO(), -1),
    },
    { label: "Tahun ini", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const activePreset = presets.find((preset) => preset.from === from && preset.to === to);
  const exportQuery = `from=${from}&to=${to}`;

  return (
    <div>
      <PageHeader
        title="Pajak (PPN)"
        description="Buku PPN Keluaran dan PPN Masukan dari jurnal yang telah diposting. Angka mengikuti akun pemetaan pajak, bukan hitung ulang tarif."
        actions={
          <>
            <div className="flex items-center overflow-hidden rounded-md border border-border bg-card">
              <Link
                href={`/api/export/report?type=ppn&${exportQuery}`}
                className="inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                <Download className="size-3.5" /> CSV
              </Link>
              <span aria-hidden className="h-4 w-px bg-border" />
              <Link
                href={`/api/export/report?type=ppn&${exportQuery}&format=xlsx`}
                className="inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                <Download className="size-3.5" /> Excel
              </Link>
            </div>
            <Link
              href={`/app/akuntansi/pajak/cetak?${exportQuery}&autoprint=1`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Printer className="size-3.5" /> Cetak
            </Link>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">Periode</span>
          {presets.map((preset) => (
            <Link
              key={preset.label}
              href={`/app/akuntansi/pajak?from=${preset.from}&to=${preset.to}`}
              className={
                activePreset?.label === preset.label
                  ? "inline-flex h-7 items-center rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background"
                  : "inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              }
            >
              {preset.label}
            </Link>
          ))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {formatDate(from)} — {formatDate(to)}
          </span>
        </div>
        <form action="/app/akuntansi/pajak" className="flex flex-wrap items-center gap-1.5">
          <DateRangeField
            from={{ name: "from", defaultValue: from }}
            to={{ name: "to", defaultValue: to }}
          />
          <button
            type="submit"
            className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            Terapkan
          </button>
        </form>
      </div>

      {!data.mapped ? (
        <EmptyState
          title="Akun pajak belum dipetakan"
          description="Petakan akun PPN Keluaran (tax_output) dan PPN Masukan (tax_input) di Pengaturan → Pemetaan akun agar buku PPN dapat dihitung."
          action={
            <Link
              href="/app/pengaturan?tab=akun"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Buka pemetaan akun
            </Link>
          }
        />
      ) : (
        <>
          <SummaryStrip
            items={[
              {
                label: "PPN Keluaran",
                value: formatIDR(data.output),
                hint: data.outputAccount
                  ? `${data.outputAccount.code} · ${data.outputAccount.name}`
                  : "Akun belum dipetakan",
                tone: "default",
              },
              {
                label: "PPN Masukan",
                value: formatIDR(data.input),
                hint: data.inputAccount
                  ? `${data.inputAccount.code} · ${data.inputAccount.name}`
                  : "Akun belum dipetakan",
                tone: "default",
              },
              {
                label: data.net > 0 ? "PPN kurang bayar" : data.net < 0 ? "PPN lebih bayar" : "PPN neto",
                value: formatIDR(Math.abs(data.net)),
                hint:
                  data.net > 0
                    ? "Keluaran lebih besar dari masukan"
                    : data.net < 0
                      ? "Masukan lebih besar dari keluaran"
                      : "Keluaran dan masukan seimbang",
                tone: data.net > 0 ? "amber" : data.net < 0 ? "green" : "muted",
              },
              {
                label: "Jurnal PPN",
                value: data.entryCount,
                hint: `${data.lines.length} baris pajak pada periode ini`,
              },
            ]}
          />

          {!data.outputAccount || !data.inputAccount ? (
            <div className="mt-3 rounded-lg border border-tone-amber/30 bg-tone-amber-soft px-4 py-2.5 text-[11px] leading-4 text-tone-amber">
              Salah satu akun pajak belum dipetakan. Lengkapi pemetaan PPN Keluaran dan PPN Masukan agar laporan
              tidak menampilkan angka sebelah.
            </div>
          ) : null}

          <div className="mt-4">
            <DataList
              density="compact"
              isEmpty={data.lines.length === 0}
              empty={
                <EmptyState
                  size="compact"
                  title="Belum ada mutasi PPN"
                  description="Jurnal yang menyentuh akun PPN Keluaran atau PPN Masukan akan tampil di sini."
                />
              }
              footerNote="DPP dan faktur pajak tetap berada di dokumen sumber (POS, penerimaan, beban, klaim). Buku PPN ini adalah rekonsiliasi tingkat buku besar; tarif dan DPP tidak dihitung ulang di sini."
            >
              <div className="overflow-x-auto">
                <table className="data-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Jurnal</th>
                      <th>Sumber</th>
                      <th>Keterangan</th>
                      <th className="text-right">PPN Masukan</th>
                      <th className="text-right">PPN Keluaran</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((row) => (
                      <tr key={row.id}>
                        <td className="num whitespace-nowrap text-[12px] text-muted-foreground">
                          {formatDate(row.date)}
                        </td>
                        <td>
                          <Link
                            href={`/app/akuntansi/jurnal/${row.entryId}`}
                            className="num text-[12px] font-medium text-primary hover:underline"
                          >
                            {row.number}
                          </Link>
                        </td>
                        <td className="text-[11px] text-muted-foreground">
                          {journalSourceLabel(row.sourceType)}
                        </td>
                        <td className="max-w-[360px] truncate text-[12px]">
                          {row.description || "—"}
                        </td>
                        <td className="num text-right text-[12px]">
                          {row.direction === "input" ? formatIDR(row.amount) : "—"}
                        </td>
                        <td className="num text-right text-[12px]">
                          {row.direction === "output" ? formatIDR(row.amount) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/40 font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                        Total
                      </td>
                      <td className="num px-3 py-2 text-right text-[12px]">{formatIDR(data.input)}</td>
                      <td className="num px-3 py-2 text-right text-[12px]">{formatIDR(data.output)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-[11px] text-muted-foreground">
                        {data.net > 0 ? "PPN kurang bayar" : data.net < 0 ? "PPN lebih bayar" : "PPN neto"}
                      </td>
                      <td colSpan={2} className={`num px-3 py-2 text-right text-[12px] font-semibold ${amountTone(data.net)}`}>
                        {formatIDR(Math.abs(data.net))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </DataList>
          </div>
        </>
      )}
    </div>
  );
}
