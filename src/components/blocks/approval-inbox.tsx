"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Inbox } from "lucide-react";
import { toast } from "sonner";
import {
  decideLeaveRequestAction,
  decideOvertimeRequestAction,
} from "@/server/actions/hr/cuti-lembur";
import { decideReimbursementClaimAction } from "@/server/actions/reimbursements";
import { decidePurchaseRequestAction } from "@/server/actions/purchase-requests";
import {
  approveStockAdjustmentAction,
  rejectStockAdjustmentAction,
} from "@/server/actions/inventory/penyesuaian";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { EmptyState } from "@/components/blocks/empty-state";
import { cn } from "@/lib/utils";

/**
 * A-25 U2 — ApprovalInbox: daftar persetujuan GABUNGAN resmi
 * (ARAH-DESAIN-A25 §3.12). Satu daftar untuk semua jenis yang
 * menunggu keputusan; baris ringkas (jenis, pengaju, ringkasan,
 * nilai, umur) dengan Setujui/Tolak sebaris.
 *
 * Kontrak data: pemanggil (halaman server per modul, pemasangan
 * U5) memetakan antreannya menjadi `ApprovalItem[]` — komponen ini
 * TIDAK membaca data sendiri. Keputusan dijalankan lewat aksi
 * server yang SUDAH ada per jenis (tidak ada aksi baru):
 * - leave            → decideLeaveRequestAction({ id, approve, note })
 * - overtime         → decideOvertimeRequestAction({ id, approve, note })
 * - claim            → decideReimbursementClaimAction({ id, approve, note })
 * - purchase_request → decidePurchaseRequestAction({ requestId, approve, note })
 * - stock_adjustment → approveStockAdjustmentAction({ id }) /
 *                      rejectStockAdjustmentAction({ id, reason })
 * Penolakan selalu lewat dialog alasan (opsional untuk semua jenis
 * kecuali penyesuaian stok, yang domainnya mewajibkan alasan ≥3
 * karakter). Baris yang sudah diputuskan hilang dari daftar lokal
 * dan halaman disegarkan.
 */
export type ApprovalKind = "leave" | "overtime" | "claim" | "purchase_request" | "stock_adjustment";

export type ApprovalItem = {
  /** Id entitas sumber (uuid) — diteruskan apa adanya ke aksinya. */
  id: string;
  kind: ApprovalKind;
  /** Nama pengaju/karyawan. */
  requester: string;
  /** Ringkasan satu baris: tanggal, jumlah, alasan singkat. */
  summary: string;
  /** Nilai terformat siap tampil, mis. "Rp1.250.000" (opsional). */
  amount?: string;
  /** Umur pengajuan siap tampil, mis. "2 hari lalu" (opsional). */
  ageLabel?: string;
  /** Tautan ke detail entitas (opsional). */
  href?: string;
};

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  leave: "Cuti",
  overtime: "Lembur",
  claim: "Klaim",
  purchase_request: "Permintaan pembelian",
  stock_adjustment: "Penyesuaian stok",
};

type ActionResult = { ok: boolean; message?: string };

async function decideApproval(item: ApprovalItem, approve: boolean, note: string): Promise<ActionResult> {
  const trimmed = note.trim();
  switch (item.kind) {
    case "leave":
      return decideLeaveRequestAction({ id: item.id, approve, note: trimmed || undefined });
    case "overtime":
      return decideOvertimeRequestAction({ id: item.id, approve, note: trimmed || undefined });
    case "claim":
      return decideReimbursementClaimAction({ id: item.id, approve, note: trimmed || undefined });
    case "purchase_request":
      return decidePurchaseRequestAction({ requestId: item.id, approve, note: trimmed || undefined });
    case "stock_adjustment":
      return approve
        ? approveStockAdjustmentAction({ id: item.id })
        : rejectStockAdjustmentAction({ id: item.id, reason: trimmed });
  }
}

