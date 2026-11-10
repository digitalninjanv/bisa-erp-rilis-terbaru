"use client";

import { Trash2 } from "lucide-react";
import { QtyInput } from "@/components/qty-input";
import { OpnamePackagingPopover } from "@/components/gudang/opname-packaging-popover";
import { formatQty } from "@/lib/money";
import {
  effectiveCountedQty,
  formatOpnameCountBreakdown,
  type OpnameCountRow,
} from "@/lib/gudang/opname-count";

/**
 * Tabel lembar hitung opname: satu baris = satu produk. Hitungan
 * kemasan dibuka dari popover "Kemasan" agar kolom Fisik tetap satu
 * tingkat dan tinggi baris konsisten.
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
  return (
    <div className="overflow-hidden rounded-lg border border-border">
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
            {rows.map((row) => {
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
