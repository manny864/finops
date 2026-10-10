// @vitest-environment node
/**
 * Las tools del MCP y el feed de Power BI tienen que leer fuentes que existen.
 *
 * `get_waste_zombies` / `get_zombie_resources` pedían `ZombieResources`, `get_budgets_status` / `get_budget_status`
 * pedían `Budgets.name` / `amount_usd` / `period` / `actual_spend_usd`, `get_recommendations` pedía `recommendations`
 * y el feed de Power BI pedía `zombies`: ninguna existe. MySQL rechazaba el SELECT y un `catch` devolvía
 * `{ count: 0, ..., note: "Tabla X no disponible" }`, que un agente lee como "no hay" (y que Power BI importaba como
 * una tabla vacía, sin error).
 *
 * Ahora cada una sale de la misma fuente que ve el usuario en la pantalla: el escaneo de Resource Graph (con su
 * caché de 15 min), Cost Management a través de la caché de GET /api/budgets, y Azure Advisor. Las tres son llamadas a
 * Azure: se mockean (no hay Azure acá) y lo que se prueba es que se las lea bien y que un fallo NUNCA se vea como
 * "no hay". MySQL, en cambio, es la base falsa que lee el DDL REAL del repo (`__tests__/helpers/ddlVersionado.ts`) y
 * rechaza, como MySQL, toda tabla o columna inexistente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { crearBaseFalsa, type Fila } from "../helpers/baseFalsaDdl";

const { query, scanLiveZombies, getBudgetConsumption, getAdvisorExecutiveData, cacheSwr, peekSwr, TENANT } = vi.hoisted(() => ({
    query: vi.fn(),
    scanLiveZombies: vi.fn(),
    getBudgetConsumption: vi.fn(),
    getAdvisorExecutiveData: vi.fn(),
    cacheSwr: vi.fn(),
    peekSwr: vi.fn(),
    TENANT: "8b41364f-581a-4e43-b7cb-13138dac5517",
}));

vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) }, initializeDatabase: vi.fn() }));
vi.mock("@/services/mcpApiKey.service", () => ({ authenticateMcpToken: vi.fn(async () => ({ tenantId: TENANT, keyId: 1 })) }));
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: (...a: unknown[]) => cacheSwr(...a),
    peekSwr: (...a: unknown[]) => peekSwr(...a),
}));
vi.mock("@/services/azureZombieScan.service", () => ({
    scanLiveZombies,
    zombieScanCacheKey: (t: string) => `zombies:${t}`,
    ZOMBIE_SCAN_TTL_S: 900,
    ZOMBIE_SCAN_SOFT_TTL_S: 300,
}));
// `calculateBudgetProjection` es la real (la pantalla de Presupuestos la usa); sólo el gasto, que es Azure, es falso.
vi.mock("@/services/budgetService", async () => ({
    ...(await vi.importActual<typeof import("@/services/budgetService")>("@/services/budgetService")),
    getBudgetConsumption,
}));
vi.mock("@/services/azureAdvisor.service", () => ({ getAdvisorExecutiveData }));

const { POST } = await import("@/app/api/mcp/route");
const { GET: feedDePowerBi } = await import("@/app/api/exports/powerbi-feed/route");
const { peekActiveHardWaste } = await import("@/services/azureHardWaste.service");
const { getBudgetsUtilization, budgetsCacheKey } = await import("@/services/budgetUtilization.service");

const base = crearBaseFalsa();
const fila = base.fila;

/** Llama a una tool por JSON-RPC, como un agente, y devuelve lo que la tool respondió. */
async function llamar(tool: string, args: Record<string, unknown> = {}) {
    const respuesta = await POST(
        new NextRequest("http://localhost/api/mcp", {
            method: "POST",
            headers: { authorization: "Bearer mcp_live_prueba", "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
        })
    );
    const cuerpo = await respuesta.json();
    return JSON.parse(cuerpo.result.content[0].text);
}

/** Pide un feed de Power BI con una llave válida: devuelve el status HTTP y el cuerpo. */
async function pedirFeed(type: string) {
    const respuesta = await feedDePowerBi(
        new NextRequest(`http://localhost/api/exports/powerbi-feed?type=${type}`, { headers: { authorization: "Bearer mcp_prueba" } })
    );
    return { status: respuesta.status, cuerpo: await respuesta.json() };
}

// ── Datos de prueba ─────────────────────────────────────────────────────────

const rid = (tipo: string, nombre: string) => `/subscriptions/s1/resourceGroups/rg/providers/${tipo}/${nombre}`;
/** Un hallazgo tal como lo devuelve `scanLiveZombies`: con las tres etiquetas mínimas salvo que se diga otra cosa. */
const zombi = (tipo: string, name: string, monthlyCost: number, extra: Fila = {}) => ({
    id: rid(tipo, name),
    resourceId: rid(tipo, name),
    name,
    type: tipo.toLowerCase(),
    resourceType: tipo.toLowerCase(),
    location: "eastus",
    resourceGroup: "rg",
    subscriptionId: "s1",
    subscriptionName: "s1",
    monthlyCost,
    estimatedMonthlyCost: monthlyCost,
    tags: { Environment: "Prod", CostCenter: "IT", Owner: "ops@contoso.com" },
    isHygiene: false,
    ...extra,
});

const HALLAZGOS = [
    zombi("Microsoft.Compute/disks", "disco-1", 10),
    zombi("Microsoft.Compute/disks", "disco-2", 20),
    zombi("Microsoft.Compute/disks", "disco-eximido", 100), // eximido más abajo
    zombi("Microsoft.Network/publicIPAddresses", "ip-1", 4),
    zombi("Microsoft.Network/virtualNetworkGateways", "gw-1", 130),
    // Higiene (grupo de recursos vacío): hallazgo de gobernanza, no desperdicio.
    zombi("Microsoft.Resources/subscriptions/resourceGroups", "rg-vacio", 0, { isHygiene: true }),
];

/** Lo que MCP y Power BI deben contar como desperdicio: sin el eximido ni la higiene, de mayor a menor. */
const DESPERDICIO_ESPERADO = [
    { name: "gw-1", tipo: "Microsoft.Network/virtualNetworkGateways", usd: 130, motivo: "VNet Gateway" },
    { name: "disco-2", tipo: "Microsoft.Compute/disks", usd: 20, motivo: "Disco Huérfano (Unattached)" },
    { name: "disco-1", tipo: "Microsoft.Compute/disks", usd: 10, motivo: "Disco Huérfano (Unattached)" },
    { name: "ip-1", tipo: "Microsoft.Network/publicIPAddresses", usd: 4, motivo: "IP Pública Huérfana" },
];

const presupuesto = (id: number, centro: string, limite: string, extra: Fila = {}) =>
    fila("Budgets", { id, tenant_id: TENANT, cost_center_tag_value: centro, monthly_limit_usd: limite, alert_threshold: "80.00", active: 1, ...extra });

const PRESUPUESTOS = () => [
    presupuesto(1, "Plataforma", "1000.00"),
    presupuesto(2, "Datos", "500.00"),
    presupuesto(3, "Web", "1000.00"),
    presupuesto(4, "Viejo", "300.00", { active: 0 }), // apagado: ni el agente ni Power BI lo ven
];
const GASTO: Record<string, number> = { Plataforma: 400, Datos: 650, Web: 850, Viejo: 10 };

/** Una recomendación de Advisor tal como la deja `getAdvisorExecutiveData`. */
const recomendacion = (id: string, actionType: string, ahorroMensual: number, extra: Fila = {}) => ({
    id,
    name: id,
    category: "Cost",
    impact: "High",
    resourceId: rid("Microsoft.Compute/virtualMachines", `vm-${id}`),
    resourceName: `vm-${id}`,
    resourceGroup: "rg",
    subscriptionId: "s1",
    subscriptionName: "s1",
    titleTranslated: `Problema de ${id}`,
    descriptionTranslated: "Solución",
    monthlySavingsUSD: ahorroMensual,
    annualSavingsUSD: ahorroMensual * 12,
    actionType,
    status: "active",
    ...extra,
});

const ADVISOR = () => ({
    success: true,
    recommendations: {
        Cost: [
            recomendacion("rs-1", "RESIZE", 50, { aiSuggestedAction: { actionTitle: "Redimensionar vm-rs-1 a Standard_D2s_v5", actionType: "RIGHTSIZE" } }),
            recomendacion("ri-1", "PURCHASE_RESERVATION", 300),
            recomendacion("ip-1", "DELETE_IP", 4),
            recomendacion("pospuesta", "RESIZE", 999, { status: "postponed" }),
        ],
        Security: [recomendacion("seg-1", "OPTIMIZE", 0, { category: "Security" })],
        HighAvailability: [],
        Performance: [],
        OperationalExcellence: [],
    },
});

let consolaError: ReturnType<typeof vi.spyOn>;
let consolaWarn: ReturnType<typeof vi.spyOn>;
const errorDeLaTool = (tool: string) => consolaError.mock.calls.some(([m]) => String(m).startsWith(`[mcp] ${tool}`));

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
    consolaWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cacheSwr.mockImplementation(async (_clave: string, f: () => unknown) => f());
    peekSwr.mockResolvedValue(null);
    scanLiveZombies.mockResolvedValue(HALLAZGOS);
    getBudgetConsumption.mockImplementation(async (_t: string, _s: string, centro: string) => GASTO[centro]);
    getAdvisorExecutiveData.mockResolvedValue(ADVISOR());
    query.mockImplementation(
        base.query({
            mcpapikeys: () => [fila("MCPApiKeys", { tenant_id: TENANT })],
            zombieexemptions: () => [
                fila("ZombieExemptions", {
                    resource_id: rid("Microsoft.Compute/disks", "disco-eximido"),
                    exemption_reason: "DR frío",
                    exempted_at: new Date("2026-09-01T00:00:00Z"),
                    expires_at: null,
                }),
            ],
            localresourcetagscache: () => [],
            budgets: PRESUPUESTOS,
        })
    );
});

