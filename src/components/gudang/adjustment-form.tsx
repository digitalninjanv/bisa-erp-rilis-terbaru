"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createAdjustmentAction } from "@/server/actions/inventory/penyesuaian";
import { LineEditor, docLineBaseQty, type DocLine } from "@/components/gudang/line-editor";
import { DateField } from "@/components/date-field";
import { useActionRunner } from "@/components/use-action-runner";
import {
  OTHER_ADJUSTMENT_REASON,
  composeAdjustmentReason,
} from "@/lib/adjustment-reasons";
import { d, formatIDR, formatQty } from "@/lib/money";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";

// FIX-P1 (AK4-02): jenis "Retur ke pemasok" DICABUT dari formulir ini.
// Jalur lamanya mendebit Utang Usaha tanpa alokasi penerimaan (risiko
// utang terbayar dua kali) dan mendebit Piutang Usaha untuk klaim
// penggantian. Retur ke pemasok kini hanya lewat modul Retur Pembelian
// (lihat catatan pengarah di bawah formulir).
const TYPES = [
  { value: "adjustment", label: "Penyesuaian stok" },
  { value: "damaged", label: "Barang rusak" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "lost", label: "Hilang" },
  { value: "quarantine", label: "Karantina" },
] as const;

// T5R-5: the approval threshold only gates the write-off family —
// quarantine always posts immediately, so the amber notice below is
// shown only for the gated types.
const APPROVAL_GATED_TYPE_VALUES: readonly string[] = ["adjustment", "damaged", "expired", "lost"];

