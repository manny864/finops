/**
 * Quién es un tenant de DEMO, separado del dataset de la demo.
 *
 * Vivía en `mockData.ts` (4.452 líneas, 292 KB) y por eso ese archivo entero viajaba al
 * navegador: 184 componentes de cliente importan `isMockTenant` y sólo 8 usan datos de
 * verdad. Medido en el build del 2026-10-06, 241 de 250 páginas cargaban el chunk con el
 * dataset (676 KB crudo, 194 KB gzip) para evaluar un `if`.
 *
 * Este módulo no importa nada y tiene que seguir así: un componente de cliente puede traerlo
 * sin arrastrar datos ni servicios. `mockData.ts` lo re-exporta, así que los ~300 archivos
 * de servidor y los tests que lo importan de allá no cambian.
 */

/**
 * Tenant "cliente" que se precarga en el generador de script de
 * /admin/access?tab=onboarding.
 *
 * Existe aparte de MOCK_AZURE_TENANTS por una razon concreta: esos cuatro ids
 * NO son UUIDs RFC-4122 (el cuarto grupo arranca en 5/6/7 y el validador exige
 * [89ab]), asi que `generateOnboardingScript` los rechaza. En vez de relajar
 * esa validacion —que se usa en cinco entradas reales de la plataforma— la
 * demo usa un GUID que sí conforma, y de paso modela mejor el flujo: un MSP
 * onboardea el tenant de SU CLIENTE, no el propio.
 */
export const MOCK_ONBOARDING_CLIENT_TENANT = "d0000000-0000-4000-8000-00000000c001";

/**
 * Tenants de demo de Azure, uno por tier (Professional/Business/Enterprise
 * — el antiguo tier Essential se descontinuó, ver migrations/).
 */
export const MOCK_AZURE_TENANTS = [
    "11111111-2222-3333-4444-555555555555",
    "22222222-3333-4444-5555-666666666666",
    "44444444-5555-6666-7777-888888888888",
    "33333333-4444-5555-6666-777777777777",
    MOCK_ONBOARDING_CLIENT_TENANT,
] as const;

/**
 * Suscripciones sinteticas de los tenants demo.
 *
 * Son GUIDs validos a proposito: `generateOnboardingScript` valida el formato
 * y tira si no lo es, asi que sin esto el generador de script de
 * /admin/access?tab=onboarding no podia demostrarse en demo. Los nombres son
 * los mismos que usan los seeds de zombies y networking, para que la demo
 * cuente una sola historia.
 */
export const MOCK_AZURE_SUBSCRIPTIONS = [
    { id: "d0000000-0000-4000-8000-000000000001", name: "CSCS-LandingZone-Production" },
    { id: "d0000000-0000-4000-8000-000000000002", name: "CSCS-DataPlatform-Analytics" },
    { id: "d0000000-0000-4000-8000-000000000003", name: "CSCS-Testing-Sandbox" },
] as const;

export const isMockTenant = (tenantId: string) => {
    if (!tenantId) return false;
    const lower = tenantId.trim().toLowerCase();
    if (
        lower === "demo" ||
        lower === "demo_tenant" ||
        lower === "demo-tenant" ||
        lower.startsWith("demo") ||
        lower.startsWith("mock") ||
        lower.includes("demo") ||
        lower.includes("mock")
    ) {
        return true;
    }
    return ([...MOCK_AZURE_TENANTS] as string[]).includes(tenantId);
};
