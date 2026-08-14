import crypto from "crypto";
import { NextRequest } from "next/server";
import pool from "@/modules/storage/db";
import { hasAccess } from "@/lib/tierLogic";

/**
 * Tenant well-known de Microsoft para CUENTAS PERSONALES (MSA / "consumers"):
 * cualquier token emitido para una @outlook.com / @hotmail.com / @live.com trae
 * este GUID en el claim `tid`.
 *
 * SE RECHAZA EN LA VALIDACIÓN DEL TOKEN, no en cada ruta. Una cuenta personal no
 * puede tener suscripciones de Azure ni un Service Principal, así que toda
 * operación de la plataforma contra ella falla por diseño — y falla tarde y con un
 * mensaje que no dice nada: getAzureCredential cae al AZURE_CLIENT_ID de
 * plataforma y lo autentica contra este directorio, produciendo
 * "AADSTS700016: Application ... was not found in the directory '9188040d-…'".
 *
 * Peor todavía: bastaba un GET a /api/tenants para que se auto-provisionara una
 * fila en `Tenants` con este id (ver el bloque de auto-provisión de esa ruta).
 * En prod eso dejó un tenant basura que prewarm-dashboard barría cada 10 min
 * gastando reintentos de Cost Management que les hacen falta a los tenants
 * reales: 102 líneas de error en 7 minutos el 2026-07-30. La migración
 * 20260731-002 borra esa fila; esto es lo que evita que vuelva.
 *
 * Cortarlo acá cubre TODOS los caminos de alta de una sola vez (había 10 puntos
 * de INSERT INTO Tenants en 7 archivos) en vez de parchear ruta por ruta.
 */
export const MSA_CONSUMERS_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

/**
 * Mensaje de rechazo. Es user-facing (lo muestra la pantalla de login), así que
 * dice qué hacer, no qué falló internamente.
 */
export const PERSONAL_ACCOUNT_REJECTION =
  "Esta plataforma requiere una cuenta de organización de Microsoft Entra ID. " +
  "Las cuentas personales (Outlook, Hotmail, Live) no pueden acceder.";

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

export type AuthClaims = {
  tid: string;
  oid?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  preferred_username?: string;
  unique_name?: string;
  upn?: string;
  email?: string;
  [key: string]: unknown;
};

type OpenIdConfiguration = {
  issuer: string;
  jwks_uri: string;
};

type JsonWebKey = {
  kty: string;
  kid: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
  [key: string]: unknown;
};

type JwksResponse = {
  keys: JsonWebKey[];
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const openIdCache = new Map<string, CacheEntry<OpenIdConfiguration>>();
const jwksCache = new Map<string, CacheEntry<JwksResponse>>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 120;
const DEFAULT_ENTRA_CLIENT_ID = "876d8a5b-6023-4484-b3ba-73c186e4a72b";

export class AuthError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 401, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function getBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("No autorizado.", 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AuthError("No autorizado.", 401);
  }

  return token;
}

function base64UrlDecode(input: string): Buffer {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function parseJson<T>(buf: Buffer, field: string): T {
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    throw new AuthError(`Token inválido (${field}).`, 401);
  }
}

async function cachedFetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new AuthError("No se pudo validar el token con Entra ID.", 401);
  }
  return (await response.json()) as T;
}

