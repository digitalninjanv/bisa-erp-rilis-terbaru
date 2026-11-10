/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — lembur (pengajuan & keputusan).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  decideOvertimeRequestAction,
  submitOvertimeRequestAction,
} from "@/server/actions/hr/cuti-lembur";
import { DateField } from "@/components/date-field";
import { QtyInput } from "@/components/qty-input";
import { useActionRunner } from "@/components/use-action-runner";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import type { SimpleEmployee } from "./shared";

/* ------------------------------------------------------------------ */
/* Lembur & THR (§6D)                                                  */
/* ------------------------------------------------------------------ */

const OVERTIME_DAY_TYPES: Array<{ value: string; label: string }> = [
  { value: "workday", label: "Hari kerja biasa" },
  { value: "rest_5day", label: "Hari istirahat/libur — pola 5 hari" },
  { value: "rest_6day", label: "Hari istirahat/libur — pola 6 hari" },
  { value: "shortest_day_6day", label: "Libur hari terpendek — pola 6 hari" },
];

export function OvertimeRequestForm({ employees }: { employees: SimpleEmployee[] }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [dayType, setDayType] = useState("workday");
  const [hours, setHours] = useState("2");
  const [reason, setReason] = useState("");
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();

  async function submit() {
    if (!employeeId || !date || !(Number(hours) > 0)) {
      toast.error("Karyawan, tanggal, dan jam lembur wajib diisi.");
      return;
    }
    const data = await run(submitOvertimeRequestAction({
      employeeId,
      date,
      dayType: dayType as "workday" | "rest_5day" | "rest_6day" | "shortest_day_6day",
      hours,
      reason: reason || null,
    }));
    if (data === null) return;
    toast.success("Pengajuan lembur terkirim, menunggu persetujuan.");
    setReason("");
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Ajukan lembur</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Hanya lembur yang disahkan yang menjadi upah lembur di payroll (bila saklar lembur aktif di Pengaturan HR).
        </p>
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
        <label className="space-y-1">
          <span className={labelClass}>Tanggal</span>
          <DateField value={date} onChange={setDate} />
        </label>
        <label className="min-w-48 flex-1 space-y-1">
          <span className={labelClass}>Jenis hari</span>
          <select value={dayType} onChange={(event) => setDayType(event.target.value)} className={fieldClass}>
            {OVERTIME_DAY_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="w-20 space-y-1">
          <span className={labelClass}>Jam</span>
          {/* G2 (FRM-03): jam lembur kini QtyInput bersama. */}
          <QtyInput value={hours} onChange={setHours} aria-label="Jam lembur" className="h-9 px-2.5 text-[12px]" />
        </label>
        <label className="min-w-40 flex-1 space-y-1">
          <span className={labelClass}>Alasan</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} className={fieldClass} />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Ajukan
        </button>
      </div>
    </div>
  );
}

export function OvertimeDecisionButtons({ id }: { id: string }) {
  const router = useRouter();
  const { busy, run } = useActionRunner();
  /* G1 (FRM-02): catatan keputusan dikumpulkan dialog bersama,
     bukan window.prompt. Semantik lama dipertahankan: catatan
     opsional di kedua arah. */
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  async function decide(approve: boolean, note: string) {
    const data = await run(decideOvertimeRequestAction({ id, approve, note: note || undefined }));
    setDecision(null);
    if (data === null) return;
    toast.success(approve ? "Lembur disahkan." : "Lembur ditolak.");
    router.refresh();
  }

  return (
    <span className="flex gap-1.5">
      <button
        type="button"
        onClick={() => setDecision("approve")}
        disabled={busy}
        className="h-8 rounded border border-border px-1.5 text-[11px] transition-colors hover:bg-tone-green-soft disabled:opacity-50"
      >
        Sahkan
      </button>
      <button
        type="button"
        onClick={() => setDecision("reject")}
        disabled={busy}
        className="h-8 rounded border border-border px-1.5 text-[11px] transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        Tolak
      </button>
      <ConfirmDialog
        open={decision !== null}
        title={decision === "approve" ? "Sahkan pengajuan lembur?" : "Tolak pengajuan lembur?"}
        confirmLabel={decision === "approve" ? "Sahkan" : "Tolak"}
        danger={decision === "reject"}
        busy={busy}
        reason={{
          label: decision === "approve" ? "Catatan persetujuan (opsional)" : "Alasan penolakan (opsional)",
          minLength: 0,
        }}
        onConfirm={(note) => void decide(decision === "approve", note)}
        onCancel={() => setDecision(null)}
      />
    </span>
  );
}
