"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DateField } from "@/components/date-field";
import { MoneyInput } from "@/components/money-input";
import { todayISO } from "@/lib/format";
import { formatIDR, formatNumber } from "@/lib/money";
import { IMPORT_FIELDS } from "@/lib/import-parse";
import { updateImportRowAction } from "@/server/actions/import/rows";
import { StatCard } from "@/components/blocks/stat-card";
import { StatusSteps } from "@/components/blocks/document-page";
import { useImportWizard } from "./import/use-import-wizard";
import {
  ImportCancelDialog,
  ImportHistoryTable,
  ImportMappingCard,
  ImportProgressBar,
  ImportRowsPager,
  ImportUploadCard,
  type ImportHistoryJob,
} from "./import/wizard-shell";

/**
 * A-26 Q6 (P-07/D-03): wizard impor produk — alur unggah→commit kini
 * dari kerangka bersama useImportWizard + potongan rangka
 * wizard-shell; yang tinggal di sini adalah isi spesifik produk:
 * klasifikasi baris (chip & bendera), edit sel di tempat, opsi
 * perbarui/stok awal, dan kartu statistiknya.
 */

type Analysis = {
  summary: {
    totalRows: number;
    valid: number;
    missingName: number;
    missingSku: number;
    duplicateInFile: number;
    existingCount: number;
    barcodeConflict: number;
    duplicateBarcodeInFile?: number;
    invalidPrice: number;
    invalidValue: number;
    invalidPackaging?: number;
    /** Baris pending tanpa error DAN enam field wajib terisi. */
    lengkap: number;
    newCategories: string[];
    newUnits: string[];
    newSuppliers: string[];
  };
  preview: {
    rowNumber: number;
    name: string | null;
    sku: string | null;
    barcode: string | null;
    price: number;
    stock: number;
    issue: string | null;
    action: "insert" | "update" | "skip" | "error";
  }[];
};
type RowFlags = {
  barcodeKosong: boolean;
  hargaJualKosong: boolean;
  hargaBeliKosong: boolean;
  duplikatDalamBerkas: boolean;
  duplikatKatalog: boolean;
  bermasalah: boolean;
  siap: boolean;
  lengkap: boolean;
  belumLengkap: boolean;
};
type RowCounts = {
  total: number;
  siap: number;
  lengkap: number;
  belumLengkap: number;
  bermasalah: number;
  barcodeKosong: number;
  hargaJualKosong: number;
  hargaBeliKosong: number;
  duplikat: number;
};
type EditableField = "name" | "sku" | "barcode" | "salePrice" | "costPrice" | "unit";
type PreviewRow = {
  id: string;
  rowNumber: number;
  status: string;
  error: string | null;
  preview: { sku: string; name: string; salePrice: number; costPrice: number; stock: number; barcode: string | null; unit: string | null } | null;
  cells?: Record<EditableField, string>;
  edited?: boolean;
  flags?: RowFlags;
};
type ListData = {
  rows: PreviewRow[];
  total: number;
  counts?: RowCounts;
  filterRowNumbers?: number[];
  selectableRowNumbers?: number[];
  problemRowNumbers?: number[];
};

const ROWS_PAGE_SIZE = 50;
type RowsFilter =
  | "all"
  | "valid"
  | "complete"
  | "incomplete"
  | "problem"
  | "barcode_empty"
  | "sale_price_empty"
  | "cost_price_empty"
  | "duplicate";

const FILTER_CHIPS: { key: RowsFilter; label: string; count: (counts: RowCounts) => number }[] = [
  { key: "all", label: "Semua", count: (c) => c.total },
  { key: "complete", label: "Siap impor", count: (c) => c.lengkap },
  { key: "incomplete", label: "Belum lengkap", count: (c) => c.belumLengkap },
  { key: "problem", label: "Bermasalah", count: (c) => c.bermasalah },
  { key: "barcode_empty", label: "Barcode kosong", count: (c) => c.barcodeKosong },
  { key: "sale_price_empty", label: "Harga jual kosong/0", count: (c) => c.hargaJualKosong },
  { key: "cost_price_empty", label: "Harga beli kosong/0", count: (c) => c.hargaBeliKosong },
  { key: "duplicate", label: "Duplikat", count: (c) => c.duplikat },
];

