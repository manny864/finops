/**
 * tenantAccountStatus.service — salud real de la conexión con Azure.
 *
 * No hay tablas nuevas: todo se deriva de lo que ya existe.
 *   - `Tenants.sync_status` / `last_sync_at` / `last_error_message` → estado de ingesta
 *   - `CostSnapshots` agrupado por `subscription_id` → inventario y gasto MTD
 *   - `ExpiringCredentials` → vigencia del Service Principal
 *
 * Crear `TenantAccountStatus` / `TenantSubscriptionsStatus` habría duplicado
 * hechos que ya viven en esas tablas, y el padrón paralelo mostraría un
 * inventario falso en cuanto los dos derivaran (mismo criterio que LLD §32.4).
 *
 * RBAC: no valida identidad; la ruta resuelve el guard antes de llamar.
 */
import pool from '@/modules/storage/db';
import { toMoneyNumber } from '@/lib/moneyDecimal';
import Decimal from 'decimal.js';
import { getQuotaSummary } from '@/lib/azureQuotaTracking';
import { getAllSubscriptionsForTenant, getExcludedSubscriptionIds } from '@/lib/azure';
import { errorMessage } from '@/lib/apiErrors';
import {
    deriveIngestionStatus,
    normalizePlanTier,
    type SubscriptionOfferType,
    type TenantCloudAccountStatus,
    type TenantSubscriptionStatusItem,
} from '@/types/tenantAccountStatus.types';

/**
 * Universo + gasto por suscripción.
 *
 * MEJ-25 (desvincular): antes esta lista salía SÓLO de `CostSnapshots` del mes
 * en curso, así que una suscripción sin gasto ingerido este mes (recién
 * delegada, de patrocinio con crédito agotado, o simplemente sin actividad)
 * nunca tenía fila y por lo tanto nunca tenía botón de Desvincular — aunque
 * `getAllSubscriptionsForTenant` (Management API + delegaciones) ya la viera
 * y le siguiera gastando cuota de las APIs de Azure. Ahora el universo sale de
 * ahí, y `CostSnapshots` sólo aporta el gasto/salud cuando existe.
 *
 * `resourceCount` es el número de combinaciones resource_group + service con
 * costo — no el conteo de recursos de Resource Graph. Se nombra así en la UI
 * ("series de costo") para no afirmar algo que este dato no dice.
 */
export async function getSubscriptionRollup(tenantId: string): Promise<TenantSubscriptionStatusItem[]> {
    const [rows] = await pool.query<any[]>(
        `SELECT
             cs.subscription_id                                   AS subscriptionId,
             SUM(COALESCE(cs.EffectiveCost, cs.cost_usd, 0))      AS monthlySpend,
             COUNT(DISTINCT CONCAT(COALESCE(cs.resource_group,''), '|', COALESCE(cs.service_name,''))) AS seriesCount,
             MAX(COALESCE(cs.ChargePeriodStart, cs.date))         AS lastSample
         FROM CostSnapshots cs
         WHERE cs.tenant_id = ?
           AND COALESCE(cs.ChargePeriodStart, cs.date) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
         GROUP BY cs.subscription_id
         ORDER BY monthlySpend DESC
         LIMIT 500`,
        [tenantId]
    );

    const costById = new Map<string, { subscriptionId: string; monthlySpend: number; seriesCount: number; lastSample: Date | null }>();
    for (const r of rows || []) {
        const id = String(r.subscriptionId || '').trim();
        if (!id) continue;
        costById.set(id.toLowerCase(), {
            subscriptionId: id,
            monthlySpend: Number(r.monthlySpend || 0),
            seriesCount: Number(r.seriesCount || 0),
            lastSample: r.lastSample ? new Date(r.lastSample) : null,
        });
    }

    // Universo completo (ya excluye las desvinculadas): si el descubrimiento
    // falla (permisos, Azure caído), se degrada a lo que haya en CostSnapshots
    // en vez de dejar la tabla vacía.
    let discoveredIds: string[] = [];
    try {
        discoveredIds = await getAllSubscriptionsForTenant(tenantId);
    } catch (e) {
        console.warn(`[tenantAccountStatus] getAllSubscriptionsForTenant falló para ${tenantId}:`, errorMessage(e));
    }

    const excluded = await getExcludedSubscriptionIds(tenantId);
    const allIds = new Map<string, string>(); // lowercase -> casing a mostrar
    for (const id of discoveredIds) allIds.set(id.toLowerCase(), id);
    // Una suscripción con gasto pero que el descubrimiento no trajo (permisos
    // ARM caídos justo ahora, por ejemplo) no debe desaparecer de la tabla.
    for (const id of costById.keys()) if (!allIds.has(id)) allIds.set(id, costById.get(id)!.subscriptionId);

    const now = Date.now();
    const items: TenantSubscriptionStatusItem[] = [];
    for (const [lower, displayId] of allIds) {
        if (excluded.has(lower)) continue;
        const cost = costById.get(lower);
        const lastSample = cost?.lastSample ?? null;
        // Una suscripción cuya última muestra tiene más de 48 h dentro del mes
        // en curso quedó fuera de la ingesta aunque el tenant en general esté OK.
        // Sin ninguna muestra este mes (recién vinculada, sin gasto todavía) se
        // marca igual como no saludable: no hay ingesta que confirmar.
        const healthy = Boolean(lastSample) && (now - (lastSample as Date).getTime()) / 36e5 <= 48;

        items.push({
            id: displayId,
            subscriptionId: displayId,
            // El nombre se resuelve en la ruta (necesita credencial de Azure).
            subscriptionName: displayId,
            state: 'Enabled' as const,
            // El offer type sólo lo sabe la API de Billing; no se inventa.
            offerType: 'Unknown' as SubscriptionOfferType,
            monthlySpendUSD: toMoneyNumber(new Decimal(cost?.monthlySpend || 0)),
            resourceCount: cost?.seriesCount || 0,
            isIngestionHealthy: healthy,
            lastCostDataTimestamp: lastSample ? lastSample.toISOString() : '',
        });
    }

    items.sort((a, b) => b.monthlySpendUSD - a.monthlySpendUSD);
    return items.slice(0, 500);
}

