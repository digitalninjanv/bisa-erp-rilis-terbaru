import { Inbox } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { ApprovalInbox, APPROVAL_KIND_LABELS, type ApprovalItem } from "@/components/blocks/approval-inbox";
import { EmptyState } from "@/components/blocks/empty-state";
import { listLeaveRequests, listOvertimeRequests } from "@/server/hr";
import { listReimbursementClaims } from "@/server/reimbursements";

export const metadata = { title: "Persetujuan HR" };
export const dynamic = "force-dynamic";

const DAY_TYPE_LABELS: Record<string, string> = {
  workday: "Hari kerja",
  rest_5day: "Libur (5 hari)",
  rest_6day: "Libur (6 hari)",
  shortest_day_6day: "Libur hari terpendek",
};

/** Umur pengajuan dari tanggal pembuatan klaim (satu-satunya antrean
 * yang fungsi bacanya memaparkan createdAt). */
function claimAge(createdAt: Date | string): string {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  if (days === 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${days} hari lalu`;
}

/**
 * A-25 U5 — Persetujuan: SATU antrean keputusan HR (ARAH-DESAIN-A25
 * §3.12 & §4.3: setujui klaim/kasbon/cuti dari 3 menu terpisah →
 * 2 langkah dari satu kotak masuk). Menggabungkan yang benar-benar
 * menunggu keputusan menurut domain yang ada: cuti `pending`,
 * lembur `pending`, klaim reimbursement `submitted`. Kasbon &
 * pinjaman TIDAK punya status menunggu — dokumennya langsung
 * terposting saat dibuat — jadi tidak dipaksakan masuk antrean;
 * keputusan atasnya memang tidak ada di domain.
 *
 * Keputusan dijalankan ApprovalInbox lewat aksi server yang sudah
 * ada per jenis (kontrak U2); halaman ini hanya memetakan antrean
 * menjadi ApprovalItem[].
 */
export default async function ApprovalPage() {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [leaves, overtimes, claims] = await Promise.all([
      listLeaveRequests(tx, ctx.company.id),
      // Rentang lebar: pengajuan yang menunggu bisa bertanggal
      // kapan pun, bukan hanya periode berjalan.
      listOvertimeRequests(tx, ctx.company.id, { start: "2000-01-01", end: "2100-12-31" }),
      listReimbursementClaims(tx, ctx.company.id),
    ]);
    return { leaves, overtimes, claims };
  });

  const items: ApprovalItem[] = [
    ...data.claims
      .filter((row) => row.status === "submitted")
      .map((row) => ({
        id: row.id,
        kind: "claim" as const,
        requester: row.employeeName,
        summary: `${row.number} · ${formatDate(row.date)} · ${row.description}`,
        amount: formatIDR(row.amount),
        ageLabel: claimAge(row.createdAt),
        href: "/app/akuntansi/klaim",
      })),
    ...data.leaves
      .filter((row) => row.status === "pending")
      .map((row) => ({
        id: row.id,
        kind: "leave" as const,
        requester: row.employeeName,
        summary: `${row.typeName} · ${formatDate(row.startDate)} s.d. ${formatDate(row.endDate)} · ${row.days} hari${row.reason ? ` · ${row.reason}` : ""}`,
        href: "/app/akuntansi/hr/cuti",
      })),
    ...data.overtimes
      .filter((row) => row.status === "pending")
      .map((row) => ({
        id: row.id,
        kind: "overtime" as const,
        requester: row.employeeName,
        summary: `${formatDate(row.date)} · ${row.hours} jam · ${DAY_TYPE_LABELS[row.dayType] ?? row.dayType}${row.reason ? ` · ${row.reason}` : ""}`,
        href: "/app/akuntansi/hr/lembur",
      })),
  ];

  return (
    <div>
      <PageHeader
        title="Persetujuan"
        description="Satu antrean untuk cuti, lembur, dan klaim reimbursement yang menunggu keputusan. Kasbon & pinjaman tidak melalui persetujuan — dokumennya langsung terposting saat dibuat, lalu dipotong dari gaji."
      />

      {manageable ? (
        <ApprovalInbox
          items={items}
          title="Menunggu keputusan"
          emptyTitle="Tidak ada yang menunggu"
          emptyDescription="Pengajuan cuti, lembur, dan klaim baru yang menunggu keputusan akan tampil di sini."
        />
      ) : items.length === 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="p-3">
            <EmptyState
              size="compact"
              title="Tidak ada yang menunggu"
              description="Pengajuan cuti, lembur, dan klaim baru yang menunggu keputusan akan tampil di sini."
              icon={<Inbox className="size-5" />}
            />
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Menunggu keputusan</h2>
            <span className="num rounded-full bg-tone-amber-soft px-2 py-0.5 text-[11px] font-semibold text-tone-amber">
              {items.length} menunggu
            </span>
          </div>
          <ul className="divide-y divide-border/70">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {APPROVAL_KIND_LABELS[item.kind]}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-[13px] font-medium">{item.requester}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{item.summary}</p>
                </div>
                {item.amount ? <span className="num text-[13px] font-semibold">{item.amount}</span> : null}
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
            Peran Anda hanya dapat melihat antrean ini. Keputusan diambil oleh peran dengan izin mengelola payroll.
          </p>
        </section>
      )}
    </div>
  );
}
