"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  applySupplierCreditAction,
  convertSupplierCreditToAdvanceAction,
  receiveReplacementAction,
  refundSupplierReturnAction,
  resolveSupplierReturnOtherAction,
} from "@/server/actions/supplier-returns";
import { MoneyInput } from "@/components/money-input";
import { QtyInput } from "@/components/qty-input";
import { DateField } from "@/components/date-field";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";

export type OpenPayableOption = {
  kind: "receipt" | "opening";
  id: string;
  number: string | null;
  reference: string | null;
  date: string;
  outstanding: string;
};

export type ReplaceableLine = {
  returnLineId: string;
  productName: string;
  sku: string;
  qty: string;
  replacedQty: string;
  remainingQty: string;
  unitCost: string;
  trackBatch: boolean;
};

const sectionClass = "rounded-lg border border-border bg-card";
const sectionHeadClass = "border-b border-border px-4 py-3";
const submitClass =
  "inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

/**
 * RET-2: empat formulir penyelesaian klaim Kredit Pemasok. Setiap
 * formulir memanggil aksi domain apa adanya — batas nominal/qty dan
 * status ditegakkan server; pesan kesalahan domain ditampilkan utuh.
 */
export function SupplierReturnResolutionForms({
  returnId,
  number,
  remainingClaim,
  today,
  openPayables,
  paymentAccounts,
  replaceableLines,
  canSettleMoney,
  canReceiveReplacement,
}: {
  returnId: string;
  number: string;
  remainingClaim: string;
  today: string;
  openPayables: OpenPayableOption[];
  paymentAccounts: { id: string; code: string; name: string }[];
  replaceableLines: ReplaceableLine[];
  canSettleMoney: boolean;
  canReceiveReplacement: boolean;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {canSettleMoney ? (
        <>
          <ApplyCreditForm returnId={returnId} remainingClaim={remainingClaim} today={today} openPayables={openPayables} />
          <ConvertToAdvanceForm returnId={returnId} remainingClaim={remainingClaim} today={today} />
          <RefundForm returnId={returnId} remainingClaim={remainingClaim} today={today} paymentAccounts={paymentAccounts} />
        </>
      ) : null}
      {canReceiveReplacement ? (
        <ReplacementForm returnId={returnId} number={number} today={today} lines={replaceableLines} />
      ) : null}
      {canSettleMoney ? (
        <OtherCloseForm returnId={returnId} remainingClaim={remainingClaim} />
      ) : null}
    </div>
  );
}

function ConvertToAdvanceForm({
  returnId,
  remainingClaim,
  today,
}: {
  returnId: string;
  remainingClaim: string;
  today: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await convertSupplierCreditToAdvanceAction({
      returnId,
      date,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      `Kredit retur menjadi uang muka ${result.data.advanceNumber}. Sisa klaim ${formatIDR(result.data.remainingClaim)}.`,
    );
    router.refresh();
  }

  return (
    <section className={sectionClass}>
      <div className={sectionHeadClass}>
        <h3 className="text-[13px] font-semibold">Jadikan Uang Muka Pembelian</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Seluruh sisa klaim dipindahkan ke akun Uang Muka Pembelian tanpa kas keluar, lalu otomatis dipotong FIFO saat penerimaan barang berikutnya. Dokumen muncul di Gudang → Uang muka pembelian.
        </p>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="text-[11px] text-muted-foreground">Sisa klaim yang dipindahkan</span>
          <span className="num text-[13px] font-semibold">{formatIDR(remainingClaim)}</span>
        </div>
        <label className="block space-y-1">
          <span className={labelClass}>Tanggal</span>
          <DateField value={date} onChange={setDate} className="h-9 px-2.5 text-[12px]" />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Catatan (opsional)</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} className={fieldClass} placeholder="cth. kredit retur untuk pembelian bulan depan" />
        </label>
        <button type="button" onClick={() => void submit()} disabled={busy} className={submitClass}>
          {busy ? "Memproses…" : "Jadikan Uang Muka"}
        </button>
      </div>
    </section>
  );
}

