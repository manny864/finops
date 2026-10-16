// @vitest-environment node
import crypto from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let db: Pool;
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: Parameters<Pool["query"]>) => db.query(...args) },
    initializeDatabase: async () => {},
}));
vi.mock("next-intl/server", () => ({
    getTranslations: async () => (key: string) => key,
}));

import { GET as report } from "@/app/api/admin/audit-trail/route";
import { GET as reportLegacy } from "@/app/api/admin/audit/route";
import { GET as exportTrail } from "@/app/api/admin/audit-trail/export/route";
import { GET as exportLegacy } from "@/app/api/admin/audit/export/route";
import { GET as billing } from "@/app/api/admin/billing/route";
import { aiCacheGet, aiCacheKey, aiCacheSet } from "@/lib/aiCache";
import { PUT as saveMarkup } from "@/app/api/admin/config/markup/route";
import { POST as saveLegacyMarkup } from "@/app/api/admin/billing-markup/route";
import { POST as issueChallenge } from "@/app/api/mfa/challenge/route";
import { markupStepUpPayload, type SaveMarkupPayload } from "@/types/tenantPartnerMarkup.types";
import { PATCH as changePlan, DELETE as cancelPlan } from "@/app/api/billing/subscription/route";
import { cancellationStepUpPayload, planChangeStepUpPayload, type SubscriptionPlanChange } from "@/types/saasBilling.types";

const tenants = [
    { id: "a0000000-0000-4000-8000-000000000001", email: "reader@alpha.example", marker: "alpha-only-record" },
    { id: "b0000000-0000-4000-8000-000000000002", email: "reader@beta.example", marker: "beta-only-record" },
];
const audience = "tenant-matrix-synthetic-client";
const database = `finops_tenant_matrix_${process.pid}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "tenant-matrix-test", kty: "RSA" };
const paddleRequest = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>();

function request(path: string, target: string, identity?: typeof tenants[number], extra = "") {
    const headers = new Headers();
    if (identity) {
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({
            tid: identity.id, oid: identity.id, aud: audience,
            iss: `https://login.microsoftonline.com/${identity.id}/v2.0`,
            exp: Math.floor(Date.now() / 1000) + 3600,
            preferred_username: identity.email,
        })).toString("base64url");
        const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
        headers.set("authorization", `Bearer ${header}.${payload}.${signature}`);
    }
    return new NextRequest(`https://example.test${path}?tenantId=${target}${extra}`, { headers });
}

