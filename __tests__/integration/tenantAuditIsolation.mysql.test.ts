// @vitest-environment node
import crypto from "node:crypto";
import mysql, { type Pool } from "mysql2/promise";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let db: Pool;
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: Parameters<Pool["query"]>) => db.query(...args) },
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

const tenants = [
    { id: "a0000000-0000-4000-8000-000000000001", email: "reader@alpha.example", marker: "alpha-only-record" },
    { id: "b0000000-0000-4000-8000-000000000002", email: "reader@beta.example", marker: "beta-only-record" },
];
const audience = "tenant-matrix-synthetic-client";
const database = `finops_tenant_matrix_${process.pid}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "tenant-matrix-test", kty: "RSA" };

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
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
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
            port: Number(process.env.MYSQL_SECURITY_PORT), database });
        await db.query(`CREATE TABLE Users (
            tenant_id VARCHAR(64), email VARCHAR(120), entra_oid VARCHAR(64),
            role VARCHAR(40), account_status VARCHAR(20), system_role VARCHAR(40))`);
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
            paddle_subscription_id VARCHAR(64), company_name VARCHAR(120), cancel_at_period_end BOOLEAN)`);
        await db.query(`CREATE TABLE BillingTransactions (
            id INT PRIMARY KEY AUTO_INCREMENT, tenant_id VARCHAR(64), paddle_transaction_id VARCHAR(120),
            amount DECIMAL(12,2), currency VARCHAR(3), status VARCHAR(40),
            raw_event JSON, billed_at DATETIME, created_at DATETIME)`);
        await db.query("CREATE TABLE CancellationRequests (id INT PRIMARY KEY, tenant_id VARCHAR(64), status VARCHAR(40))");
        for (const tenant of tenants) {
            await db.query("INSERT INTO Users VALUES (?, ?, ?, 'Reader', 'ACTIVE', NULL)",
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
            await db.query("INSERT INTO Users VALUES (?, ?, ?, 'Reader', 'ACTIVE', NULL)",
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
});
