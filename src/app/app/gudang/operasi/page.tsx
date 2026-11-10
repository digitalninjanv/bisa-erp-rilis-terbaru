import { withCompanyReadOnly } from "@/db/tenant";
import { getOperationQueue } from "@/server/inventory";
import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { OperationQueueBoard } from "@/components/gudang/operation-queue";

export const metadata = { title: "Mode Operasi Gudang" };
export const dynamic = "force-dynamic";

/**
 * A-24 T3 (pola G1) — Mode Operasi: antrean kerja gudang sebagai
 * kartu besar ramah sentuh + satu input pindai yang selalu fokus.
 * Memindai barcode operasi (nomor dokumen tercetak) membuka dokumen
 * operasinya; memindai produk membuka/menandai operasi yang memuat
 * produk itu. Dokumen & domain yang ada tetap mesinnya — halaman ini
 * hanya membaca antrean lewat fungsi baca modul inventory.
 */
export default async function OperationModePage() {
  const ctx = await requirePermissionPage("inventory.view");

  const queue = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    getOperationQueue(tx, ctx.company.id, ctx.user.id),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Gudang · Mode Operasi"
        title="Antrean operasi"
        description="Kerja yang menunggu di gudang, dalam kartu besar. Pindai nomor dokumen pada kertas PO/surat jalan untuk langsung membuka operasinya, atau pindai barcode produk untuk menemukan operasi yang memuatnya."
      />
      <OperationQueueBoard myTasks={queue.myTasks} queue={queue.queue} />
    </div>
  );
}
