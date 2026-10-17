// @vitest-environment node
import crypto from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * STRIDE-03 — las rutas de `/api/tenants` que dan de alta tenants y usuarios.
 *
 *  - `POST /api/tenants` (lo llama `AuthSync` en cada login) hacía `INSERT IGNORE INTO Tenants (tenant_id, company_name)`.
 *    En el esquema REAL (migraciones aplicadas el 2026-10-17) esa fila nace `subscription_status='ACTIVE'` y
 *    `tier='Professional'`: un tenant activo sin pasar por el checkout, saltándose el alta controlada de `/api/onboard`.
 *  - `GET /api/tenants` vinculaba a quien no tenía fila con `role='Admin'`, sin límite del plan y sin la regla «el primero
 *    es Owner, los demás Reader». Como `Users.role` también tiene `DEFAULT 'Admin'`, cualquier INSERT que omita el rol
 *    produce un Admin.
 *
 * Misma regla de admisión que el login y el guard: `altaDeMiembro` (primero Owner, resto Reader, con cupo del plan).
 *
 * Los valores por defecto del esquema de abajo son los REALES, verificados aplicando las migraciones del repo a un MySQL
 * descartable. Sólo usa un MySQL local descartable (MYSQL_SECURITY_PORT); nunca credenciales ni datos de la aplicación.
 */
let db: Pool;
vi.mock("@/modules/storage/db", () => ({
    default: {
        query: (...args: Parameters<Pool["query"]>) => db.query(...args),
        getConnection: () => db.getConnection(),
    },
    initializeDatabase: async () => {},
}));
vi.mock("@/lib/rateLimiter", () => ({
    default: { checkByKeyDistributed: async () => ({ allowed: true, remaining: 99, resetAt: new Date() }) },
}));
vi.mock("@/lib/emailHelper", () => ({
    sendEmailAsync: vi.fn(),
    getWelcomeEmailHtml: vi.fn(() => ""),
    getInternalSignupAlertEmailHtml: vi.fn(() => ""),
}));

import { GET as listarTenants, POST as sincronizarTenant } from "@/app/api/tenants/route";
import { POST as onboard } from "@/app/api/onboard/route";

const ALPHA = "a0000000-0000-4000-8000-000000000001";
const BETA = "b0000000-0000-4000-8000-000000000002";
const audience = "tenants-alta-synthetic-client";
const database = `finops_tenants_alta_${process.pid}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "tenants-alta-test", kty: "RSA" };

type Who = { tid: string; oid: string; email: string };
const quien = (tid: string, n: string): Who => ({ tid, oid: `oid-${n}`, email: `${n}@example.test` });

function bearer(who: Who) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
        tid: who.tid, oid: who.oid, aud: audience,
        iss: `https://login.microsoftonline.com/${who.tid}/v2.0`,
        exp: Math.floor(Date.now() / 1000) + 3600, preferred_username: who.email,
    })).toString("base64url");
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
    return `Bearer ${header}.${payload}.${signature}`;
}

async function get(who: Who) {
    const res = await listarTenants(new NextRequest("https://example.test/api/tenants", { headers: { authorization: bearer(who) } }));
    return { status: res.status, body: await res.json() };
}
async function post(who: Who, tenantId = who.tid) {
    const res = await sincronizarTenant(new NextRequest("https://example.test/api/tenants", {
        method: "POST", headers: { authorization: bearer(who), "content-type": "application/json" },
        body: JSON.stringify({ tenantId, name: "example.test" }),
    }));
    return { status: res.status, body: await res.json() };
}
async function login(who: Who) {
    const res = await onboard(new NextRequest("https://example.test/api/onboard", {
        method: "POST", headers: { authorization: bearer(who), "content-type": "application/json" },
        body: JSON.stringify({ plan: null }),
    }));
    return res.status;
}

async function tenant(id: string, tier = "Professional", status = "ACTIVE") {
    await db.query("INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status) VALUES (?, 'x', ?, ?)", [id, tier, status]);
}
async function fila(who: Who, role = "Reader", status = "ACTIVE") {
    await db.query("INSERT INTO Users (entra_oid, tenant_id, email, role, account_status) VALUES (?, ?, ?, ?, ?)",
        [who.oid, who.tid, who.email, role, status]);
}
async function filaDe(who: Who) {
    const [rows] = await db.query<RowDataPacket[]>(
        "SELECT role, account_status FROM Users WHERE tenant_id = ? AND entra_oid = ?", [who.tid, who.oid]);
    return rows[0];
}
async function cuantosUsuarios(tenantId: string) {
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM Users WHERE tenant_id = ?", [tenantId]);
    return Number(rows[0].n);
}

