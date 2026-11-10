import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkQueueTone = "red" | "amber" | "teal" | "plum" | "neutral";

const TONE_CHIP: Record<WorkQueueTone, string> = {
  red: "bg-tone-red-soft text-tone-red",
  amber: "bg-tone-amber-soft text-tone-amber",
  teal: "bg-tone-teal-soft text-tone-teal",
  plum: "bg-tone-plum-soft text-tone-plum",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * A-22 Tahap K5 (pola dashboard kartu aksi Odoo): satu kartu = satu
 * antrean kerja. Seluruh kartu adalah tautan ke daftar antreannya
 * supaya pengguna sampai ke pekerjaan dalam satu klik. Antrean kosong
 * tampil redup dengan teks penenang — dashboard harus terbaca sebagai
 * "apa yang menunggu saya" dalam lima detik.
 */
export function WorkQueueCard({
  href,
  icon: Icon,
  label,
  headline,
  detail,
  actionLabel,
  tone,
  empty,
  emptyText,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Baris utama saat antrean berisi, mis. "2 nota · Rp140.000". */
  headline: string;
  /** Konteks tambahan, mis. rincian terlambat vs jatuh tempo. */
  detail?: string;
  actionLabel: string;
  tone: WorkQueueTone;
  empty: boolean;
  /** Teks yang tampil saat antrean kosong, mis. "Semua mutasi cocok". */
  emptyText: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-2xs transition-colors hover:border-primary/40",
        empty && "opacity-60 hover:opacity-90",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-md",
            empty ? "bg-muted text-muted-foreground" : TONE_CHIP[tone],
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
      </span>
      {empty ? (
        <span className="text-sm font-medium text-muted-foreground">{emptyText}</span>
      ) : (
        <>
          <span className="text-lg font-semibold leading-tight tabular-nums">{headline}</span>
          {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
        </>
      )}
      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary">
        {actionLabel}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
