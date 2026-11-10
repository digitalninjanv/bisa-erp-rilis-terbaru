import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading skeleton for module pages (T4-6b): mirrors the visual
 * rhythm of a real page — a PageHeader block, optional stat-card row and a
 * table card with pulsing lines. It carries no text or numbers, so it can
 * never be mistaken for loaded data.
 */
export function PageSkeleton({ stats = 4, rows = 8 }: { stats?: number; rows?: number }) {
  return (
    <div role="status" aria-label="Memuat halaman">
      <span className="sr-only">Memuat…</span>
      <div className="mb-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-7 w-56 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      {stats > 0 ? (
        <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: stats }, (_, index) => (
            <div key={index} className="rounded-lg border border-border bg-card px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-28" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border bg-card" aria-hidden="true">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-3 px-4 py-3">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-4 w-24 shrink-0" />
              <Skeleton className={`h-4 flex-1 ${index % 3 === 1 ? "max-w-[70%]" : ""}`} />
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
