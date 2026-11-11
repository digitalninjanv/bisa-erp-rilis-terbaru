"use client";

import { useState } from "react";
import { newUuid } from "@/lib/uuid";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { createTransferAction } from "@/server/actions/inventory/transfer";
import { LineEditor, type DocLine } from "@/components/gudang/line-editor";
import { DateField } from "@/components/date-field";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";

export function TransferForm({
  warehouses,
  defaultWarehouseId,
  today,
}: {
  warehouses: { id: string; name: string }[];
  defaultWarehouseId?: string;
  today: string;
}) {
  const router = useRouter();
  const initialFrom = defaultWarehouseId || warehouses[0]?.id || "";
  const [fromWarehouseId, setFrom] = useState(initialFrom);
  const [toWarehouseId, setTo] = useState(
    () => warehouses.find((w) => w.id !== initialFrom)?.id ?? initialFrom,
  );
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocLine[]>([]);
  const [busy, setBusy] = useState(false);
  // GDG3-06: kunci idempotensi per pembukaan form (lihat receipt-form).
  const [idempotencyKey, setIdempotencyKey] = useState(() => newUuid());

  async function submit() {
    if (fromWarehouseId === toWarehouseId) {
      toast.error("Gudang asal dan tujuan harus berbeda.");
      return;
    }
    if (lines.length === 0) {
      toast.error("Tambahkan minimal satu produk.");
      return;
    }
    setBusy(true);
    const result = await createTransferAction({
      fromWarehouseId,
      toWarehouseId,
      idempotencyKey,
      date,
      notes: notes || undefined,
      lines: lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        // Satuan Kemasan S3: satuan baris terpilih (kosong = dasar).
        packagingId: line.packagingId || null,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Transfer stok tersimpan.");
    setIdempotencyKey(newUuid());
    setLines([]);
    setNotes("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Transfer antar gudang</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Stok keluar dari gudang asal dan masuk ke tujuan dalam satu transaksi.</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className={labelClass}>Dari gudang</span>
            <select value={fromWarehouseId} onChange={(event) => setFrom(event.target.value)} className={fieldClass}>
              {warehouses.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Ke gudang</span>
            <select value={toWarehouseId} onChange={(event) => setTo(event.target.value)} className={fieldClass}>
              {warehouses.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Tanggal</span>
            {/* A-25 U3: DateField bersama (dd/mm/yyyy selalu, POLA-03). */}
            <DateField value={date} onChange={setDate} aria-label="Tanggal transfer" />
          </label>
        </div>

        <LineEditor lines={lines} onChange={setLines} mode="transfer" warehouseId={fromWarehouseId} />

        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="min-w-[220px] flex-1 space-y-1">
            <span className={labelClass}>Catatan</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <ArrowRightLeft className="size-3.5" /> {busy ? "Menyimpan…" : "Transfer stok"}
          </button>
        </div>
      </div>
    </div>
  );
}

