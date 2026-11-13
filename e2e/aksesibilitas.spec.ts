import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Sesi demo berasal dari storageState (lihat auth.setup.ts).

// Audit WCAG 2.0/2.1 A & AA (tag wcag2a/wcag2aa) pada rute utama.
// Gerbang: 0 pelanggaran berdampak critical atau serious.
// Pelanggaran minor/moderate dilaporkan apa adanya di output test.
const ROUTES: { path: string; label: string }[] = [
  { path: "/app", label: "Beranda" },
  { path: "/app/pos", label: "Terminal POS" },
  { path: "/app/gudang/produk", label: "Daftar produk Gudang" },
  { path: "/app/akuntansi/laporan", label: "Laporan Akuntansi" },
  { path: "/app/pengaturan", label: "Pengaturan" },
];

test.describe("Aksesibilitas (axe WCAG 2 A/AA)", () => {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path}) — 0 critical/serious`, async ({ page }) => {
      await page.goto(route.path);
      // Halaman laporan tidak pernah mencapai networkidle (streaming RSC),
      // jadi kesiapan ditandai konten utama yang benar-benar tampil.
      await expect(page.locator("h1, h2").first()).toBeVisible();
      await page.waitForTimeout(500);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      const byImpact = (impacts: string[]) =>
        results.violations.filter((v) => impacts.includes(v.impact ?? ""));
      const blocking = byImpact(["critical", "serious"]);
      const others = byImpact(["moderate", "minor"]);

      console.log(
        `[axe] ${route.path}: total=${results.violations.length} ` +
          `critical=${byImpact(["critical"]).length} serious=${byImpact(["serious"]).length} ` +
          `moderate=${byImpact(["moderate"]).length} minor=${byImpact(["minor"]).length}`,
      );
      for (const v of results.violations) {
        console.log(
          `[axe] ${route.path} ${v.impact ?? "?"} ${v.id}: ${v.help} (${v.nodes.length} node)`,
        );
      }
      if (others.length > 0) {
        console.log(`[axe] ${route.path}: ${others.length} pelanggaran minor/moderate (tidak memblokir).`);
      }

      expect(
        blocking.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} node)`),
      ).toEqual([]);
    });
  }
});

test.describe("Aksesibilitas POS mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("menu terminal tetap memiliki nama saat teks disembunyikan", async ({ page }) => {
    await page.goto("/app/pos");
    await expect(page.getByRole("button", { name: "Menu terminal POS", exact: true })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(result.violations.filter(v => v.impact === "critical" || v.impact === "serious").map(v => v.id)).toEqual([]);
  });
});
