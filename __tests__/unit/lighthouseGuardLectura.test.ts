// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Toda ruta que LEE de Azure con un scope que viene del request tiene que
 * exigir que ese scope sea del tenant.
 *
 * Con Lighthouse la credencial es una sola, la nuestra, delegada sobre las
 * suscripciones de todos los clientes: un `?subscriptionId=` de otro cliente
 * devolvía sus VMs, sus costos, sus presupuestos o sus resource groups. Las
 * escrituras se cerraron en lighthouseGuardEscritura.test.ts; esto es lo mismo
 * para las lecturas.
 *
 * La lista se armó siguiendo cada parámetro con forma de scope de cada ruta
 * hasta donde se usa. Las que lo mandan a Azure están en LEEN_CON_SCOPE; las
 * que sólo filtran nuestra base, o ya lo cruzan con la lista del tenant, en
 * VERIFICADAS. Una ruta nueva que lea un parámetro así de la query y toque
 * Azure falla acá hasta que alguien la clasifique.
 *
 * Lo que este test NO cubre: las consultas a Resource Graph sin `subscriptions`,
 * que con Lighthouse abarcan a todos los clientes aunque nadie mande nada
 * (Learn, Resource Graph, "Query scope"). Es otro arreglo, en la fábrica del
 * cliente de ARG, y no un chequeo por ruta.
 */

/** Lectura con scope del request, verificada leyendo la ruta y lo que llama. */
const LEEN_CON_SCOPE: Array<[ruta: string, porque: string]> = [
    ["power", "GET: ARG con subscriptions: [subscriptionId]"],
    ["resourcegroups", "GET: ResourceManagementClient(credencial, subscriptionId)"],
    ["governance/tags", "GET: scanTagGovernanceLive con [subscriptionId]"],
    ["governance/tags/inheritance-preview", "analyzeMissingTags: el id en el KQL de un ARG sin suscripciones"],
    ["audit/full", "runGraphAudits con [subscriptionId], y su cache se indexa por suscripción sin tenant"],
    ["budgets", "getBudgetConsumption: Cost Management sobre /subscriptions/{id}"],
    ["budgets/monthly-history", "Cost Management sobre /subscriptions/{id}"],
    ["budgets/burn", "lista: presupuestos de Consumption y costo MTD por suscripción"],
    ["cleanup/zombies", "runGraphAudits con [subscriptionId]"],
    ["cleanup/zombies/networking", "runGraphAudits con [subscriptionId]"],
    ["analytics/self-service-alerts/scope-options", "el id en el KQL de un ARG sin suscripciones"],
    ["dashboard/summary", "costo MTD, histórico y huella de carbono por suscripción"],
    ["intelligence/chargeback", "Cost Management sobre /subscriptions/{id}"],
    ["intelligence/container-apps/details", "ARM sobre /subscriptions/{id}/resourceGroups/{rg}"],
    ["intelligence/container-apps", "si ARG falla, la suscripción del request pasa tal cual"],
    ["intelligence/cosmos-db", "idem container-apps"],
    ["intelligence/misc-services", "idem container-apps"],
    ["intelligence/cost-projection", "histórico de Cost Management cuando la base no alcanza"],
    ["intelligence/financial-leaks", "ARG con [subscriptionId]"],
    ["intelligence/zombies", "ARG con [subscriptionId]"],
    ["intelligence/forecast", "Cost Management: MTD y forecast por suscripción"],
    ["intelligence/billing", "Cost Management: MTD por suscripción"],
    ["intelligence/network", "Cost Management sobre /subscriptions/{id}"],
    ["intelligence/network/basic", "lista: KQL sobre un ARG sin suscripciones"],
    ["intelligence/rates", "Consumption: recomendaciones de reserva por suscripción"],
    ["intelligence/sustainability", "ARG por suscripción; validaba el formato, no el dueño"],
    ["intelligence/anomalies", "histórico de Cost Management cuando la base no alcanza"],
    ["locations", "ARM sobre /subscriptions/{id}/locations"],
    ["recommendations", "ARG con subscriptions: [subscriptionId]"],
    ["tags/compliance", "ARG con [subscriptionId]"],
    ["intelligence/commitments/reservations/utilization", "reserva de nivel tenant: con Lighthouse, la de nuestro directorio"],
    // El scope viaja en el body.
    ["intelligence/executive-report/jobs", "POST: el job guarda la suscripción y la usa contra Azure"],
    ["reports/executive/export-pdf", "fuera de TENANT_ALL, scopeId llega como suscripción (huella, etiquetas)"],
    ["reports/executive/send-email", "idem export-pdf"],
    ["reports/executive/start-job", "idem export-pdf, guardado para el job"],
];

/**
 * Leen un parámetro con forma de scope y tocan Azure, pero el parámetro no
 * llega sin validar. Se listan para que la próxima auditoría no las revise
 * desde cero.
 */
