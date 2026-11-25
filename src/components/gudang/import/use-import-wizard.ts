"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { analyzeImportAction } from "@/server/actions/import/analyze";
import {
  cancelImportAction,
  listImportRowsAction,
  skipImportRowsAction,
} from "@/server/actions/import/rows";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import type { ProductImportFilter } from "@/lib/import-classify";

/**
 * A-26 Q6 (P-07/D-03): kerangka alur wizard impor bersama — unggah →
 * parse → petakan → analisis → muat baris → kecualikan → commit
 * bertahap. Sebelumnya seluruh alur ini disalin utuh di wizard produk
 * (import-wizard.tsx) dan wizard master (import-master-wizard.tsx)
 * (341 baris klon terukur jscpd); kini orkestrasinya hidup di sini dan
 * tiap wizard hanya menyimpan isi langkahnya yang spesifik: field,
 * tabel pratinjau, opsi commit, dan teks hasilnya. Perilaku & teks
 * tidak berubah dari kedua wizard asal.
 */

export type ImportUploaded = {
  jobId: string;
  fileName: string;
  headers: string[];
  totalRows: number;
  sheet: string;
  ignoredSheets?: string[];
  mapping: Record<string, string> | null;
};

export type ImportProgress = {
  processed: number;
  imported: number;
  failed: number;
  /** Baris yang sengaja dilewati (bermasalah/belum lengkap/tidak dipilih). */
  skipped: number;
  remaining: number;
};

export type ImportCommitOptions = {
  /**
   * Pemeriksaan sebelum commit mulai: kembalikan pesan untuk
   * membatalkan dengan toast error (mis. gudang tujuan stok awal
   * belum dipilih), atau null untuk lanjut.
   */
  validate?: () => string | null;
  /**
   * Kelompok baris tambahan yang dilewati sebelum commit (sesudah
   * baris terkecuali pengguna), dikirim per potongan 1000 sesuai
   * batas aksi lewati.
   */
  extraSkips?: { rowNumbers: number[]; keepError?: boolean; reason?: string }[];
  /** Bangun input commit dari basis { jobId, mapping, limit }. */
  buildInput: (base: {
    jobId: string;
    mapping: Record<string, string>;
    limit: number;
  }) => Parameters<typeof commitImportBatchAction>[0];
  /** Kait per hasil batch (mis. menangkap nomor penerimaan). */
  onBatch?: (data: { receiptNumber?: string | null }) => void;
  /** Teks toast sukses akhir — berbeda per jenis impor. */
  successMessage: (result: { imported: number; failed: number }) => string;
};

export function useImportWizard<
  AnalysisT extends { summary: { totalRows: number } },
  RowT,
  FilterT extends string,
