"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatIDR, formatQty } from "@/lib/money";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { createReturnAction } from "@/server/actions/pos";
import { newUuid } from "@/lib/uuid";
import { QtyInput } from "@/components/qty-input";
import { useActionRunner } from "@/components/use-action-runner";

const REASON_PRESETS = [
  "Kemasan rusak",
  "Barang tidak sesuai",
  "Salah input",
  "Kedaluwarsa",
  "Tidak jadi membeli",
] as const;

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
  const operationKey = useRef<string | null>(null);
  const [disposition, setDisposition] = useState<"sellable" | "write_off">("sellable");
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
  const selectedCount = selected.length;
  const reasonValid = reason.trim().length >= 3;
  const cashBlocked =
    type === "return" && refundMethod === "cash" && estimatedRefund > 0 && !cashSession;
  const canSubmit = !busy && selectedCount > 0 && reasonValid && !cashBlocked;

  async function submit() {
    if (selected.length === 0) {
      toast.error("Pilih minimal satu barang dan jumlah retur.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Alasan retur minimal 3 karakter.");
      return;
    }
    const pendingKey = `bisa-erp:return:${saleId}`;
    const fingerprint = JSON.stringify({ qty, reason, type, refundMethod, disposition });
    try {
      const stored = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
      operationKey.current = stored?.fingerprint === fingerprint && typeof stored?.key === "string" ? stored.key : newUuid();
      sessionStorage.setItem(pendingKey, JSON.stringify({ key: operationKey.current, fingerprint }));
    } catch {
      operationKey.current ??= newUuid();
    }
    const idempotencyKey = operationKey.current ??= newUuid();
    const data = await run(createReturnAction({
      idempotencyKey,
      disposition,
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
    try { sessionStorage.removeItem(pendingKey); } catch { /* storage may be unavailable */ }
    operationKey.current = null;
    toast.success(`Retur ${data.number} tersimpan.`);
    showPostingWarnings(data.warnings);
    router.push("/app/pos/retur");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[13px] font-semibold">Form retur · {number}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Stok otomatis kembali ke gudang dan jurnal pembalik dibuat.
            </p>
          </div>
          <span className="num rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {selectedCount} baris dipilih
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div>
          <p className="text-[12px] font-semibold">1 · Barang yang diretur</p>
          <p className="text-[10px] text-muted-foreground">
            Isi qty 0 untuk barang yang tidak diretur. Maksimum mengikuti sisa yang dapat diretur.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setQty(
                Object.fromEntries(lines.map((line) => [line.saleLineId, line.remaining])),
              )
            }
            className="h-7 rounded-md border border-border px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted"
          >
            Pilih semua
          </button>
          <button
            type="button"
            onClick={() => setQty({})}
            className="h-7 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted"
          >
            Kosongkan
          </button>
        </div>
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
        <label className="block space-y-1">
          <span className="text-[12px] font-medium">Kondisi dan penanganan barang</span>
          <select aria-label="Kondisi dan penanganan barang" value={disposition}
            onChange={(event) => setDisposition(event.target.value as typeof disposition)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]">
            <option value="sellable">Layak jual — kembalikan ke stok</option>
            <option value="write_off">Rusak / kedaluwarsa — tidak masuk stok, catat beban</option>
          </select>
          <p className="text-[11px] text-muted-foreground">Berlaku untuk seluruh barang pada retur ini. Pisahkan retur jika kondisi barang berbeda.</p>
        </label>
        <div className="border-t border-border pt-3">
          <p className="text-[12px] font-semibold">3 · Penyelesaian</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Pilih jenis retur dan tujuan pengembalian dana.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Jenis</span>
            <select
              value={type}
              onChange={(event) => {
                const next = event.target.value as "return" | "exchange";
                setType(next);
                setRefundMethod(next === "exchange" ? "exchange" : "cash");
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
              disabled={type === "exchange"}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px] disabled:opacity-60"
            >
              {type === "exchange" ? (
                <option value="exchange">Tukar barang (kredit pelanggan)</option>
              ) : (
                <>
                  <option value="cash">Tunai</option>
                  <option value="transfer">Transfer bank</option>
                  <option value="store_credit">Kredit toko (kredit pelanggan)</option>
                </>
              )}
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
            <p className="text-[11px] font-medium text-destructive">
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
        <div className="border-t border-border pt-3">
          <p className="text-[12px] font-semibold">2 · Alasan retur</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Pilih alasan umum atau tulis detailnya. Alasan wajib diisi minimal 3 karakter.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                aria-pressed={reason === preset}
                className={
                  reason === preset
                    ? "h-7 rounded-full bg-foreground px-2.5 text-[10px] font-medium text-background"
                    : "h-7 rounded-full border border-border bg-card px-2.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              >
                {preset}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="Contoh: kemasan rusak, salah input, barang tidak sesuai"
            aria-label="Alasan retur"
            className="mt-2 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring"
          />
        </div>
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Estimasi nilai retur · {selectedCount} baris
            </p>
            <p className="num text-[15px] font-semibold">{formatIDR(estimate)}</p>
            {outstandingReceivable > 0 && selectedCount > 0 ? (
              <p className="num text-[11px] text-muted-foreground">
                Potong piutang {formatIDR(estimatedOffset)} · Refund {formatIDR(estimatedRefund)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="h-9 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Memproses…" : "Simpan retur"}
          </button>
        </div>
      </div>
    </div>
  );
}