afterEach(() => {
    consolaError.mockRestore();
    consolaWarn.mockRestore();
});

describe("la superficie del MCP no cambia", () => {
    it("sigue ofreciendo las mismas ocho tools con los mismos nombres", async () => {
        const respuesta = await POST(
            new NextRequest("http://localhost/api/mcp", {
                method: "POST",
                headers: { authorization: "Bearer mcp_live_prueba", "content-type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            })
        );
        const { result } = await respuesta.json();

        expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
            "get_cost_summary",
            "get_top_resources",
            "get_waste_zombies",
            "get_zombie_resources",
            "get_anomalies_feed",
            "get_budgets_status",
            "get_budget_status",
            "get_recommendations",
        ]);
    });
});

describe("MCP get_waste_zombies y get_zombie_resources", () => {
    it("devuelven el desperdicio duro vigente del escaneo: sin eximidos ni higiene, de mayor a menor plata", async () => {
        const r = await llamar("get_waste_zombies");

        expect(base.violaciones).toEqual([]);
        // No pasa en vacío: la base falsa sí vio las lecturas de MySQL que ensamblan el desperdicio.
        expect(query.mock.calls.map(([sql]) => String(sql).match(/FROM\s+(\w+)/i)?.[1]).sort()).toEqual(["LocalResourceTagsCache", "ZombieExemptions"]);
        expect(r.note).toBeUndefined();
        expect(r).toEqual({
            count: 4,
            waste: DESPERDICIO_ESPERADO.map((d) => ({
                // El id es el del recurso en Azure: el escaneo no guarda nada en una tabla, así que no hay id numérico.
                id: rid(d.tipo, d.name),
                subscription_id: "s1",
                resource_name: d.name,
                resource_type: d.tipo.toLowerCase(),
                resource_group: "rg",
                region: "eastus",
                estimated_waste_usd: d.usd,
                // Lo que no tiene motivo propio en el escaneo ("Recurso Zombi") se rotula por su tipo de recurso.
                reason: d.motivo,
            })),
        });
    });

    it("el alias get_zombie_resources devuelve lo mismo bajo la clave `zombies`", async () => {
        const waste = await llamar("get_waste_zombies");
        const zombies = await llamar("get_zombie_resources");

        expect(zombies.count).toBe(4);
        expect(zombies.zombies).toEqual(waste.waste);
        expect(zombies.waste).toBeUndefined();
    });

    it("lee el escaneo del tenant de la llave, por la caché compartida con la pantalla y el reporte", async () => {
        await llamar("get_waste_zombies");

        expect(scanLiveZombies).toHaveBeenCalledWith(TENANT);
        // Misma clave y mismos TTL (duro 15 min, blando 5) que `/api/cleanup/zombies` y el reporte ejecutivo.
        expect(cacheSwr).toHaveBeenCalledWith(`zombies:${TENANT}`, expect.any(Function), 900, 300);
    });

    it("devuelve a lo sumo 100 hallazgos", async () => {
        scanLiveZombies.mockResolvedValue(Array.from({ length: 130 }, (_, i) => zombi("Microsoft.Compute/disks", `d-${i}`, 130 - i)));

        const r = await llamar("get_waste_zombies");

        expect(r.count).toBe(100);
        expect(r.waste[0].estimated_waste_usd).toBe(130);
        expect(r.waste[99].estimated_waste_usd).toBe(31);
    });

    it("tenant limpio: lista vacía y SIN nota (eso sí es 'no hay desperdicio')", async () => {
        scanLiveZombies.mockResolvedValue([]);

        expect(await llamar("get_waste_zombies")).toEqual({ count: 0, waste: [] });
    });

    it("si el escaneo falla lo dice y lo registra: no se lee como 'no hay' ni culpa a una tabla", async () => {
        scanLiveZombies.mockRejectedValue(new Error("ARG 429: demasiadas solicitudes"));

        for (const [tool, lista] of [["get_waste_zombies", "waste"], ["get_zombie_resources", "zombies"]] as const) {
            const r = await llamar(tool);

            expect(r.count).toBe(0);
            expect(r[lista]).toEqual([]);
            expect(r.note).toContain("429");
            expect(r.note).not.toMatch(/tabla|no disponible/i);
            // Sin esta línea el fallo sólo se veía como "no hay desperdicio".
            expect(errorDeLaTool(tool)).toBe(true);
        }
    });
});

describe("MCP get_budgets_status y get_budget_status", () => {
    it("el límite sale de la tabla y el gasto de Cost Management; sólo los presupuestos activos", async () => {
        const r = await llamar("get_budgets_status");

        expect(base.violaciones).toEqual([]);
        expect(query.mock.calls.some(([sql]) => /FROM\s+Budgets\s+WHERE\s+tenant_id/i.test(String(sql)))).toBe(true);
        expect(r.note).toBeUndefined();
        expect(r).toEqual({
            count: 3,
            budgets: [
                // `Budgets` sólo guarda presupuestos mensuales y el gasto es el del mes en curso: de ahí el `period`.
                { name: "Plataforma", period: "monthly", budgetUSD: 1000, spentUSD: 400, usagePct: 40, status: "ok" },
                { name: "Datos", period: "monthly", budgetUSD: 500, spentUSD: 650, usagePct: 130, status: "exceeded" },
                { name: "Web", period: "monthly", budgetUSD: 1000, spentUSD: 850, usagePct: 85, status: "warning" },
            ],
        });
    });

    it("el alias get_budget_status devuelve lo mismo", async () => {
        expect(await llamar("get_budget_status")).toEqual(await llamar("get_budgets_status"));
    });

    it("pide el gasto de todo el tenant y por la MISMA caché que la pantalla de Presupuestos", async () => {
        await llamar("get_budgets_status");

        expect(getBudgetConsumption).toHaveBeenCalledWith(TENANT, "All", "Plataforma");
        // Clave `budgets:{tenant}:All` (TTL 1 h; 5 min si Cost Management tiró 429): lo que GET /api/budgets guarda.
        expect(cacheSwr).toHaveBeenCalledWith(`budgets:${TENANT}:All`, expect.any(Function), 3600, undefined, expect.any(Function));
    });

    it("si Cost Management no contesta por un presupuesto, ese gasto es desconocido, no cero", async () => {
        getBudgetConsumption.mockImplementation(async (_t: string, _s: string, centro: string) => {
            if (centro === "Datos") throw new Error("Azure Cost Management 429 throttled para todas las suscripciones");
            return GASTO[centro];
        });

        const r = await llamar("get_budgets_status");

        // Un 0 acá se leería como "0% usado, todo ok": peor que no tener el dato.
        expect(r.budgets.find((b: { name: string }) => b.name === "Datos")).toEqual({
            name: "Datos",
            period: "monthly",
            budgetUSD: 500,
            spentUSD: null,
            usagePct: null,
            status: "unknown",
        });
        expect(r.budgets.find((b: { name: string }) => b.name === "Plataforma")).toMatchObject({ spentUSD: 400, status: "ok" });
    });

    it("si no se puede leer la tabla lo dice y lo registra: no culpa a una tabla que existe", async () => {
        query.mockRejectedValue(Object.assign(new Error("Connection lost: The server closed the connection."), { code: "PROTOCOL_CONNECTION_LOST" }));

        for (const tool of ["get_budgets_status", "get_budget_status"]) {
            const r = await llamar(tool);

            expect(r.count).toBe(0);
            expect(r.budgets).toEqual([]);
            expect(r.note).toContain("Connection lost");
            expect(r.note).not.toMatch(/no disponible/i);
            expect(errorDeLaTool(tool)).toBe(true);
        }
    });
});

describe("MCP get_recommendations", () => {
    it("sale de Azure Advisor, categoría Cost: las abiertas, de mayor a menor ahorro mensual", async () => {
        const r = await llamar("get_recommendations");

        expect(base.violaciones).toEqual([]);
        expect(r.note).toBeUndefined();
        expect(r).toEqual({
            count: 3,
            recommendations: [
                {
                    id: "ri-1",
                    kind: "PURCHASE_RESERVATION",
                    resource_id: rid("Microsoft.Compute/virtualMachines", "vm-ri-1"),
                    // Sin acción sintetizada, el texto es el título que trae Advisor.
                    action_text: "Problema de ri-1",
                    estimated_savings_usd: 300,
                },
                {
                    id: "rs-1",
                    kind: "RESIZE",
                    resource_id: rid("Microsoft.Compute/virtualMachines", "vm-rs-1"),
                    action_text: "Redimensionar vm-rs-1 a Standard_D2s_v5",
                    estimated_savings_usd: 50,
                },
                {
                    id: "ip-1",
                    kind: "DELETE_IP",
                    resource_id: rid("Microsoft.Compute/virtualMachines", "vm-ip-1"),
                    action_text: "Problema de ip-1",
                    estimated_savings_usd: 4,
                },
            ],
        });
        // Ni la de otro pilar (Security) ni la pospuesta (999 USD) cuentan como recomendación abierta de costo.
        expect(JSON.stringify(r)).not.toContain("seg-1");
        expect(JSON.stringify(r)).not.toContain("pospuesta");
    });

    it("respeta el límite pedido, con tope en 100", async () => {
        const dos = await llamar("get_recommendations", { limit: 2 });
        expect(dos.recommendations.map((x: { id: string }) => x.id)).toEqual(["ri-1", "rs-1"]);

        getAdvisorExecutiveData.mockResolvedValue({
            recommendations: { Cost: Array.from({ length: 130 }, (_, i) => recomendacion(`r-${i}`, "RESIZE", i + 1)) },
        });
        cacheSwr.mockImplementation(async (_c: string, f: () => unknown) => f());
        const muchas = await llamar("get_recommendations", { limit: 5000 });
        expect(muchas.count).toBe(100);
        expect(muchas.recommendations[0].estimated_savings_usd).toBe(130);
    });

    it("usa su propia clave de caché (30 min), no la de /api/advisor: no pisa el texto reescrito con IA de la pantalla", async () => {
        await llamar("get_recommendations");

        expect(getAdvisorExecutiveData).toHaveBeenCalledWith(TENANT, "es");
        expect(cacheSwr).toHaveBeenCalledWith(`mcp:advisor-cost:v1:${TENANT}`, expect.any(Function), 1800);
        expect(cacheSwr.mock.calls.some(([clave]) => String(clave).startsWith("advisor:"))).toBe(false);
    });

    it("no consulta MySQL: la tabla `recommendations` no existe", async () => {
        await llamar("get_recommendations");

        expect(query).not.toHaveBeenCalled();
    });

    it("sin recomendaciones abiertas: lista vacía y SIN nota", async () => {
        getAdvisorExecutiveData.mockResolvedValue({ recommendations: { Cost: [] } });

        expect(await llamar("get_recommendations")).toEqual({ count: 0, recommendations: [] });
    });

    it("si Advisor falla lo dice y lo registra: no se lee como 'no hay' ni culpa a una tabla", async () => {
        getAdvisorExecutiveData.mockRejectedValue(Object.assign(new Error("Falta rol Lector en las suscripciones"), { code: "MISSING_RBAC_ROLE" }));

        const r = await llamar("get_recommendations");

        expect(r.count).toBe(0);
        expect(r.recommendations).toEqual([]);
        expect(r.note).toContain("Falta rol Lector");
        expect(r.note).not.toMatch(/tabla|no disponible/i);
        expect(errorDeLaTool("get_recommendations")).toBe(true);
    });
});

describe("feed de Power BI", () => {
    it("zombies: el desperdicio duro vigente (sin eximidos ni higiene) con las columnas de la plantilla", async () => {
        const { status, cuerpo } = await pedirFeed("zombies");

        expect(base.violaciones).toEqual([]);
        expect(status).toBe(200);
        expect(cuerpo).toEqual({
            success: true,
            type: "zombies",
            data: DESPERDICIO_ESPERADO.map((d) => ({
                resource_id: rid(d.tipo, d.name),
                resource_type: d.tipo.toLowerCase(),
                location: "eastus",
                resource_group: "rg",
                estimated_monthly_cost_usd: d.usd,
            })),
        });
    });

    it("zombies: si el escaneo falla responde 500, no una tabla vacía que Power BI importaría sin error", async () => {
        scanLiveZombies.mockRejectedValue(new Error("ARG 429: demasiadas solicitudes"));

        const { status, cuerpo } = await pedirFeed("zombies");

        expect(status).toBe(500);
        expect(cuerpo.success).toBe(false);
        expect(cuerpo.error).toContain("429");
        expect(cuerpo.data).toBeUndefined();
    });

    it("budgets: el mismo estado que el MCP, con las columnas de la plantilla", async () => {
        const { status, cuerpo } = await pedirFeed("budgets");

        expect(base.violaciones).toEqual([]);
        expect(status).toBe(200);
        expect(cuerpo.type).toBe("budgets");
        expect(cuerpo.data).toEqual((await llamar("get_budgets_status")).budgets);
        expect(cuerpo.data.map((b: { name: string }) => b.name)).toEqual(["Plataforma", "Datos", "Web"]);
    });

    it("budgets: si no se puede leer la tabla responde 500, no una tabla vacía", async () => {
        query.mockImplementation(async (sql: string) => {
            if (/FROM\s+Budgets/i.test(sql)) throw new Error("Connection lost");
            return [[{ tenant_id: TENANT }], []];
        });

        const { status, cuerpo } = await pedirFeed("budgets");

        expect(status).toBe(500);
        expect(cuerpo).toMatchObject({ success: false, error: expect.stringContaining("Connection lost") });
    });
});

describe("getBudgetsUtilization (lo que sirve GET /api/budgets y comparten el MCP y el feed)", () => {
    afterEach(() => vi.useRealTimers());

    it("la clave de caché es una sola, y la ruta invalida con el mismo prefijo", () => {
        expect(budgetsCacheKey("t1", "All")).toBe("budgets:t1:All");
        expect(budgetsCacheKey("t1", "*")).toBe("budgets:t1:*");
    });

    it("cada presupuesto lleva lo que la pantalla muestra: límite, gasto, utilización y proyección", async () => {
        // 10 de octubre (31 días): a 40 USD/día el mes cierra en 1.240 y el límite de 1.000 se pasa el día 25.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
        query.mockImplementation(base.query({ budgets: () => [presupuesto(1, "Plataforma", "1000.00")] }));

        const { budgets, throttled } = await getBudgetsUtilization(TENANT, "All");

        expect(throttled).toBe(false);
        expect(budgets).toEqual([
            {
                id: 1,
                costCenter: "Plataforma",
                monthlyLimit: 1000,
                alertThreshold: 80,
                currentSpend: 400,
                utilization: 40,
                dailyBurnRate: 40,
                forecastedMonthEndSpend: 1240,
                forecastedBreachDate: "Día 25",
                budgetStatus: "CRITICAL",
                active: true,
                spendAvailable: true,
            },
        ]);
    });

    it("un 429 de Cost Management marca el resultado como degradado y el gasto como no disponible", async () => {
        query.mockImplementation(base.query({ budgets: () => [presupuesto(1, "Plataforma", "1000.00")] }));
        getBudgetConsumption.mockRejectedValue(Object.assign(new Error("Azure Cost Management 429 throttled"), { is429: true }));

        const { budgets, throttled } = await getBudgetsUtilization(TENANT, "All");

        expect(throttled).toBe(true);
        expect(budgets[0]).toMatchObject({ costCenter: "Plataforma", currentSpend: 0, spendAvailable: false });
        // El TTL del resultado degradado es corto (5 min, no 1 h): el 0 no se congela.
        const ttlDinamico = cacheSwr.mock.calls[0][4] as (r: { throttled: boolean; budgets: { spendAvailable: boolean }[] }) => number;
        expect(ttlDinamico({ throttled: true, budgets: [] })).toBe(300);
        expect(ttlDinamico({ throttled: false, budgets: [{ spendAvailable: true }] })).toBe(3600);
    });

    it("cualquier gasto no disponible (no sólo el 429) acorta el TTL: el 'unknown' no se congela una hora", async () => {
        query.mockImplementation(base.query({ budgets: () => [presupuesto(1, "Plataforma", "1000.00")] }));
        getBudgetConsumption.mockRejectedValue(new Error("No se pudo obtener la credencial de Azure"));

        const { throttled } = await getBudgetsUtilization(TENANT, "All");

        expect(throttled).toBe(false);
        const ttlDinamico = cacheSwr.mock.calls[0][4] as (r: { throttled: boolean; budgets: { spendAvailable: boolean }[] }) => number;
        expect(ttlDinamico({ throttled: false, budgets: [{ spendAvailable: false }] })).toBe(300);
    });
});

describe("peekActiveHardWaste (el buscador: sólo la caché, nunca el escaneo)", () => {
    it("con un escaneo reciente en la caché devuelve el desperdicio duro vigente", async () => {
        peekSwr.mockResolvedValue(HALLAZGOS);

        const r = await peekActiveHardWaste(TENANT);

        expect(peekSwr).toHaveBeenCalledWith(`zombies:${TENANT}`);
        expect(r?.map((x) => x.name)).toEqual(DESPERDICIO_ESPERADO.map((d) => d.name));
        expect(base.violaciones).toEqual([]);
    });

    it("con la caché fría devuelve null, sin escanear ni tocar MySQL", async () => {
        peekSwr.mockResolvedValue(null);

        expect(await peekActiveHardWaste(TENANT)).toBeNull();
        expect(scanLiveZombies).not.toHaveBeenCalled();
        expect(cacheSwr).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    it("una lista vacía en la caché es un dato (tenant limpio), no una caché fría", async () => {
        peekSwr.mockResolvedValue([]);

        expect(await peekActiveHardWaste(TENANT)).toEqual([]);
    });
});