export function AdjustmentForm({
  warehouses,
  defaultWarehouseId,
  today,
  approvalThreshold,
  reasons,
}: {
  warehouses: { id: string; name: string }[];
  defaultWarehouseId?: string;
  today: string;
  // T5-3 (D-17): company approval threshold for adjustments; null = off.
  approvalThreshold?: string | null;
  /**
   * A-24 T3 (pola G4): daftar alasan terkonfigurasi per perusahaan
   * (sudah diresolusi halaman dari pengaturan — konfigurasi, bukan
   * daftar mati di kode).
   */
  reasons: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // GDG3-06: kunci idempotensi per pembukaan form (lihat receipt-form).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses[0]?.id || "");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("adjustment");
  const [date, setDate] = useState(today);
  // G4: alasan dipilih dari daftar terkonfigurasi + rincian bebas;
  // teks final yang disimpan adalah komposisinya (lib bersama).
  const [reasonCategory, setReasonCategory] = useState(reasons[0] ?? OTHER_ADJUSTMENT_REASON);
  const [reasonDetail, setReasonDetail] = useState("");
  const [costOverrideReason, setCostOverrideReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocLine[]>([]);
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();

  const reason = composeAdjustmentReason(reasonCategory, reasonDetail);

  // G4: nilai dampak hidup per baris — rumus yang sama dengan gerbang
  // domain (Σ |selisih| × harga pokok baris). S3: selisih dinilai dalam
  // SATUAN DASAR (qty berkemasan dikonversi; harga pokok per dasar).
  const lineValues = lines.map((line) => ({
    line,
    value: docLineBaseQty(line).abs().mul(d(line.unitCost || 0)),
  }));
  const totalImpact = lineValues.reduce((acc, row) => acc.plus(row.value), d(0));
  const gated = APPROVAL_GATED_TYPE_VALUES.includes(type);
  const overThreshold =
    gated && approvalThreshold != null && totalImpact.gt(d(approvalThreshold));

  async function submit() {
    if (lines.length === 0) {
      toast.error("Tambahkan minimal satu produk.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error(
        reasonCategory === OTHER_ADJUSTMENT_REASON
          ? "Untuk alasan Lainnya, rincian alasan wajib ditulis (minimal 3 karakter)."
          : "Alasan wajib dipilih dan rincian diisi minimal 3 karakter.",
      );
      return;
    }
    const data = await run(createAdjustmentAction({
      warehouseId,
      idempotencyKey,
      date,
      type,
      reason,
      costOverrideReason: costOverrideReason.trim() || undefined,
      notes: notes || undefined,
      lines: lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        unitCost: line.unitCost,
        // Satuan Kemasan S3: satuan baris terpilih (kosong = dasar).
        packagingId: line.packagingId || null,
      })),
    }));
    if (data === null) return;
    if (data?.status === "pending") {
      toast.success(
        "Dokumen tersimpan dan menunggu persetujuan — stok dan jurnal baru diterapkan setelah disetujui pengguna lain.",
      );
    } else {
      toast.success("Dokumen penyesuaian tersimpan.");
    }
    setIdempotencyKey(crypto.randomUUID());
    setLines([]);
    setReasonDetail("");
    setCostOverrideReason("");
    setNotes("");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Dokumen penyesuaian</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Barang rusak, kedaluwarsa, hilang, atau karantina. Untuk mengembalikan barang ke
            pemasok, gunakan{" "}
            <Link href="/app/gudang/retur-pembelian/baru" className="font-medium text-foreground underline">
              Retur Pembelian
            </Link>{" "}
            agar utang &amp; klaim pemasok tercatat benar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3.5" /> {open ? "Tutup form" : "Penyesuaian baru"}
        </button>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-border p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1">
              <span className={labelClass}>Gudang</span>
              <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={fieldClass}>
                {warehouses.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Jenis</span>
              <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className={fieldClass}>
                {TYPES.map((row) => (
                  <option key={row.value} value={row.value}>{row.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Tanggal</span>
              <DateField value={date} onChange={setDate} aria-label="Tanggal" />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Alasan</span>
              <select
                value={reasonCategory}
                onChange={(event) => setReasonCategory(event.target.value)}
                className={fieldClass}
                aria-label="Kategori alasan penyesuaian"
              >
                {reasons.map((row) => (
                  <option key={row} value={row}>{row}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>
                Rincian alasan {reasonCategory === OTHER_ADJUSTMENT_REASON ? "(wajib)" : "(opsional)"}
              </span>
              <input
                value={reasonDetail}
                onChange={(event) => setReasonDetail(event.target.value)}
                className={fieldClass}
                placeholder="Contoh: kemasan penyok saat pengiriman"
                aria-label="Rincian alasan penyesuaian"
              />
            </label>
          </div>

          {type !== "adjustment" ? (
            <p className="text-[11px] text-muted-foreground">
              Jumlah diisi <span className="font-semibold text-foreground">positif</span> sebagai jumlah
              barang yang keluar — stok otomatis berkurang sesuai jumlah tersebut.
            </p>
          ) : null}

          {type === "quarantine" ? (
            <p className="text-[11px] text-muted-foreground">
              Karantina memindahkan barang ke gudang karantina perusahaan (otomatis, tanpa jurnal
              penghapusan) — barang tetap tercatat sebagai persediaan dan tidak bisa terjual dari
              gudang asal. Bila belum ada gudang bertipe Karantina, buat dulu di Pengaturan.
            </p>
          ) : null}

          {approvalThreshold && APPROVAL_GATED_TYPE_VALUES.includes(type) ? (
            <p className="rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2 text-[11px] leading-5 text-tone-amber">
              Persetujuan penyesuaian aktif: dokumen dengan nilai dampak di atas{" "}
              <span className="font-semibold">{formatIDR(approvalThreshold)}</span> akan menunggu
              persetujuan — stok dan jurnal belum berubah sampai pengguna lain yang berizin
              menyetujuinya dari daftar riwayat di bawah.
            </p>
          ) : null}

          <LineEditor
            lines={lines}
            onChange={setLines}
            mode="adjustment"
            warehouseId={warehouseId}
            stockMode={type === "adjustment" ? "signed" : "out"}
          />

          {/* A-24 T3 (pola G4): nilai selisih rupiah terlihat SEBELUM
              simpan, beserta hubungan dokumen ini dengan ambang
              persetujuan — bukan penolakan sesudahnya. */}
          {lines.length > 0 ? (
            <div
              className={`rounded-md border px-3 py-2.5 ${
                overThreshold
                  ? "border-tone-amber/40 bg-tone-amber-soft"
                  : "border-border bg-muted/40"
              }`}
            >
              <ul className="space-y-1">
                {lineValues.map(({ line, value }) => (
                  <li
                    key={line.productId}
                    className="num flex items-baseline justify-between gap-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {line.name} — |{formatQty(docLineBaseQty(line))}| × {formatIDR(line.unitCost || 0)}
                    </span>
                    <span className="font-medium text-foreground">{formatIDR(value)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-border/60 pt-2 text-[12px] leading-5">
                Nilai dampak total:{" "}
                <span className="num font-semibold">{formatIDR(totalImpact)}</span>
                {" — "}
                {!gated ? (
                  <span className="text-muted-foreground">
                    karantina selalu langsung terposting (di luar gerbang persetujuan).
                  </span>
                ) : approvalThreshold == null ? (
                  <span className="text-muted-foreground">
                    perusahaan belum memasang ambang persetujuan, jadi dokumen ini langsung
                    terposting.
                  </span>
                ) : overThreshold ? (
                  <span className="font-medium text-tone-amber">
                    melebihi ambang persetujuan {formatIDR(approvalThreshold)} — dokumen akan
                    MENUNGGU persetujuan pengguna lain; stok dan jurnal belum berubah sampai
                    disetujui.
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    di bawah ambang persetujuan {formatIDR(approvalThreshold)} — dokumen
                    langsung terposting.
                  </span>
                )}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-2">
            <label className="min-w-[220px] flex-1 space-y-1">
              <span className={labelClass}>Alasan ubah harga pokok</span>
              <input
                value={costOverrideReason}
                onChange={(event) => setCostOverrideReason(event.target.value)}
                className={fieldClass}
                placeholder="Wajib bila harga pokok baris diubah dari harga berjalan (perlu izin manajer)"
              />
            </label>
            <label className="min-w-[220px] flex-1 space-y-1">
              <span className={labelClass}>Catatan</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="h-8 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Menyimpan…" : "Posting dokumen"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