const VERIFICADAS = [
    "admin/check-sp-roles",               // filtra sobre listTenantSubscriptions
    "admin/report/invoicing",             // CostSnapshots con tenant_id
    "advisor",                            // filtra recomendaciones ya traídas del tenant
    "consumption",                        // no consulta Azure: devuelve un placeholder
    "history",                            // DailySnapshots con tenant_id
    "intelligence/perspectives/breakdown", // CostSnapshots con tenant_id
    "reports/billing",                    // filtra datos ya traídos del tenant
    "resources/search",                   // ARG acotado a getSubscriptionsForTenant; el filtro sólo achica
];

const GUARD = /await (?:exigirScopesDelTenant|exigirSuscripcionDelTenant|soloSuscripcionesDelTenant)\(/;
const PARAM_DE_SCOPE =
    /searchParams\.get\(\s*['"](?:subscriptionId|subscriptionIds|subscriptions|resourceId|resourceIds|resourceGroup|scope|scopeId|reservationId|orderId|workspaceId)['"]\s*\)/;
const TOCA_AZURE = /@\/lib\/azure['"]|@\/services\/|@\/modules\/collectors|from ['"]@azure\/|management\.azure\.com/;
const CACHE = /getWithStaleWhileRevalidate\(|cacheKey\s*=|vmCache\.get\(/;

const fuente = (ruta: string) => readFileSync(`src/app/api/${ruta}/route.ts`, "utf8");

function rutas(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) rutas(p, out);
        else if (entry === "route.ts") out.push(p);
    }
    return out;
}

describe("Lighthouse · lecturas con scope del request", () => {
    it("las rutas que leen de Azure con un scope del request lo exigen del tenant", () => {
        const sinChequeo = LEEN_CON_SCOPE.filter(([ruta]) => !GUARD.test(fuente(ruta))).map(([r, p]) => `${r} — ${p}`);
        expect(sinChequeo, sinChequeo.join("\n")).toEqual([]);
    });

    it("el chequeo va antes del cache: lo cacheado antes del arreglo puede ser de otro tenant", () => {
        const despues = LEEN_CON_SCOPE.map(([ruta]) => ruta).filter((ruta) => {
            const s = fuente(ruta);
            const cache = s.search(CACHE);
            return cache >= 0 && s.search(GUARD) > cache;
        });
        expect(despues, `El cache se consulta antes del chequeo en: ${despues.join(", ")}`).toEqual([]);
    });

    it("no hay rutas nuevas que lean un scope de la query y toquen Azure sin clasificar", () => {
        const conocidas = new Set([...LEEN_CON_SCOPE.map(([r]) => r), ...VERIFICADAS]);
        const sinClasificar = rutas("src/app/api")
            .filter((archivo) => {
                const s = readFileSync(archivo, "utf8");
                return PARAM_DE_SCOPE.test(s) && TOCA_AZURE.test(s);
            })
            .map((a) => a.replace(/\\/g, "/").replace(/^src\/app\/api\//, "").replace(/\/route\.ts$/, ""))
            .filter((r) => !conocidas.has(r));

        expect(
            sinClasificar,
            sinClasificar.length
                ? `Rutas que leen un scope de la query y tocan Azure, sin clasificar:\n` +
                  sinClasificar.map((r) => `  - ${r}`).join("\n") +
                  `\n\nSeguí el parámetro hasta Azure. Si llega a ARG, ARM, Cost Management o Monitor, ` +
                  `exigilo con exigirSuscripcionDelTenant / soloSuscripcionesDelTenant y sumá la ruta a LEEN_CON_SCOPE. ` +
                  `Si sólo filtra nuestra base o ya lo cruza con la lista del tenant, sumala a VERIFICADAS con el motivo.`
                : "",
        ).toEqual([]);
    });

    it("las verificadas siguen sin mandar el parámetro a Azure por su cuenta", () => {
        // Si una verificada empieza a usar el helper, pasó a leer con scope: moverla de lista.
        const conGuard = VERIFICADAS.filter((r) => GUARD.test(fuente(r)));
        expect(conGuard, `Usan el chequeo, van en LEEN_CON_SCOPE: ${conGuard.join(", ")}`).toEqual([]);
    });
});

const { modeloMock, fetchMock } = vi.hoisted(() => ({ modeloMock: vi.fn(), fetchMock: vi.fn() }));
vi.mock("@/lib/lighthouseAccess", () => ({ getAccessModel: modeloMock }));

describe("Lighthouse · reservas", () => {
    it("con Lighthouse no se listan: ARM devolvería las de nuestro directorio", async () => {
        vi.stubGlobal("fetch", fetchMock);
        try {
            const { getActiveReservations } = await import("@/services/reservationService");
            const credencial = { getToken: vi.fn(async () => ({ token: "t", expiresOnTimestamp: 0 })) };

            modeloMock.mockResolvedValue("lighthouse");
            await expect(getActiveReservations("t-lh", credencial)).resolves.toEqual([]);
            expect(fetchMock).not.toHaveBeenCalled();
            expect(credencial.getToken).not.toHaveBeenCalled();

            // Con app registration el directorio del token es el del cliente.
            modeloMock.mockResolvedValue("app_registration");
            fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }));
            await expect(getActiveReservations("t-app", credencial)).resolves.toEqual([]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0][0])).toContain("/providers/Microsoft.Capacity/reservations?");
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
