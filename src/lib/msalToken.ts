import type { IPublicClientApplication, AccountInfo, AuthenticationResult } from '@azure/msal-browser';

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
  if (res.status !== 401) return res;

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
