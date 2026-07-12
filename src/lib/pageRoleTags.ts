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
    "/academy": ["ProductOwner", "FinOps"],
    "/advisor": ["FinOps", "CloudAdmin", "Security"],
    "/overview/maturity": ["FinOps"],
    "/overview/progress": ["FinOps"],
    "/overview/top-expenses": ["FinOps"],
    "/overview/resources": ["CloudAdmin", "FinOps"],
    "/overview/sustainability": ["FinOps"],

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
    "/intelligence/unit-economics": ["FinOps"],
    "/intelligence/allocation": ["FinOps"],
    "/intelligence/scorecard": ["ProductOwner"],
    "/intelligence/whiteboard": ["FinOps"],
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
    "/admin/payments": ["Platform"],
    "/admin/tenants": ["Platform"],
    "/superadmin/funnel": ["Platform"],
    "/superadmin/support": ["Platform"],
    "/admin/pricing-units": ["Platform"],
};

export function getTagsForRoute(href: string): RoleTag[] {
    return PAGE_ROLE_TAGS[href] || ["Platform"];
}

// Roles de negocio nuevos (además de Reader/Colaborador/Admin/Owner ya
// existentes en Users.role). El string es el valor exacto guardado en DB.
export const BUSINESS_ROLES = [
    { value: "Analista FinOps", tag: "FinOps" as RoleTag },
    { value: "Admin Cloud", tag: "CloudAdmin" as RoleTag },
    { value: "Auditor de Seguridad", tag: "Security" as RoleTag },
    { value: "Product Owner", tag: "ProductOwner" as RoleTag, label: "Líder de Proyecto / Product Owner" },
] as const;

export function tagForBusinessRole(role: string): RoleTag | null {
    const found = BUSINESS_ROLES.find(r => r.value.toLowerCase() === role.toLowerCase());
    return found ? found.tag : null;
}
