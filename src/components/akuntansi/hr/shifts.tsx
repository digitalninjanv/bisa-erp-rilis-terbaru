/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — master shift & penugasan shift.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  assignEmployeeShiftAction,
  saveWorkShiftAction,
  setWorkShiftActiveAction,
} from "@/server/actions/hr/organisasi";
import { DateField } from "@/components/date-field";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { RowMenu } from "@/components/blocks/row-menu";
import type { SimpleEmployee, SimpleShift } from "./shared";

/* ------------------------------------------------------------------ */
/* Absensi & shift (§6B)                                               */
/* ------------------------------------------------------------------ */

export type ShiftRow = {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  workDays: number[];
  isActive: boolean;
};

const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Sen" },
  { value: 2, label: "Sel" },
  { value: 3, label: "Rab" },
  { value: 4, label: "Kam" },
  { value: 5, label: "Jum" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Min" },
];

export function WorkShiftManager({ rows }: { rows: ShiftRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ShiftRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);

  function reset(row?: ShiftRow) {
    setEditing(row ?? null);
    setCode(row?.code ?? "");
    setName(row?.name ?? "");
    setStartTime(row?.startTime.slice(0, 5) ?? "08:00");
    setEndTime(row?.endTime.slice(0, 5) ?? "17:00");
    setWorkDays(row?.workDays ?? [1, 2, 3, 4, 5]);
  }

  async function submit() {
    if (!code.trim() || name.trim().length < 2 || workDays.length === 0) {
      toast.error("Kode, nama, dan minimal satu hari kerja wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await saveWorkShiftAction({
      id: editing?.id, code, name, startTime, endTime, workDays,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Shift disimpan.");
    reset(undefined);
    router.refresh();
  }

  async function toggle(row: ShiftRow) {
    setBusy(true);
    const result = await setWorkShiftActiveAction({ id: row.id, isActive: !row.isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Master shift</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Jam masuk/pulang dan pola hari kerja adalah konfigurasi perusahaan.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-4 py-3">
        <label className="w-24 space-y-1">
          <span className={labelClass}>Kode</span>
          <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} />
        </label>
        <label className="min-w-36 flex-1 space-y-1">
          <span className={labelClass}>Nama</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </label>
        <label className="w-24 space-y-1">
          <span className={labelClass}>Masuk</span>
          <input type="time" lang="id-ID" value={startTime} onChange={(event) => setStartTime(event.target.value)} className={fieldClass} />
        </label>
        <label className="w-24 space-y-1">
          <span className={labelClass}>Pulang</span>
          <input type="time" lang="id-ID" value={endTime} onChange={(event) => setEndTime(event.target.value)} className={fieldClass} />
        </label>
        <div className="space-y-1">
          <span className={labelClass}>Hari kerja</span>
          <div className="flex gap-1.5 pb-1">
            {WEEKDAY_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={workDays.includes(option.value)}
                  onChange={(event) =>
                    setWorkDays((current) =>
                      event.target.checked
                        ? [...current, option.value]
                        : current.filter((day) => day !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {editing ? "Simpan perubahan" : "Tambah shift"}
        </button>
        {editing ? (
          <button type="button" onClick={() => reset(undefined)} className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted">
            Batal
          </button>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul className="divide-y divide-border/70 border-t border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="text-[12px]">
                <span className="num mr-2 text-[11px] text-muted-foreground">{row.code}</span>
                {row.name} · {row.startTime.slice(0, 5)}–{row.endTime.slice(0, 5)}
                {!row.isActive ? <span className="ml-2 text-[11px] text-muted-foreground">(nonaktif)</span> : null}
              </span>
              {/* G3 (UX4-01): Ubah + Nonaktifkan masuk menu ⋯. */}
              <RowMenu
                label={`Aksi untuk shift ${row.name}`}
                items={[
                  { key: "edit", label: "Ubah" },
                  { key: "toggle", label: row.isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
                ]}
                onAction={(key) => {
                  if (key === "edit") reset(row);
                  if (key === "toggle") void toggle(row);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ShiftAssignmentForm({
  employees,
  shifts,
}: {
  employees: SimpleEmployee[];
  shifts: SimpleShift[];
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!employeeId || !shiftId || !effectiveFrom) {
      toast.error("Karyawan, shift, dan tanggal efektif wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await assignEmployeeShiftAction({ employeeId, shiftId, effectiveFrom });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Penugasan shift disimpan.");
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Penugasan shift</h2>
      </div>
      <div className="flex flex-wrap items-end gap-2 p-4">
        <label className="min-w-44 flex-1 space-y-1">
          <span className={labelClass}>Karyawan</span>
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={fieldClass}>
            <option value="">— pilih —</option>
            {employees.map((person) => (
              <option key={person.id} value={person.id}>{person.code} · {person.name}</option>
            ))}
          </select>
        </label>
        <label className="min-w-36 flex-1 space-y-1">
          <span className={labelClass}>Shift</span>
          <select value={shiftId} onChange={(event) => setShiftId(event.target.value)} className={fieldClass}>
            <option value="">— pilih —</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>{shift.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Berlaku sejak</span>
          <DateField value={effectiveFrom} onChange={setEffectiveFrom} />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Tugaskan
        </button>
      </div>
    </div>
  );
}
