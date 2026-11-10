"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { reverseJournalAction } from "@/server/actions/accounting/jurnal";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { DateField } from "@/components/date-field";
import { Modal } from "@/components/blocks/modal";

export function JournalReverseButton({
  entryId,
  number,
  today,
  disabled,
}: {
  entryId: string;
  number: string;
  today: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await reverseJournalAction({ entryId, date, description: reason || undefined });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Jurnal pembalik ${result.data.number} dibuat.`);
    setOpen(false);
    router.refresh();
  }

  if (disabled) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-[12px] text-muted-foreground">
        <RotateCcw className="size-3.5" /> Sudah dibalik
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
      >
        <RotateCcw className="size-3.5" /> Balik jurnal
      </button>

      {open ? (
        <Modal
          title={`Balik jurnal ${number}`}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Buat pembalik"
          busyLabel="Memproses…"
        >
            <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
              Jurnal asli tetap tersimpan. Sistem membuat jurnal baru dengan debit/kredit terbalik.
            </p>
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className={labelClass}>Tanggal pembalik</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal pembalik" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Alasan</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className={fieldClass}
                  placeholder="Contoh: salah input akun"
                />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

