// @vitest-environment node
import crypto from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * STRIDE-03 — el MOTIVO de una negativa de acceso llega a la interfaz.
 *
 * El `code` de `AuthError` no viaja en el cuerpo de las ~100 respuestas de la API, así que la pantalla de «sin acceso» no
 * podía distinguir un límite de plan de una cuenta deshabilitada. Dos puntos de contacto, ambos con respuesta explícita:
 *  - `GET /api/me/acceso?tenantId=`: pasa por el MISMO guard de admisión y responde `{ acceso: { ok, motivo, tier?, limite? } }`.
 *  - `GET /api/tenants`: cuando el usuario no puede ver ningún tenant, agrega `acceso` con el motivo.
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

import { GET as acceso } from "@/app/api/me/acceso/route";
import { GET as listarTenants } from "@/app/api/tenants/route";

const ALPHA = "a0000000-0000-4000-8000-000000000001";
const BETA = "b0000000-0000-4000-8000-000000000002";
const OPS = "c0000000-0000-4000-8000-000000000003";
const audience = "acceso-tenant-synthetic-client";
const database = `finops_acceso_${process.pid}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "acceso-test", kty: "RSA" };

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

async function probe(tenantId: string | null, who?: Who) {
    const headers = new Headers();
    if (who) headers.set("authorization", bearer(who));
    const url = `https://example.test/api/me/acceso${tenantId === null ? "" : `?tenantId=${tenantId}`}`;
    const res = await acceso(new NextRequest(url, { headers }));
    return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
}
async function tenants(who: Who) {
    const res = await listarTenants(new NextRequest("https://example.test/api/tenants", { headers: { authorization: bearer(who) } }));
    return { status: res.status, body: await res.json() };
}

async function tenant(id: string, tier = "Professional") {
    await db.query("INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status) VALUES (?, 'x', ?, 'ACTIVE')", [id, tier]);
}
async function fila(who: Who, over: { role?: string; status?: string; system?: string } = {}) {
    await db.query("INSERT INTO Users (entra_oid, tenant_id, email, role, system_role, account_status) VALUES (?, ?, ?, ?, ?, ?)",
        [who.oid, who.tid, who.email, over.role ?? "Reader", over.system ?? "USER", over.status ?? "ACTIVE"]);
}
async function filaDe(who: Who) {
    const [rows] = await db.query<RowDataPacket[]>("SELECT role, account_status FROM Users WHERE tenant_id = ? AND entra_oid = ?", [who.tid, who.oid]);
    return rows[0];
}

