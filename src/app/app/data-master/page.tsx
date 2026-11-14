import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  BriefcaseBusiness,
  Calculator,
  FileText,
  FileSpreadsheet,
  GitBranch,
  Layers,
  Network,
  Package,
  Printer,
  Shapes,
  SlidersHorizontal,
  ShieldCheck,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { EmptyState } from "@/components/blocks/empty-state";
import { PageHeader } from "@/components/blocks/page-header";
import { requireAuth } from "@/lib/session";
import {
  MASTER_DATA_SECTIONS,
  visibleMasterDataEntries,
  type MasterDataId,
} from "@/lib/master-data-directory";

export const metadata = { title: "Data Master" };
export const dynamic = "force-dynamic";

const iconById = {
  products: Package,
  suppliers: Truck,
  customers: Users,
  taxonomy: Shapes,
  imports: FileSpreadsheet,
  "customer-groups": Tags,
  "chart-of-accounts": Calculator,
  "account-mappings": GitBranch,
  "fixed-asset-categories": Building2,
  "fiscal-periods": CalendarRange,
  employees: BriefcaseBusiness,
  "hr-organization": Network,
  "work-shifts": CalendarDays,
  "leave-types": CalendarCheck,
  locations: Warehouse,
  "payment-methods": Wallet,
  "document-numbering": FileText,
  "custom-fields": SlidersHorizontal,
  "users-and-roles": ShieldCheck,
  "company-policies": Building2,
  "module-availability": Layers,
  "print-settings": Printer,
} satisfies Record<MasterDataId, typeof Package>;

export default async function DataMasterDirectoryPage() {
  const ctx = await requireAuth();
  const entries = visibleMasterDataEntries(ctx);
  const sections = MASTER_DATA_SECTIONS
    .map((section) => ({
      section,
      entries: entries.filter((entry) => entry.section === section),
    }))
    .filter((group) => group.entries.length > 0);

  return (
    <main className="theme-erp min-h-dvh bg-background">
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 lg:py-8">
        <PageHeader
          eyebrow="Indeks lintas modul"
          title="Data Master"
          description="Temukan pemilik data master, referensi, dan pengaturan inti. Setiap data tetap dikelola pada satu layar pemiliknya."
        />

        {sections.length === 0 ? (
          <EmptyState
            title="Belum ada data yang dapat diakses"
            description="Minta admin memberikan izin melihat data master yang diperlukan untuk pekerjaan Anda."
          />
        ) : (
          <div className="space-y-5">
            {sections.map((group) => (
              <section key={group.section} aria-labelledby={`master-${group.section}`}>
                <h2 id={`master-${group.section}`} className="text-sm font-semibold text-foreground">
                  {group.section}
                </h2>
                <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
                  {group.entries.map((entry, index) => {
                    const Icon = iconById[entry.id as keyof typeof iconById];
                    return (
                      <div
                        key={entry.id}
                        className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${
                          index > 0 ? "border-t border-border" : ""
                        }`}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
                          <Icon aria-hidden="true" className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[13px] font-semibold">{entry.title}</h3>
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            {entry.description}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:w-[250px] sm:shrink-0">
                          <span className="text-muted-foreground">Pengelola</span>
                          <span className="min-w-0 break-words font-medium leading-4">{entry.owner}</span>
                          <span className="text-muted-foreground">Dipakai oleh</span>
                          <span className="min-w-0 break-words leading-4">{entry.usedBy}</span>
                        </div>
                        <Link
                          href={entry.href}
                          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {entry.canManage ? "Kelola" : "Lihat"}
                          <ArrowRight aria-hidden="true" className="size-3.5" />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
