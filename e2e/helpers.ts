import { expect, type Page } from "@playwright/test";

export const DEMO_EMAIL = "owner@bisa.id";
export const DEMO_PASSWORD = "Bisa12345!";

/** Logs in through the real login form and waits for the Beranda. */
export async function login(page: Page, password: string = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Selamat bekerja/ })).toBeVisible();
}

/**
 * Reads the stock figure of a product from the product list page
 * (default warehouse column "Stok"), searched by name fragment.
 */
export async function readProductStock(page: Page, nameFragment: string, exactName: string) {
  await page.goto(`/app/gudang/produk?q=${encodeURIComponent(nameFragment)}`);
  const row = page.locator("tbody tr", {
    has: page.getByRole("link", { name: exactName, exact: true }),
  });
  await expect(row).toBeVisible();
  const headers = await page.locator("thead th").allTextContents();
  const stockIdx = headers.findIndex((h) => h.trim() === "Stok");
  if (stockIdx < 0) throw new Error("Kolom Stok tidak ditemukan di daftar produk.");
  const text = await row.locator("td").nth(stockIdx).innerText();
  const value = Number.parseInt(text.replace(/[^0-9-]/g, ""), 10);
  if (Number.isNaN(value)) throw new Error(`Stok tidak terbaca dari teks: "${text}"`);
  return value;
}
