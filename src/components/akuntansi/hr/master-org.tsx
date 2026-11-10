/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — master organisasi (departemen/jabatan).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  saveDepartmentAction,
  saveJobPositionAction,
  setDepartmentActiveAction,
  setJobPositionActiveAction,
} from "@/server/actions/hr/organisasi";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { RowMenu } from "@/components/blocks/row-menu";
import { EmptyState } from "@/components/blocks/empty-state";

export type MasterRow = { id: string; code: string; name: string; isActive: boolean };

/** CRUD ringkas master departemen/jabatan (§6A): buat, ubah, nonaktifkan. */
export function MasterOrgManager({
  kind,
  rows,
}: {
  kind: "department" | "position";
  rows: MasterRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const label = kind === "department" ? "Departemen" : "Jabatan";

  function startEdit(row?: MasterRow) {
    setEditing(row ?? null);
    setCode(row?.code ?? "");
    setName(row?.name ?? "");
  }

  async function submit() {
    if (!code.trim() || name.trim().length < 2) {
      toast.error("Kode dan nama wajib diisi.");
      return;
    }
    setBusy(true);
    const result =
      kind === "department"
        ? await saveDepartmentAction({ id: editing?.id, code, name })
        : await saveJobPositionAction({ id: editing?.id, code, name });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${label} disimpan.`);
    startEdit(undefined);
    setEditing(null);
    setCode("");
    setName("");
    router.refresh();
  }

  async function toggle(row: MasterRow) {
    setBusy(true);
    const result =
      kind === "department"
        ? await setDepartmentActiveAction({ id: row.id, isActive: !row.isActive })
        : await setJobPositionActiveAction({ id: row.id, isActive: !row.isActive });
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
        <h2 className="text-[13px] font-semibold">{label}</h2>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-4 py-3">
        <label className="w-28 space-y-1">
          <span className={labelClass}>Kode</span>
          <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} />
        </label>
        <label className="min-w-44 flex-1 space-y-1">
          <span className={labelClass}>Nama</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {editing ? "Simpan perubahan" : `Tambah ${label.toLowerCase()}`}
        </button>
        {editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setCode("");
              setName("");
            }}
            className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
          >
            Batal
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState size="compact" title={`Belum ada ${label.toLowerCase()}.`} />
        </div>
      ) : (
        <ul className="divide-y divide-border/70 border-t border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="text-[12px]">
                <span className="num mr-2 text-[11px] text-muted-foreground">{row.code}</span>
                {row.name}
                {!row.isActive ? <span className="ml-2 text-[11px] text-muted-foreground">(nonaktif)</span> : null}
              </span>
              {/* G3 (UX4-01): Ubah + Nonaktifkan masuk menu ⋯ —
                  sebelumnya dua tombol permanen per baris. Ubah tetap
                  memicu editor inline di panel yang sama. */}
              <RowMenu
                label={`Aksi untuk ${label.toLowerCase()} ${row.name}`}
                items={[
                  { key: "edit", label: "Ubah" },
                  { key: "toggle", label: row.isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
                ]}
                onAction={(key) => {
                  if (key === "edit") startEdit(row);
                  if (key === "toggle") void toggle(row);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
