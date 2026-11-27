import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3000";
const SESSION_COOKIE = process.env.AUDIT_SESSION_COOKIE ?? "xQ6RsUbS7mfIWfD8rq2UqNOX9ah6lbbn.kn1MM8yVFKi26brgnNUqGoXquVdkPvNcMurQ7W3lpxk%3D";
const OUT = "audit/checks/system-ux";
mkdirSync(OUT, { recursive: true });

const pages = [
  ["beranda", "/app"],
  ["pos", "/app/pos"],
  ["pos-riwayat", "/app/pos/riwayat"],
  ["gudang", "/app/gudang"],
  ["produk", "/app/gudang/produk"],
  ["penerimaan", "/app/gudang/penerimaan"],
  ["pembelian", "/app/gudang/pembelian"],
  ["akuntansi", "/app/akuntansi"],
  ["jurnal", "/app/akuntansi/jurnal"],
  ["buku-besar", "/app/akuntansi/buku-besar"],
  ["laporan", "/app/akuntansi/laporan"],
  ["payroll", "/app/akuntansi/payroll"],
  ["analisa", "/app/analisa"],
  ["pengaturan", "/app/pengaturan"],
  ["pengguna", "/app/pengaturan/pengguna"],
];

const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

const browser = await chromium.launch();
const results = [];
const consoleErrors = [];

async function login(context) {
  const host = new URL(BASE).hostname;
  await context.addCookies([{
    name: "better-auth.session_token",
    value: SESSION_COOKIE,
    domain: host,
    path: "/",
    httpOnly: true,
    expires: 1796343121,
  }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill("owner@bisa.id");
    await page.getByLabel("Kata sandi").fill("Bisa12345!");
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(/\/app/, { timeout: 30000 });
  }
  await page.close();
}

for (const [viewportName, viewport] of viewports) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  await login(context);
  for (const [name, path] of pages) {
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 240));
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`.slice(0, 240)));
    let status = 0;
    try {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
      status = response?.status() ?? 0;
      await page.waitForTimeout(600);
    } catch (error) {
      errors.push(`goto: ${String(error).slice(0, 200)}`);
    }

    const metrics = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const interactive = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")].filter(visible);
      const smallTargets = interactive.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      });
      const smallText = [...document.querySelectorAll("p, span, small, div, label, td, th, li, a, button")].filter((element) => {
        if (!visible(element)) return false;
        if (element.children.length > 0) return false;
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        return size > 0 && size < 11 && (element.textContent ?? "").trim().length > 0;
      });
      const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((element) => {
        if (!visible(element)) return false;
        const id = element.getAttribute("id");
        const hasLabel = id ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : false;
        return !hasLabel && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby") && !element.getAttribute("placeholder");
      });
      const headings = [...document.querySelectorAll("h1, h2")].filter(visible).map((element) => element.textContent?.trim()).filter(Boolean);
      return {
        title: document.title,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        bodyWidth: document.body.scrollWidth,
        smallText: smallText.length,
        interactive: interactive.length,
        smallTargets: smallTargets.length,
        unlabeled: unlabeled.length,
        headings: headings.slice(0, 8),
        h1: document.querySelectorAll("h1").length,
      };
    });

    let axe = [];
    try {
      axe = (await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()).violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        }));
    } catch (error) {
      axe = [{ id: "axe-error", impact: "unknown", nodes: 0, error: String(error).slice(0, 160) }];
    }

    if (viewportName === "desktop" || ["beranda", "pos", "jurnal", "pengaturan"].includes(name)) {
      await page.screenshot({ path: `${OUT}/${name}-${viewportName}.png`, fullPage: false }).catch(() => {});
    }

    results.push({ viewport: viewportName, name, path, status, ...metrics, overflow: metrics.scrollWidth > metrics.innerWidth + 1, axe, errors });
    if (errors.length) consoleErrors.push({ viewport: viewportName, name, errors });
    await page.close();
  }
  await context.close();
}

await browser.close();
writeFileSync(`${OUT}/audit.json`, JSON.stringify({ results, consoleErrors }, null, 2));
const summary = results.map((row) => ({
  viewport: row.viewport,
  name: row.name,
  status: row.status,
  overflow: row.overflow,
  smallText: row.smallText,
  smallTargets: `${row.smallTargets}/${row.interactive}`,
  unlabeled: row.unlabeled,
  h1: row.h1,
  axe: row.axe.map((item) => `${item.id}:${item.nodes}`).join(","),
  errors: row.errors.length,
}));
console.table(summary);