>(config: {
  /** Entitas master yang dikirim ke route parse (wizard produk tidak mengirimnya). */
  parseEntity?: string;
  /**
   * Reset tambahan khusus wizard sesudah unggah berhasil (wizard
   * produk: hitungan kategori & daftar nomor baris; wizard master:
   * nomor penerimaan).
   */
  onUploaded?: () => void;
  /** Data tambahan dari hasil muat baris terbaru (khusus wizard produk). */
  onRowsLoaded?: (data: unknown) => void;
  pageSize?: number;
}) {
  const router = useRouter();
  const pageSize = config.pageSize ?? 50;
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<ImportUploaded | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<AnalysisT | null>(null);
  const [previewRows, setPreviewRows] = useState<RowT[]>([]);
  const [rowsPage, setRowsPage] = useState(1);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsFilter, setRowsFilter] = useState<FilterT>("all" as FilterT);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pendingCancelJob, setPendingCancelJob] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [done, setDone] = useState(false);

  async function upload() {
    if (!file) {
      toast.error("Pilih file XLSX atau CSV terlebih dahulu.");
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    if (config.parseEntity) form.append("entity", config.parseEntity);
    const response = await fetch("/api/import/parse", { method: "POST", body: form });
    setUploading(false);
    const payload = (await response.json()) as ImportUploaded & { error?: string };
    if (!response.ok) {
      toast.error(payload.error ?? "Gagal membaca file.");
      return;
    }
    setUploaded(payload);
    setMapping((payload.mapping ?? {}) as Record<string, string>);
    setAnalysis(null);
    setPreviewRows([]);
    setRowsPage(1);
    setRowsTotal(0);
    setRowsFilter("all" as FilterT);
    setExcluded(new Set());
    setDone(false);
    setProgress(null);
    config.onUploaded?.();
    toast.success(`${payload.totalRows.toLocaleString("id-ID")} baris terbaca dari ${payload.sheet}.`);
    if (payload.ignoredSheets && payload.ignoredSheets.length > 0) {
      toast.warning(
        `File ini punya sheet lain yang tidak dibaca: ${payload.ignoredSheets.join(", ")}. Hanya sheet "${payload.sheet}" yang diimpor.`,
      );
    }
  }

  async function loadRows(jobId: string, page: number, filter: FilterT) {
    setRowsLoading(true);
    const result = await listImportRowsAction({
      jobId,
      page,
      pageSize,
      filter: filter as ProductImportFilter,
    });
    setRowsLoading(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPreviewRows(result.data.rows as unknown as RowT[]);
    setRowsTotal(result.data.total);
    setRowsPage(page);
    setRowsFilter(filter);
    config.onRowsLoaded?.(result.data);
  }

  async function analyze(options?: { warehouseId?: string; date?: string; allowZeroCost?: boolean }) {
    if (!uploaded) return;
    setBusy(true);
    const result = await analyzeImportAction({ jobId: uploaded.jobId, mapping, ...options });
    if (!result.ok) {
      setBusy(false);
      toast.error(result.message);
      return;
    }
    setAnalysis(result.data as unknown as AnalysisT);
    await loadRows(uploaded.jobId, 1, "all" as FilterT);
    setBusy(false);
  }

  async function cancelJob(jobId: string) {
    setBusy(true);
    const result = await cancelImportAction(jobId);
    setBusy(false);
    setPendingCancelJob(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Impor dibatalkan.");
    if (uploaded?.jobId === jobId) {
      setUploaded(null);
      setAnalysis(null);
      setFile(null);
    }
    router.refresh();
  }

  /** Tombol "Ganti file": kembali ke langkah unggah tanpa membatalkan job. */
  function resetFile() {
    setUploaded(null);
    setAnalysis(null);
    setFile(null);
  }

  /** Mengubah pemetaan kolom selalu membatalkan analisis yang tampil. */
  function changeMapping(key: string, value: string) {
    setMapping((current) => ({ ...current, [key]: value }));
    setAnalysis(null);
  }

  async function commit(options: ImportCommitOptions) {
    if (!uploaded || !analysis) return;
    const validationError = options.validate?.();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    let skipped = 0;
    const skipGroups: { rowNumbers: number[]; keepError?: boolean; reason?: string }[] = [
      ...(excluded.size > 0 ? [{ rowNumbers: [...excluded] }] : []),
      ...(options.extraSkips ?? []),
    ];
    for (const group of skipGroups) {
      // GD-P3-3: kirim semua baris yang dikecualikan dalam potongan
      // sesuai batas action (1.000) — jangan memotong diam-diam,
      // baris ke-1001+ sebelumnya ikut terimpor padahal pengguna
      // mengecualikannya.
      for (let start = 0; start < group.rowNumbers.length; start += 1000) {
        const skip = await skipImportRowsAction({
          jobId: uploaded.jobId,
          rowNumbers: group.rowNumbers.slice(start, start + 1000),
          ...(group.keepError ? { keepError: true } : {}),
          ...(group.reason ? { reason: group.reason } : {}),
        });
        if (!skip.ok) {
          setBusy(false);
          toast.error(skip.message);
          return;
        }
        skipped += skip.data.skipped;
      }
    }
    let processed = 0;
    let imported = 0;
    let failed = 0;
    let remaining = analysis.summary.totalRows;
    for (let guard = 0; guard < 200; guard += 1) {
      const result = await commitImportBatchAction(
        options.buildInput({ jobId: uploaded.jobId, mapping, limit: 250 }),
      );
      if (!result.ok) {
        setBusy(false);
        toast.error(result.message);
        return;
      }
      processed += result.data.processed;
      imported += result.data.imported;
      failed += result.data.failed;
      skipped += result.data.skipped;
      remaining = result.data.remaining;
      options.onBatch?.(result.data as { receiptNumber?: string | null });
      setProgress({ processed, imported, failed, skipped, remaining });
      if (result.data.done || result.data.processed === 0) break;
    }
    setBusy(false);
    setDone(true);
    toast.success(options.successMessage({ imported, failed }));
    router.refresh();
  }

  return {
    file,
    setFile,
    uploading,
    uploaded,
    mapping,
    setMapping,
    changeMapping,
    analysis,
    setAnalysis,
    previewRows,
    rowsPage,
    rowsTotal,
    rowsFilter,
    rowsLoading,
    excluded,
    setExcluded,
    busy,
    pendingCancelJob,
    setPendingCancelJob,
    progress,
    done,
    pageSize,
    upload,
    loadRows,
    analyze,
    cancelJob,
    resetFile,
    commit,
  };
}
