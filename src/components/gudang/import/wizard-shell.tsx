"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { formatNumber } from "@/lib/money";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import type { ImportProgress, ImportUploaded } from "./use-import-wizard";

/**
 * A-26 Q6 (P-07/D-03): potongan tampilan rangka wizard impor yang
 * dipakai bersama wizard produk & wizard master (lihat
 * use-import-wizard.ts untuk orkestrasi alurnya). Isi langkah yang
 * spesifik per jenis impor — kartu statistik, tabel pratinjau, opsi
 * commit — tetap dirender wizard masing-masing. Teks & perilaku
 * potongan di sini identik dengan kedua wizard asal.
 */

export type ImportHistoryJob = {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  createdAt: string;
  journalId?: string | null;
  journalNumber?: string | null;
};

/** Langkah 1: kartu unggah berkas (pola pilih berkas GDG-09). */
export function ImportUploadCard(props: {
  title: string;
  hint: ReactNode;
  templateHref: string;
  fileName: string | null;
  uploading: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-tone-amber-soft text-tone-amber">
          <FileSpreadsheet className="size-4" />
        </span>
        <div>
          <h2 className="text-[14px] font-semibold">{props.title}</h2>
          <p className="text-[11px] text-muted-foreground">Format XLSX atau CSV. Baris pertama harus berisi nama kolom.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* A-25 U3 (GDG-09): input berkas tidak lagi mentah bawaan
            peramban — tombol label bergaya aplikasi + nama berkas
            terpilih; input aslinya tersembunyi. */}
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted">
          <Upload className="size-3.5" /> Pilih berkas
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => props.onFileChange(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>
        <span className="num max-w-[260px] truncate text-[12px] text-muted-foreground">
          {props.fileName ?? "Belum ada berkas dipilih"}
        </span>
        <button
          type="button"
          onClick={props.onUpload}
          disabled={props.uploading}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {props.uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {props.uploading ? "Membaca…" : "Unggah & baca"}
        </button>
        <Link
          href={props.templateHref}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] hover:bg-muted"
        >
          <Download className="size-3.5" /> Unduh contoh CSV
        </Link>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{props.hint}</p>
    </div>
  );
}

