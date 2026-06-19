export const TIERS: Record<string, number> = {
    Essential: 1,
    Professional: 2,
    Business: 3,
    Enterprise: 4
};

export function hasAccess(currentTier: string, requiredTier: string): boolean {
    const current = TIERS[currentTier] || 0;
    const required = TIERS[requiredTier] || 0;
    return current >= required;
}
