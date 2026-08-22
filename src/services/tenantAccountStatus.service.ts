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
import {
    deriveIngestionStatus,
    normalizePlanTier,
    type SubscriptionOfferType,
    type TenantCloudAccountStatus,
    type TenantSubscriptionStatusItem,
} from '@/types/tenantAccountStatus.types';

/**
 * Gasto e inventario del mes en curso por suscripción, desde CostSnapshots.
 * `resourceCount` es el número de combinaciones resource_group + service con
 * costo — no el conteo de recursos de Resource Graph. Se nombra así en la UI
 * ("series de costo") para no afirmar algo que este dato no dice.
 */
async function getSubscriptionRollup(tenantId: string): Promise<TenantSubscriptionStatusItem[]> {
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

    const now = Date.now();

    return (rows || []).map((r) => {
        const lastSample = r.lastSample ? new Date(r.lastSample) : null;
        // Una suscripción cuya última muestra tiene más de 48 h dentro del mes
        // en curso quedó fuera de la ingesta aunque el tenant en general esté OK.
        const healthy = Boolean(lastSample) && (now - (lastSample as Date).getTime()) / 36e5 <= 48;

        return {
            id: String(r.subscriptionId || 'unknown'),
            subscriptionId: String(r.subscriptionId || 'unknown'),
            // El nombre se resuelve en la ruta (necesita credencial de Azure).
            subscriptionName: String(r.subscriptionId || 'unknown'),
            state: 'Enabled' as const,
            // El offer type sólo lo sabe la API de Billing; no se inventa.
            offerType: 'Unknown' as SubscriptionOfferType,
            monthlySpendUSD: toMoneyNumber(new Decimal(r.monthlySpend || 0)),
            resourceCount: Number(r.seriesCount || 0),
            isIngestionHealthy: healthy,
            lastCostDataTimestamp: lastSample ? lastSample.toISOString() : '',
        };
    });
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
    const [tenantRows] = await pool.query<any[]>(
        `SELECT tenant_id, company_name, tier, sync_status, last_sync_at, last_error_message
         FROM Tenants WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
    );
    const tenant = tenantRows?.[0];
    if (!tenant) return null;

    const [countRows] = await pool.query<any[]>(
        'SELECT COUNT(*) AS total FROM CostSnapshots WHERE tenant_id = ?',
        [tenantId]
    );

    const subscriptions = await getSubscriptionRollup(tenantId);
    const credentialDaysRemaining = await getCredentialDaysRemaining(tenantId);

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
        // No se mide la cuota de ARM en ningún lado todavía. Devolver 94% fijo
        // —como hacía la maqueta— sería inventar un dato de salud.
        apiQuotaRemainingPercentage: null,
        credentialDaysRemaining,
        lastErrorMessage: tenant.last_error_message || null,
        subscriptions,
    };
}
