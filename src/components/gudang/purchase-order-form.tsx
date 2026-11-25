"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { savePurchaseOrderAction } from "@/server/actions/purchasing";
import { LineEditor, docLineBaseQty, type DocLine } from "@/components/gudang/line-editor";
import { d, formatIDR, formatQty } from "@/lib/money";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { DocumentForm, DocumentFormAdvanced } from "@/components/blocks/document-form";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { ErrorSummary, type FormErrorItem } from "@/components/blocks/error-summary";
import { DateField } from "@/components/date-field";

export function PurchaseOrderForm({
  suppliers,
  today,
  triggerPrimary = true,
}: {
  suppliers: { id: string; name: string }[];
  today: string;
  /* G4 (UX4-03): primer hanya di halaman Pembelian. Di detail pemasok,
     primer halaman adalah "Bayar utang", jadi pemicu form ini outline. */
  triggerPrimary?: boolean;
}) {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrorItem[]>([]);

  const isDirty = lines.length > 0 || notes.trim().length > 0;

  function handleCancel() {
    if (isDirty) {
      setConfirmCancel(true);
    } else {
      setOpen(false);
      setFormErrors([]);
    }
  }

  function doDiscard() {
    setConfirmCancel(false);
    setOpen(false);
    setLines([]);
    setNotes("");
    setFormErrors([]);
    idempotencyKey.current = null;
  }

  async function submit() {
    if (submitting.current) return;
    const errs: FormErrorItem[] = [];
    if (!supplierId) {
      errs.push({ field: "po-supplier", message: "Pilih pemasok untuk pesanan pembelian." });
    }
    if (lines.length === 0) {
      errs.push({ field: "po-lines", message: "Tambahkan minimal satu produk pesanan." });
    }
    if (errs.length > 0) {
      setFormErrors(errs);
      toast.error(errs[0].message);
      return;
    }
    setFormErrors([]);
    submitting.current = true;
    setBusy(true);
    try {
      const key = idempotencyKey.current ?? (idempotencyKey.current = crypto.randomUUID());
      const result = await savePurchaseOrderAction({
        idempotencyKey: key,
        supplierId,
        date,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        lines: lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          unitCost: line.unitCost,
          // S2: baris berkemasan — qty & harga per kemasan apa adanya;
          // konversi ke satuan dasar terjadi di domain.
          packagingId: line.packagingId || undefined,
        })),
      });
      if (!result.ok) {
        setFormErrors([{ message: result.message }]);
        toast.error(result.message);
        return;
      }
      idempotencyKey.current = null;
      toast.success(`Pesanan pembelian ${result.data.number} dibuat sebagai draft.`);
      router.push(`/app/gudang/pembelian/${result.data.id}`);
    } catch {
      // Keep the same key after an ambiguous network failure: a retry
      // must never create a second purchase order if the first commit
      // succeeded but its response was lost.
      const message = "Koneksi terputus saat menyimpan. Periksa daftar PO sebelum mencoba lagi.";
      setFormErrors([{ message }]);
      toast.error(message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  // A-25 U3: form PO memakai DocumentForm bersama — kepala inti
  // (pemasok & tanggal) di kartu kepala, perkiraan tiba + catatan
  // terlipat di Opsi lanjutan, total hidup di rel ringkasan.
  const total = lines.reduce(
    (acc, line) => acc.plus(d(line.qty || 0).mul(d(line.unitCost || 0))),
    d(0),
  );
  // Total qty ringkasan selalu SATUAN DASAR (baris berkemasan dihitung
  // lewat isinya); total nilai memakai qty × harga sebagaimana
  // dimasukkan — jumlah faktur yang sama di kedua bentuk satuan.
  const totalQty = lines.reduce((acc, line) => acc.plus(docLineBaseQty(line)), d(0));
  const supplierName = suppliers.find((row) => row.id === supplierId)?.name;

  return (
    <div>
      {/* A-28 UI-5 (UX-A02): pita formulir tidak lagi menggandakan
          judul halaman — pola SectionTitle bare A-25 (POLA-02): yang
          tersisa hanya baris aksinya (tombol buka/tutup form).
          Penjelasan PO sebagai dokumen komitmen hidup di deskripsi
          PageHeader halaman. */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={triggerPrimary
              ? "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
              : "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"}
          >
            <Plus className="size-3.5" /> {open ? "Tutup form" : "PO baru"}
          </button>
        </div>
      </div>

      {open ? (
        <DocumentForm
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          header={
            <div className="space-y-3 p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={labelClass}>Pemasok</span>
                  <select id="po-supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={fieldClass}>
                    {suppliers.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Tanggal PO</span>
                  <DateField value={date} onChange={setDate} className={fieldClass} />
                </label>
              </div>
              <DocumentFormAdvanced>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className={labelClass}>Perkiraan tiba (opsional)</span>
                    <DateField value={expectedDate} onChange={setExpectedDate} className={fieldClass} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Catatan</span>
                    <input
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className={fieldClass}
                      placeholder="Syarat pembayaran, alamat kirim…"
                    />
                  </label>
                </div>
              </DocumentFormAdvanced>
            </div>
          }
          summary={
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Ringkasan PO</p>
              <p className="num mt-1 text-[16px] font-semibold">{formatIDR(total)}</p>
              <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Pemasok</dt>
                  <dd className="min-w-0 text-right font-medium">{supplierName ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Baris produk</dt>
                  <dd className="num font-medium">{formatQty(lines.length)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Total qty</dt>
                  <dd className="num font-medium">{formatQty(totalQty)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Status awal</dt>
                  <dd className="font-medium">Draf</dd>
                </div>
              </dl>
            </div>
          }
          guide={
            <ul className="list-disc space-y-0.5 pl-4">
              <li>PO tersimpan sebagai draf; kirim PO dari halaman detail agar dapat ditautkan ke penerimaan.</li>
              <li>Stok dan jurnal baru bergerak saat barang diterima terhadap PO ini, bukan saat PO dibuat.</li>
              <li>Penerimaan boleh sebagian — sisa pesanan tetap terlihat di detail PO.</li>
            </ul>
          }
          actions={
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-8 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Menyimpan…" : "Simpan PO (draft)"}
              </button>
            </div>
          }
        >
          <div className="space-y-4 p-4">
            {formErrors.length > 0 ? (
              <ErrorSummary errors={formErrors} />
            ) : null}
            <div id="po-lines" tabIndex={-1} className="outline-none">
              <LineEditor lines={lines} onChange={setLines} mode="receipt" />
            </div>
          </div>
        </DocumentForm>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        title="Batalkan pembuatan pesanan pembelian?"
        description="Daftar produk dan catatan yang sudah diisi akan dibuang."
        confirmLabel="Buang isian"
        danger
        onConfirm={doDiscard}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
