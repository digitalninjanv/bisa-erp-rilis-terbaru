"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { DateField } from "@/components/date-field";
import { todayISO } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { ENTITY_FIELDS, type ImportEntity } from "@/lib/import-parse";
import { StatCard } from "@/components/blocks/stat-card";
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

type MasterEntity = Exclude<ImportEntity, "products">;
type MasterAnalysis = {
  summary: {
    totalRows: number;
    valid: number;
    existingCount: number;
    duplicateInFile: number;
    invalidRows: number;
    unknownGroups: string[];
    unknownProducts: number;
  };
};
type PreviewRow = {
  id: string;
  rowNumber: number;
  status: string;
  error: string | null;
  preview: { label: string; detail: string } | null;
};

const ROWS_PAGE_SIZE = 50;
type RowsFilter = "all" | "problem" | "valid";

/**
 * T4-5a: wizard impor untuk pemasok, pelanggan, akun, dan stok awal.
 * Alurnya meniru wizard produk (unggah → petakan → validasi → pilih
 * baris → commit bertahap); yang berbeda hanya field, pratinjau
 * label/detail, dan — khusus stok awal — gudang tujuan + satu nomor
 * penerimaan hasil commit.
 *
 * A-26 Q6 (P-07/D-03): alur bersama itu kini benar-benar satu
 * kerangka (useImportWizard + wizard-shell); berkas ini hanya
 * menyimpan isi spesifik master di atasnya.
 */
