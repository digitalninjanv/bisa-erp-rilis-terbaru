import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { getAccountMap, listCashBankAccounts } from "@/server/accounting";
import { getSettings } from "@/server/catalog";
import { listEmployees } from "@/server/hr";
import { listExpenseAccounts } from "@/server/reports";
import {
  REIMBURSEMENT_STATUS_LABELS,
  listReimbursementClaims,
} from "@/server/reimbursements";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DataList } from "@/components/blocks/data-list";
import {
  ClaimDecisionButtons,
  ClaimForm,
  ClaimPayButton,
} from "@/components/akuntansi/reimbursement-panel";

export const metadata = { title: "Klaim reimbursement" };
export const dynamic = "force-dynamic";

export default async function KlaimPage() {
  const ctx = await requirePermissionPage("payroll.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const claims = await listReimbursementClaims(tx, ctx.company.id);
    const staff = await listEmployees(tx, ctx.company.id);
    const expenseAccounts = await listExpenseAccounts(tx, ctx.company.id);
    const cashAccounts = await listCashBankAccounts(tx, ctx.company.id);
    // A-21 (R3-10): tarif efektif & pemetaan PPN Masukan untuk opsi
    // "Termasuk PPN" pada form klaim — pola halaman Beban.
    const settings = await getSettings(tx, ctx.company.id);
    const mappings = await getAccountMap(tx, ctx.company.id);
    return { claims, staff, expenseAccounts, cashAccounts, settings, mappings };
  });

  const canManage = can(ctx, "payroll.manage");
  const pending = data.claims.filter((row) => row.status === "submitted");
  const approved = data.claims.filter((row) => row.status === "approved");
  const approvedTotal = approved.reduce((acc, row) => acc + Number(row.approvedAmount ?? row.amount), 0);

  return (
    <div>
      <PageHeader
        eyebrow="HR"
        title="Klaim reimbursement"
        description="Klaim pengembalian biaya perusahaan yang dibayar karyawan lebih dulu. Klaim disahkan atasan (bukan pengaju), lalu dibayar sebagai beban perusahaan — tidak pernah menjadi piutang karyawan."
        actions={
          canManage ? (
            <ClaimForm
              employees={data.staff.filter((person) => person.isActive)}
              expenseAccounts={data.expenseAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
              taxRate={data.settings?.taxEnabled ? (data.settings?.taxRate ?? "0") : "0"}
              taxInputMapped={Boolean(data.mappings.tax_input)}
            />
          ) : null
        }
      />

      <SummaryStrip
        items={[
          {
            label: "Menunggu persetujuan",
            value: pending.length,
            hint: "Klaim belum diputuskan",
            tone: pending.length > 0 ? "amber" : "green",
          },
          {
            label: "Disahkan belum dibayar",
            value: formatIDR(approvedTotal),
            hint: `${approved.length} klaim siap bayar`,
            tone: approved.length > 0 ? "amber" : "green",
          },
          {
            label: "Total klaim",
            value: data.claims.length,
            hint: "Semua status",
          },
          {
            label: "Sudah terbayar",
            value: data.claims.filter((row) => row.status === "paid").length,
            hint: "Klaim selesai sebagai beban",
            tone: "green",
          },
        ]}
      />

      <h2 className="mb-2 mt-4 text-[13px] font-semibold">Semua klaim</h2>
      <DataList
        isEmpty={data.claims.length === 0}
        empty={
          <EmptyState title="Belum ada klaim" description={can(ctx, "payroll.manage") ? "Ajukan klaim pertama lewat tombol Klaim Baru." : "Peran Anda dapat melihat; klaim dibuat oleh peran dengan izin mengelola payroll."} icon={<ClipboardCheck className="size-5" />} />
        }
        footerNote="Pengesah wajib pengguna lain selain pengaju. Nominal disahkan boleh lebih kecil dari klaim; selisihnya tercatat pada klaim. Klaim yang menunggu juga terkumpul di halaman Persetujuan."
      >
        <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Karyawan</th>
                  <th>Kategori beban</th>
                  <th>Keterangan</th>
                  <th className="text-right">Klaim</th>
                  <th className="text-right">Disahkan</th>
                  <th>Status</th>
                  {canManage ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.claims.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[11px] text-muted-foreground">
                      {row.journalId ? (
                        <Link href={`/app/akuntansi/jurnal/${row.journalId}`} className="transition-colors hover:underline">
                          {row.number}
                        </Link>
                      ) : (
                        row.number
                      )}
                    </td>
                    <td className="text-[12px]">{formatDate(row.date)}</td>
                    <td className="text-[12px] font-medium">
                      {row.employeeName}
                      <span className="num ml-1.5 text-[11px] text-muted-foreground">{row.employeeCode}</span>
                    </td>
                    <td className="text-[11px] text-muted-foreground">{row.expenseAccountLabel}</td>
                    <td className="max-w-[240px] text-[11px] text-muted-foreground">
                      <span className="block truncate">{row.description}</span>
                      {row.attachmentName ? <span className="block truncate text-[11px]">Bukti: {row.attachmentName}</span> : null}
                      {row.decisionNote ? <span className="block truncate text-[11px]">Keputusan: {row.decisionNote}</span> : null}
                    </td>
                    <td className="num text-right text-[12px]">
                      {formatIDR(row.amount)}
                      {Number(row.taxRate) > 0 ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          termasuk PPN {Number(row.taxRate)}%
                        </span>
                      ) : null}
                    </td>
                    <td className="num text-right text-[12px] font-medium">
                      {row.approvedAmount ? formatIDR(row.approvedAmount) : "—"}
                    </td>
                    <td>
                      <StatusBadge status={row.status} label={REIMBURSEMENT_STATUS_LABELS[row.status]} />
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        {row.status === "submitted" ? (
                          <ClaimDecisionButtons id={row.id} number={row.number} claimed={row.amount} />
                        ) : row.status === "approved" ? (
                          <ClaimPayButton
                            id={row.id}
                            number={row.number}
                            accounts={data.cashAccounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
                          />
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </DataList>
    </div>
  );
}
