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

    // Presupuestos. Los definidos en la plataforma viven en la tabla Budgets y
    // ya eran agnosticos; los nativos salen de AWS Budgets, que es un servicio
    // global aparte (solo responde en us-east-1) y no tiene scope jerarquico:
    // se consultan cuenta por cuenta.
    "/intelligence/budgets",

    // Gastos y proyeccion: la serie sale de CostSnapshots, que el sync de AWS
    // llena por los dos caminos (CUR y Cost Explorer). El backfill contra Azure
    // se saltea para AWS, que ya trae su propio historico.
    "/intelligence/cost-projection",

    // Asignacion de costos. Se habilitan a partir de la migracion
    // 20260728-001, que agrega la dimension de etiqueta a la clave unica de
    // CostSnapshots: antes el agregado diario colapsaba las filas con distinto
    // centro de costo y todo el gasto AWS caia en "Sin asignar".
    // Requiere que el cliente tenga el CUR configurado: el camino de Cost
    // Explorer no trae etiquetas de recurso.
    "/intelligence/allocation",
    "/intelligence/cost-centers",
    "/intelligence/chargeback",
    "/intelligence/unit-economics",

    // Limpieza de recursos ociosos. El inventario AWS lo arma
    // awsInventoryService con las APIs de EC2 (volumenes EBS sin adjuntar, IPs
    // elasticas ociosas, snapshots vencidos e instancias apagadas), que es el
    // equivalente funcional de la consulta KQL a Resource Graph en Azure.
    "/cleanup/zombies",

    // --- Plataforma / SaaS: no dependen de la nube del tenant -------------
    // Estas paginas administran el producto (identidad, facturacion del SaaS,
    // cumplimiento, integraciones), no los recursos del cliente. Estaban
    // ocultas para AWS sólo porque el default de esta allow-list es azure-only,
    // y eso dejaba al tenant AWS sin medio panel de administracion.
    "/admin/compliance",
    "/admin/data-residency",
    "/admin/markup",
    "/admin/payments",
    "/admin/powerbi-templates",
    "/admin/copilot-m365",
    "/admin/report",
    "/remediation/approvals",
    "/intelligence/alerts",
    "/intelligence/upload",
    "/marketplace",
    "/mobile",
    "/upgrade",

    // Rutas de autenticacion y alta. Son pre-login o de ciclo de vida de la
    // cuenta: el tenant AWS entra justamente por aca (email + contraseña).
    "/login",
    "/signup",
    "/verify-email",
    "/reset-password",
    "/accept-invite",
    "/demo",

    // La deteccion (Z-Score) corre sobre CostSnapshots; lo unico Azure era el
    // backfill del historial, que en AWS no hace falta porque el sync ya
    // escribe la serie completa.
    "/intelligence/anomalies",

    // Todo el ranking sale de CostSnapshots. Lo unico Azure era resolver los
    // nombres de suscripcion; en AWS se resuelven los alias de AwsAccounts.
    "/overview/top-expenses",

    // Es la landing post-login: si no esta habilitada, un tenant AWS aterriza
    // en una pagina que su propio menu no muestra. La API se parametrizo por
    // proveedor (los bloques de costo salen de CostSnapshots; el inventario y
    // Advisor quedan vacios hasta la Fase 8).
    "/overview/whiteboard",

    // Lee `DailySnapshots` del dominio 'dashboard_summary', que se escribe
    // desde /api/dashboard/summary — ya parametrizada por proveedor. La serie
    // de ahorro capturado se arma con los mismos snapshots para las dos nubes.
    "/overview/captured-savings",
];

/** Rutas que sólo tienen sentido con AWS conectado. */
const AWS_ROUTES: readonly string[] = ["/admin/cloud-accounts"];

/**
 * `/admin/onboarding/lighthouse` es Azure puro aunque cuelgue de un prefijo
 * agnóstico; se declara aparte para que el match por prefijo más largo lo
 * resuelva bien.
 */
const EXPLICIT_AZURE_ROUTES: readonly string[] = [
    // El alta por Service Principal / Lighthouse es especifica de Azure; el
    // alta de cuentas AWS vive en /admin/cloud-accounts.
    "/admin/onboarding",
    // Azure Workbooks es un producto de Azure Monitor, sin equivalente AWS.
    "/admin/workbooks",
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
