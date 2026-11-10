"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatIDR, formatQty } from "@/lib/money";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { createReturnAction } from "@/server/actions/pos";
import { QtyInput } from "@/components/qty-input";
import { useActionRunner } from "@/components/use-action-runner";

type Line = {
  /** S4: baris penjualan asal — retur ditargetkan per baris ini. */
  saleLineId: string;
  productId: string;
  productName: string;
  /** S4: nama kemasan baris asal (null = satuan dasar); qty, sisa
   * dan harga di bawah sudah dalam bentuk masukannya. */
  packagingName: string | null;
  qty: number;
  remaining: number;
  unitPrice: number;
  lineTotal: number;
};

export function ReturnForm({
  saleId,
  number,
  lines,
  cashSession,
  outstandingReceivable = 0,
}: {
  saleId: string;
  number: string;
  lines: Line[];
  cashSession: { openedAtLabel: string } | null;
  // FIX-P1 (AK2-01/AK4-03): sisa piutang penjualan asal. Bila > 0, nilai
  // retur pertama-tama memotong piutang ini; metode pengembalian di
  // bawah hanya berlaku untuk kelebihannya.
  outstandingReceivable?: number;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [type, setType] = useState<"return" | "exchange">("return");
  const [refundMethod, setRefundMethod] = useState<"cash" | "transfer" | "store_credit" | "exchange">("cash");
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();

  const selected = useMemo(
    () => lines.filter((line) => (qty[line.saleLineId] ?? 0) > 0),
    [lines, qty],
  );
  const estimate = selected.reduce((acc, line) => {
    const take = qty[line.saleLineId] ?? 0;
    return acc + (line.qty > 0 ? (line.lineTotal / line.qty) * take : 0);
  }, 0);
  // Perkiraan rincian penyelesaian: potong piutang dulu, sisanya refund.
  const estimatedOffset = Math.min(estimate, outstandingReceivable);
  const estimatedRefund = Math.max(0, estimate - estimatedOffset);

  async function submit() {
    if (selected.length === 0) {
      toast.error("Pilih minimal satu barang dan jumlah retur.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Alasan retur minimal 3 karakter.");
      return;
    }
    const data = await run(createReturnAction({
      saleId,
      reason,
      refundMethod,
      type,
      // S4: qty dalam bentuk masukan baris asal; server mengonversi
      // dengan faktor cuplikan baris asal, bukan master saat ini.
      lines: selected.map((line) => ({
        saleLineId: line.saleLineId,
        productId: line.productId,
        qty: qty[line.saleLineId],
      })),
    }));
    if (data === null) return;
    toast.success(`Retur ${data.number} tersimpan.`);
    showPostingWarnings(data.warnings);
    router.push("/app/pos/retur");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Form retur · {number}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Stok otomatis kembali ke gudang dan jurnal pembalik dibuat.
        </p>
      </div>

      <div className="divide-y divide-border/70">
        {lines.map((line) => (
          <div key={line.saleLineId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium">
                {line.productName}
                {line.packagingName ? (
                  <span className="ml-1 rounded bg-tone-teal-soft px-1.5 py-0.5 text-[10px] font-medium text-tone-teal">
                    {line.packagingName}
                  </span>
                ) : null}
              </p>
              <p className="num text-[10px] text-muted-foreground">
                {formatIDR(line.unitPrice)}
                {line.packagingName ? ` / ${line.packagingName}` : ""} · sisa {formatQty(line.remaining)}
                {line.packagingName ? ` ${line.packagingName}` : ""} dari {formatQty(line.qty)}
                {line.packagingName ? ` ${line.packagingName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* G2 (FRM-03): QtyInput bersama — penjepitan [0, sisa]
                  yang dulu ditulis tangan di onChange kini prop
                  min/max komponen; state tetap number seperti
                  sebelumnya ("" dari komponen = 0, sama seperti
                  Number("") || 0 lama). */}
              <QtyInput
                value={qty[line.saleLineId] === undefined ? "" : String(qty[line.saleLineId])}
                onChange={(value) =>
                  setQty((current) => ({
                    ...current,
                    [line.saleLineId]: value === "" ? 0 : Number(value),
                  }))
                }
                min="0"
                max={String(line.remaining)}
                placeholder="0"
                aria-label={`Jumlah retur ${line.productName}${line.packagingName ? ` ${line.packagingName}` : ""}`}
                wrapperClassName="w-20 shrink-0"
                className="w-full rounded-md px-2 text-[12px]"
              />
              <button
                type="button"
                onClick={() =>
                  setQty((current) => ({ ...current, [line.saleLineId]: line.remaining }))
                }
                className="h-8 rounded-md border border-border px-2 text-[10px] text-muted-foreground hover:bg-muted"
              >
                Semua
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2.5 border-t border-border p-4">
        {outstandingReceivable > 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
            Penjualan ini masih memiliki piutang sebesar{" "}
            <span className="font-semibold">{formatIDR(outstandingReceivable)}</span>. Nilai retur
            akan <span className="font-semibold">memotong piutang terlebih dahulu</span>; hanya
            kelebihannya di atas sisa piutang yang dikembalikan lewat metode pengembalian di bawah
            — penjualan yang belum lunas tidak mengeluarkan refund melebihi yang sudah diterima.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Jenis</span>
            <select
              value={type}
              onChange={(event) => {
                const next = event.target.value as "return" | "exchange";
                setType(next);
                if (next === "exchange") setRefundMethod("exchange");
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
            >
              <option value="return">Retur dana</option>
              <option value="exchange">Tukar barang</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pengembalian</span>
            <select
              value={refundMethod}
              onChange={(event) => setRefundMethod(event.target.value as typeof refundMethod)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
            >
              <option value="cash">Tunai</option>
              <option value="transfer">Transfer bank</option>
              <option value="store_credit">Kredit toko (kredit pelanggan)</option>
              <option value="exchange">Tukar barang (kredit pelanggan)</option>
            </select>
          </label>
        </div>
        {refundMethod === "cash" && estimatedRefund > 0 ? (
          cashSession ? (
            <p className="text-[11px] text-muted-foreground">
              Refund tunai akan dicatat pada sesi kasir Anda yang sedang terbuka (dibuka{" "}
              {cashSession.openedAtLabel}).
            </p>
          ) : (
            <p className="text-[11px] font-medium text-red-600">
              Belum ada sesi kasir terbuka — buka sesi terlebih dahulu, refund tunai tidak dapat
              diproses tanpa sesi.
            </p>
          )
        ) : null}
        {refundMethod === "cash" && outstandingReceivable > 0 && estimatedRefund <= 0 && selected.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Seluruh nilai retur ini memotong piutang — tidak ada uang tunai yang keluar, jadi sesi
            kasir tidak diperlukan.
          </p>
        ) : null}
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Alasan</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="Contoh: kemasan rusak, salah input, barang tidak sesuai"
            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimasi nilai retur</p>
            <p className="num text-[15px] font-semibold">{formatIDR(estimate)}</p>
            {outstandingReceivable > 0 && selected.length > 0 ? (
              <p className="num text-[11px] text-muted-foreground">
                Potong piutang {formatIDR(estimatedOffset)} · Refund {formatIDR(estimatedRefund)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="h-9 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Memproses…" : "Simpan retur"}
          </button>
        </div>
      </div>
    </div>
  );
}
