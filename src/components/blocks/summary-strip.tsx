import Link from "next/link";
import { cn } from "@/lib/utils";

export type SummaryTone = "default" | "green" | "red" | "amber" | "muted";

export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: SummaryTone;
  href?: string;
};

const VALUE_TONE: Record<SummaryTone, string> = {
  default: "",
  green: "text-tone-green",
  red: "text-destructive",
  amber: "text-tone-amber",
  muted: "text-muted-foreground",
};

/**
 * Satu strip ringkasan terbagi garis — pengganti deretan kartu KPI
 * yang memakan tinggi layar. Dipakai lintas modul (HR, payroll,
 * kasbon, pinjaman) agar angka kunci selalu punya bentuk yang sama.
 */
export function SummaryStrip({
  items,
  className,
  columns = 4,
}: {
  items: SummaryItem[];
  className?: string;
  columns?: 4 | 5;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border",
        columns === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
        className,
      )}
    >
      {items.map((item, index) => {
        const body = (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p
              className={cn(
                "num mt-1 whitespace-nowrap text-[clamp(14px,2vw,18px)] font-semibold leading-none",
                VALUE_TONE[item.tone ?? "default"],
              )}
            >
              {item.value}
            </p>
            {item.hint ? (
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{item.hint}</p>
            ) : null}
          </>
        );
        const spanClass =
          columns === 5 && index === items.length - 1 ? "max-lg:col-span-2" : null;
        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "bg-card px-4 py-3 transition-colors hover:bg-muted/40",
              spanClass,
            )}
          >
            {body}
          </Link>
        ) : (
          <div key={item.label} className={cn("bg-card px-4 py-3", spanClass)}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
