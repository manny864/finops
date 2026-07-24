// Mapa centralizado: ruta (sin locale prefix) -> tier requerido.
// Refleja el Sidebar (src/components/Sidebar.tsx). Manténganlos en sync.
//
// Se busca por prefijo más largo, así que rutas más específicas ganan
// sobre las genéricas (ej. /intelligence/aks-chargeback gana sobre /intelligence/aks).

export const ROUTE_TIERS: Record<string, 'Essential' | 'Professional' | 'Business' | 'Enterprise'> = {
    // Inteligencia
    '/intelligence/billing': 'Essential',
    '/intelligence/budgets': 'Essential',
    '/intelligence/rightsizing': 'Enterprise',
    '/intelligence/network': 'Business',
    '/intelligence/rates': 'Enterprise',
    '/intelligence/licenses': 'Enterprise',
    '/intelligence/hybrid-benefit': 'Business',
    '/intelligence/commitments': 'Enterprise',
    '/intelligence/aks-chargeback': 'Enterprise',
    '/intelligence/aks': 'Enterprise',
    '/intelligence/container-apps': 'Business',
    '/intelligence/cosmos-db': 'Business',
    '/intelligence/log-analytics': 'Business',
    '/intelligence/unit-economics': 'Enterprise',
    // Cost Groups (Budget & Forecast por Business Unit) — Business y Enterprise.
    '/intelligence/cost-groups': 'Business',
    '/intelligence/allocation': 'Enterprise',
    '/intelligence/scorecard': 'Business',
    '/intelligence/cost-centers': 'Enterprise',
    '/intelligence/anomalies': 'Enterprise',
    '/intelligence/optimization-index': 'Enterprise',
    '/intelligence/tenant-health': 'Business',
    // Simulador What-If — Business.
    '/intelligence/simulator': 'Business',
    '/intelligence/cost-projection': 'Enterprise',
    '/intelligence/storage-efficiency': 'Enterprise',
    '/intelligence/compute-efficiency': 'Enterprise',
    '/intelligence/cost-by-category': 'Business',
    '/intelligence/commitment-simulator': 'Professional',
    '/intelligence/alerts': 'Business',
    '/intelligence/ai-analytics': 'Enterprise',
    '/intelligence/macc': 'Enterprise',
    '/intelligence/upload': 'Business',
    // Limpieza — TTL Business (vista y remediación quedan separadas dentro de
    // la página, ver canDeleteResources en tierLogic.ts). Networking Zombies
    // gratis desde Essential (vista; remediación desde Business).
    '/cleanup/ttl': 'Business',
    '/cleanup/zombies/networking': 'Essential',
    // Gobernanza — Tags gratis desde Essential (vista; remediación desde
    // Business, ver canRemediateTags en tierLogic.ts).
    '/governance/tags': 'Essential',
    '/governance/power': 'Business',
    '/governance/policies': 'Enterprise',
    // Reporting de Gobernanza absorbe el KPI que antes vivía en
    // /governance/score (fusionadas en una sola página).
    '/governance/reporting': 'Enterprise',
    '/governance/ha': 'Business',
    '/governance/credentials': 'Business',
    '/remediation/approvals': 'Business',
    // Visibilidad
    '/overview/maturity': 'Essential',
    '/overview/resources': 'Business',
    '/overview/progress': 'Professional',
    '/overview/top-expenses': 'Professional',
    '/overview/sustainability': 'Professional',
    '/overview/captured-savings': 'Professional',
    '/overview/financial-leaks': 'Professional',
    // Admin
    '/admin/markup': 'Enterprise',
    '/admin/workbooks': 'Enterprise',
    '/admin/copilot-m365': 'Enterprise',
    // pricing-units: oculto del Sidebar para tenants, exclusivo super-admin
    // (ver Sidebar.tsx) — el tier acá es irrelevante para clientes, pero se
    // deja Essential (piso) ya que el gate real es requireSuperAdmin server-side.
    '/admin/pricing-units': 'Essential',
    '/admin/api-keys': 'Enterprise',
    '/admin/focus-export': 'Professional',
    '/admin/cloud-accounts': 'Professional',
    // Oculta del Sidebar (ver Sidebar.tsx): sólo un datacenter real (Brasil) hoy,
    // no ofrecemos multi-región. La entrada de tier queda por si se accede directo
    // a la URL mientras la feature esté deshabilitada de la nav.
    '/admin/data-residency': 'Enterprise',
    '/admin/notifications': 'Professional',
    '/admin/billing': 'Essential',
    '/admin/ai-config': 'Professional',
    '/admin/audit': 'Professional',
    '/admin/report': 'Business',
    '/admin/report/invoicing': 'Business',
    '/admin/mcp-keys': 'Enterprise',
    '/admin/powerbi-templates': 'Enterprise',
    '/admin/sso': 'Enterprise',
    // Lighthouse: página existía pero no estaba en el Sidebar ni acá — quedaba
    // sin gate real, accesible por URL directa a cualquier tier. La agregamos
    // con el tier que promete su propio marketing ("Azure Lighthouse
    // Onboarding" en pricing.enterprise.features).
    '/admin/onboarding/lighthouse': 'Enterprise',
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
