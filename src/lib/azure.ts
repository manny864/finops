import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { attachQuotaTracking } from "@/lib/azureQuotaTracking";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";
import { getSubscriptionLimit } from "@/lib/tierLogic";
import { getEffectiveSubscriptionLimit } from "@/lib/subscriptionQuota";
import { errorMessage } from '@/lib/apiErrors';
import { getAccessModel, getLighthouseCredential } from "@/lib/lighthouseAccess";

export function isSubscriptionStateEligible(state: unknown): boolean {
  const normalized = String(state || "").trim().toLowerCase();
  if (!normalized) return true;
  // Excluimos solo estados terminales/no utilizables; el resto se conserva
  // para no perder subs con costo real por estados transitorios (Warned/PastDue).
  return !["deleted", "disabled", "expired", "canceled", "cancelled"].includes(normalized);
}

export type ArmSubscription = {
  subscriptionId: string;
  state?: string;
  displayName?: string;
  tenantId?: string;
};

/**
 * Suscripciones que ARM devuelve para un tenant, **filtradas por el directorio
 * al que pertenecen**.
 *
 * Un token emitido para el tenant A no devuelve solamente las suscripciones de
 * A. Basta con que el service principal tenga RBAC sobre una suscripción de
 * otro directorio (invitado B2B, transferencia, delegación) para que ARM la
 * liste igual. Medido contra Azure real: el token de "CS CloudSolutions Azure
 * Patrocinio" devolvía `CSCloudSolution-Production`, que vive en otro tenant.
 * Los dos clientes terminaban mezclados en el selector de alcance, en los
 * cobros y en el inventario, sólo porque el nombre se parecía.
 *
 * El dato para cortar ya venía en la respuesta: cada suscripción trae su
 * `tenantId`, que es su directorio de origen. Nadie lo miraba.
 *
 * Con Lighthouse vale lo mismo, y no es una suposición. El token sale de
 * NUESTRO directorio y ARM devuelve las suscripciones de TODOS los clientes que
 * nos delegaron, pero cada una sigue declarando en `tenantId` el directorio del
 * cliente; el nuestro aparece aparte, en `managedByTenants`. El ejemplo de la
 * documentación de ARM (`Subscriptions - List`) es justo el caso MSP: dos
 * suscripciones con `tenantId` distinto (`31c75423…` y `2a0ff0de…`) y el mismo
 * `managedByTenants` (`8f70baf1…`). Filtrar por `tenantId` es correcto en los
 * dos modelos; hacerlo por `managedByTenants` mezclaría a todos los clientes
 * delegados, que es exactamente el bug que esto arregla.
 *
 * Se descarta lo que no coincide en vez de confiar: una suscripción sin
 * `tenantId` no se puede atribuir, y ante la duda no entra. Cruzar el límite de
 * un cliente es peor que mostrar de menos.
 */
