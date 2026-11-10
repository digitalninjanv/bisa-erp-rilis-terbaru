import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  size = "full",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  /**
   * A-25 U2 — EmptyState v2 (ARAH-DESAIN-A25 §3.11, menutup
   * AUDIT-UI-A25 POLA-08): `full` adalah tampilan lama persis untuk
   * keadaan kosong satu halaman/daftar (pemanggil lama tidak
   * berubah). `compact` untuk panel, grafik, dan seksi di dalam
   * halaman berisi: bingkai dashed setinggi tetap ±120px, teks
   * 12px, tanpa ikon raksasa — kosong terbaca sebagai keadaan
   * normal, bukan kegagalan render.
   */
  size?: "full" | "compact";
}) {
  if (size === "compact") {
    return (
      <div
        className={cn(
          "flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-4 text-center",
          className,
        )}
      >
        {icon ? <div className="mb-1.5 text-muted-foreground">{icon}</div> : null}
        <p className="text-[12px] font-medium text-muted-foreground">{title}</p>
        {description ? (
          <p className="mt-0.5 max-w-sm text-[12px] leading-5 text-muted-foreground">{description}</p>
        ) : null}
        {action ? <div className="mt-2.5">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[12px] leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Money({
  value,
  className,
  symbol = true,
}: {
  value: string | number | null | undefined;
  className?: string;
  symbol?: boolean;
}) {
  const formatted = new Intl.NumberFormat("id-ID", {
    style: symbol ? "currency" : "decimal",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
  return <span className={cn("num whitespace-nowrap", className)}>{formatted}</span>;
}
