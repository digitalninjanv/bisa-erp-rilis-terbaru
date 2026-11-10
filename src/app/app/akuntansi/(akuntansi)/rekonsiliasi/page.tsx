import Link from "next/link";
import { BookOpen, Landmark } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getReconciliationFormData,
  getReconciliationSummary,
  listBookLines,
  listReconciliationAccounts,
  listStatementImports,
  listStatementLines,
} from "@/server/bank-reconciliation";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { LIST_PAGE_SIZE } from "@/lib/pagination";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { EmptyState } from "@/components/blocks/empty-state";
import { labelClass } from "@/components/akuntansi/field-classes";
import { Pagination } from "@/components/blocks/pagination";
import {
  AutoMatchButton,
  ImportStatementDialog,
  StatementLinesTable,
} from "@/components/akuntansi/bank-reconciliation-panel";
import { cn } from "@/lib/utils";

export const metadata = { title: "Rekonsiliasi bank" };
export const dynamic = "force-dynamic";

// G3 (TBL-01): ukuran halaman baku repo (sebelumnya 25 setempat).
// Kandidat pencocokan (fetch 200 di bawah) adalah bacaan kerja
// internal panel, bukan daftar halaman — tidak ikut diselaraskan.
const PAGE_SIZE = LIST_PAGE_SIZE;

type StatusFilter = "all" | "matched" | "unmatched";

function parseStatus(value: string | undefined, fallback: StatusFilter): StatusFilter {
  return value === "matched" || value === "unmatched" || value === "all" ? value : fallback;
}

