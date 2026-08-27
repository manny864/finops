/**
 * Contratos de la pestaña Estado de Cuenta (Cuentas Cloud — Azure).
 *
 * Todo lo que expone este contrato se deriva de datos reales: `Tenants`
 * (sync_status, last_sync_at), `CostSnapshots` (gasto e inventario por
 * suscripción) y `ExpiringCredentials`. El panel anterior mostraba
 * "Sincronización OK" y "Active & Connected" como literales, así que decía que
 * todo estaba bien incluso con la ingesta caída.
 */

export type IngestionHealthStatus = 'HEALTHY' | 'SYNCING' | 'DEGRADED' | 'DISCONNECTED';

export type SubscriptionOfferType =
    | 'EnterpriseAgreement'
    | 'Sponsorship'
    | 'PayAsYouGo'
    | 'CSP'
    | 'MicrosoftCustomerAgreement'
    | 'Unknown';

export interface TenantSubscriptionStatusItem {
    id: string;
    subscriptionId: string;
    subscriptionName: string;
    state: 'Enabled' | 'Warned' | 'PastDue' | 'Disabled';
    offerType: SubscriptionOfferType;
    monthlySpendUSD: number;
    resourceCount: number;
    isIngestionHealthy: boolean;
    lastCostDataTimestamp: string;
}

export interface TenantCloudAccountStatus {
    tenantId: string;
    azureTenantGuid: string;
    organizationDisplayName: string;
    activePlanTier: 'Enterprise' | 'Business' | 'Professional' | 'Community';
    ingestionStatus: IngestionHealthStatus;
    lastSuccessfulSyncAt: string | null;
    ingestedRecordsCount: number;
    totalActiveSubscriptionsCount: number;
    /** null = desconocido. No se inventa 100% cuando no hay medición. */
    apiQuotaRemainingPercentage: number | null;
    /** Cuál de los tres límites está más ajustado (el que va a throttlear primero). */
    apiQuotaTightestSource?: 'RESOURCE_GRAPH' | 'COST_MANAGEMENT' | 'ARM' | null;
    /** Detalle por fuente, para el popover del KPI. */
    apiQuotaBreakdown?: Array<{
        source: 'RESOURCE_GRAPH' | 'COST_MANAGEMENT' | 'ARM';
        remaining: number;
        ceiling: number | null;
        remainingPercentage: number | null;
        observedAt: string;
    }>;
    /** null = sin credencial registrada en ExpiringCredentials. */
    credentialDaysRemaining: number | null;
    lastErrorMessage: string | null;
    subscriptions: TenantSubscriptionStatusItem[];
    mock?: boolean;
}

export interface TriggerSyncResult {
    success: boolean;
    jobId: string;
    message: string;
    startedAt: string;
}

/** Umbral a partir del cual una ingesta se considera atrasada. */
export const INGESTION_STALE_HOURS = 26;

/**
 * Deriva el estado de ingesta de lo que hay en base, sin adornar.
 *
 * `DISCONNECTED` cuando nunca hubo sync o el último terminó en error;
 * `DEGRADED` cuando la última muestra es más vieja que el umbral — el cron
 * corre a diario, así que 26 h sin datos ya es un hueco real, no una demora.
 */
export function deriveIngestionStatus(params: {
    syncStatus: string | null;
    lastSyncAt: Date | string | null;
    hasError: boolean;
    now?: Date;
}): IngestionHealthStatus {
    const { syncStatus, lastSyncAt, hasError } = params;
    const now = params.now ?? new Date();

    const normalized = (syncStatus || '').toLowerCase();
    if (normalized === 'syncing' || normalized === 'running') return 'SYNCING';
    if (!lastSyncAt) return 'DISCONNECTED';
    if (normalized === 'error' || normalized === 'failed' || hasError) return 'DISCONNECTED';

    const last = lastSyncAt instanceof Date ? lastSyncAt : new Date(lastSyncAt);
    if (Number.isNaN(last.getTime())) return 'DISCONNECTED';

    const hours = (now.getTime() - last.getTime()) / 36e5;
    return hours > INGESTION_STALE_HOURS ? 'DEGRADED' : 'HEALTHY';
}

/**
 * El tier contratado no es el mismo dato que el offer type de la suscripción en
 * Azure, y el panel viejo los mezclaba. Esto normaliza sólo el tier de la
 * plataforma.
 */
export function normalizePlanTier(raw: string | null | undefined): 'Enterprise' | 'Business' | 'Professional' | 'Community' {
    const value = (raw || '').toLowerCase();
    if (value === 'enterprise') return 'Enterprise';
    if (value === 'business') return 'Business';
    if (value === 'professional' || value === 'pro' || value === 'essential' || value === 'starter') return 'Professional';
    return 'Community';
}

export function isSubscriptionState(value: unknown): value is TenantSubscriptionStatusItem['state'] {
    return typeof value === 'string' && ['Enabled', 'Warned', 'PastDue', 'Disabled'].includes(value);
}
