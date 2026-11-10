"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { PercentInput } from "@/components/percent-input";
import { DateField } from "@/components/date-field";
import { formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  createEmployeeAdvanceAction,
  repayEmployeeAdvanceAction,
  voidEmployeeAdvanceAction,
} from "@/server/actions/employee-advances";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";

export type AdvanceEmployeeOption = { id: string; code: string; name: string };
export type AdvanceAccountOption = { id: string; label: string };

const PLAN_OPTIONS = [
  { value: "full", label: "Potong penuh di gaji berikutnya" },
  { value: "fixed", label: "Cicilan nominal tetap per periode" },
  { value: "percent", label: "Cicilan persen dari gaji pokok" },
] as const;

export function AdvanceForm({
  employees,
  accounts,
}: {
  employees: AdvanceEmployeeOption[];
  accounts: AdvanceAccountOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [planMode, setPlanMode] = useState<(typeof PLAN_OPTIONS)[number]["value"]>("full");
  const [planValue, setPlanValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!employeeId) {
      toast.error("Pilih karyawan penerima kasbon.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error("Jumlah kasbon harus lebih dari nol.");
      return;
    }
    if (!accountId) {
      toast.error("Pilih akun kas/bank sumber dana.");
      return;
    }
    if (planMode !== "full" && (!planValue || Number(planValue) <= 0)) {
      toast.error(planMode === "fixed" ? "Nominal cicilan wajib diisi." : "Persen potongan wajib diisi (1–100).");
      return;
    }
    setBusy(true);
    const result = await createEmployeeAdvanceAction({
      employeeId,
      date,
      amount,
      accountId,
      planMode,
      planValue: planMode === "full" ? undefined : planValue,
      note: note || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Kasbon ${result.data.number} tercatat dan jurnalnya diposting.`);
    setOpen(false);
    setAmount("");
    setPlanValue("");
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
        <HandCoins className="size-3.5" /> Kasbon Baru
      </button>

      {open ? (
        <Modal
          title="Kasbon baru"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Posting kasbon"
          busyLabel="Memposting…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Uang yang diberikan menjadi piutang karyawan dan dipotong dari gaji mengikuti rencana potongannya.</p>
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
                <span className={labelClass}>Jumlah kasbon</span>
                <MoneyInput value={amount} onChange={setAmount} aria-label="Jumlah kasbon" className="h-9 px-2.5 text-[12px]" />
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
                <legend className={labelClass}>Rencana potongan gaji</legend>
                {PLAN_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-[12px]">
                    <input
                      type="radio"
                      name="plan-mode"
                      checked={planMode === option.value}
                      onChange={() => setPlanMode(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                {planMode === "fixed" ? (
                  <div className="pt-1">
                    <MoneyInput
                      value={planValue}
                      onChange={setPlanValue}
                      aria-label="Nominal cicilan per periode"
                      className="h-9 px-2.5 text-[12px]"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">Nominal yang dipotong setiap periode payroll sampai kasbon lunas.</p>
                  </div>
                ) : null}
                {planMode === "percent" ? (
                  <div className="pt-1">
                    <div className="flex items-center gap-1.5">
                      {/* Validasi 3 (F-02): mode persen memakai PercentInput
                          bersama seperti mode nominal memakai MoneyInput —
                          state planValue yang sama, string kanonis persen. */}
                      <PercentInput
                        value={planValue}
                        onChange={setPlanValue}
                        aria-label="Persen potongan"
                        className="h-9 w-24 text-[12px]"
                        placeholder="50"
                      />
                      <span className="text-[12px] text-muted-foreground">% dari gaji pokok per periode</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Dihitung dari gaji pokok karyawan pada periode payroll yang berjalan.</p>
                  </div>
                ) : null}
              </fieldset>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Catatan</span>
                <input value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} placeholder="Keperluan kasbon (opsional)" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export function RepayAdvanceForm({
  employeeId,
  openTotal,
  accounts,
}: {
  employeeId: string;
  openTotal: string;
  accounts: AdvanceAccountOption[];
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
    const result = await repayEmployeeAdvanceAction({
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
    toast.success("Setoran kasbon tercatat; sisa kasbon berkurang (tertua dulu).");
    setAmount("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Setor tunai (pelunasan manual)</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Sisa kasbon berjalan {formatIDR(openTotal)}. Setoran dialokasikan ke kasbon tertua lebih dulu.
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

export function AdvanceVoidButton({
  id,
  number,
  disabled,
  asMenu = false,
}: {
  id: string;
  number: string;
  disabled?: boolean;
  /** G3 (UX4-01): menu ⋯ satu item destruktif — lihat LoanVoidButton. */
  asMenu?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidEmployeeAdvanceAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Kasbon dibatalkan dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      {asMenu ? (
        <RowMenu
          label={`Aksi untuk kasbon ${number}`}
          items={[
            {
              key: "void",
              label: "Batalkan kasbon",
              danger: true,
              disabled: busy || disabled,
              note: disabled ? "Sudah memiliki potongan/setoran — tidak dapat dibatalkan" : undefined,
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
          title={disabled ? "Kasbon yang sudah memiliki potongan/setoran tidak dapat dibatalkan" : undefined}
          className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
        >
          {busy ? "…" : "Batalkan"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Batalkan kasbon ${number}?`}
        description="Jurnal pembalik akan dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan kasbon"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

