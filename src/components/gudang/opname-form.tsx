"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { newUuid } from "@/lib/uuid";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ClipboardList,
  Eraser,
  Eye,
  EyeOff,
  Info,
  ListPlus,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildOpnamePostingLines,
  effectiveCountedQty,
  opnameDraftKey,
  parseCountedQty,
  parseOpnameDraft,
  serializeOpnameDraft,
  summarizeOpnameCount,
  type OpnameCountRow,
} from "@/lib/opname-count";
import { createOpnameAction } from "@/server/actions/inventory/opname";
import {
  loadOpnameProductsAction,
  productStockAction,
  productsStockAction,
} from "@/server/actions/inventory/produk";
import { ProductPicker } from "@/components/gudang/product-picker";
import { OpnameCountTable } from "@/components/gudang/opname-count-table";
import {
  OpnameReviewPanel,
  type OpnameReviewFilter,
} from "@/components/gudang/opname-review-panel";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { StatusSteps } from "@/components/blocks/document-page";
import { DateField } from "@/components/date-field";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";

type Row = OpnameCountRow;
type CountFilter = "all" | "uncounted" | "counted";


function byProductName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, "id", { numeric: true, sensitivity: "base" });
}

/**
 * FIX-GDG Tahap 4 (GDG2-01) — opname dua langkah dengan HITUNG BUTA.
 *
 * Langkah HITUNG: kolom Fisik mulai kosong, angka sistem disembunyikan
 * (dapat dibuka sadar lewat saklar). Satu baris = satu produk; hitungan
 * kemasan dibuka dari popover agar tabel tetap rata dan tidak bertumpuk.
 * Langkah TINJAU: stok sistem diambil ulang, selisih difokuskan lebih
 * dulu, dan posting baru aktif setelah pemeriksaan dicentang.
 *
 * Draf disimpan di localStorage per perusahaan+gudang; posting tetap
 * lewat createOpnameAction yang sama.
 */
