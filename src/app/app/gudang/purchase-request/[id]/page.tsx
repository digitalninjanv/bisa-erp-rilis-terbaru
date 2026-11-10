import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { suppliers } from "@/db/schema";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatQty } from "@/lib/money";
import { formatDateLong } from "@/lib/format";
import { PR_STATUS_LABELS, getPurchaseRequest } from "@/server/purchase-requests";
import { DocumentMetaRows, DocumentPage } from "@/components/blocks/document-page";
import {
  PURCHASE_REQUEST_FLOW_STAGES,
  documentFlowSteps,
} from "@/lib/document-flow";
import {
  PurchaseRequestConvertForm,
  PurchaseRequestDecisionButtons,
} from "@/components/gudang/purchase-request-panel";

export const metadata = { title: "Detail Purchase Request" };
export const dynamic = "force-dynamic";

export default async function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const request = await getPurchaseRequest(tx, ctx.company.id, id);
    if (!request) return null;
    const supplierRows = await tx
      .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.companyId, ctx.company.id))
      .orderBy(asc(suppliers.name));
    return { request, supplierRows };
  });
  if (!data) notFound();
  const { request } = data;
  const canManage = can(ctx, "inventory.manage");
  const showDecision = canManage && request.status === "submitted";
  const showConvert = canManage && request.status === "approved";

  // A-25 U3: detail PR memakai DocumentPage bersama — StatusSteps
  // Diajukan → Disetujui → Menjadi PO dari status nyata (ditolak
  // menutup alur sebagai tahap void), tombol keputusan menjadi aksi
  // di rel atas, meta di rel kanan. Semua qty dirender formatQty
  // (temuan audit: qty PR pernah tampil mentah "10000").
  return (
    <DocumentPage
      backHref="/app/gudang/purchase-request"
      backLabel="Semua PR"
      eyebrow="Gudang · Purchase Request"
      number={request.number}
      title={request.notes ?? undefined}
      status={request.status}
      steps={documentFlowSteps(
        request.status,
        PURCHASE_REQUEST_FLOW_STAGES,
        PR_STATUS_LABELS[request.status] ?? request.status,
      )}
      actions={
        showDecision ? (
          <PurchaseRequestDecisionButtons id={request.id} number={request.number} />
        ) : null
      }
      banners={
        <>
          {showDecision ? (
            <div className="border-t border-border bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">
              Menunggu keputusan — pengesah wajib pengguna lain selain pembuat PR.
            </div>
          ) : null}
          {request.decisionNote ? (
            <div className="border-t border-border bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">
              Catatan keputusan: {request.decisionNote}
            </div>
          ) : null}
          {request.convertedPoId ? (
            <div className="border-t border-border bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">
              Sudah dikonversi menjadi{" "}
              <Link
                href={`/app/gudang/pembelian/${request.convertedPoId}`}
                className="font-medium text-foreground underline"
              >
                PO terkait
              </Link>
              .
            </div>
          ) : null}
        </>
      }
      meta={
        <DocumentMetaRows
          rows={[
            { label: "Tanggal diajukan", value: formatDateLong(request.date) },
            {
              label: "Status",
              value: PR_STATUS_LABELS[request.status] ?? request.status,
            },
            { label: "Total perkiraan", value: formatIDR(request.totalEstimate) },
            { label: "Jumlah baris", value: formatQty(request.lines.length) },
            ...(request.convertedPoId
              ? [
                  {
                    label: "PO terkait",
                    value: (
                      <Link
                        href={`/app/gudang/pembelian/${request.convertedPoId}`}
                        className="text-primary hover:underline"
                      >
                        Buka PO
                      </Link>
                    ),
                  },
                ]
              : []),
          ]}
        />
      }
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Baris permintaan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Alasan</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Perkiraan harga</th>
                <th className="text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {request.lines.map((line) => (
                <tr key={line.id}>
                  <td className="text-[12px] font-medium">
                    {line.productName ?? "—"}
                    <span className="num ml-1.5 text-[10px] font-normal text-muted-foreground">{line.productSku ?? ""}</span>
                  </td>
                  <td className="text-[11px] text-muted-foreground">{line.reason ?? "—"}</td>
                  <td className="num text-right text-[12px]">{formatQty(line.qty)}</td>
                  <td className="num text-right text-[12px]">{formatIDR(line.estimatedPrice)}</td>
                  <td className="num text-right text-[12px] font-medium">{formatIDR(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-[12px] font-semibold">Total perkiraan</td>
                <td className="num text-right text-[12px] font-semibold">{formatIDR(request.totalEstimate)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {showConvert ? (
        <section className="mt-3 rounded-lg border border-border bg-card px-4 py-3">
          <h2 className="mb-2 text-[13px] font-semibold">Konversi menjadi PO</h2>
          <PurchaseRequestConvertForm id={request.id} number={request.number} suppliers={data.supplierRows} />
        </section>
      ) : null}
    </DocumentPage>
  );
}
