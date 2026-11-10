import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { accounts } from "@/db/schema";
import { getLedger, listAccountBalances } from "@/server/reports";
import { getAccountImpact } from "@/server/account-impact";
import { listEntityAuditTrail } from "@/server/audit";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatIDRReport } from "@/lib/money";
import { formatDate, monthStartISO, todayISO } from "@/lib/format";
import { ACCOUNT_SECTIONS, maskBankAccountNumber, resolveSection } from "@/lib/accounting";
import {
  EXPENSE_FUNCTIONS,
  EXPENSE_NATURES,
  PSAK118_CATEGORIES,
  type ExpenseFunction,
  type ExpenseNature,
  type Psak118Category,
} from "@/lib/akuntansi/psak118";
import { Pagination } from "@/components/blocks/pagination";
import { AuditHistorySection } from "@/components/blocks/audit-history";
import { DocumentPage, DocumentMetaRows } from "@/components/blocks/document-page";
import { EmptyState } from "@/components/blocks/empty-state";
import { AccountForm } from "@/components/akuntansi/account-form";

export const metadata = { title: "Detail akun" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Liabilitas",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "Harga pokok penjualan",
  expense: "Beban",
};

/**
 * SIM-2 S7 (REM-03): detail akun — fakta master + saldo berjalan +
 * riwayat perubahan dari audit_log (penampil per record yang belum ada
 * untuk akun; SEC-09). Gerbang mengikuti halaman bagan akun.
 *
 * A-25 U4 (AKT-12): halaman memakai DocumentPage bersama — rel kanan
 * berisi fakta akun, badan memuat MUTASI TERAKHIR akun ini (hal
 * pertama yang dicari dari sebuah akun; sebelumnya halaman ini hanya
 * kartu info + riwayat perubahan yang sering kosong), dan tombol
 * Ubah kini tinggal di sini juga (sebelumnya hanya di daftar).
 * Mutasi dibaca lewat getLedger yang sama seperti halaman Buku Besar
 * (ARS1-01: fungsi baca bernama modul reports).
 */