// Never uses application DB credentials; only a dedicated, disposable local MySQL.
describe.skipIf(!process.env.MYSQL_SECURITY_PORT)("tenant audit isolation with signed identities and real MySQL", () => {
    let admin: Pool;
    beforeAll(async () => {
        vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", audience);
        vi.stubEnv("CRON_SECRET", "");
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            if (url.origin === "https://sandbox-api.paddle.com") return paddleRequest(url, init);
            if (url.hostname !== "login.microsoftonline.com") throw new Error(`Unexpected network request: ${url.origin}`);
            const tenant = tenants.find((item) => url.pathname.startsWith(`/${item.id}/`));
            if (!tenant) throw new Error("Unexpected OIDC tenant");
            if (url.pathname.endsWith("/.well-known/openid-configuration")) {
                return Response.json({ issuer: `https://login.microsoftonline.com/${tenant.id}/v2.0`,
                    jwks_uri: `https://login.microsoftonline.com/${tenant.id}/discovery/v2.0/keys` });
            }
            if (!url.pathname.endsWith("/discovery/v2.0/keys")) throw new Error("Unexpected OIDC endpoint");
            return Response.json({ keys: [key] });
        }));
        admin = mysql.createPool({ host: "127.0.0.1", user: "root", password: "",
            port: Number(process.env.MYSQL_SECURITY_PORT) });
        await admin.query(`CREATE DATABASE ${database}`);
        db = mysql.createPool({ host: "127.0.0.1", user: "root", password: "",
            port: Number(process.env.MYSQL_SECURITY_PORT), database, timezone: "Z" });
        await db.query(`CREATE TABLE Users (
            tenant_id VARCHAR(64), email VARCHAR(120), entra_oid VARCHAR(64),
            role VARCHAR(40), account_status VARCHAR(20), system_role VARCHAR(40), mfa_enabled BOOLEAN DEFAULT false)`);
        await db.query(`CREATE TABLE UserScopes (
            tenant_id VARCHAR(64), user_email VARCHAR(120), perspective_id INT, group_name VARCHAR(120))`);
        await db.query(`CREATE TABLE ActionLogs (
            id INT PRIMARY KEY AUTO_INCREMENT, tenant_id VARCHAR(64), user_email VARCHAR(120),
            user_name VARCHAR(120), ip_address VARCHAR(64), user_agent TEXT, action_type VARCHAR(64),
            resource_id VARCHAR(512), resource_name VARCHAR(120), status VARCHAR(32),
            error_message TEXT, metadata_json JSON, created_at DATETIME, timestamp DATETIME)`);
        await db.query(`CREATE TABLE AiCache (
            hash_prompt VARCHAR(64) PRIMARY KEY, tenant_id VARCHAR(64), response_text TEXT,
            created_at DATETIME, expires_at DATETIME)`);
        await db.query(`CREATE TABLE Tenants (
            tenant_id VARCHAR(64) PRIMARY KEY, tier VARCHAR(40), subscription_status VARCHAR(40),
            marketplace_plan_id VARCHAR(64), marketplace_source VARCHAR(40),
            paddle_subscription_id VARCHAR(64), company_name VARCHAR(120), cancel_at_period_end BOOLEAN,
            markup_percentage DECIMAL(5,2) DEFAULT 0, management_fee_usd DECIMAL(12,2) DEFAULT 0,
            markup_enabled BOOLEAN DEFAULT true)`);
        await db.query(`CREATE TABLE BillingTransactions (
            id INT PRIMARY KEY AUTO_INCREMENT, tenant_id VARCHAR(64), paddle_transaction_id VARCHAR(120),
            amount DECIMAL(12,2), currency VARCHAR(3), status VARCHAR(40),
            raw_event JSON, billed_at DATETIME, created_at DATETIME)`);
        await db.query("CREATE TABLE CancellationRequests (id INT PRIMARY KEY, tenant_id VARCHAR(64), status VARCHAR(40))");
        await db.query(`CREATE TABLE MfaChallenges (
            id VARCHAR(64) PRIMARY KEY, user_email VARCHAR(120), tenant_id VARCHAR(64),
            operation VARCHAR(64), payload_hash VARCHAR(64), consumed_at DATETIME, expires_at DATETIME)`);
        for (const tenant of tenants) {
            await db.query(`INSERT INTO Users (tenant_id, email, entra_oid, role, account_status, system_role)
                VALUES (?, ?, ?, 'Reader', 'ACTIVE', NULL)`,
                [tenant.id, tenant.email, tenant.id]);
            await db.query(`INSERT INTO ActionLogs
                (tenant_id, user_email, resource_id, resource_name, action_type, status, created_at, timestamp)
                VALUES (?, ?, ?, ?, 'START_VM', 'SUCCESS', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
                [tenant.id, tenant.email, `/${tenant.marker}`, tenant.marker]);
            await db.query(`INSERT INTO Tenants
                (tenant_id, tier, subscription_status, company_name, cancel_at_period_end)
                VALUES (?, 'Business', 'ACTIVE', ?, false)`, [tenant.id, tenant.marker]);
            await db.query(`INSERT INTO BillingTransactions
                (tenant_id, paddle_transaction_id, amount, currency, status, billed_at, created_at)
                VALUES (?, ?, 100.00, 'USD', 'completed', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
                [tenant.id, `transaction-${tenant.marker}`]);
        }
    });
    afterAll(async () => {
        await db?.end();
        try {
            if (admin) await admin.query(`DROP DATABASE IF EXISTS ${database}`);
        } finally {
            await admin?.end();
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
        }
    });

    const routes = [
        { path: "/api/admin/audit-trail", handler: report, formats: [""] },
        { path: "/api/admin/audit", handler: reportLegacy, formats: ["json", "ndjson", "csv"] },
        { path: "/api/admin/audit-trail/export", handler: exportTrail, formats: ["json", "ndjson", "csv"] },
        { path: "/api/admin/audit/export", handler: exportLegacy, formats: ["json", "ndjson", "csv"] },
        { path: "/api/admin/billing", handler: billing, formats: ["json"] },
    ];
    for (const route of routes) {
        for (const format of route.formats) {
            it(`${route.path} ${format}: concurrent readers only receive their own data`, async () => {
                await Promise.all(tenants.map(async (tenant, index) => {
                    for (const mock of ["", "&mock=true"]) {
                        const response = await route.handler(request(route.path, tenant.id, tenant, `&format=${format}${mock}`));
                        expect(response.status).toBe(200);
                        const text = await response.text();
                        expect(text).toContain(tenant.marker);
                        expect(text).not.toContain(tenants[1 - index].marker);
                        if (route.handler === report) expect(JSON.parse(text).totalCount).toBe(1);
                        if (route.handler === reportLegacy && format === "json") expect(JSON.parse(text).total).toBe(1);
                        if (route.handler === billing) {
                            expect(JSON.parse(text).invoices).toMatchObject([
                                { paddleTransactionId: `transaction-${tenant.marker}`, amount: 100 },
                            ]);
                        }
                    }
                }));
            });
        }
        it(`${route.path}: neither tenantId nor mock=true bypasses identity/tenant authorization`, async () => {
            for (const extra of ["", "&mock=true"]) {
                for (const tenant of tenants) {
                    const anonymous = await route.handler(request(route.path, tenant.id, undefined, extra));
                    expect(anonymous.status).toBe(401);
                    for (const marker of tenants.map((item) => item.marker)) {
                        expect(await anonymous.clone().text()).not.toContain(marker);
                    }
                    const other = tenants.find((item) => item.id !== tenant.id)!;
                    const denied = await route.handler(request(route.path, tenant.id, other, extra));
                    expect(denied.status).toBe(403);
                    expect(await denied.text()).not.toContain(tenant.marker);
                }
            }
        });
        it(`${route.path}: disabling a provisioned reader revokes an otherwise valid token`, async () => {
            const tenant = tenants[0];
            await db.query("UPDATE Users SET account_status='DISABLED' WHERE tenant_id=?", [tenant.id]);
            try {
                const response = await route.handler(request(route.path, tenant.id, tenant, "&mock=true"));
                expect(response.status).toBe(403);
                expect(await response.text()).not.toContain(tenant.marker);
            } finally {
                await db.query("UPDATE Users SET account_status='ACTIVE' WHERE tenant_id=?", [tenant.id]);
            }
        });
        if (route.handler !== billing) it(`${route.path}: another tenant's email and SQL metacharacters cannot expand the report`, async () => {
            for (const filter of [tenants[1].email, "' OR 1=1 -- "]) {
                const response = await route.handler(request(route.path, tenants[0].id, tenants[0],
                    `&format=json&userEmail=${encodeURIComponent(filter)}`));
                expect(response.status).toBe(200);
                const text = await response.text();
                for (const tenant of tenants) expect(text).not.toContain(tenant.marker);
                if (route.handler === report) expect(JSON.parse(text).totalCount).toBe(0);
                if (route.handler === reportLegacy) expect(JSON.parse(text).total).toBe(0);
            }
        });
        it(`${route.path}: preserves explicitly granted active membership in another tenant`, async () => {
            const [a, b] = tenants;
            await db.query(`INSERT INTO Users (tenant_id, email, entra_oid, role, account_status, system_role)
                VALUES (?, ?, ?, 'Reader', 'ACTIVE', NULL)`,
                [b.id, a.email, a.id]);
            try {
                const response = await route.handler(request(route.path, b.id, a, "&format=json&mock=true"));
                expect(response.status).toBe(200);
                const text = await response.text();
                expect(text).toContain(b.marker);
                expect(text).not.toContain(a.marker);
            } finally {
                await db.query("DELETE FROM Users WHERE tenant_id=? AND email=?", [b.id, a.email]);
            }
        });
    }
    it("AiCache isolates identical payloads and refuses cross-tenant read/overwrite under real SQL", async () => {
        const [a, b] = tenants;
        const aKey = aiCacheKey(a.id, "same-prompt", "same-model");
        const bKey = aiCacheKey(b.id, "same-prompt", "same-model");
        expect(aKey).not.toBe(bKey);
        await Promise.all([aiCacheSet(a.id, aKey, a.marker), aiCacheSet(b.id, bKey, b.marker)]);
        expect(await aiCacheGet(a.id, aKey)).toBe(a.marker);
        expect(await aiCacheGet(b.id, bKey)).toBe(b.marker);
        expect(await aiCacheGet(b.id, aKey)).toBeNull();
        expect(await aiCacheGet(a.id, bKey)).toBeNull();
        await aiCacheSet(b.id, aKey, "cross-tenant-poison");
        expect(await aiCacheGet(a.id, aKey)).toBe(a.marker);
        expect(await aiCacheGet(b.id, aKey)).toBeNull();
    });

    describe("billing step-up binds the exact mutation", () => {
        const settings: SaveMarkupPayload = {
            globalMarkupPercentage: 15, fixedManagementFeeUSD: 500, isMarkupEnabled: true,
        };
        const [actor, other] = tenants;
        function mutation(path: string, body: { tenantId: string; [key: string]: unknown },
            method: string, challenge?: string) {
            const headers = new Headers(request(path, body.tenantId, actor).headers);
            headers.set("content-type", "application/json");
            if (challenge) headers.set("X-MFA-Challenge-Id", challenge);
            return new NextRequest(`https://example.test${path}?tenantId=${encodeURIComponent(body.tenantId)}`,
                { method, headers, body: JSON.stringify(body) });
        }
        async function challenge(payload: unknown, operation = "change_billing_config") {
            const response = await issueChallenge(mutation("/api/mfa/challenge",
                { tenantId: actor.id, operation, payload }, "POST"));
            expect(response.status).toBe(200);
            const { challenge_id: id } = await response.json() as { challenge_id: string };
            // Seed a successful factor verification; factor verification itself has a separate suite.
            await db.query("UPDATE MfaChallenges SET consumed_at=UTC_TIMESTAMP() WHERE id=?", [id]);
            return id;
        }
        async function saved() {
            const [rows] = await db.query<RowDataPacket[]>(
                "SELECT markup_percentage, management_fee_usd, markup_enabled FROM Tenants WHERE tenant_id=?", [actor.id]);
            return {
                globalMarkupPercentage: Number(rows[0].markup_percentage),
                fixedManagementFeeUSD: Number(rows[0].management_fee_usd),
                isMarkupEnabled: Boolean(rows[0].markup_enabled),
            };
        }
        beforeEach(async () => {
            vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_synthetic-test-only");
            vi.stubEnv("NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY", "pri_synthetic_business_monthly");
            vi.stubEnv("NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY", "pri_synthetic_business_yearly");
            vi.stubEnv("NEXT_PUBLIC_PADDLE_PRO_MONTHLY", "pri_synthetic_pro_monthly");
            paddleRequest.mockReset().mockImplementation(async () => Response.json({ data: {} }));
            await db.query("UPDATE Users SET role='Admin', mfa_enabled=true WHERE tenant_id=?", [actor.id]);
            await db.query("UPDATE Tenants SET tier='Enterprise', markup_percentage=0, management_fee_usd=0, markup_enabled=true");
            await db.query("UPDATE Tenants SET paddle_subscription_id=? WHERE tenant_id=?",
                ["sub_synthetic_actor", actor.id]);
            await db.query("DELETE FROM MfaChallenges");
        });
        afterEach(async () => {
            await db.query("UPDATE Users SET role='Reader', mfa_enabled=false WHERE tenant_id=?", [actor.id]);
        });
        it.each([
            ["percentage", { globalMarkupPercentage: 16 }],
            ["fee", { fixedManagementFeeUSD: 501 }],
            ["enabled flag", { isMarkupEnabled: false }],
        ])("rejects a different %s without consuming the correctly bound challenge", async (_field, changed) => {
            const id = await challenge(markupStepUpPayload(actor.id, settings));
            const response = await saveMarkup(mutation("/api/admin/config/markup",
                { tenantId: actor.id, ...settings, ...changed }, "PUT", id));
            expect(response.status).toBe(403);
            expect(await saved()).toEqual({ globalMarkupPercentage: 0, fixedManagementFeeUSD: 0, isMarkupEnabled: true });
            const valid = await saveMarkup(mutation("/api/admin/config/markup",
                { tenantId: actor.id, ...settings }, "PUT", id));
            expect(valid.status).toBe(200);
            expect(await saved()).toEqual(settings);
        });
        it("rejects tenant-only, other target, action and operation bindings", async () => {
            for (const payload of [
                { tenantId: actor.id },
                markupStepUpPayload(other.id, settings),
                { ...markupStepUpPayload(actor.id, settings), action: "another_action" },
            ]) {
                const id = await challenge(payload);
                expect((await saveMarkup(mutation("/api/admin/config/markup",
                    { tenantId: actor.id, ...settings }, "PUT", id))).status).toBe(403);
            }
            const id = await challenge(markupStepUpPayload(actor.id, settings), "another_operation");
            expect((await saveMarkup(mutation("/api/admin/config/markup",
                { tenantId: actor.id, ...settings }, "PUT", id))).status).toBe(403);
            expect((await saved()).globalMarkupPercentage).toBe(0);
        });
        it("allows only one concurrent mutation per verified challenge", async () => {
            const id = await challenge(markupStepUpPayload(actor.id, settings));
            const results = await Promise.all(Array.from({ length: 8 }, () => saveMarkup(
                mutation("/api/admin/config/markup", { tenantId: actor.id, ...settings }, "PUT", id))));
            expect(results.filter((response) => response.status === 200)).toHaveLength(1);
            expect(results.filter((response) => response.status === 403)).toHaveLength(7);
            expect(await saved()).toEqual(settings);
        });
        it("normalizes omitted enabled=true and rejects invalid input/plan before consuming MFA", async () => {
            const id = await challenge(markupStepUpPayload(actor.id, settings));
            for (const changed of [{ isMarkupEnabled: "true" }, { globalMarkupPercentage: -1 }, { fixedManagementFeeUSD: -1 }]) {
                expect((await saveMarkup(mutation("/api/admin/config/markup",
                    { tenantId: actor.id, ...settings, ...changed }, "PUT", id))).status).toBe(400);
            }
            await db.query("UPDATE Tenants SET tier='Business' WHERE tenant_id=?", [actor.id]);
            expect((await saveMarkup(mutation("/api/admin/config/markup",
                { tenantId: actor.id, ...settings }, "PUT", id))).status).toBe(403);
            await db.query("UPDATE Tenants SET tier='Enterprise' WHERE tenant_id=?", [actor.id]);
            const { isMarkupEnabled: _enabled, ...withoutDefault } = settings;
            expect((await saveMarkup(mutation("/api/admin/config/markup",
                { tenantId: actor.id, ...withoutDefault }, "PUT", id))).status).toBe(200);
            expect(await saved()).toEqual(settings);
        });
        it("legacy writes require Admin/Owner and a distinct amount-bound challenge", async () => {
            const id = await challenge({ action: "set_legacy_markup", tenantId: actor.id, markupPercentage: 25 });
            await db.query("UPDATE Users SET role='Reader' WHERE tenant_id=?", [actor.id]);
            expect((await saveLegacyMarkup(mutation("/api/admin/billing-markup",
                { tenantId: actor.id, markupPercentage: 25 }, "POST", id))).status).toBe(403);
            await db.query("UPDATE Users SET role='Owner' WHERE tenant_id=?", [actor.id]);
            expect((await saveLegacyMarkup(mutation("/api/admin/billing-markup",
                { tenantId: actor.id, markupPercentage: 26 }, "POST", id))).status).toBe(403);
            expect((await saveLegacyMarkup(mutation("/api/admin/billing-markup",
                { tenantId: actor.id, markupPercentage: 1000 }, "POST", id))).status).toBe(400);
            expect((await saveLegacyMarkup(mutation("/api/admin/billing-markup",
                { tenantId: actor.id, markupPercentage: 25 }, "POST", id))).status).toBe(200);
            expect((await saved()).globalMarkupPercentage).toBe(25);
            const canonicalId = await challenge(markupStepUpPayload(actor.id, settings));
            expect((await saveLegacyMarkup(mutation("/api/admin/billing-markup",
                { tenantId: actor.id, markupPercentage: 15 }, "POST", canonicalId))).status).toBe(403);
        });
        it("preserves opt-in MFA for an authorized administrator without MFA enabled", async () => {
            await db.query("UPDATE Users SET mfa_enabled=false WHERE tenant_id=?", [actor.id]);
            const response = await saveMarkup(mutation("/api/admin/config/markup",
                { tenantId: actor.id, ...settings }, "PUT"));
            expect(response.status).toBe(200);
            expect(await saved()).toEqual(settings);
        });
        const change: SubscriptionPlanChange = {
            newTier: "Business", billing: "monthly", prorationBillingMode: "prorated_immediately",
        };
        it.each([
            ["tier", { newTier: "Professional" }],
            ["billing cycle", { billing: "yearly" }],
            ["proration", { prorationBillingMode: "do_not_bill" }],
        ])("plan change rejects a different %s before any provider request", async (_field, changed) => {
            const id = await challenge(planChangeStepUpPayload(actor.id, change), "change_plan");
            expect((await changePlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, ...change, ...changed }, "PATCH", id))).status).toBe(403);
            expect(paddleRequest).not.toHaveBeenCalled();
            expect((await changePlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, ...change }, "PATCH", id))).status).toBe(200);
            expect(paddleRequest).toHaveBeenCalledOnce();
            const [url, options] = paddleRequest.mock.calls[0];
            expect(url.pathname).toBe("/subscriptions/sub_synthetic_actor");
            expect(JSON.parse(String(options?.body))).toEqual({
                items: [{ price_id: "pri_synthetic_business_monthly", quantity: 1 }],
                proration_billing_mode: "prorated_immediately",
            });
        });
        it("cancellation binds effective time and never simulates success without provider credentials", async () => {
            const id = await challenge(cancellationStepUpPayload(actor.id, "next_billing_period"), "cancel_subscription");
            expect((await cancelPlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, effective: "immediately" }, "DELETE", id))).status).toBe(403);
            expect(paddleRequest).not.toHaveBeenCalled();
            vi.stubEnv("PADDLE_API_KEY", "");
            expect((await cancelPlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, effective: "next_billing_period" }, "DELETE", id))).status).toBe(503);
            expect(paddleRequest).not.toHaveBeenCalled();
            const [rows] = await db.query<RowDataPacket[]>("SELECT subscription_status FROM Tenants WHERE tenant_id=?", [actor.id]);
            expect(rows[0].subscription_status).toBe("ACTIVE");
            vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_synthetic-test-only");
            expect((await cancelPlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, effective: "next_billing_period" }, "DELETE", id))).status).toBe(200);
            expect(paddleRequest).toHaveBeenCalledOnce();
            const [url, options] = paddleRequest.mock.calls[0];
            expect(url.pathname).toBe("/subscriptions/sub_synthetic_actor/cancel");
            expect(JSON.parse(String(options?.body))).toEqual({ effective_from: "next_billing_period" });
            expect((await cancelPlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, effective: "next_billing_period" }, "DELETE", id))).status).toBe(403);
            expect(paddleRequest).toHaveBeenCalledOnce();
        });
        it("plan input and missing configuration fail before MFA consumption; omitted proration is normalized", async () => {
            const id = await challenge(planChangeStepUpPayload(actor.id, change), "change_plan");
            for (const changed of [{ newTier: "Enterprise" }, { billing: "invalid" }, { prorationBillingMode: null }]) {
                expect((await changePlan(mutation("/api/billing/subscription",
                    { tenantId: actor.id, ...change, ...changed }, "PATCH", id))).status).toBe(400);
            }
            vi.stubEnv("PADDLE_API_KEY", "");
            expect((await changePlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, ...change }, "PATCH", id))).status).toBe(500);
            vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_synthetic-test-only");
            const { prorationBillingMode: _proration, ...withoutDefault } = change;
            expect((await changePlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, ...withoutDefault }, "PATCH", id))).status).toBe(200);
            expect(paddleRequest).toHaveBeenCalledOnce();
        });
        it("plan/cancel mutations reject the old tenant-only payload", async () => {
            for (const operation of ["change_plan", "cancel_subscription"]) {
                const id = await challenge({ tenantId: actor.id }, operation);
                const body = operation === "change_plan" ? { ...change } : { effective: "immediately" };
                const handler = operation === "change_plan" ? changePlan : cancelPlan;
                const method = operation === "change_plan" ? "PATCH" : "DELETE";
                expect((await handler(mutation("/api/billing/subscription",
                    { tenantId: actor.id, ...body }, method, id))).status).toBe(403);
            }
            expect(paddleRequest).not.toHaveBeenCalled();
        });
        it("allows exactly one concurrent plan request to reach the provider", async () => {
            const id = await challenge(planChangeStepUpPayload(actor.id, change), "change_plan");
            const results = await Promise.all(Array.from({ length: 8 }, () => changePlan(mutation(
                "/api/billing/subscription", { tenantId: actor.id, ...change }, "PATCH", id,
            ))));
            expect(results.filter((result) => result.status === 200)).toHaveLength(1);
            expect(results.filter((result) => result.status === 403)).toHaveLength(7);
            expect(paddleRequest).toHaveBeenCalledOnce();
        });
        it("normalizes omitted cancellation timing and preserves local state on provider rejection", async () => {
            const id = await challenge(cancellationStepUpPayload(actor.id, "immediately"), "cancel_subscription");
            expect((await cancelPlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, effective: null }, "DELETE", id))).status).toBe(400);
            expect(paddleRequest).not.toHaveBeenCalled();
            paddleRequest.mockImplementation(async () => Response.json({ error: { detail: "Synthetic rejection" } }, { status: 400 }));
            const response = await cancelPlan(mutation("/api/billing/subscription", { tenantId: actor.id }, "DELETE", id));
            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ error: "Fallo al cancelar suscripción en Paddle" });
            expect(JSON.parse(String(paddleRequest.mock.calls[0][1]?.body))).toEqual({ effective_from: "immediately" });
            const [rows] = await db.query<RowDataPacket[]>("SELECT subscription_status FROM Tenants WHERE tenant_id=?", [actor.id]);
            expect(rows[0].subscription_status).toBe("ACTIVE");
            expect((await cancelPlan(mutation("/api/billing/subscription", { tenantId: actor.id }, "DELETE", id))).status).toBe(403);
            expect(paddleRequest).toHaveBeenCalledOnce();
        });
        it("does not let a Reader reach either provider mutation", async () => {
            await db.query("UPDATE Users SET role='Reader' WHERE tenant_id=?", [actor.id]);
            expect((await changePlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, ...change }, "PATCH"))).status).toBe(403);
            expect((await cancelPlan(mutation("/api/billing/subscription",
                { tenantId: actor.id, effective: "immediately" }, "DELETE"))).status).toBe(403);
            expect(paddleRequest).not.toHaveBeenCalled();
        });
    });
});
