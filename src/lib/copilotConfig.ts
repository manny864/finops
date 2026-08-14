/**
 * Cuota mensual de consultas al FinOps Copilot (IA) por tier.
 *
 * El Copilot ya está gateado a nivel feature desde el tier Professional (ver
 * requireTenantTier(request, tenantId, 'Professional') en
 * src/app/api/intelligence/copilot/route.ts) — Professional es el tier más
 * bajo de la plataforma, así que siempre tiene acceso a esta cuota.
 *
 * `monthlyQueryQuota: null` = ilimitado.
 */
export interface CopilotTierConfig {
    monthlyQueryQuota: number | null;
}

const COPILOT_TIERS: Record<string, CopilotTierConfig> = {
    Professional: { monthlyQueryQuota: 50 },
    Business: { monthlyQueryQuota: 150 },
    Enterprise: { monthlyQueryQuota: null },
};

export function getCopilotConfig(tier: string): CopilotTierConfig {
    const t = (tier || '').trim().toLowerCase();
    if (t === 'enterprise') return COPILOT_TIERS.Enterprise;
    if (t === 'business') return COPILOT_TIERS.Business;
    // Fail-closed a la cuota más restrictiva (piso de la plataforma) para
    // tiers desconocidos.
    return COPILOT_TIERS.Professional;
}
