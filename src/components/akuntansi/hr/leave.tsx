/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — cuti (jenis, pengajuan & keputusan).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  decideLeaveRequestAction,
  saveLeaveTypeAction,
  setLeaveTypeActiveAction,
  submitLeaveRequestAction,
} from "@/server/actions/hr/cuti-lembur";
import { DateField } from "@/components/date-field";
import { QtyInput } from "@/components/qty-input";
import { useActionRunner } from "@/components/use-action-runner";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import type { SimpleEmployee } from "./shared";

/* ------------------------------------------------------------------ */
/* Cuti (§6C)                                                          */
/* ------------------------------------------------------------------ */

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  daysPerYear: string | null;
  isPaid: boolean;
  isActive: boolean;
};

export function LeaveTypeManager({ rows }: { rows: LeaveTypeRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LeaveTypeRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [daysPerYear, setDaysPerYear] = useState("");
  const [isPaid, setIsPaid] = useState(true);
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();

  function reset(row?: LeaveTypeRow) {
    setEditing(row ?? null);
    setCode(row?.code ?? "");
    setName(row?.name ?? "");
    setDaysPerYear(row?.daysPerYear ?? "");
    setIsPaid(row?.isPaid ?? true);
  }

  async function submit() {
    if (!code.trim() || name.trim().length < 2) {
      toast.error("Kode dan nama jenis cuti wajib diisi.");
      return;
    }
    const data = await run(saveLeaveTypeAction({
      id: editing?.id, code, name,
      daysPerYear: daysPerYear === "" ? null : daysPerYear,
      isPaid,
    }));
    if (data === null) return;
    toast.success("Jenis cuti disimpan.");
    reset(undefined);
    router.refresh();
  }

  async function toggle(row: LeaveTypeRow) {
    const data = await run(setLeaveTypeActiveAction({ id: row.id, isActive: !row.isActive }));
    if (data === null) return;
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Jenis cuti</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Jatah hari per tahun & status berbayar adalah konfigurasi perusahaan. Kosongkan jatah untuk jenis tanpa batas saldo.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-4 py-3">
        <label className="w-28 space-y-1">
          <span className={labelClass}>Kode</span>
          <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} />
        </label>
        <label className="min-w-40 flex-1 space-y-1">
          <span className={labelClass}>Nama</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </label>
        <label className="w-28 space-y-1">
          <span className={labelClass}>Jatah hari/thn</span>
          {/* G2 (FRM-03): jatah hari kini QtyInput bersama. */}
          <QtyInput value={daysPerYear} onChange={setDaysPerYear} placeholder="tanpa jatah" aria-label="Jatah hari per tahun" className="h-9 px-2.5 text-[12px]" />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px]">
          <input type="checkbox" checked={isPaid} onChange={(event) => setIsPaid(event.target.checked)} />
          Berbayar
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {editing ? "Simpan perubahan" : "Tambah jenis"}
        </button>
        {editing ? (
          <button type="button" onClick={() => reset(undefined)} className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted">
            Batal
          </button>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto border-t border-border">
          {/* A-25 U5 (HR-03): daftar jenis cuti menjadi TABEL
              sejajar kolom — bukan lagi baris teks mengalir. */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Jenis cuti</th>
                <th className="text-right">Jatah (hari/thn)</th>
                <th>Pembayaran</th>
                <th>Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="text-[12px] font-medium">{row.name}</span>
                    <span className="num ml-1.5 text-[10px] text-muted-foreground">{row.code}</span>
                  </td>
                  <td className="num text-right">{row.daysPerYear === null ? "—" : row.daysPerYear}</td>
                  <td className="text-[12px]">{row.isPaid ? "Berbayar" : "Tidak berbayar"}</td>
                  <td className="text-[12px]">{row.isActive ? "Aktif" : "Nonaktif"}</td>
                  <td className="text-right">
                    {/* G3 (UX4-01): Ubah + Nonaktifkan masuk menu ⋯. */}
                    <span className="flex justify-end">
                      <RowMenu
                        label={`Aksi untuk jenis cuti ${row.name}`}
                        items={[
                          { key: "edit", label: "Ubah" },
                          { key: "toggle", label: row.isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
                        ]}
                        onAction={(key) => {
                          if (key === "edit") reset(row);
                          if (key === "toggle") void toggle(row);
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function LeaveRequestForm({
  employees,
  leaveTypes,
}: {
  employees: SimpleEmployee[];
  leaveTypes: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, run } = useActionRunner();

  async function submit() {
    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      toast.error("Karyawan, jenis cuti, dan rentang tanggal wajib diisi.");
      return;
    }
    const data = await run(submitLeaveRequestAction({
      employeeId, leaveTypeId, startDate, endDate, halfDay, reason: reason || null,
    }));
    if (data === null) return;
    toast.success(`Pengajuan cuti ${data.days} hari terkirim, menunggu persetujuan.`);
    setReason("");
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Ajukan cuti</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Hari dihitung dari hari kerja menurut pola shift karyawan; pengajuan melebihi saldo atau tumpang tindih ditolak.
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
        <label className="min-w-40 flex-1 space-y-1">
          <span className={labelClass}>Jenis cuti</span>
          <select value={leaveTypeId} onChange={(event) => setLeaveTypeId(event.target.value)} className={fieldClass}>
            <option value="">— pilih —</option>
            {leaveTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Mulai</span>
          <DateField value={startDate} onChange={setStartDate} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Selesai</span>
          <DateField value={endDate} onChange={setEndDate} />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px]">
          <input type="checkbox" checked={halfDay} onChange={(event) => setHalfDay(event.target.checked)} />
          Setengah hari (satu hari)
        </label>
        <label className="min-w-36 flex-1 space-y-1">
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

export function LeaveDecisionButtons({ id }: { id: string }) {
  const router = useRouter();
  const { busy, run } = useActionRunner();
  /* G1 (FRM-02): catatan keputusan dikumpulkan dialog bersama,
     bukan window.prompt. Semantik lama dipertahankan: catatan
     opsional di kedua arah. */
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  async function decide(approve: boolean, note: string) {
    const data = await run(decideLeaveRequestAction({ id, approve, note: note || undefined }));
    setDecision(null);
    if (data === null) return;
    toast.success(approve ? "Cuti disahkan." : "Cuti ditolak.");
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
        title={decision === "approve" ? "Sahkan pengajuan cuti?" : "Tolak pengajuan cuti?"}
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
