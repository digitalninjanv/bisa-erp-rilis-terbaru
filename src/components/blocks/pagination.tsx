import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params = {},
  pageParam = "page",
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  // SIM-2 S7 (REM-03): halaman dengan dua daftar berpaginasi (mis. detail
  // produk: kartu stok + riwayat perubahan) memakai kunci query berbeda
  // per daftar agar keduanya tidak saling menimpa.
  pageParam?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) {
    return (
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>{total} data</span>
      </div>
    );
  }

  const href = (target: number) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    search.set(pageParam, String(target));
    return `${basePath}?${search.toString()}`;
  };

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
      <span className="num">
        {start}–{end} dari {total}
      </span>
      <div className="flex items-center gap-1">
        <Link
          href={href(Math.max(1, page - 1))}
          aria-label="Halaman sebelumnya"
          aria-disabled={page === 1}
          tabIndex={page === 1 ? -1 : undefined}
          className={cn(
            // A-22 K6: target sentuh minimum h-8 (sebelumnya size-6 =
            // 24px, satu-satunya kontrol bersama di bawah lantai 28px).
            "grid size-8 place-items-center rounded border border-border bg-card transition-colors hover:bg-muted",
            page === 1 && "pointer-events-none opacity-40",
          )}
        >
          <ChevronLeft className="size-3.5" />
        </Link>
        <span className="num px-2">
          {page} / {pages}
        </span>
        <Link
          href={href(Math.min(pages, page + 1))}
          aria-label="Halaman berikutnya"
          aria-disabled={page === pages}
          tabIndex={page === pages ? -1 : undefined}
          className={cn(
            "grid size-8 place-items-center rounded border border-border bg-card transition-colors hover:bg-muted",
            page === pages && "pointer-events-none opacity-40",
          )}
        >
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
