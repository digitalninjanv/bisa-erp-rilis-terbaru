import { describe, expect, it } from "vitest";
import { resolveMembership } from "@/lib/company-selection";

// LINTAS-01: memberships arrive ordered by member.createdAt ascending
// (earliest first). The cookie may only *choose among* the user's own
// memberships — anything else falls back to the earliest membership,
// which is exactly the pre-LINTAS-01 behaviour.
const memberships = [
  { companyId: "org-pertama", role: "owner" },
  { companyId: "org-kedua", role: "admin" },
  { companyId: "org-ketiga", role: "viewer" },
];

describe("resolveMembership (LINTAS-01)", () => {
  it("memilih perusahaan kedua bila cookie menunjuk membership yang sah", () => {
    expect(resolveMembership(memberships, "org-kedua")?.companyId).toBe("org-kedua");
    expect(resolveMembership(memberships, "org-ketiga")?.companyId).toBe("org-ketiga");
  });

  it("mengabaikan cookie perusahaan asing (bukan anggota) ke membership terawal", () => {
    expect(resolveMembership(memberships, "org-perusahaan-lain")?.companyId).toBe("org-pertama");
  });

  it("tanpa cookie memakai membership terawal (perilaku lama)", () => {
    expect(resolveMembership(memberships, null)?.companyId).toBe("org-pertama");
    expect(resolveMembership(memberships, undefined)?.companyId).toBe("org-pertama");
    expect(resolveMembership(memberships, "")?.companyId).toBe("org-pertama");
  });

  it("daftar kosong menghasilkan undefined", () => {
    expect(resolveMembership([], "org-kedua")).toBeUndefined();
    expect(resolveMembership([], null)).toBeUndefined();
  });
});
