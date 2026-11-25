"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { forceCloseSessionAction } from "@/server/actions/pos-sessions";

/**
 * Force-close sesi kasir yang ditinggalkan. Hanya dirender untuk pemegang
 * `pos.void`; server tetap menegakkan izin dan menulis audit `forced`.
 */
export function ForceCloseSessionButton({
  sessionId,
  cashierName,
}: {
  sessionId: string;
  cashierName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [valid, setValid] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!valid) {
      toast.error("Nominal hitungan belum terbaca.");
      return;
    }
    setBusy(true);
    try {
      const result = await forceCloseSessionAction({
        sessionId,
        countedCash,
        notes: notes.trim() || undefined,
        differenceReason: reason.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        `Sesi ${cashierName ?? "kasir"} ditutup paksa. Selisih ${result.data.difference.toLocaleString("id-ID")}.`,
      );
      setOpen(false);
      setCountedCash("");
      setNotes("");
      setReason("");
      router.refresh();
    } catch {
      toast.error("Status penutupan belum pasti. Muat ulang sebelum mencoba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-[12px] font-medium text-destructive hover:bg-destructive/10"
      >
        <LockKeyhole className="size-3.5" /> Tutup paksa
      </button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tutup paksa sesi {cashierName ?? "kasir"}</DialogTitle>
            <DialogDescription>
              Masukkan hitungan fisik laci. Tindakan ini diaudit sebagai penutupan supervisor dan
              tidak dapat dibatalkan. Sesi dengan pesanan tahanan aktif akan ditolak server.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[12px] font-medium">Uang dihitung</span>
              <MoneyInput
                value={countedCash}
                onChange={setCountedCash}
                onValidityChange={setValid}
                aria-label="Uang dihitung saat tutup paksa"
                className="font-semibold"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] font-medium">Alasan selisih (bila ada)</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px]"
                placeholder="Mis. kasir pulang tanpa menutup sesi"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] font-medium">Catatan penutupan (opsional)</span>
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px]"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="h-9 rounded-md border border-border px-3 text-[12px]"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy || !countedCash.trim()}
                onClick={() => void submit()}
                className="h-9 rounded-md bg-destructive px-3 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Menutup…" : "Tutup paksa"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
