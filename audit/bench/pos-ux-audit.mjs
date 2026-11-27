/**
 * Audit UX/UI POS — read-only, tidak menekan Bayar.
 * Jalankan: node audit/bench/pos-ux-audit.mjs
 * Output: JSON + screenshot di audit/checks/.
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BISA_BASE_URL ?? "http://127.0.0.1:3000";
const PREFS = {
  density: "comfortable",
  columns: "4",
  cartWidth: 480,
  showStock: true,
  showSku: false,
  showPackaging: true,
  showPrice: true,
  view: "grid",
  fontScale: "large",
  cardShape: "rounded",
  cardTint: true,
  showCategory: false,
  colorByCategory: false,
  autoFullscreen: false,
  actionTheme: "accurate",
};

const browser = await chromium.launch();
const results = { base: BASE, generatedAt: new Date().toISOString(), viewports: {} };

async function login(context) {
  const res = await context.request.post("/api/auth/sign-in/email", {
    data: { email: "owner@bisa.id", password: "Bisa12345!" },
  });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
}

async function runDesktop(name, viewport, fullscreen, prefs = PREFS) {
  const context = await browser.newContext({ baseURL: BASE, viewport });
  await login(context);
  const page = await context.newPage();
  await page.addInitScript((prefs) => {
    localStorage.setItem("bisa.pos.display", JSON.stringify(prefs));
  }, prefs);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await page.goto("/app/pos", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  if (fullscreen) {
    const btn = page.getByRole("button", { name: "Layar penuh" });
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(500);
    }
  }
  // Empat baris, qty bertambah agar daftar melebihi tinggi panel.
  const cards = page.locator("[data-catalog-index]");
  for (const index of [0, 1, 2, 3, 3, 2]) {
    if (await cards.nth(index).count()) {
      await cards.nth(index).click();
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(1000);
  const launch = page.locator("button:visible", { hasText: /^Bayar Rp/ }).first();
  if (await launch.count()) {
    await launch.click();
    await page.waitForTimeout(600);
  }
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const metrics = await page.evaluate(() => {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1) };
    };
    const style = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        color: cs.color,
        background: cs.backgroundColor,
        overflowY: cs.overflowY,
        letterSpacing: cs.letterSpacing,
      };
    };
    const parse = (value) => {
      const direct = String(value).match(/rgba?\(([^)]+)\)/);
      if (direct) {
        const parts = direct[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
      }
      // Normalisasi format modern (oklch/oklab/color()) lewat canvas.
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) return null;
      probe.fillStyle = "#000";
      probe.fillStyle = String(value);
      const normalized = probe.fillStyle;
      const m = normalized.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
      }
      const hex = normalized.match(/^#([0-9a-f]{6})$/i);
      if (hex) {
        return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
      }
      return null;
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const bgOf = (el) => {
      let node = el;
      const stack = [];
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) stack.push(c);
        if (c && c.a >= 0.999) break;
        node = node.parentElement;
      }
      let bg = stack.length ? stack[stack.length - 1] : { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 2; i >= 0; i -= 1) bg = blend(stack[i], bg);
      return bg;
    };
    const ratio = (fg, bg) => {
      const l1 = lum(fg), l2 = lum(bg);
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
    };
    const contrast = (el) => {
      if (!el) return null;
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      return fg ? ratio(blend(fg, bg), bg) : null;
    };
    const placeholderContrast = (el) => {
      if (!el) return null;
      const fg = parse(getComputedStyle(el, "::placeholder").color);
      const bg = bgOf(el);
      return fg ? ratio(blend(fg, bg), bg) : null;
    };
    const isVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const intersectArea = (a, b) => {
      if (!a || !b) return 0;
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      return w * h;
    };

    const posRoot = $(".pos-terminal-root") ?? document.body;
    const cards = $$("[data-catalog-index]", posRoot);
    const firstCard = cards[0];
    const cardTexts = (card) => {
      const spans = $$("span", card);
      const name = spans.find((s) => /font-semibold/.test(s.className) && !/^\s*×/.test(text(s)));
      const price = spans.find((s) => /font-bold/.test(s.className) && /^Rp\s[0-9]/.test(text(s)));
      const stock = spans.find((s) => /^Stok /.test(text(s)));
      const qty = spans.find((s) => /^×/.test(text(s)));
      return { name, price, stock, qty };
    };
    const c0 = cardTexts(firstCard);
    const nameRect = rect(c0.name);
    const priceRect = rect(c0.price);
    const cardGap = nameRect && priceRect ? +(priceRect.y - (nameRect.y + nameRect.h)).toFixed(1) : null;

    const aside = $("#pos-cart");
    const cartLines = $(".pos-cart-lines");
    const cartItems = $$("#pos-cart li");
    const cartViewport = rect(cartLines);
    const visibleCartItems = cartItems.filter((li) => intersectArea(rect(li), cartViewport) > 0).length;
    const fullyVisibleCartItems = cartItems.filter((li) => {
      const r = rect(li);
      return r && cartViewport && r.y >= cartViewport.y - 1 && r.bottom <= cartViewport.bottom + 1;
    }).length;

    const pay = $$("button", posRoot).find((b) => /^Bayar (Rp|—|sisa)/.test(text(b)) && !/dengan/.test(text(b)));
    const footer = pay?.parentElement;
    const cashChipsLabel = $$("span").find((s) => text(s) === "Saran uang diterima");
    const cashChips = cashChipsLabel?.parentElement?.parentElement;
    const exactChip = $$("button").find((b) => text(b) === "Uang Pas");
    const cashInput = $("#pos-tendered-input");
    const changeBox = $$("div").find((d) => /^Rp\s0$/.test(text(d)) && /text-lg/.test(d.className));
    const methodGroup = $('[role="group"][aria-label="Metode pembayaran"]');
    const methodTiles = $$("button", methodGroup ?? document);
    const paymentHeader = $$("p").find((p) => text(p) === "Pembayaran")?.parentElement;
    const paymentTotal = paymentHeader ? $$("p", paymentHeader).find((p) => /^Rp\s/.test(text(p))) : null;
    const cartTitle = $$("h2").find((h) => text(h) === "Keranjang");
    const cartSelect = $("#pos-price-group-compact");
    const pageScroll = { body: document.body.scrollHeight, viewport: innerHeight };

    const smallText = $$("*", posRoot).filter((el) => {
      if (!isVisible(el)) return false;
      if (el.children.length > 0) return false;
      const size = parseFloat(getComputedStyle(el).fontSize);
      return size > 0 && size <= 11;
    }).slice(0, 80).map((el) => ({
      text: text(el).slice(0, 50),
      fontSize: getComputedStyle(el).fontSize,
      contrast: contrast(el),
      tag: el.tagName.toLowerCase(),
    }));

    const smallTargets = $$("button, a, input, select", posRoot).filter(isVisible).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 44 || r.height < 44;
    }).slice(0, 40).map((el) => ({
      text: (text(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName).slice(0, 50),
      tag: el.tagName.toLowerCase(),
      rect: rect(el),
    }));

    const chipRect = rect(exactChip);
    const footerRect = rect(footer);
    const overlapY = chipRect && footerRect ? Math.max(0, Math.min(chipRect.bottom, footerRect.bottom) - Math.max(chipRect.y, footerRect.y)) : 0;
    let chipHit = null;
    if (exactChip) {
      const r = exactChip.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      chipHit = hit ? { tag: hit.tagName.toLowerCase(), text: text(hit).slice(0, 80), isChip: hit === exactChip || exactChip.contains(hit) } : null;
    }

    const key = (el, extra = {}) => el ? ({ text: text(el).slice(0, 60), rect: rect(el), style: style(el), contrast: contrast(el), ...extra }) : null;

    return {
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      pageScroll,
      catalog: {
        cardCount: cards.length,
        card: key(firstCard),
        cardGapNameToPrice: cardGap,
        name: key(c0.name),
        price: key(c0.price),
        stock: key(c0.stock),
        visibleGrid: rect($$("[data-catalog-index]")[0]?.parentElement),
      },
      cart: {
        aside: { rect: rect(aside), clientHeight: aside?.clientHeight, scrollHeight: aside?.scrollHeight, overflowY: getComputedStyle(aside).overflowY },
        lines: { rect: cartViewport, clientHeight: cartLines?.clientHeight, scrollHeight: cartLines?.scrollHeight, overflowY: cartLines ? getComputedStyle(cartLines).overflowY : null },
        itemCount: cartItems.length,
        visibleCartItems,
        fullyVisibleCartItems,
        firstItemHeight: cartItems[0]?.getBoundingClientRect().height ?? null,
        title: key(cartTitle),
        priceSelect: key(cartSelect),
        total: key($$("#pos-cart span").find((s) => /^Rp\s/.test(text(s)) && parseFloat(getComputedStyle(s).fontSize) >= 24)),
      },
      payment: {
        header: key(paymentHeader),
        total: key(paymentTotal),
        methodTiles: methodTiles.map((b) => ({ text: text(b).slice(0, 40), rect: rect(b), pressed: b.getAttribute("aria-pressed") })),
        cashInput: key(cashInput, { placeholder: cashInput?.placeholder, placeholderContrast: placeholderContrast(cashInput) }),
        change: key(changeBox),
        exactChip: key(exactChip),
        cashChips: key(cashChips),
        payButton: key(pay),
        footer: rect(footer),
        chipFooterOverlapY: +overlapY.toFixed(1),
        chipHit,
      },
      smallText,
      smallTargets,
      colors: {
        paymentTextColors: [...new Set(methodTiles.map((b) => getComputedStyle(b).color))],
        paymentBackgrounds: [...new Set(methodTiles.map((b) => getComputedStyle(b).backgroundColor))],
      },
    };
  });
  await page.screenshot({ path: `audit/checks/pos-ux-${name}.png`, fullPage: false });
  results.viewports[name] = {
    viewport,
    fullscreen,
    errors,
    axe: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) })),
    metrics,
  };
  await context.close();
}

async function runMobile() {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await login(context);
  const page = await context.newPage();
  await page.addInitScript((prefs) => localStorage.setItem("bisa.pos.display", JSON.stringify(prefs)), PREFS);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await page.goto("/app/pos", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const cards = page.locator("[data-catalog-index]");
  for (const index of [0, 1, 2]) {
    if (await cards.nth(index).count()) {
      await cards.nth(index).click();
      await page.waitForTimeout(200);
    }
  }
  const openCart = page.getByRole("button", { name: /Buka keranjang/ });
  if (await openCart.count()) {
    await openCart.click();
    await page.waitForTimeout(600);
  }
  const metrics = await page.evaluate(() => {
    const $$ = (sel) => [...document.querySelectorAll(sel)];
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) };
    };
    const pay = $$("button").find((b) => /^Bayar\b/.test(text(b)));
    const exact = $$("button").find((b) => text(b) === "Uang Pas");
    const input = document.querySelector("#pos-tendered-input");
    return {
      viewport: { w: innerWidth, h: innerHeight },
      sheet: rect(document.querySelector('[data-slot="sheet-content"]')),
      pay: rect(pay),
      footer: rect(pay?.parentElement),
      exactChip: rect(exact),
      cashInput: rect(input),
      cashInputVisible: input ? input.getBoundingClientRect().bottom < innerHeight : false,
      bodyScroll: document.body.scrollHeight,
    };
  });
  await page.screenshot({ path: "audit/checks/pos-ux-mobile-sheet.png", fullPage: false });
  results.viewports.mobile = { errors, metrics };
  await context.close();
}

await runDesktop("desktop-1920", { width: 1920, height: 1080 }, true);
await runDesktop("desktop-1536-user", { width: 1536, height: 864 }, true, { ...PREFS, cartWidth: 360 });
await runDesktop("laptop-1366", { width: 1366, height: 768 }, false);
await runMobile();
await browser.close();
writeFileSync("audit/checks/pos-ux-audit.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
