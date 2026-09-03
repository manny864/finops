import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const FULFILLMENT_API_BASE = 'https://marketplaceapi.microsoft.com/api/saas';
const FULFILLMENT_API_VERSION = '2018-08-31';
const FULFILLMENT_SCOPE = '20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default';

export interface AzureResolvedSubscription {
  id: string;
  subscriptionName: string;
  offerId: string;
  planId: string;
  quantity?: number;
  subscription: AzureSubscription;
}

export interface AzureSubscription {
  id: string;
  name: string;
  publisherId: string;
  offerId: string;
  planId: string;
  quantity?: number;
  beneficiary?: { emailId?: string; objectId?: string; tenantId?: string };
  purchaser?: { emailId?: string; objectId?: string; tenantId?: string };
  saasSubscriptionStatus?: string;
  term?: { termUnit?: string; startDate?: string; endDate?: string };
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

export function clearAzureTokenCache(): void {
  tokenCache = null;
}

function ensureConfig(): { tenantId: string; clientId: string; clientSecret: string } {
  const tenantId = process.env.AZURE_MARKETPLACE_AAD_TENANT_ID;
  const clientId = process.env.AZURE_MARKETPLACE_AAD_APP_ID;
  // El nombre canónico es *_APP_SECRET: así se llama el secreto en Key Vault
  // (`azure-marketplace-aad-app-secret`), así lo hidrata `infraSecrets.ts` y así
  // está en `.env.example`. Este archivo leía *_CLIENT_SECRET, un nombre que no
  // escribe nadie — o sea que el token de Marketplace fallaba siempre con "not
  // configured" y el flujo de resolve/activate estaba muerto.
  //
  // Se acepta también el nombre viejo por si algún entorno lo tiene puesto a
  // mano; se puede quitar una vez verificado que producción usa el canónico.
  const clientSecret =
    process.env.AZURE_MARKETPLACE_AAD_APP_SECRET ||
    process.env.AZURE_MARKETPLACE_AAD_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Azure Marketplace not configured: missing AZURE_MARKETPLACE_AAD_TENANT_ID, AZURE_MARKETPLACE_AAD_APP_ID or AZURE_MARKETPLACE_AAD_APP_SECRET'
    );
  }
  return { tenantId, clientId, clientSecret };
}

export async function getAadAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const { tenantId, clientId, clientSecret } = ensureConfig();
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: FULFILLMENT_SCOPE,
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`AAD token request failed: ${resp.status} ${txt}`);
  }
  const json = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function fulfillmentFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAadAccessToken();
  const url = `${FULFILLMENT_API_BASE}${path}${path.includes('?') ? '&' : '?'}api-version=${FULFILLMENT_API_VERSION}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ms-requestid': crypto.randomUUID(),
      'x-ms-correlationid': crypto.randomUUID(),
    },
  });
}

export async function resolveSubscription(token: string): Promise<AzureResolvedSubscription> {
  const resp = await fetch(
    `${FULFILLMENT_API_BASE}/subscriptions/resolve?api-version=${FULFILLMENT_API_VERSION}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getAadAccessToken()}`,
        'Content-Type': 'application/json',
        'x-ms-marketplace-token': token,
      },
    }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`resolveSubscription failed: ${resp.status} ${txt}`);
  }
  return (await resp.json()) as AzureResolvedSubscription;
}

export async function getSubscription(subscriptionId: string): Promise<AzureSubscription> {
  const resp = await fulfillmentFetch(`/subscriptions/${subscriptionId}`);
  if (!resp.ok) {
    throw new Error(`getSubscription failed: ${resp.status}`);
  }
  return (await resp.json()) as AzureSubscription;
}

export async function activateSubscription(
  subscriptionId: string,
  planId: string,
  quantity?: number
): Promise<void> {
  const resp = await fulfillmentFetch(`/subscriptions/${subscriptionId}/activate`, {
    method: 'POST',
    body: JSON.stringify({ planId, quantity }),
  });
  if (!resp.ok && resp.status !== 200) {
    const txt = await resp.text();
    throw new Error(`activateSubscription failed: ${resp.status} ${txt}`);
  }
}

export async function patchOperation(
  subscriptionId: string,
  operationId: string,
  status: 'Success' | 'Failure',
  planId?: string,
  quantity?: number
): Promise<void> {
  const resp = await fulfillmentFetch(
    `/subscriptions/${subscriptionId}/operations/${operationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, planId, quantity }),
    }
  );
  if (!resp.ok) {
    throw new Error(`patchOperation failed: ${resp.status}`);
  }
}

const aadJwks = createRemoteJWKSet(
  new URL('https://login.microsoftonline.com/common/discovery/keys')
);

/**
 * Trusted Marketplace publisher issuers. The Microsoft SaaS Fulfillment service
 * signs webhook JWTs with one of these issuers (per Marketplace SDK docs).
 * AAD tenant ID `62e173e9-301e-423e-bcd4-29121ec1aa24` is the Microsoft
 * Marketplace publisher tenant.
 */
const ALLOWED_WEBHOOK_ISSUERS = new Set<string>([
  'https://sts.windows.net/62e173e9-301e-423e-bcd4-29121ec1aa24/',
  'https://login.microsoftonline.com/62e173e9-301e-423e-bcd4-29121ec1aa24/v2.0',
]);

function isAllowedIssuer(iss: unknown): boolean {
  if (typeof iss !== 'string') return false;
  if (ALLOWED_WEBHOOK_ISSUERS.has(iss)) return true;
  const extra = process.env.AZURE_MARKETPLACE_TRUSTED_ISSUERS;
  if (extra) {
    return extra.split(',').map((s) => s.trim()).includes(iss);
  }
  return false;
}

export async function verifyWebhookJwt(authHeader: string | null): Promise<JWTPayload> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing Bearer token');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error('Empty token');

  if (process.env.MARKETPLACE_SKIP_VERIFY === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MARKETPLACE_SKIP_VERIFY is not allowed in production');
    }
    const [, payload] = token.split('.');
    if (!payload) throw new Error('Invalid JWT format');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JWTPayload;
  }

  const expectedAudience = process.env.AZURE_MARKETPLACE_AAD_APP_ID;
  const { payload } = await jwtVerify(token, aadJwks, {
    audience: expectedAudience,
  });
  if (!isAllowedIssuer(payload.iss)) {
    throw new Error(`Untrusted webhook issuer: ${String(payload.iss)}`);
  }
  return payload;
}
