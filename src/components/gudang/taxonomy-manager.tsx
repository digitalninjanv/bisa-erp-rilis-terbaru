"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderTree, Plus, Ruler, Search } from "lucide-react";
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
import { StatusBadge } from "@/components/blocks/status-badge";
import { RowMenu } from "@/components/blocks/row-menu";
import { requireFilled } from "@/components/use-action-runner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

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
  const [activeTab, setActiveTab] = useState<"categories" | "units">("categories");
  const [editing, setEditing] = useState<EditTarget>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "category" | "unit"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Form tambah kategori
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryParent, setNewCategoryParent] = useState("");

  // Form tambah satuan
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitCode, setNewUnitCode] = useState("");

  // Filter pencarian di dalam drawer
  const [searchCategory, setSearchCategory] = useState("");
  const [searchUnit, setSearchUnit] = useState("");

  // T5-3 (D-17): kategori bertingkat sebagai pohon terurut
  const categoryTree = useMemo(() => sortCategoryTree(categories), [categories]);

  // Filter kategori berdasarkan pencarian
  const filteredCategories = useMemo(() => {
    if (!searchCategory.trim()) return categoryTree;
    const q = searchCategory.toLowerCase();
    return categoryTree.filter((cat) => cat.name.toLowerCase().includes(q) || (cat.path && cat.path.toLowerCase().includes(q)));
  }, [categoryTree, searchCategory]);

  // Filter satuan berdasarkan pencarian
  const filteredUnits = useMemo(() => {
    if (!searchUnit.trim()) return units;
    const q = searchUnit.toLowerCase();
    return units.filter((u) => u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q));
  }, [units, searchUnit]);

  // Opsi induk kategori saat ubah (menghindari rekursi/siklus)
  const editParentOptions = useMemo(() => {
    if (editing?.kind !== "category") return [];
    const forbidden = descendantIds(categories, editing.id);
    return categoryTree.filter((row) => !forbidden.has(row.id));
  }, [categories, categoryTree, editing]);

  async function createCategory() {
    if (!requireFilled(newCategory, "Nama kategori wajib diisi.")) return;
    setBusy(true);
    const result = await createTaxonomyAction({
      kind: "category",
      name: newCategory.trim(),
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
      name: newUnitName.trim(),
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
    toast.success(`${label === "kategori" ? "Kategori" : "Satuan"} berhasil dihapus.`);
    router.refresh();
  }

  async function saveEdit() {
    if (!editing) return;
    if (!requireFilled(editing.name, "Nama wajib diisi.")) return;
    setBusy(true);
    const result = await updateTaxonomyAction(
      editing.kind === "category"
        ? { kind: "category", id: editing.id, name: editing.name.trim(), parentId: editing.parentId }
        : { kind: "unit", id: editing.id, name: editing.name.trim(), code: editing.code.trim() },
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

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as "categories" | "units")}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="categories" className="gap-2 text-[12px]">
            <FolderTree className="size-3.5" />
            <span>Kategori</span>
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
              {categoryTree.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="units" className="gap-2 text-[12px]">
            <Ruler className="size-3.5" />
            <span>Satuan</span>
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
              {units.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: KATEGORI PRODUK */}
        <TabsContent value="categories" className="mt-3 space-y-3">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <p className="text-[13px] font-semibold text-foreground">Kategori Produk</p>
              <p className="text-[11px] text-muted-foreground">
                Kategori produk dapat bertingkat (induk dan sub-kategori). Kategori nonaktif tidak tampil pada kasir POS.
              </p>
            </div>

            {/* FORM TAMBAH KATEGORI YANG BERSIH & RESPOMSIF */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createCategory();
              }}
              className="flex flex-col gap-2 border-b border-border bg-muted/10 p-3 sm:flex-row sm:items-center"
            >
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Nama kategori baru..."
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
              <select
                value={newCategoryParent}
                onChange={(e) => setNewCategoryParent(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 sm:w-48"
                aria-label="Kategori induk"
              >
                <option value="">Tanpa induk (Utama)</option>
                {categoryTree.map((row) => (
                  <option key={row.id} value={row.id}>
                    {"— ".repeat(row.depth)}
                    {row.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy || !newCategory.trim()}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="size-3.5" /> Tambah
              </button>
            </form>

            {/* PENCARIAN KATEGORI */}
            {categoryTree.length > 5 ? (
              <div className="border-b border-border px-3 py-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchCategory}
                    onChange={(e) => setSearchCategory(e.target.value)}
                    placeholder="Saring kategori..."
                    className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>
            ) : null}

            {/* TABEL KATEGORI */}
            <div className="overflow-x-auto contain-paint">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Nama Kategori</th>
                    <th className="w-24">Status</th>
                    <th className="w-16 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.map((row) => {
                    const isChild = row.depth > 0;
                    return (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="text-[12px]">
                          <div
                            className="flex items-center gap-1.5"
                            style={{ paddingLeft: `${row.depth * 18}px` }}
                          >
                            {isChild ? (
                              <span className="font-mono text-[11px] text-muted-foreground/70">↳</span>
                            ) : null}
                            <span className={isChild ? "text-foreground" : "font-semibold text-foreground"}>
                              {row.name}
                            </span>
                            {isChild && row.path ? (
                              <span className="hidden text-[10px] text-muted-foreground lg:inline">
                                ({row.path})
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={row.isActive ? "active" : "inactive"} />
                        </td>
                        <td>
                          <div className="flex justify-end">
                            <RowMenu
                              label={`Aksi untuk kategori ${row.name}`}
                              items={[
                                { key: "edit", label: "Ubah nama / induk" },
                                { key: "toggle", label: row.isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
                                { key: "delete", label: "Hapus", danger: true, disabled: busy },
                              ]}
                              onAction={(key) => {
                                if (key === "edit") {
                                  setEditing({ kind: "category", id: row.id, name: row.name, parentId: row.parentId });
                                }
                                if (key === "toggle") void toggleCategory(row);
                                if (key === "delete") {
                                  setPendingDelete({ kind: "category", id: row.id, name: row.name });
                                }
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCategories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-[12px] text-muted-foreground">
                        {searchCategory ? "Tidak ada kategori yang cocok dengan pencarian." : "Belum ada kategori produk."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: SATUAN PRODUK */}
        <TabsContent value="units" className="mt-3 space-y-3">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <p className="text-[13px] font-semibold text-foreground">Satuan Produk</p>
              <p className="text-[11px] text-muted-foreground">
                Satuan dasar untuk penghitungan kuantitas stok produk (misal: PCS, BOX, KG, LTR).
              </p>
            </div>

            {/* FORM TAMBAH SATUAN YANG BERSIH & RESPONSIF */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createUnit();
              }}
              className="flex flex-col gap-2 border-b border-border bg-muted/10 p-3 sm:flex-row sm:items-center"
            >
              <input
                value={newUnitCode}
                onChange={(e) => setNewUnitCode(e.target.value)}
                placeholder="Kode (PCS)"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-[12px] font-medium uppercase outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 sm:w-28"
              />
              <input
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
                placeholder="Nama satuan (Pieces)..."
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
              <button
                type="submit"
                disabled={busy || !newUnitName.trim()}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Plus className="size-3.5" /> Tambah
              </button>
            </form>

            {/* PENCARIAN SATUAN */}
            {units.length > 5 ? (
              <div className="border-b border-border px-3 py-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchUnit}
                    onChange={(e) => setSearchUnit(e.target.value)}
                    placeholder="Saring satuan..."
                    className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>
            ) : null}

            {/* TABEL SATUAN */}
            <div className="overflow-x-auto contain-paint">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th className="w-24">Kode</th>
                    <th>Nama Satuan</th>
                    <th className="w-24">Status</th>
                    <th className="w-16 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnits.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/40">
                      <td className="num text-[12px] font-semibold text-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5">{row.code}</span>
                      </td>
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
                              if (key === "edit") {
                                setEditing({ kind: "unit", id: row.id, name: row.name, code: row.code });
                              }
                              if (key === "toggle") void toggleUnit(row);
                              if (key === "delete") {
                                setPendingDelete({ kind: "unit", id: row.id, name: row.name });
                              }
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUnits.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-[12px] text-muted-foreground">
                        {searchUnit ? "Tidak ada satuan yang cocok dengan pencarian." : "Belum ada satuan produk."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* MODAL UBAH KATEGORI ATAU SATUAN */}
      {editing ? (
        <Modal
          title={editing.kind === "category" ? "Ubah Kategori" : "Ubah Satuan"}
          onClose={() => setEditing(null)}
          onSubmit={() => void saveEdit()}
          busy={busy}
        >
          <div className="grid gap-3 py-1">
            {editing.kind === "unit" ? (
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kode Satuan</span>
                <input
                  value={editing.code}
                  onChange={(event) => setEditing({ ...editing, code: event.target.value.toUpperCase() })}
                  className={`${fieldClass} uppercase font-semibold`}
                  placeholder="Misal: PCS"
                />
              </label>
            ) : null}

            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Nama</span>
              <input
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                className={fieldClass}
                placeholder="Nama lengkap..."
              />
            </label>

            {editing.kind === "category" ? (
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kategori Induk</span>
                <select
                  value={editing.parentId ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, parentId: event.target.value || null })
                  }
                  className={fieldClass}
                >
                  <option value="">Tanpa induk (Kategori Utama)</option>
                  {editParentOptions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {"— ".repeat(row.depth)}
                      {row.name}
                    </option>
                  ))}
                </select>
                <span className="block text-[10px] leading-4 text-muted-foreground">
                  Kategori tidak dapat menjadi induk bagi dirinya sendiri atau sub-kategorinya.
                </span>
              </label>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {/* DIALOG KONFIRMASI HAPUS */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete
            ? `Hapus ${pendingDelete.kind === "category" ? "kategori" : "satuan"} "${pendingDelete.name}"?`
            : ""
        }
        description={`${pendingDelete?.kind === "category" ? "Kategori" : "Satuan"} yang sedang dipakai oleh produk tidak dapat dihapus — server akan menolak penghapusan untuk menjaga integritas data.`}
        confirmLabel="Hapus"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
