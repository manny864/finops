/**
 * Frontera entre clientes para lo que se escribe en Azure.
 *
 * Con Lighthouse la credencial es una sola, la nuestra, delegada sobre las
 * suscripciones de TODOS los clientes (`getLighthouseCredential`). ARM no sabe
 * qué tenant de la plataforma hace el pedido: si el body trae el id de un
 * recurso de otro cliente, ARM lo ejecuta. Este chequeo es lo único que lo
 * impide, y por eso va antes de cada escritura cuyo scope viene del llamador.
 *
 * Vive fuera de `azure.ts` para que los tests puedan simular
 * `listTenantSubscriptions`: una llamada interna del mismo módulo no se mockea.
 */

import { listTenantSubscriptions } from "@/lib/azure";
import { getAccessModel } from "@/lib/lighthouseAccess";
import { isMockTenant } from "@/lib/mockData";
import { AuthError } from "@/lib/requestAuth";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIVEL_TENANT = "nivel-tenant";

/**
 * A qué suscripción llega un pedido a ARM sobre `scope`, que puede ser un
 * subscriptionId suelto o un path `/subscriptions/{id}/...`. Devuelve
 * NIVEL_TENANT para `/providers/...` (management groups, reservas) y null
 * cuando no se puede afirmar.
 *
 * Los llamadores concatenan el scope en la URL (`https://management.azure.com${scope}`).
 * El parser de URL resuelve `..` y `%2e`, toma `\` como `/`, descarta tabs y
 * corta en `?` y `#`, así que un texto que empieza en una suscripción propia
 * puede terminar pidiendo otra. Y sin la `/` inicial cambia hasta el host:
 * `.evil.com/...` se lleva nuestro token. Ningún id legítimo de ARM usa nada de
 * eso, así que no se interpreta: se rechaza.
 */
function destinoDelScope(scope: unknown): string | null {
  const s = typeof scope === "string" ? scope : "";
  if (GUID.test(s)) return s.toLowerCase();
  if (!s.startsWith("/") || /[\\?#%\x00-\x1f\x7f]/.test(s)) return null;
  const partes = s.split("/").slice(1);
  if (partes.some((p) => p === "." || p === "..")) return null;
  const raiz = partes[0].toLowerCase();
  if (raiz === "providers") return NIVEL_TENANT;
  return raiz === "subscriptions" && GUID.test(partes[1] ?? "") ? partes[1].toLowerCase() : null;
}

/**
 * Exige que cada scope sea del tenant. Si alguno no lo es, lanza un AuthError
 * 404 (no 403) para no confirmar que el recurso de otro cliente existe. Las
 * rutas ya responden un AuthError con su status, así que el 404 llega sin tocar
 * sus catch.
 *
 * - Suscripción: tiene que estar en lo que ARM atribuye al directorio del
 *   tenant (`listTenantSubscriptions`). No se usa `getSubscriptionsForTenant`
 *   porque, si ARM no contesta, cae a `TenantDelegations`, que el propio tenant
 *   carga sin verificar, y una escritura no se autoriza con un dato que aportó
 *   quien la pide. Si ARM falla, no se escribe.
 * - Nivel tenant: ARM lo resuelve en el directorio del TOKEN (Learn,
 *   Reservation - List All: "in the current tenant"). Con app registration ese
 *   directorio es el del cliente. Con Lighthouse es el nuestro, porque
 *   Lighthouse delega sólo suscripciones y resource groups, así que ahí nunca
 *   es del cliente.
 */
export async function exigirScopesDelTenant(tenantId: string, scopes: unknown[]): Promise<void> {
  // Un tenant mock no tiene Azure detrás: sus rutas responden simulado.
  if (isMockTenant(tenantId)) return;

  const destinos = scopes.map(destinoDelScope);
  const subs = destinos.filter((d): d is string => !!d && d !== NIVEL_TENANT);
  let propio = !destinos.includes(null);
  if (propio && destinos.includes(NIVEL_TENANT)) {
    propio = (await getAccessModel(tenantId)) !== "lighthouse";
  }
  if (propio && subs.length > 0) {
    const delTenant = new Set(
      (await listTenantSubscriptions(tenantId)).map((s) => s.subscriptionId.toLowerCase())
    );
    propio = subs.every((s) => delTenant.has(s));
  }
  if (!propio) {
    console.warn(`[scope] ${tenantId} pidió escribir fuera de su tenant:`, JSON.stringify(scopes).slice(0, 500));
    throw new AuthError("El recurso no existe o no pertenece a este tenant.", 404);
  }
}
