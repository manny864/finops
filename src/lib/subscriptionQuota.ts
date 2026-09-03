import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";
import { getSubscriptionLimit } from "@/lib/tierLogic";

/**
 * Cuota de suscripciones de Azure: cuántas ve el tenant y cuántas le permite su
 * plan.
 *
 * Vive en su propio módulo para que `azure.ts` (que trunca) y
 * `tierLimitsGuard.ts` (que informa) usen EXACTAMENTE la misma cuenta sin
 * importarse entre sí. Antes cada uno resolvía lo suyo y no coincidían.
 *
 * BUG QUE ARREGLA (2026-09-01)
 * `getTenantTierLimitStatus` contaba con
 *   SELECT COUNT(DISTINCT subscription_id) FROM TenantSubscriptions
 * pero `TenantSubscriptions` es el registro de FACTURACIÓN (un renglón por
 * tenant: plan, ids de Paddle) y NO TIENE columna `subscription_id`. La
 * consulta tiraba "Unknown column", el catch la tragaba, el fallback tiraba lo
 * mismo, y el contador quedaba en 0. Resultado: el endpoint `/tier-limits` le
 * informaba "0 suscripciones usadas" a todos los tenants, siempre — mientras
 * `azure.ts` sí truncaba de verdad. El cliente veía 2 de sus 10 suscripciones
 * y un medidor que decía que no había usado ninguna.
 */

/**
 * Las suscripciones que la plataforma conoce para el tenant, contadas desde la
 * base (sin llamar a Azure): las delegaciones registradas más las que aparecen
 * con costo. Es la misma fuente que usa `getStoredSubscriptionsForTenant` en
 * `azure.ts`.
 */
export async function countStoredSubscriptions(tenantId: string): Promise<number> {
  const ids = new Set<string>();

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT managed_subscription_id AS subscription_id
         FROM TenantDelegations
        WHERE tenant_id = ? AND managed_subscription_id IS NOT NULL AND managed_subscription_id <> ''`,
      [tenantId]
    );
    for (const r of rows) if (r.subscription_id) ids.add(String(r.subscription_id).toLowerCase());
  } catch { /* la tabla puede no existir en un entorno viejo */ }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT subscription_id
         FROM CostSnapshots
        WHERE tenant_id = ? AND subscription_id IS NOT NULL
          AND subscription_id NOT IN ('', 'default', 'mg-aggregated')`,
      [tenantId]
    );
    for (const r of rows) if (r.subscription_id) ids.add(String(r.subscription_id).toLowerCase());
  } catch { /* idem */ }

  // MEJ-25: lo desvinculado NO consume cupo del plan.
  //
  // Una suscripción que el tenant dio de baja sigue teniendo delegaciones y
  // CostSnapshots históricos --el gasto de meses cerrados es información
  // contable y no se borra-- así que sin este filtro se seguía contando.
  // Resultado: el cliente daba de baja una suscripción, dejaba de verla, y el
  // medidor le seguía diciendo que la estaba usando. Perdía el cupo sin recibir
  // nada a cambio.
  //
  // Tiene que coincidir con el filtro de `getSubscriptionsForTenant` en
  // azure.ts: este módulo existe justamente para que el que trunca y el que
  // informa cuenten IGUAL.
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT subscription_id FROM TenantExcludedSubscriptions WHERE tenant_id = ?`,
      [tenantId]
    );
    for (const r of rows) ids.delete(String(r.subscription_id || "").toLowerCase());
  } catch { /* sin la tabla no se excluye nada, igual que en azure.ts */ }

  return ids.size;
}

/**
 * El tope efectivo: el del plan, elevado por los slots que el tenant haya
 * comprado (`TenantSubscriptions.max_allowed_subscriptions`).
 *
 * Esa columna ya existía y NADIE la leía: el tope salía siempre del mapa fijo
 * por tier, así que comprar suscripciones adicionales no podía levantar el
 * límite ni aunque se cobrara. Este es el enganche que hace vendible el add-on.
 *
 * Se toma el MÁXIMO entre plan y override: un override viejo o mal cargado no
 * debe dejar al cliente por debajo de lo que ya paga en su plan.
 */
export async function getEffectiveSubscriptionLimit(tenantId: string, tier: string): Promise<number> {
  const planLimit = getSubscriptionLimit(tier);
  if (!Number.isFinite(planLimit)) return planLimit; // Enterprise: ilimitado

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT max_allowed_subscriptions, purchased_subscription_slots
         FROM TenantSubscriptions WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    );

    // Base: el tope del plan, o el override manual si es mayor (casos
    // comerciales puntuales cargados a mano desde SuperAdmin).
    const override = Number(rows[0]?.max_allowed_subscriptions);
    const base = Number.isFinite(override) && override > planLimit ? override : planLimit;

    // Los slots COMPRADOS se suman a la base, no la reemplazan: así un cambio
    // de tier no se lleva puesto lo que el cliente ya pagó (ver la migración
    // 20260901-006).
    const purchased = Number(rows[0]?.purchased_subscription_slots) || 0;
    return base + Math.max(0, purchased);
  } catch { /* sin registro de facturación: rige el plan */ }

  return planLimit;
}
