import { ModuleShell } from "@/components/shell/module-shell";
import { requireModuleAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AnalisaLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModuleAccess("analisa");
  return (
    <ModuleShell moduleKey="analisa" ctx={ctx}>
      {children}
    </ModuleShell>
  );
}
