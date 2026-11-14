import { describe, expect, it } from "vitest";
import type { Tx } from "@/db";
import { resolveHomeDashboardScope } from "@/lib/home-dashboard-scope";
import { getHomeSummary } from "@/server/reports/home";

describe("home dashboard data scope", () => {
  it("does not query financial or inventory data for a user without those grants", async () => {
    const tx = new Proxy(
      {},
      {
        get() {
          throw new Error("Dashboard queried data outside the user's permission scope");
        },
      },
    ) as Tx;

    const summary = await getHomeSummary(tx, "company-id", "2026-11-14", {
      sales: false,
      inventoryValue: false,
      lowStock: false,
      openSession: false,
      cashBank: false,
    });

    expect(summary).toEqual({
      todaySales: 0,
      todayTransactions: 0,
      monthSales: 0,
      monthTransactions: 0,
      inventoryValue: 0,
      lowStockCount: 0,
      openSession: null,
      cashBalance: 0,
    });
  });

  it("limits each summary to the module grants and sensitive permissions", () => {
    expect(
      resolveHomeDashboardScope({
        canSeePosSales: false,
        canSeeInventory: false,
        canSeeInventoryCost: false,
        canSeeAccounting: false,
        canSeePosSession: false,
      }),
    ).toEqual({
      sales: false,
      inventoryValue: false,
      lowStock: false,
      openSession: false,
      cashBank: false,
    });

    expect(
      resolveHomeDashboardScope({
        canSeePosSales: false,
        canSeeInventory: true,
        canSeeInventoryCost: false,
        canSeeAccounting: false,
        canSeePosSession: false,
      }),
    ).toEqual({
      sales: false,
      inventoryValue: false,
      lowStock: true,
      openSession: false,
      cashBank: false,
    });

    expect(
      resolveHomeDashboardScope({
        canSeePosSales: true,
        canSeeInventory: true,
        canSeeInventoryCost: true,
        canSeeAccounting: true,
        canSeePosSession: true,
      }),
    ).toEqual({
      sales: true,
      inventoryValue: true,
      lowStock: true,
      openSession: true,
      cashBank: true,
    });
  });
});
