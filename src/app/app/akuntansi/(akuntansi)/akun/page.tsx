import Link from "next/link";
import { CornerDownRight, Download, Lock, SearchX, Upload } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { listAccountBalances } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDRSigned } from "@/lib/money";
import { normalBalanceLabel } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { FilterChips } from "@/components/blocks/search-form";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { AccountForm } from "@/components/akuntansi/account-form";
import { AccountRowActions } from "@/components/akuntansi/account-row-actions";
import { ACCOUNT_SECTIONS, maskBankAccountNumber, resolveSection } from "@/lib/accounting";

export const metadata = { title: "Bagan akun" };
export const dynamic = "force-dynamic";

const GROUPS = [
  { type: "asset", label: "Aset" },
  { type: "liability", label: "Liabilitas" },
  { type: "equity", label: "Ekuitas" },
  { type: "revenue", label: "Pendapatan" },
  { type: "cogs", label: "Harga pokok penjualan" },
  { type: "expense", label: "Beban" },
];

/**
 * A-25 U4: daftar bagan akun memakai DataList bersama — pencarian +
 * chip tipe menjadi satu bilah alat, KPI menjadi strip ringkas di
 * slot KPI, dan kelompok tipe menjadi sub-seksi di dalam SATU
 * bingkai (bukan enam kartu bertumpuk). Aksi baris: tautan navigasi
 * (detail, buku besar) masuk menu ⋯ RowMenu; Ubah tetap tombol
 * dialog komponennya (AccountForm membuka dialog sendiri — pola
 * yang sama seperti dialog pembayaran di Piutang & Utang).
 * A-28 UI-5 (UX-A05): Hapus kini ikut masuk menu ⋯ lewat
 * AccountRowActions (nonaktif berpenjelasan untuk akun terikat).
 * Judul kartu yang menggandakan judul halaman tidak ada lagi.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const allBalances = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listAccountBalances(tx, ctx.company.id),
  );
  const term = params.q?.trim().toLowerCase();
  const filteredByTerm = term
    ? allBalances.filter((row) => row.code.toLowerCase().includes(term) || row.name.toLowerCase().includes(term))
    : allBalances;
  const balances = params.type ? filteredByTerm.filter((row) => row.type === params.type) : filteredByTerm;
  const canManage = can(ctx, "accounting.manage");
  const parentById = new Map(allBalances.map((row) => [row.id, row.parentId]));
  const depthOf = (id: string) => {
    let depth = 0;
    let parent = parentById.get(id);
    const seen = new Set<string>();
    while (parent && !seen.has(parent) && depth < 10) {
      seen.add(parent);
      depth += 1;
      parent = parentById.get(parent);
    }
    return depth;
  };
  const parentOptions = balances.map((item) => ({ id: item.id, code: item.code, name: item.name }));

  // A-27 B4 (F-06): subtotal anti hitung ganda. Saldo akun header
  // (non-postable) yang DITAMPILKAN adalah rollup saldo akun detail
  // keturunannya; total grup & KPI hanya menjumlah akun DETAIL —
  // header tidak pernah ikut dijumlah (saldo jurnalnya sendiri, bila
  // ada sisa data lama, tidak dihitung dua kali). Untuk bagan datar
  // (semua akun detail, keadaan bawaan hari ini) angka tidak berubah.
  const childrenByParent = new Map<string, typeof allBalances>();
  for (const row of allBalances) {
    if (!row.parentId) continue;
    const siblings = childrenByParent.get(row.parentId) ?? [];
    siblings.push(row);
    childrenByParent.set(row.parentId, siblings);
  }
  const detailRollup = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = 0;
    for (const child of childrenByParent.get(id) ?? []) {
      total += child.isPostable ? child.balance : detailRollup(child.id, seen);
    }
    return total;
  };
  const displayBalance = (row: (typeof allBalances)[number]): number =>
    row.isPostable ? row.balance : detailRollup(row.id, new Set<string>());
  const detailTotal = (rows: typeof balances): number =>
    rows.filter((row) => row.isPostable).reduce((acc, row) => acc + row.balance, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Bagan akun"
        description="Struktur akun perusahaan beserta saldo berjalan. Akun baru langsung dapat dipakai pada jurnal dan pemetaan otomatis."
        actions={
          <>
            <Link
              href={`/api/export/accounts?${new URLSearchParams({
                ...(params.q ? { q: params.q } : {}),
                ...(params.type ? { type: params.type } : {}),
                format: "xlsx",
              }).toString()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Unduh Excel
            </Link>
            <Link
              href="/app/gudang/impor?jenis=accounts"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <Upload className="size-3.5" /> Impor Excel
            </Link>
            {canManage ? <AccountForm parents={parentOptions} /> : null}
          </>
        }
      />

      <DataList density="compact"
        kpis={
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total akun</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{balances.length}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{balances.filter((row) => row.isActive).length} aktif</p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Aset</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{formatIDRSigned(detailTotal(balances.filter((row) => row.type === "asset")))}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Saldo akun detail</p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Liabilitas</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{formatIDRSigned(detailTotal(balances.filter((row) => row.type === "liability")))}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Saldo akun detail</p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ekuitas</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{formatIDRSigned(detailTotal(balances.filter((row) => row.type === "equity")))}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Saldo akun detail</p>
            </div>
          </div>
        }
        toolbar={
          <>
            <DataListToolbar
              action="/app/akuntansi/akun"
              q={params.q}
              placeholder="Cari kode atau nama akun…"
              hidden={{ type: params.type }}
              resetHref={params.q || params.type ? "/app/akuntansi/akun" : undefined}
            />
            <div className="mt-2">
              <FilterChips
                basePath="/app/akuntansi/akun"
                param="type"
                value={params.type}
                q={params.q}
                options={[
                  { value: "", label: "Semua tipe" },
                  { value: "asset", label: "Aset" },
                  { value: "liability", label: "Liabilitas" },
                  { value: "equity", label: "Ekuitas" },
                  { value: "revenue", label: "Pendapatan" },
                  { value: "cogs", label: "HPP" },
                  { value: "expense", label: "Beban" },
                ]}
              />
            </div>
          </>
        }
        isEmpty={balances.length === 0}
        empty={
          /* FIX-R2 Tahap 2 (RD2U-08): pencarian tanpa hasil punya
             keadaan kosong yang dirancang, kini di dalam bingkai
             DataList yang sama. */
          <EmptyState
            title="Tidak ada akun yang cocok"
            description="Tidak ada akun yang cocok dengan kata kunci atau filter tipe ini. Coba kata kunci lain, atau reset pencarian untuk melihat seluruh bagan akun."
            icon={<SearchX className="size-5" />}
            action={
              <Link
                href="/app/akuntansi/akun"
                className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                Reset pencarian
              </Link>
            }
          />
        }
      >
        {GROUPS.map((group) => {
          const rows = balances.filter((row) => row.type === group.type);
          if (rows.length === 0) return null;
          return (
            <div key={group.type} className="border-b border-border last:border-b-0">
              <div className="flex items-center justify-between bg-muted/30 px-4 py-2">
                <h2 className="text-[12px] font-semibold">{group.label}</h2>
                <span className="num text-[11px] text-muted-foreground">
                  {rows.length} akun · {formatIDRSigned(detailTotal(rows))}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Nama akun</th>
                      <th>Saldo normal</th>
                      <th>Kelompok laporan</th>
                      <th className="text-right">Saldo</th>
                      <th>Status</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="num text-[11px] text-muted-foreground">{row.code}</td>
                        <td className="text-[12px] font-medium">
                          <span className="inline-flex items-center gap-1" style={{ paddingLeft: depthOf(row.id) * 14 }}>
                            {depthOf(row.id) > 0 ? <CornerDownRight className="size-3 shrink-0 text-muted-foreground" /> : null}
                            <Link href={`/app/akuntansi/akun/${row.id}`} className="transition-colors hover:underline">
                              {row.name}
                            </Link>
                            {/* A-27 B4 (F-07): lencana akun sistem — turunan
                                ikatan pemetaan/metode (isSystem di model
                                baca), bukan kolom bendera. */}
                            {row.isSystem ? (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground" title="Akun sistem — dirujuk pemetaan akun dan/atau metode pembayaran">
                                <Lock className="size-2.5" />
                                Sistem
                              </span>
                            ) : null}
                          </span>
                          {/* A-27 B3: rincian bank tampil termasker di daftar — nomor penuh hanya untuk formulir ubah. */}
                          {row.cashBankKind === "bank" && row.bankAccountNumber ? (
                            <span className="block text-[10px] font-normal text-muted-foreground" style={{ paddingLeft: depthOf(row.id) * 14 }}>
                              {row.bankName ?? "Bank"} · {maskBankAccountNumber(row.bankAccountNumber)}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-[11px]">{normalBalanceLabel(row.normalBalance)}</td>
                        <td className="text-[11px] text-muted-foreground">
                          {sectionLabel(row)}
                        </td>
                        <td className={`num text-right text-[12px] font-medium ${displayBalance(row) < 0 ? "text-destructive" : ""}`}>
                          {/* A-25 U0 (POLA-04): saldo yang membulat ke nol
                              tidak lagi tampil "-Rp 0" — formatIDRSigned
                              menormalkannya, negatif asli tetap bertanda.
                              A-27 B4: akun header menampilkan rollup
                              keturunannya (displayBalance), bukan saldo
                              jurnalnya sendiri. */}
                          {formatIDRSigned(displayBalance(row))}
                        </td>
                        <td>
                          <StatusBadge status={row.isActive ? "active" : "inactive"} />
                        </td>
                        <td className="text-right">
                          <AccountRowActions
                            account={{
                              id: row.id,
                              code: row.code,
                              name: row.name,
                              type: row.type,
                              normalBalance: row.normalBalance,
                              parentId: row.parentId,
                              section: row.section,
                              cashFlowGroup: row.cashFlowGroup,
                              cashBankKind: row.cashBankKind,
                              bankName: row.bankName,
                              bankAccountNumber: row.bankAccountNumber,
                              bankBranch: row.bankBranch,
                              bankAccountHolder: row.bankAccountHolder,
                              currency: row.currency,
                              psak118Category: row.psak118Category,
                              expenseNature: row.expenseNature,
                              expenseFunction: row.expenseFunction,
                              isContra: row.isContra,
                              contraOf: row.contraOf,
                              description: row.description,
                              isPostable: row.isPostable,
                              isActive: row.isActive,
                            }}
                            parents={parentOptions}
                            impact={{
                              // A-27 B4: ringkasan parsial utk alur
                              // konfirmasi penonaktifan bersaldo;
                              // ikatan rinci ada di halaman detail.
                              balance: String(row.balance),
                              journalLineCount: null,
                              mappingLabels: [],
                              paymentMethods: [],
                              discountGroupNames: [],
                              childrenCount: null,
                              isSystem: row.isSystem,
                              partial: true,
                            }}
                            canManage={canManage}
                            hasChildren={(childrenByParent.get(row.id) ?? []).length > 0}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </DataList>
    </div>
  );
}


function sectionLabel(row: { type: string; code: string; section?: string | null }): string {
  const section = resolveSection(row);
  return section ? ACCOUNT_SECTIONS[section] : "—";
}
