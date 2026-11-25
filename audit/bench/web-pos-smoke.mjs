import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3100", viewport: { width: 1440, height: 900 } });
const login = await ctx.request.post("/api/auth/sign-in/email", { data: { email: "owner@bisa.id", password: "Bisa12345!" } });
console.log("login", login.status());
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 500)); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 500)));
await page.goto("/app/pos", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  headings: await page.locator("h1,h2").allTextContents().catch(() => []),
  body: (await page.locator("body").innerText()).slice(0, 800),
  errors,
}, null, 2));
await browser.close();
