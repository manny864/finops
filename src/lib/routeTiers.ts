// Mapa centralizado: ruta (sin locale prefix) -> tier requerido.
// Refleja el Sidebar (src/components/Sidebar.tsx). Manténganlos en sync.
//
// Se busca por prefijo más largo, así que rutas más específicas ganan
// sobre las genéricas (ej. /intelligence/aks-chargeback gana sobre /intelligence/aks).

export const ROUTE_TIERS: Record<string, 'Professional' | 'Business' | 'Enterprise'> = {
    // Inteligencia
    '/intelligence/billing': 'Professional',
    '/intelligence/budgets': 'Professional',
    '/intelligence/rightsizing': 'Enterprise',
    '/intelligence/network': 'Business',
    '/intelligence/redes': 'Business',
    '/intelligence/redes/ddos-protection': 'Business',
    '/intelligence/optimization': 'Enterprise',
    '/intelligence/rates': 'Enterprise',
    '/intelligence/licenses': 'Enterprise',
    '/intelligence/hybrid-benefit': 'Business',
    '/intelligence/commitments': 'Enterprise',
    '/intelligence/aks-chargeback': 'Enterprise',
    '/intelligence/aks': 'Enterprise',
    '/intelligence/computo/kubernetes': 'Enterprise',
    '/intelligence/container-apps': 'Business',
    '/intelligence/cosmos-db': 'Business',
    '/cleanup/backup-orphans': 'Professional',
    '/intelligence/defender': 'Business',
    '/intelligence/seguridad': 'Business',
    '/intelligence/integration-services': 'Business',
    '/intelligence/app-insights': 'Business',
    '/intelligence/monitoreo': 'Business',
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
    '/intelligence/almacenamiento': 'Enterprise',
    '/intelligence/compute-efficiency': 'Enterprise',
    '/intelligence/cost-by-category': 'Business',
    '/intelligence/commitment-simulator': 'Professional',
    '/intelligence/alerts': 'Business',
    '/intelligence/ai-analytics': 'Enterprise',
    '/intelligence/macc': 'Enterprise',
    '/intelligence/upload': 'Business',
    '/intelligence/analitica-avanzada': 'Business',
    // Limpieza — TTL Business (vista y remediación quedan separadas dentro de
    // la página, ver canDeleteResources en tierLogic.ts). Networking Zombies
    // gratis desde Professional (vista; remediación desde Business).
    '/cleanup/ttl': 'Business',
    '/cleanup/zombies/networking': 'Professional',
    // Gobernanza — Tags gratis desde Professional (vista; remediación desde
    // Business, ver canRemediateTags en tierLogic.ts).
    '/governance/tags': 'Professional',
    '/governance/power': 'Business',
    '/governance/policies': 'Enterprise',
    // Reporting de Gobernanza absorbe el KPI que antes vivía en
    // /governance/score (fusionadas en una sola página).
    '/governance/reporting': 'Enterprise',
    '/governance/ha': 'Business',
    '/governance/credentials': 'Business',
    '/remediation/approvals': 'Business',
    // Visibilidad
    '/overview/maturity': 'Professional',
    '/overview/resources': 'Business',
    '/overview/progress': 'Professional',
    '/overview/top-expenses': 'Professional',
    '/overview/top-spend': 'Professional',
    '/overview/sustainability': 'Professional',
    '/overview/captured-savings': 'Professional',
    '/overview/financial-leaks': 'Professional',
    // Admin
    '/admin/markup': 'Enterprise',
    '/admin/workbooks': 'Enterprise',
    '/admin/copilot-m365': 'Enterprise',
    // pricing-units: oculto del Sidebar para tenants, exclusivo super-admin
    // (ver Sidebar.tsx) — el tier acá es irrelevante para clientes, pero se
    // deja Professional (piso) ya que el gate real es requireSuperAdmin server-side.
    '/admin/pricing-units': 'Professional',
    '/admin/api-keys': 'Enterprise',
    '/admin/focus-export': 'Professional',
    '/admin/cloud-accounts': 'Enterprise',
    // Oculta del Sidebar (ver Sidebar.tsx): sólo un datacenter real (Brasil) hoy,
    // no ofrecemos multi-región. La entrada de tier queda por si se accede directo
    // a la URL mientras la feature esté deshabilitada de la nav.
    '/admin/data-residency': 'Enterprise',
    '/admin/notifications': 'Professional',
    '/admin/billing': 'Professional',
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

import { stripLocale } from "./stripLocale";
export { stripLocale };

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
