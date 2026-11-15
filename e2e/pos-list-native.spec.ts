import { expect, test } from "@playwright/test";
import fs from "node:fs";
import postgres from "postgres";

function directUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const env = fs.readFileSync(".env.local", "utf8");
  const line = env.split("\n").find((row) => row.startsWith("DIRECT_URL="));
  if (!line) throw new Error("DIRECT_URL tidak ditemukan di .env.local");
  return line.slice("DIRECT_URL=".length).trim();
}

const sql = postgres(directUrl(), { max: 1 });
const DEMO = "01900000-0000-7000-8000-000000000001";
const OWNER = "01900000-0000-7000-8000-000000000010";
const ids = { session: "", sale: "", customer: "" };

test.beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [customer] = await sql<{ id: string }[]>`
    insert into customers (company_id, code, name)
    values (${DEMO}, ${`POS-CARD-${suffix}`}, ${`Pelanggan Kartu ${suffix}`})
    returning id
  `;
  ids.customer = customer.id;
  const [warehouse] = await sql<{ id: string }[]>`
    select id from warehouses where company_id = ${DEMO} order by is_default desc limit 1
  `;
  const [sale] = await sql<{ id: string }[]>`
    insert into sales
      (company_id, warehouse_id, number, date, cashier_id, customer_id, status,
       subtotal, total, paid_total, payment_status)
    values (${DEMO}, ${warehouse.id}, ${`POS-CARD-${suffix}`}, '2026-11-15', ${OWNER},
            ${customer.id}, 'completed', '100000', '100000', '0', 'unpaid')
    returning id
  `;
  ids.sale = sale.id;
  const [session] = await sql<{ id: string }[]>`
    insert into cash_sessions
      (company_id, user_id, opened_at, closed_at, opening_cash, expected_cash,
       counted_cash, difference, status, notes)
    values (${DEMO}, ${OWNER}, '2026-11-15T01:00:00Z', '2026-11-15T09:00:00Z',
            '100000', '250000', '240000', '-10000', 'closed', 'Uji kartu sesi')
    returning id
  `;
  ids.session = session.id;
  await sql`
    insert into cash_movements (company_id, session_id, type, amount, notes, created_by)
    values
      (${DEMO}, ${session.id}, 'opening', '100000', 'Modal awal uji', ${OWNER}),
      (${DEMO}, ${session.id}, 'sale', '150000', 'Penjualan tunai uji', ${OWNER})
  `;
});

test.afterAll(async () => {
  await sql`delete from cash_movements where session_id = ${ids.session}`;
  await sql`delete from cash_sessions where id = ${ids.session}`;
  await sql`delete from sales where id = ${ids.sale}`;
  await sql`delete from customers where id = ${ids.customer}`;
  await sql.end();
});

test("piutang mobile memakai kartu dengan aksi terima", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/pos/piutang");
  await expect(page.getByText(/Pelanggan Kartu/).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Terima" }).last()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.locator("table.data-table").first()).toBeHidden();
});

test("detail sesi mobile memakai kartu mutasi", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/pos/sesi/riwayat/${ids.session}`);
  await expect(page.getByText("Mutasi kas sesi")).toBeVisible();
  await expect(page.getByText("Modal awal uji").last()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.locator("table.data-table").first()).toBeHidden();
});

test("detail sesi desktop tetap berupa tabel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/app/pos/sesi/riwayat/${ids.session}`);
  await expect(page.locator("table.data-table").first()).toBeVisible();
});