export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const canManage = can(ctx, "accounting.manage");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.id, id)))
      .limit(1);
    if (!account) return null;
    const balances = await listAccountBalances(tx, ctx.company.id);
    const balance = balances.find((row) => row.id === id)?.balance ?? 0;
    const parent = account.parentId
      ? balances.find((row) => row.id === account.parentId)
      : undefined;
    const audit = await listEntityAuditTrail(tx, ctx.company.id, "account", id, {
      page: Number(query.page ?? 1),
      pageSize: 20,
    });
    const ledger = await getLedger(tx, {
      companyId: ctx.company.id,
      accountId: id,
      from: monthStartISO(),
      to: todayISO(),
      page: 1,
      pageSize: 10,
    });
    // A-27 B4: pratinjau dampak — fungsi baca yang sama yang dipakai
    // penjaga tulis saveAccountAction (satu definisi "dipakai oleh").
    const impact = await getAccountImpact(tx, ctx.company.id, id);
    return { account, balance, parent, audit, ledger, balances, impact };
  });

  if (!data) notFound();
  const { account, balance, parent, audit, ledger, balances, impact } = data;
  const section = resolveSection(account);
  const impactSummary = impact
    ? {
        balance: impact.balance,
        journalLineCount: impact.journalLineCount,
        mappingLabels: impact.mappingKeys.map((row) => row.label),
        paymentMethods: impact.paymentMethods.map((row) => ({
          label: `${row.code} — ${row.name}`,
          isActive: row.isActive,
        })),
        discountGroupNames: impact.discountGroups.map((row) => row.name),
        childrenCount: impact.children.length,
        isSystem: impact.isSystem,
      }
    : null;

  return (
    <DocumentPage
      backHref="/app/akuntansi/akun"
      backLabel="Bagan akun"
      eyebrow="Akun"
      number={account.code}
      title={account.name}
      status={account.isActive ? "active" : "inactive"}
      actions={
        <>
          {canManage ? (
            <AccountForm
              account={{
                id: account.id,
                code: account.code,
                name: account.name,
                type: account.type,
                normalBalance: account.normalBalance,
                parentId: account.parentId,
                section: account.section,
                cashFlowGroup: account.cashFlowGroup,
                cashBankKind: account.cashBankKind,
                bankName: account.bankName,
                bankAccountNumber: account.bankAccountNumber,
                bankBranch: account.bankBranch,
                bankAccountHolder: account.bankAccountHolder,
                currency: account.currency,
                psak118Category: account.psak118Category,
                expenseNature: account.expenseNature,
                expenseFunction: account.expenseFunction,
                isContra: account.isContra,
                contraOf: account.contraOf,
                description: account.description,
                isPostable: account.isPostable,
                isActive: account.isActive,
              }}
              parents={balances.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
              impact={impactSummary}
            />
          ) : null}
          <Link
            href={`/app/akuntansi/buku-besar?account=${account.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            Lihat di buku besar
          </Link>
        </>
      }
      meta={
        <DocumentMetaRows
          rows={[
            { label: "Tipe", value: TYPE_LABELS[account.type] ?? account.type },
            { label: "Saldo normal", value: account.normalBalance === "debit" ? "Debit" : "Kredit" },
            { label: "Kelompok laporan", value: section ? ACCOUNT_SECTIONS[section] : "—" },
            { label: "Induk", value: parent ? `${parent.code} — ${parent.name}` : "—" },
            { label: "Dapat dijurnal", value: account.isPostable ? "Ya" : "Tidak (akun induk)" },
            // A-27 B4 (F-07): akun sistem adalah turunan ikatan, bukan bendera tersimpan.
            {
              label: "Akun sistem",
              value: impact?.isSystem
                ? "Ya — dirujuk pemetaan akun dan/atau metode pembayaran"
                : "Tidak",
            },
            // A-27 B5: tagging PSAK 118 + penanda kontra (data kesiapan;
            // laporan saat ini belum membaca tag ini).
            ...(account.psak118Category
              ? [
                  {
                    label: "Kategori PSAK 118",
                    value:
                      PSAK118_CATEGORIES[account.psak118Category as Psak118Category] ??
                      account.psak118Category,
                  },
                ]
              : []),
            ...(account.expenseNature
              ? [
                  {
                    label: "Sifat beban",
                    value: EXPENSE_NATURES[account.expenseNature as ExpenseNature] ?? account.expenseNature,
                  },
                ]
              : []),
            ...(account.expenseFunction
              ? [
                  {
                    label: "Fungsi beban",
                    value:
                      EXPENSE_FUNCTIONS[account.expenseFunction as ExpenseFunction] ??
                      account.expenseFunction,
                  },
                ]
              : []),
            {
              label: "Akun kontra",
              value: account.isContra
                ? `Ya${
                    account.contraOf
                      ? ` — mengontra ${(() => {
                          const target = balances.find((row) => row.id === account.contraOf);
                          return target ? `${target.code} ${target.name}` : "akun lain";
                        })()}`
                      : " — akun yang dikontra belum ditentukan"
                  }`
                : "Tidak",
            },
            // A-27 B3: kelas kas/bank + rincian bank (nomor termasker).
            {
              label: "Kelas kas/bank",
              value:
                account.cashBankKind === "cash"
                  ? "Kas"
                  : account.cashBankKind === "bank"
                    ? "Bank"
                    : account.cashBankKind === "clearing"
                      ? "Kliring / Settlement"
                      : "—",
            },
            ...(account.cashBankKind === "bank"
              ? [
                  { label: "Bank", value: account.bankName ?? "—" },
                  { label: "Nomor rekening", value: maskBankAccountNumber(account.bankAccountNumber) || "—" },
                  { label: "Cabang", value: account.bankBranch ?? "—" },
                  { label: "Atas nama", value: account.bankAccountHolder ?? "—" },
                  { label: "Mata uang", value: account.currency },
                ]
              : []),
            {
              label: "Saldo berjalan",
              value: (
                <span className={balance < 0 ? "text-destructive" : undefined}>{formatIDR(balance)}</span>
              ),
            },
          ]}
        />
      }
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Mutasi bulan ini</h2>
          <span className="num text-[11px] text-muted-foreground">
            Saldo akhir periode {formatIDRReport(ledger.closing)}
          </span>
        </div>
        {ledger.items.length === 0 ? (
          <EmptyState
            title="Belum ada mutasi bulan ini"
            description="Jurnal yang menyentuh akun ini pada bulan berjalan akan tampil di sini. Mutasi lengkap ada di Buku Besar."
            className="py-8"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Nomor</th>
                  <th>Keterangan</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Kredit</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((row) => (
                  <tr key={row.id}>
                    <td className="num whitespace-nowrap text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                    <td className="num text-[12px]">
                      <Link href={`/app/akuntansi/jurnal/${row.entryId}`} className="transition-colors hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="max-w-[280px] truncate text-[12px]">{row.description}</td>
                    <td className="num text-right text-[12px]">{Number(row.debit) > 0 ? formatIDR(row.debit) : ""}</td>
                    <td className="num text-right text-[12px]">{Number(row.credit) > 0 ? formatIDR(row.credit) : ""}</td>
                    <td className="num text-right text-[12px] font-medium">{formatIDRReport(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* A-27 B4: pratinjau dampak — ikatan yang sama yang dijaga
          saveAccountAction saat akun diubah/dinonaktifkan/dihapus. */}
      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Dipakai oleh</h2>
        </div>
        <div className="px-4 py-3">
          {impact &&
          (impact.mappingKeys.length > 0 ||
            impact.paymentMethods.length > 0 ||
            impact.discountGroups.length > 0 ||
            impact.children.length > 0 ||
            impact.journalLineCount > 0) ? (
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted-foreground">
              {impact.mappingKeys.length > 0 ? (
                <li>
                  Pemetaan akun: {impact.mappingKeys.map((row) => row.label).join(", ")}
                </li>
              ) : null}
              {impact.paymentMethods.length > 0 ? (
                <li>
                  Metode pembayaran:{" "}
                  {impact.paymentMethods
                    .map((row) => `${row.code} — ${row.name}${row.isActive ? "" : " (nonaktif)"}`)
                    .join(", ")}
                </li>
              ) : null}
              {impact.discountGroups.length > 0 ? (
                <li>
                  Akun diskon kelompok harga: {impact.discountGroups.map((row) => row.name).join(", ")}
                </li>
              ) : null}
              {impact.children.length > 0 ? (
                <li>
                  Induk dari {impact.children.length} sub-akun:{" "}
                  {impact.children.map((row) => `${row.code} ${row.name}`).join(", ")}
                </li>
              ) : null}
              {impact.journalLineCount > 0 ? (
                <li>
                  {impact.journalLineCount} baris jurnal terposting · saldo terakhir{" "}
                  {formatIDR(impact.balance)}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Akun ini belum dirujuk pemetaan, metode pembayaran, kelompok harga, sub-akun, atau
              jurnal mana pun.
            </p>
          )}
        </div>
      </section>

      <div className="mt-3">
        <AuditHistorySection
          rows={audit.rows}
          emptyDescription="Perubahan master akun ini akan tercatat di sini."
          headerClassName="border-b border-border px-4 py-3"
          footer={
            <Pagination
              page={audit.page}
              pageSize={audit.pageSize}
              total={audit.total}
              basePath={`/app/akuntansi/akun/${id}`}
            />
          }
        />
      </div>
    </DocumentPage>
  );
}
