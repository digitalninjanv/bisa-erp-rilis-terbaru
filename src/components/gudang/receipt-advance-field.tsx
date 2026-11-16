"use client";

import { useEffect, useState } from "react";
import { listSupplierPurchaseAdvancesAction } from "@/server/actions/inventory/uang-muka";
import { d, formatIDR, toDb } from "@/lib/money";

/**
 * Pemakaian uang muka/DP pemasok pada penerimaan barang. Saldo diambil
 * ulang saat pemasok berubah; potongan dihitung otomatis sampai total
 * tagihan (FIFO di server). Disembunyikan bila tidak ada saldo terbuka.
 */
export function ReceiptAdvanceField({
  supplierId,
  isPurchase,
  grandTotal,
  onAppliedChange,
  onAvailableChange,
}: {
  supplierId: string;
  isPurchase: boolean;
  grandTotal: string;
  onAppliedChange: (value: string) => void;
  onAvailableChange?: (available: boolean) => void;
}) {
  const [rows, setRows] = useState<{ remainingAmount: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [useAdvance, setUseAdvance] = useState(false);

  // Komponen di-remount oleh parent saat pemasok/sumber berganti, jadi
  // state di sini selalu bersih; effect hanya mengambil saldo.
  useEffect(() => {
    let cancelled = false;
    if (!isPurchase || !supplierId) {
      onAvailableChange?.(false);
      return;
    }
    void listSupplierPurchaseAdvancesAction({ supplierId })
      .then((result) => {
        if (cancelled) return;
        setLoading(false);
        const nextRows = result.ok ? result.data : [];
        setRows(nextRows);
        const hasAvailable = nextRows.some((row) => d(row.remainingAmount).gt(0));
        onAvailableChange?.(hasAvailable);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          onAvailableChange?.(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId, isPurchase, onAvailableChange]);

  const available = rows.reduce((acc, row) => acc.plus(d(row.remainingAmount)), d(0));
  const total = d(grandTotal);
  const applied = useAdvance ? (available.lt(total) ? available : total) : d(0);
  const appliedText = toDb(applied);

  useEffect(() => {
    onAppliedChange(appliedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedText]);

  if (!isPurchase || !supplierId || (!loading && available.lte(0))) return null;

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <label className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] font-medium">
          <input
            type="checkbox"
            checked={useAdvance}
            disabled={loading || available.lte(0)}
            onChange={(event) => setUseAdvance(event.target.checked)}
            className="size-4"
          />
          Gunakan uang muka pemasok
        </span>
        <span className="num text-[10px] text-muted-foreground">
          {loading
            ? "Memuat uang muka…"
            : `Tersedia ${formatIDR(available)} · ${rows.length} dokumen`}
        </span>
      </label>
      {useAdvance && applied.gt(0) ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Dipakai {formatIDR(applied)} · sisa tagihan {formatIDR(total.minus(applied))}.
          Pemotongan FIFO dari uang muka terlama.
        </p>
      ) : null}
    </div>
  );
}
