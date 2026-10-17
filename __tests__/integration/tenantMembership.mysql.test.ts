// @vitest-environment node
import crypto from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * STRIDE-03 — membresía de aplicación.
 *
 * HOY `requireTenantAccess` deja pasar a cualquier identidad cuyo `tid` coincida con el tenant, sin exigir fila en
 * `Users` (sólo una fila DISABLED corta el paso). La decisión del propietario es exigir una fila ACTIVE en cada petición.
 *
 * Estas pruebas se escribieron ANTES de tocar el guard:
 *  - los grupos «vigente» y «orden login → API» describen lo que ya se cumple y NO debe romperse;
 *  - el grupo «STRIDE-03» describe el comportamiento nuevo y hoy FALLA a propósito. Se marca con `it.fails` para que el
 *    CI siga verde: cuando el guard se implemente esas pruebas pasarán de verdad, `it.fails` fallará con «Expect test to
 *    fail» y habrá que cambiarlas a `it`. Con `STRIDE03_ACTIVO=1` corren como pruebas normales (rojas hoy) para ver el
 *    motivo exacto de cada fallo.
 *
 * Sólo usa un MySQL local descartable (MYSQL_SECURITY_PORT); nunca credenciales ni datos de la aplicación.
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

import { POST as onboard } from "@/app/api/onboard/route";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

const ALPHA = "a0000000-0000-4000-8000-000000000001";
const BETA = "b0000000-0000-4000-8000-000000000002";
const OPS = "c0000000-0000-4000-8000-000000000003";
const audience = "tenant-membership-synthetic-client";
const database = `finops_membership_${process.pid}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "membership-test", kty: "RSA" };
const CRON = "cron-secret-sintetico-de-32-caracteres!";

/** Pruebas del comportamiento nuevo: esperadas en rojo hasta implementar el guard (ver cabecera). */
const nuevo = process.env.STRIDE03_ACTIVO === "1" ? it : it.fails;

type Who = { tid: string; oid: string; email: string };
const quien = (tid: string, n: string, dominio = "example.test"): Who => ({ tid, oid: `oid-${n}`, email: `${n}@${dominio}` });

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

/** Resultado del guard: "ok" o el error de autorización (status + code). */
async function acceso(tenantId: string, who?: Who, extra: Record<string, string> = {}) {
    const headers = new Headers(extra);
    if (who) headers.set("authorization", bearer(who));
    const req = new NextRequest(`https://example.test/api/x?tenantId=${tenantId}`, { headers });
    try {
        await requireTenantAccess(req, tenantId);
        return "ok" as const;
    } catch (e) {
        if (e instanceof AuthError) return { status: e.status, code: e.code };
        throw e;
    }
}

async function loginOnboard(who: Who) {
    const req = new NextRequest("https://example.test/api/onboard", {
        method: "POST",
        headers: { authorization: bearer(who), "content-type": "application/json" },
        body: JSON.stringify({ plan: null }),
    });
    const res = await onboard(req);
    return { status: res.status, body: await res.json() };
}

async function fila(who: Who, over: { role?: string; status?: string; system?: string; tenant?: string } = {}) {
    await db.query(
        "INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, account_status) VALUES (?, ?, ?, ?, ?, ?)",
        [who.oid, over.tenant ?? who.tid, who.email, over.role ?? "Reader", over.system ?? "USER", over.status ?? "ACTIVE"],
    );
}

async function tenant(id: string, tier = "Professional") {
    await db.query(
        "INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status) VALUES (?, 'x', ?, 'ACTIVE')",
        [id, tier],
    );
}

async function filaDe(who: Who) {
    const [rows] = await db.query<RowDataPacket[]>(
        "SELECT role, account_status FROM Users WHERE tenant_id = ? AND entra_oid = ?", [who.tid, who.oid]);
    return rows[0];
}

