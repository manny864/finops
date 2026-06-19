export const TIERS: Record<string, number> = {
    Essential: 1,
    Professional: 2,
    Business: 3,
    Enterprise: 4
};

export function hasAccess(currentTier: string, requiredTier: string): boolean {
    // Normalize current tier mapping 'pro' to 'Professional'
    let normalizedCurrent = currentTier;
    if (normalizedCurrent.toLowerCase() === 'pro') normalizedCurrent = 'Professional';
    if (normalizedCurrent.toLowerCase() === 'essential') normalizedCurrent = 'Essential';
    if (normalizedCurrent.toLowerCase() === 'business') normalizedCurrent = 'Business';
    if (normalizedCurrent.toLowerCase() === 'enterprise') normalizedCurrent = 'Enterprise';

    // Normalize required tier just in case
    let normalizedRequired = requiredTier;
    if (normalizedRequired.toLowerCase() === 'pro') normalizedRequired = 'Professional';
    if (normalizedRequired.toLowerCase() === 'essential') normalizedRequired = 'Essential';
    if (normalizedRequired.toLowerCase() === 'business') normalizedRequired = 'Business';
    if (normalizedRequired.toLowerCase() === 'enterprise') normalizedRequired = 'Enterprise';

    const current = TIERS[normalizedCurrent] || 0;
    const required = TIERS[normalizedRequired] || 0;
    return current >= required;
}
