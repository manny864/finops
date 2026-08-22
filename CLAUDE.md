# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The import above is the **binding operational directive set** for this repo (RBAC-first
development, granular commits, mandatory docs, DB migration protocol, i18n parity, mocks-per-tier,
biweekly security audits, CI/CD branch model). Read it in full before making changes — it is not
optional background. What follows here is a quick-reference layer on top of it: commands and the
architectural map needed to actually navigate the code.

## Commands

```bash
npm run dev              # Next.js dev server on :3000
npm run dev:clean        # kill whatever holds :3000, then start dev
npm run build            # next build (production)
npm run start            # serve production build on :3000
npm run lint             # eslint (flat config, eslint.config.mjs)
npm run typecheck        # tsc --noEmit
npm run test             # vitest run (unit + integration, jsdom)
npm run test:watch       # vitest watch mode
npm run test:coverage    # vitest run --coverage (v8, informational only — no gate yet)
npm run test:e2e         # playwright
npm run migrate          # tsx scripts/migrate.ts — applies pending SQL from migrations/
```

Single test file / single test:
```bash
npx vitest run __tests__/unit/fx.test.ts
npx vitest run -t "name of the test"
```

There is no separate `npm run test:integration` — unit, component, and integration specs all run
through the same `vitest run` (see `vitest.config.ts` `include`). Integration tests that exercise
Next.js route handlers directly need `// @vitest-environment node` at the top of the file (jsdom,
the project default, lacks a real `Request`/`Response`).

CI (`.github/workflows/ci.yml`, on PRs to `main`/`staging` and pushes to `staging`) runs `lint`,
`typecheck`, `test:coverage`, then `build` (build depends on lint+typecheck passing). Note `lint` runs with
`--quiet`, so only errors gate the build — the ~3.6k warnings do not.

A push to `staging` also fires `deploy-staging.yml` **in parallel with CI, not gated on it**: it builds the
runtime and `-builder` images in ACR, runs the migration Container Apps Job, rolls a new revision of the
staging Container App, and health-checks it. There is a real deployed staging environment on Azure Container
Apps, not just a CI gate.
`deploy-azure.yml` on `main` does **not** re-run lint/tests — it builds the image in ACR, runs the
migration Container Apps Job and rolls a new revision of the Container App — so `staging` CI is the
only quality gate. Never promote to `main` with `staging` CI red.

Infra lives in `infra/terraform/` (Azure Container Apps, one control plane + N regional stamps).
`terraform.yml` gates PRs that touch `infra/terraform/**` with Checkov + Infracost + `plan`; the
`apply` is always manual (`workflow_dispatch`), and a Monday cron checks for drift. `deploy.yml`
(SSH to the legacy VPS) is `workflow_dispatch`-only and must not be re-armed on push: the VPS was
frozen on 2026-07-28 and running it would deploy to a dead host and migrate its stale database.

## Architecture

Next.js 16 App Router SaaS (multi-tenant FinOps platform for Microsoft Azure — Azure-only, no
multi-cloud abstraction). Three logical layers, all under `src/`:

1. **`src/app/[locale]/`** — UI routes, one subtree per module (`admin`, `advisor`, `cleanup`,
   `governance`, `intelligence`, `overview`, `superadmin`, `academy`, `onboarding`, `demo`, …).
   Server Components by default; `'use client'` only where a component actually holds state or
   handles user interaction (AGENTS.md Regla UI). Locale is a routing segment resolved by
   `src/i18n/routing.ts` (`es` default, `en`, `pt-BR`) via `next-intl`.
2. **`src/app/api/**/route.ts`** — backend route handlers, one directory per domain, mirroring the
   UI subtrees plus platform-only concerns (`auth`, `cron`, `webhooks`, `superadmin`, `v1` public
   API). This is the tenant-security boundary — see Auth model below.
3. **`src/services/`** and **`src/modules/`** — business logic and cloud SDK integration, called
   from route handlers, never directly from UI:
   - `src/modules/collectors/azure/` + `azureProvider.ts` + `providerFactory.ts` — Azure SDK
     integration (Resource Graph, Cost Management, Compute, Monitor).
   - `src/modules/core/` — provider-agnostic engines: `focusMapper.ts` (FOCUS 1.0 schema
     normalization), `rightsizingEngine.ts`, `kqlCatalog.ts` (canned Resource Graph KQL queries),
     `aiProvider.ts` (multi-vendor AI chat, see AI section below).
   - `src/modules/storage/` — `db.ts` (MySQL pool, `mysql2`), `migrations.ts` (migration runner),
     `schema.sql` (baseline schema reference — not itself executed; migrations/ is the source of
     truth for changes on top of it).
   - `src/services/` — everything else: `reservationService.ts`, `remediationService.ts`,
     `snapshotService.ts`, etc. — one file per feature domain, called by the matching API routes.

