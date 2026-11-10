"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
} from "lucide-react";
import { formatIDRReport, formatQty } from "@/lib/money";
import type { OpnameCountSummary } from "@/lib/gudang/opname-count";

export type OpnameReviewFilter = "all" | "diff" | "match";

function byProductName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, "id", { numeric: true, sensitivity: "base" });
}

/**
 * Langkah tinjau opname: ringkasan hasil, filter selisih/cocok, dan
 * konfirmasi posting. Hanya baris yang benar-benar dihitung yang
 * ditampilkan; baris belum dihitung tetap dihitung di peringatan agar
 * tidak diam-diam dianggap nol.
 */
export function OpnameReviewPanel({
  summary,
  showValues,
  filter,
  onFilterChange,
  confirmed,
  onConfirmedChange,
  busy,
  onBack,
  onSubmit,
}: {
  summary: OpnameCountSummary;
  showValues: boolean;
  filter: OpnameReviewFilter;
  onFilterChange: (filter: OpnameReviewFilter) => void;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const countedRows = useMemo(
    () => summary.reviewRows.filter((row) => row.countedQty !== null).sort(byProductName),
    [summary],
  );
  const rows = useMemo(() => {
    if (filter === "diff") return countedRows.filter((row) => row.diff !== 0);
    if (filter === "match") return countedRows.filter((row) => row.diff === 0);
    return countedRows;
  }, [countedRows, filter]);

  const filters: { key: OpnameReviewFilter; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: summary.countedCount },
    { key: "diff", label: "Selisih", count: summary.diffCount },
    { key: "match", label: "Cocok", count: summary.matchCount },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-4">
        <div className="bg-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Dihitung
          </p>
          <p className="num mt-1 text-[15px] font-semibold">{summary.countedCount}</p>
        </div>
        <div className="bg-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Selisih
          </p>
          <p
            className={`num mt-1 text-[15px] font-semibold ${
              summary.diffCount > 0 ? "text-tone-amber" : ""
            }`}
          >
            {summary.diffCount}
          </p>
        </div>
        <div className="bg-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cocok
          </p>
          <p className="num mt-1 text-[15px] font-semibold">{summary.matchCount}</p>
        </div>
        <div className="bg-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {showValues ? "Total nilai selisih" : "Belum dihitung"}
          </p>
          <p className="num mt-1 text-[15px] font-semibold">
            {showValues ? formatIDRReport(summary.totalAbsValue ?? 0, { symbol: false }) : summary.uncountedCount}
          </p>
        </div>
      </div>

      {summary.uncountedCount > 0 ? (
        <div className="flex items-start gap-2 border-b border-border bg-tone-amber-soft/50 px-4 py-2.5 text-[11px] leading-5 text-tone-amber">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p>
            <span className="font-semibold">{summary.uncountedCount} produk belum dihitung.</span>{" "}
            Baris tersebut tidak ikut posting — bukan dianggap nol.
          </p>
        </div>
      ) : null}

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] font-semibold">Hasil pemeriksaan</p>
            <p className="text-[11px] text-muted-foreground">
              Fokus pada baris yang selisih, lalu konfirmasi posting.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilterChange(item.key)}
                aria-pressed={filter === item.key}
                className={
                  filter === item.key
                    ? "inline-flex h-7 items-center gap-1 rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background"
                    : "inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                }
              >
                {item.label}
                <span className="num opacity-70">{item.count}</span>
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
            {filter === "diff" && summary.diffCount === 0 ? (
              <>
                <CheckCircle2 className="mx-auto size-6 text-tone-green" />
                <p className="mt-2 text-[12px] font-medium">Tidak ada selisih</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Semua hasil hitung cocok dengan stok sistem.
                </p>
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Tidak ada baris pada filter ini.</p>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="max-h-[55vh] overflow-auto">
              <table className="data-table sticky-head w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className="text-left">Produk</th>
                    <th className="w-[104px] text-right">Sistem</th>
                    <th className="w-[160px] text-right">Fisik</th>
                    <th className="w-[84px] text-left">Satuan</th>
                    <th className="w-[104px] text-right">Selisih</th>
                    {showValues ? (
                      <th className="w-[130px] text-right">Nilai selisih</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const hasDiff = row.diff !== null && row.diff !== 0;
                    return (
                      <tr key={row.productId} className={hasDiff ? "bg-tone-amber-soft/25" : ""}>
                        <td className="cell-wrap">
                          <p
                            className="max-w-[360px] truncate text-[12px] font-medium"
                            title={row.name}
                          >
                            {row.name}
                          </p>
                          <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                        </td>
                        <td className="num text-right text-[12px] text-muted-foreground">
                          {formatQty(row.system)}
                        </td>
                        <td className="text-right">
                          <p className="num text-[12px]">{formatQty(row.countedQty ?? 0)}</p>
                          {row.breakdown ? (
                            <p className="num mt-0.5 text-[10px] text-muted-foreground">
                              {row.breakdown}
                            </p>
                          ) : null}
                        </td>
                        <td className="text-[12px] text-muted-foreground">
                          {row.unitName ?? "—"}
                        </td>
                        <td
                          className={`num text-right text-[12px] font-medium ${
                            row.diff === null || row.diff === 0
                              ? "text-muted-foreground"
                              : row.diff < 0
                                ? "text-destructive"
                                : "text-tone-green"
                          }`}
                        >
                          {row.diff === null
                            ? "—"
                            : `${row.diff > 0 ? "+" : ""}${formatQty(row.diff)}`}
                        </td>
                        {showValues ? (
                          <td className="num text-right text-[12px]">
                            {row.diffValue === null || row.diff === 0
                              ? "—"
                              : formatIDRReport(row.diffValue, { symbol: false })}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmedChange(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span className="text-[12px] leading-5">
              <span className="block font-medium">
                Saya sudah memeriksa hasil hitung dan selisihnya.
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Posting akan menyesuaikan stok {summary.countedCount} produk yang dihitung.
                {summary.uncountedCount > 0
                  ? ` ${summary.uncountedCount} produk yang belum dihitung tidak diubah.`
                  : " Semua produk di lembar ini sudah dihitung."}
              </span>
            </span>
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <ArrowLeft className="size-3.5" /> Kembali menghitung
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={busy || !confirmed || summary.countedCount === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <ClipboardCheck className="size-3.5" />{" "}
              {busy ? "Memposting…" : "Posting opname"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
