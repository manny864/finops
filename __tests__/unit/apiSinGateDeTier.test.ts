// @vitest-environment node
/**
 * Las APIs de las pantallas de planes pagos tienen que exigir el plan EN EL SERVIDOR.
 *
 * `src/lib/routeTiers.ts` dice qué plan pide cada pantalla, pero sólo lo hace cumplir la UI
 * (`RouteTierGate`, el menú): el servidor nunca consulta ese mapa y `proxy.ts` no mira el plan. Una ruta
 * de API que sólo llama a `requireTenantAccess` responde a cualquier tenant autenticado de su propio
 * tenant, sea cual sea su plan: un Professional puede pedir directo una API Enterprise. Hallazgo de la
 * auditoría del 2026-10-10 (mismo origen que el desfase de `/admin/api-keys`, que se corrigió aparte).
 *
 * Este test NO decide qué rutas deben tener gate (eso es una decisión de producto, ruta por ruta: una API
 * puede alimentar a propósito una pantalla de un plan menor). Hace dos cosas:
 *  1. Registra el estado actual como lista de excepciones (`SIN_GATE_DE_TIER`).
 *  2. Falla si aparece una ruta NUEVA sin gate bajo una pantalla paga, o si una de la lista ya tiene gate
 *     y hay que sacarla (las excepciones se auto-invalidan, como `TABLEROS_MUERTOS`).
 *
 * Una ruta "tiene gate" si usa `requireTenantTier`/`assertTenantTier`/`hasAccess`/`tierLogic`, o si no es
 * de usuarios de un plan: `requireSuperAdmin`, `verifyApiKey` (se pagan al crear la clave) o secreto de cron.
 *
 * Limite conocido: el mapeo pantalla -> API es por prefijo de ruta (`/intelligence/aks` -> `/api/intelligence/aks`).
 * No ve APIs con otro prefijo (p. ej. la pantalla `/admin/api-keys` usa `/api/admin/public-api-keys`).
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROUTE_TIERS } from "@/lib/routeTiers";

const RAIZ = process.cwd();
const GUARDA = /requireTenantTier|assertTenantTier|requireSuperAdmin|hasAccess\(|tierLogic|verifyApiKey|X-Cron-Auth|CRON_SECRET/;

/** Estado al 2026-10-10. Sacar una línea cuando la ruta pase a exigir el plan; NO agregar sin decisión de producto. */
const SIN_GATE_DE_TIER = new Set<string>([
    // Enterprise (43)
    "admin/data-residency/route.ts",
    "admin/sso/portal-link/route.ts",
    "admin/sso/route.ts",
    "admin/sso/test/route.ts",
    "admin/workbooks/route.ts",
    "governance/policies/route.ts",
    "intelligence/ai-analytics/diagnostics/route.ts",
    "intelligence/aks/route.ts",
    "intelligence/anomalies/[id]/explanation/route.ts",
    "intelligence/anomalies/route.ts",
    "intelligence/app-insights/route.ts",
    "intelligence/azure-ai/aml/route.ts",
    "intelligence/azure-ai/content-safety/route.ts",
    "intelligence/azure-ai/databricks/route.ts",
    "intelligence/azure-ai/document-intelligence/route.ts",
    "intelligence/azure-ai/foundry/detail/route.ts",
    "intelligence/azure-ai/route.ts",
    "intelligence/azure-ai/search/route.ts",
    "intelligence/azure-ai/speech-language/route.ts",
    "intelligence/azure-ai/summary/route.ts",
    "intelligence/azure-ai/vision-video/route.ts",
    "intelligence/azure-monitor/route.ts",
    "intelligence/commitment-simulator/route.ts",
    "intelligence/cost-projection/route.ts",
    "intelligence/integration-services/adf/route.ts",
    "intelligence/integration-services/apim/route.ts",
    "intelligence/integration-services/event-grid/route.ts",
    "intelligence/integration-services/event-hubs/route.ts",
    "intelligence/integration-services/logic-apps/route.ts",
    "intelligence/integration-services/service-bus/route.ts",
    "intelligence/licenses/route.ts",
    "intelligence/log-analytics/route.ts",
    "intelligence/perspectives/breakdown/route.ts",
    "intelligence/rates/route.ts",
    "intelligence/rightsizing/exemptions/route.ts",
    "intelligence/rightsizing/route.ts",
    "intelligence/scorecard/route.ts",
    "intelligence/seguridad/sentinel/route.ts",
    "intelligence/simulator/scenarios/[id]/route.ts",
    "intelligence/storage-efficiency/history/route.ts",
    "intelligence/storage-efficiency/route.ts",
    "intelligence/unit-economics/route.ts",
    "intelligence/zero-cost/route.ts",
    // Business (16)
    "cleanup/ttl/history/route.ts",
    "cleanup/ttl/unlabeled/route.ts",
    "governance/lifecycle/route.ts",
    "intelligence/cost-by-category/route.ts",
    "intelligence/network/analytics/route.ts",
    "intelligence/network/basic/route.ts",
    "intelligence/network/capacity/route.ts",
    "intelligence/network/egress/route.ts",
    "intelligence/network/hybrid/route.ts",
    "intelligence/network/internet-access/route.ts",
    "intelligence/network/internet/route.ts",
    "intelligence/network/load-balancing/route.ts",
    "intelligence/network/loadbalancer/route.ts",
    "intelligence/network/route.ts",
    "intelligence/network/service-cost-v2/route.ts",
    "intelligence/network/service-cost/route.ts",
]);

function rutasDePlanPago(): string[] {
    const archivos = execSync("git ls-files 'src/app/api/*route.ts'", { cwd: RAIZ, encoding: "utf8" }).split("\n").filter(Boolean);
    const prefijos = Object.keys(ROUTE_TIERS);
    const salida: string[] = [];
    for (const f of archivos) {
        const dir = path.posix.dirname(f).slice("src/app/api".length);
        const gobernantes = prefijos.filter((p) => dir === p || dir.startsWith(p + "/"));
        if (!gobernantes.length) continue;
        const plan = ROUTE_TIERS[gobernantes.sort((a, b) => b.length - a.length)[0]];
        if (plan === "Business" || plan === "Enterprise") salida.push(f);
    }
    return salida;
}

describe("APIs de pantallas de planes pagos sin gate de tier en el servidor", () => {
    const candidatas = rutasDePlanPago();
    const sinGate = candidatas
        .filter((f) => !GUARDA.test(readFileSync(path.join(RAIZ, f), "utf8")))
        .map((f) => f.slice("src/app/api/".length));

    it("el test está mirando algo (hay un centenar de rutas bajo pantallas Business/Enterprise)", () => {
        expect(candidatas.length).toBeGreaterThan(60);
    });

    it("no aparece ninguna ruta nueva sin gate bajo una pantalla paga", () => {
        const nuevas = sinGate.filter((r) => !SIN_GATE_DE_TIER.has(r));
        expect(nuevas, "exigí el plan con requireTenantTier(request, tenantId, \"<Plan>\") o, si es a propósito, agregala a SIN_GATE_DE_TIER con una decisión de producto").toEqual([]);
    });

    it("la lista de excepciones no tiene entradas viejas (rutas que ya exigen el plan o ya no existen)", () => {
        const obsoletas = [...SIN_GATE_DE_TIER].filter((r) => !sinGate.includes(r));
        expect(obsoletas, "estas ya tienen gate o ya no existen: sacalas de SIN_GATE_DE_TIER").toEqual([]);
    });
});
