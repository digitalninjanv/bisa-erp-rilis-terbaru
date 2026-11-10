import { ModuleShell } from "@/components/shell/module-shell";
import { QuickEntryHost } from "@/components/akuntansi/quick-entry-modal";
import { requireModuleAccess } from "@/lib/session";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AkuntansiLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModuleAccess("akuntansi");
  return (
    <ModuleShell moduleKey="akuntansi" ctx={ctx}>
      {children}
      {/* A-12 (D-23): host modal Catat Transaksi + pintasan N untuk
          seluruh halaman modul Akuntansi; hanya untuk pemegang izin
          posting. */}
      <QuickEntryHost enabled={can(ctx, "accounting.post")} />
    </ModuleShell>
  );
}
