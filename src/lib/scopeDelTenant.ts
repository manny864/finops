/**
 * Frontera entre clientes para lo que se lee o se escribe en Azure.
 *
 * Con Lighthouse la credencial es una sola, la nuestra, delegada sobre las
 * suscripciones de TODOS los clientes (`getLighthouseCredential`). ARM no sabe
 * qué tenant de la plataforma hace el pedido: si el request trae el id de un
 * recurso de otro cliente, ARM lo ejecuta o lo devuelve. Este chequeo es lo
 * único que lo impide, y por eso va antes de cada llamada cuyo scope viene del
 * llamador, sea escritura o lectura.
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
 * Las suscripciones del tenant según ARM, 60 s en memoria.
 *
 * Desde que las lecturas pasan por acá, el chequeo corre en rutas calientes:
 * un tablero dispara varias en paralelo con la misma suscripción. Sin memoria,
 * cada una pagaba un `GET /subscriptions` a ARM (0,35 a 0,9 s medidos el
 * 2026-10-06) y, con app registration, además un token nuevo, porque
 * `getAzureCredential` arma una credencial por llamada. Las concurrentes
 * comparten la misma promesa.
 *
 * No se reusa `getAllSubscriptionsForTenant`, que también cachea 60 s, porque
 * si ARM falla devuelve lo que hay en base, y eso no sirve de autoridad. Acá
 * un fallo no se recuerda: el pedido siguiente vuelve a preguntarle a ARM.
 * Una lista vacía tampoco, por el mismo motivo que allá: suele ser un 429 o
 * un permiso que todavía no propagó, y negaría todo durante un minuto.
 */
const SUBS_TTL_MS = 60_000;
const subsPorTenant = new Map<string, { subs: Promise<Set<string>>; expira: number }>();

function subsDelTenant(tenantId: string): Promise<Set<string>> {
  const vigente = subsPorTenant.get(tenantId);
  if (vigente && Date.now() < vigente.expira) return vigente.subs;

  const entrada = {
    subs: listTenantSubscriptions(tenantId).then((l) => new Set(l.map((s) => s.subscriptionId.toLowerCase()))),
    expira: Date.now() + SUBS_TTL_MS,
  };
  const olvidar = () => {
    if (subsPorTenant.get(tenantId) === entrada) subsPorTenant.delete(tenantId);
  };
  entrada.subs.then((s) => s.size === 0 && olvidar(), olvidar);
  subsPorTenant.set(tenantId, entrada);
  return entrada.subs;
}

/** Para los tests, que simulan distintas listas para el mismo tenant. */
export function olvidarSubsDelTenant(): void {
  subsPorTenant.clear();
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
 *   carga sin verificar, y un acceso no se autoriza con un dato que aportó
 *   quien lo pide. Si ARM falla, no se lee ni se escribe.
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
    const delTenant = await subsDelTenant(tenantId);
    propio = subs.every((s) => delTenant.has(s));
  }
  if (!propio) {
    console.warn(`[scope] ${tenantId} pidió un scope fuera de su tenant:`, JSON.stringify(scopes).slice(0, 500));
    throw new AuthError("El recurso no existe o no pertenece a este tenant.", 404);
  }
}

/**
 * Para las lecturas que reciben UNA suscripción opcional (`?subscriptionId=`).
 * Vacía o "All" significa "todas las del tenant": esas rutas arman la lista
 * ellas mismas, así que no hay nada que validar. Existe para no repetir esa
 * condición en treinta rutas, donde un error de tipeo abre la frontera.
 */
export async function exigirSuscripcionDelTenant(tenantId: string, subscriptionId: string | null | undefined): Promise<void> {
  if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
    await exigirScopesDelTenant(tenantId, [subscriptionId]);
  }
}

/**
 * Para las lecturas que reciben VARIAS suscripciones: devuelve las del tenant
 * y descarta el resto en silencio, así un filtro viejo de la UI no rompe la
 * pantalla. Si no queda ninguna responde 404, igual que una sola ajena: varios
 * llamadores toman la lista vacía como "sin filtro", y una consulta de Resource
 * Graph sin suscripciones abarca todo lo que ve la credencial, que con
 * Lighthouse son todos los clientes.
 */
export async function soloSuscripcionesDelTenant(tenantId: string, subscriptionIds: string[]): Promise<string[]> {
  if (isMockTenant(tenantId)) return subscriptionIds;
  const delTenant = await subsDelTenant(tenantId);
  const propias = subscriptionIds.filter((s) => GUID.test(s) && delTenant.has(s.toLowerCase()));
  if (propias.length === 0) {
    console.warn(`[scope] ${tenantId} pidió suscripciones fuera de su tenant:`, JSON.stringify(subscriptionIds).slice(0, 500));
    throw new AuthError("El recurso no existe o no pertenece a este tenant.", 404);
  }
  return propias;
}
