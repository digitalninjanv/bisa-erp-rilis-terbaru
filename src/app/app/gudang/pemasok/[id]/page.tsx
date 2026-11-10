import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getPartyDetail } from "@/server/master-data";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { todayISO } from "@/lib/format";
import { PartyDetailView } from "@/components/gudang/party-detail-view";
import { SupplierForm } from "@/components/gudang/partner-forms";
import { PurchaseOrderForm } from "@/components/gudang/purchase-order-form";

export const metadata = { title: "Detail pemasok" };
export const dynamic = "force-dynamic";

/**
 * A-25 U3 (GDG-02): detail pemasok membawa tindakannya sendiri —
 * ubah profil (form master yang sama dengan daftar) dan buat PO
 * dengan pemasok ini terpilih (form PO yang sama, daftar pemasok
 * dibatasi ke pihak ini). Keduanya hanya untuk peran berizin kelola.
 */
export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");
  const canManage = can(ctx, "inventory.manage");
  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [detail, settings] = await Promise.all([
      getPartyDetail(tx, ctx.company.id, "supplier", id),
      getSettings(tx, ctx.company.id),
    ]);
    return { detail, settings };
  });
  if (!data.detail) notFound();
  const detail = data.detail;
  return (
    <PartyDetailView
      detail={detail}
      editForm={
        canManage ? (
          <SupplierForm
            supplier={{
              id: detail.party.id,
              code: detail.party.code,
              name: detail.party.name,
              phone: detail.party.phone,
              email: detail.party.email,
              address: detail.party.address,
              notes: detail.party.notes,
              taxId: detail.party.taxId,
              bankName: detail.party.bankName,
              bankAccountNumber: detail.party.bankAccountNumber,
              bankAccountName: detail.party.bankAccountName,
              paymentTermDays: detail.party.paymentTermDays,
            }}
            customFields={customFieldDefinitionsFor(data.settings?.customFields, "supplier")}
          />
        ) : undefined
      }
      createSection={
        canManage ? (
          <PurchaseOrderForm
            suppliers={[{ id: detail.party.id, name: detail.party.name }]}
            today={todayISO()}
            triggerPrimary={false}
          />
        ) : undefined
      }
    />
  );
}
