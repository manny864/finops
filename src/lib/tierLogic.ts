export const TIERS: Record<string, number> = {
    Essential: 1,
    Professional: 2,
    Business: 3,
    Enterprise: 4
};

function normalizeTier(tier: string): string | null {
    const t = (tier || '').trim().toLowerCase();
    if (t === 'pro' || t === 'professional') return 'Professional';
    if (t === 'essential' || t === 'starter') return 'Essential';
    if (t === 'business') return 'Business';
    if (t === 'enterprise') return 'Enterprise';
    return null;
}

export function hasAccess(currentTier: string, requiredTier: string): boolean {
    const normalizedCurrent = normalizeTier(currentTier);
    const normalizedRequired = normalizeTier(requiredTier);

    // Fail-closed: un requiredTier desconocido NO debe abrir la feature.
    if (!normalizedRequired) return false;

    const current = normalizedCurrent ? TIERS[normalizedCurrent] : 0;
    const required = TIERS[normalizedRequired];
    return current >= required;
}
