// Registro central de etiquetas de rol por página del SaaS.
//
// DIRECTIVA: toda página nueva del sidebar (src/components/Sidebar.tsx) DEBE
// agregar una entrada acá con al menos una etiqueta. Sidebar la usa para (a)
// mostrar el badge de rol junto al link y (b) filtrar la navegación para los
// 4 roles de negocio (Analista FinOps / Admin Cloud / Auditor de Seguridad /
// Product Owner). Ver docs/roles-y-permisos.md para la semántica completa.
//
// Un href sin entrada acá se trata como 'Platform' por defecto (visible solo
// para Admin/Owner/SuperAdmin) — better fail-closed que fail-open.

import { stripLocale } from "./routeTiers";

export type RoleTag = "FinOps" | "CloudAdmin" | "Security" | "ProductOwner" | "Platform";

export const ROLE_TAG_META: Record<RoleTag, { label: string; color: string; description: string }> = {
    FinOps: {
        label: "FinOps",
        color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200 dark:border-sky-900",
        description: "Visibilidad de costos y recomendaciones — sin permisos de ejecución.",
    },
    CloudAdmin: {
        label: "Cloud Admin",
        color: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-900",
        description: "Permisos de ejecución y escritura sobre infraestructura (remediación, políticas, horarios).",
    },
    Security: {
        label: "Seguridad",
        color: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-900",
        description: "Auditoría de cumplimiento, credenciales y gobernanza.",
    },
    ProductOwner: {
        label: "Product Owner",
        color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900",
        description: "Visibilidad restringida a su Centro de Costos / aplicación.",
    },
    Platform: {
        label: "Plataforma",
        color: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300 border-gray-200 dark:border-slate-700",
        description: "Administración del SaaS (usuarios, facturación, configuración) — no es un dominio FinOps/Cloud/Seguridad.",
    },
};

// href (sin locale, tal como aparece en Sidebar.categories[].items[].href) -> tags.
export const PAGE_ROLE_TAGS: Record<string, RoleTag[]> = {
    // Visibilidad
    "/": ["FinOps"],
    // "/academy" deliberadamente ausente: siempre visible para todo rol/permiso
    // (ver ALWAYS_VISIBLE_HREFS en Sidebar.tsx / ALWAYS_VISIBLE_ROUTES en RouteTierGate.tsx).
    "/advisor": ["FinOps", "CloudAdmin", "Security"],
    "/overview/maturity": ["FinOps"],
    "/overview/progress": ["FinOps"],
    "/overview/top-expenses": ["FinOps"],
    "/overview/resources": ["CloudAdmin", "FinOps"],
    "/overview/sustainability": ["FinOps"],
    "/overview/whiteboard": ["FinOps"],
    "/overview/captured-savings": ["FinOps"],
    "/overview/financial-leaks": ["FinOps"],

    // Inteligencia Financiera
    "/intelligence/billing": ["FinOps"],
    "/intelligence/budgets": ["FinOps"],
    "/intelligence/cost-groups": ["FinOps"],
    "/intelligence/rightsizing": ["FinOps", "CloudAdmin"],
    "/intelligence/network": ["CloudAdmin"],
    "/intelligence/rates": ["FinOps"],
    "/intelligence/licenses": ["FinOps", "Security"],
    "/intelligence/hybrid-benefit": ["FinOps"],
    "/intelligence/commitments": ["FinOps"],
    "/intelligence/zero-cost": ["FinOps"],
    "/intelligence/aks": ["CloudAdmin"],
    "/intelligence/aks-chargeback": ["FinOps"],
    "/intelligence/container-apps": ["FinOps"],
    "/intelligence/log-analytics": ["FinOps"],
    "/intelligence/unit-economics": ["FinOps"],
    "/intelligence/allocation": ["FinOps"],
    "/intelligence/scorecard": ["ProductOwner"],
    "/intelligence/cost-centers": ["FinOps"],
    "/intelligence/anomalies": ["Security"],
    "/intelligence/optimization-index": ["FinOps"],
    "/intelligence/tenant-health": ["CloudAdmin"],
    "/intelligence/simulator": ["FinOps"],
    "/intelligence/cost-projection": ["FinOps"],
    "/intelligence/storage-efficiency": ["FinOps", "CloudAdmin"],
    "/intelligence/cost-by-category": ["FinOps"],
    "/intelligence/commitment-simulator": ["FinOps"],
    "/intelligence/compute-efficiency": ["FinOps", "CloudAdmin"],
    "/intelligence/alerts": ["FinOps"],
    "/intelligence/ai-analytics": ["ProductOwner"],
    "/intelligence/macc": ["FinOps"],
    "/intelligence/upload": ["FinOps"],

    // Limpieza de Nube
    "/cleanup/zombies": ["CloudAdmin"],
    "/cleanup/zombies/networking": ["CloudAdmin"],
    "/cleanup/ttl": ["CloudAdmin"],

    // Gobernanza
    "/governance/tags": ["Security"],
    "/governance/power": ["CloudAdmin"],
    "/governance/policies": ["CloudAdmin"],
    "/governance/reporting": ["Security"],
    "/governance/ha": ["CloudAdmin"],
    "/governance/credentials": ["Security"],
    "/remediation/approvals": ["CloudAdmin"],

    // Administración (plataforma del SaaS, no un dominio FinOps/Cloud/Seguridad)
    "/support": ["Platform"],
    "/admin/users": ["Platform"],
    "/admin/onboarding": ["Platform"],
    "/admin/onboarding/lighthouse": ["Platform"],
    "/admin/config": ["Platform"],
    "/admin/markup": ["Platform"],
    "/admin/ai-config": ["Platform"],
    "/admin/report": ["FinOps", "Platform"],
    "/admin/report/invoicing": ["FinOps", "Platform"],
    "/admin/workbooks": ["Platform"],
    "/admin/notifications": ["Platform"],
    "/admin/billing": ["Platform"],
    "/admin/copilot-m365": ["Platform"],
    "/admin/audit": ["Security", "Platform"],
    "/admin/mcp-keys": ["Platform"],
    "/admin/api-keys": ["Platform"],
    "/admin/powerbi-templates": ["Platform"],
    "/admin/focus-export": ["FinOps", "Platform"],
    "/admin/sso": ["Security", "Platform"],
    "/admin/tenants": ["Platform"],
    "/superadmin/funnel": ["Platform"],
    "/superadmin/support": ["Platform"],
    "/admin/pricing-units": ["Platform"],
    "/admin/load-test": ["Platform"],
    "/admin/system-alerts": ["Platform"],
    "/admin/ai-config-global": ["Platform"],
};

