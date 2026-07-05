// Mapa centralizado: ruta (sin locale prefix) -> tier requerido.
// Refleja el Sidebar (src/components/Sidebar.tsx). Manténganlos en sync.
//
// Se busca por prefijo más largo, así que rutas más específicas ganan
// sobre las genéricas (ej. /intelligence/aks-chargeback gana sobre /intelligence/aks).

export const ROUTE_TIERS: Record<string, 'Essential' | 'Professional' | 'Business' | 'Enterprise'> = {
    // Inteligencia
    '/intelligence/billing': 'Professional',
    '/intelligence/budgets': 'Professional',
    '/intelligence/rightsizing': 'Professional',
    '/intelligence/network': 'Professional',
    '/intelligence/rates': 'Business',
    '/intelligence/licenses': 'Professional',
    '/intelligence/hybrid-benefit': 'Professional',
    '/intelligence/commitments': 'Professional',
    '/intelligence/aks-chargeback': 'Enterprise',
    '/intelligence/aks': 'Business',
    '/intelligence/unit-economics': 'Business',
    '/intelligence/allocation': 'Enterprise',
    '/intelligence/scorecard': 'Enterprise',
    '/intelligence/anomalies': 'Professional',
    '/intelligence/simulator': 'Enterprise',
    // New (P2/P3/P4 — finops-toolkit gap analysis)
    '/intelligence/storage-efficiency': 'Business',
    '/intelligence/compute-efficiency': 'Professional',
    '/intelligence/cost-by-category': 'Business',
    '/intelligence/commitment-simulator': 'Enterprise',
    '/intelligence/alerts': 'Professional',
    '/intelligence/ai-analytics': 'Enterprise',
    '/intelligence/macc': 'Enterprise',
    // Limpieza
    '/cleanup/ttl': 'Professional',
    // Gobernanza
    '/governance/tags': 'Business',
    '/governance/power': 'Business',
    '/governance/policies': 'Enterprise',
    '/governance/reporting': 'Enterprise',
    '/governance/ha': 'Business',
    '/governance/credentials': 'Business',
    '/remediation/approvals': 'Professional',
    // Admin
    '/admin/markup': 'Enterprise',
    '/admin/workbooks': 'Enterprise',
    '/admin/copilot-m365': 'Enterprise',
    '/admin/pricing-units': 'Essential',
    '/admin/api-keys': 'Professional',
    '/admin/focus-export': 'Professional',
    '/admin/cloud-accounts': 'Professional',
    // Oculta del Sidebar (ver Sidebar.tsx): sólo un datacenter real (Brasil) hoy,
    // no ofrecemos multi-región. La entrada de tier queda por si se accede directo
    // a la URL mientras la feature esté deshabilitada de la nav.
    '/admin/data-residency': 'Enterprise',
    '/admin/notifications': 'Professional',
    '/admin/mcp-keys': 'Professional',
    '/admin/powerbi-templates': 'Professional',
    '/admin/sso': 'Enterprise',
};

/**
 * Quita el prefijo de locale (es, en, pt-BR, etc.) de un pathname.
 * `/es/intelligence/billing` -> `/intelligence/billing`
 */
export function stripLocale(pathname: string): string {
    return pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/|$)/, '') || '/';
}

/**
 * Devuelve el tier requerido para una ruta o null si es libre.
 * Match por prefijo más largo.
 */
export function getRequiredTierForPath(pathname: string): string | null {
    const clean = stripLocale(pathname);
    let best: { route: string; tier: string } | null = null;
    for (const [route, tier] of Object.entries(ROUTE_TIERS)) {
        if (clean === route || clean.startsWith(route + '/')) {
            if (!best || route.length > best.route.length) best = { route, tier };
        }
    }
    return best ? best.tier : null;
}