export function ApprovalInbox({
  items,
  title = "Persetujuan menunggu",
  emptyTitle = "Tidak ada persetujuan menunggu",
  emptyDescription = "Pengajuan baru yang menunggu keputusan akan tampil di sini.",
  className,
}: {
  items: ApprovalItem[];
  title?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const toApprove = rows.filter((r) => selectedIds.has(r.id));
    let successCount = 0;
    const failedIds: string[] = [];
    for (const item of toApprove) {
      const res = await decideApproval(item, true, "");
      if (res.ok) {
        successCount++;
      } else {
        failedIds.push(item.id);
      }
    }
    setBulkBusy(false);
    if (successCount > 0) {
      toast.success(`${successCount} pengajuan berhasil disetujui sekaligus.`);
      setRows((current) => current.filter((r) => !selectedIds.has(r.id) || failedIds.includes(r.id)));
      setSelectedIds(new Set(failedIds));
      router.refresh();
    }
    if (failedIds.length > 0) {
      toast.error(`${failedIds.length} pengajuan gagal diproses.`);
    }
  }

  async function run(item: ApprovalItem, approve: boolean, note: string) {
    setBusyId(item.id);
    const result = await decideApproval(item, approve, note);
    setBusyId(null);
    setRejecting(null);
    if (!result.ok) {
      toast.error(result.message ?? "Keputusan gagal disimpan.");
      return;
    }
    toast.success(
      approve
        ? `${APPROVAL_KIND_LABELS[item.kind]} dari ${item.requester} disetujui.`
        : `${APPROVAL_KIND_LABELS[item.kind]} dari ${item.requester} ditolak.`,
    );
    setRows((current) => current.filter((row) => !(row.id === item.id && row.kind === item.kind)));
    setSelectedIds((prev) => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    router.refresh();
  }

  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        {selectedIds.size > 0 ? (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedIds.size === rows.length && rows.length > 0}
                onChange={toggleAll}
                aria-label="Pilih semua pengajuan"
                className="size-4 rounded border-border text-primary focus:ring-ring"
              />
              <span className="text-[12px] font-semibold text-primary">
                {selectedIds.size} pengajuan dipilih
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkBusy}
                className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] font-medium transition-colors hover:bg-muted"
              >
                Batal pilihan
              </button>
              <button
                type="button"
                onClick={() => void bulkApprove()}
                disabled={bulkBusy}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {bulkBusy ? "Memproses…" : `Setujui terpilih (${selectedIds.size})`}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              {rows.length > 0 ? (
                <input
                  type="checkbox"
                  checked={false}
                  onChange={toggleAll}
                  aria-label="Pilih semua pengajuan"
                  className="size-4 rounded border-border text-primary focus:ring-ring"
                />
              ) : null}
              <h2 className="text-[13px] font-semibold">{title}</h2>
            </div>
            {rows.length > 0 ? (
              <span className="num rounded-full bg-tone-amber-soft px-2 py-0.5 text-[11px] font-semibold text-tone-amber">
                {rows.length} menunggu
              </span>
            ) : null}
          </>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="p-3">
          <EmptyState size="compact" title={emptyTitle} description={emptyDescription} icon={<Inbox className="size-5" />} />
        </div>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => toggleOne(item.id)}
                aria-label={`Pilih pengajuan ${item.requester}`}
                className="size-4 shrink-0 rounded border-border text-primary focus:ring-ring"
              />
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                {APPROVAL_KIND_LABELS[item.kind]}
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-[13px] font-medium">
                  {item.href ? (
                    <Link href={item.href} className="hover:underline">
                      {item.requester}
                    </Link>
                  ) : (
                    item.requester
                  )}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">{item.summary}</p>
              </div>
              {item.amount ? <span className="num text-[13px] font-semibold">{item.amount}</span> : null}
              {item.ageLabel ? (
                <span className="text-[11px] text-muted-foreground">{item.ageLabel}</span>
              ) : null}
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void run(item, true, "")}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {busyId === item.id ? "…" : "Setujui"}
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => setRejecting(item)}
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  Tolak
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={rejecting !== null}
        title={
          rejecting
            ? `Tolak ${APPROVAL_KIND_LABELS[rejecting.kind].toLowerCase()} dari ${rejecting.requester}?`
            : ""
        }
        description={rejecting?.summary}
        confirmLabel="Tolak pengajuan"
        danger
        busy={rejecting ? busyId === rejecting.id : false}
        reason={{
          label: "Alasan penolakan",
          placeholder: "Ditulis pada catatan keputusan",
          minLength: rejecting?.kind === "stock_adjustment" ? 3 : 0,
        }}
        onConfirm={(reason) => {
          if (rejecting) void run(rejecting, false, reason);
        }}
        onCancel={() => setRejecting(null)}
      />
    </section>
  );
}