export async function listTenantSubscriptions(
  tenantId: string,
  credential?: ClientSecretCredential,
  signal?: AbortSignal
): Promise<ArmSubscription[]> {
  const esperado = String(tenantId || "").trim().toLowerCase();
  if (!esperado) return [];

  const cred = credential || (await getAzureCredential(tenantId));
  const tokenResponse = await cred.getToken("https://management.azure.com/.default");
  if (!tokenResponse?.token) return [];

  const out: ArmSubscription[] = [];
  const seen = new Set<string>();
  const ajenas = new Map<string, string>();
  let nextUrl: string | null = "https://management.azure.com/subscriptions?api-version=2020-01-01";

  while (nextUrl) {
    const fetchRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${tokenResponse.token}` },
      signal,
    });
    // Un 403 acá no es "no hay suscripciones": es que falta el rol de Lector.
    // El onboarding depende de poder distinguirlo, asi que sube como error en
    // vez de degradar a lista vacia. El resto de los fallos si corta callado,
    // como antes, porque los colectores ya toleran una lista incompleta.
    if (fetchRes.status === 401 || fetchRes.status === 403) {
      const err = new Error(
        `AccessDenied: ARM respondió ${fetchRes.status} al listar suscripciones del tenant ${esperado}`
      ) as Error & { statusCode?: number; code?: string };
      err.statusCode = fetchRes.status;
      err.code = "AccessDenied";
      throw err;
    }
    if (!fetchRes.ok) break;

    const data: any = await fetchRes.json();
    for (const sub of data.value || []) {
      const id = String(sub?.subscriptionId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const duenio = String(sub?.tenantId || "").trim().toLowerCase();
      if (duenio !== esperado) {
        ajenas.set(id, duenio || "(sin tenantId)");
        continue;
      }
      out.push({
        subscriptionId: id,
        state: sub?.state,
        displayName: sub?.displayName,
        tenantId: sub?.tenantId,
      });
    }

    const candidate: string = String(data?.nextLink || "").trim();
    nextUrl = candidate.length > 0 ? candidate : null;
  }

  if (ajenas.size > 0) {
    console.warn(
      `[azure] ${ajenas.size} suscripción(es) descartada(s) por pertenecer a otro directorio (tenant pedido ${esperado}): ` +
        [...ajenas].map(([id, t]) => `${id}→${t}`).join(", ")
    );
  }

  return out;
}

export async function getAzureCredential(tenantId: string) {
  await initializeDatabase();

  const clean = (v: string | undefined): string =>
    (v ?? "").trim().replace(/^["']+|["']+$/g, "");
  const cleanTid = clean(tenantId);

  // Con Lighthouse la autoridad del token es NUESTRO directorio, no el del
  // cliente: nuestro service principal no existe en el suyo. Es la diferencia
  // entera entre los dos modelos, y por eso la delegacion no servia de nada
  // aunque se creara bien --todo terminaba pidiendo el token contra el tenant
  // equivocado--. Ver `lighthouseAccess.ts`.
  if ((await getAccessModel(cleanTid)) === "lighthouse") {
    return getLighthouseCredential();
  }

  const creds = await getTenantCredentials(cleanTid);
  const clientId = creds?.clientId || clean(process.env.AZURE_CLIENT_ID);
  const clientSecret = creds?.clientSecret || clean(process.env.AZURE_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error(`Faltan credenciales (Client ID o Secret) para el tenant ${tenantId}. Verifique el Onboarding.`);
  }

  return new ClientSecretCredential(cleanTid, clientId, clientSecret);
}

/**
 * Suscripciones de Azure visibles para el Service Principal del tenant,
 * truncadas al límite de plan (Professional=5, Business=20,
 * Enterprise=sin límite — ver SUBSCRIPTION_LIMITS en tierLogic.ts).
 */
/**
 * Mapa subscriptionId -> displayName real de Azure.
 *
 * Existe porque varios servicios necesitaban el NOMBRE y solo tenian el id, y
 * la salida era inventarselo: `commitmentRecommendations.service.ts` armaba
 * `Sub (0beb7800...)` con los primeros 8 caracteres del GUID, y eso es lo que
 * el usuario veia en el filtro de suscripciones del drilldown.
 *
 * El dato ya venia en la respuesta de ARM --`displayName` en
 * /subscriptions?api-version=2020-01-01-- y `listTenantSubscriptions` lo
 * descartaba. No agrega una llamada: reusa la que ya se hacia.
 *
 * Devuelve un Map vacio si ARM falla. El llamador decide el fallback; ninguno
 * deberia ser un GUID recortado.
 */
export async function getSubscriptionNameMap(
  tenantId: string,
  credential?: ClientSecretCredential
): Promise<Map<string, string>> {
  const cred = credential || (await getAzureCredential(tenantId));
  const map = new Map<string, string>();
  try {
    for (const sub of await listTenantSubscriptions(tenantId, cred)) {
      if (sub.subscriptionId && sub.displayName) {
        map.set(sub.subscriptionId, sub.displayName);
      }
    }
  } catch (e) {
    console.error(`[azure] Error resolviendo nombres de suscripcion para ${tenantId}:`, e);
  }
  return map;
}

export async function getSubscriptionsForTenant(
  tenantId: string,
  credential?: ClientSecretCredential
): Promise<string[]> {
  const cred = credential || (await getAzureCredential(tenantId));
  const subs = new Set<string>();

  try {
    const discovered = await listTenantSubscriptions(tenantId, cred);
    for (const sub of discovered) {
      if (sub.subscriptionId && isSubscriptionStateEligible(sub.state)) {
        subs.add(String(sub.subscriptionId));
      }
    }
  } catch (e) {
    console.error(`[azure] Error fetching subscriptions for tenant ${tenantId}:`, e);
  }

  for (const subId of await getStoredSubscriptionsForTenant(tenantId)) {
    subs.add(subId);
  }

  // MEJ-25: la exclusión se aplica ACÁ TAMBIÉN, no sólo en
  // `getAllSubscriptionsForTenant`.
  //
  // El comentario de esa función dice que es "el único punto por el que pasa
  // todo colector y cockpit". No lo era: esta función es una segunda vía de
  // descubrimiento y la usan 69 archivos contra 16 de la otra. El resultado era
  // justo lo que ese comentario quería evitar — una exclusión a medias: la
  // suscripción desaparecía de Cuentas Cloud y seguía apareciendo en Usuarios y
  // Accesos y en el inventario de recursos.
  //
  // Va ANTES del truncado por tier a propósito: filtrando después, una
  // suscripción desvinculada ocuparía uno de los cupos del plan y el cliente
  // perdería una suscripción visible por cada una que da de baja.
  const excluded = await getExcludedSubscriptionIds(tenantId);
  for (const subId of subs) {
    if (excluded.has(subId.toLowerCase())) subs.delete(subId);
  }

  const subList = Array.from(subs);
  if (subList.length === 0) return subList;

  let tier = "Professional";
  try {
    const [rows]: any = await pool.query(
      `SELECT COALESCE(t.tier, p.tier, 'Professional') as tier
       FROM Tenants t
       LEFT JOIN Tenants p ON t.parent_tenant_id = p.tenant_id
       WHERE t.tenant_id = ?
       LIMIT 1`,
      [tenantId]
    );
    tier = rows?.[0]?.tier || "Professional";
  } catch {
    try {
      const [rows]: any = await pool.query(
        `SELECT t.tier FROM Tenants t WHERE t.tenant_id = ? LIMIT 1`,
        [tenantId]
      );
      tier = rows?.[0]?.tier || "Professional";
    } catch {
      tier = "Professional";
    }
  }

  try {
    // Tope efectivo = plan + slots comprados. Antes salía sólo del mapa fijo
    // por tier, así que comprar suscripciones extra no levantaba el límite.
    const limit = await getEffectiveSubscriptionLimit(tenantId, tier);
    if (Number.isFinite(limit) && subList.length > limit) {
      console.warn(
        `[azure] Tenant ${tenantId} (${tier}): ${subList.length} suscripciones visibles, límite del plan es ${limit}. Truncando (orden estable por ID).`
      );
      return [...subList].sort().slice(0, limit);
    }
  } catch (e) {
    console.warn(
      `[azure] No se pudo verificar el límite de suscripciones para ${tenantId}, devolviendo lista completa:`,
      errorMessage(e)
    );
  }

  return subList;
}

/**
 * Get ALL subscriptions accessible by the Service Principal, WITHOUT plan limits.
 */
export async function getAllSubscriptionsForTenant(
  tenantId: string,
  credential?: ClientSecretCredential
): Promise<string[]> {
  const cred = credential || (await getAzureCredential(tenantId));
  const subs = new Set<string>();

  try {
    const discovered = await listTenantSubscriptions(tenantId, cred);
    for (const sub of discovered) {
      if (sub.subscriptionId && isSubscriptionStateEligible(sub.state)) {
        subs.add(String(sub.subscriptionId));
      }
    }
    console.log(`[azure] getAllSubscriptionsForTenant(${tenantId}): Found ${subs.size} subscriptions via Management API`);
  } catch (e) {
    console.error(`[azure] Error fetching subscriptions for tenant ${tenantId}:`, e);
  }

  for (const subId of await getStoredSubscriptionsForTenant(tenantId)) {
    subs.add(subId);
  }

  // MEJ-25: las suscripciones desvinculadas se filtran acá, el único punto por
  // el que pasa todo colector y cockpit. Filtrar en cada llamador habría dejado
  // la exclusión a medias, y borrar filas no sirve: el descubrimiento las
  // vuelve a encontrar en el siguiente sync.
  const excluded = await getExcludedSubscriptionIds(tenantId);
  for (const subId of subs) {
    if (excluded.has(subId.toLowerCase())) subs.delete(subId);
  }

  if (subs.size === 0) {
    console.log(`[azure] getAllSubscriptionsForTenant(${tenantId}): WARNING - No subscriptions found`);
  }

  return Array.from(subs);
}

/**
 * Suscripciones que el tenant desvinculó a mano (MEJ-25). En minúsculas: los
 * GUID llegan con distinta capitalización según la fuente (ARM, Cost
 * Management, delegaciones).
 */
export async function getExcludedSubscriptionIds(tenantId: string): Promise<Set<string>> {
  try {
    const [rows]: any = await pool.query(
      `SELECT subscription_id FROM TenantExcludedSubscriptions WHERE tenant_id = ?`,
      [tenantId]
    );
    return new Set((rows || []).map((r: any) => String(r.subscription_id || '').toLowerCase()));
  } catch (e: any) {
    // Sin la tabla (migración no aplicada todavía) no se excluye nada.
    if (e?.code !== 'ER_NO_SUCH_TABLE') {
      console.warn(`[azure] TenantExcludedSubscriptions lookup failed for ${tenantId}:`, errorMessage(e));
    }
    return new Set();
  }
}

async function getStoredSubscriptionsForTenant(tenantId: string): Promise<string[]> {
  const fromDb = new Set<string>();

  try {
    const [rows]: any = await pool.query(
      `SELECT DISTINCT managed_subscription_id AS subscription_id
       FROM TenantDelegations
       WHERE tenant_id = ? AND managed_subscription_id IS NOT NULL AND managed_subscription_id <> ''`,
      [tenantId]
    );
    for (const row of rows || []) {
      if (row?.subscription_id) fromDb.add(String(row.subscription_id));
    }
  } catch (e) {
    console.warn(`[azure] TenantDelegations subscription lookup failed for ${tenantId}:`, errorMessage(e));
  }

  try {
    const [rows]: any = await pool.query(
      `SELECT DISTINCT subscription_id
       FROM CostSnapshots
       WHERE tenant_id = ? AND subscription_id IS NOT NULL AND subscription_id NOT IN ('', 'default', 'mg-aggregated')`,
      [tenantId]
    );
    for (const row of rows || []) {
      if (row?.subscription_id) fromDb.add(String(row.subscription_id));
    }
  } catch (e) {
    console.warn(`[azure] CostSnapshots subscription lookup failed for ${tenantId}:`, errorMessage(e));
  }

  return Array.from(fromDb);
}

export async function getComputeClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new ComputeManagementClient(credential, subscriptionId);
}

export async function getNetworkClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new NetworkManagementClient(credential, subscriptionId);
}

/**
 * Cliente de Resource Graph instrumentado.
 *
 * El policy de cuota se engancha acá y no en cada call site porque esta factory
 * ya es el punto único: la usan 130 lugares. Cada respuesta de ARG trae
 * `x-ms-user-quota-remaining`, que antes se descartaba.
 */
export async function getResourceGraphClient(tenantId: string) {
  const credential = await getAzureCredential(tenantId);
  return attachQuotaTracking(new ResourceGraphClient(credential), tenantId, 'RESOURCE_GRAPH');
}

/**
 * Cliente de Cost Management instrumentado.
 *
 * No existía factory: cada colector hacía `new CostManagementClient(credential)`
 * por su cuenta. Los call sites que se migren a esta empiezan a reportar cuota;
 * los que no, siguen funcionando igual (sólo no aportan mediciones).
 */
export async function getCostManagementClient(tenantId: string) {
  const credential = await getAzureCredential(tenantId);
  return attachQuotaTracking(new CostManagementClient(credential), tenantId, 'COST_MANAGEMENT');
}
