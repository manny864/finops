// Mapa centralizado: ruta (sin locale prefix) -> tier requerido.
// Refleja el Sidebar (src/components/Sidebar.tsx). Manténganlos en sync.
//
// Se busca por prefijo más largo, así que rutas más específicas ganan
// sobre las genéricas (ej. /intelligence/aks-chargeback gana sobre /intelligence/aks).

export const ROUTE_TIERS: Record<string, 'Essential' | 'Professional' | 'Business' | 'Enterprise'> = {
    // Inteligencia
    // billing (Consumo Real) y budgets (Presupuestos) bajados a Essential —
    // ver pricing.essential.features / Sidebar.tsx.
    '/intelligence/billing': 'Essential',
    '/intelligence/budgets': 'Essential',
    '/intelligence/rightsizing': 'Professional',
    '/intelligence/network': 'Professional',
    '/intelligence/rates': 'Business',
    '/intelligence/licenses': 'Professional',
    '/intelligence/hybrid-benefit': 'Professional',
    '/intelligence/commitments': 'Professional',
    // AKS Chargeback bajado a Business ("Distribución de Costos (Chargeback)"
    // está en pricing.business.features, no en enterprise).
    '/intelligence/aks-chargeback': 'Business',
    '/intelligence/aks': 'Business',
    '/intelligence/unit-economics': 'Business',
    '/intelligence/allocation': 'Enterprise',
    '/intelligence/scorecard': 'Enterprise',
    '/intelligence/whiteboard': 'Enterprise',
    '/intelligence/anomalies': 'Professional',
    '/intelligence/optimization-index': 'Professional',
    '/intelligence/tenant-health': 'Professional',
    // Simulador What-If bajado a Business ("Escenarios What-If (Simulador de
    // Costos)" está en pricing.business.features, no en enterprise).
    '/intelligence/simulator': 'Business',
    '/intelligence/cost-projection': 'Professional',
    // New (P2/P3/P4 — finops-toolkit gap analysis)
    '/intelligence/storage-efficiency': 'Business',
    '/intelligence/compute-efficiency': 'Professional',
    '/intelligence/cost-by-category': 'Business',
    '/intelligence/commitment-simulator': 'Enterprise',
    '/intelligence/alerts': 'Professional',
    '/intelligence/ai-analytics': 'Enterprise',
    '/intelligence/macc': 'Enterprise',
    '/intelligence/upload': 'Professional',
    // Limpieza — TTL subido a Business, Networking Zombies nuevo (Professional).
    '/cleanup/ttl': 'Business',
    '/cleanup/zombies/networking': 'Professional',
    // Gobernanza — Tags bajado de Business a Professional.
    '/governance/tags': 'Professional',
    '/governance/power': 'Business',
    '/governance/policies': 'Enterprise',
    '/governance/reporting': 'Enterprise',
    '/governance/ha': 'Business',
    '/governance/credentials': 'Business',
    '/remediation/approvals': 'Professional',
    // Visibilidad
    '/overview/maturity': 'Essential',
    // Admin
    '/admin/markup': 'Enterprise',
    '/admin/workbooks': 'Enterprise',
    '/admin/copilot-m365': 'Enterprise',
    // pricing-units: oculto del Sidebar para tenants, exclusivo super-admin
    // (ver Sidebar.tsx) — el tier acá es irrelevante para clientes, pero se
    // deja Essential (piso) ya que el gate real es requireSuperAdmin server-side.
    '/admin/pricing-units': 'Essential',
    '/admin/api-keys': 'Professional',
    // focus-export subido a Enterprise (antes Professional).
    '/admin/focus-export': 'Enterprise',
    '/admin/cloud-accounts': 'Professional',
    // Oculta del Sidebar (ver Sidebar.tsx): sólo un datacenter real (Brasil) hoy,
    // no ofrecemos multi-región. La entrada de tier queda por si se accede directo
    // a la URL mientras la feature esté deshabilitada de la nav.
    '/admin/data-residency': 'Enterprise',
    '/admin/notifications': 'Professional',
    // mcp-keys subido a Business (antes Professional).
    '/admin/mcp-keys': 'Business',
    '/admin/powerbi-templates': 'Professional',
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
