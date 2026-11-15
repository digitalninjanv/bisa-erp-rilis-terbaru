import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A-25 U2 — DocumentForm: kerangka form dokumen TUNGGAL
 * (ARAH-DESAIN-A25 §3.6). Susunan tetap:
 *
 * - Kolom utama: kartu kepala (`header` — pihak, tanggal, gudang;
 *   field inti saja) lalu kartu editor (`children` — baris-baris
 *   item dengan total hidup di kakinya).
 * - Rel kanan 320px menempel (sticky): kartu ringkasan (`summary` —
 *   total & keadaan dokumen, selalu terlihat saat mengisi baris)
 *   dan panduan (`guide`) sebagai bagian TERLIPAT bawaan tertutup —
 *   bantuan tidak lagi memajaki lebar form secara permanen
 *   (AUDIT-UI-A25 POLA-13).
 * - Field lanjutan pemanggil dibungkus `DocumentFormAdvanced`
 *   (bagian terlipat bawaan tertutup) di dalam kartu yang relevan.
 * - `actions` — bilah aksi terpaku di dasar area form: Batal +
 *   aksi sekunder di kiri/kanan sesuai pemanggil, satu primer.
 *
 * Komponen ini bingkai presentasi murni (server component): state,
 * validasi, dan pengiriman tetap milik form pemanggil.
 */
export function DocumentForm({
  header,
  children,
  summary,
  guide,
  guideTitle = "Panduan singkat",
  actions,
  className,
  onSubmit,
}: {
  header?: React.ReactNode;
  children?: React.ReactNode;
  summary?: React.ReactNode;
  guide?: React.ReactNode;
  guideTitle?: string;
  actions?: React.ReactNode;
  className?: string;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
}) {
  const hasRail = Boolean(summary || guide);
  const body = (
    <>
      <div className={cn("items-start gap-3", hasRail && "grid xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0 space-y-3">
          {header ? (
            <section className="overflow-hidden rounded-lg border border-border bg-card">{header}</section>
          ) : null}
          {children ? (
            <section className="overflow-hidden rounded-lg border border-border bg-card">{children}</section>
          ) : null}
        </div>
        {hasRail ? (
          <aside className="mt-3 min-w-0 space-y-3 self-start xl:sticky xl:top-4 xl:mt-0">
            {summary}
            {guide ? (
              <details className="group rounded-lg border border-border bg-card px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-semibold [&::-webkit-details-marker]:hidden">
                  {guideTitle}
                  <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 text-[11px] leading-5 text-muted-foreground">{guide}</div>
              </details>
            ) : null}
          </aside>
        ) : null}
      </div>
      {actions ? (
        <div className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur">
          {actions}
        </div>
      ) : null}
    </>
  );
  return onSubmit ? (
    <form className={className} onSubmit={onSubmit}>
      {body}
    </form>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Bagian field lanjutan terlipat (progressive disclosure,
 * ARAH-DESAIN-A25 §4.1 butir 1): tertutup bawaan; isinya hanya
 * dirender pengguna yang memang membukanya.
 */
export function DocumentFormAdvanced({
  title = "Opsi lanjutan",
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