export function MasterImportWizard({
  entity,
  title,
  description,
  warehouses,
  defaultWarehouseId,
  history,
}: {
  entity: MasterEntity;
  title: string;
  description: string;
  warehouses: { id: string; name: string }[];
  defaultWarehouseId?: string;
  history: ImportHistoryJob[];
}) {
  const fields = ENTITY_FIELDS[entity];
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses[0]?.id || "");
  // Tanggal cut-off impor stok awal; baris dengan kolom Tanggal menang.
  const [stockDate, setStockDate] = useState(todayISO());
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);

  const flow = useImportWizard<MasterAnalysis, PreviewRow, RowsFilter>({
    parseEntity: entity,
    pageSize: ROWS_PAGE_SIZE,
    onUploaded: () => setReceiptNumber(null),
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

  async function commit() {
    await flow.commit({
      validate: () =>
        entity === "opening_stock" && !warehouseId
          ? "Pilih gudang tujuan stok awal terlebih dahulu."
          : entity === "opening_stock" && !stockDate
            ? "Pilih tanggal cut-off stok awal terlebih dahulu."
            : null,
      buildInput: (base) => ({
        ...base,
        warehouseId: warehouseId || undefined,
        ...(entity === "opening_stock" ? { date: stockDate || undefined } : {}),
      }),
      onBatch: (data) => {
        if (data.receiptNumber) setReceiptNumber(data.receiptNumber);
      },
      successMessage: ({ imported, failed }) =>
        `Impor selesai: ${formatNumber(imported)} berhasil, ${formatNumber(failed)} gagal.`,
    });
  }

  const problemCount = analysis
    ? analysis.summary.invalidRows + analysis.summary.duplicateInFile
    : 0;

  return (
    <div className="space-y-3">
      {!uploaded ? (
        <ImportUploadCard
          title={title}
          hint={description}
          templateHref={`/api/import/template/${entity}?format=xlsx`}
          fileName={flow.file?.name ?? null}
          uploading={flow.uploading}
          onFileChange={flow.setFile}
          onUpload={() => void flow.upload()}
        />
      ) : null}

      {uploaded ? (
        <ImportMappingCard
          uploaded={uploaded}
          fields={fields}
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
            <StatCard label="Siap diimpor" value={formatNumber(analysis.summary.valid)} valueClassName="text-tone-green" />
            <StatCard label="Sudah ada" value={formatNumber(analysis.summary.existingCount)} valueClassName="text-tone-amber" />
            <StatCard label="Bermasalah" value={formatNumber(problemCount)} valueClassName="text-destructive" />
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">Pratinjau baris</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Pratinjau persisten (staging) — data master belum berubah sampai impor dijalankan.
                </p>
              </div>
              {entity === "opening_stock" && warehouses.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px]">
                    Gudang tujuan
                    <select
                      value={warehouseId}
                      onChange={(event) => setWarehouseId(event.target.value)}
                      className="h-9 rounded border border-input bg-background px-1.5 text-[11px]"
                    >
                      {warehouses.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                  </label>
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span>Tanggal cut-off</span>
                    <span className="block w-32">
                      <DateField
                        value={stockDate}
                        onChange={setStockDate}
                        aria-label="Tanggal cut-off"
                      />
                    </span>
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Tampilkan
                <select
                  value={rowsFilter}
                  disabled={rowsLoading}
                  onChange={(event) => {
                    if (uploaded) void flow.loadRows(uploaded.jobId, 1, event.target.value as RowsFilter);
                  }}
                  className="h-9 rounded border border-input bg-background px-1.5 text-[11px] text-foreground"
                >
                  <option value="all">Semua baris</option>
                  <option value="problem">Bermasalah saja</option>
                  <option value="valid">Siap saja</option>
                </select>
              </label>
              {excluded.size > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {formatNumber(excluded.size)} baris dikecualikan dari impor.
                </span>
              ) : null}
              {rowsLoading ? <span className="text-[11px] text-muted-foreground">Memuat baris…</span> : null}
            </div>

            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8">
                      <input
                        type="checkbox"
                        checked={
                          previewRows.some((row) => row.status === "pending") &&
                          previewRows
                            .filter((row) => row.status === "pending")
                            .every((row) => !excluded.has(row.rowNumber))
                        }
                        onChange={(event) =>
                          setExcluded((current) => {
                            const next = new Set(current);
                            for (const row of previewRows.filter((r) => r.status === "pending")) {
                              if (event.target.checked) next.delete(row.rowNumber);
                              else next.add(row.rowNumber);
                            }
                            return next;
                          })
                        }
                        aria-label="Pilih semua baris di halaman ini"
                      />
                    </th>
                    <th className="text-right">Baris</th>
                    <th>Isi</th>
                    <th>Detail</th>
                    <th>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const included = !excluded.has(row.rowNumber);
                    return (
                      <tr key={row.id} className={included ? "" : "opacity-50"}>
                        <td>
                          <input
                            type="checkbox"
                            checked={included}
                            disabled={row.status !== "pending"}
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
                        <td className="max-w-[300px] truncate text-[12px]">{row.preview?.label ?? "—"}</td>
                        <td className="num text-[11px] text-muted-foreground">{row.preview?.detail ?? "—"}</td>
                        <td className={`max-w-[260px] truncate text-[11px] ${row.error ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                          {row.error ?? (row.status === "pending" ? "Siap" : row.status)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {previewRows.length === 0 ? (
                <p className="px-4 py-5 text-center text-[11px] text-muted-foreground">
                  {rowsFilter === "problem"
                    ? "Tidak ada baris bermasalah — semua baris siap diimpor."
                    : "Tidak ada baris untuk ditampilkan."}
                </p>
              ) : null}
            </div>

            <ImportRowsPager
              page={rowsPage}
              total={rowsTotal}
              pageSize={flow.pageSize}
              loading={rowsLoading}
              filtered={rowsFilter !== "all"}
              onPage={(page) => {
                if (uploaded) void flow.loadRows(uploaded.jobId, page, rowsFilter);
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
              <p className="text-[11px] text-muted-foreground">
                Baris yang tidak dicentang akan dilewati saat impor.
                {entity === "opening_stock"
                  ? " Seluruh baris valid digabung menjadi satu dokumen penerimaan stok awal."
                  : ""}
                {receiptNumber ? ` Penerimaan stok awal: ${receiptNumber}.` : ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void flow.analyze()}
                  disabled={busy}
                  className="h-8 rounded-md border border-border px-3 text-[12px] hover:bg-muted disabled:opacity-50"
                >
                  Validasi ulang
                </button>
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={busy || done}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  {done ? "Selesai" : busy ? "Mengimpor…" : "Mulai impor"}
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
