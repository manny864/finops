/**
 * Cuota mensual de consultas al FinOps Copilot (IA) por tier.
 *
 * El Copilot ya está gateado a nivel feature desde el tier Professional (ver
 * requireTenantTier(request, tenantId, 'Professional') en
 * src/app/api/intelligence/copilot/route.ts) — Essential nunca llega a esta
 * cuota porque no tiene acceso al endpoint. Se incluye igual para fail-closed
 * si ese gate cambiara alguna vez.
 *
 * `monthlyQueryQuota: null` = ilimitado.
 */
export interface CopilotTierConfig {
    monthlyQueryQuota: number | null;
}

const COPILOT_TIERS: Record<string, CopilotTierConfig> = {
    Essential: { monthlyQueryQuota: 0 },
    Professional: { monthlyQueryQuota: 100 },
    Business: { monthlyQueryQuota: 300 },
    Enterprise: { monthlyQueryQuota: null },
};

export function getCopilotConfig(tier: string): CopilotTierConfig {
    const t = (tier || '').trim().toLowerCase();
    if (t === 'enterprise') return COPILOT_TIERS.Enterprise;
    if (t === 'business') return COPILOT_TIERS.Business;
    if (t === 'pro' || t === 'professional') return COPILOT_TIERS.Professional;
    // Fail-closed a la cuota más restrictiva para tiers desconocidos.
    return COPILOT_TIERS.Essential;
}
