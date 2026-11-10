"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createTaxonomyAction,
  deleteTaxonomyAction,
  toggleCategoryAction,
  toggleUnitAction,
  updateTaxonomyAction,
} from "@/server/actions/inventory/taksonomi";
import { descendantIds, sortCategoryTree } from "@/lib/categories";
import { fieldClass } from "@/components/blocks/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { Modal } from "@/components/blocks/modal";
import { SectionTitle } from "@/components/blocks/page-header";
import { StatusBadge } from "@/components/blocks/status-badge";
import { RowMenu } from "@/components/blocks/row-menu";
import { requireFilled } from "@/components/use-action-runner";

export type CategoryRow = { id: string; name: string; parentId: string | null; isActive: boolean };
export type UnitRow = { id: string; code: string; name: string; isActive: boolean };

type EditTarget =
  | { kind: "category"; id: string; name: string; parentId: string | null }
  | { kind: "unit"; id: string; name: string; code: string }
  | null;

export function TaxonomyManager({
  categories,
  units,
}: {
  categories: CategoryRow[];
  units: UnitRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditTarget>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "category" | "unit"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryParent, setNewCategoryParent] = useState("");
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitCode, setNewUnitCode] = useState("");

  // T5-3 (D-17): categories render as a tree — parents above children,
  // names indented by depth.
  const categoryTree = sortCategoryTree(categories);
  // Parent candidates when editing: everything except the category
  // itself and its own descendants (the server rejects cycles too).
  const editParentOptions =
    editing?.kind === "category"
      ? categoryTree.filter((row) => !descendantIds(categories, editing.id).has(row.id))
      : [];

  async function createCategory() {
    // G2 (FRM-05): validasi wajib-isi kini helper bersama.
    if (!requireFilled(newCategory, "Nama kategori wajib diisi.")) return;
    setBusy(true);
    const result = await createTaxonomyAction({
      kind: "category",
      name: newCategory,
      parentId: newCategoryParent || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Kategori ditambahkan.");
    setNewCategory("");
    setNewCategoryParent("");
    router.refresh();
  }

  async function createUnit() {
    if (!requireFilled(newUnitName, "Nama satuan wajib diisi.")) return;
    setBusy(true);
    const result = await createTaxonomyAction({
      kind: "unit",
      name: newUnitName,
      code: newUnitCode.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Satuan ditambahkan.");
    setNewUnitName("");
    setNewUnitCode("");
    router.refresh();
  }

  async function toggleCategory(row: CategoryRow) {
    setBusy(true);
    const result = await toggleCategoryAction({ id: row.id, isActive: !row.isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(row.isActive ? "Kategori dinonaktifkan." : "Kategori diaktifkan.");
    router.refresh();
  }

  async function toggleUnit(row: UnitRow) {
    setBusy(true);
    const result = await toggleUnitAction({ id: row.id, isActive: !row.isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(row.isActive ? "Satuan dinonaktifkan." : "Satuan diaktifkan.");
    router.refresh();
  }

  async function remove() {
    if (!pendingDelete) return;
    const { kind, id } = pendingDelete;
    const label = kind === "category" ? "kategori" : "satuan";
    setBusy(true);
    const result = await deleteTaxonomyAction({ kind, id });
    setBusy(false);
    setPendingDelete(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${label === "kategori" ? "Kategori" : "Satuan"} dihapus.`);
    router.refresh();
  }

  async function saveEdit() {
    if (!editing) return;
    if (!requireFilled(editing.name, "Nama wajib diisi.")) return;
    setBusy(true);
    const result = await updateTaxonomyAction(
      editing.kind === "category"
        ? { kind: "category", id: editing.id, name: editing.name, parentId: editing.parentId }
        : { kind: "unit", id: editing.id, name: editing.name, code: editing.code },
    );
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Perubahan disimpan.");
    setEditing(null);
    router.refresh();
  }

  // A-25 U2: pengelola ini kini hidup di dalam drawer "Kategori &
  // satuan" dari halaman Produk (bukan lagi dua panel bertumpuk di
  // bawah daftar produk — POLA-01). Kepala seksi memakai SectionTitle
  // bersama dan aksi baris memakai menu ⋯ (RowMenu, POLA-07); logika
  // & aksi server tidak berubah.
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <SectionTitle
          title="Kategori produk"
          description="Kategori nonaktif tidak tampil pada pilihan produk."
        />
        <div className="flex gap-2 border-b border-border px-4 py-2.5">
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="Nama kategori baru"
            className={fieldClass}
          />
          <select
            value={newCategoryParent}
            onChange={(event) => setNewCategoryParent(event.target.value)}
            className={`${fieldClass} w-44 shrink-0`}
            aria-label="Kategori induk"
          >
            <option value="">Tanpa induk</option>
            {categoryTree.map((row) => (
              <option key={row.id} value={row.id}>
                {"— ".repeat(row.depth)}
                {row.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={createCategory} disabled={busy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Plus className="size-3.5" /> Tambah
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>Nama</th><th>Status</th><th className="text-right">Aksi</th></tr>
          </thead>
          <tbody>
            {categoryTree.map((row) => (
              <tr key={row.id}>
                <td className="text-[12px] font-medium">
                  <span style={{ paddingLeft: row.depth * 14 }}>{row.name}</span>
                </td>
                <td>
                  <StatusBadge status={row.isActive ? "active" : "inactive"} />
                </td>
                <td>
                  <div className="flex justify-end">
                    <RowMenu
                      label={`Aksi untuk kategori ${row.name}`}
                      items={[
                        { key: "edit", label: "Ubah" },
                        { key: "toggle", label: row.isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
                        { key: "delete", label: "Hapus", danger: true, disabled: busy },
                      ]}
                      onAction={(key) => {
                        if (key === "edit") setEditing({ kind: "category", id: row.id, name: row.name, parentId: row.parentId });
                        if (key === "toggle") void toggleCategory(row);
                        if (key === "delete") setPendingDelete({ kind: "category", id: row.id, name: row.name });
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {categories.length === 0 ? (
              <tr><td colSpan={3} className="py-6 text-center text-[11px] text-muted-foreground">Belum ada kategori.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <SectionTitle
          title="Satuan"
          description="Kode satuan harus unik, misalnya PCS, BOX, KG. Satuan nonaktif tidak tampil pada pilihan produk."
        />
        <div className="flex gap-2 border-b border-border px-4 py-2.5">
          <input
            value={newUnitCode}
            onChange={(event) => setNewUnitCode(event.target.value)}
            placeholder="Kode"
            className={`${fieldClass} w-24 shrink-0`}
          />
          <input
            value={newUnitName}
            onChange={(event) => setNewUnitName(event.target.value)}
            placeholder="Nama satuan baru"
            className={fieldClass}
          />
          <button type="button" onClick={createUnit} disabled={busy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Plus className="size-3.5" /> Tambah
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>Kode</th><th>Nama</th><th>Status</th><th className="text-right">Aksi</th></tr>
          </thead>
          <tbody>
            {units.map((row) => (
              <tr key={row.id}>
                <td className="num text-[12px]">{row.code}</td>
                <td className="text-[12px] font-medium">{row.name}</td>
                <td>
                  <StatusBadge status={row.isActive ? "active" : "inactive"} />
                </td>
                <td>
                  <div className="flex justify-end">
                    <RowMenu
                      label={`Aksi untuk satuan ${row.name}`}
                      items={[
                        { key: "edit", label: "Ubah" },
                        { key: "toggle", label: row.isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
                        { key: "delete", label: "Hapus", danger: true, disabled: busy },
                      ]}
                      onAction={(key) => {
                        if (key === "edit") setEditing({ kind: "unit", id: row.id, name: row.name, code: row.code });
                        if (key === "toggle") void toggleUnit(row);
                        if (key === "delete") setPendingDelete({ kind: "unit", id: row.id, name: row.name });
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {units.length === 0 ? (
              <tr><td colSpan={4} className="py-6 text-center text-[11px] text-muted-foreground">Belum ada satuan.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </section>

      {editing ? (
        <Modal
          title={editing.kind === "category" ? "Ubah kategori" : "Ubah satuan"}
          onClose={() => setEditing(null)}
          onSubmit={() => void saveEdit()}
          busy={busy}
        >
            <div className="grid gap-2">
              {editing.kind === "unit" ? (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kode</span>
                  <input
                    value={editing.code}
                    onChange={(event) => setEditing({ ...editing, code: event.target.value })}
                    className={fieldClass}
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Nama</span>
                <input
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  className={fieldClass}
                />
              </label>
              {editing.kind === "category" ? (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kategori induk</span>
                  <select
                    value={editing.parentId ?? ""}
                    onChange={(event) =>
                      setEditing({ ...editing, parentId: event.target.value || null })
                    }
                    className={fieldClass}
                  >
                    <option value="">Tanpa induk</option>
                    {editParentOptions.map((row) => (
                      <option key={row.id} value={row.id}>
                        {"— ".repeat(row.depth)}
                        {row.name}
                      </option>
                    ))}
                  </select>
                  <span className="block text-[10px] leading-4 text-muted-foreground">
                    Kategori tidak dapat menjadi induk bagi dirinya atau keturunannya.
                  </span>
                </label>
              ) : null}
            </div>
        </Modal>
      ) : null}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete
            ? `Hapus ${pendingDelete.kind === "category" ? "kategori" : "satuan"} "${pendingDelete.name}"?`
            : ""
        }
        description={`${pendingDelete?.kind === "category" ? "Kategori" : "Satuan"} yang masih dipakai produk tidak bisa dihapus — server akan menolaknya. Penghapusan ini permanen.`}
        confirmLabel="Hapus"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
