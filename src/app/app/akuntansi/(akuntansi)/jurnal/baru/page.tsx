import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, History } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { fiscalPeriods } from "@/db/schema";
import { getAccountMap, listPostableAccounts } from "@/server/accounting";
import { getJournalDetail } from "@/server/reports";
import { listCustomers, listSuppliers } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { JournalEntryForm } from "@/components/akuntansi/journal-entry-form";
import { copyJournalLines } from "@/lib/akuntansi/journal-form";

export const metadata = { title: "Jurnal baru" };
export const dynamic = "force-dynamic";

export default async function NewJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.post");
  const copyFromId =
    typeof params.from === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.from)
      ? params.from
      : null;
  const { accounts, mappedAccounts, periods, customers, suppliers, copied } = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [postable, mappings, customerRows, supplierRows, periodRows, copiedJournal] = await Promise.all([
      listPostableAccounts(tx, ctx.company.id),
      getAccountMap(tx, ctx.company.id),
      // A-21 (R3-09): daftar pihak untuk pemilih tag baris jurnal.
      listCustomers(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
      // FIX-P1 Tahap 5 (AK5-03): status periode dimuat dari server agar
      // formulir bisa memperingatkan SEBELUM submit, bukan sesudahnya
      // lewat toast error PERIOD_CLOSED.
      tx
        .select({ year: fiscalPeriods.year, month: fiscalPeriods.month, status: fiscalPeriods.status })
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.companyId, ctx.company.id))
        .orderBy(asc(fiscalPeriods.year), asc(fiscalPeriods.month)),
      copyFromId ? getJournalDetail(tx, ctx.company.id, copyFromId) : Promise.resolve(null),
    ]);
    return {
      accounts: postable,
      mappedAccounts: mappings,
      periods: periodRows,
      customers: customerRows,
      suppliers: supplierRows,
      copied: copiedJournal,
    };
  });

  return (
    <div>
      <Link href="/app/akuntansi" className="mb-3 inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Kembali ke akuntansi
      </Link>
      <PageHeader
        eyebrow="Akuntansi"
        title="Jurnal baru"
        description="Formulir mulai dengan tiga baris. Isi debit atau kredit; baris berdekatan yang akunnya sudah dipilih terisi otomatis sebagai penyeimbang. Keterangan opsional."
        actions={
          <Link
            href="/app/akuntansi/jurnal/riwayat"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            <History className="size-3.5" /> Riwayat
          </Link>
        }
      />
      <JournalEntryForm
        accounts={accounts.map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type }))}
        today={todayISO()}
        mappedAccounts={mappedAccounts}
        periods={periods}
        currentYear={new Date().getFullYear()}
        customers={customers}
        suppliers={suppliers}
        copyFrom={copied?.entry.number}
        initialDescription={copied?.entry.description ?? ""}
        initialLines={copied ? copyJournalLines(copied.lines) : undefined}
      />
    </div>
  );
}
