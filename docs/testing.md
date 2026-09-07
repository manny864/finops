# Testing

This SaaS uses **Vitest 4** + **React Testing Library** + **MSW** for unit/integration tests and (optionally) **Playwright** for E2E.

## Quick commands

```bash
npm test              # run all unit + integration once
npm run test:watch    # watch mode for TDD
npm run test:coverage # run with v8 coverage (HTML + lcov)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
```

## Layout

```
__tests__/
  unit/          # pure functions, isolated logic (lib/, services/)
  components/    # React components with RTL + jsdom
  integration/   # API route handlers invoked directly (mocking pool + auth)
  e2e/           # Playwright (excluded from vitest)
```

## Patterns

### Mocking the MySQL pool

```ts
vi.mock("@/modules/storage/db", () => ({
  default: { query: vi.fn().mockResolvedValue([[], []]) },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));
```

This activates fallback paths in `pricingUnits`, `fx` (embedded defaults when DB is empty).

### Mocking auth (`requireSuperAdmin`, `requireTenantAccess`, ...)

```ts
vi.mock("@/lib/requestAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
  return {
    ...actual,
    requireTenantAccess: vi.fn().mockResolvedValue({
      tenantId: "t", email: "u@x.com", claims: { oid: "oid" }, isCorporateDomain: false,
    }),
  };
});
```

### Decimal.js assertions

Never compare `===` against `number`. Always convert:

```ts
expect(result.toString()).toBe("1.234");
// or
expect(result.toNumber()).toBeCloseTo(1.234, 6);
```

### Testing Next.js route handlers

Add `// @vitest-environment node` at the top of integration test files to avoid `jsdom` limitations with `Request`/`Response`.

```ts
// @vitest-environment node
import { GET } from "@/app/api/health/route";

const res = await GET(new NextRequest("http://localhost/api/health"));
expect(res.status).toBe(200);
```

## CI

`.github/workflows/ci.yml` runs **lint**, **typecheck**, **test** (with coverage upload) and **build** on every PR to `main`. On a push to `main` it runs **only** the test job — the image's own `next build` in `deploy-azure.yml` already covers the other three. Build depends on lint + typecheck passing.

## Coverage thresholds

Currently no enforced thresholds — coverage is reported as informational. Once we cross ~30 % on `src/lib` we will enable thresholds in `vitest.config.ts` (`coverage.thresholds.lines: 30`).

## E2E (Playwright)

Dos formas de "estar logueado" en los tests, cada una con su propio setup project y `storageState` (ver `playwright.config.ts`):

| Project | Login | Cubre | Requiere |
|---|---|---|---|
| `demo` | `/es/demo` (demo/demo), sin Azure AD | UI/render de casi todas las páginas (datos mock) | Nada — corre siempre |
| `authenticated` | `loginRedirect` real contra Entra ID | Auth real + backend tenant-scoped | `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` en el entorno |

```bash
npm run test:e2e:demo      # solo demo (rápido, sin credenciales)
npm run test:e2e           # demo + authenticated (si las env vars están seteadas)
npm run test:e2e:report    # abre el último HTML report
PLAYWRIGHT_BASE_URL=https://finops.cscloudsolutions.com.ar npm run test:e2e:demo  # contra un deploy real en vez de localhost
```

### Suite actual

- `__tests__/e2e/smoke.demo.spec.ts` — recorre TODAS las rutas de `ROUTE_TIERS` (`src/lib/routeTiers.ts`) más un puñado de rutas libres, en tier `enterprise` vía modo demo, y falla si hay un error de consola/React o un status HTTP no-OK. Barato y de alto impacto: no reemplaza pruebas funcionales por feature, pero atrapa páginas rotas de entrada.

### Setup de "authenticated" (pendiente — requiere un usuario de test en Entra ID)

`__tests__/e2e/setup/msal.setup.ts` hace un `loginRedirect` real contra `login.microsoftonline.com`. Para que funcione:

1. Crear (o pedirle a un admin) un usuario de test en el tenant de Entra ID de la app, **excluido de cualquier política de Conditional Access que exija MFA** — igual que se hizo para el Service Principal de load-testing (`docs/loadtest.md`), pero acá es un usuario real, no un SP.
2. Setear `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` en un `.env.test` local (gitignoreado, nunca commitear valores reales).
3. **Caveat conocido**: `AuthProvider.tsx` no fija `cacheLocation` en la config de MSAL, así que usa el default de `@azure/msal-browser` = `sessionStorage`. El `storageState()` de Playwright no persiste `sessionStorage` (solo cookies + `localStorage`), así que el login capturado en el setup puede no sobrevivir a un nuevo browser context. Si los specs `*.auth.spec.ts` arrancan deslogueados, evaluar cambiar `AuthProvider.tsx` a `cacheLocation: "localStorage"` (revisar impacto de seguridad — mayor superficie XSS que sessionStorage) antes de aplicarlo.

Una vez resuelto esto, los tests que necesiten auth/backend real van en archivos `*.auth.spec.ts` (el sufijo determina el project vía `testMatch` en `playwright.config.ts`).
