"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/money";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { payPayrollAction, voidPayrollPaymentAction } from "@/server/actions/hr/payroll";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { DateField } from "@/components/date-field";
import { Modal } from "@/components/blocks/modal";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

export function PayrollPaymentForm({
  runId,
  number,
  totalNet,
  accounts,
  today,
  paid,
  canVoid = false,
}: {
  runId: string;
  number: string;
  totalNet: number;
  accounts: { id: string; code: string; name: string }[];
  today: string;
  paid: boolean;
  canVoid?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await payPayrollAction({ runId, accountId, date });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pembayaran gaji ${number} diposting.`);
    showPostingWarnings(result.data.entry.warnings);
    setOpen(false);
    router.refresh();
  }

  async function voidPayment(reason: string) {
    setVoidBusy(true);
    const result = await voidPayrollPaymentAction({ runId, reason });
    setVoidBusy(false);
    setVoidOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pembayaran gaji ${number} dibatalkan; payroll kembali berstatus posted.`);
    router.refresh();
  }

  if (paid) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-tone-green-soft px-3 text-[12px] font-medium text-tone-green">
            <Banknote className="size-3.5" /> Sudah dibayar
          </span>
          {canVoid ? (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              Batalkan pembayaran
            </button>
          ) : null}
        </div>
        <ConfirmDialog
          open={voidOpen}
          title={`Batalkan pembayaran gaji ${number}?`}
          description="Jurnal pembayaran dibalik dan status payroll kembali menjadi posted. Run tetap ada dan dapat dibayar ulang dengan akun/tanggal yang benar."
          confirmLabel="Batalkan pembayaran"
          danger
          busy={voidBusy}
          reason={{ label: "Alasan pembatalan", initialValue: "Salah akun/tanggal bayar", minLength: 3 }}
          onConfirm={(reason) => void voidPayment(reason)}
          onCancel={() => setVoidOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Banknote className="size-3.5" /> Bayar gaji
      </button>

      {open ? (
        <Modal
          title={`Bayar gaji ${number}`}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Posting pembayaran"
          busyLabel="Memproses…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Total bersih {formatIDR(totalNet)}.</p>
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className={labelClass}>Tanggal bayar</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal bayar" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Dibayar dari</span>
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={fieldClass}>
                  {accounts.map((row) => (
                    <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                  ))}
                </select>
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

