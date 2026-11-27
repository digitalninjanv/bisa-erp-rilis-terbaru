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
import { journalSourceLabel, todayISO, monthStartISO, JOURNAL_SOURCE_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { Pagination } from "@/components/blocks/pagination";
import { DataList, DataListToolbar, dataListFilterClass, dataListFilterWideClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { JournalHistoryTable } from "@/components/akuntansi/journal-history-table";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Riwayat jurnal" };
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
        title="Riwayat jurnal"
        description="Daftar jurnal otomatis dari POS, gudang, beban, payroll, serta jurnal manual. Saring berdasarkan periode, sumber, akun, atau status; buka detail atau ekspor."
        actions={
          <>
            <Link
              href={`/api/export/journals?${exportParams.toString()}${exportParams.toString() ? "&" : ""}format=xlsx`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Ekspor Excel
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
          <SummaryStrip
            items={[
              { label: "Jurnal", value: String(data.summary.entries), hint: `${data.summary.manual} manual` },
              { label: "Total debit", value: formatIDR(data.summary.debit), hint: "Periode terpilih" },
              { label: "Total kredit", value: formatIDR(data.summary.credit), hint: "Periode terpilih" },
              {
                label: "Selisih",
                value: formatIDR(data.summary.debit - data.summary.credit),
                hint: Math.abs(data.summary.debit - data.summary.credit) < 0.01 ? "Seimbang" : "Periksa jurnal",
                tone: Math.abs(data.summary.debit - data.summary.credit) < 0.01 ? ("green" as const) : ("red" as const),
              },
            ]}
          />
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
            action="/app/akuntansi/jurnal/riwayat"
            q={params.q}
            placeholder="Cari nomor atau keterangan…"
            resetHref={
              params.q || params.source || params.account || params.status || params.user
                ? "/app/akuntansi/jurnal/riwayat"
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
            basePath="/app/akuntansi/jurnal/riwayat"
            params={{ q: params.q, from, to, source: params.source, account: params.account, status: params.status, user: params.user }}
          />
        }
      >
        <JournalHistoryTable rows={data.rows} />
      </DataList>
    </div>
  );
}

