import type { ReactNode } from "react";
import { EmptyState } from "@/components/blocks/empty-state";
import { formatDateTime } from "@/lib/format";

/**
 * SIM-2 S7 (REM-03): seksi "Riwayat perubahan" bersama untuk halaman
 * detail master — pertama kali dibangun untuk detail pihak (S3), kini
 * digeneralisasi agar detail produk & akun menampilkan audit_log dengan
 * bentuk yang sama persis.
 */
export type AuditTrailRow = {
  id: string;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

export function AuditHistorySection({
  rows,
  emptyTitle = "Belum ada riwayat perubahan",
  emptyDescription = "Perubahan master ini akan tercatat di sini.",
  headerClassName = "border-b border-border px-3 py-2.5",
  footer,
}: {
  rows: AuditTrailRow[];
  emptyTitle?: string;
  emptyDescription?: string;
  headerClassName?: string;
  footer?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <h2 className={`${headerClassName} text-[13px] font-semibold`}>Riwayat perubahan</h2>
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto contain-paint">
          <table className="data-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Aksi</th>
                <th>Perubahan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="num whitespace-nowrap text-[11px]">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="text-[11px] font-medium">{row.action}</td>
                  <td className="max-w-[480px] truncate text-[11px] text-muted-foreground">
                    {summarizeAuditChange(row.before, row.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer}
    </section>
  );
}

/** Ringkasan perubahan audit: field yang berubah, nilai lama → baru. */
export function summarizeAuditChange(before: unknown, after: unknown): string {
  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const parts: string[] = [];
  for (const key of keys) {
    if (key === "attributes") continue;
    const from = beforeObj[key];
    const to = afterObj[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    parts.push(`${key}: ${formatAuditValue(from)} → ${formatAuditValue(to)}`);
    if (parts.length >= 4) break;
  }
  return parts.length > 0 ? parts.join("; ") : "—";
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Aktif" : "Nonaktif";
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json.length > 60 ? `${json.slice(0, 60)}…` : json;
    } catch {
      return "[objek]";
    }
  }
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
