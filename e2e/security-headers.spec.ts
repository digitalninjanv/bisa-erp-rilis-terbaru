import { expect, test } from "@playwright/test";

/**
 * SEC-013 — CSP dokumen memakai nonce per request; script-src tidak
 * lagi mengizinkan 'unsafe-inline'. Login diuji terpisah oleh
 * auth.spec.ts, jadi kegagalan hidrasi akan terlihat di suite penuh.
 */
test("CSP dokumen memakai nonce dan script-src tanpa unsafe-inline", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");

  const nonce = csp.match(/'nonce-([a-f0-9]+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const scriptNonces = await page.locator("script[nonce]").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLScriptElement).nonce),
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === nonce)).toBe(true);
});
