import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { customerGroups } from "@/db/schema";
import { getPartyDetail } from "@/server/master-data";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { PartyDetailView } from "@/components/gudang/party-detail-view";
import { CustomerForm } from "@/components/gudang/partner-forms";

export const metadata = { title: "Detail pelanggan" };
export const dynamic = "force-dynamic";

/**
 * A-25 U3 (GDG-02): detail pelanggan membawa ubah profil (form
 * master yang sama dengan daftar pihak) di kepala halamannya;
 * penerimaan pembayaran berjalan lewat tautan saldo ke Piutang &
 * Utang di dalam tampilannya.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");
  const canManage = can(ctx, "inventory.manage");
  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [detail, settings, groups] = await Promise.all([
      getPartyDetail(tx, ctx.company.id, "customer", id),
      getSettings(tx, ctx.company.id),
      // Kelompok pelanggan: satu tabel tanpa join (pola baca yang
      // sama dengan halaman daftar pihak).
      tx
        .select({ id: customerGroups.id, name: customerGroups.name })
        .from(customerGroups)
        .where(eq(customerGroups.companyId, ctx.company.id))
        .orderBy(asc(customerGroups.name)),
    ]);
    return { detail, settings, groups };
  });
  if (!data.detail) notFound();
  const detail = data.detail;
  return (
    <PartyDetailView
      detail={detail}
      editForm={
        canManage ? (
          <CustomerForm
            groups={data.groups}
            customer={{
              id: detail.party.id,
              code: detail.party.code,
              name: detail.party.name,
              phone: detail.party.phone,
              email: detail.party.email,
              address: detail.party.address,
              groupId: detail.party.groupId ?? "",
              creditLimit: detail.party.creditLimit ?? "0",
              creditLimitUnlimited: detail.party.creditLimitUnlimited,
              taxId: detail.party.taxId,
              paymentTermDays: detail.party.paymentTermDays,
            }}
            customFields={customFieldDefinitionsFor(data.settings?.customFields, "customer")}
          />
        ) : undefined
      }
    />
  );
}
