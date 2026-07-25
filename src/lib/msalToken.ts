import type { IPublicClientApplication, AccountInfo, AuthenticationResult } from '@azure/msal-browser';
import { getLocalToken } from './localSession';

/**
 * Decodifica el payload de un JWT (sin validar firma) para chequear `exp`.
 */
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Obtiene un idToken válido de MSAL.
 *
 * `acquireTokenSilent` devuelve el idToken cacheado aunque ya esté caducado
 * (a diferencia del access token que sí refresca). Por eso decodificamos el
 * `exp` del JWT y forzamos `forceRefresh: true` si quedan <5 min de vida.
 *
 * Lanza si no se puede obtener un token (por ejemplo, sesión revocada).
 */
export async function getFreshIdToken(
  instance: IPublicClientApplication,
  account: AccountInfo,
  scopes: string[] = ['User.Read']
): Promise<string> {
  // Identidad propia (tenants AWS, sin Entra). Éste es el ÚNICO lugar donde el
  // frontend se entera de que existen dos tipos de sesión: los ~264 call sites
  // de getFreshIdToken siguen pidiendo "un token" y reciben el que corresponda.
  // Va ANTES del corte por `!account` porque un usuario local nunca tiene
  // AccountInfo de MSAL y si no caería en la rama 'demo'.
  const localToken = getLocalToken();
  if (localToken) return localToken;

  // Sin cuenta real no hay nada que pedirle a MSAL — típicamente sesión de
  // demo/mock (ver TenantProvider: intercepta window.fetch por URL para esos
  // tenants). Sin este corte, acquireTokenSilent(..., account: undefined)
  // lanza no_account_error ANTES de llegar al fetch(), y el interceptor de
  // demo nunca se ejecuta pese a tener el mock data listo.
  if (!account) return 'demo';

  const SKEW_SECONDS = 300; // 5 min de margen

  let result: AuthenticationResult = await instance.acquireTokenSilent({
    scopes,
    account,
  });

  const exp = decodeJwtExp(result.idToken);
  const nowS = Math.floor(Date.now() / 1000);

  if (!exp || exp - nowS < SKEW_SECONDS) {
    result = await instance.acquireTokenSilent({
      scopes,
      account,
      forceRefresh: true,
    });
  }

  return result.idToken;
}

/**
 * Access token (no idToken) para llamar directamente a Microsoft Graph desde
 * el cliente (ej. foto de perfil en `/me/photo/$value`). El scope `User.Read`
 * ya se usa en el login, así que esto no pide consentimiento adicional.
 */
export async function getGraphAccessToken(
  instance: IPublicClientApplication,
  account: AccountInfo,
  scopes: string[] = ['User.Read']
): Promise<string | null> {
  if (!account) return null;
  try {
    const result = await instance.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch {
    return null;
  }
}

/**
 * `fetch` con retry automático en 401: si la respuesta es 401, fuerza refresh
 * del idToken y reintenta una sola vez. Útil cuando el token caducó entre
 * que el usuario abrió la página y disparó la llamada.
 */
export async function fetchWithAuthRetry(
  instance: IPublicClientApplication,
  account: AccountInfo,
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  scopes: string[] = ['User.Read']
): Promise<Response> {
  const idToken = await getFreshIdToken(instance, account, scopes);
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${idToken}`,
  };

  const res = await fetch(url, { ...init, headers });
  if (res.status !== 401 || !account) return res;

  const freshToken = await instance.acquireTokenSilent({
    scopes,
    account,
    forceRefresh: true,
  });

  return fetch(url, {
    ...init,
    headers: { ...headers, Authorization: `Bearer ${freshToken.idToken}` },
  });
}