function ApplyCreditForm({
  returnId,
  remainingClaim,
  today,
  openPayables,
}: {
  returnId: string;
  remainingClaim: string;
  today: string;
  openPayables: OpenPayableOption[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(remainingClaim);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!(Number(amount) > 0)) {
      toast.error("Isi nominal kredit yang diterapkan.");
      return;
    }
    const [kind, targetId] = target ? target.split(":") : [];
    setBusy(true);
    const result = await applySupplierCreditAction({
      returnId,
      amount,
      date,
      targetReceiptId: kind === "receipt" ? targetId : null,
      targetOpeningId: kind === "opening" ? targetId : null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Kredit diterapkan ke utang pemasok. Sisa klaim sekarang ${formatIDR(result.data.remainingClaim)}.`);
    router.refresh();
  }

  return (
    <section className={sectionClass}>
      <div className={sectionHeadClass}>
        <h3 className="text-[13px] font-semibold">Terapkan ke Utang (potong pembelian berikutnya)</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Klaim otomatis tersedia saat membayar tagihan di menu Piutang & Utang. Anda juga dapat mengalokasikannya langsung ke dokumen utang terbuka di bawah ini:
        </p>
      </div>
      <div className="space-y-3 p-4">
        {openPayables.length === 0 ? (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3.5 text-[12px]">
            <div className="flex items-center gap-1.5 font-semibold text-primary">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Kredit Retur Siap Digunakan untuk Pembelian Berikutnya</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
              Pemasok ini saat ini belum memiliki tagihan utang terbuka. Anda <strong>tidak perlu</strong> melakukan tindakan apapun di sini.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">
              Ketika Anda mencatat penerimaan/pembelian kredit baru berikutnya untuk pemasok ini, saldo kredit ini ({formatIDR(remainingClaim)}) akan <strong>otomatis muncul sebagai pilihan sumber dana pemotongan</strong> saat membayar tagihan di menu Piutang & Utang.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/app/akuntansi/piutang-utang?tab=utang"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-card px-2.5 text-[11px] font-medium text-primary shadow-xs hover:bg-muted"
              >
                Lihat Menu Piutang & Utang
                <ArrowRight className="size-3" />
              </Link>
              <Link
                href="/app/gudang/penerimaan/baru"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
              >
                Penerimaan Barang Baru
              </Link>
            </div>
          </div>
        ) : (
          <>
            <label className="block space-y-1">
              <span className={labelClass}>Dokumen utang tujuan</span>
              <select value={target} onChange={(event) => setTarget(event.target.value)} className={fieldClass}>
                <option value="">Otomatis — utang tertua dulu (FIFO)</option>
                {openPayables.map((doc) => (
                  <option key={`${doc.kind}:${doc.id}`} value={`${doc.kind}:${doc.id}`}>
                    {doc.number ?? "(tanpa nomor)"}
                    {doc.kind === "opening" ? " · saldo awal" : ""}
                    {doc.reference ? ` · ref ${doc.reference}` : ""} · {formatDate(doc.date)} · sisa {formatIDR(doc.outstanding)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className={labelClass}>Nominal (maks {formatIDR(remainingClaim)})</span>
                <MoneyInput value={amount} onChange={setAmount} className="h-9 px-2.5 text-[12px]" aria-label="Nominal kredit diterapkan" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Tanggal</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal" />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={submit} disabled={busy} className={submitClass}>
                {busy ? "Menerapkan…" : "Terapkan kredit sekarang"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function RefundForm({
  returnId,
  remainingClaim,
  today,
  paymentAccounts,
}: {
  returnId: string;
  remainingClaim: string;
  today: string;
  paymentAccounts: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(paymentAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState(remainingClaim);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!accountId) {
      toast.error("Pilih akun Kas/Bank tujuan refund.");
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error("Isi nominal refund.");
      return;
    }
    setBusy(true);
    const result = await refundSupplierReturnAction({ returnId, accountId, amount, date });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Refund dari pemasok tercatat. Sisa klaim sekarang ${formatIDR(result.data.remainingClaim)}.`);
    router.refresh();
  }

  return (
    <section className={sectionClass}>
      <div className={sectionHeadClass}>
        <h3 className="text-[13px] font-semibold">Refund Uang dari Pemasok</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Pemasok mengembalikan uang tunai/transfer sebesar sebagian atau seluruh sisa klaim.
        </p>
      </div>
      <div className="space-y-2 p-4">
        <label className="block space-y-1">
          <span className={labelClass}>Uang masuk ke akun</span>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={fieldClass}>
            {paymentAccounts.map((row) => (
              <option key={row.id} value={row.id}>{row.code} — {row.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={labelClass}>Nominal (maks {formatIDR(remainingClaim)})</span>
            <MoneyInput value={amount} onChange={setAmount} className="h-9 px-2.5 text-[12px]" aria-label="Nominal refund" />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>Tanggal</span>
            <DateField value={date} onChange={setDate} aria-label="Tanggal" />
          </label>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={submit} disabled={busy || paymentAccounts.length === 0} className={submitClass}>
            {busy ? "Mencatat…" : "Catat refund"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ReplacementForm({
  returnId,
  number,
  today,
  lines,
}: {
  returnId: string;
  number: string;
  today: string;
  lines: ReplaceableLine[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { qty: string; batchNumber: string; expiryDate: string }>>({});

  function draftOf(line: ReplaceableLine) {
    return drafts[line.returnLineId] ?? { qty: "", batchNumber: "", expiryDate: "" };
  }
  function patch(lineId: string, patch: Partial<{ qty: string; batchNumber: string; expiryDate: string }>) {
    setDrafts((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] ?? { qty: "", batchNumber: "", expiryDate: "" }), ...patch },
    }));
  }

  async function submit() {
    const picked = lines
      .map((line) => ({ line, draft: draftOf(line) }))
      .filter(({ draft }) => Number(draft.qty) > 0);
    if (picked.length === 0) {
      toast.error("Isi qty pengganti pada minimal satu baris.");
      return;
    }
    const missingBatch = picked.find(({ line, draft }) => line.trackBatch && !draft.batchNumber.trim());
    if (missingBatch) {
      toast.error(`Nomor batch wajib diisi untuk ${missingBatch.line.productName} karena produk ini dilacak per batch.`);
      return;
    }
    setBusy(true);
    const result = await receiveReplacementAction({
      returnId,
      date,
      lines: picked.map(({ line, draft }) => ({
        returnLineId: line.returnLineId,
        qty: draft.qty,
        batchNumber: line.trackBatch ? draft.batchNumber.trim() : null,
        expiryDate: line.trackBatch && draft.expiryDate ? draft.expiryDate : null,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      `Barang pengganti ${number} diterima — klaim terpakai ${formatIDR(result.data.consumedAmount)}, sisa klaim ${formatIDR(result.data.remainingClaim)}.`,
    );
    router.refresh();
  }

  return (
    <section className={sectionClass}>
      <div className={sectionHeadClass}>
        <h3 className="text-[13px] font-semibold">Terima Barang Pengganti</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Barang pengganti masuk stok pada nilai klaim baris asal. Penerimaan boleh sebagian dan berulang.
        </p>
      </div>
      <div className="space-y-2 p-4">
        {lines.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Semua baris retur sudah diganti penuh.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Produk</th>
                    <th className="px-2 py-1.5 text-right">Sisa belum diganti</th>
                    <th className="px-2 py-1.5 text-right">Qty datang</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {lines.map((line) => {
                    const draft = draftOf(line);
                    return (
                      <tr key={line.returnLineId}>
                        <td className="px-2 py-1.5">
                          <p className="max-w-[220px] truncate font-medium">{line.productName}</p>
                          <p className="num text-[10px] text-muted-foreground">
                            {line.sku} · nilai klaim {formatIDR(line.unitCost)}/unit
                          </p>
                          {line.trackBatch ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <input
                                value={draft.batchNumber}
                                onChange={(event) => patch(line.returnLineId, { batchNumber: event.target.value })}
                                placeholder="Nomor batch baru *"
                                aria-label={`Nomor batch pengganti ${line.productName}`}
                                className="h-9 w-32 rounded border border-input bg-background px-1.5 text-[11px]"
                              />
                              <DateField
                                value={draft.expiryDate}
                                onChange={(value) => patch(line.returnLineId, { expiryDate: value })}
                                aria-label={`Kedaluwarsa batch pengganti ${line.productName}`}
                                className="h-9 w-32 px-1.5 text-[11px]"
                              />
                            </div>
                          ) : null}
                        </td>
                        <td className="num px-2 py-1.5 text-right text-muted-foreground">
                          {formatQty(line.remainingQty)} <span className="text-[10px]">(dari {formatQty(line.qty)}, diganti {formatQty(line.replacedQty)})</span>
                        </td>
                        <td className="px-2 py-1.5">
                          {/* G2 (FRM-03): QtyInput bersama. */}
                          <QtyInput
                            value={draft.qty}
                            onChange={(value) => patch(line.returnLineId, { qty: value })}
                            placeholder="0"
                            aria-label={`Qty pengganti ${line.productName}`}
                            wrapperClassName="w-20"
                            className="w-full rounded px-1.5 text-[12px]"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label className="block space-y-1">
                <span className={labelClass}>Tanggal terima</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal" />
              </label>
              <button type="button" onClick={submit} disabled={busy} className={submitClass}>
                {busy ? "Menerima…" : "Terima pengganti"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function OtherCloseForm({ returnId, remainingClaim }: { returnId: string; remainingClaim: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [confirmRemainder, setConfirmRemainder] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasRemainder = d(remainingClaim).gt(0);

  async function submit() {
    if (note.trim().length < 3) {
      toast.error("Catatan penyelesaian wajib diisi dengan jelas.");
      return;
    }
    if (hasRemainder && !confirmRemainder) {
      toast.error("Centang penegasan penutupan bila masih ada sisa klaim.");
      return;
    }
    setBusy(true);
    const result = await resolveSupplierReturnOtherAction({
      returnId,
      note: note.trim(),
      writeOffRemainder: hasRemainder ? confirmRemainder : false,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Retur ditutup dengan penyelesaian cara lain sesuai catatan.");
    router.refresh();
  }

  return (
    <section className={sectionClass}>
      <div className={sectionHeadClass}>
        <h3 className="text-[13px] font-semibold">Selesaikan dengan Cara Lain</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Penutupan bebas di luar tiga jalur di atas — kesepakatan khusus dengan pemasok, tukar produk lain, dan sebagainya. Wajib dijelaskan di catatan.
        </p>
      </div>
      <div className="space-y-2 p-4">
        <label className="block space-y-1">
          <span className={labelClass}>Catatan penyelesaian (wajib)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring"
            placeholder="cth. Disepakati pemasok menukar dengan produk lain senilai sama pada kunjungan sales berikutnya…"
          />
        </label>
        {hasRemainder ? (
          <label className="flex items-start gap-2 rounded-md bg-tone-amber-soft px-3 py-2 text-[11px] leading-5 text-tone-amber">
            <input
              type="checkbox"
              checked={confirmRemainder}
              onChange={(event) => setConfirmRemainder(event.target.checked)}
              className="mt-1"
            />
            <span>
              Tutup walau masih ada sisa klaim {formatIDR(remainingClaim)}. Sisa ini <strong>tetap tercatat sebagai aset Kredit Pemasok</strong> di
              buku besar — tidak dihapus diam-diam; akuntan dapat menjurnalnya kemudian bila benar-benar hangus.
            </span>
          </label>
        ) : null}
        <div className="flex justify-end">
          <button type="button" onClick={submit} disabled={busy} className={submitClass}>
            {busy ? "Menutup…" : "Tutup retur"}
          </button>
        </div>
      </div>
    </section>
  );
}