/** Langkah 2: kartu pemetaan kolom + tombol pratinjau & validasi. */
export function ImportMappingCard(props: {
  uploaded: ImportUploaded;
  fields: { key: string; label: string; required?: boolean }[];
  mapping: Record<string, string>;
  onMappingChange: (key: string, value: string) => void;
  busy: boolean;
  showAnalyze: boolean;
  onAnalyze: () => void;
  onCancelRequest: () => void;
  onResetFile: () => void;
}) {
  const { uploaded } = props;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Pemetaan kolom</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {uploaded.fileName} · {formatNumber(uploaded.totalRows)} baris · {uploaded.headers.length} kolom
          </p>
          {uploaded.ignoredSheets && uploaded.ignoredSheets.length > 0 ? (
            <p className="mt-0.5 text-[11px] font-medium text-tone-amber">
              Sheet lain tidak dibaca: {uploaded.ignoredSheets.join(", ")} — hanya sheet &quot;{uploaded.sheet}&quot; yang diimpor.
            </p>
          ) : null}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Pratinjau tersimpan sebagai staging — data master belum berubah sampai Anda menjalankan impor (commit).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={props.onCancelRequest}
            disabled={props.busy}
            className="text-[11px] text-destructive underline disabled:opacity-50"
          >
            Batalkan impor
          </button>
          <button
            type="button"
            onClick={props.onResetFile}
            className="text-[11px] text-muted-foreground underline"
          >
            Ganti file
          </button>
        </div>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {props.fields.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {field.label}
              {field.required ? <span className="text-destructive"> *</span> : null}
            </span>
            <select
              value={props.mapping[field.key] ?? ""}
              onChange={(event) => props.onMappingChange(field.key, event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12px]"
            >
              <option value="">— tidak diimpor —</option>
              {uploaded.headers.map((header) => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {props.showAnalyze ? (
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={props.onAnalyze}
            disabled={props.busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {props.busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Pratinjau & validasi
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Bilah kemajuan commit bertahap di kaki kartu pratinjau. */
export function ImportProgressBar(props: { progress: ImportProgress; totalRows: number }) {
  const { progress } = props;
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Diproses {formatNumber(progress.processed)} · berhasil {formatNumber(progress.imported)} ·
          dilewati {formatNumber(progress.skipped)} · gagal {formatNumber(progress.failed)}
        </span>
        <span>Sisa {formatNumber(progress.remaining)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-tone-teal transition-all"
          style={{
            // Baris yang dilewati (bermasalah/belum lengkap) tidak masuk
            // `processed`; saat sisa 0, pekerjaan memang tuntas — jangan
            // biarkan bar berhenti di 49%.
            width: `${
              progress.remaining === 0
                ? 100
                : Math.min(100, (progress.processed / Math.max(1, props.totalRows)) * 100)
            }%`,
          }}
        />
      </div>
    </div>
  );
}

/** Kaki paginasi tabel baris pratinjau. */
export function ImportRowsPager(props: {
  page: number;
  total: number;
  pageSize: number;
  loading: boolean;
  filtered: boolean;
  /** Wizard produk menambahkan jumlah total baris berkas di akhir kalimat. */
  totalFileRows?: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
      <p className="text-[11px] text-muted-foreground">
        {props.total === 0
          ? "Tidak ada baris yang cocok dengan tampilan ini."
          : `Menampilkan ${formatNumber((props.page - 1) * props.pageSize + 1)}–${formatNumber(Math.min(props.total, props.page * props.pageSize))} dari ${formatNumber(props.total)} baris${props.filtered ? " (sesuai filter)" : ""}${props.totalFileRows !== undefined ? `, total ${formatNumber(props.totalFileRows)} baris pada file.` : "."}`}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={props.loading || props.page <= 1}
          onClick={() => props.onPage(props.page - 1)}
          className="h-8 rounded-md border border-border px-2.5 text-[11px] hover:bg-muted disabled:opacity-50"
        >
          Sebelumnya
        </button>
        <span className="text-[11px] text-muted-foreground">
          Halaman {props.page} dari {pageCount}
        </span>
        <button
          type="button"
          disabled={props.loading || props.page >= pageCount}
          onClick={() => props.onPage(props.page + 1)}
          className="h-8 rounded-md border border-border px-2.5 text-[11px] hover:bg-muted disabled:opacity-50"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}

function renderImportStatus(status: string) {
  switch (status) {
    case "committed":
    case "completed":
    case "success":
      return <span className="inline-flex items-center rounded-full bg-tone-green-soft px-2 py-0.5 text-[10px] font-semibold text-tone-green">Selesai</span>;
    case "preview":
      return <span className="inline-flex items-center rounded-full bg-tone-amber-soft px-2 py-0.5 text-[10px] font-semibold text-tone-amber">Pratinjau</span>;
    case "cancelled":
      return <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Dibatalkan</span>;
    case "failed":
    case "error":
      return <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">Gagal</span>;
    default:
      return <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">{status}</span>;
  }
}

/**
 * Tabel riwayat impor di bawah wizard. Sel aksi bawaan: tombol
 * batalkan untuk job berstatus preview; wizard produk meneruskan
 * renderAction sendiri (tautan jurnal saldo awal).
 */
export function ImportHistoryTable(props: {
  history: ImportHistoryJob[];
  busy: boolean;
  onCancelRequest: (jobId: string) => void;
  renderAction?: (job: ImportHistoryJob) => ReactNode;
}) {
  if (props.history.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Riwayat impor</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Waktu</th>
              <th className="text-right">Baris</th>
              <th className="text-right">Berhasil</th>
              <th className="text-right">Gagal</th>
              <th>Status</th>
              <th className="text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {props.history.map((job) => (
              <tr key={job.id}>
                <td className="max-w-[260px] truncate text-[12px] font-medium">{job.fileName}</td>
                <td className="num text-[11px] text-muted-foreground">{job.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td className="num text-right text-[11px]">{formatNumber(job.totalRows)}</td>
                <td className="num text-right text-[11px]">{formatNumber(job.successRows)}</td>
                <td className="num text-right text-[11px]">{formatNumber(job.failedRows)}</td>
                <td className="text-[11px]">{renderImportStatus(job.status)}</td>
                <td className="text-[11px]">
                  {props.renderAction ? (
                    props.renderAction(job)
                  ) : job.status === "preview" ? (
                    <button
                      type="button"
                      onClick={() => props.onCancelRequest(job.id)}
                      disabled={props.busy}
                      className="text-destructive underline disabled:opacity-50"
                    >
                      Batalkan
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Dialog konfirmasi batalkan impor — teks yang sama di semua wizard. */
export function ImportCancelDialog(props: {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title="Batalkan impor ini?"
      description="Job dan barisnya tetap tersimpan sebagai riwayat berstatus dibatalkan; tidak ada data yang terlanjur dibuat dari job ini."
      confirmLabel="Batalkan impor"
      danger
      busy={props.busy}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}