Supporting directories: `src/lib/` (stateless utilities — `requestAuth.ts`, `tierLogic.ts`,
`money.ts`/`fx.ts`/`pricingUnits.ts` for exact-decimal math, `mockData.ts` for demo-tenant data,
`secrets/` for Key Vault access), `src/components/`, `src/context/` (React Context providers, e.g.
tenant/view-mode), `src/store/` (Zustand global state), `src/hooks/`.

### Auth & multi-tenant RBAC (read this before touching any API route)

Every API route that is scoped to a tenant **must** resolve `tenantId` through one of the guards in
`src/lib/requestAuth.ts` — never trust `x-tenant-id` header or `?tenantId=` query param directly:

- `requireRequestIdentity(request)` — validates the Entra ID JWT (RS256, live JWKS fetch against
  `login.microsoftonline.com/{tid}`, audience allow-list, issuer allow-list, clock skew) and returns
  the caller's own `tenantId`/`email`.
- `requireTenantAccess(request, tenantId)` — identity must match `tenantId`, or be a SuperAdmin
  (corporate `@cscloudsolutions.com.ar` domain **and** `system_role = SUPERADMIN` in `Users`).
  Accepts an internal `X-Cron-Auth: <CRON_SECRET>` bypass (timing-safe compare, tenant-scoped only,
  never grants global superadmin) for pre-warm/cron jobs.
- `requireTenantRole(request, tenantId, ['Owner','Admin',...])` — same as above, plus checks the
  caller's row in `Users.role` for the tenant.
- `requireTenantTier(request, tenantId, minTier)` — wraps `requireTenantAccess`, then checks the tenant's
  `Tenants.tier` against `hasAccess()`. **Required on any route serving a feature registered in
  `src/lib/routeTiers.ts`**: `RouteTierGate`/`FeatureGuard`/Sidebar gate the UI only, so without this a
  lower-tier tenant can call the endpoint directly with a valid token (finding SEC-02,
  `docs/security/audit-2026-08-21.md`). Used in 40 route files.
- `requireSuperAdmin(request)` — corporate domain + `SUPERADMIN` system role only.

This is enforced in CI, not just convention: the custom ESLint rule
`local/no-unauth-tenant-id` (`eslint-rules/no-unauth-tenant-id.mjs`, wired in `eslint.config.mjs`
for `src/app/api/**/*.ts`) errors on any handler that reads `tenantId` from client input without one
of these guards present in the same file. It exists to prevent the IDOR class of bug documented in
`docs/security/audit-2026-06-30.md` (findings C-01/C-02). If a route is intentionally public
(pre-login SSO init, etc.), suppress with a justified
`// eslint-disable-next-line local/no-unauth-tenant-id` comment, not by removing the guard.

Azure-side least privilege is tiered (`Professional → Business → Enterprise`), each
tier adding scoped roles (Reader/Cost Management Reader → Tag Contributor → custom power-management
role → custom role with disk/NIC/IP cleanup). Full role matrix and the onboarding
Service-Principal model are in `README.md` under "Authentication & Least Privilege" — check it
before adding any endpoint that calls a new Azure Resource Manager operation, and add the
corresponding role to the SOP/tier config rather than over-provisioning.

### Feature tiers

`src/lib/tierLogic.ts` (`TIERS` map + `hasAccess(currentTier, requiredTier)`) is the single gate
for tier-based feature access, used both server-side (route handlers) and client-side
(`FeatureGuard` component, `RouteTierGate`, `routeTiers.ts`). It fails closed: an unrecognized
`requiredTier` denies access. Every new gated feature needs an entry in the relevant tier
config/route-tier registry, i18n copy for the upsell state, and — per AGENTS.md #13 — mock data for
all four tiers in `src/lib/mockData.ts` so `/demo` can showcase it without live Azure calls.

### Mock-first demo tenants

`isMockTenant(tenantId)` (`src/lib/mockData.ts`) is checked by API routes to short-circuit real
Azure calls and return deterministic synthetic data scaled by tier, so demos work offline.

