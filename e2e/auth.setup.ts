import path from "node:path";
import { test as setup } from "@playwright/test";
import { login } from "./helpers";

// Better Auth membatasi percobaan masuk per IP ("Too many requests"),
// jadi seluruh suite berbagi satu sesi terautentikasi lewat storageState.
// Hanya auth.spec.ts yang melakukan login UI sendiri (itu yang diuji).
export const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");

setup("autentikasi demo sekali untuk seluruh suite", async ({ page }) => {
  await login(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
