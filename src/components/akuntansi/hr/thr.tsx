/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — THR (hitung & batalkan draf).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  computeThrAction,
  voidComponentDraftAction,
} from "@/server/actions/hr/cuti-lembur";

/**
 * A-25 U5 (HR-04): form ini TIDAK lagi membawa pemilih periodenya
 * sendiri — periode mengikuti pemilih periode halaman Lembur & THR
 * (dulu dua pemilih untuk periode yang sama bisa tidak sinkron).
 */
export function ThrComputeForm({ period }: { period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      toast.error("Pilih periode target THR.");
      return;
    }
    setBusy(true);
    const result = await computeThrAction({ period });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      `Draf THR dibuat untuk ${result.data.created} karyawan (total ${result.data.total.toLocaleString("id-ID")}); ${result.data.skipped} dilewati (belum berhak).`,
    );
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={submit}
      disabled={busy}
      className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      {busy ? "Menghitung…" : "Hitung THR"}
    </button>
  );
}

export function ThrDraftVoidButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const result = await voidComponentDraftAction({ id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Draf THR dibatalkan.");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="h-8 rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
    >
      Batalkan
    </button>
  );
}
