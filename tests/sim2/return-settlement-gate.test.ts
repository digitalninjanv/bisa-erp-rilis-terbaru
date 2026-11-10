import { describe, expect, it, vi } from "vitest";

/**
 * SIM-2 Fase S6 (SEC-10): helper izin penyelesaian retur pembelian
 * kini menghormati saklar modul perusahaan (D-16) — sebelumnya ia
 * memeriksa izin saja, tidak seperti aksi tulis modul lain yang
 * melewati requirePermissionInModule. Izin ganda dipertahankan:
 * accounting.post berlaku hanya bila modul akuntansi aktif,
 * inventory.manage hanya bila modul gudang aktif.
 */

const sessionState = vi.hoisted(() => ({
  role: "owner" as string,
  enabledModules: ["pos", "gudang", "akuntansi"] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const perms = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  const buildCtx = () => ({
    company: { id: "01900000-0000-7000-8000-00000000cc12" },
    user: { id: "01900000-0000-7000-8000-00000000cc22" },
    role: sessionState.role,
    permissions: perms.permissionsFor(sessionState.role),
    modules: perms.modulesFor(sessionState.role),
    enabledModules: sessionState.enabledModules,
  });
  const requireAuth = async () => buildCtx();
  const requirePermission = async (permission: never) => {
    const ctx = buildCtx();
    perms.assertCan(ctx, permission);
    return ctx;
  };
  return { requireAuth, requirePermission, requirePermissionInModule: requirePermission };
});

import { applySupplierCreditAction } from "@/server/actions/supplier-returns";

const FAKE_RETURN = "01900000-0000-7000-8000-00000000dead";

function attempt() {
  return applySupplierCreditAction({ returnId: FAKE_RETURN, amount: "1000" });
}

describe("SEC-10 — gerbang penyelesaian retur menghormati saklar modul", () => {
  it("kedua modul mati: owner pun ditolak FORBIDDEN", async () => {
    sessionState.role = "owner";
    sessionState.enabledModules = ["pos"];
    const result = await attempt();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("hanya gudang aktif: jalur inventory.manage lolos gerbang (gagal NOT_FOUND di domain)", async () => {
    sessionState.role = "owner";
    sessionState.enabledModules = ["gudang"];
    const result = await attempt();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("hanya akuntansi aktif: jalur accounting.post lolos gerbang", async () => {
    sessionState.role = "owner";
    sessionState.enabledModules = ["akuntansi"];
    const result = await attempt();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("akuntan (accounting.post) ditolak bila modul akuntansi dimatikan walau gudang aktif", async () => {
    sessionState.role = "accountant";
    sessionState.enabledModules = ["gudang"];
    const result = await attempt();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("staf gudang (inventory.manage) ditolak bila modul gudang dimatikan walau akuntansi aktif", async () => {
    sessionState.role = "warehouse";
    sessionState.enabledModules = ["akuntansi"];
    const result = await attempt();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("viewer tanpa izin apa pun tetap ditolak walau semua modul aktif", async () => {
    sessionState.role = "viewer";
    sessionState.enabledModules = ["pos", "gudang", "akuntansi"];
    const result = await attempt();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});
