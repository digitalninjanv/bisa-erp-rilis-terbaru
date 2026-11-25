import Link from "next/link";
import { cookies } from "next/headers";
import { CompanySwitcher } from "@/components/shell/company-switcher";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarFrame } from "@/components/shell/sidebar-frame";
import { SidebarNav, type NavBadges } from "@/components/shell/sidebar-nav";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  parseSidebarCollapsedCookie,
} from "@/lib/sidebar-pref";
import { AppSwitcher } from "@/components/shell/app-switcher";
import { UserMenu } from "@/components/shell/user-menu";
import { CommandPalette } from "@/components/shell/command-palette";
import { NavMetrics } from "@/components/shell/nav-metrics";
import { Database } from "lucide-react";
import { buildPalettePages } from "@/lib/palette";
import { hasMasterDataDirectoryAccess } from "@/lib/master-data-directory";
import { MODULES, MODULE_LIST, type ModuleKey } from "@/lib/modules";
import { initials, todayISO } from "@/lib/format";
import { withCompanyReadOnly } from "@/db/tenant";
import { countPurchaseRequestsByStatus } from "@/server/purchase-requests";
import { countHeldSales } from "@/server/pos";
import { getOfflineReviewQueueSummary } from "@/server/pos-offline";
import { getOpnameReminders } from "@/server/inventory";
import { countPendingReimbursementClaims } from "@/server/reimbursements";
import { countPendingLeaveRequests, countPendingOvertimeRequests } from "@/server/hr";
import type { CompanyContext } from "@/lib/session";

/**
 * A-25 U1 — lencana antrean sidebar, dihitung dari fungsi baca modul
 * pemilik yang SUDAH ada dan sudah dipakai kartu antrean beranda
 * (bukan kueri baru yang diciptakan untuk cangkang):
 * - Gudang "Permintaan Pembelian": PR berstatus submitted menunggu
 *   keputusan (`listPurchaseRequests`, disaring di memori);
 * - Gudang "Stok opname": cakupan opname jatuh tempo
 *   (`getOpnameReminders` — fungsi pengingat dashboard gudang);
 * - HR "Persetujuan": antrean GABUNGAN menunggu keputusan sejak
 *   A-25 U5 — klaim submitted (`countPendingReimbursementClaims`),
 *   cuti pending (`listLeaveRequests`), lembur pending
 *   (`listOvertimeRequests` rentang lebar: yang menunggu bisa
 *   bertanggal kapan pun). Lencana tunggal menunjuk halaman
 *   Persetujuan, menggantikan lencana khusus klaim dari U1.
 * - POS (sejak A-25 U8, pembekuan dicabut pengguna): "Pesanan
 *   ditahan" dari `countHeldSales` (fungsi yang sama dengan hitungan
 *   di halaman kasir) dan "Peninjauan offline" dari panjang
 *   `listOfflineReviewQueue` (fungsi baca halaman peninjauan itu
 *   sendiri) — tidak ada kueri baru yang diciptakan untuk cangkang.
 * Kegagalan baca tidak pernah merusak cangkang: lencana hilang,
 * halaman tetap tampil.
 */
const NAV_BADGE_TTL_MS = 15_000;
const navBadgeCache = new Map<string, { expiresAt: number; value: NavBadges | undefined }>();

