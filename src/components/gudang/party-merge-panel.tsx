"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mergePartyAction, previewPartyMergeAction } from "@/server/actions/master-data";
import type { PartyBrief, PartyKind, PartyMergePreview } from "@/server/master-data";
import { formatIDR } from "@/lib/money";
import { Modal } from "@/components/blocks/modal";

/**
 * S3 (§18G): panel gabung (merge) dua pihak dari halaman kemungkinan
 * duplikat. Pengguna memilih record utama; pratinjau server menampilkan
 * saldo kedua pihak, saldo gabungan, dan referensi yang berpindah;
 * penerapan butuh konfirmasi eksplisit dan berjalan satu transaksi.
 * Record duplikat TIDAK dihapus — dinonaktifkan dengan catatan.
 */
export function PartyMergePanel({
  kind,
  a,
  b,
}: {
  kind: PartyKind;
  a: PartyBrief;
  b: PartyBrief;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [primaryId, setPrimaryId] = useState<string>(a.id);
  const [preview, setPreview] = useState<PartyMergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const label = kind === "supplier" ? "pemasok" : "pelanggan";
  const duplicateId = primaryId === a.id ? b.id : a.id;

  async function loadPreview(nextPrimaryId: string) {
    setBusy(true);
    const result = await previewPartyMergeAction({
      kind,
      primaryId: nextPrimaryId,
      duplicateId: nextPrimaryId === a.id ? b.id : a.id,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPreview(result.data);
  }

  async function openPanel() {
    setOpen(true);
    setPreview(null);
    await loadPreview(primaryId);
  }

  async function apply() {
    setBusy(true);
    const result = await mergePartyAction({ kind, primaryId, duplicateId, confirm: true });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      `Penggabungan selesai. Saldo gabungan ${formatIDR(result.data.combinedOutstanding)} kini di record utama.`,
    );
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Gabungkan…
      </button>
      {open ? (
        <Modal
          title={`Gabungkan ${label} duplikat`}
          onClose={() => setOpen(false)}
          onSubmit={() => void apply()}
          busy={busy}
          submitLabel="Gabungkan sekarang"
          busyLabel="Memproses…"
          submitDisabled={!preview || preview.duplicateAlreadyMerged}
        >
            <p className="mb-3 text-[11px] text-muted-foreground">
              Semua transaksi &amp; referensi duplikat dipindah ke record utama dalam satu transaksi.
              Duplikat dinonaktifkan dengan catatan penggabungan — tidak dihapus, histori tetap ada.
            </p>
            <div className="max-h-[60vh] overflow-y-auto">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Record utama (yang dipertahankan)
              </p>
              <div className="space-y-2">
                {[a, b].map((party) => (
                  <label
                    key={party.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
                      primaryId === party.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="merge-primary"
                      checked={primaryId === party.id}
                      onChange={() => {
                        setPrimaryId(party.id);
                        void loadPreview(party.id);
                      }}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[12px] font-medium">{party.name}</span>
                      <span className="num block text-[10px] text-muted-foreground">
                        {party.code}
                        {party.phone ? ` · ${party.phone}` : ""}
                        {party.isActive ? "" : " · Nonaktif"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {preview ? (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-muted px-2 py-2">
                      <p className="text-[10px] text-muted-foreground">Saldo utama</p>
                      <p className="num text-[13px] font-semibold">{formatIDR(preview.primary.outstanding)}</p>
                    </div>
                    <div className="rounded-md bg-muted px-2 py-2">
                      <p className="text-[10px] text-muted-foreground">Saldo duplikat</p>
                      <p className="num text-[13px] font-semibold">{formatIDR(preview.duplicate.outstanding)}</p>
                    </div>
                    <div className="rounded-md bg-tone-green-soft px-2 py-2">
                      <p className="text-[10px] text-tone-green">Saldo gabungan</p>
                      <p className="num text-[13px] font-semibold text-tone-green">
                        {formatIDR(preview.combinedOutstanding)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Referensi duplikat yang akan berpindah
                    </p>
                    {preview.references.every((ref) => ref.count === 0) ? (
                      <p className="text-[11px] text-muted-foreground">Tidak ada referensi — duplikat belum pernah bertransaksi.</p>
                    ) : (
                      <ul className="list-disc pl-4 text-[11px]">
                        {preview.references
                          .filter((ref) => ref.count > 0)
                          .map((ref) => (
                            <li key={ref.key}>
                              {ref.label}: {ref.count}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                  {preview.duplicateAlreadyMerged ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                      Pihak duplikat ini sudah pernah digabungkan ke pihak lain — penggabungan ditolak server.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-[11px] text-muted-foreground">{busy ? "Menghitung pratinjau…" : ""}</p>
              )}
            </div>
        </Modal>
      ) : null}
    </>
  );
}
