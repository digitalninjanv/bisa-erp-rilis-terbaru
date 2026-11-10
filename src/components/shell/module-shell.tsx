import Link from "next/link";
import { cookies } from "next/headers";
import { Settings } from "lucide-react";
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
import { buildPalettePages } from "@/lib/palette";
import { MODULES, MODULE_LIST, type ModuleKey } from "@/lib/modules";
import { initials, todayISO } from "@/lib/format";
import { withCompanyReadOnly } from "@/db/tenant";
import { listPurchaseRequests } from "@/server/purchase-requests";
import { countHeldSales } from "@/server/pos";
import { listOfflineReviewQueue } from "@/server/pos-offline";
import { getOpnameReminders } from "@/server/inventory";
import { countPendingReimbursementClaims } from "@/server/reimbursements";
import { listLeaveRequests, listOvertimeRequests } from "@/server/hr";
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
async function computeNavBadges(
  moduleKey: ModuleKey,
  ctx: CompanyContext,
): Promise<NavBadges | undefined> {
  try {
    return await withCompanyReadOnly(ctx.company.id, async (tx) => {
      const badges: NavBadges = {};
      if (moduleKey === "gudang" && ctx.permissions.includes("inventory.view")) {
        const requests = await listPurchaseRequests(tx, ctx.company.id);
        const pending = requests.filter((row) => row.status === "submitted").length;
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
          listOfflineReviewQueue(tx, ctx.company.id),
        ]);
        if (held > 0) {
          badges["/app/pos/ditahan"] = { count: held, tone: "amber" };
        }
        if (reviewQueue.length > 0) {
          badges["/app/pos/offline"] = { count: reviewQueue.length, tone: "red" };
        }
      }
      if (moduleKey === "hr" && ctx.permissions.includes("payroll.view")) {
        const [claims, leaves, overtimes] = await Promise.all([
          countPendingReimbursementClaims(tx, ctx.company.id),
          listLeaveRequests(tx, ctx.company.id),
          listOvertimeRequests(tx, ctx.company.id, { start: "2000-01-01", end: "2100-12-31" }),
        ]);
        const pendingTotal =
          claims.count +
          leaves.filter((row) => row.status === "pending").length +
          overtimes.filter((row) => row.status === "pending").length;
        if (pendingTotal > 0) {
          badges["/app/akuntansi/hr/persetujuan"] = { count: pendingTotal, tone: "red" };
        }
      }
      return badges;
    });
  } catch {
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
          <Link href="/app" className="block truncate text-[13px] font-semibold text-shell-title">
            {ctx.company.name}
          </Link>
          <p className="truncate text-[11px] text-shell-muted">Bisa ERP</p>
        </div>
      </div>
      <div className="pt-3">
        <AppSwitcher
          activeKey={activeKey}
          allowedKeys={allowedKeys}
          showSettings={ctx.permissions.includes("settings.manage")}
          settingsActive={settingsActive}
        />
      </div>
    </div>
  );
}

/**
 * A-25 U1 — kaki sidebar bertema (ARAH-DESAIN-A25 §2.5): kartu
 * pengguna (avatar inisial, nama, peran) + pintasan Pengaturan.
 * Menggantikan tautan "Beranda modul" di modul bertema — beranda
 * modul dicapai dari pengalih aplikasi & logo.
 */
export function SidebarUserCard({ ctx }: { ctx: CompanyContext }) {
  const showSettings = ctx.permissions.includes("settings.manage");
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
        {showSettings ? (
          <Link
            href="/app/pengaturan"
            aria-label="Pengaturan"
            className="grid size-8 shrink-0 place-items-center rounded-md text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-hover-foreground"
          >
            <Settings className="size-4" />
          </Link>
        ) : null}
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
            <MobileNav moduleKey={moduleKey} permissions={ctx.permissions} badges={badges} />
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
