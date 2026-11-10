import { ModuleShell } from "@/components/shell/module-shell";
import { requireModuleAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function GudangLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModuleAccess("gudang");
  return (
    <ModuleShell moduleKey="gudang" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
