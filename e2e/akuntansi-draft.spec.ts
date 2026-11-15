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
const DATE = "2026-11-15";

test.afterAll(async () => {
  await sql.end();
});

test("draf jurnal direview lalu diposting menjadi jurnal resmi", async ({ page }) => {
  const accounts = await sql<{ id: string }[]>`
    select id from accounts
    where company_id = ${DEMO} and is_postable = true and is_active = true
    order by code limit 2
  `;
  expect(accounts.length).toBe(2);
  const suffix = crypto.randomUUID().slice(0, 8);
  const draftNumber = `DRAFT-E2E-${suffix}`;
  const entry = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into journal_entries
        (company_id, number, date, description, source_type, status, created_by)
      values (${DEMO}, ${draftNumber}, ${DATE}, ${"Draf E2E review"}, 'manual', 'draft', ${OWNER})
      returning id
    `;
    await tx`
      insert into journal_lines (company_id, entry_id, account_id, debit, credit, line_no)
      values
        (${DEMO}, ${row.id}, ${accounts[0].id}, ${"1000"}, ${"0"}, 1),
        (${DEMO}, ${row.id}, ${accounts[1].id}, ${"0"}, ${"1000"}, 2)
    `;
    return row;
  });

  await page.goto(`/app/akuntansi/jurnal/${entry.id}`);
  await expect(page.getByText("Draf belum memengaruhi buku besar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Posting draf" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hapus draf" })).toBeVisible();

  await page.getByRole("button", { name: "Posting draf" }).click();
  await expect(page).toHaveURL(/\/app\/akuntansi\/jurnal\/[0-9a-f-]+$/);
  await expect(page).not.toHaveURL(new RegExp(entry.id));
  await expect(page.getByText("Draf belum memengaruhi buku besar")).toHaveCount(0);
  await expect(page.getByText("Terposting").first()).toBeVisible();

  const [posted] = await sql<{ number: string; status: string }[]>`
    select number, status from journal_entries where id = ${entry.id}
  `;
  expect(posted).toBeUndefined();
});
