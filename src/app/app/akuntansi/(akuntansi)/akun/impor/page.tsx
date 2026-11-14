import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { importJobs } from "@/db/schema";
import { getSettings, listLinkedJournalsBySourceIds, listWarehouses, pickDefaultWarehouseId } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { MasterImportWizard } from "@/components/gudang/import-master-wizard";

export const metadata = { title: "Impor bagan akun" };
export const dynamic = "force-dynamic";

export default async function ImportAccountsPage() {
  const ctx = await requirePermissionPage("import.manage");
  await requirePermissionPage("accounting.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouses, settings, jobs] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      tx
        .select({
          id: importJobs.id,
          fileName: importJobs.fileName,
          status: importJobs.status,
          totalRows: importJobs.totalRows,
          successRows: importJobs.successRows,
          failedRows: importJobs.failedRows,
          createdAt: importJobs.createdAt,
        })
        .from(importJobs)
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.entity, "accounts")))
        .orderBy(desc(importJobs.createdAt))
        .limit(10),
    ]);
    const journalsByJob = await listLinkedJournalsBySourceIds(
      tx,
      ctx.company.id,
      jobs.map((job) => job.id),
    );
    const history = jobs.map((job) => {
      const opening = (journalsByJob.get(job.id) ?? []).find(
        (journal) => journal.sourceType === "opening" && !journal.reversalOfId,
      );
      return {
        ...job,
        createdAt: job.createdAt.toISOString(),
        journalId: opening?.id ?? null,
        journalNumber: opening?.number ?? null,
      };
    });
    return {
      warehouses,
      history,
      defaultWarehouseId: pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId),
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Akuntansi · Bagan akun"
        title="Impor bagan akun"
        description="Unggah dan validasi akun di konteks Akuntansi. Kolom: kode, nama, tipe, saldo normal, bagian, dan keterangan. Hierarki akun induk tidak diimpor; kode yang sudah ada akan dilewati."
        actions={
          <Link
            href="/app/akuntansi/akun"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            <ArrowLeft className="size-3.5" /> Kembali ke bagan akun
          </Link>
        }
      />
      <MasterImportWizard
        entity="accounts"
        title="Pilih file bagan akun"
        description="Gunakan template untuk memastikan nama kolom dan tipe akun dikenali. Periksa semua baris pada pratinjau sebelum mengimpor."
        warehouses={data.warehouses}
        defaultWarehouseId={data.defaultWarehouseId}
        history={data.history}
      />
    </div>
  );
}
