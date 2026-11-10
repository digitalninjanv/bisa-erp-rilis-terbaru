"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  cancelOpnameTaskAction,
  completeOpnameTaskAction,
  createOpnameTaskAction,
} from "@/server/actions/inventory/opname";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { DateField } from "@/components/date-field";
import { formatDate } from "@/lib/format";

export type OpnameTaskView = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  categoryId: string | null;
  categoryName: string | null;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
  status: string;
  documentId: string | null;
  documentNumber: string | null;
  notes: string | null;
};

/**
 * A-24 T3 (pola G3): panel tugas opname. Opname menjadi TUGAS —
 * dibuat dengan penanggung jawab + cakupan (gudang/kategori);
 * tugas selesai otomatis saat yang ditugasi memposting opname di
 * gudang tugasnya (domain), atau ditandai selesai/batal di sini.
 * Hitung buta tidak berubah: panel ini tidak menampilkan stok sistem.
 */
export function OpnameTasksPanel({
  tasks,
  canManage,
  currentUserId,
  warehouses,
  categories,
  assignees,
  today,
  embedded = false,
}: {
  tasks: OpnameTaskView[];
  canManage: boolean;
  currentUserId: string;
  warehouses: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  assignees: { userId: string; name: string }[];
  today: string;
  /**
   * A-25 U3: panel hidup di dalam tab "Tugas" halaman opname —
   * cangkang kartu & kepala seksinya tidak digambar dua kali
   * (tab sudah memberi konteksnya); penjelasan hitung buta pindah
   * ke satu baris ringkas di atas form.
   */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [assigneeId, setAssigneeId] = useState(assignees[0]?.userId ?? "");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<OpnameTaskView | null>(null);

  const openTasks = tasks.filter((task) => task.status === "open");
  const closedTasks = tasks.filter((task) => task.status !== "open").slice(0, 8);

  async function create() {
    if (!warehouseId) {
      toast.error("Pilih gudang tugas.");
      return;
    }
    if (!assigneeId) {
      toast.error("Pilih penanggung jawab.");
      return;
    }
    setBusy(true);
    const result = await createOpnameTaskAction({
      warehouseId,
      categoryId: categoryId || null,
      assigneeId,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Tugas opname dibuat.");
    setNotes("");
    setDueDate("");
    router.refresh();
  }

  async function complete(task: OpnameTaskView) {
    setBusy(true);
    const result = await completeOpnameTaskAction({ id: task.id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      result.data?.documentId
        ? "Tugas selesai dan tertaut ke dokumen opname terakhir penanggung jawab."
        : "Tugas ditandai selesai.",
    );
    router.refresh();
  }

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    const result = await cancelOpnameTaskAction({ id: cancelling.id });
    setBusy(false);
    setCancelling(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Tugas opname dibatalkan.");
    router.refresh();
  }

  return (
    <section className={embedded ? "" : "mb-4 rounded-lg border border-border bg-card"}>
      {embedded ? (
        <p className="mb-3 max-w-2xl text-[12px] leading-5 text-muted-foreground">
          Opname yang ditugaskan ke orang &amp; cakupan tertentu. Tugas selesai otomatis saat
          penanggung jawab memposting opname di gudang tugasnya; hitungan tetap buta — angka
          sistem tidak ditampilkan di sini.
        </p>
      ) : (
        <div className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <ClipboardList className="size-4 text-primary" /> Tugas opname
          </h2>
          <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
            Opname yang ditugaskan ke orang &amp; cakupan tertentu. Tugas selesai otomatis saat
            penanggung jawab memposting opname di gudang tugasnya; hitungan tetap buta — angka
            sistem tidak ditampilkan di sini.
          </p>
        </div>
      )}

      {canManage ? (
        <div
          className={
            embedded
              ? "grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 mb-3"
              : "grid gap-2 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          <label className="space-y-1">
            <span className={labelClass}>Gudang</span>
            <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={fieldClass}>
              {warehouses.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Cakupan kategori (opsional)</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={fieldClass}>
              <option value="">Seluruh gudang</option>
              {categories.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Penanggung jawab</span>
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className={fieldClass}>
              {assignees.map((row) => (
                <option key={row.userId} value={row.userId}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Target selesai (opsional)</span>
            {/* A-25 U3: DateField bersama — tampilan selalu dd/mm/yyyy,
                bukan format AS input native (POLA-03). */}
            <DateField value={dueDate} onChange={setDueDate} aria-label="Target selesai" />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2">
            <label className="min-w-0 flex-1 space-y-1">
              <span className={labelClass}>Catatan (opsional)</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Cth. rak minuman &amp; susu" />
            </label>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="size-3.5" /> Buat tugas
            </button>
          </div>
        </div>
      ) : null}

      <div className={embedded ? "overflow-hidden rounded-lg border border-border bg-card" : undefined}>
      {openTasks.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-muted-foreground">
          Tidak ada tugas opname terbuka.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {openTasks.map((task) => {
            const overdue = task.dueDate !== null && task.dueDate < today;
            const mine = task.assigneeId === currentUserId;
            return (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-[220px] flex-1">
                  <p className="text-[12px] font-medium">
                    {task.warehouseName}
                    {task.categoryName ? ` · ${task.categoryName}` : " · seluruh gudang"}
                    {mine ? (
                      <span className="ml-1.5 rounded-full bg-tone-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-amber">
                        Tugas saya
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Penanggung jawab: {task.assigneeName}
                    {task.dueDate ? (
                      <>
                        {" · target "}
                        <span className={overdue ? "font-semibold text-destructive" : ""}>
                          {formatDate(task.dueDate)}{overdue ? " (lewat)" : ""}
                        </span>
                      </>
                    ) : null}
                    {task.notes ? ` · ${task.notes}` : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Link
                    href={`/app/gudang/opname/lembar-hitung?warehouse=${task.warehouseId}`}
                    className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] font-medium hover:bg-muted"
                  >
                    Lembar hitung
                  </Link>
                  <Link
                    href={`/app/gudang/opname?warehouse=${task.warehouseId}`}
                    className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] font-medium hover:bg-muted"
                  >
                    Buka form opname
                  </Link>
                  {mine || canManage ? (
                    <button
                      type="button"
                      onClick={() => void complete(task)}
                      disabled={busy}
                      className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Tandai selesai
                    </button>
                  ) : null}
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setCancelling(task)}
                      disabled={busy}
                      className="inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      Batalkan
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {closedTasks.length > 0 ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Terakhir selesai / dibatalkan
          </p>
          <ul className="mt-1.5 space-y-1">
            {closedTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    task.status === "done"
                      ? "bg-tone-green-soft text-tone-green"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {task.status === "done" ? "Selesai" : "Dibatalkan"}
                </span>
                <span className="font-medium text-foreground">
                  {task.warehouseName}
                  {task.categoryName ? ` · ${task.categoryName}` : ""}
                </span>
                <span>{task.assigneeName}</span>
                {task.documentId && task.documentNumber ? (
                  <Link href={`/app/gudang/dokumen/${task.documentId}`} className="num text-primary hover:underline">
                    {task.documentNumber}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>

      <ConfirmDialog
        open={cancelling !== null}
        title="Batalkan tugas opname?"
        description={
          cancelling
            ? `Tugas opname ${cancelling.warehouseName}${cancelling.categoryName ? ` · ${cancelling.categoryName}` : ""} untuk ${cancelling.assigneeName} akan dibatalkan. Opname yang sudah terposting tidak terpengaruh.`
            : undefined
        }
        confirmLabel="Ya, batalkan tugas"
        danger
        busy={busy}
        onCancel={() => setCancelling(null)}
        onConfirm={() => void cancel()}
      />
    </section>
  );
}