describe.skipIf(!process.env.MYSQL_SECURITY_PORT)("motivo de la negativa de acceso con MySQL real", () => {
    let admin: Pool;
    beforeAll(async () => {
        vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", audience);
        vi.stubEnv("CRON_SECRET", "");
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
        await db.query(`CREATE TABLE Tenants (
            tenant_id VARCHAR(255) PRIMARY KEY, company_name VARCHAR(255), client_id VARCHAR(255), client_secret TEXT,
            tier ENUM('Professional','Business','Enterprise') DEFAULT 'Professional', trial_ends_at DATETIME NULL,
            subscription_status ENUM('TRIAL','ACTIVE','PAST_DUE','CANCELED','EXPIRED') DEFAULT 'ACTIVE',
            access_until DATETIME NULL, is_onboarded TINYINT(1) DEFAULT 0, paddle_subscription_id VARCHAR(255),
            partner_link_status VARCHAR(40), partner_link_detail VARCHAR(255), provider VARCHAR(40),
            provider_archived TINYINT(1) DEFAULT 0, provider_purge_at DATETIME NULL, timezone VARCHAR(64),
            logo_stored_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await db.query(`CREATE TABLE Users (
            id INT AUTO_INCREMENT PRIMARY KEY, entra_oid VARCHAR(255), tenant_id VARCHAR(255), email VARCHAR(255),
            display_name VARCHAR(255), role VARCHAR(50) DEFAULT 'Admin', system_role VARCHAR(50) DEFAULT 'USER',
            account_status VARCHAR(16) DEFAULT 'ACTIVE', UNIQUE KEY unique_user_tenant (entra_oid, tenant_id))`);
        await db.query("CREATE TABLE UserScopes (tenant_id VARCHAR(64), user_email VARCHAR(120), perspective_id INT, group_name VARCHAR(120))");
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

    describe("GET /api/me/acceso", () => {
        it("un miembro ACTIVE tiene acceso y la respuesta no se cachea", async () => {
            const ana = quien(ALPHA, "ana");
            await tenant(ALPHA); await fila(ana);
            const r = await probe(ALPHA, ana);
            expect(r.status).toBe(200);
            expect(r.body.acceso).toEqual({ ok: true });
            expect(r.cache).toMatch(/no-store/);
        });

        it("un miembro nuevo con cupo entra y queda ACTIVE como Reader (misma admisión que el guard)", async () => {
            const eva = quien(ALPHA, "eva");
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), { role: "Owner" });
            expect((await probe(ALPHA, eva)).body.acceso).toEqual({ ok: true });
            expect(await filaDe(eva)).toEqual({ role: "Reader", account_status: "ACTIVE" });
        });

        it("DESHABILITADA: una fila DISABLED", async () => {
            const ana = quien(ALPHA, "ana");
            await tenant(ALPHA); await fila(ana, { status: "DISABLED" });
            expect((await probe(ALPHA, ana)).body.acceso).toEqual({ ok: false, motivo: "DESHABILITADA" });
        });

        it("NO_INVITADO: una fila INVITED no entra", async () => {
            const ines = quien(ALPHA, "ines");
            await tenant(ALPHA); await fila(ines, { status: "INVITED" });
            expect((await probe(ALPHA, ines)).body.acceso).toEqual({ ok: false, motivo: "NO_INVITADO" });
        });

        it("SIN_CUPO: el 4.º usuario de Professional, con el plan y su límite", async () => {
            await tenant(ALPHA, "Professional");
            for (const n of ["u1", "u2", "u3"]) await fila(quien(ALPHA, n));
            const cuarto = quien(ALPHA, "u4");
            const r = await probe(ALPHA, cuarto);
            expect(r.body.acceso).toEqual({ ok: false, motivo: "SIN_CUPO", tier: "Professional", limite: 3 });
            expect(await filaDe(cuarto)).toBeUndefined();
        });

        it("SIN_SUSCRIPCION: el tenant no existe en la base", async () => {
            const eva = quien(ALPHA, "eva");
            expect((await probe(ALPHA, eva)).body.acceso).toEqual({ ok: false, motivo: "SIN_SUSCRIPCION" });
        });

        it("SIN_ACCESO: tenant contratado sin ningún usuario (el primero pasa por el login)", async () => {
            const primero = quien(ALPHA, "primero");
            await tenant(ALPHA);
            expect((await probe(ALPHA, primero)).body.acceso).toEqual({ ok: false, motivo: "SIN_ACCESO" });
            expect(await filaDe(primero)).toBeUndefined();
        });

        it("SIN_ACCESO: alguien de otro directorio sin fila no entra ni queda con fila", async () => {
            const luis = quien(BETA, "luis");
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), { role: "Owner" });
            expect((await probe(ALPHA, luis)).body.acceso).toEqual({ ok: false, motivo: "SIN_ACCESO" });
            expect(await filaDe({ ...luis, tid: ALPHA })).toBeUndefined();
        });

        it("un SuperAdmin corporativo tiene acceso a cualquier tenant", async () => {
            const ops = quien(OPS, "ops", "cscloudsolutions.com.ar");
            await tenant(ALPHA); await fila({ ...ops, tid: OPS }, { system: "SUPERADMIN" });
            expect((await probe(ALPHA, ops)).body.acceso).toEqual({ ok: true });
        });

        it("un tenant demo no toca la base", async () => {
            const ana = quien(ALPHA, "ana");
            expect((await probe("demo", ana)).body.acceso).toEqual({ ok: true });
        });

        it("sin token responde 401, y sin tenantId responde 400", async () => {
            expect((await probe(ALPHA)).status).toBe(401);
            expect((await probe(null, quien(ALPHA, "ana"))).status).toBe(400);
        });
    });

    describe("GET /api/tenants agrega el motivo cuando el usuario no ve ningún tenant", () => {
        it("SIN_CUPO con plan y límite", async () => {
            await tenant(ALPHA, "Professional");
            for (const n of ["u1", "u2", "u3"]) await fila(quien(ALPHA, n));
            const r = await tenants(quien(ALPHA, "u4"));
            expect(r.body.tenants).toEqual([]);
            expect(r.body.acceso).toEqual({ motivo: "SIN_CUPO", tier: "Professional", limite: 3 });
        });

        it("SIN_SUSCRIPCION cuando el tenant no tiene suscripción", async () => {
            const r = await tenants(quien(ALPHA, "eva"));
            expect(r.body.tenants).toEqual([]);
            expect(r.body.acceso).toEqual({ motivo: "SIN_SUSCRIPCION" });
        });

        it("un usuario admitido ve su tenant y la respuesta no trae `acceso`", async () => {
            await tenant(ALPHA); await fila(quien(ALPHA, "dueno"), { role: "Owner" });
            const r = await tenants(quien(ALPHA, "eva"));
            expect(r.body.tenants).toHaveLength(1);
            expect(r.body.acceso).toBeUndefined();
        });
    });
});