describe.skipIf(!process.env.MYSQL_SECURITY_PORT)("membresía de aplicación con identidades firmadas y MySQL real", () => {
    let admin: Pool;
    beforeAll(async () => {
        vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", audience);
        vi.stubEnv("CRON_SECRET", CRON);
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            if (url.hostname !== "login.microsoftonline.com") throw new Error(`Unexpected network request: ${url.origin}`);
            const t = [ALPHA, BETA, OPS].find((id) => url.pathname.startsWith(`/${id}/`));
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
        await db.query(`CREATE TABLE Users (
            tenant_id VARCHAR(64), email VARCHAR(120), entra_oid VARCHAR(64), role VARCHAR(40),
            account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', system_role VARCHAR(40) DEFAULT 'USER',
            UNIQUE KEY uq_user (entra_oid, tenant_id))`);
        await db.query(`CREATE TABLE UserScopes (
            tenant_id VARCHAR(64), user_email VARCHAR(120), perspective_id INT, group_name VARCHAR(120))`);
        await db.query(`CREATE TABLE Tenants (
            tenant_id VARCHAR(64) PRIMARY KEY, company_name VARCHAR(120), tier VARCHAR(40),
            subscription_status VARCHAR(40), trial_ends_at DATETIME NULL,
            ai_anomaly_sensitivity VARCHAR(20), ai_share_resource_names BOOLEAN, ai_share_tags BOOLEAN)`);
        await db.query("CREATE TABLE GlobalSettings (setting_key VARCHAR(64) PRIMARY KEY, setting_value VARCHAR(255))");
        // /api/onboard registra un evento en cada login (plan por defecto), por eso la tabla tiene que existir.
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
        await db.query("TRUNCATE TABLE UserScopes");
        await db.query("DELETE FROM Tenants");
    });

    describe("contrato vigente que el guard estricto debe conservar", () => {
        it("un miembro con fila ACTIVE entra", async () => {
            const ana = quien(ALPHA, "ana");
            await tenant(ALPHA); await fila(ana);
            expect(await acceso(ALPHA, ana)).toBe("ok");
        });

        it("una fila DISABLED corta el acceso aunque el JWT siga vigente", async () => {
            const ana = quien(ALPHA, "ana");
            await tenant(ALPHA); await fila(ana, { status: "DISABLED" });
            expect(await acceso(ALPHA, ana)).toEqual({ status: 403, code: "ACCOUNT_DISABLED" });
        });

        it("una membresía explícita ACTIVE en otro tenant entra", async () => {
            const luis = quien(BETA, "luis");
            await tenant(ALPHA); await fila(luis, { tenant: ALPHA });
            expect(await acceso(ALPHA, luis)).toBe("ok");
        });

        it("sin fila y de otro directorio no entra", async () => {
            const luis = quien(BETA, "luis");
            await tenant(ALPHA);
            expect(await acceso(ALPHA, luis)).toMatchObject({ status: 403 });
        });

        it("un SuperAdmin corporativo entra a cualquier tenant sin fila en él", async () => {
            const ops = quien(OPS, "ops", "cscloudsolutions.com.ar");
            await tenant(ALPHA); await fila(ops, { system: "SUPERADMIN" });
            expect(await acceso(ALPHA, ops)).toBe("ok");
        });

        it("el cron autenticado entra sin fila ni JWT, sólo por GET", async () => {
            await tenant(ALPHA);
            expect(await acceso(ALPHA, undefined, { "x-cron-auth": CRON })).toBe("ok");
        });
    });

    describe("orden login → API: lo que /api/onboard ya garantiza", () => {
        it("un miembro nuevo del directorio queda ACTIVE como Reader y después entra", async () => {
            const dueno = quien(ALPHA, "dueno"); const eva = quien(ALPHA, "eva");
            await tenant(ALPHA); await fila(dueno, { role: "Owner" });
            const r = await loginOnboard(eva);
            expect(r.status).toBe(200);
            expect(await filaDe(eva)).toEqual({ role: "Reader", account_status: "ACTIVE" });
            expect(await acceso(ALPHA, eva)).toBe("ok");
        });

        it("el primer usuario de un tenant ya contratado queda Owner", async () => {
            const primero = quien(ALPHA, "primero");
            await tenant(ALPHA);
            expect((await loginOnboard(primero)).status).toBe(200);
            expect(await filaDe(primero)).toEqual({ role: "Owner", account_status: "ACTIVE" });
        });

        it("onboard repetido no escala ni cambia el rol de nadie", async () => {
            const dueno = quien(ALPHA, "dueno"); const admin = quien(ALPHA, "admin"); const eva = quien(ALPHA, "eva");
            await tenant(ALPHA); await fila(dueno, { role: "Owner" }); await fila(admin, { role: "Admin" });
            await loginOnboard(eva); await loginOnboard(eva); await loginOnboard(admin);
            expect(await filaDe(eva)).toMatchObject({ role: "Reader" });
            expect(await filaDe(admin)).toMatchObject({ role: "Admin" });
        });

        it("onboard no crea fila para un tenant sin suscripción", async () => {
            const eva = quien(ALPHA, "eva");
            const r = await loginOnboard(eva);
            expect(r.status).toBe(403);
            expect(r.body.needsSubscription).toBe(true);
            expect(await filaDe(eva)).toBeUndefined();
        });

        it("el usuario que supera el límite del plan Professional (3) es rechazado por onboard y no queda con fila", async () => {
            await tenant(ALPHA, "Professional");
            for (const n of ["u1", "u2", "u3"]) await fila(quien(ALPHA, n));
            const cuarto = quien(ALPHA, "u4");
            const r = await loginOnboard(cuarto);
            expect(r.status).toBe(403);
            expect(await filaDe(cuarto)).toBeUndefined();
        });
    });

    describe("STRIDE-03: fila ACTIVE exigida en cada petición (esperadas en rojo hasta implementar el guard)", () => {
        nuevo("un miembro del directorio SIN fila ya no entra", async () => {
            const nadie = quien(ALPHA, "nadie");
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), { role: "Owner" });
            expect(await acceso(ALPHA, nadie)).toEqual({ status: 403, code: "MEMBERSHIP_REQUIRED" });
        });

        nuevo("una fila INVITED del mismo tenant no entra", async () => {
            const ines = quien(ALPHA, "ines");
            await tenant(ALPHA); await fila(ines, { status: "INVITED" });
            expect(await acceso(ALPHA, ines)).toEqual({ status: 403, code: "MEMBERSHIP_REQUIRED" });
        });

        nuevo("una fila INVITED en otro tenant tampoco entra", async () => {
            const luis = quien(BETA, "luis");
            await tenant(ALPHA); await fila(luis, { tenant: ALPHA, status: "INVITED" });
            expect(await acceso(ALPHA, luis)).toEqual({ status: 403, code: "MEMBERSHIP_REQUIRED" });
        });

        nuevo("quien superó el límite del plan no entra llamando directo a la API", async () => {
            await tenant(ALPHA, "Professional");
            for (const n of ["u1", "u2", "u3"]) await fila(quien(ALPHA, n));
            const cuarto = quien(ALPHA, "u4");
            expect((await loginOnboard(cuarto)).status).toBe(403);
            expect(await acceso(ALPHA, cuarto)).toEqual({ status: 403, code: "MEMBERSHIP_REQUIRED" });
        });

        nuevo("quien entra a un tenant sin suscripción tampoco lee datos (no hay fila que lo admita)", async () => {
            const eva = quien(ALPHA, "eva");
            await loginOnboard(eva);
            expect(await acceso(ALPHA, eva)).toEqual({ status: 403, code: "MEMBERSHIP_REQUIRED" });
        });
    });
});
