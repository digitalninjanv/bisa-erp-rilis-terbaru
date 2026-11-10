import { ALL_MODULE_KEYS, MODULES, type ModuleKey } from "@/lib/modules";
import type { Permission } from "@/lib/permissions";

/**
 * A-23 SIS-06/SIS-04 — role-aware landing & denial targets (research
 * pattern S1). Pure decisions shared by the Beranda page and the
 * page-level permission guard so the two can never disagree:
 *
 * - A module is reachable only when the role grants it AND the company
 *   switch has it on (the same intersection `requireModuleAccess`
 *   enforces per module).
 * - A user with exactly ONE reachable module lands directly in it
 *   after login instead of crossing the shared Beranda.
 * - A page-level permission denial bounces to a surface the user can
 *   actually open — their single module's home when its own guard
 *   would let them in, otherwise the shared Beranda — carrying
 *   `?forbidden=<permission>` so the landing renders the explanation
 *   banner instead of a crash page.
 */

/**
 * The permission each module home page itself requires (verified at
 * the call sites: pos/page.tsx, gudang/page.tsx, akuntansi/page.tsx).
 * A denial may only bounce into a module home whose own guard passes.
 */
export const MODULE_HOME_PERMISSION: Record<ModuleKey, Permission> = {
  pos: "pos.sell",
  gudang: "inventory.view",
  akuntansi: "accounting.view",
  // Beranda modul HR adalah ringkasan /app/akuntansi/hr — penjaga
  // halamannya sendiri juga payroll.view.
  hr: "payroll.view",
  analisa: "analytics.view",
};

export type LandingAccess = {
  permissions: readonly Permission[];
  modules: readonly ModuleKey[];
  enabledModules: readonly ModuleKey[];
};

export function accessibleModules(
  roleModules: readonly ModuleKey[],
  enabledModules: readonly ModuleKey[],
): ModuleKey[] {
  return ALL_MODULE_KEYS.filter(
    (key) => roleModules.includes(key) && enabledModules.includes(key),
  );
}

export function singleModuleLanding(
  roleModules: readonly ModuleKey[],
  enabledModules: readonly ModuleKey[],
): ModuleKey | null {
  const accessible = accessibleModules(roleModules, enabledModules);
  return accessible.length === 1 ? accessible[0] : null;
}

export function denialRedirectPath(access: LandingAccess, denied: Permission): string {
  const single = singleModuleLanding(access.modules, access.enabledModules);
  if (single && access.permissions.includes(MODULE_HOME_PERMISSION[single])) {
    return `${MODULES[single].href}?forbidden=${denied}`;
  }
  return `/app?forbidden=${denied}`;
}
