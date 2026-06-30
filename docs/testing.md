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

`.github/workflows/ci.yml` runs **lint**, **typecheck**, **test** (with coverage upload) and **build** on every PR to `main`/`staging` and every push to `staging`. Build depends on lint + typecheck passing.

## Coverage thresholds

Currently no enforced thresholds — coverage is reported as informational. Once we cross ~30 % on `src/lib` we will enable thresholds in `vitest.config.ts` (`coverage.thresholds.lines: 30`).
