// @vitest-environment node
/**
 * PERIM-07 — Webhook de Azure Marketplace: audiencia obligatoria y fail-closed.
 *
 * Se firman JWT reales (RS256) con un par de claves local inyectado como JWKS,
 * así se ejercita `jwtVerify` de verdad: audiencia, issuer, algoritmo, exp y
 * claims requeridos. No hay bypass sin firma.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";

const h = vi.hoisted(() => ({
    getConnection: vi.fn(),
    query: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { getConnection: h.getConnection, query: h.query },
}));

import {
    verifyWebhookJwt,
    __setMarketplaceJwksForTests,
    MarketplaceVerifierNotConfigured,
    MarketplaceWebhookAuthError,
} from "@/lib/marketplace/azure";
import { POST as webhookPOST } from "@/app/api/webhooks/marketplace/azure/route";

const APP_ID = "11111111-2222-3333-4444-555555555555";
const ISS = "https://sts.windows.net/62e173e9-301e-423e-bcd4-29121ec1aa24/";

let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey as CryptoKey;
    otherKey = (await generateKeyPair("RS256")).privateKey as CryptoKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    __setMarketplaceJwksForTests(createLocalJWKSet({ keys: [jwk] }));
});
afterAll(() => __setMarketplaceJwksForTests(null));

beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_MARKETPLACE_AAD_APP_ID = APP_ID;
    delete process.env.MARKETPLACE_SKIP_VERIFY;
    delete process.env.AZURE_MARKETPLACE_TRUSTED_ISSUERS;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

type Opts = { aud?: string | null; iss?: string | null; exp?: number | string | null; iat?: boolean; key?: CryptoKey; kid?: string };

async function token(o: Opts = {}): Promise<string> {
    const jwt = new SignJWT({ sub: "marketplace" }).setProtectedHeader({ alg: "RS256", kid: o.kid ?? "k1" });
    if (o.aud !== null) jwt.setAudience(o.aud ?? APP_ID);
    if (o.iss !== null) jwt.setIssuer(o.iss ?? ISS);
    if (o.exp !== null) jwt.setExpirationTime(o.exp ?? "5m");
    if (o.iat !== false) jwt.setIssuedAt();
    return jwt.sign(o.key ?? privateKey);
}

const bearer = async (o?: Opts) => `Bearer ${await token(o)}`;

function unsigned(payload: Record<string, unknown>, alg = "none"): string {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    return `${enc({ alg, typ: "JWT" })}.${enc(payload)}.`;
}

describe("PERIM-07 — verifyWebhookJwt", () => {
    it("un JWT válido con claims del proveedor pasa", async () => {
        const payload = await verifyWebhookJwt(await bearer());
        expect(payload.aud).toBe(APP_ID);
        expect(payload.iss).toBe(ISS);
    });

    it("sin AZURE_MARKETPLACE_AAD_APP_ID falla cerrado aunque el token sea válido", async () => {
        const auth = await bearer();
        for (const v of [undefined, "", "   "]) {
            if (v === undefined) delete process.env.AZURE_MARKETPLACE_AAD_APP_ID;
            else process.env.AZURE_MARKETPLACE_AAD_APP_ID = v;
            await expect(verifyWebhookJwt(auth)).rejects.toBeInstanceOf(MarketplaceVerifierNotConfigured);
        }
    });

    it("MARKETPLACE_SKIP_VERIFY ya no decodifica tokens sin firma (en ningún entorno)", async () => {
        process.env.MARKETPLACE_SKIP_VERIFY = "true";
        const fake = unsigned({ aud: APP_ID, iss: ISS, exp: 9_999_999_999, iat: 1 });
        await expect(verifyWebhookJwt(`Bearer ${fake}x`)).rejects.toBeInstanceOf(MarketplaceVerifierNotConfigured);
        await expect(verifyWebhookJwt(await bearer())).rejects.toBeInstanceOf(MarketplaceVerifierNotConfigured);
    });

    it.each([
        ["audiencia de otra app (mismo issuer confiable)", { aud: "99999999-0000-0000-0000-000000000000" }],
        ["sin audiencia", { aud: null }],
        ["issuer no permitido", { iss: "https://sts.windows.net/otro-tenant/" }],
        ["sin issuer", { iss: null }],
        ["vencido", { exp: Math.floor(Date.now() / 1000) - 60 }],
        ["sin exp", { exp: null }],
        ["sin iat", { iat: false }],
        ["firmado con otra clave", { key: undefined as unknown as CryptoKey, kid: "k1", other: true }],
        ["kid desconocido", { kid: "nope" }],
    ])("rechaza: %s", async (_name, o) => {
        const opts = { ...(o as Opts) };
        if ((o as { other?: boolean }).other) opts.key = otherKey;
        await expect(verifyWebhookJwt(await bearer(opts))).rejects.toBeInstanceOf(MarketplaceWebhookAuthError);
    });

    it("rechaza alg none y HS256 aunque los claims sean correctos", async () => {
        const claims = { aud: APP_ID, iss: ISS, exp: 9_999_999_999, iat: 1 };
        await expect(verifyWebhookJwt(`Bearer ${unsigned(claims)}x`)).rejects.toBeInstanceOf(MarketplaceWebhookAuthError);
        const hs = await new SignJWT(claims).setProtectedHeader({ alg: "HS256", kid: "k1" })
            .sign(new TextEncoder().encode("s".repeat(32)));
        await expect(verifyWebhookJwt(`Bearer ${hs}`)).rejects.toBeInstanceOf(MarketplaceWebhookAuthError);
    });

    it.each([null, "", "Basic abcd", "Bearer ", "Bearer a.b", "bearer x.y.z"])(
        "cabecera ausente o malformada (%s) → 401",
        async (header) => {
            await expect(verifyWebhookJwt(header)).rejects.toBeInstanceOf(MarketplaceWebhookAuthError);
        }
    );

    it("AZURE_MARKETPLACE_TRUSTED_ISSUERS amplía el issuer pero no relaja la audiencia", async () => {
        const extra = "https://login.microsoftonline.com/extra/v2.0";
        process.env.AZURE_MARKETPLACE_TRUSTED_ISSUERS = extra;
        await expect(verifyWebhookJwt(await bearer({ iss: extra }))).resolves.toBeTruthy();
        await expect(verifyWebhookJwt(await bearer({ iss: extra, aud: "otra" }))).rejects.toBeInstanceOf(MarketplaceWebhookAuthError);
    });
});

describe("PERIM-07 — POST /api/webhooks/marketplace/azure", () => {
    const post = (auth: string | null) =>
        webhookPOST(new NextRequest("https://app/api/webhooks/marketplace/azure", {
            method: "POST",
            headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
            body: JSON.stringify({ action: "ChangePlan", subscriptionId: "sub-1", planId: "enterprise-monthly" }),
        }));

    it("sin audiencia configurada: 503 y nunca llega a la base", async () => {
        delete process.env.AZURE_MARKETPLACE_AAD_APP_ID;
        const res = await post(await bearer());
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "Webhook verifier not configured" });
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("token de otra audiencia: 401 sin detalles del token y sin tocar la base", async () => {
        const res = await post(await bearer({ aud: "otra-app" }));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Webhook authentication failed" });
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("sin Authorization: 401 sin tocar la base", async () => {
        expect((await post(null)).status).toBe(401);
        expect(h.getConnection).not.toHaveBeenCalled();
    });

    it("token válido: pasa la verificación y llega al handler", async () => {
        const conn = { query: vi.fn(async () => [[]]), release: vi.fn() };
        h.getConnection.mockResolvedValue(conn);
        const res = await post(await bearer());
        expect(res.status).toBe(200);
        expect(h.getConnection).toHaveBeenCalledOnce();
        expect(conn.release).toHaveBeenCalled();
    });
});
