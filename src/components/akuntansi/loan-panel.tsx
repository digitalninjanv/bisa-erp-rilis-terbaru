"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  createEmployeeLoanAction,
  repayEmployeeLoanAction,
  voidEmployeeLoanAction,
} from "@/server/actions/employee-loans";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";

export type LoanEmployeeOption = { id: string; code: string; name: string };
export type LoanAccountOption = { id: string; label: string };

const PLAN_OPTIONS = [
  { value: "tenor", label: "Cicilan merata selama tenor" },
  { value: "fixed", label: "Cicilan nominal tetap per periode" },
] as const;

export function LoanForm({
  employees,
  accounts,
}: {
  employees: LoanEmployeeOption[];
  accounts: LoanAccountOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [planMode, setPlanMode] = useState<(typeof PLAN_OPTIONS)[number]["value"]>("tenor");
  const [planValue, setPlanValue] = useState("12");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!employeeId) {
      toast.error("Pilih karyawan penerima pinjaman.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error("Jumlah pinjaman harus lebih dari nol.");
      return;
    }
    if (!accountId) {
      toast.error("Pilih akun kas/bank sumber dana.");
      return;
    }
    if (!planValue || Number(planValue) <= 0) {
      toast.error(planMode === "tenor" ? "Tenor (bulan) wajib diisi." : "Nominal cicilan wajib diisi.");
      return;
    }
    if (planMode === "tenor" && !Number.isInteger(Number(planValue))) {
      toast.error("Tenor harus bilangan bulat (bulan).");
      return;
    }
    setBusy(true);
    const result = await createEmployeeLoanAction({
      employeeId,
      date,
      amount,
      accountId,
      planMode,
      planValue,
      note: note || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pinjaman ${result.data.number} tercatat dan jurnalnya diposting.`);
    setOpen(false);
    setAmount("");
    setNote("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={employees.length === 0 || accounts.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        <Landmark className="size-3.5" /> Pinjaman Baru
      </button>

      {open ? (
        <Modal
          title="Pinjaman karyawan baru"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Posting pinjaman"
          busyLabel="Memposting…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Pinjaman adalah fasilitas kredit bertenor — berbeda dari kasbon yang merupakan uang muka operasional jangka pendek. Keduanya menjadi piutang karyawan dan dipotong dari gaji, tetapi dokumen dan cicilannya tercatat terpisah.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Karyawan</span>
                <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={fieldClass}>
                  {employees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.code} · {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Tanggal</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Jumlah pinjaman</span>
                <MoneyInput value={amount} onChange={setAmount} aria-label="Jumlah pinjaman" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Dibayar dari kas / bank</span>
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={fieldClass}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="space-y-1.5 sm:col-span-2">
                <legend className={labelClass}>Rencana cicilan gaji</legend>
                {PLAN_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-[12px]">
                    <input
                      type="radio"
                      name="loan-plan-mode"
                      checked={planMode === option.value}
                      onChange={() => setPlanMode(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                {planMode === "tenor" ? (
                  <div className="pt-1">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={planValue}
                        onChange={(event) => setPlanValue(event.target.value)}
                        inputMode="numeric"
                        aria-label="Tenor (bulan)"
                        className={`${fieldClass} num w-24 text-right`}
                        placeholder="12"
                      />
                      <span className="text-[12px] text-muted-foreground">bulan — cicilan = sisa ÷ sisa bulan</span>
                    </div>
                  </div>
                ) : (
                  <div className="pt-1">
                    <MoneyInput
                      value={planValue}
                      onChange={setPlanValue}
                      aria-label="Nominal cicilan per periode"
                      className="h-9 px-2.5 text-[12px]"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">Nominal yang dipotong setiap periode payroll sampai pinjaman lunas.</p>
                  </div>
                )}
              </fieldset>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Catatan</span>
                <input value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} placeholder="Keperluan pinjaman (opsional)" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export function RepayLoanForm({
  employeeId,
  openTotal,
  accounts,
}: {
  employeeId: string;
  openTotal: string;
  accounts: LoanAccountOption[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!amount || Number(amount) <= 0) {
      toast.error("Nominal setoran harus lebih dari nol.");
      return;
    }
    if (!accountId) {
      toast.error("Pilih akun kas/bank tujuan setoran.");
      return;
    }
    setBusy(true);
    const result = await repayEmployeeLoanAction({
      employeeId,
      date,
      amount,
      accountId,
      note: note || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Setoran pinjaman tercatat; sisa pinjaman berkurang (tertua dulu).");
    setAmount("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Setor tunai (pelunasan manual)</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Sisa pinjaman berjalan {formatIDR(openTotal)}. Setoran dialokasikan ke pinjaman tertua lebih dulu.
        </p>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Tanggal</span>
          <DateField value={date} onChange={setDate} aria-label="Tanggal" />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Nominal setoran</span>
          <MoneyInput value={amount} onChange={setAmount} aria-label="Nominal setoran" className="h-9 px-2.5 text-[12px]" />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Masuk ke kas / bank</span>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={fieldClass}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Catatan</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} placeholder="Opsional" />
        </label>
      </div>
      <div className="flex justify-end border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || accounts.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <PiggyBank className="size-3.5" /> {busy ? "Menyimpan…" : "Catat setoran"}
        </button>
      </div>
    </div>
  );
}

export function LoanVoidButton({
  id,
  number,
  disabled,
  asMenu = false,
}: {
  id: string;
  number: string;
  disabled?: boolean;
  /** G3 (UX4-01): menu ⋯ satu item destruktif — alasan nonaktif
   * menjadi catatan item menu (pola A-28 UI-5), bukan tooltip. */
  asMenu?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidEmployeeLoanAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Pinjaman dibatalkan dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      {asMenu ? (
        <RowMenu
          label={`Aksi untuk pinjaman ${number}`}
          items={[
            {
              key: "void",
              label: "Batalkan pinjaman",
              danger: true,
              disabled: busy || disabled,
              note: disabled ? "Sudah memiliki cicilan/setoran — tidak dapat dibatalkan" : undefined,
            },
          ]}
          onAction={(key) => {
            if (key === "void") setOpen(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy || disabled}
          title={disabled ? "Pinjaman yang sudah memiliki cicilan/setoran tidak dapat dibatalkan" : undefined}
          className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
        >
          {busy ? "…" : "Batalkan"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Batalkan pinjaman ${number}?`}
        description="Jurnal pembalik akan dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan pinjaman"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