async function computeNavBadges(
  moduleKey: ModuleKey,
  ctx: CompanyContext,
): Promise<NavBadges | undefined> {
  const cacheKey = `${moduleKey}:${ctx.company.id}:${ctx.permissions.join(",")}`;
  const cached = navBadgeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const value = await withCompanyReadOnly(ctx.company.id, async (tx) => {
      const badges: NavBadges = {};
      if (moduleKey === "gudang" && ctx.permissions.includes("inventory.view")) {
        const requestsByStatus = await countPurchaseRequestsByStatus(tx, ctx.company.id);
        const pending = requestsByStatus.submitted ?? 0;
        if (pending > 0) {
          badges["/app/gudang/purchase-request"] = { count: pending, tone: "red" };
        }
        const reminders = await getOpnameReminders(tx, ctx.company.id, todayISO());
        if (reminders.length > 0) {
          badges["/app/gudang/opname"] = { count: reminders.length, tone: "amber" };
        }
      }
      if (moduleKey === "pos" && ctx.permissions.includes("pos.sell")) {
        const [held, reviewQueue] = await Promise.all([
          countHeldSales(tx, ctx.company.id),
          getOfflineReviewQueueSummary(tx, ctx.company.id),
        ]);
        if (held > 0) {
          badges["/app/pos/ditahan"] = { count: held, tone: "amber" };
        }
        if (reviewQueue.total > 0) {
          badges["/app/pos/offline"] = { count: reviewQueue.total, tone: "red" };
        }
      }
      if (moduleKey === "hr" && ctx.permissions.includes("payroll.view")) {
        const [claims, pendingLeaves, pendingOvertimes] = await Promise.all([
          countPendingReimbursementClaims(tx, ctx.company.id),
          countPendingLeaveRequests(tx, ctx.company.id),
          countPendingOvertimeRequests(tx, ctx.company.id),
        ]);
        const pendingTotal = claims.count + pendingLeaves + pendingOvertimes;
        if (pendingTotal > 0) {
          badges["/app/akuntansi/hr/persetujuan"] = { count: pendingTotal, tone: "red" };
        }
      }
      return badges;
    });
    navBadgeCache.set(cacheKey, { expiresAt: Date.now() + NAV_BADGE_TTL_MS, value });
    return value;
  } catch {
    navBadgeCache.set(cacheKey, { expiresAt: Date.now() + NAV_BADGE_TTL_MS, value: undefined });
    return undefined;
  }
}

/**
 * A-25 U1 — kepala sidebar bertema (ARAH-DESAIN-A25 §2.5): blok
 * perusahaan (logo "b" dalam kotak primer + nama perusahaan) dan
 * pengalih aplikasi lebar di bawahnya. Dipakai ModuleShell modul
 * bertema dan SettingsShell.
 */
export function ThemedSidebarHead({
  ctx,
  activeKey,
  settingsActive = false,
}: {
  ctx: CompanyContext;
  activeKey: ModuleKey | null;
  settingsActive?: boolean;
}) {
  const allowedKeys = MODULE_LIST.filter(
    (item) => ctx.modules.includes(item.key) && ctx.enabledModules.includes(item.key),
  ).map((item) => item.key);
  return (
    <div className="sb-head px-3 pb-1 pt-4">
      <div className="sb-head-row flex items-center gap-2.5 px-1">
        <Link
          href="/app"
          className="grid size-8 shrink-0 place-items-center rounded-md bg-shell-logo text-sm font-bold text-shell-logo-foreground"
          aria-label="Beranda"
          title="Beranda"
        >
          b
        </Link>
        <div className="sb-head-text min-w-0 leading-tight">
          <p className="block truncate text-[13px] font-semibold text-shell-title">{ctx.company.name}</p>
          <p className="truncate text-[11px] text-shell-muted">Bisa ERP</p>
        </div>
      </div>
      <div className="pt-3">
        <AppSwitcher
          activeKey={activeKey}
          allowedKeys={allowedKeys}
          showMasterData={hasMasterDataDirectoryAccess(ctx)}
          settingsActive={settingsActive}
        />
      </div>
    </div>
  );
}

/**
 * Kartu identitas pengguna di kaki sidebar. Pengaturan berada di
 * menu pengguna pada topbar agar tidak ada beberapa pintasan ke tujuan sama.
 */
export function SidebarUserCard({ ctx }: { ctx: CompanyContext }) {
  return (
    <div className="sb-user-card border-t border-sidebar-border p-3">
      <div className="sb-user-row flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {initials(ctx.user.name)}
        </span>
        <div className="sb-user-text min-w-0 flex-1 leading-tight">
          <p className="truncate text-[12px] font-medium text-shell-title">{ctx.user.name}</p>
          <p className="truncate text-[11px] text-shell-muted">{ctx.roleName}</p>
        </div>
      </div>
    </div>
  );
}

