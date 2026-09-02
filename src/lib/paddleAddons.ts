import pool from "@/modules/storage/db";

/**
 * Add-ons de capacidad comprados en Paddle: de los ítems de la suscripción a
 * la capacidad efectiva del tenant.
 *
 * POR QUÉ SE *FIJA* Y NO SE INCREMENTA
 * El plan original (MEJ-15 fase 2) proponía, sobre `transaction.completed`:
 *     UPDATE Tenants SET additional_tenant_slots = additional_tenant_slots + 1
 * Eso está mal para un add-on MENSUAL: `transaction.completed` dispara en cada
 * RENOVACIÓN, así que el cliente acumularía un slot por mes hasta el infinito.
 *
 * La cantidad vigente en la suscripción es la única fuente de verdad. Fijarla
 * (en vez de sumar) sale gratis en tres frentes:
 *  - Las reentregas de webhook son inocuas: fijar dos veces el mismo número da
 *    el mismo número.
 *  - Bajar el add-on de 3 a 1 baja la capacidad sola.
 *  - Cancelarlo lo saca de los ítems, la cantidad queda en 0 y la capacidad
 *    vuelve a la del plan. No hace falta manejar refunds por separado.
 */

export type CapacityAddon = "additional_tenant_slot" | "additional_subscription_slot";

/**
 * Cada add-on tiene un precio DISTINTO por tier (una suscripción extra sale
 * $50 en Professional y $40 en Business), así que en Paddle son dos productos
 * con dos precios cada uno: cuatro price IDs en total.
 *
 * Enterprise no figura a propósito: su capacidad va dentro del contrato
 * negociado, no se compra por unidad.
 */
const ADDON_ENV_VARS: Array<{ env: string; addon: CapacityAddon; tier: string }> = [
  { env: "PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_PROFESSIONAL", addon: "additional_subscription_slot", tier: "Professional" },
  { env: "PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_BUSINESS",     addon: "additional_subscription_slot", tier: "Business" },
  { env: "PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL",       addon: "additional_tenant_slot",       tier: "Professional" },
  { env: "PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS",           addon: "additional_tenant_slot",       tier: "Business" },
];

/**
 * Mapa price_id -> add-on, con los CUATRO IDs.
 *
 * El webhook sólo necesita saber QUÉ add-on es cada ítem, no de qué tier: un
 * tenant que cambió de plan puede tener el precio del tier anterior en su
 * suscripción hasta la próxima renovación, y esa capacidad se le tiene que
 * seguir acreditando igual.
 */
export function getAddonPriceIdMap(): Record<string, CapacityAddon> {
  const map: Record<string, CapacityAddon> = {};
  for (const { env, addon } of ADDON_ENV_VARS) {
    const priceId = process.env[env];
    if (priceId) map[priceId] = addon;
  }
  return map;
}

/**
 * El price ID que corresponde contratar para un tier. Lo usa la ruta de
 * autoservicio: cobrar el precio de Business a un Professional (o al revés)
 * sería facturar mal.
 *
 * `null` si ese tier no tiene precio configurado — Enterprise siempre, y
 * cualquier tier cuyo ID falte en el entorno.
 */
export function getAddonPriceIdForTier(addon: CapacityAddon, tier: string): string | null {
  const entry = ADDON_ENV_VARS.find((e) => e.addon === addon && e.tier === tier);
  return entry ? process.env[entry.env] || null : null;
}

/**
 * Cantidades por add-on según los ítems de la suscripción. Un add-on que no
 * aparece en los ítems devuelve 0 EXPLÍCITAMENTE: es lo que hace que dar de
 * baja el add-on baje la capacidad.
 */
export function resolveAddonQuantities(items: unknown): Record<CapacityAddon, number> {
  const priceMap = getAddonPriceIdMap();
  const quantities: Record<CapacityAddon, number> = {
    additional_tenant_slot: 0,
    additional_subscription_slot: 0,
  };

  if (!Array.isArray(items)) return quantities;

  for (const item of items as any[]) {
    // Paddle manda `price.id` en los ítems de suscripción; algunos payloads
    // traen `price_id` plano.
    const priceId = item?.price?.id || item?.price_id;
    const addon = priceId ? priceMap[priceId] : undefined;
    if (!addon) continue;
    const qty = Number(item?.quantity);
    if (Number.isFinite(qty) && qty > 0) quantities[addon] += qty;
  }

  return quantities;
}

/**
 * Escribe la capacidad comprada. Sólo toca las columnas de add-on: el tier, el
 * estado y las fechas los maneja el handler de la suscripción.
 *
 * Devuelve `false` si no hay ningún price ID de add-on configurado — así el
 * webhook no pisa con ceros la capacidad de un tenant al que se le cargó
 * capacidad a mano, en un entorno donde los add-ons todavía no existen en
 * Paddle.
 */
export async function applyAddonCapacity(
  tenantId: string,
  quantities: Record<CapacityAddon, number>
): Promise<boolean> {
  if (Object.keys(getAddonPriceIdMap()).length === 0) {
    console.warn("[paddleAddons] Sin PADDLE_ADDITIONAL_*_PRICE_ID configurados: no se toca la capacidad.");
    return false;
  }

  await pool.query(
    "UPDATE Tenants SET additional_tenant_slots = ? WHERE tenant_id = ?",
    [quantities.additional_tenant_slot, tenantId]
  );

  // El registro de facturación puede no existir todavía (alta manual desde
  // SuperAdmin): se crea con lo mínimo para no perder los slots pagos.
  await pool.query(
    `INSERT INTO TenantSubscriptions (id, tenant_id, purchased_subscription_slots)
     VALUES (UUID(), ?, ?)
     ON DUPLICATE KEY UPDATE purchased_subscription_slots = VALUES(purchased_subscription_slots)`,
    [tenantId, quantities.additional_subscription_slot]
  );

  console.log(
    `[paddleAddons] tenant=${tenantId} tenants_extra=${quantities.additional_tenant_slot} subs_extra=${quantities.additional_subscription_slot}`
  );
  return true;
}
