// Mapa centralizado: ruta (sin locale prefix) -> tier requerido.
// Refleja el Sidebar (src/components/Sidebar.tsx). Manténganlos en sync.
//
// Se busca por prefijo más largo, así que rutas más específicas ganan
// sobre las genéricas (ej. /intelligence/aks-chargeback gana sobre /intelligence/aks).

export const ROUTE_TIERS: Record<string, 'Professional' | 'Business' | 'Enterprise'> = {
    // Las seis áreas Enterprise-only: Optimización y Ahorro, Azure Integration
    // Services, Analítica Avanzada, Monitoreo, Seguridad y Azure IA.
    //
    // Cada una es un hub cuyas pestañas cuelgan de su propia ruta, así que el
    // match por prefijo las cubre. Lo que NO cubre es que varias de esas
    // pestañas son alias (`export { default } from ...`) de páginas viejas que
    // viven en otra ruta de primer nivel: `/intelligence/scorecard`,
    // `/intelligence/simulator`, `/intelligence/alerts`, etc. Esas URLs sirven
    // exactamente el mismo componente, así que si no suben también el bloqueo
    // es decorativo — se entra por la ruta vieja. Por eso están todas acá en
    // Enterprise, aunque no aparezcan en el Sidebar.
    '/intelligence/optimizacion-y-ahorro': 'Enterprise',
    '/intelligence/azure-ai': 'Enterprise',
    // Página consolidada vieja de Azure IA (las mismas pestañas: Search,
    // Document Intelligence, Speech, Vision, Content Safety, AML).
    '/intelligence/azure-ai-services': 'Enterprise',
    // Alias inverso: /intelligence/azure-monitor reexporta la pestaña del hub.
    '/intelligence/azure-monitor': 'Enterprise',
    // Pestaña "Costo Cero" de Optimización y Ahorro.
    '/intelligence/zero-cost': 'Enterprise',

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
    '/intelligence/hybrid-benefit': 'Enterprise',
    '/intelligence/commitments': 'Enterprise',
    '/intelligence/aks-chargeback': 'Enterprise',
    '/intelligence/aks': 'Enterprise',
    '/intelligence/computo/kubernetes': 'Enterprise',
    '/intelligence/container-apps': 'Business',
    '/intelligence/cosmos-db': 'Business',
    '/cleanup/backup-orphans': 'Professional',
    '/intelligence/defender': 'Enterprise',
    '/intelligence/seguridad': 'Enterprise',
    '/intelligence/integration-services': 'Enterprise',
    '/intelligence/app-insights': 'Enterprise',
    '/intelligence/monitoreo': 'Enterprise',
    '/intelligence/log-analytics': 'Enterprise',
    '/intelligence/unit-economics': 'Enterprise',
    // Cost Groups (Budget & Forecast por Business Unit) — Business y Enterprise.
    '/intelligence/cost-groups': 'Business',
    '/intelligence/allocation': 'Enterprise',
    '/intelligence/scorecard': 'Enterprise',
    '/intelligence/cost-centers': 'Enterprise',
    '/intelligence/anomalies': 'Enterprise',
    '/intelligence/optimization-index': 'Enterprise',
    '/intelligence/tenant-health': 'Enterprise',
    // Simulador What-If — pestaña de Analítica Avanzada.
    '/intelligence/simulator': 'Enterprise',
    '/intelligence/cost-projection': 'Enterprise',
    '/intelligence/storage-efficiency': 'Enterprise',
    '/intelligence/almacenamiento': 'Enterprise',
    '/intelligence/compute-efficiency': 'Enterprise',
    '/intelligence/cost-by-category': 'Business',
    '/intelligence/commitment-simulator': 'Enterprise',
    '/intelligence/alerts': 'Professional',
    '/intelligence/ai-analytics': 'Enterprise',
    '/intelligence/macc': 'Enterprise',
    '/intelligence/upload': 'Business',
    '/intelligence/analitica-avanzada': 'Enterprise',
    // Limpieza — TTL Business (vista y remediación quedan separadas dentro de
    // la página, ver canDeleteResources en tierLogic.ts). Networking Zombies
    // gratis desde Professional (vista; remediación desde Business).
    '/cleanup/ttl': 'Business',
    '/cleanup/zombies/networking': 'Professional',
    // Gobernanza — Tags gratis desde Professional (vista; remediación desde
    // Business, ver canRemediateTags en tierLogic.ts).
    '/governance/tags': 'Professional',
    '/governance/alerts': 'Professional',
    '/governance/power': 'Business',
    '/governance/policies': 'Enterprise',
    // Reporting de Gobernanza absorbe el KPI que antes vivía en
    // /governance/score (fusionadas en una sola página).
    '/governance/reporting': 'Enterprise',
    '/governance/ha': 'Business',
    '/governance/credentials': 'Business',
    '/remediation/approvals': 'Business',
    '/governance/approvals': 'Business',
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
    '/superadmin/pricing-units': 'Professional',
    '/admin/api-keys': 'Enterprise',
    '/admin/focus-export': 'Professional',
    // cloud-accounts NO es Enterprise, aunque estuvo declarado asi hasta el
    // 2026-09-04. Es la pantalla donde el cliente ve sus suscripciones, el
    // estado de la ingesta y el vencimiento de credenciales, y donde
    // desvincula o revincula para elegir cuales se monitorean.
    //
    // Dos evidencias de que el Enterprise estaba mal:
    //  - `CloudAccountsPanel` renderiza el banner de cuota de suscripciones
    //    SOLO cuando `effectiveTier !== "Enterprise"`, o sea que el panel esta
    //    construido para Professional y Business.
    //  - La pagina de precios le promete "Hasta 2 suscripciones de Azure" a
    //    Professional y "Hasta 3" a Business.
    //
    // Nunca dio problema porque el gate no se aplicaba: la pantalla es una
    // pestaña de `/admin/config` y `AdminHubGate` no miraba el tier. Al
    // agregarle el gate por pestaña, aplicar la declaracion tal cual le habria
    // escondido a esos dos tiers su unica forma de administrar el cupo.
    '/admin/cloud-accounts': 'Professional',
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
