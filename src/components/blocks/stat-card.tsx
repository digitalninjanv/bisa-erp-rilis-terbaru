import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* FIX-R2 Tahap 2 (RD2U-06): nada bersumber dari token --tone-* di
   globals.css, bukan hex mentah yang disalin antar-berkas. */
const tones = {
  neutral: "bg-muted text-muted-foreground",
  plum: "bg-tone-plum-soft text-tone-plum",
  teal: "bg-tone-teal-soft text-tone-teal",
  amber: "bg-tone-amber-soft text-tone-amber",
  red: "bg-tone-red-soft text-tone-red",
  green: "bg-tone-green-soft text-tone-green",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  valueClassName,
  size = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: keyof typeof tones;
  valueClassName?: string;
  /* FIX-R2 Tahap 2 (RD2U-01): "compact" adalah SATU-SATUNYA varian
     ringkas resmi — untuk baris ringkasan di halaman daftar (jurnal,
     buku besar, kelompok umur piutang/utang). Varian lokal per halaman
     (SummaryCard/MiniMetric/AgingCard) dihapus; halaman daftar memakai
     komponen ini, bukan mengarang kartu sendiri. */
  size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <div
      data-size={compact ? "compact" : "default"}
      className={cn("stat-card min-w-0 rounded-lg border border-border bg-card", compact ? "px-3 py-2.5" : "px-4 py-3")}
    >
      <div className="flex items-start justify-between gap-2">
        {/* UX4-05 (G2): label kini sentence case 12px sesuai arah
            desain §2.2 — tanpa kapital & tracking lebar. */}
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span className={cn("grid size-7 place-items-center rounded-md", tones[tone])}>
            <Icon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "stat-value num whitespace-nowrap font-semibold leading-none tracking-tight",
          compact ? "mt-1 text-[16px]" : "mt-2 text-[clamp(15px,2.4vw,24px)]",
          valueClassName,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
