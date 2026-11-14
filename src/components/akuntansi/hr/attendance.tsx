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
  recordAttendanceBatchAction,
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

type AttendanceDraft = {
  status: "" | "present" | "permit" | "sick" | "leave" | "absent";
  checkIn: string;
  checkOut: string;
  note: string;
};

type ExistingAttendance = {
  employeeId: string;
  status: AttendanceDraft["status"];
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
};

/** Roster harian: status beberapa karyawan dapat disimpan sekaligus dalam satu transaksi. */
export function AttendanceBatchForm({
  employees,
  date,
  records,
}: {
  employees: SimpleEmployee[];
  date: string;
  records: ExistingAttendance[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const existingByEmployee = new Map(records.map((row) => [row.employeeId, row]));
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>(() =>
    Object.fromEntries(
      employees.map((employee) => {
        const existing = existingByEmployee.get(employee.id);
        return [employee.id, {
          status: existing?.status ?? "",
          checkIn: existing?.checkIn?.slice(0, 5) ?? "",
          checkOut: existing?.checkOut?.slice(0, 5) ?? "",
          note: existing?.note ?? "",
        }];
      }),
    ),
  );
  const filteredEmployees = employees.filter((employee) =>
    `${employee.code} ${employee.name}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const markedCount = Object.values(drafts).filter((entry) => entry.status !== "").length;

  function update(employeeId: string, patch: Partial<AttendanceDraft>) {
    setDrafts((current) => ({
      ...current,
      [employeeId]: { ...current[employeeId], ...patch },
    }));
  }

  async function submit() {
    const entries = employees.flatMap((employee) => {
      const entry = drafts[employee.id];
      return entry?.status
        ? [{ employeeId: employee.id, status: entry.status, checkIn: entry.checkIn || null, checkOut: entry.checkOut || null, note: entry.note || null }]
        : [];
    });
    if (entries.length === 0) {
      toast.error("Pilih status untuk minimal satu karyawan.");
      return;
    }
    setBusy(true);
    const result = await recordAttendanceBatchAction({ date, entries });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${result.data.saved} catatan presensi tersimpan untuk ${date}.`);
    router.refresh();
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Daftar hadir · {date}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Pilih status tiap karyawan. Jam masuk dan pulang opsional; yang kosong tidak menghalangi penyimpanan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDrafts((current) => Object.fromEntries(
              Object.entries(current).map(([employeeId, entry]) => [
                employeeId,
                entry.status ? entry : { ...entry, status: "present" },
              ]),
            ))}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium transition-colors hover:bg-muted"
          >
            Isi yang belum dicatat sebagai hadir
          </button>
          <label className="sr-only" htmlFor="attendance-roster-search">Cari karyawan</label>
          <input
            id="attendance-roster-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-44 rounded-md border border-input bg-background px-2.5 text-[12px]"
            placeholder="Cari karyawan…"
          />
        </div>
      </div>

      <div className="divide-y divide-border/70">
        {filteredEmployees.map((employee) => {
          const entry = drafts[employee.id] ?? { status: "", checkIn: "", checkOut: "", note: "" };
          return (
            <div key={employee.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(140px,1fr)_150px_108px_108px] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium">{employee.name}</p>
                <p className="num text-[10px] text-muted-foreground">{employee.code}</p>
              </div>
              <label className="space-y-1">
                <span className={`${labelClass} sm:sr-only`}>Status</span>
                <select
                  value={entry.status}
                  onChange={(event) => update(employee.id, { status: event.target.value as AttendanceDraft["status"] })}
                  className={fieldClass}
                  aria-label={`Status presensi ${employee.name}`}
                >
                  <option value="">Belum dicatat</option>
                  {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={`${labelClass} sm:sr-only`}>Masuk</span>
                <input
                  type="time"
                  value={entry.checkIn}
                  onChange={(event) => update(employee.id, { checkIn: event.target.value })}
                  className={fieldClass}
                  aria-label={`Jam masuk ${employee.name}`}
                />
              </label>
              <label className="space-y-1">
                <span className={`${labelClass} sm:sr-only`}>Pulang</span>
                <input
                  type="time"
                  value={entry.checkOut}
                  onChange={(event) => update(employee.id, { checkOut: event.target.value })}
                  className={fieldClass}
                  aria-label={`Jam pulang ${employee.name}`}
                />
              </label>
            </div>
          );
        })}
        {filteredEmployees.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">Karyawan tidak ditemukan.</p>
        ) : null}
        {employees.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">Belum ada karyawan aktif.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3">
        <p className="text-[11px] text-muted-foreground">{markedCount} dari {employees.length} karyawan diberi status.</p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || markedCount === 0}
          className="h-9 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Menyimpan…" : `Simpan ${markedCount} catatan`}
        </button>
      </div>
    </section>
  );
}

export function AttendanceEntryForm({ employees, defaultDate = "" }: { employees: SimpleEmployee[]; defaultDate?: string }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(defaultDate);
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