**Ordering vs. the auth guard is conditional, and the codebase is genuinely split (76 routes mock-first,
70 guard-first).** The rule: put `isMockTenant` before the guard *only if* the mock branch returns
purely synthetic literals. If that branch reads MySQL, Redis, Azure, or any shared state, the guard goes
first — otherwise an anonymous caller passing `?tenantId=demo-x` reaches real state (that was finding
SEC-01 in `docs/security/audit-2026-08-09.md`). Mnemonic: mock-first only if the mock touches nothing real.
See DOC-01 in `docs/security/audit-2026-08-21.md`. When
adding an endpoint, follow the existing pattern: check `isMockTenant` early, return mock payload
with `data.mock === true` (UI shows an amber banner keyed off that flag), otherwise hit the real
service.

### Numeric precision

Regla Cero (AGENTS.md): no floats for money/cost math. Use `decimal.js` (already a dependency) via
the wrappers in `src/lib/money.ts`, `src/lib/fx.ts`, `src/lib/pricingUnits.ts`, and `DECIMAL` columns
in MySQL — never raw JS `number` arithmetic for costs, amortization, or projections. In tests, never
assert `===` against a `number`; convert with `.toString()` or `.toNumber()` first (see
`docs/testing.md`).

### Database & migrations

MySQL via a lazily-created global pool (`src/modules/storage/db.ts`, `mysql2`). Schema changes are
**never** hand-applied — add a file to `migrations/YYYYMMDD-NNN-description.sql`; the runner
(`src/modules/storage/migrations.ts`, invoked by `initializeDatabase()` at boot and via
`npm run migrate`) tracks applied files by checksum in `SchemaMigrations` and tolerates
already-applied idempotent errors (`ER_DUP_FIELDNAME`, `ER_DUP_KEYNAME`, `ER_TABLE_EXISTS_ERROR`,
`ER_DUP_ENTRY`, `ER_CANT_DROP_FIELD_OR_KEY`). Write migrations idempotently
(`CREATE TABLE IF NOT EXISTS`, etc.) — see `migrations/README.md` and `directivas/agent_dba_SOP.md`.

### i18n

`next-intl`, locales `es` (default) `en` `pt-BR`, dictionaries in `messages/*.json`. Keys must stay
in parity across all three files for every UI change — no hardcoded user-facing strings, always
`useTranslations()`.

### Cron jobs

Internal endpoints under `src/app/api/cron/`, protected by `Authorization: Bearer $CRON_SECRET`
(not a tenant JWT), invoked from the VPS crontab. Current jobs: `sync` (daily cost snapshot),
`prewarm-dashboard` (10 min, warms SWR cache, propagates `X-Cron-Auth` for the `requireTenantAccess`
bypass), `power-schedules` (10 min, executes due VM shutdown/startup schedules). See README.md
"Cron Jobs" for the full table and crontab example before adding a new one.

### AI integration

`src/modules/core/aiProvider.ts` abstracts multiple backends (`@ai-sdk/anthropic`, `@ai-sdk/azure`,
`@ai-sdk/google`, `@ai-sdk/openai`) selected via `AI_PROVIDER` env var; includes exponential backoff
for Gemini 429s. Used by the context-aware FinOps chatbot and the M365 Copilot RAG integration.

## Documentation map

- `README.md` — architecture diagram, directory tree, full RBAC/role matrix, diagnostic endpoints,
  cron table, and a running changelog of major features (kept current per AGENTS.md #3/#7 — update
  it alongside any user- or admin-visible change).
- `MANUAL_DE_USUARIO.md` — end-user facing manual.
- `directivas/*_SOP.md` — one Standard Operating Procedure per feature/module: gotchas, known
  restrictions, implementation context. Consult the relevant SOP before touching that feature;
  `directivas/README.md` indexes the most-referenced ones. Don't delete SOPs without review.
- `docs/*.md` — deep technical guides (testing, MFA, SSO, marketplace, forecasting-ml, FOCUS
  exporter, Key Vault, etc.) and `docs/security/audit-YYYY-MM-DD.md` biweekly security audit
  reports (AGENTS.md #14).
- `.env.example` — canonical list of required environment variables (Azure AD/MSAL, MySQL, Paddle
  billing, Redis, WorkOS SSO, SMTP, Azure Key Vault, Azure Marketplace).
