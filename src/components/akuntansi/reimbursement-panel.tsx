"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { d, formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  decideReimbursementClaimAction,
  payReimbursementClaimAction,
  submitReimbursementClaimAction,
} from "@/server/actions/reimbursements";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { Modal } from "@/components/blocks/modal";

export type ClaimEmployeeOption = { id: string; code: string; name: string };
export type ClaimAccountOption = { id: string; label: string };

export function ClaimForm({
  employees,
  expenseAccounts,
  taxRate = "0",
  taxInputMapped = false,
}: {
  employees: ClaimEmployeeOption[];
  expenseAccounts: ClaimAccountOption[];
  /** Tarif PPN efektif perusahaan (persen); "0"/absen bila PPN nonaktif. */
  taxRate?: string;
  /** Akun PPN Masukan sudah dipetakan di Pengaturan. */
  taxInputMapped?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [expenseAccountId, setExpenseAccountId] = useState(expenseAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentNote, setAttachmentNote] = useState("");
  // A-21 (R3-10): opsi "Termasuk PPN" — pola form Beban persis; hanya
  // tampil bila PPN perusahaan aktif & bertarif.
  const [taxIncluded, setTaxIncluded] = useState(false);
  const [busy, setBusy] = useState(false);
  const showTaxOption = d(taxRate || "0").gt(0);

  async function submit() {
    if (!employeeId) return toast.error("Pilih karyawan pengaju klaim.");
    if (!expenseAccountId) return toast.error("Pilih kategori beban.");
    if (!amount || Number(amount) <= 0) return toast.error("Nominal klaim harus lebih dari nol.");
    if (description.trim().length < 3) return toast.error("Keterangan klaim wajib diisi.");
    setBusy(true);
    const result = await submitReimbursementClaimAction({
      employeeId,
      date,
      expenseAccountId,
      amount,
      description: description.trim(),
      attachmentName: attachmentName.trim() || undefined,
      attachmentNote: attachmentNote.trim() || undefined,
      taxIncluded: showTaxOption && taxInputMapped ? taxIncluded : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Klaim ${result.data.number} diajukan dan menunggu persetujuan.`);
    setOpen(false);
    setAmount("");
    setDescription("");
    setAttachmentName("");
    setAttachmentNote("");
    setTaxIncluded(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={employees.length === 0 || expenseAccounts.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        <ReceiptText className="size-3.5" /> Klaim Baru
      </button>

      {open ? (
        <Modal
          title="Klaim reimbursement baru"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Ajukan klaim"
          busyLabel="Mengajukan…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Klaim adalah pengembalian biaya perusahaan yang sudah dibayar karyawan. Sesudah disahkan atasan, klaim dibayar tunai sebagai beban perusahaan — bukan piutang karyawan.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Karyawan pengaju</span>
                <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={fieldClass}>
                  {employees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.code} · {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Tanggal biaya</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal biaya" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Nominal klaim</span>
                <MoneyInput value={amount} onChange={setAmount} aria-label="Nominal klaim" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Kategori beban</span>
                <select value={expenseAccountId} onChange={(event) => setExpenseAccountId(event.target.value)} className={fieldClass}>
                  {expenseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Keterangan</span>
                <input value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} placeholder="Mis. Bensin kunjungan klien PT X" />
              </label>
              {showTaxOption ? (
                taxInputMapped ? (
                  <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={taxIncluded}
                      onChange={(event) => setTaxIncluded(event.target.checked)}
                      className="size-3.5"
                    />
                    Termasuk PPN {d(taxRate || "0").toString()}% — saat dibayar, PPN dipisah ke PPN
                    Masukan dan beban dicatat sebesar DPP
                  </label>
                ) : (
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">
                    Opsi termasuk PPN tidak tersedia: akun PPN Masukan belum dipetakan di Pengaturan.
                  </p>
                )
              ) : null}
              <label className="space-y-1">
                <span className={labelClass}>Nama berkas bukti</span>
                <input value={attachmentName} onChange={(event) => setAttachmentName(event.target.value)} className={fieldClass} placeholder="struk-bensin.jpg" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Catatan lampiran</span>
                <input value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} className={fieldClass} placeholder="Lokasi berkas asli (opsional)" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export function ClaimDecisionButtons({ id, number, claimed }: { id: string; number: string; claimed: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /* G1 (FRM-02): alur sahkan dua langkah (nominal → catatan) dan
     tolak beralasan kini dialog bersama; sebelumnya dua window.prompt
     berurutan untuk satu keputusan. */
  const [step, setStep] = useState<{ approve: boolean; phase: "amount" | "note"; amount?: string } | null>(null);

  async function submit(approve: boolean, approvedAmount: string | undefined, note: string) {
    setBusy(true);
    const result = await decideReimbursementClaimAction({
      id,
      approve,
      approvedAmount,
      note: note || undefined,
    });
    setBusy(false);
    setStep(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(approve ? `Klaim ${number} disahkan.` : `Klaim ${number} ditolak.`);
    router.refresh();
  }

  function confirmAmount(raw: string) {
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits || Number(digits) <= 0) {
      toast.error("Nominal disahkan harus lebih dari nol.");
      return;
    }
    setStep({ approve: true, phase: "note", amount: digits });
  }

  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        onClick={() => setStep({ approve: true, phase: "amount" })}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
      >
        Sahkan
      </button>
      <button
        type="button"
        onClick={() => setStep({ approve: false, phase: "note" })}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        Tolak
      </button>
      <ConfirmDialog
        open={step?.approve === true && step.phase === "amount"}
        title={`Sahkan klaim ${number}?`}
        description={`Klaim diajukan sebesar ${formatIDR(claimed)}. Periksa nominal yang disahkan sebelum melanjutkan.`}
        confirmLabel="Lanjut"
        busy={busy}
        reason={{ label: "Nominal yang disahkan", initialValue: claimed }}
        onConfirm={confirmAmount}
        onCancel={() => setStep(null)}
      />
      <ConfirmDialog
        open={step !== null && step.phase === "note"}
        title={step?.approve ? `Sahkan klaim ${number}?` : `Tolak klaim ${number}?`}
        confirmLabel={step?.approve ? "Sahkan klaim" : "Tolak klaim"}
        danger={!step?.approve}
        busy={busy}
        reason={
          step?.approve
            ? { label: "Catatan persetujuan (opsional)", minLength: 0 }
            : { label: "Alasan penolakan", minLength: 3 }
        }
        onConfirm={(note) => {
          if (step) void submit(step.approve, step.amount, note);
        }}
        onCancel={() => setStep(null)}
      />
    </span>
  );
}

export function ClaimPayButton({
  id,
  number,
  accounts,
}: {
  id: string;
  number: string;
  accounts: ClaimAccountOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (!accountId) return toast.error("Pilih akun kas/bank pembayaran.");
    setBusy(true);
    const result = await payReimbursementClaimAction({ id, paymentAccountId: accountId, date });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Klaim ${number} terbayar — jurnal beban diposting.`);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={accounts.length === 0}
        className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] transition-colors hover:bg-muted disabled:opacity-40"
      >
        Bayar
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <DateField value={date} onChange={setDate} aria-label="Tanggal bayar" className="h-9 w-[132px] px-1 text-[11px]" />
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-9 max-w-[150px] rounded border border-input bg-background px-1 text-[11px]" aria-label="Akun pembayaran">
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={pay} disabled={busy} className="inline-flex h-8 items-center rounded bg-primary px-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40">
        {busy ? "…" : "OK"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px]">
        ✕
      </button>
    </span>
  );
}

