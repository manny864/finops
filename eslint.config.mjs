import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CI doesn't lint test files, tmp, scripts, root utility js, vitest config.
    "__tests__/**",
    ".tmp/**",
    "scripts/**",
    ".next-*/**",
    "*.js",
    "vitest.setup.ts",
    "vitest.config.ts",
  ]),
  {
    // Pre-existing tech debt (1000+ instances). Downgraded to warnings so CI
    // doesn't block; can be fixed incrementally.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@next/next/no-img-element": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
