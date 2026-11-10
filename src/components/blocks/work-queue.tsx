import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkQueueTone = "red" | "amber" | "teal" | "plum" | "neutral";

const TONE_CHIP: Record<WorkQueueTone, string> = {
  red: "bg-tone-red-soft text-tone-red",
  amber: "bg-tone-amber-soft text-tone-amber",
  teal: "bg-tone-teal-soft text-tone-teal",
  plum: "bg-tone-plum-soft text-tone-plum",
  neutral: "bg-muted text-muted-foreground",
};

export type WorkQueueItem = {
  key: string;
  /** Judul pekerjaan, mis. "Piutang terlambat". */
  label: string;
  /** Jumlah pekerjaan menunggu — penentu render (lihat komponen). */
  count: number;
  /** Baris utama kartu, mis. "3 nota · Rp1.250.000". Bawaan:
   * `${count} menunggu`. */
  headline?: string;
  detail?: string;
  href: string;
  actionLabel: string;
  tone?: WorkQueueTone;
  icon?: React.ReactNode;
};

/**
 * A-25 U2 — WorkQueue: antrean kerja resmi beranda modul
 * (ARAH-DESAIN-A25 §3.4; menutup AUDIT-UI-A25 POLA-08/POLA-09 pada
 * permukaan beranda). Aturan kerasnya: item dengan `count` 0 TIDAK
 * dirender, dan bila semua item nol SELURUH seksi tidak dirender —
 * tidak ada lagi kartu basi "Tidak ada kredit tersedia" dan KPI nol
 * yang memajaki beranda. Pemanggil cukup meneruskan hitungan nyata
 * tiap antrean; penyaringan adalah urusan komponen ini.
 */
export function WorkQueue({
  title = "Antrean kerja",
  items,
  className,
}: {
  title?: string;
  items: WorkQueueItem[];
  className?: string;
}) {
  const visible = items.filter((item) => item.count > 0);
  if (visible.length === 0) return null;
  return (
    <section className={className}>
      <h2 className="mb-2 text-[13px] font-semibold">{title}</h2>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-primary/40"
          >
            <span className="flex items-center gap-2">
              {item.icon ? (
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md",
                    TONE_CHIP[item.tone ?? "neutral"],
                  )}
                >
                  {item.icon}
                </span>
              ) : null}
              <span className="text-[12px] font-medium text-muted-foreground">{item.label}</span>
              <span
                className={cn(
                  "num ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  TONE_CHIP[item.tone ?? "neutral"],
                )}
              >
                {item.count}
              </span>
            </span>
            <span className="text-[15px] font-semibold leading-tight">
              {item.headline ?? `${item.count} menunggu`}
            </span>
            {item.detail ? <span className="text-[12px] text-muted-foreground">{item.detail}</span> : null}
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[12px] font-medium text-primary">
              {item.actionLabel}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