function FilterChips({
  base,
  param,
  current,
  otherParams,
}: {
  base: string;
  param: string;
  current: StatusFilter;
  otherParams: Record<string, string | undefined>;
}) {
  const options: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "Semua" },
    { value: "unmatched", label: "Belum tertaut" },
    { value: "matched", label: "Sudah tertaut" },
  ];
  return (
    <div className="flex gap-1">
      {options.map((option) => {
        const search = new URLSearchParams();
        Object.entries(otherParams).forEach(([key, value]) => {
          if (value) search.set(key, value);
        });
        search.set(param, option.value);
        return (
          <Link
            key={option.value}
            href={`${base}?${search.toString()}`}
            className={cn(
              /* FIX-R2 Tahap 2 (RD2U-05): chip filter mengikuti bahasa
                 visual FilterChips bersama (pil penuh, aktif =
                 foreground) — bukan varian kotak sendiri.
                 A-22 K6: tinggi disamakan dengan FilterChips bersama
                 (h-8) — varian lokal ini tertinggal di py-1 (27px). */
              "inline-flex h-8 items-center rounded-full px-3 text-[11px] font-medium",
              current === option.value
                ? "bg-foreground text-background"
                : "border border-border bg-card text-muted-foreground transition-colors hover:bg-muted",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function RekonsiliasiPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountId?: string;
    sstatus?: string;
    page?: string;
    bstatus?: string;
    bpage?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const canManage = can(ctx, "accounting.manage");

  const eligible = await withCompanyReadOnly(ctx.company.id, (tx) =>
    listReconciliationAccounts(tx, ctx.company.id),
  );

  if (eligible.length === 0) {
    return (
      <div>
        <PageHeader
          eyebrow="Akuntansi"
          title="Rekonsiliasi bank"
          description="Cocokkan mutasi rekening bank dengan buku besar."
        />
        {/* A-24 T1 (SIS-05): prasyaratnya benar, tetapi instruksi &
            tombol Pengaturan hanya boleh ditawarkan kepada pemegang
            settings.manage — pola yang sama seperti peringatan ambang
            di halaman Penyesuaian. */}
        <EmptyState
          title="Belum ada akun kas/bank"
          description={can(ctx, "settings.manage")
            ? "Rekonsiliasi membutuhkan akun hasil pemetaan kas/bank/QRIS atau akun metode pembayaran yang aktif. Atur pemetaan akun di Pengaturan terlebih dahulu."
            : "Rekonsiliasi membutuhkan akun hasil pemetaan kas/bank/QRIS atau akun metode pembayaran yang aktif. Minta pemilik/admin mengatur pemetaan akun di Pengaturan."}
          icon={<Landmark className="size-5" />}
          action={can(ctx, "settings.manage") ? (
            <Link
              href="/app/pengaturan"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Buka Pengaturan
            </Link>
          ) : undefined}
        />
      </div>
    );
  }

  const accountId = eligible.some((row) => row.id === params.accountId)
    ? (params.accountId as string)
    : eligible.find((row) => row.code === "1100")?.id ?? eligible[0].id;
  const account = eligible.find((row) => row.id === accountId) ?? eligible[0];

  // A-22 K3: halaman dibuka sebagai ANTREAN kerja — bawaan daftar
  // mutasi adalah "belum tertaut"; chip tetap bisa beralih ke
  // Semua/Sudah tertaut.
  const sStatus = parseStatus(params.sstatus, "unmatched");
  const bStatus = parseStatus(params.bstatus, "unmatched");
  const sPage = Math.max(1, Number(params.page ?? "1") || 1);
  const bPage = Math.max(1, Number(params.bpage ?? "1") || 1);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [summary, statements, books, candidates, imports, formData] = await Promise.all([
      getReconciliationSummary(tx, ctx.company.id, accountId),
      listStatementLines(tx, ctx.company.id, accountId, {
        status: sStatus,
        page: sPage,
        pageSize: PAGE_SIZE,
      }),
      listBookLines(tx, ctx.company.id, accountId, {
        status: bStatus,
        page: bPage,
        pageSize: PAGE_SIZE,
      }),
      listBookLines(tx, ctx.company.id, accountId, { status: "unmatched", page: 1, pageSize: 200 }),
      listStatementImports(tx, ctx.company.id, accountId),
      getReconciliationFormData(tx, ctx.company.id, accountId),
    ]);
    return { summary, statements, books, candidates, imports, formData };
  });

  const sharedParams = {
    accountId,
    sstatus: sStatus,
    bstatus: bStatus,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi"
        title="Rekonsiliasi bank"
        description="Cocokkan mutasi rekening bank dengan baris jurnal pada akun yang sama, dan buat jurnal untuk mutasi yang belum tercatat. Nominal harus sama persis — selisih diselesaikan lewat jurnal penyesuaian."
      />

      {/* A-25 U4 (AKT-01): bilah kerja satu baris — pemilih akun,
          pencocokan otomatis, dan impor yang kini hidup di dialog.
          Formulir impor tidak lagi mendominasi paruh atas halaman;
          pekerjaan harian (pencocokan) menjadi isi utama. */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className={labelClass}>Akun kas/bank</span>
            <select
              name="accountId"
              defaultValue={accountId}
              className="h-9 rounded-md border border-input bg-background px-2 text-[12px]"
            >
              {eligible.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} — {row.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            Tampilkan
          </button>
        </form>
        {canManage ? <AutoMatchButton accountId={accountId} /> : null}
        {canManage ? <ImportStatementDialog accountId={accountId} /> : null}
        <span className="pb-1 text-[11px] text-muted-foreground">
          Rekening aktif: {account.code} — {account.name}
        </span>
        {data.imports.length > 0 ? (
          <span className="pb-1 text-[11px] text-muted-foreground">
            · Impor terakhir:{" "}
            {data.imports
              .map(
                (row) =>
                  `${row.fileName} (${row.insertedRows} masuk, ${row.skippedRows} dilewati, ${formatDate(row.createdAt.toISOString().slice(0, 10))})`,
              )
              .join(" · ")}
          </span>
        ) : null}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard size="compact" label="Saldo buku (GL)" value={formatIDR(data.summary.bookBalance)} hint="Semua jurnal terposting s.d. hari ini" />
        <StatCard size="compact" label="Sudah direkonsiliasi" value={formatIDR(data.summary.reconciledTotal)} hint="Baris jurnal yang tertaut ke mutasi" />
        <StatCard size="compact" label="Belum direkonsiliasi" value={formatIDR(data.summary.unreconciledTotal)} hint="Baris jurnal tanpa tautan mutasi" />
        <StatCard size="compact" label="Mutasi belum tertaut" value={formatIDR(data.summary.unmatchedStatementTotal)} hint="Neto mutasi impor tanpa pasangan (debit +)" />
      </div>

      {/* A-25 U4 (AKT-01): pencocokan BERDAMPINGAN — mutasi bank di
          kiri, buku besar di kanan, dalam satu pandangan (menggantikan
          tumpukan vertikal A-22 K3). Pasangan dikerjakan dari kolom
          mutasi: usulan pasangan per baris menamai jurnal bukunya
          (quick-match), panel baris membuka pilihan jurnal dari daftar
          kandidat buku yang sama — kolom kanan adalah referensi hidup
          dengan filter & halamannya sendiri. Di bawah xl kedua kolom
          menumpuk kembali (mutasi tetap di atas). */}
      <div className="grid items-start gap-3 xl:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Mutasi bank — antrean pencocokan</h2>
              <p className="text-[11px] text-muted-foreground">
                Kerjakan dari sini: tautkan usulan pasangan atau buat jurnal untuk mutasi yang belum tercatat.
              </p>
            </div>
            <FilterChips
              base="/app/akuntansi/rekonsiliasi"
              param="sstatus"
              current={sStatus}
              otherParams={{ accountId, bstatus: bStatus }}
            />
          </div>
          <div className="overflow-x-auto contain-paint">
            <StatementLinesTable
              rows={data.statements.rows}
              bookCandidates={data.candidates.rows}
              contraAccounts={data.formData.contraAccounts}
              models={data.formData.models}
              canManage={canManage}
            />
          </div>
          <Pagination
            page={data.statements.page}
            pageSize={data.statements.pageSize}
            total={data.statements.total}
            basePath="/app/akuntansi/rekonsiliasi"
            params={{ ...sharedParams, bpage: String(bPage) }}
          />
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Buku besar — {account.code}</h2>
            <FilterChips
              base="/app/akuntansi/rekonsiliasi"
              param="bstatus"
              current={bStatus}
              otherParams={{ accountId, sstatus: sStatus }}
            />
          </div>
          {data.books.rows.length === 0 ? (
            <EmptyState
              title="Tidak ada baris jurnal"
              description="Tidak ada baris jurnal pada filter ini untuk akun terpilih."
              icon={<BookOpen className="size-5" />}
              className="py-8"
            />
          ) : (
            /* FIX-R2 Tahap 2 (RD2U-05): tabel buku besar memakai
               .data-table bersama (header uppercase-muted, hover
               bertransisi) dan status tertaut memakai nada token rumah
               — bukan lagi tabel bespoke hijau emerald Tailwind.
               A-25 U4: dibungkus overflow-x-auto seperti kolom mutasi
               agar dua kolom berdampingan tidak saling memotong. */
            <div className="overflow-x-auto contain-paint">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Jurnal</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Kredit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.books.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="num whitespace-nowrap text-[12px]">{formatDate(row.date)}</td>
                    <td className="text-[12px]">
                      <span className="font-medium">{row.entryNumber}</span>
                      <span className="block text-[11px] text-muted-foreground">{row.description}</span>
                    </td>
                    <td className="num whitespace-nowrap text-right text-[12px]">
                      {Number(row.debit) > 0 ? formatIDR(row.debit) : "—"}
                    </td>
                    <td className="num whitespace-nowrap text-right text-[12px]">
                      {Number(row.credit) > 0 ? formatIDR(row.credit) : "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      {row.matched ? (
                        <span className="inline-flex items-center rounded-full bg-tone-green-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-tone-green">
                          Tertaut
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-tone-amber-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-tone-amber">
                          Belum
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span>{data.books.total} data</span>
            {data.books.total > data.books.pageSize ? (
              <span className="flex gap-2">
                {bPage > 1 ? (
                  <Link
                    href={`/app/akuntansi/rekonsiliasi?accountId=${accountId}&sstatus=${sStatus}&bstatus=${bStatus}&page=${sPage}&bpage=${bPage - 1}`}
                    className="rounded border border-border bg-card px-2 py-1 transition-colors hover:bg-muted"
                  >
                    Sebelumnya
                  </Link>
                ) : null}
                {bPage * data.books.pageSize < data.books.total ? (
                  <Link
                    href={`/app/akuntansi/rekonsiliasi?accountId=${accountId}&sstatus=${sStatus}&bstatus=${bStatus}&page=${sPage}&bpage=${bPage + 1}`}
                    className="rounded border border-border bg-card px-2 py-1 transition-colors hover:bg-muted"
                  >
                    Berikutnya
                  </Link>
                ) : null}
              </span>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
