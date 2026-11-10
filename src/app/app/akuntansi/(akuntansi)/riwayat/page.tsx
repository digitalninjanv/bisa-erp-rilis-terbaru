import Link from "next/link";
import { History } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listCompanyAuditTrail } from "@/server/audit";
import { requirePermissionPage } from "@/lib/session";
import { formatDate, formatDateTime, monthStartISO, todayISO } from "@/lib/format";
import { LIST_PAGE_SIZE } from "@/lib/pagination";
import { summarizeAuditChange } from "@/components/blocks/audit-history";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  insert: "Dibuat",
  create: "Dibuat",
  update: "Diubah",
  delete: "Dihapus",
  void: "Dibatalkan",
  post: "Diposting",
  close: "Ditutup",
  lock: "Dikunci",
  unlock: "Dibuka",
  login: "Masuk",
  logout: "Keluar",
  superseded: "Digantikan",
  settled: "Diselesaikan",
};

const ACTION_DOMAIN: Record<string, string> = {
  settings: "Pengaturan",
  "settings print": "Pengaturan cetak",
  "settings custom fields": "Kolom kustom",
  "settings modules": "Modul",
  "settings settings": "Pengaturan",
  "payment method": "Metode pembayaran",
  import: "Impor",
  unit: "Satuan",
  account: "Akun",
  period: "Periode fiskal",
  journal: "Jurnal",
  payroll: "Payroll",
  supplier: "Pemasok",
  product: "Produk",
};

const ACTION_VERB: Record<string, string> = {
  create: "dibuat",
  update: "diubah",
  delete: "dihapus",
  activate: "diaktifkan",
  deactivate: "dinonaktifkan",
  open: "dibuka",
  close: "ditutup",
  reverse: "dibalik",
  pay: "dibayar",
  complete: "selesai",
  upload: "diunggah",
  settled: "diselesaikan",
};

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

const ENTITY_LABELS: Record<string, string> = {
  account: "Akun",
  journal_entry: "Jurnal",
  sale: "Penjualan",
  stock_document: "Dokumen stok",
  stock_receipt: "Penerimaan",
  product: "Produk",
  customer: "Pelanggan",
  supplier: "Pemasok",
  employee: "Karyawan",
  payroll_run: "Payroll",
  reimbursement_claim: "Klaim",
  company_settings: "Pengaturan",
  fiscal_period: "Periode fiskal",
  company_role: "Peran",
  party_payment: "Pembayaran pihak",
  party_credit: "Kredit pihak",
  expense: "Beban",
  purchase_order: "Pesanan pembelian",
  purchase_request: "Permintaan pembelian",
  supplier_return: "Retur pembelian",
  cash_session: "Sesi kas",
  payment_method: "Metode pembayaran",
  import_job: "Impor",
  unit: "Satuan",
  category: "Kategori",
  work_shift: "Shift kerja",
  stock_reservation: "Reservasi stok",
  party_opening_balance: "Saldo awal pihak",
  employee_advance: "Kasbon",
  employee_loan: "Pinjaman",
  fixed_asset: "Aset tetap",
};

function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const parts = action.replace(/_/g, " ").split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    return titleCase(parts[0].replace(/_/g, " "));
  }
  const verb = parts[parts.length - 1];
  const objectParts = parts.slice(0, -1);
  const domain = ACTION_DOMAIN[objectParts.join(" ").toLowerCase()];
  if (domain && ACTION_VERB[verb.toLowerCase()]) {
    return `${domain} ${ACTION_VERB[verb.toLowerCase()]}`;
  }
  return titleCase(action.replace(/[._]/g, " "));
}

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, " ");
}