export function OpnameForm({
  companyId,
  warehouses,
  defaultWarehouseId,
  today,
}: {
  companyId: string;
  warehouses: { id: string; name: string }[];
  defaultWarehouseId?: string;
  today: string;
}) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses[0]?.id || "");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [step, setStep] = useState<"hitung" | "tinjau">("hitung");
  const [showSystem, setShowSystem] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [draftNotice, setDraftNotice] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [countFilter, setCountFilter] = useState<CountFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<OpnameReviewFilter>("diff");
  // GDG3-06: kunci idempotensi per pembukaan form (lihat receipt-form).
  const [idempotencyKey, setIdempotencyKey] = useState(() => newUuid());
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const loadedWarehouseRef = useRef("");

  /* ---- Draf: muat saat gudang terpilih berubah ---- */
  useEffect(() => {
    let cancelled = false;
    // localStorage adalah sistem eksternal; pemuatan draf berjalan
    // sebagai sinkronisasi async (IIFE) — bukan setState sinkron di
    // badan effect.
    void (async () => {
      const draft = parseOpnameDraft(
        window.localStorage.getItem(opnameDraftKey(companyId, warehouseId)),
      );
      if (draft && draft.warehouseId === warehouseId && draft.rows.length > 0) {
        // Angka sistem draf tidak disimpan (cepat basi) — ambil ulang
        // SEBELUM baris diterapkan agar tidak ada kedipan angka 0.
        const freshResult = await productsStockAction({
          warehouseId,
          productIds: draft.rows.map((row) => row.productId),
        }).catch(() => null);
        if (cancelled) return;
        const fresh = new Map(
          freshResult?.ok ? freshResult.data.map((row) => [row.productId, row.qty]) : [],
        );
        setDate(draft.date);
        setNotes(draft.notes);
        setStep(draft.step);
        setConfirmed(false);
        setDraftNotice(true);
        setRows(
          draft.rows.map((row) => ({
            productId: row.productId,
            name: row.name,
            sku: row.sku,
            system: fresh.get(row.productId) ?? 0,
            counted: row.counted,
            // K-3: draf tanpa harga pokok (format lama / biaya tidak
            // terlihat) tetap "tidak terlihat" — bukan dianggap nol.
            unitCost: row.unitCost ?? null,
            unitName: row.unitName ?? null,
            packagings: row.packagings ?? [],
            components: row.components ?? {},
          })),
        );
      } else {
        setDate(today);
        setNotes("");
        setStep("hitung");
        setDraftNotice(false);
        setRows([]);
      }
      setCountFilter("all");
      setReviewFilter("diff");
      loadedWarehouseRef.current = warehouseId;
    })();
    return () => {
      cancelled = true;
    };
    // `today` sengaja tidak menjadi dependensi: tanggal bawaan hanya
    // dipakai saat draf gudang itu pertama kali dimuat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, companyId]);

  /* ---- Draf: simpan setiap perubahan isian ---- */
  useEffect(() => {
    if (loadedWarehouseRef.current !== warehouseId) return;
    const key = opnameDraftKey(companyId, warehouseId);
    if (rows.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      serializeOpnameDraft({
        warehouseId,
        date,
        notes,
        step,
        rows: rows.map((row) => ({
          productId: row.productId,
          name: row.name,
          sku: row.sku,
          counted: row.counted,
          unitCost: row.unitCost,
          unitName: row.unitName ?? null,
          packagings: row.packagings ?? [],
          components: row.components ?? {},
        })),
      }),
    );
  }, [rows, date, notes, step, warehouseId, companyId]);

  // GD-P3-9: mode hitung menyeluruh — muat semua produk aktif terlacak
  // di gudang terpilih (server membatasi 1.000). GDG2-01: baris baru
  // mulai dengan Fisik KOSONG — petugas menghitung dari rak, bukan
  // menyalin angka sistem.
  async function loadAll() {
    if (!warehouseId) return;
    setLoadingAll(true);
    const result = await loadOpnameProductsAction({ warehouseId });
    setLoadingAll(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setRows((current) => {
      const existing = new Set(current.map((row) => row.productId));
      const additions = result.data.rows
        .filter((row) => !existing.has(row.productId))
        .map((row) => ({
          productId: row.productId,
          name: row.name,
          sku: row.sku,
          system: row.system,
          counted: "",
          unitCost: row.costPrice,
          unitName: row.unitName,
          packagings: row.packagings,
          components: {},
        }));
      return [...current, ...additions];
    });
    if (result.data.truncated) {
      toast.warning("Produk terlacak melebihi batas 1.000 — hanya 1.000 pertama yang dimuat.");
    } else {
      toast.success(`${result.data.rows.length} produk dimuat untuk dihitung.`);
    }
  }

  /** Pilih/pindai produk: baris baru mulai kosong; produk yang sudah
   *  terdaftar naik hitungannya +1 (pola hitung fisik pindai-berulang).
   *  S3: memindai barcode KEMASAN menaikkan komponen kemasan itu +1. */
  async function addOrIncrement(product: {
    id: string;
    name: string;
    sku: string;
    costPrice: string | null;
    unitName?: string | null;
    packagings?: { id: string; name: string; isi: string }[];
    scannedPackagingId?: string | null;
  }) {
    const packagings = (product.packagings ?? []).map((pack) => ({
      id: pack.id,
      name: pack.name,
      isi: pack.isi,
    }));
    const scannedPack = product.scannedPackagingId
      ? packagings.find((pack) => pack.id === product.scannedPackagingId)
      : undefined;
    const existing = rows.find((row) => row.productId === product.id);
    if (existing) {
      setRows((current) =>
        current.map((row) => {
          if (row.productId !== product.id) return row;
          const rowPack = scannedPack
            ? (row.packagings ?? []).find((pack) => pack.id === scannedPack.id)
            : undefined;
          if (rowPack) {
            const components = { ...(row.components ?? {}) };
            components[rowPack.id] = String(
              (parseCountedQty(components[rowPack.id] ?? "") ?? 0) + 1,
            );
            return { ...row, components };
          }
          return { ...row, counted: String((parseCountedQty(row.counted) ?? 0) + 1) };
        }),
      );
      return;
    }
    const result = await productStockAction({ warehouseId, productId: product.id });
    const system = result.ok ? result.data.qty : 0;
    setRows((current) => [
      ...current,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        system,
        counted: "",
        unitCost: product.costPrice,
        unitName: product.unitName ?? null,
        packagings,
        components: scannedPack ? { [scannedPack.id]: "1" } : {},
      },
    ]);
  }

  function updateCounted(productId: string, value: string) {
    setRows((current) =>
      current.map((row) => (row.productId === productId ? { ...row, counted: value } : row)),
    );
  }

  function updateComponent(productId: string, packagingId: string, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.productId === productId
          ? {
              ...row,
              components: { ...(row.components ?? {}), [packagingId]: value },
            }
          : row,
      ),
    );
  }

  function clearComponents(productId: string) {
    setRows((current) =>
      current.map((row) => (row.productId === productId ? { ...row, components: {} } : row)),
    );
  }

  function removeRow(productId: string) {
    setRows((current) => current.filter((row) => row.productId !== productId));
  }

  /** Masuk langkah tinjau: stok sistem diambil ulang lebih dulu agar
   *  perbandingan yang diperiksa petugas adalah angka terbaru. */
  async function goReview() {
    if (rows.length === 0) {
      toast.error("Pilih minimal satu produk untuk dihitung.");
      return;
    }
    setRefreshing(true);
    const result = await productsStockAction({
      warehouseId,
      productIds: rows.map((row) => row.productId),
    });
    setRefreshing(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const fresh = new Map(result.data.map((row) => [row.productId, row.qty]));
    setRows((current) =>
      current.map((row) => ({ ...row, system: fresh.get(row.productId) ?? 0 })),
    );
    setConfirmed(false);
    setReviewFilter("diff");
    setStep("tinjau");
  }

  async function submit() {
    const lines = buildOpnamePostingLines(rows);
    if (lines.length === 0) {
      toast.error("Belum ada produk yang dihitung. Isi kolom Fisik lebih dulu.");
      return;
    }
    setBusy(true);
    const result = await createOpnameAction({
      warehouseId,
      idempotencyKey,
      date,
      notes: notes || undefined,
      lines,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Opname tersimpan dan stok disesuaikan.");
    window.localStorage.removeItem(opnameDraftKey(companyId, warehouseId));
    setIdempotencyKey(newUuid());
    setRows([]);
    setNotes("");
    setStep("hitung");
    setConfirmed(false);
    setDraftNotice(false);
    setCountFilter("all");
    setReviewFilter("diff");
    router.refresh();
  }

  function clearDraft() {
    window.localStorage.removeItem(opnameDraftKey(companyId, warehouseId));
    setRows([]);
    setNotes("");
    setStep("hitung");
    setConfirmed(false);
    setDraftNotice(false);
    setCountFilter("all");
    setReviewFilter("diff");
    setConfirmingClear(false);
  }

  const summary = useMemo(() => summarizeOpnameCount(rows), [rows]);
  const countedSoFar = summary.countedCount;
  // K-3: nilai selisih hanya tampil bila semua biaya terlihat
  // (pemegang inventory.cost); tanpa itu kolom & kartu total disembunyikan.
  const showValues = summary.totalAbsValue !== null;
  const progress = rows.length === 0 ? 0 : Math.round((countedSoFar / rows.length) * 100);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const counted = effectiveCountedQty(row) !== null;
      if (countFilter === "counted") return counted;
      if (countFilter === "uncounted") return !counted;
      return true;
    });
    return [...filtered].sort(byProductName);
  }, [rows, countFilter]);

  const countFilters: { key: CountFilter; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: rows.length },
    { key: "uncounted", label: "Belum dihitung", count: rows.length - countedSoFar },
    { key: "counted", label: "Sudah dihitung", count: countedSoFar },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <StatusSteps
          steps={[
            { key: "hitung", label: "Hitung fisik", state: step === "hitung" ? "current" : "done" },
            { key: "tinjau", label: "Tinjau selisih", state: step === "tinjau" ? "current" : "todo" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          {step === "hitung"
            ? "Hitung dari rak tanpa melihat stok sistem."
            : "Periksa selisih sebelum posting."}
        </p>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]">
          <label className="space-y-1">
            <span className={labelClass}>Gudang</span>
            <select
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              className={fieldClass}
            >
              {warehouses.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Tanggal</span>
            {/* A-25 U3: DateField bersama (dd/mm/yyyy selalu). */}
            <DateField value={date} onChange={setDate} aria-label="Tanggal opname" />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Catatan</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={500}
              placeholder="Opsional — kondisi hitung"
              className={fieldClass}
            />
          </label>
        </div>

        {draftNotice && rows.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2 text-[11px] leading-5 text-tone-amber">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Draf hitung dipulihkan dari perangkat ini. Hitungan belum terposting — lanjutkan
              menghitung atau hapus draf untuk mulai dari awal.
            </p>
          </div>
        ) : null}
      </div>

      {step === "hitung" ? (
        <>
          <div className="border-t border-border bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[240px] flex-1">
                {/* A-28 UI-5 (UX-B05): kotak pindai autofocus seperti
                    Mode Operasi & terminal POS — tugas opname
                    digerakkan pindai, petugas tidak perlu klik dulu. */}
                <ProductPicker
                  onPick={addOrIncrement}
                  placeholder="Pindai / cari produk…"
                  scanMode autoFocus
                />
              </div>
              <div className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto">
                <button
                  type="button"
                  onClick={() => void loadAll()}
                  disabled={loadingAll || !warehouseId}
                  className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 text-[10px] font-medium transition-colors hover:bg-muted disabled:opacity-50 sm:px-3 sm:text-[12px]"
                >
                  <ListPlus className="size-3.5" />
                  {loadingAll ? "Memuat…" : "Muat semua"}
                </button>
                <Link
                  href={`/app/gudang/opname/lembar-hitung?warehouse=${warehouseId}`}
                  className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 text-[10px] font-medium transition-colors hover:bg-muted sm:px-3 sm:text-[12px]"
                >
                  <Printer className="size-3.5" /> Lembar hitung
                </Link>
                <button
                  type="button"
                  onClick={() => setShowSystem((value) => !value)}
                  aria-pressed={showSystem}
                  title={showSystem ? "Sembunyikan stok sistem" : "Tampilkan stok sistem"}
                  className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 text-[10px] font-medium transition-colors hover:bg-muted sm:px-3 sm:text-[12px]"
                >
                  {showSystem ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  Stok sistem
                </button>
              </div>
            </div>

            {rows.length > 0 ? (
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 w-24 overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={rows.length}
                    aria-valuenow={countedSoFar}
                    aria-label="Progres hitung opname"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="num text-[11px] text-muted-foreground">
                    {countedSoFar}/{rows.length} dihitung
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {countFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setCountFilter(filter.key)}
                      aria-pressed={countFilter === filter.key}
                      className={
                        countFilter === filter.key
                          ? "inline-flex h-7 items-center gap-1 rounded-full bg-foreground px-2.5 text-[11px] font-medium text-background"
                          : "inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      }
                    >
                      {filter.label}
                      <span className="num opacity-70">{filter.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="p-4">
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <ClipboardList className="mx-auto size-6 text-muted-foreground/60" />
                <p className="mt-2 text-[12px] font-medium">Belum ada produk di lembar hitung</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Pindai atau cari produk di atas, atau muat semua produk gudang ini.
                </p>
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <p className="text-[12px] text-muted-foreground">
                  Tidak ada produk pada filter ini.{" "}
                  <button
                    type="button"
                    onClick={() => setCountFilter("all")}
                    className="font-medium text-primary hover:underline"
                  >
                    Tampilkan semua
                  </button>
                </p>
              </div>
            ) : (
              <OpnameCountTable
                rows={visibleRows}
                showSystem={showSystem}
                onChangeCounted={updateCounted}
                onChangeComponent={updateComponent}
                onClearComponents={clearComponents}
                onDelete={removeRow}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <div>
              {rows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Eraser className="size-3.5" /> Hapus draf
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void goReview()}
              disabled={refreshing || rows.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {refreshing ? "Mengambil stok sistem…" : "Tinjau selisih"}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </>
      ) : (
        <OpnameReviewPanel
          summary={summary}
          showValues={showValues}
          filter={reviewFilter}
          onFilterChange={setReviewFilter}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
          busy={busy}
          onBack={() => setStep("hitung")}
          onSubmit={() => void submit()}
        />
      )}
      <ConfirmDialog
        open={confirmingClear}
        title="Hapus draf hitung opname?"
        description="Seluruh isian hitung gudang ini di perangkat ini dibuang dan form mulai dari kosong. Stok tidak berubah — belum ada yang terposting."
        confirmLabel="Hapus draf"
        danger
        onConfirm={clearDraft}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  );
}