const FILTER_EMPTY_TEXT: Partial<Record<RowsFilter, string>> = {
  problem: "Tidak ada baris bermasalah — semua baris siap diimpor.",
  valid: "Tidak ada baris yang siap diimpor pada kategori ini.",
  complete: "Tidak ada baris lengkap pada kategori ini.",
  incomplete: "Tidak ada baris belum lengkap.",
  barcode_empty: "Tidak ada baris dengan barcode kosong.",
  sale_price_empty: "Tidak ada baris dengan harga jual kosong/0.",
  cost_price_empty: "Tidak ada baris dengan harga beli kosong/0.",
  duplicate: "Tidak ada baris duplikat.",
};

export function ImportWizard({
  warehouses,
  defaultWarehouseId,
  history,
}: {
  warehouses: { id: string; name: string }[];
  defaultWarehouseId?: string;
  history: ImportHistoryJob[];
}) {
  const [counts, setCounts] = useState<RowCounts | null>(null);
  const [filterRowNumbers, setFilterRowNumbers] = useState<number[]>([]);
  const [selectableRowNumbers, setSelectableRowNumbers] = useState<number[]>([]);
  const [problemRowNumbers, setProblemRowNumbers] = useState<number[]>([]);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importStock, setImportStock] = useState(true);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses[0]?.id || "");
  // Tanggal cut-off migrasi; dipakai untuk gerakan stok & jurnal saldo awal.
  const [stockDate, setStockDate] = useState(todayISO());

  const flow = useImportWizard<Analysis, PreviewRow, RowsFilter>({
    pageSize: ROWS_PAGE_SIZE,
    onUploaded: () => {
      setCounts(null);
      setFilterRowNumbers([]);
      setSelectableRowNumbers([]);
      setProblemRowNumbers([]);
    },
    onRowsLoaded: (raw) => {
      const data = raw as unknown as ListData;
      if (data.counts) setCounts(data.counts);
      setFilterRowNumbers(data.filterRowNumbers ?? []);
      setSelectableRowNumbers(data.selectableRowNumbers ?? []);
      setProblemRowNumbers(data.problemRowNumbers ?? []);
    },
  });
  const {
    uploaded,
    mapping,
    analysis,
    previewRows,
    rowsPage,
    rowsTotal,
    rowsFilter,
    rowsLoading,
    excluded,
    setExcluded,
    busy,
    pendingCancelJob,
    progress,
    done,
  } = flow;

  async function saveCell(row: PreviewRow, field: EditableField, value: string) {
    if (!uploaded || savingRow !== null) return;
    setSavingRow(row.rowNumber);
    const result = await updateImportRowAction({
      jobId: uploaded.jobId,
      rowNumber: row.rowNumber,
      fields: { [field]: value },
    });
    setSavingRow(null);
    if (!result.ok) {
      toast.error(result.message);
      void flow.loadRows(uploaded.jobId, rowsPage, rowsFilter);
      return;
    }
    const data = result.data as unknown as {
      counts: RowCounts;
      summary: Analysis["summary"];
      mapping: Record<string, string>;
    };
    setCounts(data.counts);
    flow.setMapping(data.mapping);
    flow.setAnalysis((current) => (current ? { ...current, summary: data.summary } : current));
    // Muat ulang halaman aktif: bendera duplikat baris lain bisa berubah.
    await flow.loadRows(uploaded.jobId, rowsPage, rowsFilter);
  }

  async function commit() {
    const skips: { rowNumbers: number[]; keepError?: boolean; reason?: string }[] = [];
    // A-10/D-21: baris bermasalah tidak bisa dipilih, jadi wizard
    // melewatinya sebelum commit — dengan keepError agar alasan
    // analisisnya tetap tercatat sebagai sebab lewatinya.
    if (problemRowNumbers.length > 0) {
      skips.push({ rowNumbers: problemRowNumbers, keepError: true });
    }
    await flow.commit({
      extraSkips: skips,
      buildInput: (base) => ({
        ...base,
        updateExisting,
        importStock,
        warehouseId: warehouseId || undefined,
        date: stockDate || undefined,
      }),
      successMessage: ({ imported, failed }) =>
        `Impor selesai: ${formatNumber(imported)} produk, ${formatNumber(failed)} gagal.`,
    });
  }

  const selectedCount = selectableRowNumbers.filter((n) => !excluded.has(n)).length;

  // A-25 U3 (GDG-09): indikator langkah wizard — fase diturunkan
  // dari state yang sudah ada (unggah → petakan → validasi → impor),
  // digambar StatusSteps bersama agar pengguna selalu tahu posisinya.
  const phase = done ? 3 : analysis ? 2 : uploaded ? 1 : 0;
  const phaseLabels = ["Unggah berkas", "Petakan kolom", "Validasi & pilih baris", "Impor"];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <StatusSteps
          steps={phaseLabels.map((label, index) => ({
            key: label,
            label,
            state: index < phase ? "done" : index === phase ? "current" : "todo",
          }))}
        />
      </div>
      {!uploaded ? (
        <ImportUploadCard
          title="Unggah file produk"
          hint="Ekspor Accurate didukung: Harga Jual dibaca dari Def. Hrg. Jual Satuan #1, stok dari Kuantitas Saldo Awal, dan multi-satuan Satuan #2..#5 otomatis menjadi kemasan. Filter Siap impor hanya menampilkan baris lengkap (SKU, Nama, Barcode, Satuan, Harga beli > 0, Harga jual > 0); baris lain ada di Belum lengkap. Anda juga bisa memakai template Excel/CSV ERP."
          templateHref="/api/import/template/products?format=xlsx"
          fileName={flow.file?.name ?? null}
          uploading={flow.uploading}
          onFileChange={flow.setFile}
          onUpload={() => void flow.upload()}
        />
      ) : null}

      {uploaded ? (
        <ImportMappingCard
          uploaded={uploaded}
          fields={IMPORT_FIELDS}
          mapping={mapping}
          onMappingChange={flow.changeMapping}
          busy={busy}
          showAnalyze={!analysis}
          onAnalyze={() => void flow.analyze()}
          onCancelRequest={() => flow.setPendingCancelJob(uploaded.jobId)}
          onResetFile={flow.resetFile}
        />
      ) : null}

      {analysis ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard label="Total baris" value={formatNumber(analysis.summary.totalRows)} />
            <StatCard label="Siap diimpor (lengkap)" value={formatNumber(counts?.lengkap ?? analysis.summary.lengkap)} valueClassName="text-tone-green" />
            <StatCard label="Sudah ada (SKU)" value={formatNumber(analysis.summary.existingCount)} valueClassName="text-tone-amber" />
            <StatCard label="Bermasalah" value={formatNumber(analysis.summary.missingName + analysis.summary.duplicateInFile + analysis.summary.barcodeConflict + (analysis.summary.duplicateBarcodeInFile ?? 0) + (analysis.summary.invalidPrice ?? 0) + (analysis.summary.invalidValue ?? 0) + (analysis.summary.invalidPackaging ?? 0))} valueClassName="text-destructive" />
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">Pratinjau baris</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Pratinjau persisten (staging) — data master belum berubah sampai impor dijalankan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={updateExisting} onChange={(event) => setUpdateExisting(event.target.checked)} />
                  Perbarui produk yang sudah ada
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={importStock} onChange={(event) => setImportStock(event.target.checked)} />
                  Impor stok awal
                </label>
                {importStock && warehouses.length > 0 ? (
                  <select
                    value={warehouseId}
                    onChange={(event) => setWarehouseId(event.target.value)}
                    className="h-9 rounded border border-input bg-background px-1.5 text-[11px]"
                  >
                    {warehouses.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </select>
                ) : null}
                {importStock ? (
                  <span className="flex items-center gap-1.5">
                    <span>Tanggal stok</span>
                    <span className="block w-32">
                      <DateField
                        value={stockDate}
                        onChange={setStockDate}
                        aria-label="Tanggal stok"
                      />
                    </span>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-2 border-b border-border px-4 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    disabled={rowsLoading || !uploaded || savingRow !== null}
                    onClick={() => {
                      if (uploaded) void flow.loadRows(uploaded.jobId, 1, chip.key);
                    }}
                    className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-medium disabled:opacity-50 ${
                      rowsFilter === chip.key
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card hover:bg-muted"
                    }`}
                  >
                    {chip.label}
                    {counts ? <span className="num ml-1">({formatNumber(chip.count(counts))})</span> : null}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <button
                  type="button"
                  disabled={rowsLoading || selectableRowNumbers.length === 0}
                  onClick={() => setExcluded(new Set())}
                  className="h-8 rounded-md border border-border px-2.5 hover:bg-muted disabled:opacity-50"
                >
                  Pilih semua yang siap
                </button>
                <button
                  type="button"
                  disabled={rowsLoading || selectedCount === 0}
                  onClick={() => setExcluded(new Set(selectableRowNumbers))}
                  className="h-8 rounded-md border border-border px-2.5 hover:bg-muted disabled:opacity-50"
                >
                  Kosongkan pilihan
                </button>
                <button
                  type="button"
                  disabled={rowsLoading || filterRowNumbers.length === 0}
                  onClick={() =>
                    setExcluded((current) => {
                      const next = new Set(current);
                      for (const n of filterRowNumbers) next.delete(n);
                      return next;
                    })
                  }
                  className="h-8 rounded-md border border-border px-2.5 hover:bg-muted disabled:opacity-50"
                >
                  Pilih semua hasil filter
                </button>
                <button
                  type="button"
                  disabled={rowsLoading || filterRowNumbers.length === 0}
                  onClick={() =>
                    setExcluded((current) => {
                      const next = new Set(current);
                      for (const n of filterRowNumbers) next.add(n);
                      return next;
                    })
                  }
                  className="h-8 rounded-md border border-border px-2.5 hover:bg-muted disabled:opacity-50"
                >
                  Batalkan pilihan hasil filter
                </button>
                <span className="font-medium">
                  {formatNumber(selectedCount)} dari {formatNumber(selectableRowNumbers.length)} baris siap dipilih
                </span>
                {excluded.size > 0 ? (
                  <span className="text-muted-foreground">
                    {formatNumber(excluded.size)} baris dikecualikan dari impor.
                  </span>
                ) : null}
                {rowsLoading ? <span className="text-muted-foreground">Memuat baris…</span> : null}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Sel nama, SKU, barcode, satuan, dan harga pada baris yang belum diproses bisa diubah langsung —
                klasifikasi baris dihitung ulang setiap kali selesai mengedit.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8">
                      <input
                        type="checkbox"
                        checked={
                          previewRows.some((row) => row.flags?.siap) &&
                          previewRows
                            .filter((row) => row.flags?.siap)
                            .every((row) => !excluded.has(row.rowNumber))
                        }
                        onChange={(event) =>
                          setExcluded((current) => {
                            const next = new Set(current);
                            for (const row of previewRows.filter((r) => r.flags?.siap)) {
                              if (event.target.checked) next.delete(row.rowNumber);
                              else next.add(row.rowNumber);
                            }
                            return next;
                          })
                        }
                        aria-label="Pilih semua baris lengkap di halaman ini"
                      />
                    </th>
                    <th className="text-right">Baris</th>
                    <th>SKU</th>
                    <th>Nama</th>
                    <th>Barcode</th>
                    <th>Satuan</th>
                    <th className="text-right">Harga beli</th>
                    <th className="text-right">Harga jual</th>
                    <th className="text-right">Stok</th>
                    <th>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const ready = row.flags?.siap ?? false;
                    const included = ready && !excluded.has(row.rowNumber);
                    const editable = row.status === "pending" && row.cells;
                    const hints = row.flags ? flagHints(row) : null;
                    return (
                      <tr key={row.id} className={excluded.has(row.rowNumber) ? "opacity-50" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={included}
                            disabled={row.status !== "pending" || !ready}
                            onChange={(event) =>
                              setExcluded((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.delete(row.rowNumber);
                                else next.add(row.rowNumber);
                                return next;
                              })
                            }
                            aria-label={`Baris ${row.rowNumber}`}
                          />
                        </td>
                        <td className="num text-right text-[11px] text-muted-foreground">{row.rowNumber}</td>
                        {editable ? (
                          <>
                            <td>
                              <CellInput
                                key={`${row.id}-sku-${row.cells!.sku}`}
                                initial={row.cells!.sku}
                                disabled={savingRow !== null}
                                onSave={(value) => void saveCell(row, "sku", value)}
                                ariaLabel={`SKU baris ${row.rowNumber}`}
                              />
                            </td>
                            <td className="min-w-[170px]">
                              <CellInput
                                key={`${row.id}-name-${row.cells!.name}`}
                                initial={row.cells!.name}
                                disabled={savingRow !== null}
                                onSave={(value) => void saveCell(row, "name", value)}
                                ariaLabel={`Nama baris ${row.rowNumber}`}
                              />
                            </td>
                            <td>
                              <CellInput
                                key={`${row.id}-barcode-${row.cells!.barcode}`}
                                initial={row.cells!.barcode}
                                disabled={savingRow !== null}
                                onSave={(value) => void saveCell(row, "barcode", value)}
                                ariaLabel={`Barcode baris ${row.rowNumber}`}
                              />
                            </td>
                            <td>
                              <CellInput
                                key={`${row.id}-unit-${row.cells!.unit}`}
                                initial={row.cells!.unit}
                                disabled={savingRow !== null}
                                onSave={(value) => void saveCell(row, "unit", value)}
                                ariaLabel={`Satuan baris ${row.rowNumber}`}
                              />
                            </td>
                            <td>
                              <MoneyCellInput
                                key={`${row.id}-costPrice-${row.cells!.costPrice}`}
                                initial={row.cells!.costPrice}
                                disabled={savingRow !== null}
                                onSave={(value) => void saveCell(row, "costPrice", value)}
                                ariaLabel={`Harga beli baris ${row.rowNumber}`}
                              />
                            </td>
                            <td>
                              <MoneyCellInput
                                key={`${row.id}-salePrice-${row.cells!.salePrice}`}
                                initial={row.cells!.salePrice}
                                disabled={savingRow !== null}
                                onSave={(value) => void saveCell(row, "salePrice", value)}
                                ariaLabel={`Harga jual baris ${row.rowNumber}`}
                              />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="num text-[11px]">{row.preview?.sku ?? "—"}</td>
                            <td className="max-w-[260px] truncate text-[12px]">{row.preview?.name ?? "—"}</td>
                            <td className="num text-[11px]">{row.preview?.barcode ?? "—"}</td>
                            <td className="text-[11px]">{row.preview?.unit ?? "—"}</td>
                            <td className="num text-right text-[11px]">{row.preview ? formatIDR(row.preview.costPrice) : "—"}</td>
                            <td className="num text-right text-[11px]">{row.preview ? formatIDR(row.preview.salePrice) : "—"}</td>
                          </>
                        )}
                        <td className="num text-right text-[11px]">{row.preview?.stock ?? "—"}</td>
                        <td className="max-w-[240px] text-[11px]">
                          {row.error ? (
                            <span className="font-medium text-destructive">{row.error}</span>
                          ) : hints ? (
                            <span className="text-muted-foreground">{hints}</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {row.status === "pending" ? "Siap" : row.status}
                            </span>
                          )}
                          {row.edited ? (
                            <span className="ml-1.5 rounded bg-tone-amber-soft px-1 py-0.5 text-[10px] font-medium text-tone-amber">
                              diubah
                            </span>
                          ) : null}
                          {savingRow === row.rowNumber ? (
                            <span className="ml-1.5 text-muted-foreground">menyimpan…</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {previewRows.length === 0 ? (
                <p className="px-4 py-5 text-center text-[11px] text-muted-foreground">
                  {FILTER_EMPTY_TEXT[rowsFilter] ?? "Tidak ada baris untuk ditampilkan."}
                </p>
              ) : null}
            </div>

            <ImportRowsPager
              page={rowsPage}
              total={rowsTotal}
              pageSize={flow.pageSize}
              loading={rowsLoading}
              filtered={rowsFilter !== "all"}
              totalFileRows={analysis.summary.totalRows}
              onPage={(page) => {
                if (uploaded) void flow.loadRows(uploaded.jobId, page, rowsFilter);
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
              <p className="text-[11px] text-muted-foreground">
                Baris belum lengkap tetap bisa dipilih dan diimpor: SKU kosong dibuat otomatis, barcode/satuan
                kosong disimpan tanpa nilai, dan harga kosong menjadi 0. Baris bermasalah harus diperbaiki atau
                dibiarkan tidak dipilih. Baris yang tidak dicentang akan dilewati.
                {analysis.summary.newCategories.length > 0 ? ` Kategori baru: ${analysis.summary.newCategories.slice(0, 5).join(", ")}.` : ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void flow.analyze()}
                  disabled={busy || savingRow !== null}
                  className="h-8 rounded-md border border-border px-3 text-[12px] hover:bg-muted disabled:opacity-50"
                >
                  Validasi ulang
                </button>
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={busy || done || selectedCount === 0 || savingRow !== null}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  {done ? "Selesai" : busy ? "Mengimpor…" : `Impor ${formatNumber(selectedCount)} produk terpilih`}
                </button>
              </div>
            </div>

            {progress ? (
              <ImportProgressBar progress={progress} totalRows={analysis.summary.totalRows} />
            ) : null}
          </div>
        </>
      ) : null}

      <ImportHistoryTable
        history={history}
        busy={busy}
        onCancelRequest={(jobId) => flow.setPendingCancelJob(jobId)}
        renderAction={(job) =>
          job.status === "preview" ? (
            <button
              type="button"
              onClick={() => flow.setPendingCancelJob(job.id)}
              disabled={busy}
              className="text-destructive underline disabled:opacity-50"
            >
              Batalkan
            </button>
          ) : job.journalId ? (
            // A-24 T4: jurnal saldo awal persediaan dari
            // impor ini (bila file membawa stok awal).
            <Link href={`/app/akuntansi/jurnal/${job.journalId}`} className="num font-medium text-primary hover:underline">
              Jurnal {job.journalNumber ?? ""}
            </Link>
          ) : (
            "—"
          )
        }
      />
      <ImportCancelDialog
        open={pendingCancelJob !== null}
        busy={busy}
        onConfirm={() => {
          if (pendingCancelJob) void flow.cancelJob(pendingCancelJob);
        }}
        onCancel={() => flow.setPendingCancelJob(null)}
      />
    </div>
  );
}

function flagHints(row: PreviewRow): string | null {
  const flags = row.flags;
  if (!flags) return null;
  const hints: string[] = [];
  if (flags.duplikatDalamBerkas) hints.push("Duplikat di file");
  if (flags.duplikatKatalog) hints.push("Sudah ada di katalog");
  if (flags.belumLengkap) {
    const missing: string[] = [];
    if (!row.cells?.sku.trim()) missing.push("SKU");
    if (!row.cells?.name.trim()) missing.push("Nama");
    if (!row.cells?.barcode.trim()) missing.push("Barcode");
    if (!row.cells?.unit.trim()) missing.push("Satuan");
    if (!(row.preview?.costPrice && row.preview.costPrice > 0)) missing.push("Harga beli");
    if (!(row.preview?.salePrice && row.preview.salePrice > 0)) missing.push("Harga jual");
    if (missing.length > 0) hints.push(`Belum lengkap: ${missing.join(", ")}`);
  }
  return hints.length > 0 ? hints.join(" · ") : null;
}

/**
 * Sel harga yang bisa diedit di tempat dengan format rupiah id-ID
 * (pemisah ribuan saat mengetik). Menyimpan sekali saat blur/Enter —
 * bukan setiap ketikan — dan tidak menyimpan input yang belum valid.
 */
function MoneyCellInput({
  initial,
  onSave,
  disabled,
  ariaLabel,
}: {
  initial: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [valid, setValid] = useState(true);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        if (valid && draft !== initial) onSave(draft);
      }}
    >
      <MoneyInput
        value={draft}
        onChange={setDraft}
        onValidityChange={setValid}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder="Kosong"
        className="min-w-[88px]"
      />
    </div>
  );
}

/**
 * Sel pratinjau yang bisa diedit di tempat (A-10/D-21). Nilai awal
 * berasal dari server; komponen dipasang ulang (lewat `key` yang
 * memuat nilai server) setiap kali nilai tersimpan berubah, dan
 * perubahan dikirim ke server saat fokus lepas atau Enter ditekan.
 */
function CellInput({
  initial,
  onSave,
  disabled,
  ariaLabel,
}: {
  initial: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== initial) onSave(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      aria-label={ariaLabel}
      className="h-9 w-full min-w-[64px] rounded border border-input bg-background px-1.5 text-[11px] disabled:opacity-50"
    />
  );
}
