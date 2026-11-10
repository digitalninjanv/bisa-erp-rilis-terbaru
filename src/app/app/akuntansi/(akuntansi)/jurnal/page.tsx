import Link from "next/link";
import { BookOpen, Download } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getJournalSummary,
  listAccounts,
  listJournalActors,
  listJournalEntries,
  listJournalSourceTypes,
} from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { LIST_PAGE_SIZE } from "@/lib/pagination";
import { formatIDR } from "@/lib/money";
import { formatDate, journalSourceLabel, todayISO, monthStartISO, JOURNAL_SOURCE_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { Pagination } from "@/components/blocks/pagination";
import { DataList, DataListToolbar, dataListFilterClass, dataListFilterWideClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { RowMenu } from "@/components/blocks/row-menu";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Jurnal umum" };
export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    source?: string;
    account?: string;
    status?: string;
    user?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [list, summary, accounts, sourceTypes, actors] = await Promise.all([
      listJournalEntries(tx, {
        companyId: ctx.company.id,
        q: params.q,
        from,
        to,
        sourceType: params.source,
        accountId: params.account,
        status: params.status,
        createdBy: params.user,
        page: Number(params.page ?? 1),
        // G3 (TBL-01): ukuran halaman baku repo (sebelumnya 30).
        pageSize: LIST_PAGE_SIZE,
      }),
      getJournalSummary(tx, ctx.company.id, { from, to: `${to}T23:59:59` }),
      listAccounts(tx, ctx.company.id),
      listJournalSourceTypes(tx, ctx.company.id),
      listJournalActors(tx, ctx.company.id),
    ]);
    return { ...list, summary, accounts, sourceTypes, actors };
  });

  // FIX-P1 Tahap 5 (AK5-02d): opsi sumber = gabungan tipe yang dikenal
  // kode (berlabel) dan tipe yang benar-benar ada di data perusahaan —
  // bukan lagi 9 nilai hardcoded yang menyembunyikan ±sebelas tipe nyata.
  const sourceOptions = [...new Set([...Object.keys(JOURNAL_SOURCE_LABELS), ...data.sourceTypes])]
    .map((value) => ({ value, label: journalSourceLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, "id"));

  const exportParams = new URLSearchParams({ from, to });
  if (params.q) exportParams.set("q", params.q);
  if (params.source) exportParams.set("source", params.source);
  if (params.account) exportParams.set("account", params.account);
  if (params.status) exportParams.set("status", params.status);
  if (params.user) exportParams.set("user", params.user);

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Jurnal umum"
        description="Semua jurnal otomatis dari POS, gudang, beban, dan payroll — plus jurnal manual dengan kontrol keseimbangan."
        actions={
          <>
            <Link
              href={`/api/export/journals?${exportParams.toString()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Ekspor CSV
            </Link>
            {can(ctx, "accounting.post") ? (
              <Link
                href="/app/akuntansi/jurnal/baru"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Jurnal baru
              </Link>
            ) : null}
          </>
        }
      />

      {/* A-25 U2: daftar jurnal memakai DataList bersama. Ringkasan
          periode adalah isi slot KPI DataList (FIX-R2 Tahap 2
          (RD2U-01): StatCard compact bersama — varian lokal
          SummaryCard dihapus); slot ini OPSIONAL pada pola DataList,
          halaman ini mengisinya karena keseimbangan periode memang
          informasi kerja akuntan, bukan dekorasi. */}
      <DataList density="compact"
        kpis={
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Jurnal</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{data.summary.entries}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{data.summary.manual} manual</p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total debit</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{formatIDR(data.summary.debit)}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Periode terpilih</p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total kredit</p>
              <p className="num mt-1 text-[18px] font-semibold leading-none">{formatIDR(data.summary.credit)}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Periode terpilih</p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Selisih</p>
              <p className={`num mt-1 text-[18px] font-semibold leading-none ${Math.abs(data.summary.debit - data.summary.credit) < 0.01 ? "text-tone-green" : "text-destructive"}`}>
                {formatIDR(data.summary.debit - data.summary.credit)}
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {Math.abs(data.summary.debit - data.summary.credit) < 0.01 ? "Seimbang" : "Periksa jurnal"}
              </p>
            </div>
          </div>
        }
        toolbar={
          /* A-22 K1 (UX-01): JANGAN teruskan from/to/source sebagai
             hidden — ketiganya sudah menjadi kontrol anak form di bawah.
             Hidden + anak bernama sama membuat parameter terkirim dua
             kali, searchParams menjadi array, dan kueri jurnal melempar
             error (halaman error dari UI). Satu sumber kebenaran:
             kontrol anak. A-25 U2: input tanggal native diganti
             DateField bersama (tampilan selalu dd/mm/yyyy; nilai yang
             terkirim tetap ISO lewat input tersembunyi bernama). */
          <DataListToolbar
            action="/app/akuntansi/jurnal"
            q={params.q}
            placeholder="Cari nomor atau keterangan…"
            resetHref={
              params.q || params.source || params.account || params.status || params.user
                ? "/app/akuntansi/jurnal"
                : undefined
            }
          >
            <DateRangeField
              from={{ name: "from", defaultValue: from }}
              to={{ name: "to", defaultValue: to }}
            />
            <select name="source" defaultValue={params.source ?? ""} className={dataListFilterClass} aria-label="Sumber">
              <option value="">Semua sumber</option>
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select name="account" defaultValue={params.account ?? ""} className={dataListFilterWideClass} aria-label="Akun">
              <option value="">Semua akun</option>
              {data.accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} · {account.name}</option>
              ))}
            </select>
            <select name="status" defaultValue={params.status ?? ""} className={dataListFilterClass} aria-label="Status">
              <option value="">Semua status</option>
              <option value="posted">Terposting</option>
              <option value="void">Dibatalkan</option>
              <option value="draft">Draf</option>
            </select>
            <select name="user" defaultValue={params.user ?? ""} className={dataListFilterWideClass} aria-label="User">
              <option value="">Semua user</option>
              {data.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.name}</option>
              ))}
            </select>
          </DataListToolbar>
        }
        isEmpty={data.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada jurnal"
            description={can(ctx, "accounting.post")
              ? "Transaksi akan otomatis membentuk jurnal di periode ini. Untuk pencatatan manual, gunakan tombol Jurnal baru di kanan atas."
              : "Transaksi akan otomatis membentuk jurnal di periode ini. Peran Anda hanya dapat melihat jurnal."}
            icon={<BookOpen className="size-5" />}
            action={
              can(ctx, "accounting.post") ? (
                <Link
                  href="/app/akuntansi/jurnal/baru"
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Buat jurnal manual
                </Link>
              ) : undefined
            }
          />
        }
        pagination={
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/app/akuntansi/jurnal"
            params={{ q: params.q, from, to, source: params.source, account: params.account, status: params.status, user: params.user }}
          />
        }
      >
        {/* G4 (UX4-04): contain-paint — tanpa ini scrollable-overflow tabel
            lebar merambat melewati wadah gulir ke dokumen (halaman ikut
            bergeser di 390px walau tabel sudah di dalam overflow-x-auto). */}
        <div className="overflow-x-auto contain-paint">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Keterangan</th>
                <th>Sumber</th>
                <th>Status</th>
                <th className="text-right">Nilai</th>
                <th className="w-10"><span className="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/app/akuntansi/jurnal/${row.id}`} className="num font-medium transition-colors hover:underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                  <td className="max-w-[340px] text-[12px]">
                    <span className="block truncate">{row.description}</span>
                    {/* A-28 UI-3 (AKT-05): rincian debit/kredit per
                        baris jurnal, ringkas & dapat dilipat — akuntan
                        tak perlu membuka detail hanya untuk melihat
                        komposisi akun jurnal ini. */}
                    {row.lines.length > 0 ? (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer text-[11px] text-primary hover:underline">
                          Rincian {row.lines.length} baris
                        </summary>
                        <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-2">
                          {row.lines.map((line, index) => (
                            <li key={index} className="flex items-baseline justify-between gap-3 text-[11px]">
                              <span className="min-w-0 truncate">
                                <span className="num mr-1.5 text-muted-foreground">{line.accountCode}</span>
                                {line.accountName}
                              </span>
                              <span className="num shrink-0 whitespace-nowrap">
                                {line.debit > 0 ? `Dr ${formatIDR(line.debit)}` : line.credit > 0 ? `Cr ${formatIDR(line.credit)}` : "—"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                  {/* AK5-02d: label sumber Bahasa Indonesia bersama —
                      bukan lagi kata mentah hasil replace underscore. */}
                  <td className="text-[11px]">{journalSourceLabel(row.sourceType)}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="num text-right font-medium">{formatIDR(row.amount)}</td>
                  <td>
                    <div className="flex justify-end">
                      <RowMenu
                        label={`Aksi untuk jurnal ${row.number}`}
                        items={[
                          { key: "detail", label: "Lihat detail", href: `/app/akuntansi/jurnal/${row.id}` },
                          { key: "print", label: "Cetak", href: `/app/akuntansi/jurnal/${row.id}/cetak` },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}

