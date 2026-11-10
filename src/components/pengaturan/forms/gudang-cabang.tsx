/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — gudang & cabang (form & aksi baris).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { deleteWarehouseAction, saveBranchAction, saveWarehouseAction, toggleWarehouseAction } from "@/server/actions/settings/lokasi";
import { fieldClass } from "@/components/blocks/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { requireFilled } from "@/components/use-action-runner";
import { Field, Modal } from "./shared";

export type WarehouseInput = {
  id: string;
  code: string;
  name: string;
  type: string;
  branchId: string | null;
  isDefault: boolean;
  isActive: boolean;
};

export function WarehouseForm({
  branches,
  warehouse,
}: {
  branches: { id: string; name: string }[];
  warehouse?: WarehouseInput;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: warehouse?.code ?? "",
    name: warehouse?.name ?? "",
    type: warehouse?.type ?? "warehouse",
    branchId: warehouse?.branchId ?? "",
    isDefault: warehouse?.isDefault ?? false,
    isActive: warehouse?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    // G2 (FRM-05): validasi wajib-isi kini helper bersama.
    if (!requireFilled(form.code, "Kode dan nama gudang wajib diisi.") || !requireFilled(form.name, "Kode dan nama gudang wajib diisi.")) {
      return;
    }
    setBusy(true);
    const result = await saveWarehouseAction({
      id: warehouse?.id,
      code: form.code,
      name: form.name,
      type: form.type as "warehouse" | "store" | "quarantine",
      branchId: form.branchId || null,
      isDefault: form.isDefault,
      isActive: form.isActive,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(warehouse ? "Gudang diperbarui." : "Gudang disimpan.");
    if (!warehouse) {
      setForm({ code: "", name: "", type: "warehouse", branchId: "", isDefault: false, isActive: true });
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          warehouse
            ? "inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
        }
      >
        {warehouse ? <Save className="size-3" /> : <Plus className="size-3.5" />}
        {warehouse ? "Ubah" : "Gudang baru"}
      </button>
      {open ? (
        <Modal title={warehouse ? "Ubah gudang" : "Gudang baru"} onClose={() => setOpen(false)} onSubmit={submit} busy={busy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kode"><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className={fieldClass} placeholder="GDG-02" /></Field>
            <Field label="Nama"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} /></Field>
            <Field label="Jenis">
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className={fieldClass}>
                <option value="warehouse">Gudang</option>
                <option value="store">Toko</option>
                <option value="quarantine">Karantina</option>
              </select>
            </Field>
            <Field label="Cabang">
              <select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })} className={fieldClass}>
                <option value="">Tanpa cabang</option>
                {branches.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
              <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />
              Jadikan gudang utama
            </label>
            {warehouse ? (
              <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Gudang aktif
              </label>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function WarehouseRowActions({
  id,
  name,
  isActive,
}: {
  id: string;
  name: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function toggle() {
    setBusy(true);
    const result = await toggleWarehouseAction({ id, isActive: !isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(isActive ? "Gudang dinonaktifkan." : "Gudang diaktifkan.");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await deleteWarehouseAction(id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Gudang dihapus.");
    router.refresh();
  }

  // G3 (UX4-01): aksi baris gudang kini satu menu ⋯ (pola Produk) —
  // sebelumnya dua tombol permanen Nonaktifkan + Hapus per baris.
  return (
    <>
      <RowMenu
        label={`Aksi untuk gudang ${name}`}
        items={[
          { key: "toggle", label: isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
          { key: "delete", label: "Hapus", danger: true, disabled: busy },
        ]}
        onAction={(key) => {
          if (key === "toggle") void toggle();
          if (key === "delete") setConfirming(true);
        }}
      />
      <ConfirmDialog
        open={confirming}
        title={`Hapus gudang "${name}"?`}
        description="Gudang yang masih berstok atau sudah bertransaksi tidak bisa dihapus."
        confirmLabel="Hapus gudang"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export function BranchForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", address: "", phone: "", isDefault: false });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!requireFilled(form.code, "Kode dan nama cabang wajib diisi.") || !requireFilled(form.name, "Kode dan nama cabang wajib diisi.")) {
      return;
    }
    setBusy(true);
    const result = await saveBranchAction({
      code: form.code,
      name: form.name,
      address: form.address || undefined,
      phone: form.phone || undefined,
      isDefault: form.isDefault,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Cabang disimpan.");
    setForm({ code: "", name: "", address: "", phone: "", isDefault: false });
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted">
        <MapPin className="size-3.5" /> Cabang baru
      </button>
      {open ? (
        <Modal title="Cabang baru" onClose={() => setOpen(false)} onSubmit={submit} busy={busy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kode"><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className={fieldClass} placeholder="CBG-02" /></Field>
            <Field label="Nama"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} /></Field>
            <Field label="Telepon"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={fieldClass} /></Field>
            <Field label="Alamat"><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={fieldClass} /></Field>
            <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
              <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />
              Jadikan cabang utama
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
