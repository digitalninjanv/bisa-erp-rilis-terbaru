"use client";

import { useState } from "react";
import { newUuid } from "@/lib/uuid";
import { useRouter } from "next/navigation";
import { HandCoins } from "lucide-react";
import { toast } from "sonner";
import {
  createPurchaseAdvanceAction,
  voidPurchaseAdvanceAction,
} from "@/server/actions/inventory/uang-muka";
import { d } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";

export function PurchaseAdvanceForm({
  suppliers,
  paymentAccounts,
  today,
}: {
  suppliers: { id: string; name: string }[];
  paymentAccounts: { id: string; code: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => newUuid());
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [paymentAccountId, setPaymentAccountId] = useState(paymentAccounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [amountValid, setAmountValid] = useState(true);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierId) {
      toast.error("Pemasok wajib dipilih.");
      return;
    }
    if (!paymentAccountId) {
      toast.error("Akun pembayaran wajib dipilih.");
      return;
    }
    if (!amountValid || !d(amount || "0").gt(0)) {
      toast.error("Nominal uang muka harus lebih dari nol.");
      return;
    }
    setBusy(true);
    const result = await createPurchaseAdvanceAction({
      supplierId,
      date,
      amount,
      paymentAccountId,
      taxInvoiceNumber: taxInvoiceNumber || undefined,
      notes: notes || undefined,
      idempotencyKey,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Uang muka ${result.data.number} tersimpan.`);
    setIdempotencyKey(newUuid());
    setAmount("");
    setTaxInvoiceNumber("");
    setNotes("");
    router.refresh();
  }

  if (suppliers.length === 0 || paymentAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        Butuh minimal satu pemasok dan satu akun kas/bank untuk mencatat uang muka.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Uang muka pembelian baru</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dana keluar sekarang dan menjadi saldo uang muka pemasok. Saldo dipotong otomatis
          saat penerimaan barang.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className={labelClass}>Pemasok</span>
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={fieldClass}>
              {suppliers.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Tanggal</span>
            <DateField value={date} onChange={setDate} aria-label="Tanggal uang muka" />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Nominal</span>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              onValidityChange={setAmountValid}
              aria-label="Nominal uang muka"
              className="h-9 text-[12px]"
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Dibayar dari</span>
            <select
              value={paymentAccountId}
              onChange={(event) => setPaymentAccountId(event.target.value)}
              className={fieldClass}
            >
              {paymentAccounts.map((row) => (
                <option key={row.id} value={row.id}>{row.code} — {row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>No. faktur uang muka (opsional)</span>
            <input
              value={taxInvoiceNumber}
              onChange={(event) => setTaxInvoiceNumber(event.target.value)}
              className={fieldClass}
              placeholder="Nomor faktur pajak / DP"
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Catatan (opsional)</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={fieldClass}
              placeholder="Contoh: DP 30% pesanan gula"
            />
          </label>
        </div>
        <div className="flex justify-end border-t border-border pt-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
          >
            <HandCoins className="size-3.5" /> {busy ? "Menyimpan…" : "Simpan uang muka"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PurchaseAdvanceVoidButton({
  id,
  number,
  today,
}: {
  id: string;
  number: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidPurchaseAdvanceAction({ advanceId: id, date: today, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Uang muka ${number} dibatalkan.`);
    router.refresh();
  }

  return (
    <>
      <RowMenu
        label={`Aksi untuk uang muka ${number}`}
        items={[{ key: "void", label: "Batalkan uang muka", danger: true }]}
        onAction={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        title={`Batalkan uang muka ${number}?`}
        description="Hanya uang muka yang belum dipakai pada penerimaan yang dapat dibatalkan. Jurnal pembalik dibuat otomatis."
        confirmLabel="Batalkan uang muka"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", placeholder: "Contoh: DP salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