function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === "journal_entry") return `/app/akuntansi/jurnal/${entityId}`;
  if (entityType === "account") return `/app/akuntansi/akun/${entityId}`;
  if (entityType === "sale") return `/app/pos/nota/${entityId}`;
  if (entityType === "product") return `/app/gudang/produk/${entityId}`;
  if (entityType === "customer") return `/app/gudang/pelanggan/${entityId}`;
  if (entityType === "supplier") return `/app/gudang/pemasok/${entityId}`;
  if (entityType === "employee") return `/app/akuntansi/karyawan/${entityId}`;
  if (entityType === "payroll_run") return `/app/akuntansi/payroll/${entityId}`;
  return null;
}

export default async function AccountingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    action?: string;
    entity?: string;
    user?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listCompanyAuditTrail(tx, ctx.company.id, {
      from,
      to,
      action: params.action,
      entityType: params.entity,
      userId: params.user,
      page,
      pageSize: LIST_PAGE_SIZE,
    }),
  );

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Jejak aktivitas akuntansi: siapa mengubah apa, kapan, dan nilai sebelum-sesudahnya. Sumbernya audit log yang sama dengan riwayat perubahan tiap master."
      />

      <DataList
        density="compact"
        toolbar={
          <form action="/app/akuntansi/riwayat" className="flex flex-wrap items-center gap-1.5">
            <DateRangeField
              from={{ name: "from", defaultValue: from }}
              to={{ name: "to", defaultValue: to }}
            />
            <select
              name="action"
              defaultValue={params.action ?? ""}
              aria-label="Aksi"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua aksi</option>
              {data.actions.map((action) => (
                <option key={action} value={action}>
                  {actionLabel(action)}
                </option>
              ))}
            </select>
            <select
              name="entity"
              defaultValue={params.entity ?? ""}
              aria-label="Entitas"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua entitas</option>
              {data.entityTypes.map((entity) => (
                <option key={entity} value={entity}>
                  {entityLabel(entity)}
                </option>
              ))}
            </select>
            <select
              name="user"
              defaultValue={params.user ?? ""}
              aria-label="Aktor"
              className="h-9 rounded-md border border-input bg-background px-2 text-[11px]"
            >
              <option value="">Semua aktor</option>
              {data.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Tampilkan
            </button>
            <Link
              href="/app/akuntansi/riwayat"
              className="inline-flex h-9 items-center px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Atur ulang
            </Link>
          </form>
        }
        isEmpty={data.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada aktivitas"
            description="Perubahan master, jurnal, dan dokumen pada periode ini akan tercatat di sini."
            icon={<History className="size-5" />}
          />
        }
        pagination={
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/app/akuntansi/riwayat"
            params={{
              from,
              to,
              action: params.action,
              entity: params.entity,
              user: params.user,
            }}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table min-w-[780px]">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Aktor</th>
                <th>Aksi</th>
                <th>Entitas</th>
                <th>Perubahan</th>
                <th className="hidden lg:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const href = entityHref(row.entityType, row.entityId);
                return (
                  <tr key={row.id}>
                    <td className="num whitespace-nowrap text-[11px]">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="text-[12px]">{row.userName ?? "Sistem"}</td>
                    <td className="text-[11px] font-medium">{actionLabel(row.action)}</td>
                    <td className="text-[11px]">
                      {href ? (
                        <Link href={href} className="font-medium text-primary hover:underline">
                          {entityLabel(row.entityType)}
                        </Link>
                      ) : (
                        entityLabel(row.entityType)
                      )}
                      {row.entityId ? (
                        <span className="num ml-1 text-[10px] text-muted-foreground">
                          {row.entityId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[430px] truncate text-[11px] text-muted-foreground">
                      {summarizeAuditChange(row.before, row.after)}
                    </td>
                    <td className="num hidden text-[10px] text-muted-foreground lg:table-cell">
                      {row.ip ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataList>

      <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
        Audit trail memuat aktivitas sejak {formatDate(from)} sampai {formatDate(to)}. Riwayat
        jurnal tetap tersedia di menu Jurnal umum.
      </p>
    </div>
  );
}
