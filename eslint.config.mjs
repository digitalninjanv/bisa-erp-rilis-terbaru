import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Electron's sandboxed preload exposes the runtime through CommonJS.
    files: ["pos-electron/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Local remediation build output, like .next, is generated code.
    ".next-remediation/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // A-24 T5: assembled production release artifact (standalone tree
    // with its own node_modules) — build output, not source.
    "dist-release/**",
    // POS Native Langkah 1: keluaran build aplikasi desktop
    // (sumbernya di pos-desktop/app & pos-desktop/lib tetap di-lint).
    "pos-desktop/.next/**",
    "pos-desktop/out/**",
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
