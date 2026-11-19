export function PosPageSkeleton({
  rows = 6,
  cards = false,
}: {
  rows?: number;
  cards?: boolean;
}) {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="h-7 w-56 animate-pulse rounded bg-muted" />
        <div className="h-3 w-80 max-w-full animate-pulse rounded bg-muted/70" />
      </div>
      <div className="h-10 animate-pulse rounded-lg border border-border bg-card" />
      {cards ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="h-10 animate-pulse border-b border-border bg-muted/60" />
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="flex h-12 items-center gap-3 border-b border-border px-3 last:border-b-0"
            >
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3 flex-1 animate-pulse rounded bg-muted/70" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
