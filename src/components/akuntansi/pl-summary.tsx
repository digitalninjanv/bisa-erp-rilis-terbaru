import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatIDRReport } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/blocks/empty-state";

export type ProfitLossRow = {
  key: string;
  label: string;
  hint?: string;
  amount: number;
  percent: number | null;
  priorAmount?: number;
  emphasis?: boolean;
  indent?: boolean;
  tone?: "default" | "green" | "red" | "amber";
  increaseIsGood?: boolean;
};

export type ExpenseAccountRow = {
  accountId: string;
  code: string;
  name: string;
  amount: number;
};

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}%`;
}

function change(current: number, prior: number | undefined): number | null {
  if (prior === undefined || Math.abs(prior) < 0.005) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function Delta({
  current,
  prior,
  increaseIsGood,
}: {
  current: number;
  prior?: number;
  increaseIsGood: boolean;
}) {
  const value = change(current, prior);
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const better = increaseIsGood ? value >= 0 : value <= 0;
  return (
    <span className={cn("num", better ? "text-tone-green" : "text-destructive")}>
      {value >= 0 ? "+" : ""}
      {new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}%
    </span>
  );
}

/**
 * Laporan laba rugi ringkas ala dashboard keuangan: baris pendapatan →
 * HPP → laba kotor → beban → laba operasi → laba bersih. Angka negatif
 * memakai kurung akuntansi; persentase selalu terhadap pendapatan neto.
 */
export function ProfitLossStatement({
  periodLabel,
  compareLabel,
  rows,
  showComparison,
  warning,
  reportHref,
}: {
  periodLabel: string;
  compareLabel: string;
  rows: ProfitLossRow[];
  showComparison: boolean;
  warning?: string | null;
  reportHref: string;
}) {
  const hasActivity = rows.some((row) => Math.abs(row.amount) >= 0.005);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Laba rugi</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {periodLabel} · {compareLabel}
          </p>
        </div>
        <Link
          href={reportHref}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline"
        >
          Laporan laba rugi <ArrowRight className="size-3" />
        </Link>
      </div>

      {warning ? (
        <div className="border-b border-tone-amber/25 bg-tone-amber-soft px-4 py-2 text-[11px] leading-4 text-tone-amber">
          {warning}
        </div>
      ) : null}

      {!hasActivity ? (
        <div className="p-3">
          <EmptyState
            size="compact"
            title="Belum ada transaksi pada periode ini"
            description="Pendapatan, harga pokok, dan beban akan tampil setelah jurnal diposting."
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-1.5 text-left font-semibold">Komponen</th>
              <th className="px-4 py-1.5 text-right font-semibold">Jumlah</th>
              <th className="hidden px-4 py-1.5 text-right font-semibold sm:table-cell">
                % pendapatan
              </th>
              {showComparison ? (
                <th className="hidden px-4 py-1.5 text-right font-semibold md:table-cell">
                  Δ {compareLabel}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={cn(
                  "border-t border-border/70",
                  row.emphasis && "bg-muted/25",
                  row.tone === "amber" && "bg-tone-amber-soft/30",
                )}
              >
                <td
                  className={cn(
                    "px-4 py-2.5 text-[12px]",
                    row.indent && "pl-8",
                    row.emphasis && "font-semibold",
                  )}
                >
                  {row.label}
                  {row.hint ? (
                    <span className="mt-0.5 block text-[10px] font-normal leading-4 text-muted-foreground">
                      {row.hint}
                    </span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    "num whitespace-nowrap px-4 py-2.5 text-right text-[12px]",
                    row.emphasis && "font-semibold",
                    row.tone === "green" && "text-tone-green",
                    row.tone === "red" && "text-destructive",
                    row.tone === "amber" && "text-tone-amber",
                  )}
                >
                  {formatIDRReport(row.amount)}
                </td>
                <td className="num hidden px-4 py-2.5 text-right text-[11px] text-muted-foreground sm:table-cell">
                  {percent(row.percent)}
                </td>
                {showComparison ? (
                  <td className="hidden px-4 py-2.5 text-right text-[11px] md:table-cell">
                    <Delta
                      current={row.amount}
                      prior={row.priorAmount}
                      increaseIsGood={row.increaseIsGood ?? true}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-border px-4 py-2 text-[10px] leading-4 text-muted-foreground">
        Persentase dihitung dari pendapatan neto. Angka dalam tanda kurung adalah pengurang.
      </p>
        </>
      )}
    </section>
  );
}

/**
 * Beban per akun: daftar akun dengan nilai absolut terbesar, bukan pie
 * chart. Batang tipis hanya menjadi pembanding panjang antar-akun.
 */
export function ExpenseBreakdown({
  rows,
  periodLabel,
  reportHref,
}: {
  rows: ExpenseAccountRow[];
  periodLabel: string;
  reportHref: string;
}) {
  const visible = [...rows]
    .filter((row) => Math.abs(row.amount) >= 0.005)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5);
  const max = visible.reduce((acc, row) => Math.max(acc, Math.abs(row.amount)), 0);
  const totalAbs = rows.reduce((acc, row) => acc + Math.abs(row.amount), 0);
  const net = rows.reduce((acc, row) => acc + row.amount, 0);
  const negativeCount = rows.filter((row) => row.amount < 0).length;

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Beban per akun</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {periodLabel} · <span className={cn(net < 0 && "text-tone-amber")}>{formatIDRReport(net)}</span> neto
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="p-3">
          <EmptyState
            size="compact"
            title="Belum ada beban"
            description="Beban operasional yang tercatat akan muncul di sini."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border/70">
          {visible.map((row) => {
            const share = totalAbs > 0 ? (Math.abs(row.amount) / totalAbs) * 100 : 0;
            return (
              <li key={row.accountId} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">{row.name}</p>
                    <p className="num mt-0.5 text-[10px] text-muted-foreground">{row.code}</p>
                  </div>
                  <span className="num shrink-0 text-[12px] font-medium">
                    {formatIDRReport(row.amount)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.amount < 0 ? "bg-tone-amber" : "bg-primary/60",
                    )}
                    style={{ width: `${max > 0 ? Math.min(100, (Math.abs(row.amount) / max) * 100) : 0}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {percent(share)} dari total nilai beban
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {negativeCount > 0 ? (
        <p className="border-t border-border px-4 py-2.5 text-[10px] leading-4 text-tone-amber">
          {negativeCount} akun beban bersaldo kredit.
        </p>
      ) : null}

      <div className="mt-auto border-t border-border px-4 py-2.5">
        <Link
          href={reportHref}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:underline"
        >
          Lihat rincian beban <ArrowRight className="size-3" />
        </Link>
      </div>
    </section>
  );
}