async function getOpenIdConfiguration(tenantId: string): Promise<OpenIdConfiguration> {
  const cached = openIdCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const openIdUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
  const value = await cachedFetchJson<OpenIdConfiguration>(openIdUrl);
  openIdCache.set(tenantId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function getJwks(tenantId: string): Promise<JwksResponse> {
  const cached = jwksCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const openId = await getOpenIdConfiguration(tenantId);
  const value = await cachedFetchJson<JwksResponse>(openId.jwks_uri);
  jwksCache.set(tenantId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function getAudienceAllowList(): string[] {
  const ids = [
    process.env.AZURE_CLIENT_ID,
    process.env.AZURE_AD_CLIENT_ID,
    process.env.NEXT_PUBLIC_AZURE_CLIENT_ID,
    process.env.NEXT_PUBLIC_CLIENT_ID,
    DEFAULT_ENTRA_CLIENT_ID,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (ids.length === 0) return [];

  const audience = new Set<string>();
  for (const id of ids) {
    audience.add(id);
    audience.add(`api://${id}`);
  }
  return [...audience];
}

function isAllowedIssuer(issuer: string | undefined, tenantId: string): boolean {
  if (!issuer) return false;
  const normalizedTid = tenantId.toLowerCase();
  const allowed = new Set([
    `https://login.microsoftonline.com/${normalizedTid}/v2.0`,
    `https://login.microsoftonline.com/${normalizedTid}/`,
    `https://sts.windows.net/${normalizedTid}/`,
  ]);
  return allowed.has(issuer.toLowerCase());
}

function validateStandardClaims(claims: AuthClaims): void {
  const now = Math.floor(Date.now() / 1000);
  if (claims.nbf && claims.nbf > now + CLOCK_SKEW_SECONDS) {
    throw new AuthError("Token aún no válido.", 401);
  }
  if (claims.exp && claims.exp < now - CLOCK_SKEW_SECONDS) {
    throw new AuthError("Token expirado.", 401);
  }
}

function validateAudience(claims: AuthClaims): void {
  const allowList = getAudienceAllowList();
  if (allowList.length === 0) {
    // Fail-closed: sin allow-list de audience configurada no podemos validar el
    // destinatario del token. Rechazamos en vez de aceptar cualquier audience
    // (evita que un token firmado para otra app/audience del mismo tenant pase).
    console.error(
      "[auth] Audience allow-list vacía: configurar AZURE_CLIENT_ID/AZURE_AD_CLIENT_ID/NEXT_PUBLIC_*. Rechazando (fail-closed)."
    );
    throw new AuthError("Validación de audience no configurada.", 500);
  }

  const aud = typeof claims.aud === "string" ? claims.aud : "";
  if (!allowList.includes(aud)) {
    throw new AuthError("Audiencia de token inválida.", 401);
  }
}

function resolveEmail(claims: AuthClaims): string {
  const candidates = [
    claims.preferred_username,
    claims.unique_name,
    claims.upn,
    claims.email,
  ];

  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return (found || "").toLowerCase();
}

export async function validateRequestToken(request: NextRequest): Promise<AuthClaims> {
  const token = getBearerToken(request);
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Token inválido.", 401);
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJson<JwtHeader>(base64UrlDecode(encodedHeader), "header");
  const claims = parseJson<AuthClaims>(base64UrlDecode(encodedPayload), "payload");

  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthError("Algoritmo de token inválido.", 401);
  }

  if (!claims.tid) {
    throw new AuthError("Token sin tenant.", 401);
  }

  if (claims.tid.toLowerCase() === MSA_CONSUMERS_TENANT_ID) {
    throw new AuthError(PERSONAL_ACCOUNT_REJECTION, 403);
  }

  validateStandardClaims(claims);
  validateAudience(claims);

  if (!isAllowedIssuer(typeof claims.iss === "string" ? claims.iss : undefined, claims.tid)) {
    throw new AuthError("Issuer de token inválido.", 401);
  }

  const jwks = await getJwks(claims.tid);
  const key = jwks.keys.find((item) => item.kid === header.kid && item.kty === "RSA");
  if (!key) {
    throw new AuthError("No se encontró clave pública para validar token.", 401);
  }

  const verifierInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  const signature = base64UrlDecode(encodedSignature);
  const publicKey = crypto.createPublicKey({ key, format: "jwk" });
  const isValid = crypto.verify("RSA-SHA256", verifierInput, publicKey, signature);

  if (!isValid) {
    throw new AuthError("Firma de token inválida.", 401);
  }

  return claims;
}

export type RequestIdentity = {
  claims: AuthClaims;
  tenantId: string;
  email: string;
  isCorporateDomain: boolean;
};

export async function requireRequestIdentity(request: NextRequest): Promise<RequestIdentity> {
  const claims = await validateRequestToken(request);
  const email = resolveEmail(claims);
  const isCorporateDomain = email.endsWith("@cscloudsolutions.com.ar");

  return {
    claims,
    tenantId: claims.tid,
    email,
    isCorporateDomain,
  };
}

/**
 * Autenticación máquina-a-máquina (client credentials, sin usuario/MFA) para
 * el Service Principal dedicado a pruebas de carga externas (JMeter/k6) —
 * ver docs/loadtest.md. El token se valida con el MISMO pipeline que un
 * token de usuario (firma RS256, issuer del tenant, audience de esta app,
 * vía validateRequestToken) — lo único que cambia es que en vez de resolver
 * un email de usuario, se exige que el claim `appid` (Application ID del
 * llamador, presente en todo token de client_credentials) coincida
 * EXACTAMENTE con LOAD_TEST_SP_APP_ID. Cualquier otro Service Principal del
 * mismo tenant de Entra ID —válido igual en términos de firma/issuer— es
 * rechazado. Fail-closed: sin la env var configurada, nadie pasa.
 */
export async function requireLoadTestServicePrincipal(request: NextRequest): Promise<AuthClaims> {
  const allowedAppId = process.env.LOAD_TEST_SP_APP_ID;
  if (!allowedAppId) {
    throw new AuthError("LOAD_TEST_SP_APP_ID no configurado.", 503);
  }

  const claims = await validateRequestToken(request);
  // Los tokens v2.0 de client_credentials de este tenant no traen `appid`
  // (viene ausente) — el Application ID del caller viaja en `azp` ("authorized
  // party", el claim estándar OIDC para app-only). Se acepta cualquiera de
  // los dos por robustez ante ambas variantes de token.
  const callerAppId = typeof claims.appid === "string" ? claims.appid
    : typeof claims.azp === "string" ? claims.azp
    : undefined;
  if (!callerAppId || callerAppId.toLowerCase() !== allowedAppId.toLowerCase()) {
    throw new AuthError("Service Principal no autorizado para pruebas de carga.", 403);
  }

  return claims;
}

/**
 * Internal-cron bypass: cuando una request trae el header `X-Cron-Auth`
 * con un valor que coincide exactamente con `CRON_SECRET`, se retorna una
 * identidad sintética del tenant solicitado. Útil para que pre-warmers
 * y jobs internos rellenen cachés sin pasar por OAuth.
 *
 * Requisitos de seguridad:
 *  - `CRON_SECRET` debe tener >= 16 caracteres (fail-closed si no).
 *  - Comparación timing-safe.
 *  - Solo concede acceso al tenantId indicado en el query/body — NO es superadmin global.
 */
function tryCronAuth(request: NextRequest, tenantId: string): RequestIdentity | null {
  const provided = request.headers.get("x-cron-auth");
  if (!provided) return null;

  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return null;

  // Comparación timing-safe que no depende de la longitud real del secreto:
  // comparar los strings crudos con `timingSafeEqual` requiere igual longitud
  // de antemano, y ese chequeo de longitud (`provided.length !== secret.length`)
  // es en sí mismo un side-channel de timing que revela cuántos caracteres
  // tiene CRON_SECRET. Se comparan hashes SHA-256 (longitud fija, 32 bytes)
  // en su lugar, así timingSafeEqual nunca necesita ver la longitud original.
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const secretHash = crypto.createHash("sha256").update(secret).digest();
  if (!crypto.timingSafeEqual(providedHash, secretHash)) return null;

  return {
    claims: { tid: tenantId, preferred_username: "cron@system", email: "cron@system" } as AuthClaims,
    tenantId,
    email: "cron@system",
    isCorporateDomain: true,
  };
}

export async function hasSystemRole(email: string, role: string): Promise<boolean> {
  if (!email) return false;
  const [rows] = await pool.query(
    "SELECT 1 FROM Users WHERE email = ? AND system_role = ? LIMIT 1",
    [email, role]
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function requireSuperAdmin(request: NextRequest): Promise<RequestIdentity> {
  const identity = await requireRequestIdentity(request);
  if (!identity.isCorporateDomain) {
    throw new AuthError("Acceso denegado. Se requieren privilegios de Super Administrador.", 403);
  }

  const superAdmin = await hasSystemRole(identity.email, "SUPERADMIN");
  if (!superAdmin) {
    throw new AuthError("Acceso denegado. Se requieren privilegios de Super Administrador.", 403);
  }

  return identity;
}

export async function requireTenantAccess(
  request: NextRequest,
  tenantId: string,
  options?: { allowSuperAdmin?: boolean }
): Promise<RequestIdentity> {
  // Bypass interno-cron: si llega el header X-Cron-Auth válido, retornamos
  // identidad sintética del tenant. NO degrada la seguridad para callers humanos.
  const cronIdentity = tryCronAuth(request, tenantId);
  if (cronIdentity) return cronIdentity;

  const identity = await requireRequestIdentity(request);
  const allowSuperAdmin = options?.allowSuperAdmin ?? true;

  if (identity.tenantId === tenantId) {
    return identity;
  }

  if (!allowSuperAdmin) {
    throw new AuthError("Acceso denegado al tenant.", 403, "TENANT_ACCESS_SUPERADMIN_DISABLED");
  }

  if (!identity.isCorporateDomain) {
    throw new AuthError("Acceso denegado al tenant.", 403, "TENANT_ACCESS_NOT_CORPORATE_DOMAIN");
  }

  const superAdmin = await hasSystemRole(identity.email, "SUPERADMIN");
  if (!superAdmin) {
    throw new AuthError("Acceso denegado al tenant.", 403, "TENANT_ACCESS_MISSING_SUPERADMIN_ROLE");
  }

  return identity;
}

/**
 * Requiere que el caller pertenezca al tenant (o sea SuperAdmin) Y que el tier
 * PAGADO del tenant (columna `Tenants.tier`, no un valor mandado por el
 * cliente) alcance `minTier`. Contraparte server-side del gating de
 * Sidebar/FeatureGuard, que es solo client-side y por ende no evita que un
 * tenant Professional le pegue directo a una API de una feature Business —
 * seguía la URL/token válidos, pero nunca se validaba el tier ahí.
 *
 * Uso: reemplaza `requireTenantAccess` en el handler cuando la ruta respalda
 * una feature gateada por tier en el Sidebar; deja pasar siempre a
 * SuperAdmins (mismo criterio que el resto de `requestAuth`). Los tenants
 * demo/mock nunca llegan hasta acá: `TenantProvider` intercepta el fetch en
 * el cliente para esas URLs antes de que salga al servidor.
 */
export async function requireTenantTier(
  request: NextRequest,
  tenantId: string,
  minTier: string,
  options?: { allowSuperAdmin?: boolean }
): Promise<RequestIdentity> {
  const identity = await requireTenantAccess(request, tenantId, options);

  if (identity.isCorporateDomain) {
    const superAdmin = await hasSystemRole(identity.email, "SUPERADMIN");
    if (superAdmin) return identity;
  }

  const [rows] = await pool.query(
    "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
    [tenantId]
  );
  const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { tier?: string }) : null;
  const tier = row?.tier || "Professional";

  if (!hasAccess(tier, minTier)) {
    throw new AuthError(`Esta función requiere el plan ${minTier} o superior.`, 403);
  }

  return identity;
}

/**
 * Requiere que el caller pertenezca al tenant Y tenga uno de los roles indicados
 * en la tabla Users (columna `role`). SuperAdmins (dominio corp + system_role=SUPERADMIN)
 * pasan sin chequear el role.
 */
export async function requireTenantRole(
  request: NextRequest,
  tenantId: string,
  allowedRoles: string[]
): Promise<RequestIdentity> {
  const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

  if (identity.isCorporateDomain) {
    const superAdmin = await hasSystemRole(identity.email, "SUPERADMIN");
    if (superAdmin) return identity;
  }

  if (!identity.claims.oid && !identity.email) {
    throw new AuthError("Acceso denegado: identidad incompleta.", 403);
  }

  const [rows] = await pool.query(
    `SELECT role FROM Users WHERE tenant_id = ? AND (entra_oid = ? OR email = ?) LIMIT 1`,
    [tenantId, identity.claims.oid || "", identity.email || ""]
  );
  const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { role?: string }) : null;
  const allowedLower = allowedRoles.map((r) => r.toLowerCase());
  if (!row || !row.role || !allowedLower.includes(row.role.toLowerCase())) {
    throw new AuthError(`Acceso denegado: requiere rol ${allowedRoles.join("/")}.`, 403);
  }
  return identity;
}
