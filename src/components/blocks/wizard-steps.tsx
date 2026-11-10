"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
  key: string;
  label: string;
  description?: string;
};

/**
 * A-25 U2 — WizardSteps: pola alur bertahap resmi (ARAH-DESAIN-A25
 * §3.9). Indikator langkah di puncak (selesai = centang, aktif =
 * primer, berikutnya = redup; langkah yang sudah dilewati dapat
 * diklik kembali bila `onNavigate` diberikan), isi langkah aktif
 * dari pemanggil, dan bilah navigasi konsisten: Kembali (ghost) di
 * kiri, Lanjut/Selesai (primer tunggal) di kanan.
 *
 * Untuk: impor data, opname, payroll, tutup periode (pemasangan per
 * modul di U3–U5). Komponen ini presentasi + navigasi saja; isi &
 * validasi tiap langkah milik pemanggil (`nextDisabled` menahan
 * Lanjut sampai langkah sah).
 */
export function WizardSteps({
  steps,
  current,
  onNavigate,
  onBack,
  onNext,
  nextLabel = "Lanjut",
  finishLabel = "Selesai",
  backLabel = "Kembali",
  busy = false,
  nextDisabled = false,
  children,
  className,
}: {
  steps: WizardStep[];
  /** Indeks langkah aktif (0-based). */
  current: number;
  onNavigate?: (index: number) => void;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  finishLabel?: string;
  backLabel?: string;
  busy?: boolean;
  nextDisabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const isFirst = current === 0;
  const isLast = current === steps.length - 1;
  return (
    <div className={className}>
      <ol className="flex flex-wrap items-start gap-y-2" aria-label="Langkah">
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const clickable = Boolean(onNavigate) && index < current;
          return (
            <li key={step.key} className="flex items-start">
              {index > 0 ? <span aria-hidden className="mx-3 mt-4 h-px w-8 bg-border sm:w-14" /> : null}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onNavigate?.(index)}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 text-center",
                  clickable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-8 place-items-center rounded-full text-[12px] font-semibold",
                    state === "done" && "bg-primary-soft text-primary",
                    state === "current" && "bg-primary text-primary-foreground",
                    state === "todo" && "bg-muted text-muted-foreground",
                  )}
                >
                  {state === "done" ? <Check className="size-4" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "text-[12px] leading-tight",
                    state === "current" && "font-semibold",
                    state === "done" && "font-medium",
                    state === "todo" && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                {step.description ? (
                  <span className="max-w-36 text-[11px] leading-tight text-muted-foreground">
                    {step.description}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      {children ? <div className="mt-4">{children}</div> : null}

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isFirst || busy || !onBack}
          className="inline-flex h-9 items-center rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          {backLabel}
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          Langkah {current + 1} dari {steps.length}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={busy || nextDisabled || !onNext}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Memproses…" : isLast ? finishLabel : nextLabel}
        </button>
      </div>
    </div>
  );
}