// Match por prefijo más largo (igual criterio que getRequiredTierForPath en
// routeTiers.ts) para que sub-rutas dinámicas no listadas (ej. detalle de un
// item dentro de una página tageada) hereden la etiqueta de su ruta base en
// vez de caer siempre a Platform por defecto.
export function getTagsForRoute(pathname: string): RoleTag[] {
    const clean = stripLocale(pathname);
    let best: { route: string; tags: RoleTag[] } | null = null;
    for (const [route, tags] of Object.entries(PAGE_ROLE_TAGS)) {
        if (clean === route || clean.startsWith(route + "/")) {
            if (!best || route.length > best.route.length) best = { route, tags };
        }
    }
    return best ? best.tags : ["Platform"];
}

// Permisos de dominio asignables a un usuario (Users.permissions, JSON array).
// ORTOGONALES al rol (Users.role = Reader/Colaborador/Admin/Owner, que dice
// qué acciones puede EJECUTAR). Un permiso dice qué páginas puede VER, según
// PAGE_ROLE_TAGS de arriba. 'Platform' no es asignable acá — es implícito
// para Admin/Owner (administración del propio SaaS), no un dominio de negocio
// que un usuario elija.
export const ASSIGNABLE_PERMISSIONS: Array<{ value: RoleTag; label: string }> = [
    { value: "FinOps", label: "FinOps (Analista FinOps)" },
    { value: "CloudAdmin", label: "Cloud Admin" },
    { value: "Security", label: "Auditor de Seguridad" },
    { value: "ProductOwner", label: "Product Owner / Líder de Proyecto" },
];

// Normaliza lo que venga de DB (JSON string, array, null) a un array de RoleTag válidos.
export function parsePermissions(raw: unknown): RoleTag[] {
    let arr: unknown = raw;
    if (typeof raw === "string") {
        try { arr = JSON.parse(raw); } catch { arr = []; }
    }
    if (!Array.isArray(arr)) return [];
    const valid = new Set(ASSIGNABLE_PERMISSIONS.map(p => p.value));
    return arr.filter((t): t is RoleTag => valid.has(t as RoleTag));
}

// ¿Alguno de los permisos del usuario matchea alguna de las etiquetas de la página?
export function hasAnyTag(userPermissions: RoleTag[], pageTags: RoleTag[]): boolean {
    return pageTags.some(t => userPermissions.includes(t));
}