describe.skipIf(!process.env.MYSQL_SECURITY_PORT)("/api/tenants: alta de tenants y de usuarios con MySQL real", () => {
    let admin: Pool;
    beforeAll(async () => {
        vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", audience);
        vi.stubEnv("CRON_SECRET", "");
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            if (url.hostname !== "login.microsoftonline.com") throw new Error(`Unexpected network request: ${url.origin}`);
            const t = [ALPHA, BETA].find((id) => url.pathname.startsWith(`/${id}/`));
            if (!t) throw new Error("Unexpected OIDC tenant");
            if (url.pathname.endsWith("/.well-known/openid-configuration")) {
                return Response.json({ issuer: `https://login.microsoftonline.com/${t}/v2.0`,
                    jwks_uri: `https://login.microsoftonline.com/${t}/discovery/v2.0/keys` });
            }
            return Response.json({ keys: [key] });
        }));
        const conn = { host: "127.0.0.1", user: "root", password: "", port: Number(process.env.MYSQL_SECURITY_PORT) };
        admin = mysql.createPool(conn);
        await admin.query(`CREATE DATABASE ${database}`);
        db = mysql.createPool({ ...conn, database, timezone: "Z" });
        // Valores por defecto REALES: Users.role = 'Admin', Tenants.subscription_status = 'ACTIVE', tier = 'Professional'.
        await db.query(`CREATE TABLE Tenants (
            tenant_id VARCHAR(255) PRIMARY KEY, company_name VARCHAR(255), client_id VARCHAR(255), client_secret TEXT,
            tier ENUM('Professional','Business','Enterprise') DEFAULT 'Professional', trial_ends_at DATETIME NULL,
            subscription_status ENUM('TRIAL','ACTIVE','PAST_DUE','CANCELED','EXPIRED') DEFAULT 'ACTIVE',
            access_until DATETIME NULL, is_onboarded TINYINT(1) DEFAULT 0, paddle_subscription_id VARCHAR(255),
            partner_link_status VARCHAR(40), partner_link_detail VARCHAR(255), provider VARCHAR(40),
            provider_archived TINYINT(1) DEFAULT 0, provider_purge_at DATETIME NULL, timezone VARCHAR(64),
            logo_stored_name VARCHAR(255), ai_anomaly_sensitivity VARCHAR(20), ai_share_resource_names BOOLEAN,
            ai_share_tags BOOLEAN, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await db.query(`CREATE TABLE Users (
            id INT AUTO_INCREMENT PRIMARY KEY, entra_oid VARCHAR(255), tenant_id VARCHAR(255), email VARCHAR(255),
            display_name VARCHAR(255), role VARCHAR(50) DEFAULT 'Admin', system_role VARCHAR(50) DEFAULT 'USER',
            account_status VARCHAR(16) DEFAULT 'ACTIVE', UNIQUE KEY unique_user_tenant (entra_oid, tenant_id))`);
        await db.query(`CREATE TABLE UserScopes (
            tenant_id VARCHAR(64), user_email VARCHAR(120), perspective_id INT, group_name VARCHAR(120))`);
        await db.query("CREATE TABLE GlobalSettings (setting_key VARCHAR(64) PRIMARY KEY, setting_value VARCHAR(255))");
        await db.query(`CREATE TABLE SignupEvents (
            id INT PRIMARY KEY AUTO_INCREMENT, tenant_id VARCHAR(64), user_email VARCHAR(120),
            event_type VARCHAR(40), plan VARCHAR(40), metadata TEXT)`);
    });
    afterAll(async () => {
        await admin.query(`DROP DATABASE IF EXISTS ${database}`);
        await db.end();
        await admin.end();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });
    beforeEach(async () => {
        await db.query("TRUNCATE TABLE Users");
        await db.query("DELETE FROM Tenants");
        await db.query("TRUNCATE TABLE SignupEvents");
    });

    describe("POST /api/tenants: no es una vía de alta de tenants", () => {
        it("un usuario del directorio no crea con el login un tenant ACTIVE sin pasar por el checkout", async () => {
            const ana = quien(ALPHA, "ana");
            const r = await post(ana);
            expect(r.status).toBe(403);
            const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM Tenants WHERE tenant_id = ?", [ALPHA]);
            expect(Number(rows[0].n)).toBe(0);
        });

        it("no sincroniza un tenant ajeno", async () => {
            const ana = quien(ALPHA, "ana");
            await tenant(BETA); await fila(quien(BETA, "dueno"), "Owner");
            expect((await post(ana, BETA)).status).toBe(403);
        });
    });

    describe("GET /api/tenants: el auto-vínculo usa la misma regla de admisión que el login", () => {
        it("un usuario nuevo de un tenant contratado queda como Reader, no como Admin", async () => {
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), "Owner");
            const eva = quien(ALPHA, "eva");
            const r = await get(eva);
            expect(r.status).toBe(200);
            expect(r.body.tenants.map((t: { id: string }) => t.id)).toEqual([ALPHA]);
            expect(await filaDe(eva)).toEqual({ role: "Reader", account_status: "ACTIVE" });
        });

        it("el primer usuario de un tenant contratado sin usuarios queda Owner", async () => {
            await tenant(ALPHA);
            const primero = quien(ALPHA, "primero");
            expect((await get(primero)).status).toBe(200);
            expect(await filaDe(primero)).toEqual({ role: "Owner", account_status: "ACTIVE" });
        });

        it("respeta el límite del plan: el 4.º usuario de Professional no queda vinculado ni ve el tenant", async () => {
            await tenant(ALPHA, "Professional");
            for (const n of ["u1", "u2", "u3"]) await fila(quien(ALPHA, n));
            const cuarto = quien(ALPHA, "u4");
            const r = await get(cuarto);
            expect(r.body.tenants).toEqual([]);
            expect(r.body.isRegistered).toBe(false);
            expect(await filaDe(cuarto)).toBeUndefined();
        });

        it("no cambia el rol de quien ya tiene fila ni reactiva a un DISABLED", async () => {
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), "Owner");
            const lector = quien(ALPHA, "lector"); const baja = quien(ALPHA, "baja");
            await fila(lector, "Reader"); await fila(baja, "Reader", "DISABLED");
            await get(lector); await get(baja);
            expect(await filaDe(lector)).toEqual({ role: "Reader", account_status: "ACTIVE" });
            expect(await filaDe(baja)).toEqual({ role: "Reader", account_status: "DISABLED" });
        });

        it("no vincula a nadie en un tenant sin suscripción (sin fila en Tenants)", async () => {
            const eva = quien(ALPHA, "eva");
            const r = await get(eva);
            expect(r.body.tenants).toEqual([]);
            expect(await filaDe(eva)).toBeUndefined();
        });

        it("no vincula en un tenant CANCELED", async () => {
            await tenant(ALPHA, "Professional", "CANCELED"); await fila(quien(ALPHA, "dueno"), "Owner");
            const eva = quien(ALPHA, "eva");
            await get(eva);
            expect(await filaDe(eva)).toBeUndefined();
        });
    });

    describe("orden y concurrencia entre GET /api/tenants y /api/onboard", () => {
        it("GET antes que onboard no deja a un usuario nuevo como Admin: queda Reader en cualquier orden", async () => {
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), "Owner");
            const eva = quien(ALPHA, "eva");
            await get(eva);
            expect(await login(eva)).toBe(200);
            expect(await filaDe(eva)).toEqual({ role: "Reader", account_status: "ACTIVE" });
        });

        it("GET y onboard simultáneos del mismo usuario nuevo crean una sola fila Reader", async () => {
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), "Owner");
            const eva = quien(ALPHA, "eva");
            await Promise.all([get(eva), get(eva), login(eva), get(eva)]);
            expect(await cuantosUsuarios(ALPHA)).toBe(2);
            expect(await filaDe(eva)).toEqual({ role: "Reader", account_status: "ACTIVE" });
        });

        it("altas simultáneas por GET de usuarios distintos no superan el cupo del plan", async () => {
            await tenant(ALPHA, "Professional");
            await fila(quien(ALPHA, "u1"), "Owner"); await fila(quien(ALPHA, "u2"));
            await Promise.all(["n1", "n2", "n3", "n4"].map((n) => get(quien(ALPHA, n))));
            expect(await cuantosUsuarios(ALPHA)).toBe(3);
        });
    });
});
