/**
 * A-26 Q7 (K-07): pecahan `payment-panel.tsx` per bagian panel
 * pembayaran. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya (pola ARS2-01).
 */
"use client";

import { d, formatIDR } from "@/lib/money";
import type { Method, PaymentEntry } from "@/components/pos/terminal-types";

/**
 * A-21 Tahap R3-A (R3-01): fee/MDR di panel pembayaran. Hanya metode
 * non-tunai berkaki akun yang bisa berfee (tunai masuk laci utuh;
 * utang & kredit retur bukan mutasi bank). Nilai yang tampil adalah
 * bawaan konfigurasi metode sampai kasir mengubahnya — nilai final
 * itulah yang dikirim ke checkout dan dibekukan di sale_payments.
 */
export function methodFeeEligible(method: Method | undefined): boolean {
  return Boolean(
    method &&
      method.type !== "cash" &&
      method.type !== "credit" &&
      method.type !== "customer_credit" &&
      method.feeEnabled &&
      method.feeType &&
      method.feeType !== "none",
  );
}

export function configuredFeeValue(method: Method, base: number): string {
  if (method.feeType === "percent") {
    return d(base).mul(d(method.feeValue ?? 0)).div(100).toDecimalPlaces(2).toString();
  }
  return String(method.feeValue ?? "0");
}

export function FeeEntryField({
  method,
  base,
  entry,
  onFee,
}: {
  method: Method;
  base: number;
  entry: PaymentEntry | undefined;
  onFee: (fee: string) => void;
}) {
  const shown = entry?.fee ?? configuredFeeValue(method, base);
  const net = Math.max(base - Number(shown || 0), 0);
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Biaya (fee/MDR) {method.name} — tarif{" "}
        {method.feeType === "percent" ? `${method.feeValue}%` : formatIDR(method.feeValue ?? 0)}
      </span>
      <input
        value={shown}
        onChange={(event) => onFee(event.target.value)}
        placeholder="0"
        inputMode="numeric"
        aria-label={`Biaya fee pembayaran ${method.name}`}
        className="num h-9 w-full rounded border border-input bg-background px-2 text-[12px]"
      />
      <span className="block text-[10px] text-muted-foreground">
        Yang masuk akun: {formatIDR(net)} (neto sesudah fee).
      </span>
    </label>
  );
}
