export const TIERS: Record<string, number> = {
    Essential: 1,
    Professional: 2,
    Business: 3,
    Enterprise: 4
};

export function normalizeTier(tier: string): string | null {
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

/**
 * Límites de uso por plan (ver pricing.*.limits en messages/*.json y
 * PricingPage.tsx). No confundir con `hasAccess`/`requiredTier`, que gatean
 * FEATURES (qué páginas ves); esto gatea CANTIDAD (cuántas suscripciones
 * Azure monitorea la plataforma y cuántos usuarios puede tener el tenant).
 */
export const SUBSCRIPTION_LIMITS: Record<string, number> = {
    Essential: 1,
    Professional: 5,
    Business: 20,
    Enterprise: Infinity,
};

export const USER_LIMITS: Record<string, number> = {
    Essential: 1,
    Professional: 5,
    Business: 20,
    Enterprise: Infinity,
};

export function getSubscriptionLimit(tier: string): number {
    const normalized = normalizeTier(tier);
    return normalized ? SUBSCRIPTION_LIMITS[normalized] : SUBSCRIPTION_LIMITS.Essential;
}

export function getUserLimit(tier: string): number {
    const normalized = normalizeTier(tier);
    return normalized ? USER_LIMITS[normalized] : USER_LIMITS.Essential;
}
