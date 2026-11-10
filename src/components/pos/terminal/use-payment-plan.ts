/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — hook rencana pembayaran
 * (simulasi campuran, dibayar/kembalian/sisa, gerbang utang &
 * konfirmasi non-tunai). Rumus identik dengan berkas asal.
 */
"use client";

import { useMemo } from "react";
import type { Method, PaymentEntry } from "@/components/pos/terminal-types";

export function usePaymentPlan(params: {
  mode: "single" | "mixed";
  entries: Record<string, PaymentEntry>;
  methodById: Map<string, Method>;
  total: number;
  singleMethod: string;
  single: Method | undefined;
  isCreditSingle: boolean;
  cashTendered: number;
  debtMethod: { id: string; name: string } | null;
}) {
  const { mode, entries, methodById, total, singleMethod, single, isCreditSingle, cashTendered, debtMethod } = params;

  // POS-PAY-02: mode campuran disimulasikan persis seperti alokasi
  // server — pembayaran diterapkan berurutan ke sisa tagihan, dan
  // kembalian HANYA berasal dari kelebihan uang diterima (tendered)
  // metode tunai. Kelebihan nominal non-tunai bukan kembalian (server
  // menolaknya); ia ditampilkan sebagai peringatan.
  const mixedPlan = useMemo(() => {
    let remaining = total;
    let appliedTotal = 0;
    let changeTotal = 0;
    const overpaid: string[] = [];
    if (mode === "mixed") {
      for (const [methodId, entry] of Object.entries(entries)) {
        const amount = Number(entry.amount || 0);
        if (amount <= 0) continue;
        const method = methodById.get(methodId);
        if (!method) continue;
        const applied = Math.min(amount, remaining);
        appliedTotal += applied;
        if (method.type === "cash") {
          const tendered = Number(entry.tendered || amount);
          changeTotal += Math.max(0, tendered - applied);
        } else if (method.type !== "credit" && amount > remaining) {
          overpaid.push(method.name);
        }
        remaining -= applied;
      }
    }
    return { appliedTotal, changeTotal, overpaid };
  }, [mode, entries, methodById, total]);

  const paidAmount = useMemo(() => {
    if (mode === "single") {
      if (isCreditSingle) return total;
      return Math.min(Number(entries[singleMethod]?.amount || total), total);
    }
    return mixedPlan.appliedTotal;
  }, [mode, entries, singleMethod, total, isCreditSingle, mixedPlan]);

  const change = useMemo(() => {
    if (mode === "single") {
      // Kembalian hanya dari tunai; metode lain tidak memberi kembalian.
      return single?.type === "cash" ? Math.max(0, cashTendered - total) : 0;
    }
    return mixedPlan.changeTotal;
  }, [mode, single, cashTendered, total, mixedPlan]);

  const outstanding = Math.max(0, total - paidAmount);

  // A-28 UI-1 (UX-B07): mode campuran dengan sisa belum tertutup
  // memblokir tombol Bayar SEJAK AWAL (bukan penolakan sesudah klik).
  // Satu-satunya sisa yang sah dibiarkan terbuka adalah sisa yang
  // dialokasikan server ke metode kredit — cermin persis gerbang
  // checkout pada use-terminal-checkout (baris utang bernominal > 0).
  const mixedShortfall =
    mode === "mixed" &&
    outstanding > 0 &&
    !Object.entries(entries).some(
      ([methodId, entry]) =>
        Number(entry.amount) > 0 && methodById.get(methodId)?.type === "credit",
    );

  // POS-1 (D-19): penjualan mengandung utang bila metode kredit dipilih
  // sebagai metode tunggal, atau baris utang pada mode campuran
  // bernominal > 0. Panel pelanggan & jatuh tempo wajib mengikuti.
  const debtEntryAmount = debtMethod ? Number(entries[debtMethod.id]?.amount ?? 0) : 0;
  const debtActive = Boolean(
    debtMethod &&
      ((mode === "single" && isCreditSingle) || (mode === "mixed" && debtEntryAmount > 0)),
  );
  // Nominal utang efektif: tunggal = seluruh tagihan; campuran = baris
  // utang (dijepit ke total, seperti pemotongan server) ditambah sisa
  // tagihan yang dialokasikan server ke piutang.
  const debtAmount = !debtActive
    ? 0
    : mode === "single"
      ? total
      : Math.min(debtEntryAmount, total) + outstanding;

  // POS2-05: metode tunggal non-tunai (QRIS/bank) mewajibkan
  // konfirmasi penerimaan sebelum Bayar aktif; metode kredit (utang)
  // mempunyai gerbangnya sendiri (pelanggan + jatuh tempo).
  const nonCashNeedsConfirm = Boolean(
    mode === "single" && single && single.type !== "cash" && single.type !== "credit",
  );

  return { mixedPlan, paidAmount, change, outstanding, mixedShortfall, debtEntryAmount, debtActive, debtAmount, nonCashNeedsConfirm };
}
