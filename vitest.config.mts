import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";
import { configureVitestDatabase } from "./tests/vitest-db-guard.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
configureVitestDatabase(process.argv.slice(2), process.env, root);
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/server/accounting.ts",
        "src/server/accounting-reversal.ts",
        "src/server/payables.ts",
        "src/server/party-credits.ts",
        "src/server/purchasing.ts",
        "src/server/purchase-advances.ts",
        "src/server/reservations.ts",
        "src/server/inventory/**/*.ts",
        "src/server/supplier-returns/**/*.ts",
        "src/server/reports/**/*.ts",
        "src/server/pos/**/*.ts",
      ],
      exclude: ["**/index.ts", "**/*.test.ts"],
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
