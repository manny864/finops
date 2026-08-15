export const TIERS: Record<string, number> = {
    Professional: 1,
    Business: 2,
    Enterprise: 3
};

export function normalizeTier(tier: string): string | null {
    const t = (tier || '').trim().toLowerCase();
    // 'essential'/'starter' son legacy: el tier Essential se descontinuó y los
    // tenants existentes se migraron a Professional (ver migrations/). Se
    // mapean acá como alias de seguridad por si queda algún valor viejo en
    // cache/localStorage/JWT sin refrescar.
    if (t === 'pro' || t === 'professional' || t === 'essential' || t === 'starter') return 'Professional';
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
 * Eliminación de recursos de Azure: el Service Principal solo tiene permisos
 * `delete` en Azure vía el Custom Role de remediación que el script de
 * onboarding asigna (ver getCustomRoleActionsForTier en
 * onboardingScriptTemplate.ts). El umbral difiere por dominio: Recursos
 * Zombis y Networking Zombies habilitan remediación desde Business; TTL y
 * Azure Advisor Action Center siguen siendo exclusivos de Enterprise. Otros
 * tiers pueden VER/detectar recursos pero no tienen el rol de Azure para
 * borrarlos — se oculta el botón en vez de dejar que falle en el backend.
 */
export type DeleteResourceDomain = 'zombies' | 'networking' | 'ttl' | 'advisor';

const DELETE_REMEDIATION_TIER: Record<DeleteResourceDomain, string> = {
    zombies: 'Business',
    networking: 'Business',
    ttl: 'Enterprise',
    advisor: 'Enterprise',
};

export function canDeleteResources(currentTier: string | null | undefined, domain: DeleteResourceDomain): boolean {
    return hasAccess(currentTier || '', DELETE_REMEDIATION_TIER[domain]);
}

/**
 * Tier mínimo requerido para borrar recursos del dominio dado. Usado por el
 * enforcement server-side de /api/remediation (ver requireTenantTier), que
 * necesita el string de tier (no un booleano) para reusar el mismo helper de
 * auth que ya valida membresía + SuperAdmin + fetch de tier del tenant.
 */
export function getDeleteRemediationTier(domain: DeleteResourceDomain): string {
    return DELETE_REMEDIATION_TIER[domain];
}

/**
 * Auto-fix de Cumplimiento de Etiquetas (/governance/tags): el rol Tag
 * Contributor solo se otorga desde tier Business (ver
 * onboardingScriptTemplate.ts). Professional ve el score de
 * cumplimiento pero no puede disparar la remediación automática.
 */
export function canRemediateTags(currentTier?: string | null): boolean {
    return hasAccess(currentTier || '', 'Business');
}

/**
 * Límites de uso por plan (ver pricing.*.limits en messages/*.json y
 * PricingPage.tsx). No confundir con `hasAccess`/`requiredTier`, que gatean
 * FEATURES (qué páginas ves); esto gatea CANTIDAD (cuántas suscripciones
 * Azure monitorea la plataforma y cuántos usuarios puede tener el tenant).
 */
export const SUBSCRIPTION_LIMITS: Record<string, number> = {
    Professional: 2,
    Business: 3,
    Enterprise: Infinity,
};

export const USER_LIMITS: Record<string, number> = {
    Professional: 3,
    Business: 5,
    Enterprise: Infinity,
};

export function getSubscriptionLimit(tier: string): number {
    const normalized = normalizeTier(tier);
    return normalized ? SUBSCRIPTION_LIMITS[normalized] : SUBSCRIPTION_LIMITS.Professional;
}

export function getUserLimit(tier: string): number {
    const normalized = normalizeTier(tier);
    return normalized ? USER_LIMITS[normalized] : USER_LIMITS.Professional;
}

// Límite de tickets de soporte/mes: ya vive en src/lib/supportConfig.ts
// (getSupportConfig), con enforcement en /api/support/tickets — no se
// duplica acá.
