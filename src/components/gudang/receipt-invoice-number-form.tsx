"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordReceiptInvoiceNumberAction } from "@/server/actions/inventory/penerimaan";
import { DateField } from "@/components/date-field";

export function ReceiptInvoiceNumberForm({
  receiptId,
  initialValue,
  initialInvoiceDate = null,
  initialDueDate = null,
}: {
  receiptId: string;
  initialValue: string | null;
  initialInvoiceDate?: string | null;
  initialDueDate?: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? "");
  const [savedValue, setSavedValue] = useState(initialValue ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initialInvoiceDate ?? "");
  const [dueDate, setDueDate] = useState(initialDueDate ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supplierInvoiceNumber = value.trim();
    if (!supplierInvoiceNumber) {
      toast.error("Masukkan nomor faktur pemasok.");
      return;
    }
    setBusy(true);
    const result = await recordReceiptInvoiceNumberAction({
      receiptId,
      supplierInvoiceNumber,
      supplierInvoiceDate: invoiceDate || undefined,
      dueDate: dueDate || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setValue(result.data.supplierInvoiceNumber);
    setSavedValue(result.data.supplierInvoiceNumber);
    setInvoiceDate(result.data.supplierInvoiceDate ?? "");
    setDueDate(result.data.dueDate ?? "");
    toast.success("Nomor dan tanggal faktur tersimpan.");
    router.refresh();
  }

  return (
    <section className="mb-3 rounded-lg border border-border bg-card px-4 py-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="min-w-52 flex-1 space-y-1">
          <span className="text-[11px] font-medium">No. faktur pemasok</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="Masukkan nomor faktur"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium">Tanggal faktur</span>
          <DateField value={invoiceDate} onChange={setInvoiceDate} aria-label="Tanggal faktur pemasok" className="h-9 w-40" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium">Jatuh tempo</span>
          <DateField value={dueDate} onChange={setDueDate} aria-label="Jatuh tempo faktur" className="h-9 w-40" />
        </label>
        <button
          type="submit"
          disabled={busy || !value.trim() || value.trim() === savedValue}
          className="h-9 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Menyimpan…" : savedValue ? "Perbarui nomor faktur" : "Catat nomor faktur"}
        </button>
      </form>
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        Pencatatan nomor tidak mengubah stok, nilai pembelian, pajak, atau jurnal yang sudah diposting.
      </p>
    </section>
  );
}
