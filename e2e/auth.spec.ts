import { expect, test } from "@playwright/test";
import { DEMO_EMAIL, login } from "./helpers";

// Spec ini menguji form login itu sendiri — jangan pakai sesi bersama.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Autentikasi", () => {
  test("login kredensial demo menampilkan Beranda", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "Ruang kerja" })).toBeVisible();
    await expect(page.getByText(/Akses cepat ke modul/)).toBeVisible();
  });

  test("kata sandi salah menampilkan kesalahan dan tetap di halaman login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Kata sandi").fill("KataSandiSalah123!");
    await page.getByRole("button", { name: "Masuk" }).click();

    // role="alert" juga dipakai route announcer Next — saring ke alert form.
    const alert = page.getByRole("alert").filter({ hasText: /invalid|tidak cocok|gagal/i });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
  });
});
