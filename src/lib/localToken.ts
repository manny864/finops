import { SignJWT, jwtVerify } from "jose";

/**
 * JWT propio para tenants que no usan Entra (ver docs/aws-multicloud-handoff.md
 * §3.1: AWS no tiene un IdP equivalente, así que el login es email+password).
 *
 * El payload imita la forma de un idToken de Entra (`tid`, `oid`, `email`) a
 * propósito: `validateRequestToken` devuelve estos claims tal cual y todo lo
 * que hay aguas abajo — requireRequestIdentity, requireTenantAccess,
 * requireTenantRole, requireTenantTier y las ~244 rutas de API — sigue
 * funcionando sin enterarse de que la identidad no vino de Microsoft.
 *
 * Se firma con HS256 (secreto simétrico). Entra firma con RS256. Esa
 * diferencia de algoritmo es lo que usa `validateRequestToken` para decidir
 * qué rama de validación aplicar, y como cada rama exige su propio `alg`, no
 * hay confusión de algoritmo posible entre las dos.
 *
 * NO importa nada de requestAuth.ts: éste lo importa a él, y el ciclo rompería
 * el bundle. Por eso lanza Error pelado y requestAuth lo envuelve en AuthError.
 */

export const LOCAL_TOKEN_ISSUER = "cscloudsolutions-local";

/** 8h: una jornada laboral. Vencido, el usuario vuelve a loguearse. */
const TOKEN_TTL = "8h";

function getSecret(): Uint8Array {
    const raw = process.env.LOCAL_AUTH_SECRET;
    // Fail-closed: sin secreto configurado nadie entra por esta vía. Un
    // secreto corto es peor que ninguno porque da falsa sensación de
    // seguridad — HS256 con 16 bytes es fuerza-brutable offline.
    if (!raw || raw.length < 32) {
        throw new Error("LOCAL_AUTH_SECRET no configurado (mínimo 32 caracteres).");
    }
    return new TextEncoder().encode(raw);
}

export type LocalTokenPayload = {
    tid: string;
    oid: string;
    email: string;
};

export async function issueLocalToken(payload: LocalTokenPayload): Promise<string> {
    return new SignJWT({ email: payload.email, oid: payload.oid })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(payload.oid)
        .setAudience(payload.tid)
        .setIssuer(LOCAL_TOKEN_ISSUER)
        .setIssuedAt()
        .setExpirationTime(TOKEN_TTL)
        .sign(getSecret());
}

/**
 * Verifica firma, issuer y expiración. Devuelve los claims en el mismo formato
 * que un token de Entra. Lanza Error si algo no cierra.
 */
export async function verifyLocalToken(token: string): Promise<Record<string, unknown>> {
    const { payload } = await jwtVerify(token, getSecret(), {
        issuer: LOCAL_TOKEN_ISSUER,
        algorithms: ["HS256"],
    });

    // `aud` lleva el tenant. Se normaliza porque jose lo tipa como
    // string | string[] (el estándar permite múltiples audiences).
    const tid = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (typeof tid !== "string" || !tid) {
        throw new Error("Token local sin tenant.");
    }

    return { ...payload, tid };
}

export function isLocalAuthConfigured(): boolean {
    const raw = process.env.LOCAL_AUTH_SECRET;
    return Boolean(raw && raw.length >= 32);
}
