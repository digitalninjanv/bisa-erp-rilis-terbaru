"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CashMovementDialog({
  open,
  onOpenChange,
  sessionId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  onSave?: (data: { type: "deposit" | "withdrawal"; amount: number; notes?: string }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [type, setType] = useState<"deposit" | "withdrawal">("withdrawal");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) {
      toast.error("Tidak ada sesi kasir aktif. Buka sesi kasir terlebih dahulu.");
      return;
    }
    const num = Number(amount) || 0;
    if (num <= 0) {
      toast.error("Nominal mutasi kas harus lebih dari 0.");
      return;
    }
    setBusy(true);
    try {
      let res: { ok: boolean; message?: string };
      if (onSave) {
        res = await onSave({ type, amount: num, notes: notes.trim() || undefined });
      } else {
        const { cashMovementAction } = await import("@/server/actions/pos");
        const actionRes = await cashMovementAction({
          sessionId,
          type,
          amount: num,
          notes: notes.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        });
        res = actionRes.ok ? { ok: true } : { ok: false, message: actionRes.message };
      }

      if (res.ok) {
        toast.success(
          type === "deposit"
            ? `Kas masuk sebesar Rp ${num.toLocaleString("id-ID")} berhasil dicatat.`
            : `Kas keluar sebesar Rp ${num.toLocaleString("id-ID")} berhasil dicatat.`,
        );
        setAmount("");
        setNotes("");
        onOpenChange(false);
      } else {
        toast.error(res.message ?? "Gagal mencatat mutasi kas.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Catat Mutasi Kas (Kas Masuk / Keluar)</DialogTitle>
          <DialogDescription>
            Catat pengambilan uang laci untuk operasional darurat atau penambahan modal float kasir.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("withdrawal")}
              className={`flex items-center justify-center gap-1.5 rounded-md border p-2.5 text-xs font-semibold transition-colors ${
                type === "withdrawal"
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border hover:bg-muted text-muted-foreground"
              }`}
            >
              <ArrowDownRight className="size-4" />
              Kas Keluar (Biaya)
            </button>
            <button
              type="button"
              onClick={() => setType("deposit")}
              className={`flex items-center justify-center gap-1.5 rounded-md border p-2.5 text-xs font-semibold transition-colors ${
                type === "deposit"
                  ? "border-tone-teal bg-tone-teal-soft text-tone-teal"
                  : "border-border hover:bg-muted text-muted-foreground"
              }`}
            >
              <ArrowUpRight className="size-4" />
              Kas Masuk (Tambah)
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Nominal (Rp) *</label>
            <input
              type="number"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Contoh: 25000"
              className="num h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Keterangan / Keperluan</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Beli kantong kresek / es batu darurat"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="mt-4 flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Menyimpan…" : "Simpan Mutasi"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