/** Días hasta el vencimiento de la credencial más próxima a expirar. */
async function getCredentialDaysRemaining(tenantId: string): Promise<number | null> {
    try {
        const [rows] = await pool.query<any[]>(
            `SELECT MIN(days_till_expiry) AS days
             FROM ExpiringCredentials
             WHERE tenant_id = ? AND expires_at > NOW()`,
            [tenantId]
        );
        const days = rows?.[0]?.days;
        return days == null ? null : Number(days);
    } catch (err: any) {
        if (err?.code === 'ER_NO_SUCH_TABLE') return null;
        throw err;
    }
}

export async function getAccountStatus(tenantId: string): Promise<TenantCloudAccountStatus | null> {
    let tenant: any = null;
    try {
        const [tenantRows] = await pool.query<any[]>(
            `SELECT t.tenant_id, t.company_name, COALESCE(t.tier, p.tier) AS tier, t.sync_status, t.last_sync_at, t.last_error_message
             FROM Tenants t
             LEFT JOIN Tenants p ON t.parent_tenant_id = p.tenant_id
             WHERE t.tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        tenant = tenantRows?.[0];
    } catch {
        const [tenantRows] = await pool.query<any[]>(
            `SELECT tenant_id, company_name, tier, sync_status, last_sync_at, last_error_message
             FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        tenant = tenantRows?.[0];
    }
    if (!tenant) return null;

    const [countRows] = await pool.query<any[]>(
        'SELECT COUNT(*) AS total FROM CostSnapshots WHERE tenant_id = ?',
        [tenantId]
    );

    const subscriptions = await getSubscriptionRollup(tenantId);
    const credentialDaysRemaining = await getCredentialDaysRemaining(tenantId);
    const quota = await getQuotaSummary(tenantId);

    return {
        tenantId,
        azureTenantGuid: tenant.tenant_id,
        organizationDisplayName: tenant.company_name || tenant.tenant_id,
        activePlanTier: normalizePlanTier(tenant.tier),
        ingestionStatus: deriveIngestionStatus({
            syncStatus: tenant.sync_status,
            lastSyncAt: tenant.last_sync_at,
            hasError: Boolean(tenant.last_error_message),
        }),
        lastSuccessfulSyncAt: tenant.last_sync_at ? new Date(tenant.last_sync_at).toISOString() : null,
        ingestedRecordsCount: Number(countRows?.[0]?.total || 0),
        totalActiveSubscriptionsCount: subscriptions.length,
        // Medición real: el más ajustado de los límites observados. Sigue siendo
        // null mientras no haya muestras — nunca un número inventado.
        apiQuotaRemainingPercentage: quota.remainingPercentage,
        apiQuotaTightestSource: quota.tightestSource,
        apiQuotaBreakdown: quota.breakdown,
        credentialDaysRemaining,
        lastErrorMessage: tenant.last_error_message || null,
        subscriptions,
    };
}
