import { describe, expect, it } from "vitest";
import {
  MASTER_DATA_ENTRIES,
  MASTER_DATA_SECTIONS,
  hasMasterDataDirectoryAccess,
  visibleMasterDataEntries,
  type MasterDataAccess,
} from "@/lib/master-data-directory";

function access(
  permissions: string[],
  modules: MasterDataAccess["modules"] = ["pos", "gudang", "akuntansi", "hr"],
  enabledModules: MasterDataAccess["enabledModules"] = modules,
): MasterDataAccess {
  return { permissions, modules, enabledModules };
}

describe("master data directory visibility", () => {
  it("keeps every owner record unique and assigned to a canonical section", () => {
    const ids = MASTER_DATA_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MASTER_DATA_ENTRIES.every((entry) => MASTER_DATA_SECTIONS.includes(entry.section))).toBe(true);
  });

  it("only shows canonical inventory owners when the warehouse module is available", () => {
    const entries = visibleMasterDataEntries(access(["inventory.view"]));
    expect(entries.map((entry) => entry.id)).toEqual(["products", "suppliers", "customers"]);
    expect(entries.every((entry) => !entry.canManage)).toBe(true);
    expect(entries.find((entry) => entry.id === "suppliers")?.href).toBe(
      "/app/gudang/pemasok?tab=pemasok",
    );
    expect(entries.find((entry) => entry.id === "customers")?.href).toBe(
      "/app/gudang/pemasok?tab=pelanggan",
    );

    expect(
      visibleMasterDataEntries(access(["inventory.view"], ["gudang"], [])),
    ).toEqual([]);
  });

  it("routes supplier and customer managers to their own tab", () => {
    const entries = visibleMasterDataEntries(access(["inventory.view", "inventory.manage"]));
    expect(entries.find((entry) => entry.id === "suppliers")).toMatchObject({
      canManage: true,
      href: "/app/gudang/pemasok?tab=pemasok",
    });
    expect(entries.find((entry) => entry.id === "customers")).toMatchObject({
      canManage: true,
      href: "/app/gudang/pemasok?tab=pelanggan",
    });
  });

  it("shows customer groups read-only to POS users and routes managers to the owner screen", () => {
    const cashier = visibleMasterDataEntries(access(["pos.sell"]));
    const customerGroups = cashier.find((entry) => entry.id === "customer-groups");
    expect(customerGroups).toMatchObject({ canManage: false, href: "/app/pos/grup" });

    const admin = visibleMasterDataEntries(access(["pos.sell", "settings.manage"]));
    expect(admin.find((entry) => entry.id === "customer-groups")).toMatchObject({
      canManage: true,
      href: "/app/pengaturan?tab=grup",
    });

    const settingsOnly = visibleMasterDataEntries(access(["settings.manage"], [], []));
    expect(settingsOnly.find((entry) => entry.id === "customer-groups")).toMatchObject({
      canManage: true,
      href: "/app/pengaturan?tab=grup",
    });
  });

  it("indexes general policies, print settings, and module availability for settings managers", () => {
    const settings = visibleMasterDataEntries(access(["settings.manage"], [], []));
    expect(settings.find((entry) => entry.id === "company-policies")?.href).toBe(
      "/app/pengaturan?tab=umum",
    );
    expect(settings.find((entry) => entry.id === "print-settings")?.href).toBe(
      "/app/pengaturan?tab=cetak",
    );
    expect(settings.find((entry) => entry.id === "module-availability")?.href).toBe(
      "/app/pengaturan?tab=modul",
    );
    expect(settings.find((entry) => entry.id === "locations")?.description).toContain("alasan penyesuaian");
  });

  it("keeps data onboarding separate from the master catalog", () => {
    const imports = visibleMasterDataEntries(access(["import.manage"])).find(
      (entry) => entry.id === "imports",
    );
    expect(imports).toMatchObject({
      section: "Impor & saldo awal",
      owner: "Gudang · lintas modul",
      href: "/app/gudang/impor",
    });
  });

  it("routes HR and accounting reference data to their canonical owner screens", () => {
    const entries = visibleMasterDataEntries(
      access(["payroll.view", "accounting.view"], ["hr", "akuntansi"]),
    );
    expect(entries.map((entry) => entry.id)).toContain("hr-organization");
    expect(entries.map((entry) => entry.id)).toContain("work-shifts");
    expect(entries.map((entry) => entry.id)).toContain("leave-types");
    expect(entries.find((entry) => entry.id === "fixed-asset-categories")).toMatchObject({
      canManage: false,
      href: "/app/akuntansi/aset",
    });
    expect(entries.find((entry) => entry.id === "fiscal-periods")).toMatchObject({
      canManage: false,
      href: "/app/akuntansi/periode",
    });

    const hrManager = visibleMasterDataEntries(access(["payroll.view", "payroll.manage"], ["hr"]));
    expect(hrManager.find((entry) => entry.id === "hr-organization")).toMatchObject({
      canManage: true,
      href: "/app/akuntansi/hr/pengaturan",
    });

    const accountingManager = visibleMasterDataEntries(
      access(["accounting.view", "accounting.manage"], ["akuntansi"]),
    );
    expect(accountingManager.find((entry) => entry.id === "fiscal-periods")).toMatchObject({
      canManage: true,
      href: "/app/akuntansi/periode",
    });
  });

  it("keeps platform configuration links behind settings permission", () => {
    const noSettings = visibleMasterDataEntries(access(["inventory.view", "accounting.view"]));
    expect(noSettings.map((entry) => entry.id)).not.toContain("document-numbering");
    expect(noSettings.map((entry) => entry.id)).not.toContain("custom-fields");

    const settings = visibleMasterDataEntries(access(["settings.manage"]));
    expect(settings.find((entry) => entry.id === "document-numbering")?.href).toBe(
      "/app/pengaturan?tab=nomor",
    );
    expect(settings.find((entry) => entry.id === "custom-fields")?.href).toBe(
      "/app/pengaturan?tab=kolom",
    );
  });

  it("does not expose entries without their view permission", () => {
    expect(visibleMasterDataEntries(access([]))).toEqual([]);
    expect(hasMasterDataDirectoryAccess(access([]))).toBe(false);
    expect(hasMasterDataDirectoryAccess(access(["accounting.view"]))).toBe(true);
  });
});
