import { expect, test } from "@playwright/test";
import fs from "node:fs";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";
import { loginWith } from "./helpers";

/**
 * Matriks role/modul: pengguna terbatas tidak boleh melihat biaya/gaji/
 * laporan, dan modul yang dimatikan harus menolak URL langsung.
 * Fixture user dibuat di DB uji ini saja (bukan DB pengguna).
 */
function directUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const env = fs.readFileSync(".env.local", "utf8");
  const line = env.split("\n").find((row) => row.startsWith("DIRECT_URL="));
  if (!line) throw new Error("DIRECT_URL tidak ditemukan di .env.local");
  return line.slice("DIRECT_URL=".length).trim();
}

const sql = postgres(directUrl(), { max: 1 });
const DEMO = "01900000-0000-7000-8000-000000000001";
const PASSWORD = "Bisa12345!";
const VIEWER_EMAIL = "e2e-viewer@bisa.id";
const CASHIER_EMAIL = "e2e-cashier@bisa.id";
const HR_EMAIL = "e2e-hr@bisa.id";
const HR_ROLE = "e2e_hr_no_payroll";

async function upsertUser(email: string, name: string, role: string) {
  const id = `e2e-${email.split("@")[0]}`;
  await sql.unsafe(`delete from "user" where email = $1`, [email]);
  await sql.unsafe(
    `insert into "user" (id, name, email, email_verified, role, created_at, updated_at)
     values ($1, $2, $3, true, $4, now(), now())`,
    [id, name, email, role],
  );
  const passwordHash = await hashPassword(PASSWORD);
  await sql.unsafe(
    `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $3, $4, now(), now())`,
    [`acc-${id}`, id, id, passwordHash],
  );
  await sql.unsafe(
    `insert into member (id, organization_id, user_id, role, created_at)
     values ($1, $2, $3, $4, now())`,
    [`mem-${id}`, DEMO, id, role],
  );
}

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
  await sql.unsafe(`delete from company_roles where company_id = $1 and key = $2`, [DEMO, HR_ROLE]);
  await sql.unsafe(
    `insert into company_roles (company_id, key, name, modules, permissions, is_active)
     values ($1, $2, 'E2E HR tanpa payroll.view', $3::jsonb, $4::jsonb, true)`,
    [DEMO, HR_ROLE, JSON.stringify(["hr", "pos"]), JSON.stringify(["pos.sell"])],
  );
  await upsertUser(VIEWER_EMAIL, "E2E Viewer", "viewer");
  await upsertUser(CASHIER_EMAIL, "E2E Kasir", "cashier");
  await upsertUser(HR_EMAIL, "E2E HR", HR_ROLE);
});

test.afterAll(async () => {
  await sql.unsafe(`delete from "user" where email = any($1)`, [[VIEWER_EMAIL, CASHIER_EMAIL, HR_EMAIL]]);
  await sql.unsafe(`delete from company_roles where company_id = $1 and key = $2`, [DEMO, HR_ROLE]);
  await sql.end();
});

test("viewer melihat stok tetapi tidak melihat HPP", async ({ page }) => {
  await loginWith(page, VIEWER_EMAIL);
  await page.goto("/app/gudang/produk");
  await expect(page.getByRole("heading", { name: "Produk & harga" })).toBeVisible();
  await expect(page.locator("thead").getByText("HPP", { exact: true })).toHaveCount(0);
  await expect(page.locator("thead").getByText("Margin", { exact: true })).toHaveCount(0);
});

test("kasir ditolak dari modul gudang dan akuntansi", async ({ page }) => {
  await loginWith(page, CASHIER_EMAIL, PASSWORD, { url: /\/app(\/pos)?$/, heading: null });
  await page.goto("/app/gudang/produk");
  await expect(page).toHaveURL(/\/app\?(denied|disabled)=gudang/);
  await page.goto("/app/akuntansi/laporan");
  await expect(page).toHaveURL(/\/app\?(denied|disabled)=akuntansi/);
});

test("role HR tanpa payroll.view ditolak dari halaman payroll", async ({ page }) => {
  await loginWith(page, HR_EMAIL);
  await page.goto("/app/akuntansi/payroll");
  await expect(page).toHaveURL(/\/app\?forbidden=payroll\.view/);
  await expect(page.getByText(/tidak punya akses|akses ditolak/i).first()).toBeVisible();
});

test("modul gudang yang dimatikan menolak URL langsung", async ({ page }) => {
  const [settings] = await sql.unsafe<{ enabled_modules: unknown }[]>(
    `select enabled_modules from company_settings where company_id = $1`,
    [DEMO],
  );
  const original = settings?.enabled_modules ?? null;
  try {
    await sql.unsafe(
      `update company_settings set enabled_modules = $2::jsonb where company_id = $1`,
      [DEMO, JSON.stringify({ gudang: false })],
    );
    await loginWith(page, VIEWER_EMAIL);
    await page.goto("/app/gudang/produk");
    await expect(page).toHaveURL(/\/app\?disabled=gudang/);
  } finally {
    if (original === null) {
      await sql.unsafe(`update company_settings set enabled_modules = null where company_id = $1`, [DEMO]);
    } else {
      await sql.unsafe(
        `update company_settings set enabled_modules = $2::jsonb where company_id = $1`,
        [DEMO, JSON.stringify(original)],
      );
    }
  }
});

test("kontrol positif: owner tetap melihat HPP", async ({ page }) => {
  await loginWith(page, "owner@bisa.id");
  await page.goto("/app/gudang/produk");
  await expect(page.locator("thead").getByText("HPP", { exact: true })).toHaveCount(1);
});
