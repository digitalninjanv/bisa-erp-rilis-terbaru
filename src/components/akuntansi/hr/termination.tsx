/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — terminasi & pembayaran akhir.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createFinalPayAction,
  terminateEmployeeAction,
} from "@/server/actions/hr/karyawan";
import { formatIDR } from "@/lib/money";
import { DateField } from "@/components/date-field";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";

/* Terminasi & pembayaran akhir (§6G)                                  */
/* ------------------------------------------------------------------ */


export function TerminationPanel({
  employeeId,
  reasons,
  isTerminated,
  hasFinalRun,
  openAdvance,
}: {
  employeeId: string;
  reasons: Array<{ code: string; label: string }>;
  isTerminated: boolean;
  hasFinalRun: boolean;
  openAdvance: string;
}) {
  const router = useRouter();
  const [terminationDate, setTerminationDate] = useState("");
  const [terminationReason, setTerminationReason] = useState(reasons[0]?.code ?? "");
  const [terminationNote, setTerminationNote] = useState("");
  const [period, setPeriod] = useState("");
  const [acknowledgeShortfall, setAcknowledgeShortfall] = useState(false);
  const [busy, setBusy] = useState(false);
  // A-25 U5 (HR-01): formulir berhenti adalah aksi paling
  // destruktif di HR — ia tidak lagi terbuka permanen di profil
  // karyawan aktif, melainkan di balik gerbang zona berbahaya.
  const [formOpen, setFormOpen] = useState(false);

  async function terminate() {
    if (!terminationDate || !terminationReason) {
      toast.error("Tanggal dan alasan berhenti wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await terminateEmployeeAction({
      employeeId, terminationDate, terminationReason,
      terminationNote: terminationNote || null, acknowledgeShortfall,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      `Pembayaran akhir ${result.data.number} dibuat: bersih ${formatIDR(result.data.net)}` +
        (Number(result.data.leftoverReceivable) > 0
          ? `; sisa piutang tetap terbuka ${formatIDR(result.data.leftoverReceivable)}.`
          : "."),
    );
    router.refresh();
  }

  async function recreateFinalPay() {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      toast.error("Periode pembayaran akhir harus YYYY-MM.");
      return;
    }
    setBusy(true);
    const result = await createFinalPayAction({ employeeId, period, acknowledgeShortfall });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pembayaran akhir ${result.data.number} dibuat: bersih ${formatIDR(result.data.net)}.`);
    router.refresh();
  }

  if (isTerminated) {
    if (hasFinalRun) return null;
    return (
      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Pembayaran akhir belum dibuat</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Karyawan sudah tercatat berhenti tetapi belum memiliki run pembayaran akhir non-void (mis. run lama dibatalkan).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 p-4">
          <label className="space-y-1">
            <span className={labelClass}>Periode pembayaran akhir</span>
            <input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="YYYY-MM" className={`${fieldClass} num w-28`} />
          </label>
          <label className="flex max-w-md items-start gap-1.5 pb-1 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={acknowledgeShortfall} onChange={(event) => setAcknowledgeShortfall(event.target.checked)} className="mt-0.5" />
            Saya menegaskan sisa kasbon/pinjaman yang melebihi pembayaran akhir tetap menjadi piutang terbuka (tercatat di audit).
          </label>
          <button
            type="button"
            onClick={recreateFinalPay}
            disabled={busy}
            className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Buat pembayaran akhir
          </button>
        </div>
      </section>
    );
  }

  if (!formOpen) {
    return (
      <section className="mt-3 overflow-hidden rounded-lg border border-destructive/30 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Zona berbahaya — Berhenti & pembayaran akhir</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Memproses pemberhentian karyawan ini dan membuat run pembayaran akhirnya. Sisa kasbon berjalan:{" "}
              <span className="num font-medium text-foreground">{formatIDR(openAdvance)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="h-8 rounded-md border border-destructive/40 px-3 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            Buka formulir berhenti
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-destructive/30 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Berhenti & pembayaran akhir</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Memproses pemberhentian sekaligus membuat run pembayaran akhir: gaji prorata hari kerja terpakai,
            PPh 21 mode masa terakhir bila engine aktif, dan sisa kasbon ditagihkan penuh sampai batas bersih.
            Sisa kasbon berjalan saat ini: <span className="num font-medium text-foreground">{formatIDR(openAdvance)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(false)}
          className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
        >
          Tutup
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2 p-4">
        <label className="space-y-1">
          <span className={labelClass}>Tanggal berhenti</span>
          <DateField value={terminationDate} onChange={setTerminationDate} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Alasan</span>
          <select value={terminationReason} onChange={(event) => setTerminationReason(event.target.value)} className={fieldClass}>
            {reasons.map((reason) => (
              <option key={reason.code} value={reason.code}>{reason.label}</option>
            ))}
          </select>
        </label>
        <label className="min-w-44 flex-1 space-y-1">
          <span className={labelClass}>Catatan</span>
          <input value={terminationNote} onChange={(event) => setTerminationNote(event.target.value)} className={fieldClass} />
        </label>
        <label className="flex max-w-md items-start gap-1.5 pb-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={acknowledgeShortfall} onChange={(event) => setAcknowledgeShortfall(event.target.checked)} className="mt-0.5" />
          Bila sisa kasbon melebihi pembayaran akhir, saya menegaskan sisanya tetap menjadi piutang terbuka (tercatat di audit).
        </label>
        <button
          type="button"
          onClick={terminate}
          disabled={busy}
          className="h-8 rounded-md border border-destructive/40 px-3 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          Proses berhenti & pembayaran akhir
        </button>
      </div>
    </section>
  );
}
