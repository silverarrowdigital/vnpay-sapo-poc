import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    // Sanity Studio build output (`sanity build` / `sanity deploy`). 8 MB of bundled vendor
    // JavaScript; linting it reported ~23k problems that are not this repo's code.
    "dist/**",
    // Downloaded UI reference, not code we run.
    "design/reference/**",
  ]),
]);
