import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";
import type { FlowStep } from "@/lib/document-flow";
import { StatusBadge } from "@/components/blocks/status-badge";
import { cn } from "@/lib/utils";

/**
 * A-25 U2 — StatusSteps: penanda tahap alur dokumen (pola status bar
 * Odoo, ARAH-DESAIN-A25 §3.5). Tahap dihitung pemanggil dari status
 * NYATA dokumen lewat lib/document-flow — komponen ini hanya
 * menggambar: selesai = centang di lingkaran primer lembut, aktif =
 * lingkaran primer solid, menunggu = angka redup, terminal negatif
 * (batal/dibalik) = silang merah lembut.
 */
export function StatusSteps({ steps, className }: { steps: FlowStep[]; className?: string }) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-y-1", className)} aria-label="Tahap dokumen">
      {steps.map((step, index) => (
        <li key={step.key} className="flex items-center">
          {index > 0 ? <span aria-hidden className="mx-2 h-px w-6 bg-border sm:w-10" /> : null}
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                step.state === "done" && "bg-primary-soft text-primary",
                step.state === "current" && "bg-primary text-primary-foreground",
                step.state === "todo" && "bg-muted text-muted-foreground",
                step.state === "void" && "bg-tone-red-soft text-tone-red",
              )}
            >
              {step.state === "done" ? (
                <Check className="size-3" />
              ) : step.state === "void" ? (
                <X className="size-3" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                "text-[12px]",
                step.state === "current" && "font-semibold",
                step.state === "done" && "font-medium",
                step.state === "todo" && "text-muted-foreground",
                step.state === "void" && "font-medium text-tone-red",
              )}
            >
              {step.label}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A-25 U2 — DocumentPage: kerangka halaman detail dokumen TUNGGAL
 * (menutup AUDIT-UI-A25 POLA-15: tiga varian tata letak detail hidup
 * bersama). Susunan tetap:
 *
 * - Baris kembali + rel aksi di atas kartu (aksi = langkah alur
 *   berikutnya sebagai primer, sisanya outline/menu — §4.2).
 * - Kartu kepala: eyebrow kecil, nomor dokumen besar, keterangan,
 *   StatusSteps dari status nyata + StatusBadge.
 * - `banners` — pemberitahuan konteks tepat di bawah kepala.
 * - Badan dua kolom (xl): kiri isi dokumen (baris & total), kanan
 *   rel 320px berisi kartu meta (`meta`), seksi Jurnal terkait
 *   (`journals` — komponen DocumentJournals yang ada diteruskan apa
 *   adanya), dan slot tambahan (`railExtra`, mis. riwayat audit
 *   terlipat). Di bawah xl semuanya menumpuk berurutan.
 */
export function DocumentPage({
  backHref,
  backLabel = "Kembali",
  eyebrow,
  number,
  title,
  status,
  steps,
  actions,
  banners,
  meta,
  metaTitle = "Detail dokumen",
  journals,
  railExtra,
  children,
  footer,
}: {
  backHref: string;
  backLabel?: string;
  eyebrow?: string;
  number: string;
  title?: string;
  status?: string;
  steps?: FlowStep[];
  actions?: React.ReactNode;
  banners?: React.ReactNode;
  meta?: React.ReactNode;
  metaTitle?: string;
  journals?: React.ReactNode;
  railExtra?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const hasRail = Boolean(meta || journals || railExtra);
  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={backHref}
          className="inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {backLabel}
        </Link>
        {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="num mt-1 text-[18px] font-semibold leading-tight">{number}</h1>
            {title ? <p className="mt-0.5 text-[12px] text-muted-foreground">{title}</p> : null}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {steps ? <StatusSteps steps={steps} /> : null}
            {status ? <StatusBadge status={status} /> : null}
          </div>
        </div>
        {banners}
      </div>

      <div className={cn("mt-3 items-start gap-3", hasRail && "grid xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0">
          {children}
          {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
        {hasRail ? (
          <aside className="mt-3 min-w-0 space-y-3 xl:mt-0">
            {meta ? (
              <section className="rounded-lg border border-border bg-card px-4 py-3">
                <h2 className="text-[13px] font-semibold">{metaTitle}</h2>
                <div className="mt-2">{meta}</div>
              </section>
            ) : null}
            {journals}
            {railExtra}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** Baris meta standar untuk rel DocumentPage: label redup di kiri,
 * nilai di kanan, satu pola untuk semua dokumen. */
export function DocumentMetaRows({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="space-y-1.5 text-[12px]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 text-right font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
