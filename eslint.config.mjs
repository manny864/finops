import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUnauthTenantId from "./eslint-rules/no-unauth-tenant-id.mjs";

const combinedPlugins = Object.assign(
  {},
  ...nextVitals.map((c) => c.plugins || {}),
  ...nextTs.map((c) => c.plugins || {})
);

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
    // Vendored Claude Code skill assets (gsap.min.js et al). Not app source.
    ".agents/**",
    "scripts/**",
    ".next-*/**",
    "*.js",
    "vitest.setup.ts",
    "vitest.config.ts",
  ]),
  {
    // Security: disallow trusting x-tenant-id header / ?tenantId= param without JWT auth guard.
    // See docs/security/audit-2026-06-30.md#c-01-c-02 for context.
    plugins: { local: { rules: { "no-unauth-tenant-id": noUnauthTenantId } } },
    files: ["src/app/api/**/*.ts"],
    rules: {
      "local/no-unauth-tenant-id": "error",
    },
  },
  {
    // `rules-of-hooks` NO es deuda cosmética como el resto de este archivo: un
    // hook después de un corte temprano hace que React tire "Rendered more
    // hooks than during the previous render" y la pantalla entera deja de
    // renderizar. Estaba en "warn", y como CI corre eslint con --quiet las
    // advertencias no son gate, así que el linter lo detectó y nadie se enteró:
    // el tablero de Compromisos se caía al cambiar de tenant (2026-09-23).
    // Se sube a error con 0 violaciones en el repo, así que no rompe nada hoy.
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
  {
    // Pre-existing tech debt (1000+ instances). Downgraded to warnings so CI
    // doesn't block; can be fixed incrementally.
    plugins: combinedPlugins,
    rules: {
      "@typescript-eslint/no-this-alias": "warn",
      "@next/next/no-assign-module-variable": "warn",
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
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
