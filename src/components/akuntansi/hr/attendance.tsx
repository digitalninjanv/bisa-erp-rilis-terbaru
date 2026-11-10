/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — absensi (catat manual & impor CSV).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  importAttendanceCsvAction,
  recordAttendanceAction,
} from "@/server/actions/hr/presensi";
import { DateField } from "@/components/date-field";
import { requireFilled, useActionRunner } from "@/components/use-action-runner";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import type { SimpleEmployee } from "./shared";

const ATTENDANCE_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "present", label: "Hadir" },
  { value: "permit", label: "Izin" },
  { value: "sick", label: "Sakit" },
  { value: "leave", label: "Cuti" },
  { value: "absent", label: "Alpa" },
];

export function AttendanceEntryForm({ employees }: { employees: SimpleEmployee[] }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("present");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!employeeId || !date) {
      toast.error("Karyawan dan tanggal wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await recordAttendanceAction({
      employeeId,
      date,
      status: status as "present" | "permit" | "sick" | "leave" | "absent",
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      note: note || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Absensi tercatat.");
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Catat absensi manual</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Mencatat tanggal yang sama memperbarui catatan hari itu. Menit terlambat dihitung dari shift yang berlaku.
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
        <label className="space-y-1">
          <span className={labelClass}>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
            {ATTENDANCE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="w-24 space-y-1">
          <span className={labelClass}>Masuk</span>
          <input type="time" lang="id-ID" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} className={fieldClass} />
        </label>
        <label className="w-24 space-y-1">
          <span className={labelClass}>Pulang</span>
          <input type="time" lang="id-ID" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} className={fieldClass} />
        </label>
        <label className="min-w-36 flex-1 space-y-1">
          <span className={labelClass}>Catatan</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Simpan
        </button>
      </div>
    </div>
  );
}

export function AttendanceImportForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  // G2 (FRM-05): busy + hasil + wajib-isi kini helper bersama.
  const { busy, run } = useActionRunner();

  async function submit() {
    if (!requireFilled(text, "Tempel isi CSV terlebih dahulu.")) return;
    const data = await run(importAttendanceCsvAction({ text }));
    if (data === null) return;
    if (data.errors.length > 0) {
      toast.warning(
        `${data.imported} baris terimpor; ${data.errors.length} baris gagal: ` +
          data.errors.map((row) => `baris ${row.line}: ${row.message}`).join("; "),
      );
    } else {
      toast.success(`${data.imported} baris absensi terimpor.`);
    }
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Impor absensi CSV</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Format per baris: <code>kode;tanggal;status;masuk;pulang;catatan</code> — status: hadir/izin/sakit/cuti/alpa.
          Contoh: <code>EMP-001;2026-11-02;hadir;08:05;17:00;</code>
        </p>
      </div>
      <div className="space-y-2 p-4">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          className="w-full rounded-md border border-input bg-background px-2.5 py-2 font-mono text-[11px] outline-none focus:border-ring"
          placeholder={"kode;tanggal;status;masuk;pulang;catatan"}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Mengimpor…" : "Impor"}
        </button>
      </div>
    </div>
  );
}
