"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import { QtyInput } from "@/components/qty-input";
import { OpnamePackagingPopover } from "@/components/gudang/opname-packaging-popover";
import { formatQty } from "@/lib/money";
import {
  effectiveCountedQty,
  formatOpnameCountBreakdown,
  type OpnameCountRow,
} from "@/lib/gudang/opname-count";

const PAGE_SIZE = 50;

/**
 * Tabel lembar hitung opname: satu baris = satu produk. Hitungan
 * kemasan dibuka dari popover "Kemasan" agar kolom Fisik tetap satu
 * tingkat dan tinggi baris konsisten.
 * Dilengkapi pencarian lokal dan paginasi (50 baris per halaman) agar
 * tetap ringan, responsif, dan 60 FPS saat memuat hingga puluhan ribu produk.
 */
export function OpnameCountTable({
  rows,
  showSystem,
  onChangeCounted,
  onChangeComponent,
  onClearComponents,
  onDelete,
}: {
  rows: OpnameCountRow[];
  showSystem: boolean;
  onChangeCounted: (productId: string, value: string) => void;
  onChangeComponent: (productId: string, packagingId: string, value: string) => void;
  onClearComponents: (productId: string) => void;
  onDelete: (productId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const displayedRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {rows.length > 10 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2 text-[12px]">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari dalam tabel hitung…"
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[12px] placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>
              Menampilkan {filtered.length === 0 ? 0 : startIdx + 1}–
              {Math.min(startIdx + PAGE_SIZE, filtered.length)} dari {filtered.length} produk
              {search ? ` (total ${rows.length})` : ""}
            </span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="grid size-7 place-items-center rounded border border-border bg-card hover:bg-muted disabled:opacity-40"
                  aria-label="Halaman sebelumnya"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="px-1 text-[11px] font-semibold text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="grid size-7 place-items-center rounded border border-border bg-card hover:bg-muted disabled:opacity-40"
                  aria-label="Halaman berikutnya"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="max-h-[60vh] overflow-auto">
        <table className="data-table sticky-head w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="text-left">Produk</th>
              {showSystem ? <th className="w-[100px] text-right">Sistem</th> : null}
              <th className="w-[170px] text-right">Fisik</th>
              <th className="w-[120px] text-left">Satuan</th>
              <th className="w-[96px] text-right">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={showSystem ? 6 : 5}
                  className="py-8 text-center text-[12px] text-muted-foreground"
                >
                  {search ? "Tidak ada produk yang cocok dengan pencarian." : "Belum ada produk."}
                </td>
              </tr>
            ) : (
              displayedRows.map((row) => {
                const total = effectiveCountedQty(row);
                const breakdown = formatOpnameCountBreakdown(row);
                return (
                  <tr key={row.productId}>
                    <td className="cell-wrap">
                      <p
                        className="max-w-[360px] truncate text-[12px] font-medium"
                        title={row.name}
                      >
                        {row.name}
                      </p>
                      <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                    </td>
                    {showSystem ? (
                      <td className="num text-right text-[12px] text-muted-foreground">
                        {formatQty(row.system)}
                      </td>
                    ) : null}
                    <td>
                      <div className="flex justify-end">
                        <QtyInput
                          value={row.counted}
                          onChange={(value) => onChangeCounted(row.productId, value)}
                          min="0"
                          placeholder="—"
                          aria-label={`Fisik ${row.name}`}
                          wrapperClassName="w-32"
                          className="h-8 w-full rounded px-1.5 text-[12px]"
                        />
                      </div>
                      {breakdown ? (
                        <p className="num mt-1 text-right text-[10px] text-muted-foreground">
                          {breakdown}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <span>{row.unitName ?? "—"}</span>
                        {row.packagings && row.packagings.length > 0 ? (
                          <OpnamePackagingPopover
                            row={row}
                            onChange={(packagingId, value) =>
                              onChangeComponent(row.productId, packagingId, value)
                            }
                            onClear={() => onClearComponents(row.productId)}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="num text-right text-[12px] font-medium">
                      {total === null ? (
                        <span className="text-muted-foreground/50">—</span>
                      ) : (
                        formatQty(total)
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onDelete(row.productId)}
                        className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Hapus ${row.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
