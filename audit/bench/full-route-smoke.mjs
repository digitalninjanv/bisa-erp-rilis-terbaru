import { chromium } from "@playwright/test";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3000";
const ROOT = "src/app/app";
const SESSION_COOKIE = process.env.AUDIT_SESSION_COOKIE ?? "xQ6RsUbS7mfIWfD8rq2UqNOX9ah6lbbn.kn1MM8yVFKi26brgnNUqGoXquVdkPvNcMurQ7W3lpxk%3D";

function routes(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...routes(full));
      continue;
    }
    if (entry !== "page.tsx") continue;
    const rel = relative(ROOT, dir);
    if (rel.includes("[") || rel.includes("]")) continue;
    const segments = rel
      .split("/")
      .filter(Boolean)
      .filter((segment) => !segment.startsWith("("));
    out.push(`/app${segments.length ? `/${segments.join("/")}` : ""}`);
  }
  return out;
}

const all = [...new Set(routes(ROOT))].sort();
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
await context.addCookies([{
  name: "better-auth.session_token",
  value: SESSION_COOKIE,
  domain: new URL(BASE).hostname,
  path: "/",
  httpOnly: true,
  expires: 1796343121,
}]);

const results = [];
let index = 0;
async function worker() {
  while (index < all.length) {
    const path = all[index++];
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 200));
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`.slice(0, 200)));
    let status = 0;
    let text = "";
    try {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = response?.status() ?? 0;
      await page.waitForTimeout(900);
      text = (await page.locator("body").innerText()).slice(0, 3000);
    } catch (error) {
      errors.push(`goto: ${String(error).slice(0, 180)}`);
    }
    const broken = /application error|internal server error|something went wrong|unhandled runtime error/i.test(text);
    results.push({ path, status, broken, title: await page.title().catch(() => ""), errors });
    await page.close();
  }
}

await Promise.all([worker(), worker(), worker()]);
await browser.close();
results.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync("audit/checks/full-route-smoke.json", JSON.stringify(results, null, 2));
const bad = results.filter((row) => row.status >= 400 || row.status === 0 || row.broken || row.errors.length > 0);
console.log(JSON.stringify({ total: results.length, ok: results.length - bad.length, bad }, null, 2));
