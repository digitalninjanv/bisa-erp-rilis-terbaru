import { ModuleShell } from "@/components/shell/module-shell";
import { requireModuleAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModuleAccess("pos");
  return (
    <ModuleShell moduleKey="pos" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
