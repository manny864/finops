import type { CloudProviderId } from "@/lib/providerPolicy";

/**
 * Mapa centralizado: ruta (sin prefijo de locale) -> proveedores que la
 * soportan. Es el equivalente por proveedor de `routeTiers.ts`, y se resuelve
 * igual: gana el prefijo más largo.
 *
 * POR QUÉ UNA ALLOW-LIST Y NO UNA DENY-LIST
 * -----------------------------------------
 * El panel nació 100% Azure: la mayoría de las páginas terminan llamando a
 * Azure Resource Manager / Resource Graph a través de sus APIs. Si el default
 * fuera "sirve para los dos", un tenant AWS vería ~30 ítems de menú que fallan
 * al abrirlos — peor que no verlos.
 *
 * Por eso el default es **azure-only** y acá se listan explícitamente:
 *   - las rutas AGNÓSTICAS: no tocan ningún SDK de nube (plataforma, cuenta,
 *     usuarios, facturación del SaaS, auditoría, exports FOCUS), o leen de
 *     tablas propias que ambos proveedores alimentan;
 *   - las rutas AWS-ONLY: hoy sólo el alta de cuentas AWS.
 *
 * A medida que la Fase 7 vaya parametrizando páginas (ver
 * docs/aws-multicloud-handoff.md §3.4), cada una se mueve a AGNOSTIC_ROUTES.
 * Esa lista es, literalmente, el marcador de avance de la Fase 7.
 */

const BOTH: readonly CloudProviderId[] = ["azure", "aws"];
const AZURE_ONLY: readonly CloudProviderId[] = ["azure"];
const AWS_ONLY: readonly CloudProviderId[] = ["aws"];

/**
 * Rutas que funcionan igual con cualquier proveedor. Verificado una por una:
 * ninguna depende de credenciales de Azure para renderizar su contenido
 * principal.
 */
const AGNOSTIC_ROUTES: readonly string[] = [
    "/",
    "/academy",
    "/support",
    "/admin/users",
    "/admin/security",
    "/admin/config",
    "/admin/billing",
    "/admin/notifications",
    "/admin/audit",
    "/admin/api-keys",
    "/admin/mcp-keys",
    "/admin/sso",
    "/admin/ai-config",
    "/admin/ai-config-global",
    "/admin/focus-export",
    "/admin/tenants",
    "/admin/pricing-units",
    "/admin/load-test",
    "/admin/system-alerts",
    "/superadmin",
    "/legal",
    "/status",
    "/upgrade",

    // --- Fase 7: páginas de costo que leen de tablas propias ---------------
    // Verificadas una por una: su API principal no importa (ni directa ni
    // transitivamente) ningún SDK de Azure. Leen `CostSnapshots` / `CostGroups`,
    // tablas que el sync de AWS también alimenta (ver /api/sync/aws/[id]/ce),
    // así que muestran datos reales para un tenant AWS sin código nuevo.
    "/intelligence/cost-by-category",
    "/intelligence/cost-groups",
    "/intelligence/simulator",
];

/** Rutas que sólo tienen sentido con AWS conectado. */
const AWS_ROUTES: readonly string[] = ["/admin/cloud-accounts"];

/**
 * `/admin/onboarding/lighthouse` es Azure puro aunque cuelgue de un prefijo
 * agnóstico; se declara aparte para que el match por prefijo más largo lo
 * resuelva bien.
 */
const EXPLICIT_AZURE_ROUTES: readonly string[] = [
    "/admin/onboarding",
    "/admin/markup",
    "/admin/workbooks",
    "/admin/powerbi-templates",
    "/admin/copilot-m365",
    "/admin/report",
];

const ROUTE_PROVIDERS: Record<string, readonly CloudProviderId[]> = {
    ...Object.fromEntries(AGNOSTIC_ROUTES.map((r) => [r, BOTH])),
    ...Object.fromEntries(EXPLICIT_AZURE_ROUTES.map((r) => [r, AZURE_ONLY])),
    ...Object.fromEntries(AWS_ROUTES.map((r) => [r, AWS_ONLY])),
};

/**
 * Proveedores que soportan una ruta. Match por prefijo más largo, igual que
 * `getRequiredTier`, para que `/admin/onboarding/lighthouse` (Azure) gane sobre
 * un eventual `/admin` agnóstico.
 *
 * La raíz `/` se trata como caso exacto: si no, sería prefijo de todo.
 */
export function providersForRoute(href: string): readonly CloudProviderId[] {
    if (href === "/") return BOTH;

    let best: string | null = null;
    for (const route of Object.keys(ROUTE_PROVIDERS)) {
        if (route === "/") continue;
        if (href === route || href.startsWith(`${route}/`)) {
            if (!best || route.length > best.length) best = route;
        }
    }
    return best ? ROUTE_PROVIDERS[best] : AZURE_ONLY;
}

export function isRouteAvailableForProvider(href: string, provider: CloudProviderId): boolean {
    return providersForRoute(href).includes(provider);
}

/**
 * Rutas explícitamente habilitadas para AWS.
 *
 * Existe para que las verificaciones automáticas (por ejemplo el test de
 * terminología por proveedor) puedan recorrer la lista real en vez de una copia
 * a mano que se desactualiza en silencio: habilitar una página para AWS y
 * olvidarse de revisar su i18n es exactamente cómo se coló el "VMs/AKS" que
 * veían los tenants AWS.
 */
export function awsEnabledRoutes(): readonly string[] {
    return Object.entries(ROUTE_PROVIDERS)
        .filter(([, providers]) => providers.includes("aws"))
        .map(([route]) => route)
        .sort();
}