export async function ModuleShell({
  moduleKey,
  ctx,
  children,
}: {
  moduleKey: ModuleKey;
  ctx: CompanyContext;
  children: React.ReactNode;
}) {
  const activeModule = MODULES[moduleKey];
  const allowedKeys = MODULE_LIST.filter(
    (item) => ctx.modules.includes(item.key) && ctx.enabledModules.includes(item.key),
  ).map((item) => item.key);

  // A-25 U0/U1 meletakkan tema baru berlingkup kelas di semua modul
  // KECUALI pos (keputusan Pemimpin RENCANA A-25 butir 1). A-25 U8:
  // pengguna mencabut pembekuan POS — cangkang POS kini markup &
  // tema yang sama persis dengan modul lain (sidebar terang,
  // pengalih aplikasi, kartu pengguna, topbar ringkas). Markup
  // cangkang lama POS (sidebar gelap + segmented control + tautan
  // "Beranda modul") dibuang; tidak ada pemanggil lain yang tersisa.
  const badges = await computeNavBadges(moduleKey, ctx);

  // Validasi 2 (V-01): preferensi ciut sidebar dari cookie — dibaca
  // server agar lebar & mode benar sejak HTML pertama.
  const sidebarCookie = (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE);

  return (
    <div className="module-shell theme-erp min-h-dvh bg-background lg:flex">
      {moduleKey === "pos" ? <NavMetrics moduleKey={moduleKey} /> : null}
      <SidebarFrame
        defaultCollapsed={parseSidebarCollapsedCookie(sidebarCookie?.value)}
        hasPreference={sidebarCookie !== undefined}
        rail={activeModule.nav.some((item) => item.group !== undefined)}
        footer={<SidebarUserCard ctx={ctx} />}
      >
        <ThemedSidebarHead ctx={ctx} activeKey={moduleKey} />

        <SidebarNav
          moduleKey={moduleKey}
          permissions={ctx.permissions}
          badges={badges}
          rail={activeModule.nav.some((item) => item.group !== undefined)}
        />
      </SidebarFrame>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="module-topbar no-print sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b border-border bg-card/95 px-3 backdrop-blur sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <MobileNav moduleKey={moduleKey} permissions={ctx.permissions} badges={badges} allowedKeys={allowedKeys} />
            <div className="hidden h-4 w-px bg-border lg:block" />
            {/* A-25 U1 (POLA-16): breadcrumb dua tingkat yang statis
                diganti judul konteks ringkas — nama modul saja;
                posisi halaman diberikan judul halaman & sidebar. */}
            <span className="truncate text-xs font-medium">{activeModule.name}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* A-24 T1 (SIS-12): palet perintah — indeks halaman
                dihitung dari nav tersaring peran perusahaan ini. */}
            <CommandPalette
              pages={buildPalettePages({
                permissions: ctx.permissions,
                modules: ctx.modules,
                enabledModules: ctx.enabledModules,
              })}
            />
            <CompanySwitcher companies={ctx.companies} activeId={ctx.company.id} />
            <UserMenu
              name={ctx.user.name}
              email={ctx.user.email}
              role={ctx.roleName}
              showSettings={ctx.permissions.includes("settings.manage")}
            />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6">{children}</main>
      </div>
    </div>
  );
}

export function HomeTopbar({ ctx }: { ctx: CompanyContext }) {
  const showMasterData = hasMasterDataDirectoryAccess(ctx);
  return (
    <header className="module-topbar no-print sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-[56px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="grid size-8 place-items-center rounded-md bg-[#2c1e28] text-sm font-bold text-white"
          >
            b
          </Link>
          <div>
            <p className="text-[13px] font-semibold leading-tight">Bisa ERP</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Minimarket suite
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showMasterData ? (
            <Link
              href="/app/data-master"
              aria-label="Data Master"
              title="Data Master"
              className="grid size-8 place-items-center rounded-md border border-border bg-card text-[12px] font-medium transition-colors hover:bg-muted sm:flex sm:h-8 sm:w-auto sm:items-center sm:gap-1.5 sm:px-2.5"
            >
              <Database aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">Data Master</span>
            </Link>
          ) : null}
          <CommandPalette
            pages={buildPalettePages({
              permissions: ctx.permissions,
              modules: ctx.modules,
              enabledModules: ctx.enabledModules,
            })}
          />
          <CompanySwitcher companies={ctx.companies} activeId={ctx.company.id} />
          <UserMenu
              name={ctx.user.name}
              email={ctx.user.email}
              role={ctx.roleName}
              showSettings={ctx.permissions.includes("settings.manage")}
            />
        </div>
      </div>
    </header>
  );
}
