import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
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
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
